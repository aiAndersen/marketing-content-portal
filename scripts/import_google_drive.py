#!/usr/bin/env python3
"""
Google Drive Content Import & Enrichment

Connects to Google Drive via service account, scans configured folders,
extracts text from documents, and imports or updates records in
marketing_content.

Prerequisites:
    pip install google-api-python-client google-auth python-docx PyPDF2
    Set GOOGLE_SERVICE_ACCOUNT_KEY_PATH in scripts/.env (path to service account JSON key)
    Set GOOGLE_DRIVE_FOLDER_ID in scripts/.env (shared folder to scan)

Setup:
    1. Create a GCP project at https://console.cloud.google.com
    2. Enable the Google Drive API
    3. Create a service account and download the JSON key file
    4. Share the target Google Drive folder with the service account email
    5. Add to scripts/.env:
       GOOGLE_SERVICE_ACCOUNT_KEY_PATH=/path/to/service-account-key.json
       GOOGLE_DRIVE_FOLDER_ID=your_folder_id_here

Usage:
    python scripts/import_google_drive.py                      # Scan & match to existing content
    python scripts/import_google_drive.py --dry-run             # Preview without changes
    python scripts/import_google_drive.py --import-new          # Also import unmatched files as new records
    python scripts/import_google_drive.py --enrich              # Run AI enrichment on imported content
    python scripts/import_google_drive.py --folder-id FOLDER_ID # Scan specific folder
    python scripts/import_google_drive.py --limit 20            # Process max 20 files
"""

import os
import sys
import argparse
import json
import re
import time
from datetime import datetime
from typing import Optional, Dict, Any, List
from io import BytesIO

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Google API imports
try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
    GOOGLE_API_AVAILABLE = True
except ImportError:
    GOOGLE_API_AVAILABLE = False

# Optional enrichment dependencies
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

try:
    from PyPDF2 import PdfReader
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

try:
    import docx
    DOCX_AVAILABLE = True
except ImportError:
    DOCX_AVAILABLE = False

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
GOOGLE_SERVICE_ACCOUNT_KEY_PATH = os.getenv('GOOGLE_SERVICE_ACCOUNT_KEY_PATH')
GOOGLE_DRIVE_FOLDER_ID = os.getenv('GOOGLE_DRIVE_FOLDER_ID')

# Google Drive MIME types
MIME_TYPES = {
    'application/vnd.google-apps.document': 'google_doc',
    'application/vnd.google-apps.spreadsheet': 'google_sheet',
    'application/vnd.google-apps.presentation': 'google_slides',
    'application/pdf': 'pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
}

# Content type detection from filename
CONTENT_TYPE_PATTERNS = {
    '1-Pager': ['1-pager', 'one-pager', 'onepager', 'fact sheet', 'factsheet', 'datasheet',
                'brochure', 'flyer', 'sell sheet', 'infographic'],
    'Ebook': ['ebook', 'whitepaper', 'white paper', 'guide', 'handbook', 'playbook', 'report'],
    'Customer Story': ['case study', 'case-study', 'success story', 'testimonial', 'customer story'],
    'Webinar': ['webinar', 'presentation', 'deck', 'slides'],
    'Video': ['video', 'demo', 'tutorial'],
    'Blog': ['blog', 'article', 'post'],
}

ENRICHMENT_MODEL = 'gpt-5.2'
REQUEST_DELAY = 1


def get_db_connection():
    """Create a database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def get_drive_service():
    """Create Google Drive API service using service account."""
    if not GOOGLE_API_AVAILABLE:
        print("ERROR: google-api-python-client and google-auth not installed.")
        print("  pip install google-api-python-client google-auth")
        sys.exit(1)

    if not GOOGLE_SERVICE_ACCOUNT_KEY_PATH:
        print("ERROR: GOOGLE_SERVICE_ACCOUNT_KEY_PATH not set in .env")
        print("  Set it to the path of your service account JSON key file")
        sys.exit(1)

    if not os.path.exists(GOOGLE_SERVICE_ACCOUNT_KEY_PATH):
        print(f"ERROR: Service account key file not found: {GOOGLE_SERVICE_ACCOUNT_KEY_PATH}")
        sys.exit(1)

    scopes = ['https://www.googleapis.com/auth/drive.readonly']
    credentials = service_account.Credentials.from_service_account_file(
        GOOGLE_SERVICE_ACCOUNT_KEY_PATH, scopes=scopes
    )
    return build('drive', 'v3', credentials=credentials)


# =============================================================================
# File Discovery
# =============================================================================

def list_files_recursive(service, folder_id: str, verbose: bool = False) -> List[Dict]:
    """List all files in a Google Drive folder recursively."""
    all_files = []

    # Query for files in this folder
    query = f"'{folder_id}' in parents and trashed = false"
    page_token = None

    while True:
        results = service.files().list(
            q=query,
            pageSize=100,
            fields="nextPageToken, files(id, name, mimeType, modifiedTime, size, webViewLink)",
            pageToken=page_token
        ).execute()

        items = results.get('files', [])

        for item in items:
            mime = item.get('mimeType', '')

            # If it's a folder, recurse into it
            if mime == 'application/vnd.google-apps.folder':
                if verbose:
                    print(f"    Scanning subfolder: {item['name']}/")
                sub_files = list_files_recursive(service, item['id'], verbose)
                all_files.extend(sub_files)
            # If it's a supported file type, add it
            elif mime in MIME_TYPES:
                item['file_type'] = MIME_TYPES[mime]
                all_files.append(item)

        page_token = results.get('nextPageToken')
        if not page_token:
            break

    return all_files


# =============================================================================
# Content Extraction
# =============================================================================

def extract_google_doc(service, file_id: str) -> Optional[str]:
    """Export Google Doc as plain text."""
    try:
        result = service.files().export(fileId=file_id, mimeType='text/plain').execute()
        text = result.decode('utf-8') if isinstance(result, bytes) else str(result)
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:8000] if text else None
    except Exception as e:
        print(f"      Doc export error: {e}")
        return None


def extract_google_sheet(service, file_id: str) -> Optional[str]:
    """Export Google Sheet as CSV text."""
    try:
        result = service.files().export(fileId=file_id, mimeType='text/csv').execute()
        text = result.decode('utf-8') if isinstance(result, bytes) else str(result)
        return text[:8000] if text else None
    except Exception as e:
        print(f"      Sheet export error: {e}")
        return None


def extract_google_slides(service, file_id: str) -> Optional[str]:
    """Export Google Slides as plain text."""
    try:
        result = service.files().export(fileId=file_id, mimeType='text/plain').execute()
        text = result.decode('utf-8') if isinstance(result, bytes) else str(result)
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:8000] if text else None
    except Exception as e:
        print(f"      Slides export error: {e}")
        return None


def download_file_bytes(service, file_id: str) -> Optional[bytes]:
    """Download a binary file from Google Drive."""
    try:
        request = service.files().get_media(fileId=file_id)
        buffer = BytesIO()
        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        return buffer.getvalue()
    except Exception as e:
        print(f"      Download error: {e}")
        return None


def extract_pdf_from_bytes(data: bytes) -> Optional[str]:
    """Extract text from PDF bytes."""
    if not PDF_AVAILABLE:
        print("      PyPDF2 not installed, skipping PDF")
        return None
    try:
        reader = PdfReader(BytesIO(data))
        text = ''
        for page in reader.pages[:15]:
            text += page.extract_text() or ''
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:8000] if text else None
    except Exception as e:
        print(f"      PDF extraction error: {e}")
        return None


def extract_docx_from_bytes(data: bytes) -> Optional[str]:
    """Extract text from DOCX bytes."""
    if not DOCX_AVAILABLE:
        print("      python-docx not installed, skipping DOCX")
        return None
    try:
        doc = docx.Document(BytesIO(data))
        text = '\n'.join(para.text for para in doc.paragraphs)
        text = re.sub(r'\s+', ' ', text).strip()
        return text[:8000] if text else None
    except Exception as e:
        print(f"      DOCX extraction error: {e}")
        return None


def extract_content_from_drive_file(service, file_info: Dict) -> Optional[str]:
    """Extract text content from a Google Drive file."""
    file_type = file_info.get('file_type', '')
    file_id = file_info['id']

    if file_type == 'google_doc':
        return extract_google_doc(service, file_id)
    elif file_type == 'google_sheet':
        return extract_google_sheet(service, file_id)
    elif file_type == 'google_slides':
        return extract_google_slides(service, file_id)
    elif file_type == 'pdf':
        data = download_file_bytes(service, file_id)
        return extract_pdf_from_bytes(data) if data else None
    elif file_type == 'docx':
        data = download_file_bytes(service, file_id)
        return extract_docx_from_bytes(data) if data else None
    else:
        return None


# =============================================================================
# Content Type Detection
# =============================================================================

def detect_content_type_from_name(filename: str) -> str:
    """Detect marketing content type from filename."""
    name_lower = filename.lower()
    for content_type, patterns in CONTENT_TYPE_PATTERNS.items():
        for pattern in patterns:
            if pattern in name_lower:
                return content_type
    return 'Asset'


# =============================================================================
# Database Matching
# =============================================================================

def find_matching_content(conn, title: str, drive_url: str) -> Optional[Dict]:
    """Find an existing marketing_content record matching this Drive file."""
    with conn.cursor() as cur:
        # Try exact URL match first
        if drive_url:
            cur.execute("""
                SELECT id, title, live_link, ungated_link, extracted_text
                FROM marketing_content
                WHERE live_link = %s OR ungated_link = %s
                LIMIT 1
            """, (drive_url, drive_url))
            match = cur.fetchone()
            if match:
                return match

        # Try title match (fuzzy)
        clean_title = re.sub(r'\.(pdf|docx|pptx|xlsx)$', '', title, flags=re.IGNORECASE).strip()
        if len(clean_title) > 5:
            cur.execute("""
                SELECT id, title, live_link, ungated_link, extracted_text
                FROM marketing_content
                WHERE LOWER(title) ILIKE %s
                LIMIT 1
            """, (f"%{clean_title.lower()}%",))
            match = cur.fetchone()
            if match:
                return match

    return None


# =============================================================================
# AI Enrichment
# =============================================================================

def enrich_with_ai(openai_client, title: str, content_type: str, extracted_text: str) -> Dict:
    """Generate AI enrichment for imported content."""
    try:
        messages = [
            {
                "role": "system",
                "content": "You are a marketing content analyst for SchooLinks, a K-12 college and career readiness platform. Generate structured metadata for search optimization. Respond with valid JSON only."
            },
            {
                "role": "user",
                "content": f"""Analyze this marketing content and generate metadata.

TITLE: {title}
TYPE: {content_type}

CONTENT:
{extracted_text[:6000]}

Return JSON:
{{
  "enhanced_summary": "3-5 sentence summary optimized for search",
  "auto_tags": ["tag1", "tag2", ...],
  "keywords": [
    {{"keyword": "term", "weight": 0.9, "category": "topic|persona|feature|competitor|state"}}
  ],
  "state": "2-letter state abbreviation if state-specific, or 'National'"
}}

Be selective with tags - only include what's actually in the content."""
            }
        ]

        # gpt-5.x models use max_completion_tokens instead of max_tokens
        api_params = {"model": ENRICHMENT_MODEL, "messages": messages}
        if ENRICHMENT_MODEL.startswith('gpt-5') or ENRICHMENT_MODEL.startswith('o'):
            api_params["max_completion_tokens"] = 1500
        else:
            api_params["temperature"] = 0.3
            api_params["max_tokens"] = 1500

        response = openai_client.chat.completions.create(**api_params)

        content = response.choices[0].message.content
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json.loads(json_match.group())
        return {}
    except Exception as e:
        print(f"      AI enrichment error: {e}")
        return {}


# =============================================================================
# Main Processing
# =============================================================================

def process_file(
    conn,
    service,
    openai_client,
    file_info: Dict,
    import_new: bool = False,
    enrich: bool = False,
    dry_run: bool = False,
    verbose: bool = False,
) -> str:
    """Process a single Google Drive file. Returns: 'matched', 'imported', 'skipped', or 'error'."""
    name = file_info['name']
    file_type = file_info.get('file_type', 'unknown')
    drive_url = file_info.get('webViewLink', '')

    print(f"\n  [{file_type}] {name[:60]}...")

    if dry_run:
        match = find_matching_content(conn, name, drive_url)
        if match:
            print(f"    [DRY RUN] Would update: \"{match['title'][:50]}\"")
            return 'matched'
        elif import_new:
            print(f"    [DRY RUN] Would import as new record")
            return 'imported'
        else:
            print(f"    [DRY RUN] No match found (use --import-new to create)")
            return 'skipped'

    # Extract content
    if verbose:
        print(f"    Extracting content...")
    extracted_text = extract_content_from_drive_file(service, file_info)

    if not extracted_text or len(extracted_text) < 50:
        print(f"    - No extractable content")
        return 'error'

    if verbose:
        print(f"    Extracted {len(extracted_text)} chars")

    # AI enrichment
    ai_data = {}
    if enrich and openai_client:
        content_type = detect_content_type_from_name(name)
        if verbose:
            print(f"    Enriching with AI ({ENRICHMENT_MODEL})...")
        ai_data = enrich_with_ai(openai_client, name, content_type, extracted_text)
        time.sleep(REQUEST_DELAY)

    # Try to match existing record
    match = find_matching_content(conn, name, drive_url)

    if match:
        # Update existing record
        update_fields = {'extracted_text': extracted_text[:5000]}
        if ai_data.get('enhanced_summary'):
            update_fields['enhanced_summary'] = ai_data['enhanced_summary']
        if ai_data.get('auto_tags'):
            tags = ai_data['auto_tags']
            update_fields['auto_tags'] = ', '.join(tags) if isinstance(tags, list) else tags
        if ai_data.get('keywords'):
            keywords = ai_data['keywords']
            validated = []
            for kw in keywords:
                if isinstance(kw, dict) and 'keyword' in kw:
                    validated.append({
                        'keyword': str(kw['keyword']),
                        'weight': float(kw.get('weight', 0.5)),
                        'category': str(kw.get('category', 'topic')),
                    })
            update_fields['keywords'] = json.dumps(validated)

        # Build dynamic UPDATE
        set_clauses = []
        values = []
        for field, value in update_fields.items():
            if field == 'keywords':
                set_clauses.append(f"{field} = %s::jsonb")
            else:
                set_clauses.append(f"{field} = %s")
            values.append(value)
        set_clauses.append("deep_enriched_at = %s")
        values.append(datetime.utcnow())
        values.append(match['id'])

        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE marketing_content SET {', '.join(set_clauses)} WHERE id = %s",
                values
            )
        conn.commit()
        print(f"    + Updated: \"{match['title'][:50]}\"")
        return 'matched'

    elif import_new:
        # Insert new record
        content_type = detect_content_type_from_name(name)
        clean_title = re.sub(r'\.(pdf|docx|pptx|xlsx)$', '', name, flags=re.IGNORECASE).strip()

        enhanced_summary = ai_data.get('enhanced_summary', '')
        auto_tags = ai_data.get('auto_tags', [])
        if isinstance(auto_tags, list):
            auto_tags = ', '.join(auto_tags)
        keywords_json = '[]'
        if ai_data.get('keywords'):
            validated = []
            for kw in ai_data['keywords']:
                if isinstance(kw, dict) and 'keyword' in kw:
                    validated.append({
                        'keyword': str(kw['keyword']),
                        'weight': float(kw.get('weight', 0.5)),
                        'category': str(kw.get('category', 'topic')),
                    })
            keywords_json = json.dumps(validated)
        state = ai_data.get('state', 'National')

        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO marketing_content
                    (type, title, live_link, platform, summary, state, tags,
                     enhanced_summary, auto_tags, keywords, extracted_text,
                     content_analyzed_at, deep_enriched_at)
                VALUES
                    (%s, %s, %s, 'Google Drive', %s, %s, %s,
                     %s, %s, %s::jsonb, %s,
                     %s, %s)
            """, (
                content_type,
                clean_title,
                drive_url,
                enhanced_summary or f"Content imported from Google Drive: {clean_title}",
                state if state and len(state) == 2 else None,
                auto_tags,
                enhanced_summary,
                auto_tags,
                keywords_json,
                extracted_text[:5000],
                datetime.utcnow(),
                datetime.utcnow(),
            ))
        conn.commit()
        print(f"    + Imported as new [{content_type}]: \"{clean_title[:50]}\"")
        return 'imported'

    else:
        print(f"    - No match (use --import-new to create)")
        return 'skipped'


def main():
    parser = argparse.ArgumentParser(
        description='Google Drive Content Import & Enrichment',
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument('--folder-id', type=str, help='Google Drive folder ID to scan')
    parser.add_argument('--import-new', action='store_true',
                        help='Import unmatched files as new marketing_content records')
    parser.add_argument('--enrich', action='store_true',
                        help='Run AI enrichment on imported/updated content')
    parser.add_argument('--limit', type=int, help='Max files to process')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')
    args = parser.parse_args()

    print("=" * 60)
    print("Google Drive Content Import")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    folder_id = args.folder_id or GOOGLE_DRIVE_FOLDER_ID
    if not folder_id:
        print("ERROR: No folder ID specified.")
        print("  Set GOOGLE_DRIVE_FOLDER_ID in scripts/.env")
        print("  Or use --folder-id FOLDER_ID")
        sys.exit(1)

    # Connect to Drive
    print("\nConnecting to Google Drive...")
    service = get_drive_service()
    print("  Connected via service account")

    # Connect to database
    print("Connecting to database...")
    conn = get_db_connection()
    print("  Connected")

    # OpenAI client (optional)
    openai_client = None
    if args.enrich:
        if OPENAI_AVAILABLE and OPENAI_API_KEY:
            openai_client = OpenAI(api_key=OPENAI_API_KEY)
            print(f"  OpenAI available (model: {ENRICHMENT_MODEL})")
        else:
            print("  Warning: OpenAI not available, enrichment will be skipped")

    # Discover files
    print(f"\nScanning folder: {folder_id}")
    files = list_files_recursive(service, folder_id, verbose=args.verbose)
    print(f"  Found {len(files)} supported files")

    if not files:
        print("\nNo supported files found in the specified folder.")
        conn.close()
        return

    if args.limit:
        files = files[:args.limit]
        print(f"  Processing first {len(files)} files")

    # Process files
    print(f"\nProcessing {len(files)} files...")
    counts = {'matched': 0, 'imported': 0, 'skipped': 0, 'error': 0}

    for i, file_info in enumerate(files):
        if args.verbose:
            print(f"\n[{i+1}/{len(files)}]", end='')

        result = process_file(
            conn=conn,
            service=service,
            openai_client=openai_client,
            file_info=file_info,
            import_new=args.import_new,
            enrich=args.enrich,
            dry_run=args.dry_run,
            verbose=args.verbose,
        )
        counts[result] = counts.get(result, 0) + 1

    # Summary
    print("\n")
    print("=" * 60)
    print("Import Summary")
    print("=" * 60)
    print(f"  Total files:   {len(files)}")
    print(f"  Matched:       {counts['matched']} (updated existing records)")
    print(f"  Imported:      {counts['imported']} (new records created)")
    print(f"  Skipped:       {counts['skipped']} (no match, --import-new not set)")
    print(f"  Errors:        {counts['error']}")

    if args.dry_run:
        print("\n  [DRY RUN] No changes were made.")

    conn.close()
    print("\nDone!")


if __name__ == '__main__':
    main()

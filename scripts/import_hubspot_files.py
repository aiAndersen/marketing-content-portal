#!/usr/bin/env python3
"""
HubSpot Files Import Script for Marketing Content Portal

Pulls files from HubSpot File Manager API and syncs them to Supabase
marketing_content table. Filters by date and avoids duplicates.

Usage:
    python import_hubspot_files.py                    # Import files since Jan 2025
    python import_hubspot_files.py --since 2025-01-01 # Custom start date
    python import_hubspot_files.py --dry-run          # Preview without inserting
    python import_hubspot_files.py --limit 50         # Limit number of files

Required environment variables:
    HUBSPOT_API_KEY - HubSpot private app token
    SUPABASE_URL
    SUPABASE_KEY (or DATABASE_URL for direct DB access)
"""

import os
import sys
import argparse
import json
import re
import time
from datetime import datetime, timezone
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse, unquote

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import requests
from openai import OpenAI

# Load environment variables
load_dotenv()

# Configuration
HUBSPOT_API_KEY = os.getenv('HUBSPOT_API_KEY')
DATABASE_URL = os.getenv('DATABASE_URL')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Initialize OpenAI client
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# HubSpot API base URL
HUBSPOT_API_BASE = 'https://api.hubapi.com'

# Rate limiting
REQUEST_DELAY = 0.5  # seconds between API calls

# File type to content type mapping
FILE_TYPE_MAP = {
    'PDF': 'Ebook',  # Default PDFs to Ebook, can be refined
    'DOCUMENT': 'Asset',
    'SPREADSHEET': 'Asset',
    'PRESENTATION': 'Webinar',
    'IMAGE': 'Asset',
    'VIDEO': 'Video',
    'AUDIO': 'Asset',
    'OTHER': 'Asset'
}

# Keywords to detect content type from filename (checked in order - first match wins)
# More specific patterns should come before general ones
CONTENT_TYPE_KEYWORDS = [
    # 1-Pagers (specific patterns first)
    ('1-pager', '1-Pager'),
    ('one-pager', '1-Pager'),
    ('onepager', '1-Pager'),
    ('one pager', '1-Pager'),
    ('1 pager', '1-Pager'),
    ('datasheet', '1-Pager'),
    ('data sheet', '1-Pager'),
    ('data-sheet', '1-Pager'),
    ('brochure', '1-Pager'),
    ('flyer', '1-Pager'),
    ('flier', '1-Pager'),
    ('overview sheet', '1-Pager'),
    ('product sheet', '1-Pager'),
    ('fact sheet', '1-Pager'),
    ('factsheet', '1-Pager'),
    ('info sheet', '1-Pager'),
    ('sell sheet', '1-Pager'),
    ('leave behind', '1-Pager'),
    ('leave-behind', '1-Pager'),
    ('handout', '1-Pager'),
    ('hand out', '1-Pager'),
    ('comparison sheet', '1-Pager'),
    ('competitive', '1-Pager'),

    # Ebooks and longer content
    ('ebook', 'Ebook'),
    ('e-book', 'Ebook'),
    ('whitepaper', 'Ebook'),
    ('white paper', 'Ebook'),
    ('white-paper', 'Ebook'),
    ('playbook', 'Ebook'),
    ('play book', 'Ebook'),
    ('guidebook', 'Ebook'),
    ('guide book', 'Ebook'),
    ('handbook', 'Ebook'),
    ('hand book', 'Ebook'),
    ('toolkit', 'Ebook'),
    ('tool kit', 'Ebook'),
    ('resource guide', 'Ebook'),
    ('buyers guide', 'Ebook'),
    ('buyer guide', 'Ebook'),
    ('implementation guide', 'Ebook'),
    ('best practices', 'Ebook'),
    ('ultimate guide', 'Ebook'),
    ('complete guide', 'Ebook'),
    ('comprehensive', 'Ebook'),

    # Customer Stories
    ('case study', 'Customer Story'),
    ('case-study', 'Customer Story'),
    ('casestudy', 'Customer Story'),
    ('customer story', 'Customer Story'),
    ('customer-story', 'Customer Story'),
    ('success story', 'Customer Story'),
    ('testimonial', 'Customer Story'),
    ('district story', 'Customer Story'),
    ('school story', 'Customer Story'),

    # Webinars and presentations
    ('webinar', 'Webinar'),
    ('web-inar', 'Webinar'),
    ('presentation', 'Webinar'),
    ('slide deck', 'Webinar'),
    ('slidedeck', 'Webinar'),
    ('slides', 'Webinar'),
    ('ppt', 'Webinar'),
    ('powerpoint', 'Webinar'),

    # Videos
    ('video', 'Video'),
    ('demo', 'Video'),
    ('tutorial', 'Video'),
    ('walkthrough', 'Video'),
    ('walk through', 'Video'),
    ('recording', 'Video'),

    # Blog (for written content)
    ('blog', 'Blog'),
    ('article', 'Blog'),
    ('post', 'Blog'),

    # Press/Awards
    ('press release', 'Press Release'),
    ('press-release', 'Press Release'),
    ('news release', 'Press Release'),
    ('announcement', 'Press Release'),
    ('award', 'Award'),
    ('winner', 'Award'),
    ('recognition', 'Award'),

    # Landing pages
    ('landing page', 'Landing Page'),
    ('landing-page', 'Landing Page'),
    ('lp-', 'Landing Page'),

    # Social/Marketing specific
    ('social', 'Asset'),
    ('linkedin', 'Asset'),
    ('twitter', 'Asset'),
    ('facebook', 'Asset'),
    ('instagram', 'Asset'),
    ('email', 'Asset'),
    ('banner', 'Asset'),
    ('ad-', 'Asset'),
    ('ads-', 'Asset'),
    ('graphic', 'Asset'),
    ('infographic', 'Asset'),
    ('info graphic', 'Asset'),
    ('checklist', 'Asset'),
    ('check list', 'Asset'),
    ('template', 'Asset'),
    ('logo', 'Asset'),
    ('icon', 'Asset'),
    ('image', 'Asset'),
    ('photo', 'Asset'),
    ('screenshot', 'Asset'),
]

# Folder path hints for content type
FOLDER_TYPE_HINTS = {
    'one-pager': '1-Pager',
    '1-pager': '1-Pager',
    'one pager': '1-Pager',
    'ebook': 'Ebook',
    'ebooks': 'Ebook',
    'e-book': 'Ebook',
    'whitepaper': 'Ebook',
    'whitepapers': 'Ebook',
    'guide': 'Ebook',
    'guides': 'Ebook',
    'case stud': 'Customer Story',
    'customer stor': 'Customer Story',
    'testimonial': 'Customer Story',
    'webinar': 'Webinar',
    'webinars': 'Webinar',
    'presentation': 'Webinar',
    'video': 'Video',
    'videos': 'Video',
    'press': 'Press Release',
    'news': 'Press Release',
    'award': 'Award',
    'social': 'Asset',
    'marketing': 'Asset',
    'email': 'Asset',
    'banner': 'Asset',
}

# PDF file extensions to include
PDF_EXTENSIONS = ['.pdf']


def classify_pdf_with_ai(filename: str, folder_path: str = '') -> tuple[str, str]:
    """
    Use AI to classify a PDF file as either '1-Pager' or 'Ebook'.

    Returns: (content_type, reason)
    """
    if not openai_client:
        # Fallback to keyword-based detection if no OpenAI key
        return detect_content_type_from_filename(filename, 'PDF', folder_path), "keyword match"

    prompt = f"""Analyze this PDF filename and folder path to classify it as marketing content.

Filename: {filename}
Folder path: {folder_path or 'N/A'}

Classify this PDF into ONE of these categories:
- "1-Pager": Short sales collateral (1-2 pages) like datasheets, product overviews, comparison sheets, brochures, flyers, sell sheets, fact sheets, competitive battle cards
- "Ebook": Long-form content (3+ pages) like whitepapers, guides, playbooks, handbooks, toolkits, reports, research papers
- "Customer Story": Case studies, customer success stories, testimonials
- "SKIP": Social media graphics, email thumbnails, banner images, logos, icons, screenshots, or any non-document PDF

Respond with JSON only:
{{"type": "1-Pager" or "Ebook" or "Customer Story" or "SKIP", "reason": "brief explanation"}}"""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.1,
            max_tokens=100
        )

        content = response.choices[0].message.content.strip()

        # Parse JSON response
        json_match = re.search(r'\{[^}]+\}', content)
        if json_match:
            result = json.loads(json_match.group())
            return result.get('type', 'Ebook'), result.get('reason', 'AI classification')

        # Fallback parsing
        if '1-pager' in content.lower() or '1-Pager' in content:
            return '1-Pager', 'AI classification'
        elif 'ebook' in content.lower():
            return 'Ebook', 'AI classification'
        elif 'customer story' in content.lower() or 'case study' in content.lower():
            return 'Customer Story', 'AI classification'
        elif 'skip' in content.lower():
            return 'SKIP', 'AI classification - not a document'

        return 'Ebook', 'AI default'

    except Exception as e:
        print(f"  AI classification error for '{filename}': {e}")
        # Fallback to keyword-based
        return detect_content_type_from_filename(filename, 'PDF', folder_path), "keyword fallback"


def is_pdf_file(filename: str, url: str = '') -> bool:
    """Check if a file is a PDF based on filename or URL extension."""
    # Check filename extension
    ext = os.path.splitext(filename)[1].lower()
    if ext in PDF_EXTENSIONS:
        return True

    # Check URL extension (HubSpot often stores extension in URL path, not filename)
    if url:
        url_path = urlparse(url).path
        url_ext = os.path.splitext(url_path)[1].lower()
        if url_ext in PDF_EXTENSIONS:
            return True

    return False


def should_skip_file(filename: str) -> bool:
    """Check if a file should be skipped based on common patterns for non-document content."""
    filename_lower = filename.lower()

    # Skip patterns for social media, email graphics, etc.
    skip_patterns = [
        'social', 'linkedin', 'twitter', 'facebook', 'instagram', 'tiktok',
        'email-', 'email_', 'emailbanner', 'email header', 'email-header',
        'thumbnail', 'thumb_', 'thumb-',
        'banner', 'banner_', 'banner-',
        'logo', 'icon', 'favicon',
        'screenshot', 'screen-shot', 'screen_shot',
        'ad-', 'ad_', 'ads-', 'ads_',
        'graphic-', 'graphic_',
        'social-', 'social_',
        '-sq', '_sq',  # Square crops for social
        '-ig', '_ig',  # Instagram
        '-li', '_li',  # LinkedIn
        '-fb', '_fb',  # Facebook
        '-tw', '_tw',  # Twitter
    ]

    for pattern in skip_patterns:
        if pattern in filename_lower:
            return True

    return False


def get_db_connection():
    """Create a database connection using the pooler."""
    if not DATABASE_URL:
        raise ValueError("DATABASE_URL environment variable not set")
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def get_hubspot_headers():
    """Get headers for HubSpot API requests."""
    if not HUBSPOT_API_KEY:
        raise ValueError("HUBSPOT_API_KEY environment variable not set")
    return {
        'Authorization': f'Bearer {HUBSPOT_API_KEY}',
        'Content-Type': 'application/json'
    }


def detect_content_type_from_filename(filename: str, file_type: str, folder_path: str = '') -> str:
    """Detect content type from filename keywords and folder path."""
    filename_lower = filename.lower()
    folder_lower = (folder_path or '').lower()
    combined_text = f"{filename_lower} {folder_lower}"

    # Check for keyword matches in filename first (order matters - first match wins)
    for keyword, content_type in CONTENT_TYPE_KEYWORDS:
        if keyword in filename_lower:
            return content_type

    # Check folder path for hints
    for folder_hint, content_type in FOLDER_TYPE_HINTS.items():
        if folder_hint in folder_lower:
            return content_type

    # Special cases based on file extension
    ext = os.path.splitext(filename)[1].lower()
    if ext in ['.pptx', '.ppt', '.key']:
        return 'Webinar'
    elif ext in ['.mp4', '.mov', '.avi', '.webm']:
        return 'Video'
    elif ext in ['.mp3', '.wav', '.m4a']:
        return 'Asset'  # Audio files
    elif ext in ['.pdf']:
        # PDFs could be many things - check combined text for hints
        for keyword, content_type in CONTENT_TYPE_KEYWORDS:
            if keyword in combined_text:
                return content_type
        return 'Ebook'  # Default PDFs to Ebook

    # Fall back to file type mapping
    return FILE_TYPE_MAP.get(file_type, 'Asset')


def clean_filename_to_title(filename: str) -> str:
    """Convert filename to a readable title."""
    # Remove file extension
    title = os.path.splitext(filename)[0]

    # Replace underscores and hyphens with spaces
    title = re.sub(r'[-_]+', ' ', title)

    # Remove common prefixes like dates, IDs
    title = re.sub(r'^\d{4}[-_]?\d{2}[-_]?\d{2}[-_]?', '', title)
    title = re.sub(r'^[A-Z0-9]{8,}[-_]', '', title)

    # Clean up extra spaces
    title = ' '.join(title.split())

    # Title case
    title = title.title()

    return title.strip() or filename


def fetch_hubspot_files(since_date: datetime, limit: Optional[int] = None) -> List[Dict]:
    """Fetch files from HubSpot using multiple API approaches."""
    headers = get_hubspot_headers()

    print(f"\n[1/4] Fetching files from HubSpot (since {since_date.strftime('%Y-%m-%d')})...")

    # Try different HubSpot file APIs in order of preference
    # 1. CRM Objects - Files (newer API)
    # 2. File Manager folders/files
    # 3. Marketing files

    all_files = []

    # Approach 1: Try CRM Files API (v3 search)
    print("  Trying CRM Files search API...")
    try:
        url = f"{HUBSPOT_API_BASE}/crm/v3/objects/files/search"
        body = {
            'limit': 100,
            'properties': ['hs_file_url', 'hs_created_date', 'hs_file_name', 'hs_file_type']
        }
        response = requests.post(url, headers=headers, json=body)
        if response.status_code == 200:
            data = response.json()
            files = data.get('results', [])
            print(f"  Found {len(files)} files via CRM Files API")
            for f in files:
                props = f.get('properties', {})
                all_files.append({
                    'id': f.get('id'),
                    'name': props.get('hs_file_name', 'Unknown'),
                    'url': props.get('hs_file_url', ''),
                    'type': props.get('hs_file_type', 'DOCUMENT'),
                    'createdAt': props.get('hs_created_date', '')
                })
    except Exception as e:
        print(f"  CRM Files API error: {e}")

    # Approach 2: Try File Manager API (folders then files)
    print("  Trying File Manager API...")
    try:
        # First get folders
        folders_url = f"{HUBSPOT_API_BASE}/filemanager/api/v3/folders"
        response = requests.get(folders_url, headers=headers)
        if response.status_code == 200:
            folders_data = response.json()
            folders = folders_data.get('objects', [])
            print(f"  Found {len(folders)} folders")

            # Get files from each folder
            for folder in folders[:20]:  # Limit folders to avoid too many requests
                folder_id = folder.get('id')
                if folder_id:
                    files_url = f"{HUBSPOT_API_BASE}/filemanager/api/v3/files"
                    params = {'folder_id': folder_id, 'limit': 100, 'type': 'DOCUMENT'}  # Filter for documents
                    files_response = requests.get(files_url, headers=headers, params=params)
                    if files_response.status_code == 200:
                        files_data = files_response.json()
                        folder_files = files_data.get('objects', [])
                        for f in folder_files:
                            created = f.get('created', 0)
                            if isinstance(created, int) and created > 0:
                                created_ts = created / 1000
                            else:
                                created_ts = 0
                            if created_ts >= since_date.timestamp():
                                all_files.append({
                                    'id': f.get('id'),
                                    'name': f.get('name', 'Unknown'),
                                    'url': f.get('url', f.get('friendly_url', '')),
                                    'type': f.get('type', 'DOCUMENT'),
                                    'createdAt': datetime.fromtimestamp(created_ts).isoformat() if created_ts else '',
                                    'path': f.get('full_path', '')
                                })
                    time.sleep(0.2)  # Rate limit
    except Exception as e:
        print(f"  File Manager API error: {e}")

    # Approach 3: Try Marketing Files API
    print("  Trying Marketing Files API...")
    try:
        url = f"{HUBSPOT_API_BASE}/marketing/v3/files"
        response = requests.get(url, headers=headers, params={'limit': 100})
        if response.status_code == 200:
            data = response.json()
            marketing_files = data.get('results', data.get('objects', []))
            print(f"  Found {len(marketing_files)} marketing files")
            for f in marketing_files:
                created = f.get('createdAt', f.get('created', ''))
                all_files.append({
                    'id': f.get('id'),
                    'name': f.get('name', f.get('title', 'Unknown')),
                    'url': f.get('url', f.get('publicUrl', '')),
                    'type': f.get('type', 'DOCUMENT'),
                    'createdAt': created
                })
    except Exception as e:
        print(f"  Marketing Files API error: {e}")

    # Approach 4: Try Content/CMS files
    print("  Trying CMS Source Code API for files...")
    try:
        url = f"{HUBSPOT_API_BASE}/cms/v3/source-code/content/files"
        response = requests.get(url, headers=headers)
        if response.status_code == 200:
            data = response.json()
            cms_files = data.get('results', data.get('objects', []))
            print(f"  Found {len(cms_files)} CMS files")
    except Exception as e:
        print(f"  CMS API error: {e}")

    # Deduplicate by URL
    seen_urls = set()
    unique_files = []
    for f in all_files:
        url = f.get('url', '')
        if url and url not in seen_urls:
            seen_urls.add(url)
            unique_files.append(f)

    print(f"  Total unique files found: {len(unique_files)}")

    # Apply limit if specified
    if limit:
        unique_files = unique_files[:limit]

    return unique_files


def fetch_hubspot_files_list(since_date: datetime, limit: Optional[int] = None) -> List[Dict]:
    """Alternative: Fetch files using list endpoint and filter locally."""
    headers = get_hubspot_headers()
    all_files = []
    after = None
    page_size = 100

    since_timestamp = since_date.timestamp()

    print(f"  Using list endpoint with local filtering...")

    while True:
        # Use the files list endpoint
        url = f"{HUBSPOT_API_BASE}/filemanager/api/v3/files"
        params = {
            'limit': page_size,
        }

        if after:
            params['offset'] = after

        try:
            response = requests.get(url, headers=headers, params=params)
            response.raise_for_status()
            data = response.json()
        except requests.exceptions.HTTPError as e:
            if e.response.status_code == 401:
                print("ERROR: Invalid HubSpot API key.")
                sys.exit(1)
            # Try the CRM files endpoint as last resort
            print("  Trying CRM files endpoint...")
            return fetch_hubspot_crm_files(since_date, limit)

        files = data.get('objects', data.get('results', []))

        for file in files:
            # Filter by creation date locally
            created_at = file.get('created', file.get('createdAt', 0))
            if isinstance(created_at, str):
                file_timestamp = datetime.fromisoformat(created_at.replace('Z', '+00:00')).timestamp()
            else:
                file_timestamp = created_at / 1000  # milliseconds to seconds

            if file_timestamp >= since_timestamp:
                all_files.append(file)

                if limit and len(all_files) >= limit:
                    print(f"  Reached limit of {limit} files")
                    return all_files

        print(f"  Processed batch, {len(all_files)} matching files...")

        # Check for more pages
        if data.get('has_more', False):
            after = data.get('offset', len(all_files))
        else:
            break

        time.sleep(REQUEST_DELAY)

    return all_files


def fetch_hubspot_crm_files(since_date: datetime, limit: Optional[int] = None) -> List[Dict]:
    """Last resort: Try CRM files/engagements endpoint."""
    headers = get_hubspot_headers()
    all_files = []

    print(f"  Attempting CRM engagements/notes with attachments...")

    # This is a fallback - the CRM engagement attachments
    url = f"{HUBSPOT_API_BASE}/engagements/v1/engagements/paged"
    params = {'limit': 100}

    try:
        response = requests.get(url, headers=headers, params=params)
        if response.status_code == 200:
            data = response.json()
            for engagement in data.get('results', []):
                attachments = engagement.get('attachments', [])
                for att in attachments:
                    all_files.append({
                        'id': att.get('id'),
                        'name': att.get('name', 'Attachment'),
                        'url': att.get('url', ''),
                        'type': 'DOCUMENT',
                        'createdAt': engagement.get('engagement', {}).get('createdAt', 0)
                    })
        else:
            print(f"  CRM endpoint returned {response.status_code}")
    except Exception as e:
        print(f"  CRM endpoint error: {e}")

    return all_files


def normalize_url(url: str) -> str:
    """Normalize URL for duplicate checking."""
    if not url:
        return ''
    return url.lower().replace('www.', '').rstrip('/').split('?')[0]


def check_existing_content(conn, urls: List[str], titles: List[str]) -> set:
    """Check which URLs/titles already exist in the database."""
    existing = set()

    with conn.cursor() as cur:
        # Check by URL
        if urls:
            placeholders = ','.join(['%s'] * len(urls))
            cur.execute(f"""
                SELECT LOWER(live_link) as url FROM marketing_content
                WHERE LOWER(live_link) IN ({placeholders})
                UNION
                SELECT LOWER(ungated_link) as url FROM marketing_content
                WHERE LOWER(ungated_link) IN ({placeholders})
            """, urls + urls)
            for row in cur.fetchall():
                if row['url']:
                    existing.add(normalize_url(row['url']))

        # Check by title (exact match)
        if titles:
            placeholders = ','.join(['%s'] * len(titles))
            cur.execute(f"""
                SELECT LOWER(title) as title FROM marketing_content
                WHERE LOWER(title) IN ({placeholders})
            """, [t.lower() for t in titles])
            for row in cur.fetchall():
                if row['title']:
                    existing.add(row['title'])

    return existing


def map_hubspot_file_to_content(file: Dict) -> Dict:
    """Map a HubSpot file to marketing_content record format."""
    filename = file.get('name', 'Untitled')
    file_type = file.get('type', 'OTHER')
    folder_path = file.get('path', file.get('full_path', ''))

    # Get the public URL
    url = file.get('url', '')

    # Detect content type from filename and folder path
    content_type = detect_content_type_from_filename(filename, file_type, folder_path)

    # Generate title from filename
    title = clean_filename_to_title(filename)

    # Get file metadata
    created_at = file.get('createdAt', '')
    updated_at = file.get('updatedAt', created_at)
    size_bytes = file.get('size', 0)

    # Build tags
    tags = []
    if file_type:
        tags.append(file_type.lower())

    # Add folder path as context
    folder_path = file.get('path', '')
    if folder_path:
        # Extract meaningful folder names
        folders = [f for f in folder_path.split('/') if f and f not in ['files', 'documents']]
        tags.extend(folders[:3])  # Add up to 3 folder names as tags

    return {
        'title': title,
        'type': content_type,
        'live_link': None,  # HubSpot files are typically ungated downloads
        'ungated_link': url,
        'platform': 'HubSpot',
        'state': None,
        'summary': f"File uploaded to HubSpot. Original filename: {filename}",
        'tags': ', '.join(tags) if tags else None,
        'last_updated': datetime.now().isoformat(),
        'hubspot_file_id': file.get('id'),
        'hubspot_created_at': created_at,
    }


def insert_content_records(conn, records: List[Dict], dry_run: bool = False) -> int:
    """Insert new content records into the database."""
    if not records:
        return 0

    if dry_run:
        print(f"\n[DRY RUN] Would insert {len(records)} records:")
        for r in records[:10]:  # Show first 10
            print(f"  - {r['type']}: {r['title']}")
        if len(records) > 10:
            print(f"  ... and {len(records) - 10} more")
        return len(records)

    inserted = 0
    with conn.cursor() as cur:
        for record in records:
            try:
                cur.execute("""
                    INSERT INTO marketing_content
                    (title, type, live_link, ungated_link, platform, state, summary, tags, last_updated)
                    VALUES (%(title)s, %(type)s, %(live_link)s, %(ungated_link)s, %(platform)s,
                            %(state)s, %(summary)s, %(tags)s, %(last_updated)s)
                    ON CONFLICT DO NOTHING
                """, record)
                if cur.rowcount > 0:
                    inserted += 1
            except Exception as e:
                print(f"  ERROR inserting '{record['title']}': {e}")

    conn.commit()
    return inserted


def main():
    parser = argparse.ArgumentParser(description='Import HubSpot files to marketing content database')
    parser.add_argument('--since', type=str, default='2025-01-01',
                        help='Import files created since this date (YYYY-MM-DD)')
    parser.add_argument('--limit', type=int, default=None,
                        help='Maximum number of files to import')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview what would be imported without making changes')
    parser.add_argument('--include-all', action='store_true',
                        help='Include all file types (by default only PDFs are imported)')
    parser.add_argument('--skip-ai', action='store_true',
                        help='Skip AI classification, use keyword-based detection only')

    args = parser.parse_args()

    # Parse since date
    try:
        since_date = datetime.strptime(args.since, '%Y-%m-%d').replace(tzinfo=timezone.utc)
    except ValueError:
        print(f"ERROR: Invalid date format '{args.since}'. Use YYYY-MM-DD.")
        sys.exit(1)

    # Check required env vars
    if not HUBSPOT_API_KEY:
        print("ERROR: HUBSPOT_API_KEY environment variable not set.")
        print("\nTo get a HubSpot API key:")
        print("1. Go to HubSpot > Settings > Integrations > Private Apps")
        print("2. Create a private app with 'Files' scope (read access)")
        print("3. Copy the access token and add to scripts/.env:")
        print("   HUBSPOT_API_KEY=your-token-here")
        sys.exit(1)

    use_ai = OPENAI_API_KEY and not args.skip_ai

    print("=" * 60)
    print("HubSpot Files Import (PDFs Only)")
    print("=" * 60)
    print(f"Since date: {since_date.strftime('%Y-%m-%d')}")
    print(f"Dry run: {args.dry_run}")
    print(f"AI classification: {'enabled' if use_ai else 'disabled (keyword-based)'}")
    if args.limit:
        print(f"Limit: {args.limit} files")

    # Fetch files from HubSpot
    files = fetch_hubspot_files(since_date, args.limit)

    if not files:
        print("\nNo files found matching criteria.")
        return

    print(f"\n✓ Found {len(files)} total files from HubSpot")

    # Filter to PDFs only (unless --include-all is specified)
    if not args.include_all:
        original_count = len(files)
        pdf_files = [f for f in files if is_pdf_file(f.get('name', ''), f.get('url', ''))]
        non_pdf_count = original_count - len(pdf_files)
        print(f"  Filtered to PDFs only: {len(pdf_files)} PDFs ({non_pdf_count} non-PDF files skipped)")
        files = pdf_files

    if not files:
        print("\nNo PDF files found.")
        return

    # Classify PDFs using AI
    print("\n[2/4] Classifying PDFs with AI...")
    records = []
    skipped_by_ai = 0

    for i, f in enumerate(files):
        filename = f.get('name', 'Unknown')
        folder_path = f.get('path', f.get('full_path', ''))

        # Quick pre-filter for obvious non-documents
        if should_skip_file(filename):
            print(f"  [{i+1}/{len(files)}] SKIP (pattern): {filename[:50]}")
            skipped_by_ai += 1
            continue

        # Use AI classification for PDFs
        if use_ai:
            content_type, reason = classify_pdf_with_ai(filename, folder_path)
            print(f"  [{i+1}/{len(files)}] {content_type}: {filename[:50]} ({reason})")

            if content_type == 'SKIP':
                skipped_by_ai += 1
                continue
        else:
            content_type = detect_content_type_from_filename(filename, 'PDF', folder_path)
            print(f"  [{i+1}/{len(files)}] {content_type}: {filename[:50]}")

        # Create record with AI-determined type
        record = map_hubspot_file_to_content(f)
        record['type'] = content_type  # Override with AI classification
        records.append(record)

        # Small delay to avoid rate limiting OpenAI
        if use_ai and i < len(files) - 1:
            time.sleep(0.1)

    print(f"\n  AI classification complete:")
    print(f"    Documents to import: {len(records)}")
    print(f"    Skipped (not documents): {skipped_by_ai}")

    # Show type breakdown
    type_counts = {}
    for r in records:
        type_counts[r['type']] = type_counts.get(r['type'], 0) + 1
    print("\n  Content types detected:")
    for t, count in sorted(type_counts.items(), key=lambda x: -x[1]):
        print(f"    {t}: {count}")

    # Check for duplicates
    print("\n[3/4] Checking for existing content...")
    conn = get_db_connection()

    urls = [normalize_url(r['ungated_link']) for r in records if r['ungated_link']]
    titles = [r['title'] for r in records]
    existing = check_existing_content(conn, urls, titles)

    # Filter out duplicates
    new_records = []
    skipped = 0
    for record in records:
        url_norm = normalize_url(record['ungated_link']) if record['ungated_link'] else ''
        title_norm = record['title'].lower()

        if url_norm in existing or title_norm in existing:
            skipped += 1
        else:
            new_records.append(record)

    print(f"  Found {skipped} duplicates (will be skipped)")
    print(f"  New records to import: {len(new_records)}")

    # Insert new records
    print("\n[4/4] Importing new content...")
    inserted = insert_content_records(conn, new_records, args.dry_run)

    conn.close()

    # Summary
    print("\n" + "=" * 60)
    print("IMPORT COMPLETE")
    print("=" * 60)
    print(f"Files fetched from HubSpot: {len(files)}")
    print(f"Duplicates skipped: {skipped}")
    print(f"New records {'would be ' if args.dry_run else ''}inserted: {inserted}")

    if args.dry_run:
        print("\nRun without --dry-run to actually import the files.")


if __name__ == '__main__':
    main()

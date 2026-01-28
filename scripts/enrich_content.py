#!/usr/bin/env python3
"""
Content Enrichment Script for Marketing Content Portal

This script fetches content from Supabase, extracts text from linked resources
(PDFs, YouTube videos, web pages), and uses OpenAI to generate enhanced
summaries and auto-tags for better AI search.

Usage:
    python enrich_content.py           # Process all unenriched content
    python enrich_content.py --limit 10  # Process only 10 records
    python enrich_content.py --force    # Re-process all content
    python enrich_content.py --dry-run  # Show what would be processed
"""

import os
import sys
import argparse
import json
import re
import time
from datetime import datetime
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import requests
from bs4 import BeautifulSoup
from openai import OpenAI

# Load environment variables
load_dotenv()

# Configuration
DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY')

# Initialize OpenAI client
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# Rate limiting
REQUEST_DELAY = 1  # seconds between API calls


def get_db_connection():
    """Create a database connection using the pooler."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def ensure_columns_exist(conn):
    """Add enrichment columns to the database if they don't exist."""
    print("\n[1/5] Checking database schema...")

    alter_statements = [
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS enhanced_summary TEXT",
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS auto_tags TEXT",
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS extracted_text TEXT",
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS content_analyzed_at TIMESTAMP",
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS extraction_error TEXT"
    ]

    with conn.cursor() as cur:
        for stmt in alter_statements:
            cur.execute(stmt)
    conn.commit()
    print("✓ Database schema updated")


def detect_content_type(url: str) -> str:
    """Detect the type of content from URL."""
    if not url:
        return 'unknown'

    url_lower = url.lower()
    parsed = urlparse(url)

    # YouTube
    if 'youtube.com' in parsed.netloc or 'youtu.be' in parsed.netloc:
        return 'youtube'

    # PDF
    if url_lower.endswith('.pdf') or '/pdf/' in url_lower:
        return 'pdf'

    # Google Docs/Drive
    if 'docs.google.com' in url_lower or 'drive.google.com' in url_lower:
        return 'google_doc'

    # HubSpot
    if 'hubspot' in url_lower:
        return 'hubspot'

    # LinkedIn
    if 'linkedin.com' in url_lower:
        return 'linkedin'

    # Default to web page
    return 'webpage'


def extract_youtube_transcript(url: str) -> Optional[str]:
    """Extract transcript from YouTube video."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound

        # Extract video ID
        parsed = urlparse(url)
        if 'youtube.com' in parsed.netloc:
            video_id = parsed.query.split('v=')[1].split('&')[0] if 'v=' in parsed.query else None
        elif 'youtu.be' in parsed.netloc:
            video_id = parsed.path.strip('/')
        else:
            return None

        if not video_id:
            return None

        # Get transcript
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
        transcript_text = ' '.join([entry['text'] for entry in transcript_list])
        return transcript_text[:10000]  # Limit to 10k chars

    except (TranscriptsDisabled, NoTranscriptFound) as e:
        print(f"    YouTube transcript not available: {e}")
        return None
    except Exception as e:
        print(f"    YouTube extraction error: {e}")
        return None


def extract_pdf_text(url: str) -> Optional[str]:
    """Extract text from PDF URL."""
    try:
        from PyPDF2 import PdfReader
        from io import BytesIO

        response = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; ContentEnricher/1.0)'
        })
        response.raise_for_status()

        pdf_file = BytesIO(response.content)
        reader = PdfReader(pdf_file)

        text = ''
        for page in reader.pages[:10]:  # Limit to first 10 pages
            text += page.extract_text() or ''

        return text[:10000]  # Limit to 10k chars

    except Exception as e:
        print(f"    PDF extraction error: {e}")
        return None


def extract_webpage_text(url: str) -> Optional[str]:
    """Extract text from a web page."""
    try:
        response = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Remove script and style elements
        for script in soup(['script', 'style', 'nav', 'footer', 'header']):
            script.decompose()

        # Get text
        text = soup.get_text(separator=' ', strip=True)

        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text)

        return text[:10000]  # Limit to 10k chars

    except Exception as e:
        print(f"    Webpage extraction error: {e}")
        return None


def extract_content(url: str, content_type: str) -> Optional[str]:
    """Extract text content based on content type."""
    if content_type == 'youtube':
        return extract_youtube_transcript(url)
    elif content_type == 'pdf':
        return extract_pdf_text(url)
    elif content_type in ['webpage', 'hubspot', 'linkedin']:
        return extract_webpage_text(url)
    else:
        return None


def analyze_with_openai(
    title: str,
    content_type: str,
    existing_summary: str,
    existing_tags: str,
    extracted_text: str,
    state: str
) -> Dict[str, Any]:
    """Use OpenAI to analyze content and generate enhanced tags."""

    if not openai_client:
        return {'error': 'OpenAI client not configured'}

    prompt = f"""Analyze this marketing content and generate enhanced metadata for search optimization.

CONTENT DETAILS:
- Title: {title}
- Type: {content_type}
- State: {state or 'National/Unknown'}
- Existing Tags: {existing_tags or 'None'}
- Existing Summary: {existing_summary or 'None'}

EXTRACTED TEXT FROM CONTENT:
{extracted_text[:5000] if extracted_text else 'No text extracted'}

GENERATE THE FOLLOWING (respond in JSON format):

1. "enhanced_summary": A 2-3 sentence summary optimized for search. Be specific about what this content covers.

2. "auto_tags": ONLY include tags that are ACTUALLY present in the content. Be highly selective (3-8 tags max). Choose from:
   - Competitor names ONLY if explicitly mentioned (Naviance, Xello, MajorClarity, PowerSchool)
   - Specific personas ONLY if directly addressed (counselors, administrators, CTE coordinators, students, parents)
   - Topics ONLY if actually covered (FAFSA, graduation, work-based learning, career exploration, college readiness)
   - Content format (testimonial, tutorial, customer-story, demo)
   DO NOT list all possible tags - only include what is ACTUALLY in the content.

3. "competitors_mentioned": Array of competitor names ACTUALLY found in content (empty array if none)

4. "personas_addressed": Array of personas ACTUALLY addressed (empty array if general)

5. "key_topics": Array of 2-4 main topics actually covered

Respond ONLY with valid JSON, no other text."""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a marketing content analyst. Generate structured metadata for search optimization. Always respond with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=1000
        )

        content = response.choices[0].message.content

        # Parse JSON response
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json.loads(json_match.group())
        else:
            return {'error': 'Could not parse JSON response'}

    except Exception as e:
        return {'error': str(e)}


def process_record(conn, record: Dict, dry_run: bool = False) -> bool:
    """Process a single content record."""
    record_id = record['id']
    title = record['title']
    live_link = record.get('live_link')
    ungated_link = record.get('ungated_link')

    # Choose best URL
    url = live_link or ungated_link
    if not url:
        print(f"  ⚠ No URL available for: {title[:50]}...")
        return False

    print(f"\n  Processing: {title[:60]}...")
    print(f"    URL: {url[:80]}...")

    # Detect content type
    url_type = detect_content_type(url)
    print(f"    Type: {url_type}")

    if dry_run:
        print("    [DRY RUN] Would extract and analyze content")
        return True

    # Extract content
    extracted_text = extract_content(url, url_type)

    if not extracted_text:
        # Update record with error
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE marketing_content
                SET extraction_error = %s, content_analyzed_at = %s
                WHERE id = %s
            """, (f"Could not extract content from {url_type}", datetime.utcnow(), record_id))
        conn.commit()
        print(f"    ✗ Could not extract content")
        return False

    print(f"    ✓ Extracted {len(extracted_text)} chars")

    # Analyze with OpenAI
    print("    Analyzing with OpenAI...")
    analysis = analyze_with_openai(
        title=title,
        content_type=record.get('type', ''),
        existing_summary=record.get('summary', ''),
        existing_tags=record.get('tags', ''),
        extracted_text=extracted_text,
        state=record.get('state', '')
    )

    if 'error' in analysis:
        print(f"    ✗ Analysis error: {analysis['error']}")
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE marketing_content
                SET extraction_error = %s, extracted_text = %s, content_analyzed_at = %s
                WHERE id = %s
            """, (f"OpenAI error: {analysis['error']}", extracted_text[:5000], datetime.utcnow(), record_id))
        conn.commit()
        return False

    # Update database with enriched data
    enhanced_summary = analysis.get('enhanced_summary', '')
    auto_tags_raw = analysis.get('auto_tags', '')
    # Handle auto_tags as either list or string
    if isinstance(auto_tags_raw, list):
        auto_tags = ', '.join(auto_tags_raw)
    else:
        auto_tags = auto_tags_raw or ''

    # Combine auto_tags with existing tags
    existing_tags = record.get('tags', '') or ''
    if auto_tags and existing_tags:
        combined_tags = f"{existing_tags}, {auto_tags}"
    else:
        combined_tags = auto_tags or existing_tags

    with conn.cursor() as cur:
        cur.execute("""
            UPDATE marketing_content
            SET enhanced_summary = %s,
                auto_tags = %s,
                tags = %s,
                extracted_text = %s,
                content_analyzed_at = %s,
                extraction_error = NULL
            WHERE id = %s
        """, (
            enhanced_summary,
            auto_tags,
            combined_tags,
            extracted_text[:5000],  # Limit stored text
            datetime.utcnow(),
            record_id
        ))
    conn.commit()

    print(f"    ✓ Enriched with {len(auto_tags.split(',')) if auto_tags else 0} new tags")
    return True


def main():
    parser = argparse.ArgumentParser(description='Enrich marketing content with AI-generated metadata')
    parser.add_argument('--limit', type=int, help='Limit number of records to process')
    parser.add_argument('--force', action='store_true', help='Re-process already enriched content')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be processed without making changes')
    args = parser.parse_args()

    print("=" * 60)
    print("Marketing Content Enrichment Pipeline")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set in .env")
        sys.exit(1)

    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY not set in .env")
        sys.exit(1)

    # Connect to database
    print("\n[1/5] Connecting to database...")
    conn = get_db_connection()
    print("✓ Connected to Supabase via pooler")

    # Ensure columns exist
    ensure_columns_exist(conn)

    # Fetch records to process
    print("\n[2/5] Fetching content records...")
    with conn.cursor() as cur:
        if args.force:
            # Process all records
            query = "SELECT * FROM marketing_content WHERE live_link IS NOT NULL OR ungated_link IS NOT NULL"
        else:
            # Only process unenriched records
            query = """
                SELECT * FROM marketing_content
                WHERE (live_link IS NOT NULL OR ungated_link IS NOT NULL)
                AND content_analyzed_at IS NULL
            """

        if args.limit:
            query += f" LIMIT {args.limit}"

        cur.execute(query)
        records = cur.fetchall()

    total = len(records)
    print(f"✓ Found {total} records to process")

    if total == 0:
        print("\nNo records to process. Use --force to re-process existing content.")
        conn.close()
        return

    # Process records
    print(f"\n[3/5] Processing content{'...' if not args.dry_run else ' (DRY RUN)...'}")

    success_count = 0
    error_count = 0

    for i, record in enumerate(records, 1):
        print(f"\n[{i}/{total}]", end='')

        try:
            if process_record(conn, record, dry_run=args.dry_run):
                success_count += 1
            else:
                error_count += 1
        except Exception as e:
            print(f"  ✗ Error: {e}")
            error_count += 1

        # Rate limiting
        if not args.dry_run and i < total:
            time.sleep(REQUEST_DELAY)

    # Summary
    print("\n" + "=" * 60)
    print("[5/5] ENRICHMENT COMPLETE")
    print("=" * 60)
    print(f"  Total processed: {total}")
    print(f"  Successful: {success_count}")
    print(f"  Errors: {error_count}")

    if args.dry_run:
        print("\n  [DRY RUN] No changes were made to the database.")

    conn.close()


if __name__ == '__main__':
    main()

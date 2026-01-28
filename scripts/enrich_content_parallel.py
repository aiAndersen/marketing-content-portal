#!/usr/bin/env python3
"""
Parallel Content Enrichment Script for Marketing Content Portal

Processes content in parallel batches for faster enrichment.

Usage:
    python enrich_content_parallel.py              # Process all unenriched
    python enrich_content_parallel.py --workers 10  # Use 10 parallel workers
    python enrich_content_parallel.py --limit 100   # Process only 100 records
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
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

import psycopg2
from psycopg2.extras import RealDictCursor
from psycopg2 import pool
from dotenv import load_dotenv
import requests
from bs4 import BeautifulSoup
from openai import OpenAI

# Load environment variables
load_dotenv()

# Configuration
DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Initialize OpenAI client
openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# Thread-safe counters
lock = threading.Lock()
success_count = 0
error_count = 0
processed_count = 0

# Connection pool
db_pool = None


def init_db_pool(min_conn=2, max_conn=10):
    """Initialize database connection pool."""
    global db_pool
    db_pool = pool.ThreadedConnectionPool(min_conn, max_conn, DATABASE_URL, cursor_factory=RealDictCursor)


def get_db_connection():
    """Get a connection from the pool."""
    return db_pool.getconn()


def return_db_connection(conn):
    """Return a connection to the pool."""
    db_pool.putconn(conn)


def detect_content_type(url: str) -> str:
    """Detect the type of content from URL."""
    if not url:
        return 'unknown'

    url_lower = url.lower()
    parsed = urlparse(url)

    if 'youtube.com' in parsed.netloc or 'youtu.be' in parsed.netloc:
        return 'youtube'
    if url_lower.endswith('.pdf') or '/pdf/' in url_lower:
        return 'pdf'
    if 'docs.google.com' in url_lower or 'drive.google.com' in url_lower:
        return 'google_doc'

    return 'webpage'


def extract_youtube_transcript(url: str) -> Optional[str]:
    """Extract transcript from YouTube video."""
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound

        parsed = urlparse(url)
        if 'youtube.com' in parsed.netloc:
            video_id = parsed.query.split('v=')[1].split('&')[0] if 'v=' in parsed.query else None
        elif 'youtu.be' in parsed.netloc:
            video_id = parsed.path.strip('/')
        else:
            return None

        if not video_id:
            return None

        transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
        transcript_text = ' '.join([entry['text'] for entry in transcript_list])
        return transcript_text[:10000]

    except Exception:
        return None


def extract_pdf_text(url: str) -> Optional[str]:
    """Extract text from PDF URL."""
    try:
        from PyPDF2 import PdfReader
        from io import BytesIO

        response = requests.get(url, timeout=15, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; ContentEnricher/1.0)'
        })
        response.raise_for_status()

        pdf_file = BytesIO(response.content)
        reader = PdfReader(pdf_file)

        text = ''
        for page in reader.pages[:10]:
            text += page.extract_text() or ''

        return text[:10000]

    except Exception:
        return None


def extract_webpage_text(url: str) -> Optional[str]:
    """Extract text from a web page."""
    try:
        response = requests.get(url, timeout=15, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        for script in soup(['script', 'style', 'nav', 'footer', 'header']):
            script.decompose()

        text = soup.get_text(separator=' ', strip=True)
        text = re.sub(r'\s+', ' ', text)

        return text[:10000]

    except Exception:
        return None


def extract_content(url: str, content_type: str) -> Optional[str]:
    """Extract text content based on content type."""
    if content_type == 'youtube':
        return extract_youtube_transcript(url)
    elif content_type == 'pdf':
        return extract_pdf_text(url)
    elif content_type in ['webpage', 'hubspot', 'linkedin']:
        return extract_webpage_text(url)
    return None


def analyze_with_openai(title: str, content_type: str, existing_summary: str,
                        existing_tags: str, extracted_text: str, state: str) -> Dict[str, Any]:
    """Use OpenAI to analyze content and generate enhanced tags."""

    if not openai_client:
        return {'error': 'OpenAI client not configured'}

    prompt = f"""Analyze this marketing content and generate enhanced metadata for search optimization.

CONTENT DETAILS:
- Title: {title}
- Type: {content_type}
- State: {state or 'National/Unknown'}
- Existing Tags: {existing_tags or 'None'}

EXTRACTED TEXT FROM CONTENT:
{extracted_text[:4000] if extracted_text else 'No text extracted'}

GENERATE THE FOLLOWING (respond in JSON format):

1. "enhanced_summary": A 2-3 sentence summary optimized for search. Be specific about what this content covers.

2. "auto_tags": ONLY include tags that are ACTUALLY present in the content. Be highly selective (3-8 tags max). Choose from:
   - Competitor names ONLY if explicitly mentioned (Naviance, Xello, MajorClarity, PowerSchool)
   - Specific personas ONLY if directly addressed (counselors, administrators, CTE coordinators, students, parents)
   - Topics ONLY if actually covered (FAFSA, graduation, work-based learning, career exploration, college readiness)
   - Content format (testimonial, tutorial, customer-story, demo)

   DO NOT list all possible tags - only include what is ACTUALLY in the content.

Respond ONLY with valid JSON."""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a marketing content analyst. Generate structured metadata. Always respond with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=800
        )

        content = response.choices[0].message.content
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json.loads(json_match.group())
        return {'error': 'Could not parse JSON response'}

    except Exception as e:
        return {'error': str(e)}


def process_record(record: Dict, total: int) -> bool:
    """Process a single content record."""
    global success_count, error_count, processed_count

    record_id = record['id']
    title = record['title']
    url = record.get('live_link') or record.get('ungated_link')

    conn = get_db_connection()

    try:
        with lock:
            processed_count += 1
            current = processed_count

        if not url:
            with lock:
                error_count += 1
            return False

        # Detect and extract content
        url_type = detect_content_type(url)
        extracted_text = extract_content(url, url_type)

        if not extracted_text:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE marketing_content
                    SET extraction_error = %s, content_analyzed_at = %s
                    WHERE id = %s
                """, (f"Could not extract from {url_type}", datetime.utcnow(), record_id))
            conn.commit()
            with lock:
                error_count += 1
            print(f"[{current}/{total}] ✗ {title[:40]}... (no content)")
            return False

        # Analyze with OpenAI
        analysis = analyze_with_openai(
            title=title,
            content_type=record.get('type', ''),
            existing_summary=record.get('summary', ''),
            existing_tags=record.get('tags', ''),
            extracted_text=extracted_text,
            state=record.get('state', '')
        )

        if 'error' in analysis:
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE marketing_content
                    SET extraction_error = %s, extracted_text = %s, content_analyzed_at = %s
                    WHERE id = %s
                """, (f"OpenAI: {analysis['error']}", extracted_text[:5000], datetime.utcnow(), record_id))
            conn.commit()
            with lock:
                error_count += 1
            print(f"[{current}/{total}] ✗ {title[:40]}... (AI error)")
            return False

        # Update database
        enhanced_summary = analysis.get('enhanced_summary', '')
        auto_tags_raw = analysis.get('auto_tags', '')
        # Handle auto_tags as either list or string
        if isinstance(auto_tags_raw, list):
            auto_tags = ', '.join(auto_tags_raw)
        else:
            auto_tags = auto_tags_raw or ''

        existing_tags = record.get('tags', '') or ''
        combined_tags = f"{existing_tags}, {auto_tags}" if auto_tags and existing_tags else (auto_tags or existing_tags)

        with conn.cursor() as cur:
            cur.execute("""
                UPDATE marketing_content
                SET enhanced_summary = %s, auto_tags = %s, tags = %s,
                    extracted_text = %s, content_analyzed_at = %s, extraction_error = NULL
                WHERE id = %s
            """, (enhanced_summary, auto_tags, combined_tags, extracted_text[:5000], datetime.utcnow(), record_id))
        conn.commit()

        tag_count = len(auto_tags.split(',')) if auto_tags else 0
        with lock:
            success_count += 1
        print(f"[{current}/{total}] ✓ {title[:40]}... (+{tag_count} tags)")
        return True

    except Exception as e:
        with lock:
            error_count += 1
        print(f"[{current}/{total}] ✗ {title[:40]}... ({e})")
        return False

    finally:
        return_db_connection(conn)


def main():
    global success_count, error_count, processed_count

    parser = argparse.ArgumentParser(description='Parallel content enrichment')
    parser.add_argument('--workers', type=int, default=5, help='Number of parallel workers')
    parser.add_argument('--limit', type=int, help='Limit number of records')
    parser.add_argument('--force', action='store_true', help='Re-process all content')
    args = parser.parse_args()

    print("=" * 60)
    print("PARALLEL Content Enrichment Pipeline")
    print(f"Workers: {args.workers}")
    print("=" * 60)

    if not DATABASE_URL or not OPENAI_API_KEY:
        print("ERROR: Missing DATABASE_URL or OPENAI_API_KEY")
        sys.exit(1)

    # Initialize connection pool
    print("\n[1/4] Initializing database pool...")
    init_db_pool(min_conn=2, max_conn=args.workers + 2)
    print("✓ Connection pool ready")

    # Ensure columns exist
    print("\n[2/4] Checking schema...")
    conn = get_db_connection()
    with conn.cursor() as cur:
        for stmt in [
            "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS enhanced_summary TEXT",
            "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS auto_tags TEXT",
            "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS extracted_text TEXT",
            "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS content_analyzed_at TIMESTAMP",
            "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS extraction_error TEXT"
        ]:
            cur.execute(stmt)
    conn.commit()
    return_db_connection(conn)
    print("✓ Schema ready")

    # Fetch records
    print("\n[3/4] Fetching records...")
    conn = get_db_connection()
    with conn.cursor() as cur:
        query = """
            SELECT * FROM marketing_content
            WHERE (live_link IS NOT NULL OR ungated_link IS NOT NULL)
        """
        if not args.force:
            query += " AND content_analyzed_at IS NULL"
        if args.limit:
            query += f" LIMIT {args.limit}"
        cur.execute(query)
        records = cur.fetchall()
    return_db_connection(conn)

    total = len(records)
    print(f"✓ Found {total} records to process")

    if total == 0:
        print("\nNo records to process.")
        return

    # Process in parallel
    print(f"\n[4/4] Processing with {args.workers} workers...")
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {executor.submit(process_record, record, total): record for record in records}

        for future in as_completed(futures):
            try:
                future.result()
            except Exception as e:
                print(f"Worker error: {e}")

    elapsed = time.time() - start_time

    # Summary
    print("\n" + "=" * 60)
    print("ENRICHMENT COMPLETE")
    print("=" * 60)
    print(f"  Total: {total}")
    print(f"  Success: {success_count}")
    print(f"  Errors: {error_count}")
    print(f"  Time: {elapsed:.1f}s ({elapsed/total:.2f}s per record)")
    print(f"  Speed: {total/elapsed*60:.1f} records/minute")


if __name__ == '__main__':
    main()

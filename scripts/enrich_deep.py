#!/usr/bin/env python3
"""
Deep Content Enrichment Pipeline

Re-reads content from live_link URLs and YouTube transcripts using
an advanced AI model (gpt-5.2) to generate richer keyword data,
better summaries, and structured keyword metadata.

This upgrades from the basic gpt-4o-mini enrichment in enrich_content.py
by producing weighted, categorized keywords stored as JSONB, enabling
smarter cross-referencing in the content gap analysis.

Usage:
    python scripts/enrich_deep.py                     # Process un-enriched content
    python scripts/enrich_deep.py --limit 20          # Process 20 records
    python scripts/enrich_deep.py --force             # Re-process everything
    python scripts/enrich_deep.py --model gpt-4o      # Use specific model
    python scripts/enrich_deep.py --dry-run -v        # Preview mode
"""

import os
import sys
import argparse
import json
import re
import time
from datetime import datetime
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse, parse_qs

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import requests
from bs4 import BeautifulSoup
from openai import OpenAI

# Optional YouTube transcript API
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import (
        TranscriptsDisabled,
        NoTranscriptFound,
        VideoUnavailable,
        CouldNotRetrieveTranscript
    )
    YOUTUBE_API_AVAILABLE = True
except ImportError:
    YOUTUBE_API_AVAILABLE = False

# Optional PDF extraction
try:
    from PyPDF2 import PdfReader
    from io import BytesIO
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Default model for deep enrichment
DEFAULT_MODEL = 'gpt-5.2'
REQUEST_DELAY = 2  # seconds between API calls (advanced models are slower)
MAX_EXTRACTED_TEXT = 8000
MAX_STORED_TEXT = 5000


def get_db_connection():
    """Create a database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def ensure_columns_exist(conn):
    """Add deep enrichment columns if they don't exist."""
    alter_statements = [
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS keywords JSONB DEFAULT '[]'",
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS deep_enriched_at TIMESTAMP",
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS enhanced_summary TEXT",
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS auto_tags TEXT",
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS extracted_text TEXT",
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS content_analyzed_at TIMESTAMP",
        "ALTER TABLE marketing_content ADD COLUMN IF NOT EXISTS extraction_error TEXT",
    ]
    with conn.cursor() as cur:
        for stmt in alter_statements:
            cur.execute(stmt)
    conn.commit()


# =============================================================================
# State Terminology Helpers
# =============================================================================

def get_state_terminology(conn, state_code: str) -> Optional[Dict[str, str]]:
    """
    Fetch state-specific KRI and PLP terminology from the state_terminology table.
    Returns a dict with state_name, kri_full, plp_full, or None if not found.
    Silently returns None if the table doesn't exist yet (graceful fallback).
    """
    if not state_code or state_code in ('National', 'national', ''):
        return None
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT state_name, kri_full, plp_full FROM state_terminology WHERE state_code = %s",
                (state_code.upper(),)
            )
            row = cur.fetchone()
            if row:
                return {
                    'state_name': row['state_name'],
                    'kri_full': row['kri_full'],
                    'plp_full': row['plp_full'],
                }
    except Exception:
        # Table may not exist yet — fail silently
        pass
    return None


# =============================================================================
# Content Extraction Helpers
# =============================================================================

def detect_content_type(url: str) -> str:
    """Detect content type from URL."""
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
    if 'hubspot' in url_lower:
        return 'hubspot'
    return 'webpage'


def extract_video_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from various URL formats."""
    if not url:
        return None
    try:
        parsed = urlparse(url)
        if 'youtube.com' in parsed.netloc:
            if '/watch' in parsed.path:
                query = parse_qs(parsed.query)
                return query.get('v', [None])[0]
            elif '/shorts/' in parsed.path:
                return parsed.path.split('/shorts/')[-1].split('/')[0].split('?')[0]
            elif '/embed/' in parsed.path:
                return parsed.path.split('/embed/')[-1].split('/')[0].split('?')[0]
        elif 'youtu.be' in parsed.netloc:
            return parsed.path.strip('/').split('?')[0]
        return None
    except Exception:
        return None


def extract_youtube_transcript(url: str) -> Optional[str]:
    """Extract transcript from YouTube video."""
    if not YOUTUBE_API_AVAILABLE:
        return None
    video_id = extract_video_id(url)
    if not video_id:
        return None
    try:
        api = YouTubeTranscriptApi()
        try:
            transcript = api.fetch(video_id, languages=['en', 'en-US', 'en-GB'])
        except NoTranscriptFound:
            try:
                transcript_list = api.list(video_id)
                available = transcript_list.find_transcript(['en', 'en-US', 'en-GB'])
                transcript = available.fetch()
            except NoTranscriptFound:
                return None

        full_text = ' '.join([entry.text for entry in transcript])
        full_text = re.sub(r'\[.*?\]', '', full_text)
        full_text = re.sub(r'\s+', ' ', full_text).strip()
        return full_text[:15000] if full_text else None

    except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable, CouldNotRetrieveTranscript):
        return None
    except Exception as e:
        print(f"      Transcript error: {type(e).__name__}: {e}")
        return None


def extract_pdf_text(url: str) -> Optional[str]:
    """Extract text from PDF URL."""
    if not PDF_AVAILABLE:
        return None
    try:
        response = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; ContentEnricher/2.0)'
        })
        response.raise_for_status()
        pdf_file = BytesIO(response.content)
        reader = PdfReader(pdf_file)
        text = ''
        for page in reader.pages[:15]:
            text += page.extract_text() or ''
        return text[:MAX_EXTRACTED_TEXT] if text else None
    except Exception as e:
        print(f"      PDF extraction error: {e}")
        return None


def extract_webpage_text(url: str) -> Optional[str]:
    """Extract text from a web page."""
    try:
        response = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')
        for el in soup(['script', 'style', 'nav', 'footer', 'header']):
            el.decompose()
        text = soup.get_text(separator=' ', strip=True)
        text = re.sub(r'\s+', ' ', text)
        return text[:MAX_EXTRACTED_TEXT] if text else None
    except Exception as e:
        print(f"      Webpage extraction error: {e}")
        return None


def extract_content(url: str) -> Optional[str]:
    """Extract text content from any URL type."""
    url_type = detect_content_type(url)
    if url_type == 'youtube':
        return extract_youtube_transcript(url)
    elif url_type == 'pdf':
        return extract_pdf_text(url)
    elif url_type in ('webpage', 'hubspot', 'google_doc'):
        return extract_webpage_text(url)
    return None


# =============================================================================
# Deep AI Analysis
# =============================================================================

def analyze_deep(
    openai_client: OpenAI,
    model: str,
    title: str,
    content_type: str,
    state: str,
    existing_tags: str,
    existing_summary: str,
    extracted_text: str,
    state_context: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """Use advanced AI model for deep content analysis with weighted keywords."""

    # Build state-specific context block when available
    state_context_block = ''
    if state_context:
        state_context_block = f"""
STATE-SPECIFIC CONTEXT (this content is specifically for {state_context['state_name']}):
- State KRI terminology: {state_context['kri_full']}
- State PLP terminology: {state_context['plp_full']}
Include these state-specific acronyms in keywords (category: "state") if relevant to the content.
IMPORTANT: Do NOT include KRI/PLP terminology from other states in the keywords.
"""

    prompt = f"""Analyze this SchooLinks marketing content in depth and generate rich, structured metadata.

SchooLinks is a K-12 college and career readiness platform. The marketing content portal
contains resources for sales reps: Customer Stories, Videos, Ebooks, 1-Pagers, Webinars,
Blog posts, Landing Pages, and more.

CONTENT DETAILS:
- Title: {title}
- Type: {content_type}
- State: {state or 'National/Unknown'}
- Existing Tags: {existing_tags or 'None'}
- Existing Summary: {existing_summary or 'None'}
{state_context_block}
EXTRACTED TEXT (from the actual content):
{extracted_text[:MAX_EXTRACTED_TEXT]}

GENERATE THE FOLLOWING (respond ONLY with valid JSON):

{{
  "enhanced_summary": "A detailed 3-5 sentence summary. Be specific about topics, features, customer names, metrics, outcomes mentioned. Optimize for search relevance.",

  "auto_tags": ["tag1", "tag2", ...],
  // ONLY include tags ACTUALLY present in the content. Be selective (3-10 max).
  // Categories: competitor names, personas, topics, features, content format

  "keywords": [
    {{"keyword": "term", "weight": 0.95, "category": "topic"}},
    {{"keyword": "term", "weight": 0.8, "category": "persona"}}
  ],
  // 10-20 weighted keywords extracted from the content.
  // Weight: 0.0-1.0 (how central this keyword is to the content)
  // Categories: "topic", "persona", "feature", "competitor", "state", "outcome", "product"
  // Include: specific product features, educational concepts, state-specific terms,
  //          district/school names, specific metrics or outcomes mentioned

  "key_themes": ["theme1", "theme2", "theme3"],
  // 2-4 high-level themes this content addresses

  "target_audience": ["audience1", "audience2"],
  // Who this content is for (e.g., "school counselors", "district administrators", "CTE directors")

  "competitors_mentioned": ["competitor1"],
  // ONLY list competitors explicitly named (Naviance, Xello, MajorClarity, PowerSchool, Scoir, Kuder, YouScience)

  "content_quality_notes": "Brief assessment of content depth, uniqueness, and search value"
}}

IMPORTANT:
- Extract keywords that would help match this content to user search queries
- Include specific names (districts, schools, people) as high-weight keywords
- Include state legislation codes if mentioned (e.g., HB 773, CCMR, ICAP)
- Weight keywords by how central they are to the content (not just mentioned in passing)
- Do NOT pad with generic tags — only include what is actually in the content"""

    try:
        # gpt-5.x models use max_completion_tokens instead of max_tokens
        api_params = {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are an expert content analyst for K-12 education marketing. Generate structured metadata optimized for search matching. Always respond with valid JSON only."
                },
                {"role": "user", "content": prompt}
            ],
        }
        if model.startswith('gpt-5') or model.startswith('o'):
            api_params["max_completion_tokens"] = 2000
        else:
            api_params["temperature"] = 0.3
            api_params["max_tokens"] = 2000

        response = openai_client.chat.completions.create(**api_params)

        content = response.choices[0].message.content

        # Parse JSON from response
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json.loads(json_match.group())
        else:
            return {'error': 'Could not parse JSON response'}

    except Exception as e:
        return {'error': str(e)}


# =============================================================================
# Record Processing
# =============================================================================

def process_record(
    conn,
    openai_client: OpenAI,
    model: str,
    record: Dict,
    dry_run: bool = False,
    verbose: bool = False,
) -> bool:
    """Process a single content record with deep enrichment."""
    record_id = record['id']
    title = record['title']
    live_link = record.get('live_link')
    ungated_link = record.get('ungated_link')

    url = live_link or ungated_link
    if not url:
        if verbose:
            print(f"  SKIP (no URL): {title[:50]}...")
        return False

    print(f"\n  [{record.get('type', '?')}] {title[:60]}...")

    if dry_run:
        url_type = detect_content_type(url)
        print(f"    URL type: {url_type} | {url[:70]}...")
        print(f"    [DRY RUN] Would extract and deeply analyze content")
        return True

    # Try to use already-extracted text if available, otherwise re-extract
    extracted_text = record.get('extracted_text') or ''
    if len(extracted_text) < 100:
        if verbose:
            print(f"    Extracting from: {url[:70]}...")
        extracted_text = extract_content(url) or ''

    if not extracted_text or len(extracted_text) < 50:
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE marketing_content
                SET extraction_error = %s, deep_enriched_at = %s
                WHERE id = %s
            """, (f"No extractable content from URL", datetime.utcnow(), record_id))
        conn.commit()
        print(f"    - No extractable content ({len(extracted_text)} chars)")
        return False

    if verbose:
        print(f"    Extracted {len(extracted_text)} chars")

    # Fetch state-specific terminology context for state-tagged content
    record_state = record.get('state', '') or ''
    state_ctx = get_state_terminology(conn, record_state)
    if verbose and state_ctx:
        print(f"    State context: {state_ctx['state_name']} — KRI={state_ctx['kri_full'][:40]}, PLP={state_ctx['plp_full'][:40]}")

    # Deep AI analysis
    print(f"    Analyzing with {model}...")
    analysis = analyze_deep(
        openai_client=openai_client,
        model=model,
        title=title,
        content_type=record.get('type', ''),
        state=record_state,
        existing_tags=record.get('tags', ''),
        existing_summary=record.get('summary', ''),
        extracted_text=extracted_text,
        state_context=state_ctx,
    )

    if 'error' in analysis:
        print(f"    - AI error: {analysis['error']}")
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE marketing_content
                SET extraction_error = %s,
                    extracted_text = %s,
                    deep_enriched_at = %s
                WHERE id = %s
            """, (
                f"AI analysis error: {analysis['error']}",
                extracted_text[:MAX_STORED_TEXT],
                datetime.utcnow(),
                record_id
            ))
        conn.commit()
        return False

    # Extract results
    enhanced_summary = analysis.get('enhanced_summary', '')
    auto_tags_raw = analysis.get('auto_tags', [])
    if isinstance(auto_tags_raw, list):
        auto_tags = ', '.join(auto_tags_raw)
    else:
        auto_tags = auto_tags_raw or ''

    keywords = analysis.get('keywords', [])
    # Validate keyword structure
    validated_keywords = []
    for kw in keywords:
        if isinstance(kw, dict) and 'keyword' in kw:
            validated_keywords.append({
                'keyword': str(kw['keyword']),
                'weight': float(kw.get('weight', 0.5)),
                'category': str(kw.get('category', 'topic')),
            })
    keywords_json = json.dumps(validated_keywords)

    # Combine tags
    existing_tags = record.get('tags', '') or ''
    if auto_tags and existing_tags:
        # Deduplicate
        existing_set = set(t.strip().lower() for t in existing_tags.split(','))
        new_tags = [t.strip() for t in auto_tags.split(',') if t.strip().lower() not in existing_set]
        combined_tags = existing_tags + (', ' + ', '.join(new_tags) if new_tags else '')
    else:
        combined_tags = auto_tags or existing_tags

    # Update database
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE marketing_content
            SET enhanced_summary = %s,
                auto_tags = %s,
                tags = %s,
                keywords = %s::jsonb,
                extracted_text = %s,
                deep_enriched_at = %s,
                content_analyzed_at = %s,
                extraction_error = NULL
            WHERE id = %s
        """, (
            enhanced_summary,
            auto_tags,
            combined_tags,
            keywords_json,
            extracted_text[:MAX_STORED_TEXT],
            datetime.utcnow(),
            datetime.utcnow(),
            record_id
        ))
    conn.commit()

    kw_count = len(validated_keywords)
    tag_count = len(auto_tags.split(',')) if auto_tags else 0
    print(f"    + {kw_count} keywords, {tag_count} tags, summary updated")

    if verbose and validated_keywords:
        top_kw = sorted(validated_keywords, key=lambda x: x['weight'], reverse=True)[:5]
        for kw in top_kw:
            print(f"      [{kw['category']}] {kw['keyword']} ({kw['weight']})")

    return True


# =============================================================================
# Main
# =============================================================================

def main():
    parser = argparse.ArgumentParser(description='Deep content enrichment with advanced AI')
    parser.add_argument('--limit', type=int, help='Limit number of records to process')
    parser.add_argument('--force', action='store_true', help='Re-process all content (ignore deep_enriched_at)')
    parser.add_argument('--model', default=DEFAULT_MODEL, help=f'AI model to use (default: {DEFAULT_MODEL})')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')
    args = parser.parse_args()

    print("=" * 60)
    print("Deep Content Enrichment Pipeline")
    print(f"Model: {args.model}")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        print("Export it or add to scripts/.env")
        sys.exit(1)

    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY not set")
        sys.exit(1)

    openai_client = OpenAI(api_key=OPENAI_API_KEY)

    # Connect
    print("\n[1/4] Connecting to database...")
    conn = get_db_connection()
    print("  Connected")

    # Ensure columns
    print("[2/4] Checking schema...")
    ensure_columns_exist(conn)
    print("  Schema ready")

    # Fetch records
    print("[3/4] Fetching content records...")
    with conn.cursor() as cur:
        if args.force:
            query = """
                SELECT * FROM marketing_content
                WHERE live_link IS NOT NULL OR ungated_link IS NOT NULL
                ORDER BY created_at DESC
            """
        else:
            query = """
                SELECT * FROM marketing_content
                WHERE (live_link IS NOT NULL OR ungated_link IS NOT NULL)
                  AND deep_enriched_at IS NULL
                ORDER BY created_at DESC
            """

        if args.limit:
            query += f" LIMIT {args.limit}"

        cur.execute(query)
        records = cur.fetchall()

    print(f"  Found {len(records)} records to process")

    if not records:
        print("\n  No records to process. Use --force to re-process all content.")
        conn.close()
        return

    # Process records
    print(f"\n[4/4] Deep enriching with {args.model}...")
    success_count = 0
    error_count = 0
    skip_count = 0
    start_time = time.time()

    for i, record in enumerate(records):
        progress = f"[{i+1}/{len(records)}]"
        print(f"\n{progress}", end='')

        result = process_record(
            conn=conn,
            openai_client=openai_client,
            model=args.model,
            record=record,
            dry_run=args.dry_run,
            verbose=args.verbose,
        )

        if result:
            success_count += 1
        elif result is False:
            # Check if it was a skip (no URL) vs error
            url = record.get('live_link') or record.get('ungated_link')
            if not url:
                skip_count += 1
            else:
                error_count += 1

        # Rate limiting (skip on dry-run)
        if not args.dry_run and i < len(records) - 1:
            time.sleep(REQUEST_DELAY)

    elapsed = time.time() - start_time
    speed = success_count / (elapsed / 60) if elapsed > 0 else 0

    # Summary
    print("\n")
    print("=" * 60)
    print("Deep Enrichment Summary")
    print("=" * 60)
    print(f"  Total records:   {len(records)}")
    print(f"  Enriched:        {success_count}")
    print(f"  Errors:          {error_count}")
    print(f"  Skipped:         {skip_count}")
    print(f"  Model:           {args.model}")
    print(f"  Time:            {elapsed:.1f}s ({speed:.1f} records/min)")

    if args.dry_run:
        print("\n  [DRY RUN] No changes were made to the database.")

    conn.close()
    print("\nDone!")


if __name__ == '__main__':
    main()

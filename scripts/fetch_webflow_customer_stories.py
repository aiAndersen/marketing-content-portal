#!/usr/bin/env python3
"""
Fetch Customer Stories from Webflow CMS

Pulls all published Customer Story items from the Webflow resources collection,
extracts all available fields, and:
1. Saves a local CSV for reference
2. Matches each story to existing marketing_content records by URL or title
3. Reports which stories are already in the DB and which need to be added

Run this FIRST before enrich_customer_stories.py

Usage:
    python scripts/fetch_webflow_customer_stories.py              # Full fetch
    python scripts/fetch_webflow_customer_stories.py --dry-run -v # Preview
    python scripts/fetch_webflow_customer_stories.py --output PATH  # Custom CSV
"""

import os
import sys
import csv
import json
import re
import time
import argparse
from datetime import datetime
from typing import Optional, Dict, Any, List

import requests
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')
WEBFLOW_API_TOKEN = os.getenv('WEBFLOW_API_TOKEN')

RESOURCES_COLLECTION_ID = '6751db0aa481dcef9c9f387a'
CUSTOMER_STORY_TYPE_ID = '675223f1c7d4029beaea5081'
SCHOOLINKS_BASE_URL = 'https://www.schoolinks.com'

DEFAULT_OUTPUT_PATH = os.path.expanduser(
    f'~/Desktop/inbound-generator/data/reports/customer-stories/customer-stories-{datetime.now().strftime("%Y-%m-%d")}.csv'
)

# CSV columns
CSV_COLUMNS = [
    'webflow_id', 'name', 'slug', 'live_link', 'district_name', 'state',
    'quote', 'video_url', 'pdf_url', 'description', 'meta_description',
    'body_text', 'topics', 'schools_count', 'students_count', 'years_with_sl',
    'published_at', 'marketing_content_id', 'db_match_status'
]


def get_db_connection():
    """Create database connection."""
    if not DATABASE_URL:
        raise ValueError('DATABASE_URL environment variable not set')
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def get_webflow_headers() -> Dict[str, str]:
    return {
        'Authorization': f'Bearer {WEBFLOW_API_TOKEN}',
        'accept': 'application/json'
    }


def fetch_all_customer_stories() -> List[Dict]:
    """Fetch all Customer Story items from Webflow resources collection."""
    headers = get_webflow_headers()
    all_items = []
    offset = 0
    limit = 100

    print(f'Fetching from Webflow collection {RESOURCES_COLLECTION_ID}...')

    while True:
        url = (
            f'https://api.webflow.com/v2/collections/{RESOURCES_COLLECTION_ID}/items'
            f'?limit={limit}&offset={offset}'
        )
        try:
            response = requests.get(url, headers=headers, timeout=30)
            response.raise_for_status()
            data = response.json()
            items = data.get('items', [])

            if not items:
                break

            all_items.extend(items)
            print(f'  Fetched {len(all_items)} items so far...')
            offset += limit
            time.sleep(0.3)

            if len(items) < limit:
                break

        except Exception as e:
            print(f'ERROR fetching items at offset {offset}: {e}')
            break

    # Filter to Customer Stories only
    customer_stories = [
        item for item in all_items
        if not item.get('isDraft') and not item.get('isArchived')
        and item.get('fieldData', {}).get('resource-type') == CUSTOMER_STORY_TYPE_ID
    ]

    return customer_stories


def get_topic_map() -> Dict[str, str]:
    """Fetch topic ID → name mapping from Webflow."""
    RESOURCE_TOPICS_COLLECTION_ID = '6751dae129876320ee925de2'
    headers = get_webflow_headers()
    topics = {}
    try:
        url = f'https://api.webflow.com/v2/collections/{RESOURCE_TOPICS_COLLECTION_ID}/items?limit=100'
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        items = response.json().get('items', [])
        for item in items:
            topics[item.get('id')] = item.get('fieldData', {}).get('name', '')
    except Exception as e:
        print(f'  WARN: Could not load topic map: {e}')
    return topics


def extract_story_fields(item: Dict, topic_map: Dict[str, str]) -> Dict[str, Any]:
    """Extract and normalize fields from a Webflow CMS item.

    Actual Webflow field names (confirmed from API inspection 2026-02-24):
      cs-state       — 2-letter state code (e.g. 'TX', 'AZ')
      cs-city        — city name (nearest proxy for district city)
      cs-pdf-download — PDF URL string
      video-link     — dict with 'url' key (Vimeo or YouTube URL)
      meta-description — plain text description
      body           — rich text body (may be dict or None)
      cs-schools-number, cs-students-number, cs-years-with-sl — metrics
    """
    fd = item.get('fieldData', {})
    slug = fd.get('slug', '')

    # Build landing page URL
    live_link = f'{SCHOOLINKS_BASE_URL}/resources/{slug}' if slug else ''

    # Extract topic names
    topic_ids = fd.get('resource-topic-s', [])
    if isinstance(topic_ids, str):
        topic_ids = [topic_ids]
    topics = ', '.join(
        topic_map.get(tid, tid) for tid in topic_ids if tid
    )

    # State — cs-state is the confirmed field name
    state = fd.get('cs-state', '') or ''
    if isinstance(state, str):
        state = state.strip().upper()[:2]

    # City (closest to district location)
    city = fd.get('cs-city', '') or ''

    # Video URL — video-link is a dict with a 'url' key
    video_link_field = fd.get('video-link')
    if isinstance(video_link_field, dict):
        video_url = video_link_field.get('url', '')
    elif isinstance(video_link_field, str):
        video_url = video_link_field
    else:
        video_url = ''

    # PDF URL — cs-pdf-download is a plain string URL
    pdf_url = fd.get('cs-pdf-download', '') or ''

    # District name — derive from story title (e.g. "How Austin ISD..." → "Austin ISD")
    # Webflow has no dedicated district field; cs-city is closest hint
    district_name = city  # Will be enriched/corrected by AI during enrich step

    # Description (meta)
    description = fd.get('meta-description', '') or ''

    # Body — Webflow returns rich text as an HTML string; strip tags to plain text
    body_html = fd.get('body', '') or ''
    if isinstance(body_html, dict):
        body_html = ''  # unexpected format — skip
    if body_html:
        from bs4 import BeautifulSoup as _BS
        import re as _re
        _soup = _BS(body_html, 'html.parser')
        body_text = _soup.get_text(separator=' ', strip=True)
        body_text = _re.sub(r'\s+', ' ', body_text).strip()
    else:
        body_text = ''

    # Metrics from Webflow
    schools_count = fd.get('cs-schools-number', '') or ''
    students_count = fd.get('cs-students-number', '') or ''
    years_with_sl = fd.get('cs-years-with-sl', '') or ''

    meta_description = fd.get('meta-description', '') or ''
    published_at = item.get('lastPublished') or item.get('createdOn', '')

    return {
        'webflow_id': item.get('id', ''),
        'name': fd.get('name', '').strip(),
        'slug': slug,
        'live_link': live_link,
        'district_name': district_name.strip() if isinstance(district_name, str) else '',
        'state': state,
        'quote': '',  # No quote field in Webflow CMS — extracted from page by enrich script
        'video_url': video_url.strip() if isinstance(video_url, str) else '',
        'pdf_url': pdf_url.strip() if isinstance(pdf_url, str) else '',
        'description': description.strip()[:2000],
        'meta_description': meta_description.strip(),
        'body_text': body_text[:12000],  # Full story body — primary source for enrichment
        'topics': topics,
        'published_at': published_at,
        'schools_count': str(schools_count),
        'students_count': str(students_count),
        'years_with_sl': str(years_with_sl),
        'raw_fields': fd,  # Keep all fields for debugging
    }


def match_to_db(conn, stories: List[Dict], verbose: bool) -> List[Dict]:
    """
    Match each story to an existing marketing_content record.
    Tries URL match first, then title match.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, title, live_link, type
            FROM marketing_content
            WHERE type = 'Customer Story'
            ORDER BY last_updated DESC
        """)
        db_records = cur.fetchall()

    # Build lookup indices
    url_to_id = {}
    title_to_id = {}
    for rec in db_records:
        if rec['live_link']:
            url_norm = rec['live_link'].lower().rstrip('/')
            url_to_id[url_norm] = str(rec['id'])
        if rec['title']:
            title_to_id[rec['title'].lower().strip()] = str(rec['id'])

    matched = 0
    unmatched = 0

    for story in stories:
        marketing_content_id = None
        match_status = 'not_found'

        # Try URL match
        if story['live_link']:
            url_norm = story['live_link'].lower().rstrip('/')
            if url_norm in url_to_id:
                marketing_content_id = url_to_id[url_norm]
                match_status = 'url_match'

        # Try title match
        if not marketing_content_id and story['name']:
            title_norm = story['name'].lower().strip()
            if title_norm in title_to_id:
                marketing_content_id = title_to_id[title_norm]
                match_status = 'title_match'

        story['marketing_content_id'] = marketing_content_id or ''
        story['db_match_status'] = match_status

        if marketing_content_id:
            matched += 1
            if verbose:
                print(f'  [MATCH] {story["name"][:50]} → {match_status} (id={marketing_content_id})')
        else:
            unmatched += 1
            if verbose:
                print(f'  [MISS]  {story["name"][:50]} → no DB match')

    print(f'  DB matches: {matched} matched, {unmatched} unmatched')
    return stories


def save_csv(stories: List[Dict], output_path: str, verbose: bool):
    """Save stories to CSV file."""
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    with open(output_path, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=CSV_COLUMNS, extrasaction='ignore')
        writer.writeheader()
        for story in stories:
            writer.writerow({k: story.get(k, '') for k in CSV_COLUMNS})

    print(f'  Saved {len(stories)} rows to {output_path}')


def print_raw_fields_sample(stories: List[Dict], n: int = 3):
    """Print all raw Webflow field keys for the first N stories (for debugging)."""
    print(f'\n=== RAW FIELD KEYS (first {min(n, len(stories))} stories) ===')
    for story in stories[:n]:
        raw = story.get('raw_fields', {})
        print(f'\n  Story: {story["name"][:60]}')
        print(f'  Fields: {list(raw.keys())}')
        # Show values for customer-story-specific fields
        interesting = {k: v for k, v in raw.items()
                      if any(kw in k.lower() for kw in ['quote', 'video', 'pdf', 'customer', 'district', 'state', 'name', 'download'])}
        for k, v in interesting.items():
            val_str = str(v)[:80] if v else '(empty)'
            print(f'    {k}: {val_str}')


def main():
    parser = argparse.ArgumentParser(
        description='Fetch Customer Stories from Webflow CMS'
    )
    parser.add_argument('--dry-run', action='store_true',
                        help='Fetch and preview without saving')
    parser.add_argument('--output', default=DEFAULT_OUTPUT_PATH,
                        help=f'CSV output path (default: {DEFAULT_OUTPUT_PATH})')
    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Show detailed output')
    parser.add_argument('--fields', action='store_true',
                        help='Print raw Webflow field keys for first 3 stories (for debugging)')
    args = parser.parse_args()

    print(f'Customer Story Fetch — {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    if args.dry_run:
        print('[DRY RUN] No files will be saved')
    print()

    if not WEBFLOW_API_TOKEN:
        print('ERROR: WEBFLOW_API_TOKEN not set')
        sys.exit(1)

    # Step 1: Fetch from Webflow
    stories_raw = fetch_all_customer_stories()
    print(f'Found {len(stories_raw)} published Customer Stories in Webflow')
    if not stories_raw:
        print('No customer stories found. Check WEBFLOW_API_TOKEN and collection ID.')
        sys.exit(1)
    print()

    # Step 2: Load topic map
    print('Loading topic map...')
    topic_map = get_topic_map()
    print(f'  {len(topic_map)} topics loaded')
    print()

    # Step 3: Extract fields
    print('Extracting fields...')
    stories = [extract_story_fields(item, topic_map) for item in stories_raw]

    # Show field debug info if requested
    if args.fields:
        print_raw_fields_sample(stories)
        print()

    # Step 4: Match to DB
    print('Matching to marketing_content records...')
    try:
        conn = get_db_connection()
        stories = match_to_db(conn, stories, args.verbose)
        conn.close()
    except Exception as e:
        print(f'  WARN: Could not connect to DB for matching: {e}')
        for s in stories:
            s['marketing_content_id'] = ''
            s['db_match_status'] = 'db_error'
    print()

    # Step 5: Summary
    by_status = {}
    for s in stories:
        by_status.setdefault(s['db_match_status'], []).append(s['name'])

    print('=== SUMMARY ===')
    print(f'  Total customer stories: {len(stories)}')
    for status, names in sorted(by_status.items()):
        print(f'  {status}: {len(names)}')
    print()

    # Step 6: Show unmatched (may need to be imported via import_webflow_resources.py first)
    unmatched = [s for s in stories if s['db_match_status'] == 'not_found']
    if unmatched:
        print(f'  Stories NOT in DB ({len(unmatched)}) — run import_webflow_resources.py --type "Customer Story" to import:')
        for s in unmatched[:10]:
            print(f'    - {s["name"][:60]}')
        if len(unmatched) > 10:
            print(f'    ... and {len(unmatched) - 10} more')
        print()

    # Step 7: Save CSV
    if not args.dry_run:
        print(f'Saving CSV to {args.output}...')
        save_csv(stories, args.output, args.verbose)
    else:
        print('[DRY RUN] Would save CSV to:', args.output)
        if args.verbose:
            print()
            for s in stories[:5]:
                print(f'  {s["name"][:60]:60} | state={s["state"] or "?"} | match={s["db_match_status"]}')
            if len(stories) > 5:
                print(f'  ... and {len(stories) - 5} more')

    print()
    print('Done!')
    if not args.dry_run:
        print()
        print('Next step: run enrich_customer_stories.py to build ai_context entries.')
        print(f'  python scripts/enrich_customer_stories.py --csv-path {args.output} --limit 3 -v')


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Comprehensive Content Enrichment Pipeline

Pulls from multiple sources:
1. Webflow CMS (Resources, Testimonials)
2. SchooLinks competitor pages
3. Retry YouTube transcripts
4. Scrape SL Resources pages

Usage:
    python enrich_comprehensive.py --dry-run     # Preview
    python enrich_comprehensive.py --webflow     # Webflow only
    python enrich_comprehensive.py --youtube     # YouTube retry only
    python enrich_comprehensive.py --all         # Full enrichment
"""

import os
import sys
import argparse
import json
import re
import time
from datetime import datetime
from typing import Optional, Dict, Any, List

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import requests
from bs4 import BeautifulSoup
from openai import OpenAI

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
WEBFLOW_API_TOKEN = os.getenv('WEBFLOW_API_TOKEN')
WEBFLOW_SITE_ID = os.getenv('WEBFLOW_SITE_ID')

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# Try to import YouTube transcript API
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import TranscriptsDisabled, NoTranscriptFound, VideoUnavailable
    YOUTUBE_API_AVAILABLE = True
except ImportError:
    YOUTUBE_API_AVAILABLE = False
    print("⚠ youtube-transcript-api not installed, skipping YouTube enrichment")


def get_db_connection():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def strip_html(html: str) -> str:
    """Remove HTML tags from text."""
    if not html:
        return ""
    soup = BeautifulSoup(html, 'html.parser')
    return soup.get_text(separator=' ', strip=True)


def analyze_with_openai(title: str, content: str, content_type: str = "") -> Dict:
    """Analyze content and generate metadata."""
    if not openai_client or not content or len(content) < 50:
        return {}

    prompt = f"""Analyze this SchooLinks content and generate metadata.

TITLE: {title}
TYPE: {content_type}

CONTENT:
{content[:5000]}

GENERATE (JSON only):
{{
  "enhanced_summary": "2-3 sentence summary",
  "auto_tags": "3-8 relevant tags from: competitor names (Naviance, Xello, Scoir, LevelAll, MajorClarity, PowerSchool), personas (counselors, administrators, CTE coordinators, students, parents), topics (FAFSA, graduation, work-based learning, career exploration, college readiness, course planning)",
  "competitors_mentioned": ["only if actually named"],
  "key_topics": ["2-4 topics"]
}}

Only include tags ACTUALLY in the content."""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Marketing content analyst. Respond with valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=600
        )

        content_str = response.choices[0].message.content
        json_match = re.search(r'\{[\s\S]*\}', content_str)
        if json_match:
            return json.loads(json_match.group())
    except Exception as e:
        print(f"  OpenAI error: {e}")

    return {}


def webflow_request(endpoint: str) -> Optional[Dict]:
    """Make authenticated Webflow API request."""
    if not WEBFLOW_API_TOKEN:
        return None

    headers = {
        'Authorization': f'Bearer {WEBFLOW_API_TOKEN}',
        'accept': 'application/json'
    }

    try:
        response = requests.get(f'https://api.webflow.com/v2/{endpoint}', headers=headers)
        if response.ok:
            return response.json()
        print(f"  Webflow API error: {response.status_code}")
    except Exception as e:
        print(f"  Webflow request error: {e}")

    return None


def get_all_webflow_items(collection_id: str, published_only: bool = True) -> List[Dict]:
    """Get all items from a Webflow collection with pagination.

    Args:
        collection_id: Webflow collection ID
        published_only: Only return published/live items (default True)
    """
    all_items = []
    offset = 0
    limit = 100

    while True:
        data = webflow_request(f'collections/{collection_id}/items?limit={limit}&offset={offset}')
        if not data:
            break

        items = data.get('items', [])
        if not items:
            break

        # Filter to only published items if requested
        if published_only:
            items = [item for item in items if not item.get('isDraft', False) and not item.get('isArchived', False)]

        all_items.extend(items)
        offset += limit
        time.sleep(0.3)  # Rate limit

        if len(items) < limit:
            break

    return all_items


def enrich_from_webflow(conn, dry_run: bool = False):
    """Pull content from Webflow CMS and update Supabase."""
    if not WEBFLOW_API_TOKEN or not WEBFLOW_SITE_ID:
        print("⚠ Webflow credentials not set, skipping")
        return

    print("\n" + "=" * 50)
    print("WEBFLOW CMS ENRICHMENT")
    print("=" * 50)

    # Resources collection
    resources_id = '6751db0aa481dcef9c9f387a'
    print(f"\nFetching Resources collection...")

    items = get_all_webflow_items(resources_id)
    print(f"Found {len(items)} resources")

    updated = 0
    matched = 0

    for i, item in enumerate(items):
        fields = item.get('fieldData', {})
        title = fields.get('name', '')
        body = strip_html(fields.get('body', ''))
        meta_desc = fields.get('meta-description', '')
        slug = fields.get('slug', '')

        if not title or len(body) < 100:
            continue

        if dry_run:
            if i < 5:
                print(f"  [{i+1}] {title[:50]}... ({len(body)} chars)")
            continue

        # Try to find matching Supabase record
        with conn.cursor() as cur:
            # Match by title or URL containing slug
            cur.execute("""
                SELECT id, title, extracted_text, live_link
                FROM marketing_content
                WHERE title ILIKE %s
                   OR live_link ILIKE %s
                LIMIT 1
            """, (f'%{title[:40]}%', f'%{slug}%'))

            record = cur.fetchone()

            if record:
                matched += 1

                # Only update if we have more content
                existing_text = record.get('extracted_text') or ''
                if len(body) > len(existing_text):
                    # Analyze with OpenAI
                    analysis = analyze_with_openai(title, body, 'Blog')

                    auto_tags = analysis.get('auto_tags', '')
                    if isinstance(auto_tags, list):
                        auto_tags = ', '.join(auto_tags)

                    cur.execute("""
                        UPDATE marketing_content
                        SET extracted_text = %s,
                            enhanced_summary = COALESCE(%s, enhanced_summary),
                            auto_tags = CASE
                                WHEN auto_tags IS NULL OR auto_tags = '' THEN %s
                                ELSE auto_tags || ', ' || %s
                            END,
                            content_analyzed_at = %s,
                            extraction_error = NULL
                        WHERE id = %s
                    """, (
                        body[:5000],
                        analysis.get('enhanced_summary'),
                        auto_tags, auto_tags,
                        datetime.utcnow(),
                        record['id']
                    ))
                    conn.commit()
                    updated += 1
                    print(f"  ✓ Updated: {title[:40]}...")

        if (i + 1) % 50 == 0:
            print(f"  Processed {i + 1}/{len(items)}...")

        time.sleep(0.2)

    print(f"\nWebflow: Matched {matched}, Updated {updated} records")


def enrich_competitor_pages(conn, dry_run: bool = False):
    """Scrape competitor comparison pages."""
    print("\n" + "=" * 50)
    print("COMPETITOR PAGES ENRICHMENT")
    print("=" * 50)

    pages = [
        ('https://www.schoolinks.com/competitors/schoolinks-vs-xello', 'SL vs Xello', 'Xello'),
        ('https://www.schoolinks.com/competitors/schoolinks-vs-naviance', 'SL vs Naviance', 'Naviance'),
        ('https://www.schoolinks.com/competitors/schoolinks-vs-scoir', 'SL vs Scoir', 'Scoir'),
    ]

    for url, title_match, competitor in pages:
        print(f"\n{competitor} comparison page...")

        if dry_run:
            print(f"  [DRY RUN] Would scrape: {url}")
            continue

        try:
            response = requests.get(url, timeout=30, headers={
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            })
            response.raise_for_status()

            soup = BeautifulSoup(response.text, 'html.parser')
            for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
                tag.decompose()

            content = soup.get_text(separator=' ', strip=True)
            content = re.sub(r'\s+', ' ', content)

            if len(content) < 200:
                print(f"  ✗ Not enough content scraped")
                continue

            print(f"  ✓ Scraped {len(content)} chars")

            # Analyze
            analysis = analyze_with_openai(f"SchooLinks vs {competitor}", content, 'Landing Page')

            auto_tags = analysis.get('auto_tags', '')
            if isinstance(auto_tags, list):
                auto_tags = ', '.join(auto_tags)

            # Make sure competitor tag is included
            if competitor.lower() not in auto_tags.lower():
                auto_tags = f"{competitor}, {auto_tags}" if auto_tags else competitor

            # Update Supabase
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE marketing_content
                    SET extracted_text = %s,
                        enhanced_summary = %s,
                        auto_tags = %s,
                        tags = CASE
                            WHEN tags IS NULL OR tags = '' THEN %s
                            WHEN tags NOT ILIKE %s THEN tags || ', ' || %s
                            ELSE tags
                        END,
                        content_analyzed_at = %s,
                        extraction_error = NULL
                    WHERE title ILIKE %s OR title ILIKE %s
                """, (
                    content[:5000],
                    analysis.get('enhanced_summary', ''),
                    auto_tags,
                    auto_tags,
                    f'%{competitor}%', competitor,
                    datetime.utcnow(),
                    f'%{title_match}%', f'%vs {competitor}%'
                ))
                conn.commit()

                if cur.rowcount > 0:
                    print(f"  ✓ Updated {cur.rowcount} record(s)")
                else:
                    print(f"  ⚠ No matching record found")

        except Exception as e:
            print(f"  ✗ Error: {e}")

        time.sleep(1)


def retry_youtube_transcripts(conn, dry_run: bool = False, limit: int = 50):
    """Retry getting transcripts for YouTube videos that failed."""
    if not YOUTUBE_API_AVAILABLE:
        print("⚠ YouTube API not available")
        return

    print("\n" + "=" * 50)
    print("YOUTUBE TRANSCRIPT RETRY")
    print("=" * 50)

    with conn.cursor() as cur:
        # Get YouTube videos without transcripts
        cur.execute("""
            SELECT id, title, live_link
            FROM marketing_content
            WHERE (live_link ILIKE %s OR live_link ILIKE %s)
              AND (extracted_text IS NULL OR LENGTH(extracted_text) < 50)
            LIMIT %s
        """, ('%youtube%', '%youtu.be%', limit))

        videos = cur.fetchall()

    print(f"Found {len(videos)} videos to retry")

    success = 0

    for video in videos:
        title = video['title']
        url = video['live_link']

        # Extract video ID
        video_id = None
        if 'youtube.com' in url:
            if '/shorts/' in url:
                video_id = url.split('/shorts/')[-1].split('?')[0].split('/')[0]
            elif 'v=' in url:
                video_id = url.split('v=')[-1].split('&')[0]
        elif 'youtu.be' in url:
            video_id = url.split('/')[-1].split('?')[0]

        if not video_id:
            continue

        print(f"\n{title[:40]}... (ID: {video_id})")

        if dry_run:
            print(f"  [DRY RUN] Would fetch transcript")
            continue

        try:
            api = YouTubeTranscriptApi()
            transcript = api.fetch(video_id, languages=['en', 'en-US', 'en-GB'])

            text = ' '.join([entry.text for entry in transcript])
            text = re.sub(r'\[.*?\]', '', text)  # Remove [Music] etc
            text = re.sub(r'\s+', ' ', text).strip()

            if len(text) < 50:
                print(f"  ✗ Transcript too short")
                continue

            print(f"  ✓ Got {len(text)} chars")

            # Analyze
            analysis = analyze_with_openai(title, text, 'Video')

            auto_tags = analysis.get('auto_tags', '')
            if isinstance(auto_tags, list):
                auto_tags = ', '.join(auto_tags)

            # Update
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE marketing_content
                    SET extracted_text = %s,
                        enhanced_summary = %s,
                        auto_tags = CASE
                            WHEN auto_tags IS NULL OR auto_tags = '' THEN %s
                            ELSE auto_tags || ', ' || %s
                        END,
                        content_analyzed_at = %s,
                        extraction_error = NULL
                    WHERE id = %s
                """, (
                    text[:5000],
                    analysis.get('enhanced_summary', ''),
                    auto_tags, auto_tags,
                    datetime.utcnow(),
                    video['id']
                ))
                conn.commit()
                success += 1

        except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable) as e:
            print(f"  ✗ {type(e).__name__}")
        except Exception as e:
            print(f"  ✗ Error: {e}")

        time.sleep(0.5)

    print(f"\nYouTube: Successfully enriched {success} videos")


def scrape_sl_resource_pages(conn, dry_run: bool = False, limit: int = 20):
    """Scrape SL Resources pages that are missing content."""
    print("\n" + "=" * 50)
    print("SL RESOURCES PAGE SCRAPING")
    print("=" * 50)

    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, title, live_link
            FROM marketing_content
            WHERE platform ILIKE %s
              AND (extracted_text IS NULL OR LENGTH(extracted_text) < 100)
              AND live_link IS NOT NULL
              AND live_link != ''
            LIMIT %s
        """, ('%SL Res%', limit))

        pages = cur.fetchall()

    print(f"Found {len(pages)} pages to scrape")

    success = 0

    for page in pages:
        title = page['title']
        url = page['live_link']

        if not url or not url.startswith('http'):
            url = f"https://{url}" if url else None

        if not url:
            continue

        print(f"\n{title[:40]}...")

        if dry_run:
            print(f"  [DRY RUN] Would scrape: {url[:50]}")
            continue

        try:
            response = requests.get(url, timeout=30, headers={
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
            })
            response.raise_for_status()

            soup = BeautifulSoup(response.text, 'html.parser')
            for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
                tag.decompose()

            content = soup.get_text(separator=' ', strip=True)
            content = re.sub(r'\s+', ' ', content)

            if len(content) < 100:
                print(f"  ✗ Not enough content")
                continue

            print(f"  ✓ Scraped {len(content)} chars")

            # Analyze
            analysis = analyze_with_openai(title, content, 'Blog')

            auto_tags = analysis.get('auto_tags', '')
            if isinstance(auto_tags, list):
                auto_tags = ', '.join(auto_tags)

            # Update
            with conn.cursor() as cur:
                cur.execute("""
                    UPDATE marketing_content
                    SET extracted_text = %s,
                        enhanced_summary = %s,
                        auto_tags = CASE
                            WHEN auto_tags IS NULL OR auto_tags = '' THEN %s
                            ELSE auto_tags
                        END,
                        content_analyzed_at = %s,
                        extraction_error = NULL
                    WHERE id = %s
                """, (
                    content[:5000],
                    analysis.get('enhanced_summary', ''),
                    auto_tags,
                    datetime.utcnow(),
                    page['id']
                ))
                conn.commit()
                success += 1

        except Exception as e:
            print(f"  ✗ Error: {e}")

        time.sleep(1)

    print(f"\nSL Resources: Scraped {success} pages")


def main():
    parser = argparse.ArgumentParser(description='Comprehensive content enrichment')
    parser.add_argument('--dry-run', action='store_true', help='Preview without changes')
    parser.add_argument('--webflow', action='store_true', help='Webflow only')
    parser.add_argument('--youtube', action='store_true', help='YouTube retry only')
    parser.add_argument('--competitors', action='store_true', help='Competitor pages only')
    parser.add_argument('--scrape', action='store_true', help='SL Resources scraping only')
    parser.add_argument('--all', action='store_true', help='Run all enrichments')
    parser.add_argument('--limit', type=int, default=50, help='Limit for YouTube/scrape')
    args = parser.parse_args()

    print("=" * 60)
    print("COMPREHENSIVE CONTENT ENRICHMENT")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    conn = get_db_connection()
    print("✓ Connected to database")

    run_all = args.all or not any([args.webflow, args.youtube, args.competitors, args.scrape])

    if args.webflow or run_all:
        enrich_from_webflow(conn, dry_run=args.dry_run)

    if args.competitors or run_all:
        enrich_competitor_pages(conn, dry_run=args.dry_run)

    if args.youtube or run_all:
        retry_youtube_transcripts(conn, dry_run=args.dry_run, limit=args.limit)

    if args.scrape or run_all:
        scrape_sl_resource_pages(conn, dry_run=args.dry_run, limit=args.limit)

    conn.close()

    print("\n" + "=" * 60)
    print("ENRICHMENT COMPLETE")
    print("=" * 60)


if __name__ == '__main__':
    main()

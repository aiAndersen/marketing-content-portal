#!/usr/bin/env python3
"""
Webflow Resources CMS Import Script

Imports all published resources from Webflow CMS including:
- Blog Posts, Videos, Webinars, eBooks, Customer Stories
- Press Releases, Awards, Events, 1-Pagers

Avoids duplicates by checking existing titles and URLs.

Usage:
    python import_webflow_resources.py              # Full import
    python import_webflow_resources.py --dry-run    # Preview without changes
    python import_webflow_resources.py --type "Blog Post"  # Import specific type
"""

import os
import sys
import argparse
import json
import re
import time
from datetime import datetime
from typing import Optional, Dict, Any, List, Set
from html import unescape

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

# Collection IDs
RESOURCES_COLLECTION_ID = '6751db0aa481dcef9c9f387a'
RESOURCE_TYPES_COLLECTION_ID = '6751daf28e1af86441a0593a'
RESOURCE_TOPICS_COLLECTION_ID = '6751dae129876320ee925de2'

# SchooLinks base URL
SCHOOLINKS_BASE_URL = 'https://www.schoolinks.com'

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# Type ID to database type mapping
WEBFLOW_TYPE_MAP = {
    '67626bc6c3c7b15c804c0426': 'Award',
    '675223f253981c726ff23303': 'Webinar',
    '675223f2984c60080643fd9a': 'Video',
    '675223f1552c4c30b0ddced4': 'Ebook',
    '675223f1c7d4029beaea5081': 'Customer Story',
    '675223f1d5bb34dc72fc6709': 'Event',
    '675223f1bba77df9f4a65aca': 'Blog',
    '675223f1e57b8177a6e5f8f2': '1-Pager',
    '675223f146c059050c3effe6': 'Press Release'
}


def get_db_connection():
    """Create database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def get_existing_content(conn) -> tuple[Set[str], Set[str]]:
    """Get existing titles and URLs to avoid duplicates."""
    with conn.cursor() as cur:
        cur.execute("SELECT title, live_link FROM marketing_content")
        rows = cur.fetchall()

        titles = set()
        urls = set()

        for row in rows:
            if row['title']:
                titles.add(row['title'].lower().strip())
            if row['live_link']:
                url = row['live_link'].lower().rstrip('/')
                urls.add(url)
                urls.add(url.replace('www.', ''))

        return titles, urls


def normalize_title(title: str) -> str:
    """Normalize title for comparison."""
    return title.lower().strip() if title else ''


def normalize_url(url: str) -> str:
    """Normalize URL for comparison."""
    return url.lower().rstrip('/').replace('www.', '') if url else ''


def get_webflow_items(collection_id: str, limit: int = 100) -> List[Dict]:
    """Get all items from a Webflow CMS collection."""
    if not WEBFLOW_API_TOKEN:
        return []

    headers = {
        'Authorization': f'Bearer {WEBFLOW_API_TOKEN}',
        'accept': 'application/json'
    }

    all_items = []
    offset = 0

    while True:
        url = f'https://api.webflow.com/v2/collections/{collection_id}/items?limit={limit}&offset={offset}'

        try:
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()
            items = data.get('items', [])

            if not items:
                break

            all_items.extend(items)
            offset += limit
            time.sleep(0.3)

            if len(items) < limit:
                break

        except Exception as e:
            print(f"Error fetching items: {e}")
            break

    return all_items


def get_resource_topics() -> Dict[str, str]:
    """Get topic ID to name mapping."""
    items = get_webflow_items(RESOURCE_TOPICS_COLLECTION_ID)
    return {
        item.get('id'): item.get('fieldData', {}).get('name', '')
        for item in items
    }


def strip_html(html_content: str) -> str:
    """Strip HTML tags and clean up text."""
    if not html_content:
        return ''
    soup = BeautifulSoup(html_content, 'html.parser')
    text = soup.get_text(separator=' ', strip=True)
    text = unescape(text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()


def scrape_resource_page(url: str) -> Optional[str]:
    """Scrape additional content from the resource page."""
    try:
        response = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Remove navigation, footer, scripts
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'noscript', 'iframe']):
            tag.decompose()

        # Find main content
        main_content = (
            soup.find('article') or
            soup.find('main') or
            soup.find('div', class_=re.compile(r'resource|article|post|content', re.I))
        )

        if main_content:
            text = main_content.get_text(separator=' ', strip=True)
        else:
            text = soup.body.get_text(separator=' ', strip=True) if soup.body else ''

        text = re.sub(r'\s+', ' ', text)
        return text[:10000] if text else None

    except Exception as e:
        return None


def analyze_resource(title: str, content: str, resource_type: str) -> Dict[str, Any]:
    """Use OpenAI to analyze resource and generate metadata."""
    if not openai_client or not content or len(content) < 100:
        return {}

    prompt = f"""Analyze this SchooLinks marketing resource and generate search metadata.

RESOURCE DETAILS:
- Title: {title}
- Type: {resource_type}

CONTENT:
{content[:5000]}

GENERATE (respond in valid JSON only):
{{
  "enhanced_summary": "A 2-3 sentence summary of what this resource covers. Be specific about the value proposition.",

  "auto_tags": "5-8 relevant tags from this list: competitor names (Naviance, Xello, MajorClarity, Scoir), personas (counselors, administrators, CTE-coordinators, students, parents), topics (FAFSA, graduation-tracking, work-based-learning, career-exploration, college-readiness, course-planning, KRI, SEL, alumni-tracking), format (guide, comparison, case-study, tutorial, webinar, video)",

  "key_topics": ["2-4 main topics covered"],

  "target_persona": "Primary audience (counselors, administrators, CTE coordinators, parents, students)"
}}

IMPORTANT: Only include tags that are ACTUALLY discussed in the content."""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a marketing content analyst. Generate structured metadata for search optimization. Always respond with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=600
        )

        content_str = response.choices[0].message.content
        json_match = re.search(r'\{[\s\S]*\}', content_str)
        if json_match:
            return json.loads(json_match.group())
        return {}

    except Exception as e:
        print(f"    OpenAI error: {e}")
        return {}


def insert_resource(conn, resource_data: Dict, dry_run: bool = False) -> bool:
    """Insert a new resource into the database."""
    if dry_run:
        return True

    with conn.cursor() as cur:
        try:
            cur.execute("""
                INSERT INTO marketing_content (
                    type, title, live_link, ungated_link, platform, summary, tags,
                    extracted_text, enhanced_summary, auto_tags, content_analyzed_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                resource_data.get('type'),
                resource_data.get('title'),
                resource_data.get('live_link'),
                resource_data.get('ungated_link'),
                resource_data.get('platform', 'Website'),
                resource_data.get('summary'),
                resource_data.get('tags'),
                resource_data.get('extracted_text'),
                resource_data.get('enhanced_summary'),
                resource_data.get('auto_tags'),
                datetime.utcnow()
            ))
            conn.commit()
            return True
        except Exception as e:
            print(f"    Error inserting: {e}")
            conn.rollback()
            return False


def main():
    parser = argparse.ArgumentParser(description='Import resources from Webflow CMS')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    parser.add_argument('--type', type=str, help='Import specific resource type only')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of resources to import (0 = all)')
    parser.add_argument('--skip-ai', action='store_true', help='Skip OpenAI analysis')
    args = parser.parse_args()

    print("=" * 60)
    print("Webflow Resources CMS Import")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    if not WEBFLOW_API_TOKEN:
        print("ERROR: WEBFLOW_API_TOKEN not set")
        sys.exit(1)

    conn = get_db_connection()
    print("✓ Connected to database")

    # Get existing content to avoid duplicates
    existing_titles, existing_urls = get_existing_content(conn)
    print(f"✓ Found {len(existing_titles)} existing titles, {len(existing_urls)} existing URLs")

    # Get topic mappings
    print("✓ Loading topic mappings...")
    topic_map = get_resource_topics()

    # Get all resources from Webflow
    print(f"\n=== FETCHING RESOURCES FROM WEBFLOW ===")
    resources = get_webflow_items(RESOURCES_COLLECTION_ID)
    print(f"Found {len(resources)} total resources in Webflow")

    # Filter out drafts and archived
    published_resources = [
        r for r in resources
        if not r.get('isDraft') and not r.get('isArchived')
    ]
    print(f"Published resources: {len(published_resources)}")

    # Process resources
    added = 0
    skipped_duplicate = 0
    skipped_type = 0
    errors = 0

    print(f"\n=== PROCESSING RESOURCES ===")

    for i, resource in enumerate(published_resources):
        if args.limit > 0 and added >= args.limit:
            print(f"\nReached limit of {args.limit} imports")
            break

        field_data = resource.get('fieldData', {})

        # Get basic info
        title = field_data.get('name', '').strip()
        slug = field_data.get('slug', '')
        type_id = field_data.get('resource-type')
        resource_type = WEBFLOW_TYPE_MAP.get(type_id, 'Blog')

        # Filter by type if specified
        if args.type and args.type.lower() not in resource_type.lower():
            skipped_type += 1
            continue

        # Build URL
        live_link = f"{SCHOOLINKS_BASE_URL}/resources/{slug}" if slug else None

        # Check for duplicates
        if normalize_title(title) in existing_titles:
            skipped_duplicate += 1
            continue

        if live_link and normalize_url(live_link) in existing_urls:
            skipped_duplicate += 1
            continue

        print(f"\n[{added + 1}] {title[:50]}...")
        print(f"    Type: {resource_type}")

        if args.dry_run:
            print(f"    [DRY RUN] Would import")
            added += 1
            existing_titles.add(normalize_title(title))
            if live_link:
                existing_urls.add(normalize_url(live_link))
            continue

        # Get content from Webflow body field
        body_content = strip_html(field_data.get('body', ''))
        meta_description = field_data.get('meta-description', '')

        # If body is short, try scraping the page
        if len(body_content) < 200 and live_link:
            scraped = scrape_resource_page(live_link)
            if scraped and len(scraped) > len(body_content):
                body_content = scraped

        # Get topic tags
        topic_ids = field_data.get('resource-topic-s', [])
        if isinstance(topic_ids, str):
            topic_ids = [topic_ids]
        topic_tags = [topic_map.get(tid, '') for tid in topic_ids if tid]
        topic_tags = [t for t in topic_tags if t]

        # Analyze with OpenAI
        analysis = {}
        if not args.skip_ai and body_content:
            analysis = analyze_resource(title, body_content, resource_type)

        # Build tags
        tags_list = topic_tags.copy()
        if analysis.get('auto_tags'):
            auto_tags = analysis['auto_tags']
            if isinstance(auto_tags, str):
                tags_list.extend([t.strip() for t in auto_tags.split(',')])
            elif isinstance(auto_tags, list):
                tags_list.extend(auto_tags)
        tags_list.append(resource_type.lower().replace(' ', '-'))
        tags = ', '.join(list(dict.fromkeys(tags_list)))  # Remove duplicates while preserving order

        # Prepare record
        resource_data = {
            'type': resource_type,
            'title': title,
            'live_link': live_link,
            'ungated_link': field_data.get('ungated-link') or field_data.get('download-link'),
            'platform': 'Website',
            'summary': meta_description or analysis.get('enhanced_summary', '')[:500],
            'tags': tags,
            'extracted_text': body_content[:5000] if body_content else None,
            'enhanced_summary': analysis.get('enhanced_summary'),
            'auto_tags': analysis.get('auto_tags') if isinstance(analysis.get('auto_tags'), str) else ', '.join(analysis.get('auto_tags', []))
        }

        if insert_resource(conn, resource_data):
            added += 1
            existing_titles.add(normalize_title(title))
            if live_link:
                existing_urls.add(normalize_url(live_link))
            print(f"    ✓ Added")
        else:
            errors += 1

        time.sleep(0.3)

    conn.close()

    print("\n" + "=" * 60)
    print("IMPORT SUMMARY")
    print("=" * 60)
    print(f"  Resources added:     {added}")
    print(f"  Skipped (duplicate): {skipped_duplicate}")
    if args.type:
        print(f"  Skipped (type):      {skipped_type}")
    print(f"  Errors:              {errors}")
    print("=" * 60)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Webflow CMS Content Enrichment Script

Pulls content from Webflow CMS and enriches Supabase records with:
- Full article text from Webflow
- Competitor comparison data
- Resource metadata

Usage:
    python enrich_from_webflow.py              # Pull all Webflow content
    python enrich_from_webflow.py --dry-run    # Preview what would be pulled
    python enrich_from_webflow.py --collection resources  # Pull specific collection

Prerequisites:
    - WEBFLOW_API_TOKEN in .env
    - WEBFLOW_SITE_ID in .env
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

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')
WEBFLOW_API_TOKEN = os.getenv('WEBFLOW_API_TOKEN')
WEBFLOW_SITE_ID = os.getenv('WEBFLOW_SITE_ID')

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


def get_db_connection():
    """Create database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def get_webflow_collections():
    """List all CMS collections in the Webflow site."""
    if not WEBFLOW_API_TOKEN or not WEBFLOW_SITE_ID:
        print("ERROR: Missing WEBFLOW_API_TOKEN or WEBFLOW_SITE_ID")
        return []

    headers = {
        'Authorization': f'Bearer {WEBFLOW_API_TOKEN}',
        'accept': 'application/json'
    }

    # Webflow API v2
    url = f'https://api.webflow.com/v2/sites/{WEBFLOW_SITE_ID}/collections'

    try:
        response = requests.get(url, headers=headers)
        response.raise_for_status()
        data = response.json()
        return data.get('collections', [])
    except Exception as e:
        print(f"Error fetching collections: {e}")
        return []


def get_collection_items(collection_id: str, limit: int = 100) -> List[Dict]:
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

            # Respect rate limits
            time.sleep(0.5)

            # Check if we've got all items
            if len(items) < limit:
                break

        except Exception as e:
            print(f"Error fetching items: {e}")
            break

    return all_items


def scrape_schoolinks_page(url: str) -> Optional[str]:
    """Scrape content from a SchooLinks webpage."""
    try:
        response = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Remove navigation, footer, scripts
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'noscript']):
            tag.decompose()

        # Try to find main content
        main_content = soup.find('main') or soup.find('article') or soup.find('div', class_=re.compile(r'content|article|post|resource'))

        if main_content:
            text = main_content.get_text(separator=' ', strip=True)
        else:
            text = soup.get_text(separator=' ', strip=True)

        # Clean up
        text = re.sub(r'\s+', ' ', text)
        return text[:15000] if text else None

    except Exception as e:
        print(f"  Error scraping {url}: {e}")
        return None


def analyze_content_with_openai(title: str, content: str, content_type: str) -> Dict[str, Any]:
    """Use OpenAI to analyze content and generate metadata."""
    if not openai_client or not content:
        return {}

    prompt = f"""Analyze this SchooLinks marketing content and generate search metadata.

CONTENT DETAILS:
- Title: {title}
- Type: {content_type}

CONTENT TEXT:
{content[:6000]}

GENERATE (respond in valid JSON only):
{{
  "enhanced_summary": "A 2-3 sentence summary of what this content covers. Be specific.",

  "auto_tags": "3-8 tags that are ACTUALLY in the content. Choose from: competitor names (Naviance, Xello, MajorClarity, PowerSchool, Scoir, LevelAll), personas (counselors, administrators, CTE coordinators, students, parents), topics (FAFSA, graduation, work-based learning, career exploration, college readiness, course planning), format (comparison, guide, tutorial, customer-story)",

  "competitors_mentioned": ["List only competitors actually named"],

  "key_topics": ["2-4 main topics covered"]
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
            max_tokens=800
        )

        content_str = response.choices[0].message.content
        json_match = re.search(r'\{[\s\S]*\}', content_str)
        if json_match:
            return json.loads(json_match.group())
        return {}

    except Exception as e:
        print(f"  OpenAI error: {e}")
        return {}


def update_supabase_record(conn, title_pattern: str, updates: Dict):
    """Update a Supabase record with enrichment data."""
    with conn.cursor() as cur:
        # Find matching record
        cur.execute("""
            SELECT id, title FROM marketing_content
            WHERE title ILIKE %s
            LIMIT 1
        """, (f'%{title_pattern}%',))

        record = cur.fetchone()
        if not record:
            return False

        # Update with enrichment
        update_parts = []
        values = []

        if updates.get('extracted_text'):
            update_parts.append("extracted_text = %s")
            values.append(updates['extracted_text'][:5000])

        if updates.get('enhanced_summary'):
            update_parts.append("enhanced_summary = %s")
            values.append(updates['enhanced_summary'])

        if updates.get('auto_tags'):
            update_parts.append("auto_tags = %s")
            values.append(updates['auto_tags'])
            # Also append to tags
            update_parts.append("tags = CASE WHEN tags IS NULL OR tags = '' THEN %s ELSE tags || ', ' || %s END")
            values.extend([updates['auto_tags'], updates['auto_tags']])

        update_parts.append("content_analyzed_at = %s")
        values.append(datetime.utcnow())

        update_parts.append("extraction_error = NULL")

        values.append(record['id'])

        cur.execute(f"""
            UPDATE marketing_content
            SET {', '.join(update_parts)}
            WHERE id = %s
        """, values)

        conn.commit()
        return True


def enrich_competitor_pages(conn, dry_run: bool = False):
    """Scrape and enrich competitor comparison pages."""
    competitor_pages = [
        ('https://www.schoolinks.com/competitors/schoolinks-vs-xello', 'Xello'),
        ('https://www.schoolinks.com/competitors/schoolinks-vs-naviance', 'Naviance'),
        ('https://www.schoolinks.com/competitors/schoolinks-vs-scoir', 'Scoir'),
    ]

    print("\n=== ENRICHING COMPETITOR PAGES ===")

    for url, competitor in competitor_pages:
        print(f"\nProcessing {competitor} comparison page...")

        if dry_run:
            print(f"  [DRY RUN] Would scrape: {url}")
            continue

        content = scrape_schoolinks_page(url)
        if not content:
            print(f"  ✗ Could not scrape {url}")
            continue

        print(f"  ✓ Scraped {len(content)} chars")

        # Analyze with OpenAI
        analysis = analyze_content_with_openai(
            f"SchooLinks vs {competitor} Comparison",
            content,
            "Landing Page"
        )

        # Try to update matching record
        updated = update_supabase_record(conn, f"vs {competitor}", {
            'extracted_text': content,
            'enhanced_summary': analysis.get('enhanced_summary'),
            'auto_tags': analysis.get('auto_tags') if isinstance(analysis.get('auto_tags'), str) else ', '.join(analysis.get('auto_tags', []))
        })

        if updated:
            print(f"  ✓ Updated Supabase record")
        else:
            print(f"  ⚠ No matching record found for {competitor}")

        time.sleep(1)  # Rate limit


def enrich_from_webflow(conn, collection_name: str = None, dry_run: bool = False):
    """Pull content from Webflow CMS and enrich Supabase."""
    print("\n=== WEBFLOW CMS ENRICHMENT ===")

    if not WEBFLOW_API_TOKEN or not WEBFLOW_SITE_ID:
        print("⚠ Webflow credentials not configured. Add to .env:")
        print("  WEBFLOW_API_TOKEN=your_token")
        print("  WEBFLOW_SITE_ID=your_site_id")
        return

    # Get collections
    collections = get_webflow_collections()
    if not collections:
        print("✗ No collections found")
        return

    print(f"Found {len(collections)} collections:")
    for c in collections:
        print(f"  - {c.get('displayName', c.get('name'))}: {c.get('id')}")

    # Process each collection (or specific one)
    for collection in collections:
        coll_name = collection.get('displayName', collection.get('name', ''))
        coll_id = collection.get('id')

        if collection_name and collection_name.lower() not in coll_name.lower():
            continue

        print(f"\nProcessing collection: {coll_name}")

        items = get_collection_items(coll_id)
        print(f"  Found {len(items)} items")

        if dry_run:
            for item in items[:5]:
                print(f"    - {item.get('fieldData', {}).get('name', item.get('id'))}")
            if len(items) > 5:
                print(f"    ... and {len(items) - 5} more")
            continue

        # Process items
        for item in items:
            field_data = item.get('fieldData', {})
            title = field_data.get('name') or field_data.get('title') or ''
            slug = field_data.get('slug', '')

            if not title:
                continue

            # Get rich text content if available
            content = field_data.get('body') or field_data.get('content') or field_data.get('post-body') or ''

            if content:
                # Strip HTML
                soup = BeautifulSoup(content, 'html.parser')
                content = soup.get_text(separator=' ', strip=True)

            if len(content) < 100:
                continue

            print(f"  Processing: {title[:50]}...")

            # Analyze
            analysis = analyze_content_with_openai(title, content, coll_name)

            # Update Supabase
            updated = update_supabase_record(conn, title[:30], {
                'extracted_text': content,
                'enhanced_summary': analysis.get('enhanced_summary'),
                'auto_tags': analysis.get('auto_tags') if isinstance(analysis.get('auto_tags'), str) else ', '.join(analysis.get('auto_tags', []))
            })

            if updated:
                print(f"    ✓ Updated")

            time.sleep(0.5)


def main():
    parser = argparse.ArgumentParser(description='Enrich content from Webflow CMS')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    parser.add_argument('--collection', type=str, help='Process specific collection only')
    parser.add_argument('--competitors-only', action='store_true', help='Only enrich competitor pages')
    args = parser.parse_args()

    print("=" * 60)
    print("Webflow CMS Content Enrichment")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    conn = get_db_connection()
    print("✓ Connected to database")

    # Enrich competitor comparison pages
    enrich_competitor_pages(conn, dry_run=args.dry_run)

    # Enrich from Webflow CMS
    if not args.competitors_only:
        enrich_from_webflow(conn, collection_name=args.collection, dry_run=args.dry_run)

    conn.close()
    print("\n✓ Enrichment complete")


if __name__ == '__main__':
    main()

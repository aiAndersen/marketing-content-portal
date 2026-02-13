#!/usr/bin/env python3
"""
Webflow Landing Pages Import & Enrichment Script

Pulls ALL landing pages from Webflow including:
- CMS State Pages (e.g., /state/texas, /state/california)
- Static landing pages (non-CMS pages)
- Competitor comparison pages
- Product feature pages

Avoids duplicates by checking existing live_links in the database.

Usage:
    python import_webflow_landing_pages.py              # Full import
    python import_webflow_landing_pages.py --dry-run    # Preview without making changes
    python import_webflow_landing_pages.py --states-only # Only state pages
    python import_webflow_landing_pages.py --static-only # Only static pages
"""

import os
import sys
import argparse
import json
import re
import time
from datetime import datetime
from typing import Optional, Dict, Any, List, Set
from urllib.parse import urlparse, urljoin

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

# SchooLinks base URL
SCHOOLINKS_BASE_URL = 'https://www.schoolinks.com'

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# US State mappings
STATE_ABBREV = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
    'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
    'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
    'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
    'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new-hampshire': 'NH', 'new-jersey': 'NJ',
    'new-mexico': 'NM', 'new-york': 'NY', 'north-carolina': 'NC', 'north-dakota': 'ND', 'ohio': 'OH',
    'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode-island': 'RI', 'south-carolina': 'SC',
    'south-dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
    'virginia': 'VA', 'washington': 'WA', 'west-virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY'
}


def get_db_connection():
    """Create database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def get_existing_urls(conn) -> Set[str]:
    """Get all existing live_links from the database to avoid duplicates."""
    with conn.cursor() as cur:
        cur.execute("SELECT live_link FROM marketing_content WHERE live_link IS NOT NULL")
        rows = cur.fetchall()
        # Normalize URLs for comparison
        urls = set()
        for row in rows:
            url = row['live_link'].lower().rstrip('/')
            urls.add(url)
            # Also add without www
            urls.add(url.replace('www.', ''))
        return urls


def normalize_url(url: str) -> str:
    """Normalize URL for comparison."""
    return url.lower().rstrip('/').replace('www.', '')


def get_webflow_collections() -> List[Dict]:
    """List all CMS collections in the Webflow site."""
    if not WEBFLOW_API_TOKEN or not WEBFLOW_SITE_ID:
        print("ERROR: Missing WEBFLOW_API_TOKEN or WEBFLOW_SITE_ID")
        return []

    headers = {
        'Authorization': f'Bearer {WEBFLOW_API_TOKEN}',
        'accept': 'application/json'
    }

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
            time.sleep(0.3)

            if len(items) < limit:
                break

        except Exception as e:
            print(f"Error fetching items: {e}")
            break

    return all_items


def get_webflow_pages() -> List[Dict]:
    """Get all static pages from Webflow using the Pages API."""
    if not WEBFLOW_API_TOKEN or not WEBFLOW_SITE_ID:
        return []

    headers = {
        'Authorization': f'Bearer {WEBFLOW_API_TOKEN}',
        'accept': 'application/json'
    }

    all_pages = []
    offset = 0
    limit = 100

    while True:
        url = f'https://api.webflow.com/v2/sites/{WEBFLOW_SITE_ID}/pages?limit={limit}&offset={offset}'

        try:
            response = requests.get(url, headers=headers)
            response.raise_for_status()
            data = response.json()
            pages = data.get('pages', [])

            if not pages:
                break

            all_pages.extend(pages)
            offset += limit
            time.sleep(0.3)

            if len(pages) < limit:
                break

        except Exception as e:
            print(f"Error fetching pages: {e}")
            break

    return all_pages


def scrape_page_content(url: str) -> Optional[Dict[str, str]]:
    """Scrape content from a webpage and extract metadata."""
    try:
        response = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        response.raise_for_status()

        soup = BeautifulSoup(response.text, 'html.parser')

        # Extract title
        title = None
        if soup.find('h1'):
            title = soup.find('h1').get_text(strip=True)
        elif soup.title:
            title = soup.title.get_text(strip=True)

        # Extract meta description
        meta_desc = None
        meta_tag = soup.find('meta', attrs={'name': 'description'})
        if meta_tag:
            meta_desc = meta_tag.get('content', '')

        # Remove navigation, footer, scripts
        for tag in soup(['script', 'style', 'nav', 'footer', 'header', 'noscript', 'iframe']):
            tag.decompose()

        # Find main content
        main_content = (
            soup.find('main') or
            soup.find('article') or
            soup.find('div', class_=re.compile(r'content|article|post|hero|section', re.I)) or
            soup.find('div', class_=re.compile(r'container', re.I))
        )

        if main_content:
            text = main_content.get_text(separator=' ', strip=True)
        else:
            text = soup.body.get_text(separator=' ', strip=True) if soup.body else ''

        # Clean up
        text = re.sub(r'\s+', ' ', text)

        return {
            'title': title,
            'meta_description': meta_desc,
            'content': text[:15000] if text else None
        }

    except Exception as e:
        print(f"  Error scraping {url}: {e}")
        return None


def analyze_landing_page(title: str, content: str, url: str) -> Dict[str, Any]:
    """Use OpenAI to analyze landing page and generate metadata."""
    if not openai_client or not content:
        return {}

    # Detect if it's a state page
    is_state_page = '/state/' in url.lower()
    state_slug = None
    if is_state_page:
        match = re.search(r'/state/([a-z-]+)', url.lower())
        if match:
            state_slug = match.group(1)

    prompt = f"""Analyze this SchooLinks landing page and generate search metadata.

PAGE DETAILS:
- Title: {title}
- URL: {url}
- Is State Page: {is_state_page}
{f'- State: {state_slug}' if state_slug else ''}

PAGE CONTENT:
{content[:6000]}

GENERATE (respond in valid JSON only):
{{
  "enhanced_summary": "A 2-3 sentence summary of what this landing page offers. Be specific about the value proposition.",

  "auto_tags": "5-10 relevant tags. Include: page type (landing-page, state-page, product-page, competitor-comparison), features mentioned (course-planning, college-readiness, career-exploration, work-based-learning, FAFSA, KRI, graduation-tracking), personas (counselors, administrators, students, parents, CTE-coordinators), and any state/region specifics",

  "key_topics": ["3-5 main topics or features highlighted on the page"],

  "target_persona": "Primary audience for this page (counselors, administrators, CTE coordinators, parents, students)",

  "content_type": "landing-page, state-page, product-page, competitor-comparison, or resource-page"
}}

IMPORTANT: Be specific to what's ACTUALLY on the page, not generic descriptions."""

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


def insert_landing_page(conn, page_data: Dict, dry_run: bool = False) -> bool:
    """Insert a new landing page into the database."""
    if dry_run:
        print(f"  [DRY RUN] Would insert: {page_data.get('title', 'Unknown')}")
        return True

    with conn.cursor() as cur:
        try:
            cur.execute("""
                INSERT INTO marketing_content (
                    type, title, live_link, platform, summary, state, tags,
                    extracted_text, enhanced_summary, auto_tags, content_analyzed_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                page_data.get('type', 'Landing Page'),
                page_data.get('title'),
                page_data.get('live_link'),
                page_data.get('platform', 'Website'),
                page_data.get('summary'),
                page_data.get('state'),
                page_data.get('tags'),
                page_data.get('extracted_text'),
                page_data.get('enhanced_summary'),
                page_data.get('auto_tags'),
                datetime.utcnow()
            ))
            conn.commit()
            return True
        except Exception as e:
            print(f"  Error inserting: {e}")
            conn.rollback()
            return False


def update_existing_record(conn, live_link: str, updates: Dict, dry_run: bool = False) -> bool:
    """Update an existing record with enrichment data."""
    if dry_run:
        print(f"  [DRY RUN] Would update existing record for: {live_link}")
        return True

    with conn.cursor() as cur:
        try:
            cur.execute("""
                UPDATE marketing_content
                SET extracted_text = COALESCE(%s, extracted_text),
                    enhanced_summary = COALESCE(%s, enhanced_summary),
                    auto_tags = COALESCE(%s, auto_tags),
                    content_analyzed_at = %s
                WHERE live_link ILIKE %s OR live_link ILIKE %s
            """, (
                updates.get('extracted_text'),
                updates.get('enhanced_summary'),
                updates.get('auto_tags'),
                datetime.utcnow(),
                live_link,
                live_link.replace('www.', '')
            ))
            conn.commit()
            return cur.rowcount > 0
        except Exception as e:
            print(f"  Error updating: {e}")
            conn.rollback()
            return False


def process_state_pages(conn, existing_urls: Set[str], dry_run: bool = False) -> int:
    """Find and process state pages from Webflow CMS."""
    print("\n=== PROCESSING STATE PAGES ===")

    collections = get_webflow_collections()
    state_collections = [c for c in collections if 'state' in c.get('displayName', '').lower() or 'state' in c.get('slug', '').lower()]

    if not state_collections:
        print("No state collections found. Trying to find state pages by URL pattern...")
        # Fall back to scraping known state page patterns
        return process_state_pages_by_scraping(conn, existing_urls, dry_run)

    processed = 0

    for collection in state_collections:
        coll_name = collection.get('displayName', collection.get('name', ''))
        coll_id = collection.get('id')
        print(f"\nProcessing collection: {coll_name}")

        items = get_collection_items(coll_id)
        print(f"  Found {len(items)} items")

        for item in items:
            field_data = item.get('fieldData', {})
            name = field_data.get('name') or field_data.get('title') or ''
            slug = field_data.get('slug', '')

            if not slug:
                continue

            # Build the URL
            url = f"{SCHOOLINKS_BASE_URL}/state/{slug}"

            # Check if already exists
            if normalize_url(url) in existing_urls:
                print(f"  ⏭ Skipping (exists): {name}")
                continue

            print(f"  Processing: {name}")

            # Scrape the page
            page_content = scrape_page_content(url)
            if not page_content:
                continue

            # Determine state abbreviation
            state_abbrev = STATE_ABBREV.get(slug.lower())

            # Analyze with OpenAI
            analysis = analyze_landing_page(
                page_content.get('title') or name,
                page_content.get('content', ''),
                url
            )

            # Build tags
            tags_list = []
            if analysis.get('auto_tags'):
                tags_list.append(analysis['auto_tags'] if isinstance(analysis['auto_tags'], str) else ', '.join(analysis['auto_tags']))
            tags_list.append('state-page')
            if state_abbrev:
                tags_list.append(state_abbrev.lower())

            # Insert new record
            page_data = {
                'type': 'Landing Page',
                'title': page_content.get('title') or name,
                'live_link': url,
                'platform': 'Website',
                'summary': page_content.get('meta_description') or analysis.get('enhanced_summary'),
                'state': state_abbrev,
                'tags': ', '.join(tags_list),
                'extracted_text': page_content.get('content', '')[:5000],
                'enhanced_summary': analysis.get('enhanced_summary'),
                'auto_tags': analysis.get('auto_tags') if isinstance(analysis.get('auto_tags'), str) else ', '.join(analysis.get('auto_tags', []))
            }

            if insert_landing_page(conn, page_data, dry_run):
                processed += 1
                print(f"    ✓ Added: {name} ({state_abbrev or 'Unknown state'})")
                existing_urls.add(normalize_url(url))

            time.sleep(0.5)

    return processed


def process_state_pages_by_scraping(conn, existing_urls: Set[str], dry_run: bool = False) -> int:
    """Discover state pages by checking known URL patterns."""
    print("\nDiscovering state pages by URL patterns...")

    processed = 0

    for state_name, state_abbrev in STATE_ABBREV.items():
        url = f"{SCHOOLINKS_BASE_URL}/state/{state_name}"

        # Check if already exists
        if normalize_url(url) in existing_urls:
            continue

        print(f"  Checking: {state_name.replace('-', ' ').title()}...")

        page_content = scrape_page_content(url)
        if not page_content or not page_content.get('content'):
            continue

        # Page exists! Analyze it
        print(f"    Found page for {state_name}")

        analysis = analyze_landing_page(
            page_content.get('title') or f"SchooLinks - {state_name.replace('-', ' ').title()}",
            page_content.get('content', ''),
            url
        )

        # Build tags
        tags = f"state-page, {state_abbrev.lower()}"
        if analysis.get('auto_tags'):
            auto_tags = analysis['auto_tags'] if isinstance(analysis['auto_tags'], str) else ', '.join(analysis['auto_tags'])
            tags = f"{auto_tags}, {tags}"

        page_data = {
            'type': 'Landing Page',
            'title': page_content.get('title') or f"SchooLinks - {state_name.replace('-', ' ').title()}",
            'live_link': url,
            'platform': 'Website',
            'summary': page_content.get('meta_description') or analysis.get('enhanced_summary'),
            'state': state_abbrev,
            'tags': tags,
            'extracted_text': page_content.get('content', '')[:5000],
            'enhanced_summary': analysis.get('enhanced_summary'),
            'auto_tags': analysis.get('auto_tags') if isinstance(analysis.get('auto_tags'), str) else ', '.join(analysis.get('auto_tags', []))
        }

        if insert_landing_page(conn, page_data, dry_run):
            processed += 1
            print(f"    ✓ Added: {state_name.replace('-', ' ').title()} ({state_abbrev})")
            existing_urls.add(normalize_url(url))

        time.sleep(0.5)

    return processed


def process_static_landing_pages(conn, existing_urls: Set[str], dry_run: bool = False) -> int:
    """Process non-CMS static landing pages from Webflow."""
    print("\n=== PROCESSING STATIC LANDING PAGES ===")

    # Known landing page URL patterns to look for
    landing_page_patterns = [
        '/platform', '/product', '/features', '/solutions', '/competitors',
        '/pricing', '/demo', '/about', '/contact', '/resources',
        '/counselors', '/administrators', '/districts', '/k-12',
        '/college-readiness', '/career-readiness', '/work-based-learning',
        '/course-planning', '/graduation-tracking', '/fafsa',
        '/why-schoolinks', '/higher-education', '/industry-partner',
        '/consolidate', '/welcome-kit', '/ambassadors', '/user-groups',
        '/college-deadlines', '/texas-ccmr', '/roi-cost', '/security',
        '/nsc-terms',
    ]

    # All known landing pages from the SchooLinks.com sitemap
    known_pages = [
        # Core pages
        '/why-schoolinks',
        '/platform',
        '/about',
        '/resources',
        '/higher-education',
        # Platform / feature pages
        '/platform/portrait-of-a-graduate',
        '/platform/course-planning',
        '/platform/college-application-manager',
        '/platform/student-experience-wbl',
        '/platform/district-experience-wbl',
        '/platform/alumni',
        '/platform/state-reporting-solutions',
        '/platform/agentic-ai-layer',
        # Competitor comparison pages
        '/competitors/schoolinks-vs-naviance',
        '/competitors/schoolinks-vs-xello',
        '/competitors/schoolinks-vs-scoir',
        '/competitors/schoolinks-vs-majorclarity',
        # Industry partner pages
        '/industry-partners',
        '/industry-partner-solutions',
        '/industry-partner-csr',
        '/industry-partner-sign-up',
        # Campaign / specialty pages
        '/welcome-kit',
        '/consolidate-save',
        '/college-deadlines',
        '/texas-ccmr-cte',
        '/ambassadors',
        '/user-groups',
        '/roi-cost-comparison-calculator',
        '/roi-cost-comparison-calculator-enhanced',
        # Security
        '/security',
    ]

    # Get pages from Webflow API
    api_pages = get_webflow_pages()
    print(f"Found {len(api_pages)} pages from Webflow API")

    processed = 0

    # Process API pages
    for page in api_pages:
        slug = page.get('slug', '')
        title = page.get('title', '')

        # Skip utility pages
        if slug in ['404', 'search', 'password', '401', 'utility']:
            continue

        # Build URL
        url = f"{SCHOOLINKS_BASE_URL}/{slug}" if slug else SCHOOLINKS_BASE_URL

        # Check if already exists
        if normalize_url(url) in existing_urls:
            continue

        # Check if it's a landing page type
        is_landing = slug and any(pattern.strip('/') in slug.lower() for pattern in landing_page_patterns)

        # Include home page and main sections
        if not is_landing and slug not in ['', 'home', None]:
            continue

        print(f"  Processing: {title or slug}")

        page_content = scrape_page_content(url)
        if not page_content or not page_content.get('content'):
            continue

        analysis = analyze_landing_page(
            page_content.get('title') or title,
            page_content.get('content', ''),
            url
        )

        tags = 'landing-page'
        if analysis.get('auto_tags'):
            auto_tags = analysis['auto_tags'] if isinstance(analysis['auto_tags'], str) else ', '.join(analysis['auto_tags'])
            tags = f"{auto_tags}, {tags}"

        page_data = {
            'type': 'Landing Page',
            'title': page_content.get('title') or title or slug.replace('-', ' ').title(),
            'live_link': url,
            'platform': 'Website',
            'summary': page_content.get('meta_description') or analysis.get('enhanced_summary'),
            'state': None,
            'tags': tags,
            'extracted_text': page_content.get('content', '')[:5000],
            'enhanced_summary': analysis.get('enhanced_summary'),
            'auto_tags': analysis.get('auto_tags') if isinstance(analysis.get('auto_tags'), str) else ', '.join(analysis.get('auto_tags', []))
        }

        if insert_landing_page(conn, page_data, dry_run):
            processed += 1
            print(f"    ✓ Added: {page_data['title']}")
            existing_urls.add(normalize_url(url))

        time.sleep(0.5)

    # Also check known pages that might not be in the API
    print("\n  Checking known page patterns...")
    for page_path in known_pages:
        url = f"{SCHOOLINKS_BASE_URL}{page_path}"

        if normalize_url(url) in existing_urls:
            continue

        page_content = scrape_page_content(url)
        if not page_content or not page_content.get('content'):
            continue

        print(f"  Processing: {page_path}")

        analysis = analyze_landing_page(
            page_content.get('title') or page_path.split('/')[-1].replace('-', ' ').title(),
            page_content.get('content', ''),
            url
        )

        # Determine type from URL
        content_type = 'Landing Page'
        if '/competitors/' in page_path:
            tags_extra = 'competitor-comparison'
        elif '/platform/' in page_path:
            tags_extra = 'platform-page, product-page'
        elif '/product/' in page_path:
            tags_extra = 'product-page'
        elif '/solutions/' in page_path:
            tags_extra = 'solutions-page'
        elif '/industry-partner' in page_path:
            tags_extra = 'industry-partner'
        elif '/roi-cost' in page_path:
            tags_extra = 'tool, roi-calculator'
        else:
            tags_extra = 'landing-page'

        tags = tags_extra
        if analysis.get('auto_tags'):
            auto_tags = analysis['auto_tags'] if isinstance(analysis['auto_tags'], str) else ', '.join(analysis['auto_tags'])
            tags = f"{auto_tags}, {tags}"

        page_data = {
            'type': content_type,
            'title': page_content.get('title') or page_path.split('/')[-1].replace('-', ' ').title(),
            'live_link': url,
            'platform': 'Website',
            'summary': page_content.get('meta_description') or analysis.get('enhanced_summary'),
            'state': None,
            'tags': tags,
            'extracted_text': page_content.get('content', '')[:5000],
            'enhanced_summary': analysis.get('enhanced_summary'),
            'auto_tags': analysis.get('auto_tags') if isinstance(analysis.get('auto_tags'), str) else ', '.join(analysis.get('auto_tags', []))
        }

        if insert_landing_page(conn, page_data, dry_run):
            processed += 1
            print(f"    ✓ Added: {page_data['title']}")
            existing_urls.add(normalize_url(url))

        time.sleep(0.5)

    return processed


def main():
    parser = argparse.ArgumentParser(description='Import landing pages from Webflow')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    parser.add_argument('--states-only', action='store_true', help='Only import state pages')
    parser.add_argument('--static-only', action='store_true', help='Only import static pages')
    args = parser.parse_args()

    print("=" * 60)
    print("Webflow Landing Pages Import & Enrichment")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    if not WEBFLOW_API_TOKEN or not WEBFLOW_SITE_ID:
        print("WARNING: Webflow credentials not configured.")
        print("Will use URL scraping method instead.")

    if not OPENAI_API_KEY:
        print("WARNING: OPENAI_API_KEY not set. Will skip content analysis.")

    conn = get_db_connection()
    print("✓ Connected to database")

    # Get existing URLs to avoid duplicates
    existing_urls = get_existing_urls(conn)
    print(f"✓ Found {len(existing_urls)} existing records")

    total_added = 0

    # Process state pages
    if not args.static_only:
        state_count = process_state_pages(conn, existing_urls, dry_run=args.dry_run)
        total_added += state_count
        print(f"\n  State pages added: {state_count}")

    # Process static landing pages
    if not args.states_only:
        static_count = process_static_landing_pages(conn, existing_urls, dry_run=args.dry_run)
        total_added += static_count
        print(f"\n  Static pages added: {static_count}")

    conn.close()

    print("\n" + "=" * 60)
    print(f"✓ Import complete. Total new pages added: {total_added}")
    print("=" * 60)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
sync_linkedin_posts.py — Sync SchooLinks LinkedIn company posts into marketing_content

Uses LinkedIn's internal Voyager API with a browser session cookie (li_at).
Posts are upserted into the marketing_content table as type='LinkedIn Post'.

Setup:
  1. Log into LinkedIn in Chrome
  2. DevTools → Application → Cookies → www.linkedin.com → copy li_at value
  3. Add to scripts/.env:  LINKEDIN_LI_AT=AQE...your_value

Usage:
    python3 scripts/sync_linkedin_posts.py                # sync last 7 days
    python3 scripts/sync_linkedin_posts.py --days 30      # sync last 30 days
    python3 scripts/sync_linkedin_posts.py --dry-run -v   # preview without writing
    python3 scripts/sync_linkedin_posts.py --limit 5 -v   # sync up to 5 posts
"""

import argparse
import json
import os
import re
import sys
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor
import requests
from dotenv import load_dotenv

# --------------------------------------------------------------------------- #
# Environment
# --------------------------------------------------------------------------- #
load_dotenv()
load_dotenv('.env.local', override=False)
load_dotenv('scripts/.env', override=False)
load_dotenv('frontend/.env', override=False)

DATABASE_URL = os.getenv('DATABASE_URL')
LI_AT = os.getenv('LINKEDIN_LI_AT')

COMPANY_ID = '3322464'
ORG_URN = f'urn:li:organization:{COMPANY_ID}'

# Voyager feed endpoint for organization posts
FEED_URL = (
    'https://www.linkedin.com/voyager/api/feed/updates'
    '?count=20'
    '&moduleKey=ORGANIZATION_MEMBER_FEED_DESKTOP'
    '&numComments=0'
    '&q=organizationMemberFeed'
    '&start={start}'
    f'&urn={ORG_URN}'
)


# --------------------------------------------------------------------------- #
# LinkedIn helpers
# --------------------------------------------------------------------------- #

def make_headers(li_at: str) -> dict:
    """Build Voyager API request headers using the li_at session cookie."""
    csrf = f'ajax:{uuid.uuid4().hex}'
    return {
        'User-Agent': (
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/120.0.0.0 Safari/537.36'
        ),
        'Accept': 'application/vnd.linkedin.normalized+json+2.1',
        'Accept-Language': 'en-US,en;q=0.9',
        'x-li-lang': 'en_US',
        'x-li-track': json.dumps({
            'clientVersion': '1.13.15',
            'mpVersion': '1.13.15',
            'osName': 'web',
            'timezoneOffset': -5,
            'deviceFormFactor': 'DESKTOP',
        }),
        'csrf-token': csrf,
        'Cookie': f'li_at={li_at}; JSESSIONID="{csrf}"',
        'Referer': 'https://www.linkedin.com/',
    }


def fetch_posts(li_at: str, start: int = 0, verbose: bool = False) -> list:
    """Fetch a page of company feed updates from the Voyager API."""
    url = FEED_URL.format(start=start)
    headers = make_headers(li_at)
    resp = requests.get(url, headers=headers, timeout=15)

    if resp.status_code == 401:
        print('ERROR: li_at cookie is invalid or expired. Get a fresh cookie from LinkedIn.', file=sys.stderr)
        sys.exit(1)
    if resp.status_code == 403:
        print('ERROR: Access denied (403). The li_at cookie may not have access to this page.', file=sys.stderr)
        sys.exit(1)
    if not resp.ok:
        print(f'ERROR: LinkedIn API returned {resp.status_code}: {resp.text[:200]}', file=sys.stderr)
        sys.exit(1)

    data = resp.json()

    if verbose:
        print(f'  Voyager response keys: {list(data.keys())}')

    # LinkedIn Voyager returns a normalized graph — elements are the top-level items
    elements = data.get('data', {}).get('elements', []) or data.get('elements', [])

    # Also check the 'included' array which contains the actual post objects
    included = data.get('included', [])
    if verbose:
        print(f'  elements: {len(elements)}, included: {len(included)}')

    return elements, included, data


def extract_text(commentary_obj) -> Optional[str]:
    """Extract plain text from a LinkedIn commentary object."""
    if not commentary_obj:
        return None
    if isinstance(commentary_obj, str):
        return commentary_obj
    # Nested text object
    text = commentary_obj.get('text', '')
    if isinstance(text, dict):
        return text.get('text', '')
    return text or None


def extract_image_url(content_obj, included: list) -> Optional[str]:
    """Try to extract a LinkedIn CDN image URL from post content."""
    if not content_obj:
        return None

    # Article posts often have a previewImageUrl directly
    if isinstance(content_obj, dict):
        # Direct image URL in articles
        preview = content_obj.get('previewImageUrl') or content_obj.get('thumbnailUrl')
        if preview and 'licdn.com' in preview:
            return preview

        # Article thumbnail
        article = content_obj.get('article') or content_obj.get('navigationContext', {})
        if article and isinstance(article, dict):
            thumb = article.get('previewImage') or article.get('thumbnail')
            if thumb and isinstance(thumb, dict):
                url = thumb.get('url') or thumb.get('rootUrl')
                if url and 'licdn.com' in url:
                    return url
            if isinstance(thumb, str) and 'licdn.com' in thumb:
                return thumb

    # Search included objects for images associated with this content
    for obj in included:
        obj_type = obj.get('$type', '')
        if 'Image' in obj_type or 'image' in obj_type:
            artifacts = obj.get('artifacts', [])
            if artifacts:
                # Pick the largest artifact
                best = max(artifacts, key=lambda a: a.get('width', 0) * a.get('height', 0), default=None)
                if best:
                    url = best.get('fileIdentifyingUrlPathSegment', '')
                    root = obj.get('rootUrl', '')
                    if root and url:
                        return f'{root}{url}'
            root = obj.get('rootUrl') or obj.get('url')
            if root and 'licdn.com' in root:
                return root

    return None


def build_post_url(share_urn: Optional[str]) -> Optional[str]:
    """Build the LinkedIn post URL from a share URN."""
    if not share_urn:
        return None
    # urn:li:share:1234567890 or urn:li:ugcPost:1234567890
    if share_urn.startswith('urn:li:'):
        return f'https://www.linkedin.com/feed/update/{share_urn}/'
    return None


def parse_elements(elements: list, included: list, cutoff_ts: int, verbose: bool) -> list:
    """
    Parse Voyager normalized elements into clean post dicts.
    Returns list of { title, summary, live_link, ungated_link, created_at, type, platform }
    """
    posts = []

    # Build a map of URN → object from included for quick lookup
    included_map = {}
    for obj in included:
        urn = obj.get('entityUrn') or obj.get('urn')
        if urn:
            included_map[urn] = obj

    for elem in elements:
        try:
            # The element may directly be an UpdateV2 or wrap one
            obj_type = elem.get('$type', '')

            # Get the share/post URN
            update_key = (
                elem.get('updateMetadata', {}).get('updateKey')
                or elem.get('entityUrn')
                or elem.get('urn')
            )

            # Published timestamp (milliseconds)
            created_time = (
                elem.get('created', {}).get('time')
                or elem.get('publishedAt')
                or elem.get('firstPublishedAt')
            )
            if not created_time:
                if verbose:
                    print(f'  Skipping element with no timestamp: {update_key}')
                continue

            if created_time < cutoff_ts:
                if verbose:
                    print(f'  Skipping old post (published {datetime.fromtimestamp(created_time/1000)})')
                continue

            # Commentary / text
            commentary = (
                elem.get('commentary')
                or elem.get('specificContent', {})
                    .get('com.linkedin.ugc.ShareContent', {})
                    .get('shareCommentary', {})
            )
            text = extract_text(commentary)
            if not text:
                if verbose:
                    print(f'  Skipping element with no text: {update_key}')
                continue

            # Content (for image extraction)
            content = (
                elem.get('content')
                or elem.get('specificContent', {})
                    .get('com.linkedin.ugc.ShareContent', {})
            )
            image_url = extract_image_url(content, list(included_map.values()))

            # Post URL
            post_url = build_post_url(update_key)
            if not post_url:
                if verbose:
                    print(f'  Skipping element with no URN: {elem.keys()}')
                continue

            # Title = first 120 chars of text
            title = text[:120].strip()
            if len(text) > 120:
                title = title.rstrip() + '…'

            published_dt = datetime.fromtimestamp(created_time / 1000, tz=timezone.utc)

            posts.append({
                'title': title,
                'summary': text,
                'live_link': post_url,
                'ungated_link': image_url,
                'created_at': published_dt.isoformat(),
                'type': 'LinkedIn Post',
                'platform': 'LinkedIn',
            })

        except Exception as e:
            if verbose:
                print(f'  Error parsing element: {e}')
            continue

    return posts


# --------------------------------------------------------------------------- #
# Database helpers
# --------------------------------------------------------------------------- #

def get_db_connection():
    if not DATABASE_URL:
        print('ERROR: DATABASE_URL not set.', file=sys.stderr)
        sys.exit(1)
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def post_exists(cur, live_link: str) -> bool:
    cur.execute('SELECT id FROM marketing_content WHERE live_link = %s', (live_link,))
    return cur.fetchone() is not None


def insert_post(cur, post: dict, verbose: bool) -> bool:
    sql = """
        INSERT INTO marketing_content
            (title, summary, live_link, ungated_link, created_at, type, platform)
        VALUES
            (%(title)s, %(summary)s, %(live_link)s, %(ungated_link)s,
             %(created_at)s::timestamptz, %(type)s, %(platform)s)
    """
    cur.execute(sql, post)
    if verbose:
        print(f'    Inserted: {post["title"][:60]}')
    return True


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    parser = argparse.ArgumentParser(description='Sync SchooLinks LinkedIn posts into marketing_content')
    parser.add_argument('--days', type=int, default=7, help='Sync posts from last N days (default: 7)')
    parser.add_argument('--limit', type=int, default=0, help='Max posts to process (0 = unlimited)')
    parser.add_argument('--dry-run', action='store_true', help='Print posts without writing to DB')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')
    args = parser.parse_args()

    # Validate env
    if not LI_AT:
        print(
            'ERROR: LINKEDIN_LI_AT not set.\n'
            '  1. Log into LinkedIn in Chrome\n'
            '  2. DevTools → Application → Cookies → www.linkedin.com\n'
            '  3. Copy li_at value → add to scripts/.env as LINKEDIN_LI_AT=...',
            file=sys.stderr,
        )
        sys.exit(1)

    cutoff_dt = datetime.now(tz=timezone.utc) - timedelta(days=args.days)
    cutoff_ts = int(cutoff_dt.timestamp() * 1000)

    print(f'Fetching SchooLinks LinkedIn posts from last {args.days} days...')
    if args.dry_run:
        print('DRY RUN — no DB writes')

    # Fetch posts (paginate if needed)
    all_posts = []
    start = 0
    while True:
        if args.verbose:
            print(f'  Fetching page start={start}...')
        elements, included, raw = fetch_posts(LI_AT, start=start, verbose=args.verbose)

        if not elements:
            if args.verbose:
                print('  No more elements.')
            break

        page_posts = parse_elements(elements, included, cutoff_ts, verbose=args.verbose)
        all_posts.extend(page_posts)

        if args.verbose:
            print(f'  Found {len(page_posts)} posts in this page, {len(all_posts)} total so far')

        # Stop if we got posts older than cutoff (they're sorted newest-first)
        if len(page_posts) < len(elements):
            break  # some elements were older than cutoff, we're done
        if args.limit and len(all_posts) >= args.limit:
            break

        # Check if there are more pages
        paging = raw.get('data', {}).get('paging') or raw.get('paging', {})
        total = paging.get('total', 0)
        if start + 20 >= total:
            break
        start += 20

    if args.limit:
        all_posts = all_posts[:args.limit]

    print(f'\nFound {len(all_posts)} LinkedIn posts in the last {args.days} days')

    if not all_posts:
        print('Nothing to sync.')
        return

    # Preview posts
    for i, post in enumerate(all_posts):
        print(f'\n[{i+1}] {post["title"]}')
        if args.verbose:
            print(f'     URL:   {post["live_link"]}')
            print(f'     Image: {post["ungated_link"]}')
            print(f'     Date:  {post["created_at"]}')

    if args.dry_run:
        print(f'\nDry run complete — {len(all_posts)} posts would be synced.')
        return

    # Write to DB
    conn = get_db_connection()
    try:
        with conn:
            with conn.cursor() as cur:
                inserted = 0
                skipped = 0
                for post in all_posts:
                    if post_exists(cur, post['live_link']):
                        if args.verbose:
                            print(f'  Already exists: {post["title"][:60]}')
                        skipped += 1
                    else:
                        insert_post(cur, post, verbose=args.verbose)
                        inserted += 1
        print(f'\nDone — {inserted} inserted, {skipped} already existed.')
    finally:
        conn.close()


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Fix Tag Format Script

Fixes 279 records where tags/auto_tags are stored in PostgreSQL array literal
format {counselors, "career exploration", eBook} instead of clean comma-separated
strings: counselors, career exploration, eBook

Usage:
    python scripts/fix_tag_format.py --dry-run    # Preview changes
    python scripts/fix_tag_format.py              # Apply fixes
"""

import os
import sys
import re
import argparse

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load environment variables from multiple locations
for env_path in ['.env', '.env.local', 'scripts/.env', 'frontend/.env']:
    load_dotenv(env_path)

DATABASE_URL = os.getenv('DATABASE_URL')


def clean_pg_array_tags(value: str) -> str:
    """Convert PostgreSQL array literal to clean comma-separated string.

    {counselors, "career exploration", eBook} -> counselors, career exploration, eBook
    {} -> None
    """
    if not value or value.strip() == '{}':
        return None

    # Remove outer braces
    inner = value.strip()
    if inner.startswith('{') and inner.endswith('}'):
        inner = inner[1:-1]

    # Parse the comma-separated values, respecting quoted strings
    tags = []
    current = ''
    in_quotes = False

    for char in inner:
        if char == '"':
            in_quotes = not in_quotes
        elif char == ',' and not in_quotes:
            tag = current.strip().strip('"').strip()
            if tag:
                tags.append(tag)
            current = ''
        else:
            current += char

    # Don't forget the last tag
    tag = current.strip().strip('"').strip()
    if tag:
        tags.append(tag)

    if not tags:
        return None

    return ', '.join(tags)


def main():
    parser = argparse.ArgumentParser(description='Fix PostgreSQL array tag format')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    args = parser.parse_args()

    print("=" * 60)
    print("Fix Tag Format: {array} -> comma-separated")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    cur = conn.cursor()

    # Find affected records
    cur.execute("""
        SELECT id, title, tags, auto_tags
        FROM marketing_content
        WHERE tags LIKE '{%%}' OR auto_tags LIKE '{%%}'
        ORDER BY title
    """)
    rows = cur.fetchall()

    print(f"\nFound {len(rows)} records with curly-brace tag format\n")

    if not rows:
        print("Nothing to fix!")
        conn.close()
        return

    fixed = 0
    for row in rows:
        title = row['title'][:55]
        old_tags = row['tags']
        old_auto = row['auto_tags']

        new_tags = clean_pg_array_tags(old_tags) if old_tags and old_tags.startswith('{') else old_tags
        new_auto = clean_pg_array_tags(old_auto) if old_auto and old_auto.startswith('{') else old_auto

        tags_changed = new_tags != old_tags
        auto_changed = new_auto != old_auto

        if not tags_changed and not auto_changed:
            continue

        if args.dry_run:
            print(f"  {title}")
            if tags_changed:
                print(f"    tags:      {old_tags[:60]}")
                print(f"           ->  {(new_tags or 'NULL')[:60]}")
            if auto_changed:
                print(f"    auto_tags: {old_auto[:60]}")
                print(f"           ->  {(new_auto or 'NULL')[:60]}")
        else:
            cur.execute("""
                UPDATE marketing_content
                SET tags = %s, auto_tags = %s
                WHERE id = %s
            """, (new_tags, new_auto, row['id']))

        fixed += 1

    if not args.dry_run:
        conn.commit()

    conn.close()

    action = "Would fix" if args.dry_run else "Fixed"
    print(f"\n{action} {fixed} records")
    if args.dry_run:
        print("Run without --dry-run to apply changes.")


if __name__ == '__main__':
    main()

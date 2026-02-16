#!/usr/bin/env python3
"""
Content Deduplication Detector

Scans marketing_content table for duplicate entries across sources using
fuzzy title and URL matching. Can report or interactively merge duplicates.

Usage:
    python scripts/dedup_content.py                    # Scan for duplicates
    python scripts/dedup_content.py --threshold 0.85   # Custom similarity threshold
    python scripts/dedup_content.py --output dupes.json
    python scripts/dedup_content.py --merge             # Interactive merge mode
    python scripts/dedup_content.py --dry-run -v
"""

import os
import sys
import json
import argparse
from datetime import datetime
from decimal import Decimal

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


def get_db_connection():
    """Create a database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def normalize_url(url):
    """Normalize URL for comparison."""
    if not url:
        return None
    url = url.strip().lower()
    # Remove trailing slashes, query params, fragments
    url = url.split('?')[0].split('#')[0].rstrip('/')
    # Remove http/https
    url = url.replace('https://', '').replace('http://', '')
    return url


def fuzzy_similarity(str1, str2):
    """Calculate fuzzy similarity between two strings using token overlap."""
    if not str1 or not str2:
        return 0.0

    # Simple token-based similarity (Jaccard)
    import re
    tokens1 = set(re.findall(r'\w+', str1.lower()))
    tokens2 = set(re.findall(r'\w+', str2.lower()))

    if not tokens1 or not tokens2:
        return 0.0

    intersection = len(tokens1 & tokens2)
    union = len(tokens1 | tokens2)

    return intersection / union if union > 0 else 0.0


def find_duplicates(conn, threshold=0.85, verbose=False):
    """Find potential duplicate content entries."""
    print("\n[1/2] Fetching all content...")

    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, title, type, platform, live_link, ungated_link,
                   tags, created_at, deep_enriched_at
            FROM marketing_content
            ORDER BY created_at DESC
        """)
        records = cur.fetchall()

    print(f"  Found {len(records)} records")

    print("\n[2/2] Scanning for duplicates...")
    duplicates = []
    checked = 0

    # Compare each pair
    for i, rec1 in enumerate(records):
        for rec2 in records[i+1:]:
            checked += 1
            if checked % 1000 == 0 and verbose:
                print(f"    Checked {checked} pairs...")

            # Check URL similarity
            url1 = normalize_url(rec1['live_link'] or rec1['ungated_link'])
            url2 = normalize_url(rec2['live_link'] or rec2['ungated_link'])

            url_match = url1 and url2 and url1 == url2

            # Check title similarity
            title_sim = fuzzy_similarity(rec1['title'], rec2['title'])

            # Consider duplicate if URL matches or title very similar
            if url_match or title_sim >= threshold:
                duplicates.append({
                    'id1': str(rec1['id']),
                    'id2': str(rec2['id']),
                    'title1': rec1['title'][:80],
                    'title2': rec2['title'][:80],
                    'platform1': rec1['platform'],
                    'platform2': rec2['platform'],
                    'url_match': url_match,
                    'title_similarity': round(title_sim, 2),
                    'created1': rec1['created_at'].isoformat() if rec1['created_at'] else None,
                    'created2': rec2['created_at'].isoformat() if rec2['created_at'] else None,
                    'enriched1': bool(rec1['deep_enriched_at']),
                    'enriched2': bool(rec2['deep_enriched_at']),
                })

    print(f"  Found {len(duplicates)} potential duplicates (threshold: {threshold})")
    return duplicates


def merge_duplicates_interactive(conn, duplicates, dry_run=False):
    """Interactively merge duplicate records."""
    print(f"\n{'='*60}")
    print(f"INTERACTIVE MERGE MODE")
    print(f"Found {len(duplicates)} duplicate pairs")
    print(f"{'='*60}\n")

    if dry_run:
        print("[DRY RUN] No changes will be made\n")

    merged_count = 0
    skipped_count = 0

    for i, dup in enumerate(duplicates, 1):
        print(f"\nDuplicate {i}/{len(duplicates)}:")
        print(f"  [1] {dup['title1']}")
        print(f"      ID: {dup['id1']}, Platform: {dup['platform1']}, Enriched: {dup['enriched1']}")
        print(f"  [2] {dup['title2']}")
        print(f"      ID: {dup['id2']}, Platform: {dup['platform2']}, Enriched: {dup['enriched2']}")
        print(f"  Similarity: Title={dup['title_similarity']}, URL_match={dup['url_match']}")

        # Auto-suggest: keep the enriched one, or the older one
        if dup['enriched1'] and not dup['enriched2']:
            suggestion = "1 (enriched)"
        elif dup['enriched2'] and not dup['enriched1']:
            suggestion = "2 (enriched)"
        elif dup['created1'] and dup['created2']:
            suggestion = "1 (older)" if dup['created1'] < dup['created2'] else "2 (older)"
        else:
            suggestion = "1"

        choice = input(f"  Keep which? [1/2/skip] (suggest: {suggestion}): ").strip().lower()

        if choice == 'skip' or choice == 's':
            skipped_count += 1
            continue
        elif choice not in ['1', '2']:
            print("  Invalid choice, skipping...")
            skipped_count += 1
            continue

        keep_id = dup['id1'] if choice == '1' else dup['id2']
        delete_id = dup['id2'] if choice == '1' else dup['id1']

        if dry_run:
            print(f"  [DRY RUN] Would delete {delete_id}, keep {keep_id}")
            merged_count += 1
        else:
            try:
                with conn.cursor() as cur:
                    cur.execute("DELETE FROM marketing_content WHERE id = %s", (delete_id,))
                conn.commit()
                print(f"  Deleted {delete_id}, kept {keep_id}")
                merged_count += 1
            except Exception as e:
                print(f"  ERROR: Could not delete {delete_id}: {e}")
                conn.rollback()

    print(f"\n{'='*60}")
    print(f"Merged: {merged_count}, Skipped: {skipped_count}")
    print(f"{'='*60}")

    return merged_count, skipped_count


def main():
    parser = argparse.ArgumentParser(description='Content deduplication detector')
    parser.add_argument('--threshold', type=float, default=0.85,
                        help='Similarity threshold for title matching (default: 0.85)')
    parser.add_argument('--merge', action='store_true',
                        help='Interactive merge mode (prompts for each duplicate)')
    parser.add_argument('--output', type=str, help='Output file for JSON report')
    parser.add_argument('--dry-run', action='store_true', help='Preview only')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')

    args = parser.parse_args()

    print("=" * 60)
    print("Content Deduplication Detector")
    print(f"Threshold: {args.threshold}")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    conn = get_db_connection()

    try:
        # Find duplicates
        duplicates = find_duplicates(conn, args.threshold, args.verbose)

        if not duplicates:
            print("\nNo duplicates found!")
            return

        # Merge mode
        if args.merge:
            merged, skipped = merge_duplicates_interactive(conn, duplicates, args.dry_run)
        else:
            print("\nTo merge duplicates, run with --merge flag")

        # Print summary
        if not args.merge:
            print(f"\nDuplicate Summary:")
            print(f"  Total pairs: {len(duplicates)}")
            by_platform = {}
            for dup in duplicates:
                key = f"{dup['platform1']} <-> {dup['platform2']}"
                by_platform[key] = by_platform.get(key, 0) + 1

            print(f"\n  By platform pairs:")
            for pair, count in sorted(by_platform.items(), key=lambda x: -x[1]):
                print(f"    {pair}: {count}")

        # Save report
        if args.output:
            report = {
                'agent': 'dedup-content',
                'version': '1.0.0',
                'timestamp': datetime.now().isoformat(),
                'threshold': args.threshold,
                'total_duplicates': len(duplicates),
                'duplicates': duplicates,
            }
            with open(args.output, 'w') as f:
                json.dump(report, f, indent=2, cls=DecimalEncoder)
            print(f"\n  Report saved to {args.output}")

    finally:
        conn.close()

    print("\nDone!")


if __name__ == '__main__':
    main()

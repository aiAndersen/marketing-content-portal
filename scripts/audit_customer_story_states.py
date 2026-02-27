#!/usr/bin/env python3
"""
Customer Story State Tag Auditor

Finds customer stories (and optionally other content types) that are missing
or have incorrect state/region tags. Detects state from title, summary, and
tags fields, then reports or applies fixes.

Usage:
    python scripts/audit_customer_story_states.py             # Dry-run report
    python scripts/audit_customer_story_states.py --apply     # Write fixes to DB
    python scripts/audit_customer_story_states.py --all-types # Check all content types
    python scripts/audit_customer_story_states.py --verbose   # Show full details
    python scripts/audit_customer_story_states.py --limit 20  # Limit records checked
"""

import os
import sys
import re
import argparse
from typing import Optional

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load environment variables (same multi-load pattern as other scripts)
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')

# All 50 US states: full name → 2-letter abbreviation
STATE_NAME_TO_CODE = {
    'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
    'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
    'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
    'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
    'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
    'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
    'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
    'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
    'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
    'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
    'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
    'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
    'wisconsin': 'WI', 'wyoming': 'WY',
}

# Reverse map: abbreviation → full name (for display)
STATE_CODE_TO_NAME = {v: k.title() for k, v in STATE_NAME_TO_CODE.items()}

# All valid 2-letter state codes
VALID_STATE_CODES = set(STATE_NAME_TO_CODE.values())

# State abbreviations that appear as standalone words in titles
# (used for regex word-boundary matching — avoids false positives like "IN" in "includes")
# Only include abbreviations that are unambiguous in education/marketing context
UNAMBIGUOUS_ABBREVS = {
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'WA', 'WV', 'WI', 'WY',
    # Excluded ambiguous ones: IN (in), OR (or), VA (va), WA (wa) — detected via full name instead
}


def get_db_connection():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def detect_state_from_text(text: str) -> list[str]:
    """
    Scan text for US state mentions. Returns list of unique state codes found.
    Checks full state names first (multi-word safe), then unambiguous abbreviations.
    """
    if not text:
        return []

    text_lower = text.lower()
    found = set()

    # Check full state names (sorted longest-first to handle "new york" before "york")
    for name, code in sorted(STATE_NAME_TO_CODE.items(), key=lambda x: -len(x[0])):
        if re.search(r'\b' + re.escape(name) + r'\b', text_lower):
            found.add(code)

    # Check unambiguous 2-letter abbreviations as standalone uppercase tokens
    for abbrev in UNAMBIGUOUS_ABBREVS:
        if re.search(r'\b' + abbrev + r'\b', text):  # case-sensitive for abbreviations
            found.add(abbrev)

    return sorted(found)


def get_missing_state_records(conn, content_types: list, limit: Optional[int]) -> list:
    """Fetch records that have no state tag or are tagged National."""
    type_placeholders = ','.join(['%s'] * len(content_types))
    query = f"""
        SELECT id, type, title, summary, tags, state, live_link, ungated_link, last_updated
        FROM marketing_content
        WHERE type IN ({type_placeholders})
          AND (state IS NULL OR state = '' OR state = 'National')
        ORDER BY last_updated DESC
    """
    params = list(content_types)
    if limit:
        query += " LIMIT %s"
        params.append(limit)

    with conn.cursor() as cur:
        cur.execute(query, params)
        return cur.fetchall()


def get_all_records(conn, content_types: list, limit: Optional[int]) -> list:
    """Fetch all records of given types (for full audit including existing state tags)."""
    type_placeholders = ','.join(['%s'] * len(content_types))
    query = f"""
        SELECT id, type, title, summary, tags, state, live_link, ungated_link, last_updated
        FROM marketing_content
        WHERE type IN ({type_placeholders})
        ORDER BY last_updated DESC
    """
    params = list(content_types)
    if limit:
        query += " LIMIT %s"
        params.append(limit)

    with conn.cursor() as cur:
        cur.execute(query, params)
        return cur.fetchall()


def analyze_record(record: dict) -> dict:
    """
    Determine the correct state for a record.
    Returns dict with: detected_states, recommendation, confidence, reason
    """
    combined = ' '.join(filter(None, [
        record.get('title') or '',
        record.get('summary') or '',
        record.get('tags') or '',
    ]))

    detected = detect_state_from_text(combined)
    current_state = record.get('state') or ''

    if not detected:
        return {
            'detected_states': [],
            'recommendation': None,
            'confidence': 'none',
            'reason': 'No state mention found in title, summary, or tags',
        }

    if len(detected) == 1:
        state = detected[0]
        if state == current_state:
            return {
                'detected_states': detected,
                'recommendation': None,
                'confidence': 'confirmed',
                'reason': f'Current state "{current_state}" matches detected state',
            }
        return {
            'detected_states': detected,
            'recommendation': state,
            'confidence': 'high',
            'reason': f'Single state detected: {STATE_CODE_TO_NAME.get(state, state)}',
        }

    # Multiple states — flag as ambiguous, don't auto-update
    return {
        'detected_states': detected,
        'recommendation': None,
        'confidence': 'ambiguous',
        'reason': f'Multiple states detected: {", ".join(detected)} — manual review needed',
    }


def apply_fix(conn, record_id: str, new_state: str, verbose: bool):
    """Update the state field for a single record."""
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE marketing_content SET state = %s WHERE id = %s",
            (new_state, record_id)
        )
    conn.commit()
    if verbose:
        print(f"      → Updated state to {new_state}")


def main():
    parser = argparse.ArgumentParser(description='Audit and fix missing state tags on content records')
    parser.add_argument('--apply', action='store_true', help='Write fixes to the database (default: dry-run)')
    parser.add_argument('--all-types', action='store_true', help='Check all content types, not just Customer Story')
    parser.add_argument('--full-audit', action='store_true', help='Check all records including those with existing state tags')
    parser.add_argument('--limit', type=int, help='Max records to check')
    parser.add_argument('--verbose', '-v', action='store_true', help='Show full details for each record')
    args = parser.parse_args()

    print("=" * 60)
    print("Customer Story State Tag Auditor")
    if not args.apply:
        print("MODE: Dry-run (use --apply to write changes)")
    else:
        print("MODE: APPLYING FIXES TO DATABASE")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    content_types = None
    if args.all_types:
        content_types = ['Customer Story', 'Video', 'Video Clip', '1-Pager', 'Webinar', 'eBook', 'Blog Post', 'Infographic', 'Case Study', 'White Paper']
    else:
        content_types = ['Customer Story']

    conn = get_db_connection()
    print(f"✓ Connected to database")
    print(f"  Checking types: {', '.join(content_types)}")

    if args.full_audit:
        records = get_all_records(conn, content_types, args.limit)
        print(f"  Mode: full audit (all records)")
    else:
        records = get_missing_state_records(conn, content_types, args.limit)
        print(f"  Mode: missing/National state only")

    print(f"  Found: {len(records)} records to check\n")

    if not records:
        print("Nothing to audit.")
        conn.close()
        return

    # Counters
    fixable = []
    ambiguous = []
    no_detection = []
    already_correct = []

    for record in records:
        result = analyze_record(record)
        title_preview = (record['title'] or '')[:60]
        current = record.get('state') or '(none)'

        if result['confidence'] == 'confirmed':
            already_correct.append(record)
            if args.verbose:
                print(f"  ✓ [{current}] {title_preview}")
            continue

        if result['confidence'] == 'high':
            fixable.append((record, result))
            marker = '→' if args.apply else '?'
            print(f"  {marker} [{current} → {result['recommendation']}] {title_preview}")
            if args.verbose:
                print(f"      Reason: {result['reason']}")
                print(f"      URL: {record.get('live_link') or record.get('ungated_link') or '(no url)'}")
            if args.apply:
                apply_fix(conn, record['id'], result['recommendation'], args.verbose)

        elif result['confidence'] == 'ambiguous':
            ambiguous.append((record, result))
            print(f"  ⚠ [AMBIGUOUS] {title_preview}")
            if args.verbose:
                print(f"      {result['reason']}")

        else:  # 'none'
            no_detection.append(record)
            if args.verbose:
                print(f"  ✗ [NO MATCH] {title_preview}")
                print(f"      {result['reason']}")

    # Summary
    print("\n" + "=" * 60)
    print("AUDIT SUMMARY")
    print("=" * 60)
    print(f"  Total checked:       {len(records)}")
    if args.full_audit:
        print(f"  Already correct:     {len(already_correct)}")
    print(f"  Fixable (1 state):   {len(fixable)}")
    print(f"  Ambiguous (multi):   {len(ambiguous)}")
    print(f"  No state detected:   {len(no_detection)}")

    if args.apply:
        print(f"\n  ✓ Applied {len(fixable)} state tag fixes to database")
    elif fixable:
        print(f"\n  Run with --apply to write {len(fixable)} fix(es) to the database")

    if ambiguous:
        print(f"\n  Ambiguous records (manual review needed):")
        for record, result in ambiguous:
            print(f"    • {(record['title'] or '')[:70]}")
            print(f"      States found: {', '.join(result['detected_states'])}")

    if no_detection and args.verbose:
        print(f"\n  Records with no state detected (may need manual tagging):")
        for record in no_detection[:10]:
            print(f"    • [{record.get('state') or 'none'}] {(record['title'] or '')[:70]}")

    conn.close()


if __name__ == '__main__':
    main()

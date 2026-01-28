#!/usr/bin/env python3
"""
Video State & Tag Enrichment Script

Uses AI to analyze video content and infer:
- State/territory from title, tags, and transcript
- Better tags based on SchooLinks context
- Competitor mentions

For videos without transcripts, uses title + existing metadata.
For videos with transcripts, extracts state mentions and topics.

Usage:
    python enrich_video_states.py              # Enrich all videos missing state
    python enrich_video_states.py --dry-run    # Preview without changes
    python enrich_video_states.py --limit 10   # Process only 10 records
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
from openai import OpenAI

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# SchooLinks context for AI reasoning
SCHOOLINKS_CONTEXT = """
SCHOOLINKS OVERVIEW:
SchooLinks is a K-12 college & career readiness (CCR) platform. Marketing content often features:
- Customer stories from specific school districts (usually mention state/location)
- Competitor comparisons (Naviance, Xello, MajorClarity, Scoir, PowerSchool)
- Feature demos (WBL, FAFSA, graduation tracking, course planning)
- Testimonials from counselors, admins, CTE coordinators

STATE IDENTIFICATION CLUES:
- School district names often include city/region (e.g., "Sarasota County" = FL, "Round Rock ISD" = TX)
- State abbreviations in titles or tags
- City names (Austin=TX, Portland=OR, Boston=MA, Orlando=FL)
- "ISD" suffix common in Texas
- "Parish" indicates Louisiana
- Regional references (Northeast, Southwest, etc.)

COMPETITOR KEYWORDS:
- Xello: career exploration competitor
- Naviance: legacy CCR platform (PowerSchool)
- Scoir: college application focused
- MajorClarity: CCR competitor
- PowerSchool: parent company of Naviance

TAG CATEGORIES (only use if actually present):
- Competitors: Xello, Naviance, Scoir, MajorClarity, PowerSchool
- Personas: counselors, administrators, CTE coordinators, students, parents
- Topics: FAFSA, graduation, WBL, career exploration, college readiness, course planning
- Format: testimonial, demo, tutorial, customer-story, comparison
"""

# US State mappings for extraction
STATE_MAPPINGS = {
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
    'wisconsin': 'WI', 'wyoming': 'WY', 'district of columbia': 'DC'
}

# Known city to state mappings for common references
CITY_STATE_MAPPINGS = {
    'austin': 'TX', 'houston': 'TX', 'dallas': 'TX', 'san antonio': 'TX', 'round rock': 'TX',
    'los angeles': 'CA', 'san francisco': 'CA', 'san diego': 'CA', 'sacramento': 'CA',
    'new york': 'NY', 'brooklyn': 'NY', 'buffalo': 'NY',
    'chicago': 'IL', 'springfield': 'IL',
    'miami': 'FL', 'orlando': 'FL', 'tampa': 'FL', 'jacksonville': 'FL', 'sarasota': 'FL',
    'atlanta': 'GA', 'savannah': 'GA',
    'portland': 'OR', 'eugene': 'OR', 'bend': 'OR',
    'seattle': 'WA', 'spokane': 'WA',
    'boston': 'MA', 'cambridge': 'MA',
    'phoenix': 'AZ', 'tucson': 'AZ', 'mesa': 'AZ',
    'denver': 'CO', 'colorado springs': 'CO',
    'las vegas': 'NV', 'reno': 'NV',
    'nashville': 'TN', 'memphis': 'TN',
    'charlotte': 'NC', 'raleigh': 'NC',
    'indianapolis': 'IN', 'fort wayne': 'IN',
    'columbus': 'OH', 'cleveland': 'OH', 'cincinnati': 'OH',
    'detroit': 'MI', 'grand rapids': 'MI',
    'minneapolis': 'MN', 'st paul': 'MN',
    'new orleans': 'LA', 'baton rouge': 'LA',
    'bow': 'NH',  # Bow High School is in NH
    'pomperaug': 'CT',  # Pomperaug Regional in CT
    'wilder': 'ID',  # Wilder School District in ID
}


def get_db_connection():
    """Create database connection with retry."""
    for attempt in range(3):
        try:
            return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
        except Exception as e:
            if attempt < 2:
                time.sleep(1)
            else:
                raise e


def extract_state_from_text(text: str) -> Optional[str]:
    """Try to extract state from text using pattern matching."""
    if not text:
        return None

    text_lower = text.lower()

    # Check for state abbreviations (2 capital letters)
    abbrev_match = re.search(r'\b([A-Z]{2})\b', text)
    if abbrev_match:
        abbrev = abbrev_match.group(1)
        if abbrev in STATE_MAPPINGS.values():
            return abbrev

    # Check for full state names
    for state_name, abbrev in STATE_MAPPINGS.items():
        if state_name in text_lower:
            return abbrev

    # Check for known cities
    for city, state in CITY_STATE_MAPPINGS.items():
        if city in text_lower:
            return state

    # Check for Texas ISD pattern
    if ' isd' in text_lower or 'independent school district' in text_lower:
        return 'TX'  # ISDs are primarily Texas

    # Check for Louisiana parish
    if 'parish' in text_lower:
        return 'LA'

    return None


def analyze_video_with_ai(record: Dict) -> Dict[str, Any]:
    """Use AI to analyze video and extract state + improved tags."""
    if not openai_client:
        return {'error': 'No OpenAI client'}

    title = record.get('title', '')
    existing_tags = record.get('tags', '') or ''
    auto_tags = record.get('auto_tags', '') or ''
    summary = record.get('summary', '') or ''
    enhanced_summary = record.get('enhanced_summary', '') or ''
    extracted_text = record.get('extracted_text', '') or ''
    content_type = record.get('type', 'Video')
    current_state = record.get('state', '')

    # Build context from available data
    has_transcript = len(extracted_text) > 100

    prompt = f"""{SCHOOLINKS_CONTEXT}

ANALYZE THIS VIDEO CONTENT:
- Title: {title}
- Type: {content_type}
- Current State: {current_state or 'Not set'}
- Existing Tags: {existing_tags}
- Auto Tags: {auto_tags}
- Summary: {summary[:500] if summary else 'None'}
- Enhanced Summary: {enhanced_summary[:500] if enhanced_summary else 'None'}
{'- Transcript excerpt: ' + extracted_text[:2000] if has_transcript else '- No transcript available'}

TASK: Analyze this video and determine:

1. STATE: Based on the title, tags, summary, and transcript, what US state is this content about?
   - Look for school district names, city names, state references
   - If it's a general/national video with no state focus, return null
   - Return the 2-letter state abbreviation (TX, CA, FL, etc.)

2. IMPROVED TAGS: Based on SchooLinks context, what tags should this video have?
   - Only include tags that are ACTUALLY evident from the content
   - Include competitor names if mentioned (Xello, Naviance, etc.)
   - Include personas if addressed (counselors, students, etc.)
   - Include topics if covered (FAFSA, WBL, graduation, etc.)
   - Include format (testimonial, demo, comparison, etc.)

Respond with ONLY valid JSON:
{{
  "inferred_state": "XX" or null,
  "state_reasoning": "Brief explanation of why this state was inferred",
  "improved_tags": ["tag1", "tag2", ...],
  "competitors_mentioned": ["competitor1", ...] or [],
  "is_customer_story": true/false,
  "confidence": "high" | "medium" | "low"
}}"""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a marketing content analyst for SchooLinks. Analyze video content to extract state information and improve tagging. Always respond with valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=800
        )

        content = response.choices[0].message.content
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json.loads(json_match.group())
        return {'error': 'Could not parse JSON response'}

    except Exception as e:
        return {'error': str(e)}


def update_video_record(conn, record_id: int, state: str, new_tags: List[str], analysis: Dict):
    """Update video record with inferred state and improved tags."""
    with conn.cursor() as cur:
        updates = []
        values = []

        # Update state if inferred and not already set
        if state:
            updates.append("state = %s")
            values.append(state)

        # Update tags if improved
        if new_tags:
            tags_str = ', '.join(new_tags)
            updates.append("auto_tags = %s")
            values.append(tags_str)

        # Mark as analyzed
        updates.append("content_analyzed_at = %s")
        values.append(datetime.utcnow())

        if updates:
            values.append(record_id)
            cur.execute(f"""
                UPDATE marketing_content
                SET {', '.join(updates)}
                WHERE id = %s
            """, values)
            conn.commit()
            return True

    return False


def main():
    parser = argparse.ArgumentParser(description='Enrich video content with state and tags')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of records to process')
    parser.add_argument('--all', action='store_true', help='Process all videos, not just those missing state')
    args = parser.parse_args()

    print("=" * 60)
    print("Video State & Tag Enrichment")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY not set")
        sys.exit(1)

    conn = get_db_connection()
    print("✓ Connected to database")

    # Get videos to process
    with conn.cursor() as cur:
        if args.all:
            # Process all videos
            query = """
                SELECT * FROM marketing_content
                WHERE type IN ('Video', 'Video Clip')
                ORDER BY last_updated DESC
            """
        else:
            # Only videos missing state
            query = """
                SELECT * FROM marketing_content
                WHERE type IN ('Video', 'Video Clip')
                  AND (state IS NULL OR state = '')
                ORDER BY last_updated DESC
            """

        if args.limit > 0:
            query += f" LIMIT {args.limit}"

        cur.execute(query)
        videos = cur.fetchall()

    print(f"Found {len(videos)} videos to process")

    if not videos:
        print("No videos need processing")
        conn.close()
        return

    # Process each video
    updated = 0
    skipped = 0
    errors = 0

    for i, video in enumerate(videos, 1):
        title = video['title'][:50]
        print(f"\n[{i}/{len(videos)}] {title}...")

        # First try simple pattern matching
        text_to_check = f"{video['title']} {video.get('tags', '')} {video.get('summary', '')}"
        simple_state = extract_state_from_text(text_to_check)

        if simple_state and not args.all:
            # Use pattern match for state
            print(f"  → Pattern match: {simple_state}")
            if not args.dry_run:
                update_video_record(conn, video['id'], simple_state, [], {})
            updated += 1
            continue

        # Use AI for more complex analysis
        analysis = analyze_video_with_ai(video)

        if 'error' in analysis:
            print(f"  ✗ AI error: {analysis['error']}")
            errors += 1
            continue

        inferred_state = analysis.get('inferred_state')
        improved_tags = analysis.get('improved_tags', [])
        confidence = analysis.get('confidence', 'low')
        reasoning = analysis.get('state_reasoning', '')

        print(f"  → AI inferred: state={inferred_state} ({confidence}), tags={len(improved_tags)}")
        if reasoning:
            print(f"    Reasoning: {reasoning[:80]}...")

        if inferred_state or improved_tags:
            if not args.dry_run:
                update_video_record(conn, video['id'], inferred_state, improved_tags, analysis)
            updated += 1
        else:
            skipped += 1

        # Rate limit
        time.sleep(0.3)

    conn.close()

    print("\n" + "=" * 60)
    print("ENRICHMENT COMPLETE")
    print(f"  Updated: {updated}")
    print(f"  Skipped: {skipped}")
    print(f"  Errors: {errors}")
    if args.dry_run:
        print("  (DRY RUN - no changes made)")


if __name__ == '__main__':
    main()

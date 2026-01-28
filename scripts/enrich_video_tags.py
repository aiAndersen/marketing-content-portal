#!/usr/bin/env python3
"""
Video Tag Enrichment Script

For videos WITHOUT transcripts, uses AI to analyze titles and generate:
- Better tags based on SchooLinks context
- Competitor mentions
- Persona targeting
- Topic identification

Usage:
    python enrich_video_tags.py              # Enrich videos without transcripts
    python enrich_video_tags.py --dry-run    # Preview without changes
    python enrich_video_tags.py --limit 20   # Process only 20 records
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

# SchooLinks context
SCHOOLINKS_CONTEXT = """
SCHOOLINKS OVERVIEW:
SchooLinks is a K-12 college & career readiness (CCR) platform that helps districts with:
- Graduation tracking and compliance
- College and career planning
- Work-based learning (WBL) program management
- FAFSA completion tracking
- Student engagement and gamification

COMPETITOR KEYWORDS (tag ONLY if explicitly mentioned):
- Xello: career exploration competitor
- Naviance: legacy CCR platform (PowerSchool owns it)
- Scoir: college application focused
- MajorClarity: CCR competitor
- AzCIS: Arizona state CCR system
- PowerSchool: SIS vendor, owns Naviance

PERSONA KEYWORDS:
- counselors/counselor: School counselors
- administrators/admin: District or school admin
- CTE: Career Technical Education
- WBL: Work-based learning coordinators
- students: Student-facing content
- parents: Parent-facing content

TOPIC KEYWORDS:
- FAFSA: Financial aid
- graduation/graduation tracking: Graduation requirements
- WBL/work-based learning/internships: Work experience programs
- career exploration: Career discovery tools
- college readiness/college planning: College prep
- course planning/course planner: Academic scheduling
- compliance/indicators/KRI: State reporting requirements
- engagement: Student platform usage

FORMAT KEYWORDS:
- testimonial/customer story: District success story
- demo: Product demonstration
- comparison/vs: Competitive content
- overview: General feature tour
"""


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


def analyze_title_with_ai(title: str, content_type: str, existing_tags: str = '') -> Dict[str, Any]:
    """Use AI to analyze video title and generate appropriate tags."""
    if not openai_client:
        return {'error': 'No OpenAI client'}

    prompt = f"""{SCHOOLINKS_CONTEXT}

ANALYZE THIS VIDEO TITLE:
Title: "{title}"
Type: {content_type}
Existing Tags: {existing_tags or 'None'}

Based on the title, determine what this video is about and generate appropriate tags.

RULES:
1. Only tag competitors (Xello, Naviance, etc.) if EXPLICITLY mentioned in title
2. Identify the target persona if clear (counselors, students, parents, admin, CTE)
3. Identify the main topic (FAFSA, WBL, graduation, career exploration, etc.)
4. Identify the format (testimonial, demo, comparison, overview)
5. Look for state/district clues (school district names, state abbreviations)
6. Be SELECTIVE - only include tags that are clearly relevant

Respond with ONLY valid JSON:
{{
  "auto_tags": ["tag1", "tag2", ...],
  "competitors_mentioned": ["competitor1", ...] or [],
  "personas": ["persona1", ...] or [],
  "topics": ["topic1", ...] or [],
  "format": "testimonial" | "demo" | "comparison" | "overview" | "general",
  "is_customer_story": true/false,
  "reasoning": "Brief explanation"
}}"""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a marketing content analyst for SchooLinks. Analyze video titles and generate appropriate tags. Be selective and accurate. Always respond with valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=500
        )

        content = response.choices[0].message.content
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json.loads(json_match.group())
        return {'error': 'Could not parse JSON response'}

    except Exception as e:
        return {'error': str(e)}


def update_video_tags(conn, record_id: int, analysis: Dict):
    """Update video record with new tags."""
    auto_tags = analysis.get('auto_tags', [])

    if not auto_tags:
        return False

    # Build tag string
    tags_str = ', '.join(auto_tags)

    with conn.cursor() as cur:
        cur.execute("""
            UPDATE marketing_content
            SET auto_tags = COALESCE(auto_tags, '') ||
                CASE WHEN COALESCE(auto_tags, '') = '' THEN %s
                     ELSE ', ' || %s END,
                content_analyzed_at = %s
            WHERE id = %s
        """, (tags_str, tags_str, datetime.utcnow(), record_id))
        conn.commit()
        return True

    return False


def main():
    parser = argparse.ArgumentParser(description='Enrich video tags from titles')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of records to process')
    parser.add_argument('--all', action='store_true', help='Process all videos without transcripts')
    args = parser.parse_args()

    print("=" * 60)
    print("Video Tag Enrichment (Title Analysis)")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY not set")
        sys.exit(1)

    conn = get_db_connection()
    print("✓ Connected to database")

    # Get videos without transcripts that need better tagging
    with conn.cursor() as cur:
        query = """
            SELECT id, title, type, tags, auto_tags, state
            FROM marketing_content
            WHERE (type = 'Video' OR type = 'Video Clip')
              AND (extracted_text IS NULL OR LENGTH(extracted_text) < 100)
              AND (auto_tags IS NULL OR LENGTH(auto_tags) < 10)
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

        analysis = analyze_title_with_ai(
            video['title'],
            video['type'],
            video.get('tags', '')
        )

        if 'error' in analysis:
            print(f"  ✗ AI error: {analysis['error']}")
            errors += 1
            continue

        auto_tags = analysis.get('auto_tags', [])
        competitors = analysis.get('competitors_mentioned', [])
        format_type = analysis.get('format', 'general')
        reasoning = analysis.get('reasoning', '')[:60]

        if auto_tags:
            print(f"  → Tags: {', '.join(auto_tags[:5])}{'...' if len(auto_tags) > 5 else ''}")
            if competitors:
                print(f"    Competitors: {', '.join(competitors)}")
            print(f"    Format: {format_type} | {reasoning}")

            if not args.dry_run:
                update_video_tags(conn, video['id'], analysis)
            updated += 1
        else:
            print(f"  → No tags generated")
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

#!/usr/bin/env python3
"""
YouTube Content Enrichment Script

Specifically targets YouTube videos, extracts transcripts, and generates
tags/summaries using OpenAI.

Usage:
    python enrich_youtube.py           # Process all unenriched YouTube content
    python enrich_youtube.py --limit 10  # Process only 10 videos
    python enrich_youtube.py --force    # Re-process already enriched videos
"""

import os
import sys
import argparse
import json
import re
import time
from datetime import datetime
from typing import Optional, Dict, Any, List
from urllib.parse import urlparse, parse_qs

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from openai import OpenAI

# Import YouTube transcript API at module level
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import (
        TranscriptsDisabled,
        NoTranscriptFound,
        VideoUnavailable,
        CouldNotRetrieveTranscript
    )
    YOUTUBE_API_AVAILABLE = True
except ImportError:
    YOUTUBE_API_AVAILABLE = False

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


def get_db_connection():
    """Create database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def extract_video_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from various URL formats."""
    if not url:
        return None

    try:
        parsed = urlparse(url)

        # youtube.com/watch?v=VIDEO_ID
        if 'youtube.com' in parsed.netloc:
            if '/watch' in parsed.path:
                query = parse_qs(parsed.query)
                return query.get('v', [None])[0]
            # youtube.com/shorts/VIDEO_ID
            elif '/shorts/' in parsed.path:
                return parsed.path.split('/shorts/')[-1].split('/')[0].split('?')[0]
            # youtube.com/embed/VIDEO_ID
            elif '/embed/' in parsed.path:
                return parsed.path.split('/embed/')[-1].split('/')[0].split('?')[0]

        # youtu.be/VIDEO_ID
        elif 'youtu.be' in parsed.netloc:
            return parsed.path.strip('/').split('?')[0]

        return None
    except Exception:
        return None


def get_youtube_transcript(video_id: str) -> Optional[str]:
    """Get transcript from YouTube video."""
    if not YOUTUBE_API_AVAILABLE:
        print("      YouTube transcript API not installed")
        return None

    try:
        api = YouTubeTranscriptApi()

        # Try to get transcript in English first
        try:
            transcript = api.fetch(video_id, languages=['en', 'en-US', 'en-GB'])
        except NoTranscriptFound:
            # Try to get any available transcript and translate
            try:
                transcript_list = api.list(video_id)
                available = transcript_list.find_transcript(['en', 'en-US', 'en-GB'])
                transcript = available.fetch()
            except NoTranscriptFound:
                return None

        # Combine transcript entries - new API returns FetchedTranscriptSnippet objects
        full_text = ' '.join([entry.text for entry in transcript])

        # Clean up the text
        full_text = re.sub(r'\[.*?\]', '', full_text)  # Remove [Music], [Applause], etc.
        full_text = re.sub(r'\s+', ' ', full_text).strip()

        return full_text[:15000] if full_text else None  # Limit to 15k chars

    except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable, CouldNotRetrieveTranscript):
        return None
    except Exception as e:
        print(f"      Transcript error: {type(e).__name__}: {e}")
        return None


def analyze_transcript_with_openai(
    title: str,
    content_type: str,
    transcript: str,
    state: str,
    existing_tags: str
) -> Dict[str, Any]:
    """Use OpenAI to analyze transcript and generate metadata."""

    if not openai_client:
        return {'error': 'OpenAI client not configured'}

    prompt = f"""Analyze this SchooLinks marketing video transcript and generate search metadata.

VIDEO DETAILS:
- Title: {title}
- Content Type: {content_type}
- State: {state or 'National/Unknown'}
- Existing Tags: {existing_tags or 'None'}

TRANSCRIPT:
{transcript[:6000]}

GENERATE (respond in valid JSON only):

{{
  "enhanced_summary": "A 2-3 sentence summary of what this video covers. Be specific about topics, features, or customer stories mentioned.",

  "auto_tags": "ONLY include tags that are ACTUALLY discussed in the transcript. Do NOT list tags just because they're possible categories. Be selective - typically 3-8 tags maximum. Choose from these categories ONLY if they appear in the content: competitor names if mentioned (Naviance, Xello, MajorClarity, PowerSchool, Scoir), specific personas if addressed (counselors, administrators, CTE coordinators, students, parents), specific topics if covered (FAFSA, graduation, work-based learning, career exploration, college readiness, course planning), content format (testimonial, demo, tutorial, customer-story)",

  "competitors_mentioned": ["ONLY list competitors actually named in transcript, empty array if none"],

  "key_topics": ["2-4 main topics actually covered"],

  "is_short_form": true/false (true if under 60 seconds or clearly a short clip/highlight)
}}

IMPORTANT: Be highly selective with tags. Only include what is ACTUALLY in the content. Do not pad with generic tags."""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a marketing content analyst for SchooLinks. Extract structured metadata from video transcripts for search optimization. Always respond with valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=800
        )

        content = response.choices[0].message.content
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json.loads(json_match.group())
        return {'error': 'Could not parse JSON response'}

    except Exception as e:
        return {'error': str(e)}


def process_youtube_record(conn, record: Dict, index: int, total: int) -> bool:
    """Process a single YouTube record."""
    record_id = record['id']
    title = record['title']
    url = record.get('live_link') or record.get('ungated_link')

    print(f"\n[{index}/{total}] {title[:50]}...")

    # Extract video ID
    video_id = extract_video_id(url)
    if not video_id:
        print(f"    ✗ Could not extract video ID from: {url[:60]}...")
        return False

    print(f"    Video ID: {video_id}")

    # Get transcript
    print(f"    Fetching transcript...")
    transcript = get_youtube_transcript(video_id)

    if not transcript:
        print(f"    ✗ No transcript available")
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE marketing_content
                SET extraction_error = %s, content_analyzed_at = %s
                WHERE id = %s
            """, ('YouTube: No transcript available', datetime.utcnow(), record_id))
        conn.commit()
        return False

    print(f"    ✓ Got {len(transcript)} chars of transcript")

    # Analyze with OpenAI
    print(f"    Analyzing with OpenAI...")
    analysis = analyze_transcript_with_openai(
        title=title,
        content_type=record.get('type', ''),
        transcript=transcript,
        state=record.get('state', ''),
        existing_tags=record.get('tags', '')
    )

    if 'error' in analysis:
        print(f"    ✗ AI error: {analysis['error']}")
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE marketing_content
                SET extraction_error = %s, extracted_text = %s, content_analyzed_at = %s
                WHERE id = %s
            """, (f"OpenAI: {analysis['error']}", transcript[:5000], datetime.utcnow(), record_id))
        conn.commit()
        return False

    # Update database
    enhanced_summary = analysis.get('enhanced_summary', '')
    auto_tags_raw = analysis.get('auto_tags', '')
    # Handle auto_tags as either list or string
    if isinstance(auto_tags_raw, list):
        auto_tags = ', '.join(auto_tags_raw)
    else:
        auto_tags = auto_tags_raw or ''

    existing_tags = record.get('tags', '') or ''
    combined_tags = f"{existing_tags}, {auto_tags}" if auto_tags and existing_tags else (auto_tags or existing_tags)

    with conn.cursor() as cur:
        cur.execute("""
            UPDATE marketing_content
            SET enhanced_summary = %s,
                auto_tags = %s,
                tags = %s,
                extracted_text = %s,
                content_analyzed_at = %s,
                extraction_error = NULL
            WHERE id = %s
        """, (
            enhanced_summary,
            auto_tags,
            combined_tags,
            transcript[:5000],
            datetime.utcnow(),
            record_id
        ))
    conn.commit()

    tag_count = len(auto_tags.split(',')) if auto_tags else 0
    print(f"    ✓ Enriched with {tag_count} new tags")

    # Show extracted info
    competitors = analysis.get('competitors_mentioned', [])
    if competitors:
        print(f"    Competitors: {', '.join(competitors)}")

    return True


def main():
    parser = argparse.ArgumentParser(description='Enrich YouTube content with transcripts')
    parser.add_argument('--limit', type=int, help='Limit number of videos to process')
    parser.add_argument('--force', action='store_true', help='Re-process already enriched content')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be processed')
    args = parser.parse_args()

    print("=" * 60)
    print("YouTube Content Enrichment Pipeline")
    print("=" * 60)

    if not DATABASE_URL or not OPENAI_API_KEY:
        print("ERROR: Missing DATABASE_URL or OPENAI_API_KEY")
        sys.exit(1)

    conn = get_db_connection()
    print("✓ Connected to database")

    # Find YouTube content
    print("\nFinding YouTube content...")
    with conn.cursor() as cur:
        query = """
            SELECT * FROM marketing_content
            WHERE (live_link ILIKE '%youtube%' OR live_link ILIKE '%youtu.be%'
                   OR ungated_link ILIKE '%youtube%' OR ungated_link ILIKE '%youtu.be%')
        """
        if not args.force:
            # Only process records that either haven't been analyzed OR had extraction errors
            query += " AND (content_analyzed_at IS NULL OR extraction_error IS NOT NULL)"

        if args.limit:
            query += f" LIMIT {args.limit}"

        cur.execute(query)
        records = cur.fetchall()

    total = len(records)
    print(f"✓ Found {total} YouTube videos to process")

    if total == 0:
        print("\nNo YouTube content to process. Use --force to re-process.")
        conn.close()
        return

    if args.dry_run:
        print("\n[DRY RUN] Would process:")
        for i, record in enumerate(records[:20], 1):
            url = record.get('live_link') or record.get('ungated_link')
            video_id = extract_video_id(url)
            print(f"  {i}. {record['title'][:50]}... (ID: {video_id})")
        if total > 20:
            print(f"  ... and {total - 20} more")
        conn.close()
        return

    # Process each video
    print("\nProcessing YouTube videos...")
    success_count = 0
    error_count = 0

    for i, record in enumerate(records, 1):
        try:
            if process_youtube_record(conn, record, i, total):
                success_count += 1
            else:
                error_count += 1
        except Exception as e:
            print(f"    ✗ Error: {e}")
            error_count += 1

        # Small delay to avoid rate limiting
        if i < total:
            time.sleep(0.5)

    # Summary
    print("\n" + "=" * 60)
    print("YOUTUBE ENRICHMENT COMPLETE")
    print("=" * 60)
    print(f"  Total: {total}")
    print(f"  Success: {success_count}")
    print(f"  Errors: {error_count}")
    print(f"  Success rate: {success_count/total*100:.1f}%")

    conn.close()


if __name__ == '__main__':
    main()

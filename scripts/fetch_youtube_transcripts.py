#!/usr/bin/env python3
"""
YouTube Transcript Fetcher

Fetches full, untruncated transcripts for all YouTube videos and shorts
in the marketing_content database and stores them in the `transcript` column.

Unlike enrich_youtube.py (which truncates at 5,000 chars and runs OpenAI analysis),
this script is focused solely on transcript storage — no AI calls, no tag generation.

Usage:
    python fetch_youtube_transcripts.py              # Process all unfetched YouTube content
    python fetch_youtube_transcripts.py --limit 20   # Process only 20 videos
    python fetch_youtube_transcripts.py --force      # Re-fetch already-fetched transcripts
    python fetch_youtube_transcripts.py --dry-run    # Preview what would be processed
    python fetch_youtube_transcripts.py -v           # Verbose output
"""

import os
import sys
import argparse
import re
import time
from datetime import datetime
from typing import Optional
from urllib.parse import urlparse, parse_qs

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Import YouTube transcript API
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

load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')


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


def get_youtube_transcript(video_id: str, verbose: bool = False) -> Optional[str]:
    """
    Fetch the full transcript for a YouTube video.
    Returns the complete transcript text with no truncation.
    Returns None if captions are unavailable.
    """
    if not YOUTUBE_API_AVAILABLE:
        print("  ERROR: youtube-transcript-api is not installed")
        print("         Run: pip install youtube-transcript-api")
        return None

    try:
        api = YouTubeTranscriptApi()

        # Try English first, then fall back to any available transcript
        try:
            transcript = api.fetch(video_id, languages=['en', 'en-US', 'en-GB'])
        except NoTranscriptFound:
            try:
                transcript_list = api.list(video_id)
                available = transcript_list.find_transcript(['en', 'en-US', 'en-GB'])
                transcript = available.fetch()
            except NoTranscriptFound:
                return None

        # Join all transcript segments
        full_text = ' '.join([entry.text for entry in transcript])

        # Clean: remove [Music], [Applause], etc. and normalize whitespace
        full_text = re.sub(r'\[.*?\]', '', full_text)
        full_text = re.sub(r'\s+', ' ', full_text).strip()

        return full_text if full_text else None

    except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable, CouldNotRetrieveTranscript):
        return None
    except Exception as e:
        if verbose:
            print(f"  Transcript error: {type(e).__name__}: {e}")
        return None


def process_record(conn, record: dict, index: int, total: int, verbose: bool) -> str:
    """
    Process a single record. Returns 'fetched', 'no_transcript', or 'error'.
    """
    record_id = record['id']
    title = record['title']
    url = record.get('live_link') or record.get('ungated_link')

    label = f"[{index}/{total}]"

    # Extract video ID
    video_id = extract_video_id(url)
    if not video_id:
        if verbose:
            print(f"{label} SKIP — could not extract video ID: {title[:60]}")
            print(f"         URL: {url}")
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE marketing_content
                SET transcript = NULL,
                    transcript_fetched_at = NOW(),
                    extraction_error = 'YouTube: Could not extract video ID from URL'
                WHERE id = %s
            """, (record_id,))
        conn.commit()
        return 'error'

    if verbose:
        print(f"{label} {title[:60]}")
        print(f"         Video ID: {video_id}")
        print(f"         Fetching transcript...", end='', flush=True)

    # Fetch transcript
    transcript = get_youtube_transcript(video_id, verbose=verbose)

    if transcript is None:
        if verbose:
            print(" no captions")
        with conn.cursor() as cur:
            cur.execute("""
                UPDATE marketing_content
                SET transcript = NULL,
                    transcript_fetched_at = NOW(),
                    extraction_error = 'YouTube: No transcript available'
                WHERE id = %s
            """, (record_id,))
        conn.commit()
        return 'no_transcript'

    char_count = len(transcript)
    if verbose:
        print(f" {char_count:,} chars")

    # Store full transcript (no truncation)
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE marketing_content
            SET transcript = %s,
                transcript_fetched_at = NOW(),
                extraction_error = NULL
            WHERE id = %s
        """, (transcript, record_id))
    conn.commit()

    if not verbose:
        print(f"{label} {title[:55]}... → {char_count:,} chars")

    return 'fetched'


def main():
    parser = argparse.ArgumentParser(
        description='Fetch full YouTube transcripts into marketing_content.transcript'
    )
    parser.add_argument('--limit', type=int, help='Max number of videos to process')
    parser.add_argument('--force', action='store_true',
                        help='Re-fetch transcripts that were already fetched')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview what would be processed without making changes')
    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Verbose output')
    args = parser.parse_args()

    print("=" * 60)
    print("YouTube Transcript Fetcher")
    print("=" * 60)

    if not YOUTUBE_API_AVAILABLE:
        print("ERROR: youtube-transcript-api not installed")
        print("       Run: pip install youtube-transcript-api")
        sys.exit(1)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL environment variable not set")
        sys.exit(1)

    conn = get_db_connection()
    print("✓ Connected to database")

    # Build query for YouTube content
    with conn.cursor() as cur:
        query = """
            SELECT id, title, live_link, ungated_link, type, platform
            FROM marketing_content
            WHERE (
                live_link ILIKE '%youtube%' OR live_link ILIKE '%youtu.be%'
                OR ungated_link ILIKE '%youtube%' OR ungated_link ILIKE '%youtu.be%'
            )
        """
        if not args.force:
            query += " AND transcript_fetched_at IS NULL"

        query += " ORDER BY last_updated DESC NULLS LAST"

        if args.limit:
            query += f" LIMIT {args.limit}"

        cur.execute(query)
        records = cur.fetchall()

    total = len(records)
    print(f"✓ Found {total} YouTube videos to process")

    if total == 0:
        if args.force:
            print("\nNo YouTube content found in the database.")
        else:
            print("\nAll YouTube content already has transcripts fetched.")
            print("Use --force to re-fetch.")
        conn.close()
        return

    if args.dry_run:
        print(f"\n[DRY RUN] Would process {total} videos:")
        for i, record in enumerate(records[:25], 1):
            url = record.get('live_link') or record.get('ungated_link')
            video_id = extract_video_id(url)
            vid_str = f"(ID: {video_id})" if video_id else "(no video ID)"
            print(f"  {i:3}. {record['title'][:55]:<55} {vid_str}")
        if total > 25:
            print(f"  ... and {total - 25} more")
        conn.close()
        return

    # Process each video
    print()
    fetched = 0
    no_transcript = 0
    errors = 0

    for i, record in enumerate(records, 1):
        try:
            result = process_record(conn, record, i, total, args.verbose)
            if result == 'fetched':
                fetched += 1
            elif result == 'no_transcript':
                no_transcript += 1
            else:
                errors += 1
        except Exception as e:
            print(f"[{i}/{total}] ERROR processing '{record['title'][:40]}': {e}")
            errors += 1

        # Rate limit to avoid triggering YouTube blocks
        if i < total:
            time.sleep(1.0)

    # Summary
    print("\n" + "=" * 60)
    print("TRANSCRIPT FETCH COMPLETE")
    print("=" * 60)
    print(f"  Total processed:    {total}")
    print(f"  Transcripts stored: {fetched}")
    print(f"  No captions:        {no_transcript}")
    print(f"  Errors:             {errors}")
    if total > 0:
        print(f"  Success rate:       {fetched / total * 100:.0f}%")

    if fetched > 0:
        print(f"\n✓ Run the following SQL to verify:")
        print(f"  SELECT title, length(transcript), transcript_fetched_at")
        print(f"  FROM marketing_content")
        print(f"  WHERE transcript IS NOT NULL")
        print(f"  ORDER BY transcript_fetched_at DESC LIMIT 10;")

    conn.close()


if __name__ == '__main__':
    main()

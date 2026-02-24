#!/usr/bin/env python3
"""
Customer Story Enrichment Script

For each customer story in the DB (or from a CSV), this script:
1. Scrapes the landing page, extracts YouTube transcript, and reads the PDF
2. Sends all extracted content to gpt-5.2 for synthesis
3. Extracts: key quote, proof points, metrics, features used, district summary
4. Upserts ai_context (category='customer_story') with rich context for the AI assistant
5. Updates marketing_content record with enhanced_summary, auto_tags, keywords

The AI assistant in App.jsx uses customer_story ai_context to surface quotes
and proof points when sales reps ask "give me a proof point about Texas" etc.

Usage:
    python scripts/enrich_customer_stories.py --dry-run -v         # Preview
    python scripts/enrich_customer_stories.py --limit 3 -v         # Test 3 stories
    python scripts/enrich_customer_stories.py -v                   # All stories
    python scripts/enrich_customer_stories.py --story austin-isd   # Single story by slug
    python scripts/enrich_customer_stories.py --csv-path PATH      # Use CSV from fetch script
    python scripts/enrich_customer_stories.py --force -v           # Re-enrich all
"""

import os
import sys
import csv
import json
import re
import time
import argparse
from datetime import datetime
from typing import Optional, Dict, Any, List

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import requests
from bs4 import BeautifulSoup
from openai import OpenAI

# Optional YouTube transcript API
try:
    from youtube_transcript_api import YouTubeTranscriptApi
    from youtube_transcript_api._errors import (
        TranscriptsDisabled, NoTranscriptFound, VideoUnavailable, CouldNotRetrieveTranscript
    )
    YOUTUBE_API_AVAILABLE = True
except ImportError:
    YOUTUBE_API_AVAILABLE = False
    print('WARN: youtube_transcript_api not installed — YouTube transcripts disabled')

# Optional PDF extraction
try:
    from PyPDF2 import PdfReader
    from io import BytesIO
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False
    print('WARN: PyPDF2 not installed — PDF extraction disabled')

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

SCHOOLINKS_BASE_URL = 'https://www.schoolinks.com'
DEEP_MODEL = 'gpt-5.2'
MAX_EXTRACTED_CHARS = 8000


def get_db_connection():
    if not DATABASE_URL:
        raise ValueError('DATABASE_URL not set')
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


# =============================================================================
# Content Extraction (reuse patterns from enrich_deep.py)
# =============================================================================

def extract_youtube_transcript(url: str) -> Optional[str]:
    """Extract transcript from a YouTube URL."""
    if not YOUTUBE_API_AVAILABLE or not url:
        return None
    try:
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        video_id = None
        if 'youtube.com' in parsed.netloc:
            qs = parse_qs(parsed.query)
            video_id = (qs.get('v') or [''])[0]
            if not video_id and '/embed/' in parsed.path:
                video_id = parsed.path.split('/embed/')[-1].split('/')[0].split('?')[0]
        elif 'youtu.be' in parsed.netloc:
            video_id = parsed.path.strip('/').split('?')[0]
        if not video_id:
            return None

        api = YouTubeTranscriptApi()
        transcript_list = api.fetch(video_id, languages=['en'])
        text = ' '.join(item.get('text', '') for item in transcript_list)
        return text[:MAX_EXTRACTED_CHARS] if text else None
    except (TranscriptsDisabled, NoTranscriptFound, VideoUnavailable, CouldNotRetrieveTranscript):
        return None
    except Exception as e:
        print(f'      YouTube transcript error: {type(e).__name__}: {e}')
        return None


def extract_pdf_text(url: str) -> Optional[str]:
    """Extract text from a PDF URL."""
    if not PDF_AVAILABLE or not url:
        return None
    try:
        response = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (compatible; ContentEnricher/2.0)'
        })
        response.raise_for_status()
        reader = PdfReader(BytesIO(response.content))
        text = '\n'.join(
            page.extract_text() or '' for page in reader.pages[:10]
        )
        return text[:MAX_EXTRACTED_CHARS] if text.strip() else None
    except Exception as e:
        print(f'      PDF extraction error: {e}')
        return None


def scrape_landing_page(url: str) -> Optional[str]:
    """Scrape text from the customer story landing page."""
    if not url:
        return None
    try:
        response = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        for el in soup(['script', 'style', 'nav', 'footer', 'header', 'noscript', 'iframe']):
            el.decompose()

        # Prioritize main content areas
        main = (
            soup.find('main') or
            soup.find('article') or
            soup.find('div', class_=re.compile(r'resource|story|content|case|customer', re.I))
        )
        text = (main or soup.body or soup).get_text(separator=' ', strip=True)
        text = re.sub(r'\s+', ' ', text)
        return text[:MAX_EXTRACTED_CHARS] if text else None
    except Exception as e:
        print(f'      Scrape error for {url[:60]}: {e}')
        return None


def build_extracted_content(story: Dict, verbose: bool) -> str:
    """Gather content from all available sources for a customer story."""
    parts = []

    # Webflow body text — primary source (full story article from CMS)
    body_text = story.get('body_text', '').strip()
    if body_text and len(body_text) > 100:
        parts.append(f'[STORY BODY — full article text]\n{body_text[:10000]}')
        if verbose:
            print(f'      Body text: {len(body_text)} chars')
    else:
        # Fallback: try scraping the landing page
        if story.get('live_link'):
            if verbose:
                print(f'      No body_text — scraping: {story["live_link"]}')
            page_text = scrape_landing_page(story['live_link'])
            if page_text:
                parts.append(f'[LANDING PAGE]\n{page_text}')
                if verbose:
                    print(f'      Landing page: {len(page_text)} chars')

    # YouTube video
    if story.get('video_url') and 'youtube' in story.get('video_url', '').lower():
        if verbose:
            print(f'      YouTube: {story["video_url"][:60]}')
        transcript = extract_youtube_transcript(story['video_url'])
        if transcript:
            parts.append(f'[VIDEO TRANSCRIPT]\n{transcript}')
            if verbose:
                print(f'      Transcript: {len(transcript)} chars')

    # PDF
    if story.get('pdf_url'):
        if verbose:
            print(f'      PDF: {story["pdf_url"][:60]}')
        pdf_text = extract_pdf_text(story['pdf_url'])
        if pdf_text:
            parts.append(f'[PDF WRITE-UP]\n{pdf_text}')
            if verbose:
                print(f'      PDF: {len(pdf_text)} chars')

    # Existing description from Webflow/DB
    if story.get('description') or story.get('meta_description'):
        desc = (story.get('description') or '') + ' ' + (story.get('meta_description') or '')
        parts.append(f'[DESCRIPTION]\n{desc.strip()}')

    return '\n\n'.join(parts)


# =============================================================================
# AI Synthesis
# =============================================================================

def synthesize_customer_story(
    openai_client: OpenAI,
    story: Dict,
    extracted_content: str
) -> Dict[str, Any]:
    """
    Use gpt-5.2 to extract structured insights from a customer story.
    Returns dict with key_quote, proof_points, metrics, features_used, summary, etc.
    """
    district_hint = story.get('district_name') or story.get('name') or 'Unknown District'
    state_hint = story.get('state') or 'Unknown'

    prompt = f"""You are analyzing a SchooLinks customer story (case study).

Customer/District: {district_hint}
State: {state_hint}
Story Title: {story.get('name', '')}
Known Quote from CMS: {story.get('quote', 'None')}

CONTENT FROM ALL SOURCES (landing page, video transcript, PDF):
{extracted_content[:6000] if extracted_content else 'No content extracted — use title and description only.'}

Extract the following and respond ONLY with valid JSON:

{{
  "district_name": "Official name of the school district or organization",
  "state": "2-letter US state code (e.g. TX, AZ, WA). Empty string if unknown.",
  "key_quote": "The single best verbatim testimonial quote from a real person. Include attribution if available (e.g. 'Great platform — Jane Smith, Counselor'). Empty string if no quote found.",
  "secondary_quotes": ["Additional quote 1", "Additional quote 2"],
  "metrics": [
    "Specific measurable outcome (e.g. '95% FAFSA completion rate', '3,000 students served')"
  ],
  "features_used": ["SchooLinks feature 1", "SchooLinks feature 2"],
  "proof_points": [
    "Sales-ready proof point 1 (1-2 sentences, leads with outcome)",
    "Sales-ready proof point 2",
    "Sales-ready proof point 3"
  ],
  "summary": "2-3 sentence customer story summary for a sales rep. Lead with the district name, state, and key outcome.",
  "enhanced_summary": "Detailed 4-5 sentence summary optimized for search. Include district name, state, features, outcomes, quotes, and context.",
  "auto_tags": ["tag1", "tag2"],
  "keywords": [
    {{"keyword": "term", "weight": 0.95, "category": "topic"}}
  ]
}}

RULES:
- Only include what is actually stated in the content. Do not fabricate or paraphrase loosely.
- For key_quote: find the single best VERBATIM quote with quotation marks. Look for sentences inside quotation marks in the story body. Include the speaker's name/title if mentioned (e.g., "— Melissa Barlow, Principal").
- For secondary_quotes: find 2-3 more verbatim quoted passages from the story body. These are gold for sales.
- For metrics: extract every specific number mentioned (percentages, student counts, time savings, engagement rates, completion rates). Be precise.
- For proof_points: write 3-5 punchy sales-ready bullets. Lead with the outcome. Reference the district name.
- For features_used: list only SchooLinks features explicitly named or demonstrated in the story.
- For keywords: include district name, state code, features, outcomes, people names mentioned.
- keyword categories: "topic", "feature", "state", "persona", "outcome", "district"
- auto_tags: include state code, district name (shortened), key features demonstrated"""

    try:
        api_params = {
            "model": DEEP_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": "You are an expert K-12 education marketing analyst. Extract structured insights from customer stories for a sales enablement platform. Always respond with valid JSON only."
                },
                {"role": "user", "content": prompt}
            ],
            "max_completion_tokens": 2000
        }

        response = openai_client.chat.completions.create(**api_params)
        content = response.choices[0].message.content

        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json.loads(json_match.group())
        return {'error': 'No JSON in response', 'raw': content[:300]}

    except Exception as e:
        return {'error': str(e)}


# =============================================================================
# Related Asset Discovery
# =============================================================================

def extract_district_keywords(district_name: str) -> list:
    """Extract searchable keyword(s) from a district name by stripping common suffixes."""
    suffixes = [
        ' unified school district', ' unified school dist',
        ' community unit school district', ' independent school district',
        ' elementary school district', ' school district',
        ' public schools', ' city schools', ' county schools',
        ' cusd', ' isd', ' usd',
    ]
    name = district_name.lower().strip()
    # Apply longest matching suffix first
    for suffix in sorted(suffixes, key=len, reverse=True):
        if name.endswith(suffix):
            name = name[:-len(suffix)].strip()
            break
    keywords = [name]
    if ' ' in name:
        keywords.append(name.split()[0])
    return list(dict.fromkeys(keywords))  # deduplicated, order preserved


def find_related_assets(conn, district_name: str, state: str, exclude_id: str = None) -> list:
    """Find related assets in marketing_content for a customer story district.

    Searches by district keyword across title and auto_tags columns.
    Falls back to state-based search if keyword search returns nothing.
    Returns assets sorted by type priority: Video Clip → Video → 1-Pager → Blog → other.
    """
    if not district_name:
        return []

    keywords = extract_district_keywords(district_name)
    primary_kw = keywords[0] if keywords else ''

    if not primary_kw or len(primary_kw) < 3:
        return []

    exclude_clause = ' AND id != %s::uuid' if exclude_id else ''

    with conn.cursor() as cur:
        params = [f'%{primary_kw}%', f'%{primary_kw}%']
        if exclude_id:
            params.append(exclude_id)
        cur.execute(f"""
            SELECT type, title, live_link, ungated_link, platform
            FROM marketing_content
            WHERE (title ILIKE %s OR auto_tags ILIKE %s)
              AND type NOT IN ('Customer Story', 'Landing Page')
              {exclude_clause}
            ORDER BY CASE type
              WHEN 'Video Clip' THEN 1
              WHEN 'Video' THEN 2
              WHEN '1-Pager' THEN 3
              WHEN 'Blog' THEN 4
              ELSE 5 END, title
            LIMIT 20
        """, params)
        results = [dict(r) for r in cur.fetchall()]

    # Fallback: search by state if keyword search returned nothing
    if not results and state:
        with conn.cursor() as cur:
            params = [state]
            if exclude_id:
                params.append(exclude_id)
            cur.execute(f"""
                SELECT type, title, live_link, ungated_link, platform
                FROM marketing_content
                WHERE state = %s
                  AND type NOT IN ('Customer Story', 'Landing Page')
                  {exclude_clause}
                ORDER BY CASE type
                  WHEN 'Video Clip' THEN 1
                  WHEN 'Video' THEN 2
                  WHEN '1-Pager' THEN 3
                  WHEN 'Blog' THEN 4
                  ELSE 5 END, title
                LIMIT 10
            """, params)
            results = [dict(r) for r in cur.fetchall()]

    return results


# =============================================================================
# ai_context Upsert
# =============================================================================

def build_context_document(story: Dict, analysis: Dict, related_assets: list = None) -> str:
    """Build the rich markdown content document stored in ai_context."""
    district = analysis.get('district_name') or story.get('district_name') or story.get('name', 'Unknown')
    state = analysis.get('state') or story.get('state') or ''
    state_label = f' ({state})' if state else ''

    sections = [f'# {district}{state_label} Customer Story — SchooLinks\n']

    key_quote = analysis.get('key_quote', '').strip()
    if key_quote:
        sections.append(f'## Key Quote\n"{key_quote}"\n')

    proof_points = analysis.get('proof_points', [])
    if proof_points:
        points_text = '\n'.join(f'- {p}' for p in proof_points)
        sections.append(f'## Proof Points\n{points_text}\n')

    features = analysis.get('features_used', [])
    if features:
        sections.append(f'## Features Demonstrated\n{", ".join(features)}\n')

    summary = analysis.get('summary', '').strip()
    if summary:
        sections.append(f'## District Overview\n{summary}\n')

    secondary_quotes = analysis.get('secondary_quotes', [])
    if secondary_quotes:
        quotes_text = '\n'.join(f'- "{q}"' for q in secondary_quotes if q.strip())
        if quotes_text:
            sections.append(f'## Additional Quotes\n{quotes_text}\n')

    metrics = analysis.get('metrics', [])
    if metrics:
        metrics_text = '\n'.join(f'- {m}' for m in metrics if m.strip())
        if metrics_text:
            sections.append(f'## Metrics & Outcomes\n{metrics_text}\n')

    # Assets section
    asset_lines = []
    if story.get('live_link'):
        asset_lines.append(f'- Landing page: {story["live_link"]}')
    if story.get('video_url'):
        asset_lines.append(f'- Full video: {story["video_url"]}')
    if story.get('pdf_url'):
        asset_lines.append(f'- PDF write-up: {story["pdf_url"]}')
    if asset_lines:
        sections.append(f'## Assets\n' + '\n'.join(asset_lines) + '\n')

    # Related video clips & supporting assets from the same district cluster
    if related_assets:
        related_lines = []
        for asset in related_assets:
            asset_type = asset.get('type', 'Asset')
            asset_title = asset.get('title', 'Untitled')
            platform = asset.get('platform', '')
            line = f'- [{asset_type}] "{asset_title}"'
            if platform:
                line += f' ({platform})'
            related_lines.append(line)
        if related_lines:
            sections.append(
                '## Related Video Clips & Supporting Assets\n'
                'When recommending content for this customer story, INCLUDE THESE related assets — '
                'they are all from the same district and part of the same story cluster:\n'
                + '\n'.join(related_lines) + '\n'
            )

    return '\n'.join(sections)


def upsert_ai_context(conn, story: Dict, analysis: Dict, dry_run: bool, content_doc: str = None) -> bool:
    """Upsert ai_context entry for a customer story."""
    district = analysis.get('district_name') or story.get('district_name') or story.get('name', '')
    state = analysis.get('state') or story.get('state') or ''

    # Use slug as subcategory (stable identifier)
    subcategory = story.get('slug') or re.sub(r'[^a-z0-9-]', '-', district.lower().strip())[:50]
    title = f'{district} Customer Story — SchooLinks'
    summary = analysis.get('summary') or f'{district} uses SchooLinks for K-12 CCR.'
    content = content_doc if content_doc is not None else build_context_document(story, analysis)

    # Build tags array
    tags = list(set(filter(None, [
        state or None,
        'Customer Story',
    ] + (analysis.get('auto_tags') or []))))

    source_content_id = story.get('marketing_content_id') or None

    if dry_run:
        print(f'    [DRY RUN] Would upsert ai_context: {title[:60]}')
        print(f'    subcategory={subcategory}, tags={tags[:5]}')
        return True

    with conn.cursor() as cur:
        # Check if entry exists (no UNIQUE constraint on category+subcategory)
        cur.execute("""
            SELECT id FROM ai_context
            WHERE category = 'customer_story' AND subcategory = %s
            LIMIT 1
        """, (subcategory,))
        existing = cur.fetchone()

        if existing:
            cur.execute("""
                UPDATE ai_context SET
                  title = %s,
                  summary = %s,
                  content = %s,
                  tags = %s,
                  source_content_id = COALESCE(%s::uuid, source_content_id),
                  is_verified = true,
                  updated_at = NOW()
                WHERE category = 'customer_story' AND subcategory = %s
            """, (title, summary, content, tags, source_content_id, subcategory))
        else:
            cur.execute("""
                INSERT INTO ai_context
                  (category, subcategory, title, summary, content, tags,
                   source_content_id, source_type, source_url,
                   is_verified, confidence, created_at, updated_at)
                VALUES
                  ('customer_story', %s, %s, %s, %s, %s,
                   %s::uuid, 'customer_story', %s,
                   true, 0.90, NOW(), NOW())
            """, (
                subcategory, title, summary, content, tags,
                source_content_id,
                story.get('live_link') or ''
            ))

    return True


def update_marketing_content(conn, story: Dict, analysis: Dict, dry_run: bool, verbose: bool) -> bool:
    """Update marketing_content record with enriched metadata."""
    content_id = story.get('marketing_content_id')
    if not content_id:
        if verbose:
            print('    SKIP marketing_content update (no DB match)')
        return False

    enhanced_summary = analysis.get('enhanced_summary') or analysis.get('summary') or ''
    auto_tags = analysis.get('auto_tags', [])
    if isinstance(auto_tags, list):
        auto_tags_str = ', '.join(auto_tags)
    else:
        auto_tags_str = str(auto_tags)

    keywords = analysis.get('keywords', [])

    if dry_run:
        print(f'    [DRY RUN] Would update marketing_content id={content_id}')
        print(f'    enhanced_summary: {enhanced_summary[:80]}...')
        return True

    with conn.cursor() as cur:
        cur.execute("""
            UPDATE marketing_content SET
              enhanced_summary = %s,
              auto_tags = %s,
              keywords = %s::jsonb,
              deep_enriched_at = NOW()
            WHERE id = %s::uuid
        """, (
            enhanced_summary,
            auto_tags_str,
            json.dumps(keywords),
            content_id
        ))

    return True


# =============================================================================
# Data Loading
# =============================================================================

def load_stories_from_db(conn, limit: int, force: bool, story_slug: Optional[str]) -> List[Dict]:
    """Load customer stories from marketing_content table."""
    with conn.cursor() as cur:
        if story_slug:
            cur.execute("""
                SELECT id, title, live_link, ungated_link, type, state,
                       summary, enhanced_summary, auto_tags, extracted_text
                FROM marketing_content
                WHERE type = 'Customer Story'
                  AND (live_link ILIKE %s OR title ILIKE %s)
            """, (f'%{story_slug}%', f'%{story_slug}%'))
        elif force:
            cur.execute("""
                SELECT id, title, live_link, ungated_link, type, state,
                       summary, enhanced_summary, auto_tags, extracted_text
                FROM marketing_content
                WHERE type = 'Customer Story'
                  AND live_link IS NOT NULL
                ORDER BY last_updated DESC
                LIMIT %s
            """, (limit or 1000,))
        else:
            # Only unenriched stories (no deep_enriched_at or no ai_context yet)
            cur.execute("""
                SELECT mc.id, mc.title, mc.live_link, mc.ungated_link, mc.type, mc.state,
                       mc.summary, mc.enhanced_summary, mc.auto_tags, mc.extracted_text
                FROM marketing_content mc
                LEFT JOIN ai_context ac ON (
                  ac.category = 'customer_story'
                  AND ac.source_content_id = mc.id
                )
                WHERE mc.type = 'Customer Story'
                  AND mc.live_link IS NOT NULL
                  AND ac.id IS NULL
                ORDER BY mc.last_updated DESC
                LIMIT %s
            """, (limit or 1000,))

        rows = cur.fetchall()

    return [dict(r) for r in rows]


def load_stories_from_csv(csv_path: str, limit: int, story_slug: Optional[str]) -> List[Dict]:
    """Load customer stories from the CSV output of fetch_webflow_customer_stories.py."""
    stories = []
    with open(csv_path, newline='', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if story_slug and story_slug not in (row.get('slug', '') + row.get('name', '')).lower():
                continue
            stories.append(dict(row))
            if limit and len(stories) >= limit:
                break
    return stories


# =============================================================================
# Main Processing Loop
# =============================================================================

def process_story(
    conn,
    openai_client: OpenAI,
    story: Dict,
    dry_run: bool,
    verbose: bool
) -> bool:
    """Process a single customer story end-to-end."""
    name = story.get('name') or story.get('title') or 'Unknown'
    print(f'\n  [{name[:60]}]')

    if verbose:
        print(f'    URL: {story.get("live_link", "none")}')
        print(f'    State: {story.get("state", "?")}, DB match: {story.get("marketing_content_id", "none")}')

    # Extract content from all sources
    print('    Extracting content...')
    extracted = build_extracted_content(story, verbose)

    if not extracted or len(extracted) < 100:
        print('    WARN: No content extracted — will use description/title only')

    # AI synthesis
    print(f'    Synthesizing with {DEEP_MODEL}...')
    if dry_run:
        print(f'    [DRY RUN] Would call {DEEP_MODEL} for synthesis')
        district_hint = story.get('district_name') or name
        related_assets = find_related_assets(conn, district_hint, story.get('state', ''))
        if verbose:
            print(f'    Related assets: {len(related_assets)} found')
            for a in related_assets[:3]:
                print(f'      - [{a["type"]}] {a["title"][:55]}')
        upsert_ai_context(conn, story, {
            'district_name': district_hint,
            'state': story.get('state', ''),
            'summary': f'{name} uses SchooLinks for K-12 college and career readiness.',
            'proof_points': ['(dry run — no actual proof points generated)'],
        }, dry_run=True)
        return True

    analysis = synthesize_customer_story(openai_client, story, extracted)

    if 'error' in analysis:
        print(f'    AI error: {analysis["error"]}')
        return False

    if verbose:
        print(f'    District: {analysis.get("district_name", "?")}')
        print(f'    State: {analysis.get("state", "?")}')
        if analysis.get('key_quote'):
            print(f'    Quote: {analysis["key_quote"][:80]}...')
        print(f'    Proof points: {len(analysis.get("proof_points", []))}')
        print(f'    Metrics: {len(analysis.get("metrics", []))}')
        print(f'    Features: {analysis.get("features_used", [])}')

    # Find related assets from marketing_content (same district cluster)
    district_for_search = (
        analysis.get('district_name') or story.get('district_name')
        or story.get('name') or story.get('title', '')
    )
    state_for_search = analysis.get('state') or story.get('state', '')
    story_mc_id = str(story.get('id')) if story.get('id') else None
    related_assets = find_related_assets(conn, district_for_search, state_for_search, exclude_id=story_mc_id)
    if verbose:
        print(f'    Related assets: {len(related_assets)} found')
        for a in related_assets[:5]:
            print(f'      - [{a["type"]}] {a["title"][:55]}')

    # Build content doc with related assets baked in, then upsert ai_context
    content_doc = build_context_document(story, analysis, related_assets=related_assets)
    print('    Upserting ai_context...')
    upsert_ai_context(conn, story, analysis, dry_run=False, content_doc=content_doc)

    # Update marketing_content
    print('    Updating marketing_content...')
    update_marketing_content(conn, story, analysis, dry_run=False, verbose=verbose)

    conn.commit()
    print('    Done')
    return True


def patch_related_assets(
    conn,
    dry_run: bool,
    verbose: bool,
    limit: int = 0,
    story_slug: str = None
) -> int:
    """Patch mode: add/refresh Related Assets section in existing ai_context entries.

    No AI synthesis — just queries marketing_content by district keyword and
    updates the ai_context content column. Zero OpenAI cost.
    """
    where_clause = "WHERE ac.category = 'customer_story'"
    params: list = []
    if story_slug:
        where_clause += ' AND (ac.subcategory ILIKE %s OR ac.title ILIKE %s)'
        params.extend([f'%{story_slug}%', f'%{story_slug}%'])
    limit_clause = f'LIMIT {int(limit)}' if limit else ''

    with conn.cursor() as cur:
        cur.execute(f"""
            SELECT ac.id, ac.subcategory, ac.title AS ac_title, ac.content,
                   mc.id AS mc_id, mc.state
            FROM ai_context ac
            LEFT JOIN marketing_content mc ON mc.id = ac.source_content_id
            {where_clause}
            ORDER BY ac.updated_at DESC
            {limit_clause}
        """, params)
        entries = [dict(r) for r in cur.fetchall()]

    print(f'  {len(entries)} ai_context entries to patch')

    success = 0
    skipped = 0

    for entry in entries:
        # Extract district name from stored title: "{district} Customer Story — SchooLinks"
        ac_title = entry.get('ac_title') or ''
        district_name = ac_title.replace(' Customer Story — SchooLinks', '').strip()
        if not district_name:
            district_name = (entry.get('subcategory') or '').replace('-', ' ')

        state = entry.get('state') or ''
        mc_id = str(entry['mc_id']) if entry.get('mc_id') else None

        print(f'\n  [{district_name[:60]}]')

        related_assets = find_related_assets(conn, district_name, state, exclude_id=mc_id)

        if verbose:
            print(f'    Found {len(related_assets)} related assets')
            for a in related_assets[:5]:
                print(f'      - [{a["type"]}] {a["title"][:60]}')

        if not related_assets:
            if verbose:
                print('    No related assets — skipping')
            skipped += 1
            continue

        # Build the Related Assets markdown section
        related_lines = []
        for asset in related_assets:
            asset_type = asset.get('type', 'Asset')
            asset_title = asset.get('title', 'Untitled')
            platform = asset.get('platform', '')
            line = f'- [{asset_type}] "{asset_title}"'
            if platform:
                line += f' ({platform})'
            related_lines.append(line)

        related_section = (
            '\n## Related Video Clips & Supporting Assets\n'
            'When recommending content for this customer story, INCLUDE THESE related assets — '
            'they are all from the same district and part of the same story cluster:\n'
            + '\n'.join(related_lines) + '\n'
        )

        if dry_run:
            print(f'    [DRY RUN] Would add {len(related_assets)} related assets')
            if verbose:
                print(f'    Preview: {related_section[:300]}')
            success += 1
            continue

        # Strip any existing Related Assets section, then append the fresh one
        content = entry.get('content') or ''
        content = re.sub(r'\n## Related Video Clips.*', '', content, flags=re.DOTALL).rstrip()
        content += related_section

        with conn.cursor() as cur:
            cur.execute("""
                UPDATE ai_context SET content = %s, updated_at = NOW()
                WHERE id = %s
            """, (content, entry['id']))
        conn.commit()
        success += 1

    print(f'\n=== PATCH SUMMARY ===')
    print(f'  Patched: {success}')
    print(f'  Skipped (no related assets found): {skipped}')
    return success


def main():
    parser = argparse.ArgumentParser(
        description='Enrich customer stories: extract content, synthesize with AI, upsert ai_context'
    )
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview without writing to DB or calling OpenAI')
    parser.add_argument('--limit', type=int, default=0,
                        help='Max stories to process (0 = all)')
    parser.add_argument('--force', action='store_true',
                        help='Re-enrich stories that already have ai_context entries')
    parser.add_argument('--story', type=str, default=None,
                        help='Process a single story by slug or partial title')
    parser.add_argument('--csv-path', type=str, default=None,
                        help='Load stories from CSV (output of fetch_webflow_customer_stories.py)')
    parser.add_argument('--add-related-assets', action='store_true',
                        help='Patch mode: add Related Assets section to existing ai_context entries (no AI synthesis, no cost)')
    parser.add_argument('-v', '--verbose', action='store_true',
                        help='Show detailed output')
    args = parser.parse_args()

    print(f'Customer Story Enrichment — {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}')
    if args.dry_run:
        print('[DRY RUN] No changes will be written')
    print()

    if not DATABASE_URL:
        print('ERROR: DATABASE_URL not set')
        sys.exit(1)

    if not args.dry_run and not OPENAI_API_KEY:
        print('ERROR: OPENAI_API_KEY not set')
        sys.exit(1)

    openai_client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

    print('Connecting to database...')
    try:
        conn = get_db_connection()
    except Exception as e:
        print(f'ERROR: Could not connect: {e}')
        sys.exit(1)

    # Patch mode: just update Related Assets sections, no AI synthesis
    if args.add_related_assets:
        print('Mode: --add-related-assets (no AI synthesis)')
        patch_related_assets(
            conn,
            dry_run=args.dry_run,
            verbose=args.verbose,
            limit=args.limit,
            story_slug=args.story,
        )
        conn.close()
        print('\nDone!')
        return

    # Load stories
    print('Loading customer stories...')
    if args.csv_path:
        if not os.path.exists(args.csv_path):
            print(f'ERROR: CSV not found: {args.csv_path}')
            sys.exit(1)
        print(f'  From CSV: {args.csv_path}')
        stories = load_stories_from_csv(args.csv_path, args.limit, args.story)
    else:
        print('  From marketing_content table')
        stories = load_stories_from_db(conn, args.limit, args.force, args.story)

    print(f'  {len(stories)} stories to process')

    if not stories:
        print('No stories to process. All may already be enriched (use --force to re-enrich).')
        conn.close()
        sys.exit(0)

    # Cost estimate
    if not args.dry_run and len(stories) > 1:
        estimated_cost = len(stories) * 0.07
        print(f'\n  Estimated cost: ~${estimated_cost:.2f} ({len(stories)} stories × ~$0.07 each)')
        print()

    # Process each story
    success = 0
    failed = 0
    skipped = 0

    for story in stories:
        try:
            result = process_story(conn, openai_client, story, args.dry_run, args.verbose)
            if result:
                success += 1
            else:
                skipped += 1
        except Exception as e:
            print(f'  ERROR: {story.get("name", "?")} — {e}')
            failed += 1
            if not args.dry_run:
                conn.rollback()

        time.sleep(0.5)  # Rate limiting

    conn.close()

    print(f'\n=== SUMMARY ===')
    print(f'  Processed: {success}')
    print(f'  Skipped:   {skipped}')
    print(f'  Failed:    {failed}')

    if not args.dry_run and success > 0:
        print()
        print(f'  {success} customer story context entries in ai_context')
        print()
        print('Verify with:')
        print("  SELECT subcategory, LEFT(content, 150) FROM ai_context WHERE category = 'customer_story' ORDER BY updated_at DESC LIMIT 5;")

    print()
    print('Done!')
    if args.dry_run:
        print()
        print('Run without --dry-run to apply changes.')


if __name__ == '__main__':
    main()

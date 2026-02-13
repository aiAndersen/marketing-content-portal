#!/usr/bin/env python3
"""
PDF Text Extraction & Re-Enrichment Script

Fixes ebooks and 1-pagers whose extracted_text contains Webflow resource page
wrapper text instead of actual PDF content. Downloads the PDF from ungated_link,
extracts real text via PyPDF2, and optionally re-runs AI enrichment.

Usage:
    python scripts/enrich_pdf_text.py --dry-run -v      # Preview what would be processed
    python scripts/enrich_pdf_text.py                    # Extract PDF text only
    python scripts/enrich_pdf_text.py --re-enrich        # Extract + AI re-analysis
    python scripts/enrich_pdf_text.py --limit 5 -v       # Test with 5 records
    python scripts/enrich_pdf_text.py --force             # Re-extract all PDFs (not just bad ones)
"""

import os
import sys
import io
import re
import json
import time
import argparse
from datetime import datetime
from typing import Optional, Dict

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
import requests

# PDF extraction
try:
    import PyPDF2
except ImportError:
    print("ERROR: PyPDF2 not installed. Run: pip install PyPDF2")
    sys.exit(1)

# Load environment variables from multiple locations
for env_path in ['.env', '.env.local', 'scripts/.env', 'frontend/.env']:
    load_dotenv(env_path)

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

# Webflow wrapper patterns that indicate extracted_text is from the resource page, not the PDF
WRAPPER_PATTERNS = [
    'All Resources%Case Study%',
    'All Resources%WEbinar%',
    '%Subscribe For Weekly Resources%',
    'All Resources%1-Pager%SchooLinks Staff%',
    'All Resources%eBook%SchooLinks Staff%',
]


def get_db_connection():
    """Create database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def extract_pdf_text(url: str, max_chars: int = 8000, verbose: bool = False) -> Optional[str]:
    """Download a PDF from URL and extract text via PyPDF2."""
    try:
        if verbose:
            print(f"    Downloading PDF from {url[:80]}...")

        response = requests.get(url, timeout=30, headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        })
        response.raise_for_status()

        pdf_file = io.BytesIO(response.content)
        reader = PyPDF2.PdfReader(pdf_file)

        text_parts = []
        total_chars = 0

        for i, page in enumerate(reader.pages[:15]):  # Max 15 pages
            try:
                page_text = page.extract_text() or ""
                text_parts.append(page_text)
                total_chars += len(page_text)

                if total_chars >= max_chars:
                    break
            except Exception as e:
                if verbose:
                    print(f"    Warning: Could not extract page {i+1}: {e}")
                continue

        full_text = "\n".join(text_parts)

        # Clean up: strip NUL bytes (some PDFs contain them) and whitespace
        full_text = full_text.replace('\x00', '')
        full_text = re.sub(r'\s+', ' ', full_text).strip()

        if verbose:
            print(f"    Extracted {len(full_text)} chars from {len(reader.pages)} pages")

        return full_text[:max_chars] if full_text else None

    except Exception as e:
        print(f"    ERROR extracting PDF: {e}")
        return None


def enrich_with_ai(title: str, content_type: str, text: str, verbose: bool = False) -> Dict:
    """Use gpt-4o-mini to generate tags and summary from extracted PDF text."""
    from openai import OpenAI

    client = OpenAI(api_key=OPENAI_API_KEY)

    prompt = f"""Analyze this SchooLinks marketing PDF and generate search metadata.

TITLE: {title}
TYPE: {content_type}

EXTRACTED TEXT:
{text[:6000]}

Generate (respond with valid JSON only):
{{
  "enhanced_summary": "A 2-3 sentence summary of what this content covers. Be specific about the key takeaways.",
  "auto_tags": ["tag1", "tag2", ...],
  "key_topics": ["2-4 main topics"]
}}

Tag categories to choose from (only include what's ACTUALLY in the content):
- Personas: counselors, administrators, CTE coordinators, students, parents, district leaders
- Topics: career exploration, college readiness, work-based learning, FAFSA, financial aid, graduation, course planning, CTE pathways, internships, college applications
- Legislation: CCMR, CCR, ICAP, ACP, ECAP, PLP, ILP
- Competitors: Naviance, Xello, MajorClarity, Scoir, CCGI, LevelAll
- Features: analytics, reporting, dashboards, AI, mobile, family portal
- State names if state-specific

Be selective - only include tags actually discussed in the content."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a marketing content analyst. Generate structured metadata for search optimization. Respond with valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=600
        )

        content = response.choices[0].message.content
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            result = json.loads(json_match.group())
            if verbose:
                tags = result.get('auto_tags', [])
                print(f"    AI: {len(tags)} tags, summary: {result.get('enhanced_summary', '')[:60]}...")
            return result
        return {}

    except Exception as e:
        print(f"    AI enrichment error: {e}")
        return {}


def main():
    parser = argparse.ArgumentParser(description='Extract real PDF text for ebooks/1-pagers')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    parser.add_argument('--re-enrich', action='store_true', help='Also re-run AI enrichment')
    parser.add_argument('--force', action='store_true', help='Re-extract all PDFs, not just bad ones')
    parser.add_argument('--limit', type=int, default=0, help='Limit number of records to process')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')
    args = parser.parse_args()

    print("=" * 60)
    print("PDF Text Extraction & Re-Enrichment")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    if args.re_enrich and not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY required for --re-enrich")
        sys.exit(1)

    conn = get_db_connection()
    cur = conn.cursor()

    # Build query based on mode
    if args.force:
        # Re-extract all ebooks/1-pagers with PDF links
        cur.execute("""
            SELECT id, title, type, ungated_link, LENGTH(extracted_text) as text_len
            FROM marketing_content
            WHERE ungated_link LIKE '%%.pdf'
              AND type IN ('Ebook', '1-Pager')
            ORDER BY title
        """)
    else:
        # Only records with Webflow wrapper text
        wrapper_conditions = " OR ".join(
            f"extracted_text LIKE '{p}'" for p in WRAPPER_PATTERNS
        )
        cur.execute(f"""
            SELECT id, title, type, ungated_link, LENGTH(extracted_text) as text_len
            FROM marketing_content
            WHERE ungated_link LIKE '%%.pdf'
              AND type IN ('Ebook', '1-Pager')
              AND ({wrapper_conditions} OR extracted_text IS NULL OR LENGTH(extracted_text) < 100)
            ORDER BY title
        """)

    rows = cur.fetchall()

    if args.limit > 0:
        rows = rows[:args.limit]

    print(f"\nFound {len(rows)} records to process")
    if args.dry_run:
        print("[DRY RUN MODE]")
    if args.re_enrich:
        print("[AI RE-ENRICHMENT ENABLED]")
    print()

    if not rows:
        print("Nothing to process!")
        conn.close()
        return

    success = 0
    failed = 0
    skipped = 0

    for i, row in enumerate(rows):
        print(f"[{i+1}/{len(rows)}] [{row['type']}] {row['title'][:60]}")

        if args.dry_run:
            print(f"  PDF: {row['ungated_link'][:70]}...")
            print(f"  Current text: {row['text_len'] or 0} chars")
            success += 1
            continue

        # Extract PDF text
        pdf_text = extract_pdf_text(row['ungated_link'], verbose=args.verbose)

        if not pdf_text or len(pdf_text) < 50:
            print(f"  SKIP: Could not extract text (scanned PDF or empty)")
            cur.execute("""
                UPDATE marketing_content
                SET extraction_error = 'PDF text extraction failed - possibly scanned/image PDF'
                WHERE id = %s
            """, (row['id'],))
            conn.commit()
            skipped += 1
            continue

        print(f"  Extracted {len(pdf_text)} chars")

        # Prepare update fields
        update_fields = {
            'extracted_text': pdf_text[:5000],
            'extraction_error': None,
            'content_analyzed_at': datetime.utcnow(),
        }

        # Optionally re-enrich with AI
        if args.re_enrich:
            ai_result = enrich_with_ai(row['title'], row['type'], pdf_text, verbose=args.verbose)
            if ai_result:
                if ai_result.get('enhanced_summary'):
                    update_fields['enhanced_summary'] = ai_result['enhanced_summary']
                if ai_result.get('auto_tags'):
                    tags = ai_result['auto_tags']
                    if isinstance(tags, list):
                        tags = ', '.join(tags)
                    update_fields['auto_tags'] = tags

        # Update database
        set_clause = ', '.join(f"{k} = %s" for k in update_fields.keys())
        values = list(update_fields.values()) + [row['id']]

        cur.execute(f"""
            UPDATE marketing_content
            SET {set_clause}
            WHERE id = %s
        """, values)
        conn.commit()

        success += 1
        print(f"  Updated")

        # Rate limit
        delay = 1.0 if args.re_enrich else 0.3
        if i < len(rows) - 1:
            time.sleep(delay)

    conn.close()

    print("\n" + "=" * 60)
    action = "Would process" if args.dry_run else "Processed"
    print(f"{action}: {success} records")
    if failed:
        print(f"Failed: {failed}")
    if skipped:
        print(f"Skipped (no text): {skipped}")
    print("=" * 60)

    if args.dry_run:
        print("\nRun without --dry-run to apply changes.")
        if not args.re_enrich:
            print("Add --re-enrich to also regenerate AI tags and summaries.")


if __name__ == '__main__':
    main()

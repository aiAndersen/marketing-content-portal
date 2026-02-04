#!/usr/bin/env python3
"""
Enrich HubSpot PDF content with AI-generated tags and summaries.

This script:
1. Finds HubSpot PDFs that haven't been enriched yet
2. Downloads and extracts text from each PDF
3. Uses OpenAI to generate relevant tags and enhanced summaries
4. Updates the database with the enriched data
"""

import os
import sys
import io
import re
import time
import requests
import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from openai import OpenAI
from datetime import datetime

# PDF extraction
try:
    import PyPDF2
except ImportError:
    print("Installing PyPDF2...")
    os.system('pip install PyPDF2')
    import PyPDF2

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

if not OPENAI_API_KEY:
    print("ERROR: OPENAI_API_KEY not set in environment")
    sys.exit(1)

openai_client = OpenAI(api_key=OPENAI_API_KEY)


def get_db_connection():
    """Create database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def extract_pdf_text(url: str, max_chars: int = 8000) -> str:
    """Download and extract text from a PDF URL."""
    try:
        print(f"    Downloading PDF...")
        response = requests.get(url, timeout=30)
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
                print(f"    Warning: Could not extract page {i+1}: {e}")
                continue

        full_text = "\n".join(text_parts)

        # Clean up the text
        full_text = re.sub(r'\s+', ' ', full_text)
        full_text = full_text.strip()

        print(f"    Extracted {len(full_text)} characters from {len(reader.pages)} pages")
        return full_text[:max_chars]

    except Exception as e:
        print(f"    ERROR extracting PDF: {e}")
        return ""


def generate_tags_and_summary(title: str, content_type: str, text: str) -> dict:
    """Use OpenAI to generate relevant tags and an enhanced summary."""

    prompt = f"""Analyze this SchooLinks marketing PDF content and generate:
1. Relevant keyword tags (5-10 tags)
2. A concise 2-3 sentence summary optimized for search

PDF Title: {title}
Content Type: {content_type}

Extracted Text:
{text[:6000]}

Generate tags from these categories (only include tags that are ACTUALLY mentioned or clearly relevant):

**Personas/Audiences:**
- counselors, administrators, CTE coordinators, students, parents, teachers, district leaders

**Topics/Features:**
- career exploration, college readiness, work-based learning, FAFSA, financial aid
- graduation requirements, course planning, student portfolios, assessments
- CTE pathways, credentials, certificates, internships, job shadows
- college applications, scholarship matching, transcript management
- CCMR (College Career Military Readiness), ACP (Academic Career Plan)
- ICAP, CCR (College Career Readiness), ECAP

**Competitors (only if mentioned):**
- Naviance, Xello, MajorClarity, PowerSchool, Scoir, Cialfo

**State-specific (only if mentioned):**
- Texas, Virginia, Utah, Nebraska, Wisconsin, Arizona, etc.

**Product Features:**
- AI-powered, analytics, reporting, dashboards, mobile app
- family portal, intermediary accounts, credential wallet

Respond with valid JSON only:
{{
  "tags": ["tag1", "tag2", "tag3", ...],
  "summary": "A concise 2-3 sentence summary of this content piece."
}}"""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=500
        )

        content = response.choices[0].message.content.strip()

        # Parse JSON response
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            import json
            result = json.loads(json_match.group())
            return {
                "tags": result.get("tags", []),
                "summary": result.get("summary", "")
            }

        return {"tags": [], "summary": ""}

    except Exception as e:
        print(f"    ERROR generating tags: {e}")
        return {"tags": [], "summary": ""}


def enrich_content(conn, content_id: str, title: str, content_type: str, url: str):
    """Enrich a single content item with extracted text, tags, and summary."""

    print(f"\n  Processing: {title}")

    # Step 1: Extract text from PDF
    extracted_text = extract_pdf_text(url)

    if not extracted_text:
        # Update with error
        cur = conn.cursor()
        cur.execute("""
            UPDATE marketing_content
            SET extraction_error = 'Could not extract text from PDF',
                content_analyzed_at = NOW()
            WHERE id = %s
        """, (content_id,))
        conn.commit()
        print("    Skipped - could not extract text")
        return False

    # Step 2: Generate tags and summary with AI
    print("    Generating tags and summary with AI...")
    result = generate_tags_and_summary(title, content_type, extracted_text)

    tags = result.get("tags", [])
    summary = result.get("summary", "")

    # Format tags as comma-separated string
    tags_str = ", ".join(tags) if tags else ""

    print(f"    Generated {len(tags)} tags: {tags_str[:80]}{'...' if len(tags_str) > 80 else ''}")
    print(f"    Summary: {summary[:100]}{'...' if len(summary) > 100 else ''}")

    # Step 3: Update database
    cur = conn.cursor()
    cur.execute("""
        UPDATE marketing_content
        SET extracted_text = %s,
            auto_tags = %s,
            enhanced_summary = %s,
            content_analyzed_at = NOW(),
            extraction_error = NULL
        WHERE id = %s
    """, (extracted_text[:5000], tags_str, summary, content_id))
    conn.commit()

    print("    ✓ Updated database")
    return True


def main():
    print("=" * 60)
    print("HubSpot PDF Enrichment")
    print("=" * 60)

    conn = get_db_connection()
    cur = conn.cursor()

    # Find HubSpot PDFs needing enrichment
    cur.execute("""
        SELECT id, title, type, ungated_link
        FROM marketing_content
        WHERE (platform = 'HubSpot' OR ungated_link LIKE '%hubspot%')
          AND type IN ('1-Pager', 'Ebook', 'Customer Story')
          AND (extracted_text IS NULL OR extracted_text = '')
          AND ungated_link IS NOT NULL
          AND ungated_link != ''
        ORDER BY created_at DESC
    """)

    items = cur.fetchall()

    if not items:
        print("\nNo HubSpot PDFs need enrichment. All done!")
        return

    print(f"\nFound {len(items)} PDFs to enrich:\n")
    for item in items:
        print(f"  - {item['title'][:50]} ({item['type']})")

    print(f"\nStarting enrichment...")

    success = 0
    failed = 0

    for i, item in enumerate(items):
        print(f"\n[{i+1}/{len(items)}]")

        try:
            if enrich_content(conn, item['id'], item['title'], item['type'], item['ungated_link']):
                success += 1
            else:
                failed += 1
        except Exception as e:
            print(f"    ERROR: {e}")
            failed += 1

        # Rate limit
        if i < len(items) - 1:
            time.sleep(0.5)

    print("\n" + "=" * 60)
    print("Enrichment Complete")
    print("=" * 60)
    print(f"Successfully enriched: {success}")
    print(f"Failed: {failed}")

    conn.close()


if __name__ == '__main__':
    main()

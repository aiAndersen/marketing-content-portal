#!/usr/bin/env python3
"""
State-Specific Context Import Script

Imports state-specific SchooLinks messaging and context from markdown files
into the ai_context table for use by the AI Search Assistant.

Usage:
    python import_state_context.py              # Import all state context files
    python import_state_context.py --dry-run    # Preview without changes
    python import_state_context.py --state TX   # Import specific state only
"""

import os
import sys
import argparse
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional
import hashlib

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

DATABASE_URL = os.getenv('DATABASE_URL')

# State code mapping for file name detection
STATE_CODES = {
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

STATE_NAMES = {v: k.title() for k, v in STATE_CODES.items()}


def get_db_connection():
    """Create database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def detect_state_from_filename(filename: str) -> Optional[str]:
    """Extract state code from filename."""
    filename_lower = filename.lower()

    # Try to match state names in filename
    for state_name, code in STATE_CODES.items():
        if state_name.replace(' ', '_') in filename_lower or state_name.replace(' ', '') in filename_lower:
            return code

    # Try 2-letter codes
    match = re.search(r'\b([A-Z]{2})\b', filename)
    if match and match.group(1) in STATE_NAMES:
        return match.group(1)

    return None


def extract_sections(content: str) -> List[Dict]:
    """Extract major sections from markdown content."""
    sections = []
    current_section = None
    current_content = []

    for line in content.split('\n'):
        # Check for h1 or h2 headers
        if line.startswith('## ') or line.startswith('# '):
            if current_section:
                sections.append({
                    'title': current_section,
                    'content': '\n'.join(current_content).strip()
                })
            current_section = line.lstrip('#').strip()
            current_content = []
        else:
            current_content.append(line)

    # Don't forget the last section
    if current_section:
        sections.append({
            'title': current_section,
            'content': '\n'.join(current_content).strip()
        })

    return sections


def extract_key_terms(content: str, state_code: str) -> List[str]:
    """Extract key terms and acronyms from the content."""
    terms = set()

    # State-specific acronyms and terms (common patterns)
    acronyms = re.findall(r'\b[A-Z]{2,6}\b', content)
    for acr in acronyms:
        if acr not in ['THE', 'AND', 'FOR', 'NOT', 'ARE', 'BUT', 'THIS', 'THAT']:
            terms.add(acr)

    # SchooLinks features mentioned
    features = ['KRI', 'PLP', 'CAM', 'WBL', 'Course Planner', 'FAFSA', 'CTE',
                'CCMR', 'IBC', 'ICAP', 'POS', 'endorsement', 'graduation']
    for feature in features:
        if feature.lower() in content.lower():
            terms.add(feature)

    # State initiatives
    state_terms = {
        'TX': ['HB 5', 'HB 773', 'HB 3', 'CCMR', 'TEA', 'PEIMS', 'ECHS', 'P-TECH', 'FHSP'],
        'CO': ['ICAP', 'MyColoradoJourney', 'MCJ', 'QCPF', 'CDE'],
        'MI': ['MICIP', 'EDP', 'MME'],
    }

    if state_code in state_terms:
        for term in state_terms[state_code]:
            if term.lower() in content.lower():
                terms.add(term)

    return list(terms)[:20]  # Limit to 20 terms


def generate_summary(content: str, state_code: str) -> str:
    """Generate a summary for the state context."""
    # Extract the first paragraph after the main title
    lines = content.split('\n')
    summary_lines = []

    for line in lines:
        line = line.strip()
        if line and not line.startswith('#') and not line.startswith('*') and not line.startswith('---'):
            summary_lines.append(line)
            if len(' '.join(summary_lines)) > 300:
                break

    summary = ' '.join(summary_lines)[:500]

    # Clean up markdown formatting
    summary = re.sub(r'\*\*([^*]+)\*\*', r'\1', summary)  # Remove bold
    summary = re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', summary)  # Remove links

    return summary


def import_state_context(conn, file_path: Path, dry_run: bool = False) -> bool:
    """Import a single state context file into ai_context."""
    filename = file_path.name
    state_code = detect_state_from_filename(filename)

    if not state_code:
        print(f"  ⚠ Could not detect state from filename: {filename}")
        return False

    state_name = STATE_NAMES.get(state_code, state_code)

    # Read file content
    try:
        content = file_path.read_text(encoding='utf-8')
    except Exception as e:
        print(f"  ✗ Error reading file: {e}")
        return False

    if len(content.strip()) < 100:
        print(f"  ⚠ File too short, skipping: {filename}")
        return False

    # Extract title from first h1
    title_match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
    title = title_match.group(1) if title_match else f"SchooLinks {state_name} Context"

    # Generate metadata
    key_terms = extract_key_terms(content, state_code)
    summary = generate_summary(content, state_code)

    print(f"  State: {state_name} ({state_code})")
    print(f"  Title: {title[:60]}...")
    print(f"  Terms: {', '.join(key_terms[:5])}...")
    print(f"  Content length: {len(content):,} chars")

    if dry_run:
        print(f"  [DRY RUN] Would import")
        return True

    with conn.cursor() as cur:
        # Check if context for this state already exists
        cur.execute("""
            SELECT id FROM ai_context
            WHERE category = 'state_context' AND subcategory = %s
        """, (state_code,))
        existing = cur.fetchone()

        if existing:
            # Update existing record
            cur.execute("""
                UPDATE ai_context SET
                    title = %s,
                    content = %s,
                    summary = %s,
                    source_file = %s,
                    tags = %s,
                    updated_at = %s
                WHERE id = %s
            """, (
                title,
                content,
                summary,
                str(file_path),
                key_terms,
                datetime.utcnow(),
                existing['id']
            ))
            print(f"  ✓ Updated existing context")
        else:
            # Insert new record
            cur.execute("""
                INSERT INTO ai_context (
                    category, subcategory, title, content, summary,
                    source_type, source_file, tags, confidence, is_verified,
                    created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                'state_context',
                state_code,
                title,
                content,
                summary,
                'markdown_file',
                str(file_path),
                key_terms,
                1.0,  # High confidence for manually curated content
                True,  # Verified by user
                datetime.utcnow(),
                datetime.utcnow()
            ))
            print(f"  ✓ Inserted new context")

        conn.commit()
        return True


def import_baseline_context(conn, file_path: Path, dry_run: bool = False) -> bool:
    """Import the baseline SchooLinks context."""
    try:
        content = file_path.read_text(encoding='utf-8')
    except Exception as e:
        print(f"  ✗ Error reading file: {e}")
        return False

    # Extract title
    title_match = re.search(r'^#\s+(.+)$', content, re.MULTILINE)
    title = title_match.group(1) if title_match else "SchooLinks Baseline Context"

    key_terms = ['SchooLinks', 'CCR', 'Naviance', 'Xello', 'MajorClarity',
                 'KRI', 'PLP', 'FAFSA', 'WBL', 'CTE', 'Course Planner']
    summary = "Comprehensive baseline training and knowledge base for SchooLinks positioning, features, competitors, and messaging."

    print(f"  Title: {title[:60]}...")
    print(f"  Content length: {len(content):,} chars")

    if dry_run:
        print(f"  [DRY RUN] Would import")
        return True

    with conn.cursor() as cur:
        # Check if baseline context exists
        cur.execute("""
            SELECT id FROM ai_context
            WHERE category = 'baseline' AND subcategory = 'schoolinks'
        """)
        existing = cur.fetchone()

        if existing:
            cur.execute("""
                UPDATE ai_context SET
                    title = %s,
                    content = %s,
                    summary = %s,
                    source_file = %s,
                    tags = %s,
                    updated_at = %s
                WHERE id = %s
            """, (
                title,
                content,
                summary,
                str(file_path),
                key_terms,
                datetime.utcnow(),
                existing['id']
            ))
            print(f"  ✓ Updated existing baseline context")
        else:
            cur.execute("""
                INSERT INTO ai_context (
                    category, subcategory, title, content, summary,
                    source_type, source_file, tags, confidence, is_verified,
                    created_at, updated_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                'baseline',
                'schoolinks',
                title,
                content,
                summary,
                'markdown_file',
                str(file_path),
                key_terms,
                1.0,
                True,
                datetime.utcnow(),
                datetime.utcnow()
            ))
            print(f"  ✓ Inserted baseline context")

        conn.commit()
        return True


def main():
    parser = argparse.ArgumentParser(description='Import state-specific context for AI Search')
    parser.add_argument('--dry-run', action='store_true', help='Preview without making changes')
    parser.add_argument('--state', type=str, help='Import specific state only (e.g., TX, CO)')
    parser.add_argument('--include-baseline', action='store_true', help='Also import baseline context')
    args = parser.parse_args()

    print("=" * 60)
    print("State-Specific Context Import")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    # Define paths
    base_path = Path(__file__).parent.parent / "SchooLinks Baseline Context"
    state_context_path = base_path / "State Specific Context"
    baseline_file = base_path / "SL_baseline_context_AIAgents.md"

    if not state_context_path.exists():
        print(f"ERROR: State context folder not found: {state_context_path}")
        sys.exit(1)

    conn = get_db_connection()
    print("✓ Connected to database")

    # Import baseline context if requested
    if args.include_baseline and baseline_file.exists():
        print(f"\n=== IMPORTING BASELINE CONTEXT ===")
        import_baseline_context(conn, baseline_file, dry_run=args.dry_run)

    # Find all markdown files
    md_files = list(state_context_path.glob("*.md"))
    print(f"\n=== IMPORTING STATE CONTEXT ===")
    print(f"Found {len(md_files)} markdown files")

    imported = 0
    skipped = 0
    errors = 0

    for file_path in sorted(md_files):
        filename = file_path.name
        state_code = detect_state_from_filename(filename)

        # Filter by state if specified
        if args.state and state_code != args.state.upper():
            continue

        print(f"\nProcessing: {filename}")

        if import_state_context(conn, file_path, dry_run=args.dry_run):
            imported += 1
        else:
            errors += 1

    conn.close()

    print("\n" + "=" * 60)
    print("IMPORT SUMMARY")
    print("=" * 60)
    print(f"  Files processed: {imported + errors}")
    print(f"  Successfully imported: {imported}")
    print(f"  Errors: {errors}")
    print("=" * 60)


if __name__ == '__main__':
    main()

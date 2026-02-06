#!/usr/bin/env python3
"""
Content Submission Agent Self-Improvement Tool
==============================================

An end-to-end agent that analyzes and improves the Content Submission AI Assistant.
Uses OpenAI to intelligently analyze issues and suggest improvements.

Usage:
    python scripts/submission_agent_improver.py                    # Full analysis
    python scripts/submission_agent_improver.py --fix-tags         # Fix redundant tags
    python scripts/submission_agent_improver.py --fix-spelling     # Fix brand misspellings
    python scripts/submission_agent_improver.py --analyze-prompt   # Analyze SYSTEM_PROMPT quality
    python scripts/submission_agent_improver.py --suggest-terms    # AI-powered terminology suggestions
    python scripts/submission_agent_improver.py --all --apply      # Run all fixes

Environment:
    OPENAI_API_KEY - Your OpenAI API key (or set in .env file)
    DATABASE_URL   - PostgreSQL connection string

This agent is designed to be called anytime to continuously improve
the content submission AI assistant's quality.
"""

import os
import sys
import json
import re
import argparse
from datetime import datetime
from collections import Counter

import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Try to import OpenAI
try:
    from openai import OpenAI
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False
    print("Warning: openai package not installed. AI-powered features disabled.")
    print("Install with: pip install openai")


# ============================================
# CONFIGURATION
# ============================================

CORRECT_BRAND = 'SchooLinks'
BRAND_MISSPELLINGS = ['schoollinks', 'school links', 'scholinks', 'schoLinks', 'Schoolinks']

REDUNDANT_TAG_TERMS = {
    'schoolinks', 'schoollinks', 'school links', 'sl',
    'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id',
    'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms',
    'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok',
    'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv',
    'wi', 'wy', 'national', 'texas', 'california', 'florida', 'new york',
    'ohio', 'illinois', 'pennsylvania', 'georgia', 'michigan', 'north carolina',
    'blog', 'video', 'video clip', 'customer story', '1-pager', 'ebook',
    'webinar', 'press release', 'award', 'landing page', 'asset',
    'education', 'edtech', 'k-12', 'k12', 'students', 'schools', 'learning',
}

AI_ASSISTANT_PATH = os.path.join(
    os.path.dirname(__file__), '..', 'content-submission', 'ai-assistant.js'
)


# ============================================
# DATABASE CONNECTION
# ============================================

def get_connection():
    """Get database connection from environment."""
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        raise ValueError("DATABASE_URL environment variable not set")
    return psycopg2.connect(database_url)


def get_openai_client():
    """Get OpenAI client."""
    if not OPENAI_AVAILABLE:
        return None

    api_key = os.getenv('OPENAI_API_KEY')
    if not api_key:
        print("Warning: OPENAI_API_KEY not set. AI-powered features disabled.")
        return None

    return OpenAI(api_key=api_key)


# ============================================
# TAG ANALYSIS & FIXING
# ============================================

def analyze_tags():
    """Analyze all content for tag quality issues."""
    conn = get_connection()
    cur = conn.cursor()

    cur.execute('''
        SELECT id, title, type, state, tags
        FROM marketing_content
        WHERE tags IS NOT NULL AND tags != ''
    ''')
    content = cur.fetchall()
    cur.close()
    conn.close()

    issues = []
    for row in content:
        content_id, title, content_type, state, tags = row
        tag_list = [t.strip().lower() for t in (tags or '').split(',')]

        content_issues = []
        for tag in tag_list:
            # Check for brand name
            if 'schoolinks' in tag or 'school links' in tag:
                content_issues.append(f"Brand name '{tag}' in tags")
            # Check for state
            if state and tag == state.lower():
                content_issues.append(f"State '{tag}' duplicated in tags")
            # Check for type
            if content_type and tag == content_type.lower():
                content_issues.append(f"Type '{tag}' duplicated in tags")
            # Check for generic terms
            if tag in REDUNDANT_TAG_TERMS:
                content_issues.append(f"Generic term '{tag}'")

        if content_issues:
            issues.append({
                'id': content_id,
                'title': title[:60] + '...' if len(title) > 60 else title,
                'issues': content_issues
            })

    return issues


def fix_tags(dry_run=True):
    """Fix redundant tags in the database."""
    conn = get_connection()
    cur = conn.cursor()

    cur.execute('''
        SELECT id, title, type, state, tags
        FROM marketing_content
        WHERE tags IS NOT NULL AND tags != ''
    ''')
    content = cur.fetchall()

    fixed_count = 0
    for row in content:
        content_id, title, content_type, state, tags = row
        original_tags = tags
        tag_list = [t.strip() for t in tags.split(',')]

        # Build exclusion set
        exclude = set(REDUNDANT_TAG_TERMS)
        if state:
            exclude.add(state.lower())
        if content_type:
            exclude.add(content_type.lower())

        # Filter tags
        filtered = [t for t in tag_list if t.lower() not in exclude]
        new_tags = ', '.join(filtered)

        if new_tags != original_tags:
            fixed_count += 1
            print(f"  [{content_id[:8]}] {title[:50]}...")
            print(f"    Before: {original_tags[:80]}...")
            print(f"    After:  {new_tags[:80]}...")

            if not dry_run:
                cur.execute('UPDATE marketing_content SET tags = %s WHERE id = %s',
                           (new_tags, content_id))

    if not dry_run:
        conn.commit()

    cur.close()
    conn.close()

    return fixed_count


# ============================================
# BRAND SPELLING ANALYSIS & FIXING
# ============================================

def analyze_brand_spelling():
    """Find content with misspelled brand name."""
    conn = get_connection()
    cur = conn.cursor()

    cur.execute('SELECT id, title, summary FROM marketing_content')
    content = cur.fetchall()
    cur.close()
    conn.close()

    issues = []
    for row in content:
        content_id, title, summary = row
        combined = f"{title or ''} {summary or ''}".lower()

        for misspelling in BRAND_MISSPELLINGS:
            if misspelling.lower() in combined:
                issues.append({
                    'id': content_id,
                    'title': title[:60] + '...' if len(title) > 60 else title,
                    'misspelling': misspelling,
                    'in_title': misspelling.lower() in (title or '').lower(),
                    'in_summary': misspelling.lower() in (summary or '').lower()
                })
                break

    return issues


def fix_brand_spelling(dry_run=True):
    """Fix brand spelling in titles and summaries."""
    conn = get_connection()
    cur = conn.cursor()

    cur.execute('SELECT id, title, summary FROM marketing_content')
    content = cur.fetchall()

    fixed_count = 0
    for row in content:
        content_id, title, summary = row
        new_title = title
        new_summary = summary

        # Fix title
        if title:
            for misspelling in BRAND_MISSPELLINGS:
                pattern = re.compile(re.escape(misspelling), re.IGNORECASE)
                new_title = pattern.sub(CORRECT_BRAND, new_title)

        # Fix summary
        if summary:
            for misspelling in BRAND_MISSPELLINGS:
                pattern = re.compile(re.escape(misspelling), re.IGNORECASE)
                new_summary = pattern.sub(CORRECT_BRAND, new_summary)

        if new_title != title or new_summary != summary:
            fixed_count += 1
            print(f"  [{content_id[:8]}] Fixed brand spelling")
            if new_title != title:
                print(f"    Title: {title[:60]} -> {new_title[:60]}")
            if new_summary != summary:
                print(f"    Summary: (updated)")

            if not dry_run:
                cur.execute('''
                    UPDATE marketing_content
                    SET title = %s, summary = %s
                    WHERE id = %s
                ''', (new_title, new_summary, content_id))

    if not dry_run:
        conn.commit()

    cur.close()
    conn.close()

    return fixed_count


# ============================================
# AI-POWERED PROMPT ANALYSIS
# ============================================

def analyze_system_prompt():
    """Use AI to analyze the SYSTEM_PROMPT quality and suggest improvements."""
    client = get_openai_client()
    if not client:
        print("OpenAI client not available. Skipping prompt analysis.")
        return None

    # Read the current ai-assistant.js
    with open(AI_ASSISTANT_PATH, 'r') as f:
        content = f.read()

    # Extract SYSTEM_PROMPT
    match = re.search(r'const SYSTEM_PROMPT = `(.*?)`;', content, re.DOTALL)
    if not match:
        print("Could not find SYSTEM_PROMPT in ai-assistant.js")
        return None

    system_prompt = match.group(1)

    analysis_prompt = f"""Analyze this SYSTEM_PROMPT for a content submission AI assistant and suggest improvements.

CURRENT SYSTEM_PROMPT:
{system_prompt}

Analyze for:
1. Clarity of instructions
2. Completeness of content type definitions
3. Quality of tagging guidelines
4. Brand name spelling consistency (should be "SchooLinks")
5. Edge cases that might confuse the AI
6. Any contradictions or ambiguities

Provide:
1. Overall quality score (1-10)
2. Top 3 strengths
3. Top 3 areas for improvement
4. Specific suggested changes (if any)

Format as JSON:
{{
  "score": 8,
  "strengths": ["...", "...", "..."],
  "improvements": ["...", "...", "..."],
  "suggestions": ["...", "..."]
}}"""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an expert at analyzing and improving AI prompts."},
                {"role": "user", "content": analysis_prompt}
            ],
            temperature=0.3,
            max_tokens=1500
        )

        result_text = response.choices[0].message.content
        # Extract JSON from response
        json_match = re.search(r'\{[\s\S]*\}', result_text)
        if json_match:
            return json.loads(json_match.group())
        return {"raw_response": result_text}

    except Exception as e:
        print(f"Error analyzing prompt: {e}")
        return None


# ============================================
# AI-POWERED TERMINOLOGY SUGGESTIONS
# ============================================

def suggest_terminology_mappings():
    """Use AI to suggest new terminology mappings based on search patterns."""
    client = get_openai_client()
    if not client:
        print("OpenAI client not available. Skipping terminology suggestions.")
        return []

    conn = get_connection()
    cur = conn.cursor()

    # Check if ai_prompt_logs exists
    cur.execute('''
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'ai_prompt_logs'
        )
    ''')
    if not cur.fetchone()[0]:
        print("ai_prompt_logs table not found. Skipping terminology suggestions.")
        cur.close()
        conn.close()
        return []

    # Get recent search queries
    cur.execute('''
        SELECT query FROM ai_prompt_logs
        WHERE timestamp > NOW() - INTERVAL '14 days'
        LIMIT 200
    ''')
    queries = [row[0] for row in cur.fetchall() if row[0]]

    # Get existing mappings
    cur.execute('SELECT user_term, canonical_term FROM terminology_map WHERE is_active = true')
    existing = {row[0].lower(): row[1] for row in cur.fetchall()}

    cur.close()
    conn.close()

    if not queries:
        print("No recent queries found.")
        return []

    # Use AI to analyze queries and suggest mappings
    suggestion_prompt = f"""Analyze these search queries from a marketing content database and suggest terminology mappings.

RECENT SEARCH QUERIES:
{chr(10).join(queries[:100])}

EXISTING MAPPINGS (sample):
{json.dumps(dict(list(existing.items())[:20]), indent=2)}

The database contains marketing content about SchooLinks (an education technology company).
Content types: Blog, Video, Video Clip, Customer Story, 1-Pager, Ebook, Webinar, Press Release, Award, Landing Page, Asset

Suggest new terminology mappings that would help users find content more easily.
Focus on:
1. Common misspellings
2. Synonyms for content types
3. Industry jargon → standard terms
4. Abbreviations → full terms

Return as JSON array:
[
  {{"user_term": "one pager", "canonical_term": "1-Pager", "confidence": 0.95, "reason": "Common synonym"}},
  ...
]

Only suggest high-confidence mappings (0.8+) that aren't already mapped."""

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are an expert at search optimization and terminology mapping."},
                {"role": "user", "content": suggestion_prompt}
            ],
            temperature=0.3,
            max_tokens=1500
        )

        result_text = response.choices[0].message.content
        json_match = re.search(r'\[[\s\S]*\]', result_text)
        if json_match:
            suggestions = json.loads(json_match.group())
            # Filter out existing mappings
            new_suggestions = [
                s for s in suggestions
                if s.get('user_term', '').lower() not in existing
            ]
            return new_suggestions
        return []

    except Exception as e:
        print(f"Error generating terminology suggestions: {e}")
        return []


# ============================================
# COMPREHENSIVE REPORT
# ============================================

def generate_full_report():
    """Generate a comprehensive self-improvement report."""
    print("=" * 70)
    print("CONTENT SUBMISSION AGENT SELF-IMPROVEMENT REPORT")
    print(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 70)

    report = {
        'generated_at': datetime.now().isoformat(),
        'tag_issues': [],
        'brand_issues': [],
        'prompt_analysis': None,
        'terminology_suggestions': []
    }

    # 1. Tag Analysis
    print("\n[1/4] Analyzing tag quality...")
    tag_issues = analyze_tags()
    report['tag_issues'] = tag_issues[:50]
    print(f"      Found {len(tag_issues)} content items with tag issues")

    # 2. Brand Spelling
    print("\n[2/4] Checking brand spelling...")
    brand_issues = analyze_brand_spelling()
    report['brand_issues'] = brand_issues
    print(f"      Found {len(brand_issues)} items with brand misspellings")

    # 3. Prompt Analysis (AI-powered)
    print("\n[3/4] Analyzing SYSTEM_PROMPT quality...")
    prompt_analysis = analyze_system_prompt()
    report['prompt_analysis'] = prompt_analysis
    if prompt_analysis and 'score' in prompt_analysis:
        print(f"      Prompt quality score: {prompt_analysis['score']}/10")

    # 4. Terminology Suggestions (AI-powered)
    print("\n[4/4] Generating terminology suggestions...")
    terminology = suggest_terminology_mappings()
    report['terminology_suggestions'] = terminology
    print(f"      Generated {len(terminology)} new term suggestions")

    # Save report
    report_path = os.path.join(
        os.path.dirname(__file__),
        f"agent_improvement_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )
    with open(report_path, 'w') as f:
        json.dump(report, f, indent=2)

    # Print summary
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"Tag issues:              {len(report['tag_issues'])}")
    print(f"Brand spelling issues:   {len(report['brand_issues'])}")
    print(f"Terminology suggestions: {len(report['terminology_suggestions'])}")
    if prompt_analysis and 'score' in prompt_analysis:
        print(f"Prompt quality score:    {prompt_analysis['score']}/10")
    print(f"\nReport saved: {report_path}")

    # Print actionable items
    if tag_issues:
        print("\n--- Tag Issues (run --fix-tags to fix) ---")
        for issue in tag_issues[:3]:
            print(f"  {issue['title']}")
            print(f"    Issues: {', '.join(issue['issues'][:2])}")

    if brand_issues:
        print("\n--- Brand Spelling (run --fix-spelling to fix) ---")
        for issue in brand_issues[:3]:
            loc = []
            if issue['in_title']: loc.append('title')
            if issue['in_summary']: loc.append('summary')
            print(f"  {issue['title']}")
            print(f"    '{issue['misspelling']}' in {', '.join(loc)}")

    if prompt_analysis and 'improvements' in prompt_analysis:
        print("\n--- Prompt Improvements ---")
        for imp in prompt_analysis.get('improvements', [])[:3]:
            print(f"  - {imp}")

    if terminology:
        print("\n--- Suggested Terminology Mappings ---")
        for term in terminology[:5]:
            print(f"  '{term['user_term']}' -> '{term['canonical_term']}' ({term.get('reason', 'N/A')})")

    return report


# ============================================
# MAIN
# ============================================

def main():
    parser = argparse.ArgumentParser(
        description='Content Submission Agent Self-Improvement Tool',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python submission_agent_improver.py                    # Full analysis report
  python submission_agent_improver.py --fix-tags         # Preview tag fixes
  python submission_agent_improver.py --fix-tags --apply # Apply tag fixes
  python submission_agent_improver.py --fix-spelling --apply  # Fix brand spelling
  python submission_agent_improver.py --analyze-prompt   # AI analysis of SYSTEM_PROMPT
  python submission_agent_improver.py --suggest-terms    # AI terminology suggestions
  python submission_agent_improver.py --all --apply      # Run all fixes
        """
    )

    parser.add_argument('--fix-tags', action='store_true',
                       help='Fix redundant tags in database')
    parser.add_argument('--fix-spelling', action='store_true',
                       help='Fix brand spelling in titles/summaries')
    parser.add_argument('--analyze-prompt', action='store_true',
                       help='AI-powered analysis of SYSTEM_PROMPT')
    parser.add_argument('--suggest-terms', action='store_true',
                       help='AI-powered terminology suggestions')
    parser.add_argument('--all', action='store_true',
                       help='Run all fixes')
    parser.add_argument('--apply', action='store_true',
                       help='Apply changes (without this, runs in dry-run mode)')

    args = parser.parse_args()

    dry_run = not args.apply
    if dry_run and (args.fix_tags or args.fix_spelling or args.all):
        print("DRY RUN MODE - No changes will be made. Use --apply to apply changes.\n")

    # Run specific actions or full report
    if args.fix_tags or args.all:
        print("=" * 50)
        print("FIXING REDUNDANT TAGS")
        print("=" * 50)
        count = fix_tags(dry_run=dry_run)
        print(f"\n{'Would fix' if dry_run else 'Fixed'} {count} content items")

    if args.fix_spelling or args.all:
        print("\n" + "=" * 50)
        print("FIXING BRAND SPELLING")
        print("=" * 50)
        count = fix_brand_spelling(dry_run=dry_run)
        print(f"\n{'Would fix' if dry_run else 'Fixed'} {count} content items")

    if args.analyze_prompt:
        print("\n" + "=" * 50)
        print("ANALYZING SYSTEM_PROMPT")
        print("=" * 50)
        analysis = analyze_system_prompt()
        if analysis:
            print(json.dumps(analysis, indent=2))

    if args.suggest_terms:
        print("\n" + "=" * 50)
        print("TERMINOLOGY SUGGESTIONS")
        print("=" * 50)
        suggestions = suggest_terminology_mappings()
        for s in suggestions:
            print(f"  '{s['user_term']}' -> '{s['canonical_term']}' (confidence: {s.get('confidence', 'N/A')})")

    # If no specific action, run full report
    if not any([args.fix_tags, args.fix_spelling, args.analyze_prompt, args.suggest_terms, args.all]):
        generate_full_report()


if __name__ == '__main__':
    main()

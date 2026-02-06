#!/usr/bin/env python3
"""
AI Self-Improvement Agent
Analyzes AI interactions and suggests improvements for the Marketing Content Portal.

Run manually: python scripts/ai_self_improvement.py
Run via cron: 0 2 * * * cd /path/to/portal && python scripts/ai_self_improvement.py

Features:
1. Tag quality analysis - Identify content with redundant or missing tags
2. Brand spelling audit - Find content with misspelled brand name
3. Terminology gap detection - Find user terms not mapped to canonical terms
4. Generates improvement report for admin review
"""

import os
import json
import psycopg2
from datetime import datetime, timedelta
from collections import Counter
from dotenv import load_dotenv

load_dotenv()

# Brand name variations that indicate misspelling
BRAND_MISSPELLINGS = [
    'schoollinks',  # Wrong - has 'l' between school and links
    'school links',  # Wrong - has space
    'scholinks',    # Wrong - missing 'o'
    'schoLinks',    # Wrong - wrong capitalization
]

CORRECT_BRAND = 'SchooLinks'

# Terms that should NOT appear in tags
REDUNDANT_TAG_TERMS = {
    # Brand (all content is SchooLinks)
    'schoolinks', 'schoollinks', 'school links',
    # State abbreviations (captured in state field)
    'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id',
    'il', 'in', 'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms',
    'mo', 'mt', 'ne', 'nv', 'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok',
    'or', 'pa', 'ri', 'sc', 'sd', 'tn', 'tx', 'ut', 'vt', 'va', 'wa', 'wv',
    'wi', 'wy', 'national',
    # Content types (captured in type field)
    'blog', 'video', 'video clip', 'customer story', '1-pager', 'ebook',
    'webinar', 'press release', 'award', 'landing page', 'asset',
    # Generic education terms
    'education', 'edtech', 'k-12', 'k12', 'students', 'schools', 'learning',
}


def get_connection():
    """Get database connection from environment."""
    database_url = os.getenv('DATABASE_URL')
    if not database_url:
        raise ValueError("DATABASE_URL environment variable not set")
    return psycopg2.connect(database_url)


def analyze_tag_quality():
    """Find content with redundant or problematic tags."""
    conn = get_connection()
    cur = conn.cursor()

    cur.execute('''
        SELECT id, title, type, state, tags
        FROM marketing_content
        WHERE tags IS NOT NULL AND tags != ''
    ''')
    content = cur.fetchall()

    issues = []

    for row in content:
        content_id, title, content_type, state, tags = row
        tag_list = [t.strip().lower() for t in (tags or '').split(',')]

        content_issues = []

        # Check for brand name in tags
        for tag in tag_list:
            if 'schoolinks' in tag or 'school links' in tag:
                content_issues.append({
                    'type': 'redundant_brand',
                    'tag': tag,
                    'reason': 'Brand name should not be in tags (all content is SchooLinks)'
                })

        # Check for state in tags
        if state:
            state_lower = state.lower()
            for tag in tag_list:
                if tag == state_lower:
                    content_issues.append({
                        'type': 'redundant_state',
                        'tag': tag,
                        'reason': f'State "{state}" already captured in state field'
                    })

        # Check for content type in tags
        if content_type:
            type_lower = content_type.lower()
            for tag in tag_list:
                if tag == type_lower:
                    content_issues.append({
                        'type': 'redundant_type',
                        'tag': tag,
                        'reason': f'Content type "{content_type}" already captured in type field'
                    })

        # Check for generic terms
        for tag in tag_list:
            if tag in REDUNDANT_TAG_TERMS:
                content_issues.append({
                    'type': 'generic_term',
                    'tag': tag,
                    'reason': 'Generic term provides no specific value'
                })

        if content_issues:
            issues.append({
                'content_id': content_id,
                'title': title[:80] + '...' if len(title) > 80 else title,
                'current_tags': tags,
                'issues': content_issues
            })

    cur.close()
    conn.close()

    return issues


def analyze_brand_spelling():
    """Find content with misspelled brand name in title or summary."""
    conn = get_connection()
    cur = conn.cursor()

    cur.execute('''
        SELECT id, title, summary
        FROM marketing_content
    ''')
    content = cur.fetchall()

    issues = []

    for row in content:
        content_id, title, summary = row
        combined_text = f"{title or ''} {summary or ''}".lower()

        for misspelling in BRAND_MISSPELLINGS:
            if misspelling in combined_text:
                # Determine where the misspelling is
                location = []
                if title and misspelling in title.lower():
                    location.append('title')
                if summary and misspelling in summary.lower():
                    location.append('summary')

                issues.append({
                    'content_id': content_id,
                    'title': title[:80] + '...' if len(title) > 80 else title,
                    'misspelling': misspelling,
                    'correct': CORRECT_BRAND,
                    'location': location
                })
                break  # Only report first misspelling found per content

    cur.close()
    conn.close()

    return issues


def analyze_terminology_gaps():
    """Find search terms that aren't mapped in terminology_map."""
    conn = get_connection()
    cur = conn.cursor()

    # Check if ai_prompt_logs table exists
    cur.execute('''
        SELECT EXISTS (
            SELECT FROM information_schema.tables
            WHERE table_name = 'ai_prompt_logs'
        )
    ''')
    if not cur.fetchone()[0]:
        print("Note: ai_prompt_logs table not found, skipping terminology gap analysis")
        cur.close()
        conn.close()
        return []

    # Get recent queries
    cur.execute('''
        SELECT query
        FROM ai_prompt_logs
        WHERE timestamp > NOW() - INTERVAL '7 days'
    ''')
    queries = cur.fetchall()

    # Get existing terminology mappings
    cur.execute('''
        SELECT user_term
        FROM terminology_map
        WHERE is_active = true
    ''')
    existing_terms = {row[0].lower() for row in cur.fetchall()}

    # Count unmapped terms
    term_counts = Counter()

    for (query,) in queries:
        if not query:
            continue
        # Simple word extraction
        words = query.lower().split()
        for word in words:
            # Skip very short words and numbers
            if len(word) < 3 or word.isdigit():
                continue
            if word not in existing_terms:
                term_counts[word] += 1

    # Return terms seen 3+ times that aren't mapped
    suggestions = []
    for term, count in term_counts.most_common(30):
        if count >= 3:
            suggestions.append({
                'term': term,
                'count': count,
                'suggestion': infer_canonical(term)
            })

    cur.close()
    conn.close()

    return suggestions


def infer_canonical(user_term):
    """Infer the canonical term for a user term."""
    mappings = {
        'one pager': '1-Pager',
        'onepager': '1-Pager',
        'fact sheet': '1-Pager',
        'factsheet': '1-Pager',
        'case study': 'Customer Story',
        'casestudy': 'Customer Story',
        'success story': 'Customer Story',
        'white paper': 'Ebook',
        'whitepaper': 'Ebook',
        'e-book': 'Ebook',
        'counselor': 'counselors',
        'counselors': 'counselors',
        'admin': 'administrators',
        'fafsa': 'FAFSA',
        'wbl': 'Work-Based Learning',
        'kri': 'Key Readiness Indicators',
        'plp': 'Personalized Learning Plan',
    }
    return mappings.get(user_term.lower(), f"[Needs mapping: {user_term}]")


def generate_report(output_dir=None):
    """Generate a full self-improvement report."""
    print("=" * 60)
    print("AI Self-Improvement Report")
    print(f"Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    report = {
        'generated_at': datetime.now().isoformat(),
        'tag_issues': [],
        'brand_spelling_issues': [],
        'terminology_gaps': [],
    }

    # Analyze tag quality
    print("\n[1/3] Analyzing tag quality...")
    try:
        report['tag_issues'] = analyze_tag_quality()[:50]  # Limit to 50
        print(f"      Found {len(report['tag_issues'])} content items with tag issues")
    except Exception as e:
        print(f"      Error: {e}")

    # Analyze brand spelling
    print("\n[2/3] Checking brand spelling...")
    try:
        report['brand_spelling_issues'] = analyze_brand_spelling()[:50]
        print(f"      Found {len(report['brand_spelling_issues'])} items with brand misspellings")
    except Exception as e:
        print(f"      Error: {e}")

    # Analyze terminology gaps
    print("\n[3/3] Detecting terminology gaps...")
    try:
        report['terminology_gaps'] = analyze_terminology_gaps()
        print(f"      Found {len(report['terminology_gaps'])} potential terminology gaps")
    except Exception as e:
        print(f"      Error: {e}")

    # Save report
    if output_dir is None:
        output_dir = os.path.dirname(os.path.abspath(__file__))

    output_file = os.path.join(
        output_dir,
        f"self_improvement_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    )

    with open(output_file, 'w') as f:
        json.dump(report, f, indent=2)

    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Tag issues:           {len(report['tag_issues'])}")
    print(f"Brand spelling issues: {len(report['brand_spelling_issues'])}")
    print(f"Terminology gaps:     {len(report['terminology_gaps'])}")
    print(f"\nReport saved to: {output_file}")

    # Print top issues
    if report['tag_issues']:
        print("\n--- Top Tag Issues ---")
        for issue in report['tag_issues'][:5]:
            print(f"  - {issue['title']}")
            for i in issue['issues'][:2]:
                print(f"    Tag '{i['tag']}': {i['reason']}")

    if report['brand_spelling_issues']:
        print("\n--- Brand Spelling Issues ---")
        for issue in report['brand_spelling_issues'][:5]:
            print(f"  - {issue['title']}")
            print(f"    Found '{issue['misspelling']}' in {', '.join(issue['location'])}")

    if report['terminology_gaps']:
        print("\n--- Top Terminology Gaps ---")
        for gap in report['terminology_gaps'][:5]:
            print(f"  - '{gap['term']}' (seen {gap['count']}x) -> {gap['suggestion']}")

    return report


def fix_tag_issues(dry_run=True):
    """Fix redundant tags in the database."""
    if dry_run:
        print("DRY RUN MODE - No changes will be made")

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

        # Build exclusion set for this content
        exclude = set(REDUNDANT_TAG_TERMS)
        if state:
            exclude.add(state.lower())
        if content_type:
            exclude.add(content_type.lower())

        # Filter tags
        filtered_tags = [t for t in tag_list if t.lower() not in exclude]
        new_tags = ', '.join(filtered_tags)

        if new_tags != original_tags:
            fixed_count += 1
            print(f"\nContent ID {content_id}: {title[:50]}...")
            print(f"  Before: {original_tags}")
            print(f"  After:  {new_tags}")

            if not dry_run:
                cur.execute('''
                    UPDATE marketing_content
                    SET tags = %s
                    WHERE id = %s
                ''', (new_tags, content_id))

    if not dry_run:
        conn.commit()

    cur.close()
    conn.close()

    print(f"\n{'Would fix' if dry_run else 'Fixed'} {fixed_count} content items")
    return fixed_count


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='AI Self-Improvement Agent')
    parser.add_argument('--fix-tags', action='store_true',
                       help='Fix redundant tags (use with --apply to actually make changes)')
    parser.add_argument('--apply', action='store_true',
                       help='Apply changes (without this flag, runs in dry-run mode)')
    parser.add_argument('--output-dir', type=str, default=None,
                       help='Directory to save reports')

    args = parser.parse_args()

    if args.fix_tags:
        fix_tag_issues(dry_run=not args.apply)
    else:
        generate_report(args.output_dir)

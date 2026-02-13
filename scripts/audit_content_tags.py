#!/usr/bin/env python3
"""
Content Database Audit Tool

Scans all content in the marketing_content table and identifies tagging
opportunities, enrichment gaps, and overall content health metrics.
Uses gpt-5.2 to analyze a sample of flagged content and prioritize improvements.

Usage:
    python scripts/audit_content_tags.py                    # Full audit
    python scripts/audit_content_tags.py --dry-run -v       # Preview mode
    python scripts/audit_content_tags.py --limit 5          # Limit AI sample
    python scripts/audit_content_tags.py --output report.json
"""

import os
import sys
import json
import argparse
from datetime import datetime
from collections import Counter, defaultdict
from decimal import Decimal

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv
from openai import OpenAI

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

AI_MODEL = 'gpt-5.2'

US_STATES = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
]


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        return super().default(obj)


def get_db_connection():
    """Create a database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def fetch_all_content(conn):
    """Fetch all content records for audit."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, title, type, platform, state, tags, auto_tags,
                   summary, enhanced_summary, extracted_text, keywords,
                   deep_enriched_at, content_analyzed_at, extraction_error,
                   live_link, ungated_link, created_at
            FROM marketing_content
            ORDER BY created_at DESC
        """)
        return cur.fetchall()


def audit_content(records):
    """Analyze all content and produce audit metrics."""
    metrics = {
        'total_content': len(records),
        'missing_tags': 0,
        'missing_keywords': 0,
        'missing_summaries': 0,
        'not_deep_enriched': 0,
        'tagging_opportunities': 0,
        'extraction_errors': 0,
        'no_url': 0,
    }

    type_distribution = Counter()
    state_distribution = Counter()
    platform_distribution = Counter()
    flagged_content = []

    for record in records:
        record_id = record['id']
        title = record['title'] or '(no title)'

        # Content type distribution
        type_distribution[record.get('type') or 'Unknown'] += 1
        state_distribution[record.get('state') or 'Unknown'] += 1
        platform_distribution[record.get('platform') or 'Unknown'] += 1

        issues = []

        # Missing tags
        tags = (record.get('tags') or '').strip()
        if not tags:
            metrics['missing_tags'] += 1
            issues.append('missing_tags')

        # Missing keywords JSONB
        keywords = record.get('keywords')
        has_keywords = keywords and keywords != [] and keywords != '[]'
        if not has_keywords:
            metrics['missing_keywords'] += 1
            issues.append('missing_keywords')

        # Missing summaries
        summary = (record.get('summary') or '').strip()
        enhanced = (record.get('enhanced_summary') or '').strip()
        if not summary and not enhanced:
            metrics['missing_summaries'] += 1
            issues.append('missing_summary')

        # Not deep enriched
        if not record.get('deep_enriched_at'):
            metrics['not_deep_enriched'] += 1
            issues.append('not_deep_enriched')

        # Tagging opportunity: has extracted text but no keywords
        extracted = (record.get('extracted_text') or '').strip()
        if len(extracted) > 100 and not has_keywords:
            metrics['tagging_opportunities'] += 1
            issues.append('tagging_opportunity')

        # Extraction errors
        if record.get('extraction_error'):
            metrics['extraction_errors'] += 1
            issues.append(f"extraction_error: {record['extraction_error'][:60]}")

        # No URL
        if not record.get('live_link') and not record.get('ungated_link'):
            metrics['no_url'] += 1
            issues.append('no_url')

        if issues:
            flagged_content.append({
                'id': str(record_id),
                'title': title[:80],
                'type': record.get('type', 'Unknown'),
                'state': record.get('state', 'Unknown'),
                'issues': issues,
                'has_extracted_text': len(extracted) > 100,
                'extracted_text_length': len(extracted),
            })

    # State coverage analysis
    states_with_content = set()
    for record in records:
        state = record.get('state')
        if state and state.upper() in US_STATES:
            states_with_content.add(state.upper())

    state_coverage = {
        'covered': sorted(list(states_with_content)),
        'missing': sorted([s for s in US_STATES if s not in states_with_content]),
        'coverage_pct': round(len(states_with_content) / len(US_STATES) * 100, 1),
    }

    return {
        'metrics': metrics,
        'type_distribution': dict(type_distribution.most_common()),
        'state_distribution': dict(state_distribution.most_common()),
        'platform_distribution': dict(platform_distribution.most_common()),
        'state_coverage': state_coverage,
        'flagged_content': flagged_content,
    }


def ai_analyze_sample(openai_client, flagged_content, metrics, limit=10):
    """Use gpt-5.2 to analyze a sample of flagged content and prioritize improvements."""
    # Prioritize: tagging opportunities first, then missing keywords, then others
    sample = sorted(
        flagged_content,
        key=lambda x: (
            'tagging_opportunity' in x['issues'],
            'missing_keywords' in x['issues'],
            x['extracted_text_length'],
        ),
        reverse=True,
    )[:limit]

    if not sample:
        return {'message': 'No flagged content to analyze'}

    sample_text = json.dumps(sample, indent=2, cls=DecimalEncoder)

    prompt = f"""You are auditing a marketing content database for SchooLinks (a K-12 college & career readiness platform).

OVERALL METRICS:
- Total content: {metrics['total_content']}
- Missing tags: {metrics['missing_tags']}
- Missing JSONB keywords: {metrics['missing_keywords']}
- Missing summaries: {metrics['missing_summaries']}
- Not deep-enriched: {metrics['not_deep_enriched']}
- Tagging opportunities (have text, no keywords): {metrics['tagging_opportunities']}
- Extraction errors: {metrics['extraction_errors']}

SAMPLE OF FLAGGED CONTENT:
{sample_text}

Analyze this data and respond with valid JSON only:
{{
  "overall_health_score": 7.5,  // 1-10 scale
  "health_summary": "Brief 2-3 sentence assessment of database health",
  "priority_actions": [
    {{"action": "description", "impact": "high|medium|low", "records_affected": 42, "estimated_effort": "description"}}
  ],
  "recommendations": [
    "Specific actionable recommendation"
  ],
  "enrichment_priority_order": [
    "Content type or category to enrich first, with reasoning"
  ]
}}

Focus on:
1. Which content types have the most gaps?
2. What's the most impactful action to improve search quality?
3. What should be enriched first for maximum ROI?
4. Are there patterns in what's missing (e.g., all videos lack keywords)?"""

    try:
        api_params = {
            "model": AI_MODEL,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a content database auditor. Analyze metrics and provide actionable, prioritized recommendations. Respond with valid JSON only."
                },
                {"role": "user", "content": prompt}
            ],
        }
        # gpt-5.x: use max_completion_tokens, not max_tokens; no temperature
        if AI_MODEL.startswith('gpt-5') or AI_MODEL.startswith('o'):
            api_params["max_completion_tokens"] = 2000
        else:
            api_params["temperature"] = 0.3
            api_params["max_tokens"] = 2000

        response = openai_client.chat.completions.create(**api_params)
        content = response.choices[0].message.content

        import re
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            return json.loads(json_match.group())
        return {'error': 'Could not parse JSON from AI response', 'raw': content[:500]}

    except Exception as e:
        return {'error': str(e)}


def save_report(conn, report, dry_run=False):
    """Save audit report to log_analysis_reports table."""
    if dry_run:
        return None

    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO log_analysis_reports (
                    report_type, analysis_date, logs_analyzed,
                    summary, issues_identified, pattern_insights,
                    model_used
                ) VALUES (
                    'audit', %s, %s,
                    %s, %s, %s,
                    %s
                )
                RETURNING id
            """, (
                report['audit_date'],
                report['metrics']['total_content'],
                report.get('ai_analysis', {}).get('health_summary', ''),
                json.dumps(report.get('flagged_content_sample', []), cls=DecimalEncoder),
                json.dumps(report.get('ai_analysis', {}).get('recommendations', []), cls=DecimalEncoder),
                AI_MODEL,
            ))
            result = cur.fetchone()
            conn.commit()
            return result['id'] if result else None
    except Exception as e:
        print(f"  Warning: Could not save report to database: {e}")
        conn.rollback()
        return None


def print_summary(audit_results, ai_analysis):
    """Print a formatted console summary."""
    metrics = audit_results['metrics']

    print("\n" + "=" * 60)
    print("CONTENT DATABASE AUDIT REPORT")
    print(f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)

    print(f"\n  Total content:          {metrics['total_content']}")
    print(f"  Missing tags:           {metrics['missing_tags']}")
    print(f"  Missing JSONB keywords: {metrics['missing_keywords']}")
    print(f"  Missing summaries:      {metrics['missing_summaries']}")
    print(f"  Not deep-enriched:      {metrics['not_deep_enriched']}")
    print(f"  Tagging opportunities:  {metrics['tagging_opportunities']}")
    print(f"  Extraction errors:      {metrics['extraction_errors']}")
    print(f"  No URL:                 {metrics['no_url']}")

    # Type distribution
    print(f"\n  Content Type Distribution:")
    for ctype, count in audit_results['type_distribution'].items():
        bar = '#' * min(count // 2, 30)
        print(f"    {ctype:<20} {count:>4}  {bar}")

    # State coverage
    coverage = audit_results['state_coverage']
    print(f"\n  State Coverage: {coverage['coverage_pct']}% ({len(coverage['covered'])}/{len(US_STATES)} states)")
    if coverage['missing']:
        print(f"    Missing: {', '.join(coverage['missing'][:15])}")
        if len(coverage['missing']) > 15:
            print(f"    ... and {len(coverage['missing']) - 15} more")

    # AI Analysis
    if ai_analysis and 'error' not in ai_analysis:
        score = ai_analysis.get('overall_health_score', 'N/A')
        print(f"\n  AI Health Score: {score}/10")
        summary = ai_analysis.get('health_summary', '')
        if summary:
            print(f"  {summary}")

        actions = ai_analysis.get('priority_actions', [])
        if actions:
            print(f"\n  Priority Actions ({len(actions)}):")
            for i, action in enumerate(actions[:5], 1):
                impact = action.get('impact', 'unknown')
                icon = '!' if impact == 'high' else '-' if impact == 'medium' else ' '
                print(f"    {icon} [{impact.upper()}] {action.get('action', 'N/A')}")
                if action.get('records_affected'):
                    print(f"      Records affected: {action['records_affected']}")

        recs = ai_analysis.get('recommendations', [])
        if recs:
            print(f"\n  Recommendations:")
            for rec in recs[:5]:
                print(f"    - {rec}")

        priority = ai_analysis.get('enrichment_priority_order', [])
        if priority:
            print(f"\n  Enrichment Priority:")
            for i, item in enumerate(priority[:5], 1):
                print(f"    {i}. {item}")
    elif ai_analysis and 'error' in ai_analysis:
        print(f"\n  AI Analysis Error: {ai_analysis['error']}")


def main():
    parser = argparse.ArgumentParser(description='Audit content database for tagging opportunities')
    parser.add_argument('--limit', type=int, default=10, help='Number of flagged items for AI analysis (default: 10)')
    parser.add_argument('--dry-run', action='store_true', help='Preview only, no report saved to database')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')
    parser.add_argument('--output', type=str, help='Output file for JSON report')
    parser.add_argument('--skip-ai', action='store_true', help='Skip AI analysis (faster, cheaper)')

    args = parser.parse_args()

    print("=" * 60)
    print("Content Database Audit Tool")
    print(f"Model: {AI_MODEL}" + (" (skipped)" if args.skip_ai else ""))
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        print("Export it or add to scripts/.env")
        sys.exit(1)

    # Connect
    print("\n[1/4] Connecting to database...")
    conn = get_db_connection()
    print("  Connected")

    # Fetch all content
    print("[2/4] Fetching all content records...")
    records = fetch_all_content(conn)
    print(f"  Found {len(records)} records")

    if not records:
        print("\n  No content found in database.")
        conn.close()
        return

    # Audit
    print("[3/4] Auditing content...")
    audit_results = audit_content(records)
    print(f"  Audit complete: {len(audit_results['flagged_content'])} flagged items")

    if args.verbose:
        print(f"\n  Top flagged items:")
        for item in audit_results['flagged_content'][:5]:
            print(f"    [{item['type']}] {item['title']}")
            print(f"      Issues: {', '.join(item['issues'][:3])}")

    # AI Analysis
    ai_analysis = None
    if not args.skip_ai:
        if not OPENAI_API_KEY:
            print("\n  WARNING: OPENAI_API_KEY not set, skipping AI analysis")
        else:
            print(f"[4/4] AI analysis of {min(args.limit, len(audit_results['flagged_content']))} flagged items...")
            openai_client = OpenAI(api_key=OPENAI_API_KEY)
            ai_analysis = ai_analyze_sample(
                openai_client,
                audit_results['flagged_content'],
                audit_results['metrics'],
                limit=args.limit,
            )
            print("  AI analysis complete")
    else:
        print("[4/4] Skipping AI analysis (--skip-ai)")

    # Build report
    report = {
        'audit_date': datetime.now().strftime('%Y-%m-%d'),
        'metrics': audit_results['metrics'],
        'type_distribution': audit_results['type_distribution'],
        'state_distribution': audit_results['state_distribution'],
        'platform_distribution': audit_results['platform_distribution'],
        'state_coverage': audit_results['state_coverage'],
        'flagged_content_sample': audit_results['flagged_content'][:50],
        'total_flagged': len(audit_results['flagged_content']),
        'ai_analysis': ai_analysis,
    }

    # Print summary
    print_summary(audit_results, ai_analysis)

    # Save to database
    if not args.dry_run:
        print("\n  Saving report to database...")
        report_id = save_report(conn, report)
        if report_id:
            print(f"  Report saved (ID: {report_id})")
    else:
        print("\n  [DRY RUN] No changes made to database")

    # Save to file
    if args.output:
        print(f"\n  Saving report to {args.output}...")
        with open(args.output, 'w') as f:
            json.dump(report, f, indent=2, cls=DecimalEncoder)
        print(f"  Report saved")

    conn.close()
    print("\nDone!")


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""
Log Analysis Agent for AI Search Assistant
Analyzes prompt logs from Supabase to identify search quality issues,
suggest terminology improvements, and generate actionable insights.

Part of the "Terminology Brain" for self-improving search intelligence.

Usage:
    python scripts/log_analyzer.py --days 7
    python scripts/log_analyzer.py --days 7 --output report.json --verbose
    python scripts/log_analyzer.py --days 7 --auto-suggest-terms
    python scripts/log_analyzer.py --start 2026-02-01 --end 2026-02-04
    python scripts/log_analyzer.py --days 7 --dry-run
"""

import os
import sys
import json
import argparse
from datetime import datetime, timedelta
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

# Analysis configuration
ANALYSIS_MODEL = 'gpt-4o-mini'  # Cost-effective for batch analysis
BATCH_SIZE = 20  # Number of logs to analyze per AI call
LOW_RECOMMENDATION_THRESHOLD = 2  # Queries with fewer recommendations need attention


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        return super().default(obj)


def connect_to_database():
    """Connect to Supabase database."""
    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        print("Set it in scripts/.env or export it:")
        print("  export DATABASE_URL='postgresql://...'")
        sys.exit(1)

    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def fetch_recent_logs(conn, days=7, start_date=None, end_date=None):
    """
    Fetch recent prompt logs for analysis.

    Args:
        conn: Database connection
        days: Number of days to look back (default 7)
        start_date: Optional start date string (YYYY-MM-DD)
        end_date: Optional end date string (YYYY-MM-DD)

    Returns:
        List of log entries
    """
    cur = conn.cursor()

    if start_date and end_date:
        query = """
            SELECT
                id, query, complexity, model_used, detected_states,
                query_type, matched_indicators, recommendations_count,
                ai_quick_answer, ai_key_points, response_time_ms,
                session_id, created_at
            FROM ai_prompt_logs
            WHERE created_at >= %s AND created_at <= %s
            ORDER BY created_at DESC
        """
        cur.execute(query, (start_date, end_date))
    else:
        query = """
            SELECT
                id, query, complexity, model_used, detected_states,
                query_type, matched_indicators, recommendations_count,
                ai_quick_answer, ai_key_points, response_time_ms,
                session_id, created_at
            FROM ai_prompt_logs
            WHERE created_at >= NOW() - INTERVAL '%s days'
            ORDER BY created_at DESC
        """
        cur.execute(query, (days,))

    logs = cur.fetchall()
    cur.close()
    return logs


def fetch_context_inventory(conn):
    """
    Fetch all AI context for cross-referencing.

    Returns:
        Dict with state_context, competitor_intel, and features
    """
    cur = conn.cursor()

    # Fetch state-specific context
    cur.execute("""
        SELECT subcategory, title, summary
        FROM ai_context
        WHERE category = 'state_context'
    """)
    state_context = {row['subcategory']: row for row in cur.fetchall()}

    # Fetch competitor intel
    cur.execute("""
        SELECT subcategory, title, summary
        FROM ai_context
        WHERE category = 'competitor_intel'
    """)
    competitor_intel = {row['subcategory']: row for row in cur.fetchall()}

    # Fetch terminology mappings
    cur.execute("""
        SELECT map_type, user_term, canonical_term
        FROM terminology_map
        WHERE is_active = true
    """)
    terminology = {}
    for row in cur.fetchall():
        if row['map_type'] not in terminology:
            terminology[row['map_type']] = {}
        terminology[row['map_type']][row['user_term']] = row['canonical_term']

    cur.close()
    return {
        'state_context': state_context,
        'competitor_intel': competitor_intel,
        'terminology': terminology
    }


def analyze_logs_with_ai(logs, context, openai_client, verbose=False):
    """
    Use AI to analyze a batch of logs and identify issues.

    Args:
        logs: List of log entries to analyze
        context: Context inventory (state, competitor, terminology)
        openai_client: OpenAI client
        verbose: Print detailed output

    Returns:
        Analysis results dict
    """
    if not logs:
        return {
            'issues': [],
            'suggested_mappings': [],
            'state_context_gaps': [],
            'competitor_queries': [],
            'pattern_insights': []
        }

    # Prepare context summaries
    state_summary = "Available states: " + ", ".join(context['state_context'].keys()) if context['state_context'] else "No state context available"
    competitor_summary = "Competitors tracked: " + ", ".join(context['competitor_intel'].keys()) if context['competitor_intel'] else "No competitor intel available"

    # Format terminology for prompt
    term_lines = []
    for map_type, mappings in context['terminology'].items():
        term_lines.append(f"  {map_type}: {len(mappings)} mappings")
    terminology_summary = "\n".join(term_lines) if term_lines else "No terminology mappings"

    # Format logs for analysis
    logs_text = []
    for log in logs:
        log_entry = f"""
Query: "{log['query']}"
- Complexity: {log['complexity']}
- Model: {log['model_used']}
- States detected: {log['detected_states'] or 'None'}
- Query type: {log['query_type']}
- Recommendations: {log['recommendations_count'] or 0}
- Response time: {log['response_time_ms'] or 'N/A'}ms
"""
        logs_text.append(log_entry)

    system_prompt = f"""You are a search quality analyst for the SchooLinks Marketing Content Portal.
You are analyzing search logs to identify issues and improvement opportunities.

CONTEXT:
- The portal contains marketing content: Customer Stories, Videos, Ebooks, 1-Pagers, etc.
- Users search for content by topic, state, content type, competitor comparisons
- The AI assistant uses terminology mappings to understand user queries

KNOWN TERMINOLOGY MAPPINGS:
{terminology_summary}

STATE-SPECIFIC CONTEXT AVAILABLE:
{state_summary}

COMPETITOR INTEL AVAILABLE:
{competitor_summary}

ANALYZE THESE SEARCH LOGS:
{"".join(logs_text)}

For each problematic query, identify:
1. Did the query return adequate results (recommendations_count >= 2)?
2. Should this query have triggered state-specific context?
3. Are there unmapped terms that should be added to terminology?
4. Did the query mention competitors that we have intel on?
5. What patterns do you see across multiple queries?

OUTPUT FORMAT (JSON):
{{
  "issues": [
    {{"query": "the original query", "issue": "description of the problem", "severity": "high|medium|low", "suggested_fix": "how to fix it"}}
  ],
  "suggested_mappings": [
    {{"user_term": "what user typed", "canonical_term": "database term", "map_type": "content_type|competitor|persona|topic|feature", "confidence": 0.0-1.0}}
  ],
  "state_context_gaps": [
    {{"query": "the query", "expected_state": "XX", "context_available": true|false}}
  ],
  "competitor_queries": [
    {{"query": "the query", "competitor": "competitor name", "intel_used": true|false}}
  ],
  "pattern_insights": [
    "Insight about patterns across multiple queries"
  ]
}}

Be specific and actionable. Focus on issues that can be fixed with terminology mappings or context improvements.
Only include suggested_mappings for terms that are clearly missing from our terminology.
Return valid JSON only."""

    try:
        response = openai_client.chat.completions.create(
            model=ANALYSIS_MODEL,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": "Analyze these logs and provide your findings."}
            ],
            temperature=0.3,
            max_tokens=2000
        )

        content = response.choices[0].message.content

        # Parse JSON from response
        json_match = content
        if '```json' in content:
            json_match = content.split('```json')[1].split('```')[0]
        elif '```' in content:
            json_match = content.split('```')[1].split('```')[0]

        result = json.loads(json_match.strip())

        if verbose:
            print(f"  AI analysis found {len(result.get('issues', []))} issues")

        return result

    except json.JSONDecodeError as e:
        print(f"  Warning: Failed to parse AI response as JSON: {e}")
        return {
            'issues': [],
            'suggested_mappings': [],
            'state_context_gaps': [],
            'competitor_queries': [],
            'pattern_insights': [],
            'raw_response': content if 'content' in dir() else None
        }
    except Exception as e:
        print(f"  Error in AI analysis: {e}")
        return {
            'issues': [],
            'suggested_mappings': [],
            'state_context_gaps': [],
            'competitor_queries': [],
            'pattern_insights': [],
            'error': str(e)
        }


def calculate_metrics(logs):
    """Calculate summary metrics from logs."""
    if not logs:
        return {
            'total_logs': 0,
            'avg_recommendations': 0,
            'zero_result_queries': 0,
            'low_confidence_queries': 0,
            'state_context_usage': {},
            'competitor_queries': 0
        }

    total = len(logs)
    recommendations = [log['recommendations_count'] or 0 for log in logs]
    avg_recommendations = sum(recommendations) / total if total > 0 else 0
    zero_results = sum(1 for r in recommendations if r == 0)
    low_results = sum(1 for r in recommendations if r < LOW_RECOMMENDATION_THRESHOLD)

    # Count state usage
    state_usage = {}
    for log in logs:
        states = log['detected_states'] or []
        for state in states:
            state_usage[state] = state_usage.get(state, 0) + 1

    # Count competitor queries
    competitor_keywords = ['naviance', 'xello', 'scoir', 'majorclarity', 'powerschool', 'kuder', 'youscience']
    competitor_count = 0
    for log in logs:
        query_lower = (log['query'] or '').lower()
        if any(kw in query_lower for kw in competitor_keywords):
            competitor_count += 1

    return {
        'total_logs': total,
        'avg_recommendations': round(avg_recommendations, 2),
        'zero_result_queries': zero_results,
        'low_confidence_queries': low_results,
        'state_context_usage': state_usage,
        'competitor_queries': competitor_count
    }


def insert_terminology_suggestions(conn, suggestions, dry_run=False):
    """
    Insert suggested terminology mappings into the database.
    Suggestions are inserted as unverified and inactive.

    Args:
        conn: Database connection
        suggestions: List of suggested mappings
        dry_run: If True, don't actually insert

    Returns:
        Number of suggestions inserted
    """
    if not suggestions or dry_run:
        return 0

    cur = conn.cursor()
    inserted = 0

    for suggestion in suggestions:
        try:
            cur.execute("""
                INSERT INTO terminology_map
                    (map_type, user_term, canonical_term, source, confidence, is_verified, is_active)
                VALUES
                    (%s, %s, %s, 'log_analysis', %s, false, false)
                ON CONFLICT (map_type, user_term) DO NOTHING
                RETURNING id
            """, (
                suggestion.get('map_type', 'content_type'),
                suggestion.get('user_term', '').lower(),
                suggestion.get('canonical_term', ''),
                suggestion.get('confidence', 0.5)
            ))
            if cur.fetchone():
                inserted += 1
        except Exception as e:
            print(f"  Warning: Failed to insert suggestion: {e}")

    conn.commit()
    cur.close()
    return inserted


def save_report(conn, report, dry_run=False):
    """
    Save analysis report to the database.

    Args:
        conn: Database connection
        report: Report dict
        dry_run: If True, don't actually save

    Returns:
        Report ID if saved, None otherwise
    """
    if dry_run:
        return None

    cur = conn.cursor()

    try:
        cur.execute("""
            INSERT INTO log_analysis_reports (
                analysis_date, logs_analyzed, time_range_start, time_range_end,
                avg_recommendations_count, zero_result_queries, low_confidence_queries,
                state_context_usage_count, competitor_query_count,
                summary, issues_identified, suggested_mappings, pattern_insights,
                terminology_suggestions, context_gaps, state_context_usage,
                execution_time_ms, model_used
            ) VALUES (
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s,
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s
            )
            RETURNING id
        """, (
            report['analysis_date'],
            report['metrics']['total_logs'],
            report.get('time_range_start'),
            report.get('time_range_end'),
            report['metrics']['avg_recommendations'],
            report['metrics']['zero_result_queries'],
            report['metrics']['low_confidence_queries'],
            len(report['metrics']['state_context_usage']),
            report['metrics']['competitor_queries'],
            report.get('summary'),
            json.dumps(report.get('issues', []), cls=DecimalEncoder),
            json.dumps(report.get('suggested_mappings', []), cls=DecimalEncoder),
            json.dumps(report.get('pattern_insights', []), cls=DecimalEncoder),
            json.dumps(report.get('terminology_suggestions', []), cls=DecimalEncoder),
            json.dumps(report.get('context_gaps', []), cls=DecimalEncoder),
            json.dumps(report['metrics']['state_context_usage'], cls=DecimalEncoder),
            report.get('execution_time_ms'),
            ANALYSIS_MODEL
        ))

        result = cur.fetchone()
        conn.commit()
        cur.close()
        return result['id'] if result else None

    except Exception as e:
        print(f"  Error saving report: {e}")
        conn.rollback()
        cur.close()
        return None


def generate_summary(metrics, issues, suggestions):
    """Generate a human-readable summary of the analysis."""
    parts = [
        f"{metrics['total_logs']} queries analyzed.",
    ]

    if metrics['zero_result_queries'] > 0:
        parts.append(f"{metrics['zero_result_queries']} returned zero results.")

    if len(issues) > 0:
        high_severity = sum(1 for i in issues if i.get('severity') == 'high')
        if high_severity > 0:
            parts.append(f"{high_severity} high-severity issues found.")

    if len(suggestions) > 0:
        parts.append(f"{len(suggestions)} terminology suggestions generated.")

    if metrics['state_context_usage']:
        top_states = sorted(metrics['state_context_usage'].items(), key=lambda x: x[1], reverse=True)[:3]
        state_str = ', '.join(f"{s[0]}:{s[1]}" for s in top_states)
        parts.append(f"Top states: {state_str}.")

    return ' '.join(parts)


def main():
    parser = argparse.ArgumentParser(description='Analyze AI Search Assistant prompt logs')
    parser.add_argument('--days', type=int, default=7, help='Number of days to analyze (default: 7)')
    parser.add_argument('--start', type=str, help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, help='End date (YYYY-MM-DD)')
    parser.add_argument('--output', type=str, help='Output file for JSON report')
    parser.add_argument('--auto-suggest-terms', action='store_true', help='Auto-insert terminology suggestions (unverified)')
    parser.add_argument('--dry-run', action='store_true', help='Don\'t write to database')
    parser.add_argument('--verbose', '-v', action='store_true', help='Verbose output')

    args = parser.parse_args()

    print("=" * 60)
    print("LOG ANALYSIS AGENT - AI Search Assistant")
    print("=" * 60)

    start_time = datetime.now()

    # Validate environment
    if not OPENAI_API_KEY:
        print("ERROR: OPENAI_API_KEY not set")
        sys.exit(1)

    # Connect to database
    print("\nConnecting to database...")
    conn = connect_to_database()
    print("  ✓ Connected")

    # Initialize OpenAI client
    openai_client = OpenAI(api_key=OPENAI_API_KEY)

    # Fetch logs
    print(f"\nFetching logs...")
    if args.start and args.end:
        print(f"  Date range: {args.start} to {args.end}")
        logs = fetch_recent_logs(conn, start_date=args.start, end_date=args.end)
    else:
        print(f"  Last {args.days} days")
        logs = fetch_recent_logs(conn, days=args.days)
    print(f"  ✓ Found {len(logs)} log entries")

    if len(logs) == 0:
        print("\n⚠️  No logs found to analyze. Exiting.")
        conn.close()
        return

    # Fetch context inventory
    print("\nFetching context inventory...")
    context = fetch_context_inventory(conn)
    print(f"  ✓ State contexts: {len(context['state_context'])}")
    print(f"  ✓ Competitor intel: {len(context['competitor_intel'])}")
    print(f"  ✓ Terminology types: {len(context['terminology'])}")

    # Calculate metrics
    print("\nCalculating metrics...")
    metrics = calculate_metrics(logs)
    print(f"  ✓ Average recommendations: {metrics['avg_recommendations']}")
    print(f"  ✓ Zero-result queries: {metrics['zero_result_queries']}")
    print(f"  ✓ Competitor queries: {metrics['competitor_queries']}")

    # Analyze logs in batches
    print(f"\nAnalyzing logs with AI ({ANALYSIS_MODEL})...")
    all_issues = []
    all_suggestions = []
    all_state_gaps = []
    all_competitor_queries = []
    all_patterns = []

    for i in range(0, len(logs), BATCH_SIZE):
        batch = logs[i:i + BATCH_SIZE]
        print(f"  Batch {i // BATCH_SIZE + 1}/{(len(logs) + BATCH_SIZE - 1) // BATCH_SIZE}...")

        results = analyze_logs_with_ai(batch, context, openai_client, verbose=args.verbose)

        all_issues.extend(results.get('issues', []))
        all_suggestions.extend(results.get('suggested_mappings', []))
        all_state_gaps.extend(results.get('state_context_gaps', []))
        all_competitor_queries.extend(results.get('competitor_queries', []))
        all_patterns.extend(results.get('pattern_insights', []))

    print(f"  ✓ Analysis complete")

    # Generate summary
    summary = generate_summary(metrics, all_issues, all_suggestions)

    # Build report
    execution_time = int((datetime.now() - start_time).total_seconds() * 1000)
    report = {
        'analysis_date': datetime.now().strftime('%Y-%m-%d'),
        'time_range_start': logs[-1]['created_at'].isoformat() if logs else None,
        'time_range_end': logs[0]['created_at'].isoformat() if logs else None,
        'metrics': metrics,
        'summary': summary,
        'issues': all_issues,
        'suggested_mappings': all_suggestions,
        'context_gaps': all_state_gaps,
        'competitor_queries': all_competitor_queries,
        'pattern_insights': list(set(all_patterns)),  # Deduplicate
        'terminology_suggestions': all_suggestions,  # Same as suggested_mappings
        'execution_time_ms': execution_time
    }

    # Print summary
    print("\n" + "=" * 60)
    print("ANALYSIS SUMMARY")
    print("=" * 60)
    print(f"\n{summary}")

    if all_issues:
        print(f"\n📋 Issues Found ({len(all_issues)}):")
        for issue in all_issues[:5]:  # Show first 5
            severity_icon = '🔴' if issue.get('severity') == 'high' else '🟡' if issue.get('severity') == 'medium' else '⚪'
            print(f"  {severity_icon} {issue.get('query', 'N/A')[:40]}...")
            print(f"     Issue: {issue.get('issue', 'N/A')[:60]}")
        if len(all_issues) > 5:
            print(f"  ... and {len(all_issues) - 5} more")

    if all_suggestions:
        print(f"\n💡 Terminology Suggestions ({len(all_suggestions)}):")
        for suggestion in all_suggestions[:5]:
            print(f"  • \"{suggestion.get('user_term')}\" → \"{suggestion.get('canonical_term')}\" ({suggestion.get('map_type')})")
        if len(all_suggestions) > 5:
            print(f"  ... and {len(all_suggestions) - 5} more")

    if all_patterns:
        print(f"\n🔍 Pattern Insights:")
        for pattern in all_patterns[:3]:
            print(f"  • {pattern[:80]}...")

    # Save to database
    if not args.dry_run:
        print("\n💾 Saving report to database...")
        report_id = save_report(conn, report)
        if report_id:
            print(f"  ✓ Report saved (ID: {report_id})")

        if args.auto_suggest_terms and all_suggestions:
            print("\n📝 Inserting terminology suggestions...")
            inserted = insert_terminology_suggestions(conn, all_suggestions)
            print(f"  ✓ Inserted {inserted} suggestions (unverified, inactive)")
    else:
        print("\n🔒 Dry run - no database changes made")

    # Save to file if requested
    if args.output:
        print(f"\n📄 Saving report to {args.output}...")
        with open(args.output, 'w') as f:
            json.dump(report, f, indent=2, cls=DecimalEncoder, default=str)
        print(f"  ✓ Report saved")

    conn.close()
    print(f"\n✅ Analysis complete in {execution_time / 1000:.1f}s")


if __name__ == '__main__':
    main()

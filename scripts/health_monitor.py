#!/usr/bin/env python3
"""
System Health & Search Quality Monitoring Agent

Multi-step agent that monitors search quality, content freshness, pipeline
execution status, terminology health, and uses AI to detect anomalies.

Steps:
    1. Query quality check (zero-result rate vs baseline)
    2. Content freshness (stale enrichment, extraction errors)
    3. Pipeline execution status (did today's jobs run?)
    4. Terminology health (unverified suggestions, zero-usage)
    5. AI anomaly detection (gpt-4o-mini pattern flagging)
    6. Alert-formatted output

Usage:
    python scripts/health_monitor.py                        # Full health check
    python scripts/health_monitor.py --baseline-days 7 -v   # Custom baseline
    python scripts/health_monitor.py --alert                 # Alert format
    python scripts/health_monitor.py --skip-ai               # Rule-based only
    python scripts/health_monitor.py --output report.json
    python scripts/health_monitor.py --dry-run -v
"""

import os
import sys
import json
import argparse
import time
from datetime import datetime, timedelta
from decimal import Decimal

import psycopg2
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')
OPENAI_API_KEY = os.getenv('OPENAI_API_KEY')

AI_MODEL = 'gpt-4o-mini'


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types."""
    def default(self, obj):
        if isinstance(obj, Decimal):
            return float(obj)
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, timedelta):
            return str(obj)
        return super().default(obj)


def get_db_connection():
    """Create a database connection."""
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)


def step_query_quality(conn, baseline_days, threshold_zero_rate, verbose=False):
    """Step 1: Analyze search quality vs baseline."""
    with conn.cursor() as cur:
        # Last 24h metrics
        cur.execute("""
            SELECT
                COUNT(*) as total_queries,
                COUNT(*) FILTER (WHERE recommendations_count = 0 OR recommendations_count IS NULL) as zero_result,
                AVG(recommendations_count) as avg_recommendations,
                COUNT(DISTINCT query) as unique_queries
            FROM ai_prompt_logs
            WHERE created_at > NOW() - INTERVAL '24 hours'
        """)
        current = cur.fetchone()

        # Baseline metrics (rolling N-day average)
        cur.execute("""
            SELECT
                COUNT(*) / GREATEST(%s, 1) as avg_daily_queries,
                COUNT(*) FILTER (WHERE recommendations_count = 0 OR recommendations_count IS NULL)::float
                    / GREATEST(COUNT(*), 1) * 100 as baseline_zero_rate,
                AVG(recommendations_count) as baseline_avg_recommendations
            FROM ai_prompt_logs
            WHERE created_at > NOW() - INTERVAL '%s days'
            AND created_at <= NOW() - INTERVAL '24 hours'
        """, (baseline_days, baseline_days))
        baseline = cur.fetchone()

    total = current['total_queries'] or 0
    zero = current['zero_result'] or 0
    current_zero_rate = round(zero / max(total, 1) * 100, 1)
    baseline_zero_rate = round(float(baseline['baseline_zero_rate'] or 0), 1)

    issues = []
    alerts = []

    if current_zero_rate > threshold_zero_rate * 100:
        alerts.append({
            'severity': 'high',
            'message': f"Zero-result rate {current_zero_rate}% exceeds threshold {threshold_zero_rate * 100}%",
        })

    # Compare to baseline
    if baseline_zero_rate > 0 and current_zero_rate > baseline_zero_rate * 1.5:
        alerts.append({
            'severity': 'medium',
            'message': f"Zero-result rate {current_zero_rate}% is 50%+ above baseline {baseline_zero_rate}%",
        })

    status = 'fail' if any(a['severity'] == 'high' for a in alerts) else (
        'warn' if alerts else 'pass'
    )

    return {
        'status': status,
        'current': {
            'total_queries_24h': total,
            'zero_result_queries': zero,
            'zero_result_rate': current_zero_rate,
            'avg_recommendations': round(float(current['avg_recommendations'] or 0), 1),
            'unique_queries': current['unique_queries'] or 0,
        },
        'baseline': {
            'avg_daily_queries': round(float(baseline['avg_daily_queries'] or 0), 1),
            'zero_result_rate': baseline_zero_rate,
            'avg_recommendations': round(float(baseline['baseline_avg_recommendations'] or 0), 1),
        },
        'alerts': alerts,
        'issues': [a['message'] for a in alerts],
    }


def step_content_freshness(conn, verbose=False):
    """Step 2: Check content freshness and errors."""
    with conn.cursor() as cur:
        # Stale enrichment (>30 days old)
        cur.execute("""
            SELECT COUNT(*) as cnt FROM marketing_content
            WHERE deep_enriched_at IS NOT NULL
            AND deep_enriched_at < NOW() - INTERVAL '30 days'
        """)
        stale_enriched = cur.fetchone()['cnt']

        # Never enriched
        cur.execute("SELECT COUNT(*) as cnt FROM marketing_content WHERE deep_enriched_at IS NULL")
        never_enriched = cur.fetchone()['cnt']

        # Extraction errors
        cur.execute("SELECT COUNT(*) as cnt FROM marketing_content WHERE extraction_error IS NOT NULL")
        extraction_errors = cur.fetchone()['cnt']

        # Missing keywords
        cur.execute("SELECT COUNT(*) as cnt FROM marketing_content WHERE keywords IS NULL OR keywords = '[]'::jsonb")
        missing_keywords = cur.fetchone()['cnt']

        # Total
        cur.execute("SELECT COUNT(*) as cnt FROM marketing_content")
        total = cur.fetchone()['cnt']

    issues = []
    if extraction_errors > 10:
        issues.append(f"{extraction_errors} records have extraction errors")
    if missing_keywords > total * 0.3:
        issues.append(f"{missing_keywords}/{total} records missing JSONB keywords ({round(missing_keywords/max(total,1)*100)}%)")

    status = 'fail' if issues else 'pass'
    return {
        'status': status,
        'total_records': total,
        'stale_enrichment': stale_enriched,
        'never_enriched': never_enriched,
        'extraction_errors': extraction_errors,
        'missing_keywords': missing_keywords,
        'issues': issues,
    }


def step_pipeline_status(conn, verbose=False):
    """Step 3: Check if scheduled pipelines have run recently."""
    with conn.cursor() as cur:
        # Check log_analysis_reports for recent entries
        cur.execute("""
            SELECT report_type, MAX(created_at) as last_run
            FROM log_analysis_reports
            GROUP BY report_type
        """)
        pipeline_runs = {row['report_type']: row['last_run'] for row in cur.fetchall()}

    now = datetime.now()
    issues = []
    pipelines = {}

    # Check each expected pipeline
    expected = {
        'comprehensive': {'name': 'Log Analysis', 'max_age_hours': 36},
        'audit': {'name': 'Content Audit', 'max_age_hours': 192},  # ~8 days (weekly)
    }

    for report_type, config in expected.items():
        last_run = pipeline_runs.get(report_type)
        if last_run:
            # Handle timezone-aware datetime
            if last_run.tzinfo is not None:
                from datetime import timezone
                now_aware = datetime.now(timezone.utc)
                age_hours = (now_aware - last_run).total_seconds() / 3600
            else:
                age_hours = (now - last_run).total_seconds() / 3600

            stale = age_hours > config['max_age_hours']
            pipelines[report_type] = {
                'name': config['name'],
                'last_run': last_run.isoformat(),
                'age_hours': round(age_hours, 1),
                'stale': stale,
            }
            if stale:
                issues.append(f"{config['name']} last ran {round(age_hours)}h ago (threshold: {config['max_age_hours']}h)")
        else:
            pipelines[report_type] = {
                'name': config['name'],
                'last_run': None,
                'stale': True,
            }
            issues.append(f"{config['name']} has never run")

    status = 'warn' if issues else 'pass'
    return {
        'status': status,
        'pipelines': pipelines,
        'issues': issues,
    }


def step_terminology_health(conn, verbose=False):
    """Step 4: Check terminology map health."""
    with conn.cursor() as cur:
        # Total terminology entries
        cur.execute("SELECT COUNT(*) as cnt FROM terminology_map")
        total = cur.fetchone()['cnt']

        # Recently added (last 7 days)
        cur.execute("""
            SELECT COUNT(*) as cnt FROM terminology_map
            WHERE created_at > NOW() - INTERVAL '7 days'
        """)
        recent = cur.fetchone()['cnt']

        # Check for any source info
        cur.execute("""
            SELECT source, COUNT(*) as cnt FROM terminology_map
            GROUP BY source ORDER BY cnt DESC
        """)
        by_source = {row['source'] or 'unknown': row['cnt'] for row in cur.fetchall()}

    issues = []
    if total == 0:
        issues.append("Terminology map is empty")

    status = 'warn' if issues else 'pass'
    return {
        'status': status,
        'total_mappings': total,
        'added_last_7d': recent,
        'by_source': by_source,
        'issues': issues,
    }


def step_ai_anomaly_detection(conn, metrics, skip_ai=False, verbose=False):
    """Step 5: Use AI to detect anomalies in metrics."""
    if skip_ai:
        return {'status': 'skipped', 'reason': '--skip-ai'}

    if not OPENAI_API_KEY:
        return {'status': 'skipped', 'reason': 'OPENAI_API_KEY not set'}

    from openai import OpenAI
    client = OpenAI(api_key=OPENAI_API_KEY)

    metrics_text = json.dumps(metrics, indent=2, cls=DecimalEncoder)

    prompt = f"""You are a system health monitor for a marketing content search portal (SchooLinks).

Analyze these health metrics and identify any anomalies or concerns:

{metrics_text}

Respond with valid JSON only:
{{
  "anomalies": [
    {{"severity": "high|medium|low", "area": "area name", "description": "what's wrong", "recommendation": "what to do"}}
  ],
  "overall_health": "healthy|degraded|critical",
  "summary": "1-2 sentence overall assessment"
}}

Focus on:
1. Is search quality degrading?
2. Are enrichment pipelines keeping up?
3. Is content freshness acceptable?
4. Any patterns that suggest emerging problems?"""

    try:
        response = client.chat.completions.create(
            model=AI_MODEL,
            messages=[
                {"role": "system", "content": "You are a system health monitor. Analyze metrics and identify anomalies. Respond with valid JSON only."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=1000,
        )
        content = response.choices[0].message.content

        import re
        json_match = re.search(r'\{[\s\S]*\}', content)
        if json_match:
            result = json.loads(json_match.group())
            result['status'] = 'pass'
            return result
        return {'status': 'warn', 'issues': ['Could not parse AI response']}

    except Exception as e:
        return {'status': 'warn', 'issues': [f'AI analysis failed: {str(e)[:200]}']}


def print_health_report(report, alert_mode=False):
    """Print formatted health report."""
    print("\n" + "=" * 60)
    print("SYSTEM HEALTH MONITOR")
    print(f"Time: {report['timestamp']}")
    print("=" * 60)

    for step_data in report['steps']:
        icon = {'pass': '+', 'fail': 'X', 'warn': '!', 'skipped': '-'}.get(step_data['status'], '?')
        print(f"  [{icon}] {step_data['name']} ({step_data['status']})")

    # Query quality details
    qc = report.get('query_quality', {})
    if 'current' in qc:
        c = qc['current']
        b = qc.get('baseline', {})
        print(f"\n  Search Quality (24h):")
        print(f"    Queries: {c.get('total_queries_24h', 'N/A')} ({c.get('unique_queries', 'N/A')} unique)")
        print(f"    Zero-result rate: {c.get('zero_result_rate', 'N/A')}% (baseline: {b.get('zero_result_rate', 'N/A')}%)")
        print(f"    Avg recommendations: {c.get('avg_recommendations', 'N/A')} (baseline: {b.get('avg_recommendations', 'N/A')})")

    # Content freshness
    cf = report.get('content_freshness', {})
    if 'total_records' in cf:
        print(f"\n  Content Health:")
        print(f"    Total records: {cf['total_records']}")
        print(f"    Stale enrichment (>30d): {cf.get('stale_enrichment', 'N/A')}")
        print(f"    Never enriched: {cf.get('never_enriched', 'N/A')}")
        print(f"    Extraction errors: {cf.get('extraction_errors', 'N/A')}")
        print(f"    Missing keywords: {cf.get('missing_keywords', 'N/A')}")

    # All issues
    all_issues = report.get('all_issues', [])
    if all_issues:
        print(f"\n  Issues ({len(all_issues)}):")
        for issue in all_issues:
            print(f"    X {issue}")

    # AI analysis
    ai = report.get('ai_analysis', {})
    if ai.get('summary'):
        print(f"\n  AI Assessment: {ai.get('overall_health', 'N/A')}")
        print(f"  {ai['summary']}")

    if ai.get('anomalies'):
        print(f"\n  Anomalies Detected ({len(ai['anomalies'])}):")
        for anomaly in ai['anomalies']:
            sev = anomaly.get('severity', 'unknown')
            icon = '!' if sev == 'high' else '-' if sev == 'medium' else ' '
            print(f"    {icon} [{sev.upper()}] {anomaly.get('area', 'unknown')}: {anomaly.get('description', '')}")
            if anomaly.get('recommendation'):
                print(f"      Fix: {anomaly['recommendation']}")

    overall = report.get('overall_status', 'unknown')
    print(f"\n  Overall: {overall.upper()}")
    print("=" * 60)

    if alert_mode and all_issues:
        print("\n  ALERT FORMAT:")
        for issue in all_issues:
            print(f"  [ALERT] {issue}")


def main():
    parser = argparse.ArgumentParser(description='System health and search quality monitoring agent')
    parser.add_argument('--baseline-days', type=int, default=7, help='Days for baseline comparison (default: 7)')
    parser.add_argument('--alert', action='store_true', help='Format output for alerting')
    parser.add_argument('--skip-ai', action='store_true', help='Skip AI anomaly detection')
    parser.add_argument('--threshold-zero-rate', type=float, default=0.15,
                        help='Alert threshold for zero-result rate (default: 0.15 = 15%%)')
    parser.add_argument('--output', type=str, help='Output file for JSON report')
    parser.add_argument('--dry-run', action='store_true', help='Preview only')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')

    args = parser.parse_args()

    total_steps = 6
    print("=" * 60)
    print(f"System Health Monitor — baseline: {args.baseline_days} days")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    conn = get_db_connection()
    all_issues = []
    step_results = []

    # Step 1: Query quality
    print(f"\n[1/{total_steps}] Checking search quality...")
    qc = step_query_quality(conn, args.baseline_days, args.threshold_zero_rate, args.verbose)
    step_results.append({'name': 'Query Quality', 'status': qc['status']})
    all_issues.extend(qc.get('issues', []))
    c = qc.get('current', {})
    print(f"  Zero-result rate: {c.get('zero_result_rate', 'N/A')}%")

    # Step 2: Content freshness
    print(f"\n[2/{total_steps}] Checking content freshness...")
    cf = step_content_freshness(conn, args.verbose)
    step_results.append({'name': 'Content Freshness', 'status': cf['status']})
    all_issues.extend(cf.get('issues', []))
    print(f"  Records: {cf.get('total_records', 'N/A')}, Errors: {cf.get('extraction_errors', 'N/A')}")

    # Step 3: Pipeline status
    print(f"\n[3/{total_steps}] Checking pipeline status...")
    ps = step_pipeline_status(conn, args.verbose)
    step_results.append({'name': 'Pipeline Status', 'status': ps['status']})
    all_issues.extend(ps.get('issues', []))
    for ptype, pdata in ps.get('pipelines', {}).items():
        print(f"  {pdata['name']}: last run {pdata.get('age_hours', 'never')}h ago")

    # Step 4: Terminology health
    print(f"\n[4/{total_steps}] Checking terminology health...")
    th = step_terminology_health(conn, args.verbose)
    step_results.append({'name': 'Terminology Health', 'status': th['status']})
    all_issues.extend(th.get('issues', []))
    print(f"  Total mappings: {th.get('total_mappings', 'N/A')}, Added (7d): {th.get('added_last_7d', 'N/A')}")

    # Step 5: AI anomaly detection
    print(f"\n[5/{total_steps}] AI anomaly detection...")
    collected_metrics = {
        'query_quality': qc,
        'content_freshness': cf,
        'pipeline_status': ps,
        'terminology': th,
    }
    ai = step_ai_anomaly_detection(conn, collected_metrics, args.skip_ai, args.verbose)
    step_results.append({'name': 'AI Anomaly Detection', 'status': ai.get('status', 'unknown')})
    print(f"  Status: {ai.get('status', 'unknown')}")

    conn.close()

    # Step 6: Generate report
    print(f"\n[6/{total_steps}] Generating report...")

    has_failures = any(s['status'] == 'fail' for s in step_results)
    has_warnings = any(s['status'] == 'warn' for s in step_results)
    overall = 'critical' if has_failures else ('degraded' if has_warnings else 'healthy')

    report = {
        'agent': 'health-monitor',
        'version': '1.0.0',
        'timestamp': datetime.now().isoformat(),
        'baseline_days': args.baseline_days,
        'overall_status': overall,
        'steps': step_results,
        'query_quality': qc,
        'content_freshness': cf,
        'pipeline_status': ps,
        'terminology': th,
        'ai_analysis': ai,
        'all_issues': all_issues,
    }

    print_health_report(report, alert_mode=args.alert)

    # Save report
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(report, f, indent=2, cls=DecimalEncoder)
        print(f"\n  Report saved to {args.output}")

    # Exit code
    if overall == 'critical':
        sys.exit(1)
    sys.exit(0)


if __name__ == '__main__':
    main()

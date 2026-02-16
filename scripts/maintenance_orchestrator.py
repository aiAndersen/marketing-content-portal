#!/usr/bin/env python3
"""
Complete Maintenance Cycle Orchestrator Agent

Multi-step agent that runs the full daily or weekly maintenance pipeline,
orchestrating health checks, log analysis, enrichment, tag hygiene, audit,
and content gap analysis in the correct sequence.

Steps:
    1. Pre-health check (gate - stop if critical)
    2. Log analysis
    3. Content enrichment
    4. Tag hygiene
    5. Content audit (weekly mode)
    6. Content gaps analysis (weekly mode)
    7. Post-health check + delta
    8. Generate maintenance report

Usage:
    python scripts/maintenance_orchestrator.py                     # Daily mode
    python scripts/maintenance_orchestrator.py --mode weekly       # Weekly mode
    python scripts/maintenance_orchestrator.py --mode full         # Everything
    python scripts/maintenance_orchestrator.py --skip log_analysis,enrichment
    python scripts/maintenance_orchestrator.py --enrich-limit 30
    python scripts/maintenance_orchestrator.py --output report.json
    python scripts/maintenance_orchestrator.py --dry-run -v
"""

import os
import sys
import json
import argparse
import subprocess
import time
from datetime import datetime
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

# Maintenance steps configuration
MAINTENANCE_STEPS = {
    'daily': [
        'health_check_pre',
        'log_analysis',
        'enrichment',
        'tag_hygiene',
        'health_check_post',
    ],
    'weekly': [
        'health_check_pre',
        'log_analysis',
        'enrichment',
        'tag_hygiene',
        'content_audit',
        'content_gaps',
        'health_check_post',
    ],
    'full': [
        'health_check_pre',
        'log_analysis',
        'enrichment',
        'tag_hygiene',
        'content_audit',
        'content_gaps',
        'import_all',
        'health_check_post',
    ],
}


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


def run_command(cmd, timeout=600, verbose=False):
    """Run a shell command and return result dict."""
    if verbose:
        print(f"      $ {cmd}")
    try:
        result = subprocess.run(
            cmd, shell=True, capture_output=True, text=True, timeout=timeout
        )
        return {
            'success': result.returncode == 0,
            'returncode': result.returncode,
            'stdout': result.stdout.strip(),
            'stderr': result.stderr.strip(),
        }
    except subprocess.TimeoutExpired:
        return {'success': False, 'returncode': -1, 'stdout': '', 'stderr': 'Command timed out'}
    except Exception as e:
        return {'success': False, 'returncode': -1, 'stdout': '', 'stderr': str(e)}


def step_health_check_pre(args):
    """Step 1: Pre-maintenance health check."""
    cmd = f"python scripts/health_monitor.py --baseline-days 7 --output /tmp/health_pre.json"
    if args.verbose:
        cmd += " -v"

    result = run_command(cmd, timeout=120, verbose=args.verbose)

    # Load report
    health_status = 'unknown'
    if os.path.exists('/tmp/health_pre.json'):
        try:
            with open('/tmp/health_pre.json', 'r') as f:
                health_data = json.load(f)
                health_status = health_data.get('overall_status', 'unknown')
        except:
            pass

    return {
        'success': result['success'],
        'health_status': health_status,
        'critical': health_status == 'critical',
    }


def step_log_analysis(args):
    """Step 2: Run log analysis."""
    cmd = f"python scripts/log_analyzer.py --days 1 --auto-suggest-terms"
    if args.verbose:
        cmd += " -v"

    start = time.time()
    result = run_command(cmd, timeout=180, verbose=args.verbose)
    duration = round(time.time() - start, 1)

    return {
        'success': result['success'],
        'duration_sec': duration,
    }


def step_enrichment(args):
    """Step 3: Content enrichment."""
    cmd = f"python scripts/enrich_deep.py --limit {args.enrich_limit}"
    if args.dry_run:
        cmd += " --dry-run"
    if args.verbose:
        cmd += " -v"

    start = time.time()
    result = run_command(cmd, timeout=900, verbose=args.verbose)
    duration = round(time.time() - start, 1)

    # Parse enriched count
    enriched = 0
    for line in result['stdout'].split('\n'):
        if 'enriched' in line.lower():
            import re
            match = re.search(r'(\d+)', line)
            if match:
                enriched = int(match.group(1))
                break

    return {
        'success': result['success'],
        'duration_sec': duration,
        'enriched_count': enriched,
    }


def step_tag_hygiene(args):
    """Step 4: Tag hygiene (multiple scripts)."""
    results = {}

    # submission_agent_improver.py
    cmd1 = "python scripts/submission_agent_improver.py --fix-tags --fix-spelling"
    if not args.dry_run:
        cmd1 += " --apply"
    if args.verbose:
        cmd1 += " -v"

    result1 = run_command(cmd1, timeout=180, verbose=args.verbose)
    results['improver'] = {
        'success': result1['success'],
        'stdout_sample': result1['stdout'][:200],
    }

    # fix_tag_format.py
    cmd2 = "python scripts/fix_tag_format.py"
    if args.dry_run:
        cmd2 += " --dry-run"

    result2 = run_command(cmd2, timeout=120, verbose=args.verbose)
    results['format'] = {
        'success': result2['success'],
    }

    return {
        'success': results['improver']['success'] and results['format']['success'],
        'sub_results': results,
    }


def step_content_audit(args):
    """Step 5: Content audit (weekly only)."""
    cmd = f"python scripts/audit_content_tags.py --output /tmp/audit_report.json"
    if args.verbose:
        cmd += " -v"

    start = time.time()
    result = run_command(cmd, timeout=300, verbose=args.verbose)
    duration = round(time.time() - start, 1)

    return {
        'success': result['success'],
        'duration_sec': duration,
    }


def step_content_gaps(args):
    """Step 6: Content gaps analysis (weekly only)."""
    cmd = f"python scripts/query_popularity_report.py --days 7 --output /tmp/gaps_report.json"
    if args.verbose:
        cmd += " -v"

    start = time.time()
    result = run_command(cmd, timeout=300, verbose=args.verbose)
    duration = round(time.time() - start, 1)

    return {
        'success': result['success'],
        'duration_sec': duration,
    }


def step_import_all(args):
    """Step 7: Import all sources (full mode only)."""
    cmd = f"python scripts/import_orchestrator.py --enrich-limit {args.enrich_limit}"
    if args.dry_run:
        cmd += " --dry-run"
    if args.verbose:
        cmd += " -v"

    start = time.time()
    result = run_command(cmd, timeout=1800, verbose=args.verbose)
    duration = round(time.time() - start, 1)

    return {
        'success': result['success'],
        'duration_sec': duration,
    }


def step_health_check_post(args):
    """Step 8: Post-maintenance health check."""
    cmd = f"python scripts/health_monitor.py --baseline-days 7 --output /tmp/health_post.json"
    if args.verbose:
        cmd += " -v"

    result = run_command(cmd, timeout=120, verbose=args.verbose)

    # Load both reports for comparison
    health_pre = {}
    health_post = {}

    if os.path.exists('/tmp/health_pre.json'):
        try:
            with open('/tmp/health_pre.json', 'r') as f:
                health_pre = json.load(f)
        except:
            pass

    if os.path.exists('/tmp/health_post.json'):
        try:
            with open('/tmp/health_post.json', 'r') as f:
                health_post = json.load(f)
        except:
            pass

    # Calculate delta
    delta = {}
    if health_pre and health_post:
        pre_qc = health_pre.get('query_quality', {}).get('current', {})
        post_qc = health_post.get('query_quality', {}).get('current', {})

        if pre_qc and post_qc:
            delta['zero_result_rate_change'] = round(
                post_qc.get('zero_result_rate', 0) - pre_qc.get('zero_result_rate', 0), 2
            )

        pre_cf = health_pre.get('content_freshness', {})
        post_cf = health_post.get('content_freshness', {})

        if pre_cf and post_cf:
            delta['never_enriched_change'] = post_cf.get('never_enriched', 0) - pre_cf.get('never_enriched', 0)

    return {
        'success': result['success'],
        'health_status_post': health_post.get('overall_status', 'unknown'),
        'delta': delta,
    }


def run_maintenance(args):
    """Run full maintenance cycle."""
    mode = args.mode
    steps_to_run = MAINTENANCE_STEPS.get(mode, MAINTENANCE_STEPS['daily'])

    # Apply skip filter
    if args.skip:
        skip_list = [s.strip() for s in args.skip.split(',')]
        steps_to_run = [s for s in steps_to_run if s not in skip_list]

    total_steps = len(steps_to_run)
    results = {}
    step_num = 0

    print("\n" + "=" * 60)
    print(f"MAINTENANCE CYCLE: {mode.upper()}")
    print(f"Steps: {total_steps}")
    print("=" * 60)

    # Run each step
    for step_name in steps_to_run:
        step_num += 1
        print(f"\n[{step_num}/{total_steps}] {step_name.replace('_', ' ').title()}...")

        if step_name == 'health_check_pre':
            result = step_health_check_pre(args)
            results[step_name] = result
            print(f"    Status: {result['health_status']}")

            # Gate: stop if critical and stop-on-error enabled
            if result.get('critical') and args.stop_on_error:
                print("\n  CRITICAL HEALTH STATUS - Stopping maintenance cycle")
                results['stopped_at'] = step_name
                break

        elif step_name == 'log_analysis':
            result = step_log_analysis(args)
            results[step_name] = result
            print(f"    Success: {result['success']}")
            if not result['success'] and args.stop_on_error:
                results['stopped_at'] = step_name
                break

        elif step_name == 'enrichment':
            result = step_enrichment(args)
            results[step_name] = result
            print(f"    Enriched: {result.get('enriched_count', 0)}")
            if not result['success'] and args.stop_on_error:
                results['stopped_at'] = step_name
                break

        elif step_name == 'tag_hygiene':
            result = step_tag_hygiene(args)
            results[step_name] = result
            print(f"    Success: {result['success']}")
            if not result['success'] and args.stop_on_error:
                results['stopped_at'] = step_name
                break

        elif step_name == 'content_audit':
            result = step_content_audit(args)
            results[step_name] = result
            print(f"    Success: {result['success']}")
            if not result['success'] and args.stop_on_error:
                results['stopped_at'] = step_name
                break

        elif step_name == 'content_gaps':
            result = step_content_gaps(args)
            results[step_name] = result
            print(f"    Success: {result['success']}")
            if not result['success'] and args.stop_on_error:
                results['stopped_at'] = step_name
                break

        elif step_name == 'import_all':
            result = step_import_all(args)
            results[step_name] = result
            print(f"    Success: {result['success']}")
            if not result['success'] and args.stop_on_error:
                results['stopped_at'] = step_name
                break

        elif step_name == 'health_check_post':
            result = step_health_check_post(args)
            results[step_name] = result
            print(f"    Status: {result['health_status_post']}")
            if result.get('delta'):
                for key, val in result['delta'].items():
                    print(f"    {key}: {val:+.1f}" if isinstance(val, float) else f"    {key}: {val:+d}")

    return results


def print_maintenance_report(report):
    """Print formatted maintenance report."""
    print("\n" + "=" * 60)
    print("MAINTENANCE REPORT")
    print(f"Mode: {report['mode']}")
    print(f"Time: {report['timestamp']}")
    print("=" * 60)

    results = report.get('results', {})
    total = len(results)
    successful = sum(1 for r in results.values() if r.get('success'))

    print(f"\n  Steps: {total}, Successful: {successful}")

    for step_name, result in results.items():
        icon = '+' if result.get('success') else 'X' if 'success' in result else '?'
        label = step_name.replace('_', ' ').title()
        print(f"    [{icon}] {label}")
        if result.get('duration_sec'):
            print(f"        Duration: {result['duration_sec']}s")

    if report.get('stopped_at'):
        print(f"\n  STOPPED AT: {report['stopped_at']}")

    print("\n" + "=" * 60)


def main():
    parser = argparse.ArgumentParser(description='Complete maintenance cycle orchestrator agent')
    parser.add_argument('--mode', choices=['daily', 'weekly', 'full'], default='daily',
                        help='Maintenance mode (default: daily)')
    parser.add_argument('--skip', type=str,
                        help='Comma-separated steps to skip (e.g., log_analysis,enrichment)')
    parser.add_argument('--enrich-limit', type=int, default=20,
                        help='Max records to enrich (default: 20)')
    parser.add_argument('--stop-on-error', action='store_true',
                        help='Stop at first failed step')
    parser.add_argument('--output', type=str, help='Output file for JSON report')
    parser.add_argument('--dry-run', action='store_true', help='Preview only')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')

    args = parser.parse_args()

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    start_time = time.time()

    # Run maintenance
    results = run_maintenance(args)

    total_duration = round(time.time() - start_time, 1)

    # Generate report
    report = {
        'agent': 'maintenance-orchestrator',
        'version': '1.0.0',
        'timestamp': datetime.now().isoformat(),
        'mode': args.mode,
        'total_duration_sec': total_duration,
        'results': results,
        'stopped_at': results.get('stopped_at'),
    }

    print_maintenance_report(report)

    # Save report
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(report, f, indent=2, cls=DecimalEncoder)
        print(f"\n  Report saved to {args.output}")

    print(f"\nTotal duration: {total_duration}s")
    print("Done!")

    # Exit code
    if results.get('stopped_at'):
        sys.exit(1)
    sys.exit(0)


if __name__ == '__main__':
    main()

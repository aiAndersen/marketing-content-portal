#!/usr/bin/env python3
"""
Pre-Deployment Safety Agent

Multi-step agent that validates environment, build, migrations, database health,
and git state before deploying to staging or production.

Steps:
    1. Verify environment variables (local, Vercel, GitHub secrets)
    2. Build frontend and check for errors
    3. Detect pending database migrations
    4. Database health snapshot
    5. Git state validation
    6. Generate go/no-go report

Usage:
    python scripts/deploy_preflight.py                       # Full preflight (staging)
    python scripts/deploy_preflight.py --target production   # Check for prod deploy
    python scripts/deploy_preflight.py --skip-build          # Skip frontend build
    python scripts/deploy_preflight.py --strict              # Exit 1 on any warning
    python scripts/deploy_preflight.py --output report.json
    python scripts/deploy_preflight.py --dry-run -v
"""

import os
import sys
import json
import argparse
import subprocess
import time
import glob as globmod
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

# Required env vars per target
REQUIRED_ENV_VARS = {
    'local': [
        'DATABASE_URL',
        'OPENAI_API_KEY',
        'VITE_SUPABASE_URL',
        'VITE_SUPABASE_ANON_KEY',
    ],
    'vercel': [
        'SUPABASE_URL',
        'SUPABASE_SERVICE_KEY',
        'OPENAI_API_KEY',
        'VITE_SUPABASE_URL',
        'VITE_SUPABASE_ANON_KEY',
    ],
    'github': [
        'DATABASE_URL',
        'OPENAI_API_KEY',
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


def run_command(cmd, timeout=120, verbose=False):
    """Run a shell command and return result dict."""
    if verbose:
        print(f"    $ {cmd}")
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


def step_check_env_vars(args):
    """Step 1: Verify environment variables exist across systems."""
    results = {'local': {}, 'vercel': None, 'github': None}
    issues = []

    # Check local env vars
    for var in REQUIRED_ENV_VARS['local']:
        value = os.getenv(var)
        present = bool(value)
        results['local'][var] = present
        if not present:
            issues.append(f"Local env var missing: {var}")

    # Check Vercel env vars (if not skipped)
    if not args.skip_vercel:
        vercel_check = run_command('vercel env ls 2>/dev/null', verbose=args.verbose)
        if vercel_check['success']:
            vercel_output = vercel_check['stdout']
            results['vercel'] = {}
            for var in REQUIRED_ENV_VARS['vercel']:
                present = var in vercel_output
                results['vercel'][var] = present
                if not present:
                    issues.append(f"Vercel env var missing: {var}")
        else:
            results['vercel'] = 'skipped (Vercel CLI not available or not authenticated)'
            if args.verbose:
                print("    Vercel CLI not available, skipping Vercel env check")
    else:
        results['vercel'] = 'skipped (--skip-vercel)'

    # Check GitHub secrets
    gh_check = run_command('gh secret list 2>/dev/null', verbose=args.verbose)
    if gh_check['success']:
        gh_output = gh_check['stdout']
        results['github'] = {}
        for var in REQUIRED_ENV_VARS['github']:
            present = var in gh_output
            results['github'][var] = present
            if not present:
                issues.append(f"GitHub secret missing: {var}")
    else:
        results['github'] = 'skipped (gh CLI not available or not authenticated)'
        if args.verbose:
            print("    GitHub CLI not available, skipping GitHub secrets check")

    status = 'pass' if not issues else 'fail'
    return {'status': status, 'results': results, 'issues': issues}


def step_build_frontend(args):
    """Step 2: Run frontend build and check for errors."""
    if args.skip_build:
        return {'status': 'skipped', 'reason': '--skip-build'}

    # Find frontend directory
    frontend_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'frontend')
    if not os.path.isdir(frontend_dir):
        return {'status': 'fail', 'issues': [f'Frontend directory not found: {frontend_dir}']}

    # Check if node_modules exists
    if not os.path.isdir(os.path.join(frontend_dir, 'node_modules')):
        print("    Installing dependencies first...")
        install = run_command(f'cd "{frontend_dir}" && npm install', timeout=120, verbose=args.verbose)
        if not install['success']:
            return {'status': 'fail', 'issues': ['npm install failed: ' + install['stderr'][:200]]}

    # Run build
    print("    Running npm run build...")
    build = run_command(f'cd "{frontend_dir}" && npm run build 2>&1', timeout=180, verbose=args.verbose)

    issues = []
    warnings = []

    if not build['success']:
        issues.append('Build failed')
        if build['stderr']:
            issues.append(build['stderr'][:500])
        if build['stdout']:
            # Look for error lines
            for line in build['stdout'].split('\n'):
                if 'error' in line.lower():
                    issues.append(line.strip()[:200])
    else:
        # Check for warnings in output
        for line in build['stdout'].split('\n'):
            if 'warning' in line.lower() or 'warn' in line.lower():
                warnings.append(line.strip()[:200])

    status = 'fail' if issues else ('warn' if warnings else 'pass')
    result = {'status': status, 'issues': issues}
    if warnings:
        result['warnings'] = warnings[:10]
    return result


def step_check_migrations(args):
    """Step 3: Detect pending database migrations."""
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    scripts_dir = os.path.join(project_root, 'scripts')

    # Find migration scripts
    migration_files = sorted(globmod.glob(os.path.join(scripts_dir, 'run_*_migration.py')))
    if not migration_files:
        return {'status': 'pass', 'message': 'No migration scripts found', 'migrations': []}

    # Check git status of migration files
    migrations = []
    for mf in migration_files:
        basename = os.path.basename(mf)
        # Check if modified since last commit
        git_check = run_command(
            f'cd "{project_root}" && git diff --name-only HEAD -- "scripts/{basename}" 2>/dev/null',
            verbose=args.verbose
        )
        modified = bool(git_check['stdout'].strip()) if git_check['success'] else False

        # Check if in staging area
        staged_check = run_command(
            f'cd "{project_root}" && git diff --cached --name-only -- "scripts/{basename}" 2>/dev/null',
            verbose=args.verbose
        )
        staged = bool(staged_check['stdout'].strip()) if staged_check['success'] else False

        migrations.append({
            'file': basename,
            'modified': modified,
            'staged': staged,
        })

    modified_migrations = [m for m in migrations if m['modified'] or m['staged']]
    issues = []
    if modified_migrations:
        for m in modified_migrations:
            issues.append(f"Migration modified but not applied: {m['file']}")

    status = 'warn' if modified_migrations else 'pass'
    return {
        'status': status,
        'migrations': migrations,
        'modified_count': len(modified_migrations),
        'issues': issues,
    }


def step_db_health(args):
    """Step 4: Database health snapshot."""
    if not DATABASE_URL:
        return {'status': 'fail', 'issues': ['DATABASE_URL not set']}

    try:
        conn = psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)
    except Exception as e:
        return {'status': 'fail', 'issues': [f'Database connection failed: {str(e)[:200]}']}

    try:
        with conn.cursor() as cur:
            # Total records
            cur.execute("SELECT COUNT(*) as total FROM marketing_content")
            total = cur.fetchone()['total']

            # Records with null keywords
            cur.execute("SELECT COUNT(*) as cnt FROM marketing_content WHERE keywords IS NULL OR keywords = '[]'::jsonb")
            null_keywords = cur.fetchone()['cnt']

            # Records with extraction errors
            cur.execute("SELECT COUNT(*) as cnt FROM marketing_content WHERE extraction_error IS NOT NULL")
            extraction_errors = cur.fetchone()['cnt']

            # Records not deep enriched
            cur.execute("SELECT COUNT(*) as cnt FROM marketing_content WHERE deep_enriched_at IS NULL")
            not_enriched = cur.fetchone()['cnt']

            # Recent zero-result queries (last 24h)
            cur.execute("""
                SELECT COUNT(*) as cnt FROM ai_prompt_logs
                WHERE created_at > NOW() - INTERVAL '24 hours'
                AND (recommendations_count = 0 OR recommendations_count IS NULL)
            """)
            zero_results_24h = cur.fetchone()['cnt']

            # Total queries last 24h
            cur.execute("""
                SELECT COUNT(*) as cnt FROM ai_prompt_logs
                WHERE created_at > NOW() - INTERVAL '24 hours'
            """)
            total_queries_24h = cur.fetchone()['cnt']

        conn.close()

        zero_rate = round(zero_results_24h / max(total_queries_24h, 1) * 100, 1)
        issues = []
        if zero_rate > 20:
            issues.append(f"High zero-result rate: {zero_rate}% ({zero_results_24h}/{total_queries_24h} queries)")
        if extraction_errors > 10:
            issues.append(f"High extraction error count: {extraction_errors}")

        status = 'fail' if issues else 'pass'
        return {
            'status': status,
            'total_records': total,
            'null_keywords': null_keywords,
            'extraction_errors': extraction_errors,
            'not_deep_enriched': not_enriched,
            'queries_24h': total_queries_24h,
            'zero_result_queries_24h': zero_results_24h,
            'zero_result_rate': f"{zero_rate}%",
            'issues': issues,
        }

    except Exception as e:
        conn.close()
        return {'status': 'fail', 'issues': [f'Health check query failed: {str(e)[:200]}']}


def step_git_state(args):
    """Step 5: Git state validation."""
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    issues = []

    # Current branch
    branch_result = run_command(f'cd "{project_root}" && git branch --show-current 2>/dev/null', verbose=args.verbose)
    current_branch = branch_result['stdout'] if branch_result['success'] else 'unknown'

    # Check if on expected branch for target
    expected_branches = {
        'staging': ['staging', 'main'],
        'production': ['main', 'staging'],
    }
    target = args.target
    if current_branch not in expected_branches.get(target, []):
        issues.append(f"On branch '{current_branch}', expected one of {expected_branches.get(target, [])}")

    # Uncommitted changes
    status_result = run_command(f'cd "{project_root}" && git status --porcelain 2>/dev/null', verbose=args.verbose)
    uncommitted = status_result['stdout'].strip() if status_result['success'] else ''
    has_uncommitted = bool(uncommitted)
    if has_uncommitted:
        changed_files = len(uncommitted.split('\n'))
        issues.append(f"Uncommitted changes: {changed_files} files")

    # Remote sync
    fetch_result = run_command(f'cd "{project_root}" && git fetch --dry-run 2>&1', verbose=args.verbose)
    ahead_behind = run_command(
        f'cd "{project_root}" && git rev-list --left-right --count HEAD...@{{u}} 2>/dev/null',
        verbose=args.verbose
    )
    ahead = 0
    behind = 0
    if ahead_behind['success'] and ahead_behind['stdout']:
        parts = ahead_behind['stdout'].split()
        if len(parts) == 2:
            ahead, behind = int(parts[0]), int(parts[1])

    if behind > 0:
        issues.append(f"Branch is {behind} commits behind remote")
    if ahead > 0 and args.verbose:
        print(f"    Branch is {ahead} commits ahead of remote (needs push)")

    status = 'fail' if issues else 'pass'
    return {
        'status': status,
        'current_branch': current_branch,
        'target': target,
        'has_uncommitted_changes': has_uncommitted,
        'ahead_of_remote': ahead,
        'behind_remote': behind,
        'issues': issues,
    }


def step_generate_report(steps_results, args):
    """Step 6: Generate go/no-go report."""
    all_issues = []
    all_warnings = []
    step_summaries = []

    for step_name, result in steps_results.items():
        status = result.get('status', 'unknown')
        issues = result.get('issues', [])
        warnings = result.get('warnings', [])

        step_summaries.append({
            'step': step_name,
            'status': status,
            'issue_count': len(issues),
        })

        all_issues.extend(issues)
        all_warnings.extend(warnings)

    has_failures = any(r.get('status') == 'fail' for r in steps_results.values())
    has_warnings = any(r.get('status') == 'warn' for r in steps_results.values())

    if has_failures:
        decision = 'NO-GO'
    elif has_warnings and args.strict:
        decision = 'NO-GO'
    elif has_warnings:
        decision = 'GO (with warnings)'
    else:
        decision = 'GO'

    report = {
        'agent': 'deploy-preflight',
        'version': '1.0.0',
        'timestamp': datetime.now().isoformat(),
        'target': args.target,
        'decision': decision,
        'steps': steps_results,
        'step_summaries': step_summaries,
        'total_issues': len(all_issues),
        'total_warnings': len(all_warnings),
        'issues': all_issues,
        'warnings': all_warnings,
    }

    return report


def print_report(report):
    """Print formatted report to console."""
    print("\n" + "=" * 60)
    print("PRE-DEPLOYMENT SAFETY CHECK")
    print(f"Target: {report['target'].upper()}")
    print(f"Time: {report['timestamp']}")
    print("=" * 60)

    for step in report['step_summaries']:
        icon = {
            'pass': '+', 'fail': 'X', 'warn': '!', 'skipped': '-'
        }.get(step['status'], '?')
        label = step['step'].replace('_', ' ').title()
        print(f"  [{icon}] {label} ({step['status']})")

    if report['issues']:
        print(f"\n  Issues ({len(report['issues'])}):")
        for issue in report['issues']:
            print(f"    X {issue}")

    if report['warnings']:
        print(f"\n  Warnings ({len(report['warnings'])}):")
        for warning in report['warnings'][:5]:
            print(f"    ! {warning}")

    print(f"\n  Decision: {report['decision']}")
    print("=" * 60)


def main():
    parser = argparse.ArgumentParser(description='Pre-deployment safety validation agent')
    parser.add_argument('--target', choices=['staging', 'production'], default='staging',
                        help='Deploy target (default: staging)')
    parser.add_argument('--skip-build', action='store_true', help='Skip frontend build check')
    parser.add_argument('--skip-vercel', action='store_true', help='Skip Vercel env check')
    parser.add_argument('--strict', action='store_true', help='Exit 1 on any warning (not just failures)')
    parser.add_argument('--output', type=str, help='Output file for JSON report')
    parser.add_argument('--dry-run', action='store_true', help='Preview only')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')

    args = parser.parse_args()

    total_steps = 6
    print("=" * 60)
    print(f"Pre-Deployment Safety Agent — target: {args.target}")
    print("=" * 60)

    steps_results = {}

    # Step 1: Environment variables
    print(f"\n[1/{total_steps}] Checking environment variables...")
    result = step_check_env_vars(args)
    steps_results['env_vars'] = result
    local_status = result.get('results', {}).get('local', {})
    missing = sum(1 for v in local_status.values() if not v) if isinstance(local_status, dict) else 0
    print(f"  Local: {len(local_status) - missing}/{len(local_status)} vars present" if isinstance(local_status, dict) else f"  {result['status']}")

    # Step 2: Frontend build
    print(f"\n[2/{total_steps}] Checking frontend build...")
    result = step_build_frontend(args)
    steps_results['frontend_build'] = result
    print(f"  Build: {result['status']}")

    # Step 3: Migrations
    print(f"\n[3/{total_steps}] Checking database migrations...")
    result = step_check_migrations(args)
    steps_results['migrations'] = result
    print(f"  Migrations: {result['status']} ({result.get('modified_count', 0)} modified)")

    # Step 4: Database health
    print(f"\n[4/{total_steps}] Checking database health...")
    result = step_db_health(args)
    steps_results['db_health'] = result
    if result['status'] != 'fail' or 'total_records' in result:
        print(f"  Records: {result.get('total_records', 'N/A')}, "
              f"Zero-result rate: {result.get('zero_result_rate', 'N/A')}")
    else:
        print(f"  Status: {result['status']}")

    # Step 5: Git state
    print(f"\n[5/{total_steps}] Checking git state...")
    result = step_git_state(args)
    steps_results['git_state'] = result
    print(f"  Branch: {result.get('current_branch', 'unknown')}, "
          f"Uncommitted: {result.get('has_uncommitted_changes', 'unknown')}")

    # Step 6: Generate report
    print(f"\n[6/{total_steps}] Generating report...")
    report = step_generate_report(steps_results, args)

    # Print summary
    print_report(report)

    # Save report
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(report, f, indent=2, cls=DecimalEncoder)
        print(f"\n  Report saved to {args.output}")

    # Exit code
    if report['decision'] == 'NO-GO':
        sys.exit(1)
    elif report['decision'].startswith('GO'):
        sys.exit(0)


if __name__ == '__main__':
    main()

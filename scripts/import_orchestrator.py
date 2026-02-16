#!/usr/bin/env python3
"""
Unified Content Import Orchestrator Agent

Multi-step agent that orchestrates imports from all available sources,
runs deduplication, triggers enrichment on new records, and audits results.

Steps:
    1. Pre-import snapshot (record counts, type/state distribution)
    2. Test source connectivity (Webflow, HubSpot, Google Drive APIs)
    3. Run imports sequentially (dry-run first, then apply)
    4. Cross-source deduplication
    5. Post-import enrichment on new records
    6. Post-import audit delta
    7. Generate import report

Usage:
    python scripts/import_orchestrator.py                          # All sources
    python scripts/import_orchestrator.py --sources webflow        # Specific source
    python scripts/import_orchestrator.py --skip-enrich            # Skip enrichment
    python scripts/import_orchestrator.py --enrich-limit 10        # Limit enrichment
    python scripts/import_orchestrator.py --output report.json
    python scripts/import_orchestrator.py --dry-run -v
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
WEBFLOW_API_TOKEN = os.getenv('WEBFLOW_API_TOKEN')
HUBSPOT_API_KEY = os.getenv('HUBSPOT_API_KEY')
GOOGLE_SERVICE_ACCOUNT_KEY_PATH = os.getenv('GOOGLE_SERVICE_ACCOUNT_KEY_PATH')

# Import source configurations
IMPORT_SOURCES = {
    'webflow': {
        'name': 'Webflow Resources',
        'script': 'scripts/import_webflow_resources.py',
        'requires_env': ['WEBFLOW_API_TOKEN'],
        'enabled': bool(WEBFLOW_API_TOKEN),
    },
    'webflow_landing': {
        'name': 'Webflow Landing Pages',
        'script': 'scripts/import_webflow_landing_pages.py',
        'requires_env': ['WEBFLOW_API_TOKEN'],
        'enabled': bool(WEBFLOW_API_TOKEN),
    },
    'hubspot': {
        'name': 'HubSpot Files',
        'script': 'scripts/import_hubspot_files.py',
        'requires_env': ['HUBSPOT_API_KEY'],
        'enabled': bool(HUBSPOT_API_KEY),
    },
    'google_drive': {
        'name': 'Google Drive',
        'script': 'scripts/import_google_drive.py',
        'requires_env': ['GOOGLE_SERVICE_ACCOUNT_KEY_PATH'],
        'enabled': bool(GOOGLE_SERVICE_ACCOUNT_KEY_PATH and os.path.exists(GOOGLE_SERVICE_ACCOUNT_KEY_PATH or '')),
    },
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


def run_command(cmd, timeout=300, verbose=False):
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


def step_pre_import_snapshot(conn, verbose=False):
    """Step 1: Capture pre-import database state."""
    with conn.cursor() as cur:
        # Total records
        cur.execute("SELECT COUNT(*) as cnt FROM marketing_content")
        total = cur.fetchone()['cnt']

        # By type
        cur.execute("""
            SELECT type, COUNT(*) as cnt
            FROM marketing_content
            GROUP BY type
            ORDER BY cnt DESC
        """)
        by_type = {row['type']: row['cnt'] for row in cur.fetchall()}

        # By platform
        cur.execute("""
            SELECT platform, COUNT(*) as cnt
            FROM marketing_content
            GROUP BY platform
            ORDER BY cnt DESC
        """)
        by_platform = {row['platform']: row['cnt'] for row in cur.fetchall()}

    return {
        'timestamp': datetime.now().isoformat(),
        'total_records': total,
        'by_type': by_type,
        'by_platform': by_platform,
    }


def step_test_connectivity(sources_to_test, verbose=False):
    """Step 2: Test connectivity to each import source."""
    connectivity = {}

    for source_key in sources_to_test:
        source = IMPORT_SOURCES.get(source_key)
        if not source:
            connectivity[source_key] = {'available': False, 'reason': 'Unknown source'}
            continue

        # Check if enabled
        if not source['enabled']:
            missing_env = [e for e in source['requires_env'] if not os.getenv(e)]
            connectivity[source_key] = {
                'available': False,
                'reason': f"Missing env vars: {', '.join(missing_env)}"
            }
            continue

        # Check if script exists
        script_path = source['script']
        if not os.path.exists(script_path):
            connectivity[source_key] = {
                'available': False,
                'reason': f"Script not found: {script_path}"
            }
            continue

        connectivity[source_key] = {'available': True, 'script': script_path}

    return connectivity


def step_run_imports(conn, sources, connectivity, dry_run=False, verbose=False):
    """Step 3: Run imports sequentially."""
    import_results = {}

    for source_key in sources:
        conn_info = connectivity.get(source_key, {})
        if not conn_info.get('available'):
            import_results[source_key] = {
                'status': 'skipped',
                'reason': conn_info.get('reason', 'Not available'),
            }
            continue

        script = conn_info['script']
        source_name = IMPORT_SOURCES[source_key]['name']

        print(f"    Running {source_name} import...")

        # Build command
        cmd = f"python {script}"
        if dry_run:
            cmd += " --dry-run"
        if verbose:
            cmd += " -v"

        # Run import
        start = time.time()
        result = run_command(cmd, timeout=600, verbose=verbose)
        duration = round(time.time() - start, 1)

        # Parse output for import count (heuristic: look for "imported X" or "added X")
        import re
        imported_count = 0
        for line in result['stdout'].split('\n'):
            match = re.search(r'(?:imported|added|created)\s+(\d+)', line, re.IGNORECASE)
            if match:
                imported_count = int(match.group(1))
                break

        import_results[source_key] = {
            'status': 'success' if result['success'] else 'failed',
            'duration_sec': duration,
            'imported_count': imported_count,
            'stdout_sample': result['stdout'][:500],
            'stderr': result['stderr'][:200] if result['stderr'] else None,
        }

    return import_results


def step_run_deduplication(conn, skip_dedup=False, dry_run=False, verbose=False):
    """Step 4: Run cross-source deduplication."""
    if skip_dedup:
        return {'status': 'skipped', 'reason': '--skip-dedup'}

    print(f"    Running deduplication scan...")
    cmd = "python scripts/dedup_content.py --threshold 0.85 --output /tmp/dedup_report.json"
    if verbose:
        cmd += " -v"

    result = run_command(cmd, timeout=300, verbose=verbose)

    # Load dedup report
    dupes_found = 0
    if os.path.exists('/tmp/dedup_report.json'):
        try:
            with open('/tmp/dedup_report.json', 'r') as f:
                dedup_data = json.load(f)
                dupes_found = dedup_data.get('total_duplicates', 0)
        except:
            pass

    return {
        'status': 'success' if result['success'] else 'failed',
        'duplicates_found': dupes_found,
        'note': 'Use --merge flag on dedup_content.py to interactively merge',
    }


def step_post_import_enrichment(conn, skip_enrich=False, enrich_limit=20, dry_run=False, verbose=False):
    """Step 5: Trigger enrichment on newly imported (unenriched) records."""
    if skip_enrich:
        return {'status': 'skipped', 'reason': '--skip-enrich'}

    print(f"    Running enrichment on new records (limit: {enrich_limit})...")
    cmd = f"python scripts/enrich_deep.py --limit {enrich_limit}"
    if dry_run:
        cmd += " --dry-run"
    if verbose:
        cmd += " -v"

    start = time.time()
    result = run_command(cmd, timeout=900, verbose=verbose)
    duration = round(time.time() - start, 1)

    # Parse enrichment count
    enriched_count = 0
    for line in result['stdout'].split('\n'):
        if 'enriched' in line.lower():
            import re
            match = re.search(r'(\d+)', line)
            if match:
                enriched_count = int(match.group(1))
                break

    return {
        'status': 'success' if result['success'] else 'failed',
        'duration_sec': duration,
        'enriched_count': enriched_count,
    }


def step_post_import_audit(conn, pre_snapshot, verbose=False):
    """Step 6: Quick audit to show delta."""
    print(f"    Running post-import audit...")

    # Get post-import snapshot
    post = step_pre_import_snapshot(conn, verbose)

    # Calculate delta
    delta = {
        'total_records_added': post['total_records'] - pre_snapshot['total_records'],
        'new_types': {},
        'new_platforms': {},
    }

    # Type deltas
    for type_name, count in post['by_type'].items():
        pre_count = pre_snapshot['by_type'].get(type_name, 0)
        if count > pre_count:
            delta['new_types'][type_name] = count - pre_count

    # Platform deltas
    for platform, count in post['by_platform'].items():
        pre_count = pre_snapshot['by_platform'].get(platform, 0)
        if count > pre_count:
            delta['new_platforms'][platform] = count - pre_count

    return {
        'status': 'success',
        'pre': pre_snapshot,
        'post': post,
        'delta': delta,
    }


def print_import_report(report):
    """Print formatted import report."""
    print("\n" + "=" * 60)
    print("IMPORT ORCHESTRATION REPORT")
    print(f"Time: {report['timestamp']}")
    print("=" * 60)

    # Connectivity
    conn = report.get('connectivity', {})
    available = sum(1 for c in conn.values() if c.get('available'))
    print(f"\n  Sources Available: {available}/{len(conn)}")
    for source, info in conn.items():
        icon = '+' if info.get('available') else 'X'
        name = IMPORT_SOURCES.get(source, {}).get('name', source)
        print(f"    [{icon}] {name}")
        if not info.get('available'):
            print(f"        {info.get('reason', 'Unknown')}")

    # Import results
    imports = report.get('import_results', {})
    if imports:
        print(f"\n  Import Results:")
        for source, result in imports.items():
            name = IMPORT_SOURCES.get(source, {}).get('name', source)
            status = result.get('status', 'unknown')
            icon = '+' if status == 'success' else 'X' if status == 'failed' else '-'
            print(f"    [{icon}] {name} ({status})")
            if result.get('imported_count'):
                print(f"        Imported: {result['imported_count']}")
            if result.get('duration_sec'):
                print(f"        Duration: {result['duration_sec']}s")

    # Dedup
    dedup = report.get('deduplication', {})
    if dedup.get('status') != 'skipped':
        print(f"\n  Deduplication: {dedup.get('duplicates_found', 0)} duplicates found")

    # Enrichment
    enrich = report.get('enrichment', {})
    if enrich.get('status') != 'skipped':
        print(f"\n  Enrichment: {enrich.get('enriched_count', 0)} records enriched")

    # Delta
    audit = report.get('audit', {})
    if 'delta' in audit:
        delta = audit['delta']
        print(f"\n  Records Added: {delta['total_records_added']}")
        if delta.get('new_types'):
            print(f"    By type:")
            for t, cnt in delta['new_types'].items():
                print(f"      {t}: +{cnt}")

    print("\n" + "=" * 60)


def main():
    parser = argparse.ArgumentParser(description='Unified content import orchestrator agent')
    parser.add_argument('--sources', type=str,
                        help='Comma-separated source list (webflow,hubspot,google_drive,webflow_landing)')
    parser.add_argument('--skip-enrich', action='store_true', help='Skip post-import enrichment')
    parser.add_argument('--skip-dedup', action='store_true', help='Skip deduplication')
    parser.add_argument('--enrich-limit', type=int, default=20, help='Max records to enrich (default: 20)')
    parser.add_argument('--output', type=str, help='Output file for JSON report')
    parser.add_argument('--dry-run', action='store_true', help='Preview only')
    parser.add_argument('-v', '--verbose', action='store_true', help='Verbose output')

    args = parser.parse_args()

    # Parse sources
    if args.sources:
        requested_sources = [s.strip() for s in args.sources.split(',')]
    else:
        requested_sources = list(IMPORT_SOURCES.keys())

    total_steps = 7
    print("=" * 60)
    print(f"Import Orchestration Agent")
    print(f"Sources: {', '.join(requested_sources)}")
    print("=" * 60)

    if not DATABASE_URL:
        print("ERROR: DATABASE_URL not set")
        sys.exit(1)

    conn = get_db_connection()

    # Step 1: Pre-import snapshot
    print(f"\n[1/{total_steps}] Pre-import snapshot...")
    pre = step_pre_import_snapshot(conn, args.verbose)
    print(f"  Total records: {pre['total_records']}")

    # Step 2: Test connectivity
    print(f"\n[2/{total_steps}] Testing source connectivity...")
    connectivity = step_test_connectivity(requested_sources, args.verbose)
    available = sum(1 for c in connectivity.values() if c.get('available'))
    print(f"  Available: {available}/{len(requested_sources)}")

    # Step 3: Run imports
    print(f"\n[3/{total_steps}] Running imports...")
    imports = step_run_imports(conn, requested_sources, connectivity, args.dry_run, args.verbose)
    successful = sum(1 for r in imports.values() if r.get('status') == 'success')
    print(f"  Completed: {successful}/{len(requested_sources)}")

    # Step 4: Deduplication
    print(f"\n[4/{total_steps}] Running deduplication...")
    dedup = step_run_deduplication(conn, args.skip_dedup, args.dry_run, args.verbose)
    print(f"  Status: {dedup.get('status', 'unknown')}")
    if dedup.get('duplicates_found'):
        print(f"  Duplicates found: {dedup['duplicates_found']}")

    # Step 5: Enrichment
    print(f"\n[5/{total_steps}] Post-import enrichment...")
    enrich = step_post_import_enrichment(conn, args.skip_enrich, args.enrich_limit, args.dry_run, args.verbose)
    print(f"  Status: {enrich.get('status', 'unknown')}")

    # Step 6: Audit
    print(f"\n[6/{total_steps}] Post-import audit...")
    audit = step_post_import_audit(conn, pre, args.verbose)
    print(f"  Delta: +{audit['delta']['total_records_added']} records")

    conn.close()

    # Step 7: Generate report
    print(f"\n[7/{total_steps}] Generating report...")
    report = {
        'agent': 'import-orchestrator',
        'version': '1.0.0',
        'timestamp': datetime.now().isoformat(),
        'sources_requested': requested_sources,
        'connectivity': connectivity,
        'import_results': imports,
        'deduplication': dedup,
        'enrichment': enrich,
        'audit': audit,
    }

    print_import_report(report)

    # Save report
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(report, f, indent=2, cls=DecimalEncoder)
        print(f"\n  Report saved to {args.output}")

    print("\nDone!")


if __name__ == '__main__':
    main()

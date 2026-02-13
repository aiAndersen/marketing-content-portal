#!/usr/bin/env python3
"""
Run the popularity reports migration to add new columns to log_analysis_reports.
Adds support for query popularity ranking, content gap analysis, and topic clustering.

Usage:
    python scripts/run_popularity_migration.py
    python scripts/run_popularity_migration.py --dry-run
"""

import os
import sys
import argparse
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('scripts/.env')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')

if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set")
    print("Export it or add to scripts/.env:")
    print("  export DATABASE_URL='postgresql://...'")
    sys.exit(1)

parser = argparse.ArgumentParser(description='Run popularity reports migration')
parser.add_argument('--dry-run', action='store_true', help='Print SQL without executing')
args = parser.parse_args()

migration_sql = """
ALTER TABLE log_analysis_reports
ADD COLUMN IF NOT EXISTS report_type VARCHAR(50) DEFAULT 'standard',
ADD COLUMN IF NOT EXISTS popularity_ranking JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS content_gaps JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS query_clusters JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS state_coverage JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS competitor_analysis JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS temporal_trends JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS executive_summary TEXT;

CREATE INDEX IF NOT EXISTS idx_log_analysis_report_type
  ON log_analysis_reports(report_type);

DROP POLICY IF EXISTS "Allow public update of log analysis reports" ON log_analysis_reports;
CREATE POLICY "Allow public update of log analysis reports"
  ON log_analysis_reports FOR UPDATE
  USING (true)
  WITH CHECK (true);
"""

if args.dry_run:
    print("DRY RUN - SQL to execute:")
    print(migration_sql)
    print("\nNo changes made.")
    sys.exit(0)

print("Connecting to database...")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    print("Running popularity reports migration...")
    cur.execute(migration_sql)
    conn.commit()
    print("  ✓ Columns added to log_analysis_reports")

    # Verify columns
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'log_analysis_reports'
        ORDER BY ordinal_position
    """)
    cols = [r[0] for r in cur.fetchall()]
    print(f"\n  Columns in log_analysis_reports ({len(cols)} total):")
    for col in cols:
        print(f"    - {col}")

    cur.close()
    conn.close()
    print("\n✅ Migration complete!")

except Exception as e:
    print(f"\n❌ ERROR: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

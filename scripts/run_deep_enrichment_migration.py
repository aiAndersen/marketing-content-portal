#!/usr/bin/env python3
"""
Run the deep enrichment migration to add keywords JSONB and deep_enriched_at
columns to marketing_content.

Usage:
    python scripts/run_deep_enrichment_migration.py
    python scripts/run_deep_enrichment_migration.py --dry-run
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

parser = argparse.ArgumentParser(description='Run deep enrichment migration')
parser.add_argument('--dry-run', action='store_true', help='Print SQL without executing')
args = parser.parse_args()

migration_sql = """
ALTER TABLE marketing_content
ADD COLUMN IF NOT EXISTS keywords JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS deep_enriched_at TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_marketing_content_keywords
  ON marketing_content USING GIN (keywords);
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

    print("Running deep enrichment migration...")
    cur.execute(migration_sql)
    conn.commit()
    print("  ✓ Columns added to marketing_content")

    # Verify columns
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'marketing_content'
        ORDER BY ordinal_position
    """)
    cols = [r[0] for r in cur.fetchall()]
    print(f"\n  Columns in marketing_content ({len(cols)} total):")
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

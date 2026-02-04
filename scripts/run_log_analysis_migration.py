#!/usr/bin/env python3
"""
Run the log_analysis_reports migration to create the table for storing
analysis results from the log analyzer agent.

Usage:
    python scripts/run_log_analysis_migration.py
"""

import os
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
    exit(1)

print(f"Connecting to database...")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    print("\nCreating log_analysis_reports table...")

    migration_sql = """
    -- Log Analysis Reports Table
    CREATE TABLE IF NOT EXISTS log_analysis_reports (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      -- Analysis metadata
      analysis_date DATE NOT NULL,
      logs_analyzed INT NOT NULL DEFAULT 0,
      time_range_start TIMESTAMPTZ,
      time_range_end TIMESTAMPTZ,

      -- Key metrics
      avg_recommendations_count DECIMAL(5,2) DEFAULT 0,
      zero_result_queries INT DEFAULT 0,
      low_confidence_queries INT DEFAULT 0,
      state_context_usage_count INT DEFAULT 0,
      competitor_query_count INT DEFAULT 0,

      -- AI-generated insights
      summary TEXT,
      issues_identified JSONB DEFAULT '[]',
      suggested_mappings JSONB DEFAULT '[]',
      pattern_insights JSONB DEFAULT '[]',

      -- Action items
      terminology_suggestions JSONB DEFAULT '[]',
      context_gaps JSONB DEFAULT '[]',
      state_context_usage JSONB DEFAULT '{}',

      -- Execution metadata
      execution_time_ms INT,
      model_used VARCHAR(50),
      error_message TEXT,

      -- Timestamps
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_log_analysis_date
      ON log_analysis_reports(analysis_date DESC);

    CREATE INDEX IF NOT EXISTS idx_log_analysis_created
      ON log_analysis_reports(created_at DESC);
    """

    cur.execute(migration_sql)
    conn.commit()
    print("  ✓ Table created")

    # RLS policies
    print("  Setting up RLS policies...")

    rls_sql = """
    -- Enable RLS
    ALTER TABLE log_analysis_reports ENABLE ROW LEVEL SECURITY;

    -- Drop existing policies if they exist
    DROP POLICY IF EXISTS "Allow public read of log analysis reports" ON log_analysis_reports;
    DROP POLICY IF EXISTS "Allow authenticated insert of log analysis reports" ON log_analysis_reports;

    -- Allow anyone to read reports
    CREATE POLICY "Allow public read of log analysis reports"
      ON log_analysis_reports FOR SELECT
      USING (true);

    -- Allow authenticated users to insert
    CREATE POLICY "Allow authenticated insert of log analysis reports"
      ON log_analysis_reports FOR INSERT
      TO authenticated
      WITH CHECK (true);
    """

    cur.execute(rls_sql)
    conn.commit()
    print("  ✓ RLS policies configured")

    # Verify table exists
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'log_analysis_reports'
        ORDER BY ordinal_position
    """)
    cols = [r[0] for r in cur.fetchall()]
    print(f"\n  Columns in log_analysis_reports ({len(cols)} total):")
    for col in cols[:10]:
        print(f"    - {col}")
    if len(cols) > 10:
        print(f"    ... and {len(cols) - 10} more")

    cur.close()
    conn.close()
    print("\n✅ Migration complete!")

except Exception as e:
    print(f"\n❌ ERROR: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

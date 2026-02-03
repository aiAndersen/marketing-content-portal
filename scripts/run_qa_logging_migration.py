#!/usr/bin/env python3
"""
Run the QA logging migration to add response columns to ai_prompt_logs.

Usage:
    export DATABASE_URL='postgresql://...'
    python scripts/run_qa_logging_migration.py
"""

import os
import psycopg2
from dotenv import load_dotenv

# Load environment variables
load_dotenv()
load_dotenv('.env.local')
load_dotenv('frontend/.env')

DATABASE_URL = os.getenv('DATABASE_URL')

if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set")
    print("Export it or add to .env.local:")
    print("  export DATABASE_URL='postgresql://postgres.[ref]:[pass]@aws-0-us-west-1.pooler.supabase.com:6543/postgres'")
    exit(1)

print(f"Connecting to database...")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # Run the migration
    migration_sql = """
    -- Add response columns for QA review (safe - uses IF NOT EXISTS)
    ALTER TABLE ai_prompt_logs
    ADD COLUMN IF NOT EXISTS ai_quick_answer TEXT,
    ADD COLUMN IF NOT EXISTS ai_key_points JSONB DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS ai_response_raw TEXT,
    ADD COLUMN IF NOT EXISTS recommendations_count INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS response_time_ms INT,
    ADD COLUMN IF NOT EXISTS session_id VARCHAR(100);

    -- Index for finding logs by session
    CREATE INDEX IF NOT EXISTS idx_ai_prompt_logs_session ON ai_prompt_logs(session_id);

    -- Index for finding logs needing review (no feedback yet)
    CREATE INDEX IF NOT EXISTS idx_ai_prompt_logs_needs_review
    ON ai_prompt_logs(created_at DESC)
    WHERE response_helpful IS NULL;
    """

    print("Running migration...")
    cur.execute(migration_sql)
    conn.commit()
    print("✓ Migration successful!")

    # Verify columns exist
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'ai_prompt_logs'
        ORDER BY ordinal_position
    """)
    cols = [r[0] for r in cur.fetchall()]
    print(f"\nColumns in ai_prompt_logs ({len(cols)} total):")
    for col in cols:
        print(f"  - {col}")

    cur.close()
    conn.close()
    print("\n✓ Done!")

except Exception as e:
    print(f"ERROR: {e}")
    exit(1)

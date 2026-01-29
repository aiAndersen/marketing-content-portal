#!/usr/bin/env python3
"""
Create the ai_context table for storing scraped marketing context
Used for future complex AI reasoning projects
"""

import psycopg2
from dotenv import load_dotenv
import os

load_dotenv()

# SQL to create the table
CREATE_TABLE_SQL = """
-- AI Context Knowledge Base Table
-- Stores scraped/curated context for complex AI reasoning projects

CREATE TABLE IF NOT EXISTS ai_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Categorization
  category TEXT NOT NULL,
  subcategory TEXT,

  -- Content
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,

  -- Source tracking
  source_type TEXT,
  source_url TEXT,
  source_file TEXT,
  source_content_id UUID,

  -- Metadata
  tags TEXT[],
  confidence DECIMAL(3,2),
  is_verified BOOLEAN DEFAULT false,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_context_category ON ai_context(category);
CREATE INDEX IF NOT EXISTS idx_ai_context_subcategory ON ai_context(subcategory);
CREATE INDEX IF NOT EXISTS idx_ai_context_tags ON ai_context USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_ai_context_created ON ai_context(created_at DESC);

-- Comments for documentation
COMMENT ON TABLE ai_context IS 'Knowledge base for AI reasoning - stores scraped marketing context, competitor intel, product info';
COMMENT ON COLUMN ai_context.category IS 'Primary category: competitor_intel, product_features, customer_quotes, market_research, pricing, messaging, use_cases';
COMMENT ON COLUMN ai_context.subcategory IS 'Secondary grouping: naviance, xello, wbl, kri, fafsa, counselors, etc.';
COMMENT ON COLUMN ai_context.confidence IS 'For AI-generated content, confidence score 0.00-1.00';
"""

def create_table():
    """Create the ai_context table"""
    conn = psycopg2.connect(os.getenv('DATABASE_URL'))
    conn.autocommit = True
    cur = conn.cursor()

    print("Creating ai_context table...")
    cur.execute(CREATE_TABLE_SQL)
    print("Table created successfully!")

    # Verify table exists
    cur.execute("""
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'ai_context'
        ORDER BY ordinal_position
    """)
    columns = cur.fetchall()
    print("\nTable columns:")
    for col in columns:
        print(f"  - {col[0]}: {col[1]}")

    cur.close()
    conn.close()

if __name__ == '__main__':
    create_table()

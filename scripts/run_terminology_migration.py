#!/usr/bin/env python3
"""
Run the terminology_map migrations to create the Terminology Brain tables.

Usage:
    export DATABASE_URL='postgresql://...'
    python scripts/run_terminology_migration.py
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
    print("  export DATABASE_URL='postgresql://postgres.[ref]:[pass]@aws-0-us-west-1.pooler.supabase.com:6543/postgres'")
    exit(1)

print(f"Connecting to database...")

try:
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # ==========================================
    # MIGRATION 1: Create terminology_map table
    # ==========================================
    print("\n[1/2] Creating terminology_map table...")

    terminology_table_sql = """
    -- Terminology Map Table
    -- Stores vocabulary mappings from user search terms to database terminology

    CREATE TABLE IF NOT EXISTS terminology_map (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

      -- Classification of the mapping
      map_type TEXT NOT NULL CHECK (map_type IN ('content_type', 'state', 'topic', 'competitor', 'persona', 'feature')),

      -- The mapping itself
      user_term TEXT NOT NULL,           -- What users type (e.g., "one pager", "fact sheet")
      canonical_term TEXT NOT NULL,      -- Database/system term (e.g., "1-Pager", "Customer Story")

      -- Confidence and learning metadata
      confidence DECIMAL(3,2) DEFAULT 1.00 CHECK (confidence >= 0 AND confidence <= 1),
      source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'ai_suggested', 'log_analysis', 'seed')),
      usage_count INT DEFAULT 0,
      last_used_at TIMESTAMPTZ,

      -- Status flags
      is_active BOOLEAN DEFAULT true,
      is_verified BOOLEAN DEFAULT false,

      -- Timestamps
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),

      -- Prevent duplicate mappings
      UNIQUE(map_type, user_term)
    );

    -- Indexes for efficient lookup
    CREATE INDEX IF NOT EXISTS idx_terminology_user_term
      ON terminology_map(lower(user_term))
      WHERE is_active = true;

    CREATE INDEX IF NOT EXISTS idx_terminology_map_type
      ON terminology_map(map_type)
      WHERE is_active = true;

    CREATE INDEX IF NOT EXISTS idx_terminology_canonical
      ON terminology_map(canonical_term);

    CREATE INDEX IF NOT EXISTS idx_terminology_confidence
      ON terminology_map(confidence DESC)
      WHERE is_active = true;

    -- Full-text search index for fuzzy matching
    CREATE INDEX IF NOT EXISTS idx_terminology_search
      ON terminology_map USING GIN (to_tsvector('english', user_term));
    """

    cur.execute(terminology_table_sql)
    conn.commit()
    print("  ✓ terminology_map table created")

    # Create helper functions
    print("  Creating helper functions...")

    helper_functions_sql = """
    -- Function to increment usage counter (non-blocking)
    CREATE OR REPLACE FUNCTION increment_terminology_usage(
      p_user_term TEXT,
      p_map_type TEXT
    ) RETURNS void AS $$
    BEGIN
      UPDATE terminology_map
      SET usage_count = usage_count + 1,
          last_used_at = NOW(),
          updated_at = NOW()
      WHERE lower(user_term) = lower(p_user_term)
        AND map_type = p_map_type
        AND is_active = true;
    END;
    $$ LANGUAGE plpgsql;

    -- Function to get all active mappings as JSON (for efficient frontend loading)
    CREATE OR REPLACE FUNCTION get_terminology_mappings()
    RETURNS JSON AS $$
    DECLARE
      result JSON;
    BEGIN
      SELECT json_object_agg(
        map_type,
        type_mappings
      ) INTO result
      FROM (
        SELECT
          map_type,
          json_object_agg(lower(user_term), canonical_term) as type_mappings
        FROM terminology_map
        WHERE is_active = true
        GROUP BY map_type
      ) grouped;

      RETURN COALESCE(result, '{}'::JSON);
    END;
    $$ LANGUAGE plpgsql;
    """

    cur.execute(helper_functions_sql)
    conn.commit()
    print("  ✓ Helper functions created")

    # RLS Policies
    print("  Setting up RLS policies...")

    rls_sql = """
    -- Enable RLS
    ALTER TABLE terminology_map ENABLE ROW LEVEL SECURITY;

    -- Drop existing policies if they exist (for idempotency)
    DROP POLICY IF EXISTS "Allow public read of active terminology" ON terminology_map;
    DROP POLICY IF EXISTS "Allow authenticated insert of terminology" ON terminology_map;
    DROP POLICY IF EXISTS "Allow authenticated update of terminology" ON terminology_map;

    -- Allow anyone to read active mappings
    CREATE POLICY "Allow public read of active terminology"
      ON terminology_map FOR SELECT
      USING (is_active = true);

    -- Allow authenticated users to insert (for admin interface)
    CREATE POLICY "Allow authenticated insert of terminology"
      ON terminology_map FOR INSERT
      TO authenticated
      WITH CHECK (true);

    -- Allow authenticated users to update (for admin interface)
    CREATE POLICY "Allow authenticated update of terminology"
      ON terminology_map FOR UPDATE
      TO authenticated
      USING (true);
    """

    cur.execute(rls_sql)
    conn.commit()
    print("  ✓ RLS policies configured")

    # ==========================================
    # MIGRATION 2: Seed terminology data
    # ==========================================
    print("\n[2/2] Seeding terminology data...")

    seed_sql = """
    -- Seed Terminology Map with initial mappings

    -- ============================================
    -- CONTENT TYPE MAPPINGS
    -- ============================================

    -- 1-Pager variations
    INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
      ('content_type', 'one pager', '1-Pager', 'seed', true, true),
      ('content_type', 'one-pager', '1-Pager', 'seed', true, true),
      ('content_type', 'onepager', '1-Pager', 'seed', true, true),
      ('content_type', '1 pager', '1-Pager', 'seed', true, true),
      ('content_type', 'pager', '1-Pager', 'seed', true, true),
      ('content_type', 'fact sheet', '1-Pager', 'seed', true, true),
      ('content_type', 'factsheet', '1-Pager', 'seed', true, true),
      ('content_type', 'datasheet', '1-Pager', 'seed', true, true),
      ('content_type', 'data sheet', '1-Pager', 'seed', true, true),
      ('content_type', 'sell sheet', '1-Pager', 'seed', true, true),
      ('content_type', 'flyer', '1-Pager', 'seed', true, true),
      ('content_type', 'flier', '1-Pager', 'seed', true, true),
      ('content_type', 'brochure', '1-Pager', 'seed', true, true),
      ('content_type', 'infographic', '1-Pager', 'seed', true, true)
    ON CONFLICT (map_type, user_term) DO NOTHING;

    -- Customer Story variations
    INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
      ('content_type', 'case study', 'Customer Story', 'seed', true, true),
      ('content_type', 'case-study', 'Customer Story', 'seed', true, true),
      ('content_type', 'casestudy', 'Customer Story', 'seed', true, true),
      ('content_type', 'success story', 'Customer Story', 'seed', true, true),
      ('content_type', 'testimonial', 'Customer Story', 'seed', true, true),
      ('content_type', 'client story', 'Customer Story', 'seed', true, true),
      ('content_type', 'costumer story', 'Customer Story', 'seed', true, true),
      ('content_type', 'customer stories', 'Customer Story', 'seed', true, true)
    ON CONFLICT (map_type, user_term) DO NOTHING;

    -- Ebook variations
    INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
      ('content_type', 'e-book', 'Ebook', 'seed', true, true),
      ('content_type', 'ebook', 'Ebook', 'seed', true, true),
      ('content_type', 'whitepaper', 'Ebook', 'seed', true, true),
      ('content_type', 'white paper', 'Ebook', 'seed', true, true),
      ('content_type', 'guide', 'Ebook', 'seed', true, true),
      ('content_type', 'handbook', 'Ebook', 'seed', true, true),
      ('content_type', 'playbook', 'Ebook', 'seed', true, true)
    ON CONFLICT (map_type, user_term) DO NOTHING;

    -- Video variations
    INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
      ('content_type', 'tutorial', 'Video', 'seed', true, true),
      ('content_type', 'demo', 'Video', 'seed', true, true),
      ('content_type', 'demonstration', 'Video', 'seed', true, true),
      ('content_type', 'overview video', 'Video', 'seed', true, true),
      ('content_type', 'recorded webinar', 'Video', 'seed', true, true)
    ON CONFLICT (map_type, user_term) DO NOTHING;

    -- Video Clip variations
    INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
      ('content_type', 'clip', 'Video Clip', 'seed', true, true),
      ('content_type', 'clips', 'Video Clip', 'seed', true, true),
      ('content_type', 'snippet', 'Video Clip', 'seed', true, true),
      ('content_type', 'snippets', 'Video Clip', 'seed', true, true),
      ('content_type', 'short video', 'Video Clip', 'seed', true, true),
      ('content_type', 'teaser', 'Video Clip', 'seed', true, true),
      ('content_type', 'highlight', 'Video Clip', 'seed', true, true),
      ('content_type', 'highlights', 'Video Clip', 'seed', true, true)
    ON CONFLICT (map_type, user_term) DO NOTHING;

    -- Webinar variations
    INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
      ('content_type', 'webiner', 'Webinar', 'seed', true, true),
      ('content_type', 'webniar', 'Webinar', 'seed', true, true),
      ('content_type', 'web seminar', 'Webinar', 'seed', true, true),
      ('content_type', 'online seminar', 'Webinar', 'seed', true, true)
    ON CONFLICT (map_type, user_term) DO NOTHING;

    -- Blog variations
    INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
      ('content_type', 'article', 'Blog', 'seed', true, true),
      ('content_type', 'articles', 'Blog', 'seed', true, true),
      ('content_type', 'blog post', 'Blog', 'seed', true, true),
      ('content_type', 'post', 'Blog', 'seed', true, true)
    ON CONFLICT (map_type, user_term) DO NOTHING;

    -- ============================================
    -- COMPETITOR MAPPINGS
    -- ============================================

    INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
      ('competitor', 'navience', 'naviance', 'seed', true, true),
      ('competitor', 'naviannce', 'naviance', 'seed', true, true),
      ('competitor', 'navance', 'naviance', 'seed', true, true),
      ('competitor', 'power school', 'powerschool', 'seed', true, true),
      ('competitor', 'powerschol', 'powerschool', 'seed', true, true),
      ('competitor', 'major clarity', 'majorclarity', 'seed', true, true),
      ('competitor', 'majorclairty', 'majorclarity', 'seed', true, true),
      ('competitor', 'xelo', 'xello', 'seed', true, true),
      ('competitor', 'zelo', 'xello', 'seed', true, true),
      ('competitor', 'xcello', 'xello', 'seed', true, true)
    ON CONFLICT (map_type, user_term) DO NOTHING;

    -- ============================================
    -- PERSONA MAPPINGS
    -- ============================================

    INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
      ('persona', 'counselor', 'counselors', 'seed', true, true),
      ('persona', 'councelor', 'counselors', 'seed', true, true),
      ('persona', 'counsler', 'counselors', 'seed', true, true),
      ('persona', 'guidance counselor', 'counselors', 'seed', true, true),
      ('persona', 'school counselor', 'counselors', 'seed', true, true),
      ('persona', 'admin', 'administrators', 'seed', true, true),
      ('persona', 'administrator', 'administrators', 'seed', true, true),
      ('persona', 'principal', 'administrators', 'seed', true, true),
      ('persona', 'superintendent', 'administrators', 'seed', true, true),
      ('persona', 'cte coordinator', 'CTE coordinators', 'seed', true, true),
      ('persona', 'cte director', 'CTE coordinators', 'seed', true, true),
      ('persona', 'career coach', 'CTE coordinators', 'seed', true, true),
      ('persona', 'parent', 'parents', 'seed', true, true),
      ('persona', 'family', 'parents', 'seed', true, true),
      ('persona', 'guardian', 'parents', 'seed', true, true),
      ('persona', 'student', 'students', 'seed', true, true)
    ON CONFLICT (map_type, user_term) DO NOTHING;

    -- ============================================
    -- TOPIC MAPPINGS
    -- ============================================

    INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
      ('topic', 'fafsa', 'FAFSA', 'seed', true, true),
      ('topic', 'financial aid', 'FAFSA', 'seed', true, true),
      ('topic', 'wbl', 'work-based learning', 'seed', true, true),
      ('topic', 'internship', 'work-based learning', 'seed', true, true),
      ('topic', 'internships', 'work-based learning', 'seed', true, true),
      ('topic', 'apprenticeship', 'work-based learning', 'seed', true, true),
      ('topic', 'job shadow', 'work-based learning', 'seed', true, true),
      ('topic', 'clinical', 'work-based learning', 'seed', true, true),
      ('topic', 'graduation', 'graduation tracking', 'seed', true, true),
      ('topic', 'grad tracking', 'graduation tracking', 'seed', true, true),
      ('topic', 'on track', 'graduation tracking', 'seed', true, true),
      ('topic', 'ccr', 'college career readiness', 'seed', true, true),
      ('topic', 'college readiness', 'college career readiness', 'seed', true, true),
      ('topic', 'career readiness', 'college career readiness', 'seed', true, true),
      ('topic', 'career exploration', 'career exploration', 'seed', true, true),
      ('topic', 'career interest', 'career exploration', 'seed', true, true),
      ('topic', 'course planning', 'course planner', 'seed', true, true),
      ('topic', 'course planner', 'course planner', 'seed', true, true),
      ('topic', '4 year plan', 'course planner', 'seed', true, true),
      ('topic', 'four year plan', 'course planner', 'seed', true, true)
    ON CONFLICT (map_type, user_term) DO NOTHING;

    -- ============================================
    -- FEATURE MAPPINGS
    -- ============================================

    INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
      ('feature', 'kri', 'Key Readiness Indicators', 'seed', true, true),
      ('feature', 'key readiness', 'Key Readiness Indicators', 'seed', true, true),
      ('feature', 'plp', 'Personalized Learning Plan', 'seed', true, true),
      ('feature', 'ilp', 'Personalized Learning Plan', 'seed', true, true),
      ('feature', 'ecap', 'Personalized Learning Plan', 'seed', true, true),
      ('feature', 'pgp', 'Personalized Learning Plan', 'seed', true, true),
      ('feature', 'hsbp', 'Personalized Learning Plan', 'seed', true, true),
      ('feature', 'cam', 'College Application Management', 'seed', true, true),
      ('feature', 'college app', 'College Application Management', 'seed', true, true),
      ('feature', 'transcript', 'Transcript Center', 'seed', true, true),
      ('feature', 'game of life', 'Game of Life', 'seed', true, true),
      ('feature', 'pulse', 'Pulse', 'seed', true, true),
      ('feature', 'sel', 'Pulse', 'seed', true, true),
      ('feature', 'social emotional', 'Pulse', 'seed', true, true)
    ON CONFLICT (map_type, user_term) DO NOTHING;
    """

    cur.execute(seed_sql)
    conn.commit()
    print("  ✓ Terminology data seeded")

    # Verify the data
    cur.execute("SELECT COUNT(*) FROM terminology_map WHERE source = 'seed'")
    count = cur.fetchone()[0]
    print(f"  ✓ {count} terminology mappings created")

    # Show breakdown by type
    cur.execute("""
        SELECT map_type, COUNT(*) as count
        FROM terminology_map
        WHERE source = 'seed'
        GROUP BY map_type
        ORDER BY count DESC
    """)
    print("\n  Mappings by type:")
    for row in cur.fetchall():
        print(f"    - {row[0]}: {row[1]}")

    cur.close()
    conn.close()
    print("\n✅ Terminology Brain migrations complete!")

except Exception as e:
    print(f"\n❌ ERROR: {e}")
    import traceback
    traceback.print_exc()
    exit(1)

-- Terminology Map Table
-- Stores vocabulary mappings from user search terms to database terminology
-- Part of the "Terminology Brain" for AI Search Assistant

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

-- RLS Policies
ALTER TABLE terminology_map ENABLE ROW LEVEL SECURITY;

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

-- Comment on table
COMMENT ON TABLE terminology_map IS 'Vocabulary mappings from user search terms to database terminology. Part of the Terminology Brain for AI Search Assistant.';

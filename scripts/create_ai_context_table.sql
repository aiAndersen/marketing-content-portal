-- AI Context Knowledge Base Table
-- Stores scraped/curated context for complex AI reasoning projects

CREATE TABLE IF NOT EXISTS ai_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Categorization
  category TEXT NOT NULL,  -- e.g., 'competitor_intel', 'product_features', 'customer_quotes', 'market_research', 'pricing'
  subcategory TEXT,        -- e.g., 'naviance', 'xello', 'wbl', 'kri'

  -- Content
  title TEXT NOT NULL,     -- Brief title/label for the context
  content TEXT NOT NULL,   -- The actual context content
  summary TEXT,            -- Optional shorter summary

  -- Source tracking
  source_type TEXT,        -- 'web_scrape', 'document', 'database', 'manual', 'ai_generated'
  source_url TEXT,         -- URL if scraped from web
  source_file TEXT,        -- File path if from document
  source_content_id UUID REFERENCES marketing_content(id),  -- Link to marketing_content if derived

  -- Metadata
  tags TEXT[],             -- Array of tags for filtering
  confidence DECIMAL(3,2), -- 0.00-1.00 confidence score for AI-generated content
  is_verified BOOLEAN DEFAULT false,  -- Human verified flag

  -- For semantic search (future)
  embedding VECTOR(1536),  -- OpenAI ada-002 embeddings (requires pgvector extension)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,  -- Optional expiration for time-sensitive info

  -- Full-text search
  search_vector TSVECTOR GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(content, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(tags, ' '), '')), 'C')
  ) STORED
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_context_category ON ai_context(category);
CREATE INDEX IF NOT EXISTS idx_ai_context_subcategory ON ai_context(subcategory);
CREATE INDEX IF NOT EXISTS idx_ai_context_tags ON ai_context USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_ai_context_search ON ai_context USING GIN(search_vector);
CREATE INDEX IF NOT EXISTS idx_ai_context_created ON ai_context(created_at DESC);

-- Enable RLS (Row Level Security)
ALTER TABLE ai_context ENABLE ROW LEVEL SECURITY;

-- Allow read access for authenticated users
CREATE POLICY "Allow read access" ON ai_context
  FOR SELECT USING (true);

-- Allow insert/update for authenticated users
CREATE POLICY "Allow insert" ON ai_context
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow update" ON ai_context
  FOR UPDATE USING (true);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ai_context_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update timestamp
DROP TRIGGER IF EXISTS ai_context_updated_at ON ai_context;
CREATE TRIGGER ai_context_updated_at
  BEFORE UPDATE ON ai_context
  FOR EACH ROW
  EXECUTE FUNCTION update_ai_context_timestamp();

-- Comments for documentation
COMMENT ON TABLE ai_context IS 'Knowledge base for AI reasoning - stores scraped marketing context, competitor intel, product info';
COMMENT ON COLUMN ai_context.category IS 'Primary category: competitor_intel, product_features, customer_quotes, market_research, pricing, messaging, use_cases';
COMMENT ON COLUMN ai_context.subcategory IS 'Secondary grouping: naviance, xello, wbl, kri, fafsa, counselors, etc.';
COMMENT ON COLUMN ai_context.confidence IS 'For AI-generated content, confidence score 0.00-1.00';
COMMENT ON COLUMN ai_context.embedding IS 'OpenAI ada-002 vector embedding for semantic search (1536 dimensions)';

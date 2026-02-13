-- Deep enrichment columns for marketing_content
-- Adds structured JSONB keywords and deep enrichment tracking.
-- Used by enrich_deep.py with GPT-5.2 for richer keyword extraction.

-- New columns for deep AI enrichment
ALTER TABLE marketing_content
ADD COLUMN IF NOT EXISTS keywords JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS deep_enriched_at TIMESTAMP;

-- GIN index for fast keyword containment queries
CREATE INDEX IF NOT EXISTS idx_marketing_content_keywords
  ON marketing_content USING GIN (keywords);

-- Comments
COMMENT ON COLUMN marketing_content.keywords IS 'Structured keyword array from deep AI enrichment. Format: [{"keyword": "...", "weight": 0.0-1.0, "category": "topic|persona|feature|competitor|state"}]';
COMMENT ON COLUMN marketing_content.deep_enriched_at IS 'Timestamp of last deep AI enrichment (enrich_deep.py)';

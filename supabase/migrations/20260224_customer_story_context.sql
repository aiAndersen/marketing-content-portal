-- Customer Story Context Index
-- Adds a performance index for customer_story ai_context queries.
-- No new tables needed — uses the existing ai_context table.
--
-- The enrich_customer_stories.py script populates rows with:
--   category = 'customer_story'
--   subcategory = district slug (e.g. 'austin-isd')
--   tags = [state_code, 'Customer Story', feature tags...]
--   source_content_id = FK to marketing_content
--   content = rich markdown doc with quotes, proof points, metrics

-- Index for fast customer story lookups by subcategory
CREATE INDEX IF NOT EXISTS idx_ai_context_customer_story
  ON ai_context(subcategory)
  WHERE category = 'customer_story';

-- Index for state-filtered customer story lookups
-- (supports App.jsx: .eq('category','customer_story').contains('tags', [stateCode]))
CREATE INDEX IF NOT EXISTS idx_ai_context_customer_story_tags
  ON ai_context USING GIN(tags)
  WHERE category = 'customer_story';

-- Comment
COMMENT ON INDEX idx_ai_context_customer_story IS
  'Fast subcategory lookup for customer_story ai_context entries populated by enrich_customer_stories.py';

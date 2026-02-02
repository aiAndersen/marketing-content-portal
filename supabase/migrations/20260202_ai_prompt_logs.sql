-- AI Prompt Logs Table
-- Stores complex queries from the Marketing Content Portal for analysis
-- Used to improve AI agents and understand user search patterns

CREATE TABLE IF NOT EXISTS ai_prompt_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  query TEXT NOT NULL,
  complexity VARCHAR(20) NOT NULL CHECK (complexity IN ('simple', 'standard', 'advanced')),
  model_used VARCHAR(50) NOT NULL,
  detected_states TEXT[] DEFAULT '{}',
  query_type VARCHAR(50) DEFAULT 'search',
  matched_indicators TEXT[] DEFAULT '{}',
  timestamp TIMESTAMPTZ DEFAULT NOW(),

  -- Optional: track response quality for future fine-tuning
  response_helpful BOOLEAN,
  user_feedback TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by complexity (for analyzing which queries need advanced models)
CREATE INDEX IF NOT EXISTS idx_ai_prompt_logs_complexity ON ai_prompt_logs(complexity);

-- Index for querying by timestamp (for time-based analysis)
CREATE INDEX IF NOT EXISTS idx_ai_prompt_logs_timestamp ON ai_prompt_logs(timestamp DESC);

-- Index for state-specific analysis
CREATE INDEX IF NOT EXISTS idx_ai_prompt_logs_states ON ai_prompt_logs USING GIN(detected_states);

-- RLS Policies
ALTER TABLE ai_prompt_logs ENABLE ROW LEVEL SECURITY;

-- Allow inserts from authenticated and anonymous users (for logging)
CREATE POLICY "Allow insert for all users" ON ai_prompt_logs
  FOR INSERT
  WITH CHECK (true);

-- Allow select for authenticated users only (for analysis)
CREATE POLICY "Allow select for authenticated users" ON ai_prompt_logs
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Comments for documentation
COMMENT ON TABLE ai_prompt_logs IS 'Stores complex AI queries for analysis and agent improvement';
COMMENT ON COLUMN ai_prompt_logs.complexity IS 'Query complexity level: simple, standard, or advanced';
COMMENT ON COLUMN ai_prompt_logs.model_used IS 'OpenAI model used for this query (gpt-4o-mini, gpt-5-mini, gpt-5.2)';
COMMENT ON COLUMN ai_prompt_logs.detected_states IS 'US state codes detected in the query';
COMMENT ON COLUMN ai_prompt_logs.query_type IS 'Type of query: search, product_question, competitor_question, general_question';
COMMENT ON COLUMN ai_prompt_logs.matched_indicators IS 'Complexity indicators that matched for model routing';

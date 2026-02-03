-- Enhance AI Prompt Logs for Better QA and Fine-tuning
-- Adds columns to store the AI response for analysis

-- Add response columns (if they don't exist)
ALTER TABLE ai_prompt_logs
ADD COLUMN IF NOT EXISTS ai_quick_answer TEXT,
ADD COLUMN IF NOT EXISTS ai_key_points JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS ai_response_raw TEXT,
ADD COLUMN IF NOT EXISTS recommendations_count INT DEFAULT 0,
ADD COLUMN IF NOT EXISTS response_time_ms INT,
ADD COLUMN IF NOT EXISTS session_id VARCHAR(100);

-- Comments for new columns
COMMENT ON COLUMN ai_prompt_logs.ai_quick_answer IS 'The quick_answer field from AI response for QA review';
COMMENT ON COLUMN ai_prompt_logs.ai_key_points IS 'The key_points array from AI response for QA review';
COMMENT ON COLUMN ai_prompt_logs.ai_response_raw IS 'Full raw AI response JSON for debugging';
COMMENT ON COLUMN ai_prompt_logs.recommendations_count IS 'Number of recommendations returned';
COMMENT ON COLUMN ai_prompt_logs.response_time_ms IS 'Time taken for AI response in milliseconds';
COMMENT ON COLUMN ai_prompt_logs.session_id IS 'Client session ID to group conversation turns';

-- Index for finding logs by session
CREATE INDEX IF NOT EXISTS idx_ai_prompt_logs_session ON ai_prompt_logs(session_id);

-- Index for finding logs needing review (no feedback yet)
CREATE INDEX IF NOT EXISTS idx_ai_prompt_logs_needs_review
ON ai_prompt_logs(created_at DESC)
WHERE response_helpful IS NULL;

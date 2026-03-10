-- YouTube transcript storage for marketing_content
-- Adds a dedicated column for full, untruncated transcripts from YouTube videos and shorts.
-- Previously transcripts were truncated at 5,000 chars in extracted_text (shared with all content types).
-- Used by scripts/fetch_youtube_transcripts.py

ALTER TABLE marketing_content
  ADD COLUMN IF NOT EXISTS transcript TEXT,
  ADD COLUMN IF NOT EXISTS transcript_fetched_at TIMESTAMP;

-- GIN index for fast full-text search on transcripts
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_marketing_content_transcript_fts
  ON marketing_content
  USING gin(to_tsvector('english', COALESCE(transcript, '')));

COMMENT ON COLUMN marketing_content.transcript IS 'Full untruncated YouTube transcript. Populated by scripts/fetch_youtube_transcripts.py. NULL means either not yet attempted or no captions available.';
COMMENT ON COLUMN marketing_content.transcript_fetched_at IS 'Timestamp of last transcript fetch attempt. NULL means not yet attempted. Set even when no transcript is available.';

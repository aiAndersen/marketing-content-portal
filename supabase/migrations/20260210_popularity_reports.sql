-- Enhance log_analysis_reports for comprehensive popularity & gap analysis
-- Adds columns to support query popularity ranking, content gap analysis,
-- topic clustering, and the self-healing feedback loop.

-- New columns for comprehensive report data
ALTER TABLE log_analysis_reports
ADD COLUMN IF NOT EXISTS report_type VARCHAR(50) DEFAULT 'standard',
ADD COLUMN IF NOT EXISTS popularity_ranking JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS content_gaps JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS query_clusters JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS state_coverage JSONB DEFAULT '[]',
ADD COLUMN IF NOT EXISTS competitor_analysis JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS temporal_trends JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS executive_summary TEXT;

-- Index for filtering comprehensive vs standard reports
CREATE INDEX IF NOT EXISTS idx_log_analysis_report_type
  ON log_analysis_reports(report_type);

-- Comments
COMMENT ON COLUMN log_analysis_reports.report_type IS 'standard (from log_analyzer.py) or comprehensive (from query_popularity_report.py)';
COMMENT ON COLUMN log_analysis_reports.popularity_ranking IS 'Array of {query, count, avg_recommendations, avg_response_time_ms, category}';
COMMENT ON COLUMN log_analysis_reports.content_gaps IS 'Array of {query, search_count, avg_recommendations, gap_severity, flagged}';
COMMENT ON COLUMN log_analysis_reports.query_clusters IS 'Object with topic cluster breakdowns (competitor, state, content_type, etc.)';
COMMENT ON COLUMN log_analysis_reports.state_coverage IS 'Array of {state, query_count, avg_recommendations, coverage_rating}';
COMMENT ON COLUMN log_analysis_reports.competitor_analysis IS 'Object with competitor mention frequency and result quality';
COMMENT ON COLUMN log_analysis_reports.temporal_trends IS 'Object with daily/weekly trends and peak usage data';
COMMENT ON COLUMN log_analysis_reports.executive_summary IS 'AI-generated actionable summary for marketing team';

-- Allow public UPDATE for flagging content gaps from admin UI
DROP POLICY IF EXISTS "Allow public update of log analysis reports" ON log_analysis_reports;
CREATE POLICY "Allow public update of log analysis reports"
  ON log_analysis_reports FOR UPDATE
  USING (true)
  WITH CHECK (true);

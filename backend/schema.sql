-- Marketing Content Portal Database Schema
-- Run this in Supabase SQL Editor
-- This schema matches your Excel file structure with 636 rows and 9 columns

-- Create the main content table
CREATE TABLE IF NOT EXISTS marketing_content (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    live_link TEXT,
    ungated_link TEXT,
    platform TEXT,
    summary TEXT,
    state TEXT,
    tags TEXT,
    last_updated TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_marketing_content_type ON marketing_content(type);
CREATE INDEX IF NOT EXISTS idx_marketing_content_state ON marketing_content(state);
CREATE INDEX IF NOT EXISTS idx_marketing_content_platform ON marketing_content(platform);
CREATE INDEX IF NOT EXISTS idx_marketing_content_tags ON marketing_content USING GIN (string_to_array(tags, ','));

-- Create a full-text search index for the summary field
CREATE INDEX IF NOT EXISTS idx_marketing_content_summary_fts 
ON marketing_content USING GIN (to_tsvector('english', COALESCE(summary, '')));

-- Create a full-text search index for the title field
CREATE INDEX IF NOT EXISTS idx_marketing_content_title_fts 
ON marketing_content USING GIN (to_tsvector('english', COALESCE(title, '')));

-- Create a combined full-text search index
CREATE INDEX IF NOT EXISTS idx_marketing_content_combined_fts 
ON marketing_content USING GIN (
    to_tsvector('english', 
        COALESCE(title, '') || ' ' || 
        COALESCE(summary, '') || ' ' || 
        COALESCE(platform, '') || ' ' ||
        COALESCE(tags, '')
    )
);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Create a trigger to automatically update updated_at
CREATE TRIGGER update_marketing_content_updated_at 
    BEFORE UPDATE ON marketing_content
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Create a function for full-text search with ranking
CREATE OR REPLACE FUNCTION search_marketing_content(search_query TEXT)
RETURNS TABLE(
    id UUID,
    type TEXT,
    title TEXT,
    live_link TEXT,
    ungated_link TEXT,
    platform TEXT,
    summary TEXT,
    state TEXT,
    tags TEXT,
    last_updated TIMESTAMP WITH TIME ZONE,
    relevance REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mc.id,
        mc.type,
        mc.title,
        mc.live_link,
        mc.ungated_link,
        mc.platform,
        mc.summary,
        mc.state,
        mc.tags,
        mc.last_updated,
        ts_rank(
            to_tsvector('english', 
                COALESCE(mc.title, '') || ' ' || 
                COALESCE(mc.summary, '') || ' ' || 
                COALESCE(mc.platform, '') || ' ' ||
                COALESCE(mc.tags, '')
            ),
            plainto_tsquery('english', search_query)
        )::REAL as relevance
    FROM marketing_content mc
    WHERE to_tsvector('english', 
        COALESCE(mc.title, '') || ' ' || 
        COALESCE(mc.summary, '') || ' ' || 
        COALESCE(mc.platform, '') || ' ' ||
        COALESCE(mc.tags, '')
    ) @@ plainto_tsquery('english', search_query)
    ORDER BY relevance DESC;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Enable Row Level Security
ALTER TABLE marketing_content ENABLE ROW LEVEL SECURITY;

-- Public read access (marketing content is public data)
CREATE POLICY "Allow public read access" ON marketing_content FOR SELECT USING (true);

-- Only service_role can write (scripts use DATABASE_URL which bypasses RLS)
CREATE POLICY "Allow service role write access" ON marketing_content
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Create a view for content type breakdown (security_invoker respects caller's RLS)
CREATE OR REPLACE VIEW content_type_summary
WITH (security_invoker = true) AS
SELECT 
    type,
    COUNT(*) as total_count,
    COUNT(CASE WHEN live_link IS NOT NULL AND live_link != '' THEN 1 END) as with_live_link,
    COUNT(CASE WHEN ungated_link IS NOT NULL AND ungated_link != '' THEN 1 END) as with_ungated_link,
    COUNT(DISTINCT state) as unique_states,
    COUNT(DISTINCT platform) as unique_platforms
FROM marketing_content
GROUP BY type
ORDER BY total_count DESC;

-- Create a view for state-based breakdown (security_invoker respects caller's RLS)
CREATE OR REPLACE VIEW content_by_state
WITH (security_invoker = true) AS
SELECT 
    state,
    type,
    COUNT(*) as count
FROM marketing_content
WHERE state IS NOT NULL AND state != ''
GROUP BY state, type
ORDER BY state, count DESC;

-- Create a view for platform breakdown (security_invoker respects caller's RLS)
CREATE OR REPLACE VIEW content_by_platform
WITH (security_invoker = true) AS
SELECT 
    platform,
    type,
    COUNT(*) as count
FROM marketing_content
WHERE platform IS NOT NULL AND platform != ''
GROUP BY platform, type
ORDER BY platform, count DESC;

-- Create a function to get content statistics
CREATE OR REPLACE FUNCTION get_content_stats()
RETURNS JSON AS $$
DECLARE
    result JSON;
BEGIN
    SELECT json_build_object(
        'total_content', COUNT(*),
        'content_types', COUNT(DISTINCT type),
        'states_covered', COUNT(DISTINCT NULLIF(state, '')),
        'platforms', COUNT(DISTINCT NULLIF(platform, '')),
        'with_summary', COUNT(CASE WHEN summary IS NOT NULL AND summary != '' THEN 1 END),
        'with_live_link', COUNT(CASE WHEN live_link IS NOT NULL AND live_link != '' THEN 1 END),
        'with_ungated_link', COUNT(CASE WHEN ungated_link IS NOT NULL AND ungated_link != '' THEN 1 END),
        'last_updated', MAX(updated_at)
    ) INTO result
    FROM marketing_content;
    
    RETURN result;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Create a function to search by multiple filters
CREATE OR REPLACE FUNCTION filter_content(
    content_types TEXT[] DEFAULT NULL,
    content_states TEXT[] DEFAULT NULL,
    content_platforms TEXT[] DEFAULT NULL,
    search_text TEXT DEFAULT NULL
)
RETURNS SETOF marketing_content AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM marketing_content
    WHERE 
        (content_types IS NULL OR type = ANY(content_types))
        AND (content_states IS NULL OR state = ANY(content_states))
        AND (content_platforms IS NULL OR platform = ANY(content_platforms))
        AND (
            search_text IS NULL 
            OR to_tsvector('english', 
                COALESCE(title, '') || ' ' || 
                COALESCE(summary, '') || ' ' || 
                COALESCE(platform, '') || ' ' ||
                COALESCE(tags, '')
            ) @@ plainto_tsquery('english', search_text)
        )
    ORDER BY updated_at DESC;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- Grant permissions (read-only for anon, full for authenticated/service_role)
GRANT SELECT ON marketing_content TO anon, authenticated;
GRANT ALL ON marketing_content TO service_role;
GRANT SELECT ON content_type_summary TO anon, authenticated;
GRANT SELECT ON content_by_state TO anon, authenticated;
GRANT SELECT ON content_by_platform TO anon, authenticated;

COMMENT ON TABLE marketing_content IS 'Main table storing all marketing content from the portal. Includes customer stories, videos, blogs, ebooks, webinars, press releases, and more.';
COMMENT ON COLUMN marketing_content.type IS 'Content type: Customer Story, Video, Blog, Ebook, Webinar, 1-Pager, Press Release, Award, Landing Page, Asset, etc.';
COMMENT ON COLUMN marketing_content.title IS 'Title of the content piece';
COMMENT ON COLUMN marketing_content.live_link IS 'Published/live URL where content is accessible';
COMMENT ON COLUMN marketing_content.ungated_link IS 'Direct download or ungated access link (often HubSpot PDFs)';
COMMENT ON COLUMN marketing_content.platform IS 'Platform or source where content is hosted';
COMMENT ON COLUMN marketing_content.summary IS 'Full summary or description of the content';
COMMENT ON COLUMN marketing_content.state IS 'US State abbreviation (e.g., NV, NH, SC) if content is state-specific';
COMMENT ON COLUMN marketing_content.tags IS 'Comma-separated tags for content categorization';
COMMENT ON COLUMN marketing_content.last_updated IS 'When the content was last updated in the source system';

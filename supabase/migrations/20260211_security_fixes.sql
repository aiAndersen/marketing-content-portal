-- ============================================
-- SECURITY FIXES MIGRATION
-- Marketing Content Portal
-- ============================================
-- Addresses 5 errors and 6 warnings from the Supabase Security Advisor (splinter linter).
-- Run this in Supabase SQL Editor.
--
-- Fixes:
--   Errors 1-3: Security Definer Views (security_invoker = true)
--   Errors 4-5: RLS Disabled on marketing_content and ai_context
--   Warnings 1-6: Function search_path mutable
--   Warning 9: Overly permissive public UPDATE on log_analysis_reports
--   Excessive GRANT statements (revoke write from anon)

-- ============================================
-- 1. FIX SECURITY DEFINER VIEWS
-- ============================================
-- Set security_invoker = true so views respect the querying user's
-- permissions and RLS policies, not the view creator's.

ALTER VIEW public.content_type_summary SET (security_invoker = true);
ALTER VIEW public.content_by_state SET (security_invoker = true);
ALTER VIEW public.content_by_platform SET (security_invoker = true);

-- ============================================
-- 2. ENABLE RLS ON marketing_content
-- ============================================
-- Currently has no RLS + GRANT ALL TO anon, meaning anyone with the
-- anon key can INSERT/UPDATE/DELETE all content.

ALTER TABLE public.marketing_content ENABLE ROW LEVEL SECURITY;

-- Anyone can read (public marketing data)
CREATE POLICY "Allow public read access"
  ON public.marketing_content FOR SELECT
  USING (true);

-- Only service_role can write (scripts use DATABASE_URL which bypasses RLS;
-- Vercel webhooks use service_role key)
CREATE POLICY "Allow service role write access"
  ON public.marketing_content FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 3. ENABLE RLS ON ai_context
-- ============================================
-- The create_ai_context_table.sql had ENABLE RLS but it didn't
-- execute on the live database. Fix that now.

ALTER TABLE public.ai_context ENABLE ROW LEVEL SECURITY;

-- Anyone can read context (used by AI search)
CREATE POLICY "Allow public read access"
  ON public.ai_context FOR SELECT
  USING (true);

-- Only service_role can write (enrichment scripts use DATABASE_URL)
CREATE POLICY "Allow service role write access"
  ON public.ai_context FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 4. FIX FUNCTION SEARCH PATHS
-- ============================================
-- Recreate all 6 flagged functions with SET search_path = ''
-- to prevent potential search_path manipulation attacks.

-- 4a. update_updated_at_column (trigger function)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 4b. search_marketing_content
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
    FROM public.marketing_content mc
    WHERE to_tsvector('english',
        COALESCE(mc.title, '') || ' ' ||
        COALESCE(mc.summary, '') || ' ' ||
        COALESCE(mc.platform, '') || ' ' ||
        COALESCE(mc.tags, '')
    ) @@ plainto_tsquery('english', search_query)
    ORDER BY relevance DESC;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 4c. get_content_stats
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
    FROM public.marketing_content;

    RETURN result;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 4d. filter_content
CREATE OR REPLACE FUNCTION filter_content(
    content_types TEXT[] DEFAULT NULL,
    content_states TEXT[] DEFAULT NULL,
    content_platforms TEXT[] DEFAULT NULL,
    search_text TEXT DEFAULT NULL
)
RETURNS SETOF public.marketing_content AS $$
BEGIN
    RETURN QUERY
    SELECT *
    FROM public.marketing_content
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

-- 4e. increment_terminology_usage
CREATE OR REPLACE FUNCTION increment_terminology_usage(
  p_user_term TEXT,
  p_map_type TEXT
) RETURNS void AS $$
BEGIN
  UPDATE public.terminology_map
  SET usage_count = usage_count + 1,
      last_used_at = NOW(),
      updated_at = NOW()
  WHERE lower(user_term) = lower(p_user_term)
    AND map_type = p_map_type
    AND is_active = true;
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- 4f. get_terminology_mappings
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
    FROM public.terminology_map
    WHERE is_active = true
    GROUP BY map_type
  ) grouped;

  RETURN COALESCE(result, '{}'::JSON);
END;
$$ LANGUAGE plpgsql SET search_path = '';

-- ============================================
-- 5. TIGHTEN log_analysis_reports UPDATE POLICY
-- ============================================
-- Currently allows anonymous users to UPDATE reports.
-- Restrict to service_role only.

DROP POLICY IF EXISTS "Allow public update of log analysis reports" ON log_analysis_reports;

CREATE POLICY "Allow service role update of log analysis reports"
  ON log_analysis_reports FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- 6. REVOKE EXCESSIVE GRANT STATEMENTS
-- ============================================
-- marketing_content currently has GRANT ALL TO anon, authenticated.
-- Revoke write permissions from anon (reads are handled by RLS policy).

REVOKE INSERT, UPDATE, DELETE ON public.marketing_content FROM anon;

-- Views only need SELECT (currently granted ALL)
REVOKE ALL ON public.content_type_summary FROM anon, authenticated;
REVOKE ALL ON public.content_by_state FROM anon, authenticated;
REVOKE ALL ON public.content_by_platform FROM anon, authenticated;
GRANT SELECT ON public.content_type_summary TO anon, authenticated;
GRANT SELECT ON public.content_by_state TO anon, authenticated;
GRANT SELECT ON public.content_by_platform TO anon, authenticated;

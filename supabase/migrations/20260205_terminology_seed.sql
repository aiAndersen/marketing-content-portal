-- Seed Terminology Map with initial mappings
-- Based on existing typePatterns and AUTOCORRECT_DICTIONARY from nlp.js

-- ============================================
-- CONTENT TYPE MAPPINGS
-- ============================================

-- 1-Pager variations
INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
  ('content_type', 'one pager', '1-Pager', 'seed', true, true),
  ('content_type', 'one-pager', '1-Pager', 'seed', true, true),
  ('content_type', 'onepager', '1-Pager', 'seed', true, true),
  ('content_type', '1 pager', '1-Pager', 'seed', true, true),
  ('content_type', 'pager', '1-Pager', 'seed', true, true),
  ('content_type', 'fact sheet', '1-Pager', 'seed', true, true),
  ('content_type', 'factsheet', '1-Pager', 'seed', true, true),
  ('content_type', 'datasheet', '1-Pager', 'seed', true, true),
  ('content_type', 'data sheet', '1-Pager', 'seed', true, true),
  ('content_type', 'sell sheet', '1-Pager', 'seed', true, true),
  ('content_type', 'flyer', '1-Pager', 'seed', true, true),
  ('content_type', 'flier', '1-Pager', 'seed', true, true),
  ('content_type', 'brochure', '1-Pager', 'seed', true, true),
  ('content_type', 'infographic', '1-Pager', 'seed', true, true)
ON CONFLICT (map_type, user_term) DO NOTHING;

-- Customer Story variations
INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
  ('content_type', 'case study', 'Customer Story', 'seed', true, true),
  ('content_type', 'case-study', 'Customer Story', 'seed', true, true),
  ('content_type', 'casestudy', 'Customer Story', 'seed', true, true),
  ('content_type', 'success story', 'Customer Story', 'seed', true, true),
  ('content_type', 'testimonial', 'Customer Story', 'seed', true, true),
  ('content_type', 'client story', 'Customer Story', 'seed', true, true),
  ('content_type', 'costumer story', 'Customer Story', 'seed', true, true),
  ('content_type', 'customer stories', 'Customer Story', 'seed', true, true)
ON CONFLICT (map_type, user_term) DO NOTHING;

-- Ebook variations
INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
  ('content_type', 'e-book', 'Ebook', 'seed', true, true),
  ('content_type', 'ebook', 'Ebook', 'seed', true, true),
  ('content_type', 'whitepaper', 'Ebook', 'seed', true, true),
  ('content_type', 'white paper', 'Ebook', 'seed', true, true),
  ('content_type', 'guide', 'Ebook', 'seed', true, true),
  ('content_type', 'handbook', 'Ebook', 'seed', true, true),
  ('content_type', 'playbook', 'Ebook', 'seed', true, true)
ON CONFLICT (map_type, user_term) DO NOTHING;

-- Video variations
INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
  ('content_type', 'tutorial', 'Video', 'seed', true, true),
  ('content_type', 'demo', 'Video', 'seed', true, true),
  ('content_type', 'demonstration', 'Video', 'seed', true, true),
  ('content_type', 'overview video', 'Video', 'seed', true, true),
  ('content_type', 'recorded webinar', 'Video', 'seed', true, true)
ON CONFLICT (map_type, user_term) DO NOTHING;

-- Video Clip variations
INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
  ('content_type', 'clip', 'Video Clip', 'seed', true, true),
  ('content_type', 'clips', 'Video Clip', 'seed', true, true),
  ('content_type', 'snippet', 'Video Clip', 'seed', true, true),
  ('content_type', 'snippets', 'Video Clip', 'seed', true, true),
  ('content_type', 'short video', 'Video Clip', 'seed', true, true),
  ('content_type', 'teaser', 'Video Clip', 'seed', true, true),
  ('content_type', 'highlight', 'Video Clip', 'seed', true, true),
  ('content_type', 'highlights', 'Video Clip', 'seed', true, true)
ON CONFLICT (map_type, user_term) DO NOTHING;

-- Webinar variations
INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
  ('content_type', 'webiner', 'Webinar', 'seed', true, true),
  ('content_type', 'webniar', 'Webinar', 'seed', true, true),
  ('content_type', 'web seminar', 'Webinar', 'seed', true, true),
  ('content_type', 'online seminar', 'Webinar', 'seed', true, true)
ON CONFLICT (map_type, user_term) DO NOTHING;

-- Blog variations
INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
  ('content_type', 'article', 'Blog', 'seed', true, true),
  ('content_type', 'articles', 'Blog', 'seed', true, true),
  ('content_type', 'blog post', 'Blog', 'seed', true, true),
  ('content_type', 'post', 'Blog', 'seed', true, true)
ON CONFLICT (map_type, user_term) DO NOTHING;

-- ============================================
-- COMPETITOR MAPPINGS
-- ============================================

INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
  ('competitor', 'navience', 'naviance', 'seed', true, true),
  ('competitor', 'naviannce', 'naviance', 'seed', true, true),
  ('competitor', 'navance', 'naviance', 'seed', true, true),
  ('competitor', 'power school', 'powerschool', 'seed', true, true),
  ('competitor', 'powerschol', 'powerschool', 'seed', true, true),
  ('competitor', 'major clarity', 'majorclarity', 'seed', true, true),
  ('competitor', 'majorclairty', 'majorclarity', 'seed', true, true),
  ('competitor', 'xelo', 'xello', 'seed', true, true),
  ('competitor', 'zelo', 'xello', 'seed', true, true),
  ('competitor', 'xcello', 'xello', 'seed', true, true)
ON CONFLICT (map_type, user_term) DO NOTHING;

-- ============================================
-- PERSONA MAPPINGS
-- ============================================

INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
  ('persona', 'counselor', 'counselors', 'seed', true, true),
  ('persona', 'councelor', 'counselors', 'seed', true, true),
  ('persona', 'counsler', 'counselors', 'seed', true, true),
  ('persona', 'guidance counselor', 'counselors', 'seed', true, true),
  ('persona', 'school counselor', 'counselors', 'seed', true, true),
  ('persona', 'admin', 'administrators', 'seed', true, true),
  ('persona', 'administrator', 'administrators', 'seed', true, true),
  ('persona', 'principal', 'administrators', 'seed', true, true),
  ('persona', 'superintendent', 'administrators', 'seed', true, true),
  ('persona', 'cte coordinator', 'CTE coordinators', 'seed', true, true),
  ('persona', 'cte director', 'CTE coordinators', 'seed', true, true),
  ('persona', 'career coach', 'CTE coordinators', 'seed', true, true),
  ('persona', 'parent', 'parents', 'seed', true, true),
  ('persona', 'family', 'parents', 'seed', true, true),
  ('persona', 'guardian', 'parents', 'seed', true, true),
  ('persona', 'student', 'students', 'seed', true, true)
ON CONFLICT (map_type, user_term) DO NOTHING;

-- ============================================
-- TOPIC MAPPINGS
-- ============================================

INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
  ('topic', 'fafsa', 'FAFSA', 'seed', true, true),
  ('topic', 'financial aid', 'FAFSA', 'seed', true, true),
  ('topic', 'wbl', 'work-based learning', 'seed', true, true),
  ('topic', 'internship', 'work-based learning', 'seed', true, true),
  ('topic', 'internships', 'work-based learning', 'seed', true, true),
  ('topic', 'apprenticeship', 'work-based learning', 'seed', true, true),
  ('topic', 'job shadow', 'work-based learning', 'seed', true, true),
  ('topic', 'clinical', 'work-based learning', 'seed', true, true),
  ('topic', 'graduation', 'graduation tracking', 'seed', true, true),
  ('topic', 'grad tracking', 'graduation tracking', 'seed', true, true),
  ('topic', 'on track', 'graduation tracking', 'seed', true, true),
  ('topic', 'ccr', 'college career readiness', 'seed', true, true),
  ('topic', 'college readiness', 'college career readiness', 'seed', true, true),
  ('topic', 'career readiness', 'college career readiness', 'seed', true, true),
  ('topic', 'career exploration', 'career exploration', 'seed', true, true),
  ('topic', 'career interest', 'career exploration', 'seed', true, true),
  ('topic', 'course planning', 'course planner', 'seed', true, true),
  ('topic', 'course planner', 'course planner', 'seed', true, true),
  ('topic', '4 year plan', 'course planner', 'seed', true, true),
  ('topic', 'four year plan', 'course planner', 'seed', true, true)
ON CONFLICT (map_type, user_term) DO NOTHING;

-- ============================================
-- FEATURE MAPPINGS
-- ============================================

INSERT INTO terminology_map (map_type, user_term, canonical_term, source, is_verified, is_active) VALUES
  ('feature', 'kri', 'Key Readiness Indicators', 'seed', true, true),
  ('feature', 'key readiness', 'Key Readiness Indicators', 'seed', true, true),
  ('feature', 'plp', 'Personalized Learning Plan', 'seed', true, true),
  ('feature', 'ilp', 'Personalized Learning Plan', 'seed', true, true),
  ('feature', 'ecap', 'Personalized Learning Plan', 'seed', true, true),
  ('feature', 'pgp', 'Personalized Learning Plan', 'seed', true, true),
  ('feature', 'hsbp', 'Personalized Learning Plan', 'seed', true, true),
  ('feature', 'cam', 'College Application Management', 'seed', true, true),
  ('feature', 'college app', 'College Application Management', 'seed', true, true),
  ('feature', 'transcript', 'Transcript Center', 'seed', true, true),
  ('feature', 'game of life', 'Game of Life', 'seed', true, true),
  ('feature', 'pulse', 'Pulse', 'seed', true, true),
  ('feature', 'sel', 'Pulse', 'seed', true, true),
  ('feature', 'social emotional', 'Pulse', 'seed', true, true)
ON CONFLICT (map_type, user_term) DO NOTHING;

-- ============================================
-- VERIFY SEED DATA
-- ============================================

DO $$
DECLARE
  mapping_count INT;
BEGIN
  SELECT COUNT(*) INTO mapping_count FROM terminology_map WHERE source = 'seed';
  RAISE NOTICE 'Seeded % terminology mappings', mapping_count;
END $$;

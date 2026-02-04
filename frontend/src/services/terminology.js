/**
 * Terminology Service
 * Part of the "Terminology Brain" for AI Search Assistant
 *
 * Handles vocabulary mappings from user search terms to database terminology.
 * Supports learning from prompt logs and admin management.
 */

import { supabaseClient } from './supabase';

// Cache configuration
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let terminologyCache = null;
let cacheTimestamp = 0;

/**
 * Fallback mappings if database is unavailable
 * These are critical mappings that should always work
 */
const FALLBACK_MAPPINGS = {
  content_type: {
    // 1-Pager variations
    'one pager': '1-Pager',
    'one-pager': '1-Pager',
    'onepager': '1-Pager',
    '1 pager': '1-Pager',
    'pager': '1-Pager',
    'fact sheet': '1-Pager',
    'factsheet': '1-Pager',
    'datasheet': '1-Pager',
    'data sheet': '1-Pager',
    'sell sheet': '1-Pager',
    'flyer': '1-Pager',
    'flier': '1-Pager',
    'brochure': '1-Pager',
    'infographic': '1-Pager',
    // Customer Story variations
    'case study': 'Customer Story',
    'case-study': 'Customer Story',
    'casestudy': 'Customer Story',
    'success story': 'Customer Story',
    'testimonial': 'Customer Story',
    'client story': 'Customer Story',
    'costumer story': 'Customer Story',
    // Ebook variations
    'e-book': 'Ebook',
    'whitepaper': 'Ebook',
    'white paper': 'Ebook',
    'guide': 'Ebook',
    'handbook': 'Ebook',
    'playbook': 'Ebook',
    // Video variations
    'tutorial': 'Video',
    'demo': 'Video',
    'demonstration': 'Video',
    // Video Clip variations
    'clip': 'Video Clip',
    'clips': 'Video Clip',
    'snippet': 'Video Clip',
    'snippets': 'Video Clip',
    'short video': 'Video Clip',
    'teaser': 'Video Clip',
    'highlight': 'Video Clip',
    'highlights': 'Video Clip',
    // Webinar variations
    'webiner': 'Webinar',
    'webniar': 'Webinar',
    'web seminar': 'Webinar',
    // Blog variations
    'article': 'Blog',
    'blog post': 'Blog',
    'post': 'Blog',
  },
  competitor: {
    'navience': 'naviance',
    'naviannce': 'naviance',
    'navance': 'naviance',
    'power school': 'powerschool',
    'powerschol': 'powerschool',
    'major clarity': 'majorclarity',
    'majorclairty': 'majorclarity',
    'xelo': 'xello',
    'zelo': 'xello',
    'xcello': 'xello',
  },
  persona: {
    'counselor': 'counselors',
    'councelor': 'counselors',
    'counsler': 'counselors',
    'guidance counselor': 'counselors',
    'school counselor': 'counselors',
    'admin': 'administrators',
    'administrator': 'administrators',
    'principal': 'administrators',
    'superintendent': 'administrators',
  },
  topic: {
    'fafsa': 'FAFSA',
    'financial aid': 'FAFSA',
    'wbl': 'work-based learning',
    'internship': 'work-based learning',
    'internships': 'work-based learning',
    'apprenticeship': 'work-based learning',
    'job shadow': 'work-based learning',
    'ccr': 'college career readiness',
    'college readiness': 'college career readiness',
    'career readiness': 'college career readiness',
  },
  feature: {
    'kri': 'Key Readiness Indicators',
    'key readiness': 'Key Readiness Indicators',
    'plp': 'Personalized Learning Plan',
    'ilp': 'Personalized Learning Plan',
    'ecap': 'Personalized Learning Plan',
    'cam': 'College Application Management',
    'college app': 'College Application Management',
    'game of life': 'Game of Life',
    'pulse': 'Pulse',
    'sel': 'Pulse',
    'social emotional': 'Pulse',
  }
};

/**
 * Load terminology mappings from the database
 * Uses caching to reduce database calls
 * @returns {Promise<object>} Mappings organized by map_type
 */
export async function loadTerminologyMappings() {
  // Check cache first
  const now = Date.now();
  if (terminologyCache && (now - cacheTimestamp) < CACHE_TTL_MS) {
    console.log('[Terminology] Using cached mappings');
    return terminologyCache;
  }

  try {
    // Try to call the database function first (most efficient)
    const { data: funcResult, error: funcError } = await supabaseClient
      .rpc('get_terminology_mappings');

    if (!funcError && funcResult) {
      terminologyCache = funcResult;
      cacheTimestamp = now;
      const totalMappings = Object.values(funcResult).reduce(
        (sum, typeMap) => sum + Object.keys(typeMap).length, 0
      );
      console.log(`[Terminology] Loaded ${totalMappings} mappings from database function`);
      return terminologyCache;
    }

    // Fallback: direct query if function fails
    console.log('[Terminology] Function unavailable, using direct query...');
    const { data, error } = await supabaseClient
      .from('terminology_map')
      .select('map_type, user_term, canonical_term')
      .eq('is_active', true);

    if (error) {
      throw error;
    }

    // Transform to nested structure
    const mappings = {};
    for (const row of data) {
      if (!mappings[row.map_type]) {
        mappings[row.map_type] = {};
      }
      mappings[row.map_type][row.user_term.toLowerCase()] = row.canonical_term;
    }

    terminologyCache = mappings;
    cacheTimestamp = now;
    console.log(`[Terminology] Loaded ${data.length} mappings from direct query`);
    return terminologyCache;

  } catch (err) {
    console.warn('[Terminology] Failed to load from database, using fallbacks:', err.message);
    return FALLBACK_MAPPINGS;
  }
}

/**
 * Apply terminology mappings to a search query
 * Detects user terms and returns canonical mappings
 * @param {string} query - The user's search query
 * @returns {Promise<object>} Detected mappings by type
 */
export async function applyTerminologyMappings(query) {
  const mappings = await loadTerminologyMappings();
  const queryLower = query.toLowerCase();
  const detected = {
    content_type: [],
    competitor: [],
    persona: [],
    topic: [],
    feature: [],
    state: [],
  };

  // Check each mapping type
  for (const [mapType, terms] of Object.entries(mappings)) {
    for (const [userTerm, canonicalTerm] of Object.entries(terms)) {
      // Use word boundary matching for better accuracy
      const regex = new RegExp(`\\b${escapeRegex(userTerm)}\\b`, 'i');
      if (regex.test(queryLower)) {
        // Avoid duplicates
        if (!detected[mapType]?.includes(canonicalTerm)) {
          if (!detected[mapType]) {
            detected[mapType] = [];
          }
          detected[mapType].push(canonicalTerm);

          // Track usage asynchronously (fire and forget)
          recordMappingUsage(userTerm, mapType).catch(() => {});
        }
      }
    }
  }

  // Log what was detected
  const totalDetected = Object.values(detected).reduce((sum, arr) => sum + arr.length, 0);
  if (totalDetected > 0) {
    console.log('[Terminology] Detected mappings:', detected);
  }

  return detected;
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Record usage of a terminology mapping (for analytics)
 * Non-blocking, fire-and-forget
 * @param {string} userTerm - The user term that was matched
 * @param {string} mapType - The type of mapping
 */
export async function recordMappingUsage(userTerm, mapType) {
  try {
    // Call the database function to increment usage
    await supabaseClient.rpc('increment_terminology_usage', {
      p_user_term: userTerm,
      p_map_type: mapType
    });
  } catch (err) {
    // Silent fail - usage tracking is optional
    console.debug('[Terminology] Failed to record usage:', err.message);
  }
}

/**
 * Generate AI prompt context string from terminology mappings
 * This injects vocabulary knowledge into AI prompts
 * @returns {Promise<string>} Formatted context for AI system prompt
 */
export async function getTerminologyPromptContext() {
  const mappings = await loadTerminologyMappings();

  const lines = [
    'TERMINOLOGY MAPPINGS (recognize these user terms → database terms):',
    ''
  ];

  // Content Types are most important for search
  if (mappings.content_type) {
    lines.push('Content Types:');
    // Group by canonical term
    const grouped = {};
    for (const [userTerm, canonicalTerm] of Object.entries(mappings.content_type)) {
      if (!grouped[canonicalTerm]) {
        grouped[canonicalTerm] = [];
      }
      grouped[canonicalTerm].push(userTerm);
    }
    for (const [canonical, terms] of Object.entries(grouped)) {
      lines.push(`  - "${canonical}": ${terms.slice(0, 5).join(', ')}${terms.length > 5 ? '...' : ''}`);
    }
    lines.push('');
  }

  // Competitors
  if (mappings.competitor) {
    lines.push('Competitor Names (correct misspellings):');
    const grouped = {};
    for (const [userTerm, canonicalTerm] of Object.entries(mappings.competitor)) {
      if (!grouped[canonicalTerm]) {
        grouped[canonicalTerm] = [];
      }
      grouped[canonicalTerm].push(userTerm);
    }
    for (const [canonical, terms] of Object.entries(grouped)) {
      lines.push(`  - "${canonical}": ${terms.join(', ')}`);
    }
    lines.push('');
  }

  // Topics/Features (combined for brevity)
  if (mappings.topic || mappings.feature) {
    lines.push('Topics & Features:');
    const allMappings = { ...mappings.topic, ...mappings.feature };
    const grouped = {};
    for (const [userTerm, canonicalTerm] of Object.entries(allMappings)) {
      if (!grouped[canonicalTerm]) {
        grouped[canonicalTerm] = [];
      }
      grouped[canonicalTerm].push(userTerm);
    }
    for (const [canonical, terms] of Object.entries(grouped)) {
      lines.push(`  - "${canonical}": ${terms.join(', ')}`);
    }
    lines.push('');
  }

  lines.push('IMPORTANT: When users use any term on the left, map it to the term on the right.');

  return lines.join('\n');
}

/**
 * Get the fallback mappings (for offline/error scenarios)
 * @returns {object} The hardcoded fallback mappings
 */
export function getFallbackMappings() {
  return FALLBACK_MAPPINGS;
}

/**
 * Clear the terminology cache (force reload on next call)
 */
export function clearTerminologyCache() {
  terminologyCache = null;
  cacheTimestamp = 0;
  console.log('[Terminology] Cache cleared');
}

/**
 * Suggest a new terminology mapping (for admin review)
 * @param {string} userTerm - The user term
 * @param {string} canonicalTerm - The canonical database term
 * @param {string} mapType - The type of mapping
 * @param {number} confidence - Confidence score (0-1)
 * @returns {Promise<object>} The created suggestion
 */
export async function suggestTerminologyMapping(userTerm, canonicalTerm, mapType, confidence = 0.5) {
  try {
    const { data, error } = await supabaseClient
      .from('terminology_map')
      .insert({
        map_type: mapType,
        user_term: userTerm.toLowerCase(),
        canonical_term: canonicalTerm,
        source: 'ai_suggested',
        confidence: confidence,
        is_verified: false,
        is_active: false, // Suggestions start inactive until approved
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    console.log('[Terminology] Suggestion created:', data);
    return data;

  } catch (err) {
    console.error('[Terminology] Failed to create suggestion:', err);
    throw err;
  }
}

/**
 * Get all pending terminology suggestions (for admin interface)
 * @returns {Promise<array>} Pending suggestions
 */
export async function getPendingSuggestions() {
  try {
    const { data, error } = await supabaseClient
      .from('terminology_map')
      .select('*')
      .eq('is_verified', false)
      .eq('is_active', false)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    return data;

  } catch (err) {
    console.error('[Terminology] Failed to get pending suggestions:', err);
    return [];
  }
}

/**
 * Approve a pending terminology suggestion (for admin interface)
 * @param {string} id - The suggestion UUID
 * @returns {Promise<object>} The approved mapping
 */
export async function approveSuggestion(id) {
  try {
    const { data, error } = await supabaseClient
      .from('terminology_map')
      .update({
        is_verified: true,
        is_active: true,
        source: 'ai_suggested', // Keep source as ai_suggested
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    // Clear cache so new mapping takes effect
    clearTerminologyCache();
    console.log('[Terminology] Suggestion approved:', data);
    return data;

  } catch (err) {
    console.error('[Terminology] Failed to approve suggestion:', err);
    throw err;
  }
}

/**
 * Reject a pending terminology suggestion (for admin interface)
 * @param {string} id - The suggestion UUID
 * @returns {Promise<void>}
 */
export async function rejectSuggestion(id) {
  try {
    const { error } = await supabaseClient
      .from('terminology_map')
      .delete()
      .eq('id', id);

    if (error) {
      throw error;
    }

    console.log('[Terminology] Suggestion rejected:', id);

  } catch (err) {
    console.error('[Terminology] Failed to reject suggestion:', err);
    throw err;
  }
}

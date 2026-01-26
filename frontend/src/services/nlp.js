/**
 * Natural Language Processing Service
 * Uses OpenAI to intelligently parse search queries
 * Handles misspellings, synonyms, and natural language understanding
 */

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

/**
 * Use OpenAI to understand and enhance the search query
 */
export async function convertNaturalLanguageToQuery(naturalQuery, filters = {}) {
  if (!OPENAI_API_KEY) {
    console.log('No OpenAI API key, using basic keyword search');
    return parseQueryKeywords(naturalQuery, filters);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a search query parser for a marketing content database. Your job is to understand what the user is looking for and extract structured search parameters.

The database contains marketing content with these columns:
- type: Content type (Customer Story, Video, Blog, Ebook, Webinar, 1-Pager, Press Release, Award, Landing Page, Asset, Video Clip)
- title: Content title
- summary: Description of the content
- platform: Where it's hosted (Website, YouTube, LinkedIn, HubSpot, etc.)
- state: US State abbreviation (TX, CA, NY, FL, etc.) or "National"
- tags: Keywords like "college, career, counselors, students, work-based learning"

IMPORTANT RULES:
1. Fix misspellings (e.g., "costumer" → "customer", "vido" → "video", "texs" → "texas")
2. Understand synonyms (e.g., "case study" = "customer story", "film" = "video")
3. Recognize state names and convert to abbreviations (e.g., "texas" → "TX", "california" → "CA")
4. Extract relevant keywords for searching content
5. Be generous with search terms - include variations and related words

Return a JSON object with these fields:
{
  "types": ["array of content types to filter by"],
  "states": ["array of state abbreviations"],
  "searchTerms": ["array of keywords to search in title, summary, tags"],
  "correctedQuery": "the query with spelling fixed",
  "understanding": "brief explanation of what you understood"
}

Examples:
- "costumer storys from texs" → types: ["Customer Story"], states: ["TX"], searchTerms: ["customer", "story", "texas"]
- "videos about college" → types: ["Video", "Video Clip"], searchTerms: ["college", "higher education", "university"]
- "content for counselors in california" → states: ["CA"], searchTerms: ["counselor", "counselors", "guidance"]
- "nevada schools" → states: ["NV"], searchTerms: ["school", "schools", "education", "district"]`
          },
          {
            role: 'user',
            content: `Parse this search query: "${naturalQuery}"`
          }
        ],
        temperature: 0.3,
        max_tokens: 500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response from OpenAI');
    }

    // Parse the JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('AI parsed query:', parsed);

      // Merge with user-selected filters
      return {
        types: [...new Set([...(parsed.types || []), ...(filters.types || [])])],
        states: [...new Set([...(parsed.states || []), ...(filters.states || [])])],
        searchTerms: parsed.searchTerms || [],
        correctedQuery: parsed.correctedQuery || naturalQuery,
        understanding: parsed.understanding || ''
      };
    }

    throw new Error('Could not parse AI response');

  } catch (error) {
    console.error('AI search error, falling back to keyword search:', error);
    return parseQueryKeywords(naturalQuery, filters);
  }
}

/**
 * Fallback keyword-based parsing when API is unavailable
 */
function parseQueryKeywords(naturalQuery, filters) {
  const query = naturalQuery.toLowerCase();
  const words = query.split(/\s+/).filter(w => w.length > 2);

  // Content type detection with common misspellings
  const typePatterns = {
    'Customer Story': ['customer', 'story', 'stories', 'case', 'study', 'costumer', 'custimer'],
    'Video': ['video', 'videos', 'vido', 'vidoe', 'film', 'watch'],
    'Video Clip': ['clip', 'clips', 'short', 'shorts'],
    'Blog': ['blog', 'blogs', 'article', 'articles', 'post'],
    'Ebook': ['ebook', 'ebooks', 'e-book', 'book', 'guide', 'whitepaper'],
    'Webinar': ['webinar', 'webinars', 'webiner', 'webniar', 'presentation'],
    '1-Pager': ['pager', '1-pager', 'one-pager', 'onepager', 'flyer', 'flier'],
    'Press Release': ['press', 'release', 'news', 'announcement'],
    'Award': ['award', 'awards', 'recognition', 'winner'],
    'Landing Page': ['landing', 'page', 'lp'],
    'Asset': ['asset', 'assets', 'resource', 'resources']
  };

  // State detection with full names and common misspellings
  const statePatterns = {
    'TX': ['texas', 'texs', 'texa', 'tx'],
    'CA': ['california', 'californa', 'cali', 'ca'],
    'NY': ['new york', 'newyork', 'ny'],
    'FL': ['florida', 'flordia', 'fl'],
    'IL': ['illinois', 'il'],
    'PA': ['pennsylvania', 'pa'],
    'OH': ['ohio', 'oh'],
    'GA': ['georgia', 'ga'],
    'NC': ['north carolina', 'nc'],
    'MI': ['michigan', 'mi'],
    'NJ': ['new jersey', 'nj'],
    'VA': ['virginia', 'va'],
    'WA': ['washington', 'wa'],
    'AZ': ['arizona', 'az'],
    'MA': ['massachusetts', 'ma'],
    'TN': ['tennessee', 'tn'],
    'IN': ['indiana', 'in'],
    'MO': ['missouri', 'mo'],
    'MD': ['maryland', 'md'],
    'WI': ['wisconsin', 'wi'],
    'CO': ['colorado', 'co'],
    'MN': ['minnesota', 'mn'],
    'SC': ['south carolina', 'sc'],
    'AL': ['alabama', 'al'],
    'LA': ['louisiana', 'la'],
    'KY': ['kentucky', 'ky'],
    'OR': ['oregon', 'or'],
    'OK': ['oklahoma', 'ok'],
    'CT': ['connecticut', 'ct'],
    'UT': ['utah', 'ut'],
    'NV': ['nevada', 'nevda', 'nv'],
    'NH': ['new hampshire', 'nh']
  };

  // Detect types
  const detectedTypes = [];
  for (const [type, patterns] of Object.entries(typePatterns)) {
    if (patterns.some(p => query.includes(p))) {
      detectedTypes.push(type);
    }
  }

  // Detect states
  const detectedStates = [];
  for (const [abbrev, patterns] of Object.entries(statePatterns)) {
    if (patterns.some(p => query.includes(p))) {
      detectedStates.push(abbrev);
    }
  }

  // Extract search terms (words that aren't stop words)
  const stopWords = ['the', 'and', 'for', 'from', 'with', 'about', 'show', 'find', 'get', 'all', 'any', 'has', 'have', 'content', 'marketing'];
  const searchTerms = words.filter(w => !stopWords.includes(w));

  return {
    types: [...new Set([...detectedTypes, ...(filters.types || [])])],
    states: [...new Set([...detectedStates, ...(filters.states || [])])],
    searchTerms,
    correctedQuery: naturalQuery,
    understanding: 'Basic keyword matching (no AI)'
  };
}

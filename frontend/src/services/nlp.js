/**
 * Natural Language Processing Service
 * Uses OpenAI to intelligently parse search queries
 * Handles misspellings, synonyms, and natural language understanding
 */

const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

/**
 * SchooLinks Context for AI Prompts
 * Condensed from SL_baseline_context_AIAgents.md
 */
const SCHOOLINKS_CONTEXT = `
SCHOOLINKS OVERVIEW:
SchooLinks is a single college & career readiness (CCR) platform for K-12 that supports every student (college-bound, career-bound, undecided) while giving staff actionable workflows and real-time reporting for state/federal compliance.

KEY DIFFERENTIATORS:
1. Student-first design drives organic adoption (minimal training, modern UX, gamified elements)
2. Digitizes student activities with real-time data capture (not "scanning paper into a portal")
3. Live, actionable data for compliance with drill-down by student/building/activity
4. Industry partner engagement directly in the platform
5. Everything in one place: graduation tracking, WBL, alumni, wellness, CCR activities

TARGET PERSONAS:
1. School Counselors - Want: track student journeys, simplify workflows, increase completion (FAFSA, milestones). Pain: overwhelmed caseloads, paperwork, manual follow-up
2. District Admins/Cabinet - Care about: graduation rates, state indicator performance, budget consolidation. Often "never logs in" - uses data for board meetings
3. State Leaders/Accountability - Care about: indicator definitions, consistent reporting, legislative changes
4. CTE/WBL Leaders - Want: scale WBL (internships, apprenticeships), partner management, compliance reporting

KEY FEATURES:
- KRI (Key Readiness Indicators): Centralizes data sources, proactive calculation, drill-down views, democratizes access
- Course Planner: Multi-year planning with real-time error checks (NOT a scheduling tool - SIS does that)
- PLP/ILP/ECAP: Digital state-mandated plans with guardian signatures, auto-completes from student activities
- WBL Program Management: Applications → matching → placement → documentation → timesheets
- Scope & Sequence: Powers student To-Dos, drives change management during transitions
- College Application Management: Integrates with Common App, transcript center

COMPETITORS (with SchooLinks advantages):
- PowerSchool Naviance: Legacy leader, dated interface, complex pricing, poor support → SchooLinks: modern UX, transparent pricing, responsive support
- Xello: Strong career exploration → SchooLinks: better college tools, KRI reporting, staff workflows, guardian signatures
- MajorClarity: One-stop CCR positioning → SchooLinks: broader feature set, better implementation support
- YouScience Brightpath, Kuder Navigator: Career-focused → SchooLinks: unified college + career platform

COMMON USE CASES:
1. "Switching from Naviance" - Tool sprawl, low engagement, admin burden. SchooLinks unifies everything
2. FAFSA completion - Events, messaging, tracking, Game of Life financial planning
3. WBL at scale - Partner onboarding, placements, documentation, hours, evaluations
4. Graduation tracking - Course Planner aligns to requirements, KRI provides early intervention
5. State-mandated plans - PLP workflow with guardian signatures, auto-completes from activities

MESSAGING BLOCKS:
- One-liner: "SchooLinks is the all-in-one CCR platform that helps districts support every student while giving staff real-time workflows and reporting."
- Differentiator: "We're designed for student adoption and staff action, not just reporting."
- Vendor consolidation: "Replace multiple platforms with one unified solution for graduation tracking, WBL, alumni, wellness, and CCR activities."

SAFETY RAILS (don't overclaim):
- Do NOT claim exact district counts or adoption numbers unless provided
- For competitors beyond Naviance/Xello/MajorClarity/YouScience/Kuder, respond at category level
- For state-specific requirements: "SchooLinks supports state-mandated plan structures and can be updated for legislative changes"
`;

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

CONTENT TYPE DISAMBIGUATION:
- "Video" = full-length videos, tutorials, demos, recorded webinars
- "Video Clip" = short clips, snippets, teasers, highlights (use ONLY when user says "clip", "clips", "short video", or "snippet")
- IMPORTANT: If query contains "clip" or "clips", use ONLY "Video Clip" type, NOT "Video"
- If query just says "videos" without "clip", use ONLY "Video" type

Examples:
- "costumer storys from texs" → types: ["Customer Story"], states: ["TX"], searchTerms: ["customer", "story", "texas"]
- "videos about college" → types: ["Video"], searchTerms: ["college", "higher education", "university"]
- "video clips about Xello" → types: ["Video Clip"], searchTerms: ["xello", "competitor"]
- "short videos" → types: ["Video Clip"], searchTerms: []
- "Xello clips" → types: ["Video Clip"], searchTerms: ["xello", "competitor"]
- "content for counselors in california" → states: ["CA"], searchTerms: ["counselor", "counselors", "guidance"]
- "nevada schools" → states: ["NV"], searchTerms: ["school", "schools", "education", "district"]
- "customer videos" → types: ["Video"], searchTerms: ["customer", "testimonial"]`
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
/**
 * Use AI to analyze and rank search results by relevance
 * Sends results to OpenAI to score based on how well they match the user's intent
 * IMPORTANT: Uses TITLES (not IDs) for recommendation matching to avoid index mismatch bugs
 */
export async function rankResultsByRelevance(results, userQuery, maxResults = 50) {
  if (!OPENAI_API_KEY || !results || results.length === 0) {
    return { rankedResults: results, explanation: null };
  }

  // Limit results to avoid token limits
  const resultsToRank = results.slice(0, maxResults);

  // Create a condensed version of results for the AI - using title as primary identifier
  // Include enriched data (enhanced_summary, auto_tags) for better relevance matching
  const condensedResults = resultsToRank.map((item) => ({
    title: item.title,
    type: item.type,
    state: item.state,
    // Prefer enhanced_summary if available, otherwise use original summary
    summary: (item.enhanced_summary || item.summary || '').substring(0, 400),
    // Combine original tags with AI-generated auto_tags for comprehensive matching
    tags: [item.tags, item.auto_tags].filter(Boolean).join(', ')
  }));

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
            content: `You are an intelligent content assistant for SchooLinks marketing team. Your job is to help users find the MOST RELEVANT content from their marketing database.

${SCHOOLINKS_CONTEXT}

RELEVANCE RULES:
1. For competitor searches (e.g., "Xello vs SchooLinks", "Naviance alternative"):
   - ONLY content that EXPLICITLY mentions that EXACT competitor name should be recommended
   - Naviance content is NOT relevant to Xello searches - these are DIFFERENT competitors
   - Xello content is NOT relevant to Naviance searches
   - Each competitor is DISTINCT - NEVER cross-recommend (showing Naviance for Xello search is WRONG)
   - Check the title AND tags for the competitor name
   - If NO content exists for the searched competitor:
     a) Clearly state in aiResponse: "We don't have specific [competitor] comparison content yet"
     b) DO NOT substitute with other competitor content
     c) Optionally mention: "We do have [other competitor] comparisons if that would be helpful"
   - Landing Pages comparing that SPECIFIC competitor = highest relevance
   - Customer Stories mentioning that SPECIFIC competitor = high relevance

2. For persona searches (e.g., "content for counselors"):
   - Match content addressing that persona's pain points and needs
   - Prioritize testimonials and case studies from similar roles

3. For use case searches (e.g., "FAFSA completion", "WBL tracking"):
   - Match content addressing that specific workflow
   - Include related feature content

4. Read the ACTUAL summary text carefully - does it truly match the search intent?

5. For state-specific searches (e.g., "Florida content", "Texas customer stories"):
   - PRIORITIZE content from the requested state - these should ALWAYS be listed first in recommendations
   - If you recommend content from a DIFFERENT state, you MUST:
     a) Clearly state in aiResponse: "While we only have one Florida story, here are similar examples from other states..."
     b) Include the state in the reason: "From Nevada - similar WBL implementation approach"
     c) Explain WHY it's relevant despite being from a different state
   - NEVER present different-state content as if it's from the requested state
   - If NO content exists for the requested state, clearly say so: "We don't have any [STATE] content yet, but here are relevant examples from similar states..."

6. For content type searches (e.g., "video clips", "customer stories"):
   - "Video Clip" is DISTINCT from "Video" - clips are short snippets, videos are full-length
   - If user asks for "video clips", ONLY recommend items with type="Video Clip"
   - If user asks for "videos" (without "clip"), recommend type="Video" items
   - Use tags as supporting evidence: if tags include "clip", "short", "snippet" = likely a clip
   - NEVER recommend a "Video" when user specifically asked for "Video Clip" or "clips"

7. TAGS CONTAIN RICH METADATA from AI content analysis:
   - Tags may include: competitor names mentioned in the content (Naviance, Xello, etc.)
   - Tags may include: personas addressed (counselors, administrators, CTE coordinators)
   - Tags may include: topics covered (FAFSA, graduation, work-based learning, career exploration)
   - Tags may include: content format hints (testimonial, demo, tutorial, customer-story)
   - USE TAGS to validate content relevance - if user searches for "Naviance" and tags include "Naviance", it's highly relevant

CRITICAL: Your response must use EXACT TITLES from the content list. Do not paraphrase or modify titles.

YOUR RESPONSE FORMAT:
{
  "aiResponse": "A helpful 2-3 sentence response directly answering what the user is looking for. Be specific about what you found and reference SchooLinks knowledge when relevant. Mention the exact titles you're recommending.",
  "primaryRecommendations": [
    { "title": "EXACT title from content list", "reason": "Why this is the best match" }
  ],
  "additionalResources": [
    { "title": "EXACT title from content list", "reason": "Why this is also relevant" }
  ],
  "rankedTitles": ["title1", "title2", "title3", ...],
  "topMatches": [
    { "title": "EXACT title", "score": 10, "reason": "Detailed relevance explanation" }
  ]
}

IMPORTANT - RECOMMENDATION QUANTITIES:
- primaryRecommendations: Include 3-5 items that BEST match the search intent. These are the "must-see" resources.
- additionalResources: Include 5-10 more items that are also relevant. These provide comprehensive options.
- If fewer high-quality matches exist, only include what's truly relevant. Quality over quantity.
- The user will see these recommendations prominently in the chat assistant interface.

Be conversational and demonstrate SchooLinks product knowledge. If the user searches for competitor content, explain how SchooLinks differentiates.`
          },
          {
            role: 'user',
            content: `I'm searching for: "${userQuery}"

Here's the content in our database that matched:
${JSON.stringify(condensedResults, null, 2)}

Please analyze each item's title and summary carefully. Find me the MOST relevant content for my search, and explain your reasoning.`
          }
        ],
        temperature: 0.3,
        max_tokens: 3500
      })
    });

    if (!response.ok) {
      console.error('OpenAI ranking API error:', response.status);
      return { rankedResults: results, explanation: null };
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      return { rankedResults: results, explanation: null };
    }

    // Parse the JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('AI ranking result:', parsed);

      // Reorder results based on AI ranking - using TITLES instead of IDs
      const rankedResults = [];
      const resultMap = new Map(resultsToRank.map(r => [r.title, r]));

      // Add ranked results in order by title
      for (const title of parsed.rankedTitles || []) {
        if (resultMap.has(title)) {
          const item = resultMap.get(title);
          // Find relevance info for this item by title
          const matchInfo = parsed.topMatches?.find(m => m.title === title);
          if (matchInfo) {
            item._relevanceScore = matchInfo.score;
            item._relevanceReason = matchInfo.reason;
          }
          rankedResults.push(item);
          resultMap.delete(title);
        }
      }

      // Add any remaining results that weren't ranked
      for (const [, item] of resultMap) {
        rankedResults.push(item);
      }

      // Add any results beyond maxResults that weren't sent to AI
      if (results.length > maxResults) {
        rankedResults.push(...results.slice(maxResults));
      }

      return {
        rankedResults,
        explanation: parsed.searchSummary,
        aiResponse: parsed.aiResponse,
        primaryRecommendations: parsed.primaryRecommendations,
        additionalResources: parsed.additionalResources,
        topMatches: parsed.topMatches
      };
    }

    return { rankedResults: results, explanation: null };

  } catch (error) {
    console.error('AI ranking error:', error);
    return { rankedResults: results, explanation: null };
  }
}

/**
 * Fallback keyword-based parsing when API is unavailable
 */
function parseQueryKeywords(naturalQuery, filters) {
  const query = naturalQuery.toLowerCase();
  const words = query.split(/\s+/).filter(w => w.length > 2);

  // Content type detection with common misspellings
  // Note: Video Clip patterns are checked separately with priority
  const typePatterns = {
    'Customer Story': ['customer', 'story', 'stories', 'case', 'study', 'costumer', 'custimer'],
    'Video': ['video', 'videos', 'vido', 'vidoe', 'film', 'watch', 'tutorial', 'demo'],
    'Video Clip': ['clip', 'clips', 'short video', 'shorts', 'snippet', 'snippets', 'teaser', 'highlight'],
    'Blog': ['blog', 'blogs', 'article', 'articles', 'post'],
    'Ebook': ['ebook', 'ebooks', 'e-book', 'book', 'guide', 'whitepaper'],
    'Webinar': ['webinar', 'webinars', 'webiner', 'webniar', 'presentation'],
    '1-Pager': ['pager', '1-pager', 'one-pager', 'onepager', 'flyer', 'flier'],
    'Press Release': ['press', 'release', 'news', 'announcement'],
    'Award': ['award', 'awards', 'recognition', 'winner'],
    'Landing Page': ['landing', 'page', 'lp'],
    'Asset': ['asset', 'assets', 'resource', 'resources']
  };

  // Priority rule: "clip" keywords take precedence over generic "video"
  const clipKeywords = ['clip', 'clips', 'snippet', 'snippets', 'teaser', 'highlight', 'short video'];
  const hasClipKeyword = clipKeywords.some(k => query.includes(k));

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
      // Priority rule: if "clip" keywords present, skip generic "Video" type
      if (type === 'Video' && hasClipKeyword) {
        continue; // Don't add Video when user asked for clips
      }
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

/**
 * Process a conversational query with history context
 * Supports multi-turn dialog for the chat interface
 */
export async function processConversationalQuery(
  userMessage,
  conversationHistory,
  availableContent,
  maxContentForContext = 100
) {
  if (!OPENAI_API_KEY) {
    return {
      response: "AI assistant unavailable. Please use the search bar instead.",
      recommendations: []
    };
  }

  // Create content summary for context (include summary + all tags for better matching)
  // Use enriched data (enhanced_summary, auto_tags) when available
  const contentSummary = availableContent.slice(0, maxContentForContext).map(c => {
    // Prefer enhanced_summary, fall back to original summary
    const summaryText = c.enhanced_summary || c.summary || '';
    const summary = summaryText ? ` - ${summaryText.substring(0, 250)}` : '';
    // Combine both original tags and AI-generated auto_tags
    const allTags = [c.tags, c.auto_tags].filter(Boolean).join(', ');
    const tagsStr = allTags ? `, Tags: ${allTags}` : '';
    return `- "${c.title}" (${c.type}${c.state ? ', ' + c.state : ''}${tagsStr})${summary}`;
  }).join('\n');

  // Build conversation messages for OpenAI
  const messages = [
    {
      role: 'system',
      content: `You are an intelligent content assistant for SchooLinks marketing team. You help users find the most relevant marketing content through natural conversation.

${SCHOOLINKS_CONTEXT}

AVAILABLE CONTENT IN DATABASE:
${contentSummary}

YOUR RESPONSE FORMAT (MUST BE VALID JSON):
{
  "response": "Your conversational response. Be helpful, specific, and demonstrate SchooLinks knowledge. Reference exact content titles when recommending.",
  "recommendations": [
    { "title": "EXACT title from available content", "reason": "Brief explanation" }
  ],
  "followUpQuestions": ["Actionable search prompt 1", "Actionable search prompt 2"]
}

CRITICAL: You MUST respond with valid JSON. The recommendations array is REQUIRED.

**RECOMMENDATION RULES:**
- Include 5-10 recommendations for comprehensive coverage
- For competitor searches: prioritize comparison guides, competitive positioning content, and customer stories
- Match recommendations to the user's specific intent (e.g., "comparisons" = comparison guides first)
- An empty array [] is ONLY acceptable if truly NO content matches

IMPORTANT RULES:
1. Use EXACT titles from the available content list - COPY THE TITLE EXACTLY
2. Match the user's query intent - "comparison" queries → comparison guides first, "video" queries → videos first
3. Remember previous messages in the conversation and build on them
4. If user says "more like that" or "something different", reference prior context
5. Follow safety rails: don't claim exact district counts or numbers not provided
6. Be conversational and helpful, not robotic
7. followUpQuestions MUST be ACTIONABLE SEARCH PROMPTS that help find more content
   - GOOD: "Show me Xello videos", "Any Texas districts?", "Customer stories about Xello"
   - BAD: "What challenges are you facing?", "What features do you need?"

8. COMPETITOR SEARCHES - IMPORTANT:
   - The available content has been pre-filtered to competitor-relevant items
   - Recommend 5-10 items that BEST match the user's specific query
   - For "comparison" queries → prioritize comparison guides, competitive overviews
   - For "video" queries → prioritize video clips and videos
   - For "customer story" queries → prioritize customer stories and case studies

9. STATE-SPECIFIC SEARCHES - CRITICAL:
   - When user asks for content from a specific state (e.g., "Florida stories"), PRIORITIZE that state's content
   - If recommending content from OTHER states, you MUST clearly indicate this in your response
   - Example: "I found one Florida story. I'm also showing Nevada and Ohio examples that demonstrate similar approaches."
   - NEVER imply different-state content is from the requested state
   - If no content exists for requested state, say: "We don't have [STATE] content yet, but here are relevant examples from other states..."`
    },
    // Include conversation history (last 8 messages to stay within token limits)
    ...conversationHistory.slice(-8).map(msg => ({
      role: msg.role,
      content: msg.role === 'user' ? msg.content : (msg.aiContent || msg.content)
    })),
    {
      role: 'user',
      content: userMessage
    }
  ];

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages,
        temperature: 0.4,
        max_tokens: 1500
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('OpenAI conversational API error:', response.status, errorText);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content;

    if (!content) {
      return {
        response: "I couldn't process your request. Please try again.",
        recommendations: []
      };
    }

    // Parse the JSON response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      console.log('Conversational AI result:', parsed);

      return {
        response: parsed.response || content,
        recommendations: parsed.recommendations || [],
        followUpQuestions: parsed.followUpQuestions || [],
        aiContent: content // Store raw for context continuity
      };
    }

    // Fallback if JSON parsing fails - use raw response
    return {
      response: content,
      recommendations: [],
      aiContent: content
    };

  } catch (error) {
    console.error('Conversational query error:', error);
    return {
      response: "I encountered an error processing your request. Please try again or use the search bar.",
      recommendations: []
    };
  }
}

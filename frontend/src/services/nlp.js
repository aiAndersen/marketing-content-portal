/**
 * Natural Language Processing Service
 * Uses OpenAI to intelligently parse search queries
 * Handles misspellings, synonyms, and natural language understanding
 */

// Terminology Brain integration - lazy loaded to prevent cascade failures
// if terminology tables don't exist in the database
let terminologyModule = null;

async function getTerminologyModule() {
  if (!terminologyModule) {
    try {
      terminologyModule = await import('./terminology');
    } catch (err) {
      console.warn('[NLP] Failed to load terminology module:', err.message);
      terminologyModule = {
        applyTerminologyMappings: async () => ({ content_type: [], competitor: [], persona: [], topic: [], feature: [] }),
        getTerminologyPromptContext: async () => ''
      };
    }
  }
  return terminologyModule;
}

// OpenAI API key is now handled server-side via /api/openai proxy

/**
 * Multi-Model Strategy Configuration
 * Different models for different query complexities to balance cost and quality
 * See: SchooLinks Baseline Context/OpenAI_Models_Reference.md for full model list
 *
 * TESTED 2026-02-02: All models work ✅
 * Note: gpt-5 and o-series require max_completion_tokens (handled in API proxy)
 */
const AI_MODELS = {
  // Fast, cheap - for simple query parsing
  QUERY_PARSER: 'gpt-4o-mini',      // $0.15/$0.60 per 1M tokens ✅

  // Balanced - for standard searches (gpt-5-mini is 10x cheaper than gpt-4o!)
  STANDARD: 'gpt-5-mini',           // $0.25/$2.00 per 1M tokens ✅

  // Best reasoning - for complex sales questions, state context
  ADVANCED: 'gpt-5.2',              // $1.75/$14.00 per 1M tokens ✅
};

/**
 * Fallback models if primary model is unavailable (403/404 errors)
 * Order: try primary first, then fallbacks in sequence
 */
const MODEL_FALLBACKS = {
  'gpt-5.2': ['gpt-4.1', 'gpt-4o', 'gpt-4o-mini'],
  'gpt-5-mini': ['gpt-4o', 'gpt-4o-mini'],
  'gpt-4.1': ['gpt-4o', 'gpt-4o-mini'],
  'gpt-4o': ['gpt-4o-mini'],
  'gpt-4o-mini': [],  // No fallback needed - this is our baseline
};

/**
 * Make an OpenAI API call with automatic fallback on model errors
 * @param {object} requestBody - The request body for /api/openai
 * @returns {Promise<object>} - The API response data
 */
async function callOpenAIWithFallback(requestBody) {
  const primaryModel = requestBody.model;
  const modelsToTry = [primaryModel, ...(MODEL_FALLBACKS[primaryModel] || [])];

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const response = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...requestBody, model })
      });

      if (response.ok) {
        const data = await response.json();
        if (model !== primaryModel) {
          console.log(`[Model Fallback] Used ${model} instead of ${primaryModel}`);
        }
        return data;
      }

      // Check if it's a model-specific error (404 = model not found, 403 = no access)
      if (response.status === 404 || response.status === 403) {
        console.warn(`[Model Fallback] ${model} unavailable (${response.status}), trying next...`);
        lastError = new Error(`Model ${model} unavailable: ${response.status}`);
        continue;  // Try next model
      }

      // Other errors (400, 500, etc.) - don't fallback, throw immediately
      const errorText = await response.text();
      throw new Error(`OpenAI API error ${response.status}: ${errorText}`);

    } catch (err) {
      if (err.message.includes('unavailable')) {
        lastError = err;
        continue;
      }
      throw err;
    }
  }

  // All models failed
  throw lastError || new Error('All models unavailable');
}

/**
 * State-specific context hints for enhanced AI prompts
 * Explicit PLP name = / KRI name = format so AI always uses correct state term
 * Source: state-terminology-2026-02-24.csv — covers all 50 states
 *
 * IMPORTANT FORMAT: "PLP name = X" and "KRI name = Y" so AI substitutes
 * state-specific terms when users ask about PLP or KRI in a state context.
 */
const STATE_CONTEXT_HINTS = {
  'AL': "Alabama — PLP name: Graduation Plan | KRI name: CCR (College Career Readiness) | Key topics: CCR indicator monitoring, work-based learning, alumni access",
  'AK': "Alaska — PLP name: Personalized Learning Plans | KRI name: State and Graduation Requirements | Key topics: 4-6 year academic plans, FAFSA compliance",
  'AZ': "Arizona — PLP name: ECAP (Education and Career Action Plan) | KRI name: CCRI (College and Career Readiness Indicator) | Key topics: graduation endorsements, course planner, CCRI compliance. In Arizona, always say ECAP not PLP.",
  'AR': "Arkansas — PLP name: Graduation Plan | KRI name: CCR (College Career Readiness) | Key topics: graduation planning, work-based learning, alumni access",
  'CA': "California — PLP name: A-G Aligned Plan | KRI name: CCI (College/Career Indicator) | Key topics: A-G requirements, CTE pathways, district-wide CCI Progress Dashboard, alumni outcomes",
  'CO': "Colorado — PLP name: ICAP (Individual Career and Academic Plan) | KRI name: PWR (Postsecondary Workforce Readiness) | Key topics: MyColoradoJourney, QCPF, WBL, graduation requirements",
  'CT': "Connecticut — PLP name: SSP (Student Success Plan) | KRI name: Required Public School Program of Study | Key topics: FAFSA support, student interest monitoring",
  'DE': "Delaware — PLP name: Delaware Pathways Plans | KRI name: DSSF (Delaware School Success Framework) | Key topics: FAFSA resources, financial aid",
  'FL': "Florida — PLP name: Graduation Plan | KRI name: Bright Futures Scholarship Tracking | Key topics: Bright Futures eligibility, GPA/test score/volunteer hour monitoring, Scholar designation, career academies",
  'GA': "Georgia — PLP name: ICCP (Individual College & Career Plans) | KRI name: Top State for Talent Act / HB 192 (Career Advisement) | Key topics: GAfutures, Dual Enrollment, GA MATCH integration, grades 6-12 career advisement checklist",
  'HI': "Hawaii — PLP name: PTP (Personal Transition Plan) | KRI name: CCR Tracking | Key topics: K-12 work-based learning history, financial aid resources",
  'ID': "Idaho — PLP name: Personalized Learning Plans | KRI name: State and Graduation Requirements | Key topics: FAFSA compliance, graduation tracking",
  'IL': "Illinois — PLP name: ILP (Individualized Learning Plan, via PaCE Framework) | KRI name: IL PWR / CCPE / ISBE CCRI | Key topics: Postsecondary Workforce and Readiness (PWR) Act, CCPE tracking, Career Pathway Endorsements on diplomas",
  'IN': "Indiana — PLP name: Career and Academic Plan | KRI name: Roadmap for Student Success | Key topics: 6-year Course Planner, WBL, Pre-Apprenticeship programs",
  'IA': "Iowa — PLP name: ICAP (Individual Career and Academic Plan) | KRI name: Iowa Career Readiness Standards | Key topics: Iowa-specific career data, 4-6 year course plans, ICAP activity tracking",
  'KS': "Kansas — PLP name: IPS (Individual Plans of Study) | KRI name: KSDE Graduation Requirements | Key topics: Postsecondary Asset tracking dashboard, student interest monitoring",
  'KY': "Kentucky — PLP name: ILP (Individual Learning Plan) | KRI name: CCR (College Career Readiness) | Key topics: Academic and Career Plan, graduation endorsements, digital approvals",
  'LA': "Louisiana — PLP name: ILP (Individual Learning Plan) | KRI name: LEAP 360 | Key topics: LEAP 360 assessment tracking, FAFSA resources",
  'ME': "Maine — PLP name: PLP (Personalized Learning Plan) | KRI name: CCR Anchor Standards | Key topics: K-12 indicator tracking, digital signatures, elementary through high school",
  'MD': "Maryland — PLP name: CCR Plan | KRI name: MSDE State CCR / Blueprint for Maryland's Future | Key topics: Blueprint for the Future Pillar Three, Early Warning Indicators, 55% college enrollment goal",
  'MA': "Massachusetts — PLP name: MyCaP (My Career and Academic Plan) | KRI name: EWIS (Early Warning Indicator System) | Key topics: MyCAP program, WBL hours monitoring, graduation benchmarks. In Massachusetts, always say MyCaP not PLP.",
  'MI': "Michigan — PLP name: EDP (Education Development Plan) | KRI name: MME-Aligned CCR Indicators | Key topics: Talent Portfolios from 7th grade, CTE pathway tracking, Dual Credit, Michigan Career Development Model, Sixty by 30",
  'MN': "Minnesota — PLP name: Personalized Learning Plans | KRI name: CCREWS (MN CCR Early Warning System) | Key topics: World's Best Workforce goal, FAFSA compliance, student interest monitoring",
  'MS': "Mississippi — PLP name: ISP (Individual Success Plan) | KRI name: ACT WorkKeys | Key topics: ACT WorkKeys indicators, achievement history documentation",
  'MO': "Missouri — PLP name: ICAP (Individual Career Academic Plan) | KRI name: MVA (Missouri Value-Added) / A+ | Key topics: MVA tracking, A+ program, WBL, CTE pathways, digital approvals",
  'MT': "Montana — PLP name: ESSA State Plan | KRI name: CCR Indicator | Key topics: ESSA plan as living document, activity tracking, digital approvals",
  'NE': "Nebraska — PLP name: Personal Learning Plans and Portfolios | KRI name: Nebraska Career Readiness Standards | Key topics: CCR Ready framework, Perkins V, electronic signatures for students and families",
  'NV': "Nevada — PLP name: Career Planning and Placement Plan | KRI name: NSPF (Nevada School Performance Framework) | Key topics: NSPF tracking, financial aid resources",
  'NH': "New Hampshire — PLP name: IPE (Individualized Employment Plans) | KRI name: Annual Performance Report | Key topics: Career Planning and Placement Plans, activity tracking, digital approvals",
  'NJ': "New Jersey — PLP name: Graduation Plan | KRI name: Student Learning Standards for Career Readiness | Key topics: CCR tracking across all grades, FAFSA support",
  'NM': "New Mexico — PLP name: Next Step Plan | KRI name: CCR (College Career Readiness) | Key topics: College and Career Readiness Bureau, state reporting, work-based learning",
  'NY': "New York — PLP name: Graduation Plan | KRI name: CCR / Seals of Civic Readiness & Biliteracy | Key topics: Seal of Civic Readiness, Seal of Biliteracy, CDOS credential, CTE endorsements",
  'NC': "North Carolina — PLP name: Career Planning and Placement Plans | KRI name: Student Readiness Indicator | Key topics: student interest monitoring, financial aid, digital approvals",
  'ND': "North Dakota — PLP name: ESSA State Plan | KRI name: Choice Ready | Key topics: Choice Ready framework, student interest tracking, digital signatures",
  'OH': "Ohio — PLP name: OGP (Ohio Graduation Plan) | KRI name: OGP / Ohio Means Jobs | Key topics: Career Connections Framework, Ohio Means Jobs readiness seal, College Readiness Seals, graduation seals, career passport",
  'OK': "Oklahoma — PLP name: ICAP (Individual Career Academic Plan) | KRI name: CCR (College Career Readiness) | Key topics: postsecondary pathway awareness, WBL, industry partners",
  'OR': "Oregon — PLP name: EPP (Education Plans and Profiles) | KRI name: HS.HECPS (High School Habits Experiences Competencies Plans for Success) | Key topics: Senate Bill 3 for Class of 2027, 14 HS.HECPS standards, CRLE, ORSAA compliance",
  'PA': "Pennsylvania — PLP name: Career-Aligned Course Plan | KRI name: Act 158 / Chapter 339 | Key topics: Act 158 & Chapter 339 compliance, PIMS reporting, industry-based learning, FAFSA monitoring",
  'RI': "Rhode Island — PLP name: ILP (Individual Learning Plan) | KRI name: RIDE ILP Framework / Performance-Based Diploma Assessment | Key topics: 21 required credits, CCR-Based Exams, Performance-Based Diploma Assessment, Pathway Endorsements",
  'SC': "South Carolina — PLP name: IGP (Individual Graduation Plan) | KRI name: Act 213 / CCR | Key topics: Act 213 six IGP components, digital guardian signatures, SEL data integration",
  'SD': "South Dakota — PLP name: SDMyLife | KRI name: SDMyLife | Key topics: WBL and Pathways Dashboard, Course Planning, Dual Credit tracking",
  'TN': "Tennessee — PLP name: ESSA State Plan | KRI name: Ready Graduate Indicator | Key topics: dual credit monitoring, FAFSA resources, CCR standards compliance",
  'TX': "Texas — PLP name: PGP (Personal Graduation Plan) | KRI name: CCMR (College Career and Military Readiness) | Key topics: HB 5 endorsements, HB 773 IBC requirements, TEA CCMR Tracker, TEA accountability. In Texas, always say CCMR not KRI and PGP not PLP.",
  'UT': "Utah — PLP name: PCCR (Plan for College and Career Readiness) | KRI name: PCCR (Plan for College and Career Readiness) | Key topics: First Credential initiative, HB260, CTE pathway tracking, 7th grade through graduation",
  'VT': "Vermont — PLP name: PLP / ACP (Academic and Career Plan) | KRI name: CCR (College Career Readiness) | Key topics: dual credit monitoring, digital approval workflows",
  'VA': "Virginia — PLP name: ACP (Academic and Career Plan) | KRI name: Virginia CCR Initiative | Key topics: Capstone Course Content, endorsement planning, digital approvals",
  'WA': "Washington — PLP name: HSBP (High School and Beyond Plan) | KRI name: HSBP (High School and Beyond Plan) | Key topics: statewide universal HSBP solution, career pathway alignment, dual credit, course planning. In Washington, always say HSBP not PLP.",
  'WV': "West Virginia — PLP name: WVCCRDSSS (WV College Career Readiness Dispositions and Standards for Student Success) | KRI name: WVAS (WV Accountability System) | Key topics: auto-generated documents from student activities, career plan documentation",
  'WI': "Wisconsin — PLP name: ACP (Academic and Career Plan) | KRI name: Wisconsin State CCR Indicators | Key topics: PI 26 requirements, Youth Apprenticeship, WBL/CTE Dashboard, 4-6 year course planning",
  'WY': "Wyoming — PLP name: PGP (Personal Graduation Plan) | KRI name: CCR (College Career Readiness) | Key topics: course planning, living document with activity tracking",
};

/**
 * Detect query complexity to route to appropriate AI model
 * Enhanced routing based on query characteristics
 * @param {string} query - The user's query
 * @returns {'simple'|'standard'|'advanced'} - Complexity level
 */
function detectQueryComplexity(query) {
  const q = query.toLowerCase();
  const wordCount = q.split(/\s+/).filter(w => w.length > 0).length;

  // SIMPLE: Short queries with basic filters only
  // Keep in gpt-4o-mini if: <5 words, content type + basic filter, no comparison/why language
  const simplePatterns = [
    /^show\s+(me\s+)?(all\s+)?\w+s?$/i,              // "show me webinars"
    /^\w+\s+content$/i,                              // "Texas content"
    /^(videos?|webinars?|ebooks?|blogs?)\s+(from|about)\s+\w+$/i,  // "Videos from 2024"
  ];
  const isSimplePattern = simplePatterns.some(r => r.test(q));
  const hasNoComplexLanguage = !/why|how|compare|vs|versus|better|should/i.test(q);

  if (wordCount < 5 && hasNoComplexLanguage && isSimplePattern) {
    console.log('[Model Selection] Query complexity: SIMPLE (short + basic filter)');
    return 'simple';
  }

  // ADVANCED: Auto-route if query contains these high-complexity indicators
  const advancedIndicators = [
    // Competitor names
    /\b(naviance|xello|ccgi|scoir|majorclarity|powerschool|kuder|youscience)\b/i,
    // Comparison language
    /\b(vs|versus|compared?\s+to|better\s+than|difference|alternative)\b/i,
    // Why/How questions about SchooLinks
    /\b(why\s+should|how\s+does\s+schoolinks|what\s+makes)\b/i,
    // State legislation codes and state-specific acronyms
    /\b(hb\s*\d+|sb\s*\d+|act\s+\d+|chapter\s+339|ride\s+framework|ccmr|icap|ecap|pgp|ilp|hsbp|pccr|ccri|ccrews|sdmylife|dssf|wvccrdsss|wvas|hs\.hecps|epp|ogp|igp|ssp|ipe|ips|mycap|ewis|edp|ptp|iccp|cci|pwr|mva|leap\s+360|choice\s+ready|ready\s+graduate)\b/i,
    // ROI/business value with specifics
    /\b(roi|cost\s+savings?|time\s+savings?|efficiency|budget)\b.*\b(proof|evidence|data|numbers?)\b/i,
    // Multiple product features in one query
    /(and|plus|\+|with|along\s+with).*(tracking|compliance|engagement|reporting)/i,
    // Sales objection handling
    /\b(objection|concern|pushback|address|overcome|migration|switch\s+from)\b/i,
    // Evidence/proof requests
    /\b(proof\s+points?|evidence|demonstrate|show\s+that)\b/i,
  ];

  const advancedCount = advancedIndicators.filter(r => r.test(q)).length;
  if (advancedCount >= 1) {
    console.log(`[Model Selection] Query complexity: ADVANCED (${advancedCount} advanced indicators matched)`);
    return 'advanced';
  }

  // STANDARD: Multi-attribute filtering, topic understanding, moderate NLU
  const standardIndicators = [
    // Topic/theme understanding
    /\b(about|explaining|regarding|related\s+to)\b/i,
    // Persona-specific content
    /\b(for\s+(counselors?|superintendents?|admins?|teachers?|principals?|cte|wbl))\b/i,
    // Outcome-focused queries
    /\b(improve|increase|track|measure|outcomes?|results?|success)\b/i,
    // Feature-specific queries with context
    /\b(fafsa|graduation|career|college|assessment|planning)\b.*\b(tracking|completion|readiness)\b/i,
    // Multi-word descriptive queries
    wordCount >= 6,
  ];

  const standardCount = standardIndicators.filter(r => typeof r === 'boolean' ? r : r.test(q)).length;
  if (standardCount >= 1) {
    console.log(`[Model Selection] Query complexity: STANDARD (${standardCount} standard indicators matched)`);
    return 'standard';
  }

  // Default to simple for basic queries
  console.log('[Model Selection] Query complexity: SIMPLE (default)');
  return 'simple';
}

/**
 * Log complete AI interaction to Supabase for QA and fine-tuning
 * Captures query + AI response for review and improvement
 * @param {string} query - The user's query
 * @param {string} complexity - 'simple' | 'standard' | 'advanced'
 * @param {string} model - The model used
 * @param {object} metadata - Additional context (detectedStates, queryType, sessionId)
 * @param {object} response - The AI response (optional)
 * @param {number} responseTimeMs - Time taken for AI response (optional)
 */
async function logPromptForAnalysis(query, complexity, model, metadata = {}, response = null, responseTimeMs = null) {
  // Only log standard and advanced queries (skip simple ones to reduce noise)
  if (complexity === 'simple') return;

  try {
    const { supabaseClient } = await import('./supabase');

    const logEntry = {
      query: query,
      complexity: complexity,
      model_used: model,
      detected_states: metadata.detectedStates || [],
      query_type: metadata.queryType || 'search',
      timestamp: new Date().toISOString(),
      matched_indicators: metadata.matchedIndicators || [],
      session_id: metadata.sessionId || null,
    };

    // Add response data for QA review (if available)
    if (response) {
      logEntry.ai_quick_answer = response.quick_answer || null;
      logEntry.ai_key_points = response.key_points || [];
      logEntry.ai_response_raw = JSON.stringify(response).substring(0, 5000);
      logEntry.recommendations_count = response.recommendations?.length || 0;
    }

    if (responseTimeMs) {
      logEntry.response_time_ms = responseTimeMs;
    }

    const { error } = await supabaseClient
      .from('ai_prompt_logs')
      .insert([logEntry]);

    if (error) {
      console.warn('[Prompt Logging] Failed:', error.message);
    } else {
      console.log(`[Prompt Logging] Logged ${complexity} query${response ? ' with response' : ''} for QA`);
    }
  } catch (err) {
    console.warn('[Prompt Logging] Error:', err.message);
  }
}

/**
 * Get the appropriate model for a given function and query
 * @param {'parser'|'ranker'|'chat'} functionType - Which function is calling
 * @param {string} query - The user's query (for complexity detection)
 * @returns {string} - Model name to use
 */
function getModelForQuery(functionType, query = '') {
  if (functionType === 'parser') {
    // Always use fast model for parsing
    return AI_MODELS.QUERY_PARSER;
  }

  if (functionType === 'ranker') {
    // Use standard model for ranking
    return AI_MODELS.STANDARD;
  }

  if (functionType === 'chat') {
    // Dynamic selection based on query complexity
    const complexity = detectQueryComplexity(query);
    switch (complexity) {
      case 'advanced':
        return AI_MODELS.ADVANCED;
      case 'standard':
        return AI_MODELS.STANDARD;
      default:
        return AI_MODELS.QUERY_PARSER;
    }
  }

  return AI_MODELS.QUERY_PARSER;
}

/**
 * Autocorrect common misspellings before AI processing
 * Uses Levenshtein distance for fuzzy matching
 */
const AUTOCORRECT_DICTIONARY = {
  // US States (common misspellings)
  'virginai': 'virginia', 'virgina': 'virginia', 'virgnia': 'virginia', 'viriginia': 'virginia',
  'californa': 'california', 'califronia': 'california', 'californai': 'california', 'cali': 'california',
  'texs': 'texas', 'teaxs': 'texas', 'texsa': 'texas',
  'flordia': 'florida', 'flroida': 'florida', 'florda': 'florida',
  'ohoi': 'ohio', 'ohi': 'ohio',
  'illinios': 'illinois', 'ilinois': 'illinois', 'illnois': 'illinois',
  'michgan': 'michigan', 'michagan': 'michigan', 'michign': 'michigan',
  'pensylvania': 'pennsylvania', 'pennslvania': 'pennsylvania', 'pennsylania': 'pennsylvania',
  'georgai': 'georgia', 'goergia': 'georgia',
  'arizon': 'arizona', 'arizonia': 'arizona',
  'minesota': 'minnesota', 'minnisota': 'minnesota',
  'wisconson': 'wisconsin', 'wisconsn': 'wisconsin',
  'tennesee': 'tennessee', 'tennesse': 'tennessee',
  'missour': 'missouri', 'misouri': 'missouri',
  'louisianna': 'louisiana', 'lousiana': 'louisiana',
  'massachusets': 'massachusetts', 'massachussetts': 'massachusetts',
  'conneticut': 'connecticut', 'conecticut': 'connecticut',
  'oregn': 'oregon', 'oregan': 'oregon',
  'colorad': 'colorado', 'colordo': 'colorado',
  'kentuckey': 'kentucky', 'kentucy': 'kentucky',
  'alabma': 'alabama', 'alabamam': 'alabama',
  'missisippi': 'mississippi', 'mississipi': 'mississippi',
  'indianna': 'indiana', 'indana': 'indiana',
  'nevade': 'nevada', 'nevad': 'nevada',
  'oklahom': 'oklahoma', 'oaklahoma': 'oklahoma',
  'arkasas': 'arkansas', 'arkensas': 'arkansas',
  'iow': 'iowa', 'iwoa': 'iowa',
  'kansa': 'kansas', 'kanasas': 'kansas',
  'nebreska': 'nebraska', 'nebraksa': 'nebraska',
  'utahh': 'utah',
  'mainee': 'maine', 'miane': 'maine',
  'deleware': 'delaware', 'delawre': 'delaware',
  'vermot': 'vermont', 'vermnt': 'vermont',
  'hawai': 'hawaii', 'hawii': 'hawaii',
  'alask': 'alaska', 'alsaka': 'alaska',
  'idahoo': 'idaho', 'idho': 'idaho',
  'montanaa': 'montana', 'motana': 'montana',
  'wyomin': 'wyoming', 'wyomng': 'wyoming',
  // Competitors
  'navience': 'naviance', 'naviannce': 'naviance', 'navance': 'naviance',
  'xelo': 'xello', 'zelo': 'xello', 'xcello': 'xello',
  'majorclairty': 'majorclarity', 'major clarity': 'majorclarity',
  'powerschol': 'powerschool', 'power school': 'powerschool',
  // Common terms
  'councelor': 'counselor', 'counsler': 'counselor', 'counselers': 'counselors', 'counsleors': 'counselors',
  'vidoe': 'video', 'viedo': 'video', 'vidoes': 'videos',
  'custome': 'customer', 'cusotmer': 'customer',
  'storie': 'story', 'storeis': 'stories',
  'graduaton': 'graduation', 'gradution': 'graduation',
  'colege': 'college', 'collge': 'college',
  'caree': 'career', 'carreer': 'career',
  'contnet': 'content', 'conent': 'content',
  'comparsion': 'comparison', 'comparision': 'comparison',
  // Content type synonyms (normalize to database terms)
  'one pager': '1-pager', 'one-pager': '1-pager', 'onepager': '1-pager', '1 pager': '1-pager',
  'fact sheet': '1-pager', 'factsheet': '1-pager', 'datasheet': '1-pager', 'data sheet': '1-pager',
  'sell sheet': '1-pager', 'flyer': '1-pager', 'flier': '1-pager', 'brochure': '1-pager',
  'case study': 'customer story', 'casestudy': 'customer story', 'success story': 'customer story',
  'testimonial': 'customer story', 'costumer story': 'customer story',
  'whitepaper': 'ebook', 'white paper': 'ebook', 'e-book': 'ebook', 'guide': 'ebook',
  'webiner': 'webinar', 'webniar': 'webinar',
};

// State name to abbreviation mapping for direct detection
const STATE_NAME_TO_ABBREV = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
  'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
  'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
  'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
  'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
  'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
  'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
  'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
  'wisconsin': 'WI', 'wyoming': 'WY'
};

/**
 * Apply autocorrect to a query string
 * @param {string} query - The raw query
 * @returns {string} - Corrected query
 */
function autocorrectQuery(query) {
  if (!query) return query;

  let corrected = query.toLowerCase();
  let hasCorrections = false;

  // Check each word against dictionary
  for (const [misspelling, correction] of Object.entries(AUTOCORRECT_DICTIONARY)) {
    const regex = new RegExp(`\\b${misspelling}\\b`, 'gi');
    if (regex.test(corrected)) {
      corrected = corrected.replace(regex, correction);
      hasCorrections = true;
    }
  }

  if (hasCorrections) {
    console.log(`[Autocorrect] "${query}" -> "${corrected}"`);
  }

  return corrected;
}

/**
 * Detect if query contains a US state name and return the abbreviation
 * @param {string} query - The query string
 * @returns {string|null} - State abbreviation or null
 */
function detectStateInQuery(query) {
  if (!query) return null;
  const queryLower = query.toLowerCase().trim();

  // Check for exact state name match or state name in query
  for (const [stateName, abbrev] of Object.entries(STATE_NAME_TO_ABBREV)) {
    if (queryLower === stateName || queryLower.includes(stateName)) {
      console.log(`[State Detection] Found "${stateName}" -> ${abbrev}`);
      return abbrev;
    }
  }

  // Check for state abbreviations (2 uppercase letters)
  const abbrevMatch = query.match(/\b([A-Z]{2})\b/);
  if (abbrevMatch && Object.values(STATE_NAME_TO_ABBREV).includes(abbrevMatch[1])) {
    console.log(`[State Detection] Found abbreviation ${abbrevMatch[1]}`);
    return abbrevMatch[1];
  }

  return null;
}

/**
 * SchooLinks Context for AI Prompts
 * Full baseline context from SL_baseline_context_AIAgents.md
 * This comprehensive context enables the AI to answer specific questions about SchooLinks
 */
const SCHOOLINKS_CONTEXT = `
## SCHOOLINKS OVERVIEW
SchooLinks is a **single college & career readiness (CCR) platform** designed to support **every student** (college-bound, career-bound, undecided) while giving **staff actionable workflows + real-time reporting** to meet district initiatives and **state/federal compliance** requirements.

**Core Positioning:**
- Student-first design that drives adoption
- Digitizing student activities (not "scanning paper into a portal")
- Live, actionable data that lets counselors intervene (not just "report later")
- Industry partner engagement for real work-based learning (WBL)
- Service model for all stakeholders (staff, students, families)

**Core belief:** "College & Career to us are equally important… SchooLinks doesn't want your students on multiple platforms—everything should be in 1 place."

## TARGET PERSONAS

### 1. Counselors / Counseling Teams (primary power users)
**What they want:**
- Track where every student is in the journey (not guess / chase paper)
- Simplify workflows: meetings, notes, tasks, messaging, recommendations
- Increase completion (FAFSA, milestones, applications), reduce manual follow-up

**SchooLinks strengths for counselors:**
- Centralized "case file" style student management (meetings + notes)
- Bulk + individual messaging, including mobile-text support
- Action items oriented experience (what needs doing now)

### 2. District Admins / Cabinet (ultimate buyers, low-login users)
**What they care about:**
- "Is every student going to graduate?"
- State indicator performance / accountability
- Budget + systems consolidation; fewer vendors
- Board-ready reporting

**Persona note:** Ultimate buyer type, often "never logs in"; uses data for board/cabinet 1–2x/year

### 3. State Leaders / Accountability / CCR Offices
**What they care about:**
- Indicator definitions, accuracy, auditability
- Consistent reporting across districts
- Legislative changes year-to-year, minimized district burden

**SchooLinks strengths:**
- KRI approach: centralized data sources, proactive calculation, drill-down + workflow connection
- KRI is designed "out of box" but can be updated for legislative changes

### 4. CTE / WBL Leaders (Directors of CTE, WBL Coordinators, Career Coaches)
**What they care about:**
- Scaling WBL (internships, apprenticeships, clinicals, shadowing, hours)
- Partner management + placements + documentation
- Compliance reporting + quality outcomes

**SchooLinks strengths:**
- Program management: applications → matching → placement → documentation tracking
- Multiple opportunity creation paths (staff sourced, student sourced/BYOP, partner self-signup network)
- Timesheet tracking + forms + evaluations inside placements

## PACKAGES / LICENSING
SchooLinks is framed as a core platform plus add-ons:
- Core Platform (6–12) + Annual Support
- State CCR Data Suite (includes KRI + PLP)
- Pulse (student wellness/SEL)
- Graduation & Academic Success (includes Course Planner + PLP)
- Work Based Learning (includes Program Mgmt + Experience Tracking)
- Elementary (K–5) includes Pulse

## KEY FEATURES

### Actionable Staff Dashboard
- Starts with Action Items so every role knows what needs doing immediately
- Includes "Student To-Dos" completion views and ability to send reminders

### Scope & Sequence Builder (change management baked in)
- Digital scope & sequence powers student To-Dos (plan, assign, deadlines)
- Helps transition from existing platforms by centralizing "what/when" for staff, students, families

### Student Lists, Filters, and "Case File" Workflow
- Dynamic filters (target by major, college interest, clusters, etc.) to message/work groups
- Meetings, notes, To-Dos in one place; replaces scattered binders + point tools
- Meeting scheduler positioned as replacing Calendly/Google Forms for student scheduling

### Personalized Plans (PLP / ILP / ECAP / PGP / HSBP…)
- Digital workflow for creating state-mandated student plans
- Auto-completes as students do activities in SchooLinks (goals, assessments, resume/portfolio, etc.)
- Includes collaboration via comments and electronic signatures to involve guardians
- State naming examples: PGP (TX), ILP (IL), HSBP (WA), ECAP (AZ)

### Course Planner (4-year planner / course registration support)
- Part of Graduation & Academic Success add-on
- Forward planning across multiple years; aligns to graduation requirements by cohort
- Supports pathway + endorsement selection
- **Important differentiator:** NOT a course scheduling tool (SIS schedules students into sections)
- Replaces "choice slips" / manual planning with real-time error checking and counselor approval queues

### College Application Management (CAM) + Transcript Center
- Preloaded application requirements; "snapshot of status for every application"
- Integrates with Common App for sending documents
- Includes student + parent visibility; "gives students ownership"

### Events & Engagement
- Unifies events (college rep visits + career fairs + FAFSA workshops) in one place

### Student Learning Content
- Broken down CCR concepts into bite size pieces; modules include a video + activities

### Career Center, Goals, and Exploration
- Goals are visible to counselors, parents/guardians, and students
- "Game of Life" positioned as holistic life planning with budgeting consequences

### Key Readiness Indicators (KRI)
**What KRI solves:**
- Centralizes data sources and workflows (reduces spreadsheet cobbling)
- Enables proactive calculation (not "reporting season only")
- Student-level drill down in real time
- "Democratizes" access beyond accountability office (counselors can act)

**How it works (data sources):**
- Three sources: SchooLinks activity-generated data, SIS data, and uploads like SAT/ACT
- Upload frequency varies by data type; implementation managers guide this

### Alumni Tracking & Outcomes
- Maintains district-community relationships
- Integrates with National Student Clearinghouse to know outcomes after graduation

### Work-Based Learning (WBL): Experience Tracking + Program Management
**Program Management:**
- Digitizes connecting candidates (students) with sponsors (partners)
- Tracks full lifecycle: application → matching → placement → documentation
- Supports staff-managed and student-sourced placements

### Industry Partner Engagement
- Bring local and national industry partners directly into the platform

### Student Wellness / SEL + Pulse
- CASEL competency aligned lesson plans and check-in data
- SEL assessment features

### Digital Badging
- Positioned alongside experience tracking/events

## PROBLEMS WE SOLVE

### "We're drowning in spreadsheets + disconnected systems"
**Pain:** Staff manually compile readiness/indicator data across sources; time-consuming and inaccurate
**Solution:** KRI centralizes sources and connects data inside daily workflow, not in a separate dashboard silo

### "We only find out students missed requirements when it's too late"
**Pain:** Manual tracking happens only in reporting season (reactive)
**Solution:** Proactive calculation + drill-down views + ability to intervene earlier

### "Students don't engage with our CCR tool"
**Pain:** Traditional tools can require training and feel disconnected from student UX
**Solution:** "Student First Design Drives Organic Adoption" and gamified system (Game of Life)

### "Course planning is messy (choice slips, errors, high counselor load)"
**Pain:** Students plan in scheduling system or paper choice slips → error-prone and time-consuming
**Solution:** Course Planner: step-by-step guide + real-time error checks + counselor review queues

### "WBL is impossible to scale and document"
**Pain:** Matching students + employers and tracking documentation is complex
**Solution:** Program management + placements lifecycle + documentation + timesheets in one place

## PROOF POINTS & CUSTOMER STORIES

**Key proof patterns (reference when relevant):**
- Bow High School's switch from Naviance with measurable outcomes
- Elko County WBL growth (key proof point for WBL)
- Solon / Richland for replacing spreadsheets for graduation tracking
- Implementation success is positioned as part of the product value

## COMMON USE CASES

### Switching from Naviance (or "Naviance alternative")
**Typical district reality:** Tool sprawl + low student engagement + staff admin burden + compliance pressure
**Agent framing:** "SchooLinks has everything that Naviance, Xello, MajorClarity have—plus reduces clicks and unifies graduation tracking, industry partners/WBL, alumni, wellness, and CCR activities in one platform."
**Migration narrative:** Use scope & sequence to drive change management and student To-Dos

### FAFSA Completion
**What matters:** Reaching the right students/families at the right time; events (FAFSA nights), reminders, tracking
**SchooLinks assets:** Unified event scheduling, messaging capabilities (bulk/individual + mobile text), Game of Life for financial planning

### Work-based Learning (WBL) Scale + Compliance
**Common needs:** Partner onboarding, placements, documentation, hours, evaluations, reporting
**Solution:** Program management + multiple opportunity sourcing paths + placement documentation + timesheets

### Graduation Tracking / "Are students on track?"
**Common needs:** Graduation requirements by cohort, drill-down, earlier intervention
**Solution:** Course Planner aligns multi-year plan to graduation requirements; KRI turns lagging indicators into leading predictors

### State-mandated Plans (ILP/PLP/ECAP/HSBP/PGP)
**Common needs:** Ensure every student completes required activities; guardian signatures; annual review
**Solution:** PLP stores mandated activities + captures guardian signatures + auto-completes from student activity work

## COMPETITOR LANDSCAPE

### Direct CCR Competitors
- **PowerSchool Naviance** - Legacy market leader; "Naviance alternative" is a common search theme
- **Xello** (formerly Career Cruising) - Strong career exploration, weaker college tools
- **MajorClarity (by Paper)** - One-stop CCR positioning
- **YouScience Brightpath** - Career/aptitude focused
- **Kuder Navigator** - Career assessment focused

### SchooLinks Key Differentiators (why we win)
1. **Student-first design → organic adoption** (minimal training; modern UX; gamified elements)
2. **Digitize student activities** (digitally native workflows; real-time captured data)
3. **Live, actionable data for compliance** (democratize access; drill down by student/building/activity)
4. **Industry partner engagement** inside the platform
5. **Everything in one place** (graduation tracking + WBL + alumni + wellness + CCR activities)

### SchooLinks vs Xello Differentiators
- SchooLinks emphasizes staff effectiveness and "one-of-a-kind reports," including KRI + PLP to meet mandates
- Xello "does not offer any customization for reporting to meet these needs"
- SchooLinks includes guardian plan signatures and broader staff tools
- For college readiness: SchooLinks highlights scattergrams (historical app data), FAFSA tracking, and richer college research tooling

### SchooLinks vs Naviance Differentiators
- Modern UX vs dated interface
- Transparent pricing vs complex pricing
- Responsive support vs poor support reputation
- Unified platform vs need for additional tools

## MESSAGING BLOCKS (high-performing phrasing)

**One-liner:**
"SchooLinks is the all-in-one college & career readiness platform that helps districts support every student—college, career, or undecided—while giving staff real-time workflows and reporting to meet graduation and state accountability goals."

**If asked "How are you different?"**
- "We're designed for student adoption and staff action, not just reporting."
- "We digitize your CCR activities so data is captured automatically and reported in real time."
- "KRI turns compliance reporting into proactive intervention, with real-time drill-down."
- "We unify college + career events (FAFSA nights, career fairs, rep visits) so it's equitable for every student."

**If asked "Can we replace multiple vendors?"**
Explicitly argues against multiple platforms and lists: graduation tracking, industry partners, internships/placements with documentation, alumni tracking, and wellness in one platform.

## FEATURE-TO-INITIATIVE MAPPING
- **Increase Graduation** → Course Planner, KRI, Personalized Plan
- **Increase State Aligned Indicator Performance** → KRI (everyone)
- **Increase Career Awareness / Exposure** → Career Center, opportunities, event scheduler, industry partner tools
- **Increase SEL** → CASEL-aligned lessons, check-ins, meeting tools, assessments

## SAFETY RAILS (don't overclaim)
- Do NOT claim exact district counts, adoption numbers, or precise competitor feature gaps unless provided in sourced documents
- If asked about competitors beyond Naviance/Xello/MajorClarity/YouScience/Kuder, respond at a high level (category-based)
- For state-specific requirements: "SchooLinks supports state-mandated plan structures and can be updated for legislative changes"
`;

/**
 * Use OpenAI to understand and enhance the search query
 */
export async function convertNaturalLanguageToQuery(naturalQuery, filters = {}) {
  // Apply autocorrect before AI processing
  const correctedQuery = autocorrectQuery(naturalQuery);

  // Apply terminology mappings to detect content types, competitors, etc.
  let terminologyDetected = { content_type: [], competitor: [], persona: [], topic: [], feature: [] };
  try {
    const terminology = await getTerminologyModule();
    terminologyDetected = await terminology.applyTerminologyMappings(correctedQuery);
    if (terminologyDetected.content_type?.length > 0) {
      console.log('[NLP] Terminology detected types:', terminologyDetected.content_type);
    }
  } catch (err) {
    console.warn('[NLP] Terminology mapping failed, continuing with AI:', err.message);
  }

  try {
    // Use serverless proxy to keep API key secure
    const response = await fetch('/api/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a search query parser for SchooLinks marketing content database. Your job is to understand what the user is looking for and extract structured search parameters WITH INTELLIGENT PRIORITIZATION.

${SCHOOLINKS_CONTEXT}

DATABASE COLUMNS:
- type: Content type (Customer Story, Video, Blog, Ebook, Webinar, 1-Pager, Press Release, Award, Landing Page, Asset, Video Clip)
- title: Content title
- summary: Description of the content
- platform: Where it's hosted (Website, YouTube, LinkedIn, HubSpot, etc.)
- state: US State abbreviation (TX, CA, NY, FL, etc.) or "National"
- tags: Keywords like "college, career, counselors, students, work-based learning"
- auto_tags: AI-generated tags including competitor mentions, personas, topics

SEARCH PRIORITY REASONING (CRITICAL):
You must analyze the query and determine which terms are MOST IMPORTANT for finding relevant content.

Priority Hierarchy (highest to lowest):
1. COMPETITOR NAMES (Xello, Naviance, Scoir, MajorClarity, PowerSchool, Kuder, YouScience) - When mentioned, this is almost always the PRIMARY intent. User wants content about/against that competitor.
2. STATE/TERRITORY - Geographic targeting is specific and important
3. PERSONA (counselors, admins, CTE coordinators, students, parents) - Who the content is for
4. TOPIC (FAFSA, WBL, graduation, career exploration) - What the content covers
5. GENERIC MODIFIERS (comparison, vs, SchooLinks, overview, guide) - These describe FORMAT, not content focus. Often can be ignored.

IMPORTANT: When a competitor is mentioned, terms like "comparison", "vs", "SchooLinks" are ASSUMED - they add no search value because ALL competitor content is comparative. Only include the competitor name and any state/persona/topic filters.

Return a JSON object:
{
  "types": ["array of content types to filter by"],
  "states": ["array of US state ABBREVIATIONS like TX, CA, VA, NY - ALWAYS include if a state is mentioned or implied, even with typos"],
  "searchTerms": ["PRIORITIZED keywords - most important first, exclude noise words"],
  "correctedQuery": "the query with spelling fixed",
  "understanding": "brief explanation of what you understood",
  "primaryIntent": "competitor|state|persona|topic|general - what is the user primarily looking for?"
}

CRITICAL - STATE DETECTION:
- ALWAYS detect US states even with misspellings: "virginai" → states: ["VA"], "texs" → states: ["TX"], "flordia" → states: ["FL"]
- Return the 2-letter abbreviation: Virginia=VA, Texas=TX, California=CA, New York=NY, Ohio=OH, Florida=FL, Illinois=IL, etc.
- When a state is detected, primaryIntent should be "state" unless a competitor is also mentioned

CONTENT TYPE DISAMBIGUATION:
- "Video" = full-length videos, tutorials, demos, recorded webinars
- "Video Clip" = short clips, snippets, teasers, highlights (use ONLY when user says "clip", "clips", "short video", or "snippet")
- IMPORTANT: If query contains "clip" or "clips", use ONLY "Video Clip" type, NOT "Video"

CRITICAL CONTENT TYPE TERM MAPPINGS (user terms → database types):
- "one pager", "one-pager", "1 pager", "pager", "fact sheet", "factsheet", "datasheet", "flyer", "brochure", "sell sheet" → type: "1-Pager"
- "case study", "success story", "testimonial" → type: "Customer Story"
- "whitepaper", "white paper", "e-book", "guide" → type: "Ebook"
- "tutorial", "demo" → type: "Video"
- "clip", "clips", "snippet", "short video", "teaser" → type: "Video Clip"

Examples with content type mapping:
- "one pager about counselors" → types: ["1-Pager"], searchTerms: ["counselors"], primaryIntent: "topic"
- "fact sheets for texas" → types: ["1-Pager"], states: ["TX"], searchTerms: [], primaryIntent: "state"
- "case studies from california" → types: ["Customer Story"], states: ["CA"], searchTerms: [], primaryIntent: "state"
- "whitepaper about FAFSA" → types: ["Ebook"], searchTerms: ["fafsa"], primaryIntent: "topic"

Examples:
- "Xello vs SchooLinks comparisons" → searchTerms: ["xello"], primaryIntent: "competitor" (NOT ["xello", "comparison", "schoolinks"])
- "Naviance content for Texas counselors" → searchTerms: ["naviance", "counselors"], states: ["TX"], primaryIntent: "competitor"
- "Xello" → searchTerms: ["xello"], primaryIntent: "competitor"
- "customer stories from Texas" → types: ["Customer Story"], states: ["TX"], searchTerms: [], primaryIntent: "state"
- "videos about college" → types: ["Video"], searchTerms: ["college"], primaryIntent: "topic"
- "content for counselors in california" → states: ["CA"], searchTerms: ["counselors"], primaryIntent: "persona"
- "FAFSA completion resources" → searchTerms: ["fafsa", "completion"], primaryIntent: "topic"
- "virginia content" → states: ["VA"], searchTerms: [], primaryIntent: "state" (NOT searchTerms: ["virginia", "content"])
- "virginai content" → states: ["VA"], searchTerms: [], primaryIntent: "state" (detect even with typo!)
- "texs videos" → states: ["TX"], types: ["Video"], searchTerms: [], primaryIntent: "state"
- "content from ohio" → states: ["OH"], searchTerms: [], primaryIntent: "state"
- "flordia customer stories" → states: ["FL"], types: ["Customer Story"], searchTerms: [], primaryIntent: "state"
- "new york customer stories" → types: ["Customer Story"], states: ["NY"], searchTerms: [], primaryIntent: "state"
- "califronia content" → states: ["CA"], searchTerms: [], primaryIntent: "state"

IMPORTANT: When primaryIntent is "state", do NOT include state names or generic words like "content", "stuff", "resources" in searchTerms. The state filter handles the geographic targeting.`
          },
          {
            role: 'user',
            content: `Parse this search query: "${correctedQuery}"`
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

      // FALLBACK: If AI didn't detect a state, try direct detection from query
      let detectedStates = parsed.states || [];
      let primaryIntent = parsed.primaryIntent || 'general';

      if (detectedStates.length === 0) {
        const directState = detectStateInQuery(correctedQuery);
        if (directState) {
          console.log(`[Fallback] AI missed state, using direct detection: ${directState}`);
          detectedStates = [directState];
          primaryIntent = 'state';
        }
      }

      // Merge with user-selected filters AND terminology-detected types
      // Terminology takes priority for content type detection
      const terminologyTypes = terminologyDetected.content_type || [];
      const allTypes = [
        ...terminologyTypes,           // Terminology-detected types first (most reliable)
        ...(parsed.types || []),       // AI-detected types
        ...(filters.types || [])       // User-selected filters
      ];

      return {
        types: [...new Set(allTypes)],
        states: [...new Set([...detectedStates, ...(filters.states || [])])],
        searchTerms: parsed.searchTerms || [],
        correctedQuery: parsed.correctedQuery || correctedQuery,
        understanding: parsed.understanding || '',
        primaryIntent: primaryIntent,
        terminologyDetected // Include for debugging/logging
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
  if (!results || results.length === 0) {
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
    // Use serverless proxy to keep API key secure
    // Model: STANDARD for balanced quality/cost in ranking
    const response = await fetch('/api/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: getModelForQuery('ranker'),
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
 * Detect if a query is asking a question about SchooLinks (vs searching for content)
 * @param {string} query - The user's query
 * @returns {object} - { isQuestion: boolean, questionType: string }
 */
function detectQueryType(query) {
  const q = query.toLowerCase().trim();

  // Question indicators
  const questionStarters = ['what', 'how', 'why', 'when', 'where', 'who', 'which', 'can', 'does', 'is', 'are', 'do', 'will', 'would', 'could', 'should', 'tell me', 'explain', 'describe'];
  const questionEndings = ['?'];
  const questionPhrases = [
    'how does', 'what is', 'what are', 'how do', 'can schoolinks', 'does schoolinks',
    'tell me about', 'explain', 'what makes', 'how is', 'why does', 'why is',
    'difference between', 'compared to', 'vs', 'versus', 'better than',
    'how can i', 'how do i', 'what should', 'which is better'
  ];

  // SchooLinks-specific question topics
  const schoolinksTopics = [
    'kri', 'key readiness', 'course planner', 'plp', 'ilp', 'ecap', 'hsbp', 'pgp',
    'wbl', 'work-based learning', 'fafsa', 'graduation tracking', 'scope and sequence',
    'scope & sequence', 'game of life', 'pulse', 'sel', 'alumni tracking', 'digital badging',
    'cam', 'college application', 'transcript center', 'industry partner'
  ];

  const startsWithQuestion = questionStarters.some(starter => q.startsWith(starter + ' '));
  const endsWithQuestion = questionEndings.some(ending => q.endsWith(ending));
  const hasQuestionPhrase = questionPhrases.some(phrase => q.includes(phrase));
  const hasSchoolinksTopicQuestion = schoolinksTopics.some(topic => q.includes(topic));

  // Determine question type
  let questionType = 'search'; // default to search

  if (endsWithQuestion || startsWithQuestion || hasQuestionPhrase) {
    if (hasSchoolinksTopicQuestion || q.includes('schoolinks')) {
      questionType = 'product_question'; // Asking about SchooLinks features/capabilities
    } else if (q.includes('naviance') || q.includes('xello') || q.includes('majorclarity')) {
      questionType = 'competitor_question'; // Asking about competitors
    } else {
      questionType = 'general_question'; // General question that might need product knowledge
    }
  }

  return {
    isQuestion: questionType !== 'search',
    questionType
  };
}

/**
 * Process a conversational query with history context
 * Supports multi-turn dialog for the chat interface
 * Enhanced to detect and answer SchooLinks-specific questions
 * @param {string} userMessage - The user's message
 * @param {Array} conversationHistory - Previous messages in the conversation
 * @param {Array} availableContent - Content items from the database
 * @param {Object} options - Additional options
 * @param {string} options.stateContext - State-specific context to include in the prompt
 * @param {Array} options.detectedStates - State codes detected in the query
 * @param {number} options.maxContentForContext - Max content items to include
 */
export async function processConversationalQuery(
  userMessage,
  conversationHistory,
  availableContent,
  options = {}
) {
  // Handle backwards compatibility: if options is a number, treat it as maxContentForContext
  const {
    stateContext = null,
    customerStoryContext = null,
    detectedStates = [],
    maxContentForContext = 100
  } = typeof options === 'number' ? { maxContentForContext: options } : options;


  // Detect if this is a question about SchooLinks vs a content search
  const queryType = detectQueryType(userMessage);
  console.log('[Chat] Query type detection:', queryType);
  if (detectedStates.length > 0) {
    console.log('[Chat] State context provided for:', detectedStates);
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

  // Build different system prompts based on query type
  const questionSystemPrompt = queryType.isQuestion ? `
**IMPORTANT: The user is asking a QUESTION about SchooLinks (not searching for content).**
Query type: ${queryType.questionType}

YOUR PRIMARY TASK: Answer the question directly and thoroughly using your SchooLinks knowledge.
- Provide a detailed, informative answer based on the SCHOOLINKS CONTEXT above
- Use specific feature names, persona benefits, and use cases from the context
- Be conversational but thorough - aim for 3-5 sentences minimum for substantive questions
- If the question is about competitors, explain how SchooLinks differentiates
- After answering, you may recommend 2-3 relevant content pieces that support your answer

For product questions: Focus on explaining features, benefits, and how things work
For competitor questions: Explain SchooLinks advantages and differentiators
For general questions: Use your SchooLinks knowledge to provide helpful context
` : '';

  // Build state-specific context section if available
  // Include quick-reference hints for detected states
  let stateContextSection = '';
  if (detectedStates.length > 0) {
    const stateHints = detectedStates
      .filter(s => STATE_CONTEXT_HINTS[s])
      .map(s => STATE_CONTEXT_HINTS[s])
      .join('\n');

    stateContextSection = `

## STATE-SPECIFIC CONTEXT FOR ${detectedStates.join(', ')}
**CRITICAL: The user is asking about ${detectedStates.join(' or ')}. You MUST use the state-specific terminology below.**

### State Terminology (PLP and KRI names for this state):
${stateHints || 'General state CCR requirements apply.'}

${stateContext ? `### Detailed State Context:\n${stateContext}` : ''}

**TERMINOLOGY RULES (mandatory):**
- When the user asks about "PLP", "personalized learning plan", or equivalent — answer using the state's specific PLP name shown above (e.g., ECAP for AZ, HSBP for WA, PGP for TX, CCMR for TX KRI).
- When the user asks about "KRI" or "readiness indicators" — answer using the state's specific KRI name shown above.
- NEVER give a generic PLP/KRI answer when a specific state is in scope. Always lead with the state-specific term and then explain what it means.
- Example: For Arizona + "what is the PLP?" → answer should start "In Arizona, the state-mandated plan is called the ECAP (Education and Career Action Plan)..."

---
`;
  }

  // Build customer story evidence section when stories are available
  let customerStorySection = '';
  if (customerStoryContext && customerStoryContext.length > 0) {
    // Use 3000 chars so the "Related Video Clips" section (at end of content) is included
    const storiesText = customerStoryContext
      .map(cs => `### ${cs.title}\n${(cs.content || '').substring(0, 3000)}`)
      .join('\n\n---\n\n');

    // Extract named related assets from the "Related Video Clips & Supporting Assets" sections.
    // These are confirmed district-cluster assets that must all be recommended individually.
    const clusterAssets = [];
    customerStoryContext.forEach(cs => {
      const content = cs.content || '';
      const relatedMatch = content.match(/## Related Video Clips[\s\S]*?\n([\s\S]*?)(?=\n##|$)/);
      if (relatedMatch) {
        relatedMatch[1].split('\n').forEach(line => {
          const titleMatch = line.match(/"([^"]+)"/);
          if (titleMatch) clusterAssets.push(titleMatch[1]);
        });
      }
    });

    const clusterInstruction = clusterAssets.length > 0
      ? `\n**DISTRICT ASSET CLUSTER — RECOMMEND EVERY ONE:**\nThe following assets are confirmed to exist in the database for this district. Include each as a separate recommendation card — do NOT skip any:\n${clusterAssets.map(t => `- "${t}"`).join('\n')}\n`
      : '';

    customerStorySection = `

## CUSTOMER STORY EVIDENCE
Use these real customer stories when the user asks for proof points, quotes, or district examples.

${storiesText}
${clusterInstruction}
**INSTRUCTIONS:**
- Surface specific quotes and metrics from the evidence above. Always cite the district name. Do not fabricate.
- LEAD recommendations with the main customer story landing page, then list EVERY asset from the DISTRICT ASSET CLUSTER above as individual cards. These are all part of the same story — a rep needs the whole toolkit.
- After the district cluster, add supporting generic content (1-pagers, ebooks, landing pages) relevant to the topics discussed.
- Do NOT recommend content from other states when the user asked about a specific state.

---
`;
  }

  // Load terminology context for vocabulary mapping
  let terminologyContext = '';
  try {
    const terminology = await getTerminologyModule();
    terminologyContext = await terminology.getTerminologyPromptContext();
    console.log('[Chat] Loaded terminology context for AI prompt');
  } catch (err) {
    console.warn('[Chat] Failed to load terminology context:', err.message);
  }

  // Determine which AI model to use based on query complexity
  const queryComplexity = detectQueryComplexity(userMessage);
  const selectedModel = getModelForQuery('chat', userMessage);
  console.log(`[Chat] Using model: ${selectedModel} for query: "${userMessage.substring(0, 50)}..."`);

  // Track response time for QA logging
  const startTime = Date.now();

  // Store metadata for logging (will log with response after AI call)
  const logMetadata = {
    detectedStates,
    queryType: queryType.questionType,
    sessionId: `session-${Date.now()}`, // Simple session ID
  };

  // Build conversation messages for OpenAI
  const messages = [
    {
      role: 'system',
      content: `You are an intelligent content assistant for SchooLinks marketing team. You help users find the most relevant marketing content AND answer questions about SchooLinks products and features.

${SCHOOLINKS_CONTEXT}
${terminologyContext ? `\n${terminologyContext}\n` : ''}
${stateContextSection}
${customerStorySection}
${questionSystemPrompt}
AVAILABLE CONTENT IN DATABASE:
${contentSummary}

YOUR RESPONSE FORMAT (MUST BE VALID JSON):
{
  "quick_answer": "A concise 1-2 sentence summary directly answering the user's query. Get to the point immediately.",
  "key_points": [
    "First important takeaway or SchooLinks advantage",
    "Second key point with specific detail",
    "Third relevant insight (include 3-5 points total)"
  ],
  "recommendations": [
    { "title": "EXACT title from available content", "type": "Content Type", "reason": "Brief explanation" }
  ],
  "follow_up_questions": ["Actionable search prompt 1", "Actionable search prompt 2", "Actionable search prompt 3"]
}

CRITICAL REQUIREMENTS - READ CAREFULLY:
1. You MUST respond with valid JSON containing ALL required fields
2. "quick_answer" - REQUIRED: A punchy 1-2 sentence summary. No fluff, get straight to the answer.
3. "key_points" - REQUIRED: 3-5 bullet points highlighting the most important insights. Be specific and actionable.
4. "recommendations" - REQUIRED: NEVER empty if content is available. Include 3-8 relevant items. NEVER list the same title more than once — each title must be unique across all recommendations.
5. "follow_up_questions" - REQUIRED: 3 actionable search prompts the user might want to explore next.

**DUAL MODE OPERATION:**
1. QUESTION MODE: When the user asks a question (what, how, why, etc.):
   - quick_answer: Direct answer to their question
   - key_points: Key facts, features, or differentiators
   - recommendations: Supporting content that elaborates
   - follow_up_questions: Related topics to explore

2. SEARCH MODE: When the user wants to find content:
   - quick_answer: What you found and how many results
   - key_points: Why these recommendations are relevant
   - recommendations: ALL matching content (aim for 8-12)
   - follow_up_questions: Ways to refine or expand the search

**RECOMMENDATION RULES (MANDATORY - NEVER SKIP):**
- EVERY RESPONSE MUST include recommendations from the available content above
- For questions: Include 3-6 content pieces that support or elaborate on your answer
- For searches: Include ALL relevant content (aim for 8-12 recommendations)
- DO NOT artificially limit recommendations - if 12 items are relevant, show all 12
- For competitor searches: show ALL content for that competitor
- Match recommendations to the user's specific intent
- An empty array [] is ONLY acceptable if the AVAILABLE CONTENT IN DATABASE section above is completely empty
- VARIETY: Include different content types (videos, ebooks, customer stories, landing pages) when available
- For customer story + state queries: ALWAYS recommend the customer story PLUS supporting assets (video clips, ebooks, webinars, blog posts) from the same state or covering the same topics — a sales rep needs a full toolkit, not just one asset
- LOOK at the content list above and pick items that relate to the query

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
   - When user asks for content from a specific state, PRIORITIZE that state's content
   - If recommending content from OTHER states, you MUST clearly indicate this
   - NEVER imply different-state content is from the requested state
   - If no content exists for requested state, say: "We don't have [STATE] content yet..."

10. PRODUCT QUESTIONS - NEW:
   - When asked "What is KRI?" or "How does Course Planner work?" - ANSWER THE QUESTION FIRST
   - Use your SchooLinks knowledge context to provide accurate, detailed answers
   - Then recommend content that demonstrates or explains the feature further`
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
    // Use serverless proxy to keep API key secure
    // Model is dynamically selected based on query complexity
    const response = await fetch('/api/openai', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: selectedModel,
        messages,
        temperature: 0.4,
        max_tokens: 2500  // Increased to allow for more recommendations
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

      let recommendations = parsed.recommendations || [];

      // ALWAYS extract titles mentioned in bold from prose response
      // This fixes the mismatch where AI puts right content in prose but wrong content in recommendations array
      const boldTitleMatches = (parsed.response || content).match(/\*\*"?([^"*]+)"?\*\*/g) || [];
      const extractedTitles = boldTitleMatches.map(m => m.replace(/\*\*/g, '').replace(/"/g, '').trim());

      console.log('[Chat] AI returned recommendations:', recommendations.length);
      console.log('[Chat] Titles mentioned in prose:', extractedTitles.length, extractedTitles);

      // Match extracted titles against available content using fuzzy matching
      const normalizeForMatch = (str) => (str || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');

      const proseMatchedContent = [];
      for (const extractedTitle of extractedTitles) {
        const titleNorm = normalizeForMatch(extractedTitle);
        if (titleNorm.length < 8) continue; // Skip short matches

        const matchedItem = availableContent.find(item => {
          const itemTitleNorm = normalizeForMatch(item.title);
          return itemTitleNorm === titleNorm ||
                 itemTitleNorm.includes(titleNorm) ||
                 titleNorm.includes(itemTitleNorm);
        });

        if (matchedItem && !proseMatchedContent.some(r => r.title === matchedItem.title)) {
          proseMatchedContent.push({
            title: matchedItem.title,
            reason: 'Recommended in response'
          });
        }
      }

      // PRIORITY: Use prose-extracted titles if we found any matches
      // This ensures cards match what AI mentioned in the response text
      if (proseMatchedContent.length > 0) {
        console.log('[Chat] Using prose-extracted titles as recommendations:', proseMatchedContent.length);
        recommendations = proseMatchedContent;
      } else if (recommendations.length === 0 && availableContent.length > 0) {
        // Fallback: no prose titles AND no AI recommendations - use top content
        console.log('[Chat] No recommendations found - using top available content');
        recommendations = availableContent.slice(0, 5).map(item => ({
          title: item.title,
          reason: `Relevant ${item.type} for your query`
        }));
      }

      console.log('[Chat] Final recommendations:', recommendations);

      // Clean up the response text - remove the inline content recommendations section
      // since we're showing them as cards instead (avoids duplication)
      let cleanResponse = parsed.response || content;

      // Remove sections that list content recommendations inline
      // Pattern: "I recommend the following content:" followed by bold titles
      cleanResponse = cleanResponse.replace(/(?:For (?:more|further) insights?,? |Here are some |I recommend the following content(?:\s*pieces)?:?\s*)\n*(?:\*\*"?[^*]+?"?\*\*[^\n]*\n*)+/gi, '');

      // Remove orphaned "For more insights" or "I recommend" lead-ins that got partially cleaned
      cleanResponse = cleanResponse.replace(/(?:For (?:more|further) insights?,?\s*|I recommend the following(?:\s*content)?:?\s*)$/gim, '');

      // Remove lines that are just bold titles with descriptions (recommendation lists)
      cleanResponse = cleanResponse.replace(/^\s*\*\*"?[^*]+?"?\*\*\s*[-–—]\s*[^\n]+$/gm, '');

      // Clean up multiple newlines left behind
      cleanResponse = cleanResponse.replace(/\n{3,}/g, '\n\n').trim();

      // Normalize AI response keys (AI sometimes returns quickanswer instead of quick_answer)
      const quickAnswer = parsed.quick_answer || parsed.quickanswer || parsed.quickAnswer || null;
      const keyPoints = parsed.key_points || parsed.keypoints || parsed.keyPoints || [];
      const followUps = parsed.follow_up_questions || parsed.followup_questions || parsed.followupquestions || parsed.followUpQuestions || [];

      const result = {
        // New structured format fields
        quick_answer: quickAnswer,
        key_points: keyPoints,
        recommendations: recommendations,
        follow_up_questions: followUps,
        // Legacy fields for backward compatibility
        response: cleanResponse,
        followUpQuestions: followUps,
        aiContent: content // Store raw for context continuity
      };

      // Log complete interaction for QA (async, non-blocking)
      const responseTime = Date.now() - startTime;
      logPromptForAnalysis(userMessage, queryComplexity, selectedModel, logMetadata, result, responseTime);

      return result;
    }

    // Fallback if JSON parsing fails - use raw response
    // Try to add content as recommendations anyway
    const fallbackRecs = availableContent.slice(0, 5).map(item => ({
      title: item.title,
      type: item.type,
      reason: `Relevant ${item.type}`
    }));

    return {
      // Fallback: no structured data available
      quick_answer: null,
      key_points: [],
      response: content,
      recommendations: fallbackRecs,
      follow_up_questions: [],
      followUpQuestions: [],
      aiContent: content
    };

  } catch (error) {
    console.error('Conversational query error:', error);
    return {
      quick_answer: null,
      key_points: [],
      response: "I encountered an error processing your request. Please try again or use the search bar.",
      recommendations: [],
      follow_up_questions: [],
      followUpQuestions: []
    };
  }
}

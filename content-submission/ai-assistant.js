/**
 * AI Content Submission Assistant
 * Features: Voice input, URL content extraction, OpenAI parsing
 */

// ============================================
// FORM FIELD CONFIGURATION
// ============================================

const FORM_FIELDS = {
  type: {
    options: ['Blog', 'Video', 'Video Clip', 'Customer Story', '1-Pager',
              'Ebook', 'Webinar', 'Press Release', 'Award', 'Landing Page', 'Asset'],
    required: true
  },
  title: { required: true },
  live_link: { required: true, type: 'url' },
  ungated_link: { required: false, type: 'url' },
  platform: {
    options: ['Website', 'YouTube', 'LinkedIn', 'HubSpot', 'Email', 'Social Media', 'Other'],
    required: true
  },
  state: {
    options: ['', 'National', 'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
              'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI',
              'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY', 'NC', 'ND',
              'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA',
              'WA', 'WV', 'WI', 'WY'],
    required: false
  },
  summary: { required: true },
  tags: { required: false }
};

const SYSTEM_PROMPT = `You are a marketing content submission assistant for SchooLinks, an education technology company focused on college and career readiness.

## ABOUT SCHOOLINKS
SchooLinks is a unified college & career readiness (CCR) platform designed to support every student (college-bound, career-bound, undecided) while giving staff actionable workflows and real-time reporting.

KEY FEATURES (use these in tags when mentioned):
- KRI (Key Readiness Indicators) - centralized compliance tracking with drill-down views
- PLP (Personalized Learning Plans) - state-mandated plans (also called ILP, ECAP, HSBP, PGP)
- Course Planner - 4-year academic planning with error checking
- CAM (College Application Management) - application tracking + transcript center
- WBL (Work-Based Learning) - internship/apprenticeship program management + timesheets
- Pulse - student wellness/SEL with CASEL-aligned content
- Game of Life - financial literacy simulation

TARGET PERSONAS: Counselors, District Admins, CTE/WBL Leaders, State Accountability Offices

KEY COMPETITORS: PowerSchool Naviance, Xello, MajorClarity, YouScience Brightpath, Kuder Navigator

Your job is to parse content descriptions and URLs to extract structured form data.

CONTENT TYPES (choose exactly one):
Blog, Video, Video Clip, Customer Story, 1-Pager, Ebook, Webinar, Press Release, Award, Landing Page, Asset

PLATFORMS (choose exactly one):
Website, YouTube, LinkedIn, HubSpot, Email, Social Media, Other

STATES:
National (for nationwide content) or US state abbreviations: TX, CA, NY, FL, IL, PA, OH, GA, NC, MI, NJ, VA, WA, AZ, MA, TN, IN, MO, MD, WI, CO, MN, SC, AL, LA, KY, OR, OK, CT, UT, NV

RULES:
1. Extract ALL fields you can identify
2. YOUTUBE VIDEO CATEGORIZATION (CRITICAL):
   - YouTube Shorts (youtube.com/shorts/) = type "Video Clip"
   - Regular YouTube videos = type "Video"
   - Always set platform to "YouTube" for any YouTube URL
3. For YouTube videos, use the ACTUAL video title from YouTube (provided in YouTube Title field)
4. YOUTUBE SUMMARY GENERATION (in order of priority):
   - If YouTube Description is provided, use it for the summary
   - If no description but transcript is provided, generate summary from transcript content
   - If neither available, create a brief factual summary from the title only
   - NEVER make up details not present in the provided content
5. If YouTube Description or transcript is provided, analyze it to:
   - Extract relevant TAGS (topics, themes, keywords from the actual content)
   - Identify STATE/REGION if any state, city, or district is mentioned
6. HUBSPOT URL HANDLING (CRITICAL):
   - Any URL containing "hubspot" = platform "HubSpot"
   - HubSpot PDF URLs (.pdf in hubspot URL):
     - Type should be "1-Pager" OR "Ebook" based on content analysis
     - Brief/focused on one topic/single page = "1-Pager"
     - Comprehensive guide/multiple sections = "Ebook"
   - ONLY extract tags from ACTUAL PDF content - do NOT use generic education tags
   - If no meaningful tags can be extracted from content, use minimal or empty tags
7. If given a schoolinks.com URL, set platform to "Website"
8. For URLs, the live_link should be the public-facing URL
9. Default state to "National" unless a specific state/district is mentioned
10. Clean up titles - proper capitalization, make them engaging
11. Infer content type from context (case study = Customer Story, whitepaper = Ebook, etc.)
12. Always spell the brand name as "SchooLinks" (capital S and L, no space)

TAGGING GUIDELINES (CRITICAL):
- DO NOT include "SchooLinks" or brand variations as tags (redundant - all content is SchooLinks)
- DO NOT include state names or abbreviations as tags (captured in state field)
- DO NOT include content type as tags (captured in type field)
- DO NOT include generic terms like "education", "K-12", "students", "schools"
- DO include specific features when mentioned: KRI, PLP, WBL, Course Planner, CAM, Pulse
- DO include personas when addressed: counselors, administrators, CTE coordinators
- DO include specific topics: FAFSA, graduation tracking, career exploration, internships
- DO include competitor names ONLY if content specifically discusses them
- DO include state-specific legislation references: HB 773, CCMR, ACP, ICAP, etc.
- Aim for 4-8 specific, meaningful tags based on ACTUAL content

STATE DETECTION (CRITICAL - Do not default to National if a district is mentioned):
- Look for state names (Texas, California, New York, Illinois, etc.)
- Look for major cities (Austin, Houston, Los Angeles, Chicago, Atlanta, Crystal Lake, etc.)
- Look for school district names - these ALWAYS indicate a specific state:
  * "District 155" or "Community High School District 155" = IL (Crystal Lake, Illinois)
  * "Austin ISD", "Houston ISD", "Dallas ISD" = TX
  * "LAUSD", "San Diego Unified" = CA
  * "Chicago Public Schools" = IL
  * "NYC DOE", "Buffalo Public" = NY
  * "Miami-Dade", "Broward", "Hillsborough" = FL
  * "Bow High School" = NH
  * "Clark County" = NV
- If a numbered district is mentioned (e.g., "District 155"), research or infer the state
- NEVER default to "National" if ANY district, city, or school name is mentioned

SUMMARY GENERATION (for Customer Stories especially):
- Generate COMPREHENSIVE summaries (3-5 sentences minimum)
- Include specific details: district name, student count, outcomes achieved
- Mention specific SchooLinks features used (KRI, WBL, PLP, etc.)
- Include quantifiable results if mentioned (%, numbers, improvements)
- Capture the "story" - what problem was solved, what was the journey
- Example: "Community High School District 155 in Crystal Lake, Illinois partnered with SchooLinks to scale their work-based learning program. The district implemented SchooLinks' WBL module to manage internship placements, track student hours, and connect with local industry partners. Since implementation, they've increased student WBL participation by X% and streamlined coordinator workflows."

Return ONLY valid JSON in this exact format:
{
  "fields": {
    "type": { "value": "Customer Story", "confidence": 0.95 },
    "title": { "value": "How Austin ISD Transformed College Readiness with KRI", "confidence": 0.9 },
    "live_link": { "value": "https://...", "confidence": 1.0 },
    "ungated_link": { "value": null, "confidence": 0.8 },
    "platform": { "value": "Website", "confidence": 0.85 },
    "state": { "value": "TX", "confidence": 0.9 },
    "summary": { "value": "Discover how Austin ISD partnered with SchooLinks to...", "confidence": 0.8 },
    "tags": { "value": "KRI, CCMR, counselors, graduation tracking, FAFSA completion", "confidence": 0.75 }
  },
  "missingFields": [],
  "clarificationNeeded": null
}`;

// ============================================
// STATE
// ============================================

let isListening = false;
let recognition = null;
let parsedData = null;

// ============================================
// DOM ELEMENTS
// ============================================

const elements = {};

function initElements() {
  elements.chatMessages = document.getElementById('chat-messages');
  elements.aiInput = document.getElementById('ai-input');
  elements.aiFileInput = document.getElementById('ai-file');
  elements.voiceBtn = document.getElementById('voice-btn');
  elements.parseBtn = document.getElementById('parse-btn');
  elements.parseText = document.getElementById('parse-text');
  elements.parseLoading = document.getElementById('parse-loading');
  elements.previewSection = document.getElementById('preview-section');
  elements.previewFields = document.getElementById('preview-fields');
  elements.applyBtn = document.getElementById('apply-fields');
  elements.clearBtn = document.getElementById('clear-preview');
}

// ============================================
// VOICE INPUT (Web Speech API)
// ============================================

function initVoiceRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    if (elements.voiceBtn) {
      elements.voiceBtn.style.display = 'none';
    }
    console.log('Speech recognition not supported');
    return;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onstart = () => {
    isListening = true;
    elements.voiceBtn.classList.add('listening');
  };

  recognition.onend = () => {
    isListening = false;
    elements.voiceBtn.classList.remove('listening');
  };

  recognition.onresult = (event) => {
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      }
    }

    if (finalTranscript) {
      elements.aiInput.value += (elements.aiInput.value ? ' ' : '') + finalTranscript;
    }
  };

  recognition.onerror = (event) => {
    console.error('Speech error:', event.error);
    isListening = false;
    elements.voiceBtn.classList.remove('listening');

    if (event.error === 'not-allowed') {
      addMessage('assistant', 'Microphone access denied. Please enable it in browser settings.');
    }
  };
}

function toggleVoice() {
  if (!recognition) {
    addMessage('assistant', 'Voice input requires Chrome or Edge browser.');
    return;
  }

  if (isListening) {
    recognition.stop();
  } else {
    // Track voice input started in Heap
    if (window.heap) {
      heap.track('AI Voice Input Started');
    }
    recognition.start();
    addMessage('assistant', '🎤 Listening... Speak now.');
  }
}

// ============================================
// CHAT MESSAGES
// ============================================

function addMessage(role, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `chat-message ${role}`;
  messageDiv.innerHTML = `<div class="message-content">${escapeHtml(content)}</div>`;
  elements.chatMessages.appendChild(messageDiv);
  elements.chatMessages.scrollTop = elements.chatMessages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ============================================
// URL DETECTION & CONTENT EXTRACTION
// ============================================

function extractUrls(text) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.match(urlRegex) || [];
}

function getUrlType(url) {
  const lowerUrl = url.toLowerCase();

  if (lowerUrl.includes('youtube.com/shorts/')) {
    return 'youtube-short';
  }
  if (lowerUrl.includes('youtube.com') || lowerUrl.includes('youtu.be')) {
    return 'youtube';
  }
  if (lowerUrl.includes('vimeo.com')) {
    return 'vimeo';
  }
  // Check HubSpot PDF first (before generic PDF check)
  if (lowerUrl.includes('hubspot') && lowerUrl.includes('.pdf')) {
    return 'hubspot-pdf';
  }
  if (lowerUrl.includes('hubspot')) {
    return 'hubspot';
  }
  if (lowerUrl.includes('.pdf')) {
    return 'pdf';
  }
  if (lowerUrl.includes('schoolinks.com')) {
    return 'website';
  }
  return 'webpage';
}

function isYouTubeShort(url) {
  return url.toLowerCase().includes('youtube.com/shorts/');
}

function extractYouTubeId(url) {
  const patterns = [
    /youtube\.com\/shorts\/([^&\s?]+)/,
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\s?]+)/,
    /youtube\.com\/v\/([^&\s?]+)/
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function normalizeBrandName(text) {
  if (!text) return text;
  return text
    .replace(/\bschool\s*links\b/gi, 'SchooLinks')
    .replace(/\bschoo\s*links\b/gi, 'SchooLinks')
    .replace(/\bschoolinks\b/gi, 'SchooLinks')
    .replace(/\bscholinks\b/gi, 'SchooLinks');
}

/**
 * Normalize and deduplicate tags
 * - Removes brand name (SchooLinks) - redundant since all content is SchooLinks
 * - Removes state names/abbreviations - captured in state field
 * - Removes content types - captured in type field
 * - Removes generic education terms
 * - Deduplicates and normalizes case
 */
function normalizeAndDeduplicateTags(tagsString, detectedState, detectedType) {
  if (!tagsString) return '';

  let tags = tagsString.split(/[,;]/).map(t => t.trim().toLowerCase()).filter(Boolean);

  const excludeTerms = new Set([
    // Brand (redundant - all content is SchooLinks)
    'schoolinks', 'schooLinks', 'school links', 'sl',
    // State abbreviations (captured in state field)
    'al', 'ak', 'az', 'ar', 'ca', 'co', 'ct', 'de', 'fl', 'ga', 'hi', 'id', 'il', 'in',
    'ia', 'ks', 'ky', 'la', 'me', 'md', 'ma', 'mi', 'mn', 'ms', 'mo', 'mt', 'ne', 'nv',
    'nh', 'nj', 'nm', 'ny', 'nc', 'nd', 'oh', 'ok', 'or', 'pa', 'ri', 'sc', 'sd', 'tn',
    'tx', 'ut', 'vt', 'va', 'wa', 'wv', 'wi', 'wy', 'national',
    // Common state names
    'texas', 'california', 'florida', 'new york', 'ohio', 'illinois', 'pennsylvania',
    'georgia', 'michigan', 'north carolina', 'colorado', 'arizona', 'washington',
    // Content types (captured in type field)
    'blog', 'video', 'video clip', 'customer story', '1-pager', 'ebook', 'e-book',
    'webinar', 'press release', 'award', 'landing page', 'asset', 'one pager', 'one-pager',
    // Generic education terms (too broad to be useful)
    'education', 'edtech', 'k-12', 'k12', 'students', 'schools', 'learning',
    'student success', 'student empowerment', 'school district'
  ]);

  // Add detected state and type to exclusions
  if (detectedState) {
    excludeTerms.add(detectedState.toLowerCase());
  }
  if (detectedType) {
    excludeTerms.add(detectedType.toLowerCase());
  }

  // Filter, deduplicate, and normalize
  const seen = new Set();
  const normalized = [];

  for (const tag of tags) {
    const key = tag.replace(/[^a-z0-9\s]/g, '').trim();
    if (key.length >= 2 && !excludeTerms.has(key) && !seen.has(key)) {
      seen.add(key);
      // Capitalize first letter of each word
      const displayTag = tag.split(' ').map(w =>
        w.charAt(0).toUpperCase() + w.slice(1)
      ).join(' ');
      normalized.push(displayTag);
    }
  }

  // Limit to 8 most relevant tags
  return normalized.slice(0, 8).join(', ');
}

function truncateText(text, maxChars) {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}...`;
}

async function fetchYouTubeMetadata(url) {
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl);
    if (!response.ok) return null;
    return await response.json();
  } catch (error) {
    console.warn('YouTube metadata fetch failed:', error);
    return null;
  }
}

async function fetchYouTubeDescription() {
  // YouTube descriptions cannot be fetched reliably from browser due to CORS
  // The AI will use transcript or title to generate summaries instead
  return null;
}

async function fetchYouTubeTranscript(videoId) {
  try {
    const trackListUrl = `https://video.google.com/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
    const listResponse = await fetch(trackListUrl);
    if (!listResponse.ok) return null;
    const listText = await listResponse.text();

    const xml = new DOMParser().parseFromString(listText, 'text/xml');
    const tracks = Array.from(xml.getElementsByTagName('track')).map((track) => ({
      lang: track.getAttribute('lang_code') || '',
      name: track.getAttribute('name') || '',
      kind: track.getAttribute('kind') || ''
    }));

    if (tracks.length === 0) return null;

    const preferred =
      tracks.find((t) => t.lang.startsWith('en') && t.kind !== 'asr') ||
      tracks.find((t) => t.lang.startsWith('en')) ||
      tracks[0];

    const params = new URLSearchParams({
      v: videoId,
      fmt: 'json3',
      lang: preferred.lang
    });
    if (preferred.name) params.set('name', preferred.name);

    const transcriptUrl = `https://video.google.com/timedtext?${params.toString()}`;
    const response = await fetch(transcriptUrl);
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.events) return null;

    const transcript = data.events
      .map((event) => (event.segs || []).map((seg) => seg.utf8).join(''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    return transcript || null;
  } catch (error) {
    console.warn('YouTube transcript fetch failed:', error);
    return null;
  }
}

async function extractPdfText(url) {
  if (!window.pdfjsLib) {
    console.warn('PDF.js not available');
    return null;
  }

  try {
    const loadingTask = window.pdfjsLib.getDocument({ url });
    const pdf = await loadingTask.promise;
    const pageTexts = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(' ');
      if (pageText) pageTexts.push(pageText);
    }

    return pageTexts.join(' ').replace(/\s+/g, ' ').trim();
  } catch (error) {
    console.warn('PDF extraction failed:', error);
    return null;
  }
}

async function extractPdfTextFromFile(file) {
  if (!window.pdfjsLib) {
    console.warn('PDF.js not available');
    return null;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    const pageTexts = [];

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const pageText = content.items.map((item) => item.str).join(' ');
      if (pageText) pageTexts.push(pageText);
    }

    const combined = pageTexts.join(' ').replace(/\s+/g, ' ').trim();
    if (combined.length < 50) {
      throw new Error('No selectable text found. This PDF may be scanned.');
    }

    return combined;
  } catch (error) {
    console.warn('PDF file extraction failed:', error);
    throw error;
  }
}

async function ocrPdfFile(file, maxPages = 3) {
  if (!window.pdfjsLib || !window.Tesseract) {
    throw new Error('OCR dependencies not available');
  }

  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  const pagesToProcess = Math.min(pdf.numPages, maxPages);
  const pageTexts = [];

  for (let pageNum = 1; pageNum <= pagesToProcess; pageNum += 1) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.5 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({ canvasContext: context, viewport }).promise;

    const { data } = await window.Tesseract.recognize(canvas, 'eng', {
      logger: (message) => {
        if (message.status === 'recognizing text') {
          elements.parseLoading.classList.remove('hidden');
        }
      }
    });

    if (data?.text) {
      pageTexts.push(data.text);
    }
  }

  const combined = pageTexts.join(' ').replace(/\s+/g, ' ').trim();
  if (!combined) {
    throw new Error('OCR did not return any text');
  }

  return combined;
}

/**
 * Fetch and extract text content from a webpage
 * Uses CORS proxies since browser can't fetch cross-origin directly
 */
async function fetchWebpageContent(url) {
  try {
    // List of CORS proxies to try (browsers block direct cross-origin requests)
    const corsProxies = [
      (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
      (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
      (u) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(u)}`,
    ];

    let html = null;

    // Try each proxy until one works
    for (const proxyFn of corsProxies) {
      try {
        const proxyUrl = proxyFn(url);
        console.log('Trying CORS proxy for webpage...');

        const response = await fetch(proxyUrl, {
          headers: { 'Accept': 'text/html,application/xhtml+xml,*/*' }
        });

        if (response.ok) {
          const text = await response.text();
          if (text && text.length > 500 && text.includes('<')) {
            html = text;
            console.log('Successfully fetched webpage via CORS proxy');
            break;
          }
        }
      } catch (proxyError) {
        console.warn('CORS proxy failed, trying next...', proxyError.message);
        continue;
      }
    }

    if (!html) {
      console.warn('All CORS proxies failed for:', url);
      return null;
    }

    // Parse HTML and extract meaningful content
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // Remove script, style, nav, footer, header elements
    const removeSelectors = ['script', 'style', 'nav', 'footer', 'header', 'noscript', 'iframe', 'svg'];
    removeSelectors.forEach(selector => {
      doc.querySelectorAll(selector).forEach(el => el.remove());
    });

    // Try to find main content areas (common patterns)
    const contentSelectors = [
      'article',
      'main',
      '[role="main"]',
      '.content',
      '.post-content',
      '.entry-content',
      '.article-content',
      '.page-content',
      '#content',
      '.resource-content',
      '.case-study-content'
    ];

    let contentText = '';

    // First try to get structured content
    for (const selector of contentSelectors) {
      const element = doc.querySelector(selector);
      if (element) {
        contentText = element.textContent;
        break;
      }
    }

    // Fallback to body if no main content found
    if (!contentText || contentText.length < 100) {
      contentText = doc.body?.textContent || '';
    }

    // Clean up the text
    contentText = contentText
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, '\n')
      .trim();

    // Extract meta description if available
    const metaDesc = doc.querySelector('meta[name="description"]')?.content || '';
    const ogDesc = doc.querySelector('meta[property="og:description"]')?.content || '';
    const pageTitle = doc.querySelector('title')?.textContent || '';

    // Combine metadata with content
    let result = '';
    if (pageTitle) result += `Page Title: ${pageTitle}\n`;
    if (metaDesc) result += `Description: ${metaDesc}\n`;
    if (ogDesc && ogDesc !== metaDesc) result += `OG Description: ${ogDesc}\n`;
    result += `\nPage Content:\n${contentText}`;

    return result;
  } catch (error) {
    console.warn('Webpage content extraction failed:', error);
    return null;
  }
}

// Known school districts and their states for better detection
const DISTRICT_STATE_MAP = {
  // Illinois
  'district 155': 'IL', 'community high school district 155': 'IL', 'd155': 'IL',
  'chicago public': 'IL', 'cps': 'IL',
  // Texas
  'austin isd': 'TX', 'houston isd': 'TX', 'dallas isd': 'TX', 'fort worth isd': 'TX',
  'san antonio isd': 'TX', 'el paso isd': 'TX', 'arlington isd': 'TX',
  'plano isd': 'TX', 'frisco isd': 'TX', 'round rock isd': 'TX',
  // California
  'lausd': 'CA', 'los angeles unified': 'CA', 'san diego unified': 'CA',
  'san francisco unified': 'CA', 'fresno unified': 'CA', 'oakland unified': 'CA',
  // New York
  'nyc doe': 'NY', 'new york city': 'NY', 'buffalo public': 'NY',
  // Florida
  'miami-dade': 'FL', 'broward': 'FL', 'hillsborough': 'FL', 'orange county public': 'FL',
  // Ohio
  'columbus city': 'OH', 'cleveland metropolitan': 'OH', 'cincinnati public': 'OH',
  // Georgia
  'fulton county': 'GA', 'gwinnett county': 'GA', 'dekalb county': 'GA', 'cobb county': 'GA',
  // Michigan
  'detroit public': 'MI', 'grand rapids': 'MI', 'ann arbor': 'MI',
  // Pennsylvania
  'philadelphia': 'PA', 'pittsburgh public': 'PA',
  // Nevada
  'clark county': 'NV', 'washoe county': 'NV',
  // New Hampshire
  'bow': 'NH', 'bow high school': 'NH',
  // Wisconsin
  'milwaukee public': 'WI', 'madison metropolitan': 'WI',
  // Colorado
  'denver public': 'CO', 'jefferson county': 'CO', 'douglas county': 'CO',
  // North Carolina
  'charlotte-mecklenburg': 'NC', 'wake county': 'NC', 'guilford county': 'NC',
  // Arizona
  'mesa public': 'AZ', 'tucson unified': 'AZ', 'phoenix union': 'AZ',
  // Tennessee
  'metro nashville': 'TN', 'shelby county': 'TN', 'knox county': 'TN',
  // Washington
  'seattle public': 'WA', 'tacoma public': 'WA', 'spokane public': 'WA',
  // Indiana
  'indianapolis public': 'IN', 'fort wayne': 'IN',
  // Missouri
  'st. louis public': 'MO', 'kansas city': 'MO',
  // Maryland
  'montgomery county': 'MD', 'prince george\'s county': 'MD', 'baltimore': 'MD',
  // Virginia
  'fairfax county': 'VA', 'virginia beach': 'VA', 'loudoun county': 'VA',
  // Massachusetts
  'boston public': 'MA', 'springfield': 'MA', 'worcester': 'MA',
  // Kentucky
  'jefferson county': 'KY', 'fayette county': 'KY',
  // South Carolina
  'greenville county': 'SC', 'charleston county': 'SC',
  // Alabama
  'mobile county': 'AL', 'jefferson county': 'AL',
  // Louisiana
  'east baton rouge': 'LA', 'jefferson parish': 'LA', 'orleans parish': 'LA',
  // Oklahoma
  'oklahoma city': 'OK', 'tulsa public': 'OK',
  // Utah
  'granite': 'UT', 'davis': 'UT', 'jordan': 'UT', 'alpine': 'UT', 'canyons': 'UT',
  // Minnesota
  'minneapolis public': 'MN', 'st. paul public': 'MN', 'anoka-hennepin': 'MN',
  // Iowa
  'des moines': 'IA', 'cedar rapids': 'IA',
  // Nebraska
  'omaha public': 'NE', 'lincoln public': 'NE',
  // Kansas
  'wichita': 'KS', 'olathe': 'KS', 'shawnee mission': 'KS',
  // New Mexico
  'albuquerque public': 'NM',
  // Oregon
  'portland public': 'OR', 'salem-keizer': 'OR',
  // Connecticut
  'hartford public': 'CT', 'new haven': 'CT', 'bridgeport': 'CT',
  // Arkansas
  'little rock': 'AR', 'pulaski county': 'AR',
  // Mississippi
  'jackson public': 'MS',
  // West Virginia
  'kanawha county': 'WV',
};

/**
 * Try to detect state from text content using district names
 */
function detectStateFromContent(text) {
  if (!text) return null;
  const lowerText = text.toLowerCase();

  for (const [district, state] of Object.entries(DISTRICT_STATE_MAP)) {
    if (lowerText.includes(district)) {
      return state;
    }
  }
  return null;
}

// ============================================
// OPENAI INTEGRATION WITH URL CONTEXT
// ============================================

async function parseWithAI(userInput) {
  const normalizedInput = normalizeBrandName(userInput);

  // Extract URLs and add context
  const urls = extractUrls(normalizedInput);
  let enhancedPrompt = normalizedInput;

  // Add URL type hints to help AI
  if (urls.length > 0) {
    const urlContexts = [];
    const extractedContexts = [];

    for (const url of urls) {
      const type = getUrlType(url);
      const isShort = type === 'youtube-short';
      const isYouTube = type === 'youtube' || type === 'youtube-short';
      const ytId = isYouTube ? extractYouTubeId(url) : null;

      if (isYouTube && ytId) {
        // Fetch metadata, description, and transcript in parallel
        const [metadata, description, transcript] = await Promise.all([
          fetchYouTubeMetadata(url),
          fetchYouTubeDescription(ytId),
          fetchYouTubeTranscript(ytId)
        ]);

        const videoType = isShort ? 'Video Clip' : 'Video';
        const titleInfo = metadata?.title ? `\nYouTube Title: "${metadata.title}"` : '';
        const descInfo = description ? `\nYouTube Description: "${truncateText(description, 2000)}"` : '';

        urlContexts.push(`[YouTube ${isShort ? 'Short' : 'Video'} URL: ${url}. Set type to "${videoType}" and platform to "YouTube".${titleInfo}${descInfo}]`);

        if (transcript) {
          extractedContexts.push(`YouTube transcript (use this for summary generation):\n${truncateText(transcript, 12000)}`);
        }

        // Add explicit instruction for AI to use the YouTube title
        if (metadata?.title) {
          extractedContexts.push(`IMPORTANT: Use the YouTube title "${metadata.title}" as the content title.`);
        }
        if (description) {
          extractedContexts.push(`IMPORTANT: Use the YouTube description to generate the summary. Also analyze it to extract relevant tags and identify any state/region mentioned.`);
        } else if (transcript) {
          extractedContexts.push(`IMPORTANT: No YouTube description was available. Generate the summary based on the transcript content above. Extract tags and state/region from the transcript.`);
        } else {
          extractedContexts.push(`IMPORTANT: No YouTube description or transcript available. Generate a brief summary based on the title. Keep tags minimal and factual based only on the title.`);
        }
      } else if (type === 'hubspot-pdf') {
        urlContexts.push(`[HubSpot PDF URL: ${url}. Set platform to "HubSpot". Type should be "1-Pager" or "Ebook" based on content length/depth.]`);
        const pdfText = await extractPdfText(url);
        if (pdfText) {
          extractedContexts.push(`HubSpot PDF Content (analyze for tags and type):\n${truncateText(pdfText, 12000)}`);
          extractedContexts.push(`IMPORTANT: Extract tags ONLY from the actual content above. Do NOT use generic tags like "college readiness", "student empowerment", or "counselor" unless explicitly mentioned in the PDF.`);
          extractedContexts.push(`IMPORTANT: Determine type based on content - brief/single-topic = "1-Pager", comprehensive guide with multiple sections = "Ebook".`);
        }
      } else if (type === 'hubspot') {
        urlContexts.push(`[HubSpot URL: ${url}. Set platform to "HubSpot".]`);
      } else if (type === 'pdf') {
        urlContexts.push(`[PDF Document URL: ${url} - This might be an Ebook, 1-Pager, or Asset]`);
        const pdfText = await extractPdfText(url);
        if (pdfText) {
          extractedContexts.push(`PDF text (partial): ${truncateText(pdfText, 12000)}`);
        }
      } else if (type === 'website') {
        urlContexts.push(`[Website URL: ${url} - Set platform to "Website". This is likely a Customer Story or resource page.]`);

        // Try to detect state from URL first (works even if fetch fails)
        const urlStateHint = detectStateFromContent(url);

        // Fetch webpage content for richer context
        try {
          if (typeof addMessage === 'function' && elements?.chatMessages) {
            addMessage('assistant', '🔍 Fetching webpage content...');
          }
        } catch (e) { /* ignore UI errors */ }

        const webpageContent = await fetchWebpageContent(url);
        if (webpageContent) {
          extractedContexts.push(`Webpage Content (use this for summary, tags, and state detection):\n${truncateText(webpageContent, 15000)}`);
          extractedContexts.push(`IMPORTANT: Generate a COMPREHENSIVE summary (3-5 sentences) based on the webpage content above. Include specific details like district name, outcomes, metrics, and features used.`);
          extractedContexts.push(`IMPORTANT: Carefully analyze the content to identify the state/region. Look for district names, city names, or state references. Many district names indicate specific states (e.g., "District 155" is in Illinois, "Austin ISD" is in Texas).`);

          // Try to detect state from content
          const detectedState = detectStateFromContent(webpageContent);
          if (detectedState) {
            extractedContexts.push(`STATE HINT: Based on district name detection, this content appears to be from ${detectedState}. Set state to "${detectedState}".`);
          } else if (urlStateHint) {
            extractedContexts.push(`STATE HINT: Based on URL analysis, this content appears to be from ${urlStateHint}. Set state to "${urlStateHint}".`);
          }
        } else {
          // Webpage fetch failed - provide hints from URL
          extractedContexts.push(`IMPORTANT: Could not fetch webpage content directly. Analyze the URL for context.`);
          if (urlStateHint) {
            extractedContexts.push(`STATE HINT: The URL contains "district-155" which refers to Community High School District 155 in Crystal Lake, Illinois. Set state to "IL".`);
          }
          extractedContexts.push(`URL Analysis: "${url}" - Extract district name, topic, and any other details from the URL path.`);
        }
      } else {
        urlContexts.push(`[URL: ${url}]`);
      }
    }

    enhancedPrompt = `${userInput}\n\nURL Analysis:\n${urlContexts.join('\n')}`;

    if (extractedContexts.length > 0) {
      enhancedPrompt += `\n\nExtracted Content:\n${extractedContexts.join('\n\n')}`;
    }
  }

  // Use serverless proxy to keep API key secure, with local dev fallback
  let response;
  let data;

  const requestBody = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: enhancedPrompt }
    ],
    temperature: 0.3,
    max_tokens: 1500  // Increased for richer summaries
  };

  try {
    response = await fetch('/api/openai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      throw new Error(`API proxy error: ${response.status}`);
    }

    data = await response.json();
  } catch (proxyError) {
    // Fallback to direct OpenAI API for local development
    console.log('Falling back to local dev OpenAI config...');

    if (typeof LOCAL_DEV_CONFIG === 'undefined' || !LOCAL_DEV_CONFIG.openaiKey) {
      throw new Error('OpenAI API unavailable. Set LOCAL_DEV_CONFIG.openaiKey in config.js for local development.');
    }

    response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${LOCAL_DEV_CONFIG.openaiKey}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `OpenAI API error: ${response.status}`);
    }

    data = await response.json();
  }
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No response from AI');
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse AI response');
  }

  const result = JSON.parse(jsonMatch[0]);

  // Normalize and deduplicate tags to remove redundant brand/state/type mentions
  if (result.fields.tags?.value) {
    result.fields.tags.value = normalizeAndDeduplicateTags(
      result.fields.tags.value,
      result.fields.state?.value,
      result.fields.type?.value
    );
  }

  // Auto-fill URL if detected but not in response
  if (urls.length > 0 && (!result.fields.live_link || !result.fields.live_link.value)) {
    result.fields.live_link = { value: urls[0], confidence: 1.0 };
  }

  return result;
}

// ============================================
// FALLBACK PARSING
// ============================================

function fallbackParse(input) {
  const normalizedInput = normalizeBrandName(input);
  const result = {
    fields: {},
    missingFields: [],
    clarificationNeeded: null
  };

  const urls = extractUrls(normalizedInput);

  if (urls.length > 0) {
    result.fields.live_link = { value: urls[0], confidence: 0.9 };
    if (urls.length > 1) {
      result.fields.ungated_link = { value: urls[1], confidence: 0.6 };
    }

    // Detect platform from URL
    const urlType = getUrlType(urls[0]);
    if (urlType === 'youtube-short') {
      result.fields.platform = { value: 'YouTube', confidence: 0.95 };
      result.fields.type = { value: 'Video Clip', confidence: 0.95 };
    } else if (urlType === 'youtube') {
      result.fields.platform = { value: 'YouTube', confidence: 0.95 };
      result.fields.type = { value: 'Video', confidence: 0.9 };
    } else if (urlType === 'hubspot-pdf') {
      result.fields.platform = { value: 'HubSpot', confidence: 0.95 };
      result.fields.type = { value: 'Ebook', confidence: 0.7 }; // Default to Ebook, AI will refine
    } else if (urlType === 'hubspot') {
      result.fields.platform = { value: 'HubSpot', confidence: 0.95 };
    } else if (urlType === 'website') {
      result.fields.platform = { value: 'Website', confidence: 0.8 };
    }
  }

  // Content type detection
  const typeKeywords = {
    'blog': 'Blog', 'article': 'Blog',
    'video': 'Video', 'clip': 'Video Clip',
    'customer story': 'Customer Story', 'case study': 'Customer Story', 'success story': 'Customer Story',
    'ebook': 'Ebook', 'e-book': 'Ebook', 'guide': 'Ebook', 'whitepaper': 'Ebook',
    'webinar': 'Webinar', 'press release': 'Press Release',
    'award': 'Award', 'landing page': 'Landing Page',
    '1 pager': '1-Pager', 'one pager': '1-Pager', 'flyer': '1-Pager'
  };

  const lowerInput = normalizedInput.toLowerCase();
  for (const [keyword, type] of Object.entries(typeKeywords)) {
    if (lowerInput.includes(keyword)) {
      result.fields.type = { value: type, confidence: 0.7 };
      break;
    }
  }

  // State detection
  const stateKeywords = {
    'texas': 'TX', 'austin': 'TX', 'houston': 'TX', 'dallas': 'TX',
    'california': 'CA', 'los angeles': 'CA', 'san francisco': 'CA',
    'new york': 'NY', 'florida': 'FL', 'illinois': 'IL', 'chicago': 'IL',
    'pennsylvania': 'PA', 'ohio': 'OH', 'georgia': 'GA', 'atlanta': 'GA'
  };

  for (const [keyword, state] of Object.entries(stateKeywords)) {
    if (lowerInput.includes(keyword)) {
      result.fields.state = { value: state, confidence: 0.8 };
      break;
    }
  }

  // Extract potential title (first line or first sentence)
  const lines = normalizedInput.split('\n').filter(l => l.trim());
  if (lines.length > 0) {
    const firstLine = lines[0].replace(/(https?:\/\/[^\s]+)/g, '').trim();
    if (firstLine.length > 10 && firstLine.length < 200) {
      result.fields.title = { value: firstLine, confidence: 0.5 };
    }
  }

  // Use remaining text as summary
  const cleanedInput = normalizedInput.replace(/(https?:\/\/[^\s]+)/g, '').trim();
  if (cleanedInput.length > 20) {
    result.fields.summary = { value: cleanedInput.substring(0, 500), confidence: 0.4 };
  }

  return result;
}

// ============================================
// PREVIEW RENDERING
// ============================================

function renderPreview(data) {
  parsedData = data;
  elements.previewFields.innerHTML = '';

  const fieldLabels = {
    type: 'Type',
    title: 'Title',
    live_link: 'Live Link',
    ungated_link: 'Ungated',
    platform: 'Platform',
    state: 'State',
    summary: 'Summary',
    tags: 'Tags'
  };

  for (const [field, config] of Object.entries(FORM_FIELDS)) {
    const fieldData = data.fields[field];
    const value = fieldData?.value || '';
    const confidence = fieldData?.confidence || 0;

    const fieldDiv = document.createElement('div');
    fieldDiv.className = `preview-field ${confidence > 0 && confidence < 0.7 ? 'low-confidence' : ''}`;

    let inputHtml;
    if (config.options) {
      inputHtml = `<select data-field="${field}">
        <option value="">Select...</option>
        ${config.options.filter(opt => opt !== '').map(opt =>
          `<option value="${opt}" ${opt === value ? 'selected' : ''}>${opt}</option>`
        ).join('')}
      </select>`;
    } else if (field === 'summary') {
      inputHtml = `<textarea data-field="${field}" rows="2">${escapeHtml(value || '')}</textarea>`;
    } else {
      inputHtml = `<input type="${config.type || 'text'}" data-field="${field}" value="${escapeHtml(value || '')}">`;
    }

    fieldDiv.innerHTML = `
      <label>${fieldLabels[field]}</label>
      ${inputHtml}
      <span class="confidence-badge">${confidence > 0 ? Math.round(confidence * 100) + '%' : '—'}</span>
    `;
    elements.previewFields.appendChild(fieldDiv);
  }

  if (data.missingFields?.length > 0) {
    const warningDiv = document.createElement('div');
    warningDiv.className = 'preview-warning';
    warningDiv.textContent = `Missing: ${data.missingFields.join(', ')}`;
    elements.previewFields.appendChild(warningDiv);
  }

  elements.previewSection.classList.remove('hidden');
}

// ============================================
// APPLY TO FORM
// ============================================

function applyToForm() {
  // Track apply to form in Heap
  if (window.heap) {
    const typeInput = elements.previewFields.querySelector('[data-field="type"]');
    const platformInput = elements.previewFields.querySelector('[data-field="platform"]');
    heap.track('AI Fields Applied', {
      content_type: typeInput?.value || 'unknown',
      platform: platformInput?.value || 'unknown'
    });
  }

  const previewInputs = elements.previewFields.querySelectorAll('[data-field]');
  let delay = 0;

  previewInputs.forEach((input) => {
    const field = input.dataset.field;
    const formElement = document.getElementById(field);
    const value = input.value;

    if (formElement && value) {
      setTimeout(() => {
        formElement.classList.add('field-filling');
        formElement.value = value;
        formElement.dispatchEvent(new Event('change', { bubbles: true }));
        formElement.dispatchEvent(new Event('input', { bubbles: true }));

        setTimeout(() => {
          formElement.classList.remove('field-filling');
          formElement.classList.add('field-filled');
        }, 300);
      }, delay);
      delay += 100;
    }
  });

  setTimeout(() => {
    addMessage('assistant', '✅ Form filled! Review and submit when ready.');
    elements.previewSection.classList.add('hidden');
    elements.aiInput.value = '';
  }, delay + 200);
}

// ============================================
// MAIN PARSE HANDLER
// ============================================

async function handleParse() {
  const userInput = elements.aiInput.value.trim();

  if (!userInput) {
    addMessage('assistant', 'Please paste a URL or describe the content.');
    return;
  }

  // Detect URLs for user feedback
  const urls = extractUrls(userInput);

  // Track AI analyze in Heap
  if (window.heap) {
    const urlType = urls.length > 0 ? getUrlType(urls[0]) : 'text';
    heap.track('AI Analyze Clicked', {
      input_type: urlType,
      has_url: urls.length > 0,
      is_youtube_short: urlType === 'youtube-short'
    });
  }

  // Show loading
  elements.parseBtn.disabled = true;
  elements.parseText.classList.add('hidden');
  elements.parseLoading.classList.remove('hidden');

  addMessage('user', userInput);
  if (urls.length > 0) {
    const urlType = getUrlType(urls[0]);
    if (urlType === 'youtube-short') {
      addMessage('assistant', '🎬 Analyzing YouTube Short...');
    } else if (urlType === 'youtube') {
      addMessage('assistant', '🎬 Fetching YouTube video details...');
    } else if (urlType === 'hubspot-pdf') {
      addMessage('assistant', '📄 Analyzing HubSpot PDF...');
    } else if (urlType === 'hubspot') {
      addMessage('assistant', '🔗 Analyzing HubSpot content...');
    } else if (urlType === 'pdf') {
      addMessage('assistant', '📄 Extracting PDF text...');
    } else {
      addMessage('assistant', '🔍 Analyzing content...');
    }
  } else {
    addMessage('assistant', '🔍 Processing your description...');
  }

  try {
    let result;

    result = await parseWithAI(userInput);

    // Remove processing message
    const messages = elements.chatMessages.querySelectorAll('.chat-message.assistant');
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.textContent.includes('Analyzing') || lastMsg?.textContent.includes('Processing')) {
      lastMsg.remove();
    }

    addMessage('assistant', '✨ Found the following. Edit if needed, then apply:');
    renderPreview(result);

  } catch (error) {
    console.error('Parse error:', error);

    // Remove processing message
    const messages = elements.chatMessages.querySelectorAll('.chat-message.assistant');
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.textContent.includes('Analyzing') || lastMsg?.textContent.includes('Processing')) {
      lastMsg.remove();
    }

    addMessage('assistant', `⚠️ ${error.message}. Using basic extraction...`);

    try {
      const fallbackResult = fallbackParse(userInput);
      renderPreview(fallbackResult);
    } catch (e) {
      addMessage('assistant', 'Could not extract data. Please fill the form manually.');
    }
  } finally {
    elements.parseBtn.disabled = false;
    elements.parseText.classList.remove('hidden');
    elements.parseLoading.classList.add('hidden');
  }
}

async function handleFileUpload(event) {
  const file = event.target.files?.[0];

  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    addMessage('assistant', 'Please upload a PDF file.');
    event.target.value = '';
    return;
  }
  if (!window.pdfjsLib) {
    addMessage('assistant', 'PDF parsing library failed to load. Please refresh and try again.');
    event.target.value = '';
    return;
  }

  // Track PDF upload in Heap
  if (window.heap) {
    heap.track('AI PDF Uploaded', {
      file_name: file.name,
      file_size_kb: Math.round(file.size / 1024)
    });
  }

  elements.parseBtn.disabled = true;
  elements.aiFileInput.disabled = true;
  elements.parseText.classList.add('hidden');
  elements.parseLoading.classList.remove('hidden');

  addMessage('user', `Uploaded file: ${file.name}`);
  addMessage('assistant', '📄 Extracting PDF text...');

  try {
    const pdfText = await extractPdfTextFromFile(file);
    if (!pdfText) {
      throw new Error('Could not extract PDF text');
    }

    const prompt = `File name: ${file.name}\n\nDocument content:\n${truncateText(pdfText, 12000)}`;
    const result = await parseWithAI(prompt);

    const messages = elements.chatMessages.querySelectorAll('.chat-message.assistant');
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.textContent.includes('Extracting')) {
      lastMsg.remove();
    }

    addMessage('assistant', '✨ Found the following. Edit if needed, then apply:');
    renderPreview(result);
  } catch (error) {
    console.error('File parse error:', error);
    addMessage('assistant', `⚠️ ${error.message}. Trying OCR...`);

    try {
      const ocrText = await ocrPdfFile(file);
      const prompt = `File name: ${file.name}\n\nOCR content:\n${truncateText(ocrText, 12000)}`;
      const result = await parseWithAI(prompt);

      addMessage('assistant', '✨ OCR complete. Edit if needed, then apply:');
      renderPreview(result);
      return;
    } catch (ocrError) {
      console.error('OCR error:', ocrError);
      addMessage('assistant', `⚠️ OCR failed. Using basic extraction...`);
    }

    try {
      const fallbackResult = fallbackParse(file.name);
      renderPreview(fallbackResult);
    } catch (e) {
      addMessage('assistant', 'Could not extract data. Please fill the form manually.');
    }
  } finally {
    elements.parseBtn.disabled = false;
    elements.aiFileInput.disabled = false;
    elements.parseText.classList.remove('hidden');
    elements.parseLoading.classList.add('hidden');
    event.target.value = '';
  }
}

// ============================================
// CLEAR PREVIEW
// ============================================

function clearPreview() {
  parsedData = null;
  elements.previewSection.classList.add('hidden');
  elements.aiInput.value = '';
  addMessage('assistant', 'Cleared. Ready for new content.');
}

// ============================================
// INITIALIZATION
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  initElements();

  if (!elements.chatMessages) {
    console.log('AI Assistant elements not found');
    return;
  }

  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
  }

  initVoiceRecognition();

  // Event listeners
  elements.voiceBtn?.addEventListener('click', toggleVoice);
  elements.parseBtn?.addEventListener('click', handleParse);
  elements.applyBtn?.addEventListener('click', applyToForm);
  elements.clearBtn?.addEventListener('click', clearPreview);
  elements.aiFileInput?.addEventListener('change', handleFileUpload);

  // Enter to submit (Shift+Enter for newline)
  elements.aiInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleParse();
    }
  });

  // Welcome message with animation delay
  setTimeout(() => {
    addMessage('assistant', '👋 Paste a YouTube link, HubSpot URL, or describe your content. I\'ll fill the form for you!');
  }, 500);
});

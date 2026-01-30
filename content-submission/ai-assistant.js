/**
 * AI Content Submission Assistant
 * Features: Voice input, URL content extraction, OpenAI parsing
 */

// ============================================
// FORM FIELD CONFIGURATION
// ============================================

const FORM_FIELDS = {
  type: {
    options: ['Blog', 'Video', 'Video Clip', 'Customer Story', '1 Pager',
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

const SYSTEM_PROMPT = `You are a marketing content submission assistant for SchoolLinks, an education technology company focused on college and career readiness.

Your job is to parse content descriptions and URLs to extract structured form data.

CONTENT TYPES (choose exactly one):
Blog, Video, Video Clip, Customer Story, 1 Pager, Ebook, Webinar, Press Release, Award, Landing Page, Asset

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
     - Type should be "1 Pager" OR "Ebook" based on content analysis
     - Brief/focused on one topic/single page = "1 Pager"
     - Comprehensive guide/multiple sections = "Ebook"
   - ONLY extract tags from ACTUAL PDF content - do NOT use generic education tags
   - If no meaningful tags can be extracted from content, use minimal or empty tags
7. If given a schoolinks.com URL, set platform to "Website"
8. For URLs, the live_link should be the public-facing URL
9. Suggest relevant tags based on ACTUAL content (not generic education tags)
10. Default state to "National" unless a specific state/district is mentioned
11. Clean up titles - proper capitalization, make them engaging
12. Infer content type from context (case study = Customer Story, whitepaper = Ebook, etc.)
13. Always spell the brand name as "SchooLinks" (capital S and L)

STATE DETECTION HINTS:
- Look for state names (Texas, California, New York, etc.)
- Look for major cities (Austin, Houston, Los Angeles, Chicago, Atlanta, etc.)
- Look for school district names (often include city/state: "Austin ISD", "Denver Public Schools")
- Look for state abbreviations in the content

Return ONLY valid JSON in this exact format:
{
  "fields": {
    "type": { "value": "Customer Story", "confidence": 0.95 },
    "title": { "value": "How Austin ISD Transformed College Readiness", "confidence": 0.9 },
    "live_link": { "value": "https://...", "confidence": 1.0 },
    "ungated_link": { "value": null, "confidence": 0.8 },
    "platform": { "value": "Website", "confidence": 0.85 },
    "state": { "value": "TX", "confidence": 0.9 },
    "summary": { "value": "Discover how Austin ISD partnered with SchoolLinks to...", "confidence": 0.8 },
    "tags": { "value": "college readiness, Texas, district success, K-12", "confidence": 0.75 }
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
        urlContexts.push(`[HubSpot PDF URL: ${url}. Set platform to "HubSpot". Type should be "1 Pager" or "Ebook" based on content length/depth.]`);
        const pdfText = await extractPdfText(url);
        if (pdfText) {
          extractedContexts.push(`HubSpot PDF Content (analyze for tags and type):\n${truncateText(pdfText, 12000)}`);
          extractedContexts.push(`IMPORTANT: Extract tags ONLY from the actual content above. Do NOT use generic tags like "college readiness", "student empowerment", or "counselor" unless explicitly mentioned in the PDF.`);
          extractedContexts.push(`IMPORTANT: Determine type based on content - brief/single-topic = "1 Pager", comprehensive guide with multiple sections = "Ebook".`);
        }
      } else if (type === 'hubspot') {
        urlContexts.push(`[HubSpot URL: ${url}. Set platform to "HubSpot".]`);
      } else if (type === 'pdf') {
        urlContexts.push(`[PDF Document URL: ${url} - This might be an Ebook, 1 Pager, or Asset]`);
        const pdfText = await extractPdfText(url);
        if (pdfText) {
          extractedContexts.push(`PDF text (partial): ${truncateText(pdfText, 12000)}`);
        }
      } else if (type === 'website') {
        urlContexts.push(`[Website URL: ${url} - Set platform to "Website"]`);
      } else {
        urlContexts.push(`[URL: ${url}]`);
      }
    }

    enhancedPrompt = `${userInput}\n\nURL Analysis:\n${urlContexts.join('\n')}`;

    if (extractedContexts.length > 0) {
      enhancedPrompt += `\n\nExtracted Content:\n${extractedContexts.join('\n\n')}`;
    }
  }

  // Use serverless proxy to keep API key secure
  const response = await fetch('/api/openai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: enhancedPrompt }
      ],
      temperature: 0.3,
      max_tokens: 1000
    })
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error?.message || `API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;

  if (!content) {
    throw new Error('No response from AI');
  }

  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Could not parse AI response');
  }

  const result = JSON.parse(jsonMatch[0]);

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
    '1 pager': '1 Pager', 'one pager': '1 Pager', 'flyer': '1 Pager'
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

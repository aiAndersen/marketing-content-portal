import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Search, Download, ExternalLink, Loader2, Sparkles, ChevronDown, Brain, ArrowLeft } from 'lucide-react';
import { supabaseClient } from './services/supabase';
import { convertNaturalLanguageToQuery, rankResultsByRelevance, processConversationalQuery } from './services/nlp';
import ChatInterface from './components/ChatInterface';
import ContentFeed from './components/ContentFeed';
import WeeklyGTMReport from './components/WeeklyGTMReport';
import AppHeader from './components/AppHeader';
import Sidebar from './components/Sidebar';
import BottomTabBar from './components/BottomTabBar';
import { useDeviceLayout } from './hooks/useDeviceLayout';
// Lazy load TerminologyAdmin to prevent cascade failures if terminology tables don't exist
const TerminologyAdmin = lazy(() => import('./components/TerminologyAdmin'));
import './App.css';

function App() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stats, setStats] = useState(null);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [selectedStates, setSelectedStates] = useState([]);
  const [error, setError] = useState(null);
  const [aiInsight, setAiInsight] = useState(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [currentSearchConfig, setCurrentSearchConfig] = useState(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isViewAll, setIsViewAll] = useState(false);
  const [viewMode, setViewMode] = useState('chat'); // 'chat' | 'search' | 'gtm'
  const [conversationHistory, setConversationHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [showResultsHint, setShowResultsHint] = useState(false);
  const [isAdminMode, setIsAdminMode] = useState(false);
  const firstRenderRef = useRef(true);
  const resultsRef = useRef(null);

  // Device layout detection (mobile / tablet / desktop / wide)
  const { isMobile, isWide } = useDeviceLayout();

  // Sidebar collapsed state — persisted across sessions
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('sidebarCollapsed') === 'true'
  );

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebarCollapsed', String(next));
      return next;
    });
  };

  // Check URL hash for admin mode
  useEffect(() => {
    const checkAdminMode = () => {
      setIsAdminMode(window.location.hash === '#admin');
    };
    checkAdminMode();
    window.addEventListener('hashchange', checkAdminMode);
    return () => window.removeEventListener('hashchange', checkAdminMode);
  }, []);

  // Keyboard shortcut: Ctrl+Shift+A to toggle admin mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'A') {
        e.preventDefault();
        const newAdminMode = !isAdminMode;
        window.location.hash = newAdminMode ? '#admin' : '';
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAdminMode]);

  const PAGE_SIZE = 100;

  const contentTypes = [
    'Customer Story', 'Video', 'Blog', 'Ebook', 'Webinar',
    '1-Pager', 'Press Release', 'Award', 'Landing Page', 'Asset', 'Video Clip'
  ];

  const usStates = [
    { abbr: 'AL', name: 'Alabama' },
    { abbr: 'AK', name: 'Alaska' },
    { abbr: 'AZ', name: 'Arizona' },
    { abbr: 'AR', name: 'Arkansas' },
    { abbr: 'CA', name: 'California' },
    { abbr: 'CO', name: 'Colorado' },
    { abbr: 'CT', name: 'Connecticut' },
    { abbr: 'DE', name: 'Delaware' },
    { abbr: 'FL', name: 'Florida' },
    { abbr: 'GA', name: 'Georgia' },
    { abbr: 'HI', name: 'Hawaii' },
    { abbr: 'ID', name: 'Idaho' },
    { abbr: 'IL', name: 'Illinois' },
    { abbr: 'IN', name: 'Indiana' },
    { abbr: 'IA', name: 'Iowa' },
    { abbr: 'KS', name: 'Kansas' },
    { abbr: 'KY', name: 'Kentucky' },
    { abbr: 'LA', name: 'Louisiana' },
    { abbr: 'ME', name: 'Maine' },
    { abbr: 'MD', name: 'Maryland' },
    { abbr: 'MA', name: 'Massachusetts' },
    { abbr: 'MI', name: 'Michigan' },
    { abbr: 'MN', name: 'Minnesota' },
    { abbr: 'MS', name: 'Mississippi' },
    { abbr: 'MO', name: 'Missouri' },
    { abbr: 'MT', name: 'Montana' },
    { abbr: 'NE', name: 'Nebraska' },
    { abbr: 'NV', name: 'Nevada' },
    { abbr: 'NH', name: 'New Hampshire' },
    { abbr: 'NJ', name: 'New Jersey' },
    { abbr: 'NM', name: 'New Mexico' },
    { abbr: 'NY', name: 'New York' },
    { abbr: 'NC', name: 'North Carolina' },
    { abbr: 'ND', name: 'North Dakota' },
    { abbr: 'OH', name: 'Ohio' },
    { abbr: 'OK', name: 'Oklahoma' },
    { abbr: 'OR', name: 'Oregon' },
    { abbr: 'PA', name: 'Pennsylvania' },
    { abbr: 'RI', name: 'Rhode Island' },
    { abbr: 'SC', name: 'South Carolina' },
    { abbr: 'SD', name: 'South Dakota' },
    { abbr: 'TN', name: 'Tennessee' },
    { abbr: 'TX', name: 'Texas' },
    { abbr: 'UT', name: 'Utah' },
    { abbr: 'VT', name: 'Vermont' },
    { abbr: 'VA', name: 'Virginia' },
    { abbr: 'WA', name: 'Washington' },
    { abbr: 'WV', name: 'West Virginia' },
    { abbr: 'WI', name: 'Wisconsin' },
    { abbr: 'WY', name: 'Wyoming' }
  ];

  const loadMoreResults = async () => {
    if (!currentSearchConfig || loadingMore || loading || !hasMore) return;
    setLoadingMore(true);

    try {
      const nextPage = currentPage + 1;
      let queryBuilder = supabaseClient.from('marketing_content').select('*');

      if (currentSearchConfig.types.length > 0) {
        queryBuilder = queryBuilder.in('type', currentSearchConfig.types);
      }

      if (currentSearchConfig.states.length > 0) {
        queryBuilder = queryBuilder.in('state', currentSearchConfig.states);
      }

      if (currentSearchConfig.searchTerms.length > 0) {
        const searchConditions = currentSearchConfig.searchTerms.flatMap(term => {
          const t = term.toLowerCase();
          return [
            `title.ilike.%${t}%`,
            `summary.ilike.%${t}%`,
            `platform.ilike.%${t}%`,
            `tags.ilike.%${t}%`,
            `type.ilike.%${t}%`,
            `state.ilike.%${t}%`
          ];
        });
        queryBuilder = queryBuilder.or(searchConditions.join(','));
      } else if (currentSearchConfig.useRawQueryFallback && currentSearchConfig.rawQuery) {
        const searchTerm = currentSearchConfig.rawQuery.toLowerCase();
        queryBuilder = queryBuilder.or(
          `title.ilike.%${searchTerm}%,` +
          `summary.ilike.%${searchTerm}%,` +
          `platform.ilike.%${searchTerm}%,` +
          `tags.ilike.%${searchTerm}%,` +
          `state.ilike.%${searchTerm}%,` +
          `type.ilike.%${searchTerm}%`
        );
      }

      const from = nextPage * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, error } = await queryBuilder
        .order('last_updated', { ascending: false, nullsFirst: false })
        .range(from, to);

      if (error) throw error;

      setResults(prev => [...prev, ...(data || [])]);
      setCurrentPage(nextPage);
      setHasMore((data || []).length === PAGE_SIZE);
    } catch (err) {
      console.error('Load more error:', err);
      setHasMore(false);
    } finally {
      setLoadingMore(false);
    }
  };

  // Load initial stats
  useEffect(() => {
    loadStats();
  }, []);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    if (selectedTypes.length === 0 && selectedStates.length === 0) return;

    handleSearch({ preventDefault: () => {} });
  }, [selectedTypes, selectedStates]);

  useEffect(() => {
    const handleScroll = () => {
      if (loading || loadingMore || !hasMore || !currentSearchConfig) return;
      const nearBottom = window.innerHeight + window.scrollY >= document.body.offsetHeight - 300;
      if (nearBottom) {
        loadMoreResults();
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [loading, loadingMore, hasMore, currentSearchConfig, loadMoreResults]);

  const loadStats = async () => {
    try {
      const { data, error } = await supabaseClient
        .rpc('get_content_stats');

      if (error) throw error;
      setStats(data);
    } catch (err) {
      console.error('Error loading stats:', err);
    }
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setAiInsight(null);
    setFiltersOpen(false);
    setCurrentPage(0);
    setHasMore(false);
    setIsViewAll(false);

    // Track search in Heap
    if (window.heap) {
      window.heap.track('Portal Search', {
        query: query,
        type_filters: selectedTypes.join(',') || 'none',
        state_filters: selectedStates.join(',') || 'none'
      });
    }

    try {
      // Check if this is a filter-only search (no query text, but filters selected)
      const isFilterOnlySearch = !query.trim() && (selectedTypes.length > 0 || selectedStates.length > 0);

      let aiParams = { types: [], states: [], searchTerms: [], understanding: '' };

      if (isFilterOnlySearch) {
        // Skip AI call for filter-only searches - just use the selected filters
        console.log('[Search] Filter-only search:', { types: selectedTypes, states: selectedStates });

        // Build a helpful message about the filters being used
        const filterParts = [];
        if (selectedTypes.length > 0) filterParts.push(`Types: ${selectedTypes.join(', ')}`);
        if (selectedStates.length > 0) filterParts.push(`States: ${selectedStates.join(', ')}`);

        setAiInsight({
          understanding: `Showing content filtered by: ${filterParts.join(' | ')}`,
          types: selectedTypes,
          states: selectedStates,
          searchTerms: []
        });
      } else if (query.trim()) {
        // Use AI to understand the query
        aiParams = await convertNaturalLanguageToQuery(query, {
          types: selectedTypes,
          states: selectedStates
        });

        console.log('AI parsed query:', aiParams);

        // Show AI insight to user
        if (aiParams.understanding) {
          setAiInsight({
            understanding: aiParams.understanding,
            correctedQuery: aiParams.correctedQuery,
            types: aiParams.types,
            states: aiParams.states,
            searchTerms: aiParams.searchTerms
          });
        }
      }

      // Merge AI-detected filters with user-selected filters
      // AI handles spelling correction for state names (e.g., "virginai" -> VA)
      const mergedTypes = [...new Set([...selectedTypes, ...(aiParams.types || [])])];
      const allStates = [...new Set([...selectedStates, ...(aiParams.states || [])])];

      // Validate that AI-detected types are valid content types
      const allTypes = mergedTypes.filter(type => contentTypes.includes(type));
      if (mergedTypes.length !== allTypes.length) {
        console.warn('Invalid content types filtered out:', mergedTypes.filter(t => !contentTypes.includes(t)));
      }

      const searchConfig = {
        types: allTypes,
        states: allStates,
        searchTerms: aiParams.searchTerms || [],
        rawQuery: query.trim(),
        useRawQueryFallback:
          (!aiParams.searchTerms || aiParams.searchTerms.length === 0) &&
          query.trim() &&
          allTypes.length === 0 &&
          allStates.length === 0
      };

      let queryBuilder = supabaseClient.from('marketing_content').select('*');

      // BACKUP: Direct content type detection from query text
      // This ensures type filtering works even if terminology service fails
      const queryLower = query.toLowerCase();
      const directTypeDetection = {
        '1-Pager': ['one pager', 'one-pager', 'onepager', '1 pager', '1-pager', 'pager', 'fact sheet', 'factsheet', 'flyer', 'brochure'],
        'Customer Story': ['case study', 'case-study', 'casestudy', 'customer story', 'success story', 'testimonial'],
        'Ebook': ['ebook', 'e-book', 'whitepaper', 'white paper', 'guide', 'handbook'],
        'Video': ['video', 'tutorial', 'demo'],
        'Video Clip': ['video clip', 'clip', 'clips', 'snippet', 'short video'],
        'Webinar': ['webinar', 'web seminar'],
        'Blog': ['blog', 'article', 'blog post']
      };

      // Database has inconsistent type values - map detected types to ALL possible variations
      const typeVariations = {
        '1-Pager': ['1-Pager', '1 Pager'],  // Some records have hyphen, some have space
        'Video Clip': ['Video Clip', 'VideoClip']
      };

      let backupDetectedTypes = [];
      for (const [contentType, terms] of Object.entries(directTypeDetection)) {
        for (const term of terms) {
          if (queryLower.includes(term)) {
            // Add the detected type AND any variations
            const variations = typeVariations[contentType] || [contentType];
            for (const variant of variations) {
              if (!backupDetectedTypes.includes(variant)) {
                backupDetectedTypes.push(variant);
              }
            }
            console.log(`[Search] Backup detection: "${term}" → ${contentType} (+ variations: ${variations.join(', ')})`);
            break;
          }
        }
      }

      // Merge backup-detected types with AI-detected types, expanding with variations
      let expandedAITypes = [];
      for (const type of allTypes) {
        const variations = typeVariations[type] || [type];
        expandedAITypes.push(...variations);
      }
      const finalTypes = [...new Set([...expandedAITypes, ...backupDetectedTypes])];
      if (backupDetectedTypes.length > 0) {
        console.log('[Search] Final types with variations:', finalTypes);
      }

      // Apply type filters (merge AI + backup + user-selected, with all variations)
      if (finalTypes.length > 0) {
        queryBuilder = queryBuilder.in('type', finalTypes);
      }

      // Apply AI-detected state filters (merge with user-selected)
      if (allStates.length > 0) {
        queryBuilder = queryBuilder.in('state', allStates);
      }

      // Detect if this is a "content type only" search (e.g., "one pager", "case studies")
      // In this case, we should return ALL items of that type, not filter by keywords
      const terminologyTypes = aiParams.terminologyDetected?.content_type || [];
      const allDetectedTypes = [...new Set([...terminologyTypes, ...backupDetectedTypes])];
      const contentTypeTerms = ['pager', 'one-pager', 'onepager', '1-pager', 'case', 'study', 'studies',
        'video', 'clip', 'clips', 'ebook', 'e-book', 'whitepaper', 'webinar', 'blog', 'article',
        'customer', 'story', 'stories', 'testimonial', 'press', 'release', 'award', 'landing', 'page', 'asset',
        'one', 'fact', 'sheet'];

      const isContentTypeOnlySearch = allDetectedTypes.length > 0 &&
        (aiParams.searchTerms || []).every(term =>
          contentTypeTerms.includes(term.toLowerCase()) ||
          allDetectedTypes.some(t => t.toLowerCase().includes(term.toLowerCase()) || term.toLowerCase().includes(t.toLowerCase()))
        );

      if (isContentTypeOnlySearch) {
        console.log('[Search] Content-type-only search detected for:', terminologyTypes, '- skipping keyword filters');
      }

      // Apply comprehensive keyword search across ALL columns (including enriched data)
      // AI has already prioritized search terms and filtered out noise words based on SchooLinks context

      // IMPORTANT: When the primary intent is "state" and we have state filters applied,
      // we ONLY filter by state - don't also search for state names as keywords.
      // This prevents "virginia content" from returning TX content that mentions "virginia" in text.
      const isStateSpecificSearch = aiParams.primaryIntent === 'state' && allStates.length > 0;

      if (isStateSpecificSearch) {
        // State-specific search: ONLY filter by state, don't add keyword conditions
        // The state filter is already applied above via queryBuilder.in('state', allStates)
        console.log('[Search] State-specific search for:', allStates, '- using strict state filter only');

        // If there are additional non-state search terms (like "videos", "counselors"), apply those
        const nonStateTerms = (aiParams.searchTerms || []).filter(term => {
          const t = term.toLowerCase();
          // Filter out state names and generic terms
          const stateNames = ['alabama', 'alaska', 'arizona', 'arkansas', 'california', 'colorado',
            'connecticut', 'delaware', 'florida', 'georgia', 'hawaii', 'idaho', 'illinois', 'indiana',
            'iowa', 'kansas', 'kentucky', 'louisiana', 'maine', 'maryland', 'massachusetts', 'michigan',
            'minnesota', 'mississippi', 'missouri', 'montana', 'nebraska', 'nevada', 'new hampshire',
            'new jersey', 'new mexico', 'new york', 'north carolina', 'north dakota', 'ohio', 'oklahoma',
            'oregon', 'pennsylvania', 'rhode island', 'south carolina', 'south dakota', 'tennessee',
            'texas', 'utah', 'vermont', 'virginia', 'washington', 'west virginia', 'wisconsin', 'wyoming'];
          const genericTerms = ['content', 'stuff', 'things', 'resources', 'materials'];
          return !stateNames.includes(t) && !genericTerms.includes(t);
        });

        if (nonStateTerms.length > 0) {
          console.log('[Search] Additional non-state terms:', nonStateTerms);
          const searchConditions = nonStateTerms.flatMap(term => {
            const t = term.toLowerCase();
            return [
              `title.ilike.%${t}%`,
              `summary.ilike.%${t}%`,
              `enhanced_summary.ilike.%${t}%`,
              `tags.ilike.%${t}%`,
              `auto_tags.ilike.%${t}%`,
              `extracted_text.ilike.%${t}%`
            ];
          });
          queryBuilder = queryBuilder.or(searchConditions.join(','));
        }
      } else if (aiParams.searchTerms && aiParams.searchTerms.length > 0 && !isContentTypeOnlySearch) {
        // Only apply keyword search if NOT a content-type-only search
        console.log('[Search] AI-prioritized terms:', aiParams.searchTerms, 'Intent:', aiParams.primaryIntent || 'general');

        // Build search conditions for each term across all text columns
        const searchConditions = aiParams.searchTerms.flatMap(term => {
          const t = term.toLowerCase();
          return [
            `title.ilike.%${t}%`,
            `summary.ilike.%${t}%`,
            `enhanced_summary.ilike.%${t}%`,
            `platform.ilike.%${t}%`,
            `tags.ilike.%${t}%`,
            `auto_tags.ilike.%${t}%`,
            `extracted_text.ilike.%${t}%`,
            `type.ilike.%${t}%`,
            `state.ilike.%${t}%`
          ];
        });

        queryBuilder = queryBuilder.or(searchConditions.join(','));
      } else if (searchConfig.useRawQueryFallback && !isContentTypeOnlySearch) {
        // Fallback: search all columns with the raw query (including enriched data)
        const searchTerm = query.trim().toLowerCase();
        queryBuilder = queryBuilder.or(
          `title.ilike.%${searchTerm}%,` +
          `summary.ilike.%${searchTerm}%,` +
          `enhanced_summary.ilike.%${searchTerm}%,` +
          `platform.ilike.%${searchTerm}%,` +
          `tags.ilike.%${searchTerm}%,` +
          `auto_tags.ilike.%${searchTerm}%,` +
          `extracted_text.ilike.%${searchTerm}%,` +
          `state.ilike.%${searchTerm}%,` +
          `type.ilike.%${searchTerm}%`
        );
      }

      // Fetch results - use higher limit for content-type-only searches to get all items
      const resultLimit = isContentTypeOnlySearch ? 99 : 49; // 100 or 50 results
      const { data, error } = await queryBuilder
        .order('last_updated', { ascending: false, nullsFirst: false })
        .range(0, resultLimit);

      if (error) throw error;

      // Prioritize HubSpot platform for 1-pager / PDF searches (more current than SL Resources)
      let finalResults = data || [];
      const isOnePagerSearch = finalTypes.includes('1-Pager') || /\b(1.pager|one.pager|pdf)\b/i.test(query);
      if (isOnePagerSearch && finalResults.length > 0) {
        const hubspotItems = finalResults.filter(r => /hubspot/i.test(r.platform || ''));
        const otherItems = finalResults.filter(r => !/hubspot/i.test(r.platform || ''));
        finalResults = [...hubspotItems, ...otherItems];
      }
      let rankingExplanation = null;
      let topMatches = null;

      if (finalResults.length > 0 && query.trim()) {
        const rankingResult = await rankResultsByRelevance(finalResults, query);
        rankingExplanation = rankingResult.explanation;
        topMatches = rankingResult.topMatches;

        // Reorder results: primary recommendations first, then additional resources, then rest
        const primaryRecs = rankingResult.primaryRecommendations || [];
        const additionalRecs = rankingResult.additionalResources || [];
        const rankedResults = rankingResult.rankedResults || [];

        // Build ordered results array
        const orderedResults = [];
        const usedTitles = new Set();

        // 1. Add primary recommendations first (in order)
        for (const rec of primaryRecs) {
          const item = rankedResults.find(r => r.title === rec.title);
          if (item && !usedTitles.has(item.title)) {
            orderedResults.push(item);
            usedTitles.add(item.title);
          }
        }

        // 2. Add additional resources next (in order)
        for (const rec of additionalRecs) {
          const item = rankedResults.find(r => r.title === rec.title);
          if (item && !usedTitles.has(item.title)) {
            orderedResults.push(item);
            usedTitles.add(item.title);
          }
        }

        // 3. Add remaining ranked results, but sort them by keyword relevance first
        // Identify "primary" search terms (competitors) vs generic terms
        const searchTermsLower = (aiParams.searchTerms || []).map(t => t.toLowerCase());
        const primaryTerms = searchTermsLower.filter(t =>
          ['xello', 'naviance', 'scoir', 'majorcla', 'powersch', 'levelall'].some(c => t.includes(c))
        );
        const remainingItems = rankedResults.filter(item => !usedTitles.has(item.title));

        // Score remaining items - give MUCH higher weight to primary term matches
        const scoredRemaining = remainingItems.map(item => {
          let score = 0;
          const titleLower = (item.title || '').toLowerCase();
          const tagsLower = (item.tags || '').toLowerCase();
          const autoTagsLower = (item.auto_tags || '').toLowerCase();
          const allText = titleLower + ' ' + tagsLower + ' ' + autoTagsLower;

          // Primary terms (competitors) get HUGE boost - 100 points
          for (const term of primaryTerms) {
            if (allText.includes(term)) score += 100;
          }

          // Regular search terms get normal scoring
          for (const term of searchTermsLower) {
            if (titleLower.includes(term)) score += 10;
            if (tagsLower.includes(term)) score += 5;
            if (autoTagsLower.includes(term)) score += 5;
          }
          return { item, score };
        });

        // Sort by score descending, then add to results
        scoredRemaining.sort((a, b) => b.score - a.score);
        for (const { item } of scoredRemaining) {
          orderedResults.push(item);
          usedTitles.add(item.title);
        }

        finalResults = orderedResults;

        // Update AI insight with conversational response
        if (rankingResult.aiResponse || rankingExplanation) {
          setAiInsight(prev => ({
            ...prev,
            aiResponse: rankingResult.aiResponse,
            relevanceExplanation: rankingExplanation,
            primaryRecommendations: rankingResult.primaryRecommendations,
            additionalResources: rankingResult.additionalResources,
            topMatches: topMatches
          }));
        }
      }

      setResults(finalResults.slice(0, PAGE_SIZE));
      setCurrentSearchConfig({
        ...searchConfig,
        allResults: finalResults // Store all ranked results for pagination
      });
      setHasMore(finalResults.length > PAGE_SIZE);
    } catch (err) {
      setError(err.message);
      console.error('Search error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleViewAll = async () => {
    setLoading(true);
    setError(null);
    setAiInsight(null);
    setQuery('');
    setSelectedTypes([]);
    setSelectedStates([]);
    setCurrentPage(0);
    setHasMore(false);
    setIsViewAll(true);

    // Track View All in Heap
    if (window.heap) {
      window.heap.track('Portal View All');
    }

    try {
      const { data, error } = await supabaseClient
        .from('marketing_content')
        .select('*')
        .order('last_updated', { ascending: false, nullsFirst: false })
        .range(0, PAGE_SIZE - 1);

      if (error) throw error;
      setResults(data || []);
      setCurrentSearchConfig({
        types: [],
        states: [],
        searchTerms: [],
        rawQuery: '',
        useRawQueryFallback: false
      });
      setHasMore((data || []).length === PAGE_SIZE);
    } catch (err) {
      setError(err.message);
      console.error('View all error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Handle chat messages
  const handleChatMessage = async (message) => {
    // Track chat message in Heap
    if (window.heap) {
      window.heap.track('Chat Message Sent', {
        message_length: message.length
      });
    }

    // Add user message to history
    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: message,
      timestamp: Date.now()
    };

    setConversationHistory(prev => [...prev, userMessage]);
    setChatLoading(true);

    try {
      // First, parse the query to extract search terms and states
      const aiParams = await convertNaturalLanguageToQuery(message, {});
      const searchTerms = aiParams.searchTerms || [];
      const detectedStates = aiParams.states || [];
      const primaryIntent = aiParams.primaryIntent || 'general';

      console.log('[Chat] AI params:', { searchTerms, detectedStates, primaryIntent });

      // Fetch state-specific context if states were detected
      let stateContext = null;
      if (detectedStates.length > 0) {
        try {
          const { data: contextData } = await supabaseClient
            .from('ai_context')
            .select('content, title, summary')
            .eq('category', 'state_context')
            .in('subcategory', detectedStates);

          if (contextData && contextData.length > 0) {
            // Combine all state contexts (truncate to reasonable size for prompt)
            stateContext = contextData.map(ctx => {
              // Use summary + key sections (first 3000 chars) to keep prompt manageable
              const content = ctx.content || '';
              return `### ${ctx.title}\n${ctx.summary}\n\n${content.substring(0, 4000)}`;
            }).join('\n\n---\n\n');
            console.log('[Chat] Loaded state context for:', detectedStates, '- Length:', stateContext.length);
          }
        } catch (err) {
          console.warn('[Chat] Error fetching state context:', err);
        }
      }

      // Normalize the raw message for keyword detection (used throughout chat handler)
      const chatQueryLower = message.toLowerCase();

      // Fetch customer story context when the query is about proof points, quotes, districts, or examples
      let customerStoryContext = null;
      const csKeywords = ['customer story', 'case study', 'proof', 'quote', 'district',
        'testimonial', 'proof point', 'success story', 'reference', 'example district',
        'customer', 'case studies', 'customer stories'];
      const isCustomerStoryQuery = csKeywords.some(kw => chatQueryLower.includes(kw));
      if (isCustomerStoryQuery) {
        try {
          let csQuery = supabaseClient
            .from('ai_context')
            .select('title, content, subcategory, tags, source_url')
            .eq('category', 'customer_story')
            .eq('is_verified', true)
            .limit(5);

          // Narrow by state if detected
          if (detectedStates.length > 0) {
            csQuery = csQuery.contains('tags', detectedStates);
          }

          const { data: csData } = await csQuery;
          if (csData && csData.length > 0) {
            customerStoryContext = csData;
            console.log('[Chat] Loaded customer story context:', csData.length, 'stories');
          }
        } catch (err) {
          console.warn('[Chat] Error fetching customer story context:', err);
        }
      }

      // Build a search query to find relevant content
      let queryBuilder = supabaseClient
        .from('marketing_content')
        .select('*');

      // CONTENT TYPE DETECTION: Apply type filter if user is searching for a content type
      // This handles queries like "one pager", "case studies", "videos", etc.
      const chatTypeDetection = {
        '1-Pager': ['one pager', 'one-pager', 'onepager', '1 pager', '1-pager', 'pager', 'fact sheet', 'factsheet', 'flyer', 'brochure', 'oen pager', 'on pager'],
        'Customer Story': ['case study', 'case-study', 'casestudy', 'customer story', 'success story', 'testimonial', 'customer stories', 'case studies'],
        'Ebook': ['ebook', 'e-book', 'whitepaper', 'white paper', 'guide', 'handbook', 'ebooks', 'whitepapers'],
        'Video': ['video', 'videos', 'tutorial', 'demo'],
        'Video Clip': ['video clip', 'video clips', 'clip', 'clips', 'snippet', 'short video'],
        'Webinar': ['webinar', 'webinars', 'web seminar'],
        'Blog': ['blog', 'blogs', 'article', 'articles', 'blog post']
      };

      // Database has inconsistent type values - map to ALL possible variations
      const chatTypeVariations = {
        '1-Pager': ['1-Pager', '1 Pager'],  // Some records have hyphen, some have space
        'Video Clip': ['Video Clip', 'VideoClip']
      };

      let chatDetectedTypes = [];
      // Also use terminology-detected types (expand with variations)
      const terminologyDetectedTypes = aiParams.types || [];
      if (terminologyDetectedTypes.length > 0) {
        for (const type of terminologyDetectedTypes) {
          const variations = chatTypeVariations[type] || [type];
          chatDetectedTypes.push(...variations);
        }
        console.log('[Chat] Using terminology-detected types with variations:', chatDetectedTypes);
      }

      // Backup detection from query text (add variations)
      // Skip when user says "anything/everything" (wants all types),
      // or when AI returned no types and intent is state-focused (trust AI over keyword match)
      const hasAllTypesLanguage = /\b(anything|everything|all types|any type|all content|any content|whatever)\b/.test(chatQueryLower);
      const isStateOnlySearch = primaryIntent === 'state' && (aiParams.types || []).length === 0;
      if (!hasAllTypesLanguage && !isStateOnlySearch) {
        for (const [contentType, terms] of Object.entries(chatTypeDetection)) {
          for (const term of terms) {
            if (chatQueryLower.includes(term)) {
              const variations = chatTypeVariations[contentType] || [contentType];
              for (const variant of variations) {
                if (!chatDetectedTypes.includes(variant)) {
                  chatDetectedTypes.push(variant);
                }
              }
              console.log(`[Chat] Backup type detection: "${term}" → ${variations.join(', ')}`);
              break;
            }
          }
        }
      }

      // Apply content type filter if types were detected (includes all variations)
      // Skip type filter for competitor queries - users want ALL content types when comparing
      // Belt-and-suspenders: check BOTH primaryIntent AND raw query/searchTerms for competitor names
      // because gpt-4o-mini doesn't always return primaryIntent='competitor' reliably
      const competitorNames = ['naviance', 'xello', 'scoir', 'majorcla', 'powersch', 'kuder', 'youscience', 'levelall'];
      const isCompetitorQuery = primaryIntent === 'competitor' ||
        searchTerms.some(t => competitorNames.some(c => t.toLowerCase().includes(c))) ||
        competitorNames.some(c => chatQueryLower.includes(c));

      // Skip type filter for customer story queries when a state is detected:
      // The customer story quotes/evidence already comes from ai_context (customerStoryContext).
      // We want the full set of state content (videos, ebooks, clips, etc.) so the AI can
      // recommend related assets alongside the customer story.
      const isStateCustomerStoryQuery = isCustomerStoryQuery && detectedStates.length > 0;

      if (chatDetectedTypes.length > 0 && !isCompetitorQuery && !isStateCustomerStoryQuery) {
        console.log('[Chat] Applying type filter with variations:', chatDetectedTypes);
        queryBuilder = queryBuilder.in('type', chatDetectedTypes);
      } else if (chatDetectedTypes.length > 0 && isCompetitorQuery) {
        console.log('[Chat] Skipping type filter for competitor query - showing all content types');
      } else if (isStateCustomerStoryQuery) {
        console.log('[Chat] Skipping type filter for state+customer story query - loading all state content for broader recommendations');
      }

      // IMPORTANT: Apply state filter FIRST if states were detected
      // This ensures state-specific searches return ONLY that state's content
      if (detectedStates.length > 0) {
        console.log('[Chat] Applying state filter:', detectedStates);
        queryBuilder = queryBuilder.in('state', detectedStates);
      }

      // Apply keyword search to find relevant content (including enriched fields)
      // BUT skip state names as keywords when primaryIntent is 'state'
      const isStateSearch = primaryIntent === 'state' && detectedStates.length > 0;
      const filteredSearchTerms = isStateSearch
        ? searchTerms.filter(t => !Object.values({
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
          }).includes(t.toLowerCase()) && !['content', 'stuff', 'resources'].includes(t.toLowerCase()))
        : searchTerms;

      // Detect if this is a content-type-only search (e.g., "one pager", "case studies")
      // In this case, we should return ALL items of that type, not filter by keywords
      const chatContentTypeTerms = ['pager', 'one-pager', 'onepager', '1-pager', 'case', 'study', 'studies',
        'video', 'clip', 'clips', 'ebook', 'e-book', 'whitepaper', 'webinar', 'blog', 'article',
        'customer', 'story', 'stories', 'testimonial', 'one', 'fact', 'sheet', 'oen'];

      const isChatTypeOnlySearch = chatDetectedTypes.length > 0 &&
        filteredSearchTerms.every(term =>
          chatContentTypeTerms.includes(term.toLowerCase()) ||
          chatDetectedTypes.some(t => t.toLowerCase().includes(term.toLowerCase()) || term.toLowerCase().includes(t.toLowerCase()))
        );

      // Ensure competitor names from raw query are always in search terms
      // (NLP may omit them, e.g. returning ["comparison"] instead of ["naviance"])
      for (const comp of competitorNames) {
        if (chatQueryLower.includes(comp) && !filteredSearchTerms.some(t => t.toLowerCase().includes(comp))) {
          filteredSearchTerms.push(comp);
          console.log(`[Chat] Injected competitor term "${comp}" missing from NLP searchTerms`);
        }
      }

      // Only apply keyword search if NOT a type-only search
      if (filteredSearchTerms.length > 0 && !isChatTypeOnlySearch) {
        const searchConditions = filteredSearchTerms.flatMap(term => {
          const t = term.toLowerCase();
          return [
            `title.ilike.%${t}%`,
            `summary.ilike.%${t}%`,
            `enhanced_summary.ilike.%${t}%`,
            `tags.ilike.%${t}%`,
            `auto_tags.ilike.%${t}%`,
            `extracted_text.ilike.%${t}%`
          ];
        });
        queryBuilder = queryBuilder.or(searchConditions.join(','));
      } else if (isChatTypeOnlySearch) {
        console.log('[Chat] Content-type-only search - skipping keyword filters, returning all', chatDetectedTypes);
      }

      const { data } = await queryBuilder
        .order('last_updated', { ascending: false })
        .limit(100);

      let contentForContext = data || [];

      // Prioritize HubSpot platform for 1-pager / PDF searches (more current than SL Resources)
      const chatIsOnePagerSearch = (chatDetectedTypes || []).includes('1-Pager') || /\b(1.pager|one.pager|pdf)\b/i.test(chatQueryLower);
      if (chatIsOnePagerSearch && contentForContext.length > 0) {
        const hubspotItems = contentForContext.filter(r => /hubspot/i.test(r.platform || ''));
        const otherItems = contentForContext.filter(r => !/hubspot/i.test(r.platform || ''));
        contentForContext = [...hubspotItems, ...otherItems];
      }

      // For state + customer story queries: remove content tagged with OTHER states.
      // Keep the target state's content + untagged/generic content (Landing Pages, 1-Pagers, Ebooks).
      // This prevents NJ/NV customer stories from appearing in AZ recommendations.
      if (isStateCustomerStoryQuery && detectedStates.length > 0) {
        const targetState = detectedStates[0].toUpperCase();
        const stateFiltered = contentForContext.filter(item => {
          const itemState = (item.state || '').trim().toUpperCase();
          return !itemState || itemState === targetState;
        });
        if (stateFiltered.length >= 3) {
          contentForContext = stateFiltered;
          console.log(`[Chat] State+CS cross-filter: ${data?.length} → ${contentForContext.length} items (kept ${targetState} + untagged)`);
        }
      }

      // CRITICAL: Filter out wrong competitors when searching for a specific competitor
      // If searching for Xello, exclude ALL Naviance content (and vice versa)
      // Check BOTH searchTerms AND raw query text for reliability (NLP may omit competitor names)
      const searchTermsLower = searchTerms.map(t => t.toLowerCase());
      const isXelloSearch = searchTermsLower.some(t => t.includes('xello')) || chatQueryLower.includes('xello');
      const isNavianceSearch = searchTermsLower.some(t => t.includes('naviance')) || chatQueryLower.includes('naviance');

      console.log('[Chat] Competitor detection:', { isXelloSearch, isNavianceSearch, searchTerms });
      const beforeFilterCount = contentForContext.length;

      // Helper: build searchable text from all content fields (tags, summaries, extracted text, keywords)
      const getSearchableText = (item) => [
        item.tags, item.auto_tags, item.title,
        item.enhanced_summary, item.summary, item.extracted_text,
        typeof item.keywords === 'string' ? item.keywords : JSON.stringify(item.keywords || [])
      ].filter(Boolean).join(' ').toLowerCase();

      if (isXelloSearch && !isNavianceSearch) {
        // STRICT: When searching for Xello, ONLY keep Xello-related content
        const xelloContent = contentForContext.filter(item => {
          return getSearchableText(item).includes('xello');
        });

        if (xelloContent.length > 0) {
          console.log(`[Chat] Found ${xelloContent.length} Xello-specific items - using ONLY these`);
          contentForContext = xelloContent;
        } else {
          // Fallback: at least exclude Naviance content
          contentForContext = contentForContext.filter(item => {
            return !getSearchableText(item).includes('naviance');
          });
        }
        console.log(`[Chat] Filtered for Xello: ${beforeFilterCount} -> ${contentForContext.length} items`);
      } else if (isNavianceSearch && !isXelloSearch) {
        // STRICT: When searching for Naviance, ONLY keep Naviance-related content
        const navianceContent = contentForContext.filter(item => {
          return getSearchableText(item).includes('naviance');
        });

        if (navianceContent.length > 0) {
          console.log(`[Chat] Found ${navianceContent.length} Naviance-specific items - using ONLY these`);
          contentForContext = navianceContent;
        } else {
          contentForContext = contentForContext.filter(item => {
            return !getSearchableText(item).includes('xello');
          });
        }
        console.log(`[Chat] Filtered for Naviance: ${beforeFilterCount} -> ${contentForContext.length} items`);
      }

      // If no specific matches, fall back to recent content
      if (contentForContext.length === 0) {
        const { data: fallbackData } = await supabaseClient
          .from('marketing_content')
          .select('*')
          .order('last_updated', { ascending: false })
          .limit(100);
        contentForContext = fallbackData || [];
      }

      setResults(contentForContext);

      // Process with conversation context (include state-specific context if available)
      const response = await processConversationalQuery(
        message,
        conversationHistory,
        contentForContext,
        {
          stateContext,
          customerStoryContext,
          detectedStates,
          maxContentForContext: 100
        }
      );

      // IMPORTANT: Pass ALL recommendations through to ChatInterface
      // Don't filter here - let ChatInterface handle finding matching items
      // This ensures recommendation cards ALWAYS appear in the chat
      // Even if we can't find the exact item, the card shows "See results below"
      //
      // The fuzzy matching happens in ChatInterface when looking up items for links
      const normalizeForMatch = (str) => (str || '').toLowerCase().trim().replace(/\s+/g, ' ');

      // Log recommendations for debugging
      console.log('[Chat] Recommendations from AI:', response.recommendations);
      console.log('[Chat] Content available for matching:', contentForContext.length, 'items');

      // Add assistant response to history with ALL recommendations
      // ChatInterface will handle finding matching items for links
      // Include new structured format fields for the upgraded UI
      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.response,
        // New structured format fields
        quick_answer: response.quick_answer,
        key_points: response.key_points || [],
        follow_up_questions: response.follow_up_questions || [],
        // Legacy fields
        recommendations: response.recommendations || [],
        followUpQuestions: response.followUpQuestions || response.follow_up_questions || [],
        aiContent: response.aiContent,
        timestamp: Date.now()
      };

      setConversationHistory(prev => [...prev, assistantMessage]);

      // Reorder results to show recommendations first
      if (response.recommendations?.length > 0) {
        const recommendations = response.recommendations;
        const orderedResults = [];
        const usedTitles = new Set();

        // 1. Add recommended items first (in order)
        // Use same fuzzy matching as validRecommendations filter above
        const unmatchedRecs = [];
        for (const rec of recommendations) {
          const recTitleNorm = normalizeForMatch(rec.title);
          const item = contentForContext.find(r => {
            const itemTitleNorm = normalizeForMatch(r.title);
            return itemTitleNorm === recTitleNorm ||
                   itemTitleNorm.includes(recTitleNorm) ||
                   recTitleNorm.includes(itemTitleNorm);
          });
          if (item && !usedTitles.has(item.title)) {
            orderedResults.push(item);
            usedTitles.add(item.title);
          } else if (!item) {
            // AI recommended this item but it wasn't in the DB query results
            // (likely known via customerStoryContext) — track for secondary lookup
            unmatchedRecs.push(rec);
          }
        }

        // 1b. Secondary lookup: fetch any recommended items not in contentForContext
        // The AI may recommend items it learned about from customerStoryContext
        if (unmatchedRecs.length > 0) {
          try {
            const titleQueries = unmatchedRecs.map(r => r.title.substring(0, 60));
            const { data: extraItems } = await supabaseClient
              .from('marketing_content')
              .select('*')
              .or(titleQueries.map(t => `title.ilike.%${t.substring(0, 40)}%`).join(','))
              .limit(unmatchedRecs.length * 2);

            if (extraItems?.length > 0) {
              for (const rec of unmatchedRecs) {
                const recTitleNorm = normalizeForMatch(rec.title);
                const found = extraItems.find(r => {
                  const itemTitleNorm = normalizeForMatch(r.title);
                  return itemTitleNorm === recTitleNorm ||
                         itemTitleNorm.includes(recTitleNorm) ||
                         recTitleNorm.includes(itemTitleNorm);
                });
                if (found && !usedTitles.has(found.title)) {
                  orderedResults.push(found);
                  usedTitles.add(found.title);
                }
              }
            }
          } catch (lookupErr) {
            console.warn('[Chat] Secondary rec lookup failed:', lookupErr.message);
          }
        }

        // 2. Add remaining results, sorted by keyword relevance
        // First, identify "primary" search terms (competitors/specific keywords) vs generic terms
        const primaryTerms = searchTerms.filter(t =>
          ['xello', 'naviance', 'scoir', 'majorcla', 'powersch', 'levelall'].some(c => t.toLowerCase().includes(c))
        );
        const remainingItems = contentForContext.filter(item => !usedTitles.has(item.title));

        // Score remaining items - give MUCH higher weight to primary term matches
        const scoredRemaining = remainingItems.map(item => {
          let score = 0;
          const titleLower = (item.title || '').toLowerCase();
          const tagsLower = (item.tags || '').toLowerCase();
          const autoTagsLower = (item.auto_tags || '').toLowerCase();
          const allText = titleLower + ' ' + tagsLower + ' ' + autoTagsLower;

          // Primary terms (competitors) get HUGE boost - 100 points
          for (const term of primaryTerms) {
            const t = term.toLowerCase();
            if (allText.includes(t)) score += 100;
          }

          // Regular search terms get normal scoring
          for (const term of searchTerms) {
            const t = term.toLowerCase();
            if (titleLower.includes(t)) score += 10;
            if (tagsLower.includes(t)) score += 5;
            if (autoTagsLower.includes(t)) score += 5;
          }
          return { item, score };
        });

        // Sort by score descending
        scoredRemaining.sort((a, b) => b.score - a.score);
        for (const { item } of scoredRemaining) {
          orderedResults.push(item);
          usedTitles.add(item.title);
        }

        setResults(orderedResults);

        // Show hint to scroll down for results (no auto-scroll)
        setShowResultsHint(true);
      }

    } catch (error) {
      console.error('Chat error:', error);
      const errorMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: "I'm sorry, I encountered an error. Please try again or use the search bar.",
        timestamp: Date.now()
      };
      setConversationHistory(prev => [...prev, errorMessage]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleClearConversation = () => {
    setConversationHistory([]);
  };

  const handleNavigate = (mode) => {
    setViewMode(mode);
    if (window.heap) window.heap.track('Mode Toggled', { mode });
  };

  const handleAdminToggle = () => {
    const next = !isAdminMode;
    window.location.hash = next ? '#admin' : '';
  };

  const exportToCSV = () => {
    if (results.length === 0) return;

    // Track CSV export in Heap
    if (window.heap) {
      window.heap.track('Portal CSV Export', {
        result_count: results.length
      });
    }

    const headers = ['Type', 'Title', 'Live Link', 'Ungated Link', 'Platform', 'State', 'Tags', 'Summary'];
    const rows = results.map(row => [
      row.type,
      row.title,
      row.live_link || '',
      row.ungated_link || '',
      row.platform || '',
      row.state || '',
      row.tags || '',
      row.summary || ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `marketing-content-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  // Render admin interface when in admin mode
  if (isAdminMode) {
    return (
      <div className={`app-shell${isMobile ? ' is-mobile' : ' is-desktop'}${isWide ? ' is-wide' : ''}`}>
        {!isMobile && (
          <Sidebar
            collapsed={sidebarCollapsed}
            viewMode={viewMode}
            onNavigate={handleNavigate}
            onToggle={toggleSidebar}
          />
        )}
        <div className="main-panel">
          <header className="app-header app-header--admin">
            <div className="app-header-inner">
              <div className="admin-header-title">
                <button
                  className="back-btn"
                  onClick={() => { window.location.hash = ''; }}
                  title="Back to portal"
                >
                  <ArrowLeft size={18} />
                  <span>Back</span>
                </button>
                <Brain size={22} />
                <span>Terminology Brain Admin</span>
              </div>
            </div>
          </header>
          <main className="main" style={{ padding: '0' }}>
            <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}><Loader2 className="animate-spin" /> Loading admin...</div>}>
              <TerminologyAdmin />
            </Suspense>
          </main>
        </div>
        {isMobile && <BottomTabBar viewMode={viewMode} onNavigate={handleNavigate} />}
      </div>
    );
  }

  return (
    <div className={`app-shell${isMobile ? ' is-mobile' : ' is-desktop'}${isWide ? ' is-wide' : ''}`}>
      {!isMobile && (
        <Sidebar
          collapsed={sidebarCollapsed}
          viewMode={viewMode}
          onNavigate={handleNavigate}
          onToggle={toggleSidebar}
          />
      )}

      <div className="main-panel">
        <AppHeader isMobile={isMobile} stats={stats} viewMode={viewMode} />

        <main className="main">
          <div className="search-container">
          {/* Chat Interface */}
          {viewMode === 'chat' && (
            <ChatInterface
              conversationHistory={conversationHistory}
              onSendMessage={handleChatMessage}
              loading={chatLoading}
              results={results}
              contentDatabase={results}
              onClearConversation={handleClearConversation}
            />
          )}

          {/* Results hint alert - shows after chat recommendations */}
          {viewMode === 'chat' && showResultsHint && results.length > 0 && (
            <div
              className="results-hint"
              onClick={() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              <ChevronDown size={18} />
              <span>Scroll down to see {results.length} matching results</span>
              <ChevronDown size={18} />
            </div>
          )}

          {/* Traditional Search Form */}
          {viewMode === 'search' && (
          <form onSubmit={handleSearch} className="search-form">
            <div className="search-input-wrapper">
              <Search className="search-icon" size={20} />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='Try "costumer storys from texs" or "videos about college readiness"...'
                className="search-input"
              />
              <button type="submit" disabled={loading} className="search-button">
                {loading ? <Loader2 className="spinner" size={20} /> : 'Search'}
              </button>
              <button
                type="button"
                onClick={handleViewAll}
                disabled={loading}
                className="view-all-button"
              >
                View All
              </button>
            </div>
          </form>
          )}

          {/* AI Insight Display - only in search mode */}
          {viewMode === 'search' && aiInsight && (
            <div className="ai-insight">
              <div className="ai-insight-header">
                <Sparkles size={16} />
                <span>AI Search Assistant</span>
              </div>

              {/* Conversational AI Response */}
              {aiInsight.aiResponse && (
                <div className="ai-conversation">
                  <p className="ai-response">{aiInsight.aiResponse}</p>

                  {/* Primary Recommendations with Links - using title-based lookup */}
                  {aiInsight.primaryRecommendations?.length > 0 && (
                    <div className="ai-recommendations">
                      <span className="ai-rec-label">Recommended:</span>
                      {aiInsight.primaryRecommendations.map((rec, idx) => {
                        // Find by title instead of index to avoid mismatch after ranking
                        const item = results.find(r => r.title === rec.title);
                        if (!item) return null;
                        return (
                          <a
                            key={idx}
                            href={item.live_link || item.ungated_link || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ai-rec-link"
                            title={rec.reason}
                          >
                            <span className="ai-rec-type">{item.type}</span>
                            <span className="ai-rec-title">{item.title}</span>
                            <ExternalLink size={12} />
                          </a>
                        );
                      })}
                    </div>
                  )}

                  {/* Additional Resources - using title-based lookup */}
                  {aiInsight.additionalResources?.length > 0 && (
                    <div className="ai-recommendations ai-additional secondary">
                      <span className="ai-rec-label">Also relevant:</span>
                      {aiInsight.additionalResources.slice(0, 3).map((rec, idx) => {
                        // Find by title instead of index to avoid mismatch after ranking
                        const item = results.find(r => r.title === rec.title);
                        if (!item) return null;
                        return (
                          <a
                            key={idx}
                            href={item.live_link || item.ungated_link || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="ai-rec-link"
                            title={rec.reason}
                          >
                            <span className="ai-rec-type">{item.type}</span>
                            <span className="ai-rec-title">{item.title}</span>
                            <ExternalLink size={12} />
                          </a>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Fallback to basic understanding if no AI response */}
              {!aiInsight.aiResponse && aiInsight.understanding && (
                <p className="ai-understanding">{aiInsight.understanding}</p>
              )}

              <div className="ai-details">
                {aiInsight.correctedQuery !== query && (
                  <span className="ai-tag">Corrected: "{aiInsight.correctedQuery}"</span>
                )}
                {aiInsight.types?.length > 0 && (
                  <span className="ai-tag">Types: {aiInsight.types.join(', ')}</span>
                )}
                {aiInsight.states?.length > 0 && (
                  <span className="ai-tag">States: {aiInsight.states.join(', ')}</span>
                )}
                {aiInsight.searchTerms?.length > 0 && (
                  <span className="ai-tag">Keywords: {aiInsight.searchTerms.slice(0, 5).join(', ')}</span>
                )}
              </div>
            </div>
          )}

          {/* Filters - only in search mode */}
          {viewMode === 'search' && (
          <div className={`filters ${filtersOpen ? 'is-open' : 'is-collapsed'}`}>
            <div className="filters-header">
              <button
                type="button"
                className="filters-toggle"
                onClick={() => setFiltersOpen(!filtersOpen)}
                aria-expanded={filtersOpen}
              >
                {filtersOpen ? 'Hide Filters' : 'Show Filters'}
              </button>
            </div>
            <div className="filters-body">
            <div className="filter-group">
              <span className="filter-label">Content Type:</span>
              <div className="filter-options">
                {contentTypes.map(type => (
                  <label key={type} className="filter-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedTypes.includes(type)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedTypes([...selectedTypes, type]);
                        } else {
                          setSelectedTypes(selectedTypes.filter(t => t !== type));
                        }
                      }}
                    />
                    <span>{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="filter-group">
              <span className="filter-label">State:</span>
              <div className="filter-options">
                {usStates.map((state) => (
                  <label key={state.abbr} className="filter-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedStates.includes(state.abbr)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedStates([...selectedStates, state.abbr]);
                        } else {
                          setSelectedStates(selectedStates.filter((s) => s !== state.abbr));
                        }
                      }}
                    />
                    <span>{state.abbr} - {state.name}</span>
                  </label>
                ))}
              </div>
            </div>
            </div>
          </div>
          )}

          {/* Weekly GTM Report */}
          {viewMode === 'gtm' && (
            <WeeklyGTMReport />
          )}

          {/* Content Feed */}
          {viewMode === 'feed' && (
            <ContentFeed />
          )}

          {error && (
            <div className="error">
              <p>Error: {error}</p>
            </div>
          )}
        </div>

        {/* Results - hide when in GTM or Feed mode */}
        {viewMode !== 'gtm' && viewMode !== 'feed' && (
        <div className="results-container" ref={resultsRef}>
          <div className="results-header">
            <h2>
              {results.length > 0
                ? `Found ${isViewAll && stats?.total_content ? stats.total_content : results.length} result${(isViewAll && stats?.total_content ? stats.total_content : results.length) !== 1 ? 's' : ''}`
                : 'Search to see results'
              }
            </h2>
            {results.length > 0 && (
              <button onClick={exportToCSV} className="export-button">
                <Download size={16} />
                Export CSV
              </button>
            )}
          </div>

          <div className="results-grid">
            {results.map((item) => (
              <div key={item.id} className="result-card">
                <div className="result-header">
                  <span className="result-type">{item.type}</span>
                  {item.state && <span className="result-state">{item.state}</span>}
                  {item._relevanceScore && (
                    <span className={`relevance-badge relevance-${item._relevanceScore >= 8 ? 'high' : item._relevanceScore >= 5 ? 'medium' : 'low'}`}>
                      {item._relevanceScore}/10
                    </span>
                  )}
                </div>

                {item._relevanceReason && (
                  <p className="relevance-reason">{item._relevanceReason}</p>
                )}

                <h3 className="result-title">{item.title}</h3>

                {item.summary && (
                  <p className="result-summary">
                    {item.summary.length > 200
                      ? item.summary.substring(0, 200) + '...'
                      : item.summary}
                  </p>
                )}

                <div className="result-meta">
                  {item.platform && (
                    <span className="meta-item">
                      <strong>Platform:</strong> {item.platform}
                    </span>
                  )}
                  {item.tags && (
                    <span className="meta-item">
                      <strong>Tags:</strong> {item.tags}
                    </span>
                  )}
                </div>

                <div className="result-links">
                  {item.live_link && (
                    <a
                      href={item.live_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="result-link"
                      onClick={() => {
                        if (window.heap) window.heap.track('Content Link Clicked', {
                          content_type: item.type,
                          content_title: item.title,
                          link_type: 'live'
                        });
                      }}
                    >
                      <ExternalLink size={14} />
                      View Live
                    </a>
                  )}
                  {item.ungated_link && (
                    <a
                      href={item.ungated_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="result-link"
                      onClick={() => {
                        if (window.heap) window.heap.track('Content Link Clicked', {
                          content_type: item.type,
                          content_title: item.title,
                          link_type: 'download'
                        });
                      }}
                    >
                      <Download size={14} />
                      Download
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>

          {!loading && results.length === 0 && query && (
            <div className="no-results">
              <p>No results found for "{query}"</p>
              <p className="no-results-hint">Try different keywords or check your spelling</p>
            </div>
          )}
        </div>
        )}
        </main>
      </div>

      {isMobile && <BottomTabBar viewMode={viewMode} onNavigate={handleNavigate} />}
    </div>
  );
}

export default App;

import React, { useState, useEffect, useRef } from 'react';
import { Search, Database, Filter, Download, ExternalLink, Loader2, Sparkles, MessageSquare, ChevronDown } from 'lucide-react';
import { supabaseClient } from './services/supabase';
import { convertNaturalLanguageToQuery, rankResultsByRelevance, processConversationalQuery } from './services/nlp';
import ChatInterface from './components/ChatInterface';
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
  const [isChatMode, setIsChatMode] = useState(true); // Default to chat mode
  const [conversationHistory, setConversationHistory] = useState([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [showResultsHint, setShowResultsHint] = useState(false);
  const firstRenderRef = useRef(true);
  const resultsRef = useRef(null);

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

    try {
      // Use AI to understand the query
      const aiParams = await convertNaturalLanguageToQuery(query, {
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

      // Apply AI-detected type filters (merge with user-selected)
      if (allTypes.length > 0) {
        queryBuilder = queryBuilder.in('type', allTypes);
      }

      // Apply AI-detected state filters (merge with user-selected)
      if (allStates.length > 0) {
        queryBuilder = queryBuilder.in('state', allStates);
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
      } else if (aiParams.searchTerms && aiParams.searchTerms.length > 0) {
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
      } else if (searchConfig.useRawQueryFallback) {
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

      // Fetch more results for AI ranking (up to 50)
      const { data, error } = await queryBuilder
        .order('last_updated', { ascending: false, nullsFirst: false })
        .range(0, 49);

      if (error) throw error;

      // Use AI to rank results by relevance
      let finalResults = data || [];
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

      // Build a search query to find relevant content
      let queryBuilder = supabaseClient
        .from('marketing_content')
        .select('*');

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

      if (filteredSearchTerms.length > 0) {
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
      }

      const { data } = await queryBuilder
        .order('last_updated', { ascending: false })
        .limit(100);

      let contentForContext = data || [];

      // CRITICAL: Filter out wrong competitors when searching for a specific competitor
      // If searching for Xello, exclude ALL Naviance content (and vice versa)
      const searchTermsLower = searchTerms.map(t => t.toLowerCase());
      const isXelloSearch = searchTermsLower.some(t => t.includes('xello'));
      const isNavianceSearch = searchTermsLower.some(t => t.includes('naviance'));

      console.log('[Chat] Competitor detection:', { isXelloSearch, isNavianceSearch, searchTerms });
      const beforeFilterCount = contentForContext.length;

      if (isXelloSearch && !isNavianceSearch) {
        // STRICT: When searching for Xello, ONLY keep Xello-related content
        // First, identify all Xello-specific content
        const xelloContent = contentForContext.filter(item => {
          const allText = ((item.tags || '') + ' ' + (item.auto_tags || '') + ' ' + (item.title || '')).toLowerCase();
          return allText.includes('xello');
        });

        // If we have Xello content, use ONLY that (no general content mixing in)
        if (xelloContent.length > 0) {
          console.log(`[Chat] Found ${xelloContent.length} Xello-specific items - using ONLY these`);
          contentForContext = xelloContent;
        } else {
          // Fallback: at least exclude Naviance content
          contentForContext = contentForContext.filter(item => {
            const allText = ((item.tags || '') + ' ' + (item.auto_tags || '') + ' ' + (item.title || '')).toLowerCase();
            return !allText.includes('naviance');
          });
        }
        console.log(`[Chat] Filtered for Xello: ${beforeFilterCount} -> ${contentForContext.length} items`);
      } else if (isNavianceSearch && !isXelloSearch) {
        // STRICT: When searching for Naviance, ONLY keep Naviance-related content
        const navianceContent = contentForContext.filter(item => {
          const allText = ((item.tags || '') + ' ' + (item.auto_tags || '') + ' ' + (item.title || '')).toLowerCase();
          return allText.includes('naviance');
        });

        if (navianceContent.length > 0) {
          console.log(`[Chat] Found ${navianceContent.length} Naviance-specific items - using ONLY these`);
          contentForContext = navianceContent;
        } else {
          contentForContext = contentForContext.filter(item => {
            const allText = ((item.tags || '') + ' ' + (item.auto_tags || '') + ' ' + (item.title || '')).toLowerCase();
            return !allText.includes('xello');
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
          detectedStates,
          maxContentForContext: 100
        }
      );

      // CRITICAL: Filter AI recommendations to only include items that exist in our filtered content
      // This prevents Naviance content from appearing when searching for Xello
      const validRecommendations = (response.recommendations || []).filter(rec => {
        const exists = contentForContext.some(item => item.title === rec.title);
        if (!exists) {
          console.log('[Chat] Filtering out invalid recommendation (not in filtered results):', rec.title);
        }
        return exists;
      });
      console.log(`[Chat] Valid recommendations: ${validRecommendations.length} of ${(response.recommendations || []).length}`);

      // Add assistant response to history with ONLY valid recommendations
      const assistantMessage = {
        id: `assistant-${Date.now()}`,
        role: 'assistant',
        content: response.response,
        recommendations: validRecommendations,
        followUpQuestions: response.followUpQuestions,
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
        for (const rec of recommendations) {
          const item = contentForContext.find(r => r.title === rec.title);
          if (item && !usedTitles.has(item.title)) {
            orderedResults.push(item);
            usedTitles.add(item.title);
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

  const exportToCSV = () => {
    if (results.length === 0) return;

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

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="header-title">
            <Database size={32} />
            <div>
              <h1>Marketing Content Portal</h1>
              <p>AI-driven search across all SchooLinks marketing content</p>
            </div>
          </div>
          {stats && (
            <div className="stats">
              <div className="stat-item">
                <span className="stat-value">{stats.total_content}</span>
                <span className="stat-label">Total Content</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{stats.content_types}</span>
                <span className="stat-label">Content Types</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{stats.states_covered}</span>
                <span className="stat-label">States</span>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="main">
        <div className="search-container">
          {/* Mode Toggle */}
          <div className="search-mode-toggle">
            <button
              className={`search-mode-btn ${isChatMode ? 'active' : ''}`}
              onClick={() => setIsChatMode(true)}
            >
              <MessageSquare size={16} />
              Chat Assistant
            </button>
            <button
              className={`search-mode-btn ${!isChatMode ? 'active' : ''}`}
              onClick={() => setIsChatMode(false)}
            >
              <Search size={16} />
              Quick Search
            </button>
          </div>

          {/* Chat Interface */}
          {isChatMode && (
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
          {isChatMode && showResultsHint && results.length > 0 && (
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
          {!isChatMode && (
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
          {!isChatMode && aiInsight && (
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
          {!isChatMode && (
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

          {error && (
            <div className="error">
              <p>Error: {error}</p>
            </div>
          )}
        </div>

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
                    <a href={item.live_link} target="_blank" rel="noopener noreferrer" className="result-link">
                      <ExternalLink size={14} />
                      View Live
                    </a>
                  )}
                  {item.ungated_link && (
                    <a href={item.ungated_link} target="_blank" rel="noopener noreferrer" className="result-link">
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
      </main>
    </div>
  );
}

export default App;

import React, { useState, useEffect, useRef } from 'react';
import { Search, Database, Filter, Download, ExternalLink, Loader2, Sparkles } from 'lucide-react';
import { supabaseClient } from './services/supabase';
import { convertNaturalLanguageToQuery, rankResultsByRelevance } from './services/nlp';
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
  const firstRenderRef = useRef(true);

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
      const allTypes = [...new Set([...selectedTypes, ...(aiParams.types || [])])];
      const allStates = [...new Set([...selectedStates, ...(aiParams.states || [])])];

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

      // Apply comprehensive keyword search across ALL columns
      if (aiParams.searchTerms && aiParams.searchTerms.length > 0) {
        // Build search conditions for each term across all text columns
        const searchConditions = aiParams.searchTerms.flatMap(term => {
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
      } else if (searchConfig.useRawQueryFallback) {
        // Fallback: search all columns with the raw query
        const searchTerm = query.trim().toLowerCase();
        queryBuilder = queryBuilder.or(
          `title.ilike.%${searchTerm}%,` +
          `summary.ilike.%${searchTerm}%,` +
          `platform.ilike.%${searchTerm}%,` +
          `tags.ilike.%${searchTerm}%,` +
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
        finalResults = rankingResult.rankedResults;
        rankingExplanation = rankingResult.explanation;
        topMatches = rankingResult.topMatches;

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

          {/* AI Insight Display */}
          {aiInsight && (
            <div className="ai-insight">
              <div className="ai-insight-header">
                <Sparkles size={16} />
                <span>AI Search Assistant</span>
              </div>

              {/* Conversational AI Response */}
              {aiInsight.aiResponse && (
                <div className="ai-conversation">
                  <p className="ai-response">{aiInsight.aiResponse}</p>

                  {/* Primary Recommendations with Links */}
                  {aiInsight.primaryRecommendations?.length > 0 && (
                    <div className="ai-recommendations">
                      <span className="ai-rec-label">Recommended:</span>
                      {aiInsight.primaryRecommendations.map((rec, idx) => {
                        const item = results[rec.id];
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

                  {/* Additional Resources */}
                  {aiInsight.additionalResources?.length > 0 && (
                    <div className="ai-recommendations ai-additional secondary">
                      <span className="ai-rec-label">Also relevant:</span>
                      {aiInsight.additionalResources.slice(0, 3).map((rec, idx) => {
                        const item = results[rec.id];
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

          {error && (
            <div className="error">
              <p>Error: {error}</p>
            </div>
          )}
        </div>

        <div className="results-container">
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

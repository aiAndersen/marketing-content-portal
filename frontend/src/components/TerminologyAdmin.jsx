import React, { useState, useEffect } from 'react';
import { Check, X, Plus, RefreshCw, Brain, TrendingUp, AlertCircle, Search, Sparkles, Copy, ChevronDown, ChevronRight, Flag, BarChart3, MapPin } from 'lucide-react';
import { supabaseClient } from '../services/supabase';
import {
  getPendingSuggestions,
  approveSuggestion,
  rejectSuggestion,
  clearTerminologyCache,
  getFallbackMappings
} from '../services/terminology';

// OpenAI API key from environment
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

/**
 * TerminologyAdmin Component
 * Admin interface for managing the Terminology Brain
 * - View and approve/reject suggestions from the log analyzer
 * - Add new mappings manually
 * - View usage statistics
 */
function TerminologyAdmin() {
  const [activeTab, setActiveTab] = useState('suggestions');
  const [suggestions, setSuggestions] = useState([]);
  const [allMappings, setAllMappings] = useState([]);
  const [analysisReports, setAnalysisReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState('');
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [lastAnalysis, setLastAnalysis] = useState(null); // Store last analysis for display
  const [searchFilter, setSearchFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');

  // Reports dashboard state
  const [selectedReport, setSelectedReport] = useState(null);
  const [showAllPopularity, setShowAllPopularity] = useState(false);
  const [showAllGaps, setShowAllGaps] = useState(false);
  const [reportSortBy, setReportSortBy] = useState('count'); // 'count' or 'avg_recommendations'

  // New mapping form state
  const [newMapping, setNewMapping] = useState({
    map_type: 'content_type',
    user_term: '',
    canonical_term: ''
  });

  const mapTypes = ['content_type', 'competitor', 'persona', 'topic', 'feature', 'state'];

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      // Load pending suggestions (graceful failure)
      const pendingSuggestions = await getPendingSuggestions();
      setSuggestions(pendingSuggestions || []);

      // Load all active mappings with usage stats (graceful failure)
      try {
        const { data: mappings, error: mappingsError } = await supabaseClient
          .from('terminology_map')
          .select('*')
          .eq('is_active', true)
          .order('usage_count', { ascending: false });

        if (!mappingsError && mappings) {
          setAllMappings(mappings);
        } else {
          console.warn('[TerminologyAdmin] terminology_map table not available:', mappingsError?.message);
          setAllMappings([]);
        }
      } catch (e) {
        console.warn('[TerminologyAdmin] Failed to load mappings:', e);
        setAllMappings([]);
      }

      // Load recent analysis reports (graceful failure)
      try {
        const { data: reports, error: reportsError } = await supabaseClient
          .from('log_analysis_reports')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(10);

        if (!reportsError && reports) {
          setAnalysisReports(reports);
        } else {
          console.warn('[TerminologyAdmin] log_analysis_reports table not available:', reportsError?.message);
          setAnalysisReports([]);
        }
      } catch (e) {
        console.warn('[TerminologyAdmin] Failed to load reports:', e);
        setAnalysisReports([]);
      }

    } catch (err) {
      console.error('Failed to load data:', err);
      setError('Some features may be unavailable. Run database migrations to enable full functionality.');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprove(id) {
    setActionLoading(id);
    setError(null);
    try {
      await approveSuggestion(id);
      setSuggestions(prev => prev.filter(s => s.id !== id));
      setSuccess('Suggestion approved and activated!');
      setTimeout(() => setSuccess(null), 3000);
      // Reload mappings to show the new one
      loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReject(id) {
    setActionLoading(id);
    setError(null);
    try {
      await rejectSuggestion(id);
      setSuggestions(prev => prev.filter(s => s.id !== id));
      setSuccess('Suggestion rejected and removed.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAddMapping(e) {
    e.preventDefault();
    if (!newMapping.user_term || !newMapping.canonical_term) {
      setError('Please fill in both user term and canonical term');
      return;
    }

    setActionLoading('new');
    setError(null);

    try {
      const { error: insertError } = await supabaseClient
        .from('terminology_map')
        .insert({
          map_type: newMapping.map_type,
          user_term: newMapping.user_term.toLowerCase(),
          canonical_term: newMapping.canonical_term,
          source: 'manual',
          is_verified: true,
          is_active: true
        });

      if (insertError) throw insertError;

      clearTerminologyCache();
      setNewMapping({ map_type: 'content_type', user_term: '', canonical_term: '' });
      setSuccess('Mapping added successfully!');
      setTimeout(() => setSuccess(null), 3000);
      loadData();
    } catch (err) {
      setError(err.message);
    } finally {
      setActionLoading(null);
    }
  }

  /**
   * Generate terminology suggestions by analyzing recent prompt logs with AI
   */
  async function generateSuggestions() {
    if (!OPENAI_API_KEY) {
      setError('OpenAI API key not configured. Cannot generate suggestions.');
      return;
    }

    setGenerating(true);
    setGenerationProgress('Fetching recent search logs...');
    setError(null);

    try {
      // Step 1: Fetch recent prompt logs (last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data: logs, error: logsError } = await supabaseClient
        .from('ai_prompt_logs')
        .select('query, complexity, query_type, detected_states, recommendations_count, created_at')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(150);

      if (logsError) {
        throw new Error(`Failed to fetch logs: ${logsError.message}`);
      }

      if (!logs || logs.length === 0) {
        setSuccess('No recent search logs found to analyze.');
        setGenerating(false);
        return;
      }

      setGenerationProgress(`Analyzing ${logs.length} search queries...`);

      // Step 2: Get existing mappings to avoid duplicates
      const existingMappings = getFallbackMappings();
      const existingTerms = new Set();
      Object.values(existingMappings).forEach(typeMap => {
        Object.keys(typeMap).forEach(term => existingTerms.add(term.toLowerCase()));
      });
      allMappings.forEach(m => existingTerms.add(m.user_term.toLowerCase()));

      // Step 3: Prepare comprehensive log summary for AI
      const logSummary = logs.map(log => ({
        query: log.query,
        results: log.recommendations_count || 0,
        complexity: log.complexity || 'standard',
        type: log.query_type || 'search',
        states: log.detected_states || []
      }));

      console.log('[TerminologyAdmin] Loaded logs:', logSummary.length, 'Sample:', logSummary.slice(0, 3));

      // Get unique queries (deduplicate similar searches)
      const uniqueQueries = [...new Set(logSummary.map(l => l.query?.toLowerCase().trim()).filter(Boolean))];

      // All queries for comprehensive analysis with metadata
      const allQueriesForAnalysis = uniqueQueries.slice(0, 100).map(q => {
        const match = logSummary.find(l => l.query?.toLowerCase().trim() === q);
        return {
          query: q,
          results: match?.results || 0,
          complexity: match?.complexity || 'standard',
          type: match?.type || 'search'
        };
      });

      setGenerationProgress('Analyzing query patterns and terminology gaps...');

      // Step 4: Also fetch our content types and tags to identify gaps
      let contentTypes = [];
      let existingTags = [];
      try {
        const { data: content } = await supabaseClient
          .from('marketing_content')
          .select('type, tags, auto_tags')
          .limit(500);

        if (content) {
          contentTypes = [...new Set(content.map(c => c.type).filter(Boolean))];
          const allTags = content.flatMap(c => [
            ...(c.tags?.split(',').map(t => t.trim().toLowerCase()) || []),
            ...(c.auto_tags?.split(',').map(t => t.trim().toLowerCase()) || [])
          ]).filter(Boolean);
          existingTags = [...new Set(allTags)].slice(0, 100);
        }
      } catch (err) {
        console.warn('Failed to fetch content metadata:', err);
      }

      // Step 5: Call OpenAI to analyze and suggest mappings
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.3,
          messages: [
            {
              role: 'system',
              content: `You are a search quality analyst for SchooLinks Marketing Content Portal.
The portal contains marketing content about K-12 education technology for college and career readiness.

CONTENT TYPES IN DATABASE:
${contentTypes.join(', ')}

SAMPLE TAGS/TOPICS WE HAVE CONTENT FOR:
${existingTags.slice(0, 50).join(', ')}

EXISTING TERMINOLOGY MAPPINGS (already handled):
${JSON.stringify(existingMappings, null, 2)}

TASK: Analyze ALL search queries and identify terminology gaps. Look for:

1. **Content Type Synonyms**: Users may say "case study" but we call it "Customer Story", "whitepaper" but we call it "Ebook", "fact sheet" but we call it "1-Pager"

2. **Misspellings**: Common typos of content types, competitor names, or education terms

3. **Competitor Variations**: naviance/navience, xello/zelo, powerschool/power school, majorclarity

4. **Education Acronyms**: CCR, WBL, FAFSA, SEL, CTE, ICAP, PLP, ILP, etc.

5. **Persona Terms**: counselor/guidance counselor/school counselor → "counselors", admin/principal/superintendent → "administrators"

6. **Topic Synonyms**: Terms users search for that map to topics we have content about

7. **State-Specific Terms**: State education acronyms (ICAP=Colorado, ECAP=Arizona, etc.)

IMPORTANT:
- Only suggest mappings NOT already in existing mappings
- Focus on terms that appear in multiple queries
- Include confidence score based on how clear the mapping is
- The "canonical_term" should match actual content types, tags, or standard terms we use

Return ONLY valid JSON:
{
  "suggestions": [
    {"user_term": "what users typed", "canonical_term": "correct term", "map_type": "content_type|competitor|persona|topic|feature|state", "confidence": 0.8, "reason": "why this mapping makes sense"}
  ],
  "content_gaps": ["topics users searched for that we may not have content about"],
  "analysis_summary": "Key patterns and observations"
}`
            },
            {
              role: 'user',
              content: `Analyze these ${allQueriesForAnalysis.length} search queries from our portal:

ALL SEARCH QUERIES (with result counts):
${JSON.stringify(allQueriesForAnalysis, null, 2)}

Look for:
1. Terms that should map to our content types
2. Misspellings or variations of competitor names
3. Education acronyms that need expansion
4. Persona terms that could be standardized
5. Topics users search for that we should tag content with

Suggest terminology mappings that would improve search quality.`
            }
          ]
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error: ${errText}`);
      }

      const aiResult = await response.json();
      const content = aiResult.choices?.[0]?.message?.content || '';

      // Parse AI response
      let suggestions = [];
      let summary = '';
      let contentGaps = [];
      try {
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          suggestions = parsed.suggestions || [];
          summary = parsed.analysis_summary || '';
          contentGaps = parsed.content_gaps || [];
        }
      } catch (parseErr) {
        console.error('Failed to parse AI response:', parseErr, content);
        throw new Error('AI returned invalid response format');
      }

      // Store analysis for display
      const analysisResult = {
        timestamp: new Date().toISOString(),
        queriesAnalyzed: allQueriesForAnalysis,
        aiSuggestions: suggestions,
        contentGaps: contentGaps,
        summary: summary,
        skippedSuggestions: []
      };

      // Log content gaps for visibility
      if (contentGaps.length > 0) {
        console.log('[TerminologyAdmin] Content gaps identified:', contentGaps);
      }
      console.log('[TerminologyAdmin] AI suggestions:', suggestions);

      setGenerationProgress(`Found ${suggestions.length} suggestions. Processing...`);

      // Step 6: Insert suggestions into database (filter duplicates)
      let insertedCount = 0;
      for (const suggestion of suggestions) {
        // Skip if term already exists
        if (existingTerms.has(suggestion.user_term.toLowerCase())) {
          analysisResult.skippedSuggestions.push({
            ...suggestion,
            reason: 'Already exists in mappings'
          });
          continue;
        }

        try {
          const { error: insertError } = await supabaseClient
            .from('terminology_map')
            .insert({
              map_type: suggestion.map_type || 'content_type',
              user_term: suggestion.user_term.toLowerCase(),
              canonical_term: suggestion.canonical_term,
              source: 'ai_suggested',
              confidence: suggestion.confidence || 0.7,
              is_verified: false,
              is_active: false // Requires approval
            });

          if (!insertError) {
            insertedCount++;
            existingTerms.add(suggestion.user_term.toLowerCase());
          } else {
            analysisResult.skippedSuggestions.push({
              ...suggestion,
              reason: `DB error: ${insertError.message}`
            });
          }
        } catch (err) {
          console.warn('Failed to insert suggestion:', suggestion, err);
          analysisResult.skippedSuggestions.push({
            ...suggestion,
            reason: err.message
          });
        }
      }

      analysisResult.insertedCount = insertedCount;
      setLastAnalysis(analysisResult);

      // Reload data to show new suggestions
      await loadData();

      const statusMsg = insertedCount > 0
        ? `Generated ${insertedCount} new suggestions for review!`
        : suggestions.length > 0
          ? `All ${suggestions.length} AI suggestions already exist in mappings.`
          : 'No new terminology gaps found.';

      setSuccess(`${statusMsg} ${summary}`);
    } catch (err) {
      console.error('Failed to generate suggestions:', err);
      setError(err.message || 'Failed to generate suggestions');
    } finally {
      setGenerating(false);
      setGenerationProgress('');
    }
  }

  // Filter mappings based on search and type
  const filteredMappings = allMappings.filter(m => {
    const matchesSearch = searchFilter === '' ||
      m.user_term.toLowerCase().includes(searchFilter.toLowerCase()) ||
      m.canonical_term.toLowerCase().includes(searchFilter.toLowerCase());
    const matchesType = typeFilter === 'all' || m.map_type === typeFilter;
    return matchesSearch && matchesType;
  });

  // Calculate stats
  const stats = {
    totalMappings: allMappings.length,
    pendingSuggestions: suggestions.length,
    topUsed: allMappings.slice(0, 5),
    byType: mapTypes.reduce((acc, type) => {
      acc[type] = allMappings.filter(m => m.map_type === type).length;
      return acc;
    }, {})
  };

  if (loading) {
    return (
      <div className="terminology-admin">
        <div className="admin-loading">
          <RefreshCw className="spin" size={24} />
          <span>Loading Terminology Brain...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="terminology-admin">
      <header className="admin-header">
        <div className="admin-title">
          <Brain size={28} />
          <h1>Terminology Brain</h1>
        </div>
        <p className="admin-subtitle">
          Manage vocabulary mappings for the AI Search Assistant
        </p>
      </header>

      {error && (
        <div className="admin-alert error">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {success && (
        <div className="admin-alert success">
          <Check size={18} />
          <span>{success}</span>
        </div>
      )}

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.totalMappings}</div>
          <div className="stat-label">Active Mappings</div>
        </div>
        <div className="stat-card highlight">
          <div className="stat-value">{stats.pendingSuggestions}</div>
          <div className="stat-label">Pending Review</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.byType.content_type || 0}</div>
          <div className="stat-label">Content Types</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.byType.competitor || 0}</div>
          <div className="stat-label">Competitors</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="admin-tabs">
        <button
          className={`tab ${activeTab === 'suggestions' ? 'active' : ''}`}
          onClick={() => setActiveTab('suggestions')}
        >
          Pending Suggestions
          {suggestions.length > 0 && (
            <span className="tab-badge">{suggestions.length}</span>
          )}
        </button>
        <button
          className={`tab ${activeTab === 'mappings' ? 'active' : ''}`}
          onClick={() => setActiveTab('mappings')}
        >
          All Mappings
        </button>
        <button
          className={`tab ${activeTab === 'add' ? 'active' : ''}`}
          onClick={() => setActiveTab('add')}
        >
          Add New
        </button>
        <button
          className={`tab ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          Analysis Reports
        </button>
      </div>

      {/* Tab Content */}
      <div className="tab-content">
        {/* Pending Suggestions Tab */}
        {activeTab === 'suggestions' && (
          <div className="suggestions-panel">
            {/* Generate Suggestions Button */}
            <div className="suggestions-header">
              <button
                className="btn-generate"
                onClick={generateSuggestions}
                disabled={generating}
              >
                {generating ? (
                  <>
                    <RefreshCw className="spin" size={18} />
                    <span>{generationProgress || 'Analyzing...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={18} />
                    <span>Generate Suggestions from Logs</span>
                  </>
                )}
              </button>
              <p className="suggestions-hint">
                Analyzes recent search queries to identify terminology gaps
              </p>
            </div>

            {/* Last Analysis Results */}
            {lastAnalysis && (
              <div className="analysis-results">
                <h4>Last Analysis Results</h4>
                <div className="analysis-summary">
                  <p><strong>Summary:</strong> {lastAnalysis.summary}</p>
                  <p><strong>Queries Analyzed:</strong> {lastAnalysis.queriesAnalyzed?.length || 0}</p>
                  <p><strong>AI Suggestions:</strong> {lastAnalysis.aiSuggestions?.length || 0}
                    {lastAnalysis.skippedSuggestions?.length > 0 &&
                      ` (${lastAnalysis.skippedSuggestions.length} already exist)`}
                  </p>
                  <p><strong>New Mappings Created:</strong> {lastAnalysis.insertedCount || 0}</p>
                </div>

                {lastAnalysis.contentGaps?.length > 0 && (
                  <div className="content-gaps">
                    <h5>Content Gaps Identified</h5>
                    <ul>
                      {lastAnalysis.contentGaps.map((gap, i) => (
                        <li key={i}>{gap}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {lastAnalysis.aiSuggestions?.length > 0 && (
                  <div className="ai-suggestions-preview">
                    <h5>AI Suggested Mappings</h5>
                    <table className="mini-table">
                      <thead>
                        <tr>
                          <th>User Term</th>
                          <th>→</th>
                          <th>Canonical Term</th>
                          <th>Type</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lastAnalysis.aiSuggestions.map((s, i) => {
                          const skipped = lastAnalysis.skippedSuggestions?.find(
                            sk => sk.user_term === s.user_term
                          );
                          return (
                            <tr key={i} className={skipped ? 'skipped' : 'new'}>
                              <td>"{s.user_term}"</td>
                              <td>→</td>
                              <td>"{s.canonical_term}"</td>
                              <td><span className={`type-badge ${s.map_type}`}>{s.map_type}</span></td>
                              <td>{skipped ? '⚠️ Already exists' : '✅ Added'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {lastAnalysis.queriesAnalyzed?.length > 0 && (
                  <details className="queries-analyzed">
                    <summary>View {lastAnalysis.queriesAnalyzed.length} Queries Analyzed</summary>
                    <ul>
                      {lastAnalysis.queriesAnalyzed.slice(0, 20).map((q, i) => (
                        <li key={i}>
                          "{q.query}" <span className="query-meta">({q.results} results, {q.complexity})</span>
                        </li>
                      ))}
                      {lastAnalysis.queriesAnalyzed.length > 20 && (
                        <li className="more">...and {lastAnalysis.queriesAnalyzed.length - 20} more</li>
                      )}
                    </ul>
                  </details>
                )}
              </div>
            )}

            {suggestions.length === 0 ? (
              <div className="empty-state">
                <Check size={48} />
                <h3>All Caught Up!</h3>
                <p>No pending suggestions to review.</p>
                {!lastAnalysis && (
                  <p className="hint">Click the button above to analyze recent searches and generate suggestions.</p>
                )}
              </div>
            ) : (
              <div className="suggestions-list">
                {suggestions.map(suggestion => (
                  <div key={suggestion.id} className="suggestion-card">
                    <div className="suggestion-content">
                      <div className="suggestion-mapping">
                        <span className="user-term">"{suggestion.user_term}"</span>
                        <span className="arrow">→</span>
                        <span className="canonical-term">"{suggestion.canonical_term}"</span>
                      </div>
                      <div className="suggestion-meta">
                        <span className={`type-badge ${suggestion.map_type}`}>
                          {suggestion.map_type}
                        </span>
                        <span className="confidence">
                          {Math.round((suggestion.confidence || 0.5) * 100)}% confidence
                        </span>
                        <span className="source">via {suggestion.source}</span>
                      </div>
                    </div>
                    <div className="suggestion-actions">
                      <button
                        className="btn-approve"
                        onClick={() => handleApprove(suggestion.id)}
                        disabled={actionLoading === suggestion.id}
                      >
                        {actionLoading === suggestion.id ? (
                          <RefreshCw className="spin" size={16} />
                        ) : (
                          <Check size={16} />
                        )}
                        Approve
                      </button>
                      <button
                        className="btn-reject"
                        onClick={() => handleReject(suggestion.id)}
                        disabled={actionLoading === suggestion.id}
                      >
                        <X size={16} />
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* All Mappings Tab */}
        {activeTab === 'mappings' && (
          <div className="mappings-panel">
            <div className="mappings-filters">
              <div className="search-input">
                <Search size={18} />
                <input
                  type="text"
                  placeholder="Search mappings..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
              </div>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="type-select"
              >
                <option value="all">All Types</option>
                {mapTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
              <button className="btn-refresh" onClick={loadData}>
                <RefreshCw size={16} />
              </button>
            </div>

            <div className="mappings-table">
              <table>
                <thead>
                  <tr>
                    <th>User Term</th>
                    <th>Canonical Term</th>
                    <th>Type</th>
                    <th>Usage</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMappings.map(mapping => (
                    <tr key={mapping.id}>
                      <td className="user-term">{mapping.user_term}</td>
                      <td className="canonical-term">{mapping.canonical_term}</td>
                      <td>
                        <span className={`type-badge ${mapping.map_type}`}>
                          {mapping.map_type}
                        </span>
                      </td>
                      <td className="usage-count">
                        {mapping.usage_count > 0 ? (
                          <>
                            <TrendingUp size={14} />
                            {mapping.usage_count}
                          </>
                        ) : (
                          <span className="unused">-</span>
                        )}
                      </td>
                      <td className="source">{mapping.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredMappings.length === 0 && (
                <div className="empty-table">No mappings found</div>
              )}
            </div>
          </div>
        )}

        {/* Add New Tab */}
        {activeTab === 'add' && (
          <div className="add-panel">
            <form onSubmit={handleAddMapping} className="add-form">
              <h3>Add New Mapping</h3>
              <p className="form-hint">
                Map a user search term to the canonical database term.
              </p>

              <div className="form-group">
                <label htmlFor="map_type">Mapping Type</label>
                <select
                  id="map_type"
                  value={newMapping.map_type}
                  onChange={(e) => setNewMapping({ ...newMapping, map_type: e.target.value })}
                >
                  {mapTypes.map(type => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label htmlFor="user_term">User Term</label>
                <input
                  type="text"
                  id="user_term"
                  placeholder="What users type (e.g., 'fact sheet', 'one pager')"
                  value={newMapping.user_term}
                  onChange={(e) => setNewMapping({ ...newMapping, user_term: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label htmlFor="canonical_term">Canonical Term</label>
                <input
                  type="text"
                  id="canonical_term"
                  placeholder="Database term (e.g., '1-Pager', 'Customer Story')"
                  value={newMapping.canonical_term}
                  onChange={(e) => setNewMapping({ ...newMapping, canonical_term: e.target.value })}
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                disabled={actionLoading === 'new'}
              >
                {actionLoading === 'new' ? (
                  <RefreshCw className="spin" size={16} />
                ) : (
                  <Plus size={16} />
                )}
                Add Mapping
              </button>
            </form>

            <div className="examples-section">
              <h4>Examples by Type</h4>
              <ul>
                <li><strong>content_type:</strong> "fact sheet" → "1-Pager"</li>
                <li><strong>competitor:</strong> "navience" → "naviance"</li>
                <li><strong>persona:</strong> "counselor" → "counselors"</li>
                <li><strong>topic:</strong> "financial aid" → "FAFSA"</li>
                <li><strong>feature:</strong> "kri" → "Key Readiness Indicators"</li>
              </ul>
            </div>
          </div>
        )}

        {/* Analysis Reports Tab - Enhanced Dashboard */}
        {activeTab === 'reports' && (
          <div className="reports-panel">
            {(() => {
              // Separate comprehensive and standard reports
              const comprehensiveReports = analysisReports.filter(r => r.report_type === 'comprehensive');
              const standardReports = analysisReports.filter(r => r.report_type !== 'comprehensive');
              const activeReport = selectedReport || comprehensiveReports[0] || null;

              // Helper to flag a content gap
              async function handleFlagGap(reportId, gapIndex) {
                try {
                  const report = analysisReports.find(r => r.id === reportId);
                  if (!report || !report.content_gaps) return;
                  const updatedGaps = [...report.content_gaps];
                  updatedGaps[gapIndex] = { ...updatedGaps[gapIndex], flagged: !updatedGaps[gapIndex].flagged };
                  const { error: updateError } = await supabaseClient
                    .from('log_analysis_reports')
                    .update({ content_gaps: updatedGaps })
                    .eq('id', reportId);
                  if (!updateError) {
                    setAnalysisReports(prev => prev.map(r =>
                      r.id === reportId ? { ...r, content_gaps: updatedGaps } : r
                    ));
                    setSuccess('Gap priority updated!');
                    setTimeout(() => setSuccess(null), 2000);
                  }
                } catch (err) {
                  console.error('Failed to flag gap:', err);
                }
              }

              function copyToClipboard(text) {
                navigator.clipboard.writeText(text).then(() => {
                  setSuccess('Copied to clipboard!');
                  setTimeout(() => setSuccess(null), 2000);
                }).catch(() => {});
              }

              return (
                <>
                  {/* Report Selector */}
                  <div className="report-selector">
                    {comprehensiveReports.length > 0 ? (
                      <select
                        className="report-select"
                        value={activeReport?.id || ''}
                        onChange={(e) => {
                          const r = analysisReports.find(rep => rep.id === e.target.value);
                          setSelectedReport(r);
                          setShowAllPopularity(false);
                          setShowAllGaps(false);
                        }}
                      >
                        {comprehensiveReports.map(r => (
                          <option key={r.id} value={r.id}>
                            {new Date(r.analysis_date).toLocaleDateString()} - {r.logs_analyzed} queries ({r.report_type})
                          </option>
                        ))}
                      </select>
                    ) : (
                      <div className="empty-state" style={{ padding: '2rem' }}>
                        <BarChart3 size={48} />
                        <h3>No Comprehensive Reports Yet</h3>
                        <p>Run the popularity report to generate analysis:</p>
                        <code>python3 scripts/query_popularity_report.py --days 30</code>
                      </div>
                    )}
                  </div>

                  {activeReport && (
                    <>
                      {/* Executive Summary */}
                      {activeReport.executive_summary && (
                        <div className="report-executive-summary">
                          <div className="executive-header">
                            <h4><Sparkles size={16} /> Executive Summary</h4>
                            <button
                              className="btn-copy"
                              onClick={() => copyToClipboard(activeReport.executive_summary)}
                              title="Copy to clipboard"
                            >
                              <Copy size={14} /> Copy
                            </button>
                          </div>
                          <div
                            className="executive-text"
                            dangerouslySetInnerHTML={{ __html: formatMarkdown(activeReport.executive_summary) }}
                          />
                        </div>
                      )}

                      {/* Key Metrics Cards */}
                      <div className="report-metrics-grid">
                        <div className="report-metric-card">
                          <div className="metric-value">{activeReport.logs_analyzed || 0}</div>
                          <div className="metric-label">Queries Analyzed</div>
                        </div>
                        <div className="report-metric-card">
                          <div className="metric-value">{activeReport.avg_recommendations_count || 0}</div>
                          <div className="metric-label">Avg Results</div>
                        </div>
                        <div className="report-metric-card highlight-red">
                          <div className="metric-value">{activeReport.zero_result_queries || 0}</div>
                          <div className="metric-label">Zero Results</div>
                        </div>
                        <div className="report-metric-card">
                          <div className="metric-value">{activeReport.competitor_query_count || 0}</div>
                          <div className="metric-label">Competitor Queries</div>
                        </div>
                      </div>

                      {/* Query Popularity Ranking */}
                      {activeReport.popularity_ranking && activeReport.popularity_ranking.length > 0 && (
                        <div className="report-section">
                          <div className="section-header">
                            <h4><TrendingUp size={16} /> Query Popularity Ranking</h4>
                            <div className="section-controls">
                              <select
                                value={reportSortBy}
                                onChange={(e) => setReportSortBy(e.target.value)}
                                className="sort-select"
                              >
                                <option value="count">Sort by Count</option>
                                <option value="avg_recommendations">Sort by Avg Results</option>
                              </select>
                            </div>
                          </div>
                          <div className="popularity-table-wrapper">
                            <table className="popularity-table">
                              <thead>
                                <tr>
                                  <th>#</th>
                                  <th>Query</th>
                                  <th>Count</th>
                                  <th>Avg Results</th>
                                </tr>
                              </thead>
                              <tbody>
                                {[...activeReport.popularity_ranking]
                                  .sort((a, b) => reportSortBy === 'count' ? b.count - a.count : a.avg_recommendations - b.avg_recommendations)
                                  .slice(0, showAllPopularity ? undefined : 30)
                                  .map((item, idx) => {
                                    const rowClass = item.avg_recommendations === 0 ? 'row-danger'
                                      : item.avg_recommendations < 2 ? 'row-warning' : '';
                                    return (
                                      <tr key={idx} className={rowClass}>
                                        <td>{idx + 1}</td>
                                        <td className="query-cell">{item.query}</td>
                                        <td className="count-cell">{item.count}</td>
                                        <td className="recs-cell">{item.avg_recommendations}</td>
                                      </tr>
                                    );
                                  })}
                              </tbody>
                            </table>
                          </div>
                          {activeReport.popularity_ranking.length > 30 && (
                            <button
                              className="btn-show-all"
                              onClick={() => setShowAllPopularity(!showAllPopularity)}
                            >
                              {showAllPopularity ? (
                                <><ChevronRight size={14} /> Show Less</>
                              ) : (
                                <><ChevronDown size={14} /> Show All ({activeReport.popularity_ranking.length})</>
                              )}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Content Gaps */}
                      {activeReport.content_gaps && activeReport.content_gaps.length > 0 && (
                        <div className="report-section">
                          <div className="section-header">
                            <h4><AlertCircle size={16} /> Content Gaps ({activeReport.content_gaps.length})</h4>
                          </div>
                          <div className="gaps-list">
                            {[...activeReport.content_gaps]
                              .sort((a, b) => (b.flagged ? 1 : 0) - (a.flagged ? 1 : 0) || b.gap_score - a.gap_score)
                              .slice(0, showAllGaps ? undefined : 15)
                              .map((gap, idx) => {
                                const originalIdx = activeReport.content_gaps.findIndex(g => g.query === gap.query);
                                return (
                                  <div key={idx} className={`gap-card severity-${gap.gap_severity} ${gap.flagged ? 'flagged' : ''}`}>
                                    <div className="gap-content">
                                      <div className="gap-query">"{gap.query}"</div>
                                      <div className="gap-meta">
                                        <span className={`severity-badge ${gap.gap_severity}`}>
                                          {gap.gap_severity.toUpperCase()}
                                        </span>
                                        <span>{gap.search_count} searches</span>
                                        <span>{gap.avg_recommendations} avg results</span>
                                        {gap.content_matches_found !== undefined && (
                                          <span>{gap.content_matches_found} content matches</span>
                                        )}
                                      </div>
                                    </div>
                                    <button
                                      className={`btn-flag ${gap.flagged ? 'flagged' : ''}`}
                                      onClick={() => handleFlagGap(activeReport.id, originalIdx)}
                                      title={gap.flagged ? 'Unflag priority' : 'Flag as priority'}
                                    >
                                      <Flag size={14} />
                                      {gap.flagged ? 'Priority' : 'Flag'}
                                    </button>
                                    {/* AI Content Recommendations */}
                                    {gap.ai_recommendations && gap.ai_recommendations.length > 0 && (
                                      <div className="gap-ai-recs">
                                        <div className="ai-recs-header">
                                          <Sparkles size={12} /> AI Recommended Content
                                        </div>
                                        {gap.ai_recommendations.map((rec, rIdx) => (
                                          <div key={rIdx} className="ai-rec-item">
                                            <div className="ai-rec-title">
                                              <span className={`priority-dot ${rec.priority || 'medium'}`} />
                                              <strong>[{rec.content_type}]</strong> {rec.title}
                                            </div>
                                            <div className="ai-rec-meta">
                                              <span>For: {rec.target_audience}</span>
                                              {rec.rationale && (
                                                <span className="ai-rec-rationale">{rec.rationale}</span>
                                              )}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                          {activeReport.content_gaps.length > 15 && (
                            <button
                              className="btn-show-all"
                              onClick={() => setShowAllGaps(!showAllGaps)}
                            >
                              {showAllGaps ? 'Show Less' : `Show All (${activeReport.content_gaps.length})`}
                            </button>
                          )}
                        </div>
                      )}

                      {/* Terminology Suggestions from Report */}
                      {activeReport.suggested_mappings && activeReport.suggested_mappings.length > 0 && (
                        <div className="report-section">
                          <div className="section-header">
                            <h4><Brain size={16} /> Terminology Suggestions ({activeReport.suggested_mappings.length})</h4>
                          </div>
                          <div className="report-suggestions-list">
                            {activeReport.suggested_mappings.map((s, idx) => {
                              // Find matching pending suggestion to enable approve/reject
                              const pendingSuggestion = suggestions.find(
                                ps => ps.user_term === s.user_term && ps.canonical_term === s.canonical_term
                              );
                              return (
                                <div key={idx} className="report-suggestion-card">
                                  <div className="suggestion-content">
                                    <div className="suggestion-mapping">
                                      <span className="user-term">"{s.user_term}"</span>
                                      <span className="arrow">{'\u2192'}</span>
                                      <span className="canonical-term">"{s.canonical_term}"</span>
                                    </div>
                                    <div className="suggestion-meta">
                                      <span className={`type-badge ${s.map_type}`}>{s.map_type}</span>
                                      {s.confidence && (
                                        <span className="confidence">{Math.round(s.confidence * 100)}%</span>
                                      )}
                                      {s.reason && (
                                        <span className="reason">{s.reason}</span>
                                      )}
                                    </div>
                                  </div>
                                  {pendingSuggestion && (
                                    <div className="suggestion-actions">
                                      <button
                                        className="btn-approve"
                                        onClick={() => handleApprove(pendingSuggestion.id)}
                                        disabled={actionLoading === pendingSuggestion.id}
                                      >
                                        <Check size={14} /> Approve
                                      </button>
                                      <button
                                        className="btn-reject"
                                        onClick={() => handleReject(pendingSuggestion.id)}
                                        disabled={actionLoading === pendingSuggestion.id}
                                      >
                                        <X size={14} /> Reject
                                      </button>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* State & Competitor Mini-Cards */}
                      <div className="report-mini-cards-row">
                        {/* State Coverage */}
                        {activeReport.state_coverage && activeReport.state_coverage.states && (
                          <div className="report-section mini-card">
                            <h4><MapPin size={16} /> State Coverage</h4>
                            <div className="mini-card-list">
                              {activeReport.state_coverage.states.slice(0, 8).map((s, idx) => (
                                <div key={idx} className={`mini-item rating-${s.coverage_rating}`}>
                                  <span className="mini-label">{s.state}</span>
                                  <span className="mini-count">{s.query_count}x</span>
                                  <span className={`mini-rating ${s.coverage_rating}`}>{s.coverage_rating}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Competitor Intelligence */}
                        {activeReport.competitor_analysis && activeReport.competitor_analysis.competitors && (
                          <div className="report-section mini-card">
                            <h4><Search size={16} /> Competitor Mentions</h4>
                            <div className="mini-card-list">
                              {activeReport.competitor_analysis.competitors.slice(0, 8).map((c, idx) => (
                                <div key={idx} className={`mini-item rating-${c.result_quality}`}>
                                  <span className="mini-label">{c.name}</span>
                                  <span className="mini-count">{c.mention_count}x</span>
                                  <span className={`mini-rating ${c.result_quality}`}>{c.result_quality}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}

                  {/* Standard Reports (collapsed) */}
                  {standardReports.length > 0 && (
                    <details className="standard-reports-section">
                      <summary>Standard Analysis Reports ({standardReports.length})</summary>
                      <div className="reports-list">
                        {standardReports.map(report => (
                          <div key={report.id} className="report-card compact">
                            <div className="report-header">
                              <h4>{new Date(report.analysis_date).toLocaleDateString()}</h4>
                              <span className="report-meta">{report.logs_analyzed} queries</span>
                            </div>
                            <p className="report-summary">{report.summary}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Convert markdown text to formatted HTML for the executive summary.
 */
function formatMarkdown(text) {
  if (!text) return '';
  return text
    // Headers
    .replace(/^### (.*?)$/gm, '<h5 class="exec-h3">$1</h5>')
    .replace(/^## (.*?)$/gm, '<h4 class="exec-h2">$1</h4>')
    .replace(/^# (.*?)$/gm, '<h3 class="exec-h1">$1</h3>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Numbered list items: "1. **Text** - rest" or "1. Text"
    .replace(/^\s*(\d+)\.\s+/gm, '<li class="exec-li numbered">')
    // Bullet points
    .replace(/^\s*[-•]\s+/gm, '<li class="exec-li">')
    // Close list items at next newline
    .replace(/<\/li>\n/g, '</li>\n')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li[\s\S]*?<\/li>\n?)+/g, '<ul class="exec-list">$&</ul>')
    // Paragraphs from double newlines
    .replace(/\n\n/g, '</p><p>')
    // Single newlines that aren't inside lists
    .replace(/(?<!<\/li>)\n(?!<)/g, '<br/>')
    // Clean up
    .replace(/<p>\s*<ul/g, '<ul')
    .replace(/<\/ul>\s*<\/p>/g, '</ul>')
    .replace(/<p>\s*<h/g, '<h')
    .replace(/<\/h[3-5]>\s*<\/p>/g, (m) => m.replace('</p>', ''))
    .replace(/<p>\s*<\/p>/g, '');
}

export default TerminologyAdmin;

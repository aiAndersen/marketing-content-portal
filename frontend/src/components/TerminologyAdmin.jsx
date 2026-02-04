import React, { useState, useEffect } from 'react';
import { Check, X, Plus, RefreshCw, Brain, TrendingUp, AlertCircle, Search, Sparkles } from 'lucide-react';
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

        {/* Analysis Reports Tab */}
        {activeTab === 'reports' && (
          <div className="reports-panel">
            {analysisReports.length === 0 ? (
              <div className="empty-state">
                <AlertCircle size={48} />
                <h3>No Reports Yet</h3>
                <p>Run the log analyzer to generate analysis reports:</p>
                <code>python3 scripts/log_analyzer.py --days 7</code>
              </div>
            ) : (
              <div className="reports-list">
                {analysisReports.map(report => (
                  <div key={report.id} className="report-card">
                    <div className="report-header">
                      <h4>{new Date(report.analysis_date).toLocaleDateString()}</h4>
                      <span className="report-meta">
                        {report.logs_analyzed} queries analyzed
                      </span>
                    </div>
                    <p className="report-summary">{report.summary}</p>
                    <div className="report-stats">
                      <div className="report-stat">
                        <span className="label">Avg Recommendations</span>
                        <span className="value">{report.avg_recommendations_count || 0}</span>
                      </div>
                      <div className="report-stat">
                        <span className="label">Zero Results</span>
                        <span className="value">{report.zero_result_queries || 0}</span>
                      </div>
                      <div className="report-stat">
                        <span className="label">Competitor Queries</span>
                        <span className="value">{report.competitor_query_count || 0}</span>
                      </div>
                    </div>
                    {report.issues_identified && report.issues_identified.length > 0 && (
                      <div className="report-issues">
                        <strong>Issues Found:</strong>
                        <ul>
                          {report.issues_identified.slice(0, 3).map((issue, idx) => (
                            <li key={idx}>{issue.issue || issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default TerminologyAdmin;

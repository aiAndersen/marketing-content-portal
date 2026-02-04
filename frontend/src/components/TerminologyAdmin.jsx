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
        .select('query, recommendations_count, response')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

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

      // Step 3: Prepare log summary for AI
      const logSummary = logs.map(log => ({
        query: log.query,
        results: log.recommendations_count || 0
      }));

      // Focus on queries with poor results
      const poorResults = logSummary.filter(l => l.results < 3);
      const goodResults = logSummary.filter(l => l.results >= 3).slice(0, 20);

      setGenerationProgress('Identifying terminology gaps with AI...');

      // Step 4: Call OpenAI to analyze and suggest mappings
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
              content: `You are a search quality analyst for a marketing content portal.
The portal contains: Blogs, Videos, Video Clips, Customer Stories, 1-Pagers, Ebooks, Webinars, Press Releases.

EXISTING TERMINOLOGY MAPPINGS (already handled):
${JSON.stringify(existingMappings, null, 2)}

TASK: Analyze search queries and suggest NEW terminology mappings that would improve search results.
Focus on:
1. Misspellings of content types (e.g., "case study" should map to "Customer Story")
2. Alternative phrases users might use (e.g., "whitepaper" → "Ebook")
3. Competitor name misspellings (naviance, xello, powerschool, majorclarity)
4. Abbreviations (e.g., "wbl" → "work-based learning")
5. Persona variations (e.g., "guidance counselor" → "counselors")

IMPORTANT: Only suggest mappings that are NOT already in the existing mappings above.
Only suggest high-confidence mappings where the intent is clear.

Return ONLY valid JSON in this format:
{
  "suggestions": [
    {"user_term": "term users typed", "canonical_term": "correct database term", "map_type": "content_type|competitor|persona|topic|feature", "confidence": 0.8, "reason": "brief explanation"}
  ],
  "analysis_summary": "Brief summary of patterns observed"
}`
            },
            {
              role: 'user',
              content: `Analyze these search queries:

QUERIES WITH POOR RESULTS (< 3 matches):
${JSON.stringify(poorResults, null, 2)}

QUERIES WITH GOOD RESULTS (for reference):
${JSON.stringify(goodResults, null, 2)}

Suggest terminology mappings that would help the poor-performing queries find better results.`
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
      try {
        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          suggestions = parsed.suggestions || [];
          summary = parsed.analysis_summary || '';
        }
      } catch (parseErr) {
        console.error('Failed to parse AI response:', parseErr, content);
        throw new Error('AI returned invalid response format');
      }

      if (suggestions.length === 0) {
        setSuccess(`Analysis complete. ${summary || 'No new terminology gaps identified.'}`);
        setGenerating(false);
        return;
      }

      setGenerationProgress(`Found ${suggestions.length} suggestions. Saving...`);

      // Step 5: Insert suggestions into database
      let insertedCount = 0;
      for (const suggestion of suggestions) {
        // Skip if term already exists
        if (existingTerms.has(suggestion.user_term.toLowerCase())) {
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
          }
        } catch (err) {
          console.warn('Failed to insert suggestion:', suggestion, err);
        }
      }

      // Reload data to show new suggestions
      await loadData();

      setSuccess(`Generated ${insertedCount} new suggestions for review! ${summary}`);
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

            {suggestions.length === 0 ? (
              <div className="empty-state">
                <Check size={48} />
                <h3>All Caught Up!</h3>
                <p>No pending suggestions to review.</p>
                <p className="hint">Click the button above to analyze recent searches and generate suggestions.</p>
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

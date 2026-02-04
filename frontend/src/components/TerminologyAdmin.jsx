import React, { useState, useEffect } from 'react';
import { Check, X, Plus, RefreshCw, Brain, TrendingUp, AlertCircle, Search } from 'lucide-react';
import { supabaseClient } from '../services/supabase';
import {
  getPendingSuggestions,
  approveSuggestion,
  rejectSuggestion,
  clearTerminologyCache
} from '../services/terminology';

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
      // Load pending suggestions
      const pendingSuggestions = await getPendingSuggestions();
      setSuggestions(pendingSuggestions);

      // Load all active mappings with usage stats
      const { data: mappings, error: mappingsError } = await supabaseClient
        .from('terminology_map')
        .select('*')
        .eq('is_active', true)
        .order('usage_count', { ascending: false });

      if (mappingsError) throw mappingsError;
      setAllMappings(mappings || []);

      // Load recent analysis reports
      const { data: reports, error: reportsError } = await supabaseClient
        .from('log_analysis_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (reportsError) throw reportsError;
      setAnalysisReports(reports || []);

    } catch (err) {
      console.error('Failed to load data:', err);
      setError(err.message);
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
            {suggestions.length === 0 ? (
              <div className="empty-state">
                <Check size={48} />
                <h3>All Caught Up!</h3>
                <p>No pending suggestions to review.</p>
                <p className="hint">Run the log analyzer to generate new suggestions:</p>
                <code>python3 scripts/log_analyzer.py --days 7 --auto-suggest-terms</code>
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

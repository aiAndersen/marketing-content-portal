import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart3,
  Download,
  Copy,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  MapPin,
  FileText,
  Tag,
  TrendingUp,
  TrendingDown,
  Users,
  Video,
  Loader2,
  ExternalLink,
  Sparkles,
  Calendar
} from 'lucide-react';
import { supabaseClient } from '../services/supabase';

// OpenAI API key from environment
const OPENAI_API_KEY = import.meta.env.VITE_OPENAI_API_KEY;

/**
 * WeeklyGTMReport Component
 * Presentation-ready weekly marketing content report for GTM meetings
 */
function WeeklyGTMReport() {
  const [reportData, setReportData] = useState([]);
  const [allContentData, setAllContentData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insights, setInsights] = useState('');
  const [dateRange, setDateRange] = useState({ from: null, to: null });
  const [tableExpanded, setTableExpanded] = useState(false);
  const [error, setError] = useState(null);

  // Auto-generate report on mount
  useEffect(() => {
    generateReport();
    // Also fetch all content for week-over-week comparison
    fetchAllContent();
  }, []);

  async function fetchAllContent() {
    try {
      const { data } = await supabaseClient
        .from('marketing_content')
        .select('created_at, type, state')
        .order('created_at', { ascending: false })
        .limit(1000);
      setAllContentData(data || []);
    } catch (err) {
      console.error('Failed to fetch all content:', err);
    }
  }

  async function generateReport() {
    setLoading(true);
    setError(null);

    try {
      // Calculate date range (last 7 days)
      const dateTo = new Date();
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - 7);

      setDateRange({ from: dateFrom, to: dateTo });

      // Fetch last 7 days of content
      const { data, error: fetchError } = await supabaseClient
        .from('marketing_content')
        .select('*')
        .gte('created_at', dateFrom.toISOString())
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      setReportData(data || []);

      // Generate AI insights
      if (data && data.length > 0) {
        await generateInsights(data);
      }
    } catch (err) {
      console.error('Failed to generate GTM report:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function generateInsights(data) {
    if (!OPENAI_API_KEY) {
      setInsights('OpenAI API key not configured. Add VITE_OPENAI_API_KEY to .env.local');
      return;
    }

    setInsightsLoading(true);

    try {
      // Build context for AI
      const context = {
        total_items: data.length,
        by_state: countByKey(data, item => normalizeState(item.state) || 'National'),
        by_type: countByKey(data, item => item.type),
        customer_stories: data.filter(d => d.type === 'Customer Story').map(d => ({
          title: d.title,
          state: d.state,
          summary: d.summary?.substring(0, 200)
        })),
        top_topics: sortedEntries(extractTopics(data)).slice(0, 15),
        content_list: data.slice(0, 20).map(d => ({
          type: d.type,
          title: d.title,
          state: d.state,
          tags: d.tags
        }))
      };

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          temperature: 0.3,
          max_tokens: 900,
          messages: [
            {
              role: 'system',
              content: `You are a sales enablement specialist for SchooLinks, a K-12 college and career readiness platform.

Generate a concise Weekly GTM Report summary for the sales team. Focus on:

1. **Territory Highlights** - Which states got new content and why it matters for reps in those regions. Be specific about how content can help close deals.

2. **Customer Story Value** - How new customer stories can be used in sales conversations. Include specific talking points.

3. **Competitive Positioning** - Any content that helps against competitors (Naviance, Xello, PowerSchool, MaiaLearning).

4. **Key Topics** - What themes/subjects are being addressed that resonate with prospects (FAFSA, work-based learning, career exploration, etc.)

5. **Action Items** - 2-3 specific ways sales can use this content THIS WEEK

Be specific, actionable, and concise. Use bullet points. Focus on sales value, not marketing metrics.
Keep the total response under 400 words.`
            },
            {
              role: 'user',
              content: `Generate a Weekly GTM Report for the sales team based on this content released in the last 7 days:\n\n${JSON.stringify(context, null, 2)}`
            }
          ]
        })
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error?.message || `API error: ${response.status}`);
      }

      const result = await response.json();
      const insightsText = result.choices?.[0]?.message?.content || 'No insights generated';
      setInsights(insightsText);
    } catch (err) {
      console.error('Failed to generate insights:', err);
      setInsights(`Failed to generate insights: ${err.message}`);
    } finally {
      setInsightsLoading(false);
    }
  }

  function exportCSV() {
    if (reportData.length === 0) {
      alert('No data to export. Generate the report first.');
      return;
    }

    const headers = ['Date', 'Type', 'Title', 'State', 'Topics', 'Live Link'];
    const rows = reportData.map(item => [
      item.created_at ? new Date(item.created_at).toLocaleDateString() : '',
      item.type || '',
      item.title || '',
      item.state || 'National',
      [item.tags, item.auto_tags].filter(Boolean).join('; '),
      item.live_link || ''
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))
    ].join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly-gtm-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function copyInsights() {
    if (!insights) {
      alert('No insights to copy. Generate the report first.');
      return;
    }

    navigator.clipboard.writeText(insights).then(() => {
      alert('Insights copied to clipboard!');
    }).catch(err => {
      console.error('Failed to copy:', err);
    });
  }

  // Calculate summary stats
  const thisWeekCount = reportData.length;
  const customerStoriesCount = reportData.filter(d => d.type === 'Customer Story').length;
  const videosCount = reportData.filter(d => d.type === 'Video' || d.type === 'Video Clip').length;
  const statesCount = [...new Set(reportData.map(d => d.state).filter(Boolean))].length;

  // Calculate week-over-week change
  const lastWeekStart = new Date();
  lastWeekStart.setDate(lastWeekStart.getDate() - 14);
  const lastWeekEnd = new Date();
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 7);

  const lastWeekCount = allContentData.filter(item => {
    const d = new Date(item.created_at);
    return d >= lastWeekStart && d < lastWeekEnd;
  }).length;

  const weekChange = thisWeekCount - lastWeekCount;

  // Breakdowns
  const byState = countByKey(reportData, item => normalizeState(item.state) || 'National');
  const byType = countByKey(reportData, item => item.type);
  const byTopic = extractTopics(reportData);

  // Customer stories for highlights
  const customerStories = reportData.filter(d => d.type === 'Customer Story').slice(0, 4);

  if (loading) {
    return (
      <div className="gtm-report-loading">
        <Loader2 className="spin" size={32} />
        <p>Generating Weekly GTM Report...</p>
      </div>
    );
  }

  return (
    <div className="gtm-report-panel">
      {/* Toolbar */}
      <div className="gtm-toolbar">
        <button className="gtm-generate-btn" onClick={generateReport} disabled={loading}>
          <RefreshCw size={16} className={loading ? 'spin' : ''} />
          Refresh Report
        </button>
        <div className="gtm-toolbar-actions">
          <button className="gtm-action-btn" onClick={exportCSV} title="Export CSV">
            <Download size={16} /> Export
          </button>
          <button className="gtm-action-btn" onClick={copyInsights} title="Copy Insights">
            <Copy size={16} /> Copy Insights
          </button>
        </div>
      </div>

      {/* Report Header */}
      <div className="gtm-report-header">
        <div className="gtm-report-branding">
          <div className="gtm-logo-badge">
            <BarChart3 size={24} />
          </div>
          <div className="gtm-report-title-group">
            <h1 className="gtm-report-title">Weekly Marketing Content Report</h1>
            <p className="gtm-report-subtitle">SchooLinks Go-To-Market Enablement</p>
          </div>
        </div>
        <div className="gtm-report-meta">
          <div className="gtm-date-range">
            <Calendar size={14} />
            <span>
              {dateRange.from?.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – {dateRange.to?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="gtm-error">
          <p>Error: {error}</p>
          <button onClick={generateReport}>Retry</button>
        </div>
      )}

      {/* Executive Summary Stats */}
      <div className="gtm-executive-summary">
        <div className="gtm-stat-card">
          <div className="gtm-stat-value">{thisWeekCount}</div>
          <div className="gtm-stat-label">Content Items</div>
          <div className={`gtm-stat-change ${weekChange >= 0 ? 'positive' : 'negative'}`}>
            {weekChange >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
            {Math.abs(weekChange)} vs last week
          </div>
        </div>
        <div className="gtm-stat-card">
          <div className="gtm-stat-icon"><Users size={20} /></div>
          <div className="gtm-stat-value">{customerStoriesCount}</div>
          <div className="gtm-stat-label">Customer Stories</div>
        </div>
        <div className="gtm-stat-card">
          <div className="gtm-stat-icon"><Video size={20} /></div>
          <div className="gtm-stat-value">{videosCount}</div>
          <div className="gtm-stat-label">Videos & Clips</div>
        </div>
        <div className="gtm-stat-card">
          <div className="gtm-stat-icon"><MapPin size={20} /></div>
          <div className="gtm-stat-value">{statesCount}</div>
          <div className="gtm-stat-label">States Covered</div>
        </div>
      </div>

      {/* Main Content Grid */}
      <div className="gtm-main-grid">
        {/* Left Column: Breakdowns */}
        <div className="gtm-breakdowns-column">
          {/* By Territory */}
          <div className="gtm-breakdown-card">
            <h4><MapPin size={16} /> By Territory</h4>
            <ul className="gtm-breakdown-list">
              {sortedEntries(byState).slice(0, 8).map(([state, count]) => (
                <li key={state}>
                  <span className="gtm-breakdown-label">{state}</span>
                  <span className="gtm-breakdown-count">{count}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* By Content Type */}
          <div className="gtm-breakdown-card">
            <h4><FileText size={16} /> By Content Type</h4>
            <ul className="gtm-breakdown-list">
              {sortedEntries(byType).slice(0, 8).map(([type, count]) => (
                <li key={type}>
                  <span className="gtm-breakdown-label">{type}</span>
                  <span className="gtm-breakdown-count">{count}</span>
                </li>
              ))}
            </ul>
          </div>

          {/* Top Topics */}
          <div className="gtm-breakdown-card">
            <h4><Tag size={16} /> Top Topics</h4>
            <ul className="gtm-breakdown-list">
              {sortedEntries(byTopic).slice(0, 8).map(([topic, count]) => (
                <li key={topic}>
                  <span className="gtm-breakdown-label">{topic}</span>
                  <span className="gtm-breakdown-count">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Right Column: Highlights + Insights */}
        <div className="gtm-highlights-column">
          {/* Customer Stories Highlights */}
          {customerStories.length > 0 && (
            <div className="gtm-highlights-section">
              <h4><Users size={16} /> Customer Story Highlights</h4>
              <div className="gtm-stories-grid">
                {customerStories.map(story => (
                  <div key={story.id} className="gtm-story-card">
                    <div className="gtm-story-header">
                      <span className="gtm-story-type">Customer Story</span>
                      {story.state && <span className="gtm-story-state">{story.state}</span>}
                    </div>
                    <h5 className="gtm-story-title">{story.title}</h5>
                    {story.summary && (
                      <p className="gtm-story-summary">
                        {story.summary.length > 120 ? story.summary.substring(0, 120) + '...' : story.summary}
                      </p>
                    )}
                    {story.live_link && (
                      <a href={story.live_link} target="_blank" rel="noopener noreferrer" className="gtm-story-link">
                        Read Story <ExternalLink size={12} />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* AI Insights */}
          <div className="gtm-insights-section">
            <div className="gtm-insights-header">
              <h4><Sparkles size={16} /> Sales Insights</h4>
              <button
                className="gtm-refresh-insights-btn"
                onClick={() => generateInsights(reportData)}
                disabled={insightsLoading}
              >
                {insightsLoading ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                Refresh
              </button>
            </div>
            <div className="gtm-insights-content">
              {insightsLoading ? (
                <div className="gtm-insights-loading">
                  <Loader2 className="spin" size={20} />
                  <span>Generating AI insights...</span>
                </div>
              ) : (
                <div
                  className="gtm-insights-text"
                  dangerouslySetInnerHTML={{ __html: formatInsights(insights) }}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Collapsible Content Table */}
      <div className="gtm-table-section">
        <button
          className="gtm-table-toggle"
          onClick={() => setTableExpanded(!tableExpanded)}
        >
          {tableExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          Content Details ({reportData.length} items)
        </button>

        {tableExpanded && (
          <div className="gtm-table-wrapper">
            <table className="gtm-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Title</th>
                  <th>State</th>
                  <th>Link</th>
                </tr>
              </thead>
              <tbody>
                {reportData.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="gtm-table-empty">No content in the last 7 days</td>
                  </tr>
                ) : (
                  reportData.map(item => (
                    <tr key={item.id}>
                      <td>
                        {item.created_at
                          ? new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          : '-'}
                      </td>
                      <td>
                        <span className={`gtm-type-badge ${(item.type || '').toLowerCase().replace(/\s+/g, '-')}`}>
                          {item.type || '-'}
                        </span>
                      </td>
                      <td className="gtm-title-cell">{item.title || '-'}</td>
                      <td>{item.state || 'National'}</td>
                      <td>
                        {item.live_link ? (
                          <a href={item.live_link} target="_blank" rel="noopener noreferrer">
                            View <ExternalLink size={12} />
                          </a>
                        ) : '-'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper Functions

function countByKey(data, keyFn) {
  const counts = {};
  data.forEach(item => {
    const key = keyFn(item);
    if (key) {
      counts[key] = (counts[key] || 0) + 1;
    }
  });
  return counts;
}

function sortedEntries(counts) {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

function normalizeState(state) {
  if (!state) return null;
  const normalized = state.trim().toUpperCase();
  // Handle common variations
  const stateMap = {
    'TEXAS': 'TX', 'CALIFORNIA': 'CA', 'FLORIDA': 'FL', 'NEW YORK': 'NY',
    'COLORADO': 'CO', 'MICHIGAN': 'MI', 'WISCONSIN': 'WI', 'NEBRASKA': 'NE',
    'UTAH': 'UT', 'ARIZONA': 'AZ', 'NEVADA': 'NV', 'GEORGIA': 'GA',
    'NORTH CAROLINA': 'NC', 'SOUTH CAROLINA': 'SC', 'VIRGINIA': 'VA',
    'OHIO': 'OH', 'ILLINOIS': 'IL', 'PENNSYLVANIA': 'PA', 'TENNESSEE': 'TN'
  };
  return stateMap[normalized] || normalized;
}

function extractTopics(data) {
  const counts = {};
  data.forEach(item => {
    const tags = [item.tags, item.auto_tags].filter(Boolean).join(',').split(',');
    tags.map(t => t.trim().toLowerCase()).filter(Boolean).forEach(tag => {
      counts[tag] = (counts[tag] || 0) + 1;
    });
  });
  return counts;
}

function formatInsights(text) {
  if (!text) return '';
  return text
    // Bold text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Headers
    .replace(/^### (.*?)$/gm, '<h5>$1</h5>')
    .replace(/^## (.*?)$/gm, '<h4>$1</h4>')
    // Numbered lists
    .replace(/^\s*(\d+)\.\s+\*\*(.*?)\*\*\s*[-–]\s*/gm, '<li><strong>$2</strong> - ')
    .replace(/^\s*(\d+)\.\s+/gm, '<li>')
    // Bullet points
    .replace(/^\s*[-•]\s+/gm, '<li>')
    // Line breaks to list items
    .replace(/<\/li>\n/g, '</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/(<li>[\s\S]*?<\/li>)+/g, '<ul>$&</ul>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    // Clean up
    .replace(/<p>\s*<ul>/g, '<ul>')
    .replace(/<\/ul>\s*<\/p>/g, '</ul>')
    .replace(/<p>\s*<\/p>/g, '');
}

export default WeeklyGTMReport;

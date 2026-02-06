import React, { useState, useEffect } from 'react';
import { Clock, ChevronDown, ChevronUp, ExternalLink, Download, Loader2 } from 'lucide-react';
import { supabaseClient } from '../services/supabase';

/**
 * RecentSubmissions Component
 * Displays recently submitted content from the last 7 days
 * Prioritizes Customer Stories at the top of the list
 */
function RecentSubmissions() {
  const [recentContent, setRecentContent] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchRecentContent();
  }, []);

  async function fetchRecentContent() {
    try {
      setLoading(true);
      setError(null);

      // Calculate 7 days ago
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      console.log('[RecentSubmissions] Fetching content since:', sevenDaysAgo.toISOString());

      // Use created_at (when added to database) for filtering
      // last_updated is often NULL for imported content
      // Fetch more to ensure we get content from multiple days (not just today)
      const { data, error: fetchError } = await supabaseClient
        .from('marketing_content')
        .select('*')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(50);

      if (fetchError) {
        throw fetchError;
      }

      // Debug: Log date distribution
      const dateCounts = {};
      (data || []).forEach(item => {
        const dateKey = new Date(item.created_at).toLocaleDateString();
        dateCounts[dateKey] = (dateCounts[dateKey] || 0) + 1;
      });
      console.log('[RecentSubmissions] Content by date:', dateCounts);
      console.log('[RecentSubmissions] Total items fetched:', data?.length || 0);

      // Sort: Customer Stories first, then by date
      const sorted = (data || []).sort((a, b) => {
        if (a.type === 'Customer Story' && b.type !== 'Customer Story') return -1;
        if (b.type === 'Customer Story' && a.type !== 'Customer Story') return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      });

      setRecentContent(sorted);
    } catch (err) {
      console.error('[RecentSubmissions] Error fetching content:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Don't render if no recent content and not loading
  if (!loading && recentContent.length === 0) {
    return null;
  }

  return (
    <div className="recent-submissions-panel">
      <div
        className="recent-header"
        onClick={() => setCollapsed(!collapsed)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setCollapsed(!collapsed)}
      >
        <div className="recent-header-left">
          <Clock size={18} />
          <h3>Recent Submissions</h3>
          <span className="recent-count">Last 7 Days ({recentContent.length})</span>
        </div>
        <div className="recent-header-right">
          {collapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
        </div>
      </div>

      {!collapsed && (
        <div className="recent-content">
          {loading ? (
            <div className="recent-loading">
              <Loader2 className="spin" size={24} />
              <span>Loading recent content...</span>
            </div>
          ) : error ? (
            <div className="recent-error">
              Failed to load recent content. <button onClick={fetchRecentContent}>Retry</button>
            </div>
          ) : (
            <div className="recent-days-container">
              {groupByDay(recentContent).map(({ dayLabel, items }) => (
                <div key={dayLabel} className="recent-day-group">
                  <div className="recent-day-header">{dayLabel} ({items.length})</div>
                  <div className="recent-grid">
                    {items.map((item) => (
                      <div key={item.id} className="recent-card">
                        <div className="recent-card-header">
                          <span className={`recent-type ${item.type === 'Customer Story' ? 'highlight' : ''}`}>
                            {item.type}
                          </span>
                          {item.state && <span className="recent-state">{item.state}</span>}
                        </div>
                        <div className="recent-card-title">{item.title}</div>
                        {item.summary && (
                          <div className="recent-card-summary">
                            {item.summary.length > 120 ? item.summary.substring(0, 120) + '...' : item.summary}
                          </div>
                        )}
                        <div className="recent-card-actions">
                          {item.live_link && (
                            <a
                              href={item.live_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="recent-action-btn primary"
                            >
                              View <ExternalLink size={12} />
                            </a>
                          )}
                          {item.ungated_link && (
                            <a
                              href={item.ungated_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="recent-action-btn"
                            >
                              <Download size={12} /> Download
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Group content items by day for display
 */
function groupByDay(items) {
  const groups = {};

  items.forEach(item => {
    const date = new Date(item.created_at);
    // Use date string as key for grouping
    const dateKey = date.toDateString();

    if (!groups[dateKey]) {
      groups[dateKey] = {
        date: date,
        items: []
      };
    }
    groups[dateKey].items.push(item);
  });

  // Convert to array and sort by date descending
  return Object.values(groups)
    .sort((a, b) => b.date - a.date)
    .map(group => ({
      dayLabel: formatDayLabel(group.date),
      items: group.items
    }));
}

/**
 * Format a date as a day label (e.g., "Today", "Yesterday", "Monday, Feb 3")
 */
function formatDayLabel(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';

  // For older days, show day name and date
  const options = { weekday: 'long', month: 'short', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

/**
 * Format a date as relative time (e.g., "2 days ago", "today")
 */
function formatRelativeDate(dateString) {
  if (!dateString) return '';

  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now - date;
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString();
}

export default RecentSubmissions;

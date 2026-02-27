import React from 'react';

/**
 * Adaptive top header bar.
 * - Mobile: SchooLinks logo + single stat pill
 * - Desktop: slim bar with view title + stats grid (sidebar handles logo/nav)
 */
export default function AppHeader({ isMobile, stats, viewMode }) {
  const viewLabels = {
    chat:   'Chat Assistant',
    search: 'Content Search',
    gtm:    'Weekly GTM Report',
    feed:   'Content Feed',
  };

  return (
    <header className="app-header">
      <div className="app-header-inner">
        {isMobile ? (
          // Mobile: logo on left, stat pill on right
          <>
            <div className="app-header-logo">
              <img
                src="/schoolinks-logo-white.png"
                alt="SchooLinks"
                className="header-logo-img"
              />
            </div>
            {stats && (
              <span className="app-header-stat-pill">
                {stats.total_content} pieces
              </span>
            )}
          </>
        ) : (
          // Desktop: view title on left, stats on right
          <>
            <h1 className="app-header-view-title">
              {viewLabels[viewMode] || 'Marketing Content Portal'}
            </h1>
            {stats && (
              <div className="app-header-stats">
                <div className="app-stat-item">
                  <span className="app-stat-value">{stats.total_content}</span>
                  <span className="app-stat-label">Total Content</span>
                </div>
                <div className="app-stat-item">
                  <span className="app-stat-value">{stats.content_types}</span>
                  <span className="app-stat-label">Types</span>
                </div>
                <div className="app-stat-item">
                  <span className="app-stat-value">{stats.states_covered}</span>
                  <span className="app-stat-label">States</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </header>
  );
}

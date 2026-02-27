import React from 'react';
import { MessageSquare, Search, BarChart3, Rss, ChevronLeft, ChevronRight, Database } from 'lucide-react';

const NAV_ITEMS = [
  { id: 'chat',   label: 'Chat Assistant',    Icon: MessageSquare },
  { id: 'search', label: 'Content Search',    Icon: Search },
  { id: 'gtm',    label: 'Weekly GTM Report', Icon: BarChart3 },
  { id: 'feed',   label: 'Content Feed',      Icon: Rss },
];

/**
 * Desktop left sidebar navigation.
 * Props:
 *   collapsed  {boolean}  - icon-only mode (64px)
 *   viewMode   {string}   - current active view
 *   onNavigate {function} - (mode) => void
 *   onToggle   {function} - () => void
 */
export default function Sidebar({ collapsed, viewMode, onNavigate, onToggle }) {
  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="Main navigation">
      {/* Logo + collapse toggle in header */}
      <div className="sidebar-logo">
        {collapsed ? (
          <button
            className="sidebar-collapse-btn"
            onClick={onToggle}
            title="Expand sidebar"
            aria-label="Expand sidebar"
          >
            <ChevronRight size={18} />
          </button>
        ) : (
          <>
            <img
              src="/schoolinks-logo-white.png"
              alt="SchooLinks"
              className="sidebar-logo-img"
            />
            <button
              className="sidebar-collapse-btn"
              onClick={onToggle}
              title="Collapse sidebar"
              aria-label="Collapse sidebar"
            >
              <ChevronLeft size={18} />
            </button>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`sidebar-nav-item ${viewMode === id ? 'is-active' : ''}`}
            onClick={() => onNavigate(id)}
            title={collapsed ? label : undefined}
            aria-label={label}
            aria-current={viewMode === id ? 'page' : undefined}
          >
            <Icon size={20} className="sidebar-nav-icon" />
            {!collapsed && <span className="sidebar-nav-label">{label}</span>}
          </button>
        ))}
      </nav>
    </aside>
  );
}

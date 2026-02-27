import React from 'react';
import { MessageSquare, Search, BarChart3, Rss } from 'lucide-react';

const TABS = [
  { id: 'chat',   label: 'Chat',   Icon: MessageSquare },
  { id: 'search', label: 'Search', Icon: Search },
  { id: 'gtm',    label: 'Report', Icon: BarChart3 },
  { id: 'feed',   label: 'Feed',   Icon: Rss },
];

/**
 * Mobile fixed bottom navigation tab bar.
 * Props:
 *   viewMode   {string}   - current active tab
 *   onNavigate {function} - (mode) => void
 */
export default function BottomTabBar({ viewMode, onNavigate }) {
  return (
    <nav className="bottom-tab-bar" aria-label="Mobile navigation">
      {TABS.map(({ id, label, Icon }) => (
        <button
          key={id}
          className={`bottom-tab ${viewMode === id ? 'is-active' : ''}`}
          onClick={() => onNavigate(id)}
          aria-label={label}
          aria-current={viewMode === id ? 'page' : undefined}
        >
          <Icon size={22} className="bottom-tab-icon" />
          <span className="bottom-tab-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}

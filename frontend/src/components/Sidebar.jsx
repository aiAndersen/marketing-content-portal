import React from 'react';
import { MessageSquare, Search, BarChart3, Settings, ChevronLeft, ChevronRight, Database } from 'lucide-react';

const NAV_ITEMS = [
  { id: 'chat',   label: 'Chat Assistant',    Icon: MessageSquare },
  { id: 'search', label: 'Content Search',    Icon: Search },
  { id: 'gtm',    label: 'Weekly GTM Report', Icon: BarChart3 },
];

/**
 * Desktop left sidebar navigation.
 * Props:
 *   collapsed     {boolean}  - icon-only mode (64px)
 *   viewMode      {string}   - current active view
 *   onNavigate    {function} - (mode) => void
 *   onToggle      {function} - () => void
 *   isAdminMode   {boolean}
 *   onAdminToggle {function} - () => void
 */
export default function Sidebar({ collapsed, viewMode, onNavigate, onToggle, isAdminMode, onAdminToggle }) {
  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`} aria-label="Main navigation">
      {/* Logo */}
      <div className="sidebar-logo">
        {collapsed ? (
          <Database size={28} color="var(--sl-yellow)" />
        ) : (
          <img
            src="/schoolinks-logo-white.png"
            alt="SchooLinks"
            className="sidebar-logo-img"
          />
        )}
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {NAV_ITEMS.map(({ id, label, Icon }) => (
          <button
            key={id}
            className={`sidebar-nav-item ${viewMode === id && !isAdminMode ? 'is-active' : ''}`}
            onClick={() => onNavigate(id)}
            title={collapsed ? label : undefined}
            aria-label={label}
            aria-current={viewMode === id && !isAdminMode ? 'page' : undefined}
          >
            <Icon size={20} className="sidebar-nav-icon" />
            {!collapsed && <span className="sidebar-nav-label">{label}</span>}
          </button>
        ))}
      </nav>

      {/* Spacer */}
      <div className="sidebar-spacer" />

      {/* Admin toggle (dimmed) */}
      <button
        className={`sidebar-nav-item sidebar-admin-item ${isAdminMode ? 'is-active' : ''}`}
        onClick={onAdminToggle}
        title={collapsed ? 'Admin' : undefined}
        aria-label="Terminology Admin"
      >
        <Settings size={18} className="sidebar-nav-icon" />
        {!collapsed && <span className="sidebar-nav-label">Admin</span>}
      </button>

      {/* Collapse toggle */}
      <button
        className="sidebar-toggle"
        onClick={onToggle}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        {!collapsed && <span>Collapse</span>}
      </button>
    </aside>
  );
}

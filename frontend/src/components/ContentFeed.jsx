import React, { useState, useEffect, useRef } from 'react';
import {
  ExternalLink, Download, Star, Play, FileText, BookOpen,
  MonitorPlay, Newspaper, Trophy, Globe, Paperclip, Clapperboard,
  Loader2, RefreshCw, Rss
} from 'lucide-react';
import { supabaseClient } from '../services/supabase';

/* ============================================================
   THUMBNAIL HELPERS
   ============================================================ */

/**
 * Try to derive a thumbnail synchronously from a URL.
 * Returns: { type: 'image', src: string }
 *        | { type: 'vimeo', id: string }
 *        | null (fall through to og-preview or gradient)
 */
function extractThumbnailSync(url) {
  if (!url) return null;

  // YouTube
  const ytMatch = url.match(
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch) {
    return { type: 'image', src: `https://img.youtube.com/vi/${ytMatch[1]}/mqdefault.jpg` };
  }

  // Vimeo
  const vmMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vmMatch) {
    return { type: 'vimeo', id: vmMatch[1] };
  }

  return null;
}

/** Gradient + icon definitions per content type */
const TYPE_CONFIG = {
  'Customer Story': { Icon: Star,         gradient: 'linear-gradient(135deg, #F5EC1E 0%, #ABA515 100%)', iconColor: '#1E1A12' },
  'Video':          { Icon: Play,         gradient: 'linear-gradient(135deg, #2DD4BF 0%, #0F766E 100%)', iconColor: '#fff' },
  'Blog':           { Icon: FileText,     gradient: 'linear-gradient(135deg, #2B7383 0%, #115E59 100%)', iconColor: '#fff' },
  'Ebook':          { Icon: BookOpen,     gradient: 'linear-gradient(135deg, #0D9488 0%, #2B7383 100%)', iconColor: '#fff' },
  'Webinar':        { Icon: MonitorPlay,  gradient: 'linear-gradient(135deg, #B2DBE4 0%, #2B7383 100%)', iconColor: '#1E1A12' },
  '1-Pager':        { Icon: FileText,     gradient: 'linear-gradient(135deg, #D8EDF1 0%, #B2DBE4 100%)', iconColor: '#1E1A12' },
  'Press Release':  { Icon: Newspaper,    gradient: 'linear-gradient(135deg, #525252 0%, #1E1A12 100%)', iconColor: '#fff' },
  'Award':          { Icon: Trophy,       gradient: 'linear-gradient(135deg, #FACC15 0%, #ABA515 100%)', iconColor: '#1E1A12' },
  'Landing Page':   { Icon: Globe,        gradient: 'linear-gradient(135deg, #3EA4BB 0%, #2B7383 100%)', iconColor: '#fff' },
  'Asset':          { Icon: Paperclip,    gradient: 'linear-gradient(135deg, #D4D4D4 0%, #8E8C88 100%)', iconColor: '#1E1A12' },
  'Video Clip':     { Icon: Clapperboard, gradient: 'linear-gradient(135deg, #5EEAD4 0%, #0D9488 100%)', iconColor: '#1E1A12' },
};

const DEFAULT_CONFIG = {
  Icon: FileText,
  gradient: 'linear-gradient(135deg, #E5E5E5 0%, #A3A3A3 100%)',
  iconColor: '#1E1A12',
};

/** Formats relative date ("Today", "2 days ago", "Feb 15") */
function formatRelativeDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/* ============================================================
   THUMBNAIL SUB-COMPONENTS
   ============================================================ */

/** Lazy-fetches a Vimeo thumbnail via the public oEmbed API */
function VimeoThumb({ vimeoId, contentType }) {
  const [src, setSrc] = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    fetch(`https://vimeo.com/api/oembed.json?url=https://vimeo.com/${vimeoId}&width=320`)
      .then(r => r.json())
      .then(d => { if (mountedRef.current && d.thumbnail_url) setSrc(d.thumbnail_url); })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, [vimeoId]);

  if (src) return <img src={src} alt="" className="feed-card-thumb" loading="lazy" />;
  return <GradientThumb contentType={contentType} />;
}

/** Lazy-fetches og:image via the /api/og-preview proxy */
function OgThumb({ url, contentType }) {
  const [src, setSrc] = useState(() => {
    // Check sessionStorage first to avoid repeat requests
    try { return sessionStorage.getItem(`og:${url}`) || null; } catch { return null; }
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    if (src || !url) return;
    mountedRef.current = true;
    fetch(`/api/og-preview?url=${encodeURIComponent(url)}`)
      .then(r => r.json())
      .then(d => {
        if (!mountedRef.current) return;
        if (d.image) {
          try { sessionStorage.setItem(`og:${url}`, d.image); } catch {}
          setSrc(d.image);
        }
      })
      .catch(() => {});
    return () => { mountedRef.current = false; };
  }, [url, src]);

  if (src) return <img src={src} alt="" className="feed-card-thumb" loading="lazy" onError={() => setSrc(null)} />;
  return <GradientThumb contentType={contentType} />;
}

/** Gradient + icon fallback when no image is available */
function GradientThumb({ contentType }) {
  const { Icon, gradient, iconColor } = TYPE_CONFIG[contentType] || DEFAULT_CONFIG;
  return (
    <div className="feed-card-thumb-gradient" style={{ background: gradient }}>
      <Icon size={40} color={iconColor} opacity={0.85} />
    </div>
  );
}

/** Returns true if a URL points directly to a PDF file */
function isPdfUrl(url) {
  if (!url) return false;
  return /\.pdf(\?|$)/i.test(url);
}

/** Renders the right thumbnail for a card */
function CardThumb({ item }) {
  const primaryUrl = item.live_link || item.ungated_link;
  const thumb = extractThumbnailSync(primaryUrl);

  if (!thumb) {
    // For OG proxy: only use live_link (landing pages have og:image).
    // Skip OG proxy for PDFs — they have no HTML meta tags and always return null.
    const ogUrl = item.live_link && !isPdfUrl(item.live_link) ? item.live_link : null;
    if (ogUrl) return <OgThumb url={ogUrl} contentType={item.type} />;
    return <GradientThumb contentType={item.type} />;
  }

  if (thumb.type === 'image') {
    return <img src={thumb.src} alt="" className="feed-card-thumb" loading="lazy" />;
  }

  if (thumb.type === 'vimeo') {
    return <VimeoThumb vimeoId={thumb.id} contentType={item.type} />;
  }

  return <GradientThumb contentType={item.type} />;
}

/* ============================================================
   CONTENT TYPE FILTER PILLS
   ============================================================ */
const ALL_TYPES = [
  'Customer Story', 'Video', 'Blog', 'Ebook', 'Webinar',
  '1-Pager', 'Press Release', 'Award', 'Landing Page', 'Asset', 'Video Clip'
];

/* ============================================================
   MAIN COMPONENT
   ============================================================ */
export default function ContentFeed() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeType, setActiveType] = useState('All');

  useEffect(() => {
    fetchFeed();
  }, []);

  async function fetchFeed() {
    setLoading(true);
    setError(null);
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const { data, error: fetchError } = await supabaseClient
        .from('marketing_content')
        .select('*')
        .gte('created_at', sevenDaysAgo.toISOString())
        .order('created_at', { ascending: false })
        .limit(100);

      if (fetchError) throw fetchError;

      // Customer Stories float to the top
      const sorted = (data || []).sort((a, b) => {
        if (a.type === 'Customer Story' && b.type !== 'Customer Story') return -1;
        if (b.type === 'Customer Story' && a.type !== 'Customer Story') return 1;
        return new Date(b.created_at) - new Date(a.created_at);
      });

      setItems(sorted);
    } catch (err) {
      console.error('[ContentFeed] Error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const visibleItems = activeType === 'All'
    ? items
    : items.filter(i => i.type === activeType);

  // Types that actually exist in the current feed
  const presentTypes = ALL_TYPES.filter(t => items.some(i => i.type === t));

  return (
    <div className="feed-page">
      {/* Feed header */}
      <div className="feed-page-header">
        <div className="feed-page-title-row">
          <Rss size={20} />
          <div>
            <h2 className="feed-page-title">Content Feed</h2>
            <p className="feed-page-subtitle">
              {loading ? 'Loading…' : `${items.length} pieces published in the last 7 days`}
            </p>
          </div>
        </div>
        <button className="feed-refresh-btn" onClick={fetchFeed} disabled={loading} title="Refresh feed">
          <RefreshCw size={15} className={loading ? 'feed-spin' : ''} />
        </button>
      </div>

      {/* Type filter pills */}
      {!loading && presentTypes.length > 1 && (
        <div className="feed-filters">
          <button
            className={`feed-filter-pill ${activeType === 'All' ? 'is-active' : ''}`}
            onClick={() => setActiveType('All')}
          >
            All ({items.length})
          </button>
          {presentTypes.map(type => (
            <button
              key={type}
              className={`feed-filter-pill ${activeType === type ? 'is-active' : ''}`}
              onClick={() => setActiveType(type)}
            >
              {type} ({items.filter(i => i.type === type).length})
            </button>
          ))}
        </div>
      )}

      {/* States */}
      {loading && (
        <div className="feed-loading">
          <Loader2 size={28} className="feed-spin" />
          <span>Loading content feed…</span>
        </div>
      )}

      {!loading && error && (
        <div className="feed-error">
          <p>Failed to load content feed.</p>
          <button onClick={fetchFeed}>Retry</button>
        </div>
      )}

      {!loading && !error && visibleItems.length === 0 && (
        <div className="feed-empty">
          <p>No content published in the last 7 days{activeType !== 'All' ? ` matching "${activeType}"` : ''}.</p>
        </div>
      )}

      {/* Card grid */}
      {!loading && !error && visibleItems.length > 0 && (
        <div className="feed-grid">
          {visibleItems.map(item => (
            <article key={item.id} className="feed-card">
              {/* Thumbnail */}
              <div className="feed-card-thumb-wrap">
                <CardThumb item={item} />
                <span className="feed-card-type-overlay">{item.type}</span>
              </div>

              {/* Body */}
              <div className="feed-card-body">
                <div className="feed-card-meta">
                  {item.state && <span className="feed-card-state">{item.state}</span>}
                  <span className="feed-card-date">{formatRelativeDate(item.created_at)}</span>
                </div>

                <h3 className="feed-card-title">{item.title}</h3>

                {item.summary && (
                  <p className="feed-card-summary">
                    {item.summary.length > 150
                      ? item.summary.substring(0, 150) + '…'
                      : item.summary}
                  </p>
                )}

                {(item.platform || item.tags) && (
                  <div className="feed-card-tags">
                    {item.tags && (
                      <span className="feed-card-tag">{item.tags}</span>
                    )}
                  </div>
                )}

                <div className="feed-card-actions">
                  {item.live_link && (
                    <a
                      href={item.live_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="feed-card-btn primary"
                    >
                      <ExternalLink size={13} />
                      View
                    </a>
                  )}
                  {item.ungated_link && (
                    <a
                      href={item.ungated_link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="feed-card-btn"
                    >
                      <Download size={13} />
                      Download
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

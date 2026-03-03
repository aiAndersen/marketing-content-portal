import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Search, ChevronUp, ChevronDown, ChevronLeft, ChevronRight,
  Settings2, X, Loader2
} from 'lucide-react';
import { supabaseClient } from '../services/supabase';

/* ------------------------------------------------------------------ */
/* Table config                                                         */
/* ------------------------------------------------------------------ */

const TABLES = [
  {
    id: 'marketing_content',
    label: 'Content Library',
    defaultSort: 'last_updated',
    searchCols: ['title', 'summary', 'tags'],
  },
  {
    id: 'terminology_map',
    label: 'Vocabulary Mappings',
    defaultSort: 'usage_count',
    searchCols: ['user_term', 'canonical_term'],
  },
  {
    id: 'state_terminology',
    label: 'State Terminology',
    defaultSort: 'state_code',
    searchCols: ['state_code', 'state_name', 'kri_term', 'plp_term'],
  },
  {
    id: 'ai_prompt_logs',
    label: 'Search Query Logs',
    defaultSort: 'created_at',
    searchCols: ['query'],
  },
  {
    id: 'log_analysis_reports',
    label: 'Analysis Reports',
    defaultSort: 'analysis_date',
    searchCols: ['summary', 'executive_summary'],
  },
  {
    id: 'ai_context',
    label: 'AI Context',
    defaultSort: 'created_at',
    searchCols: ['title', 'content', 'subcategory'],
  },
];

// Columns to always hide (system/heavy columns)
const HIDDEN_COLS = new Set([
  'embedding', 'search_vector', 'extracted_text', 'ai_response_raw',
  'enhanced_summary', 'auto_tags', 'content_analyzed_at', 'extraction_error',
]);

const PAGE_SIZE = 50;

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */

function isUrl(val) {
  if (typeof val !== 'string') return false;
  return /^https?:\/\//i.test(val.trim());
}

function isJsonLike(val) {
  return val !== null && typeof val === 'object';
}

function formatDate(val) {
  if (!val) return null;
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return String(val);
  }
}

function isDateString(val) {
  if (typeof val !== 'string') return false;
  return /^\d{4}-\d{2}-\d{2}(T|$)/.test(val);
}

function urlDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function truncate(str, n = 80) {
  if (!str) return '';
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function storageKey(tableId) {
  return `tb-hidden-cols:${tableId}`;
}

function loadHiddenCols(tableId) {
  try {
    const raw = sessionStorage.getItem(storageKey(tableId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch { return new Set(); }
}

function saveHiddenCols(tableId, hiddenSet) {
  try {
    sessionStorage.setItem(storageKey(tableId), JSON.stringify([...hiddenSet]));
  } catch {}
}

/* ------------------------------------------------------------------ */
/* Cell rendering                                                       */
/* ------------------------------------------------------------------ */

function CellValue({ col, val }) {
  if (val === null || val === undefined || val === '') {
    return <span className="tb-td is-null">—</span>;
  }
  if (typeof val === 'boolean') {
    return (
      <td className="tb-td is-bool">
        {val ? <span className="tb-bool-yes">✓</span> : <span className="tb-bool-no">—</span>}
      </td>
    );
  }
  if (isJsonLike(val)) {
    return (
      <td className="tb-td is-json">
        <span className="tb-json-badge">
          {Array.isArray(val) ? `[${val.length}]` : '{ … }'}
        </span>
      </td>
    );
  }
  if (isDateString(val)) {
    return <td className="tb-td is-date">{formatDate(val)}</td>;
  }
  if (isUrl(val)) {
    return (
      <td className="tb-td is-url" title={val}>
        {urlDomain(val)}
      </td>
    );
  }
  return <td className="tb-td">{truncate(String(val))}</td>;
}

/* ------------------------------------------------------------------ */
/* Row detail drawer                                                    */
/* ------------------------------------------------------------------ */

function Drawer({ row, columns, onClose }) {
  const open = !!row;
  return (
    <>
      {open && <div className="tb-drawer-overlay" onClick={onClose} />}
      <div className={`tb-drawer${open ? ' is-open' : ''}`} aria-modal="true" role="dialog">
        <div className="tb-drawer-header">
          <span className="tb-drawer-title">Row Detail</span>
          <button className="tb-drawer-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="tb-drawer-body">
          {row && columns.map(col => {
            const val = row[col];
            if (val === null || val === undefined) {
              return (
                <div key={col} className="tb-field">
                  <span className="tb-field-label">{col}</span>
                  <span className="tb-field-value is-null">null</span>
                </div>
              );
            }
            if (isJsonLike(val)) {
              return (
                <div key={col} className="tb-field">
                  <span className="tb-field-label">{col}</span>
                  <pre className="tb-field-value is-json">
                    {JSON.stringify(val, null, 2)}
                  </pre>
                </div>
              );
            }
            if (isUrl(String(val))) {
              return (
                <div key={col} className="tb-field">
                  <span className="tb-field-label">{col}</span>
                  <span className="tb-field-value is-url">
                    <a href={String(val)} target="_blank" rel="noopener noreferrer">{String(val)}</a>
                  </span>
                </div>
              );
            }
            return (
              <div key={col} className="tb-field">
                <span className="tb-field-label">{col}</span>
                <span className="tb-field-value">{String(val)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Column toggle popover                                                */
/* ------------------------------------------------------------------ */

function ColToggle({ columns, hiddenCols, onToggle }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="tb-col-toggle-btn" onClick={() => setOpen(o => !o)} title="Show/hide columns">
        <Settings2 size={13} />
        Columns
      </button>
      {open && (
        <div className="tb-col-popover">
          <div className="tb-col-popover-title">Show / Hide</div>
          {columns.map(col => (
            <label key={col} className="tb-col-check">
              <input
                type="checkbox"
                checked={!hiddenCols.has(col)}
                onChange={() => onToggle(col)}
              />
              {col}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                       */
/* ------------------------------------------------------------------ */

export default function TableBrowser() {
  const [activeTable, setActiveTable] = useState(TABLES[0]);
  const [rowCounts, setRowCounts] = useState({}); // { tableId: number }
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [columns, setColumns] = useState([]);
  const [hiddenCols, setHiddenCols] = useState(() => loadHiddenCols(TABLES[0].id));
  const [sortCol, setSortCol] = useState(TABLES[0].defaultSort);
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedRow, setSelectedRow] = useState(null);
  const debounceRef = useRef(null);

  // Load row counts for all tables once on mount
  useEffect(() => {
    async function fetchCounts() {
      const counts = {};
      await Promise.all(
        TABLES.map(async t => {
          try {
            const { count } = await supabaseClient
              .from(t.id)
              .select('*', { count: 'exact', head: true });
            counts[t.id] = count ?? 0;
          } catch {
            counts[t.id] = 0;
          }
        })
      );
      setRowCounts(counts);
    }
    fetchCounts();
  }, []);

  // Fetch page of data whenever active table / sort / page / search changes
  const fetchData = useCallback(async () => {
    setLoading(true);
    setSelectedRow(null);
    try {
      let q = supabaseClient
        .from(activeTable.id)
        .select('*', { count: 'exact' });

      // Search filter
      if (search && activeTable.searchCols.length > 0) {
        const conditions = activeTable.searchCols
          .map(c => `${c}.ilike.%${search}%`)
          .join(',');
        q = q.or(conditions);
      }

      // Sort — only if column exists (we detect from first row; use defaultSort as best guess)
      q = q.order(sortCol, { ascending: sortAsc, nullsFirst: false });

      // Pagination
      q = q.range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      const { data, count, error } = await q;
      if (error) throw error;

      const safeData = data || [];
      setRows(safeData);
      setTotalRows(count ?? 0);

      // Derive columns from first row, filtering system columns
      if (safeData.length > 0) {
        const allCols = Object.keys(safeData[0]).filter(c => !HIDDEN_COLS.has(c));
        setColumns(allCols);
      } else {
        setColumns([]);
      }
    } catch (err) {
      console.error('[TableBrowser] fetch error:', err);
      setRows([]);
      setTotalRows(0);
    } finally {
      setLoading(false);
    }
  }, [activeTable, sortCol, sortAsc, page, search]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Debounced search
  function handleSearchChange(e) {
    const val = e.target.value;
    setSearchInput(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(val);
      setPage(0);
    }, 300);
  }

  // Switch table
  function handleTableSelect(table) {
    setActiveTable(table);
    setSortCol(table.defaultSort);
    setSortAsc(false);
    setPage(0);
    setSearch('');
    setSearchInput('');
    setSelectedRow(null);
    setHiddenCols(loadHiddenCols(table.id));
  }

  // Sort
  function handleSort(col) {
    if (col === sortCol) {
      setSortAsc(a => !a);
    } else {
      setSortCol(col);
      setSortAsc(true);
    }
    setPage(0);
  }

  // Column visibility
  function handleColToggle(col) {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      saveHiddenCols(activeTable.id, next);
      return next;
    });
  }

  const visibleCols = columns.filter(c => !hiddenCols.has(c));
  const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));

  return (
    <div className="tb-layout">
      {/* Left: table list */}
      <div className="tb-table-list">
        <div className="tb-list-header">Tables</div>
        {TABLES.map(t => (
          <button
            key={t.id}
            className={`tb-table-item${activeTable.id === t.id ? ' is-active' : ''}`}
            onClick={() => handleTableSelect(t)}
          >
            <span className="tb-table-item-name">{t.label}</span>
            <span className="tb-badge">
              {rowCounts[t.id] != null ? rowCounts[t.id].toLocaleString() : '…'} rows
            </span>
          </button>
        ))}
      </div>

      {/* Right: toolbar + table */}
      <div className="tb-main">
        {/* Toolbar */}
        <div className="tb-toolbar">
          <div className="tb-search-wrap">
            <Search size={14} className="tb-search-icon" />
            <input
              className="tb-search"
              type="text"
              placeholder={`Search ${activeTable.label}…`}
              value={searchInput}
              onChange={handleSearchChange}
            />
          </div>
          <span className="tb-meta">
            {loading ? '…' : `${totalRows.toLocaleString()} row${totalRows !== 1 ? 's' : ''}`}
          </span>
          {columns.length > 0 && (
            <ColToggle
              columns={columns}
              hiddenCols={hiddenCols}
              onToggle={handleColToggle}
            />
          )}
        </div>

        {/* Table */}
        <div className="tb-table-wrap">
          {loading ? (
            <div className="tb-loading">
              <Loader2 size={20} className="feed-spin" />
              Loading…
            </div>
          ) : rows.length === 0 ? (
            <div className="tb-empty">No rows found.</div>
          ) : (
            <table className="tb-table">
              <thead className="tb-thead">
                <tr>
                  {visibleCols.map(col => (
                    <th
                      key={col}
                      className={`tb-th${sortCol === col ? ' is-sorted' : ''}`}
                      onClick={() => handleSort(col)}
                    >
                      {col}
                      <span className="tb-sort-icon">
                        {sortCol === col
                          ? sortAsc ? <ChevronUp size={12} /> : <ChevronDown size={12} />
                          : <ChevronDown size={12} />}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr
                    key={row.id ?? i}
                    className="tb-row"
                    onClick={() => setSelectedRow(row)}
                  >
                    {visibleCols.map(col => {
                      const val = row[col];
                      if (val === null || val === undefined || val === '') {
                        return <td key={col} className="tb-td is-null">—</td>;
                      }
                      if (typeof val === 'boolean') {
                        return (
                          <td key={col} className="tb-td is-bool">
                            {val ? <span className="tb-bool-yes">✓</span> : <span className="tb-bool-no">—</span>}
                          </td>
                        );
                      }
                      if (isJsonLike(val)) {
                        return (
                          <td key={col} className="tb-td is-json">
                            <span className="tb-json-badge">
                              {Array.isArray(val) ? `[${val.length}]` : '{ … }'}
                            </span>
                          </td>
                        );
                      }
                      if (isDateString(String(val))) {
                        return <td key={col} className="tb-td is-date">{formatDate(val)}</td>;
                      }
                      if (isUrl(String(val))) {
                        return (
                          <td key={col} className="tb-td is-url" title={String(val)}>
                            {urlDomain(String(val))}
                          </td>
                        );
                      }
                      return <td key={col} className="tb-td">{truncate(String(val))}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {!loading && rows.length > 0 && (
          <div className="tb-pagination">
            <button
              className="tb-page-btn"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0}
            >
              <ChevronLeft size={14} /> Prev
            </button>
            <button
              className="tb-page-btn"
              onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
            >
              Next <ChevronRight size={14} />
            </button>
            <span className="tb-page-info">
              Page {page + 1} of {totalPages}
              {search && ` · filtered`}
            </span>
          </div>
        )}
      </div>

      {/* Row detail drawer */}
      <Drawer
        row={selectedRow}
        columns={columns}
        onClose={() => setSelectedRow(null)}
      />
    </div>
  );
}

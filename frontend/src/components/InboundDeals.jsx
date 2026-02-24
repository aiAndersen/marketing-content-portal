import React, { useState, useEffect } from 'react';
import { Inbox, ChevronDown, ChevronUp, Loader2, ArrowRight, CheckCircle, Circle } from 'lucide-react';
import InboundDealModal from './InboundDealModal';

/**
 * InboundDeals Component
 * Displays HubSpot inbound deals (Sales Validating - new logo stage) from the last 7 days.
 * Starts collapsed. Each card opens a modal with content recommendations and outreach tactics.
 */
function InboundDeals() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDeal, setSelectedDeal] = useState(null);

  useEffect(() => {
    fetchDeals();
  }, []);

  async function fetchDeals() {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch('/api/hubspot-deals');
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setDeals(data.deals || []);
    } catch (err) {
      console.error('[InboundDeals] Error:', err.message);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Don't render if no deals and not loading (avoids empty drawer)
  if (!loading && !error && deals.length === 0) {
    return null;
  }

  return (
    <>
      <div className="inbound-deals-panel">
        <div
          className="inbound-header"
          onClick={() => setCollapsed(!collapsed)}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === 'Enter' && setCollapsed(!collapsed)}
        >
          <div className="inbound-header-left">
            <Inbox size={18} />
            <h3>Inbound Deals</h3>
            <span className="inbound-count">
              Last 7 Days {!loading && `(${deals.length})`}
            </span>
            {!loading && !error && deals.length > 0 && (
              <span className="inbound-live-badge">LIVE</span>
            )}
          </div>
          <div className="inbound-header-right">
            {collapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
          </div>
        </div>

        {!collapsed && (
          <div className="inbound-content">
            {loading ? (
              <div className="inbound-loading">
                <Loader2 className="spin" size={24} />
                <span>Loading inbound deals from HubSpot...</span>
              </div>
            ) : error ? (
              <div className="inbound-error">
                <span>Could not load inbound deals: {error}</span>
                <button onClick={fetchDeals} className="inbound-retry-btn">Retry</button>
              </div>
            ) : (
              <div className="inbound-grid">
                {deals.map((deal) => (
                  <InboundDealCard
                    key={deal.id}
                    deal={deal}
                    onClick={() => setSelectedDeal(deal)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {selectedDeal && (
        <InboundDealModal
          deal={selectedDeal}
          onClose={() => setSelectedDeal(null)}
        />
      )}
    </>
  );
}

function InboundDealCard({ deal, onClick }) {
  const daysAgo = getDaysAgo(deal.dateEnteredStage);

  return (
    <div className="inbound-card" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      <div className="inbound-card-header">
        <span className="inbound-type-badge">INBOUND</span>
        <span className={`inbound-meeting-badge ${deal.meetingBooked ? 'booked' : 'none'}`}>
          {deal.meetingBooked
            ? <><CheckCircle size={11} /> Meeting Booked</>
            : <><Circle size={11} /> No Meeting</>
          }
        </span>
      </div>

      <div className="inbound-card-company">{deal.companyName}</div>

      {(deal.companyCity || deal.companyState) && (
        <div className="inbound-card-location">
          {[deal.companyCity, deal.companyState].filter(Boolean).join(', ')}
        </div>
      )}

      <div className="inbound-card-meta">
        <span className="inbound-acv">
          ACV: {deal.acv != null ? formatCurrency(deal.acv) : '—'}
        </span>
        <span className="inbound-enrollment">
          {'\u00b7'} {deal.enrollment != null ? deal.enrollment.toLocaleString() + ' students' : '— students'}
        </span>
      </div>

      {(deal.ownerName || deal.companyOwnerName) && (
        <div className="inbound-card-owner">
          {deal.ownerName && deal.companyOwnerName && deal.ownerName !== deal.companyOwnerName ? (
            <>
              <span>Rep: {deal.ownerName}</span>
              <span> · Acct: {deal.companyOwnerName}</span>
            </>
          ) : (
            <span>Owner: {deal.ownerName || deal.companyOwnerName}</span>
          )}
        </div>
      )}

      <div className="inbound-card-age">
        Entered Sales Validating:{' '}
        {daysAgo === null ? '—' : daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo}d ago`}
        {deal.dateEnteredStage && (
          <span className="inbound-card-age-date">
            {' \u00b7 '}{new Date(deal.dateEnteredStage).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        )}
      </div>

      <div className="inbound-card-actions">
        <button className="inbound-action-btn">
          View Content & Tactics <ArrowRight size={13} />
        </button>
      </div>
    </div>
  );
}

function formatCurrency(value) {
  if (value >= 1000) {
    return `$${(value / 1000).toFixed(0)}k`;
  }
  return `$${value.toLocaleString()}`;
}

function getDaysAgo(dateString) {
  if (!dateString) return null;
  const diff = Date.now() - new Date(dateString).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default InboundDeals;

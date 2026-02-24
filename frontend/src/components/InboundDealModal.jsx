import React, { useState, useEffect, useRef } from 'react';
import { X, CheckCircle, Circle, Loader2, ExternalLink, Download, Lightbulb, FileText, Phone } from 'lucide-react';
import { supabaseClient } from '../services/supabase';

/**
 * InboundDealModal Component
 * Shows deal details, demo form notes, AI-generated content recommendations,
 * and outreach tactics when a deal card is clicked.
 */
function InboundDealModal({ deal, onClose }) {
  const [aiOutput, setAiOutput] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const overlayRef = useRef(null);

  // Close on Escape key
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  // Trigger AI generation on mount
  useEffect(() => {
    generateRecommendations();
  }, [deal.id]);

  async function generateRecommendations() {
    setAiLoading(true);
    setAiError(null);
    setAiOutput(null);

    try {
      // Fetch state-matched content from Supabase with IDs for reliable link lookup
      let supabaseItems = [];
      if (deal.companyState) {
        const { data: contentItems } = await supabaseClient
          .from('marketing_content')
          .select('id, title, type, summary, state, live_link, ungated_link')
          .or(`state.eq.${deal.companyState},state.eq.National`)
          .order('created_at', { ascending: false })
          .limit(12);

        supabaseItems = contentItems || [];
      }

      // Build numbered content list — AI returns item numbers, we look up links by index
      const contentContext = supabaseItems.length > 0
        ? '\n\nAVAILABLE CONTENT (state-matched):\n' +
          supabaseItems.map((c, i) =>
            `[#${i + 1}] [${c.type}] "${c.title}"${c.state && c.state !== 'National' ? ` (${c.state})` : ' (National)'}\n` +
            `   ${c.summary ? c.summary.substring(0, 150) + '...' : 'No summary'}`
          ).join('\n')
        : '';

      const systemPrompt = `You are a B2B sales enablement assistant helping a school district software sales rep prepare for outreach to a new inbound lead.

Your job: Recommend the most relevant 3-5 content assets for this specific prospect AND suggest 2-3 personalized outreach tactics based on their demo form notes and district context.

IMPORTANT: Only recommend items from the AVAILABLE CONTENT list. Return the content_index number (e.g., 1, 3, 5) — do NOT copy URLs.

Respond ONLY with valid JSON in this exact structure:
{
  "recommendations": [
    {
      "rank": 1,
      "content_index": 3,
      "title": "exact title from list",
      "type": "content type",
      "reason": "1-2 sentences explaining why this fits this specific prospect's notes and context"
    }
  ],
  "tactics": [
    "Specific, personalized tactic referencing this prospect's form notes or district",
    "Tactic 2",
    "Tactic 3"
  ]
}`;

      const userPrompt = `DEAL CONTEXT:
- District: ${deal.companyName}
- Location: ${[deal.companyCity, deal.companyState].filter(Boolean).join(', ') || 'Unknown'}
- Enrollment: ${deal.enrollment ? deal.enrollment.toLocaleString() + ' students' : 'Unknown'}
- ACV: ${deal.acv != null ? formatCurrency(deal.acv) : 'Unknown'}
- Contact: ${deal.contactName || 'Unknown'}${deal.contactTitle ? `, ${deal.contactTitle}` : ''}${deal.contactEmail ? ` (${deal.contactEmail})` : ''}
- Contact Role: ${deal.contactRole || 'Unknown'}
- Meeting booked: ${deal.meetingBooked ? 'YES' : 'NO'}
- Rep Owner: ${deal.ownerName || 'Unknown'}${deal.companyOwnerName ? ` | Acct Owner: ${deal.companyOwnerName}` : ''}
${deal.trafficSource ? `- Lead traffic source: ${deal.trafficSource}` : ''}
${deal.companyDescription ? `- District background: ${deal.companyDescription.substring(0, 300)}` : ''}

DEMO REQUEST FORM NOTES (what the prospect wrote when submitting the demo request):
${deal.demoFormNotes || 'No notes provided.'}
${contentContext}

Which content items (#) are most relevant to this prospect and what personalized outreach tactics should the rep use?`;

      const response = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_completion_tokens: 1500,
        }),
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `API error ${response.status}`);
      }

      const data = await response.json();
      const raw = data.choices?.[0]?.message?.content || '';

      // Parse JSON from response
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('Invalid AI response format');
      const parsed = JSON.parse(jsonMatch[0]);

      // Resolve content links from Supabase by content_index — guaranteed correct URLs
      if (parsed.recommendations && supabaseItems.length > 0) {
        parsed.recommendations = parsed.recommendations.map(rec => {
          const idx = typeof rec.content_index === 'number' ? rec.content_index - 1 : -1;
          const item = idx >= 0 ? supabaseItems[idx] : null;
          // Fallback: fuzzy title match if index missing
          const fallback = !item
            ? supabaseItems.find(s =>
                s.title?.toLowerCase().includes(rec.title?.toLowerCase()?.slice(0, 20))
              )
            : null;
          const source = item || fallback;
          return {
            ...rec,
            live_link: source?.live_link || null,
            ungated_link: source?.ungated_link || null,
          };
        });
      }

      setAiOutput(parsed);
    } catch (err) {
      console.error('[InboundDealModal] AI error:', err.message);
      setAiError(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  function handleOverlayClick(e) {
    if (e.target === overlayRef.current) onClose();
  }

  const daysAgo = getDaysAgo(deal.dateEnteredStage);

  return (
    <div className="inbound-modal-overlay" ref={overlayRef} onClick={handleOverlayClick}>
      <div className="inbound-modal" role="dialog" aria-modal="true">

        {/* Modal Header */}
        <div className="inbound-modal-header">
          <div className="inbound-modal-title-row">
            <div className="inbound-modal-title">
              <h2>{deal.companyName}</h2>
              {deal.companyState && (
                <span className="inbound-modal-state-badge">{deal.companyState}</span>
              )}
            </div>
            <button className="inbound-modal-close" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          </div>

          <div className="inbound-modal-meta">
            {deal.companyCity && deal.companyState && (
              <span className="inbound-meta-item">{deal.companyCity}, {deal.companyState}</span>
            )}
            <span className="inbound-meta-item">
              <strong>ACV:</strong> {deal.acv != null ? formatCurrency(deal.acv) : '—'}
            </span>
            <span className="inbound-meta-item">
              <strong>Enrollment:</strong> {deal.enrollment != null ? deal.enrollment.toLocaleString() + ' students' : '—'}
            </span>
            <span className={`inbound-modal-meeting ${deal.meetingBooked ? 'booked' : 'none'}`}>
              {deal.meetingBooked
                ? <><CheckCircle size={13} /> Meeting Booked</>
                : <><Circle size={13} /> No Meeting Yet</>
              }
            </span>
          </div>

          <div className="inbound-modal-contacts">
            {deal.contactName && (
              <span className="inbound-meta-item">
                Contact: <strong>{deal.contactName}</strong>
                {deal.contactTitle && <span className="inbound-contact-title">, {deal.contactTitle}</span>}
                {deal.contactRole && <span className="inbound-contact-role"> · {deal.contactRole}</span>}
                {deal.contactEmail && (
                  <a href={`mailto:${deal.contactEmail}`} className="inbound-email-link">
                    {' '}{deal.contactEmail}
                  </a>
                )}
                {deal.contactPhone && (
                  <a href={`tel:${deal.contactPhone}`} className="inbound-phone-link">
                    {' '}<Phone size={11} /> {deal.contactPhone}
                  </a>
                )}
              </span>
            )}
            {deal.ownerName && (
              <span className="inbound-meta-item">Owner: <strong>{deal.ownerName}</strong></span>
            )}
            {daysAgo !== null && (
              <span className="inbound-meta-item inbound-meta-age">
                Entered Sales Validating{' '}
                {daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`}
                {deal.dateEnteredStage && (
                  <> · {new Date(deal.dateEnteredStage).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Demo Form Notes */}
        {deal.demoFormNotes && (
          <div className="inbound-modal-notes">
            <div className="inbound-modal-section-title">
              <FileText size={15} /> Demo Request Form Notes
            </div>
            <p className="inbound-notes-text">{deal.demoFormNotes}</p>
          </div>
        )}

        {/* AI Recommendations */}
        <div className="inbound-modal-ai">
          <div className="inbound-modal-section-title">
            <Lightbulb size={15} /> Content Recommendations & Outreach Tactics
          </div>

          {aiLoading && (
            <div className="inbound-ai-loading">
              <Loader2 className="spin" size={20} />
              <span>Generating personalized recommendations...</span>
            </div>
          )}

          {aiError && (
            <div className="inbound-ai-error">
              <span>Could not generate recommendations: {aiError}</span>
              <button onClick={generateRecommendations} className="inbound-retry-btn">Retry</button>
            </div>
          )}

          {aiOutput && (
            <>
              {/* Content Recommendations */}
              {aiOutput.recommendations && aiOutput.recommendations.length > 0 && (
                <div className="inbound-recommendations">
                  <div className="inbound-recs-label">Recommended Content</div>
                  <div className="inbound-recs-grid">
                    {aiOutput.recommendations.map((rec, idx) => (
                      <div key={idx} className="inbound-suggestion-card">
                        <div className="inbound-suggestion-header">
                          <span className="inbound-suggestion-rank">#{rec.rank || idx + 1}</span>
                          <span className="inbound-suggestion-type">{rec.type}</span>
                        </div>
                        <div className="inbound-suggestion-title">{rec.title}</div>
                        <div className="inbound-suggestion-reason">{rec.reason}</div>
                        <div className="inbound-suggestion-links">
                          {rec.live_link && rec.live_link !== 'null' && (
                            <a
                              href={rec.live_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inbound-suggestion-link view"
                            >
                              View <ExternalLink size={11} />
                            </a>
                          )}
                          {rec.ungated_link && rec.ungated_link !== 'null' && (
                            <a
                              href={rec.ungated_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inbound-suggestion-link download"
                            >
                              <Download size={11} /> Download
                            </a>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Outreach Tactics */}
              {aiOutput.tactics && aiOutput.tactics.length > 0 && (
                <div className="inbound-tactics">
                  <div className="inbound-tactics-label">Outreach Tactics</div>
                  <ul className="inbound-tactics-list">
                    {aiOutput.tactics.map((tactic, idx) => (
                      <li key={idx}>{tactic}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
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

export default InboundDealModal;

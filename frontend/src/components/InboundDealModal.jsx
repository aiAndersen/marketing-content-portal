import React, { useState, useEffect, useRef } from 'react';
import { X, CheckCircle, Circle, Loader2, ExternalLink, Download, Lightbulb, FileText } from 'lucide-react';
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
      // Fetch state-matched content from Supabase
      let contentContext = '';
      if (deal.companyState) {
        const { data: contentItems } = await supabaseClient
          .from('marketing_content')
          .select('title, type, summary, state, live_link, ungated_link')
          .or(`state.eq.${deal.companyState},state.eq.National`)
          .order('created_at', { ascending: false })
          .limit(10);

        if (contentItems && contentItems.length > 0) {
          contentContext = '\n\nAVAILABLE CONTENT FOR THIS STATE:\n' +
            contentItems.map((c, i) =>
              `${i + 1}. [${c.type}] "${c.title}"${c.state ? ` (${c.state})` : ''}\n   ${c.summary ? c.summary.substring(0, 120) + '...' : 'No summary'}\n   Links: ${[c.live_link, c.ungated_link].filter(Boolean).join(' | ') || 'None'}`
            ).join('\n');
        }
      }

      const systemPrompt = `You are a B2B sales enablement assistant helping a school district software sales rep prepare for outreach to a new inbound lead.

Your job: Given deal context and available content assets, recommend the most relevant 3-5 pieces of content for this specific prospect AND suggest 2-3 personalized outreach tactics.

Respond ONLY with valid JSON in this exact structure:
{
  "recommendations": [
    {
      "rank": 1,
      "title": "content title here",
      "type": "content type",
      "reason": "1-2 sentence explanation of why this fits this deal",
      "link": "url or null"
    }
  ],
  "tactics": [
    "Tactic sentence 1",
    "Tactic sentence 2",
    "Tactic sentence 3"
  ]
}`;

      const userPrompt = `DEAL CONTEXT:
- District: ${deal.companyName}
- Location: ${[deal.companyCity, deal.companyState].filter(Boolean).join(', ') || 'Unknown'}
- Enrollment: ${deal.enrollment ? deal.enrollment.toLocaleString() + ' students' : 'Unknown'}
- ACV: ${deal.acv != null ? formatCurrency(deal.acv) : 'Unknown'}
- Contact: ${deal.contactName || 'Unknown'}${deal.contactEmail ? ` (${deal.contactEmail})` : ''}
- Meeting booked: ${deal.meetingBooked ? 'YES' : 'NO'}
- Owner: ${deal.ownerName || 'Unknown'}
${deal.companyDescription ? `- District background: ${deal.companyDescription.substring(0, 300)}` : ''}
DEMO FORM NOTES:
${deal.demoFormNotes || 'No notes provided.'}
${contentContext}

Based on this prospect's context, which content assets are most relevant and what are the best outreach tactics?`;

      const response = await fetch('/api/openai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-5-mini',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          max_tokens: 1200,
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
            {deal.acv != null && (
              <span className="inbound-meta-item">
                <strong>ACV:</strong> {formatCurrency(deal.acv)}
              </span>
            )}
            {deal.enrollment != null && (
              <span className="inbound-meta-item">
                <strong>Enrollment:</strong> {deal.enrollment.toLocaleString()} students
              </span>
            )}
            <span className={`inbound-modal-meeting ${deal.meetingBooked ? 'booked' : 'none'}`}>
              {deal.meetingBooked
                ? <><CheckCircle size={13} /> Meeting Booked</>
                : <><Circle size={13} /> No Meeting Yet</>
              }
            </span>
          </div>

          {(deal.contactName || deal.ownerName) && (
            <div className="inbound-modal-contacts">
              {deal.contactName && (
                <span className="inbound-meta-item">
                  Contact: <strong>{deal.contactName}</strong>
                  {deal.contactEmail && (
                    <a href={`mailto:${deal.contactEmail}`} className="inbound-email-link">
                      {' '}{deal.contactEmail}
                    </a>
                  )}
                </span>
              )}
              {deal.ownerName && (
                <span className="inbound-meta-item">Owner: <strong>{deal.ownerName}</strong></span>
              )}
              {daysAgo !== null && (
                <span className="inbound-meta-item inbound-meta-age">
                  Entered stage {daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Demo Form Notes */}
        {deal.demoFormNotes && (
          <div className="inbound-modal-notes">
            <div className="inbound-modal-section-title">
              <FileText size={15} /> Demo Form Notes
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
                        {rec.link && rec.link !== 'null' && (
                          <a
                            href={rec.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inbound-suggestion-link"
                          >
                            Open <ExternalLink size={11} />
                          </a>
                        )}
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

import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, User, ExternalLink, RefreshCw, FileText, Download } from 'lucide-react';

/**
 * Format AI response text for better readability
 * Converts markdown-style text to structured HTML
 */
function formatResponseText(text) {
  // Guard against null/undefined/non-string input
  if (!text || typeof text !== 'string') {
    return text ? <p>{String(text)}</p> : null;
  }

  // Split into paragraphs
  const paragraphs = text.split(/\n\n+/);

  return paragraphs.map((paragraph, pIdx) => {
    // Check if it's a list (starts with - or *)
    if (paragraph.trim().match(/^[-*•]\s/m)) {
      const items = paragraph.split(/\n/).filter(line => line.trim());
      return (
        <ul key={pIdx} className="chat-response-list">
          {items.map((item, iIdx) => (
            <li key={iIdx}>{item.replace(/^[-*•]\s*/, '')}</li>
          ))}
        </ul>
      );
    }

    // Check if it's a numbered list
    if (paragraph.trim().match(/^\d+[.)]\s/m)) {
      const items = paragraph.split(/\n/).filter(line => line.trim());
      return (
        <ol key={pIdx} className="chat-response-list">
          {items.map((item, iIdx) => (
            <li key={iIdx}>{item.replace(/^\d+[.)]\s*/, '')}</li>
          ))}
        </ol>
      );
    }

    // Regular paragraph - handle inline formatting
    let formattedText = paragraph;

    // Bold: **text** or __text__
    formattedText = formattedText.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    formattedText = formattedText.replace(/__(.+?)__/g, '<strong>$1</strong>');

    // Italic: *text* or _text_
    formattedText = formattedText.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    formattedText = formattedText.replace(/_([^_]+)_/g, '<em>$1</em>');

    // Handle line breaks within paragraph
    formattedText = formattedText.replace(/\n/g, '<br/>');

    return (
      <p key={pIdx} dangerouslySetInnerHTML={{ __html: formattedText }} />
    );
  });
}

/**
 * ChatInterface Component
 * Provides a conversational interface for the AI Search Assistant
 * Supports multi-turn dialog with conversation history
 */
function ChatInterface({
  conversationHistory,
  onSendMessage,
  loading,
  results,
  contentDatabase,  // Full content database for recommendation lookups
  onClearConversation
}) {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-scroll within chat container only (not the page)
  useEffect(() => {
    if (messagesContainerRef.current) {
      messagesContainerRef.current.scrollTop = messagesContainerRef.current.scrollHeight;
    }
  }, [conversationHistory]);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputValue.trim() || loading) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
  };

  const handleSuggestionClick = (suggestion) => {
    if (loading) return;
    onSendMessage(suggestion);
  };

  // Suggested queries from SchooLinks context doc section 13
  const suggestions = [
    "What makes SchooLinks different from Naviance?",
    "Content for school counselors",
    "Customer stories from Texas",
    "Xello vs SchooLinks comparisons"
  ];

  return (
    <div className="chat-interface">
      <div className="chat-header">
        <div className="chat-header-title">
          <Sparkles size={20} />
          <span>AI Search Assistant</span>
        </div>
        {conversationHistory.length > 0 && (
          <button
            className="chat-clear-btn"
            onClick={onClearConversation}
            title="Start new conversation"
          >
            <RefreshCw size={16} />
            New Chat
          </button>
        )}
      </div>

      <div className="chat-messages" ref={messagesContainerRef}>
        {conversationHistory.length === 0 && (
          <div className="chat-welcome">
            <Sparkles size={32} />
            <h3>How can I help you find content?</h3>
            <p>Ask me about marketing materials, competitor comparisons, customer stories, or content for specific personas.</p>
            <div className="chat-suggestions">
              {suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSuggestionClick(suggestion)}
                  disabled={loading}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {conversationHistory.map((message) => (
          <div
            key={message.id}
            className={`chat-message chat-message-${message.role}`}
          >
            <div className="chat-message-avatar">
              {message.role === 'user' ? (
                <User size={16} />
              ) : (
                <Sparkles size={16} />
              )}
            </div>
            <div className="chat-message-content">
              {message.role === 'user' ? (
                <p>{message.content}</p>
              ) : (
                <div className="chat-response-text">
                  {formatResponseText(message.content)}
                </div>
              )}

              {/* Render recommendations for assistant messages */}
              {message.role === 'assistant' && message.recommendations?.length > 0 && (
                <div className="chat-recommendations">
                  <span className="chat-rec-header">
                    <FileText size={14} />
                    Recommended Content ({message.recommendations.length})
                  </span>
                  <div className="chat-rec-grid">
                    {message.recommendations.map((rec, idx) => {
                      // Find item by title - check both results and full database
                      const item = (results || []).find(r => r.title === rec.title) ||
                                   (contentDatabase || []).find(r => r.title === rec.title);

                      // Always render card - use rec data as fallback if item not found
                      const title = item?.title || rec.title;
                      const type = item?.type || rec.type || 'Content';
                      const state = item?.state;
                      const liveLink = item?.live_link;
                      const ungatedLink = item?.ungated_link;

                      return (
                        <div key={idx} className="chat-rec-card">
                          <div className="chat-rec-card-header">
                            <span className="chat-rec-type">{type}</span>
                            {state && <span className="chat-rec-state">{state}</span>}
                          </div>
                          <div className="chat-rec-card-title">{title}</div>
                          {rec.reason && (
                            <div className="chat-rec-card-reason">{rec.reason}</div>
                          )}
                          <div className="chat-rec-card-actions">
                            {liveLink && (
                              <a
                                href={liveLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="chat-rec-action-btn primary"
                              >
                                View Live <ExternalLink size={12} />
                              </a>
                            )}
                            {ungatedLink && (
                              <a
                                href={ungatedLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="chat-rec-action-btn"
                              >
                                <Download size={12} /> Download
                              </a>
                            )}
                            {!liveLink && !ungatedLink && (
                              <span className="chat-rec-no-link">See results below</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Follow-up suggestions */}
              {message.role === 'assistant' && message.followUpQuestions?.length > 0 && (
                <div className="chat-follow-ups">
                  <span className="chat-follow-up-label">You might also ask:</span>
                  {message.followUpQuestions.slice(0, 2).map((q, idx) => (
                    <button
                      key={idx}
                      className="chat-follow-up-btn"
                      onClick={() => handleSuggestionClick(q)}
                      disabled={loading}
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="chat-message chat-message-assistant chat-loading">
            <div className="chat-message-avatar">
              <Sparkles size={16} />
            </div>
            <div className="chat-message-content">
              <div className="chat-typing-indicator">
                <span></span><span></span><span></span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="chat-input-form">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Ask about marketing content..."
          disabled={loading}
          className="chat-input"
        />
        <button
          type="submit"
          disabled={loading || !inputValue.trim()}
          className="chat-send-btn"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

export default ChatInterface;

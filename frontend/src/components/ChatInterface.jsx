import React, { useState, useRef, useEffect } from 'react';
import { Send, Sparkles, User, ExternalLink, RefreshCw } from 'lucide-react';

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
              <p>{message.content}</p>

              {/* Render recommendations for assistant messages */}
              {message.role === 'assistant' && message.recommendations?.length > 0 && (
                <div className="chat-recommendations">
                  {message.recommendations.map((rec, idx) => {
                    // Find item by title
                    const item = results.find(r => r.title === rec.title);
                    if (!item) return null;
                    return (
                      <a
                        key={idx}
                        href={item.live_link || item.ungated_link || '#'}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="chat-rec-link"
                        title={rec.reason}
                      >
                        <span className="chat-rec-type">{item.type}</span>
                        <span className="chat-rec-title">{item.title}</span>
                        <ExternalLink size={12} />
                      </a>
                    );
                  })}
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

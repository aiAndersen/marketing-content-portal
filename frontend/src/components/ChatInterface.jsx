import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Sparkles, User, ExternalLink, RefreshCw, FileText, Download, Mic, MicOff, Loader2, Zap, List, HelpCircle } from 'lucide-react';

// OpenAI API key is now handled server-side via /api/whisper proxy

/**
 * Custom hook for OpenAI Whisper speech-to-text
 */
function useWhisperSpeechToText() {
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Use webm format which Whisper supports well
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
      });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.start(100); // Collect data every 100ms
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone access error:', err);
      setError('Microphone access denied. Please enable it in browser settings.');
    }
  }, []);

  const stopRecording = useCallback(async () => {
    return new Promise((resolve) => {
      if (!mediaRecorderRef.current || mediaRecorderRef.current.state === 'inactive') {
        resolve(null);
        return;
      }

      mediaRecorderRef.current.onstop = async () => {
        setIsRecording(false);
        setIsTranscribing(true);

        try {
          // Create audio blob
          const audioBlob = new Blob(audioChunksRef.current, {
            type: mediaRecorderRef.current.mimeType
          });

          // Stop all tracks
          mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());

          // Send to OpenAI Whisper API
          const formData = new FormData();
          formData.append('file', audioBlob, 'recording.webm');
          formData.append('model', 'whisper-1');
          formData.append('language', 'en');

          // Use serverless proxy to keep API key secure
          const response = await fetch('/api/whisper', {
            method: 'POST',
            body: formData
          });

          if (!response.ok) {
            throw new Error(`Whisper API error: ${response.status}`);
          }

          const data = await response.json();
          setIsTranscribing(false);
          resolve(data.text || '');
        } catch (err) {
          console.error('Transcription error:', err);
          setError('Failed to transcribe audio. Please try again.');
          setIsTranscribing(false);
          resolve(null);
        }
      };

      mediaRecorderRef.current.stop();
    });
  }, []);

  const isSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  return {
    isRecording,
    isTranscribing,
    error,
    startRecording,
    stopRecording,
    isSupported
  };
}

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
 * StructuredResponse Component
 * Renders AI responses in scannable sections: Quick Answer, Key Points, Content, Follow-ups
 */
function StructuredResponse({ message, onFollowUp, loading, results, contentDatabase }) {
  const { quick_answer, key_points, recommendations: rawRecommendations, follow_up_questions } = message;

  // Deduplicate recommendations by normalized title
  const recommendations = (() => {
    const seenTitles = new Set();
    return (rawRecommendations || []).filter(rec => {
      const norm = (rec.title || '').toLowerCase().trim();
      if (seenTitles.has(norm)) return false;
      seenTitles.add(norm);
      return true;
    });
  })();

  // Fuzzy title matching for recommendations (same logic as before)
  const normalizeForMatch = (str) => (str || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');

  const getKeyWords = (str) => {
    const words = normalizeForMatch(str).split(' ').filter(w => w.length > 3);
    return words.slice(0, 6);
  };

  const findContentItem = (rec) => {
    const recTitleNorm = normalizeForMatch(rec.title);
    const recKeyWords = getKeyWords(rec.title);

    const findByFuzzyTitle = (items) => (items || []).find(r => {
      const itemTitleNorm = normalizeForMatch(r.title);
      if (itemTitleNorm === recTitleNorm) return true;
      const minLen = Math.min(itemTitleNorm.length, recTitleNorm.length);
      if (minLen > 15 && (itemTitleNorm.includes(recTitleNorm) || recTitleNorm.includes(itemTitleNorm))) {
        return true;
      }
      const itemKeyWords = getKeyWords(r.title);
      const matchCount = recKeyWords.filter(w => itemKeyWords.includes(w)).length;
      const matchRatio = matchCount / Math.max(recKeyWords.length, 1);
      return matchCount >= 4 && matchRatio >= 0.6;
    });

    return findByFuzzyTitle(results) || findByFuzzyTitle(contentDatabase);
  };

  return (
    <div className="chat-structured-response">
      {/* Quick Answer Section */}
      {quick_answer && (
        <div className="chat-section">
          <div className="chat-section-title">
            <Zap size={14} />
            Quick Answer
          </div>
          <div className="chat-quick-answer">{quick_answer}</div>
        </div>
      )}

      {/* Key Points Section */}
      {key_points?.length > 0 && (
        <div className="chat-section">
          <div className="chat-section-title">
            <List size={14} />
            Key Points
          </div>
          <ul className="chat-key-points">
            {key_points.map((point, idx) => (
              <li key={idx}>{point}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Recommended Content Section */}
      {recommendations?.length > 0 && (
        <div className="chat-section">
          <div className="chat-section-title">
            <FileText size={14} />
            Recommended Content ({recommendations.length})
          </div>
          <div className="chat-rec-grid">
            {recommendations.map((rec, idx) => {
              const item = findContentItem(rec);
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
                  {(item?.summary || rec.reason) && (
                    <div className="chat-rec-card-reason">
                      {item?.summary
                        ? (item.summary.length > 150 ? item.summary.substring(0, 150) + '...' : item.summary)
                        : rec.reason}
                    </div>
                  )}
                  <div className="chat-rec-card-actions">
                    {liveLink && (
                      <a
                        href={liveLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="chat-rec-action-btn primary"
                        onClick={() => {
                          if (window.heap) window.heap.track('Chat Recommendation Clicked', {
                            content_type: type,
                            content_title: title,
                            link_type: 'live'
                          });
                        }}
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
                        onClick={() => {
                          if (window.heap) window.heap.track('Chat Recommendation Clicked', {
                            content_type: type,
                            content_title: title,
                            link_type: 'download'
                          });
                        }}
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

      {/* Follow-up Questions Section */}
      {follow_up_questions?.length > 0 && (
        <div className="chat-section">
          <div className="chat-section-title">
            <HelpCircle size={14} />
            Next Best Questions
          </div>
          <div className="chat-followups">
            {follow_up_questions.map((q, idx) => (
              <button
                key={idx}
                className="chat-followup-chip"
                onClick={() => onFollowUp(q)}
                disabled={loading}
              >
                {idx + 1}. {q}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
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
  const [showVoiceHelper, setShowVoiceHelper] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);

  // Voice input with OpenAI Whisper
  const {
    isRecording,
    isTranscribing,
    error: voiceError,
    startRecording,
    stopRecording,
    isSupported: voiceSupported
  } = useWhisperSpeechToText();

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

  useEffect(() => {
    if (!voiceSupported || !isInputFocused || loading || isRecording || isTranscribing) {
      setShowVoiceHelper(false);
      return;
    }

    if (!inputValue.trim()) {
      setShowVoiceHelper(false);
      return;
    }

    setShowVoiceHelper(false);
    const timeoutId = setTimeout(() => {
      if (!loading && !isRecording && !isTranscribing && inputValue.trim()) {
        setShowVoiceHelper(true);
      }
    }, 4500);

    return () => clearTimeout(timeoutId);
  }, [inputValue, isInputFocused, loading, isRecording, isTranscribing, voiceSupported]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!inputValue.trim() || loading) return;
    onSendMessage(inputValue.trim());
    setInputValue('');
    setShowVoiceHelper(false);
  };

  const handleSuggestionClick = (suggestion) => {
    if (loading) return;
    onSendMessage(suggestion);
  };

  // Handle voice input toggle
  const handleVoiceToggle = async () => {
    setShowVoiceHelper(false);
    if (isRecording) {
      const transcript = await stopRecording();
      if (transcript) {
        // Append to existing input or set new value
        setInputValue(prev => prev ? `${prev} ${transcript}` : transcript);
        inputRef.current?.focus();
      }
    } else {
      startRecording();
    }
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

        {conversationHistory.map((message) => {
          // Debug logging for recommendation cards
          if (message.role === 'assistant') {
            console.log('[ChatInterface] Rendering assistant message:', {
              id: message.id,
              hasRecommendations: !!message.recommendations,
              recommendationCount: message.recommendations?.length || 0,
              recommendations: message.recommendations
            });
          }

          return (
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
              ) : message.quick_answer ? (
                /* New structured format with sections */
                <StructuredResponse
                  message={message}
                  onFollowUp={handleSuggestionClick}
                  loading={loading}
                  results={results}
                  contentDatabase={contentDatabase}
                />
              ) : (
                /* Legacy format fallback */
                <>
                  <div className="chat-response-text">
                    {formatResponseText(message.content)}
                  </div>

                  {/* Legacy recommendations rendering */}
                  {(() => {
                    const seenTitles = new Set();
                    const uniqueRecs = (message.recommendations || []).filter(rec => {
                      const norm = (rec.title || '').toLowerCase().trim();
                      if (seenTitles.has(norm)) return false;
                      seenTitles.add(norm);
                      return true;
                    });
                    return uniqueRecs.length > 0 ? (
                    <div className="chat-section">
                      <div className="chat-section-title">
                        <FileText size={14} />
                        Recommended Content ({uniqueRecs.length})
                      </div>
                      <div className="chat-rec-grid">
                        {uniqueRecs.map((rec, idx) => {
                          const normalizeForMatch = (str) => (str || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[^\w\s]/g, '');
                          const recTitleNorm = normalizeForMatch(rec.title);
                          const getKeyWords = (str) => {
                            const words = normalizeForMatch(str).split(' ').filter(w => w.length > 3);
                            return words.slice(0, 6);
                          };
                          const recKeyWords = getKeyWords(rec.title);
                          const findByFuzzyTitle = (items) => (items || []).find(r => {
                            const itemTitleNorm = normalizeForMatch(r.title);
                            if (itemTitleNorm === recTitleNorm) return true;
                            const minLen = Math.min(itemTitleNorm.length, recTitleNorm.length);
                            if (minLen > 15 && (itemTitleNorm.includes(recTitleNorm) || recTitleNorm.includes(itemTitleNorm))) return true;
                            const itemKeyWords = getKeyWords(r.title);
                            const matchCount = recKeyWords.filter(w => itemKeyWords.includes(w)).length;
                            const matchRatio = matchCount / Math.max(recKeyWords.length, 1);
                            return matchCount >= 4 && matchRatio >= 0.6;
                          });
                          const item = findByFuzzyTitle(results) || findByFuzzyTitle(contentDatabase);
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
                              {(item?.summary || rec.reason) && (
                                <div className="chat-rec-card-reason">
                                  {item?.summary
                                    ? (item.summary.length > 150 ? item.summary.substring(0, 150) + '...' : item.summary)
                                    : rec.reason}
                                </div>
                              )}
                              <div className="chat-rec-card-actions">
                                {liveLink && (
                                  <a href={liveLink} target="_blank" rel="noopener noreferrer" className="chat-rec-action-btn primary">
                                    View Live <ExternalLink size={12} />
                                  </a>
                                )}
                                {ungatedLink && (
                                  <a href={ungatedLink} target="_blank" rel="noopener noreferrer" className="chat-rec-action-btn">
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
                  ) : null;
                  })()}

                  {/* Legacy follow-up suggestions */}
                  {message.followUpQuestions?.length > 0 && (
                    <div className="chat-section">
                      <div className="chat-section-title">
                        <HelpCircle size={14} />
                        Next Best Questions
                      </div>
                      <div className="chat-followups">
                        {message.followUpQuestions.slice(0, 3).map((q, idx) => (
                          <button
                            key={idx}
                            className="chat-followup-chip"
                            onClick={() => handleSuggestionClick(q)}
                            disabled={loading}
                          >
                            {idx + 1}. {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
          );
        })}

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

      {/* Voice error message */}
      {voiceError && (
        <div className="chat-voice-error">
          {voiceError}
        </div>
      )}

      <form onSubmit={handleSubmit} className="chat-input-form">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onFocus={() => setIsInputFocused(true)}
          onBlur={() => {
            setIsInputFocused(false);
            setShowVoiceHelper(false);
          }}
          placeholder={isRecording ? "Listening... click mic to stop" : isTranscribing ? "Transcribing..." : "Ask about marketing content..."}
          disabled={loading || isTranscribing}
          className="chat-input"
        />

        {/* Voice input button */}
        {voiceSupported && (
          <div className="chat-voice-wrapper">
            {showVoiceHelper && (
              <div className="chat-voice-helper" role="status" aria-live="polite">
                Try voice input — click the mic for fast speech to text.
              </div>
            )}
            <button
              type="button"
              onClick={handleVoiceToggle}
              disabled={loading || isTranscribing}
              className={`chat-voice-btn ${isRecording ? 'recording' : ''} ${isTranscribing ? 'transcribing' : ''}`}
              title={isRecording ? "Stop recording" : isTranscribing ? "Transcribing..." : "Voice input"}
            >
              {isTranscribing ? (
                <Loader2 size={18} className="animate-spin" />
              ) : isRecording ? (
                <MicOff size={18} />
              ) : (
                <Mic size={18} />
              )}
            </button>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !inputValue.trim() || isTranscribing}
          className="chat-send-btn"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  );
}

export default ChatInterface;

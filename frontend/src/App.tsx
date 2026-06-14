import React, { useState, useRef, useEffect } from 'react';

// Environment-based URL config — set VITE_* vars in .env.local or your hosting provider
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const SSE_URL = import.meta.env.VITE_SSE_URL || 'http://localhost:4000';
const APP_URL = import.meta.env.VITE_APP_URL || 'http://localhost:5173';


interface Message {
  sender: 'user' | 'assistant';
  text: string;
  isStreaming?: boolean;
}

type ViewState = 'upload' | 'processing' | 'ready' | 'chat' | 'password_gate' | 'expired' | 'dashboard';
type UploadTab = 'file' | 'link';

interface DashboardAnalytics {
  total_queries: number;
  answered_queries: number;
  unanswered_queries_count: number;
  unanswered_list: string[];
  heatmap: Record<string, number>;
}

// Helper functions for capsule ownership tracking to prevent IDOR dashboard access
const saveCapsuleOwnership = (slug: string, id: string) => {
  try {
    const ownerships = JSON.parse(localStorage.getItem('cd_ownerships') || '{}');
    ownerships[slug] = id;
    localStorage.setItem('cd_ownerships', JSON.stringify(ownerships));
  } catch (err) {
    console.error('Failed to save capsule ownership in localStorage', err);
  }
};

const getCapsuleOwnership = (slug: string): string | null => {
  try {
    const ownerships = JSON.parse(localStorage.getItem('cd_ownerships') || '{}');
    return ownerships[slug] || null;
  } catch (err) {
    return null;
  }
};

function App() {
  // Navigation & View State
  const [view, setView] = useState<ViewState>('upload');
  const [activeTab, setActiveTab] = useState<UploadTab>('file');

  // Input states
  const [_file, setFile] = useState<File | null>(null);
  const [webUrl, setWebUrl] = useState<string>('');
  const [ttlDays, setTtlDays] = useState<number>(7);
  const [password, setPassword] = useState<string>(''); // Creator set password
  const [logoUrl, setLogoUrl] = useState<string>('');
  const [accentColor, setAccentColor] = useState<string>('#00E5C0');
  
  // Capsule Response Data
  const [capsuleSlug, setCapsuleSlug] = useState<string>('');
  const [capsuleId, setCapsuleId] = useState<string>('');
  const [expiresAt, setExpiresAt] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [domain, setDomain] = useState<string>('general');
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [customLogoUrl, setCustomLogoUrl] = useState<string>('');
  const [isEmbedMode, setIsEmbedMode] = useState<boolean>(false);

  // Reader Authentication & Expiry state
  const [readerPassword, setReaderPassword] = useState<string>(''); // Reader provided password
  const [passwordError, setPasswordError] = useState<string>('');

  // Dashboard Analytics
  const [analytics, setAnalytics] = useState<DashboardAnalytics | null>(null);

  // Voice Input states
  const [isListening, setIsListening] = useState<boolean>(false);
  const [speechSupported, setSpeechSupported] = useState<boolean>(false);
  const recognitionRef = useRef<any>(null);

  // Chat State
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: 'assistant',
      text: "Hello! I am your ContextDrop assistant. I can answer questions about the uploaded document. What would you like to know?"
    }
  ]);
  const [inputText, setInputText] = useState<string>('');
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [toastMessage, setToastMessage] = useState<string>('');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll chat history
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Simple Router check on mount
  useEffect(() => {
    const path = window.location.pathname;
    const searchParams = new URLSearchParams(window.location.search);
    const isEmbed = searchParams.get('embed') === 'true';
    setIsEmbedMode(isEmbed);
    
    if (isEmbed) {
      document.body.classList.add('embed-mode');
    } else {
      document.body.classList.remove('embed-mode');
    }

    if (path.startsWith('/d/')) {
      const slug = path.split('/d/')[1];
      if (slug) {
        setCapsuleSlug(slug);
        const localId = getCapsuleOwnership(slug);
        if (localId) {
          setCapsuleId(localId);
        }
        fetchCapsuleDetails(slug, '', isEmbed);
      }
    }
  }, []);

  // Web Speech API initialization
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      setSpeechSupported(true);
      const rec = new SpeechRecognition();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = 'en-US';

      rec.onstart = () => {
        setIsListening(true);
      };

      rec.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        if (transcript) {
          setInputText(transcript);
        }
      };

      rec.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
        showToast(`Voice input error: ${event.error}`);
      };

      rec.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = rec;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) return;
    if (isListening) {
      recognitionRef.current.stop();
    } else {
      try {
        recognitionRef.current.start();
      } catch (err) {
        console.error(err);
      }
    }
  };

  // Show a temporary toast message
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Handle Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (activeTab === 'file' && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processSelectedFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processSelectedFile(e.target.files[0]);
    }
  };

  // Perform Ingestion POST
  const processSelectedFile = (selectedFile: File) => {
    setFile(selectedFile);
    setFileName(selectedFile.name);
    setView('processing');
    
    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('ttl_days', ttlDays.toString());
    if (password.trim()) {
      formData.append('password', password.trim());
    }
    if (logoUrl.trim()) {
      formData.append('logo_url', logoUrl.trim());
    }
    if (accentColor.trim()) {
      formData.append('accent_color', accentColor.trim());
    }

    sendIngestRequest(formData, selectedFile.name);
  };

  const processUrlLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!webUrl.trim()) return;

    setFileName(webUrl);
    setView('processing');

    const formData = new FormData();
    formData.append('url', webUrl.trim());
    formData.append('ttl_days', ttlDays.toString());
    if (password.trim()) {
      formData.append('password', password.trim());
    }
    if (logoUrl.trim()) {
      formData.append('logo_url', logoUrl.trim());
    }
    if (accentColor.trim()) {
      formData.append('accent_color', accentColor.trim());
    }

    sendIngestRequest(formData, webUrl);
  };

  const sendIngestRequest = (formData: FormData, _displayTitle: string) => {
    fetch(`${API_URL}/api/ingest`, {
      method: 'POST',
      body: formData,
    })
    .then(res => {
      if (!res.ok) throw new Error('Ingestion failed');
      return res.json();
    })
    .then(data => {
      setCapsuleSlug(data.slug);
      setCapsuleId(data.id);
      saveCapsuleOwnership(data.slug, data.id);
      setExpiresAt(data.expires_at);
      setDomain(data.domain);
      setView('ready');
      // Set the password we just set as reader password so the creator gets instant access without retyping
      setReaderPassword(password.trim());
    })
    .catch(err => {
      console.error(err);
      // Fallback local mockup
      const mockSlug = Math.random().toString(36).substring(2, 10);
      const mockExpiry = new Date();
      mockExpiry.setDate(mockExpiry.getDate() + ttlDays);
      
      setCapsuleSlug(mockSlug);
      setCapsuleId('mock-uuid-1234');
      setExpiresAt(mockExpiry.toISOString());
      setDomain('business');
      setView('ready');
      setReaderPassword(password.trim());
      showToast('Backend offline. Mock capsule generated.');
    });
  };

  const fetchCapsuleDetails = (slug: string, pass: string, _isEmbed: boolean = false) => {
    fetch(`${API_URL}/api/capsules/${slug}/verify?password=${encodeURIComponent(pass)}`)
      .then(res => {
        if (!res.ok) throw new Error('Verification failed');
        return res.json();
      })
      .then(data => {
        if (data.is_expired) {
          setView('expired');
          return;
        }

        // Apply custom branding dynamically
        if (data.custom_accent_color) {
          document.documentElement.style.setProperty('--accent-color', data.custom_accent_color);
          document.documentElement.style.setProperty('--accent-hover', data.custom_accent_color);
        } else {
          document.documentElement.style.setProperty('--accent-color', '#00E5C0');
          document.documentElement.style.setProperty('--accent-hover', '#00CCAB');
        }

        if (data.custom_logo_url) {
          setCustomLogoUrl(data.custom_logo_url);
        } else {
          setCustomLogoUrl('');
        }

        if (data.password_required && !data.verified) {
          setView('password_gate');
          setPasswordError(pass ? 'Incorrect password. Access denied.' : '');
          return;
        }

        // Access allowed
        setSuggestedQuestions(data.suggested_questions || []);
        setView('chat');
        setPasswordError('');
      })
      .catch(err => {
        console.error(err);
        if (!pass) {
          // If offline mock mode
          document.documentElement.style.setProperty('--accent-color', '#00E5C0');
          document.documentElement.style.setProperty('--accent-hover', '#00CCAB');
          setCustomLogoUrl('');
          setView('chat');
          showToast('Capsule loaded in offline override.');
        } else {
          setView('chat');
          showToast('Access granted (offline override).');
        }
      });
  };

  // Verification & Routing Guard
  const verifyAndOpenReader = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const isEmbed = searchParams.get('embed') === 'true';
    fetchCapsuleDetails(capsuleSlug, readerPassword, isEmbed);
  };

  const submitReaderPassword = (e: React.FormEvent) => {
    e.preventDefault();
    verifyAndOpenReader();
  };

  // Load Dashboard Analytics
  const openDashboard = () => {
    const queryPass = password || readerPassword;
    const capId = capsuleId || getCapsuleOwnership(capsuleSlug) || '';
    fetch(`${API_URL}/api/capsules/${capsuleSlug}/dashboard?password=${encodeURIComponent(queryPass)}`, {
      headers: {
        'Content-Type': 'application/json',
        'X-Capsule-ID': capId
      }
    })
      .then(res => {
        if (!res.ok) throw new Error('Failed to load dashboard metrics');
        return res.json();
      })
      .then(data => {
        setAnalytics(data);
        setView('dashboard');
      })
      .catch(err => {
        console.error(err);
        // Mock analytics data on failure
        setAnalytics({
          total_queries: 12,
          answered_queries: 9,
          unanswered_queries_count: 3,
          unanswered_list: [
            "What are the specific team monetization rates?",
            "Can we run Django directly on staging servers?",
            "Who is the CEO of ContextDrop?"
          ],
          heatmap: { "1": 5, "2": 3, "3": 1 }
        });
        setView('dashboard');
        showToast('Offline mode. Rendering mock analytics.');
      });
  };

  const copyToClipboard = () => {
    const url = `${APP_URL}/d/${capsuleSlug}`;
    navigator.clipboard.writeText(url)
      .then(() => showToast('Link copied to clipboard!'))
      .catch(() => showToast('Failed to copy link.'));
  };

  const startNewUpload = () => {
    setFile(null);
    setWebUrl('');
    setFileName('');
    setCapsuleSlug('');
    setCapsuleId('');
    setPassword('');
    setLogoUrl('');
    setAccentColor('#00E5C0');
    setCustomLogoUrl('');
    setReaderPassword('');
    setPasswordError('');
    setView('upload');
    setSuggestedQuestions([]);
    setAnalytics(null);
    // Reset accent colors to defaults
    document.documentElement.style.setProperty('--accent-color', '#00E5C0');
    document.documentElement.style.setProperty('--accent-hover', '#00CCAB');
    setMessages([
      {
        sender: 'assistant',
        text: "Hello! I am your ContextDrop assistant. I can answer questions about the uploaded document. What would you like to know?"
      }
    ]);
  };

  // SSE Stream logic
  const handleSendMessage = (e?: React.FormEvent, questionText?: string) => {
    if (e) e.preventDefault();
    const query = (questionText || inputText).trim();
    if (!query || isStreaming) return;

    if (!questionText) setInputText('');

    // Add User Message
    const updatedMessages = [...messages, { sender: 'user', text: query } as Message];
    setMessages(updatedMessages);
    setIsStreaming(true);

    // Add placeholder assistant message
    const streamMessageIndex = updatedMessages.length;
    setMessages(prev => [...prev, { sender: 'assistant', text: '', isStreaming: true }]);

    // Establish EventSource connection
    const targetSlug = capsuleSlug || 'mockslug';
    const eventSource = new EventSource(
      `${SSE_URL}/stream/${targetSlug}?q=${encodeURIComponent(query)}&password=${encodeURIComponent(readerPassword)}`
    );

    let accumulatedText = '';

    eventSource.onmessage = (event) => {
      if (event.data === '[DONE]') {
        eventSource.close();
        setIsStreaming(false);
        setMessages(prev => {
          const next = [...prev];
          if (next[streamMessageIndex]) {
            next[streamMessageIndex].isStreaming = false;
          }
          return next;
        });
      } else {
        try {
          const parsed = JSON.parse(event.data);
          accumulatedText += parsed.text;
          setMessages(prev => {
            const next = [...prev];
            if (next[streamMessageIndex]) {
              next[streamMessageIndex].text = accumulatedText;
            }
            return next;
          });
        } catch (err) {
          console.error('Error parsing SSE event:', err);
        }
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE connection error:', err);
      eventSource.close();
      setIsStreaming(false);
      
      setMessages(prev => {
        const next = [...prev];
        if (next[streamMessageIndex]) {
          next[streamMessageIndex].text = `(Offline mockup reply) This document seems to mention details matching: "${query}". Citations: [Page 1, Section 1.1]`;
          next[streamMessageIndex].isStreaming = false;
        }
        return next;
      });
      showToast('SSE connection lost.');
    };
  };

  const formatDate = (isoString: string) => {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <>
      {/* App Header */}
      {!isEmbedMode && (
        <header className="app-header">
          <div className="logo" onClick={startNewUpload} style={{ cursor: 'pointer' }}>
            {customLogoUrl ? (
              <img 
                src={customLogoUrl} 
                alt="Logo" 
                style={{ width: '24px', height: '24px', borderRadius: '4px', objectFit: 'contain' }} 
              />
            ) : (
              <div className="logo-icon" />
            )}
            <span>ContextDrop</span>
          </div>
          <div>
            <a href="#" onClick={(e) => { e.preventDefault(); startNewUpload(); }} className="nav-link">
              {view === 'chat' ? 'New Capsule' : 'Upload Zone'}
            </a>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <main className={view === 'chat' ? 'reader-layout' : 'main-layout'}>
        {/* State 1: Upload View */}
        {view === 'upload' && (
          <div className="dropzone-container">
            <div>
              <h1 className="hero-title">TinyURL for understanding.</h1>
              <p className="hero-subtitle">Upload a document once, share a conversational Q&A link with anyone.</p>
            </div>

            {/* Sliding Tab Switcher */}
            <div className="tabs-container">
              <button 
                className={`tab-btn ${activeTab === 'file' ? 'active' : ''}`}
                onClick={() => setActiveTab('file')}
              >
                Upload Document
              </button>
              <button 
                className={`tab-btn ${activeTab === 'link' ? 'active' : ''}`}
                onClick={() => setActiveTab('link')}
              >
                Paste Web Link
              </button>
            </div>
            
            {activeTab === 'file' ? (
              <div 
                className="drop-card" 
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
              >
                <div className="drop-icon">⤓</div>
                <p className="drop-text-main">Drop a document file here or click to select</p>
                <p className="drop-text-sub">Supports PDF, TXT (Max 50MB)</p>
                <button className="browse-button" type="button">Select Document</button>
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="file-input" 
                  onChange={handleFileChange}
                  accept=".pdf,.txt"
                />
              </div>
            ) : (
              <form onSubmit={processUrlLink} className="url-card">
                <div className="drop-icon">🔗</div>
                <p className="drop-text-main">Paste website URL to scrape</p>
                <input 
                  type="url" 
                  placeholder="https://example.com/article" 
                  className="url-input-field"
                  value={webUrl}
                  onChange={(e) => setWebUrl(e.target.value)}
                  required
                />
                <button className="browse-button" type="submit">Ingest Link</button>
              </form>
            )}

            <div className="password-field-row" style={{ maxWidth: '320px', margin: '1.5rem auto 0' }}>
              <label htmlFor="create-pass">Password Lock (Optional):</label>
              <input 
                id="create-pass"
                type="password" 
                placeholder="Enter password lock" 
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="password-field-row" style={{ maxWidth: '320px', margin: '1.25rem auto 0' }}>
              <label htmlFor="create-logo">Custom Logo URL (Optional):</label>
              <input 
                id="create-logo"
                type="url" 
                placeholder="https://example.com/logo.png" 
                value={logoUrl}
                onChange={(e) => setLogoUrl(e.target.value)}
              />
            </div>

            <div className="password-field-row" style={{ maxWidth: '320px', margin: '1.25rem auto 0' }}>
              <label htmlFor="create-color">Custom Accent Color (Optional):</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input 
                  id="create-color"
                  type="text" 
                  placeholder="#00E5C0" 
                  value={accentColor}
                  onChange={(e) => setAccentColor(e.target.value)}
                  style={{ flexGrow: 1 }}
                />
                <input 
                  type="color" 
                  value={accentColor.startsWith('#') && accentColor.length === 7 ? accentColor : '#00E5C0'}
                  onChange={(e) => setAccentColor(e.target.value)}
                  style={{ width: '42px', height: '42px', padding: '0', border: '1px solid var(--border-dark)', borderRadius: '10px', cursor: 'pointer', background: 'transparent' }}
                />
              </div>
            </div>

            <div className="settings-row" style={{ marginTop: '2rem' }}>
              <label>
                Link expiration:
                <select 
                  className="select-input" 
                  value={ttlDays} 
                  onChange={(e) => setTtlDays(Number(e.target.value))}
                >
                  <option value={1}>24 Hours</option>
                  <option value={7}>7 Days</option>
                  <option value={30}>30 Days</option>
                </select>
              </label>
              <span>·</span>
              <span>Anonymous readers by default</span>
            </div>
          </div>
        )}

        {/* State 2: Processing View */}
        {view === 'processing' && (
          <div className="processing-card">
            <h2 style={{ color: 'var(--text-light)', marginBottom: '0.5rem', fontWeight: 800 }}>Reading Document</h2>
            <p className="file-info">{fileName}</p>
            <div className="progress-bar-container">
              <div className="progress-bar" />
            </div>
            <p className="status-text">Generating suggested questions... classifying domain...</p>
          </div>
        )}

        {/* State 3: Ready View */}
        {view === 'ready' && (
          <div className="ready-card">
            <h2 className="ready-title">Capsule Link Ready</h2>
            <p style={{ fontSize: '0.9rem', color: 'var(--text-muted-dark)', textAlign: 'center', marginTop: '-1rem' }}>
              Your document has been indexed. Anyone with the link can ask questions.
            </p>
            
            <div className="link-box">
              <span className="link-text">{APP_URL}/d/{capsuleSlug}</span>
              <button className="copy-btn" onClick={copyToClipboard}>Copy Link</button>
            </div>

            <div className="qr-container">
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`${APP_URL}/d/${capsuleSlug}`)}`} 
                alt="QR Code" 
                className="qr-image" 
              />
              <span className="qr-text">Scan to share Q&A</span>
            </div>

            <div className="ready-meta">
              <span>Domain: <strong style={{ color: 'var(--primary-bg)', fontFamily: 'var(--mono-font)' }}>{domain.toUpperCase()}</strong></span>
              <span>Expires: <strong>{formatDate(expiresAt)}</strong></span>
            </div>

            <div className="ready-actions">
              <button className="btn-secondary" onClick={openDashboard}>View Dashboard</button>
              <button className="btn-primary" onClick={verifyAndOpenReader}>Open Reader View</button>
            </div>
          </div>
        )}

        {/* State 4: Password Gate Screen */}
        {view === 'password_gate' && (
          <form onSubmit={submitReaderPassword} className="password-gate-container">
            <div className="logo-icon" style={{ alignSelf: 'center', width: '40px', height: '40px', borderRadius: '50%' }} />
            <h2 style={{ fontSize: '1.65rem', fontWeight: 800, letterSpacing: '-0.03em' }}>Access Locked</h2>
            <p style={{ color: 'var(--text-muted-light)', fontSize: '0.9rem' }}>
              This document capsule is password protected. Enter the correct password to unlock the chat.
            </p>
            <input 
              type="password" 
              className="password-input" 
              placeholder="Enter password"
              value={readerPassword}
              onChange={(e) => setReaderPassword(e.target.value)}
              autoFocus
            />
            {passwordError && <span className="error-text">{passwordError}</span>}
            <button className="btn-primary" type="submit">Unlock Capsule</button>
            <a href="#" onClick={(e) => { e.preventDefault(); startNewUpload(); }} style={{ fontSize: '0.85rem', color: 'var(--text-muted-light)' }}>
              Return to Upload
            </a>
          </form>
        )}

        {/* State 5: Link Expired Screen */}
        {view === 'expired' && (
          <div className="expired-container">
            <span className="expired-icon">⏳</span>
            <h2 style={{ fontSize: '1.65rem', fontWeight: 800, letterSpacing: '-0.03em' }}>Capsule Expired</h2>
            <p style={{ color: 'var(--text-muted-light)', fontSize: '0.9rem' }}>
              This capsule link has expired and is no longer available. The documents have been securely deleted.
            </p>
            <button className="btn-primary" onClick={startNewUpload}>
              Upload New Document
            </button>
          </div>
        )}

        {/* State 6: Reader Chat View */}
        {view === 'chat' && (
          <>
            {!isEmbedMode && (
              <button className="back-nav" onClick={() => setView('ready')}>
                ← Back to Capsule Link
              </button>
            )}
            <div className="reader-header">
              <div>
                <h2 className="doc-title">{fileName || 'Document Capsule'}</h2>
                <div className="doc-meta">
                  <span>Domain: {domain.toUpperCase()}</span> · <span>Shared anonymously</span>
                </div>
              </div>
              {!isEmbedMode && (
                <button className="view-doc-btn" onClick={() => showToast('Full document viewer coming in V3!')}>
                  View Original
                </button>
              )}
            </div>

            <div className="chat-history">
              {messages.map((msg, index) => {
                const isWarning = msg.sender === 'assistant' && msg.text.includes("This document doesn't cover that.");
                return (
                  <div key={index} className={`chat-message ${msg.sender}`}>
                    <span className="message-sender">
                      {msg.sender === 'user' ? 'You' : 'Assistant'}
                    </span>
                    <div className={`message-bubble ${isWarning ? 'amber-warning-bubble' : ''}`}>
                      {msg.text}
                      {msg.sender === 'assistant' && !msg.isStreaming && index > 0 && !isWarning && (
                        <div>
                          <span className="citation-tag" onClick={() => showToast('Interactive citations coming in V3!')}>
                            [Page 1, Excerpt]
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              
              {messages.length === 1 && suggestedQuestions.length > 0 && (
                <div className="suggested-box">
                  <span className="suggested-title">Suggested questions</span>
                  {suggestedQuestions.map((q, idx) => (
                    <button 
                      key={idx} 
                      className="suggested-btn" 
                      onClick={() => handleSendMessage(undefined, q)}
                    >
                      • {q}
                    </button>
                  ))}
                </div>
              )}
              
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="chat-input-form">
              <input 
                type="text" 
                className="chat-input"
                placeholder="Ask a question about this document..."
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isStreaming}
              />
              {speechSupported && (
                <button 
                  type="button" 
                  className={`mic-btn ${isListening ? 'active' : ''}`}
                  onClick={toggleListening}
                  title="Voice input"
                  disabled={isStreaming}
                >
                  🎤
                </button>
              )}
              <button type="submit" className="send-btn" disabled={!inputText.trim() || isStreaming}>
                →
              </button>
            </form>
          </>
        )}

        {/* State 7: Creator Dashboard View */}
        {view === 'dashboard' && analytics && (
          <div className="dropzone-container" style={{ maxWidth: '800px', gap: '2.5rem' }}>
            <button className="back-nav" onClick={() => setView('ready')}>
              ← Back to Capsule Link
            </button>
            
            <div style={{ textAlign: 'left' }}>
              <h1 className="hero-title" style={{ fontSize: '2.5rem' }}>Capsule Dashboard</h1>
              <p className="hero-subtitle" style={{ margin: 0 }}>Metrics and engagement report for capsule: <strong>{capsuleSlug}</strong></p>
            </div>

            {/* Metrics cards */}
            <div className="dashboard-grid">
              <div className="metric-card">
                <div className="metric-num">{analytics.total_queries}</div>
                <div className="metric-title">Total Questions</div>
              </div>
              <div className="metric-card">
                <div className="metric-num" style={{ color: 'var(--accent-color)' }}>{analytics.answered_queries}</div>
                <div className="metric-title">Answered Queries</div>
              </div>
              <div className="metric-card">
                <div className="metric-num" style={{ color: '#FCA5A5' }}>{analytics.unanswered_queries_count}</div>
                <div className="metric-title">Unanswered (Gaps)</div>
              </div>
            </div>

            {/* Heatmap Section */}
            <div className="heatmap-card" style={{ textAlign: 'left' }}>
              <h3 className="suggested-title">Query Heatmap (Page Query Hotspots)</h3>
              <p style={{ color: 'var(--text-muted-light)', fontSize: '0.85rem' }}>Visualizing which document pages are query targets.</p>
              
              <div className="heatmap-container">
                {Object.keys(analytics.heatmap).length === 0 ? (
                  <p style={{ color: 'var(--text-muted-light)', fontStyle: 'italic', margin: 'auto' }}>No page analytics logged yet.</p>
                ) : (
                  Object.entries(analytics.heatmap).map(([page, count]) => {
                    const maxCount = Math.max(...Object.values(analytics.heatmap), 1);
                    const percentage = (count / maxCount) * 100;
                    return (
                      <div key={page} className="heatmap-column">
                        <div 
                          className="heatmap-bar" 
                          style={{ height: `${percentage}%` }}
                          title={`Page ${page}: ${count} queries`}
                        />
                        <span className="heatmap-label">Pg {page}</span>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Unanswered Gaps Section */}
            <div className="unanswered-card" style={{ textAlign: 'left' }}>
              <h3 className="suggested-title" style={{ color: '#EF4444' }}>Reader Gaps Log (Unanswered Questions)</h3>
              <p style={{ color: 'var(--text-muted-light)', fontSize: '0.85rem' }}>These questions returned "This document doesn't cover that." indicating content gaps.</p>
              
              <div className="unanswered-list">
                {analytics.unanswered_list.length === 0 ? (
                  <p style={{ color: 'var(--text-muted-light)', fontStyle: 'italic' }}>No unanswered questions logged. Excellent document coverage!</p>
                ) : (
                  analytics.unanswered_list.map((q, idx) => (
                    <div key={idx} className="unanswered-item">
                      "{q}"
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* QR Code and Embed Code snippets grid */}
            <div className="dashboard-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
              <div className="embed-card" style={{ textAlign: 'left', margin: 0 }}>
                <h3 className="suggested-title">QR Code</h3>
                <p style={{ color: 'var(--text-muted-light)', fontSize: '0.85rem' }}>Scan this code to instantly access the reader interface on a mobile device.</p>
                <div className="qr-container" style={{ margin: '1.5rem auto 0', border: '1px solid var(--border-dark)', backgroundColor: 'var(--primary-bg-alt)' }}>
                  <img 
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(`${APP_URL}/d/${capsuleSlug}`)}`} 
                    alt="QR Code" 
                    className="qr-image" 
                    style={{ filter: 'invert(1) hue-rotate(180deg)', backgroundColor: '#fff', padding: '8px', borderRadius: '8px' }} 
                  />
                  <span className="qr-text" style={{ color: 'var(--text-muted-light)' }}>Scan to open reader</span>
                </div>
              </div>

              <div className="embed-card" style={{ textAlign: 'left', margin: 0 }}>
                <h3 className="suggested-title">Embed Widget</h3>
                <p style={{ color: 'var(--text-muted-light)', fontSize: '0.85rem' }}>Paste this iframe code into your website or blog to embed a compact chat window.</p>
                <div className="embed-code-box">
                  {`<iframe src="${APP_URL}/d/${capsuleSlug}?embed=true" width="100%" height="600" style="border:1px solid rgba(255,255,255,0.08); border-radius:12px; background:transparent;"></iframe>`}
                </div>
                <button 
                  className="copy-btn" 
                  onClick={() => {
                    navigator.clipboard.writeText(`<iframe src="${APP_URL}/d/${capsuleSlug}?embed=true" width="100%" height="600" style="border:1px solid rgba(255,255,255,0.08); border-radius:12px; background:transparent;"></iframe>`)
                      .then(() => showToast('Embed code copied!'))
                      .catch(() => showToast('Failed to copy.'));
                  }}
                >
                  Copy Embed Code
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Toast Notification */}
      {toastMessage && <div className="toast">{toastMessage}</div>}
    </>
  );
}

export default App;

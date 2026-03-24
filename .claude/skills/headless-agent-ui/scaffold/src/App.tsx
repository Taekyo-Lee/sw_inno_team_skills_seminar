import { useState, useRef, useEffect } from 'react';

type Provider = 'gemini-cli' | 'opencode';

interface SkillInfo {
  name: string;
  description: string;
  scope: 'project' | 'global';
  provider?: string;
  model?: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  provider?: Provider;
  skillName?: string;
  skillChain?: string[];
  files?: string[];
  isStreaming?: boolean;
}

interface GeminiModel {
  name: string;
  context: string;
  reasoning: boolean;
}

interface OpencodeModel {
  name: string;
  displayName?: string;
  custom?: boolean;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<Provider>('gemini-cli');
  const [geminiModels, setGeminiModels] = useState<GeminiModel[]>([]);
  const [geminiModel, setGeminiModel] = useState('');
  const [opencodeModels, setOpencodeModels] = useState<OpencodeModel[]>([]);
  const [opencodeModel, setOpencodeModel] = useState('');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('theme') as 'dark' | 'light') || 'dark'
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    fetch('/api/skills')
      .then(r => r.json())
      .then((data: SkillInfo[]) => setSkills(data))
      .catch(() => setSkills([]));

    fetch('/api/models/gemini-cli')
      .then(r => r.json())
      .then((data: GeminiModel[]) => {
        setGeminiModels(data);
        if (data.length > 0) setGeminiModel(p => p || data[0].name);
      })
      .catch(() => setGeminiModels([]));

    fetch('/api/models/opencode')
      .then(r => r.json())
      .then((data: OpencodeModel[]) => {
        setOpencodeModels(data);
        if (data.length > 0) setOpencodeModel(p => p || data[0].name);
      })
      .catch(() => setOpencodeModels([]));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const currentModel = provider === 'gemini-cli' ? geminiModel : opencodeModel;

  const sendQuery = async (query: string) => {
    if (!query.trim() || isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query.trim(),
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      model: currentModel,
      provider,
      isStreaming: true,
    };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput('');
    setIsLoading(true);

    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim(), provider, model: currentModel }),
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const event of events) {
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'skill') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? { ...m, skillName: data.name, skillChain: data.chain }
                      : m,
                  ),
                );
              } else if (data.type === 'chain_step') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? { ...m, content: m.content + `\n--- [Step ${data.step}/${data.total}: ${data.skill}] ---\n` }
                      : m,
                  ),
                );
              } else if (data.type === 'chunk') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? { ...m, content: m.content + data.content }
                      : m,
                  ),
                );
              } else if (data.type === 'files') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? { ...m, files: data.paths }
                      : m,
                  ),
                );
              }
            } catch (_e) { /* skip */ }
          }
        }
      }

      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId ? { ...m, isStreaming: false } : m,
        ),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setMessages(prev =>
        prev.map(m =>
          m.id === assistantId
            ? { ...m, content: `Error: ${msg}`, isStreaming: false }
            : m,
        ),
      );
    } finally {
      setIsLoading(false);
      textareaRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendQuery(input);
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  const renderModelSelector = () => {
    if (provider === 'gemini-cli') {
      return (
        <select value={geminiModel} onChange={e => setGeminiModel(e.target.value)}>
          {geminiModels.map(m => (
            <option key={m.name} value={m.name}>
              {m.name} [{m.context}{m.reasoning ? ', reasoning' : ''}]
            </option>
          ))}
        </select>
      );
    }
    return (
      <select value={opencodeModel} onChange={e => setOpencodeModel(e.target.value)}>
        {opencodeModels.map(m => (
          <option key={m.name} value={m.name}>
            {m.displayName ? `${m.displayName} (${m.name})` : m.name}
          </option>
        ))}
      </select>
    );
  };

  const fileName = (p: string) => p.split('/').pop() || p;

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-title">Skills</div>
        {skills.map(s => (
          <div key={s.name} className="sidebar-skill">
            <span className="sidebar-skill-name">{s.name}</span>
            <span className={`scope-badge ${s.scope}`}>{s.scope}</span>
          </div>
        ))}
        {skills.length === 0 && (
          <div className="sidebar-empty">No skills</div>
        )}
      </aside>

      {/* Main content */}
      <div className="main-content">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1>Skill App</h1>
          <span className="subtitle">Lambda-style Agent</span>
        </div>
        <div className="header-controls">
          <button
            className="theme-toggle"
            onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z"/></svg>
            )}
          </button>
          {messages.length > 0 && (
            <button
              className="theme-toggle"
              onClick={() => setMessages([])}
              title="Clear chat"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg>
            </button>
          )}
          <div className="provider-toggle">
            {(['gemini-cli', 'opencode'] as Provider[]).map(p => (
              <button
                key={p}
                className={`toggle-btn ${provider === p ? 'active' : ''}`}
                onClick={() => setProvider(p)}
              >
                {p}
              </button>
            ))}
          </div>
          <div className="model-selector">
            {renderModelSelector()}
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <main className="chat-area">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">&#x03BB;</div>
            <h2>Available Skills</h2>
            <p>Select a skill or type a query to get started.</p>
            <div className="skill-cards">
              {skills.map(s => (
                <button
                  key={s.name}
                  className="skill-card"
                  onClick={() => {
                    setInput('');
                    textareaRef.current?.focus();
                  }}
                >
                  <div className="skill-card-header">
                    <span className="skill-card-name">{s.name}</span>
                    <span className={`scope-badge ${s.scope}`}>{s.scope}</span>
                  </div>
                  <span className="skill-card-desc">{s.description}</span>
                  {(s.provider || s.model) && (
                    <span className="skill-card-config">
                      {[s.provider, s.model].filter(Boolean).join(' / ')}
                    </span>
                  )}
                </button>
              ))}
              {skills.length === 0 && (
                <p className="no-skills">No skills found in .claude/skills/</p>
              )}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'user' ? 'You' : 'AGENT'}
              </div>
              <div className="message-body">
                {msg.role === 'assistant' && (
                  <div className="message-meta">
                    {msg.skillName && (
                      msg.skillChain && msg.skillChain.length > 1 ? (
                        <span className="skill-chain">
                          <span className="skill-badge-label">skill chain</span>
                          {msg.skillChain.map((name, i) => (
                            <span key={name} className="skill-chain-item">
                              {i > 0 && <span className="skill-chain-arrow">&rarr;</span>}
                              <span className="skill-badge">{name}</span>
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="skill-badge"><span className="skill-badge-label">skill</span>{msg.skillName}</span>
                      )
                    )}
                    <span className="provider-label">
                      {msg.model ? `${msg.provider} / ${msg.model}` : msg.provider}
                    </span>
                  </div>
                )}
                {msg.isStreaming && !msg.content && (
                  <div className="thinking">
                    <div className="thinking-dots">
                      <span /><span /><span />
                    </div>
                    <span className="thinking-text">
                      {msg.skillName ? `Running ${msg.skillName}...` : 'Matching skill...'}
                    </span>
                  </div>
                )}
                <pre className="message-text">{msg.content}</pre>
                {msg.isStreaming && msg.content && <span className="cursor" />}
                {msg.files && msg.files.length > 0 && (
                  <div className="file-downloads">
                    <span className="file-downloads-label">Generated files:</span>
                    {msg.files.map(f => (
                      <a
                        key={f}
                        href={`/api/download?path=${encodeURIComponent(f)}`}
                        className="file-download-link"
                        download
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
                        {fileName(f)}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </main>

      {/* Input */}
      <footer className="input-area">
        <div className="input-box">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInput}
            onKeyDown={handleKeyDown}
            placeholder="Type your query... (skills are matched automatically)"
            rows={1}
            disabled={isLoading}
          />
          <button
            className="send-btn"
            onClick={() => sendQuery(input)}
            disabled={!input.trim() || isLoading}
          >
            {isLoading ? (
              <span className="spinner" />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 2L11 13" />
                <path d="M22 2L15 22L11 13L2 9L22 2Z" />
              </svg>
            )}
          </button>
        </div>
        <p className="footer-note">{skills.length} skill(s) available</p>
      </footer>
      </div>{/* end main-content */}
    </div>
  );
}

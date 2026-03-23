import { useState, useRef, useEffect } from 'react';

type Provider = 'opencode' | 'gemini-cli';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  model?: string;
  provider?: Provider;
  isStreaming?: boolean;
}

interface ModelInfo {
  name: string;
  context: string;
  reasoning: boolean;
}

const GEMINI_MODELS: ModelInfo[] = [
  { name: 'dev-DeepSeek-V3.2',             context: '128K',  reasoning: true },
  { name: 'dev-DeepSeek-V3.2-non-reasoning', context: '128K', reasoning: false },
  { name: 'dev-claude-haiku-4.5',          context: '200K',  reasoning: true },
  { name: 'dev-claude-haiku-4.5-generic',  context: '200K',  reasoning: true },
  { name: 'dev-Gemini-3.1-Pro-Preview',    context: '1M',    reasoning: true },
  { name: 'dev-Claude-Opus-4.6',           context: '1M',    reasoning: true },
  { name: 'gpt-4o',                        context: '128K',  reasoning: false },
  { name: 'gpt-4o-mini',                   context: '128K',  reasoning: false },
  { name: 'gpt-4.1',                       context: '1M',    reasoning: false },
  { name: 'gpt-4.1-mini',                  context: '1M',    reasoning: false },
  { name: 'gpt-4.1-nano',                  context: '1M',    reasoning: false },
  { name: 'o1',                            context: '200K',  reasoning: true },
  { name: 'o3-mini',                       context: '128K',  reasoning: true },
  { name: 'o4-mini',                       context: '200K',  reasoning: true },
  { name: 'gpt-5',                         context: '400K',  reasoning: true },
  { name: 'gpt-5-nano',                    context: '400K',  reasoning: true },
  { name: 'gpt-5-mini',                    context: '400K',  reasoning: true },
  { name: 'gpt-5.2',                       context: '400K',  reasoning: true },
  { name: 'claude-haiku-4.5',              context: '200K',  reasoning: true },
];

const SUGGESTIONS = [
  'Explain this project structure',
  'List all files in the current directory',
  'What is 2 + 2?',
];

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [provider, setProvider] = useState<Provider>('opencode');
  const [model, setModel] = useState(GEMINI_MODELS[0].name);
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const selectedModel = GEMINI_MODELS.find(m => m.name === model);

  const sendQuery = async (query: string) => {
    if (!query.trim() || isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: query.trim(),
    };

    const currentModel = provider === 'gemini-cli' ? model : undefined;
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
              if (data.type === 'chunk') {
                setMessages(prev =>
                  prev.map(m =>
                    m.id === assistantId
                      ? { ...m, content: m.content + data.content }
                      : m,
                  ),
                );
              }
            } catch { /* skip */ }
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

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div className="header-left">
          <h1>Agent Skill</h1>
          <span className="subtitle">Headless LLM CLI Interface</span>
        </div>
        <div className="header-controls">
          <div className="provider-toggle">
            {(['opencode', 'gemini-cli'] as Provider[]).map(p => (
              <button
                key={p}
                className={`toggle-btn ${provider === p ? 'active' : ''}`}
                onClick={() => setProvider(p)}
              >
                {p}
              </button>
            ))}
          </div>
          {provider === 'gemini-cli' && (
            <div className="model-selector">
              <select value={model} onChange={e => setModel(e.target.value)}>
                {GEMINI_MODELS.map(m => (
                  <option key={m.name} value={m.name}>
                    {m.name} [{m.context}{m.reasoning ? ', reasoning' : ''}]
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </header>

      {/* Chat Area */}
      <main className="chat-area">
        {messages.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">{'>'}_</div>
            <h2>What can I help you with?</h2>
            <p>
              Using <strong>{provider}</strong>
              {provider === 'gemini-cli' && selectedModel
                ? <> with <strong>{model}</strong> [{selectedModel.context}]</>
                : null
              } in headless mode.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  className="suggestion-btn"
                  onClick={() => sendQuery(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => (
            <div key={msg.id} className={`message ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === 'user' ? 'You' : (msg.model ?? msg.provider ?? 'AI').substring(0, 3).toUpperCase()}
              </div>
              <div className="message-body">
                {msg.role === 'assistant' && (
                  <span className="provider-label">
                    {msg.model ? `${msg.provider} / ${msg.model}` : msg.provider}
                  </span>
                )}
                <pre className="message-text">{msg.content}</pre>
                {msg.isStreaming && <span className="cursor" />}
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
            placeholder={`Ask ${provider}${provider === 'gemini-cli' ? ` (${model})` : ''}...`}
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
        <p className="footer-note">
          {provider === 'opencode'
            ? '$ opencode run "..."'
            : `$ gemini -m ${model} -p "..." -y --sandbox=false`}
        </p>
      </footer>
    </div>
  );
}

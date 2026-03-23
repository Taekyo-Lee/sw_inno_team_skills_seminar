---
name: headless-agent-ui
description: Scaffold a full-stack TypeScript web app (ChatGPT-style chat UI) that wraps headless CLI tools — like opencode, gemini-cli, claude -p, or any agentic CLI — as input-output boxes. Use this skill whenever the user wants to build a web interface for CLI-based AI agents, create a chat UI that calls command-line tools in headless mode, wrap subprocess-based LLM tools with a browser frontend, or build a streaming web app that pipes CLI stdout to the browser. Also trigger when users mention "headless mode", "CLI wrapper UI", "agent UI", "web frontend for opencode/gemini", or want to use agentic CLI tools as components in a larger workflow with a visual interface.
---

# Headless Agent UI

Build a web-based chat interface that treats headless CLI tools as backend "brains". The user picks a provider (opencode, gemini-cli, etc.), types a query, and sees the response stream in token-by-token — just like ChatGPT, but powered by whatever CLI tool they choose.

## Quick Start

This skill is **self-contained**. The `scaffold/` directory contains a complete, working project.

```bash
# 1. Copy scaffold to target directory
cp -r <this-skill-path>/scaffold/* <target-project-dir>/

# 2. Install and run
cd <target-project-dir>
npm install
npm run dev    # opens Vite on :5173, Express API on :3001
```

Then adapt the scaffold to the user's specific needs (providers, models, styling).

## Architecture

```
Browser (React)  ──POST /api/chat──▶  Express Server  ──spawn──▶  CLI subprocess
     ◀──────── SSE stream ◀──────────  (pipe stdout)  ◀─ stdout ──  (gemini -p / opencode run)
```

| Layer | Tech | Key file |
|-------|------|----------|
| Frontend | Vite + React + TypeScript | `scaffold/src/App.tsx` |
| Backend | Express + TypeScript | `scaffold/server/index.ts` |
| Styling | CSS variables, dark theme | `scaffold/src/App.css` |
| Dev | Vite proxy + concurrently | `scaffold/vite.config.ts` |

## Scaffold File Inventory

```
scaffold/
├── package.json          # deps: react, express; devDeps: vite, tsx, concurrently
├── tsconfig.json         # Vite React template config
├── vite.config.ts        # React plugin + proxy with SSE buffering disabled
├── index.html            # Minimal entry point
├── server/
│   └── index.ts          # Express: spawn CLI → stream stdout via SSE
└── src/
    ├── main.tsx           # React entry
    ├── App.tsx            # Chat UI: provider toggle, model selector, SSE reader
    └── App.css            # Dark theme with purple accent
```

All files are production-tested and working. Read them directly from the scaffold directory when generating.

## SSE Streaming — Critical Pitfalls

These were discovered through painful debugging and are essential to get right.

### 1. NEVER use `req.on('close')` to kill subprocesses

When SSE streams through Vite's dev proxy, the proxy fires the `close` event on the Express request **prematurely** — before the subprocess has produced any output. This kills the process and the user gets empty responses. Just let the process run to completion.

### 2. Always call `res.flushHeaders()` immediately

After setting SSE headers, call `res.flushHeaders()` to push them to the client without waiting for body data. Without this, headers get buffered.

### 3. Send a heartbeat comment immediately

Right after `flushHeaders()`, write `': heartbeat\n\n'` (SSE comment). CLI tools take several seconds to load extensions — this keeps the proxy connection alive during that silence.

### 4. Disable proxy buffering on both sides

- **Express**: `res.setHeader('X-Accel-Buffering', 'no')`
- **Vite proxy**: `configure` callback in `vite.config.ts` sets the same header on proxy responses

## CLI Tool Headless Commands

| Provider | Command | Key flags |
|----------|---------|-----------|
| opencode | `opencode run "<query>"` | — |
| gemini-cli | `gemini -p "<query>"` | `-y` (auto-approve), `--sandbox=false`, `-o text` (clean stdout), `-m <model>` |
| claude | `claude -p "<query>"` | `--output-format text` |

## Adding a New CLI Provider

1. **server/index.ts** — add an `else if` branch with the command and args
2. **src/App.tsx** — add to the `Provider` type union and toggle buttons
3. If the tool supports model selection, add a model list

Example — adding `claude -p`:
```typescript
// server
} else if (provider === 'claude') {
  cmd = 'claude';
  args = ['-p', query, '--output-format', 'text'];
}

// frontend: extend type
type Provider = 'opencode' | 'gemini-cli' | 'claude';
```

## Customization Points

| What | Where | How |
|------|-------|-----|
| Models | `GEMINI_MODELS` array in `App.tsx` | Add/remove entries with name, context, reasoning |
| Providers | `Provider` type + toggle in `App.tsx`, switch in `server/index.ts` | Extend both |
| Colors/fonts | CSS variables in `:root` in `App.css` | Change `--accent`, `--bg-*`, etc. |
| Suggestions | `SUGGESTIONS` array in `App.tsx` | Edit prompt text |
| App title | `<h1>` and `<title>` | Change in `App.tsx` and `index.html` |

## SSE Event Protocol

The server sends these event types:

```
data: {"type":"chunk","content":"Hello"}\n\n        ← stdout (rendered in chat)
data: {"type":"status","content":"Loading..."}\n\n  ← stderr (keeps connection alive)
data: {"type":"done","exitCode":0}\n\n              ← process finished
data: {"type":"error","message":"not found"}\n\n    ← spawn error
```

The frontend only renders `chunk` events. Status events are silently consumed to keep the SSE connection alive.

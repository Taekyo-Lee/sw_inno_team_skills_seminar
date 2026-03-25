---
name: headless-agent-ui
aliases: lambda app, lambda agent, skill app
description: Scaffold, run, stop, and manage a full-stack TypeScript web app (ChatGPT-style chat UI) that wraps headless CLI tools — like opencode, gemini-cli, claude -p, or any agentic CLI — as input-output boxes. This skill is commonly referred to as "lambda app". Use this skill whenever the user wants to build, start, run, restart, stop, or shut down the web interface for CLI-based AI agents. Trigger for starting: "headless mode", "CLI wrapper UI", "agent UI", "web frontend for opencode/gemini", "lambda app", "lambda agent", "skill app", "앱 실행", "앱 켜줘", "앱 시작". Trigger for stopping: "lambda app 꺼줘", "lambda app 꺼", "lambda 꺼줘", "app 꺼줘", "꺼줘", "끄고", "stop the app", "shut it down", "turn off", "kill the app", "headless agent 꺼", "agent app 꺼".
---


# Headless Agent UI

Build a web-based chat interface that treats headless CLI tools as backend "brains". The user picks a provider (opencode, gemini-cli, etc.), types a query, and sees the response stream in token-by-token — just like ChatGPT, but powered by whatever CLI tool they choose.

## Stopping the app

When the user wants to stop/shut down the app, just run:

```bash
<this-skill-path>/scaffold/stop.sh
```

If the user asks to fully clean up (remove images, volumes), pass extra flags:

```bash
<this-skill-path>/scaffold/stop.sh --rmi local --volumes --remove-orphans
```

## IMPORTANT: App Naming — MUST ask every time

**Every single time** this skill is triggered, ask the user for an app name — even if it was set in a previous conversation or earlier in the same session. Never reuse, assume, or carry over a previously set name. The user may want a different name each time they launch the app.

> "앱 이름을 뭘로 할까요? (예: 'Document Agent', 'CICD Agent', 'Code Review Agent')"

Once the user provides a name, pass `APP_NAME` and `APP_SUBTITLE` as inline environment variables when running `docker compose up`. **Do NOT modify any files in the scaffold directory.**

- `APP_NAME` — The main title shown in the header (e.g., "Haiku Generator")
- `APP_SUBTITLE` — A short tagline (e.g., "Powered by Skills")

If the user provides only a name, derive a reasonable subtitle automatically.

## Quick Start — Docker-based (no files copied to project root)

This skill is **self-contained**. The `scaffold/` directory contains a complete, working project with its own `Dockerfile` and `docker-compose.yml`. Everything builds and runs inside Docker — **never copy scaffold files to the project root**.

### Multi-instance support

Each project gets its own unique container and port automatically. **Never modify files in the scaffold directory** — all project-specific values are derived at runtime by `run.sh` and `stop.sh`.

- `COMPOSE_PROJECT_NAME` — auto-derived from project root directory name
- `HOST_PORT` — auto-detected (first available port starting from 3001)
- `APP_NAME` / `APP_SUBTITLE` — passed as env vars when running

### Launch

```bash
# Basic (auto project name + auto port)
APP_NAME="My App" <this-skill-path>/scaffold/run.sh

# With build (passes extra args to docker compose)
APP_NAME="My App" <this-skill-path>/scaffold/run.sh --build

# Stop
<this-skill-path>/scaffold/stop.sh
```

The script outputs the assigned URL on success.

**IMPORTANT**: Do NOT copy scaffold files (package.json, src/, server/, etc.) into the project root. The project root should only contain project-owned files like README.md and `.claude/`. All scaffold source lives in `.claude/skills/headless-agent-ui/scaffold/` and is built directly by Docker from there.

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

---
name: headless-agent-ui
aliases: lambda app, lambda agent, skill app
description: Scaffold, run, and manage a full-stack TypeScript web app (ChatGPT-style chat UI) that wraps headless CLI tools — like opencode, gemini-cli, claude -p, or any agentic CLI — as input-output boxes. This skill is commonly referred to as "lambda app". Use this skill whenever the user wants to build, start, run, restart, or update the web interface for CLI-based AI agents. Also trigger when users mention "headless mode", "CLI wrapper UI", "agent UI", "web frontend for opencode/gemini", "lambda app", "lambda agent", "skill app", "앱 실행", "앱 켜줘", "앱 시작", or want to use agentic CLI tools as components in a larger workflow with a visual interface.
---

# Headless Agent UI

Build a web-based chat interface that treats headless CLI tools as backend "brains". The user picks a provider (opencode, gemini-cli, etc.), types a query, and sees the response stream in token-by-token — just like ChatGPT, but powered by whatever CLI tool they choose.

## IMPORTANT: App Naming — MUST ask every time

**Every single time** this skill is triggered, ask the user for an app name — even if it was set in a previous conversation or earlier in the same session. Never reuse, assume, or carry over a previously set name. The user may want a different name each time they launch the app.

> "앱 이름을 뭘로 할까요? (예: 'Haiku Generator', 'Code Review Bot', 'My AI Assistant')"

Once the user provides a name, set these environment variables in `scaffold/docker-compose.yml` (inside the scaffold directory, not the project root):
- `APP_NAME` — The main title shown in the header (e.g., "Haiku Generator")
- `APP_SUBTITLE` — A short tagline (e.g., "Powered by Skills")

If the user provides only a name, derive a reasonable subtitle automatically.

## Quick Start — Docker-based (no files copied to project root)

This skill is **self-contained**. The `scaffold/` directory contains a complete, working project with its own `Dockerfile` and `docker-compose.yml`. Everything builds and runs inside Docker — **never copy scaffold files to the project root**.

### Multi-instance support

Each project gets its own unique container and port so multiple instances can run simultaneously. Before launching, you MUST:

1. **Derive `COMPOSE_PROJECT_NAME`** from the project root directory name (the folder containing `.claude/`). This becomes the container name prefix, ensuring uniqueness across projects.

2. **Find an available `HOST_PORT`** starting from 3001. Check which ports are already in use:
   ```bash
   # Find next available port starting from 3001
   PORT=3001; while ss -tlnp 2>/dev/null | grep -q ":$PORT " || docker ps --format '{{.Ports}}' 2>/dev/null | grep -q "0.0.0.0:$PORT->"; do PORT=$((PORT+1)); done; echo $PORT
   ```

3. **Write a `.env` file** in the `scaffold/` directory (Docker Compose reads it automatically):
   ```bash
   cat > <this-skill-path>/scaffold/.env << EOF
   COMPOSE_PROJECT_NAME=<project-dir-name>
   HOST_PORT=<available-port>
   EOF
   ```

### Launch

```bash
# 1. Write .env with COMPOSE_PROJECT_NAME and HOST_PORT (see above)
# 2. Update APP_NAME default in scaffold/docker-compose.yml (see App Naming above)
# 3. Build and run from the scaffold directory
cd <this-skill-path>/scaffold
docker compose up -d --build
```

The app runs at **http://localhost:<HOST_PORT>** in production mode (pre-built frontend served by Express).

To stop: `docker compose down` (from the scaffold directory)
To rebuild after code changes: `docker compose up -d --build`
To view logs: `docker compose logs -f`

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

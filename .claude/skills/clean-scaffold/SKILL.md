---
name: clean-scaffold
description: Stop and remove scaffold containers (headless-agent-ui Docker container) and any leftover files from the project root, restoring it to a clean state with only README.md, .gitignore, and .claude/. Use this skill whenever the user wants to stop, shut down, turn off, or remove the headless agent app, coding agent UI, or any scaffold-generated Docker container. Also trigger for cleaning up, resetting, starting fresh, or preparing for a new scaffold generation. Trigger phrases include "lambda app 꺼줘", "lambda app 꺼", "lambda 꺼줘", "app 꺼줘", "꺼줘", "끄고", "지워", "stop the app", "shut it down", "turn off", "kill the app", "clean up", "reset project", "start over", "headless agent 꺼", "agent app 꺼", or any variation asking to stop/remove the running web app. This skill is the counterpart to headless-agent-ui — whenever that app needs to be stopped or removed, this skill handles it.
---

# Clean Scaffold

This skill restores the project root to a clean state. Since scaffold skills now run via Docker (no files copied to project root), cleanup is primarily about stopping containers. If any scaffold files were manually copied to the root, those get removed too.

## When to use

- When the user wants to stop the running app
- Before re-running a scaffold skill to regenerate from scratch
- When the user wants to reset the project to its original state

## What gets preserved

These files/directories are part of the repo identity and should never be deleted:

| Path | Why |
|------|-----|
| `.git/` | Git history — deleting this destroys the repo |
| `.claude/` | Skill definitions and Claude config |
| `.gitignore` | Git ignore rules (hand-authored) |
| `README.md` | Project documentation |

## Steps

### Step 1: Stop Docker containers

The scaffold app runs as a Docker container with a project-specific `COMPOSE_PROJECT_NAME` (set in `scaffold/.env`). Stop and clean up using the compose file:

```bash
cd .claude/skills/headless-agent-ui/scaffold
docker compose down --rmi local --volumes --remove-orphans 2>/dev/null
```

This reads `COMPOSE_PROJECT_NAME` from `scaffold/.env` automatically, targeting the correct project's containers. It removes containers, locally-built images, volumes, and orphan containers — a complete reset so the next `docker compose up` builds fresh.

If the compose file path is unknown, fall back to manual cleanup (catches containers from any project):

```bash
docker ps --filter "name=agent-ui" -q | xargs -r docker rm -f
docker images --filter "reference=*agent-ui*" -q | xargs -r docker rmi -f
```

### Step 2: Stop any local dev processes (fallback)

If the app was running locally (not in Docker), kill those processes too:

```bash
pkill -f "concurrently.*vite.*tsx" 2>/dev/null
pkill -f "tsx watch server" 2>/dev/null
pkill -f "node.*vite" 2>/dev/null
```

### Step 3: Remove any scaffold files from project root

If scaffold files were manually copied to the root, remove them:

```bash
rm -rf node_modules/ server/ src/ dist/ .vite/ .playwright-mcp/
rm -f package.json package-lock.json tsconfig.json vite.config.ts index.html
rm -f Dockerfile docker-compose.yml docker-entrypoint.sh .dockerignore
```

### Step 4: Verify

```bash
ls -la
```

Expected result: only `.git/`, `.claude/`, `.gitignore`, and `README.md`.

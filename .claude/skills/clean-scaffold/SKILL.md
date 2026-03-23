---
name: clean-scaffold
description: Stop and remove scaffold containers and any leftover files from the project root, restoring it to a clean state with only README.md, .gitignore, and .claude/. Use this skill whenever the user wants to clean up, reset, start fresh, remove generated files, stop the app, or prepare the project for a new scaffold generation. Also trigger when the user says "clean up", "delete scaffold files", "reset project", "start over", "stop the app", "shut it down", or mentions wanting to regenerate from scratch.
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

The scaffold app runs as a Docker container. Stop, remove the container, and clean up the image in one shot:

```bash
docker compose -f .claude/skills/headless-agent-ui/scaffold/docker-compose.yml down --rmi local --volumes --remove-orphans 2>/dev/null
```

This removes containers, locally-built images, volumes, and orphan containers — a complete reset so the next `docker compose up` builds fresh.

If the compose file path is unknown, fall back to manual cleanup:

```bash
docker ps --filter "name=scaffold" --filter "name=agent-ui" -q | xargs -r docker rm -f
docker images --filter "reference=*scaffold*" --filter "reference=*agent-ui*" -q | xargs -r docker rmi -f
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

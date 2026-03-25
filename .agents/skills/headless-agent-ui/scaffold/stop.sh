#!/bin/bash
set -e

SCAFFOLD_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCAFFOLD_DIR/../../../.." && pwd)"
PROJECT_NAME="$(basename "$PROJECT_ROOT")"

# Auto-detect the compose project name from running or stopped containers
# Look for containers with this service pattern in the current project
INSTANCE_NAME=""

# Try running containers first, then stopped ones
for STATE in "running" "exited"; do
  if [ -z "$INSTANCE_NAME" ]; then
    CONTAINER_ID=$(docker ps --filter "label=com.docker.compose.project" --filter "ancestor=headless-agent-ui:latest" --filter "status=$STATE" --format "{{.ID}}" | head -1)
    if [ -n "$CONTAINER_ID" ]; then
      INSTANCE_NAME=$(docker inspect "$CONTAINER_ID" --format='{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)
    fi
  fi
done

# Fallback: if no container found, look for any container with this project prefix
if [ -z "$INSTANCE_NAME" ]; then
  CONTAINER_ID=$(docker ps -a --filter "label=com.docker.compose.project" --format "{{.ID}}\t{{.Names}}" | grep "${PROJECT_NAME}-lambda" | head -1 | cut -f1)
  if [ -n "$CONTAINER_ID" ]; then
    INSTANCE_NAME=$(docker inspect "$CONTAINER_ID" --format='{{index .Config.Labels "com.docker.compose.project"}}' 2>/dev/null || true)
  fi
fi

# Last resort: use project name directly if nothing found
if [ -z "$INSTANCE_NAME" ]; then
  INSTANCE_NAME="$PROJECT_NAME"
fi

cd "$SCAFFOLD_DIR"

# Default: remove containers only (keep volumes and images for caching)
# Pass flags explicitly for additional cleanup (--volumes, --rmi local, etc.)
COMPOSE_PROJECT_NAME="$INSTANCE_NAME" docker compose down "$@"

echo ""
echo "  Stopped and removed containers: $INSTANCE_NAME"
echo ""

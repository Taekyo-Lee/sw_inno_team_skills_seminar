#!/bin/bash
set -e

SCAFFOLD_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCAFFOLD_DIR/../../../.." && pwd)"
PROJECT_NAME="$(basename "$PROJECT_ROOT")"

# Append APP_NAME slug to project name for multi-instance support
if [ -n "$APP_NAME" ] && [ "$APP_NAME" != "Skill App" ]; then
  SLUG=$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '-' | sed 's/^-//;s/-$//')
  INSTANCE_NAME="${PROJECT_NAME}-${SLUG}"
else
  INSTANCE_NAME="$PROJECT_NAME"
fi

# Find available port starting from 3001
PORT=3001
while ss -tlnp 2>/dev/null | grep -q ":$PORT " || \
      docker ps --format '{{.Ports}}' 2>/dev/null | grep -q "0.0.0.0:$PORT->"; do
  PORT=$((PORT+1))
done

# Pass all project-specific values as inline env vars — scaffold stays untouched
cd "$SCAFFOLD_DIR"
COMPOSE_PROJECT_NAME="$INSTANCE_NAME" \
HOST_PORT="$PORT" \
APP_NAME="${APP_NAME:-Skill App}" \
APP_SUBTITLE="${APP_SUBTITLE:-Powered by Skills}" \
  docker compose up -d "$@"

echo ""
echo "  App:       ${APP_NAME:-Skill App}"
echo "  Project:   $INSTANCE_NAME"
echo "  Container: ${INSTANCE_NAME}-lambda-1"
echo "  URL:       http://localhost:$PORT"
echo ""

#!/bin/bash
set -e

SCAFFOLD_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCAFFOLD_DIR/../../../.." && pwd)"
PROJECT_NAME="$(basename "$PROJECT_ROOT")"

# Match the instance name from run.sh
if [ -n "$APP_NAME" ] && [ "$APP_NAME" != "Skill App" ]; then
  SLUG=$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]' | tr -cs '[:alnum:]' '-' | sed 's/^-//;s/-$//')
  INSTANCE_NAME="${PROJECT_NAME}-${SLUG}"
else
  INSTANCE_NAME="$PROJECT_NAME"
fi

cd "$SCAFFOLD_DIR"
COMPOSE_PROJECT_NAME="$INSTANCE_NAME" docker compose down "$@"

echo ""
echo "  Stopped: $INSTANCE_NAME"
echo ""

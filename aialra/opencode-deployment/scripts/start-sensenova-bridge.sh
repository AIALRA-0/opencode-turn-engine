#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SECRETS_FILE="${OPENCODE_ENV_FILE:-/srv/aialra/config/secrets/opencode.env}"

if [[ -f "$SECRETS_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
  set +a
fi

export OPENCODE_SENSENOVA_BRIDGE_HOST="${OPENCODE_SENSENOVA_BRIDGE_HOST:-127.0.0.1}"
export OPENCODE_SENSENOVA_BRIDGE_PORT="${OPENCODE_SENSENOVA_BRIDGE_PORT:-12602}"

exec /usr/bin/node "$DEPLOYMENT_DIR/adapters/sensenova-openai-bridge.js"

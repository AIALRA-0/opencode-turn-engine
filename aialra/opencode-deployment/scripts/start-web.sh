#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOYMENT_DIR/../.." && pwd)"
OPENCODE_WORKDIR="${OPENCODE_WORKDIR:-$REPO_ROOT}"
RUNTIME_DIR="$DEPLOYMENT_DIR/runtime"
SECRETS_FILE="${OPENCODE_ENV_FILE:-/srv/aialra/config/secrets/opencode.env}"

if [[ -f "$SECRETS_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$SECRETS_FILE"
  set +a
fi

export HOME="${HOME:-/srv/aialra/state/root-home}"
export XDG_CONFIG_HOME="${XDG_CONFIG_HOME:-/srv/aialra/state/root-home/.config}"
export XDG_DATA_HOME="${XDG_DATA_HOME:-/srv/aialra/state/root-home/.local/share}"
export OPENCODE_CONFIG="${OPENCODE_CONFIG:-$DEPLOYMENT_DIR/config/opencode.json}"
export OPENCODE_TUI_CONFIG="${OPENCODE_TUI_CONFIG:-$DEPLOYMENT_DIR/config/tui.json}"
export OPENCODE_SERVER_HOST="${OPENCODE_SERVER_HOST:-127.0.0.1}"
export OPENCODE_SERVER_PORT="${OPENCODE_SERVER_PORT:-12601}"
export OPENCODE_WEB_ORIGIN="${OPENCODE_WEB_ORIGIN:-https://opencode.aialra.online}"

cd "$OPENCODE_WORKDIR"
exec "$RUNTIME_DIR/node_modules/.bin/opencode" web \
  --hostname "$OPENCODE_SERVER_HOST" \
  --port "$OPENCODE_SERVER_PORT" \
  --cors "$OPENCODE_WEB_ORIGIN"

#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOYMENT_DIR/../.." && pwd)"
OPENCODE_WORKDIR="${OPENCODE_WORKDIR:-$REPO_ROOT}"
RUNTIME_DIR="$DEPLOYMENT_DIR/runtime"
SECRETS_FILE="${OPENCODE_ENV_FILE:-/srv/aialra/config/secrets/opencode.env}"

# shellcheck source=lib-opencode-bin.sh
source "$SCRIPT_DIR/lib-opencode-bin.sh"

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
export AIALRA_TURN_TRACE_DIR="${AIALRA_TURN_TRACE_DIR:-$REPO_ROOT/aialra/turn-observability/traces}"
export OPENCODE_SERVER_HOST="${OPENCODE_SERVER_HOST:-127.0.0.1}"
export OPENCODE_SERVER_PORT="${OPENCODE_SERVER_PORT:-12601}"
export OPENCODE_WEB_ORIGIN="${OPENCODE_WEB_ORIGIN:-https://opencode.aialra.online}"

OPENCODE_BIN_RESOLVED="$(resolve_opencode_bin "$REPO_ROOT" "$RUNTIME_DIR")"

cd "$OPENCODE_WORKDIR"
exec "$OPENCODE_BIN_RESOLVED" web \
  --hostname "$OPENCODE_SERVER_HOST" \
  --port "$OPENCODE_SERVER_PORT" \
  --cors "$OPENCODE_WEB_ORIGIN"

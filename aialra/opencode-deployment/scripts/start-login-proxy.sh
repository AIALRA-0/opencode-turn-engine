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

export OPENCODE_LOGIN_PROXY_HOST="${OPENCODE_LOGIN_PROXY_HOST:-127.0.0.1}"
export OPENCODE_LOGIN_PROXY_PORT="${OPENCODE_LOGIN_PROXY_PORT:-12603}"
export OPENCODE_UPSTREAM_HOST="${OPENCODE_UPSTREAM_HOST:-127.0.0.1}"
export OPENCODE_UPSTREAM_PORT="${OPENCODE_UPSTREAM_PORT:-${OPENCODE_SERVER_PORT:-12601}}"

exec /usr/bin/node "$DEPLOYMENT_DIR/auth/login-proxy.js"

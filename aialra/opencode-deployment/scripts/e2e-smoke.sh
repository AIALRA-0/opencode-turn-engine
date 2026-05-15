#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOYMENT_DIR/../.." && pwd)"
RUNTIME_DIR="$DEPLOYMENT_DIR/runtime"
SECRETS_FILE="${OPENCODE_ENV_FILE:-/srv/aialra/config/secrets/opencode.env}"
TMP_DIR="$DEPLOYMENT_DIR/.tmp/e2e-$$"

# shellcheck source=lib-opencode-bin.sh
source "$SCRIPT_DIR/lib-opencode-bin.sh"

cleanup() {
  rm -rf "$TMP_DIR"
  rmdir "$DEPLOYMENT_DIR/.tmp" 2>/dev/null || true
}
trap cleanup EXIT

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

BIN="$(resolve_opencode_bin "$REPO_ROOT" "$RUNTIME_DIR")"
LOCAL_SERVER="http://127.0.0.1:${OPENCODE_SERVER_PORT:-12601}"
PUBLIC_SERVER="${OPENCODE_PUBLIC_URL:-https://opencode.aialra.online}"
AUTH_USER="${OPENCODE_SERVER_USERNAME:?OPENCODE_SERVER_USERNAME is required}"
AUTH_PASS="${OPENCODE_SERVER_PASSWORD:?OPENCODE_SERVER_PASSWORD is required}"

mkdir -p "$TMP_DIR"
printf 'OpenCode smoke workspace.\n' > "$TMP_DIR/README.md"

"$BIN" --version
node --test "$DEPLOYMENT_DIR/tests"/*.test.js

curl --fail --silent --show-error "http://127.0.0.1:${OPENCODE_SENSENOVA_BRIDGE_PORT:-12602}/health" >/dev/null
curl --fail --silent --show-error --user "$AUTH_USER:$AUTH_PASS" "$LOCAL_SERVER/global/health" >/dev/null

LOGIN_HTML="$(mktemp)"
LOGIN_HEADERS="$(mktemp)"
COOKIE_JAR="$(mktemp)"
APP_HTML="$(mktemp)"
BOOTSTRAP_JS="$(mktemp)"
LOGOUT_HEADERS="$(mktemp)"
trap 'rm -f "$LOGIN_HTML" "$LOGIN_HEADERS" "$COOKIE_JAR" "$APP_HTML" "$BOOTSTRAP_JS" "$LOGOUT_HEADERS"; cleanup' EXIT

curl --silent --show-error --dump-header "$LOGIN_HEADERS" --output "$LOGIN_HTML" "$PUBLIC_SERVER/"
rg --quiet '<form method="post" action="/login">' "$LOGIN_HTML"
if rg --quiet --ignore-case '^www-authenticate:' "$LOGIN_HEADERS"; then
  echo "Public OpenCode login must not use browser Basic Auth prompts" >&2
  exit 1
fi

curl --fail --silent --show-error \
  --cookie-jar "$COOKIE_JAR" \
  --data-urlencode "username=$AUTH_USER" \
  --data-urlencode "password=$AUTH_PASS" \
  --data-urlencode "next=/" \
  "$PUBLIC_SERVER/login" >/dev/null
curl --fail --silent --show-error --cookie "$COOKIE_JAR" "$PUBLIC_SERVER/global/health" >/dev/null
curl --fail --silent --show-error --cookie "$COOKIE_JAR" --output "$APP_HTML" "$PUBLIC_SERVER/"
rg --quiet '/__aialra/opencode-bootstrap.js' "$APP_HTML"
curl --fail --silent --show-error --cookie "$COOKIE_JAR" --output "$BOOTSTRAP_JS" "$PUBLIC_SERVER/__aialra/opencode-bootstrap.js"
rg --quiet 'opencode.global.dat:server' "$BOOTSTRAP_JS"
rg --quiet '账号设置' "$BOOTSTRAP_JS"
curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --cookie-jar "$COOKIE_JAR" \
  --request POST \
  --dump-header "$LOGOUT_HEADERS" \
  --output /dev/null \
  "$PUBLIC_SERVER/logout"
rg --quiet '^location: /login' "$LOGOUT_HEADERS"
if curl --silent --show-error \
  --cookie "$COOKIE_JAR" \
  --header 'accept: application/json' \
  --output /dev/null \
  --write-out '%{http_code}' \
  "$PUBLIC_SERVER/global/health" | rg --quiet '^200$'; then
  echo "Public OpenCode logout must clear the login session" >&2
  exit 1
fi

"$BIN" attach --help >/dev/null
"$BIN" run --help >/dev/null

if [[ "${RUN_MODEL_CALL:-0}" == "1" ]]; then
  "$BIN" run \
    --attach "$LOCAL_SERVER" \
    --dir "$TMP_DIR" \
    --username "$AUTH_USER" \
    --password "$AUTH_PASS" \
    --model "${OPENCODE_E2E_MODEL:-deepseek/deepseek-v4-flash}" \
    "Reply with the single ASCII word OK. Do not modify files."
fi

echo "OpenCode E2E smoke passed"

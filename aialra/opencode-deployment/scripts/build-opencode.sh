#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOYMENT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOYMENT_DIR/../.." && pwd)"

cd "$REPO_ROOT"
bun install --frozen-lockfile
bun run --cwd packages/opencode typecheck
bun run --cwd packages/opencode build --single

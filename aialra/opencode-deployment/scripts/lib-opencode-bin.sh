#!/usr/bin/env bash

resolve_opencode_bin() {
  local repo_root="$1"
  local runtime_dir="$2"
  local platform
  local arch

  if [[ -n "${OPENCODE_BIN:-}" ]]; then
    printf '%s\n' "$OPENCODE_BIN"
    return 0
  fi

  case "$(uname -s)" in
    Linux) platform="linux" ;;
    Darwin) platform="darwin" ;;
    *) platform="$(uname -s | tr '[:upper:]' '[:lower:]')" ;;
  esac

  case "$(uname -m)" in
    x86_64 | amd64) arch="x64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) arch="$(uname -m)" ;;
  esac

  local built="$repo_root/packages/opencode/dist/opencode-$platform-$arch/bin/opencode"
  if [[ -x "$built" ]]; then
    printf '%s\n' "$built"
    return 0
  fi

  printf '%s\n' "$runtime_dir/node_modules/.bin/opencode"
}

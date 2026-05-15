# OpenCode deployment

This directory keeps the local OpenCode runtime, provider bridge, and operator
scripts inside the DeeeeeepWiki workspace so the implementation can be forked
and modified later without losing the current deployment contract.

## Layout

```text
opencode/
  adapters/
    sensenova-openai-bridge.js
  config/
    opencode.json
    tui.json
  runtime/
    package.json
  scripts/
    start-web.sh
    start-sensenova-bridge.sh
    opencode-tui.sh
    opencode-run.sh
    e2e-smoke.sh
  source/
    # shallow clone of upstream OpenCode for later product customization
```

## Runtime services

| Service | Purpose | Local endpoint |
|---|---|---|
| `aialra-opencode-sensenova.service` | Adapts SenseNova to an OpenAI-compatible local API | `127.0.0.1:12602` |
| `aialra-opencode-web.service` | Runs OpenCode Web GUI and server | `127.0.0.1:12601` |
| `aialra-opencode-login.service` | Provides a form login UI and proxies authenticated Web sessions | `127.0.0.1:12603` |
| Nginx | Publishes the Web GUI | `https://opencode.aialra.online` |

Tracked systemd unit templates live in `systemd/`. The active deployment uses
the fork build at `packages/opencode/dist/opencode-linux-x64/bin/opencode` when
that binary exists, and falls back to `runtime/node_modules/.bin/opencode`.

## Secrets

Real tokens are stored outside the repository in:

```text
/srv/aialra/config/secrets/opencode.env
```

The tracked config only references environment variables:

- `OPENCODE_DEEPSEEK_API_KEY`
- `OPENCODE_KIMI_API_KEY`
- `OPENCODE_MINIMAX_API_KEY`
- `OPENCODE_SENSETIME_API_KEY`
- `OPENCODE_SERVER_USERNAME`
- `OPENCODE_SERVER_PASSWORD`

## Web GUI

Open:

```text
https://opencode.aialra.online
```

Use the username and password stored in `/srv/aialra/config/secrets/opencode.env`.

The public URL shows a form login page instead of a browser Basic Auth prompt.
The login proxy keeps the upstream OpenCode server protected and injects the
inner Basic Auth header after a successful form login.

The login proxy also injects a small same-origin bootstrap script into the
OpenCode HTML. It pins the Web app's default server to the current public
origin, which avoids OpenCode's official-site fallback to `localhost:4096` on
the `opencode.aialra.online` hostname, and it adds an account settings section
with a logout button under Settings -> General.

The same upstream server backs Web GUI, `opencode attach`, and `opencode run`.

## Models

| Provider | OpenCode model |
|---|---|
| DeepSeek | `deepseek/deepseek-v4-flash` |
| Kimi Coding Plan | `kimi/kimi-for-coding` |
| MiniMax Token Plan | `minimax/MiniMax-M2.7` |
| SenseNova | `sensenova/SenseChat` |

DeepSeek, Kimi, and MiniMax were live-tested with minimal requests. SenseNova is
configured through the local compatibility bridge; the current supplied
credential returns `403 Forbidden` from the upstream SenseNova API, so that key
needs provider-side permission correction before live SenseNova calls can pass.

## TUI

Build the fork runtime before restarting the web service:

```bash
./aialra/opencode-deployment/scripts/build-opencode.sh
```

Attach the TUI to the deployed OpenCode server:

```bash
./aialra/opencode-deployment/scripts/opencode-tui.sh
```

Run a one-shot non-interactive task against the deployed server:

```bash
./aialra/opencode-deployment/scripts/opencode-run.sh "Inspect the repo and summarize the current module layout."
```

## Turn traces

Enable structural workflow traces with:

```bash
AIALRA_TURN_TRACE=1 ./aialra/opencode-deployment/scripts/start-web.sh
```

The default trace directory is `aialra/turn-observability/traces/`, and the
directory is ignored by git. Render the newest trace as a timeline with:

```bash
node aialra/turn-observability/scripts/render-trace.js aialra/turn-observability/traces
```

## Validation

Run the smoke suite:

```bash
./aialra/opencode-deployment/scripts/e2e-smoke.sh
```

The smoke suite creates a temporary test workspace under `opencode/.tmp/` and
removes it on exit.

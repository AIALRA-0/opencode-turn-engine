# Verification record: 2026-05-15

## Build environment

- Installed `bun@1.3.13` globally with npm because the server did not have Bun.
- Ran `bun install --frozen-lockfile`.
- Built fork binary with `bun run --cwd packages/opencode build --single`.
- Built binary: `packages/opencode/dist/opencode-linux-x64/bin/opencode`.
- Built version: `0.0.0-dev-202605151330`.

## Static checks

- `bash -n aialra/opencode-deployment/scripts/*.sh`: passed.
- `node --test aialra/opencode-deployment/tests/*.test.js aialra/turn-observability/tests/*.test.js`: passed, 10 tests.
- `bun run --cwd packages/opencode typecheck`: passed.
- `packages/opencode/dist/opencode-linux-x64/bin/opencode --version`: passed.
- `./aialra/opencode-deployment/scripts/opencode-run.sh --help`: passed through the fork binary resolver.

## Deployment

- Backed up previous systemd units to:

```text
/srv/aialra/backups/opencode-systemd-20260515153437
```

- Installed tracked unit templates from `aialra/opencode-deployment/systemd/`.
- Ran `systemctl daemon-reload`.
- Restarted:
  - `aialra-opencode-sensenova.service`
  - `aialra-opencode-web.service`
  - `aialra-opencode-login.service`

## Runtime checks

- `aialra-opencode-sensenova.service`: active.
- `aialra-opencode-web.service`: active and running
  `/srv/aialra/apps/opencode-turn-engine/packages/opencode/dist/opencode-linux-x64/bin/opencode`.
- `aialra-opencode-login.service`: active.
- Local SenseNova health: passed.
- Local OpenCode health: passed with version `0.0.0-dev-202605151330`.
- Public login page `https://opencode.aialra.online/`: returned form login HTML.
- `./aialra/opencode-deployment/scripts/e2e-smoke.sh`: passed.

## Trace check

- Ran one minimal attached model call with `deepseek/deepseek-v4-flash`.
- Trace file created under ignored local storage:

```text
aialra/turn-observability/traces/ses_1d4268b47ffeAdO6lfalr7m3nl.jsonl
```

- `node aialra/turn-observability/scripts/render-trace.js aialra/turn-observability/traces`: rendered 22 events over 13.638s.
- Confirmed the rendered timeline includes prompt, loop, context build, processor, stream, text, token/cost, and completion phases.
- Confirmed the trace does not include the prompt text, generated text, API keys, usernames, or passwords.

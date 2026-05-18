# AIALRA changelog

## 2026-05-18

- Added a next-stage public event stream and exec-server roadmap. The design
  maps the current internal trace/bus events into a user-readable and
  machine-consumable event model, then uses that model as the data source for a
  Turn Inspector UI.
- Documented the Codex exec-server protocol, process model, filesystem sandbox
  model, environment abstraction, and Linux sandbox differences based on the
  local Codex source tree. The recommended migration path is a Rust exec-server
  sidecar with a TypeScript adapter and the current Node/Bun executor as a
  temporary fallback.
- Added the next validation plan for approval auditing, profile parity tests,
  Linux bwrap parity, Landlock evaluation, debug1 original-OpenCode A/B
  benchmarking, and Kimi/weak-model loop diagnosis.

## 2026-05-17

- Added Codex-style tool executor gates for turn-scoped filesystem and shell
  execution. `read`, `write`, `edit`, `apply_patch`, and `bash` now receive the
  active `TurnContext`; relative paths resolve from `TurnContext.cwd`, direct
  filesystem writes are checked against the turn permission profile and sandbox
  policy, symlink escapes are denied, and protected workspace metadata paths
  such as `.git`, `.agents`, and `.codex` are read-only under the workspace
  profile.
- Added Linux `bubblewrap` execution for `bash` under managed turn sandboxes.
  Shell commands run with the host root mounted read-only and only the turn's
  writable roots bound writable, so shell writes outside the turn workspace are
  blocked by the operating system instead of only by prompt-level permission
  checks.
- Added trace events `tool.sandbox.checked` and `tool.sandbox.denied`, plus
  direct tool tests and prompt-level tool execution tests that verify
  TurnContext cwd routing and sandbox denial behavior.

- Added the first Codex-style turn lifecycle events to OpenCode prompt turns:
  `turn.started`, `turn.completed`, and `turn.aborted`. These are emitted on
  the session bus and mirrored into the AIALRA trace stream.
- Added an internal `aialra.user_turn.v1` / `TurnContext` contract with Codex
  field names for cwd, approval policy, sandbox policy, permission profile,
  model, final output schema, collaboration mode, environments, and stream
  retry limits. This remains internal and does not change the public SDK,
  OpenAPI, prompt schema, or database schema.
- Added the first permission-profile enforcement bridge: `approval_policy=never`
  converts existing ask rules into deny rules, and read-only profiles deny
  write/edit/shell/apply-patch style actions before tool execution.
- Added Codex-compatible provider options:
  `request_max_retries`, `stream_max_retries`, and `stream_idle_timeout_ms`.
  `stream_idle_timeout_ms` takes precedence over legacy `chunkTimeout`, while
  `chunkTimeout` remains supported for existing OpenCode configs.
- Wired model processing to Codex-style retry accounting. Request failures use
  `request_max_retries`; stream failures such as idle aborts, reset connections,
  or streams that close without a terminal finish use `stream_max_retries` and
  emit `model.stream.retrying`.
- Ensured prompt turn terminal events set session status back to idle, so a
  prompt turn should no longer remain in an endless "thinking" state without a
  `turn.completed` or `turn.aborted` event.
- Extended trace documentation and renderer samples to include `turn.context`,
  lifecycle events, and stream/request retry events.

## 2026-05-16

- Added the first Codex-style prompt intake frame for OpenCode turns. Each
  prompt now creates an internal `aialra.turn_frame.v1` structure with route,
  model, agent, explicit context labels, part counts, and non-synthetic text
  length, without adding public API or database schema changes.
- Added server-side explicit context completion for raw text prompts. API,
  paste, and command prompts that include clear `@file`, `@agent`, or configured
  `@reference` mentions now reuse the existing OpenCode resolver and append only
  missing synthetic parts, while keeping the original text unchanged.
- Extended turn traces with top-level `turnID`, `prompt.explicit_context_resolved`,
  and `turn.frame.created`, and propagated `turnID` through loop, model,
  processor, stream, tool, and final events.
- Updated observability docs and renderer tests so timelines can compare a full
  prompt intake to final response chain by turn.

## 2026-05-15

- Added the first OpenCode turn observability layer behind `AIALRA_TURN_TRACE`.
- Added JSONL trace events for prompt entry, user message creation, run-loop
  decisions, assistant message creation, tool resolution, model context build,
  processor lifecycle, model stream steps, text part boundaries, and tool calls.
- Added `aialra/turn-observability/` docs, schema notes, ignored local trace
  storage, a timeline renderer, and renderer tests.
- Updated deployment scripts to default `AIALRA_TURN_TRACE_DIR` to
  `aialra/turn-observability/traces` when tracing is enabled.
- Added fork-build-aware deployment scripts and tracked systemd unit templates
  so `opencode.aialra.online` can run the fork binary instead of the pinned
  upstream npm runtime.
- Deployed the fork binary to the server, enabled structural turn traces in the
  web service, and recorded verification in
  `aialra/turn-observability/verification-2026-05-15.md`.

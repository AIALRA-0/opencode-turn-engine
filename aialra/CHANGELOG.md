# AIALRA changelog

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

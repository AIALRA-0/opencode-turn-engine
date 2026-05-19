# Trace schema

Each line is an independent JSON object.

```json
{
  "trace": "aialra.turn.v1",
  "ts": "2026-05-15T12:00:00.000Z",
  "phase": "model.process.finished",
  "turnID": "msg_user_...",
  "sessionID": "ses_...",
  "messageID": "msg_...",
  "step": 1,
  "data": {}
}
```

## Fields

- `trace`: schema marker. Current value is `aialra.turn.v1`.
- `ts`: ISO timestamp emitted at write time.
- `phase`: workflow event name.
- `turnID`: user message ID that owns the current turn, when known.
- `sessionID`: OpenCode session ID when available.
- `messageID`: OpenCode message ID when available.
- `step`: run-loop step when available.
- `data`: sanitized structural metadata.

## Redaction contract

The trace layer may record:

- IDs and phase names.
- turn IDs that connect intake, loop, model, processor, and final events.
- part counts and part type counts.
- `TurnFrame` structural fields such as route, model, agent, explicit file/agent/reference labels, and text length.
- `UserTurn`/`TurnContext` structural fields such as cwd, approval policy, sandbox policy, permission profile, collaboration mode, environment IDs, and retry limits.
- agent, provider, model, variant, finish reason.
- tool names and tool input keys.
- token totals, cost, and boolean state flags.

The trace layer must not record:

- user prompt text.
- generated assistant text.
- tool argument values.
- tool output content.
- raw system prompts or model messages.
- usernames, passwords, API keys, or provider tokens.

## Public event stream

The trace schema is an internal observation surface. It is useful for debugging,
but it is not the final user-facing protocol.

The first user-facing layer is now implemented as `aialra.public_event.v1` and
documented in:

```text
aialra/turn-observability/public-event-stream-and-exec-server-roadmap.md
```

That layer maps trace phases and OpenCode bus events into stable public
events such as `turn.started`, `model.retrying`, `tool.call.started`,
`tool.sandbox.denied`, `approval.requested`, `approval.resolved`, and
`final.output`. The public stream keeps the same redaction rule: show structure,
state, IDs, policy, paths, and summaries; do not show raw prompt text, complete
model text, full tool output, or secrets.

Implemented endpoints:

- `GET /event/public`
- `GET /session/:sessionID/events/public`
- `GET /session/:sessionID/events/:eventID/raw`

Safe public events use `id`, `sequence`, `ts`, `type`, `severity`,
`sessionID`, `turnID`, `messageID`, `toolCallID`, `title`, `summary`,
`status`, `data`, and optional `rawRef`. Full raw payloads are not sent over
SSE; the raw endpoint decrypts or reads the referenced payload after the
existing OpenCode server auth check. If `AIALRA_EVENT_AUDIT_KEY` is missing,
raw payloads use a bounded in-memory fallback with a 64 KiB default per payload
via `AIALRA_EVENT_MEMORY_RAW_LIMIT_BYTES`.

## Current phases

- `prompt.received`
- `prompt.explicit_context_resolved`
- `turn.frame.created`
- `turn.context.created`
- `turn.started`
- `user_message.created`
- `prompt.no_reply`
- `prompt.reply_requested`
- `prompt.completed`
- `turn.completed`
- `turn.aborted`
- `turn.budget_limited`
- `turn.repeated_tool.warning`
- `loop.started`
- `loop.step.started`
- `loop.exit_condition.met`
- `task.subtask.started`
- `task.subtask.finished`
- `task.compaction.started`
- `task.compaction.finished`
- `compaction.overflow_requested`
- `assistant_message.created`
- `tools.resolved`
- `tools.structured_output_added`
- `model.context_built`
- `model.process.started`
- `model.process.finished`
- `model.request.retrying`
- `model.stream.retrying`
- `exec_server.process.started`
- `exec_server.process.finished`
- `exec_server.fs.started`
- `exec_server.fs.finished`
- `exec_server.fallback`
- `tool.sandbox.capability`
- `tool.sandbox.checked`
- `tool.sandbox.denied`
- `loop.step.finished`
- `loop.finished`
- `processor.created`
- `processor.process.started`
- `processor.process.finished`
- `processor.halted`
- `model.stream.started`
- `model.step.started`
- `model.step.finished`
- `text.started`
- `text.finished`
- `tool.input.started`
- `tool.call.started`
- `tool.call.finished`

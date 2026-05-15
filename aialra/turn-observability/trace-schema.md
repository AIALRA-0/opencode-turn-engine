# Trace schema

Each line is an independent JSON object.

```json
{
  "trace": "aialra.turn.v1",
  "ts": "2026-05-15T12:00:00.000Z",
  "phase": "model.process.finished",
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
- `sessionID`: OpenCode session ID when available.
- `messageID`: OpenCode message ID when available.
- `step`: run-loop step when available.
- `data`: sanitized structural metadata.

## Redaction contract

The trace layer may record:

- IDs and phase names.
- part counts and part type counts.
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

## Current phases

- `prompt.received`
- `user_message.created`
- `prompt.no_reply`
- `prompt.reply_requested`
- `prompt.completed`
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

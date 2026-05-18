# AIALRA turn observability

This layer records the OpenCode turn workflow from user prompt entry through
loop orchestration, model streaming, and tool execution. It is intentionally
off by default and writes only structural metadata: phase names, IDs, counts,
turn IDs, model names, tool names, token totals, cost, and finish states.

It does not write prompt text, generated text, tool arguments, tool output, API
tokens, usernames, or passwords.

## Enable traces

```bash
AIALRA_TURN_TRACE=1 ./aialra/opencode-deployment/scripts/start-web.sh
```

The deployment scripts default the trace directory to:

```text
aialra/turn-observability/traces/
```

Override it when needed:

```bash
AIALRA_TURN_TRACE=1 \
AIALRA_TURN_TRACE_DIR=/srv/aialra/tmp/opencode-traces \
./aialra/opencode-deployment/scripts/start-web.sh
```

Trace files are JSONL, one file per session:

```text
<trace-dir>/<session-id>.jsonl
```

## Render a timeline

```bash
node aialra/turn-observability/scripts/render-trace.js aialra/turn-observability/traces
```

When a directory is provided, the renderer picks the newest `.jsonl` file. You
can also pass a specific trace file.

## How we use it

The first comparison target is the shape of a single turn:

1. `prompt.received`
2. `prompt.explicit_context_resolved`
3. `turn.frame.created`
4. `user_message.created` and `prompt.reply_requested`
5. `loop.started` and `loop.step.started`
6. `assistant_message.created`
7. `tools.resolved`
8. `model.context_built`
9. `processor.process.started`
10. stream events such as `model.step.started`, `text.started`, `tool.call.started`
11. `processor.process.finished`
12. `loop.step.finished`, `loop.finished`, `prompt.completed`

That gives us a stable observation surface before we merge in Codex-style turn
planning, tool governance, retry behavior, and final response handling.
Events that belong to a user turn carry the same top-level `turnID`, so a
single prompt can be followed through intake, loop, model, processor, and final
response without reading prompt text.

## Status and manual tests

For the current Codex-harness acceptance matrix, remaining gap matrix, manual
target prompts, A/B benchmark advice, and user-visible transparency roadmap, see:

```text
aialra/turn-observability/harness-status-and-test-playbook.md
```

For the next-stage design that turns internal traces into a user-visible public
event stream, adds the Turn Inspector UI, and plans the Codex exec-server/Linux
sandbox migration, see:

```text
aialra/turn-observability/public-event-stream-and-exec-server-roadmap.md
```

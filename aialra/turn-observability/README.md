# AIALRA turn observability

This layer records the OpenCode turn workflow from user prompt entry through
loop orchestration, model streaming, and tool execution. It is intentionally
off by default and writes only structural metadata: phase names, IDs, counts,
model names, tool names, token totals, cost, and finish states.

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

1. `prompt.received` and `user_message.created`
2. `loop.started` and `loop.step.started`
3. `assistant_message.created`
4. `tools.resolved`
5. `model.context_built`
6. `processor.process.started`
7. stream events such as `model.step.started`, `text.started`, `tool.call.started`
8. `processor.process.finished`
9. `loop.step.finished`, `loop.finished`, `prompt.completed`

That gives us a stable observation surface before we merge in Codex-style turn
planning, tool governance, retry behavior, and final response handling.

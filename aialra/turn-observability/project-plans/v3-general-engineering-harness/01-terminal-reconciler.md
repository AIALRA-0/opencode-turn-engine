# 01 Turn Terminal Reconciler Plan

## Original Task

请实现 AIALRA turn terminal reconciler，终态校准器。要求所有 turn.started 后必须有 completed 或 aborted。对模型未启动、空 final、零工具、零补丁、runner 等不到终态分别生成明确事件和 assistant error。所有终态必须进入 public event stream、Turn Inspector、benchmark JSON，并补测试。

## Human Goal

用户发出一轮请求后，系统不能留下一个不知道死活的回合。

用户要能看到：

```text
这轮开始了
这轮结束了
如果失败，失败原因是什么
如果模型没有真正工作，也要明确说出来
```

## Current Problem Class

Recent benchmark records showed several distinct terminal failures:

- model did not start
- assistant final text was empty
- no tool events were emitted
- final looked like a summary but no patch existed
- runner could not observe a clean terminal state

These are different problems and must not all become a vague timeout.

## Target Behavior

For every turn:

```text
turn.started -> exactly one of turn.completed or turn.aborted
```

If a terminal anomaly happens, create:

- internal trace event
- public event
- assistant error message when user-visible
- Turn Inspector readable summary
- benchmark JSON classification

## Terminal Anomaly Types

| Type | Meaning | Expected terminal handling |
| --- | --- | --- |
| model_not_started | model request never began after turn started | assistant error + completed |
| empty_final | final message is empty or whitespace | assistant error + completed |
| zero_tool | engineering task ended without useful tool activity | assistant error or repair feedback |
| zero_patch | engineering task ended without diff | route to zero patch recovery first |
| runner_no_terminal | benchmark runner did not observe terminal event | synthetic benchmark terminal classification |
| stream_exhausted | stream retry exhausted | assistant error + completed |
| user_interrupted | user stopped the turn | aborted interrupted |
| replaced | newer user turn replaced old run | aborted replaced |

## Implementation Areas

Likely files:

- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/turn-context.ts`
- `packages/opencode/src/session/public-event.ts`
- `packages/opencode/src/session/engineering.ts`
- `packages/app/src/pages/session/turn-inspector.tsx`
- `aialra/turn-observability/scripts/run-real-benchmark.mjs`
- public event tests
- session tests

## Technical Design

Add a small terminal reconciliation layer around prompt execution.

It should collect:

- turnID
- sessionID
- messageID
- startedAt
- modelStarted
- firstTokenSeen
- toolCallCount
- assistantTextLength
- finalEmitted
- abortEmitted
- diffStatus if benchmark or engineering run can provide it

The reconciler must run at all exits:

- normal model completion
- noReply
- model error
- processor halt
- user abort
- replacement abort
- catch/finally path
- benchmark runner timeout path

## Public Events

Add or reuse:

- `turn.terminal.reconciled`
- `turn.terminal.anomaly`
- `turn.completed`
- `turn.aborted`

Public summary must be Chinese and user-readable:

```text
这轮没有启动模型请求，系统已结束本轮并恢复输入
```

No raw prompt or secret material in public event body.

## Turn Inspector Behavior

Show a terminal card:

- status: completed, aborted, anomalous completed
- reason
- tool count
- model started or not
- assistant output length
- recovery action

No naked JSON as default display.

## Benchmark JSON

Each case result should include:

```json
{
  "terminal": {
    "observed": true,
    "kind": "completed",
    "anomaly": "empty_final",
    "reason": "assistant final text was empty",
    "modelStarted": false,
    "toolCallCount": 0
  }
}
```

## Tests

Unit tests:

- started then normal completed
- started then aborted
- started then model not started
- started then empty final
- started then zero tool engineering task
- terminal emitted only once

Integration tests:

- mock model throws before request start
- mock model streams then errors
- noReply turn completes
- user cancellation aborts

Benchmark script tests:

- missing public terminal becomes classified anomaly
- benchmark JSON includes terminal reason

## Milestones

1. Add terminal state collection
2. Add reconciliation function
3. Wire all prompt exits
4. Add public event mapping
5. Add Inspector rendering
6. Add benchmark JSON fields
7. Add tests
8. Update docs

## Done Means

- no `turn.started` can disappear without terminal event
- benchmark can distinguish empty final from timeout
- user sees a clear reason, not a spinner forever

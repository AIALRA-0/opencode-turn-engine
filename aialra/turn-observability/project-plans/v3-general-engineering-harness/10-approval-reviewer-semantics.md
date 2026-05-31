# 10 Approval Reviewer Semantics Plan

## Original Task

请补齐 AIALRA approval reviewer 语义。审批按钮改为拒绝、单轮允许本命令、单轮允许全部命令、仅允许一次本命令、本对话始终允许本命令、本对话始终允许全部命令。每个选择必须写入 TurnContext 或 session policy，并和 Sandbox Control Center 双向联动，事件流可审计。

## Human Goal

审批按钮不能让用户猜。

用户必须知道：

```text
我批准的是这个命令
还是这一轮所有命令
还是整个对话以后都允许
```

## Approval Choices

| Button | Meaning | Scope |
| --- | --- | --- |
| 拒绝 | 不允许这次操作 | current request |
| 单轮允许本命令 | 当前 turn 内允许同一个命令 | turn + command signature |
| 单轮允许全部命令 | 当前 turn 内允许所有命令类操作 | turn + tool class |
| 仅允许一次本命令 | 只放行这一次 | single tool call |
| 本对话始终允许本命令 | 当前 session 后续都允许同一个命令 | session + command signature |
| 本对话始终允许全部命令 | 当前 session 后续都允许所有命令类操作 | session + tool class |

## UI Problem

Button labels are long.

Design:

- short visible label
- tooltip explains full effect
- confirmation copy for dangerous broad approvals
- advanced details folded

Example:

```text
本轮本命令
tooltip: 只在当前这轮对话中允许同一个命令再次执行
```

## Policy Storage

Short-lived:

- current tool call
- current turn

Longer-lived:

- session policy

Must synchronize with:

- TurnContext
- Sandbox Control Center
- public event stream
- Turn Inspector approval panel

## Events

- `approval.requested`
- `approval.resolved`
- `approval.policy.changed`
- `security.override.requested`
- `security.override.resolved`

## Tests

- reject blocks tool
- allow once allows one call only
- turn same command allows repeated same command in same turn
- turn all commands allows command class in same turn
- session same command persists next turn
- session all commands persists next turn
- control center reflects session-level approval
- event stream records who, what, scope, before, after
- duplicate approval popup not emitted

## Milestones

1. Define approval scope model
2. Update request and response schemas
3. Update UI labels and tooltips
4. Connect session policy
5. Connect Sandbox Control Center
6. Add events
7. Add tests

## Done Means

No approval choice is ambiguous, and every approval can be audited later.

# AIALRA Public Schema Docs

状态: `aialra.public_event.v1`

本文档是第三方 UI、插件、MCP、企业 connector、benchmark harness 读取 AIALRA OpenCode 事件流的公共协议说明。内部 trace 可以变化，公共事件协议必须保持向后兼容。

## 1. PublicEvent 外壳

每条公共事件都必须是一个安全外壳:

```json
{
  "schema": "aialra.public_event.v1",
  "version": "1",
  "id": "pev_...",
  "sequence": 1,
  "ts": "2026-06-04T00:00:00.000Z",
  "type": "turn.started",
  "source": "trace",
  "threadID": "msg_user_...",
  "severity": "info",
  "sessionID": "ses_...",
  "turnID": "msg_user_...",
  "messageID": "msg_assistant_...",
  "toolCallID": "call_...",
  "title": "回合开始",
  "summary": "给用户看的短摘要",
  "status": "started",
  "payloadSchema": "aialra.public_event.turn_started.v1",
  "payload": {},
  "data": {},
  "extension_data": {},
  "rawRef": {
    "id": "raw_...",
    "eventID": "pev_...",
    "encrypted": true,
    "persisted": true
  }
}
```

字段含义:

| 字段 | 含义 | 兼容要求 |
| --- | --- | --- |
| `schema` | 公共事件总 schema，当前固定 `aialra.public_event.v1` | 破坏性变更必须升到 v2 |
| `version` | 主版本，当前固定 `1` | 新增字段不得改变旧字段语义 |
| `id` | 事件唯一 id，也是 SSE `id` 和 Last-Event-ID 游标 | 客户端必须用它去重 |
| `sequence` | 服务端递增序号 | 仅用于同进程内排序和续传 |
| `ts` | ISO 时间 | 不能作为唯一排序依据 |
| `type` | 事件类型 | 必须出现在本文档事件清单 |
| `source` | `trace`、`bus` 或 `manual` | 第三方可据此区分来源 |
| `threadID` | 优先等于 turnID，其次 sessionID | 用于跨事件串联 |
| `severity` | `info`、`warning`、`error` | UI 可直接映射颜色 |
| `payloadSchema` | 类型化 payload schema 名 | 默认由 type 派生 |
| `payload` | 机器可消费安全载荷 | 第一版与 data 保持兼容 |
| `data` | 安全摘要载荷 | 不得放完整 prompt、完整输出、密钥 |
| `extension_data` | 命名空间扩展字段 | 插件和企业策略必须放这里 |
| `rawRef` | 原始 payload 引用 | 只能通过 raw endpoint 按权限读取 |

## 2. RawRef 原始数据

安全事件默认不直接包含完整原文。完整 prompt、模型原始 chunk、reasoning raw、tool output、exec bytes delta 等内容必须放入 rawRef。

读取方式:

```text
GET /session/:sessionID/events/:eventID/raw
GET /session/:sessionID/raw-lab
GET /session/:sessionID/raw-lab/download
```

`raw-lab/download` 返回 `aialra.raw_bundle.v1`，包含 manifest、hash、publicEvents、rawPayloads、TurnHistory、traceRecords、messages、parts。

## 3. 版本策略

- 允许新增 event type
- 允许新增字段
- 不允许删除现有字段
- 不允许改变现有字段含义
- 破坏性变更必须新建 schema 或提升 version
- 旧客户端必须忽略未知字段
- 新客户端必须能读取旧事件缺失字段

## 4. 兼容和重放

公共事件流支持:

- `GET /event/public`
- `GET /session/:sessionID/events/public`
- `Last-Event-ID` header
- `lastEventID` query

客户端规则:

- 用 `id` 去重
- 用 `sequence` 排序
- 断线后从最后一个 `id` 续传
- 如果服务端找不到旧 id，允许回放当前 buffer，客户端仍按 id 去重

## 5. 核心结构

### UserTurn

UserTurn 是用户一次请求的执行合同，不是模型随便看的 JSON。AIALRA 公开可观察字段包括:

| 字段 | 含义 |
| --- | --- |
| `items` | 本轮用户输入和上下文 item |
| `cwd` | 本轮默认工作目录 |
| `approval_policy` | 本轮审批策略 |
| `approvals_reviewer` | 审批评审来源 |
| `sandbox_policy` | 沙箱策略 |
| `permission_profile` | 权限档位 |
| `model` | 本轮模型 |
| `effort` | 推理努力程度 |
| `summary` | 推理摘要策略 |
| `service_tier` | 模型服务档位 |
| `final_output_json_schema` | 最终输出 JSON schema |
| `collaboration_mode` | 协作模式 |
| `personality` | 本轮风格覆盖 |
| `environments` | 本轮可用环境 |

### TurnContextItem

TurnHistory 中的 `turn.context.item` 是 replay 用上下文 item:

| 字段 | 含义 |
| --- | --- |
| `kind` | input/message/turn_context/environment/permission/sandbox/network/model/tool/file/command/http/approval/engineering/warning/raw/runtime |
| `phase` | 原始 trace phase |
| `step` | loop step |
| `context` | 压缩后的安全上下文 |

## 6. 事件类型清单

以下类型必须和 `packages/opencode/src/session/public-event.ts` 的 `PUBLIC_EVENT_TYPES` 同步:

```text
audit.encryption.unavailable
session.configured
session.handoff.requested
session.handoff.prepared
prompt.effective.resolved
turn.input.received
turn.context.created
turn.started
turn.warning
turn.step_budget.changed
turn.completed
turn.aborted
turn.abort.requested
turn.abort.resolved
turn.terminal.assistant_error
turn.diff.updated
patch.quality.scored
engineering.controls.changed
engineering.mode.changed
engineering.budget.changed
engineering.benchmark.tier.selected
engineering.benchmark.started
engineering.benchmark.finished
multi_agent.task.assigned
multi_agent.task.settled
multi_agent.conflict.detected
engineering.run.started
engineering.phase.changed
engineering.artifact.updated
engineering.verification.planned
engineering.verification.started
engineering.verification.finished
engineering.verification.repair_requested
engineering.phase_gate.blocked_tool
engineering.phase_gate.premature_final
engineering.zero_patch.detected
engineering.zero_patch.recovery_requested
engineering.zero_patch.recovered
engineering.zero_patch.exhausted
engineering.stop_gate.checked
engineering.stop_gate.activated
engineering.stop_gate.blocked_tool
engineering.loop.warning
engineering.loop.checkpoint
engineering.loop.blocked
engineering.reasoning.recorded
reasoning.summary.created
reasoning.raw.item
engineering.deployment_gate.updated
engineering.run.finished
model.raw.chunk
model.raw.item
model.capability.evaluated
model.capability.degraded
model.effort.resolved
model.service_tier.resolved
model.request.started
model.stream.started
model.retrying
model.request.finished
runtime.provider.selected
runtime.item.received
runtime.item.settled
item.lifecycle.started
item.lifecycle.completed
item.lifecycle.failed
item.lifecycle.aborted
provider.tool.call
provider.tool.result
executor.started
executor.finished
executor.fallback
tool.foundation.resolved
tool.foundation.executing
tool.foundation.settled
tool.lifecycle.requested
tool.lifecycle.started
tool.lifecycle.completed
tool.lifecycle.failed
tool.lifecycle.aborted
tool.output.stored
tool.result.settled
tool.call.started
tool.call.finished
tools.dynamic.resolved
skill.catalog.resolved
skill.catalog.injected
skill.used
tool.sandbox.capability
tool.sandbox.checked
tool.sandbox.denied
sandbox.effective
security.constraint.checked
security.constraint.denied
file.read
file.search
directory.read
file.write
exec_command.started
exec_command.output_delta
exec_command.end
exec_command.output
exec_command.yielded
exec_command.finished
exec_command.fallback
exec.approval.requested
exec.approval.resolved
apply_patch.approval.requested
apply_patch.approval.resolved
exec_process.registered
exec_process.await_started
exec_process.await_progress
exec_process.await_finished
exec_process.await_timeout
exec_process.capacity_checked
exec_process.capacity_denied
exec_process.finished
exec_process.finish_ignored
exec_process.abort_requested
exec_process.abort_denied
exec_process.cleanup
terminal.stdin.written
terminal.stdin.denied
terminal.interaction
command.started
command.output
command.finished
shell.env.policy.applied
network.proxy.applied
network.proxy.unavailable
http.request.classified
approval.requested
approval.resolved
permission.grant.created
approval.reviewer.changed
reviewer.resolved
guardian.assessment.completed
auto_review.completed
request_permissions.requested
request_permissions.resolved
final.output
sandbox.profile.changed
sandbox.network.changed
sandbox.command.changed
sandbox.policy.changed
sandbox.control.changed
approval.policy.changed
executor.backend.changed
environment.selected
security.override.requested
security.override.resolved
turn.terminal.anomaly
turn.terminal.reconciled
thread.rollback.requested
thread.rollback.applied
thread.rollback.noop
thread.rollback.restored
thread.rollback.cleaned
context.compaction.started
context.compaction.completed
context.compaction.failed
context.compaction.pruned
extension.data.attached
```

## 7. 迁移说明

- 老事件没有 `payload` 或 `payloadSchema` 时，客户端应把 `data` 当作 payload
- 老事件没有 `rawRef` 时，不能假设没有 raw，只能说明该事件没有可公开读取的 raw 引用
- 老事件没有 `threadID` 时，用 `turnID ?? sessionID ?? "global"` 推导
- 旧 TurnHistory 的 `turn.context.item` 可继续按 `kind/phase/context` 读取

## 8. 第三方解析建议

第三方只依赖这些稳定入口:

- 公共 SSE: `/session/:sessionID/events/public`
- 单事件 raw: `/session/:sessionID/events/:eventID/raw`
- session raw bundle: `/session/:sessionID/raw-lab/download`
- 协议 registry: `PublicEventLog.protocol()` 的输出

不要依赖内部 trace 文件路径、数据库表结构或 UI 组件内部状态。

# REQ-068 Reviewer override

## 原始目标

68. Reviewer override：AIALRA 必须补全 reviewer override，支持 connector-level、environment-level、project-level、enterprise-level 的审批人覆盖规则。不同来源的资源不应该都由 current_user 单独审批，例如企业 connector、remote environment、托管 sandbox、生产仓库、外部 MCP server 可以要求 auto_review、guardian、policy_engine 或 external_reviewer。实现时必须定义 reviewer resolution 顺序：per-request reviewer、environment override、connector override、project policy、session default、current user fallback，并把最终 reviewer 写入 approval request。验收标准是：同一条命令在 local environment 可以由 user 批准，在 enterprise connector environment 中必须由 policy_engine 或 guardian 审批；inspector 能显示 reviewer 是如何被解析出来的，以及哪些 override 生效。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现 reviewer resolution 顺序、environment/connector/project/per-request/session/fallback 覆盖、public event、approval request 写入和测试
- 依赖前置: REQ-067 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session/security.ts`
- `packages/opencode/src/permission`
- `packages/opencode/src/tool`
- `packages/opencode/src/tool/sandbox.ts`
- `packages/app/src`

必须回答:

- 当前 AIALRA 已经有 `approvals_reviewer`、Guardian、AutoReview、Permission.ask、approval request/reply 和 public event replay
- 原版 OpenCode 通常把审批交给当前用户或配置规则，没有显式记录“审批人为什么这样解析”
- Codex 的方向是不同环境、connector、project policy 可以要求不同 reviewer，不能让所有资源都由 current user 直接审批
- 本条对齐方式：新增 `ReviewerOverride.resolve`，在 `Permission.ask` 中先解析最终 reviewer，再进入 AutoReview 和普通 pending approval
- 差距：本条实现 deterministic override chain，enterprise policy backend 仍是本地规则而非远端企业策略服务

## 数据结构和 schema 计划

- 新增 payload schema：`aialra.reviewer_resolution.v1`
- 字段包括：`resolution_id`、`session_id`、`turn_id`、`message_id`、`tool_call_id`、`order`、`selected_reviewer`、`matched_source`、`candidates`、`user_visible_explanation`
- reviewer 解析顺序：`per_request -> environment_override -> connector_override -> project_policy -> guardian_risk_policy -> session_default -> current_user_fallback`
- 最终 reviewer 写入 `Permission.Request.approval_reviewer`
- 完整解析过程写入 `Permission.Request.metadata.reviewer_resolution` 和 `Permission.Request.reviewer_resolution`

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 新增 public event：`reviewer.resolved`
- `approval.requested` 和 `approval.resolved` 携带 `reviewer_resolution`
- `TurnHistory.contextItemKind` 将 `reviewer.*` 归入 `approval`
- 事件摘要展示 matched_source 和最终 reviewer label

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- `Permission.ask` 在 Guardian 之后、AutoReview 之前调用 reviewer resolution
- AutoReview 使用解析后的 reviewer，因此 environment/connector/project 可以阻止 auto_review 默认放行
- pending approval 使用解析后的 reviewer，而不是原始 session default
- 支持来源：
  - `metadata.per_request_reviewer`
  - `metadata.environment_override`
  - `metadata.exec_approval.environment_id`
  - `metadata.request_permissions.requested_environment_id`
  - `metadata.connector_override`
  - `metadata.connector.type`
  - `metadata.project_policy`
  - Guardian high-risk reviewer
  - session default
  - current user fallback

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- public event 中文名：`审批人解析完成`
- 摘要展示来源和 reviewer
- approval.requested 中显示最终审批人和 reviewer_resolution
- history/replay 可按 approval 分类回看解析过程

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造允许、询问、硬拒绝、约束覆盖审批四类场景
- 断言 UI 展示和实际执行结果一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

- `bun test test/permission/reviewer-override.test.ts test/permission/auto-review.test.ts test/permission/guardian-assessment.test.ts test/permission/approval-audit.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 43 pass，0 fail
  - 覆盖本地 session default user、enterprise environment policy_engine、external connector external_reviewer、per-request 优先级
- `bun typecheck`
  - pass
- `node --test aialra/turn-observability/tests/*.test.js`
  - 6 pass，0 fail

## 验收标准

- 协议层已实现并有 schema 测试
- history/replay 已实现并有恢复测试
- trace/public event 已实现并有事件样例测试
- Inspector 已展示并有 UI 或投影测试
- runtime 行为真实生效并有端到端测试
- 旧 session 兼容测试通过
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

## 执行记录

- 开始时间: 2026-06-04T23:54:35+02:00
- 完成时间: 2026-06-04T23:58:41+02:00
- 修改文件:
  - `packages/opencode/src/session/reviewer-override.ts`
  - `packages/opencode/src/permission/index.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/permission/reviewer-override.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-068-reviewer-override.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/permission/reviewer-override.test.ts test/permission/auto-review.test.ts test/permission/guardian-assessment.test.ts test/permission/approval-audit.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - reviewer/auto-review/guardian/approval/history/public-event：43 pass
  - opencode typecheck：pass
  - observability tests：6 pass
- 残留风险:
  - 企业 policy engine/external reviewer 目前是本地 reviewer resolution 结果，不是远端企业审批服务
  - 后续 REQ-070 会继续把 UI 六按钮和 reviewer resolution 联动做成用户可见产品能力

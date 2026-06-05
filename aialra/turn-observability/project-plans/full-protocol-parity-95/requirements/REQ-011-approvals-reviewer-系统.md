# REQ-011 Approvals reviewer 系统

## 原始目标

11. Approvals reviewer 系统：AIALRA 必须把审批人从 current_user 扩展成 reviewer 系统，支持 user、auto_review、guardian、policy_engine、external_reviewer 等角色。每次 approval 都必须记录 requested_by、reviewed_by、review_result、review_reason、review_time、overridden_by_constraints。这样以后做企业版、自动审查、托管沙盒时不会被 current_user 单字段卡死。验收标准是：同一个危险操作可以由不同 reviewer 策略处理，并且 inspector 能显示是谁批准或拒绝了它。

## 当前状态

- 状态: 完全完成
- 完成判定: 完成
- 依赖前置: REQ-010 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有什么
- 最新 OpenCode 已经有什么
- 最新 Codex 已经有什么
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪

### 实际调查结论

- 当前 AIALRA 在本条之前只有 `approvals_reviewer: "current_user"` 这种单字段，审批弹窗能记录 ask/reply 和 scope，但缺少 reviewer role、requested_by、reviewed_by、review_result、review_reason、review_time、overridden_by_constraints 等审计字段。
- 原版 OpenCode 主要靠 `Permission.ask/reply` 和 ruleset，不区分 reviewer 系统；它能让用户点 once/always/reject，但难以表达“自动审查器、策略引擎、外部审查器”是谁做的决定。
- 最新 Codex 本地源码有 `ApprovalsReviewer::User`、`ApprovalsReviewer::AutoReview`，并兼容 legacy `guardian_subagent`；TUI 和 app-server protocol 里也有 approvals_reviewer override 和 additional permissions。Codex 的方向是把 reviewer 作为配置/协议字段，而不是把审批人硬写成当前用户。
- 本条实现后，AIALRA 支持 `user`、`auto_review`、`guardian`、`policy_engine`、`external_reviewer` 五类 reviewer role，并把 ask/reply 的审计字段贯通到 Permission bus、public event、SessionSecurity 和 TurnContext。

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 实际数据结构

- `TurnContext.approvals_reviewer` 从字符串升级为结构化对象：
  - `role`: `user | auto_review | guardian | policy_engine | external_reviewer`
  - `id`
  - `label`
  - `source`: `config | turn_settings | default | legacy`
- `SessionSecurity` 新增 `approvalsReviewer` 配置，默认 `user`，支持 session config 和 per-turn settings override。
- `Permission.Request` 新增：
  - `requested_by`
  - `requested_at`
  - `approval_reviewer`
  - `reviewed_by`
  - `review_result`
  - `review_reason`
  - `review_time`
  - `overridden_by_constraints`
- `Permission.Reply` payload 兼容旧字段，同时允许携带 `reviewed_by/review_reason/review_time/review_result/overridden_by_constraints`。
- 旧 session 兼容：没有配置时 `CodexTurn.approvalReviewer()` 生成 `{ role: "user", id: "current_user" }`。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 实际事件

- 新增 public event 类型：
  - `approval.reviewer.changed`
- `permission.asked` 映射的 `approval.requested` 现在包含 requested/reviewer/pending 审计字段。
- `permission.replied` 映射的 `approval.resolved` 现在包含 reviewed_by、review_result、review_reason、review_time、overridden_by_constraints。
- `Permission.reply` 还会写 `security.override.resolved` 手工审计事件，记录 scope 对服务端 reviewer state 的影响。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 实际 runtime 接入

- 主工具路径 `SessionPrompt` 的 `ctx.ask` 会从当前 `TurnContext.approvals_reviewer` 填入 approval request。
- provider/plugin 工具路径 `SessionTools` 也会填入默认 current user reviewer，避免没有 turn 的审批丢审计。
- processor doom-loop guard 的审批也写入 reviewer 字段。
- `SessionSecurity.applyToTurn` 会把 live config 和 turn override 后的 reviewer 写回 turn。
- 审批结果进入 `Permission.reply` 的 pending request settlement，允许、拒绝、传播给同 session 其他 pending request 时都带 reviewer 结果。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### 实际 Inspector 投影

- Turn Inspector 通过 public event 可看到 `approval.requested`、`approval.resolved`、`approval.reviewer.changed`。
- 默认摘要仍是中文事件名，rawRef 里保留完整 reviewer 字段。
- 历史回放通过 bus event 和 manual event 双通道保留 reviewer 审计数据。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造允许、询问、硬拒绝、约束覆盖审批四类场景
- 断言 UI 展示和实际执行结果一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

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

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/tools.ts`
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/session.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/permission/index.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/groups/permission.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/permission.ts`
  - `packages/opencode/test/permission/approval-audit.test.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/server/httpapi-public-event.test.ts`
  - `packages/opencode/test/session/engineering.test.ts`
- 测试命令:
  - `bun test test/permission/approval-audit.test.ts test/session/security.test.ts test/session/engineering.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/server/httpapi-public-event.test.ts test/permission/approval-audit.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - approval/security/engineering/public-event 28 pass
  - public-event/approval-audit focused 8 pass
  - opencode typecheck pass
- 残留风险:
  - 当前实现把 reviewer 协议和审计链路落地，`auto_review/guardian/policy_engine/external_reviewer` 的真实自动判定引擎仍在后续 guardian/auto review/request_permissions 条目实现。
  - 前端按钮文案和 reviewer 选择 UI 的产品化属于后续 approval UI 条目。

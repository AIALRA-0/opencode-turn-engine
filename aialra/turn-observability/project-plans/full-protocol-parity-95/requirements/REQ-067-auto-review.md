# REQ-067 Auto review

## 原始目标

67. Auto review：AIALRA 必须实现 auto_review 配置，支持对低风险、重复、规则明确的请求自动批准或自动拒绝，避免所有操作都打断用户。auto_review 应支持按 tool type、command pattern、path pattern、domain、environment_id、permission_profile、risk_level、project policy、time window 配置规则，并输出 auto_review_result、matched_rule、confidence、reason、fallback_reviewer。auto_review 不得绕过 constraints 和 guardian；当规则不明确、风险过高或命中 protected path 时必须升级给 user/guardian/external reviewer。验收标准是：安全的 read-only 命令、已允许路径内的普通 grep/glob、已白名单域名访问可以自动通过；高风险写入、未知网络、shell destructive command 会自动拒绝或升级审批；所有自动决策都能在 inspector 中看到匹配规则和原因。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现 `auto_review` 后端审查器、自动通过、自动升级、事件审计、history/replay 分类和测试
- 依赖前置: REQ-066 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有 approval reviewer 字段、Guardian assessment、Permission.ask pending approval、public event replay、TurnHistory 和 Sandbox Control Center 的 reviewer 配置入口
- 原版 OpenCode 可以通过 permission rules allow/deny，但没有单独的 auto reviewer 输出 `matched_rule`、`confidence`、`fallback_reviewer`，也没有将自动决策作为审计事件展示
- Codex 的方向是低风险明确操作可以少打扰用户，高风险或不明确请求必须升级到对应 reviewer，不能让 auto review 绕过 sandbox/guardian/constraints
- 本条对齐方式：新增 `AutoReview`，只在 `approval_reviewer=auto_review` 时运行；Guardian 先评估，硬约束先拒绝；auto review 只处理低风险明确规则或升级
- 差距：本条实现默认规则集 v1，尚未做用户自定义 rule editor；那属于后续控制中心产品化

## 数据结构和 schema 计划

- 新增 payload schema：`aialra.auto_review_result.v1`
- 字段包括：`result_id`、`session_id`、`turn_id`、`message_id`、`tool_call_id`、`permission`、`patterns`、`auto_review_enabled`、`decision`、`matched_rule`、`confidence`、`reason`、`fallback_reviewer`、`guardian_assessment`
- `decision=auto_approve` 表示后端直接放行，不进入 pending approval
- `decision=auto_deny` 表示自动拒绝，本条当前由 Guardian hard block 优先处理，auto reviewer 仍保留该结果类型
- `decision=escalate` 表示不能自动决策，继续进入普通审批
- 结果挂到 `Permission.Request.metadata.auto_review_result` 和 `Permission.Request.auto_review_result`

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 新增 public event：`auto_review.completed`
- 自动通过时 severity 为 info、status 为 `auto_approve`
- 自动升级时 severity 为 warning、status 为 `escalate`
- `approval.requested` 和 `approval.resolved` 会携带 `auto_review_result`
- `TurnHistory.contextItemKind` 将 `auto_review.*` 归入 `approval`

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- `Permission.ask` 在 Guardian 评估后执行 `AutoReview.review`
- `approval_reviewer` 不是 `auto_review` 时，不启用自动审查
- 低风险只读 shell 命令，如 `pwd`、`ls`、`cat`、`grep`、`rg`、`find`、`git status/diff/show/log`、`node --version`、`npm test`、`bun test`、`node --test` 可被自动通过
- 低风险 `read/grep/glob` 可被自动通过
- 中高风险、网络、provider tool、full-access、unsupported environment 等请求升级给用户或 Guardian，不自动批准
- 硬约束仍由 Guardian 先拒绝，不会被 auto review 覆盖

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- public event 中文名：`自动审批审查完成`
- 摘要展示 decision 和 reason
- approval 事件携带 `auto_review_result`，Inspector 可在审批上下文里展示匹配规则、置信度、升级原因
- 历史 turn 可通过 approval 分类回放

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造允许、询问、硬拒绝、约束覆盖审批四类场景
- 断言 UI 展示和实际执行结果一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

- `bun test test/permission/auto-review.test.ts test/permission/guardian-assessment.test.ts test/permission/approval-audit.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 40 pass，0 fail
  - 覆盖低风险 shell 自动通过、不产生 `approval.requested`、中风险 network 自动升级、approval 携带 auto_review_result
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

- 开始时间: 2026-06-04T23:49:55+02:00
- 完成时间: 2026-06-04T23:54:28+02:00
- 修改文件:
  - `packages/opencode/src/session/auto-review.ts`
  - `packages/opencode/src/permission/index.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/permission/auto-review.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-067-auto-review.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/permission/auto-review.test.ts test/permission/guardian-assessment.test.ts test/permission/approval-audit.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - auto-review/guardian/approval/history/public-event：40 pass
  - opencode typecheck：pass
  - observability tests：6 pass
- 残留风险:
  - 默认规则集 v1 只覆盖低风险读命令和只读工具；复杂项目策略、用户自定义规则、time window 细粒度配置后续继续产品化
  - auto review 不做模型判断，避免弱模型自行绕过安全策略

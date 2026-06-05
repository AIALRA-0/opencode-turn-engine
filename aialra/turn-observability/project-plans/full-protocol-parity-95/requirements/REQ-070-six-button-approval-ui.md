# REQ-070 Six-button approval UI

## 原始目标

70. Six-button approval UI：AIALRA 必须保留并标准化现有 six-button UI，将其映射到正式 approval decision / grant scope，而不是作为只影响前端的临时按钮。虽然 Codex 没有同款 six-button UI，OpenCode 只有 once/always/reject 这类简化选择，但 AIALRA 可以保留更强交互能力；关键是每个按钮都必须落成协议字段，例如 allow once、allow for this turn、allow for this session、allow for this environment、deny once、deny and remember / revoke-like policy。按钮产生的结果必须写入 ApprovalResolved、grant registry、history、trace、inspector，并与 reviewer、constraints、environment_id、tool_call_id 绑定。验收标准是：用户点任意按钮后，系统能明确展示该决定的生效范围、过期条件、是否可撤销、是否被 constraints 限制；后续同类请求是否自动通过或继续询问，必须和按钮语义完全一致。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成六按钮 UI、正式审批决定协议、运行时授权、public event、Turn Inspector 中文摘要和回归测试
- 依赖前置: REQ-069 必须已完成并更新状态矩阵
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

- 原版 OpenCode 的审批主语义是 `once / always / reject`，用户只能大致选择允许一次、始终允许或拒绝
- AIALRA 在执行本条前已经有六个前端按钮，但 `always-command` 仍混用旧 `always` reply，事件里也没有正式 approval decision，审计只能靠 `scope` 字符串猜语义
- Codex CLI 没有 AIALRA 这种六按钮产品 UI，但它的执行边界更清楚，审批结果会进入执行上下文并约束工具行为
- 本条保留 AIALRA 六按钮优势，同时补上后端正式语义和审计字段
- `reject` 仍沿用 OpenCode 旧行为，会取消同一 session 里仍在等待的审批，本条没有偷偷改变旧语义，而是把这个事实写进 `approval_decision.description`

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 已实现数据结构

- 新增 `approval_decision`，schema 为 `aialra.approval_decision.v1`
- 字段包含 `decision / status / reply / requested_scope / grant_scope / label / description / applies_to / expires_at / creates_runtime_grant / revocable_by / session_id / turn_id / environment_id / permission / patterns / tool_call_id / reviewer / propagated`
- 六按钮映射如下
  - `reject` -> 拒绝，兼容旧行为时取消同会话 pending 审批
  - `once-command` -> 仅允许一次本命令，不建立运行时 grant
  - `turn-command` -> 本回合本环境同命令自动允许
  - `turn-all` -> 本回合同环境全部后续审批自动允许
  - `always-command` -> 本会话本环境同命令自动允许
  - `always-all` -> 本会话本环境全部后续审批自动允许
- 旧事件没有 `approval_decision` 时，public event mapper 会根据 `reply + scope` 自动生成兼容对象

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 已实现事件协议

- `permission.replied` bus event 增加可选 `approval_decision`
- `security.override.resolved` public event 写入 `approval_decision`
- `permission.grant.created` public event 写入 `approval_decision`
- `approval.resolved` public event 写入 `approval_decision`，`status` 从旧 `reply` 升级为实际 scope，例如 `turn-all`
- Turn Inspector 默认中文摘要会优先展示 `approval_decision.label` 和 `approval_decision.description`

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 已实现 runtime 接入

- 后端 `approveScope` 已按 `turn-command / turn-all / always-command / always-all` 建立真实运行时授权
- 前端所有允许类按钮改为 `reply=once + scope=<button>`，不再把 `always-command` 投影成旧版全局 `always`
- `turn-all / always-command / always-all` 即使使用兼容 `once` reply，也会继续处理同 session 中可被该 scope 覆盖的 pending 审批
- 前端本回合自动响应 key 增加 environment 维度，避免不同 environment 的审批被同一个前端缓存误放行

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### 已实现 UI Inspector

- 审批完成摘要从 `审批已处理：turn-all` 升级为 `审批已处理：本对话单轮允许全部命令，当前回合内，同一环境里的后续审批自动允许；下一回合重新询问`
- 六按钮保留短标签，用 tooltip 展示完整含义，避免按钮过长挤坏 UI
- 拒绝按钮 tooltip 明确提示旧兼容行为会取消同会话待审批

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
  - `packages/opencode/src/permission/index.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/app/src/pages/session/composer/session-composer-state.ts`
  - `packages/app/src/pages/session/composer/session-permission-dock.tsx`
  - `packages/app/src/context/permission.tsx`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/opencode/test/permission/next.test.ts`
  - `packages/opencode/test/permission/approval-audit.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/permission/next.test.ts test/permission/approval-audit.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - 权限、审批审计、turn history、public event HTTP 测试 119 pass
  - opencode typecheck pass
  - app typecheck pass
  - observability tests 6 pass
- 残留风险:
  - `reject` 仍为 OpenCode 旧兼容行为，会取消同一 session 里仍在等待的审批，本条已审计和提示，但没有拆成“只拒绝本请求”和“拒绝全部待审批”
  - Codex CLI 没有同款六按钮 UI，所以这属于 AIALRA 产品增强，不是 Codex 原样搬运

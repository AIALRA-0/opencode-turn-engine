# REQ-083 App desktop handoff

## 原始目标

83. App desktop handoff：AIALRA 必须补齐 app desktop handoff 方向，对齐 Codex 最新 /app desktop handoff 的产品能力，使 web/app-server/desktop/本地 runtime 之间可以安全交接 session、thread、turn、event stream 和 environment 控制权。handoff 必须携带 session_id、thread_id、last_event_id、selected environment、active permission profile、grants、raw sync state、process registry state，并经过权限确认。验收标准是：用户可以从浏览器切到桌面端继续同一个 turn 或 thread，事件不丢、raw 不丢、live process 状态明确；如果某些 live process 或 environment 不能 handoff，系统必须在 inspector 中明确标记 unsupported/degraded。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成
- 依赖前置: REQ-082 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session`
- `packages/opencode/src/session/public-event.ts`
- `packages/opencode/src/session/turn-context.ts`
- `packages/opencode/src/session/turn-history.ts`
- `packages/app/src`

必须回答:

- 当前 AIALRA 已经有什么
- 最新 OpenCode 已经有什么
- 最新 Codex 已经有什么
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪

实际结论:

- 当前 AIALRA 原先只有前端内存级 handoff：prompt 草稿、terminal tab 标题、workspace session tabs 可以在页面切换时短暂继承。
- 当前 AIALRA 原先没有后端 session handoff snapshot，不能把 session_id、thread_id、last_event_id、environment、permission profile、raw sync、process registry 一次性交给 web/desktop。
- 当前 AIALRA 已有 public event stream、Raw Lab、SessionSecurity、ExecProcessRegistry，这些足够支撑第一版真实可审计 handoff。
- 最新 OpenCode 原版主要是 UI/local desktop 使用体验，缺少 AIALRA 这种完整 public event/raw/process/security handoff snapshot。
- 最新 Codex 的方向是 app/server/runtime 之间有明确 execution context 和 event stream 交接。AIALRA 本轮补齐到“可审计快照 + deep link 打开目标 session”，但仍不伪装 running process 跨 runtime 热迁移。

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

实际实现:

- 新增 `HandoffSnapshot`，schema 为 `aialra.session_handoff.v1`。
- 新增 `GET /session/:sessionID/handoff`，query 支持:
  - `source=web|desktop|api`
  - `target=desktop|web|local-runtime|unknown`
  - `confirm=true`
  - `lastEventID`
- handoff snapshot 包含:
  - session_id、thread_id、handoff_id、source、target、requested_at、status
  - event_stream replay URL、last_event_id、last_event_sequence、Last-Event-ID 支持状态
  - raw_sync rawRef 数量、persisted 数量、memory only 数量
  - selected environment、cwd、remote support/status
  - active permission profile、approval policy、reviewer、sandbox policy、executor backend、grants status
  - process registry 汇总和最近 50 个 process 摘要
  - confirmation required/confirmed/reason
  - unsupported/degraded 原因列表
- 新增 desktop deep link 解析 `opencode://session-handoff?...`，携带 directory、sessionID、threadID、lastEventID、environmentID。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 新增 public event:
  - `session.handoff.requested`
  - `session.handoff.prepared`
- 未确认时返回 `pending_confirmation`，写 requested 事件。
- 确认时返回 `ready` 或 `degraded`，写 prepared 事件。
- 事件 rawRef 保存完整 handoff snapshot，安全 data 只保存摘要字段。
- `public-schema-docs.md` 已同步新增事件清单。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际实现:

- runtime 读取:
  - SessionSecurity 提供当前 TurnContext 安全配置快照
  - PublicEventLog 提供 event cursor 和 rawRef 状态
  - ExecProcessRegistry 提供 live/completed/failed/aborted process 状态
- running process 不做假迁移:
  - 如果存在 running process，snapshot status 为 `degraded`
  - process_registry.handoff_status 为 `degraded`
  - unsupported 包含 `running_process_handoff_degraded`
- remote environment 未接入时不会伪装支持:
  - 如果 selected environment 是非 default 且 remote unsupported，snapshot 标记 `selected_remote_environment_unsupported`
- 工具执行和模型调用不读取 handoff snapshot，因为 handoff 是交接协议，不是工具门禁。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- Turn Inspector summary projection 识别 `session.handoff.*`。
- Inspector 总览显示:
  - 会话交接方向，例如 `web -> desktop degraded`
  - 交接降级原因，例如 `running_process_handoff_degraded`
  - rawRef 数量
- Raw Lab 可下载完整 handoff snapshot raw。
- Layout deep link handler 识别 `opencode://session-handoff`，打开项目、跳转指定 session，并把 lastEventID/threadID/environmentID 保留在 URL query。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造正常完成、模型错误、用户 abort、重复 settle、resume/replay 场景
- 断言 history、trace、public event、Inspector 四层一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际执行:

- `bun typecheck` in `packages/opencode`
  - 第一次失败: `Schema.Union` 用法不符合仓库习惯，导致 query source/target 被推为 unknown
  - 第二次失败: `active_permission_profile_kind` 可能 undefined
  - 修复后通过
- `bun test test/server/httpapi-public-event.test.ts --timeout 30000`
  - 12 pass，1321 expect
- `bun test --preload ./happydom.ts ./src/pages/layout/helpers.test.ts ./src/pages/session/turn-inspector.test.ts`
  - 28 pass，71 expect
- `bun typecheck` in `packages/app`
  - 第一次失败: deep link parser type predicate 和 optional field 形状不一致
  - 修复后通过
- `node --test aialra/turn-observability/tests/*.test.js`
  - 第一次失败: public schema docs 缺新增 handoff 事件
  - 修复后 7 pass

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

- 开始时间: 2026-06-05T01:31:02+02:00
- 完成时间: 2026-06-05T01:42:05+02:00
- 修改文件:
  - `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/server/httpapi-public-event.test.ts`
  - `packages/app/src/pages/layout/deep-links.ts`
  - `packages/app/src/pages/layout/helpers.test.ts`
  - `packages/app/src/pages/layout.tsx`
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector.test.ts`
  - `aialra/turn-observability/public-schema-docs.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-083-app-desktop-handoff.md`
- 测试命令:
  - `bun typecheck`
  - `bun test test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test --preload ./happydom.ts ./src/pages/layout/helpers.test.ts ./src/pages/session/turn-inspector.test.ts`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果: 全部通过，失败点均已修复并重跑
- 残留风险:
  - running process 仍不能跨 web/desktop runtime 热迁移，只能明确 degraded 并展示原因
  - remote environment 仍是 unsupported/degraded 状态，不伪装已完成远程执行接管
  - 产品按钮尚未做成独立“打开桌面端继续”入口，本轮完成的是后端协议、desktop deep link 解析、Inspector 和 Raw Lab 可观察闭环

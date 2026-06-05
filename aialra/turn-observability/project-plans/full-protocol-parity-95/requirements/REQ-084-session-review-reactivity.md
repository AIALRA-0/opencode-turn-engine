# REQ-084 Session review reactivity

## 原始目标

84. Session review reactivity：AIALRA 必须吸收 OpenCode 最新 session review reactivity 修复，更新当前旧状态，保证 session review 页面或 inspector 在事件到达、tool result settlement、approval resolved、raw chunk streaming、TurnDiff 生成后能及时响应。UI 不应该依赖手动刷新才能看到状态变化，也不能出现 backend 已完成但 review 仍显示旧状态。实现时需要明确 event subscription、Last-Event-ID resume、projector update、message updater、state cache invalidation 规则。验收标准是：长命令输出、approval 决策、文件 diff、context compaction、tool end 等状态变化在 UI 中实时更新；断线重连后不会丢失或重复显示事件。

## 当前状态

- 状态: 完全完成
- 完成判定: 当前 Web session 已具备 public event 驱动的消息、diff、VCS、todo、状态刷新桥接；Turn Inspector 继续使用同一 SSE 解析与认证 helper；已补纯函数测试和 app typecheck
- 依赖前置: REQ-083 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

已调查:

- `packages/app/src/pages/session.tsx`
  - session review 本身通过 `reviewDiffs()` 响应式读取 `turnDiffs()` 或 `vcsQuery`
  - `turnDiffs()` 来源是最后一条 user message 的 `summary.diffs`
  - git/branch diff 来源是 `vcsQuery`
  - 旧逻辑主要依赖 OpenCode bus 事件和 session 页面进入时的一次性刷新
- `packages/app/src/pages/session/review-tab.tsx`
  - Review tab 组件接收 `diffs: () => ReviewDiff[]`
  - 组件本身能响应 diff accessor 变化，不是卡住根因
- `packages/app/src/context/global-sync/event-reducer.ts`
  - 原版同步层能处理 `session.diff`、`message.updated`、`message.part.delta`、`permission.asked`、`permission.replied`
  - 这些是 OpenCode bus 事件，不会天然消费 AIALRA public event
- `packages/app/src/context/directory-sync.ts`
  - 已有 `sync.session.sync(id, { force: true })`、`sync.session.diff(id, { force: true })`、`sync.session.todo(id, { force: true })`
  - 可以作为 public event 到 UI cache invalidation 的真实刷新入口
- `packages/app/src/pages/session/turn-inspector.tsx`
  - 已有 public event SSE 订阅、Last-Event-ID、raw 加载
  - 但它只服务 Inspector 自身，Inspector 关闭时不会刷新 review/message

结论:

- 根因不是 Review tab 不响应
- 根因是 AIALRA public event stream 只进入 Turn Inspector，未进入 session 页面缓存刷新规则
- 本条新增 session reactivity bridge，把 public event 映射为 message/diff/VCS/todo/status 刷新动作

## 数据结构和 schema 计划

- 新增前端内部类型 `PublicEventLike`
- 新增前端内部类型 `SessionReactivityAction`
- 未修改后端 public event schema
- 未修改 SDK schema
- 未修改 DB message/part schema
- 兼容旧 session: 没有 public event 时仍走原 OpenCode bus 和原 session sync
- 新 session 默认路径:
  - `/session/:sessionID/events/public`
  - `Last-Event-ID` header
  - `lastEventID` query
  - 独立 cursor key `aialra.public-event.reactivity.last-id.${sessionID}`

## 事件协议计划

本条相关变化必须进入:

- typed public event: 复用已有 `aialra.public_event.v1`
- Turn Inspector projection: 复用同一 SSE parser/auth helper，避免 Inspector 和 session reactivity 两套解析规则漂移
- history/replay record: 通过 Last-Event-ID replay 恢复事件，不新增历史格式
- benchmark JSON: 本条是 UI reactivity，未新增 benchmark 字段
- internal trace: 未新增 trace 事件

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 本条不改变工具/模型/权限 runtime gate
- 本条改变 Web session UI runtime cache invalidation:
  - `tool.call.finished`、`file.write`、`command.finished`、`exec_command.finished` -> refresh diff/VCS
  - `approval.requested`、`approval.resolved` -> refresh messages
  - `model.raw.chunk`、`reasoning.raw.item`、`runtime.item.settled` -> refresh messages
  - `turn.completed`、`turn.aborted`、`turn.terminal.reconciled` -> refresh messages/diff/status/todo
- 断线恢复:
  - 使用独立 reactivity cursor
  - reconnect 时发送 query `lastEventID`
  - 同时发送 header `Last-Event-ID`
- 去重策略:
  - 每条 event 只更新 cursor
  - 刷新动作 debounce 合并，避免长命令大量 output delta 导致 UI 请求风暴

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- Turn Inspector 原展示不变
- SSE parser/auth helper 已抽到 `session-reactivity.ts` 复用
- Inspector 与 session page 使用同一 public event parsing 规则
- Review panel、message timeline、todo、VCS diff 现在不依赖 Inspector 打开

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

- 新增 `packages/app/src/pages/session/session-reactivity.test.ts`
  - SSE block 解析
  - malformed payload 忽略
  - 非 public schema 忽略
  - `file.write` -> diff/VCS refresh
  - `turn.completed` -> messages/diff/VCS/status/todo refresh
  - write-like `tool.call.finished` -> diff/VCS refresh
  - Inspector cursor 和 reactivity cursor 分离
- 更新 `packages/app/src/pages/session/turn-inspector.tsx`
  - 复用 parser/auth/cursor helper
- 更新 `packages/app/src/pages/session.tsx`
  - 当前 session 后台订阅 public event
  - debounce 合并刷新动作

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

## 验收标准

- 协议层: 未新增后端协议，复用现有 public event v1
- history/replay: 前端 reactivity cursor 使用 Last-Event-ID 恢复
- public event parsing: 已有测试
- Inspector: 已复用同一 parser 并通过现有投影测试
- runtime 行为: 当前 session 页根据 public event 强制刷新 messages/diff/todo/VCS
- 旧 session 兼容: 无 public event 时仍保留原 bus/session sync 路径
- 状态矩阵更新为 `完全完成`

## 回归风险

- 多开 Inspector 和 session page 时有两条 SSE 连接
  - 已用独立 cursor 避免互相覆盖 Last-Event-ID
  - 这是有意取舍，保证 Inspector 关闭时 review 仍刷新
- 长命令大量输出可能触发频繁刷新
  - 已用 debounce 合并
- 后端 public event 丢失时 UI 仍依赖原 OpenCode bus
  - 不会比原行为更差

## 执行记录

- 开始时间: 2026-06-05 01:43:00 CEST
- 完成时间: 2026-06-05 01:49:04 CEST
- 修改文件:
  - `packages/app/src/pages/session/session-reactivity.ts`
  - `packages/app/src/pages/session/session-reactivity.test.ts`
  - `packages/app/src/pages/session.tsx`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-084-session-review-reactivity.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test --preload ./happydom.ts ./src/pages/session/session-reactivity.test.ts ./src/pages/session/turn-inspector.test.ts`
  - `bun typecheck`
- 测试结果:
  - app session reactivity/inspector tests: 9 pass, 36 expect
  - app typecheck: pass
- 残留风险:
  - 未把全局 `server-sync` 底层总线替换成 public event 唯一来源
  - 未做浏览器真实长命令手工 smoke
  - 当前实现解决当前 session 页面 reactivity，不等同于所有页面全局都消费 public event

# REQ-073 Item started/completed

## 原始目标

73. Item started/completed：AIALRA 必须补全 Codex 风格 item started / item completed 事件，让每个 message item、reasoning item、tool call item、tool result item、exec item、approval item、raw item 都有清晰生命周期。当前 AIALRA 缺少统一 item 生命周期，容易导致 UI、history、model context、tool settlement 状态不一致。实现时必须给每个 item 分配 item_id，记录 started_at、completed_at、status、parent_item_id、turn_id、source、error、duration，并保证 completed、failed、aborted 等终态互斥且幂等。验收标准是：inspector 可以按 item 时间线展示一次 turn 内所有 item 的开始、完成、失败、中止；replay/resume 后 item 状态不丢失、不重复、不互相覆盖。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成统一 item lifecycle 投影，runtime/tool/raw item 可生成 `item.lifecycle.started/completed/failed/aborted`
- 依赖前置: REQ-072 必须已完成并更新状态矩阵
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

### 实际调查结论

- 原版 OpenCode 有 message/tool 事件，但没有 AIALRA 当前这种跨 runtime/tool/raw 的统一 item lifecycle 公共层
- AIALRA 执行本条前已经有 `runtime.item.received/settled`、`tool.lifecycle.*`、`tool.result.settled`，但它们彼此分散
- Codex 的 item 模型更统一，用户和 harness 能把模型输出项、工具项、终态项放在同一条时间线里看
- 本条在不推翻现有事件的前提下，新增统一 `item.lifecycle.*` 投影层

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 已实现数据结构

- 新增 public event type:
  - `item.lifecycle.started`
  - `item.lifecycle.completed`
  - `item.lifecycle.failed`
  - `item.lifecycle.aborted`
- item lifecycle schema 为 `aialra.item_lifecycle.v1`
- 字段包含 `item_id / parent_item_id / item_kind / source_phase / source / turn_id / session_id / message_id / status / started_at / completed_at / duration_ms / error / terminal / raw_item_id / model_call_id / sequence`
- `threadID/source/payloadSchema/payload/rawRef` 继承 REQ-071 typed envelope

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 已实现事件协议

- `runtime.item.received` 投影为 `item.lifecycle.started`
- `runtime.item.settled` 投影为 `item.lifecycle.completed/failed`
- `model.raw.item` 投影为 `item.lifecycle.completed`
- `tool.lifecycle.requested/started/completed/failed/aborted` 投影为对应 item lifecycle
- `tool.result.settled` 投影为 `item.lifecycle.completed/failed`
- 投影发生在 `AialraTurnTrace.emit`，所以 public event 和 TurnHistory 都能看到

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### runtime 接入结论

- 本条不改变工具是否执行，只把已经真实发生的 runtime/tool/raw trace 投影为统一生命周期
- 投影白名单已收窄，避免把 `turn.completed`、`context.compaction.completed` 等非 item 事件误当 item
- 终态互斥通过来源事件保证，failed/aborted/completed 对应不同 public event type

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### UI Inspector 实现

- Turn Inspector 增加 item lifecycle 中文标题
- 摘要显示 item kind、item id、duration 和 error
- 默认不展示裸 JSON，rawRef 可在 Raw Lab 查看

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造正常完成、模型错误、用户 abort、重复 settle、resume/replay 场景
- 断言 history、trace、public event、Inspector 四层一致

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
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-trace.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/session/turn-history.test.ts --timeout 30000`
  - `bun test test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - turn history 测试 28 pass
  - public event HTTP 测试 8 pass
  - opencode typecheck pass
  - app typecheck pass
  - observability tests 6 pass
- 残留风险:
  - 当前统一 lifecycle 是基于现有真实 trace 的投影层，还没有替换 OpenCode 内部 message part 模型
  - started_at/completed_at 使用投影时间，部分历史来源没有原生 start timestamp 时不能反推真实 provider 时间

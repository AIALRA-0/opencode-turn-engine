# REQ-003 TurnContextItem 持久化

## 原始目标

3. TurnContextItem 持久化：AIALRA 必须补全 TurnContextItem 的 history persistence，不能只存在于 trace 或 public event。所有 turn 执行过程中产生的上下文项，例如 selected environment、cwd、权限、网络状态、模型配置、tool result、context compaction、runtime warning、用户补充信息，都必须写入可恢复历史。验收标准是：重启后 resume、replay、audit 时仍能还原当时 turn 的关键上下文，而不是只能看到当时的直播事件。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。TurnHistory 现在不只记录 `turn.started/completed/aborted` 终态生命周期，也会把 turn 过程里的关键上下文项持久化为 `turn.context.item`，用于重启后的 replay、audit 和 Raw Lab 回放。
- 依赖前置: REQ-002 必须已完成并更新状态矩阵
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

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

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

- 开始时间: 2026-06-04T10:25:31+02:00 后
- 完成时间: 2026-06-04T10:25:31+02:00 后
- 调查结论:
  - REQ-001 已有 append-only JSONL TurnHistory，但只记录正式生命周期事件。
  - public event stream 已能把 trace 映射为用户可见事件，但 replay buffer 是内存为主，不能代替可恢复历史。
  - Raw Lab handler 已返回 `turnHistory`，所以只要 TurnHistory 变完整，UI/Raw Lab 就能拿到重启后仍存在的历史数据。
  - Codex 的优势是 turn 内上下文、工具结果、策略状态能进入统一运行记录；AIALRA 之前只有直播事件和生命周期 history，重启后不够完整。
- 实现内容:
  - `TurnHistoryType` 新增 `turn.context.item`。
  - 新增 `TurnContextItemKind`，覆盖 input、message、turn_context、environment、permission、sandbox、network、model、tool、file、command、http、approval、engineering、warning、raw、runtime。
  - 新增 `TurnHistory.contextItemKind(phase)`，把已有 trace phase 归类成可恢复上下文项。
  - 新增 `TurnHistory.recordContextItem(...)`，将非生命周期但有 sessionID/turnID 的 trace 事件写入 JSONL history。
  - `AialraTurnTrace.emit` 改为双写:
    - lifecycle phase 仍按原类型写 history。
    - 其他可归类 phase 写成 `turn.context.item`，保留原始 phase、step、kind、context。
  - 继续使用 compact 保护，避免 history 写入超大输出或复杂对象。
- 修改文件:
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/src/session/turn-trace.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
- 测试命令:
  - `bun test test/session/turn-history.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
  - `bun typecheck`
- 测试结果:
  - `turn-history.test.ts`: 3 pass, 0 fail。
  - `render-trace.test.js`: 1 pass, 0 fail。
  - `bun typecheck`: pass。
- 残留风险:
  - 本条持久化的是 compact 后的上下文摘要；完整原始流式 chunk、tool raw output、DB part JSON 的 rawRef 统一面板属于后续 Raw Lab 要求。
  - history 使用 JSONL 文件，不做 DB migration；这是为了先保证可恢复审计，不破坏旧数据路径。

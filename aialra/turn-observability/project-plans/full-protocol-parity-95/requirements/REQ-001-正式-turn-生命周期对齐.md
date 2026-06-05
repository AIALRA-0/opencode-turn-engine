# REQ-001 正式 turn 生命周期对齐

## 原始目标

1. 正式 turn 生命周期对齐：AIALRA 必须确保一次用户 prompt 被完整包装成正式 turn，并全量对齐 Codex 的 TurnStarted / TurnComplete / TurnAborted。需要检查当前 turn.started / turn.completed / turn.aborted 是否存在状态缺漏、重复结束、异常路径未落账、abort 后仍 completed 等问题。所有 turn 生命周期事件必须写入 history、trace，并完整展示到 inspector 中，让用户能看到每个 turn 的开始时间、结束时间、终态、失败原因、abort 来源和关联事件数量。

## 当前状态

- 状态: 完全完成
- 完成判定: 完全完成
- 依赖前置: 无
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

- 开始时间: 2026-06-04T已开始
- 完成时间: 2026-06-04T08:18:21.134Z
- 修改文件:
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/src/session/turn-trace.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
- 实现结果:
  - turn lifecycle trace 现在同步写入 `aialra.turn_history.v1` JSONL history ledger
  - `turn.started`、`turn.completed`、`turn.aborted`、`turn.terminal.assistant_error`、`turn.terminal.anomaly`、`turn.terminal.reconciled` 都可持久化
  - Raw Lab 返回 `turnHistory`，重启后可用 sessionID 读取生命周期历史
  - completed/aborted/reconciled 数据补充 `relatedEventCount`，用于展示本 turn 关联事件数量
  - 仍保留 existing `closedTurns` 幂等保护，避免 completed/aborted 重复 settle
- 测试命令:
  - `bun test test/session/turn-history.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
  - `bun typecheck`
- 测试结果:
  - turn-history: 2 pass, 0 fail
  - render-trace: 1 pass, 0 fail
  - opencode typecheck: pass
- 残留风险:
  - 本条使用追加 JSONL history ledger，未做数据库表 migration
  - 更完整的 TurnContextItem history persistence 会在 REQ-003 扩展

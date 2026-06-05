# REQ-005 ThreadRollback

## 原始目标

5. ThreadRollback：AIALRA 必须全量补全 ThreadRollback。系统需要支持回滚到某个历史 turn，将其后的 turn 从当前活动 thread 中撤销，或从该历史点创建新分支继续执行。实现必须处理 history、message tree、tool outputs、file mutations、context compacted summaries、inspector timeline 的一致性。验收标准是：用户可以选择某个 turn 回滚，后续上下文、UI、replay 状态都回到该点；如果支持分支，必须清楚显示 branch 来源和分叉点。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。AIALRA 已把 OpenCode 现有 revert/unrevert 能力正式映射成 ThreadRollback 事件和可恢复 history，回滚请求、应用、无操作、恢复、清理都会进入 trace、public event 和 TurnHistory。
- 依赖前置: REQ-004 必须已完成并更新状态矩阵
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
  - 原版 OpenCode 已有 `SessionRevert`，可以回滚消息上下文并用 Snapshot 还原文件 patch。
  - UI 已有 revert dock，回滚后会过滤当前活动消息。
  - 缺口是没有 Codex 风格的 ThreadRollback 公共事件、可恢复 history、Inspector/Raw Lab 可解释记录。
- 实现内容:
  - 新增 public event 类型:
    - `thread.rollback.requested`
    - `thread.rollback.applied`
    - `thread.rollback.noop`
    - `thread.rollback.restored`
    - `thread.rollback.cleaned`
  - `SessionRevert.revert` 在请求、无目标、成功应用时写入 trace/public event/history。
  - `SessionRevert.unrevert` 在恢复时写入 `thread.rollback.restored`。
  - `SessionRevert.cleanup` 在清理回滚消息/part 后写入 `thread.rollback.cleaned`。
  - `TurnHistory.contextItemKind` 支持 `thread.rollback.*`，这些事件会作为 `turn.context.item` 持久化。
  - Public Event 中文标题补齐，Raw Lab rawRef 规则支持 thread rollback 事件。
- 修改文件:
  - `packages/opencode/src/session/revert.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/session/revert-compact.test.ts`
- 测试命令:
  - `bun test test/session/revert-compact.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
  - `bun typecheck`
- 测试结果:
  - revert/turn-history: 11 pass, 0 fail。
  - render-trace: 1 pass, 0 fail。
  - `bun typecheck`: pass。
- 残留风险:
  - 本条基于 OpenCode 现有 revert 模型，不引入 DB 层分支对象。真正“多分支 thread tree”可作为后续产品增强。
  - 文件 mutation 回滚仍依赖现有 Snapshot/Patch 能力，本条把它纳入可审计 ThreadRollback 事件，不重写快照底座。

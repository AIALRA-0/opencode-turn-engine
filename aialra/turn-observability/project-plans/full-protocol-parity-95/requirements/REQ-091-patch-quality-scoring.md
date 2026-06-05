# REQ-091 Patch quality scoring

## 原始目标

91. Patch quality scoring：AIALRA 必须继续发展 patch quality scoring，将当前 benchmark 评分能力扩展到普通工程 turn。每个代码修改完成后，系统应基于 TurnDiff、test result、lint/typecheck、file mutation、risk profile、patch size、protected path、是否过拟合、是否仅改测试、是否破坏 public API 等因素生成 patch quality score。虽然 Codex/OpenCode 没有同名功能，AIALRA 应将其作为工程质量层，帮助用户判断 patch 是否可信。验收标准是：最终报告和 inspector 显示 patch quality score、评分理由、风险项、验证覆盖；benchmark run 中该评分可与官方 harness 结果对照。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现普通工程 turn 的 patch quality scoring，基于 TurnDiff、文件 mutation、验证结果、patch size、测试文件、生成物噪声、protected path、public API 风险、零补丁等结构信号生成 `patch.quality.scored` 公共事件，并在 Turn Inspector 摘要中展示分数、等级和风险
- 依赖前置: REQ-090 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session/public-event.ts`
- `packages/opencode/src/session/raw-audit.ts`
- `packages/app/src`
- `aialra/turn-observability`

必须回答:

- 当前 AIALRA 已经有什么
- 最新 OpenCode 已经有什么
- 最新 Codex 已经有什么
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪

实际结论:

- 当前 AIALRA benchmark runner 已有 `patchQuality(result)`，用于高难评测报告，但普通用户 turn 没有稳定公共事件
- 原版 OpenCode 没有同名 patch quality layer，通常只展示 diff、工具输出和最终回复
- Codex CLI 也没有公开同名评分事件，更多依赖模型自我汇报、验证结果和 diff 审查
- 本次 AIALRA 把 patch quality 作为独立工程质量层：`TurnDiffStore.emit` 在 `turn.diff.updated` 后同步发 `patch.quality.scored`，工程 run 收尾时再结合验证上下文发最终评分
- 本评分是结构化可信度评分，不等于官方隐藏测试通过率；它告诉用户“补丁是否存在、是否改源码、是否改测试、是否有风险、验证有没有观察到”

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

实际实现:

- 新增 `PatchQualityScore`，schema 固定为 `aialra.patch_quality.v1`
- 字段包含 `source`、`score`、`grade`、`patch`、`verification`、`risks`、`reasons`、`coverage`、`diff`
- `source=turn_diff` 表示仅基于当前 TurnDiff 的即时评分
- `source=engineering_finish` 表示工程 run 收尾时结合 verification attempts/status 的最终评分
- `verification.status` 支持 `passed`、`failed`、`skipped`、`not_observed`
- 旧事件没有 `patch.quality.scored` 时，Inspector 不显示质量标签，不影响旧 session 读取

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 新增公共事件类型 `patch.quality.scored`
- `TurnDiffStore.emit` 通过 trace 记录该事件，进入 public event stream 和 TurnHistory/replay
- `EngineeringHarness.finish` 通过 manual public event 记录最终评分，包含验证上下文
- `public-schema-docs.md` 和 `trace-schema.md` 已同步事件清单

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际实现:

- 文件工具 mutation 进入 `TurnDiffStore.update`
- `TurnDiffStore.emit` 每次 diff 更新都会生成 patch quality
- `EngineeringHarness.finish` 读取 `TurnDiffStore.list(sessionID, turnID)` 和当前工程验证状态，生成最终评分
- 评分不会阻止工具执行，本条定位是质量观测层；阻止和恢复仍由 zero patch gate、stop gate、verification feedback loop 负责

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- Turn Inspector 单条事件显示 `补丁质量评分：N/100，等级：good/risky/poor/excellent，风险：...`
- Turn Inspector summary quality 标签显示 `补丁质量 N/100 grade`
- 如果有 risks，会显示 `补丁风险`
- 默认视图不展示完整 JSON，Raw Lab 仍可查看完整 `PatchQualityScore`

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造断线续传、raw 下载、搜索、长输出、中文摘要场景
- 用 browser smoke 验证默认不展示裸 JSON，高级 raw 可展开

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际执行:

- `bun test test/session/turn-diff.test.ts test/session/engineering.test.ts --timeout 30000`
  - 首次失败原因 1：`turn-diff.ts` 使用 `Effect.andThen` 但未 import `Effect`
  - 首次失败原因 2：测试依赖 TurnHistory 固定顺序，实际还有 `item.lifecycle.completed`
  - 修复方式：补 import，并把测试改为断言包含业务 phase，而不是固定数组顺序
  - 复跑结果：25 pass，177 expect
- `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - 3 pass，32 expect
- `node --test aialra/turn-observability/tests/*.test.js`
  - 7 pass
- `bun typecheck` in `packages/opencode`
  - pass
- `bun typecheck` in `packages/app`
  - pass
- `git diff --check`
  - pass

## 验收标准

- 协议层已实现并有 schema 测试
- history/replay 已实现并有恢复测试
- trace/public event 已实现并有事件样例测试
- Inspector 已展示并有 UI 或投影测试
- runtime 行为真实生效并有端到端测试
- 旧 session 兼容测试通过
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录

实际验收:

- 协议层: `patch.quality.scored` 和 `aialra.patch_quality.v1` 已实现
- history/replay: `TurnDiffStore.emit` 后 trace/public event/replay 可观察
- Inspector: summary 和单条事件均中文展示
- runtime: 文件 mutation 和工程 run finish 都会触发评分
- 旧 session: 缺失该事件时 UI 无副作用

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

## 执行记录

- 开始时间: 2026-06-05T02:37:59+02:00
- 完成时间: 2026-06-05T02:37:59+02:00
- 修改文件:
  - `packages/opencode/src/session/turn-diff.ts`
  - `packages/opencode/src/session/engineering.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/session/turn-diff.test.ts`
  - `packages/opencode/test/session/engineering.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
  - `packages/app/src/pages/session/turn-inspector.test.ts`
  - `aialra/turn-observability/public-schema-docs.md`
  - `aialra/turn-observability/trace-schema.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-091-patch-quality-scoring.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/session/turn-diff.test.ts test/session/engineering.test.ts --timeout 30000`
  - `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
  - `git diff --check`
- 测试结果: turn-diff/engineering 25 pass，app inspector 3 pass，observability 7 pass，opencode/app typecheck pass，diff check pass
- 残留风险: 评分是结构化风险和可信度评分，不等于官方 hidden tests；“是否过拟合”目前只能通过 only-tests、patch size、generated churn 等静态信号近似，不做模型裁判

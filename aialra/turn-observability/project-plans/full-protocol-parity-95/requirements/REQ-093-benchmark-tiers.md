# REQ-093 Benchmark tiers

## 原始目标

93. Benchmark tiers：AIALRA 必须继续完善 benchmark tiers，把现有 benchmark 能力标准化为多层验证体系。不同任务应能选择 smoke、unit、integration、official harness、SWE-bench、full regression、performance、security 等验证 tier，并记录 requested tier、effective tier、运行命令、耗时、结果、失败原因、成本。虽然 Codex/OpenCode 没有同名 benchmark tier，但 AIALRA 需要用它支撑工程质量和 agent 对比评测。验收标准是：每个 EngineeringRun 可以明确选择验证层级；最终报告和 1:1 对照表能显示实际跑了哪个 tier、通过哪些、失败哪些、哪些因为资源或权限跳过。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成 EngineeringRun 评测层级协议、runtime 记录、public event、Turn Inspector 摘要和测试
- 依赖前置: REQ-092 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session/engineering.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/benchmark`
- `aialra/turn-observability/scripts`

必须回答:

- 当前 AIALRA 已经有什么
- 最新 OpenCode 已经有什么
- 最新 Codex 已经有什么
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪

实际结论:

- 当前 AIALRA 已有 `run-real-benchmark.mjs`，真实评测 runner，支持 `AIALRA_REAL_BENCH_TIER=smoke/regression-6/full-24`
- 当前 AIALRA 已有 V3 benchmark gate，能阻止在 16 项未完成前运行 regression-6/full-24
- 当前 AIALRA 的缺口是 EngineeringRun，工程回合本身不知道本轮选择了哪个验证层级，也没有把验证命令和 tier、耗时、输出成本统一进 public event
- 原版 OpenCode 没有 AIALRA 这种多层 benchmark tier 协议
- Codex CLI 有更成熟的任务执行和验证收敛，但没有直接等价的 AIALRA benchmark tier 公共事件协议
- 因此本条实现的是 AIALRA 质量评估层，用于支撑后续 smoke、regression-6、full-24 和真实对比报告

## 数据结构和 schema 计划

- 新增 `EngineeringBenchmarkTier`，评测层级:
  - `smoke`，冒烟验证
  - `unit`，单元验证
  - `integration`，集成或端到端验证
  - `official-harness`，官方验证器
  - `swe-bench`，SWE-Bench 题目验证
  - `full-regression`，完整回归
  - `performance`，性能验证
  - `security`，安全验证
  - `custom`，自定义验证
- 新增 `EngineeringBenchmarkTierRun`
- `EngineeringRunSnapshot.benchmark.schema` 为 `aialra.benchmark_tier.v1`
- `requestedTier` 表示用户提示词或任务描述要求的层级
- `effectiveTier` 表示运行过程中实际达到的最高层级
- 每个验证命令记录 `command/status/startedAt/finishedAt/durationMs/exit/outputChars/failureReason/cost`
- 旧 session 没有 benchmark 字段时 Inspector 只是不展示该层级，不影响读取

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

已实现事件:

- `engineering.benchmark.tier.selected`
- `engineering.benchmark.started`
- `engineering.benchmark.finished`

事件数据:

- 顶层包含 `requestedTier/effectiveTier/tier/command/status/reason`
- 完整详情放在 `benchmark` 和 `benchmarkRun`
- raw payload 保存命令和完整 benchmarkRun

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

已实现 runtime 行为:

- `EngineeringHarness.start` 在回合开始时根据 prompt 生成 requested/effective tier
- `beforeTool` 识别验证命令后启动 benchmark run
- `recordVerification` 结束验证时写入 passed/failed、耗时、输出字符数和失败原因
- `recordVerificationSkipIfNeeded` 在没有验证时写入 skipped benchmark run
- `publicState` 输出 benchmark 结构，benchmark JSON 可直接从 public event 或 EngineeringRun state 读取

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

已实现 Inspector 展示:

- 事件名中文化为“评测层级已选择/评测层级开始/评测层级结束”
- 单条事件摘要展示 requested -> effective、命令、状态、输出字符数和跳过原因
- Summary 面板展示“评测层级：requested：effective”“评测开始：tier”“评测通过/失败/跳过：tier”

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造验证失败后 repair、zero patch、stop gate、重复工具、benchmark 质量评分场景
- 断言 gate 触发后不能被 final 直接绕过

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试命令:

```bash
bun test test/session/engineering.test.ts --timeout 30000
bun typecheck
bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts
bun typecheck
node --test aialra/turn-observability/tests/*.test.js
git diff --check
```

实际测试结果:

- `packages/opencode` engineering 测试: 25 pass，180 expect
- `packages/opencode` typecheck: pass
- `packages/app` Turn Inspector 投影测试: 3 pass，36 expect
- `packages/app` typecheck: pass
- turn observability node tests: 7 pass
- `git diff --check`: pass

## 验收标准

- 协议层已实现并有 schema 测试: 是
- history/replay 已通过 public event replay 承载: 是
- trace/public event 已实现并有事件样例测试: 是
- Inspector 已展示并有投影测试: 是
- runtime 行为真实生效并有验证命令开始、失败、跳过测试: 是
- 旧 session 兼容: 无 benchmark 事件时不展示，不影响读取
- 状态矩阵更新为 `完全完成` 前，测试结果已记录

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

残留风险:

- 目前 cost 是 `output_chars_proxy`，输出字符数代理成本，不是 provider 真实 token 或美元账单
- 当前 tier 分类靠命令和 prompt 规则识别，不是官方 harness 的完整语义解析
- 外部 benchmark runner 已有 tier 环境变量，本条把 EngineeringRun 内部补齐，但没有重新跑大评测

## 执行记录

- 开始时间: 2026-06-05T00:46:27Z
- 完成时间: 2026-06-05T01:02:00Z
- 修改文件:
  - `packages/opencode/src/session/engineering.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/session/engineering.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
  - `packages/app/src/pages/session/turn-inspector.test.ts`
  - `aialra/turn-observability/public-schema-docs.md`
  - `aialra/turn-observability/trace-schema.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-093-benchmark-tiers.md`
- 测试命令:
  - `bun test test/session/engineering.test.ts --timeout 30000`
  - `bun typecheck`
  - `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果: 全部通过
- 残留风险: 真实计费成本和官方 harness 完整语义仍由后续 benchmark runner 继续补齐

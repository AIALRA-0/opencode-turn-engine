# REQ-087 Verification encouragement

## 原始目标

87. Verification encouragement：AIALRA 必须把 prompt 级 verification encouragement 升级为 runtime 级 verification loop，对齐 Codex prompt 强约束，并强化现有 EngineeringRun verification loop。模型不能只被“鼓励测试”，而必须在计划中声明验证路径，在执行后尽可能运行测试、lint、typecheck、benchmark、diff review 或最小可行验证。验证行为、失败原因、跳过原因都必须写入 turn final report、history、trace 和 inspector。验收标准是：每个工程修改类 turn 都会产生 VerificationPlan、VerificationRun、VerificationResult；如果没有运行测试，必须明确说明无法运行的具体原因，而不是简单说未测试。

## 当前状态

- 状态: 完全完成
- 完成判定: 完全完成
- 依赖前置: REQ-086 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行结论:

- AIALRA 已有 `EngineeringRun V3`、verification failure feedback、stop gate 和 zero patch gate 骨架，但缺少“验证计划生成”“验证命令开始”“没有验证时的具体跳过原因”这三个运行时证据。
- OpenCode 原版主要依赖模型自己决定是否测试，缺少每轮工程修改的验证计划、运行、跳过原因三件套。
- Codex 更强调工具执行后的验证和收口，本条把 AIALRA 的 prompt 级鼓励升级为 runtime 级事件和 Inspector 可见证据。

本条落地后:

- 工程修改类 turn 启动时会生成 `verificationPlan`。
- 识别到 `npm test`、`pytest`、`bun test`、`node --test`、`cargo test`、`go test`、`typecheck`、`build`、`lint`、健康检查等命令时，会生成 `verificationRun` started。
- 命令结束后记录 `verificationResult` passed/failed。
- 如果模型改了代码却准备结束且没有可识别验证命令，系统会注入一次继续提示，要求运行最小验证或写清楚具体跳过原因。
- 如果最终仍没有验证，finish 会生成 `engineering.verification.finished status=skipped`，并记录具体 skip reason。

## 数据结构和 schema 计划

- `EngineeringRunSnapshot.verification` 新增 `skipRequests/skipped/skipReason`。
- `EngineeringArtifacts` 新增 `verificationRuns`。
- `EngineeringVerificationResult` 新增 `skipped/skipReason`。
- `VerificationPlan` 继续复用 `EngineeringArtifactPlan`，但由 runtime 生成，不再只靠模型文字计划。
- 旧 session 没有这些字段时 Inspector 仍按缺省展示，不需要 DB migration。

## 事件协议计划

本条相关变化必须进入:

- public event 新增 `engineering.verification.planned`、`engineering.verification.started`。
- `engineering.verification.finished` 支持 `passed/failed/skipped` 三种状态。
- `engineering.verification.repair_requested` 现在也覆盖 final 前没有验证的继续提示。
- Turn Inspector 新增中文展示：验证计划、验证命令开始、验证跳过。
- EngineeringRun finished 事件里的 state 会包含 verification plan/run/result/skip reason，可被 benchmark JSON 读取。

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- `EngineeringHarness.start` 会为工程修改类任务生成验证计划。
- `EngineeringHarness.beforeTool` 在 bash/shell 命令被识别为验证命令时生成验证运行开始事件。
- `shell.ts` 命令结束后调用 `EngineeringHarness.recordVerification`，记录 exit/output/failure details。
- `prompt.ts` 在模型准备 final 前调用 `EngineeringHarness.verificationPrompt`，没有验证时注入继续提示。
- `EngineeringHarness.finish` 在仍无验证结果时生成 skipped verification result 和具体原因。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- `engineering.verification.planned` 显示“验证计划已生成”。
- `engineering.verification.started` 显示“验证命令开始”。
- `engineering.verification.finished status=skipped` 显示具体跳过原因，而不是裸 JSON 或“未测试”。
- Inspector summary 会把验证计划、验证开始、验证通过、验证失败反馈、验证跳过纳入质量摘要。

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

已执行:

- `bun test test/session/engineering.test.ts --timeout 30000`
  - 20 pass
  - 159 expect
- `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - 3 pass
  - 30 expect
- `bun typecheck` from `packages/opencode`
  - pass
- `bun typecheck` from `packages/app`
  - pass

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

## 验收标准

- 协议层已实现：`engineering.verification.planned/started/finished/skipped`。
- trace/public event 已实现：EngineeringHarness manual events 进入 PublicEventLog。
- Inspector 已展示：中文 labels、summary projection、skipped 文案。
- runtime 行为真实生效：start/beforeTool/recordVerification/finish/prompt final 前注入全部接入。
- 测试已覆盖 plan/run/result/skipped/final-before-verification。
- 不宣称已经能自动选择所有项目最佳验证命令；当前是运行时约束和证据闭环，项目级最佳测试选择后续可由 verifier planner 继续增强。

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
  - `packages/opencode/src/session/engineering.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/session/engineering.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
- 测试命令:
  - `bun test test/session/engineering.test.ts --timeout 30000`
  - `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
- 测试结果: 全部通过
- 残留风险: 当前能强制留下验证计划、运行、失败、跳过证据；但“自动选择最优验证命令”仍依赖模型和项目上下文，不在本条伪装成完全解决

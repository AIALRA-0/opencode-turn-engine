# REQ-088 Zero patch gate

## 原始目标

88. Zero patch gate：AIALRA 必须保留并标准化 zero patch gate，防止 agent 声称完成工程任务但没有产生任何有效代码或文件修改。虽然 Codex/OpenCode 没有同名机制，AIALRA 的 zero patch gate 应作为工程质量保护层继续存在，并与 TurnDiff、file mutation store、tool result settlement、final report 联动。当任务要求实现/修复/修改代码而 TurnDiff 为空时，系统必须阻止成功完成或要求模型解释并重新执行。验收标准是：工程任务没有 patch 时不能被标记为 completed；inspector 和最终报告必须显示 zero patch gate 是否触发、为什么触发、模型如何补救。

## 当前状态

- 状态: 完全完成
- 完成判定: 完全完成
- 依赖前置: REQ-087 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行结论:

- AIALRA 已有 zero patch recovery 基础能力：工程任务 final 前会用写工具调用和 `git status --porcelain` 判断是否真的产生工作区改动，未产生时注入 synthetic continuation 要求继续修改或说明 blocked。
- TurnDiffStore 已能在零补丁 turn finalize 时产生 `turn.diff.updated`，summary 为 files=0/mutations=0，用于 replay 和 benchmark。
- benchmark 已有 patchQuality 统计，包含 zeroPatch。
- 缺口是恢复成功没有正向事件，恢复耗尽后的工程运行状态容易被误读成普通 completed。

本条落地后:

- 新增 `engineering.zero_patch.recovered`，用户能看到“检测到 -> 请求恢复 -> 已恢复”。
- `EngineeringRunSnapshot.patch` 新增 `zeroPatchRecovered` 和 `lastWorkspaceChanged`。
- zero patch exhausted 后，`engineering.run.finished` 的 status 为 `blocked`，不再让工程状态看起来是普通成功。
- Turn Inspector 和 summary projection 都能显示“零补丁已恢复”。

## 数据结构和 schema 计划

- `EngineeringRunSnapshot.patch.zeroPatchRecovered`: 之前触发过恢复，后来检测到工作区实际有改动。
- `EngineeringRunSnapshot.patch.lastWorkspaceChanged`: 最近一次 git workspace 检查结果。
- 新增 public event `engineering.zero_patch.recovered`。
- 旧 session 没有这两个字段时 Inspector 不崩溃；新 session 默认 false/undefined。

## 事件协议计划

本条相关变化必须进入:

- 继续保留 `engineering.zero_patch.detected`、`engineering.zero_patch.recovery_requested`、`engineering.zero_patch.exhausted`。
- 新增 `engineering.zero_patch.recovered`。
- `engineering.run.finished status=blocked` 表示 zero patch recovery exhausted 后的工程阻塞收口。
- `turn.diff.updated` 已作为 TurnDiff/benchmark/replay 的文件改动证据。
- `public-schema-docs.md` 和 `trace-schema.md` 已同步新增事件。

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- `prompt.ts` final 前会调用 `workspaceHasGitChange(turn)`。
- `EngineeringHarness.zeroPatchPrompt` 会读取 `workspaceChanged`。
- `workspaceChanged=false` 时继续触发 recovery。
- `workspaceChanged=true` 且之前触发过 recovery 时记录 recovered。
- recovery 用完后进入 blocked，final 仍会被终态校准器标记为 zero patch anomaly。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- `engineering.zero_patch.detected`: 模型准备结束但没有有效改动。
- `engineering.zero_patch.recovery_requested`: 系统要求继续修改或明确阻塞。
- `engineering.zero_patch.recovered`: 之后检测到工作区改动，零补丁已恢复。
- `engineering.zero_patch.exhausted`: 恢复次数用完，本轮工程运行 blocked。

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

已执行:

- `bun test test/session/engineering.test.ts --timeout 30000`
  - 20 pass
  - 163 expect
- `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - 3 pass
  - 30 expect
- `node --test aialra/turn-observability/tests/*.test.js`
  - 7 pass
- `bun typecheck` from `packages/opencode`
  - pass
- `bun typecheck` from `packages/app`
  - pass

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

## 验收标准

- 协议层已实现：新增 `engineering.zero_patch.recovered`。
- runtime 行为真实生效：`workspaceChanged=true` 会记录 recovered，`workspaceChanged=false` 继续 recovery，recovery exhausted 会让 engineering run status 变为 blocked。
- Inspector 已展示：中文 label 和 summary 都已补。
- benchmark 已有 zeroPatch 统计，后续 REQ-091 会继续扩展普通 turn patch quality score。
- TurnDiff zero patch replay 已有 `turn-diff.test.ts` 覆盖，本条未重复改动。

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
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/session/engineering.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
  - `aialra/turn-observability/trace-schema.md`
  - `aialra/turn-observability/public-schema-docs.md`
- 测试命令:
  - `bun test test/session/engineering.test.ts --timeout 30000`
  - `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
- 测试结果: 全部通过
- 残留风险: zero patch gate 依赖 git workspace 检查和 file mutation store；对非 git 工作区或生成物清理型任务，仍需要后续 patch quality scoring 提供更细判断

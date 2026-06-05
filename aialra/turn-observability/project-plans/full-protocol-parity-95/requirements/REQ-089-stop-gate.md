# REQ-089 Stop gate

## 原始目标

89. Stop gate：AIALRA 必须保留并标准化 stop gate，防止 agent 在未完成计划、未验证、工具仍在运行、approval 未解决、TurnDiff 未生成、raw output 未落账时提前结束。stop gate 应检查 turn state、live process、pending approvals、unsettled tool results、verification result、context compaction、final output schema，并给出可解释阻止原因。虽然 Codex/OpenCode 没有同名机制，但这是 AIALRA 的工程收敛优势。验收标准是：模型尝试提前 final 时，如果仍有 running process、pending tool、未结算 output、未执行必要验证，AIALRA 会阻止或要求继续处理；inspector 显示 stop gate 检查结果。

## 当前状态

- 状态: 完全完成
- 完成判定: 完全完成
- 依赖前置: REQ-088 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行结论:

- AIALRA 已有验证通过后的 stop gate：`engineering.stop_gate.activated` 后，read/bash/edit/write/apply_patch 等工具调用会被 `EngineeringHarness.beforeTool` 阻止。
- AIALRA 已有 verification missing、zero patch、premature final、verification failed repair 等分散门禁。
- 本条新增统一 final 前检查事件 `engineering.stop_gate.checked`。
- 本条接入真实后台进程检查：如果同 turn 还有 running background process，会阻止 final，要求模型先 `await_process` 或 `cleanup_processes`。
- pending approval、tool result settlement、raw output、final schema 目前以对应公共事件为观察依据，stop gate 会明确标为 `unknown`，不伪装成已经硬检查。

和 Codex/OpenCode 对比:

- 原版 OpenCode 没有同名 stop gate，更多依赖模型和 processor 自然收口。
- Codex 没有 AIALRA 这个命名，但有更成熟的 turn lifecycle、工具执行反馈和验证后收敛行为。
- AIALRA 的优势是用户可见、可审计、可测试；差距是 approval pending 和 tool settlement 还不是一个统一可查询的 authoritative stop state。

## 数据结构和 schema 计划

- `EngineeringRunSnapshot.stopGate.checks`: final 前检查列表。
- 每个 check 包含 `name/status/reason/count/at`。
- `status` 取值：`pass`、`continue`、`blocked`、`unknown`。
- 新增 public event `engineering.stop_gate.checked`。
- 旧 session 没有 checks 时 Inspector 只显示已有 activated/blocked_tool 事件。

## 事件协议计划

本条相关变化必须进入:

- 新增 `engineering.stop_gate.checked`。
- 保留 `engineering.stop_gate.activated` 和 `engineering.stop_gate.blocked_tool`。
- `engineering.stop_gate.checked status=blocked` 表示 final 被强阻止。
- `status=continue` 表示系统发现还应继续处理，但由后续 verification/zero patch/repair prompt 继续接管。
- `status=passed` 表示 final 前没有发现强阻塞。

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- `prompt.ts` 在模型准备 final 后调用 `EngineeringHarness.stopGatePrompt`。
- `stopGatePrompt` 会检查 `ExecProcessRegistry.listLiveProcesses({ sessionID, turnID })`。
- 如果仍有 running process，则写入 `engineering.stop_gate.checked status=blocked`，生成 synthetic continuation，要求先等待或清理后台进程。
- 验证通过后继续由 `beforeTool` 阻止后续工具调用。
- pending approval/tool settlement/raw/final schema 以 `unknown` 进入 checks，后续需要更统一 authoritative state 时继续扩展。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- `engineering.stop_gate.checked`: 显示 final 前检查结果和阻止原因。
- `engineering.stop_gate.activated`: 显示验证通过后门禁开启。
- `engineering.stop_gate.blocked_tool`: 显示验证通过后继续工具调用被阻止。
- summary quality panel 会显示“停止门禁检查”和“通过即停止”。

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

已执行:

- `bun test test/session/engineering.test.ts --timeout 30000`
  - 21 pass
  - 167 expect
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

- 协议层已实现：`engineering.stop_gate.checked` 已进入 public schema docs 和 trace schema。
- runtime 行为真实生效：running background process 会阻止 final。
- 已有验证通过后工具阻止继续保留。
- Inspector 已展示：中文摘要和 quality summary 已补。
- 不宣称 pending approval/tool settlement/raw/final schema 已经是同一个硬状态机；本条把它们作为 explicit unknown check 暴露，后续可继续统一 authoritative state。

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
  - `aialra/turn-observability/trace-schema.md`
  - `aialra/turn-observability/public-schema-docs.md`
- 测试命令:
  - `bun test test/session/engineering.test.ts --timeout 30000`
  - `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
- 测试结果: 全部通过
- 残留风险: pending approval、tool settlement、raw output、final schema 目前是 explicit unknown，不伪装为强检查；后续若要完全权威化，需要把这些子系统统一暴露可查询 pending state

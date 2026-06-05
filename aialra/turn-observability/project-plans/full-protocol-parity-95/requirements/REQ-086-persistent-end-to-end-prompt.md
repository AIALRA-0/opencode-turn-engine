# REQ-086 Persistent end-to-end prompt

## 原始目标

86. Persistent end-to-end prompt：AIALRA 必须维护持久端到端 agent prompt，对齐 Codex system prompt 的全局约束能力，同时保留 AIALRA 的模型 prompt + EngineeringRun 设计，并兼容 OpenCode 各模型 prompt。该 prompt 必须覆盖工程执行原则、工具使用规则、验证要求、安全约束、上下文反查、计划先行、失败处理、最终报告格式，并且能按 model/provider/skill/turn override 组合生成。验收标准是：每次 EngineeringRun 或普通 turn 都能记录实际使用的 effective prompt version、组成来源、hash、model-specific diff，并在 inspector/Raw Lab 中可查看或审计；prompt 更新不会静默改变历史 run 的可复现性。

## 当前状态

- 状态: 完全完成
- 完成判定: 每次 LLM 请求前生成 effective prompt manifest，记录版本、来源、hash、模型差异、system/message/tool/params hash，并通过 `prompt.effective.resolved` public event + rawRef 进入 Turn Inspector/Raw Lab/turn history
- 依赖前置: REQ-085 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

已调查:

- `packages/opencode/src/session/prompt.ts`
  - 入口处已有 `prompt.received` / `turn.input.received`
  - 该层还拿不到最终 provider request prompt
- `packages/opencode/src/session/llm/request.ts`
  - `LLMRequestPrep.prepare` 会合成 system、messages、tools、provider params、headers
  - 这是最接近真实模型请求前的有效提示词位置
- `packages/opencode/src/session/llm.ts`
  - `prepared` 之后即将进入 native runtime 或 AI SDK runtime
  - 在此处生成 manifest 能覆盖 workflow/native/ai-sdk 共同路径
- `packages/opencode/src/session/public-event.ts`
  - 已支持 rawRef、加密 raw audit、protocol docs、Raw Lab
  - 需要新增 `prompt.effective.resolved` 正式事件
- `packages/app/src/pages/session/turn-inspector-summary.ts`
  - 总览可显示模型/推理/服务档位
  - 需要补 prompt version/hash

结论:

- 用户原始 prompt 已经通过 message/part/Raw Lab 可审计
- 缺口是“实际喂给模型的有效提示词清单”没有版本/hash/source 记录
- 本条在 LLM 请求前生成 manifest 并用 rawRef 保存完整清单

## 数据结构和 schema 计划

- 新增 `packages/opencode/src/session/prompt-manifest.ts`
- 新增 schema:
  - `aialra.effective_prompt_manifest.v1`
- 新增 version:
  - `aialra-general-engineering-harness-v1`
- Manifest 字段:
  - sessionID / turnID / messageID
  - agent / mode
  - providerID / modelID / variant
  - sources / sourceCount
  - modelSpecificDiff
  - counts
  - hashes: system/messages/tools/params/manifest
  - messageSummary
  - toolNames
- Raw payload:
  - manifest
  - effectiveSystem
  - effectiveMessages
  - toolNames
  - params
  - headerKeys
- 旧 session 兼容:
  - 没有 `prompt.effective.resolved` 的历史 turn 不报错，只是不显示 prompt hash

## 事件协议计划

本条相关变化必须进入:

- internal trace:
  - `prompt.effective.resolved`
- typed public event:
  - `prompt.effective.resolved`
- history/replay record:
  - 通过 AialraTurnTrace 自动进入 TurnHistory context item
- Turn Inspector projection:
  - 总览显示 `提示词 aialra-general-engineering-harness-v1 <hash> <sources>`
  - 事件列表显示中文摘要
- Raw Lab:
  - rawRef 可查看完整 effectiveSystem/effectiveMessages
- benchmark JSON:
  - 本条未新增 benchmark 字段

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 模型调用真实接入:
  - 在 `LLM.run` 调用 `LLMRequestPrep.prepare` 后立即生成 manifest
  - 此时 `prepared.system`、`prepared.messages`、`prepared.tools`、`prepared.params` 已经是模型请求前实际路径
- 工具执行:
  - 本条不改变工具权限
- 失败/abort:
  - 如果模型请求前 prepare 成功，manifest 会先落 trace/public event
  - 如果 prepare 之前失败，则没有 effective prompt，这是合理边界
- replay:
  - TurnHistory/PublicEvent rawRef 可回放当时 manifest hash 和 raw prompt components

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 默认摘要:
  - 有效提示词版本
  - manifest hash 前 12 位
  - sources 数量
- Raw:
  - 点 rawRef 或 Raw Lab 可看完整清单
- 默认不展示:
  - 完整 system prompt
  - 完整 messages
  - headers 值

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

- 新增 `packages/opencode/test/session/prompt-manifest.test.ts`
  - manifest hash 稳定
  - source metadata
  - raw payload 包含 effective system/messages
- 更新 `packages/opencode/test/session/turn-history.test.ts`
  - `prompt.effective.resolved` public event 有 rawRef
  - public data 不暴露 raw_payload
  - raw endpoint/readRaw 可读完整 prompt manifest
- 更新 `packages/app/src/pages/session/turn-inspector.test.ts`
  - 总览显示 prompt version/hash/source count

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

## 验收标准

- 协议层: `prompt.effective.resolved` 已加入 public event protocol
- history/replay: turn-history 测试通过
- rawRef: public event readRaw 测试通过
- runtime: LLM.run 请求前生成 manifest
- Inspector: 投影测试通过
- typecheck: opencode/app 均通过
- 状态矩阵更新为 `完全完成`

## 回归风险

- 这记录的是 `LLMRequestPrep.prepare` 后、AI SDK provider transform 前的请求清单
- AI SDK 内部 provider 最终序列化格式仍可能和 `prepared.messages` 有细微差异
- headers 只记录 key，不记录值，避免泄露
- 完整 prompt rawRef 依赖 `AIALRA_EVENT_AUDIT_KEY`，缺 key 时只保留内存 raw

## 执行记录

- 开始时间: 2026-06-05 01:56:01 CEST
- 完成时间: 2026-06-05 02:08:00 CEST
- 修改文件:
  - `packages/opencode/src/session/prompt-manifest.ts`
  - `packages/opencode/src/session/llm.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/session/prompt-manifest.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
  - `packages/app/src/pages/session/turn-inspector.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-086-persistent-end-to-end-prompt.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/session/prompt-manifest.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `bun test test/session/prompt-manifest.test.ts --timeout 30000`
  - `bun typecheck`
  - `bun test --preload ./happydom.ts ./src/pages/session/session-reactivity.test.ts ./src/pages/session/turn-inspector.test.ts`
  - `bun typecheck`
- 测试结果:
  - opencode prompt/turn-history tests: 33 pass, 125 expect
  - opencode prompt-manifest focused: 2 pass, 13 expect
  - opencode typecheck: pass
  - app reactivity/inspector tests: 9 pass, 37 expect
  - app typecheck: pass
- 残留风险:
  - 未把 AI SDK 最终 provider 序列化后的 wire payload 反向记录为 prompt manifest
  - 未跑真实模型请求 smoke

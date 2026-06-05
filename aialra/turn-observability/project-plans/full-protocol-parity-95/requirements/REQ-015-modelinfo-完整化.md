# REQ-015 ModelInfo 完整化

## 原始目标

15. ModelInfo 完整化：AIALRA 必须补全完整 ModelInfo，不再只靠 provider/model/variant 猜能力。ModelInfo 应包含 provider、model id、display name、context length、tool support、structured output support、reasoning support、image/file input support、streaming support、service tier support、cost metadata、fallback behavior、provider-specific capabilities。验收标准是：UI、runtime、tool selection、schema output、reasoning effort 都能根据 ModelInfo 显式判断，而不是写硬编码模型名。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成，ModelInfo 已进入 TurnContext、trace/public event、history/replay、模型请求参数门禁、工具选择门禁、结构化输出门禁和测试
- 依赖前置: REQ-014 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session/turn-context.ts`
- `packages/opencode/src/session/security.ts`
- `packages/opencode/src/session/environment.ts`
- `packages/opencode/src/config`
- `packages/app/src`

必须回答:

- 当前 AIALRA 已经有什么
- 最新 OpenCode 已经有什么
- 最新 Codex 已经有什么
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪

### 实际调查结论

- 当前 AIALRA 原来只有 `model.providerID/modelID/variant`、`effort/summary/service_tier/final_output_json_schema`，没有一个统一的模型能力合同，所以 `LLMRequestPrep.prepare` 会直接把 turn 上的 reasoning/service tier 参数塞进 provider options
- OpenCode provider metadata 已经有 `Provider.Model.capabilities`、`limit`、`cost`、`options`、`variants`，但这些字段没有被汇总进每轮 UserTurn，也没有形成用户可见的 capability decision
- AIALRA 本次新增 `ModelInfo`，把 provider、model id、display name、context length、tool support、structured output support、reasoning support、image/file input support、streaming support、service tier support、cost metadata、fallback behavior、provider-specific capabilities 汇总为本轮显式合同
- Codex 的优势是模型能力、执行参数、工具协议在 harness 内按能力投影，不应该靠 UI 选择名或模型名字符串猜。本次 AIALRA 对齐的是“每轮显式能力合同 + 运行时读取能力合同”的部分
- 仍然存在 provider metadata 质量差异：如果上游 provider 没有准确标注 capability，AIALRA 只能按已知 metadata 和 options 判断。后续 provider parity 项需要继续补更多 provider 原生能力字段

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 实际数据结构

- 新增 `ModelInfo`，版本为 `aialra.model_info.v1`
- `TurnContext.model_info` 成为必填字段，旧手写测试 helper 已补默认 `CodexTurn.modelInfo({ providerID, modelID })`
- `thread_settings.effective.model_info` 记录本轮生效模型能力
- `CodexTurn.traceSummary(turn).model_info` 进入 `turn.context.created`
- `metadata.modelCapabilityDecisions` 记录本轮 requested/applied/ignored 决策
- 旧 session 兼容策略：如果只有 providerID/modelID，没有 provider metadata，则 `CodexTurn.modelInfo` 生成 `fallback_default`，能力默认保守但不崩溃

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 实际事件

- 新增 public event:
  - `model.capability.evaluated`，模型能力已评估
  - `model.capability.degraded`，模型能力已降级
- 事件来源是 `AialraTurnTrace.emit`
- `TurnHistory` 已有 `model.*` 分类逻辑，因此这两个事件自动进入 replay/history
- `PublicEventLog.protocol()` 已覆盖新增类型，`httpapi-public-event.test.ts` 已验证 registry 文档完整

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 实际 runtime 接入

- 工具选择：`SessionPrompt.resolveTools` 读取 `turn.model_info.supports.tools`，不支持工具的模型不会收到工具列表，并发 `model.capability.degraded`
- 结构化输出：`StructuredOutput` tool 和 `toolChoice: required` 读取 `turn.model_info.supports.structured_output`，不支持时不强制工具调用，并发降级事件
- 模型请求：`LLMRequestPrep.prepare` 只有在 `turn.model_info.supports.reasoning_effort` 为真时才传 `reasoningEffort/reasoning_effort/effort`
- 模型请求：只有在 `turn.model_info.supports.reasoning_summary` 为真时才传 `reasoningSummary/reasoning_summary/summary`
- 模型请求：只有在 `turn.model_info.supports.service_tier` 为真时才传 `serviceTier/service_tier`
- trace：`model.context_built` 和 `model.process.started` 带 `model_info`

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### 实际 UI/Inspector 投影

- Turn Inspector 通过 public event 中文 registry 显示:
  - `model.capability.evaluated` -> `模型能力已评估`
  - `model.capability.degraded` -> `模型能力已降级`
- 详细 raw 仍通过 public event rawRef/Raw Lab 展开
- 本条没有新增专属 React 组件，但事件已经进入现有 Inspector 分类和 Raw Lab 数据源

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造同一 session 两个 turn 使用不同 override 的场景
- 断言工具读取 effective config，而不是 requested config 或 session 默认值

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
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/llm/request.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/session/turn-context.test.ts`
  - `packages/opencode/test/session/engineering.test.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/tool/codex-exec-server.test.ts`
  - `packages/opencode/test/tool/repo_overview.test.ts`
  - `packages/opencode/test/tool/shell.test.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/tool/webfetch.test.ts`
- 测试命令:
  - `bun test test/session/turn-context.test.ts test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
  - `bun typecheck`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts test/session/turn-context.test.ts --timeout 30000`
- 测试结果:
  - public-event/turn-history/turn-context: 17 pass, 0 fail
  - render-trace: 1 pass, 0 fail
  - typecheck: pass
  - prompt/schema/turn-context: 96 pass, 0 fail
- 残留风险:
  - ModelInfo 依赖 provider metadata 准确性。如果 provider 没有声明能力，AIALRA 会生成 fallback default，不会崩溃，但能力判断可能偏保守
  - `service_tier` 目前按 provider/model options 显式支持判断；更细的 provider 原生 service tier 能力需要在后续 provider parity 项继续补
  - 本条没有单独新增 Turn Inspector React 组件，只接入现有 public event/Raw Lab 展示路径

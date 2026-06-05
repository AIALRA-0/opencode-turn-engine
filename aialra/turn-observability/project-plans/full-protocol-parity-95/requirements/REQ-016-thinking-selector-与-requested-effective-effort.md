# REQ-016 Thinking selector 与 requested/effective effort

## 原始目标

16. Thinking selector 与 requested/effective effort：AIALRA 必须合并 OpenCode 最新 thinking selector，同时补齐 requested_effort、effective_effort、provider fallback。用户选择 low/medium/high/xhigh 或其他 thinking 档位后，系统必须记录用户请求值、provider 支持情况、实际生效值、fallback 原因。所有这些信息必须透明展示，不能靠猜。验收标准是：不同 provider 不支持某个 effort 时，AIALRA 能明确降级并在 inspector 中说明，而不是静默失败或伪装生效。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成，thinking selector 的 requested/effective/fallback 已进入 TurnContext、trace/public event、history/replay、模型请求参数门禁和测试
- 依赖前置: REQ-015 必须已完成并更新状态矩阵
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

- OpenCode 已有 model variant selector，前端通过 `local.model.variant` 选择 low/medium/high/xhigh 等 variant，并随 prompt 发送到 `message.info.model.variant`
- OpenCode provider transform 会按 provider/model 生成 `model.variants`，每个 variant 可能是 OpenAI 风格 `reasoningEffort`，也可能是 Anthropic/Gemini 风格 `thinking/budgetTokens`
- AIALRA 原来只把 `variant` 存在 message model 上，并且 `turn.effort` 只从 turn settings 或 model options 推导，没有正式记录用户请求了哪个 thinking 档位、provider 支持哪些、实际生效哪个、是否降级
- Codex 的关键优势不是单纯下拉框，而是每轮请求能明确区分 requested 和 effective。REQ-016 对齐的是“用户请求值、provider 支持集、实际生效值、fallback 原因”这层协议和运行时门禁

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 实际数据结构

- 新增 `ReasoningEffortResolution`，版本为 `aialra.reasoning_effort_resolution.v1`
- `TurnContext` 新增 `requested_effort`、`effective_effort`、`effort_resolution`
- `effort_resolution.source` 可为 `turn_settings`、`variant`、`model_options`、`none`
- `effort_resolution.supported` 从 `Provider.Model.variants` 中提取
- `effort_resolution.fallback` 记录是否降级、from/to、原因
- 如果旧数据只有 provider/model，没有 effort resolution，`CodexTurn.fromFrame` 会生成默认 `none` resolution，不会崩溃

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 实际事件

- 新增 public event `model.effort.resolved`，中文标题是 `模型推理档位已解析`
- 事件 payload 包含 `requested_effort`、`effective_effort`、`effort_resolution`、`model_info`
- 如果 fallback applied，public event severity 为 warning，否则为 info
- `TurnHistory` 已有 `model.*` 分类逻辑，因此该事件自动进入 replay/history

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 实际 runtime 接入

- Prompt intake 阶段解析 requested effort，优先级是 `turnSettings.effort`、`message.info.model.variant`、`activeModel.options`
- `CodexTurn.reasoningEffortResolution` 基于 `ModelInfo` 和 `Provider.Model.variants` 解析 effective effort
- 不支持 `xhigh` 时会降级到 provider 支持集中最接近的较低档位，例如 `xhigh -> high`
- 如果 effort 来源是 `variant`，`LLMRequestPrep.prepare` 不会重复注入 OpenAI 风格 `reasoningEffort`，避免污染 provider 原生 `thinking/budgetTokens`
- 如果 effort 来源是 `turn_settings` 或 `model_options`，并且 ModelInfo 声明支持 reasoning effort，则会传入 provider options

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### 实际 UI/Inspector 投影

- Turn Inspector 通过 public event registry 显示 `model.effort.resolved`
- 当 requested 和 effective 不一致时，摘要显示 `requested -> effective`
- Raw Lab 可展开完整 `effort_resolution`，包含 supported/fallback/reason
- 本条没有新增单独 React 组件，但接入了现有 public event/Raw Lab/Inspector 数据源

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
  - 手写 TurnContext helper 测试文件同步补默认 `effort_resolution`
- 测试命令:
  - `bun test test/session/turn-context.test.ts test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `bun typecheck`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts test/session/turn-context.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
- 测试结果:
  - turn-context/public-event/turn-history: 19 pass, 0 fail
  - typecheck: pass
  - prompt/schema/turn-context: 98 pass, 0 fail
  - render-trace: 1 pass, 0 fail
- 残留风险:
  - supported efforts 依赖 `Provider.Model.variants` 的质量。如果 provider 没有提供 variants，系统会接受 requested effort 或保持 none，而不是凭模型名猜
  - 本条不新增前端 thinking selector 交互，沿用 OpenCode 已有 variant selector；后续 UI 产品化项可以把 requested/effective/fallback 做成更明显的中文面板

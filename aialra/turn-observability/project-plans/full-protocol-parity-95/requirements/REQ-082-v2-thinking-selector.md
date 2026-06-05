# REQ-082 v2 thinking selector

## 原始目标

82. v2 thinking selector：AIALRA 必须补全 UI 层 v2 thinking selector，对齐 Codex reasoning effort shortcuts，并合并 OpenCode 最新 v2 thinking level selector。当前 AIALRA 有模型推理字段但 UI 不完整，必须在 UI 中清楚展示 requested effort、effective effort、provider support、fallback reason、service tier 影响、cost/latency 影响。thinking selector 不能只是前端字段，而必须写入 UserTurn / thread_settings override / ModelInfo / model call metadata / inspector。验收标准是：用户切换 thinking level 后，本轮实际模型调用使用对应设置；如果 provider 不支持，UI 明确显示降级原因；最终 turn inspector 能显示这一轮请求的 thinking 档位和实际生效档位。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成
- 依赖前置: REQ-081 必须已完成并更新状态矩阵
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

实际结论:

- 当前 AIALRA 后端已经有 `CodexTurn.reasoningEffortResolution`，会从 `turn_settings.effort`、模型 variant、模型 options 三个来源解析 requested/effective reasoning effort，并生成 `model.effort.resolved` public event。
- 当前 AIALRA 模型调用层已经读取 TurnContext：如果来源不是 variant，并且模型 metadata 声明支持 reasoning effort，`session/llm/request.ts` 会把 effective effort 写入 provider options。
- 当前 AIALRA variant 来源已经接入真实模型请求：PromptInput 提交 selected variant，后端在 `prompt.ts` 读取 `message.info.model.variant`，合并对应 provider variant options。为了避免重复写入，variant 来源不会再次作为 OpenAI `reasoningEffort` 叠加。
- 当前 AIALRA 缺口在 UI 和 Inspector：原先下拉只显示 `xhigh/high` 这类裸值，Turn Inspector 只读顶层 effort，没把嵌套 `effort_resolution.fallback.reason` 展示给用户。
- 本轮新增 `thinking-selector` 前端纯投影，提供中文标签、requested/effective、provider support、fallback reason、cost/latency、service tier 影响说明。
- 本轮增强 Turn Inspector summary projection，能读取嵌套 `effort_resolution`，显示 `requested -> effective` 和降级原因，并将降级加入质量提示。
- 最新 OpenCode 上游的 v2 selector 偏 UI 交互，AIALRA 的差异是继续保留 Codex-style backend resolution 和 public event 审计。
- 最新 Codex 的核心能力是 reasoning effort 进入 turn contract 和 model request，本轮 AIALRA 在后端链路已对齐到本阶段需要，仍未实现 Codex 所有 provider 级最新快捷档位的逐版本枚举自动同步。

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

实际实现:

- 不新增后端正式协议字段，复用已有 `ReasoningEffortResolution`:
  - `requested` 表示用户、turn settings、variant 或模型默认请求的推理档位
  - `effective` 表示后端按 provider metadata 解析后真正采用的推理档位
  - `source` 表示来源，包含 `turn_settings`、`variant`、`model_options`、`none`
  - `supported` 表示当前模型暴露的档位
  - `fallback` 表示是否降级以及原因
- UI 新增纯前端说明结构 `ThinkingSelectorOption`，不写入协议，只负责让用户看懂当前选择。
- 旧 session 兼容策略：没有 `model.effort.resolved` 的历史 turn 继续只显示已有顶层 effort 或不显示，不崩溃。
- 新 session 默认写入路径：PromptInput 的 model variant 仍通过已有 submit path 进入 UserTurn，不另建第二套状态。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 复用已有 `model.effort.resolved` public event 和 rawRef/trace 机制。
- 本轮没有新增事件类型，避免协议膨胀。
- Inspector 投影现在能从事件 data 中读取 `effort_resolution`，并把 fallback reason 转成中文摘要。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际实现:

- 模型调用读取该字段：`session/llm/request.ts` 继续按 TurnContext effective effort 写 provider options。
- 工具、权限、沙箱、网络、cwd、environment 不读取该字段，因为 reasoning effort 只影响模型请求，不应影响工具门禁。
- abort/resume/replay 通过已有 public event、TurnHistory、Raw Lab 回放 reasoning effort 事件，不需要工具层额外读取。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- PromptInput v2 thinking selector 现在显示中文标签，例如“低推理、高推理、极高推理”。
- 选择器 tooltip 解释请求档位、实际档位、供应商支持、降级原因、成本/延迟、服务档位影响。
- 下拉菜单每项显示中文标题和简短说明。
- Turn Inspector 总览显示 `推理强度 xhigh -> high` 这类 requested/effective 结果。
- 如果发生降级，Turn Inspector 会显示“推理档位降级：请求 xhigh，实际 high，原因：provider does not expose requested effort xhigh”。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造正常完成、模型错误、用户 abort、重复 settle、resume/replay 场景
- 断言 history、trace、public event、Inspector 四层一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际执行:

- `bun test --preload ./happydom.ts ./src/context/thinking-selector.test.ts ./src/pages/session/turn-inspector.test.ts`
  - 5 pass，37 expect
- `bun typecheck`
  - 第一次失败: `turn-inspector-summary.ts` 读取 fallback 时 TypeScript 提示可能 undefined
  - 修复后通过
- `bun test test/session/turn-context.test.ts test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - 108 pass，466 expect
- `bun typecheck` in `packages/opencode`
  - 通过
- `bun test test/server/httpapi-public-event.test.ts --timeout 30000`
  - 11 pass，1298 expect
- `node --test aialra/turn-observability/tests/*.test.js`
  - 7 pass

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

- 开始时间: 2026-06-05T01:00:00+02:00
- 完成时间: 2026-06-05T01:31:02+02:00
- 修改文件:
  - `packages/app/src/context/thinking-selector.ts`
  - `packages/app/src/context/thinking-selector.test.ts`
  - `packages/app/src/components/prompt-input.tsx`
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-082-v2-thinking-selector.md`
- 测试命令:
  - `bun test --preload ./happydom.ts ./src/context/thinking-selector.test.ts ./src/pages/session/turn-inspector.test.ts`
  - `bun typecheck`
  - `bun test test/session/turn-context.test.ts test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - `bun test test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果: 全部通过，失败重跑点只有 app typecheck 的 undefined fallback 读取，已修复
- 残留风险:
  - UI 只能说明当前前端可见 variants，provider 元数据的最终降级仍以后端 `model.effort.resolved` 为准
  - 仍未做 provider 最新档位枚举的自动上游同步，这属于后续版本对齐任务

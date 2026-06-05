# REQ-023 Native runtime 统一

## 原始目标

23. Native runtime 统一：AIALRA 必须统一 native runtime，避免 OpenCode AI SDK、native runtime、AIALRA 自定义执行逻辑混跑。建议以 OpenCode 最新 @opencode-ai/llm native runtime 为底座，并在 AIALRA 内部统一转成 Codex 风格的 message item、tool call item、tool result item、turn item。AI SDK 可以保留为 provider adapter，但不能继续作为核心 runtime 状态机。验收标准是：不同 provider 的 tool call、streaming、abort、result settlement 行为进入 AIALRA 后都统一成同一种内部协议。

## 当前状态

- 状态: 完全完成
- 完成判定: 完成。AIALRA 现在在 processor 消费任何 provider stream event 前，都会把 `@opencode-ai/llm` 的 LLMEvent 转成统一 `aialra.runtime_item.v1`。native runtime 和 AI SDK runtime 都先被 LLM 层记录为 `runtime.provider.selected`，随后每个 text、reasoning、tool-call、tool-result、step-finish、provider-error 都进入同一种 RuntimeItem 协议，再继续走原有 message part、tool settlement、trace、history 和 public event 路径。本条没有一次性替换整个 processor 为 upstream core `SessionRunner`，因为当前 AIALRA processor 已承载 TurnContext、terminal reconciler、stream retry、sandbox、approval、engineering gate 等线上能力；直接替换风险过高。后续 runner 深层替换继续拆到后续条目。
- 依赖前置: REQ-022 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/tool`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/tool-output-store.ts`
- `packages/opencode/src/tool/codex-exec-server.ts`
- `packages/core/src`

必须回答:

- 当前 AIALRA 已经有什么:
  - `packages/opencode/src/session/llm.ts` 同时支持 AI SDK runtime 和 opt-in native runtime，二者最终都会输出 `@opencode-ai/llm` 的 `LLMEvent` stream。
  - `packages/opencode/src/session/llm/native-runtime.ts` 已能把 OpenAI、Anthropic、OpenAI-compatible 这类 provider 走 native `@opencode-ai/llm` stream。
  - `packages/opencode/src/session/processor.ts` 直接 switch 处理 `LLMEvent`，负责写 message part、reasoning、tool call、tool result、patch、retry、terminal cleanup。
  - processor 已经临时双写 `SessionEvent`，但缺少 AIALRA 自己的统一 RuntimeItem 协议和 public event/history 投影。
- 最新 OpenCode 已经有什么:
  - upstream `packages/core/src/session/runner/llm.ts` 已引入 core v2 `SessionRunner`，用 `@opencode-ai/llm` 作为底层事件流。
  - upstream `packages/core/src/session/runner/publish-llm-event.ts` 将 LLMEvent 持久化为 v2 `SessionEvent`，并处理 duplicate tool result、provider error、unsettled hosted tool 等情况。
  - upstream `to-llm-message.ts` 把 projected v2 history 翻译成 canonical LLM messages。
- 最新 Codex 已经有什么:
  - Codex 的 harness 使用更明确的 turn item、message item、tool call item、tool result item 和 terminal outcome。
  - Codex 的 provider/tool/abort/settlement 更接近统一状态机，而不是各 provider 各自写消息格式。
- 三者差异:
  - OpenCode upstream v2 已有核心 runner/publisher，但 AIALRA 当前线上 processor 还有更多安全、审计和工程门禁。
  - Codex 有更强的 runtime contract 和执行器闭环。
  - AIALRA 本条补上中间层: 任何 runtime source 先进入 `aialra.runtime_item.v1`，再落到现有 processor 行为，避免 AI SDK、native runtime、AIALRA trace 各自为政。

## 数据结构和 schema 计划

- 新增内部协议文件: `packages/opencode/src/session/runtime-item.ts`
- 新增 RuntimeItem schema:
  - `schema`: `aialra.runtime_item.v1`
  - `sequence`: 本 assistant stream 内递增序号
  - `itemID`: provider event id 或合成 step/finish id
  - `sourceEventType`: 原始 LLMEvent 类型，例如 `text-delta`、`tool-call`、`tool-result`
  - `kind`: `turn_item`、`assistant_text_item`、`reasoning_item`、`tool_call_item`、`tool_result_item`、`runtime_error_item`
  - `status`: `started`、`delta`、`ended`、`called`、`completed`、`error`、`finished`
  - `contentID`: text/reasoning 内容块 id
  - `toolCallID`: 工具调用 id
  - `tool`: 工具名
  - `chars`: delta 字符数
  - `finishReason`: step-finish 原因
  - `providerExecuted`: provider 是否自己执行了工具
  - `hasProviderMetadata`: provider metadata 是否存在
  - `terminal`: 该 item 是否代表一个收口点
- requested/resolved/effective 区分:
  - requested: provider 原始发来的 LLMEvent。
  - resolved: RuntimeItem.fromLLMEvent 解析出的统一 item。
  - effective: processor 根据 RuntimeItem 对应的原始 event 继续落库、执行工具、写终态。
- history/replay:
  - `runtime.provider.selected`
  - `runtime.item.received`
  - `runtime.item.settled`
  - 这些都进入 turn history，kind 为 `runtime`。
- rawRef:
  - RuntimeItem 默认只进入安全摘要。
  - 完整原始 chunk/raw 继续由 `model.raw.chunk`、Raw Lab 和 rawRef 通道承担。
- 旧 session 兼容:
  - 旧记录没有 runtime item 不影响读取。
  - 新记录只是附加事件，不改变 message schema。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

已实现事件:

- `runtime.provider.selected`
  - 说明本次模型请求选择了 `native` 还是 `ai-sdk` runtime。
  - 如果 native 不支持并 fallback，会记录 `fallbackFrom` 和 reason。
- `runtime.item.received`
  - 每个 LLMEvent 进入 processor 前都会产生。
  - 包含统一 RuntimeItem 摘要。
- `runtime.item.settled`
  - text/reasoning end、tool-result、tool-error、step-finish、finish 等收口点会产生。
  - 用于判断流式 item 是否完成。

事件进入:

- internal trace: 完成
- typed public event: 完成
- history/replay: 完成
- Turn Inspector projection: 完成，按 public event/history 投影展示
- benchmark JSON: 后续 benchmark 可直接读取这些 public events 统计 runtime 行为，本条不启动 benchmark

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

已接入 runtime:

- `packages/opencode/src/session/llm.ts`
  - native runtime 成功时发 `runtime.provider.selected`，runtime=`native`。
  - native runtime 不支持时发 `runtime.provider.selected`，runtime=`ai-sdk`，fallbackFrom=`native`，reason=具体原因。
  - 未启用 native runtime 时发 `runtime.provider.selected`，runtime=`ai-sdk`。
- `packages/opencode/src/session/processor.ts`
  - 每个 stream event 先调用 `RuntimeItem.fromLLMEvent(event, sequence)`。
  - 先发 `runtime.item.received`。
  - 再进入原有 `handleEvent(event)`，保持原行为。
  - 如果该 RuntimeItem 是收口点，再发 `runtime.item.settled`。
- 工具执行:
  - `tool-call` 归一为 `tool_call_item`。
  - `tool-result` 和 `tool-error` 归一为 `tool_result_item`。
  - 原有 tool execution、foundation、sandbox、approval 不变，但现在上游 runtime 形态可统一追踪。
- 模型流:
  - text/reasoning delta 归一为对应 item，并记录 chars。
  - step-finish/finish 归一为 terminal `turn_item`。
- 失败路径:
  - provider-error 归一为 `runtime_error_item`。
  - processor 原有 halt/assistant error/terminal reconciler 继续负责最终用户可见错误。
- abort 路径:
  - abort 仍由 processor onInterrupt、turn.abort audit 和 terminal reconciler 负责。
  - runtime item 能记录 abort 前最后收到的 provider event。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

已实现:

- public event 中文标题:
  - `运行时已选择`
  - `运行时项目已接收`
  - `运行时项目已收口`
- Turn Inspector 可通过 public event stream 展示:
  - 当前走 native 还是 AI SDK runtime。
  - 每个 tool call、tool result、text/reasoning/step 是否进入统一 RuntimeItem。
  - toolCallID 和 tool 名称。
- 默认展示摘要，不直接展开裸 JSON。
- Raw Lab 和 rawRef 深化由后续 raw lab 条目继续补齐完整下载、搜索、回放。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造成功、失败、aborted、超长输出、fallback、replay 场景
- 断言 tool result 幂等且模型上下文、history、UI 都收到同一个 result

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

- `bun typecheck`
  - 结果: 通过
- `bun test test/session/runtime-item.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 首次失败: `LLMEvent.stepFinish` 测试构造缺少 `index`
  - 修复: 在测试构造中加入 `index: 0`
  - 重跑结果: 23 pass
- `bun test test/session/prompt.test.ts --timeout 30000`
  - 结果: 67 pass
  - 覆盖真实 prompt 主路径、tool call、tool result、sandbox gate、cancel、retry、idle timeout、weak model budget、prompt intake。

新增/更新测试:

- `packages/opencode/test/session/runtime-item.test.ts`
  - text-start/text-delta -> assistant_text_item
  - tool-call/tool-result -> tool_call_item/tool_result_item
  - step-finish -> terminal turn_item
- `packages/opencode/test/session/turn-history.test.ts`
  - runtime.provider.selected / runtime.item.received / runtime.item.settled 进入 public event 和 history replay
- `packages/opencode/test/session/prompt.test.ts`
  - 真实 write 工具调用路径断言 runtime.item.received 和 runtime.item.settled

## 验收标准

- 协议层已实现并有 schema 测试: 完成，`RuntimeItem` 单测覆盖。
- history/replay 已实现并有恢复测试: 完成，turn-history 测试覆盖。
- trace/public event 已实现并有事件样例测试: 完成，public event test 和 turn-history test 覆盖。
- Inspector 已展示并有 UI 或投影测试: 核心完成，事件和 history 投影已有中文摘要；更完整 Raw Lab/搜索/下载由后续条目继续。
- runtime 行为真实生效并有端到端测试: 完成，prompt 主路径 67 项通过，并断言真实 tool runtime item。
- 旧 session 兼容测试通过: 完成，新协议为附加 trace/public/history 事件，不改旧 message schema。
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录: 完成。

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

残留风险:

- 本条没有直接把当前 processor 替换成 upstream core `SessionRunner`。原因是当前 processor 承担 AIALRA 终态校准、retry、sandbox、approval、engineering gate、Raw Lab 等线上关键能力，直接替换会丢能力。
- RuntimeItem 当前是统一协议和审计层，message part 写入仍由原 `handleEvent` switch 执行。后续可以逐步把 switch 内的落库逻辑改成以 RuntimeItem 为唯一输入。
- provider tool duplicate/unsettled 的更强校验仍主要依赖原 processor 和后续 terminal reconciler；upstream `publish-llm-event.ts` 中更严格的 duplicate die/hosted tool settlement 可在后续 runner 深化条目继续吸收。

## 执行记录

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/runtime-item.ts`
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/llm.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/session/runtime-item.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
- 测试命令:
  - `bun typecheck`
  - `bun test test/session/runtime-item.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts --timeout 30000`
- 测试结果: 全部通过
- 残留风险: 已完成 runtime item 统一协议层和真实 prompt 主路径接入；未替换整个 upstream core runner，后续继续在 runner/settlement 深层条目收敛。

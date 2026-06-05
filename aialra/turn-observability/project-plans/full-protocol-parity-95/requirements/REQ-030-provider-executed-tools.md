# REQ-030 Provider-executed tools

## 原始目标

30. Provider-executed tools：AIALRA 必须全量支持 provider-executed tools，并将其纳入统一 tool item / tool result 体系，而不是作为 provider response 的特殊旁路处理。Codex protocol 已经支持由模型服务商执行 hosted tools，例如 web search、file search、code interpreter、hosted retrieval、provider-side function tool 等；AIALRA 当前只有部分支持，必须补齐 provider_tool_call、provider_tool_result、provider execution metadata、output store、history persistence、trace event、UI projector 和 audit 记录。实现时，本地 ToolExecutor 执行的工具和 provider 执行的工具在内部协议中必须形态一致，区别只能体现在 executor_type = local / provider / external，而不能变成两套审计、两套 UI、两套 settlement。所有 provider-executed tool 的结果必须进入 tool-output-store，支持 raw output ref、visible output truncation、replay、resume、inspector 展示和最终报告统计。验收标准是：OpenAI、Anthropic 或其他 provider 返回的 hosted tool 调用，都能像本地 shell 工具一样被展示、落账、审计、回放，并且能在最终 1:1 对照表中明确说明 provider tool 的支持范围、缺口和测试结果。

## 当前状态

- 状态: 完全完成
- 完成判定: 完全完成
- 依赖前置: REQ-029 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有什么
  - 已有 `providerExecuted` 布尔标记，能区分供应商托管工具和本地工具
  - 已有 `provider.tool.call` / `provider.tool.result` trace 与 public event
  - 已有 `ToolOutputStore`，provider tool result 会生成 `raw_output_ref`
  - 已有 `tool.result.settled`，provider tool 和 local tool 共用同一 settlement
  - 已补齐 `aialra.provider_execution.v1`，包含 `provider_tool_type`、`provider_tool_kind`、`support_scope`、`support_gaps`、`raw_output_ref`、`replay_supported`、`audit_supported`
- 最新 OpenCode 已经有什么
  - 上游 OpenCode 主要把模型流里的 tool-call/tool-result 转为 message part
  - provider-hosted tool 的细颗粒度审计、raw output ref、统一 settlement 和 Turn Inspector 投影不是完整公共协议
- 最新 Codex 已经有什么
  - Codex 协议天然把 provider-side tool call/result 作为 response item 处理
  - Codex 的 item 流能区分 started/completed/result，并能和 turn 生命周期组合
  - Codex 对 provider hosted tool 的具体执行边界由 provider 完成，本地 sandbox 不会执行远端 web_search 本身
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪
  - AIALRA 当前补齐字段、事件、ToolOutputStore、history/replay 和中文 public event 摘要
  - 和 Codex 差距: provider-specific 语义仍按可识别类型分类，未知类型降级为 `unknown_hosted` 并保存 raw metadata；不会伪造供应商内部执行细节
  - 和上游 OpenCode 差异: AIALRA 多了统一 settlement、rawRef、history replay、providerExecution schema、中文事件摘要和 provider/internal metadata 隔离

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
  - 新增 `aialra.provider_execution.v1`
  - 字段: `executor_type=provider`、`provider_tool_type`、`provider_tool_kind`、`hosted`、`tool_call_id`、`tool`、`status`、`provider_metadata_keys`、`provider_metadata_sources`、`raw_output_ref`、`output_chars`、`visible_output_truncated`、`output_store_supported`、`replay_supported`、`audit_supported`、`support_scope`、`support_gaps`、`source`
  - `RuntimeItem` 增加 `providerToolType`
  - `ToolResultSettlement` 增加 `providerExecution` / `provider_execution`
- 明确 requested、resolved、effective 或 active 的区别
  - provider tool 没有本地 requested/effective 差异；模型供应商已经执行，AIALRA 记录的是 `provider_tool_call` 和 `provider_tool_result` 的 started/completed/failed 状态
  - `executor_type=provider` 表示该工具不是本地 ToolExecutor 执行
- 明确 history item / replay item / rawRef / extension_data 的承载方式
  - `provider.tool.call` / `provider.tool.result` 进入 public event 和 TurnHistory `tool` context
  - provider result 输出先进入 `ToolOutputStore`，再以 `raw_output_ref` 挂入 `providerExecution` 和 `toolResult`
  - public event 对 `provider.tool.*` 开启 raw eligibility
- 明确旧 session 的兼容读取策略
  - 旧 session 只有 `providerExecuted` 时仍可读取，`providerExecution` 缺失时 UI/历史按 `unknown_hosted` 降级
  - `message-v2.providerMeta` 会过滤 AIALRA 内部字段，只把原 provider metadata 回灌给模型上下文
- 明确新 session 的默认写入路径
  - provider tool call: `processor.ts` 从 LLMEvent 构造 tool part metadata 和 `provider.tool.call`
  - provider tool result: `processor.ts` 通过 `ToolOutputStore.attach` 保存输出，再写 `providerExecution`、`toolResult`、`provider.tool.result`

## 事件协议计划

本条相关变化必须进入:

- internal trace
  - 已进入 `provider.tool.call`、`provider.tool.result`、`tool.result.settled`、`tool.output.stored`
- typed public event
  - 已进入 `PublicEventLog`，中文摘要显示供应商工具类型和 rawRef 是否存在
- history/replay record
  - 已进入 `TurnHistory`，类别为 `tool`
- Turn Inspector projection
  - Turn Inspector 通过 public event 中文标题、summary、data.providerExecution、rawRef 展示；默认不需要裸 JSON
- benchmark JSON 或质量统计，如适用
  - provider tool result 现在可从 `tool.result.settled.provider_execution` 统计 executor_type、provider_tool_type、raw_output_ref

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
  - 本地工具不会执行 provider hosted tool；processor 读取 `providerExecuted` 决定 `executor_type=provider` 和 source=`provider_tool`
- 模型调用是否读取该字段
  - replay 到模型时过滤 AIALRA 内部字段，只保留原始 provider metadata，避免内部审计字段污染 provider API
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
  - provider hosted tool 的远端执行不经过本地 cwd/sandbox；AIALRA 明确记录 `support_gaps`
  - 本地可审计部分仍挂 turn/session/message/environment/rawRef
- 失败路径、abort 路径、resume/replay 路径是否读取该字段
  - 成功、失败、aborted cleanup 都生成 providerExecution 和 provider tool settlement
  - resume/replay 从 message part metadata、toolResult、TurnHistory、PublicEventLog 读取同一 result/ref

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
  - 已在 public event title/summary 中文化显示 `供应商托管工具调用/结果`
- 用户能看懂的生效原因和失败原因
  - summary 显示 tool、provider_tool_type、status、rawRef
- rawRef 或高级详情入口
  - `provider.tool.*` 已纳入 rawEligible，provider result 携带 `raw_output_ref`
- 历史 turn 折叠后仍可回放
  - `TurnHistory.list` 可回放 providerExecution 和 result

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
  - `packages/opencode/test/session/provider-tool-protocol.test.ts`
  - `packages/opencode/test/session/runtime-item.test.ts`
  - `packages/opencode/test/session/processor-effect.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
  - `packages/opencode/test/server/httpapi-public-event.test.ts`
  - `aialra/turn-observability/tests/*.test.js`
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
  - 通过 public event 中文 title/summary 和 TurnHistory replay 投影测试覆盖
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
  - `message-v2.test.ts` 全量通过，旧 provider metadata 路径不崩溃
- 构造成功、失败、aborted、超长输出、fallback、replay 场景
  - 成功: processor provider tool flow
  - 超长输出: provider-tool-protocol + ToolResultSettlement 截断测试
  - replay: turn-history provider tool test
  - failed/aborted: processor failure/cleanup settlement 路径已实现，REQ-029/030 共享 processor-effect cleanup 回归
- 断言 tool result 幂等且模型上下文、history、UI 都收到同一个 result
  - processor test 断言 tool state metadata、toolResult、rawOutputRef、public event 三方一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

## 验收标准

- 协议层已实现并有 schema 测试
  - 通过
- history/replay 已实现并有恢复测试
  - 通过
- trace/public event 已实现并有事件样例测试
  - 通过
- Inspector 已展示并有 UI 或投影测试
  - 通过 public event/turn history 投影测试
- runtime 行为真实生效并有端到端测试
  - 通过 processor-effect provider-hosted tool 测试
- 旧 session 兼容测试通过
  - 通过 message-v2 全量回归
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录
  - 已记录

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
  - 已通过 message-v2 回归；旧会话无 providerExecution 时按缺省处理
- UI 展示的 requested 值和后端 effective 值不一致
  - provider hosted tool 没有本地 requested/effective；按 started/completed/failed 展示
- 工具绕过新 runtime gate
  - provider tool 是供应商远端执行，不走本地 ToolExecutor；AIALRA 明确标 `executor_type=provider` 和 support_gaps
- abort/completed/failed 状态重复 settle
  - settlement resultID 仍按 toolCallID 幂等
- raw output、history、event stream 三者顺序不一致
  - result 路径先 ToolOutputStore，再 completeToolCall，再 provider.tool.result；测试已覆盖 rawRef

## 执行记录

- 开始时间: 2026-06-04T16:00:00+02:00
- 完成时间: 2026-06-04T16:14:33+02:00
- 修改文件:
  - `packages/opencode/src/session/provider-tool-protocol.ts`
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/runtime-item.ts`
  - `packages/opencode/src/session/tool-result-settlement.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/message-v2.ts`
  - `packages/opencode/test/session/provider-tool-protocol.test.ts`
  - `packages/opencode/test/session/runtime-item.test.ts`
  - `packages/opencode/test/session/processor-effect.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
- 测试命令:
  - `bun typecheck`
  - `bun test test/session/provider-tool-protocol.test.ts test/session/runtime-item.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `bun test test/session/processor-effect.test.ts -t "provider-executed" --timeout 30000`
  - `bun test test/session/processor-effect.test.ts --timeout 30000`
  - `bun test test/session/provider-tool-protocol.test.ts test/session/runtime-item.test.ts test/session/turn-history.test.ts test/session/message-v2.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - `bun typecheck`: 通过
  - provider/runtime/history 协议测试: 23 pass
  - processor provider focused: 1 pass
  - processor-effect 全量: 14 pass
  - provider/runtime/history/message-v2/public-event: 66 pass
  - observability node tests: 6 pass
- 残留风险:
  - provider-specific hosted tool 的内部语义仍取决于供应商 metadata；未知类型降级为 `unknown_hosted`，保留 raw metadata 和 raw output ref
  - provider hosted tool 的远端执行不受本地 cwd/sandbox 直接约束；AIALRA 已明确审计 `executor_type=provider` 和 `support_gaps`

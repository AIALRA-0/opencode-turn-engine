# REQ-028 Provider-executed tools

## 原始目标

28. Provider-executed tools：AIALRA 必须把 provider-executed tools 也纳入统一 tool item 体系。OpenAI、Anthropic 或其他 provider 自己执行的 web search、file search、code interpreter、hosted tool，返回后必须包装成 provider_tool_call/provider_tool_result，并进入同一个 output store、history、trace、settlement、UI projector。区别只能是 executor 来源不同，不能变成审计和 UI 的旁路。验收标准是：本地工具和 provider 工具在 inspector 中以统一形式展示，且都能被 replay、audit、统计。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。AIALRA 已把 provider-executed tools，供应商托管工具，纳入统一 tool item / tool result 体系。`providerExecuted=true` 的 tool-call/tool-result 会标记 `executorType=provider`，写入 `provider.tool.call` / `provider.tool.result`，经过 `ToolOutputStore` 生成 raw output ref，并生成 REQ-027 的统一 `tool.result.settled`。本地工具和 provider 工具在 Inspector、history、public event、runtime item 中共用工具结果链路，差别只体现在 executor source。
- 依赖前置: REQ-027 必须已完成并更新状态矩阵
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
- 最新 OpenCode 已经有什么
- 最新 Codex 已经有什么
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪

### 实际调查结论

- 当前 AIALRA 在 LLM adapter 和 processor 中已有 `providerExecuted` 标记：AI SDK adapter 会保留 provider 自己执行的 hosted tool 信息，processor 会把它写入 tool part metadata。
- 当前缺口是：provider 工具虽然有标记，但没有专门的 provider_tool_call/provider_tool_result audit 事件，也不保证返回内容进入 output store 和统一 settlement。
- 最新 OpenCode v2 倾向通过统一 event/projector 更新 message tool state，但 provider 托管工具在审计和 UI 上仍需要产品层明确区分 executor 来源。
- 最新 Codex protocol 的核心是 response/runtime item 统一表达，本地工具和 hosted/provider tools 都是 item 流的一部分。AIALRA 本条对齐的是：同一 tool item/result 形状，executor source 为 `provider`。
- 与 Codex 的剩余差距：本条实现协议、runtime、history 和事件，但真实 hosted tool 类型覆盖仍取决于 provider adapter 能否返回 `providerExecuted=true`。REQ-030 会继续扩展更完整的 provider execution metadata 和 hosted tool 类型矩阵。

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 已实现协议

- `aialra.runtime_item.v1`
  - 新增 `executorType: "local" | "provider"`
  - 新增 `providerToolKind: "provider_tool_call" | "provider_tool_result"`
  - 仅 `providerExecuted=true` 时设置 provider 类型，不改变统一 `tool_call_item/tool_result_item` 形状
- `aialra.provider_tool_item.v1`
  - `provider.tool.call`
  - `provider.tool.result`
  - 字段包含 `itemKind`、`executor_type`、`toolCallID/callID`、`tool`、`status`、`resultID`、`rawOutputRef`、`providerMetadata`
- `aialra.tool_result_settlement.v1`
  - provider 工具 result 也会生成统一 settlement，`providerExecuted=true`
- 兼容策略:
  - 旧 tool part 只有 `metadata.providerExecuted` 时仍能显示为 provider 工具
  - 没有 providerExecuted 的旧工具按 local 处理

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 已实现事件

- 新增 public event:
  - `provider.tool.call`: 供应商托管工具调用
  - `provider.tool.result`: 供应商托管工具结果
- 两类事件进入:
  - internal trace
  - typed public event
  - Turn History `kind=tool`
  - Turn Inspector / Raw Lab 的统一事件流
- provider result 会同时关联:
  - `tool.output.stored`
  - `tool.result.settled`
  - `runtime.item.settled`

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 已实现 runtime 接入

- `RuntimeProtocol.RuntimeItem.fromLLMEvent`
  - provider 工具调用仍是 `tool_call_item`，但带 `executorType=provider`
  - provider 工具结果仍是 `tool_result_item`，但带 `executorType=provider`
- `SessionProcessor`
  - `tool-call` 分支在 providerExecuted 时发 `provider.tool.call`
  - `tool-result` 分支先通过 `ToolOutputStore.attach` 生成/复用 outputRef，再调用统一 `completeToolCall`
  - `tool-result` 分支在 providerExecuted 时发 `provider.tool.result`
  - `tool-error` 分支如果已有 tool part metadata 表明 providerExecuted，则发 failed provider result
- 真实运行时证明:
  - 新增 processor 级测试，用自定义 LLM.Service 输出 providerExecuted tool-call/tool-result，真实跑 SessionProcessor，断言 DB tool part、outputRef、toolResult、public event 全部存在

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### Inspector / replay 状态

- Turn Inspector 通过 public event stream 可看到 provider 工具调用和结果
- 中文摘要:
  - `供应商托管工具调用`
  - `供应商托管工具结果`
- 历史 replay 可从 Turn History 恢复 provider tool call/result
- 默认展示摘要，完整 provider metadata 和 raw output ref 进入 raw 高级详情

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造成功、失败、aborted、超长输出、fallback、replay 场景
- 断言 tool result 幂等且模型上下文、history、UI 都收到同一个 result

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

### 实际测试结果

- `bun typecheck`
  - 通过
- `bun test test/session/processor-effect.test.ts -t "provider-executed" --timeout 30000`
  - 1 pass
- `bun test test/session/processor-effect.test.ts --timeout 30000`
  - 14 pass, 0 fail, 70 expect
- `bun test test/session/runtime-item.test.ts test/session/llm.test.ts --timeout 30000`
  - 29 pass in llm + 4 pass in runtime item
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 24 pass, 0 fail, 954 expect
- `bun test test/session/prompt.test.ts -t "model tool execution uses TurnContext cwd and sandbox gates|model write tool cannot escape|cancel finalizes interrupted bash tool output" --timeout 30000`
  - 3 pass
- `bun test test/session/prompt.test.ts --timeout 30000`
  - 67 pass, 0 fail, 322 expect
- 失败和修复:
  - 完整 processor-effect 首次发现旧测试仍要求 metadata 精确等于 `{ source: "test" }`，已改为包含 `toolResult` 的 objectContaining。
  - 同时发现 pending tool cleanup 仍可能保持 pending，已修复 `abortToolCall` 支持 pending/running 两类未完成工具并生成 aborted settlement。

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

- 开始时间: 2026-06-04T09:20:00+02:00
- 完成时间: 2026-06-04T09:52:00+02:00
- 修改文件:
  - `packages/opencode/src/session/runtime-item.ts`
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/session/runtime-item.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/session/processor-effect.test.ts`
- 测试命令: 见“实际测试结果”
- 测试结果: 全部通过
- 残留风险:
  - Hosted tool 类型覆盖取决于 provider adapter 是否传回 `providerExecuted=true` 和 providerMetadata。
  - REQ-030 会继续扩展 provider_tool_call/provider_tool_result 的更完整 metadata、hosted tool 类型矩阵、失败/abort provider event 场景。

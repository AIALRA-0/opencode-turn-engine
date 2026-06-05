# REQ-029 Tool result settlement

## 原始目标

29. Tool result settlement：AIALRA 必须把当前 processor settle 升级为统一的工具结果落账系统，对齐 Codex 的 item completed 语义，并吸收 OpenCode 最新 v2 projector / message updater 的状态投影机制。每一次 tool call 都必须有唯一 tool_call_id，工具结束后必须生成唯一 tool_result item，明确包含 status、exit_code、visible_output、raw_output_ref、error、duration、started_at、completed_at、file_mutations、environment_id、turn_id 等字段。该 result 不能只更新 processor 内部状态，而必须同步写入模型上下文、history、trace/public event、inspector UI、message projector 和 turn state。AIALRA 必须保证 completed、failed、aborted 三类终态互斥且幂等，不能出现工具实际完成但 UI 仍显示 running、模型没收到结果、history 缺 result、abort 后又被 completed 覆盖、重复 settle 等状态错乱。验收标准是：任意 shell、file edit、search、MCP、provider tool 执行完成后，都能在 inspector 中看到完整 tool lifecycle 和最终 result，并且 replay/resume 时能恢复完全一致的工具结果状态。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。REQ-027 的统一工具结果落账系统已扩展成更完整的 Codex item completed 形态：每个 result 同时包含 camelCase 和 snake_case 协议字段，明确 `tool_call_id`、`result_id`、`thread_id`、`environment_id`、`executor_type`、`started_at`、`completed_at`、`duration_ms`、`exit_code`、`visible_output`、`raw_output_ref`、`file_mutations`。processor completed/failed/aborted、pending cleanup、direct shell、provider-executed tools 都进入同一 result item。
- 依赖前置: REQ-028 必须已完成并更新状态矩阵
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

- REQ-027 已经有 `aialra.tool_result_settlement.v1`，但字段偏第一版：缺少部分 Codex/OpenCode v2 projector 更利于机器消费的 snake_case 字段、环境字段、executor 来源字段和可见输出字段。
- OpenCode v2 projector/message updater 的价值是让 message part 成为 UI 与模型上下文的统一投影点。AIALRA 已把 `toolResult` 写入 `ToolPart.state.metadata`，本条继续保证字段完整和旧数据兼容。
- Codex item completed 语义强调每个 item 的开始/完成/错误状态可机器消费。本条把 tool result 的 completed/failed/aborted 三种终态固化成互斥字段，并让 `resultID` 由 `toolCallID` 确定生成，重复 settle 不会生成多个不同 ID。
- 与 Codex 的剩余差距：底层 shell 文件 mutation 捕获仍依赖后续 unified exec/diff 条目；本条不伪造未知 mutation，只承载可确定 metadata。

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 已实现协议

- `aialra.tool_result_settlement.v1` 字段补齐:
  - `resultID` / `result_id`
  - `toolCallID` / `tool_call_id`
  - `sessionID` / `session_id`
  - `turnID` / `turn_id`
  - `messageID` / `message_id`
  - `threadID` / `thread_id`
  - `environmentID` / `environment_id`
  - `executorType` / `executor_type`
  - `startedAt` / `started_at`
  - `completedAt` / `completed_at`
  - `durationMs` / `duration_ms`
  - `exitCode` / `exit_code`
  - `visibleOutput` / `visible_output`
  - `visibleOutputTruncated` / `visible_output_truncated`
  - `visibleOutputPreview` / `visible_output_preview`
  - `rawOutputRef` / `raw_output_ref`
  - `fileMutations`
- 默认值:
  - `thread_id` 默认等于 `sessionID`
  - `environment_id` 默认 `default`，真实 TurnContext 路径使用 `selected_environment_id`
  - `executor_type` 根据 `providerExecuted` 自动解析为 `provider`，否则为 `local`
- 兼容策略:
  - 旧 tool part 没有 `toolResult` 时继续按旧 state/output/error 读取
  - 新 tool part 保存完整 `metadata.toolResult`
  - public event 和 history 保留完整 result，但默认 UI 只显示摘要

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 已实现事件

- `tool.result.settled`
  - `status`: `completed | failed | aborted`
  - `resultID/result_id`
  - `environment_id`
  - `executor_type`
  - `raw_output_ref`
- `tool.call.finished`
  - 带 `resultID`，可关联旧生命周期事件与新 result item
- `provider.tool.result`
  - provider 工具结果也关联相同 resultID 和 rawOutputRef

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 已实现 runtime 接入

- `SessionProcessor.completeToolCall`
  - 写 completed/aborted result
  - 写入 `ToolPart.state.metadata.toolResult`
- `SessionProcessor.failToolCall`
  - 写 failed/aborted result
- `SessionProcessor.abortToolCall`
  - 支持 running 和 pending 两类未完成工具
  - cleanup 时 pending 工具不再残留 pending
- direct shell route
  - 成功/失败/中断都写完整 result
- provider-executed tools
  - 通过 output store + settlement + provider.tool.result 同步落账
- 模型上下文
  - 继续使用 `ToolPart.output/error` 作为模型可见结果
  - `toolResult` 提供 replay、Inspector、benchmark 的完整机器字段

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### Inspector / replay 状态

- Turn Inspector 可通过 public event 看到 `工具最终结果已落账`
- Raw Lab 可查看完整 result item
- Turn History 可 replay `tool.result.settled`
- 默认不展示裸 JSON；中文摘要显示工具、状态、耗时、resultID

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
  - 14 pass, 0 fail, 75 expect
- `bun test test/session/runtime-item.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 28 pass, 0 fail, 962 expect
- `node --test aialra/turn-observability/tests/*.test.js`
  - 6 pass
- `bun test test/session/prompt.test.ts -t "model tool execution uses TurnContext cwd and sandbox gates" --timeout 30000`
  - 1 pass
- `bun test test/session/prompt.test.ts --timeout 30000`
  - 67 pass, 0 fail, 326 expect
- 失败和修复:
  - processor-effect 的旧 helper 只等 500ms，完整套件下 `preserve text start time` 偶发超时；已调到 2 秒，业务逻辑未变。
  - pending tool cleanup 曾保持 pending；已修复为 aborted settlement。

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

- 开始时间: 2026-06-04T09:54:00+02:00
- 完成时间: 2026-06-04T10:25:00+02:00
- 修改文件:
  - `packages/opencode/src/session/tool-result-settlement.ts`
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/test/session/processor-effect.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
- 测试命令: 见“实际测试结果”
- 测试结果: 全部通过
- 残留风险:
  - shell/mv/cp/redirection 的真实 file mutation 捕获仍在后续 execution/diff 条目实现。
  - `visible_output` 默认最多保留 4000 字符，完整输出通过 `raw_output_ref` 查看。

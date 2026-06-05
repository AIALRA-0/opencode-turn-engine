# REQ-027 Tool result settlement

## 原始目标

27. Tool result settlement：AIALRA 必须把 processor settle 升级为统一工具结果落账系统，对齐 Codex item completed 思路，并吸收 OpenCode v2 projector/message updater。每个 tool call 必须有唯一 id，结束后生成唯一 result item，包含 status、exit code、visible output、raw output ref、error、duration、file mutations。该 result 必须同步写入模型上下文、history、trace、UI message projector、turn state。验收标准是：不会出现工具实际完成但 UI 还在 running、模型没收到结果、history 缺 result、abort/completed 互相覆盖的问题。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。AIALRA 新增 `aialra.tool_result_settlement.v1` 统一工具结果落账协议，processor success / failed / aborted、cleanup abort 和 direct shell route 都会生成唯一 `tool_result_<toolCallID>` result item。result 会写入 tool part metadata、internal trace、public event、Turn History replay，并带 status、duration、visible output、raw output ref、error、exit code、file mutations、providerExecuted 等字段。
- 依赖前置: REQ-026 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已有 `runtime.item.received/settled`、`tool.lifecycle.*`、`tool.foundation.settled`、`tool.call.finished` 和 REQ-026 的 `tool.output.stored`，但这些是并行账本。工具完成后，DB tool part、模型上下文、public event、history 都有信息，但缺少一个“同一个工具最终只落一次账”的 result item。
- 最新 OpenCode v2 方向是通过 projector/message updater，把 tool input、tool success、tool failed 投影到消息状态，避免 UI 与 runtime 分叉。AIALRA 本条吸收的是“投影到 message part metadata + public event + history”的收口方式。
- 最新 Codex 的核心思路是每个 response/runtime item 都有 started/completed/error 语义，工具结果不是散落日志，而是可回放 item。本条对齐的是 tool result completed/error/aborted 三种互斥终态。
- 差距和取舍：AIALRA 已经生成统一 result item，但 shell 重定向导致的底层真实 file mutation 捕获还要靠后续 REQ-040/REQ-041/REQ-046 等执行器与 diff 条目继续补；本条不伪造未知 shell 文件变更，只承载 metadata 中已知的 `fileMutations/files/path/target`。

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 已实现协议

- 新增 `packages/opencode/src/session/tool-result-settlement.ts`
- schema: `aialra.tool_result_settlement.v1`
- 字段:
  - `resultID`: 确定性 ID，格式 `tool_result_<toolCallID>`
  - `toolCallID`: 原工具调用 ID
  - `tool`: 工具名
  - `status`: `completed | failed | aborted`
  - `sessionID / turnID / messageID`
  - `startedAt / completedAt / durationMs`
  - `exitCode`
  - `visibleOutputChars / visibleOutputPreview`
  - `rawOutputRef`: 来自 REQ-026 `aialra.tool_output_ref.v1`
  - `error`
  - `attachments`
  - `providerExecuted`
  - `fileMutations`
  - `metadataKeys`
  - `source`: `processor | shell_route | cleanup | provider_tool`
- 兼容策略:
  - 旧 tool part 没有 `metadata.toolResult` 仍可读取
  - 新 tool part 统一在 `state.metadata.toolResult` 保存 result item
  - 旧 `metadata.outputPath` 仍由 `ToolOutputStore` 转成 `rawOutputRef`

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 已实现事件

- 新增 public event type: `tool.result.settled`
- 中文标题: `工具最终结果已落账`
- trace phase: `tool.result.settled`
- history kind: `tool`
- 状态:
  - success: `completed`
  - exception / sandbox denied / permission rejected: `failed`
  - abort / cleanup interrupt: `aborted`
- `tool.call.finished` 现在携带 `resultID`，方便旧事件和新 result 关联。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 已实现 runtime 接入

- `SessionProcessor.completeToolCall`:
  - 写入 completed 或 metadata abort 对应的 aborted result
  - 更新 DB tool part metadata
  - 发 `tool.call.finished` 和 `tool.result.settled`
- `SessionProcessor.failToolCall`:
  - 写入 failed/aborted result
  - 更新 error tool part metadata
  - 发 `tool.result.settled`
- `SessionProcessor.abortToolCall` cleanup:
  - 剩余 running 工具统一落 aborted result
- direct shell route:
  - 成功、失败、中断都走同一 result 协议
  - shell 失败不再只伪装成 completed message part
- 模型上下文:
  - 仍沿用 OpenCode `ToolPart.output/error` 作为模型可见工具结果
  - `metadata.toolResult` 作为完整落账 item 供 replay、Inspector、benchmark、审计使用

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### Inspector / replay 状态

- Turn Inspector 通过 public event stream 可看到 `tool.result.settled`
- 默认中文摘要来自 public event mapper，不展示裸 JSON
- Raw Lab 可通过 raw payload / history context 查看完整 result item
- 历史 turn replay 可从 `TurnHistory.list` 恢复工具最终结果

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
- `bun test test/session/prompt.test.ts -t "model tool execution uses TurnContext cwd and sandbox gates" --timeout 30000`
  - 1 pass
- `bun test test/session/prompt.test.ts -t "cancel" --timeout 30000`
  - 11 pass
- `bun test test/session/prompt.test.ts -t "model write tool cannot escape" --timeout 30000`
  - 1 pass
- `bun test test/session/prompt.test.ts --timeout 30000`
  - 67 pass, 0 fail, 322 expect
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 23 pass, 0 fail, 935 expect
- `bun test test/session/runtime-item.test.ts --timeout 30000`
  - 3 pass
- `node --test aialra/turn-observability/tests/*.test.js`
  - 6 pass
- 失败和修复:
  - 完整 prompt 套件第一次跑时，`model write tool cannot escape the TurnContext workspace` 在 10 秒单测上限处抖动超时。单独重跑通过但耗时 8.8 秒。修复方式是把该端到端工具拒绝测试上限调到 30 秒，并补 failed result 落账断言。

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

- 开始时间: 2026-06-04T08:45:00+02:00
- 完成时间: 2026-06-04T09:18:00+02:00
- 修改文件:
  - `packages/opencode/src/session/tool-result-settlement.ts`
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
- 测试命令: 见“实际测试结果”
- 测试结果: 全部通过
- 残留风险:
  - `fileMutations` 已有协议承载和 metadata 投影，但 shell 重定向/mv/cp 等真实底层 mutation 捕获会在后续执行器、diff 和 sandbox 条目继续补齐。
  - 旧 session 没有 `metadata.toolResult` 时按旧 message part 读取，不做迁移。

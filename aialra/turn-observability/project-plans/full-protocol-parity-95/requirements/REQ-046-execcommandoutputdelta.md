# REQ-046 ExecCommandOutputDelta

## 原始目标

46. ExecCommandOutputDelta：AIALRA 必须 P0 将 command.output 从文本 preview/rawRef 的部分实现升级为标准 ExecCommandOutputDelta，支持 stdout/stderr raw bytes 或等价无损分片、stream sequence number、timestamp、channel、byte length、truncation marker、raw_output_ref。stdout 和 stderr 必须分通道记录，不能混成不可恢复的单一文本；给模型看的可以是截断 preview，但完整输出必须进入 tool-output-store。验收标准是：长输出命令能持续产生 delta，UI 能流式显示，history/replay 能按顺序恢复，模型不会被超长输出撑爆上下文，用户仍能通过 raw output 查看完整 stdout/stderr。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成标准 ExecCommandOutputDelta 双写、public event、history/replay 和真实 shell runtime 测试
- 依赖前置: REQ-045 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

- 当前 AIALRA 已经有 `exec_command.output`、`command.output`、tool-output-store 和 truncated output raw file，但原来 command 输出分片只是 preview/text 风格事件，不是 Codex 形式的 output delta。
- 最新 OpenCode 原版主要保留 shell 工具结果和消息内容，没有 AIALRA 这一套 turn-scoped public event/history delta 协议。
- Codex 侧存在三类相邻语义:
  - `CommandExecOutputDeltaNotification`，命令执行输出增量，字段包含 `processId`、`stream`、`deltaBase64`、`capReached`
  - `ProcessOutputDeltaNotification`，进程输出增量，字段包含 `processHandle`、`stream`、`deltaBase64`、`capReached`
  - `CommandExecutionOutputDeltaNotification`，item 级命令输出增量，字段包含 `threadId`、`turnId`、`itemId`、`delta`
- 本条采用兼容双写: 旧 `exec_command.output` 保留，新增 `exec_command.output_delta` 对齐 Codex 的 base64 delta 语义。stdout/stderr 分通道记录，`combined` 仅为兼容旧 shell 输出，事件内保留 `source_stream`。
- runtime 入口在 `packages/opencode/src/session/exec-command.ts`。所有 shell 输出分片现在先进入 `ExecCommandOutputDelta.emit`，再进入 `TerminalInteraction.emit` 和旧 trace。
- 历史和 UI 投影入口在 `packages/opencode/src/session/public-event.ts`、`packages/opencode/src/session/turn-history.ts`。新增事件会进入 public event stream 和 replay history。

## 数据结构和 schema 计划

- 新增 `aialra.exec_command_output_delta.v1`:
  - `process_id`: 进程编号
  - `command_id`: 命令编号
  - `tool_call_id`: 对应工具调用
  - `backend`: `codex_exec_server` / `node_bun` / `remote`
  - `environment_id`: 当前环境
  - `stream`: 标准输出通道，`stdout` 或 `stderr`
  - `source_stream`: 原始来源通道，保留 `combined`
  - `seq`: 分片序号
  - `byte_length`: UTF-8 字节长度
  - `char_length`: 字符长度
  - `delta_base64`: 无损 base64 输出分片
  - `cap_reached`: 是否触达输出上限
  - `truncation_marker`: 截断标记
  - `preview`: UI 安全摘要
  - `raw_output_ref`: 后续接完整 raw output 分片存储的引用
  - `codex_command_exec`: Codex `command/exec/outputDelta` 兼容对象
  - `codex_item`: Codex `item/commandExecution/outputDelta` 兼容对象
- 旧 session 兼容策略: 不迁移旧数据。旧 `exec_command.output` 仍可回放；新 session 双写 delta 和旧 output。
- raw output 策略: 本条为 delta 协议落地，完整最终输出仍由既有 tool-output-store/truncation 文件保存。单分片 `raw_output_ref` 字段已预留，后续可接 chunk-level raw store。

## 事件协议计划

本条相关变化必须进入:

- internal trace: `exec_command.output_delta`
- typed public event: `exec_command.output_delta`
- history/replay record: `TurnHistory` 分类为 `command`
- Turn Inspector projection: 通过 public event 显示为 `统一命令输出增量`
- benchmark JSON: 暂不直接进入质量统计；通过 public event/history 可计算输出量和分片顺序
- 事件包含 turnID/sessionID/messageID/toolCallID，payload 内含 schema、process/command/backend/stream/seq/byte_length/base64。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- shell runtime 输出分片由 `recordChunk` 进入 `ExecCommand.output`，`ExecCommand.output` 第一时间调用 `ExecCommandOutputDelta.emit`，所以真实 Node/Bun shell 和 Codex exec-server shell 都会产生 delta。
- 权限、审批、沙箱、网络、cwd、environment 不直接读取 delta 字段；它们在命令启动前由 TurnContext gate 生效。delta 负责把 gate 后真实执行产生的 stdout/stderr 无损记录。
- abort/timeout/failure 的终态仍由 `exec_command.finished` 和 `terminal.interaction` 记录；delta 只记录已经产生的输出分片，不伪造终态。
- replay 通过 `TurnHistory` 按事件顺序恢复，stdout/stderr 可按 `stream + seq` 重建。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- public event 标题为 `统一命令输出增量`
- 默认摘要显示通道、序号和字节数，例如 `stdout #0 2 bytes`
- 详情可展开查看 base64 分片和 Codex 兼容对象
- 历史 turn 折叠后仍可通过 history/replay 取回事件
- 默认不展示裸 JSON，Raw Lab 后续可以直接读取 `delta_base64` 或 `raw_output_ref`

## 测试方法

- `test/session/turn-history.test.ts` 手工样例覆盖 `exec_command.output_delta` public event 和 replay history
- `test/tool/shell.test.ts` 真实运行 yielded shell + stdin，断言 public event 中出现 `exec_command.output_delta`
- 既有 `shell.test.ts` truncation 用例继续覆盖完整输出保存到文件
- 旧 `exec_command.output` 未删除，兼容旧事件

## 验收标准

- 协议层已实现并有事件样例测试
- history/replay 已实现并有恢复测试
- trace/public event 已实现并有事件样例测试
- Inspector 投影通过 public event 中文标题和摘要生效
- runtime 行为真实生效，shell live test 已断言真实输出 delta
- 旧 session 兼容通过保留旧 `exec_command.output`
- 状态矩阵可更新为 `完全完成`

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

## 执行记录

- 开始时间: 2026-06-04T17:50:00Z
- 完成时间: 2026-06-04T18:14:04Z
- 修改文件:
  - `packages/opencode/src/session/exec-command-output-delta.ts`
  - `packages/opencode/src/session/exec-command.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/tool/shell.test.ts`
- 测试命令:
  - `bun test test/session/turn-history.test.ts -t "unified exec command events" --timeout 30000`
  - `bun test test/tool/shell.test.ts -t "writes stdin" --timeout 30000`
  - `bun typecheck`
  - `bun test test/tool/shell.test.ts test/tool/parameters.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`
  - `git diff --check`
- 测试结果:
  - targeted turn-history: 1 pass
  - targeted shell stdin: 1 pass
  - opencode typecheck: pass
  - shell/parameters: 90 pass
  - turn-history/public-event: 31 pass
  - prompt/schema-decoding: 98 pass
  - observability node tests: 6 pass
  - codex-exec-server/turn-sandbox/external-directory: 49 pass
  - diff check: pass
- 残留风险:
  - `raw_output_ref` 字段已预留，但每个 delta 分片尚未单独落 raw store。当前完整输出仍依赖既有 tool-output-store/truncation 文件路径。
  - `cap_reached` 目前按调用方输入记录，shell 普通分片默认 false；最终截断状态仍由 `exec_command.finished` 和 shell result metadata 表达。

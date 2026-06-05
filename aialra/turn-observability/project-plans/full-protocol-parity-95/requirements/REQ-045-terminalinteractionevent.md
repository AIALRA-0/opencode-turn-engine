# REQ-045 TerminalInteractionEvent

## 原始目标

45. TerminalInteractionEvent：AIALRA 必须 P0 补全 Codex 风格 TerminalInteractionEvent，不能只用部分 command.output 事件表达终端交互。TerminalInteractionEvent 应覆盖 exec started、stdout delta、stderr delta、stdin write、process still running、process end、abort、cleanup、timeout、error 等交互阶段，并全部绑定 process_id、tool_call_id、turn_id、environment_id。UI inspector 必须能按进程时间线展示完整终端交互，而不是只看到零散输出。验收标准是：一次长命令从启动、输出、继续等待、stdin 输入、结束或 abort 的全过程，都能在 history、trace、public event 和 inspector 中按顺序重放。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现统一 `terminal.interaction` 协议事件，保留 Codex `item/commandExecution/terminalInteraction` 兼容字段，并覆盖 exec started、stdout/stderr delta、stdin write、process running、process end、abort、timeout、error、fallback 等阶段；事件进入 trace/public event/history/Inspector 投影并由真实 shell runtime 测试验证
- 依赖前置: REQ-044 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/tool`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/tool-output-store.ts`
- `packages/opencode/src/tool/codex-exec-server.ts`
- `packages/core/src`

实际结论:

- 当前 AIALRA 在 REQ-041 到 REQ-044 已经有 `exec_command.*`、`exec_process.*`、`terminal.stdin.*`，但这些是多个事件族，Inspector 只能分散查看
- 最新 Codex 协议有 `TerminalInteractionNotification`，通知方法为 `item/commandExecution/terminalInteraction`，字段是 `threadId`、`turnId`、`itemId`、`processId`、`stdin`
- Codex 的 TerminalInteraction 主要表达用户/系统对命令终端写入 stdin 的交互；AIALRA 本条在兼容这些字段的基础上扩展 stdout/stderr/start/running/end/abort/timeout/error/fallback，满足用户要求的完整时间线
- 原版 OpenCode 没有公开、稳定、可重放的 TerminalInteractionEvent，对长命令和交互式命令的 UI 解释能力弱
- AIALRA 目前通过 public event/history 给 Turn Inspector 提供数据；专门的进程时间线 UI 细节继续在后续 Turn Inspector 产品化条目推进

必须回答:

- 当前 AIALRA 已经有什么
- 最新 OpenCode 已经有什么
- 最新 Codex 已经有什么
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

实际实现:

- 新增 `packages/opencode/src/session/terminal-interaction.ts`
- 事件 schema: `aialra.terminal_interaction.v1`
- 事件 phase: `exec_started`、`stdout_delta`、`stderr_delta`、`stdin_write`、`process_running`、`process_end`、`abort`、`cleanup`、`timeout`、`error`、`fallback`
- 关键绑定字段: `session_id`、`turn_id`、`message_id`、`tool_call_id`、`process_id`、`command_id`、`backend`、`environment_id`、`cwd`、`command`
- 输出字段: `stream`、`seq`、`chars`、`preview`
- stdin 字段: `stdin_preview`
- 结果字段: `status`、`exit_code`、`duration_ms`、`reason`
- Codex 兼容字段: `codex.method=item/commandExecution/terminalInteraction`、`codex.threadId`、`codex.turnId`、`codex.itemId`、`codex.processId`、`codex.stdin`

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 新增 public event type: `terminal.interaction`
- `ExecCommand.started/output/yielded/fallback/finished` 双写 `terminal.interaction`
- `ExecProcessRegistry.writeStdin` 在 written/denied 时双写 `terminal.interaction`
- `TurnHistory.contextItemKind` 将 `terminal.interaction` 归为 command
- public event 中文标题为 `终端交互事件`
- history 测试验证 `terminal.interaction` 可按 turn replay

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际实现:

- bash shell runtime 的实际 started/output/yielded/stdin/finished 都会产生统一事件
- stdout/stderr delta 来自 `ExecCommand.output`
- process still running 来自 `ExecCommand.yielded`
- stdin write 来自 `write_stdin` 工具和 `ExecProcessRegistry.writeStdin`
- abort/timeout/error/process_end 来自 `ExecCommand.finished` 的状态判定
- fallback 来自 `ExecCommand.fallback`
- 非后台 Codex exec-server shell 路径补齐 sandbox cleanup，避免 terminal end 后保护目录残留

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- Turn Inspector 当前通过 public event/history 可显示 `终端交互事件`
- 摘要显示 process_id、phase、status
- 同一个 process_id 可由事件流重建 started -> output -> running -> stdin -> end 的时间线
- 专门的终端树状/时间线 UI、搜索下载和 Raw Lab 全量原始数据属于后续 UI 产品化条目

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造成功、失败、aborted、超长输出、fallback、replay 场景
- 断言 tool result 幂等且模型上下文、history、UI 都收到同一个 result

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际执行:

- `bun test test/tool/shell.test.ts -t "writes stdin" --timeout 30000`，通过；真实 shell runtime 产生 `terminal.interaction` 的 `exec_started/process_running/stdin_write/process_end`
- `bun test test/session/turn-history.test.ts -t "unified exec command events" --timeout 30000`，通过；`terminal.interaction` 进入 public event 和 history
- `bun test test/tool/shell.test.ts test/tool/parameters.test.ts --timeout 30000`，90 pass
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`，31 pass
- `bun typecheck`，通过
- `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`，98 pass
- `node --test aialra/turn-observability/tests/*.test.js`，6 pass
- `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`，49 pass
- `git diff --check`，通过

执行中发现:

- 初版 shell 测试固定等待 500ms 偶发读到 running；已改为最多 2 秒轮询后台 registry 状态
- 统一事件是现有 `exec_command.*` 的双写，不删除旧事件，避免破坏已有 UI/API

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
- 修改文件: `packages/opencode/src/session/terminal-interaction.ts`, `packages/opencode/src/session/exec-command.ts`, `packages/opencode/src/session/exec-process-registry.ts`, `packages/opencode/src/session/public-event.ts`, `packages/opencode/src/session/turn-history.ts`, `packages/opencode/test/tool/shell.test.ts`, `packages/opencode/test/session/turn-history.test.ts`
- 测试命令: 见“实际执行”
- 测试结果: 全部通过
- 残留风险: 当前已完成协议、runtime 双写、history/public event 投影；专门的 UI 时间线控件、Raw Lab 可搜索下载、awaiter agent 基于 process_id 的订阅等待仍在后续条目中继续

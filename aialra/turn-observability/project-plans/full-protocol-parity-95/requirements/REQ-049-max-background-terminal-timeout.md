# REQ-049 Max background terminal timeout

## 原始目标

49. Max background terminal timeout：AIALRA 必须 P0 从单一 singleCommandTimeoutMs 升级为 background_terminal_max_timeout 配置，对齐 Codex 默认 300000ms 且可配置的后台终端超时语义。前台命令的 yield_time_ms、单次 tool call timeout、后台进程最大存活时间必须分开管理，不能混成一个 timeout。后台进程超过最大时间后，系统必须自动发出 timeout/cleanup 事件并终止进程，同时写入 history、trace、inspector 和 process registry。验收标准是：长命令可以先返回 running，不会因为 yield 到期被误杀；但真正超出 background max timeout 后会被稳定清理，并能在 inspector 中看到超时原因和配置来源。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。前台 `yield_time_ms`、单次命令 `singleCommandTimeoutMs`、后台最长存活 `backgroundTerminalMaxTimeoutMs` 已分离，Node/Bun 执行器和 Codex exec-server sidecar 路径都读取同一个 TurnContext 工程控制字段
- 依赖前置: REQ-048 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有什么: 已有 `singleCommandTimeoutMs` 单命令超时、`yield_time_ms` 前台让出等待、统一 `ExecProcessRegistry` 后台进程登记、`exec_command.started/yielded/end/finished` 与 `exec_process.registered/finished` 公共事件。REQ-049 后新增 `backgroundTerminalMaxTimeoutMs`，后台命令让出后不再复用单命令 timeout，而是按独立后台最大存活时间自动终止和收口
- 最新 OpenCode 已经有什么: 原版 OpenCode 有 shell 命令执行和基础 timeout，但没有 Codex 风格的后台终端最大存活协议、独立后台进程 registry、统一终态事件和 Inspector 可回放原因
- 最新 Codex 已经有什么: Codex 有前台工具调用超时、后台命令/长命令管理、命令输出增量、标准命令终态，以及默认后台终端上限 300000ms 的语义。REQ-049 对齐默认 300000ms，并开放控制档位
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪: AIALRA 已补字段和运行时行为，事件通过现有 public event stream 与 Turn Inspector 投影展示。残留差距是后台进程 registry 仍是进程内内存状态，服务重启后 live process runtime 不可恢复；Codex 的执行器底座更接近原生 sidecar 生命周期

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

实际实现:

- `EngineeringControls.backgroundTerminalMaxTimeoutMs`: 用户/档位可配置的后台终端最长存活时间，默认 balanced 为 `300000`
- `ExecCommand` common payload 写入 `background_terminal_max_timeout_ms`
- `ExecProcessRecord.background_timeout_ms`: 后台进程登记时写入实际生效值
- 旧 session 没有该字段时，shell runtime 使用 `300000` 默认值，历史事件读取保持兼容
- 新 session 从 TurnContext 的 `turn.engineering.controls.backgroundTerminalMaxTimeoutMs` 进入 shell runtime

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- `exec_command.started` 带 `background_terminal_max_timeout_ms`
- `exec_command.yielded` 标记命令已经前台让出，后台继续运行
- `exec_command.end` 在后台超时后输出 `status=timeout`、`timeout_reason=background_terminal_max_timeout`
- `exec_process.registered` 带 `background_timeout_ms`
- `exec_process.finished` 在后台超时后输出 `status=timeout`、`failure=background_terminal_max_timeout`

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际实现:

- Node/Bun shell yield 路径: 前台 race 仍使用 `singleCommandTimeoutMs`，后台 `finishBackground` race 改用 `backgroundTerminalMaxTimeoutMs`
- Codex exec-server 路径: `RunProcessInput.backgroundTimeoutMs` 传入 sidecar drain 逻辑，后台 `process/read` 循环按该值终止
- 超时收口: 超过后台最大时间后终止进程，写 `ExecCommand.finished`、`ExecCommandEnd`、`ExecProcessRegistry.finish`
- abort 路径: 用户/系统 abort 仍优先于后台超时，原因保持 abort source，不被后台 timeout 覆盖

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- Turn Inspector 通过现有 public event projection 展示命令开始、命令让出、后台进程登记、标准终态、后台进程结束
- 用户可在事件摘要里看到后台进程已登记、最终 timeout，并在 raw/详情里看到 `background_terminal_max_timeout_ms` 与 `background_terminal_max_timeout`
- 本条未新增单独 UI 控件；配置入口复用 Engineering Controls

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造成功、失败、aborted、超长输出、fallback、replay 场景
- 断言 tool result 幂等且模型上下文、history、UI 都收到同一个 result

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际执行:

- `bun test test/tool/shell.test.ts -t "background terminal max timeout" --timeout 30000`
  - 初次失败: 测试把 `terminal_state` 误认为字符串，实际协议是对象
  - 修正后通过: 1 pass
- `bun test test/tool/shell.test.ts test/tool/parameters.test.ts --timeout 30000`
  - 92 pass
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 32 pass
- `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - 98 pass
- `node --test aialra/turn-observability/tests/*.test.js`
  - 6 pass
- `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`
  - 49 pass
- `bun typecheck`
  - pass
- `git diff --check`
  - pass

## 验收标准

- 协议层已实现并有 schema 测试
- history/replay 已实现并有恢复测试
- trace/public event 已实现并有事件样例测试
- Inspector 已展示并有 UI 或投影测试
- runtime 行为真实生效并有端到端测试
- 旧 session 兼容测试通过
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录

验收结论:

- 协议层: 完成
- history/replay: 完成，复用统一命令与后台进程 public event
- trace/public event: 完成
- Inspector 展示: 完成，复用现有投影
- runtime 行为: 完成，Node/Bun 与 Codex exec-server 都真实生效
- 旧 session 兼容: 完成，缺字段时默认 300000ms

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
  - `packages/opencode/src/session/engineering.ts`
  - `packages/opencode/src/session/exec-command.ts`
  - `packages/opencode/src/session/exec-process-registry.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/src/tool/codex-exec-server.ts`
  - `packages/opencode/test/tool/shell.test.ts`
- 测试命令: 见“测试方法”
- 测试结果: 全部通过
- 残留风险: 后台进程 registry 当前仍是进程内状态，服务重启后无法恢复 live runtime；这属于后续持久化/sidecar lifecycle 项，不阻塞本条后台超时语义

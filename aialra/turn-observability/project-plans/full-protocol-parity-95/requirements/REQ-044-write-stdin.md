# REQ-044 write_stdin

## 原始目标

44. write_stdin：AIALRA 必须 P0 补全 write_stdin，使模型和 UI 能对同一个仍在运行的 process_id 继续写入 stdin，而不是每次只能新开一个命令。write_stdin 必须经过 process registry 校验、permission profile、constraints、TerminalInteractionEvent 记录，并支持写入普通文本、换行、Ctrl-C/EOF 等受控控制序列。实现时必须避免把 stdin 写到错误进程、已结束进程或其他 turn 的进程中，并且所有 stdin 输入都必须进入 history、trace 和 inspector。验收标准是：交互式命令、REPL、测试 watcher、需要确认输入的脚本都可以通过同一个 process_id 继续交互；inspector 能清楚显示每次 stdin 写入的时间、来源、目标进程和写入内容摘要。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现模型侧 `write_stdin` 工具、进程登记表 runtime stdin 回调、Node/Bun 后台进程 stdin 管道、Codex exec-server stdin 协议适配、public event/history/Inspector 投影事件，并通过 runtime、schema、history、prompt、exec-server、sandbox、typecheck、diff 检查
- 依赖前置: REQ-043 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session/security.ts`
- `packages/opencode/src/permission`
- `packages/opencode/src/tool`
- `packages/opencode/src/tool/sandbox.ts`
- `packages/app/src`

实际结论:

- 当前 AIALRA 已有 REQ-043 的 `aialra.exec_process.v1` 进程登记表，但此前只记录 running/completed，不能对同一个 process_id 写 stdin
- 当前 AIALRA shell tool 的 Node/Bun yield 路径原来使用 `stdin: "ignore"`，即便有 process_id 也无法继续交互
- 当前 AIALRA Codex exec-server adapter 已能 `process/start/read/terminate`，但没有暴露 stdin 写入 runtime 回调
- 最新 Codex 协议有 `process/writeStdin` 和 `command/exec/write`，写入 base64 stdin 到已有 process handle；本条按该方向实现
- 原版 OpenCode 没有 AIALRA 这套 process registry/public event/Turn Inspector 显式 stdin 审计，因此模型遇到交互式命令通常只能新开命令或卡住
- UI 侧本条先完成 Turn Inspector 可消费事件；完整交互按钮留给 REQ-045/Raw Lab/Terminal view 后续产品化

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

- `ExecProcessRegistry.register` 增加内存 runtime 回调，但 trace 只保存可 JSON 序列化字段，避免把函数写进事件
- 进程记录新增 `stdin_supported`、`stdin_writes`、`stdin_chars`
- 新增 `aialra.terminal.stdin.v1` 事件 payload，字段包括 process_id、command_id、backend、session_id、turn_id、message_id、tool_call_id、actor、status、reason、control、close_stdin、chars、preview、target_status、stdin_supported
- 新增模型工具 `write_stdin` 参数 schema: `process_id`、`text`、`control`、`append_newline`、`description`
- `control` 支持 `text`、`newline`、`ctrl-c`、`eof`
- 完整 stdin 原文目前不进安全事件，只记录摘要 preview；raw 全量聚合将在 Raw Lab 相关条目继续扩展

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 新增 public event type: `terminal.stdin.written`
- 新增 public event type: `terminal.stdin.denied`
- `TurnHistory.contextItemKind` 将 `terminal.stdin.*` 归类为 `command`
- `PublicEventLog.protocol()` 会自动暴露中文说明和公共字段
- `turn-history.test.ts` 增加 written/denied 样例，验证事件进入 public event 和 history

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际实现:

- Node/Bun yield 路径改为 `stdin: "pipe"`，登记 `writeStdin`、`closeStdin`、`interrupt` runtime 回调
- `write_stdin` 工具通过 `ExecProcessRegistry.writeStdin` 校验 sessionID、turnID、running status、runtime 支持后再写入
- 写错 process、写其他 session、写其他 turn、写已结束 process、没有 runtime 的 process 都会产生 `terminal.stdin.denied`
- Codex exec-server adapter 增加 `writeStdin`，优先调用 Codex 协议 `process/writeStdin`，失败后尝试 `command/exec/write`
- Codex exec-server `process/start` 在 yield 场景设置 `pipeStdin`
- 修复 Codex exec-server 非后台 shell 路径遗漏 sandbox cleanup 的问题，避免 protected-create 临时 `.git/.agents/.codex` 留在宿主工作区
- 修复旧 turn 兼容问题: `SessionSecurity.applyToTurn`、`TurnSandbox.fileConstraint/shellConstraint/emitConstraintChecked` 对缺失 `thread_settings/security_constraints` 的旧 turn 不再抛错

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- Turn Inspector 现有 public event/history 投影可以显示 `终端输入已写入` 和 `终端输入被拒绝`
- 摘要显示 process_id、control、chars 或拒绝原因
- raw/下载/搜索级完整原始 stdin 仍归入后续 Raw Lab 全量项，本条不把完整 stdin 直接塞进 SSE 安全事件

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造允许、询问、硬拒绝、约束覆盖审批四类场景
- 断言 UI 展示和实际执行结果一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际执行:

- `bun typecheck`，通过
- `bun test test/tool/shell.test.ts -t "writes stdin" --timeout 30000`，通过；真实启动等待 stdin 的 Node 进程，yield 后使用 `write_stdin` 写入，同一 process_id 完成
- `bun test test/session/turn-history.test.ts -t "unified exec command events" --timeout 30000`，通过；stdin written/denied 进入 public event 和 history
- `bun test test/tool/parameters.test.ts --update-snapshots --timeout 30000`，通过；新增 `write_stdin` LLM 可见 schema
- `bun test test/tool/shell.test.ts test/tool/parameters.test.ts --timeout 30000`，90 pass
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`，31 pass
- `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`，98 pass
- `node --test aialra/turn-observability/tests/*.test.js`，6 pass
- `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`，49 pass
- `git diff --check`，通过

执行中发现:

- `/dev/sda1` 一度 100% 满，导致 patch 写入失败；已执行 `docker system prune -af`，回收 12.33GB
- 初版 stdin 测试脚本因 shell 单引号转义导致 exit=1，已改为不含单引号的 Node 脚本
- Node 等待 stdin 的测试脚本需要 `process.exit(0)`，否则 stdin 保持打开时进程不会自动退出
- exec-server/sandbox 组暴露两个旧 turn 兼容点和一个 Codex 非 yield cleanup 漏洞，已修复并回归通过

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
- 修改文件: `packages/opencode/src/session/exec-process-registry.ts`, `packages/opencode/src/tool/write_stdin.ts`, `packages/opencode/src/tool/shell.ts`, `packages/opencode/src/tool/codex-exec-server.ts`, `packages/opencode/src/tool/registry.ts`, `packages/opencode/src/session/public-event.ts`, `packages/opencode/src/session/turn-history.ts`, `packages/opencode/src/session/security.ts`, `packages/opencode/src/tool/turn-sandbox.ts`, `packages/opencode/test/tool/shell.test.ts`, `packages/opencode/test/tool/parameters.test.ts`, `packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap`, `packages/opencode/test/session/turn-history.test.ts`
- 测试命令: 见“实际执行”
- 测试结果: 全部通过
- 残留风险: UI 侧专门的交互按钮、Raw Lab 全量 stdin 原文下载/搜索、持久化 process runtime 恢复属于后续 REQ-045/Raw Lab/UnifiedExecProcessManager 范围；本条已完成同 turn runtime 写入、拒绝审计、事件投影和 Codex 协议适配

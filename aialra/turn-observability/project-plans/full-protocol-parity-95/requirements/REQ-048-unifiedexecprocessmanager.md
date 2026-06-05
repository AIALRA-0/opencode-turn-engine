# REQ-048 UnifiedExecProcessManager

## 原始目标

48. UnifiedExecProcessManager：AIALRA 必须 P0 实现 UnifiedExecProcessManager 或等价的 live process registry，用来保存、查询、交互、中止和清理所有尚未结束的 exec process。当前缺少持久 process registry，导致 adapter 内部持有进程但模型/UI 不可见，也无法跨事件继续操作。新的 process manager 必须记录 process_id、environment_id、cwd、command、pid/pty id、status、started_at、last_output_at、last_interaction_at、owner turn、tool_call_id、timeout、background flag、output refs，并提供 read、write_stdin、abort、cleanup、list_live_processes 接口。验收标准是：长命令返回后不会丢失进程控制权；刷新 UI、继续 turn 或恢复 session 时，仍能看到 live process 的状态和可执行操作。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成 live process manager 的 read、write_stdin、abort、cleanup、list_live_processes、runtime pid/pty、output refs、public event 和真实 shell 测试
- 依赖前置: REQ-047 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

- 当前 AIALRA 原来已有 `ExecProcessRegistry`，可登记 yielded shell、查询 `get/list`、写 stdin，但还缺少完整 manager 语义，例如 abort、cleanup、live list、pid/pty、background、output refs、终态防覆盖。
- OpenCode 原版没有 AIALRA 这套 turn-scoped live process manager；长命令主要通过 shell tool 生命周期和 session busy 状态处理。
- Codex 的 exec-server 模型有 process handle、read/write/terminate 等长期进程控制语义。AIALRA 本条把 Node/Bun shell 和 Codex exec-server shell 都统一到 `ExecProcessRegistry` 这个 manager。
- 当前差距:
  - 本条是进程内 live registry，不是跨服务重启持久化数据库。服务重启后不能恢复 OS 级 runtime handle。
  - Codex exec-server 没暴露本机 pid，AIALRA 用 process handle 写入 `pty_id`。
  - UI 可以通过 public event/history 观察，HTTP 查询 live processes 的正式 endpoint 可作为后续产品化项。

## 数据结构和 schema 计划

- 扩展 `aialra.exec_process.v1`:
  - `pid`: Node/Bun 本机进程 id
  - `pty_id`: Codex exec-server process handle 或 PTY id
  - `background`: 是否是后台进程
  - `last_output_at`: 最后输出时间
  - `output_refs`: 完整输出文件引用列表
  - `cleanup_at`: manager 清理时间
- 新增 manager 事件:
  - `exec_process.abort_requested`
  - `exec_process.abort_denied`
  - `exec_process.finish_ignored`
  - `exec_process.cleanup`
- 新增接口:
  - `read(processID, { sessionID, turnID })`
  - `listLiveProcesses({ sessionID, turnID })`
  - `abort(processID, input)`
  - `cleanup(input)`
  - `addOutputRef(processID, ref)`
- 旧 session 兼容策略: 老 `exec_process.registered/finished` 没有新字段时仍能读取；新字段都是可选或有默认值。

## 事件协议计划

本条相关变化必须进入:

- internal trace:
  - `exec_process.registered`
  - `exec_process.finished`
  - `exec_process.finish_ignored`
  - `exec_process.abort_requested`
  - `exec_process.abort_denied`
  - `exec_process.cleanup`
- typed public event: 上述事件均进入 public event stream。
- history/replay record: 通过 `TurnHistory` command context item 记录。
- Turn Inspector projection:
  - `后台进程已登记`
  - `后台进程已结束`
  - `后台进程重复终态已忽略`
  - `后台进程请求中止`
  - `后台进程中止被拒绝`
  - `后台进程记录已清理`
- benchmark JSON: 后续可读取 live process/end event 判断长命令是否丢失控制权；本条不直接改 runner。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- shell yielded path 调用 `ExecProcessRegistry.register`，登记 pid/pty、cwd、command、timeout、yield time、output refs 和 runtime callbacks。
- `write_stdin` 工具继续使用 manager 的 `writeStdin`。
- 新增 `abort` 使用 runtime 的 hard `abort`，而不是 `ctrl-c` 的 soft `interrupt`，避免 shell 收到 SIGINT 后继续执行后续命令。
- `finish` 对非 running 记录不会覆盖终态，而是发 `exec_process.finish_ignored`。
- `cleanup` 会移除 runtime handle 并记录 cleanup 时间，避免 UI 和模型误以为仍可操作。
- 权限、审批、沙箱、网络、cwd、environment 在命令启动前由 TurnContext gate 生效；manager 持有执行后可操作状态。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- Inspector 通过 public events 显示:
  - 进程是否 running/completed/aborted/timeout/failed
  - process id、pid/pty id、cwd、command、后台状态、最后输出时间
  - abort requested/denied 原因
  - cleanup 清理了哪些 process id
  - finish ignored 为什么忽略后来的终态
- 默认中文摘要，不展示裸 JSON。Raw Lab 可展开完整 record。

## 测试方法

- `test/tool/shell.test.ts`
  - `returns a running process when yield_time_ms elapses before command exit` 断言 `read/listLiveProcesses/background/pid/cwd/command`
  - `aborts and cleans up a yielded process through the unified process manager` 断言 manager abort、exec_command.end aborted、cleanup event
  - `writes stdin to a yielded process_id` 继续覆盖 write stdin
- `test/server/httpapi-public-event.test.ts` 协议测试覆盖新增 public event 类型。
- `test/session/turn-history.test.ts` 继续覆盖 exec process replay。

## 验收标准

- 协议层已实现并有 public event registry 测试
- history/replay 已实现并有恢复测试
- trace/public event 已实现并有 shell runtime 事件测试
- Inspector 投影通过 public event 中文标题、status、summary 生效
- runtime 行为真实生效，shell yielded process 可 read/list/abort/cleanup/write_stdin
- 旧 session 兼容通过可选字段和旧事件保留
- 状态矩阵可更新为 `完全完成`

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

## 执行记录

- 开始时间: 2026-06-04T18:26:00Z
- 完成时间: 2026-06-04T18:37:23Z
- 修改文件:
  - `packages/opencode/src/session/exec-process-registry.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/src/tool/codex-exec-server.ts`
  - `packages/opencode/test/tool/shell.test.ts`
- 测试命令:
  - `bun test test/tool/shell.test.ts -t "process manager" --timeout 30000`
  - `bun test test/server/httpapi-public-event.test.ts -t "protocol" --timeout 30000`
  - `bun typecheck`
  - `bun test test/tool/shell.test.ts test/tool/parameters.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`
  - `git diff --check`
- 测试结果:
  - targeted shell process manager: 1 pass
  - public event protocol: 2 pass
  - opencode typecheck: pass
  - shell/parameters: 91 pass
  - turn-history/public-event: 32 pass
  - prompt/schema-decoding: 98 pass
  - observability node tests: 6 pass
  - codex-exec-server/turn-sandbox/external-directory: 49 pass
  - diff check: pass
- 残留风险:
  - manager 是服务进程内 live registry，服务重启后不会恢复 runtime handle。
  - UI/HTTP 直接查询 live process 的产品 endpoint 尚未单独实现；当前通过 public events/history 和内部 manager API 验证。

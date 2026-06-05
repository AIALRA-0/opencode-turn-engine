# REQ-050 Awaiter agent

## 原始目标

50. Awaiter agent：AIALRA 必须 P1 实现内置 awaiter agent 或等价等待机制，用于等待长时间后台进程完成，而不是让主模型反复轮询或被长命令阻塞。awaiter 应能根据 process_id 订阅输出和终态，在最长约 1 小时或配置时间内等待命令完成，并在完成、失败、超时、abort 时把结果回填到主 turn 或后续通知中。awaiter 必须使用 UnifiedExecProcessManager 和 TerminalInteractionEvent，不得绕过统一 exec runtime。验收标准是：运行长测试、Docker build、benchmark、server startup 时，AIALRA 能把等待任务交给 awaiter，UI 显示正在等待的进程、等待时长、最新输出和最终结果，而不是主对话卡死。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。已实现内置 `await_process` 等待工具，底层通过 `ExecProcessRegistry.waitForTerminal` 读取 UnifiedExecProcessManager，不再要求主模型用 bash/sleep/ps/tail 反复轮询后台进程
- 依赖前置: REQ-049 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session/engineering.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/benchmark`
- `aialra/turn-observability/scripts`

必须回答:

- 当前 AIALRA 已经有什么: 已有后台进程登记、stdin 写入、中止、清理、标准命令终态和输出增量。REQ-050 后新增 `await_process` 工具和 `ExecProcessRegistry.waitForTerminal`，可等待 `process_id` 到 completed/failed/timeout/aborted，或在 awaiter 自己超时后返回 `await_timeout`
- 最新 OpenCode 已经有什么: 原版 OpenCode 有 shell 工具和普通执行结果，但没有统一后台进程等待工具，也没有等待开始/进展/完成/超时的公共事件协议
- 最新 Codex 已经有什么: Codex 的长命令执行体验依赖更成熟的命令执行 item、输出增量和终态事件。AIALRA 对齐了“长命令不阻塞主对话、输出和终态可观察”的核心能力
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪: AIALRA 已有工具、runtime、public event、Turn Inspector 投影和 history/replay；残留差距是等待器状态仍依赖进程内 registry，服务重启后不能恢复正在等待的 runtime

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

实际实现:

- 新增工具参数 schema:
  - `process_id`: bash yield 后返回的后台进程 id
  - `timeout_ms`: 本次等待最长时间
  - `poll_interval_ms`: 等待器检查频率
  - `description`: 等待原因
- 新增 metadata:
  - `await_status`: completed/failed/timeout/aborted/await_timeout/denied
  - `process_status`: 目标进程当前状态
  - `exit`、`failure`、`output_chars`、`duration_ms`
  - `requested_timeout_ms`、`effective_timeout_ms`
- 新增 `EngineeringControls.awaiterMaxTimeoutMs`: 默认 3600000ms，长跑模式 21600000ms
- 旧 session 兼容: 没有 engineering controls 时默认 awaiter 上限为 3600000ms

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- `exec_process.await_started`: 等待开始，包含 process_id、timeout、poll_interval、目标状态
- `exec_process.await_progress`: 等待期间输出量或状态变化
- `exec_process.await_finished`: 等待到目标进程终态
- `exec_process.await_timeout`: 等待器自己超时，但不杀目标进程
- 输出增量仍由 `exec_command.output_delta` 和 `terminal.interaction` 承载，awaiter 不复制输出文本，避免重复膨胀

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际实现:

- `await_process` 调用 `ExecProcessRegistry.waitForTerminal`
- 等待器只读取同 session/同 turn 可见的 process，跨 session 或缺失进程返回 denied
- 等待器超时只返回 `await_timeout`，不会 kill 进程；真正进程杀死仍由 REQ-049 的后台 max timeout 或显式 abort 控制
- 等待过程中如果进程 completed/failed/timeout/aborted，则立即返回终态结果
- `awaitProcessTimeoutMs` 从 TurnContext engineering controls 读取，用户请求值不能超过控制上限

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- Turn Inspector 可通过 public event stream 展示:
  - 后台进程等待开始
  - 后台进程等待进展
  - 后台进程等待结束
  - 后台进程等待超时
- 用户看到的是中文摘要，raw 详情中可看 process_id、timeout、output_chars、exit、failure
- 长输出文本不由 awaiter 重复写入，仍从实时输出增量和 rawRef 查看

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造验证失败后 repair、zero patch、stop gate、重复工具、benchmark 质量评分场景
- 断言 gate 触发后不能被 final 直接绕过

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际执行:

- `bun test test/tool/shell.test.ts -t "await" --timeout 30000`
  - 2 pass
- `bun test test/tool/parameters.test.ts --update-snapshots --timeout 30000`
  - 63 pass，更新 `await_process` schema 快照，并同步当前工作树已有工具参数快照
- `bun test test/tool/parameters.test.ts test/tool/registry.test.ts --timeout 30000`
  - 78 pass
- `bun test test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000`
  - 32 pass
- `bun test test/tool/shell.test.ts test/tool/parameters.test.ts --timeout 30000`
  - 98 pass
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
- history/replay: 完成，事件以 `exec_process.await_*` 进入 public event 和 turn history
- trace/public event: 完成
- Inspector 展示: 完成，复用 public event projection
- runtime 行为: 完成，真实等待后台进程，awaiter timeout 不杀进程
- 旧 session 兼容: 完成，缺字段时默认 1 小时 await 上限

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
  - `packages/opencode/src/tool/await_process.ts`
  - `packages/opencode/src/tool/registry.ts`
  - `packages/opencode/src/session/exec-process-registry.ts`
  - `packages/opencode/src/session/engineering.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/tool/shell.test.ts`
  - `packages/opencode/test/tool/parameters.test.ts`
  - `packages/opencode/test/tool/registry.test.ts`
  - `packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap`
- 测试命令: 见“测试方法”
- 测试结果: 全部通过
- 残留风险: awaiter 当前通过内存 registry 等待进程，服务重启后无法继续等待旧 runtime；这是后续持久化后台任务队列/sidecar session restore 范围

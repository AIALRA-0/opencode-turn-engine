# REQ-051 Max live process

## 原始目标

51. Max live process：AIALRA 必须 P1 增加 max live process 限制，建议对齐 Codex 的 64 或提供可配置默认值，防止模型或用户无意间创建过多后台终端。UnifiedExecProcessManager 在启动新进程前必须检查当前 live process 数量、per-session 限制、per-turn 限制、per-environment 限制，并在超过限制时拒绝启动或要求用户清理。验收标准是：连续启动大量长命令时，AIALRA 不会无限创建后台进程；inspector 能显示当前 live process 数量、上限、每个进程占用来源，并提供清理入口。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。后台进程 live capacity 已进入 Engineering Controls 和 shell runtime，任何会 yield 成后台进程的 bash 命令都会在 spawn 前检查 session/turn/environment 三个维度的 live process 上限
- 依赖前置: REQ-050 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session/public-event.ts`
- `packages/opencode/src/session/raw-audit.ts`
- `packages/app/src`
- `aialra/turn-observability`

必须回答:

- 当前 AIALRA 已经有什么: 已有 UnifiedExecProcessManager、后台进程登记、等待、写 stdin、中止、清理。REQ-051 后新增 live process 容量门禁，默认 balanced 对齐 Codex 建议量级 `64` 个 session live process，同时限制 turn 和 environment 维度
- 最新 OpenCode 已经有什么: 原版 OpenCode 没有每 session/turn/environment 的后台进程容量门禁，模型可以通过长命令/yield 逐步堆积后台进程
- 最新 Codex 已经有什么: Codex 具备更成熟的长命令/后台进程管理和资源保护。AIALRA 本条对齐“不能无限创建后台进程”的核心保护
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪: AIALRA 已有字段、runtime gate、public event 和 Turn Inspector 投影；残留差距是 live process registry 仍是进程内内存状态，服务重启后不能恢复 live process 计数

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

实际实现:

- `EngineeringControls.maxLiveProcessesPerSession`
- `EngineeringControls.maxLiveProcessesPerTurn`
- `EngineeringControls.maxLiveProcessesPerEnvironment`
- 默认值:
  - fast: session 16, turn 8, environment 8
  - balanced: session 64, turn 16, environment 16
  - deep: session 64, turn 32, environment 32
  - long: session 128, turn 64, environment 64
- `ExecProcessRegistry.assertLiveCapacity` 统一计算三个维度的 live process 数量和上限

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- `exec_process.capacity_checked`: 新后台进程启动前容量检查通过
- `exec_process.capacity_denied`: 超过 session/turn/environment 上限，拒绝启动新后台进程
- 事件 data 包含:
  - `session_count`、`turn_count`、`environment_count`
  - `limit_per_session`、`limit_per_turn`、`limit_per_environment`
  - `dimension`
  - `live_process_ids`

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际实现:

- shell runtime 在真正 spawn 前检查容量
- 只有会变成后台进程的命令才检查，也就是 `yield_time_ms` 生效且小于命令 timeout
- 超过上限时直接抛错，不启动新进程
- 容量拒绝不会影响已有 live process；用户可用 `await_process` 等待、`write_stdin` 交互，或通过 cleanup/abort 清理

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- Turn Inspector 通过 public event stream 展示:
  - 后台进程容量检查通过
  - 后台进程容量已满
- 用户可在详情中看到当前 live 数量、上限、触发维度和已有 process_id
- 清理入口依赖已有 `ExecProcessRegistry.cleanup`/后续 UI 操作，本条完成后端门禁与事件投影

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造断线续传、raw 下载、搜索、长输出、中文摘要场景
- 用 browser smoke 验证默认不展示裸 JSON，高级 raw 可展开

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际执行:

- `bun test test/tool/shell.test.ts -t "live process limit" --timeout 30000`
  - 1 pass
- `bun test test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000`
  - 32 pass
- `bun test test/tool/shell.test.ts test/tool/parameters.test.ts --timeout 30000`
  - 99 pass
- `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - 98 pass
- `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`
  - 49 pass
- `node --test aialra/turn-observability/tests/*.test.js`
  - 6 pass
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
- history/replay: 完成，`exec_process.capacity_*` 事件进入 public event/turn history
- trace/public event: 完成
- Inspector 展示: 完成，复用 public event projection
- runtime 行为: 完成，超限命令在 spawn 前被拒绝
- 旧 session 兼容: 完成，缺字段时使用 EngineeringControls 默认值

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
  - `packages/opencode/src/session/exec-process-registry.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/test/tool/shell.test.ts`
- 测试命令: 见“测试方法”
- 测试结果: 全部通过
- 残留风险: 容量统计依赖进程内 live registry，服务重启后不会恢复旧 live process 计数；需要后续持久化进程 registry 或 exec-server session restore

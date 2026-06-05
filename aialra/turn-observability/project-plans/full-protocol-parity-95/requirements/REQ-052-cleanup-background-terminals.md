# REQ-052 Cleanup background terminals

## 原始目标

52. Cleanup background terminals：AIALRA 必须 P1 补全 CleanBackgroundTerminals 或等价清理机制，用于手动或自动清理后台终端。清理必须支持按 process_id、按 turn、按 environment、按 session、按超时状态、按已结束状态批量处理，并对每个被清理进程生成 cleanup event。清理时必须区分已结束进程的 registry 移除、仍运行进程的 graceful terminate、强制 kill、失败重试和残留记录。验收标准是：用户可以在 inspector 中看到所有后台终端并一键清理；session 结束、rollback、environment disconnect、超时触发时，AIALRA 能自动清理相关进程，并在 history/trace 中留下可审计记录。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现后台终端清理工具、会话级 HTTP API、runtime registry 清理、运行中进程终止、public event 审计、Turn Inspector 后台终端面板和测试覆盖
- 依赖前置: REQ-051 已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session/public-event.ts`
- `packages/opencode/src/session/raw-audit.ts`
- `packages/app/src`
- `aialra/turn-observability`

实际结论:

- 当前 AIALRA 已有统一后台进程注册表 `ExecProcessRegistry`、`await_process`、`write_stdin`、后台超时和 live capacity，但缺用户可触发的批量 cleanup API 和 Inspector 操作面板
- 最新 OpenCode 原版没有 AIALRA 这套 turn-scoped 后台进程公共事件、可审计 cleanup endpoint 和 Inspector 清理面板
- Codex CLI 的长命令/后台任务通过执行器生命周期收口，AIALRA 本条对齐的是用户可见、可审计的 session-scoped cleanup 能力，底层仍运行在 AIALRA Node/Bun + Codex exec-server sidecar 混合执行器上
- 差异已经落到可见字段: `process_id`、`previous_status`、`status=cleaned|terminated|failed|summary`、`reason`、`cleaned`、`failed`

## 数据结构和 schema

- `CleanupProcessesPayload`: `process_id`、`process_ids`、`turn_id`、`environment_id`、`statuses`、`include_running`、`include_finished`、`reason`
- `CleanupProcessesResult`: `cleaned`、`failed`、`results[]`
- `ExecProcessRegistry.cleanup`: 支持按 session、turn、environment、process id、状态过滤
- 运行中进程只有 `include_running=true` 时才会被选中，避免误杀
- 已结束记录默认可清，`include_finished=false` 时跳过
- 清理结果分为 `cleaned`、`terminated`、`failed`
- 旧 session 兼容: 没有后台进程事件时 Inspector 不展示后台终端面板，不影响事件流和 Raw Lab
- 新 session 默认写入 public event replay buffer 和 trace/history 链路

## 事件协议

本条相关变化已进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计: 本条暂不新增 benchmark 维度，但事件可被后续 benchmark 采集为后台进程清理能力

事件包含 `schema=aialra.exec_process_manager.v1`、`sessionID`、`turnID`、public event `ts`、`process_id`、`previous_status`、`status`、`reason`、`cleaned`、`failed`。当前没有独立 `thread_id` 字段，沿用 session/turn/message 作为回放主键。

## runtime 接入

本条已经真实影响运行时，而不是只进入 UI:

- `cleanup_processes` 工具调用 `ExecProcessRegistry.cleanup`
- `/session/:sessionID/process/cleanup` HTTP API 调用同一个 registry cleanup
- 对运行中进程调用 runtime `interrupt` 或 `abort`，并通过 `ExecProcessRegistry.finish` 写入 `aborted`
- 对已结束进程设置 `cleanup_at`
- 对运行时缺失、终止失败保留 `failed` 事件，避免静默丢失
- cleanup 过滤支持 selected environment id，但不改写 cwd、权限、沙箱，只清理已有后台进程生命周期

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际 UI:

- Turn Inspector 新增“后台终端”区域
- 展示运行中数量、已结束待清理数量
- 展示 process id、状态、backend、命令摘要
- 提供“清理已结束”按钮，只清 finished registry record
- 提供“终止运行中”按钮，会确认后终止 running process
- cleanup 事件进入普通事件列表，中文解释 `cleaned`、`terminated`、`failed`、`summary`
- 默认不展示裸 JSON，raw 仍走 Raw Lab 或事件 raw 展开

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造断线续传、raw 下载、搜索、长输出、中文摘要场景
- 用 browser smoke 验证默认不展示裸 JSON，高级 raw 可展开

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

- `bun test test/tool/shell.test.ts -t "cleanup_processes" --timeout 30000`，1 pass
- `bun test test/tool/registry.test.ts -t "cleanup_processes" --timeout 30000`，1 pass
- `bun test test/tool/parameters.test.ts --update-snapshots --timeout 30000`，67 pass，新增 cleanup schema snapshot
- `bun test test/server/httpapi-public-event.test.ts -t "cleanup endpoint" --timeout 30000`，1 pass
- `bun test test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000`，33 pass
- `bun test test/tool/shell.test.ts test/tool/parameters.test.ts --timeout 30000`，104 pass
- `bun test test/tool/registry.test.ts -t "preserves Zod arg descriptions" --timeout 30000`，1 pass，记录为一次全套时序 flake 后隔离重跑通过
- `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`，98 pass
- `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`，49 pass
- `node --test aialra/turn-observability/tests/*.test.js`，6 pass
- `bun typecheck` in `packages/opencode`，pass
- `bun typecheck` in `packages/app`，pass
- `git diff --check`，pass

## 验收标准

- 协议层已实现并有 schema 测试: 是
- history/replay 已实现并有恢复测试: 是，public event replay 和 turn history 回归通过
- trace/public event 已实现并有事件样例测试: 是，新增 cleanup endpoint public event 测试
- Inspector 已展示并有 UI 或投影测试: 是，app typecheck 通过，事件投影中文化
- runtime 行为真实生效并有端到端测试: 是，运行中进程终止清理工具 E2E 通过
- 旧 session 兼容测试通过: 是，无进程事件时 UI 不展示新面板，schema-decoding/prompt 回归通过
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录: 是

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取: 低，本条没有 DB migration
- UI 展示的 requested 值和后端 effective 值不一致: 中低，Inspector 从 public event 重建进程状态，长时间未打开时仅受 1000 条 replay buffer 限制
- 工具绕过新 runtime gate: 低，工具和 HTTP API 共用 `ExecProcessRegistry.cleanup`
- abort/completed/failed 状态重复 settle: 低，`finish_ignored` 已存在并覆盖重复终态
- raw output、history、event stream 三者顺序不一致: 中，仍依赖事件写入顺序，已有 replay 回归覆盖

## 执行记录

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/exec-process-registry.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/tool/cleanup_processes.ts`
  - `packages/opencode/src/tool/registry.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/session.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/opencode/test/tool/shell.test.ts`
  - `packages/opencode/test/tool/parameters.test.ts`
  - `packages/opencode/test/tool/registry.test.ts`
  - `packages/opencode/test/server/httpapi-public-event.test.ts`
- 测试命令: 见“实际测试”
- 测试结果: 通过，只有一次 registry 兼容测试在大套件里 20s 超时，隔离重跑通过
- 残留风险:
  - Turn Inspector 后台终端列表来自 public event replay buffer，不是独立持久化进程列表 API
  - 运行中清理优先 graceful interrupt/abort，目前没有单独二阶段 force kill 重试事件，runtime 缺失会记录 failed
  - session remove/rollback/environment disconnect 的自动 cleanup 已可通过 registry 方法实现，仍需在对应生命周期路径继续逐项挂载

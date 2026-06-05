# REQ-047 ExecCommandEnd

## 原始目标

47. ExecCommandEnd：AIALRA 必须将当前 command.finished 升级为标准 ExecCommandEnd，并对齐 Codex 的 exit、duration、status 语义。每个 exec process 结束时必须生成唯一终态事件，包含 process_id、tool_call_id、turn_id、exit_code、signal、status、started_at、ended_at、duration_ms、output_summary、raw_output_ref、error、timeout_reason、abort_reason。ExecCommandEnd 必须进入 tool result settlement，并保证 completed、failed、timeout、aborted、cleaned_up 等终态互斥且幂等。验收标准是：任意命令结束后，UI、history、trace、tool result、turn state 都显示同一个终态，不会出现命令已退出但 inspector 仍显示 running，或 abort 后又 completed 覆盖的问题。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成标准 `exec_command.end` 终态、去重、public event、history/replay 和真实 shell runtime 测试
- 依赖前置: REQ-046 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

- 当前 AIALRA 原来已有 `exec_command.finished` 和 `exec_process.finished`，但它们是兼容事件，不是标准、唯一、不可覆盖的命令终态。
- OpenCode 原版主要通过 shell tool result 和消息状态表达命令结束，没有 AIALRA 这种 turn-scoped command terminal event。
- Codex 侧命令执行有明确的 process/item 结束语义，结束事件和输出 delta 分开。AIALRA 本条新增 `exec_command.end`，对齐“命令输出”和“命令终态”分离的结构。
- 当前差距:
  - `signal` 字段已保留，但 Node/Bun 和当前 Codex exec-server 适配器多数路径不返回 POSIX signal，所以通常是 `null`
  - `raw_output_ref` 已接 shell truncation 文件路径；非截断小输出不额外落 raw 文件
  - tool result settlement 本身继续由 processor/tool result 协议负责，本条把 command 终态写入同一 turn public event/history，后续质量统计可读取

## 数据结构和 schema 计划

- 新增 `aialra.exec_command_end.v1`:
  - `command_id`
  - `process_id`
  - `tool_call_id`
  - `backend`
  - `cwd`
  - `command`
  - `status`: `completed` / `failed` / `timeout` / `aborted` / `cleaned_up`
  - `exit_code`
  - `signal`
  - `started_at`
  - `ended_at`
  - `duration_ms`
  - `output_summary`: `chars`、`preview`、`truncated`
  - `raw_output_ref`
  - `error`
  - `timeout_reason`
  - `abort_reason`
  - `terminal_state`: 五个互斥 boolean，方便 UI 明确显示
  - `codex_item`: `item/commandExecution/end` 兼容对象
- 旧 session 兼容策略: 保留旧 `exec_command.finished` 和 `exec_process.finished`，不迁移旧数据。
- 新 session 默认双写: 标准 `exec_command.end` + 旧 `exec_command.finished`。
- 去重策略: `sessionID + turnID/messageID + commandID + processID` 作为终态 key，同一命令只允许第一条标准终态进入事件流，避免 abort 后又 completed 覆盖。

## 事件协议计划

本条相关变化必须进入:

- internal trace: `exec_command.end`
- typed public event: `exec_command.end`
- history/replay record: `TurnHistory` 分类为 command context item
- Turn Inspector projection: 中文标题 `统一命令标准终态`
- benchmark JSON: 后续可读取 `exec_command.end` 计算命令状态、耗时、失败原因，本条不直接改 benchmark runner
- 事件包含 schema、turnID、sessionID、messageID、toolCallID、processID、status、exit code、duration、raw output ref。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- `ExecCommand.finished` 现在先写 `ExecCommandEnd.emit`，再写 `TerminalInteraction` 和旧 `exec_command.finished`。
- `ExecProcessRegistry.finish` 也会兜底写 `ExecCommandEnd.emit`，但同一 command 会被去重，避免 registry 和 shell finished 产生两个互相覆盖的标准终态。
- Node/Bun shell、Codex exec-server shell、yielded background shell 都经过这条链路。
- abort、timeout、non-zero exit 都分别落到 `aborted`、`timeout`、`failed`，不会都显示成 completed。
- 权限、审批、沙箱、网络、cwd、environment 在命令启动前生效；终态事件记录这些执行结果的命令级收口。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- Turn Inspector 默认显示:
  - 标题: `统一命令标准终态`
  - 摘要: `completed exit=0 12ms` 或 `timeout exit=null 300000ms`
  - 失败时 severity 为 error，aborted 为 warning
  - 详情展示 `terminal_state`、`timeout_reason`、`abort_reason`、`raw_output_ref`
- 历史 turn 折叠后仍可通过 public event/history replay 恢复。
- 默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

- `test/session/turn-history.test.ts`
  - `unified exec command events are public and replayable` 覆盖 `exec_command.end`
  - `exec command end emits one immutable terminal state` 覆盖同一 command 终态去重和不覆盖
- `test/tool/shell.test.ts`
  - `writes stdin to a yielded process_id` 覆盖真实 yielded shell 在完成后发出 `exec_command.end`
- 回归组合覆盖 prompt cancel、shell timeout、exec-server、turn sandbox。

## 验收标准

- 协议层已实现并有事件样例测试
- history/replay 已实现并有恢复测试
- trace/public event 已实现并有事件样例测试
- Inspector 投影通过 public event 中文标题、status、summary 生效
- runtime 行为真实生效并有 shell 端到端测试
- 旧 session 兼容通过保留 `exec_command.finished`
- 状态矩阵可更新为 `完全完成`

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

## 执行记录

- 开始时间: 2026-06-04T18:15:00Z
- 完成时间: 2026-06-04T18:25:58Z
- 修改文件:
  - `packages/opencode/src/session/exec-command-end.ts`
  - `packages/opencode/src/session/exec-command.ts`
  - `packages/opencode/src/session/exec-process-registry.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/tool/shell.test.ts`
- 测试命令:
  - `bun test test/session/turn-history.test.ts -t "exec command" --timeout 30000`
  - `bun test test/tool/shell.test.ts -t "writes stdin" --timeout 30000`
  - `bun typecheck`
  - `bun test test/tool/shell.test.ts test/tool/parameters.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`
  - `git diff --check`
- 测试结果:
  - targeted turn-history: 2 pass
  - targeted shell stdin: 1 pass
  - opencode typecheck: pass
  - shell/parameters: 90 pass
  - turn-history/public-event: 32 pass
  - prompt/schema-decoding: 98 pass
  - observability node tests: 6 pass
  - codex-exec-server/turn-sandbox/external-directory: 49 pass
  - diff check: pass
- 残留风险:
  - `signal` 字段已保留，但当前 Node/Bun 和 Codex exec-server adapter 大多不返回 POSIX signal，实际值通常为 `null`。
  - `cleaned_up` 状态已在 schema 支持，但当前 shell 主路径主要使用 completed/failed/timeout/aborted。

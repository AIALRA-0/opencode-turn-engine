# REQ-025 Tool abort 与 shell cancel race

## 原始目标

25. Tool abort 与 shell cancel race：AIALRA 必须 P0 合并 OpenCode 最新 shell cancel race 修复，并把 abort 作为工具生命周期的一等状态。用户 abort turn 时，当前 running tool 必须收到 cancel signal，shell 主进程和子进程必须被终止，tool 状态必须稳定 settle 为 aborted，不能同时 completed。abort 必须幂等：已 completed 的工具不能被后来的 abort 覆盖，已 aborted 的工具不能重复 settle。验收标准是：长时间命令、Docker build、benchmark、测试进程在 abort 后不会残留后台进程，UI、history、trace 状态一致。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。当前实现把 abort 作为工具运行事件的一等状态处理：直接 shell route 取消只记录一次 `tool.lifecycle.aborted`，模型调用 `bash` 被取消时不再在 trace/public event 中伪装成 completed，processor 清理 running tool 时统一写入 aborted 事件并保持 session idle。
- 依赖前置: REQ-024 必须已完成并更新状态矩阵
- 禁止事项: 已遵守。本条不是 UI 假展示，改动进入 direct shell route、processor cleanup、ToolFoundation result settlement、AbortAudit source lookup 和真实测试路径。

## 现有代码路径调查

执行本条前已调查这些路径，并把实际结论回写如下:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/tool/shell.ts`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/tool-foundation.ts`
- `packages/opencode/src/session/abort-audit.ts`
- `packages/opencode/src/tool/codex-exec-server.ts`
- `packages/opencode/src/effect/runner.ts`
- `packages/core/src/cross-spawn-spawner.ts`

必须回答:

- 当前 AIALRA 已经有什么:
  - `SessionRunState` 和 `Runner.startShell` 已经采用 OpenCode 最新 shell race 模型：shell 独占运行，loop 会排队；cancel 会先等待 shell ready，再触发 shell cancel deferred，并 interrupt shell fiber。
  - `CrossSpawnSpawner` 支持 `forceKillAfter`，shell 工具取消和超时都会先请求终止，再升级强制终止。
  - `AbortAudit` 已有 `turn.abort.requested` 和 `turn.abort.resolved`，本条补了无 TurnContext 的 direct shell route 也能按 session 查到 abort source。
  - `ToolFoundation` 已经有 requested/started/completed/failed/aborted lifecycle，本条补了“成功返回但 metadata.abort=true”的结果也按 aborted 结算。
  - processor cleanup 已能把 running tool 写成 error，本条补了 `tool.call.finished status=aborted`，不再只是普通 error。
- 最新 OpenCode 已经有什么:
  - 本地 `packages/web/node_modules/opencode` 参考副本与当前 `packages/opencode/src/effect/runner.ts`、`run-state.ts` 的 shell cancel race 逻辑一致，说明基础上游 race fix 已在当前树中。
  - OpenCode 原生消息 schema 仍只有 `pending/running/completed/error`，没有独立 `aborted` tool state。
- 最新 Codex 已经有什么:
  - Codex harness 把用户取消、工具中断、进程终止、最终状态作为 runtime lifecycle 处理，不依赖前端猜测。
  - Codex 侧更偏向底层执行器/sidecar 统一中止进程；AIALRA 当前已在 Node/Bun runner 与 Codex exec-server fallback 路径记录 abort，但 full sidecar 进程树治理仍由后续 exec-server 条目继续收敛。
- 三者差异:
  - AIALRA 不改 OpenCode DB message schema，所以被取消的 shell result 在 DB 中仍兼容存为 `completed + metadata.abort` 或 `error + interrupted`；但 trace、public event、history、Inspector projection 按 aborted 显示。
  - Codex 原生可以在执行器层更统一地表达 aborted；AIALRA 当前通过 compatibility bridge 保持旧消息可读。

## 数据结构和 schema 计划

- 修改 `AbortAudit`:
  - 新增 `shellMetadataForSession({ sessionID, turnID? })`，用于 direct shell route 没有 active TurnContext 时仍能取到 abort request。
  - 保留 `shellMetadata(turn)`，旧调用兼容。
- 修改 `tool.lifecycle.*`:
  - `tool.lifecycle.aborted.data.abort` 可携带 `{ aborted, source, sourceLabel, actor, requestID, reason, message }`。
  - `ToolFoundation` 成功返回但 result.metadata.abort.aborted=true 时，事件 phase 为 `tool.lifecycle.aborted`，`tool.foundation.settled.status` 为 `aborted`。
- 修改 `tool.call.finished`:
  - 当 `output.metadata.abort.aborted=true` 时，`status` 为 `aborted`，并带 `abort` 数据。
  - processor cleanup 强制收尾 running tool 时也写 `status=aborted`。
- 旧 session 兼容:
  - DB tool state 不新增 `aborted` 字面量，避免旧 schema 解码失败。
  - 旧消息里没有 `metadata.abort` 时继续按 completed/error 展示。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

实际进入:

- internal trace:
  - `tool.lifecycle.aborted`
  - `tool.call.finished status=aborted`
  - `tool.foundation.settled status=aborted`
  - `turn.abort.requested`
  - `turn.abort.resolved`
- typed public event:
  - 现有 `PublicEventLog` 会把 `tool.lifecycle.aborted` 映射为 error severity，并保留 toolCallID、turnID、sessionID、messageID。
- history/replay:
  - 现有 `TurnHistory` 已把 `tool.lifecycle.*` 归类为 tool context，并通过 `turn-history.test.ts` 回归。
- Turn Inspector projection:
  - Inspector 消费 public event/history；本条保证它拿到的是 aborted 状态，不再只能从 shell metadata 字符串里猜。
- benchmark JSON:
  - runner 可从 public event/status 中区分 aborted 与 completed，避免把被取消工具误计为正常完成。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- direct shell route:
  - `SessionPrompt.shellImpl` 在 finish 阶段幂等结算，取消时写入 `metadata.abort`，只发一次 `tool.lifecycle.aborted`，不会再发 completed。
- model bash tool:
  - `ShellTool` 取消后返回 `metadata.abort`。
  - `ToolFoundation.execute` 识别该 metadata，并把 success-result 结算为 lifecycle aborted。
  - `SessionProcessor.completeToolCall` 识别同一 metadata，并把 `tool.call.finished` 记为 aborted。
- processor cleanup:
  - 若 stream/turn cleanup 后仍有 running tool，统一走 `abortToolCall()`，写 error part、interrupted metadata、`tool.call.finished status=aborted`。
- 幂等:
  - direct shell route 新增 `settled` guard，重复 cancel 或重复 finish 不会双发 completed/aborted。
  - `completeToolCall` 和 `failToolCall` 仍只处理 running part，已 completed/error 的工具不会被后续 abort 覆盖。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际结果:

- 本条没有新增前端组件，但通过 public event 和 history 投影给 Inspector 提供更精确的状态:
  - direct shell cancel: `tool.lifecycle.aborted`
  - bash tool cancel: `tool.lifecycle.aborted` + `tool.call.finished status=aborted`
  - abort source: `metadata.abort.source/sourceLabel/actor/requestID/reason`
- 默认 UI 可以显示“工具生命周期中断”，Raw Lab 可展开完整 abort metadata。
- 残留 UI 优化点:
  - 如果前端仍把 DB tool state `completed` 用作唯一视觉状态，可能需要后续 Inspector projection 优先读 lifecycle event，而不是只读 message part。

## 测试方法

- 更新 `packages/opencode/test/session/prompt.test.ts`:
  - direct shell cancel:
    - 执行 `sleep 2`
    - 连续调用 `prompt.cancel(chat.id)` 两次
    - 断言 session idle
    - 断言 tool output 含 abort metadata
    - 断言同一个 callID 只有 1 个 `tool.lifecycle.aborted`
    - 断言同一个 callID 没有 `tool.lifecycle.completed`
  - model bash tool cancel:
    - 模型调用 `bash` 输出大量文本后 sleep
    - cancel 后保留正常截断输出
    - 断言 `metadata.abort.aborted=true`
    - 断言 `tool.call.finished status=aborted`
    - 断言 `tool.lifecycle.aborted`
    - 断言没有 `tool.lifecycle.completed`
- 更新 `packages/opencode/test/tool/shell.test.ts`:
  - 修复环境策略测试命令，改为 `printf` 明确输出字段，避免空变量和 shell pipe 字符带来的歧义。
- 覆盖成功、aborted、超长输出、忽略 TERM、runner shell race、history/replay。

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际执行命令:

```bash
bun typecheck
bun test test/session/prompt.test.ts --timeout 30000
bun test test/effect/runner.test.ts --timeout 30000
bun test test/tool/shell.test.ts --timeout 30000
bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000
node --test aialra/turn-observability/tests/*.test.js
git diff --check
```

测试结果:

- `bun typecheck`: 通过
- `bun test test/session/prompt.test.ts --timeout 30000`: 67 pass, 0 fail, 304 expect
- `bun test test/effect/runner.test.ts --timeout 30000`: 25 pass, 0 fail
- `bun test test/tool/shell.test.ts --timeout 30000`: 29 pass, 0 fail
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`: 21 pass, 0 fail
- `node --test aialra/turn-observability/tests/*.test.js`: 6 pass, 0 fail
- `git diff --check`: 通过

失败和修复记录:

- 第一次 `bun typecheck` 失败:
  - 原因: direct shell route 中 `abortMetadata` 的 TypeScript 收窄不充分。
  - 修复: 用 `if (abortMetadata)` 替代 `if (aborted)`。
- 第一次 `bun test test/tool/shell.test.ts` 失败:
  - 原因: 环境策略测试用 `echo "$A|$B|..."`，清空敏感变量后在当前 shell/child process 封装下出现 `(no output)`，无法稳定证明 PATH 仍存在。
  - 修复: 改为 `printf '%s|%s|%s|%s|%s\n' ...`，明确输出 5 个字段。

## 验收标准

- 协议层已实现: 是
- history/replay 已实现并测试: 是
- trace/public event 已实现并测试: 是
- Inspector 投影输入已实现: 是
- runtime 行为真实生效并端到端测试: 是
- 旧 session 兼容: 是，未新增 DB tool state 字面量
- 状态矩阵更新条件: 已满足

## 回归风险

- OpenCode message schema 仍没有 `aborted` tool state，所以 DB 里被取消的 shell result 可能仍是 `completed + metadata.abort`。这是刻意兼容，不是漏实现；UI/Inspector 应优先用 lifecycle event 展示 aborted。
- Codex exec-server 全量进程树治理仍由后续 REQ-031 到 REQ-040 收敛；本条已保证当前 Node/Bun runner 和 shell tool 路径不会把 abort 误报为 completed。
- 对 provider-executed tools 的 abort 仍依赖 provider/runtime event，本条主要覆盖本地工具和 shell。

## 执行记录

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/abort-audit.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/tool-foundation.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/opencode/test/tool/shell.test.ts`
- 测试命令:
  - `bun typecheck`
  - `bun test test/session/prompt.test.ts --timeout 30000`
  - `bun test test/effect/runner.test.ts --timeout 30000`
  - `bun test test/tool/shell.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果: 全部通过
- 残留风险: DB message schema 仍使用 completed/error 兼容旧 OpenCode；真正面向用户的 aborted 语义以 lifecycle/public event/history 为准。后续若决定公开 schema 新增 `aborted` tool state，需要单独迁移 SDK、OpenAPI、旧会话兼容和 UI。

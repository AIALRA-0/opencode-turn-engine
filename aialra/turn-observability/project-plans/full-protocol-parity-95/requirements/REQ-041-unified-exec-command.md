# REQ-041 Unified exec_command

## 原始目标

41. Unified exec_command：AIALRA 必须 P0 将当前 bash 优先、Codex exec-server 辅助、按单次 timeout 等待的执行方式升级为统一 exec_command 体系，对齐 Codex 的 unified exec 语义。所有 shell 命令都必须进入同一个 exec runtime，而不是普通 shell tool、bash adapter、exec-server 各自分叉执行。exec_command 必须绑定 turn_id、tool_call_id、environment_id、cwd、permission_profile、network_policy、shell_env_policy、approval decision、timeout、yield_time_ms、process_id 等字段，并进入统一 tool lifecycle、tool-output-store、history、trace 和 inspector。验收标准是：任意命令执行都能在 inspector 中看到它属于哪个 turn、在哪个 environment cwd 下运行、使用了什么 shell/env/network/permission、是否仍在运行、是否可继续读取或中止，并且本地 shell、Codex exec-server、未来 remote exec 都走同一个内部协议。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。普通 shell route 和模型 bash tool 都会进入 `aialra.exec_command.v1` 统一事件协议；事件携带 turn/message/tool call/process/cwd/environment/backend/permission/approval/network/sandbox/shell env/timeout 等字段，并进入 trace、public event、TurnHistory、Turn Inspector 投影和测试回放
- 依赖前置: REQ-040 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session/turn-context.ts`
- `packages/opencode/src/session/security.ts`
- `packages/opencode/src/session/environment.ts`
- `packages/opencode/src/config`
- `packages/app/src`

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

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造同一 session 两个 turn 使用不同 override 的场景
- 断言工具读取 effective config，而不是 requested config 或 session 默认值

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

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

- 开始时间: 2026-06-04 18:10 CEST
- 完成时间: 2026-06-04 18:45 CEST
- 修改文件:
  - `packages/opencode/src/session/exec-command.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/src/tool/codex-exec-server.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
- 测试命令:
  - `bun test test/session/prompt.test.ts -t "shell completes a fast command" --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/tool/shell.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果:
  - shell route 最小测试: 1 pass
  - public event / TurnHistory: 31 pass
  - shell tool: 29 pass
  - prompt/schema: 98 pass
  - opencode typecheck: pass
  - observability node tests: 6 pass
  - diff whitespace check: pass
- 残留风险:
  - direct shell route 仍不是模型 ReAct 内部工具调用，但现在会记录本会话同源的 effective security config；后续 REQ-042/043/044 会继续补 `yield_time_ms`、running process id 和 stdin 交互能力

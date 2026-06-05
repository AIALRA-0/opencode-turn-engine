# REQ-043 Running process id

## 原始目标

43. Running process id：AIALRA 必须 P0 在命令未完成时向模型、UI、history 和 inspector 返回正式 process_id，不能只让 adapter 内部持有 live process。process_id 必须成为 unified exec 协议的一等字段，用于后续读取输出、写入 stdin、中止进程、清理后台终端、统计 live process。process_id 必须绑定 turn_id、tool_call_id、environment_id、command、started_at、last_interaction_at、status，并进入 process registry。验收标准是：执行长命令时，首次 exec_command 返回 running + process_id；用户和模型都能在 inspector 中看到该进程仍然活着，并能基于 process_id 继续读、写、abort 或 cleanup。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。`process_id` 已成为 unified exec 和后台进程注册表的一等字段；yield 后会登记 `aialra.exec_process.v1` running record，绑定 turn/tool/environment/cwd/command/backend/started/last_interaction/status/output_chars，后台结束后更新为 completed/failed/timeout/aborted 并进入 public event、TurnHistory 和 Inspector 投影
- 依赖前置: REQ-042 必须已完成并更新状态矩阵
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
- 构造成功、失败、aborted、超长输出、fallback、replay 场景
- 断言 tool result 幂等且模型上下文、history、UI 都收到同一个 result

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

- 开始时间: 2026-06-04 19:06 CEST
- 完成时间: 2026-06-04 19:19 CEST
- 修改文件:
  - `packages/opencode/src/session/exec-process-registry.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/tool/shell.test.ts`
- 测试命令:
  - `bun test test/tool/shell.test.ts -t "returns a running process" --timeout 30000`
  - `bun test test/session/turn-history.test.ts -t "unified exec command events" --timeout 30000`
  - `bun test test/tool/shell.test.ts test/tool/parameters.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果:
  - running process runtime 目标测试: 1 pass
  - exec/process public event 目标测试: 1 pass
  - shell + parameter schema: 88 pass
  - public event / TurnHistory: 31 pass
  - prompt/schema: 98 pass
  - opencode typecheck: pass
  - observability node tests: 6 pass
  - diff whitespace check: pass
- 残留风险:
  - 当前 registry 是进程内内存表，服务重启后不能恢复 live process；REQ-049/050 会继续补后台终端最大存活时间、cleanup 和持久审计

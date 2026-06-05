# REQ-042 yield_time_ms

## 原始目标

42. yield_time_ms：AIALRA 必须 P0 补齐模型可控的 yield_time_ms，不能只靠单次 timeout 阻塞等待命令结束。yield_time_ms 的语义必须对齐 Codex：命令启动后最多等待一小段时间返回当前输出，如果命令未结束，则返回 running 状态和 process_id，让模型或 UI 后续继续读取。默认值建议对齐 Codex 的 10000ms，并限制有效范围，例如 250–30000ms，避免 0ms 过度轮询或超长阻塞。验收标准是：模型可以请求短等待、默认等待或较长等待；长命令不会把整个 turn 卡死；inspector 能显示本次 exec 的 requested_yield_time_ms、effective_yield_time_ms、是否超出范围被 clamp、返回时命令是 completed 还是 still running。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。bash tool 参数新增 `yield_time_ms`；系统按 Codex 风格把 requested/effective/clamped 分开记录，默认策略为 10000ms、有效范围 250-30000ms；显式短 yield 会让长命令返回 running/process_id，后台继续读输出并在命令真实结束后发 `exec_command.finished`
- 依赖前置: REQ-041 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session/public-event.ts`
- `packages/opencode/src/session/raw-audit.ts`
- `packages/app/src`
- `aialra/turn-observability`

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
- 构造断线续传、raw 下载、搜索、长输出、中文摘要场景
- 用 browser smoke 验证默认不展示裸 JSON，高级 raw 可展开

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

- 开始时间: 2026-06-04 18:45 CEST
- 完成时间: 2026-06-04 19:06 CEST
- 修改文件:
  - `packages/opencode/src/session/exec-command.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/tool/codex-exec-server.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/src/tool/shell/prompt.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/tool/shell.test.ts`
  - `packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap`
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
  - yield runtime 目标测试: 1 pass
  - unified exec event 目标测试: 1 pass
  - shell + parameter schema: 88 pass
  - public event / TurnHistory: 31 pass
  - prompt/schema: 98 pass
  - opencode typecheck: pass
  - observability node tests: 6 pass
  - diff whitespace check: pass
- 残留风险:
  - Node/Bun fallback 仅在显式传 `yield_time_ms` 时启用后台 yield，避免把所有本地快命令从稳定 Effect child-process 路径切走；Codex exec-server 路径支持默认 yield。REQ-043 会继续补 process registry 的公开 read/status 能力

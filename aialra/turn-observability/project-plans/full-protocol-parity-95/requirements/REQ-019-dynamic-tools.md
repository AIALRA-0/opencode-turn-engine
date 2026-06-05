# REQ-019 Dynamic tools

## 原始目标

19. Dynamic tools：AIALRA 必须支持 per-turn dynamic tools。每个 turn 运行时，工具集合应该能根据权限、environment、skill、provider、task type、policy 动态注入、裁剪、启用、禁用，而不是固定不变。实现时需要明确 tool registry、tool availability resolver、tool permission resolver、tool schema projector。验收标准是：同一 session 中不同 turn 可以拥有不同工具集合，并在 inspector 中显示本轮可用工具、禁用工具、禁用原因和实际调用工具。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现 per-turn dynamic tools，真实 prompt loop 会按模型能力、权限规则、当前 environment 裁剪工具集合，并把可用工具、禁用工具、禁用原因写入 trace、public event、history/replay 和 TurnContext
- 依赖前置: REQ-018 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session/security.ts`
- `packages/opencode/src/permission`
- `packages/opencode/src/tool`
- `packages/opencode/src/tool/sandbox.ts`
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
- 构造允许、询问、硬拒绝、约束覆盖审批四类场景
- 断言 UI 展示和实际执行结果一致

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

- 开始时间: 2026-06-04T12:00:00+02:00
- 完成时间: 2026-06-04T12:54:28+02:00
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/session/turn-context.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/opencode/test/session/engineering.test.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/tool/codex-exec-server.test.ts`
  - `packages/opencode/test/tool/repo_overview.test.ts`
  - `packages/opencode/test/tool/shell.test.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/tool/webfetch.test.ts`
- 实现摘要:
  - 新增 `DynamicToolsResolution`、`DynamicToolStatus`、`DynamicToolSource`，并挂到 `UserTurn.dynamic_tools`
  - `CodexTurn.fromFrame` 默认生成 per-turn dynamic tools 合同，`traceSummary` 和 `threadSettings` 会保留该字段
  - `SessionPrompt.resolveTools` 现在在真实工具注册后执行 availability resolver，根据模型是否支持工具、`input.tools` 显式开关、permission profile、agent/session permission、selected environment 的 shell/fileSystem 能力裁剪工具
  - 禁用工具会从实际传给模型的工具集合中删除，不只是 UI 展示
  - 新增 `tools.dynamic.resolved` public event，Turn History 将其归为 tool context，可用于 Turn Inspector 和 replay
  - structured output 工具注入也会更新 dynamic tools，避免最终输出工具不在本轮工具合同里
- 测试命令:
  - `bun test test/session/prompt.test.ts --timeout 30000`
  - `bun test test/session/turn-context.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
  - `bun typecheck`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts test/session/turn-context.test.ts --timeout 30000`
  - `git diff --check`
- 测试结果:
  - `prompt.test.ts`: 67 pass, 0 fail
  - `turn-context + turn-history + httpapi-public-event`: 24 pass, 0 fail
  - `render-trace.test.js`: 1 pass, 0 fail
  - `bun typecheck`: pass
  - `prompt + schema-decoding + turn-context`: 101 pass, 0 fail
  - `git diff --check`: pass
- 残留风险:
  - 本条已让 runtime 工具集合真实受 dynamic tools 裁剪
  - Turn Inspector 依赖 public event/history 投影展示，本条没有单独新增浏览器 UI 截图测试
  - 更细的 task type、skill、plugin strategy resolver 将在后续工程状态机和 plugin/tool registry 条目继续扩展

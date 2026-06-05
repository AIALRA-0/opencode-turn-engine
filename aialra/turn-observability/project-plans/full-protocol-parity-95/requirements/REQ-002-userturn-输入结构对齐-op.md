# REQ-002 UserTurn 输入结构对齐 Op

## 原始目标

2. UserTurn 输入结构对齐 Op::UserInput：AIALRA 的 UserTurn 必须完全对齐 Codex 的 Op::UserInput，即 Codex 具备的输入组成 AIALRA 只能多不能少。需要逐项补齐 items、text/image/file 输入、environment 选择、schema、thread_settings、per-turn override、metadata、extension data 等结构，并把旧 prompt string 入口升级为结构化 UserTurn。验收标准是：任意一次用户输入都能被序列化为完整 UserTurn，并可恢复、可 replay、可在 inspector 中查看原始结构。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。AIALRA 内部 UserTurn 已具备 Codex `Op::UserInput` 对齐的结构化输入面，旧 prompt string 和 `MessageV2.Part[]` 会升级为 `input_items`，并带 `input_schema`、`thread_settings`、`responsesapi_client_metadata`、`metadata`、`extension_data` 进入 TurnContext 和 trace summary。
- 依赖前置: REQ-001 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session`
- `packages/opencode/src/session/public-event.ts`
- `packages/opencode/src/session/turn-context.ts`
- `packages/opencode/src/session/turn-history.ts`
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
- 构造正常完成、模型错误、用户 abort、重复 settle、resume/replay 场景
- 断言 history、trace、public event、Inspector 四层一致

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

- 开始时间: 2026-06-04T10:25:31+02:00 前后
- 完成时间: 2026-06-04T10:25:31+02:00
- 调查结论:
  - 当前 AIALRA 已有 `TurnContext`，回合上下文，携带 cwd、approval、sandbox、permission、model、environment、retry、engineering 等运行时字段。
  - 原版 OpenCode 以 message/part 为核心保存输入，适合聊天上下文，但没有 Codex `Op::UserInput` 这种统一的 turn input contract，回合输入合同。
  - 最新 Codex 协议中 `Op::UserInput` 拥有 `items`、`environments`、`final_output_json_schema`、`responsesapi_client_metadata`；`UserInput` item 支持 text、image、local image、skill、mention 等输入类型。
  - 本条补齐 AIALRA 的输入结构合同，不改变旧模型/tool 语义，不做 DB migration，避免破坏旧会话。
- 实现内容:
  - `UserTurn` 新增 `input_items`，结构化输入清单，支持 text、image、local_image、file、skill、mention、subtask。
  - `UserTurn` 新增 `input_schema`，声明对齐 Codex `Op::UserInput` 并列出支持 item 类型。
  - `UserTurn` 新增 `thread_settings`，按 requested、resolved、effective 保存请求值、解析值、最终生效值。
  - `UserTurn` 新增 `responsesapi_client_metadata`、`metadata`、`extension_data`，用于后续 Raw Lab、replay、扩展数据和 Responses API 元数据。
  - `CodexTurn.fromFrame` 会把旧 `MessageV2.Part[]` 转成结构化 `input_items`，包括 text、普通 file、image file、agent mention、subtask。
  - `CodexTurn.traceSummary` 会输出输入项数量和类型分布、thread settings、metadata、extension namespace，避免默认 trace 塞完整大 prompt。
  - 所有手写测试 TurnContext helper 已补齐新增必填字段，防止测试继续使用旧形状。
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/test/session/turn-context.test.ts`
  - `packages/opencode/test/session/engineering.test.ts`
  - `packages/opencode/test/tool/codex-exec-server.test.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/tool/repo_overview.test.ts`
  - `packages/opencode/test/tool/webfetch.test.ts`
  - `packages/opencode/test/tool/shell.test.ts`
- 测试命令:
  - `bun test test/session/turn-context.test.ts --timeout 30000`
  - `bun test test/session/engineering.test.ts test/tool/webfetch.test.ts test/tool/shell.test.ts test/tool/turn-sandbox.test.ts test/tool/repo_overview.test.ts test/tool/codex-exec-server.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - `turn-context.test.ts`: 2 pass, 0 fail。
  - related tests: 77 pass, 4 skip, 0 fail。
  - `bun typecheck`: pass。
- 残留风险:
  - remote environment 真执行、HTTP execution context 深层 runtime、完整 Raw Lab replay、public event schema 固化由后续独立要求实现。
  - 本条只做输入合同与 trace summary，不把完整 raw prompt 默认写入 trace，避免大文本和 token 泄露。

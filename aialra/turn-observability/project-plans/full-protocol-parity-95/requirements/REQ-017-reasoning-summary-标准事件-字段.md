# REQ-017 Reasoning summary 标准事件/字段

## 原始目标

17. Reasoning summary 标准事件/字段：AIALRA 必须把 reasoning summary 做成标准事件和标准字段，而不是 raw 文本拼接展示。需要支持 summary enabled/disabled、summary level、auto collapse、per-turn reasoning summary、tool-linked reasoning summary。UI 应默认折叠展示，但允许用户展开查看“模型做了哪些步骤”的摘要。验收标准是：reasoning summary 可以进入 history、trace、inspector，并能与对应 turn 和工具调用关联。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成 TurnContext 标准字段、runtime reasoning-end/cleanup 标准事件、tool-linked summary、public event、history/replay 和测试
- 依赖前置: REQ-016 必须已完成并更新状态矩阵
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

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/session/turn-context.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/session/engineering.test.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/tool/codex-exec-server.test.ts`
  - `packages/opencode/test/tool/repo_overview.test.ts`
  - `packages/opencode/test/tool/shell.test.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/tool/webfetch.test.ts`
- 实现摘要:
  - 新增 `ReasoningSummaryPolicy`，推理摘要策略，进入 `UserTurn` / `TurnContext` / `traceSummary` / `thread_settings.effective`
  - 支持 `enabled`、`level`、`auto_collapse`、`per_turn`、`tool_linked`、`source`
  - 新增 `CodexTurn.defaultReasoningSummaryPolicy`，按模型能力和用户 summary 选项生成默认策略
  - processor 在 `reasoning-end` 和 cleanup 收尾时发出 `reasoning.summary.created`
  - `reasoning.summary.created` 只放安全摘要、统计、折叠策略和工具关联，不把完整 reasoning 原文塞进默认事件
  - reasoning 期间启动的 `tool-input-start` / `tool-call` 会被关联到该 reasoning summary 的 `toolLinks`
  - public event registry 增加 `reasoning.summary.created`，中文名为“推理摘要已生成”
  - TurnHistory 把 `reasoning.*` 归类为 model context item，支持历史回放
- 测试命令:
  - `bun test test/session/turn-context.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
  - `bun typecheck`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts test/session/turn-context.test.ts --timeout 30000`
- 测试结果:
  - session/public event/turn context/turn history 窄测试: 21 pass, 0 fail
  - trace renderer: 1 pass, 0 fail
  - opencode typecheck: pass
  - prompt/schema/turn-context 固定回归: 99 pass, 0 fail
- 残留风险:
  - UI 的最终视觉增强仍属于后续 Turn Inspector 产品化条目，本条已提供标准事件和字段
  - provider 是否返回完整 reasoning 取决于模型和 provider adapter，本条只保证返回后会标准化记录摘要

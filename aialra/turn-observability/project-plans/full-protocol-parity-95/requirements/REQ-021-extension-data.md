# REQ-021 Extension data

## 原始目标

21. Extension data：AIALRA 必须全量支持 extension data，给插件、UI、企业系统、外部集成留下稳定扩展位置。每个核心 schema 或任务字段，除了固定结构外，都应该允许受控的额外扩展信息，例如 ui_state、enterprise_policy_id、plugin_data、benchmark_case_id、external_trace_id、custom_metadata。extension data 必须有命名空间，避免污染核心协议。验收标准是：系统每个环节既有稳定 schema，又能支持紧急扩展，而不需要破坏协议兼容性。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成
- 依赖前置: REQ-020 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有什么:
  - `PromptInput.settings.extensionData` 可以接收按命名空间组织的扩展数据。
  - `CodexTurn.fromFrame` 会把扩展数据写入 `TurnContext.extension_data`。
  - `AialraTurnTrace.emit` 支持顶层 `extension_data`，并写入 JSONL trace、public event 和 turn history。
  - public event 新增 `extension.data.attached`，默认只展示命名空间摘要，完整 payload 走 raw 审计路径。
  - `TurnHistory.recordContextItem` 会把 `extension_data` 保存为 replay item，历史回放不会丢扩展字段。
- 最新 OpenCode 已经有什么:
  - 原版 OpenCode 主要以 prompt/session/message/tool 结构承载运行数据，没有 AIALRA 这种稳定命名空间扩展层。
  - 插件和 UI 扩展更多依赖现有对象字段和 bus event，没有本条要求的统一 `extension_data` envelope。
- 最新 Codex 已经有什么:
  - Codex 协议层通常允许 metadata / client metadata / item metadata 这种扩展承载点。
  - AIALRA 本条对齐的是“核心协议稳定、扩展字段命名空间隔离”的思路，而不是把扩展字段混进核心字段。
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪:
  - AIALRA 现在有明确 `extension_data` 顶层字段、事件、history/replay 和 trace。
  - OpenCode 原版没有专门的命名空间扩展协议。
  - Codex 有 metadata 风格扩展，但具体字段名和 AIALRA 不完全相同；AIALRA 采用自有 `extension_data` 作为兼容层，后续可映射到 Codex metadata。

## 数据结构和 schema 计划

- 新增正式字段:
  - `UserTurn.extension_data: Record<string, Record<string, unknown>>`
  - `TraceInput.extension_data`
  - `PublicEvent.extension_data`
  - `TurnHistoryRecord.extension_data`
  - `PromptInput.settings.extensionData`
- requested/resolved/effective:
  - 本条不改变安全决策，所以不新增 requested/resolved/effective 三段式字段。
  - 输入侧 `extensionData` 是 requested；进入 `TurnContext.extension_data` 后视为 effective。
  - 清洗策略会移除非法 namespace、函数、symbol、过深对象和超长字符串，防止扩展污染协议。
- history/replay/rawRef/extension_data:
  - safe event 带 namespace 摘要和压缩后的 `extension_data`。
  - rawRef 存储完整事件 raw payload，供 Raw Lab/Inspector 高级展开。
  - history/replay record 保存压缩后的 `extension_data`，保证断线重放和审计不丢命名空间。
- 旧 session 兼容:
  - 旧记录没有 `extension_data` 时默认视为空对象，不触发迁移。
  - JSONL 读取失败或字段缺失不会影响 turn history 列表。
- 新 session 默认写入:
  - prompt intake 构造 TurnContext 时写入。
  - trace emit 时作为顶层字段写入 public event 和 history。

## 事件协议计划

本条相关变化必须进入:

- internal trace: 已进入 `AialraTurnTrace.emit` 的顶层 `extension_data`，JSONL trace 写入清洗后的对象。
- typed public event: 已新增 `extension.data.attached`，事件带中文说明和字段文档。
- history/replay record: 已新增 `TurnHistoryRecord.extension_data`，`extension.*` 事件归类为 `turn_context`。
- Turn Inspector projection: 通过 public event 的中文标题、状态、summary、rawRef 和 `extension_data` 字段进入 Inspector 投影。
- benchmark JSON 或质量统计: benchmark 可通过 `extensionData.benchmark.caseID`、`external_trace_id` 等命名空间字段挂载，不污染核心字段。

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际落地:

- public event schema 仍使用既有字段名 `turnID/sessionID/ts/source/data/rawRef/extension_data`。
- thread_id 当前由 session/turn 结构间接表达，后续若引入多 thread tree，可把 `threadID` 放入 `extension_data.aialra.threadID` 或正式字段。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段:
  - 本条不把扩展数据作为权限门禁输入，避免插件扩展字段绕过正式策略。
  - 工具、benchmark、企业集成可以读取 `TurnContext.extension_data` 做审计关联或外部 trace 关联。
- 模型调用是否读取该字段:
  - 本条不默认把扩展数据注入模型上下文，避免把企业字段、benchmark id 或外部 trace 泄露给模型。
  - 如需注入，后续必须显式通过 system prompt 或 prompt part，而不是隐式泄露。
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段:
  - 这些强门禁仍读取正式字段，不读取 `extension_data`。
  - `extension_data` 只能做附加审计和外部系统关联，不能覆盖安全决策。
- 失败路径、abort 路径、resume/replay 路径是否读取该字段:
  - trace/public event/history 都保存 `extension_data`，所以失败、abort、resume/replay 都能看到扩展命名空间。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际落地:

- `extension.data.attached` 默认摘要显示“本轮挂载了哪些扩展命名空间”。
- 具体扩展字段通过 rawRef 或高级详情查看。
- history replay 保留命名空间，历史 turn 折叠后仍能恢复扩展上下文。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history:
  - `packages/opencode/test/session/turn-context.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/opencode/test/session/schema-decoding.test.ts`
- 新增 public event/schema 测试:
  - `packages/opencode/test/server/httpapi-public-event.test.ts`
  - `aialra/turn-observability/tests/render-trace.test.js`
- Turn Inspector 或投影测试:
  - public event protocol registry、history replay 和 render-trace 覆盖 Inspector 投影输入。
- 旧 session 兼容测试:
  - schema decoding 对可选字段保持兼容；history 读取缺失 `extension_data` 的记录默认无扩展字段。
- 正常完成、模型错误、用户 abort、重复 settle、resume/replay:
  - 本条组合回归跑过 prompt lifecycle、cancel、model retry、stream idle、weak loop、tool sandbox。
- 四层一致:
  - prompt -> TurnContext -> trace/public event -> history/replay 已覆盖。

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

- 开始时间: 2026-06-04T13:05:00+02:00
- 完成时间: 2026-06-04T13:28:41+02:00
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/turn-trace.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/session/schema-decoding.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/opencode/test/session/turn-context.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
- 测试命令:
  - `bun test test/session/turn-context.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - `bun typecheck`
  - `bun test test/session/prompt.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts test/session/turn-context.test.ts --timeout 30000`
  - `git diff --check`
- 测试结果:
  - targeted session/public-event/schema tests: 52 pass, 0 fail
  - opencode typecheck: pass
  - prompt main chain: 67 pass, 0 fail
  - render-trace: 1 pass, 0 fail
  - prompt/schema/turn-context regression: 101 pass, 0 fail
  - git diff whitespace check: pass
- 残留风险:
  - `extension_data` 当前是受控扩展和审计关联字段，不允许覆盖安全策略。
  - 若未来需要企业插件用扩展字段影响工具门禁，必须把它提升为正式 TurnContext 字段并补门禁测试。

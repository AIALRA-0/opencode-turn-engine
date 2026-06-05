# REQ-074 Reasoning raw

## 原始目标

74. Reasoning raw：AIALRA 必须补齐 reasoning raw 的标准承载方式，对齐 Codex 的 AgentReasoningRawContent，并兼容 OpenCode 最新 thinking / reasoning 输出。不同 provider 返回的 reasoning、thinking、summary、hidden/raw reasoning fragment 必须通过统一 adapter 进入 reasoning_raw item，同时根据安全策略决定哪些可展示、哪些只存审计、哪些需要脱敏。AIALRA 不能继续依赖 provider-specific raw 拼接展示，而应该将 reasoning raw、reasoning summary、reasoning output delta 分层存储。验收标准是：支持 reasoning 的 provider 能在 Raw Lab 和 inspector 中看到结构化 reasoning raw 来源、provider 类型、chunk sequence、展示策略；不支持 reasoning 的 provider 必须明确标记 unsupported，而不是显示空白伪装成功。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成 runtime 接入、typed public event、rawRef、history/replay、Turn Inspector 中文摘要、unsupported 明确事件和测试记录
- 依赖前置: REQ-073 必须已完成并更新状态矩阵
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

- 当前 AIALRA 原来已有 `engineering.reasoning.recorded` 和 `reasoning.summary.created`，也已有 `model.raw.item kind=reasoning_*`，但 reasoning 原始内容没有独立协议名，用户无法一眼区分“模型确实没返回 reasoning”还是“系统没展示”
- 最新 OpenCode 有 thinking/reasoning part 的消息存储和流式 delta，但没有 AIALRA 这种 public event/rawRef/Inspector 的独立 reasoning raw 审计层
- Codex 有更明确的 reasoning item 分层：普通输出、推理摘要、原始推理/隐藏推理不是一层概念。AIALRA 本条对齐的是可见 provider reasoning fragment 的承载方式；隐藏推理如果 provider 不返回，AIALRA 不伪造
- 差距结论：AIALRA 现在已经能记录 provider 返回的 reasoning-start/delta/end 原始 payload，也能对没有 reasoning 的模型发 `unsupported`。仍不等于能读取 provider 不暴露的隐藏链路推理

## 数据结构和 schema 计划

- 新增正式事件 `reasoning.raw.item`
- 新增 raw item schema `aialra.reasoning_raw_item.v1`
- 关键字段:
  - `reasoning_raw_id`: 本条 reasoning 原始项编号
  - `model_call_id`: 本轮模型调用编号
  - `response_message_id`: assistant message 编号
  - `sequence`: reasoning raw 序号
  - `kind`: `reasoning_start`、`reasoning_delta`、`reasoning_end`、`unsupported`
  - `display_policy`: `rawRef_only` 或 `unsupported`
  - `normalized_event_type`: provider stream event 类型
  - `raw_payload_kind`: `provider_stream_event` 或 `unsupported_marker`
  - `raw_payload`: 完整 provider 原始 payload，只进入 rawRef，不进入安全事件外壳
- history/replay: `TurnHistory.recordContextItem` 按 `reasoning.*` 归为 `model`，同时 `turn-trace` 为 `reasoning.raw.item` 生成 `item.lifecycle.completed`
- 旧 session 兼容: 旧事件仍按 `reasoning.summary.created` 和 `model.raw.item` 展示，不需要 migration
- 新 session 写入: processor 在 reasoning-start/delta/end 时双写 `model.raw.item` 和 `reasoning.raw.item`；如果整轮没有 reasoning，则在 step-finish/finish 发 `kind=unsupported`

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- internal trace: `reasoning.raw.item`
- typed public event: `reasoning.raw.item`，自动获得 `version/source/threadID/payloadSchema/payload`
- rawRef: 完整 `raw_payload` 只通过 raw endpoint 读取
- history/replay: `turn.context.item` + `item.lifecycle.completed`
- Turn Inspector: 中文显示“推理原始项已记录”或“该模型本轮没有返回可记录的推理原文”

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际 runtime:

- 模型流处理器 `packages/opencode/src/session/processor.ts` 直接在真实 provider stream event 上发事件，不是 UI 假数据
- reasoning-start/delta/end 均保留 provider metadata、reasoningID、chars、preview 和完整 raw payload
- 没有任何 reasoning event 的 turn 会发 `unsupported`，用于 UI 和审计解释空白原因
- 本字段不控制工具权限、沙箱、cwd；它控制的是推理原始内容的审计、回放和展示策略

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际 UI:

- `packages/app/src/pages/session/turn-inspector.tsx` 已加入 `reasoning.raw.item` 标签和中文摘要
- 默认只显示摘要、kind、sequence、chars、display_policy
- 完整 provider payload 仍在 rawRef，供 Raw Lab/高级展开读取

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造同一 session 两个 turn 使用不同 override 的场景
- 断言工具读取 effective config，而不是 requested config 或 session 默认值

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

```bash
bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000
```

结果: 38 pass，0 fail

覆盖:

- `reasoning raw items keep provider reasoning behind rawRef`
- `unsupported reasoning raw is explicit instead of empty`
- public event registry 自动覆盖 `reasoning.raw.item`

```bash
node --test aialra/turn-observability/tests/*.test.js
```

结果: 6 pass，0 fail

```bash
bun typecheck
```

执行目录:

- `packages/opencode`: 通过
- `packages/app`: 通过

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
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-trace.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
- 测试结果: 全部通过
- 残留风险:
  - provider 不返回的隐藏推理不能被 AIALRA 读取或伪造，只能明确标记 unsupported
  - Raw Lab 的全量统一下载和搜索属于后续 REQ-076/REQ-081

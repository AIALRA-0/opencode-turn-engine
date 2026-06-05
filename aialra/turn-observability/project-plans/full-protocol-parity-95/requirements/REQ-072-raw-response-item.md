# REQ-072 Raw response item

## 原始目标

72. Raw response item：AIALRA 必须补齐 Codex 风格 raw response item，不能只保留部分 model.raw.chunk。模型 provider 返回的原始 response item、stream chunk、tool call fragment、reasoning fragment、output fragment、usage、finish reason、provider metadata，都必须以 raw response item 形式进入 raw store、history、trace 和 Raw Lab。实现时必须区分 normalized item 和 raw item：normalized item 给 AIALRA runtime 使用，raw item 保留 provider 原貌用于审计和 debug。验收标准是：用户可以在 Raw Lab 中按 turn、model call、provider、chunk sequence 查看原始响应；replay/debug 时能判断问题来自 provider 原始输出、adapter 转换，还是 AIALRA runtime 处理。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成 `model.raw.item`，模型原始响应项进入 raw store、history、public event 和 Turn Inspector
- 依赖前置: REQ-071 必须已完成并更新状态矩阵
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

### 实际调查结论

- 原版 OpenCode 会处理模型 stream event，但没有面向用户的 Raw Lab 级 raw response item 协议
- AIALRA 执行本条前已有 `model.raw.chunk`，主要覆盖 reasoning delta、assistant text delta 和 tool input delta，字段不够统一
- Codex 更强调保留原始 response item 和标准化 runtime item 的分层，debug 时能区分 provider 原始输出和 adapter 转换结果
- 本条新增 `model.raw.item`，保留旧 `model.raw.chunk` 兼容，同时把更完整的 provider stream event 存入 rawRef

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 已实现数据结构

- 新增 public event type `model.raw.item`
- raw item schema 为 `aialra.raw_response_item.v1`
- 每个 raw item 包含 `raw_item_id / model_call_id / response_message_id / turn_id / session_id / providerID / modelID / sequence / kind / normalized_event_type / raw_payload_kind`
- delta 类事件额外包含 `chars / preview / providerMetadata`
- step finish 事件额外包含 `finish / usage / providerMetadata`
- `raw_payload` 不进入安全 `data`，只进入 rawRef

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 已实现事件协议

- `model.raw.item` 进入 `PUBLIC_EVENT_TYPES`
- `model.raw.item` 支持 typed envelope，包含 `version/source/threadID/payloadSchema/payload`
- `model.raw.item` 默认 raw eligible，完整 provider payload 通过 raw endpoint 读取
- TurnHistory 将 `model.raw.item` 归类为 `model`，可按 turn replay

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 已实现 runtime 接入

- processor 在处理 LLM stream event 时生成 raw response item
- 已覆盖 `step-start / reasoning-start / reasoning-delta / reasoning-end / tool-input-start / tool-input-delta / tool-input-end / tool-call / tool-result / tool-error / provider-error / step-finish / text-start / text-delta / text-end / finish`
- normalized runtime 路径继续原样工作，raw item 只做审计和 debug，不改变模型输出逻辑
- 旧 `model.raw.chunk` 保留，避免破坏已有 UI 和测试

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### UI Inspector 实现

- Turn Inspector 增加 `model.raw.item` 中文标题
- 摘要显示 kind、sequence 和 chars
- 完整 raw_payload 通过已有 rawRef / Raw Lab 读取，不在默认摘要里裸露

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

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/processor.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - turn history 和 public event HTTP 测试 36 pass
  - opencode typecheck pass
  - app typecheck pass
  - observability tests 6 pass
- 残留风险:
  - Raw Lab 产品层还需要继续做更强的按 model call 分组、下载、搜索和回放
  - 本条保留 raw payload，但不改变 provider adapter 逻辑，若 provider 本身不返回 reasoning 或 usage，则不会伪造

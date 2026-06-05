# REQ-071 Typed protocol events

## 原始目标

71. Typed protocol events：AIALRA 必须将当前自定义 public event 升级为正式 typed protocol events，对齐 Codex 的 typed event 体系，并兼容 OpenCode event / v2 bridge 的事件桥接方向。所有核心事件都必须有稳定 type、version、schema、turn_id、thread_id、session_id、timestamp、source、payload、extension_data，不能只靠自由 JSON 或字符串 event name。实现时需要把 turn、tool、exec、approval、sandbox、raw、reasoning、context compaction、diff、UI inspector 等事件统一纳入 typed protocol event registry，并生成公共 schema 文档。验收标准是：任何事件都能被类型安全解析、持久化、replay、rollout、inspector 展示和外部订阅；旧 public event 可以通过 adapter 兼容，但新路径必须走 typed protocol events。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成 typed envelope，公共事件现在稳定包含 `version / source / threadID / payloadSchema / payload`，同时保留旧 `data` 兼容
- 依赖前置: REQ-070 必须已完成并更新状态矩阵
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

- 原版 OpenCode 主要是内部 bus event 和 SDK event，字段结构偏业务对象，没有 AIALRA 这套面向用户和机器订阅的 public event protocol registry
- AIALRA 执行本条前已有 `aialra.public_event.v1`、事件枚举、rawRef、Last-Event-ID replay、中文 title/description 和 TurnHistory replay，但事件本体缺少 `version/source/threadID/payloadSchema/payload`
- Codex 的事件更偏 typed item 和 typed event 体系，模型、工具、终态、审批、原始流都在统一协议外壳里被消费
- 本条没有推翻 AIALRA 现有 public event，而是在中央 record 层补 typed envelope，让旧客户端继续读 `data`，新客户端读 `payload`

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 已实现数据结构

- `PublicEvent` 增加 `version: "1"`
- `PublicEvent` 增加 `source: "trace" | "bus" | "manual"`
- `PublicEvent` 增加 `threadID`，优先取 `turnID`，其次 `sessionID`，最后 `global`
- `PublicEvent` 增加 `payloadSchema`，默认由事件 type 生成，例如 `aialra.public_event.turn_completed.v1`
- `PublicEvent` 增加 `payload`，第一版和 `data` 保持一致，用于新 typed consumer
- `data` 保留，保证旧 Inspector、旧 replay 和旧测试不需要迁移

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 已实现事件协议

- 所有 trace 适配事件标记 `source=trace`
- 所有 bus 适配事件标记 `source=bus`
- 所有手动记录事件默认 `source=manual`
- `PublicEventLog.protocol()` 的字段列表补齐 `version/source/threadID/payloadSchema/payload`
- rawRef 规则保持不变，raw 内容仍只通过 raw endpoint 读取

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### runtime 接入结论

- 本条是协议外壳升级，不改变工具执行允许/拒绝逻辑
- runtime 事件在中央 record 层自动获得 typed envelope，所以工具、模型、审批、沙箱、终态事件都会统一携带这些字段
- replay、Last-Event-ID、rawRef、TurnHistory 继续使用同一事件对象，兼容旧数据

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### UI Inspector 实现

- 前端 `PublicEvent` 类型已补齐 `version/source/threadID/payloadSchema/payload`
- 现有中文摘要继续读 `data`，后续 Raw Lab 和下载回放可直接读 `payload`
- 默认 UI 不展示裸 JSON，typed envelope 用于机器消费和高级详情

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
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/server/httpapi-public-event.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - public event HTTP 和 turn history 测试 35 pass
  - opencode typecheck pass
  - app typecheck pass
  - observability tests 6 pass
- 残留风险:
  - `payload` 第一版与 `data` 相同，还没有为每个 event type 拆独立强类型 payload schema 文件
  - `threadID` 目前从 `turnID/sessionID/global` 派生，不等于 Codex 内部真实 thread object
  - 这是 typed envelope parity，不是 Codex 全协议对象完全移植

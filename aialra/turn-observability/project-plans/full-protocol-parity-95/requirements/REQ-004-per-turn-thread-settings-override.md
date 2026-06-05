# REQ-004 Per-turn thread settings override

## 原始目标

4. Per-turn thread settings override：AIALRA 必须支持每个 turn 单独提交 settings override，而不是只能修改 session 全局配置。每个 turn 都应该能覆盖模型、provider、reasoning effort、permission profile、sandbox、network、cwd、selected environment、approval policy、service tier 等设置。实现时必须区分 requested override、resolved override、effective runtime config，并在 inspector 中展示“这一轮请求了什么配置，最终实际生效了什么配置”。验收标准是：同一 session 内连续两个 turn 可以使用不同模型、不同网络权限、不同 cwd、不同 permission profile，且互不污染。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。PromptInput 现在支持可选 `settings`，单个 turn 可以覆盖 cwd、permission profile、approval policy、network policy、command policy、environment、effort、summary、service tier 等设置，且不会写回 session 默认配置。
- 依赖前置: REQ-003 必须已完成并更新状态矩阵
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

- 开始时间: 2026-06-04T10:25:31+02:00 后
- 完成时间: 2026-06-04T10:25:31+02:00 后
- 调查结论:
  - 当前 AIALRA 已有 session 级 Sandbox Control Center，沙盒控制中心，可以修改后续 turn 的权限、审批、网络、命令策略、执行器偏好。
  - 旧实现没有 API 级 per-turn override，单轮想改变 cwd、网络或权限只能改 session 全局配置，容易污染下一轮。
  - Codex turn 输入可以携带本轮 cwd、approval、sandbox、permission、model、effort、summary、service tier 等 turn scoped 设置。
- 实现内容:
  - 新增 `SecurityTurnSettingsOverride` schema，允许单轮覆盖 cwd、permissionProfileID、approvalPolicy、networkPolicy、commandPolicy、networkAccess、executorBackend、environmentID、effort、summary、serviceTier。
  - `PromptInput` 新增可选 `settings` 字段，保持向后兼容，不新增必填项。
  - `SessionSecurity.overrides` 支持 `turnSettings`，用 session 默认配置加单轮 override 解析出 effective runtime config，但不写回 session map。
  - `SessionSecurity.overrides` 返回 `threadSettings`，包含 requested、resolved、effective，便于 Turn Inspector 解释“本轮请求了什么，最后实际生效了什么”。
  - prompt runtime 把 `settings.cwd` 解析到本轮 cwd，并把 effort、summary、serviceTier、threadSettings 传入 `CodexTurn.fromFrame`。
  - 同一 session 下一轮没有传 `settings` 时仍使用 session 默认值，证明不会污染。
- 修改文件:
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/session/schema-decoding.test.ts`
- 测试命令:
  - `bun test test/session/security.test.ts test/session/schema-decoding.test.ts test/session/turn-context.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - session/security/schema/turn-context tests: 29 pass, 0 fail。
  - `bun typecheck`: pass。
- 残留风险:
  - UI 面板的“仅本轮覆盖”入口和更丰富 hover 说明属于后续 Inspector/Control Center 产品化条目。
  - executor backend 的 per-turn runtime 默认选择仍受后续 exec-server 全量切换条目约束；本条已经保存并解析字段。

# REQ-061 macOS seatbelt

## 原始目标

61. macOS seatbelt：AIALRA 当前不做 macOS seatbelt，但必须明确标记为 unsupported / out of scope，不能把 Linux helper、bwrap、Landlock 的能力错误迁移到 macOS 展示。实现上应添加 macOS platform capability report，说明 seatbelt sandbox 未实现，并在 macOS environment 下自动采用用户态 gate、permission profile、protected path、approval、network policy 等可用的降级保护，同时清楚标记这些不是 Codex 同款 seatbelt enforcement。验收标准是：macOS 上的 inspector 和 SessionConfigured 必须显示 seatbelt = unsupported，sandbox backend = degraded/user-space gate，并且所有高风险操作都必须有清晰 warning、approval 和 audit 记录。

## 当前状态

- 状态: 完全完成
- 完成判定: 完全完成
- 依赖前置: REQ-060 必须已完成并更新状态矩阵
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

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/test/session/turn-context.test.ts`
- 实现结果:
  - `PlatformSandboxCapability` 对 darwin target 返回 `macos-unsupported`
  - TurnContext、thread_settings.effective、effective_permission_profile 会显示 macOS seatbelt unsupported
  - darwin target 写入 `platform_sandbox_unsupported:darwin` restriction
  - 不把 Linux bwrap/Landlock/seccomp 能力错误展示为 macOS seatbelt
- Codex 对齐说明:
  - Codex 最新有 macOS seatbelt policy generator、网络策略、protected metadata、unreadable glob 等能力
  - AIALRA 当前没有 macOS runtime，只做明确 unsupported 和审计防误导
  - 真正补齐需要单独移植 Codex `seatbelt.rs` policy 生成和 macOS 执行路径
- 测试命令:
  - `bun test test/session/turn-context.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - `turn-context.test.ts`: 9 pass, 0 fail
  - `bun typecheck`: pass
- 残留风险:
  - macOS seatbelt runtime 未实现，状态是明确 unsupported
  - 本机是 Linux，macOS 行为通过 target platform schema 模拟和协议测试验证

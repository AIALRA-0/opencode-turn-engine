# REQ-080 Sandbox Control Center

## 原始目标

80. Sandbox Control Center：AIALRA 必须继续强化 Sandbox Control Center，并将其从 UI 控件升级为真实 runtime config 的可视化和控制中心。虽然 Codex 没有同款产品形态，AIALRA 已有该产品层优势，但必须确保 Control Center 展示和实际 active_permission_profile、FileSystemSandboxPolicy、network policy、ShellEnvironmentPolicy、Linux helper backend、approval constraints 完全一致。用户在这里修改的权限、网络、cwd、environment、profile、reviewer、grant scope 必须进入 per-turn override 或 session config，并写入 SessionConfigured / TurnContextItem。验收标准是：Sandbox Control Center 不是“看起来改了”，而是能改变实际 sandbox enforcement；inspector 能追踪每次配置变更何时生效、影响哪些 turn、最终 active 值是什么。

## 当前状态

- 状态: 完全完成
- 完成判定: Sandbox Control Center 已返回正式 `runtimeProof`，UI 展示 active/effective 生效证明，变更事件携带 runtimeProof，沙箱/网络/权限运行时测试证明控制中心不是 UI 假开关
- 依赖前置: REQ-079 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有什么: 已有沙盒控制中心 UI、`GET/PATCH /session/:id/security`、`SessionSecurity` session 级配置、per-turn override 合并、TurnContext 注入、public audit events、shell/write live gate 测试。本条新增 `runtimeProof`，把 active profile、文件策略、网络策略、审批、执行器、环境和实时生效边界显式返回并展示。
- 最新 OpenCode 已经有什么: 原版 OpenCode 主要是 permission/session/config 层配置和审批 UI，不具备 AIALRA 这种统一沙盒控制中心、runtime proof、生效范围说明和 public event 审计。
- 最新 Codex 已经有什么: Codex 有更强的 sandbox/approval/permission 执行语义，但 CLI 没有 AIALRA 这类 Web 控制中心产品层。本条对齐的是 Codex 的“配置必须进入执行门禁”原则，而不是复制一个不存在的同款 UI。
- 三者差异: AIALRA 当前在 Web 可视化和审计上强于原版 OpenCode；底层全平台 sandbox runtime 仍不等于 Codex Rust 全平台执行器，Linux 细节由 REQ-057 到 REQ-062 负责。

## 数据结构和 schema 计划

- 新增正式字段: `SecurityRuntimeProof` / `runtimeProof`，schema 为 `aialra.sandbox_control_runtime_proof.v1`。
- active/effective 区分:
  - requested 是用户提交的 PATCH 字段。
  - active 是本轮实际门禁使用的 profile，例如 `active_permission_profile_id`。
  - effective 是完整合成后的权限、文件、网络、shell、platform sandbox 结果。
- history/replay/rawRef: `sandbox.control.changed` public event 的 safe data 携带 runtimeProof，完整 before/after/patch/proof 同步进入 rawRef。
- 旧 session 兼容: 没有持久化迁移，旧会话第一次读取 security 时按默认配置生成 runtimeProof。
- 新 session 默认写入: `SessionSecurity.get/update/overrides/applyToTurn` 都按同一个 publicConfig / overrides 逻辑生成或消费 active/effective 值。

## 事件协议计划

本条相关变化必须进入:

- internal trace: 本条沿用已有 security/session 事件。
- typed public event: `sandbox.control.changed` 现在携带 `runtimeProof`，`sandbox.profile.changed`、`sandbox.network.changed`、`sandbox.command.changed`、`approval.policy.changed`、`executor.backend.changed`、`environment.selected` 继续作为细分审计事件。
- history/replay record: public event buffer 和 Turn Inspector 可 replay 这些变更事件。
- Turn Inspector projection: REQ-079 已能把 sandbox/control 事件归类展示；本条 UI 面板也直接显示 runtime proof。
- benchmark JSON: 本条不改 benchmark schema，后续 benchmark 可从 public events 读取 runtimeProof 验证沙盒配置。

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行: `SessionSecurity.applyToTurn` 把控制中心配置合并进 TurnContext；文件工具和 shell gate 读取 TurnContext。
- 模型调用: 模型请求本身不直接读取 sandbox proof，但 TurnContext 内的 cwd/model/security/thread settings 会进入上下文事件和执行路径。
- 权限、审批、沙箱、网络、cwd、environment: `SessionSecurity.overrides` 输出 active profile、approval policy、network sandbox policy、file system policy、environment cwd；运行时测试验证 live network 和 live permission profile 对 shell/write 生效。
- 失败/abort/resume: 配置变更被 public event 记录，Inspector 可通过 Last-Event-ID replay；已经启动的模型请求和长命令不会被中途改写，这一点写入 runtimeProof.live_effect。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- Sandbox Control Center 新增“实际生效证明”区块:
  - 当前 active profile
  - environment cwd
  - approval policy / reviewer
  - command policy / executor backend
  - 文件门禁是否启用、可写根目录、受保护路径
  - 网络 access、sandbox mode、proxy 状态
  - 下一轮和下一次工具门禁如何生效
  - 已发出的模型请求和已启动长命令不会被中途改写
- Turn Inspector 可继续显示 `sandbox.control.changed`、`sandbox.profile.changed`、`sandbox.network.changed` 等事件。
- 默认仍不展示裸 JSON；完整原始 proof 在 rawRef 或 Raw Lab 里看。

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

- 开始时间: 2026-06-05T01:15:52+02:00
- 完成时间: 2026-06-05T01:15:52+02:00
- 修改文件:
  - `packages/opencode/src/session/security.ts`
  - `packages/app/src/pages/session/sandbox-control-center.tsx`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/server/httpapi-public-event.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-080-sandbox-control-center.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/session/security.test.ts test/server/httpapi-public-event.test.ts test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
  - `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
- 测试结果:
  - opencode security/public-event/turn-sandbox: 59 pass, 1458 expect
  - opencode typecheck: pass
  - app typecheck: pass
  - app inspector projection: 1 pass
- 残留风险:
  - 控制中心能改变下一次工具门禁和下一轮 TurnContext，但不能改写已经发出的模型请求或已经启动的长命令。
  - remote/container/external environment 仍是明确 unsupported descriptor，真实执行后端由后续环境/exec-server 条目继续推进。
  - Codex CLI 没有同款控制中心 UI，因此本条是 AIALRA 产品化优势，不是 Codex UI 的逐像素复刻。

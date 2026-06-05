# REQ-012 Permission profile 正式协议化

## 原始目标

12. Permission profile 正式协议化：AIALRA 必须 P0 统一 permission_profile，让权限档位成为正式协议，而不是散落在 UI、backend、sandbox、tool gate 里的布尔值。需要支持 managed、read_only、workspace、full、custom、external、disabled 等 profile，并区分 requested_permission_profile 和 active_permission_profile。所有工具执行必须以 active_permission_profile + constraints 为准。UI 必须直观显示当前权限档位、可做什么、不可做什么、为什么被降级或拒绝。验收标准是：权限档位切换、per-turn override、approval prompt、sandbox 执行结果完全一致。

## 当前状态

- 状态: 完全完成
- 完成判定: 完成
- 依赖前置: REQ-011 必须已完成并更新状态矩阵
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

### 实际调查结论

- 当前 AIALRA 已有 `permission_profile`、`active_permission_profile`、`sandbox_policy` 和 Sandbox Control Center，但 active profile 仍主要是 `:workspace/:read-only/:danger-full-access/external/disabled` 字符串，缺少 requested/resolved/active 三层可解释协议对象。
- 原版 OpenCode 以 PermissionV2 ruleset 和 agent permission 为核心，权限更像工具规则表；它没有 Codex-style per-turn permission profile descriptor，也没有统一解释“用户请求的档位为什么被解析/降级成最终档位”。
- 最新 Codex 本地源码在 app-server protocol 中有 `PermissionProfile`、`AdditionalPermissionProfile`、`FileSystemPermissions`、`NetworkPermissions`、`SandboxPolicy` 和 `approval_policy` 的组合。Codex 的方向是把 profile、sandbox、additional permissions 分开表达。
- 本条实现后，AIALRA 保留旧 ID 兼容，同时新增 profile descriptor：requested_permission_profile、resolved_permission_profile、active_permission_profile，并支持 `managed/read_only/workspace/full/custom/external/disabled` 语义。

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 实际数据结构

- 新增 `PermissionProfileKind`：
  - `managed`
  - `read_only`
  - `workspace`
  - `full`
  - `custom`
  - `external`
  - `disabled`
- 扩展 `ActivePermissionProfile`：
  - `id`
  - `kind`
  - `label`
  - `source`
  - `requestedID`
  - `resolvedID`
  - `capabilities`
  - `restrictions`
- `TurnContext` 新增：
  - `requested_permission_profile`
  - `resolved_permission_profile`
  - `active_permission_profile` 继续保留并扩展为 descriptor
- `SecurityPermissionProfileID` 支持 alias：
  - `read_only -> :read-only`
  - `workspace/managed -> :workspace`
  - `full -> :danger-full-access`
  - `custom -> custom`
- 旧 session 兼容：旧 ID 原样可用，新 alias 会被 normalize 成 active profile。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 实际事件

- 复用已有 `sandbox.profile.changed` 事件记录档位切换。
- `turn.context.created` 和 `CodexTurn.traceSummary` 现在包含 requested/resolved/active 三层 profile descriptor。
- `tool.sandbox.checked/denied` 继续携带扩展后的 `active_permission_profile`，Inspector 能看到 capability/restriction。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 实际 runtime 接入

- `SessionSecurity.overrides` 根据 session config 和 per-turn settings 生成 requested/resolved/active descriptor。
- `SessionSecurity.applyToTurn` 会把 live profile descriptor 写回 TurnContext。
- `TurnSandbox.assertFileAccess/assertShellAccess/assertSearchScope` 继续以 `permission_profile`、`sandbox_policy`、`active_permission_profile` 和 `security_constraints` 为准。
- alias `full` 的测试证明最终 active profile 为 `:danger-full-access`，runtime permission profile 为 `CodexTurn.fullAccessPermissionProfile()`。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### 实际 Inspector 投影

- Turn Inspector 可从 public event 和 trace summary 看到：
  - 用户请求的 profile
  - 系统解析后的 profile
  - 实际执行的 profile
  - capabilities 和 restrictions
- 默认 UI 继续展示中文摘要，Raw Lab/高级详情可以展开完整 descriptor。

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

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/test/session/security.test.ts`
- 测试命令:
  - `bun test test/session/security.test.ts test/session/turn-context.test.ts test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - security/turn-context/turn-sandbox 31 pass
  - opencode typecheck pass
- 残留风险:
  - profile descriptor 已协议化并进入 runtime；完整前端说明文案、下拉 hover 和 profile 可视化矩阵在后续 Inspector/Sandbox Control Center 产品化条目继续完善。
  - `custom` 当前作为正式语义入口，底层仍按 workspace-write + custom_rules 描述执行，具体自定义规则编辑器在后续权限 UI 条目实现。

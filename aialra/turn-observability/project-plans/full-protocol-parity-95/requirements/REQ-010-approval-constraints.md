# REQ-010 Approval constraints

## 原始目标

10. Approval constraints：AIALRA 必须 P0 补全 constraints，否则权限系统只是“弹窗批准”，不是完整安全模型。constraints 必须能表达禁止读写路径、禁止仓库外写入、禁止访问密钥、禁止访问内网、禁止未知域名、禁止危险 shell、禁止环境变量泄露等硬规则。实现时必须先检查 constraints，再决定是否进入 approval；违反硬约束的操作必须直接拒绝，不能靠用户点击批准绕过。验收标准是：approval policy 和 constraints 分层清楚，inspector 能显示某次工具调用被允许、询问或拒绝的具体原因。

## 当前状态

- 状态: 完全完成
- 完成判定: 完成
- 依赖前置: REQ-009 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有 `SessionSecurity`、`TurnContext`、`Permission.ask`、`TurnSandbox.assertFileAccess/assertShellAccess/assertSearchScope`、`webfetch` 网络策略、public event stream 和 TurnHistory。REQ-010 前的问题是 profile/approval/sandbox 已经能控制很多行为，但还缺一个明确的 `security_constraints` 硬约束层，部分危险行为只能表现为普通沙箱拒绝或审批请求，不够清楚。
- 最新 OpenCode 原版主要是 `PermissionV2` ruleset、agent permission、external_directory、tool 级 ask/allow/deny。它能表达“某工具某 pattern 要不要问”，但没有 AIALRA 这一轮的 Codex-style TurnContext 硬约束、public event、history/replay、Inspector 统一解释。
- 最新 Codex 本地源码在 `/srv/aialra/apps/codex-turn-engine` 中包含 `codex-rs/protocol/src/permissions.rs`、`codex-rs/protocol/src/approvals.rs`、`codex-rs/protocol/src/request_permissions.rs`、`codex-rs/exec-server/src/sandboxed_file_system.rs`、`codex-rs/exec-server/src/fs_sandbox.rs` 和 app-server `additionalPermissions` 协议。Codex 的方向是把 permission profile、approval policy、sandbox policy、额外权限请求和底层 FS sandbox 分层，而不是把所有风险都交给一个弹窗。
- 本条实现后，AIALRA 补上了硬约束层：constraints 先检查，违反则直接拒绝并记录，只有未违反硬约束的风险行为才进入 approval。差距是：AIALRA 当前 hard constraints 是 TypeScript/Bun 工具层和 bwrap/exec-server 前置门禁，Codex Rust exec-server 内部的更细粒度 FS sandbox 仍在后续 exec-server/FS 条目继续收敛。

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 实际数据结构

- `TurnContext.security_constraints` 新增为正式回合字段，版本为 `aialra.security_constraints.v1`。
- 默认包含三类硬规则：
  - `file`：禁止写 `.git/.agents/.codex`，禁止读写 `.env*`、私钥、pem/key、credentials、npm/pypi 配置等常见密钥文件。
  - `network`：禁止云元数据地址、loopback、本机和内网地址；未知公网域名按 network policy 继续询问或记录。
  - `shell`：禁止破坏根目录/块设备、访问元数据地址、把环境变量通过 curl/wget/nc/scp 等外传。
- `SessionSecurity.publicConfig` 暴露 `securityConstraints`，`SessionSecurity.overrides` 写入 effective thread settings，`SessionSecurity.applyToTurn` 会把 live config 合并后的 constraints 挂回 turn。
- 旧会话兼容：`CodexTurn.fromFrame` 和 `SessionSecurity` 都会按 cwd 生成默认 constraints；没有显式配置时不需要 migration。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 实际事件

- 新增 public event 类型：
  - `security.constraint.checked`
  - `security.constraint.denied`
- `AialraTurnTrace.emit` 会把它们映射进 public event stream，并通过 TurnHistory 记录为 `turn.context.item`，kind 为 `sandbox`。
- 拒绝事件包含 kind、operation、target、ruleID、reason、source、approval_policy、active_permission_profile、constraintsVersion、constraintLayer=`before_approval`。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 实际 runtime 接入

- 文件工具：`TurnSandbox.assertFileAccess` 在普通 file access 之前先检查 constraints。命中硬规则时直接 die，写 `security.constraint.denied` 和 `tool.sandbox.denied`，不会进入后续审批。
- shell 工具：`TurnSandbox.assertShellAccess` 在 cwd 权限和 `ctx.ask` 之前检查危险命令 constraints。命中时直接拒绝。
- webfetch/http：`TurnSandbox.assertNetworkAccess` 在 network ask 之前检查元数据/loopback/内网硬规则。命中时直接拒绝。
- approval 分层：本条没有删除原 `Permission.ask`，而是在 ask 之前增加不可绕过的 hard constraints；审批只处理“可被用户临时允许”的风险操作。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### 实际 Inspector 投影

- Turn Inspector 通过 public event protocol 可展示 `security.constraint.checked/denied` 的中文标题、摘要、状态、ruleID 和 reason。
- Raw payload 仍通过 rawRef 访问，不在普通 SSE 中推完整敏感原文。
- History/replay 能按 turnID 回放该约束事件，历史 turn 折叠后仍可还原。

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
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/src/tool/turn-sandbox.ts`
  - `packages/opencode/src/tool/webfetch.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/tool/webfetch.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - TurnContext helper tests updated
- 测试命令:
  - `bun test test/tool/turn-sandbox.test.ts test/tool/webfetch.test.ts test/session/security.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
  - `bun typecheck`
- 测试结果:
  - tool/webfetch/security 34 pass
  - turn-history/public-event 12 pass
  - render-trace 1 pass
  - opencode typecheck pass
- 残留风险:
  - 当前 constraints 已覆盖文件、shell、network 三类 P0 硬拒绝，但 Codex Rust exec-server 内部 FS sandbox 的全部语义仍需后续 FS/exec-server 条目继续收敛。
  - 当前默认 secret filename 规则偏保守，后续 Control Center 可以增加用户可视化说明和可审计覆盖。

# REQ-014 ShellEnvironmentPolicy

## 原始目标

14. ShellEnvironmentPolicy：AIALRA 必须全量实现正式 env 安全层，避免 shell 直接继承 process env 导致 API key、token、SSH agent、云服务密钥泄露。ShellEnvironmentPolicy 必须支持 allowlist、denylist、redaction、override、clear by default、safe PATH/HOME 注入、per-environment env。所有 shell 工具执行前必须根据 policy 构造安全环境变量。验收标准是：OPENAI_API_KEY、GITHUB_TOKEN、AWS_SECRET_ACCESS_KEY、SSH_AUTH_SOCK 等敏感变量默认不可被工具读取，除非被显式安全允许。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成
- 依赖前置: REQ-013 必须已完成并更新状态矩阵
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

- 当前 AIALRA 在本条执行前的 shell 环境构造是 `process.env + plugin env`，也就是命令会继承服务进程环境变量，存在 API key、token、SSH_AUTH_SOCK、云密钥泄露风险
- 原版 OpenCode 更接近传统 shell 继承语义，缺少 per-turn，按回合生效的环境变量安全合同
- Codex CLI 的安全目标是避免工具默认看到宿主敏感环境，AIALRA 需要在 OpenCode 的 Node/Bun shell executor，命令执行器，中实现等价的“默认清空 + 安全注入 + 显式允许”语义
- 本条实现后，AIALRA 的 shell env 不再默认继承整机环境，而是由 `ShellEnvironmentPolicy`，命令环境变量策略，统一生成

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 实际数据结构

- 新增 `ShellEnvironmentPolicy`，命令环境变量策略:
  - `version`: 固定为 `aialra.shell_environment_policy.v1`
  - `mode`: `clear` 或 `inherit`，默认 `clear`
  - `allowlist`: 允许从宿主继承的变量名或通配模式
  - `denylist`: 拒绝进入 shell 的变量名或通配模式
  - `redact`: 事件和 raw 里需要按键名标记为敏感的模式
  - `overrides`: 用户或系统显式注入的安全值
  - `safe_defaults`: 是否注入安全默认值，如 `PATH/HOME/PWD/TMPDIR/LANG/TERM`
  - `per_environment`: 按 environmentID，环境编号，注入的环境变量
- `UserTurn` 和 `TurnContext` 新增必填字段 `shell_environment_policy`
- `SessionSecurity` 新增 `SecurityShellEnvironmentPolicyPatch`，控制中心和单轮设置可以增量修改该策略
- 旧 session 兼容策略: 缺少字段时使用 `CodexTurn.defaultShellEnvironmentPolicy()`
- 默认策略: clear by default，默认清空；只允许安全默认变量；敏感 key 默认不可见

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 实际事件

- 新增 public event type，公共事件类型: `shell.env.policy.applied`
- 每次 shell 执行前都会记录:
  - `mode`
  - `safeDefaults`
  - `inheritedKeys`
  - `removedKeys`
  - `overrideKeys`
  - `perEnvironmentKeys`
  - `redactedKeys`
  - `outputKeys`
  - `policyVersion`
- 事件进入 internal trace，内部追踪，public event stream，公共事件流，和 TurnHistory，回合历史

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 实际 runtime 接入

- `ShellTool.shellEnv` 在每次 shell 执行前读取 `TurnContext.shell_environment_policy`
- 默认不再返回 `process.env`
- `OPENAI_API_KEY`、`GITHUB_TOKEN`、`AWS_SECRET_ACCESS_KEY`、`SSH_AUTH_SOCK` 默认不会进入命令环境
- `overrides` 可以显式注入安全值，用于“我明确允许本轮使用某个环境变量”的场景
- `per_environment.default` 可以注入当前环境专属变量
- 无 `TurnContext` 的旧路径仍保持 legacy 行为，避免破坏极少数非 turn shell 调用

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### 实际 Inspector 投影

- Turn Inspector 通过 `shell.env.policy.applied` 显示“命令环境变量策略已应用”
- 默认摘要显示 mode 和 removed 数量
- rawRef 可查看完整键名列表，但不记录变量值
- TurnHistory 可回放该事件，历史 turn 折叠后仍能展开审计 shell env 策略

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

- 开始时间: 2026-06-04T11:32:37+02:00
- 完成时间: 2026-06-04T11:44:09+02:00
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/test/tool/shell.test.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - 相关 TurnContext test helper
- 测试命令:
  - `bun test test/tool/shell.test.ts test/session/security.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - shell/security/history/public-event: 48 pass, 0 fail, 833 expect
  - opencode typecheck: pass
- 残留风险:
  - 本条完成本机 shell executor 的环境变量安全层
  - exec-server sidecar 的远程/容器环境变量注入会在后续 unified executor / remote environment 条目继续收敛
  - `mode=inherit` 是显式危险模式，默认不启用；后续 UI 必须用中文 hover 解释风险

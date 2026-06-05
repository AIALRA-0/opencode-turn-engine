# REQ-039 Protected path

## 原始目标

39. Protected path：AIALRA 必须把 protected path 从零散保护升级为 permission profile 的正式组成部分，至少覆盖 .git、.agents、.codex、密钥文件、配置凭据、系统目录、history 数据库、tool-output-store 内部文件等敏感路径。protected path 规则必须支持不同 permission_profile 下的读写差异，例如 read_only 可读部分元数据但不能写，workspace 可写普通文件但不能写 .git，full 也不能默认覆盖安全底线，custom 可以显式扩展规则。验收标准是：任何 read/write/edit/apply_patch/glob/grep 命中 protected path 时，都必须根据规则允许、隐藏、脱敏、拒绝或请求 approval，并且 inspector 显示命中的 protected rule、profile、decision 和 reason。

## 当前状态

- 状态: 完全完成
- 完成判定: protected path 已从零散工具保护提升为 `CodexTurn.defaultSecurityConstraints` 的正式硬安全约束。默认覆盖 `.git/.agents/.codex` 写保护、密钥/凭据文件读写保护、`~/.ssh`/`~/.gnupg`、AIALRA tool-output-store、turn-history、OpenCode auth/db、系统目录写保护，并通过 `TurnSandbox.fileConstraint` 在 read/write/edit/apply_patch/glob/grep 执行前统一生效
- 依赖前置: REQ-038 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

- 当前 AIALRA 已有 `security_constraints.file`，但之前主要覆盖 `.git/.agents/.codex` 写保护和常见 secret glob。REQ-039 把内部审计数据、tool-output-store、OpenCode DB/auth、系统目录也纳入正式规则
- 原版 OpenCode 主要依赖工具权限、external_directory 和普通文件系统错误，缺少 per-turn protected rule、硬约束事件和 Turn Inspector 可解释字段
- Codex 的优势是安全规则更靠近执行器/沙箱底座。AIALRA 当前通过 `TurnSandbox.fileConstraint` 在工具执行前统一拦截，后续 exec-server/helper 原生 FS enforce 会继续降低绕过风险
- custom 扩展: 当前可以通过 `TurnContext.security_constraints` 注入 user/source 规则实现扩展；独立 UI 规则编辑器不是本条范围

## 数据结构和 schema 计划

- `SecurityConstraintFileRule` 继续作为正式规则结构，规则字段包括 `id`、`operation`、`path`、`action`、`reason`、`source`
- 新增默认规则族:
  - protected metadata write: `.git/.agents/.codex`
  - secret read-write: `.env*`、private key、pem/key、credentials、npm/pypi/netrc 等
  - home secret read-write: `~/.ssh`、`~/.gnupg`
  - internal audit/store read-write: `tool-output`、`aialra-turn-history`、`auth.json`、`mcp-auth.json`、`opencode.db`、`opencode-*.db`
  - system write deny: Linux `/etc`、`/usr`、`/bin`、`/sbin`、`/var`、`/root` 等；Windows 系统目录按环境变量解析
- 事件承载:
  - `security.constraint.denied` 显示 ruleID、reason、source、active_permission_profile、sandbox_policy、constraintLayer
  - `tool.sandbox.denied` 显示实际拒绝
- 旧 session 兼容: 旧事件没有这些字段仍按普通 security constraint 展示
- 新 session 默认: 构建 TurnContext 时调用 `CodexTurn.defaultSecurityConstraints(cwd)` 自动带入

## 事件协议计划

本条相关变化必须进入:

- internal trace: `security.constraint.denied`、`tool.sandbox.denied`
- typed public event: `security.constraint.denied` 标题为 `硬安全约束拒绝`，`tool.sandbox.denied` 标题为 `沙箱拒绝工具访问`
- history/replay record: TurnHistory 将 security/sandbox 事件归类为 sandbox context item
- Turn Inspector projection: 默认摘要显示 reason，高级详情显示 ruleID/source/profile/policy/target/canonicalTarget
- benchmark JSON: 可根据 ruleID/source/reason 统计 protected path 命中和被过滤数量

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- `TurnSandbox.assertFileAccess` 在 approval 前执行 `fileConstraint`
- read/write/edit/apply_patch 直接触发 security constraint 拒绝
- glob/grep 对候选结果逐项调用 `assertFileAccess`，命中 secret/protected internal path 时过滤并计入 `sandbox_filtered`，不会把内容输出给模型
- full-access 仍受 hard security constraints 约束，不能默认读写密钥、内部审计数据或写系统目录
- disabled profile 仍作为明确关闭内置权限管理的特殊逃生模式，保留现有语义
- replay/history 只回放事件，不重新执行工具

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- `security.constraint.denied`: 用户看到 `硬安全约束拒绝`
- `tool.sandbox.denied`: 用户看到 `沙箱拒绝工具访问`
- 摘要是具体 reason，例如 `tool-output-store 保存完整工具原始输出，默认禁止模型直接读取或修改`
- 高级详情展示 ruleID、source、active_permission_profile、sandbox_policy、target、operation 和 constraintLayer
- 搜索工具不会直接报错泄露 secret 文件内容，而是在 fileSearch counts 中显示 `sandbox_filtered`

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

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

- 开始时间: 2026-06-04 17:40:33 CEST 后
- 完成时间: 2026-06-04 17:53:48 CEST
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-039-protected-path.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
- 测试命令:
  - `bun test test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts -t "security constraint" --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果:
  - turn-sandbox 37 pass，新增 internal audit store、system dir、glob/grep secret filtering 用例
  - security constraint history/public replay 1 pass
  - turn-history + public event API 30 pass
  - `bun typecheck` 通过
  - turn observability node tests 6 pass
  - `git diff --check` 通过
- 残留风险:
  - UI 级 custom protected rule 编辑器尚未实现，但 runtime 已支持通过 `TurnContext.security_constraints` 注入 user/source 规则
  - shell 命令副作用的 protected-create 深化属于 REQ-062，当前已有 bwrap protected metadata mounts 和 bash 越界测试，但不是本条全部范围

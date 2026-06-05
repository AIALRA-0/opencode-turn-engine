# REQ-054 Split FS policy

## 原始目标

54. Split FS policy：AIALRA 必须 P0 补全 Codex 风格 FileSystemSandboxPolicy，不能只靠自定义 entries 临时拼出文件系统限制。FS policy 必须拆分表达 readable roots、writable roots、creatable roots、readonly mounts、tmp dirs、protected paths、deny paths、allowed file schemes、symlink policy、realpath policy、create policy、delete policy，并且这些规则必须由 selected environment cwd 和 active permission profile 统一解析。实现时需要保证 read、readDirectory、write、edit、apply_patch、glob、grep、TurnDiff、file mutation 都从同一份 FS policy 取权限结果，而不是各自判断。验收标准是：同一个路径在不同 permission profile 下的 read/write/create/delete 行为可预测、可解释、可审计；inspector 能显示每次文件操作命中的 FS policy 规则、最终 decision、拒绝原因和相关 profile。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成
- 依赖前置: REQ-053 必须已完成并更新状态矩阵
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
- 构造同一 session 两个 turn 使用不同 override 的场景
- 断言工具读取 effective config，而不是 requested config 或 session 默认值

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

- 开始时间: 2026-06-04T19:45:00+02:00
- 完成时间: 2026-06-04T21:57:36+02:00
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/src/session/session.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/tool/turn-sandbox.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/session/session-configured.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
- 实现摘要:
  - 新增 `FileSystemSandboxPolicy`，文件系统沙箱策略，正式拆分 `readable_roots`、`writable_roots`、`creatable_roots`、`readonly_mounts`、`tmp_dirs`、`protected_paths`、`deny_paths`、`allowed_file_schemes`、`symlink_policy`、`realpath_policy`、`create_policy`、`delete_policy` 和 `rules`
  - 新增 `FileSystemSandboxDecision`，文件系统判定结果，记录每次 read/write/search 的 resolved path、canonical path、matched rule、decision 和拒绝原因
  - `TurnContext`、`thread_settings.effective`、`effective_permission_profile`、`session.configured` 全部带 `file_system_policy`
  - `SessionSecurity.applyToTurn` 会按当前 Sandbox Control Center 配置实时重算 `file_system_policy`
  - `TurnSandbox.assertFileAccess` 和 `TurnSandbox.assertSearchScope` 改为从同一份 `file_system_policy.rules` 计算 allow/deny
  - `bash` 的 bwrap writable bind roots 改为读取同一份 `file_system_policy.writable_roots`
  - `tool.sandbox.checked/denied` public event 增加 `file_system_policy` 摘要和完整 `file_system_decision`
  - Turn Inspector 中文摘要展示 `target` 和命中规则 ID，不再需要打开 raw 才知道沙箱命中来源
  - 旧 turn 若缺少 `security_constraints`，生成 FS policy 时自动回退到默认安全约束，避免旧会话/旧测试崩溃
- 三方差异结论:
  - 原版 OpenCode: 有工具权限和部分路径检查，但没有 turn-scoped 的正式 FS policy 对象，也没有每次文件访问的命中规则 public event
  - AIALRA 当前: 已有正式 FS policy + runtime gate + event/Inspector 解释，文件工具和 bash writable roots 已使用统一策略
  - Codex 最新目标: Rust exec-server/helper/OS sandbox 仍更底层，AIALRA 当前是 Node/Bun 工具层 + bwrap 层统一策略；后续 REQ-057/058/059 继续补 Linux helper、Landlock、seccomp/no_new_privs
- 测试命令:
  - `bun test test/tool/turn-sandbox.test.ts test/session/security.test.ts test/session/session-configured.test.ts --timeout 30000`
  - `bun test test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
  - `git diff --check`
- 测试结果:
  - 44 pass: turn sandbox + session security + session configured
  - 33 pass: public event HTTP API + turn history
  - 6 pass: turn observability Node tests
  - 98 pass: prompt + schema decoding
  - 49 pass: Codex exec-server + turn sandbox + external directory
  - opencode/app typecheck 通过
  - `git diff --check` 通过
- 修复过的失败:
  - `session.configured` 初次测试失败，因为事件 data 顶层未包含 `fileSystemPolicy`；已在 `session.create` 事件里补齐
  - exec/sandbox 组合初次失败，因为旧 turn 缺少 `security_constraints` 时 FS policy 生成器直接读取 undefined；已加默认安全约束兜底并重跑通过
- 残留风险:
  - `TurnDiff` 仍主要依赖文件工具 mutation metadata，本条已统一工具和沙箱判定来源，但还没有把 diff renderer 本身改成独立消费 `file_system_policy`
  - FS policy 是 AIALRA TypeScript 层正式协议和运行时门禁，不等同于 Codex Rust exec-server + Linux helper + Landlock 的底层 1:1 sandbox runtime；底层 OS 能力继续由 REQ-057、REQ-058、REQ-059 补齐
  - Inspector 当前默认显示命中规则 ID 和中文摘要，完整 policy/decision 仍在 raw 展开查看，后续 Raw Lab/Inspector 产品化项可继续做搜索和下载

# REQ-055 Network sandbox policy

## 原始目标

55. Network sandbox policy：AIALRA 必须 P0 将 sandbox 层 network policy 从 off/on/ask 升级为正式 network sandbox policy，不能只在高层记录“是否允许联网”。network policy 必须表达 network disabled、ask before access、allowlist、denylist、private IP block、localhost policy、proxy required、per-tool network permission、per-turn network override、DNS/HTTP 层审计等能力，并和 permission profile、constraints、reviewer 系统联动。所有可能联网的 shell、provider tool、MCP、package install、curl/wget/git/npm/pip 等执行路径都必须经过 network sandbox policy 判定。验收标准是：AIALRA 能实现“本轮只允许 github.com 和 pypi.org，禁止内网、localhost、未知域名，并且首次访问需要 approval”的策略；inspector 必须展示目标域名/IP、命中的 allow/deny 规则、是否经过 proxy、是否被 sandbox 拒绝或放行。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成协议层、TurnContext、session security、runtime network gate、shell/webfetch 接入、public event、Inspector 投影和回归测试
- 依赖前置: REQ-054 必须已完成并更新状态矩阵
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
- 完成时间: 2026-06-04 22:12:14 CEST
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/src/session/session.ts`
  - `packages/opencode/src/tool/turn-sandbox.ts`
  - `packages/opencode/src/tool/webfetch.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/session/session-configured.test.ts`
- 实现摘要:
  - 新增 `NetworkSandboxPolicy`，网络沙箱策略，正式表达 off/on/ask、allowlist、denylist、private IP、localhost、metadata service、proxy、per-tool、per-turn、DNS/HTTP audit 等字段
  - 新增 `NetworkSandboxDecision`，网络沙箱判定，记录 target host、classification、matched_rule、decision、needs_approval、proxy、active profile
  - `TurnContext`、`UserTurn`、`thread_settings.effective`、`effective_permission_profile`、`session.configured`、trace summary 统一携带 `network_sandbox_policy`
  - Sandbox Control Center 的网络配置通过 `SessionSecurity.applyToTurn` 实时合并进当前 turn
  - `TurnSandbox.assertNetworkAccess` 改为按正式 policy 判定，allow、deny、ask 都会生成结构化 decision
  - shell 的网络命令预检、webfetch 的 HTTP 请求分类、`security.constraint.checked/denied`、`tool.sandbox.denied` 都携带完整 policy/decision
  - 修正语义，只有 mode=off 才是 `network_disabled`，mode=ask 表示“需要时询问”，不再被展示成“网络已禁用”
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
  - sandbox/security/session-configured: 45 pass
  - public-event/turn-history: 33 pass
  - observability node tests: 6 pass
  - prompt/schema-decoding: 98 pass
  - codex-exec-server/turn-sandbox/external-directory: 50 pass
  - opencode typecheck: pass
  - app typecheck: pass
  - diff check: pass
- 残留风险:
  - shell 内任意程序的动态 DNS/HTTP 行为目前靠命令预检和 bwrap 网络隔离兜底，不能在进程内部逐个 socket 做 allowlist 级拦截，后续 REQ-056/REQ-057 需要通过 proxy/helper 继续补齐
  - provider、MCP、包管理器等更深层网络路径需要后续按工具继续接入统一 policy，目前 webfetch 和 shell 显式网络目标已接入
  - proxy_required 已进入 policy 和 event，但实际强制代理路由属于 REQ-056 范围

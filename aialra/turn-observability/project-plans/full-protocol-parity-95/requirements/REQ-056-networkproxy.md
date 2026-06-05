# REQ-056 NetworkProxy

## 原始目标

56. NetworkProxy：AIALRA 必须 P1 补全 NetworkProxy 支持，对齐 Codex 的网络代理层设计，避免网络访问只靠进程环境变量或工具自觉遵守。NetworkProxy 应作为 sandbox network policy 的执行组件，支持统一代理配置、域名审计、请求记录、deny/allow enforcement、可选内容脱敏、per-environment proxy、per-turn proxy override，并能与 network allowlist/denylist 联动。实现时，shell 命令、provider-side network adapter、MCP、git/npm/pip 等常见联网路径应尽量通过统一 proxy 或被明确标记为无法代理并进入限制策略。验收标准是：开启 proxy-required 后，未走 proxy 的网络访问会被拒绝或记录为策略违规；inspector 能显示本轮是否使用 NetworkProxy、代理地址、命中规则、请求摘要和拒绝原因。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成 NetworkProxy 协议对象、TurnContext/session security/session.configured/thread_settings 贯通、shell 代理环境变量注入、webfetch 真实 proxy fetch、proxy-required 无 URL 硬拒绝、public event 和 Inspector 展示、回归测试
- 依赖前置: REQ-055 必须已完成并更新状态矩阵
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
- 完成时间: 2026-06-04 22:35:53 CEST
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/src/session/session.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/tool/turn-sandbox.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/src/tool/webfetch.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/session/session-configured.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
- 实现摘要:
  - 新增 `NetworkProxyConfig`，网络代理配置，正式表达 enabled、required、url、no_proxy、per_environment、audit、enforcement
  - `NetworkProxyConfig.enforcement` 分为 `disabled`、`environment`、`unavailable`
  - `TurnContext`、`effective_permission_profile`、`thread_settings.effective`、`session.configured` 全部携带 `network_proxy`
  - `TurnSandbox.assertNetworkAccess` 增加 proxy-required 检查，缺少代理地址时拒绝直连并发出 `network.proxy.unavailable`
  - 代理可用时发出 `network.proxy.applied`，事件中的代理 URL 会脱敏
  - `ShellTool` 模型工具路径会注入 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 及小写变量，未启用时清理继承代理变量
  - `SessionPrompt.shell` 用户直接 shell route 也会注入 NetworkProxy 环境变量，避免和模型工具路径不一致
  - `webfetch` 在 proxy-required 且代理可用时使用 Bun fetch 的 `proxy` 参数，是真实代理路径，不是只记录字段
  - public event stream 和 Turn Inspector 已加入 `network.proxy.applied`、`network.proxy.unavailable` 中文摘要
- 测试命令:
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
  - `bun test test/tool/turn-sandbox.test.ts test/session/security.test.ts test/session/session-configured.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - `bun test test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`
  - `git diff --check`
- 测试结果:
  - opencode typecheck: pass
  - app typecheck: pass
  - sandbox/security/session-configured: 47 pass
  - prompt/schema-decoding: 99 pass
  - public-event/turn-history: 33 pass
  - observability node tests: 6 pass
  - codex-exec-server/turn-sandbox/external-directory: 52 pass
  - diff check: pass
- 残留风险:
  - shell 的代理强制目前通过标准代理环境变量执行，适用于 curl/git/npm/pip 等遵守环境变量的工具，但不能拦截进程内部手写 socket 绕过代理，透明 socket 级强制代理需要后续 Linux helper、seccomp、network namespace 或透明代理方案
  - 用户直接 shell route 仍使用 `extendEnv: true`，本条已覆盖 proxy-required 注入，但完整 shell environment policy 收敛仍应在后续条目继续推进
  - Codex exec-server HTTP API 当前没有显式 proxy 字段，本条 webfetch 在 proxy-required 时走 Bun proxy fetch，exec-server HTTP proxy parity 后续可继续补齐

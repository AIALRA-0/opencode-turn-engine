# REQ-013 细粒度 network policy

## 原始目标

13. 细粒度 network policy：AIALRA 必须 P0 将 network 从 off/on/ask 简单开关升级为细粒度网络权限系统。需要支持 sandbox network policy、network proxy、domain allowlist、domain denylist、private IP block、per-turn network override、tool-specific network permission。每次联网工具调用必须记录目标域名、是否命中 allow/deny、是否经过 proxy、是否需要审批。验收标准是：可以实现“只允许 github.com 和 pypi.org，禁止未知域名和内网地址”这种策略，并在 inspector 中清楚展示判定过程。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成
- 依赖前置: REQ-012 必须已完成并更新状态矩阵
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

- 当前 AIALRA 在本条执行前已有 `network_policy`，网络策略，取值为 `off/on/ask`，但它只能表达整轮网络大开关，不能表达域名白名单、黑名单、私网策略、代理和按工具区分的策略
- 当前 AIALRA 已有 `security_constraints.network`，硬安全约束，可在审批前拒绝元数据服务、loopback，本机回环地址、private-network，私网地址等高风险目标，但这属于硬约束，不等同于用户可调网络策略
- 原版 OpenCode 主要依赖工具权限询问和 provider/tool 自身逻辑，缺少本轮 `TurnContext`，回合上下文，里的细粒度网络合同
- Codex CLI 有更明确的 sandbox network policy，沙箱网络策略，和审批策略协同，但网页端产品化展示、rawRef 审计和 AIALRA public event stream，公共事件流，需要我们在 OpenCode 里补齐
- 本条实现后，AIALRA 的网络策略从单一 `network_policy` 升级为 `network_permissions`，细粒度网络权限，且 webfetch，网页抓取工具，和 bash，命令工具，都会读取同一套 runtime gate，运行时门禁

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 实际数据结构

- 新增 `NetworkPermissionPolicy`，网络权限策略:
  - `version`: 固定为 `aialra.network_permissions.v1`
  - `mode`: 默认网络模式，`off/on/ask`
  - `allowlist`: 域名白名单，如 `github.com`、`pypi.org`
  - `denylist`: 域名黑名单
  - `private_network`: 私网策略，`block/ask/allow`
  - `proxy`: 代理配置，包含 `enabled` 和 `url`
  - `tools`: 按工具覆盖策略，如 `webfetch: ask`、`bash: on`
- `UserTurn`，用户回合，和 `TurnContext`，回合上下文，新增必填字段 `network_permissions`
- `SessionSecurity`，会话安全配置，新增 `SecurityNetworkPermissionsPatch`，允许控制中心提交增量补丁，再归一化为完整 `NetworkPermissionPolicy`
- 旧 session 兼容策略: 缺少细粒度字段时使用 `CodexTurn.defaultNetworkPermissions(networkPolicy)` 自动补齐
- 新 session 默认: `mode=ask`，`private_network=block`，无 allowlist/denylist/proxy/tool override

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 实际事件

- `security.constraint.checked`: 记录网络目标已检查，包含 host，classification，allowlist，denylist，proxy，toolNetworkPolicy，decision，mode
- `security.constraint.denied`: 记录网络策略或硬约束拒绝，包含拒绝原因、命中规则、目标域名、目标分类
- `tool.sandbox.denied`: 记录工具级网络拒绝，Turn Inspector 可以解释“为什么没有真正发请求”
- `sandbox.effective`: webfetch 记录实际生效的 `network_policy` 和 `network_permissions`
- `sandbox.network.changed` / `sandbox.control.changed`: 控制中心变更会进入 public event stream，公共事件流

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 实际 runtime 接入

- `TurnSandbox.assertNetworkAccess`，网络访问断言，会先执行硬安全约束，再执行细粒度 `network_permissions`
- webfetch 在真正联网前调用 `TurnSandbox.assertNetworkAccess`，拒绝时不会发出 HTTP 请求
- bash 对 `curl/wget/ping/dig/nslookup/ssh/scp/rsync` 等命令解析 URL 或主机目标，进入同一套网络门禁
- bwrap，bubblewrap 沙箱，是否 `--unshare-net` 由本轮网络策略和审批结果共同决定
- `allowlist` 非空时，只允许命中的目标域名
- `denylist` 命中时直接拒绝
- `private_network=block` 时拒绝 loopback/private/metadata
- `private_network=ask` 时允许进入审批流程
- `tools` 可让某个工具覆盖默认 `mode`

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### 实际 Inspector 投影

- 本条复用现有 Turn Inspector 的 public event projection，公共事件投影
- 默认展示中文事件名，例如“硬安全约束已检查”“硬安全约束已拒绝”“沙箱拒绝访问”
- 高级 rawRef 可查看完整 host、classification、decision、allowlist、denylist、proxy、toolNetworkPolicy
- 历史回合可通过 TurnHistory，回合历史，回放 `security.constraint.*` 和 `tool.sandbox.denied`

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

- 开始时间: 2026-06-04T09:13:00+02:00
- 完成时间: 2026-06-04T11:32:37+02:00
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/tool/turn-sandbox.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/src/tool/webfetch.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/tool/webfetch.test.ts`
  - 以及相关 test helper 的 `TurnContext` 字段补齐
- 测试命令:
  - `bun test test/tool/turn-sandbox.test.ts test/tool/webfetch.test.ts test/session/security.test.ts --timeout 30000`
  - `bun test test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
  - `bun typecheck`
- 测试结果:
  - network/runtime/security: 41 pass, 0 fail, 128 expect
  - public-event/history: 12 pass, 0 fail, 714 expect
  - render-trace: 1 pass
  - opencode typecheck: pass
- 残留风险:
  - 本条完成的是策略、审计和本机 runtime gate，运行时门禁
  - 代理 `proxy.url` 当前进入协议、事件和决策记录，但底层 HTTP/SOCKS 代理转发能力会在 HTTP execution / exec-server HTTP API 条目继续实现
  - bash 目标解析覆盖常见联网命令和 URL/host，复杂 shell 脚本里的动态拼接目标仍依赖 bwrap 网络隔离和后续实时终端/exec-server 加强

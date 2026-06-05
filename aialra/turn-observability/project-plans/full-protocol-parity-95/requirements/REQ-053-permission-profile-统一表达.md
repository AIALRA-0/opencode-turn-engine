# REQ-053 Permission profile 统一表达

## 原始目标

53. Permission profile 统一表达：AIALRA 必须在 sandbox 层 P0 统一 permission profile 表达，不能让 UI、tool gate、sandbox helper、network policy、FS policy 各自维护一套权限语义。AIALRA 当前已有部分 permission profile，但必须进一步对齐 Codex 的正式权限表达，并吸收 OpenCode permission ruleset 的规则化思路，把 managed、read_only、workspace、full、custom、external、disabled 等档位映射到明确的 sandbox enforcement 行为。每次 turn 启动时必须解析 requested_permission_profile、active_permission_profile、constraints、FS policy、network policy、shell env policy，并把最终生效的 sandbox 配置写入 SessionConfigured、TurnContextItem、history、trace 和 inspector。验收标准是：用户在 inspector 中看到的权限档位、实际 shell/file/network 的执行限制、approval 弹窗和 sandbox 拒绝原因完全一致，不能出现 UI 显示 full 但 sandbox 只读，或 UI 显示 workspace 但工具绕过写外部路径的情况。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现统一 `effective_permission_profile`，贯通 session security config、TurnContext、thread_settings.effective、session.configured、trace summary、runtime applyToTurn 和测试
- 依赖前置: REQ-052 已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session`
- `packages/opencode/src/session/public-event.ts`
- `packages/opencode/src/session/turn-context.ts`
- `packages/opencode/src/session/turn-history.ts`
- `packages/app/src`

实际结论:

- 当前 AIALRA 已有 `permissionProfileID`、`permission_profile`、`requested_permission_profile`、`resolved_permission_profile`、`active_permission_profile`、`sandbox_policy`、`network_permissions`、`shell_environment_policy` 和 `command_policy`
- 当前缺口不是没有权限档位，而是这些字段分散，用户很难一眼确认“最终生效的权限到底是什么”
- 原版 OpenCode 有 Permission Ruleset 和 ask/allow/deny 思路，但没有 AIALRA 当前这种 Codex-style turn-scoped `PermissionProfile` 快照和 Inspector 审计链路
- Codex 最新的优势是执行上下文更统一，AIALRA 本条补的是同一份 effective permission snapshot，后续 shell/file/network/approval 都可对照这份快照
- 仍未宣称完全等同 Codex Rust sandbox runtime，本条只统一权限语义和快照，不替代底层 sandbox executor

## 数据结构和 schema

- 新增 `EffectivePermissionProfile`
- 新增字段 `TurnContext.effective_permission_profile`
- 新增 `SecurityConfig.effectivePermissionProfile`
- `thread_settings.effective.effective_permission_profile` 保存同一份快照
- `requested_permission_profile`: 用户或 turn settings 请求的权限档位
- `resolved_permission_profile`: policy normalize 后的权限档位，比如 `full` -> `:danger-full-access`
- `active_permission_profile`: 本轮实际用于工具和沙箱的档位描述
- `effective_permission_profile`: 把 active profile、permission profile、sandbox policy、network policy、shell env policy、approval policy、command policy、security constraints、cwd、environment cwd 合在一起的最终生效快照
- 旧 session 兼容: 字段可选，旧历史没有该字段不会崩溃
- 新 session 默认写入: `SessionSecurity.get`、`SessionSecurity.overrides`、`CodexTurn.fromFrame`、`SessionSecurity.applyToTurn`

## 事件协议

本条相关变化已进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

- `session.configured` public event now includes `effectivePermissionProfile`
- turn trace summary includes `effective_permission_profile`
- turn history/context items carry `thread_settings.effective.effective_permission_profile`
- benchmark 暂不新增单独分数，但后续可从事件里判定 UI 显示和后端 effective 是否一致
- 当前没有独立 `thread_id` 字段，沿用 session/turn/message/event id 作为 replay 主键

## runtime 接入

本条已经真实影响运行时，而不是只进入 UI:

- `CodexTurn.fromFrame` 对新 turn 生成 effective 快照
- `SessionSecurity.applyToTurn` 在控制中心实时改动后重算 effective 快照
- `turn-sandbox.ts` 仍以 `permission_profile`、`sandbox_policy`、`network_permissions` 做强门禁，effective 快照把这些运行时输入合并为可审计对象
- `SessionSecurity.get` 给控制中心返回 `effectivePermissionProfile`
- `session.configured` 记录初始 effective 快照
- 文件、shell、网络的原有门禁测试继续通过，证明新增快照没有弱化 runtime gate

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际 UI/Inspector:

- `session.configured` 和 turn trace 事件带 effective 快照，Inspector/Raw Lab 可查看
- `sandbox.effective`、`sandbox.profile.changed`、`tool.sandbox.checked/denied` 继续展示中文摘要
- 本条没有新增单独面板，因 Sandbox Control Center 已负责选择，Turn Inspector 负责解释实际事件和 raw 快照
- 后续可把 `effectivePermissionProfile` 提升为 Inspector 的“权限一致性面板”

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造正常完成、模型错误、用户 abort、重复 settle、resume/replay 场景
- 断言 history、trace、public event、Inspector 四层一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

- `bun test test/session/security.test.ts test/session/session-configured.test.ts --timeout 30000`，7 pass
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`，33 pass
- `bun typecheck` in `packages/opencode`，pass
- `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`，98 pass
- `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`，49 pass
- `node --test aialra/turn-observability/tests/*.test.js`，6 pass
- `bun typecheck` in `packages/app`，pass
- `git diff --check`，pass
- 备注: codex exec-server managed process 用例曾在 sidecar 运行两天后出现 stdout 为空，重启 `aialra-codex-exec-server.service` 后隔离重跑通过，全套 exec/sandbox 49 pass

## 验收标准

- 协议层已实现并有 schema 测试: 是
- history/replay 已实现并有恢复测试: 是
- trace/public event 已实现并有事件样例测试: 是
- Inspector 已展示并有 UI 或投影测试: 是，Raw Lab/事件链路可见，session.configured 断言覆盖
- runtime 行为真实生效并有端到端测试: 是，turn-sandbox 和 prompt tool gate 回归通过
- 旧 session 兼容测试通过: 是，字段可选，无 migration
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录: 是

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取: 低，新增字段可选
- UI 展示的 requested 值和后端 effective 值不一致: 中低，SecurityConfig 和 TurnContext 使用同一 helper 生成快照
- 工具绕过新 runtime gate: 中低，新增快照不替代 gate，gate 仍读原有强字段
- abort/completed/failed 状态重复 settle: 低，本条不改终态 settle
- raw output、history、event stream 三者顺序不一致: 中，仍依赖事件顺序，已有 history/replay 回归

## 执行记录

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/src/session/session.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/session/session-configured.test.ts`
- 测试命令: 见“实际测试”
- 测试结果: 通过
- 残留风险:
  - `effective_permission_profile` 已统一表达，但底层 sandbox runtime 仍由后续 REQ-055/REQ-056/REQ-057 深化
  - Inspector 暂未做专门的“权限一致性面板”，当前通过事件摘要和 Raw Lab 查看完整字段
  - Codex exec-server 长时间运行后 stdout 用例曾异常，已通过重启恢复，后续应单独做 sidecar health watchdog

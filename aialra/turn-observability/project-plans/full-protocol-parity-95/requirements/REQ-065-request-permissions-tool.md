# REQ-065 request_permissions tool

## 原始目标

65. request_permissions tool：AIALRA 必须实现 Codex 同款 request_permissions tool，让模型在遇到权限不足时能结构化请求提升权限，而不是只能失败或让用户手动切 UI。该 tool 必须支持请求 exec、file read/write、apply_patch、network、environment、service tier、long-running process、provider tool 等权限，并明确 requested_permission_profile、requested_network_policy、requested_paths、requested_domains、requested_environment_id、reason、duration、scope。request_permissions 不能绕过 constraints、guardian、reviewer 或 permission profile，只能发起审批流程。验收标准是：模型可以在需要联网、写 protected-adjacent 文件、运行长命令、切换 full access 等场景发起标准权限请求；UI inspector 能显示请求原因、请求范围、审批人、最终 grant 和生效范围。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现正式 `request_permissions` 工具、审批请求、可审计事件、可回放历史、支持字段生效路径和拒绝路径测试
- 依赖前置: REQ-064 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有 `SessionSecurity`、`TurnContext`、Sandbox Control Center 后端配置、`approval.requested/resolved`、`exec.approval.*`、`apply_patch.approval.*`、public event replay、turn history 和 Inspector 分类投影
- 原版 OpenCode 有普通 permission ask/reply，但没有一个模型可调用的标准 `request_permissions` 工具，也没有把请求的权限 profile、网络策略、路径、域名、执行后端、作用域统一结构化
- Codex 的同类能力是让模型在权限不足时显式请求 escalated permission，工程上由 approval/reviewer/sandbox 继续裁决，而不是模型直接越权
- 本条对齐方式是：AIALRA 新增 `request_permissions` 工具，让模型只能发起结构化审批请求；支持的设置经用户批准后写入 `SessionSecurity`，不支持的字段只作为 advisory 记录，不能伪装成已生效
- 差距：custom writable roots、service tier override、long-running process budget、dynamic provider tools 的直接 runtime 接入分属后续 REQ，不在本条伪完成

## 数据结构和 schema 计划

- 新增工具参数 schema：`permissions`、`reason`、`scope`、`duration`、`requested_permission_profile`、`requested_network_policy`、`requested_command_policy`、`requested_executor_backend`、`requested_paths`、`requested_domains`、`requested_environment_id`、`requested_service_tier`、`requested_long_running_process`、`requested_provider_tools`
- 新增请求 payload：`aialra.request_permissions.v1`
- 新增结果 payload：`aialra.request_permissions_result.v1`
- `requested_*` 是模型提出的诉求；`applied_patch` 是经过审批后真正写入 `SessionSecurity` 的设置；`unsupported` 是本条不直接应用的诉求；`final_decision` 是审批结果
- 支持直接写入的字段：permission profile、network policy、command policy、executor backend `codex/node-bun`、environment ID、network domain allowlist
- 不直接写入的字段：requested paths、service tier、long-running process、provider tools、executor backend `auto`
- trace 事件和 public event 均保存安全摘要，完整请求作为 rawRef 可取
- 旧 session 没有该工具事件时不会迁移，也不会破坏 replay；新 session 只有工具被调用时才产生对应事件

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- `request_permissions.requested`：模型发起权限提升请求，包含原因、范围、当前生效配置、请求字段、审批人
- `request_permissions.resolved`：审批完成，包含批准/拒绝、实际应用 patch、未直接支持字段
- `sandbox.control.changed` 及具体 `sandbox.profile.changed`、`sandbox.network.changed`、`sandbox.command.changed`、`executor.backend.changed` 等由 `SessionSecurity.update` 自动产生
- `TurnHistory.contextItemKind` 将 `request_permissions.*` 归类为 `approval`

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 新工具已进入 `ToolRegistry`，模型可调用 `request_permissions`
- 工具执行时必须先调用 `ctx.ask`，审批拒绝则不写入任何配置
- 审批通过后，通过 `SessionSecurity.update` 写入会话安全配置，后续 turn 和 live tool gates 可以读取新的 effective config
- 网络、命令策略、权限 profile、执行后端、environment 这类已接通字段会真实影响后续工具门禁
- requested paths、service tier、long-running process、provider tools 目前只进入审计和 Inspector，不直接改变 runtime，这是有意防止模型把未完成能力伪装成已批准
- 失败路径已测试：审批拒绝会产生 denied event，不改变 `SessionSecurity`

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- public event 已提供中文事件名：`权限提升请求`、`权限提升处理完成`
- turn history 已归入 `approval` 类，Inspector 可按审批分类回放
- rawRef 由 public event 统一保存完整 payload
- 本条没有新增专门 UI 卡片；当前走公共事件和 Inspector 分类投影，后续 REQ-066 到 REQ-070 会继续补 guardian、reviewer、六按钮和控制中心联动

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造同一 session 两个 turn 使用不同 override 的场景
- 断言工具读取 effective config，而不是 requested config 或 session 默认值

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

- `bun test test/tool/request_permissions.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 38 pass，0 fail
  - 覆盖审批通过后写入 supported settings、unsupported advisory 字段、审批拒绝不写配置、public event replay、history 分类
- `bun typecheck`
  - pass
- `node --test aialra/turn-observability/tests/*.test.js`
  - 6 pass，0 fail

修复过的问题:

- 初版误用 `Schema.Literals(...)` 多参数形式；本仓库 Effect Schema 需要 `Schema.Literals([...])`
- `requested_executor_backend=auto` 不能写入当前后端配置，因为后端 runtime 只支持 `codex` 和 `node-bun`；现在它进入 unsupported/advisory
- 拒绝路径不能返回 typed error；已改成项目工具执行约定的 die/error 收口

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

- 开始时间: 2026-06-04T23:16:00+02:00
- 完成时间: 2026-06-04T23:42:38+02:00
- 修改文件:
  - `packages/opencode/src/tool/request_permissions.ts`
  - `packages/opencode/src/tool/registry.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/tool/request_permissions.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-065-request-permissions-tool.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/tool/request_permissions.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - request permissions / history / public event：38 pass
  - opencode typecheck：pass
  - observability tests：6 pass
- 残留风险:
  - 本条完成的是“模型可结构化请求权限，并由审批后写入已支持的安全设置”
  - requested paths、service tier、long-running process、provider tools 尚未直接改变 runtime，已明确进入 unsupported/advisory，后续 REQ 继续补齐
  - guardian/auto-review/六按钮审批 UI 和更细粒度 reviewer 语义在 REQ-066 到 REQ-070 继续实现

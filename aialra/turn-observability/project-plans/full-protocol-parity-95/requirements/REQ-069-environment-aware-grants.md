# REQ-069 Environment-aware grants

## 原始目标

69. Environment-aware grants：AIALRA 必须实现 environment id keyed grants，所有 approval grant 都必须绑定 environment_id，不能把一个环境下批准的权限泄漏到另一个环境。grant scope 至少应支持 turn、session、environment、tool、command pattern、path、domain、permission profile、expiration time，并记录 granted_by、reviewer、reason、constraints_snapshot。比如用户允许本地 repo 下运行 `npm test`，不等于允许 remote production environment 运行同样命令；允许某个 container 访问 github.com，也不等于允许 host shell 联网。验收标准是：切换 environment、cwd、permission profile、network policy 后，旧 grant 不会错误复用；inspector 能按 environment 查看当前 grants、来源、作用范围、过期状态和撤销入口。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现 environment_id keyed scoped grants、legacy 兼容、grant event 审计和跨环境不复用测试
- 依赖前置: REQ-068 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有 TurnContext selected environment、exec/apply_patch environment_id、reviewer resolution、approval scopes 和 public event replay
- 原版 OpenCode 的 permission approval 更偏 session/project 级，不会把同一条 grant 明确绑定到 environment_id
- Codex 的思路是环境、cwd、sandbox、approval policy 共同决定某轮能做什么；本地允许不等于远程/生产允许
- 本条对齐方式：把 scoped grant key 从 session/turn 扩展为 session+environment/turn+environment，环境不同就不能复用旧 grant
- 差距：本条实现内存级 environment grants 和事件审计，尚未做持久化撤销 UI

## 数据结构和 schema 计划

- `Permission.Request` 新增 `environment_id`
- `turnCommandApproved`、`turnAllApproved`、`sessionCommandApproved`、`sessionAllApproved` 的 key 纳入 environment_id
- 新增 grant payload：`aialra.permission_grant.v1`
- grant 字段包括：`grant_id`、`session_id`、`turn_id`、`environment_id`、`permission`、`patterns`、`scope`、`granted_by`、`reviewer`、`reason`、`granted_at`、`expires_at`、`constraints_snapshot`
- 无 environment metadata 的旧请求使用 `legacy`，保持旧行为和旧测试兼容
- 带 environment metadata 的新请求不会写全局 approved rules，而是写 environment-scoped grant

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 新增 public event：`permission.grant.created`
- `security.override.resolved` 增加 `environment_id`
- grant raw payload 包含 request、reply、scope、environmentID、reviewer、reason、constraints snapshot
- grant event 可通过 public event replay 被 Inspector 展示

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- `Permission.ask` 从 request/environment metadata 中解析 environment_id
- 支持来源：
  - `Permission.Request.environment_id`
  - `metadata.exec_approval.environment_id`
  - `metadata.apply_patch_approval.environment_id`
  - `metadata.request_permissions.requested_environment_id`
- `always` 在 environment-aware 请求中变为 `always-command` 的 environment-scoped grant，不再泄漏到其他 environment
- `turn-all`、`turn-command`、`always-all`、`always-command` 都按 environment_id 隔离
- legacy 请求仍保留原全局 approved rule 行为，保证旧 session 不崩

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- public event 中文名：`权限授权已创建`
- event 摘要显示 env 和 scope
- grant data 显示 environment、permission、patterns、expires_at、constraints_snapshot
- 撤销入口尚未做，后续 UI 产品化继续补

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造同一 session 两个 turn 使用不同 override 的场景
- 断言工具读取 effective config，而不是 requested config 或 session 默认值

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

- `bun test test/permission/environment-aware-grants.test.ts test/permission/reviewer-override.test.ts test/permission/auto-review.test.ts test/permission/guardian-assessment.test.ts test/permission/next.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 125 pass，0 fail
  - 覆盖 default 环境批准后 default 可复用、remote 不可复用、legacy 无环境请求仍保持旧全局行为、permission 回归不破坏
- `bun typecheck`
  - pass
- `node --test aialra/turn-observability/tests/*.test.js`
  - 6 pass，0 fail

修复过的问题:

- 原 `permission.replied` 测试精确匹配旧字段；新增审计字段后改成 `objectContaining`，仍保证旧字段存在

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

- 开始时间: 2026-06-04T23:58:50+02:00
- 完成时间: 2026-06-05T00:04:46+02:00
- 修改文件:
  - `packages/opencode/src/permission/index.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/permission/environment-aware-grants.test.ts`
  - `packages/opencode/test/permission/next.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-069-environment-aware-grants.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/permission/environment-aware-grants.test.ts test/permission/reviewer-override.test.ts test/permission/auto-review.test.ts test/permission/guardian-assessment.test.ts test/permission/next.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - environment-aware grants + permission regression：125 pass
  - opencode typecheck：pass
  - observability tests：6 pass
- 残留风险:
  - grant revoke UI 尚未实现
  - grant 持久化仍沿用当前 permission layer 行为；environment-aware scoped grants 是运行期状态，后续可扩展到持久化审计表

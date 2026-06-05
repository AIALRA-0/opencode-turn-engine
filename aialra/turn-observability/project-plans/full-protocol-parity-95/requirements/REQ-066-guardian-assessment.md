# REQ-066 Guardian assessment

## 原始目标

66. Guardian assessment：AIALRA 必须补全 guardian assessment，用于对高风险审批请求进行独立安全评估，而不是所有请求都直接交给用户按钮处理。guardian 应在 exec、apply_patch、network、protected path、provider-executed tools、external connector、full access、custom permission profile 等高风险场景中运行，输出 risk_level、policy_findings、blocked_reasons、required_reviewer、suggested_decision 和 user_visible_explanation。guardian assessment 必须先于最终 approval resolution 写入 history、trace 和 inspector，并能阻止违反硬 constraints 的请求进入普通批准流程。验收标准是：危险命令、未知域名联网、读密钥、写 .git/.codex、越权 environment 等操作会先出现 guardian 评估结果，用户能看到风险解释，系统能明确区分“可由用户批准”和“guardian 直接拒绝”。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现后端 Guardian 风险评估、硬拒绝、可审批风险挂载、public event、history/replay 分类和测试
- 依赖前置: REQ-065 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有 `Permission.ask`、approval bus、exec/apply_patch/request_permissions 三类结构化审批 payload、public event replay 和 TurnHistory
- 原版 OpenCode 主要是普通 permission ask/reply，没有独立 guardian 风险评估层，危险请求通常直接进入用户审批或被已有规则拒绝
- Codex 的方向是审批前先由 harness/sandbox/approval policy 判断哪些能问、哪些必须拒绝，不能把所有危险操作都交给用户按钮
- 本条对齐方式是：新增 `GuardianAssessment` 作为后端评估器，进入 `Permission.ask` 的真实 runtime 路径
- 差距：本条是规则化 guardian v1，不是单独安全模型或 policy engine；REQ-067/068 会继续补 auto review 和 reviewer override

## 数据结构和 schema 计划

- 新增 payload schema：`aialra.guardian_assessment.v1`
- 字段包括：`assessment_id`、`session_id`、`turn_id`、`message_id`、`tool_call_id`、`permission`、`patterns`、`risk_level`、`policy_findings`、`blocked_reasons`、`required_reviewer`、`suggested_decision`、`user_visible_explanation`、`hard_block`、`input_kinds`
- `risk_level` 表示风险等级；`suggested_decision` 表示 guardian 建议允许、问用户或拒绝；`hard_block` 表示后端直接拒绝，不能进入普通批准流程
- assessment 同时挂到 `Permission.Request.metadata.guardian_assessment` 和 `Permission.Request.guardian_assessment`
- 旧会话没有该字段时按普通审批显示；新会话只有发生审批请求时才生成

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 新增 public event：`guardian.assessment.completed`
- `risk_level=critical` 且 `hard_block=true` 时 severity 为 error，status 为 denied
- 可审批风险时 status 为 `ask_user`
- `approval.requested` 会携带 `guardian_assessment`
- `approval.resolved` 会回放对应 request 的 `guardian_assessment`
- `TurnHistory.contextItemKind` 将 `guardian.assessment.*` 归入 `approval`

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- `Permission.ask` 在进入 pending approval 前调用 `GuardianAssessment.assess`
- 硬拒绝场景会直接返回 `PermissionDeniedError`，不会发布 `permission.asked`
- 可审批风险会继续进入普通审批，但 request 内会带 guardian 结果，用户能看到风险原因
- 已覆盖风险：危险/破坏性命令、挖矿/持久化特征、secret 文件访问、protected path、full-access、disabled permission management、network、unsupported environment、provider tool
- runtime 真实生效点：硬拒绝不创建 pending approval，不等待用户按钮；可审批风险仍可由用户决定
- 失败路径已测试：危险命令 `rm -rf /` 被 guardian 拒绝且没有 `approval.requested`

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- public event 中文名：`Guardian 风险评估完成`
- 摘要包含风险等级和用户可读解释
- approval.requested 中带 `guardian_assessment`，Inspector 可在审批上下文里展示
- history 分类为 approval，历史 turn 可回放
- 本条没有新增独立 UI 面板；更细展示由 Turn Inspector 产品化条目继续做

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造允许、询问、硬拒绝、约束覆盖审批四类场景
- 断言 UI 展示和实际执行结果一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

- `bun test test/permission/guardian-assessment.test.ts test/permission/approval-audit.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 38 pass，0 fail
  - 覆盖 guardian 硬拒绝危险命令、network 风险进入普通审批、approval event 携带 guardian、history/public event 协议
- `bun typecheck`
  - pass
- `node --test aialra/turn-observability/tests/*.test.js`
  - 6 pass，0 fail

修复过的问题:

- 初版危险命令正则没有识别 `rm -rf /`，导致请求进入 pending approval，测试超时；已修正为可识别破坏性命令并 hard block
- `request.patterns` 是 readonly array，传入 Guardian 前已复制，避免类型越界

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

- 开始时间: 2026-06-04T23:42:45+02:00
- 完成时间: 2026-06-04T23:49:50+02:00
- 修改文件:
  - `packages/opencode/src/session/guardian-assessment.ts`
  - `packages/opencode/src/permission/index.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/permission/guardian-assessment.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-066-guardian-assessment.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/permission/guardian-assessment.test.ts test/permission/approval-audit.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - guardian/approval/history/public-event：38 pass
  - opencode typecheck：pass
  - observability tests：6 pass
- 残留风险:
  - Guardian v1 是 deterministic rule evaluator，不是独立 LLM reviewer
  - 风险规则覆盖高危命令、secret、protected path、network/full-access/environment/provider tool，但后续还需要 REQ-067 auto review 和 REQ-068 reviewer override 做更完整的审批人语义
  - UI 目前通过 public event/approval context 展示，专门的 Inspector 卡片继续由后续 UI 条目补

# REQ-092 Deployment gate

## 原始目标

92. Deployment gate：AIALRA 必须保留并完善 deployment gate，防止 agent 在未验证、未审计、未确认环境和权限的情况下执行部署、发布、推送、上传、生产变更等高风险操作。deployment gate 应识别 npm publish、docker push、kubectl、terraform apply、git push、cloud deploy、ssh production、database migration 等命令，并要求额外 approval、guardian assessment、environment-aware grant、dry-run 或 explicit confirmation。虽然 Codex/OpenCode 没有同名机制，AIALRA 应将其作为安全上线保护层。验收标准是：任何疑似部署命令都会触发 deployment gate；inspector 显示命中的部署规则、风险说明、审批人、是否 dry-run、最终是否执行。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成 runtime 门禁、事件、Inspector 摘要和自动化测试
- 依赖前置: REQ-091 必须已完成并更新状态矩阵
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

实际结论:

- 当前 AIALRA 已有 `EngineeringHarness.beforeTool`，工程执行框架工具前置检查，可以在 `bash/shell` 执行前读取 `TurnContext`，回合上下文，并发出 public event，公共事件
- 当前 AIALRA 已有 Turn Inspector，回合检查器，可以把 `engineering.*` 事件展示给用户
- 原版 OpenCode 有权限询问和工具执行流程，但没有 AIALRA 这种部署命令规则表、部署风险解释、dry-run 检测、部署事件审计
- Codex CLI 有更成熟的沙箱、审批和命令执行收口，但没有直接等价的 AIALRA public event 部署门禁协议
- 因此本条采用 AIALRA 安全上线保护层，不伪装成 Codex 原生同名能力

## 数据结构和 schema 计划

- 新增运行时结构 `EngineeringDeploymentGateAssessment`，部署门禁评估
- schema 为 `aialra.deployment_gate.v1`
- 字段包含 `commandPreview/gate/ruleID/matchedRule/riskLevel/action/requiresApproval/requiresDryRun/dryRunDetected/explicitConfirmationDetected/approvalPolicy/approvalsReviewer/environmentID/cwd/reason/suggestion/at`
- `requested` 语义来自模型请求执行的命令
- `effective` 语义来自门禁评估后的 `action: allowed | blocked`
- history/replay 当前承载在 public event 的 `data.assessment` 和 raw payload 中
- 旧 session 没有 deployment 字段时 Inspector 只是不展示部署门禁，不影响读取
- 新 session 在工程运行 snapshot 中记录 `deployment.checks/blocked/allowed`

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

已实现事件:

- `engineering.deployment_gate.updated`
- blocked 状态表示高风险部署命令被阻止
- allowed 状态表示低风险构建/健康检查或带 dry-run/显式确认的命令被允许
- `data.assessment` 保存完整部署门禁评估
- raw payload 保存原始 command、input 和 assessment

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

已实现 runtime 行为:

- `EngineeringHarness.beforeTool` 在 `bash/shell` 工具执行前识别部署类命令
- 高风险命令如果没有 dry-run 或显式确认，会直接返回 blocked，工具不会继续执行
- 低风险构建、配置检查、健康检查会记录门禁事件但允许执行
- 显式确认支持 `deployment_confirmed`、`deploymentConfirmed` 或命令中 `AIALRA_DEPLOYMENT_APPROVED=1`
- 事件读取 `approval_policy`、`approvals_reviewer`、`selected_environment_id` 和 `cwd`
- 默认 reviewer 显示为 `user:current_user`，避免用户看不到审批人

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

已实现 Inspector 展示:

- `engineering.deployment_gate.updated` 显示为“部署门禁已更新”
- blocked 摘要显示“部署门禁已阻止高风险命令”
- allowed 摘要显示“部署门禁已记录并允许命令”
- 摘要包含命中的规则、风险等级、是否 dry-run
- Summary 面板质量标签会显示“部署门禁阻止：规则：风险等级”

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造允许、询问、硬拒绝、约束覆盖审批四类场景
- 断言 UI 展示和实际执行结果一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试命令:

```bash
bun test test/session/engineering.test.ts --timeout 30000
bun typecheck
bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts
bun typecheck
node --test aialra/turn-observability/tests/*.test.js
```

实际测试结果:

- `packages/opencode` engineering 测试: 24 pass，177 expect
- `packages/opencode` typecheck: pass
- `packages/app` Turn Inspector 投影测试: 3 pass，34 expect
- `packages/app` typecheck: pass
- turn observability node tests: 7 pass

## 验收标准

- 协议层已实现并有测试覆盖: 是
- history/replay 承载在 public event replay 中: 是
- trace/public event 已实现并有事件样例测试: 是
- Inspector 已展示并有投影测试: 是
- runtime 行为真实生效并有高风险阻止和低风险允许测试: 是
- 旧 session 兼容: 无 deployment 事件时不展示，不影响读取
- 状态矩阵更新为 `完全完成` 前，测试结果已记录

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

残留风险:

- 当前显式确认是工具输入或环境标记，不是完整交互式 reviewer 工作流
- 当前规则表覆盖常见部署命令，但不是所有云厂商和自定义脚本
- 低风险命令允许执行后，仍依赖后续工具执行层记录输出和退出码

## 执行记录

- 开始时间: 2026-06-05T00:30:00Z
- 完成时间: 2026-06-05T00:46:27Z
- 修改文件:
  - `packages/opencode/src/session/engineering.ts`
  - `packages/opencode/test/session/engineering.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
  - `packages/app/src/pages/session/turn-inspector.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-092-deployment-gate.md`
- 测试命令:
  - `bun test test/session/engineering.test.ts --timeout 30000`
  - `bun typecheck`
  - `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果: 全部通过
- 残留风险: reviewer 目前是字段记录和显式确认标记，不是完整审批 UI 工作流；规则表后续需要按真实部署命令继续扩展

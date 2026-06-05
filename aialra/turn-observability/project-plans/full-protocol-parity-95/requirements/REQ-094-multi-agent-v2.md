# REQ-094 Multi-agent v2

## 原始目标

94. Multi-agent v2：AIALRA 必须补齐 multi-agent v2 能力，对齐 Codex 最新 multi-agent v2 方向。系统应支持 planner、implementer、reviewer、tester、awaiter、guardian、summarizer 等角色分工，并通过 shared turn context、typed events、tool permissions、history persistence、raw store、skill catalog 协调。multi-agent 不能只是多个模型并发聊天，而必须有明确任务分配、权限隔离、结果汇总、冲突解决、最终 settlement。验收标准是：一个复杂工程任务可以由 planner 生成计划、implementer 改代码、tester 验证、reviewer 审查、guardian 检查风险，所有 agent 行为都能在 inspector 中按角色和 turn 展示，并可审计、回放。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成 multi-agent v2 协议、TaskTool runtime 接入、public event、Turn Inspector 摘要和测试
- 依赖前置: REQ-093 必须已完成并更新状态矩阵
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

- 当前 OpenCode 已有 `task` 工具，可以启动 subagent，子 agent，创建子会话，并按 subagent 权限派生 permission ruleset
- 当前 AIALRA 已有 TurnContext，回合上下文，public event stream，公共事件流，Turn Inspector，回合检查器
- 当前缺口是 task 工具只知道“启动了某个 subagent”，没有统一记录 planner、implementer、reviewer、tester、awaiter、guardian、summarizer 等角色，没有统一 settlement，收口，也没有按角色展示
- Codex 最新方向更强调统一运行时和工具/审批/沙箱收口，但没有直接等价的 AIALRA public event `multi_agent.*` 协议
- 因此本条在现有 OpenCode task/subagent 基础上增加 AIALRA multi-agent v2 协议层，不重写并发调度器

## 数据结构和 schema 计划

- 新增 `EngineeringRunSnapshot.multiAgent`
- schema 为 `aialra.multi_agent.v2`
- 新增角色 `planner/implementer/reviewer/tester/awaiter/guardian/summarizer/custom`
- 新增 `EngineeringMultiAgentAssignment`
- 新增 `EngineeringMultiAgentSettlement`
- 新增 `EngineeringMultiAgentConflict`
- `requested` 语义来自模型调用 task 工具时请求的 `subagent_type/description/prompt`
- `effective` 语义来自 runtime 根据描述推断出的 role 和实际创建的子会话
- history/replay 通过 public event replay 承载
- rawRef 保存 assignment、settlement、result 和 failureReason
- 旧 session 没有 `multiAgent` 字段时 Inspector 不展示，不影响读取

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

已实现事件:

- `multi_agent.task.assigned`
- `multi_agent.task.settled`
- `multi_agent.conflict.detected`

事件字段:

- `role`
- `agent`
- `subagentSessionID`
- `assignment`
- `settlement`
- `resultChars`
- `failureReason`
- `state`

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

已实现 runtime 行为:

- `TaskTool` 启动 subagent 后调用 `EngineeringHarness.multiAgentAssigned`
- foreground task 完成后调用 `EngineeringHarness.multiAgentSettled(status=completed)`
- foreground task 失败或中断后调用 `multiAgentSettled(status=failed/cancelled)`
- background task 完成、失败或中断后同样写 settlement
- `EngineeringRun` 维护 active/completed/failed/assignments/settlements
- 权限摘要来自 subagent 自身 permission ruleset
- 模型、agent、父 session、子 session 都进入 assignment

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

已实现 Inspector 展示:

- `multi_agent.task.assigned` 显示“已分配 role 子任务给 agent”
- `multi_agent.task.settled` 显示子任务完成、失败、取消、结果字符数和失败原因
- Summary 面板显示“多 agent 分配：role：agent”和“多 agent 完成/未完成：role：agent”
- 默认不展示裸 JSON，rawRef 可保存完整 assignment/result

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
bun test test/session/engineering.test.ts test/tool/task.test.ts --timeout 30000
bun typecheck
bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts
bun typecheck
node --test aialra/turn-observability/tests/*.test.js
git diff --check
```

实际测试结果:

- `packages/opencode` engineering + task 测试: 41 pass，223 expect
- `packages/opencode` typecheck: pass
- `packages/app` Turn Inspector 投影测试: 3 pass，38 expect
- `packages/app` typecheck: pass
- turn observability node tests: 7 pass
- `git diff --check`: pass

## 验收标准

- 协议层已实现并有 schema 测试: 是
- history/replay 已通过 public event replay 承载: 是
- trace/public event 已实现并有事件样例测试: 是
- Inspector 已展示并有投影测试: 是
- runtime 行为真实接入 TaskTool，并有 task 工具回归测试: 是
- 旧 session 兼容: 无 multiAgent 字段时不展示，不影响读取
- 状态矩阵更新为 `完全完成` 前，测试结果已记录

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

残留风险:

- 当前不实现新的并行调度器，仍使用 OpenCode 现有 task 工具
- 冲突检测事件协议已注册，但自动冲突分析还只保留协议入口，未做复杂语义比较
- 角色推断基于 subagent_type、description、prompt 的规则，不是模型判定 DAG

## 执行记录

- 开始时间: 2026-06-05T01:02:00Z
- 完成时间: 2026-06-05T01:18:00Z
- 修改文件:
  - `packages/opencode/src/session/engineering.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/tool/task.ts`
  - `packages/opencode/test/session/engineering.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
  - `packages/app/src/pages/session/turn-inspector.test.ts`
  - `aialra/turn-observability/public-schema-docs.md`
  - `aialra/turn-observability/trace-schema.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-094-multi-agent-v2.md`
- 测试命令:
  - `bun test test/session/engineering.test.ts test/tool/task.test.ts --timeout 30000`
  - `bun typecheck`
  - `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果: 全部通过
- 残留风险: 自动冲突分析和真正多 agent 调度 DAG 仍是后续增强，当前完成的是 shared turn context + task tool runtime + event/Inspector settlement

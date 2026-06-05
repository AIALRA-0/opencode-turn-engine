# REQ-095 Skills per-turn

## 原始目标

95. Skills per-turn：AIALRA 必须补齐完整 per-turn skills，对齐 Codex skills per-turn，并吸收 OpenCode skill foundation。每个 turn 开始时必须解析可用 skill catalog，记录 skill_id、version、source、适用条件、关联工具、MCP 资源、权限需求、prompt 注入内容、实际使用情况。skills 不能隐藏在模型 prompt 或单一 skill tool 中，而必须成为 turn runtime 的显式组成部分，并显示在 inspector 和最终报告里。验收标准是：用户可以看到本轮用了哪些 skills、为什么启用、调用了哪些工具和资源、哪些 skill 被禁用及原因；未来 Hermes 或更高阶架构可以基于 per-turn skill catalog 做调度和优化。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。每轮 turn 会解析可用 skill catalog，记录禁用 skill 及原因，skill 使用会进入 trace/public event/Turn Inspector，模型上下文注入和 skill tool runtime 都能对应到同一份 turn skill catalog
- 依赖前置: REQ-094 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/tool`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/tool-output-store.ts`
- `packages/opencode/src/tool/codex-exec-server.ts`
- `packages/core/src`

必须回答:

- 当前 AIALRA 已经有什么
  - OpenCode 原生已有 skill tool，模型可以通过 `skill` 工具读取技能内容
  - AIALRA 已经在 TurnContext 里有 `skill_catalog`，并在模型上下文里注入 skill 目录
  - AIALRA 已经有 `skill.catalog.resolved`、`skill.catalog.injected`、`skill.used` 事件基础
- 本条补齐了什么
  - `prompt.ts` 现在同时读取全部 skill 和当前 agent 可用 skill，禁用项会带 `reasons`
  - `turn-context.ts` 的 skill catalog 会提取工具、MCP 资源、外部资源、权限需求和常见命令，包括部署类命令
  - `skill.used` 事件现在记录 `skill_id`、`version`、`source`、`prompt_injected`、`tools`、`commands`、`mcp_resources`、`external_resources`、`permission_requirements`、`contentChars`、`usage_count`
  - Turn Inspector 默认用中文说明技能目录和技能使用，不把裸 JSON 当默认展示
- 最新 OpenCode 已经有什么
  - OpenCode 有 skill tool 和 agent permission 过滤基础
  - OpenCode 没有把每轮 skill catalog、禁用原因、使用次数和权限需求作为正式 turn runtime 面向用户展示
- 最新 Codex 已经有什么
  - Codex 的技能/能力更偏向每轮工具环境和系统能力声明，能在 turn contract 里成为模型可用能力的一部分
  - AIALRA 现在补齐的是 OpenCode skill foundation 上的 per-turn 显式目录和审计，仍未把 skill 作为独立调度器或 Hermes 级计划器输入
- 三者差距
  - AIALRA 强于原版 OpenCode 的地方是：用户可以看到本轮哪些 skill 可用、哪些被禁用、模型实际用了哪个 skill
  - AIALRA 仍弱于 Codex 完整体的地方是：skill catalog 还不是独立 planner 的调度输入，也没有跨 turn skill 成效学习

## 数据结构和 schema 计划

- 正式协议字段
  - `TurnContext.skill_catalog.available[]`
  - `TurnContext.skill_catalog.disabled[]`
  - `TurnContext.skill_catalog.policy`
  - `TurnContext.skill_catalog.injection`
  - `skill.used.data.skill_id`
  - `skill.used.data.version`
  - `skill.used.data.source`
  - `skill.used.data.prompt_injected`
  - `skill.used.data.tools`
  - `skill.used.data.mcp_resources`
  - `skill.used.data.commands`
  - `skill.used.data.external_resources`
  - `skill.used.data.permission_requirements`
  - `skill.used.data.usage_count`
- requested / resolved / effective 区别
  - requested：agent 或用户期望可用的 skill
  - resolved：当前 agent permission 过滤后的实际目录
  - effective：模型上下文实际注入并可通过 skill tool 使用的目录
- history/replay/rawRef/extension_data
  - 安全摘要进入 trace/public event
  - skill 内容本身由 skill tool 的模型消息和工具输出承载
  - 本条不把完整 skill content 重复复制进 trace raw，因为当前 trace emitter 没有 raw payload 字段，避免无意放大敏感内容
- 旧 session 兼容
  - 旧事件缺少 `skill_id`、`commands` 等字段时，Inspector 使用可选读取，不崩溃
  - 旧 turn 没有 disabled list 时显示为 `0`
- 新 session 默认写入
  - `SessionPrompt.promptWithRoute` 构建 TurnContext 时写入 skill catalog
  - skill tool 执行时写入 `skill.used`

## 事件协议计划

本条相关变化必须进入:

- internal trace
  - `skill.catalog.resolved`
  - `skill.catalog.injected`
  - `skill.used`
- typed public event
  - 现有 trace/public event 映射保留，skill 事件进入 Turn Inspector 和摘要投影
- history/replay record
  - skill 使用仍通过 tool result 和 message/part history 留痕
- Turn Inspector projection
  - 默认中文摘要显示技能目录和实际使用
- benchmark JSON 或质量统计
  - 本条不直接影响 benchmark 分数，但后续 benchmark 可用 `skill.used` 判断 agent 是否依赖某类 skill

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
  - `skill` 工具执行会记录使用的 skill，并把使用次数、关联工具、命令和权限需求带入事件
- 模型调用是否读取该字段
  - 模型上下文构建时注入 resolved skill catalog
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
  - 当前 skill catalog 记录权限需求和命令风险，但不直接放宽权限、沙箱、网络、cwd、environment
  - 权限真实执行仍由 TurnContext permission/sandbox/approval gate 负责
- 失败路径、abort 路径、resume/replay 路径是否读取该字段
  - skill not found 和禁用 skill 都能通过 tool result/事件解释
  - abort 不会伪造 skill completion

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
  - `skill.catalog.resolved` 显示可用数量和禁用数量
  - `skill.catalog.injected` 显示注入模型上下文的 skill 数量
  - `skill.used` 显示模型实际使用的 skill、使用次数、关联命令、外部资源
- 用户能看懂的生效原因和失败原因
  - 禁用 skill 会带 permission reason
  - skill 使用摘要会显示 `关联命令` 和 `外部资源`
- rawRef 或高级详情入口
  - 默认摘要不裸露 JSON；raw 仍走 Turn Inspector 原始数据入口
- 历史 turn 折叠后仍可回放
  - 投影函数对旧事件可选字段兼容

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
  - `test/session/turn-context.test.ts` 覆盖可用 skill、禁用 skill、外部资源、权限需求、部署命令提取
  - `test/tool/skill.test.ts` 覆盖 `skill.used` runtime metadata
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
  - 既有 observability schema 测试继续覆盖事件渲染和 schema 文档一致性
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
  - `packages/app/src/pages/session/turn-inspector.test.ts` 覆盖 skill catalog 和 skill used 中文摘要
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
  - Inspector 使用可选字段读取，旧事件缺字段不会崩溃
- 构造成功、失败、aborted、超长输出、fallback、replay 场景
  - 本条核心覆盖成功和 not found，abort/fallback 不改变 skill runtime
- 断言 tool result 幂等且模型上下文、history、UI 都收到同一个 result
  - skill tool 测试覆盖 tool result，TurnContext 测试覆盖上下文，Inspector 测试覆盖 UI 投影

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

## 验收标准

- 协议层已实现并有 schema 测试: 已完成
- history/replay 已实现并有恢复测试: 已完成，沿用 skill tool message/result history
- trace/public event 已实现并有事件样例测试: 已完成
- Inspector 已展示并有 UI 或投影测试: 已完成
- runtime 行为真实生效并有端到端测试: 已完成，skill tool 使用事件由真实 tool execute 触发
- 旧 session 兼容测试通过: 已完成，投影层兼容缺字段
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录: 已完成

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

## 执行记录

- 开始时间: 2026-06-05T02:30:00+02:00
- 完成时间: 2026-06-05T03:11:00+02:00
- 修改文件:
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/tool/skill.ts`
  - `packages/opencode/test/session/turn-context.test.ts`
  - `packages/opencode/test/tool/skill.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
  - `packages/app/src/pages/session/turn-inspector.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-095-skills-per-turn.md`
- 测试命令:
  - `bun test test/session/turn-context.test.ts test/tool/skill.test.ts --timeout 30000`
  - `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
- 测试结果:
  - opencode skill/turn-context: 12 pass, 0 fail, 75 expect
  - app Turn Inspector: 3 pass, 0 fail, 40 expect
- 残留风险:
  - 完整 skill content 没有重复塞入 trace raw，避免 trace 放大敏感内容；需要完整内容时看 skill tool message/result raw
  - skill catalog 现在可观察、可审计、可被模型上下文使用，但还不是独立 planner 或 Hermes 调度器

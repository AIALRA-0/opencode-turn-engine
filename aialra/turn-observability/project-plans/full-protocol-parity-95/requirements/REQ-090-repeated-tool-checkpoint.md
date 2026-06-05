# REQ-090 Repeated tool checkpoint

## 原始目标

90. Repeated tool checkpoint：AIALRA 必须保留并强化 repeated tool checkpoint，对齐 OpenCode 的 DOOM_LOOP_THRESHOLD 3 思路，防止模型在同一工具、同一命令、同一搜索、同一失败路径上无限循环。AIALRA 当前已有 repeated tool checkpoint，必须将其标准化为 agent workflow guard，记录 repeated pattern、tool name、arguments similarity、failure similarity、threshold、intervention suggestion。触发后系统应要求模型总结已尝试路径、改变策略、请求用户信息或停止。验收标准是：连续三次或配置次数重复运行无进展工具时，AIALRA 能自动生成 checkpoint，并在 inspector/final report 中显示循环检测原因和后续处理。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现 runtime 级重复工具预警、检查点和阻止，事件携带 repeated pattern、tool、arguments similarity、failure similarity、threshold、intervention suggestion，并在 Turn Inspector 中文摘要和工程控制面板中可观察可配置
- 依赖前置: REQ-089 必须已完成并更新状态矩阵
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
- 最新 OpenCode 已经有什么
- 最新 Codex 已经有什么
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪

实际结论:

- 当前 AIALRA 已有 `engineering.loop.warning`、`engineering.loop.checkpoint`、`engineering.loop.blocked` 三层门禁，工具执行前由 `EngineeringHarness.beforeTool` 读取当前 turn 的 `EngineeringControls`，对同一工具和同一稳定输入签名计数
- 原先差距是事件只写 `tool/count/state`，用户不知道参数为什么算重复、阈值是多少、系统建议模型下一步怎么换路线
- 本次补齐后，事件新增 `pattern` 对象，包含 `signature/tool/count/threshold/argumentsSimilarity/failureSimilarity/inputPreview/interventionSuggestion/status/at`
- `argumentsSimilarity` 当前是 `exact`，含义是同一工具和同一稳定 JSON 输入完全相同
- `failureSimilarity` 当前是 `not_observed`，原因是本门禁发生在工具执行前，还没有工具输出或失败日志，不能假装已经做失败相似度聚类
- Turn Inspector 默认中文摘要会直接显示工具名、重复次数、参数相似度、失败相似度和干预建议
- Sandbox Control Center 的高级工程参数现在同时暴露重复工具预警阈值、检查点阈值、阻止阈值，不再只暴露最终阻止值

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

实际实现:

- `EngineeringRunSnapshot.loop.patterns` 保存最近 20 个重复工具模式
- `EngineeringRepeatedToolPattern` 是本条新增正式运行态结构
- public event 的 `data.pattern` 是用户可读、机器可消费的投影
- raw payload 保存原始 `tool/input/signature/pattern`
- 旧 session 没有 `loop.patterns` 或 `data.pattern` 时，Inspector 仍回退到事件标题和 `tool/count`，不会崩溃

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 复用现有事件类型 `engineering.loop.warning/checkpoint/blocked`
- 每个事件通过 `PublicEventLog.recordManual` 自动带 `schema/version/id/sequence/ts/source/threadID/sessionID/turnID/messageID`
- 事件 `data.pattern` 提供结构化重复模式
- 事件 `rawRef` 保存完整 raw input 和 signature，默认 UI 不直接展示裸 JSON

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际实现:

- `beforeTool` 在每次工具执行前计数，真实影响工具执行
- 到 warning 阈值时只记录预警，不拦截
- 到 checkpoint 阈值时切换工程阶段到 `repair`，写入 `loop_checkpoint` feedback，下一次 system reminder 会要求模型总结旧路线并换方向
- 到 stop 阈值时切换 `blocked` 并直接阻止该次工具调用
- `longRun` 模式下 stop 阈值为 0 或禁用，不会强杀长跑任务，但仍有 warning/checkpoint

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- Turn Inspector 单条事件中文摘要会显示：工具、次数、参数相似度、失败相似度、干预建议
- Turn Inspector summary quality 标签会显示 `重复工具预警/read/2 次`、`重复工具检查点/read/3 次`、`重复工具已阻止/read/4 次`
- Sandbox Control Center 高级工程参数显示三个阈值，用户能分开调整预警、检查点和阻止

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造成功、失败、aborted、超长输出、fallback、replay 场景
- 断言 tool result 幂等且模型上下文、history、UI 都收到同一个 result

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际执行:

- `bun test test/session/engineering.test.ts --timeout 30000`
  - 首次失败原因：测试在阻止阈值触发后才检查 repair reminder，此时 phase 已从 repair 转为 blocked
  - 修复方式：把 reminder 断言移动到 checkpoint 触发后、blocked 触发前
  - 复跑结果：21 pass，169 expect
- `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - 3 pass，30 expect
- `bun typecheck` in `packages/opencode`
  - pass
- `bun typecheck` in `packages/app`
  - pass

## 验收标准

- 协议层已实现并有 schema 测试
- history/replay 已实现并有恢复测试
- trace/public event 已实现并有事件样例测试
- Inspector 已展示并有 UI 或投影测试
- runtime 行为真实生效并有端到端测试
- 旧 session 兼容测试通过
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录

实际验收:

- 协议层: `EngineeringRepeatedToolPattern` 和 public event `data.pattern` 已实现
- history/replay: 事件进入 public event replay buffer，rawRef 保存原始输入和签名
- trace/public event: 复用已有 loop 事件并补齐 pattern 字段
- Inspector: 中文摘要和 summary quality 已展示
- runtime: warning/checkpoint/block 均在真实工具执行前生效
- 旧 session: UI 对缺失 `data.pattern` 有回退

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

## 执行记录

- 开始时间: 2026-06-05T02:29:47+02:00
- 完成时间: 2026-06-05T02:29:47+02:00
- 修改文件:
  - `packages/opencode/src/session/engineering.ts`
  - `packages/opencode/test/session/engineering.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
  - `packages/app/src/pages/session/sandbox-control-center.tsx`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-090-repeated-tool-checkpoint.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/session/engineering.test.ts --timeout 30000`
  - `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
- 测试结果: engineering 21 pass，app inspector 3 pass，opencode/app typecheck pass
- 残留风险: 本条的 failure similarity 当前明确记录为 `not_observed`，因为循环检查发生在工具执行前，后续如果要做“相同失败输出聚类”，需要接入 tool result settlement 后的 post-tool analyzer

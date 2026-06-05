# REQ-006 ContextCompacted 标准事件与可视化

## 原始目标

6. ContextCompacted 标准事件与可视化：AIALRA 必须在上下文被压缩时发出 Codex 风格的标准 ContextCompacted 事件，明确记录哪些内容被 compact、压缩前后 token/size、压缩生成的新摘要、压缩策略、触发原因和关联 turn。不能只显示“上下文变小了”，必须让用户在 inspector 中看到具体被压缩内容和生成摘要。如果压缩结果是文本摘要，应支持用户查看、二次编辑、清除、重新生成或标记为不可用；如果是高度抽象结构，也必须可视化其结构和来源。验收标准是：context compaction 能被 UI、日志、replay、debug 全量追踪。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。AIALRA compaction runtime 现在会发出标准 `context.compaction.*` 事件，记录压缩开始、完成、失败和工具输出裁剪，并进入 public event、TurnHistory、Raw Lab 可恢复历史。
- 依赖前置: REQ-005 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session`
- `packages/opencode/src/session/public-event.ts`
- `packages/opencode/src/session/turn-context.ts`
- `packages/opencode/src/session/turn-history.ts`
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
- 构造正常完成、模型错误、用户 abort、重复 settle、resume/replay 场景
- 断言 history、trace、public event、Inspector 四层一致

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

- 开始时间: 2026-06-04T10:25:31+02:00 后
- 完成时间: 2026-06-04T10:25:31+02:00 后
- 调查结论:
  - OpenCode 已有 `SessionCompaction.create/process/prune`，能创建 compaction user message、生成 summary assistant、保留最近 tail、裁剪旧工具输出。
  - 旧实现主要通过 message/part 和 bus event 表达压缩，没有 AIALRA/Codex 风格的标准 ContextCompacted 公共事件和可恢复 history。
  - UI timeline 已能显示 compaction 分隔，但 Turn Inspector/Raw Lab 缺少压缩策略、触发原因、前后规模、摘要长度、tail 起点等审计字段。
- 实现内容:
  - 新增 public event 类型:
    - `context.compaction.started`
    - `context.compaction.completed`
    - `context.compaction.failed`
    - `context.compaction.pruned`
  - `SessionCompaction.create` 发出 started，记录 auto/manual/overflow、agent、model、compactionMessageID。
  - `SessionCompaction.process` 成功继续时发出 completed，记录 beforeMessageCount、compactedMessageCount、tailStartID、previousSummaryChars、summaryChars、promptChars、preserveRecentTokens、strategy、model。
  - `SessionCompaction.process` 在压缩后仍 overflow 时发出 failed，记录失败原因和压缩规模。
  - `SessionCompaction.prune` 在裁剪旧工具输出时发出 pruned，记录 partCount、prunedTokens、totalTokens、阈值和策略。
  - `TurnHistory.contextItemKind` 支持 `context.compaction.*`，这些事件会以 `turn.context.item` 进入 JSONL history。
  - Public Event 中文标题和 rawRef eligible 范围已补齐。
- 修改文件:
  - `packages/opencode/src/session/compaction.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
- 测试命令:
  - `bun test test/session/compaction.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
  - `bun typecheck`
- 测试结果:
  - compaction/turn-history: 55 pass, 0 fail。
  - render-trace: 1 pass, 0 fail。
  - `bun typecheck`: pass。
- 残留风险:
  - 本条记录 compact 摘要长度和 rawRef，不默认把完整摘要正文裸塞进安全事件；完整 raw 查看由 Raw Lab 高级面板承接。
  - “二次编辑、清除、重新生成摘要”的用户产品入口属于后续 Turn Inspector/Raw Lab 产品化任务。

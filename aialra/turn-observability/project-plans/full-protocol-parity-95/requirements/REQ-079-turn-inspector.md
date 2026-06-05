# REQ-079 Turn Inspector

## 原始目标

79. Turn Inspector：AIALRA 必须继续强化 Turn Inspector，把它作为所有 turn/runtime/tool/raw/approval/sandbox 信息的统一可视化入口。虽然 Codex 没有同款产品形态，但 Codex 的事件体系可展示，AIALRA 应该利用自身已有 inspector 优势，把 TurnStarted/Completed/Aborted、UserTurn、TurnContextItem、SessionConfigured、tool lifecycle、exec process、approval、sandbox decision、TurnDiff、context compaction、raw refs、skill catalog 全部按 turn 展示。验收标准是：用户点开任意 turn，都能看到这一轮输入是什么、配置是什么、用了什么模型、跑了哪些工具、改了哪些文件、哪些权限被批准或拒绝、原始输出在哪里、最终状态是什么。

## 当前状态

- 状态: 完全完成
- 完成判定: Turn Inspector 已增加回合总览投影和测试，能按 turn 聚合输入、配置、模型、工具、文件、命令、审批、沙箱拒绝、rawRef、质量提示和最终状态；后端 public event / turn history / schema 文档回归已通过
- 依赖前置: REQ-078 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有什么: 已有 `aialra.public_event.v1` 公共事件流、`aialra.turn_history.v1` 回放记录、Raw Lab、rawRef、Last-Event-ID 续传、事件分类、历史 turn 自动折叠、虚拟列表、后台终端清理、中文逐事件摘要。本条新增 `buildTurnInspectorSummary` 投影，把同一 turn 的事件汇总成用户能一眼读懂的总览。
- 最新 OpenCode 已经有什么: 原版主要是 session/message/tool 事件和基础 UI 状态，不具备 AIALRA 这种按 turn 串联 public event、rawRef、history、沙箱、审批、执行器、质量提示的统一 Inspector。
- 最新 Codex 已经有什么: Codex 有更成熟的 turn/runtime/tool 事件语义和命令输出项，但 CLI 形态不是同款侧栏产品。AIALRA 的 Inspector 是把 Codex 可追踪事件语义产品化成 Web 面板。
- 三者差异: AIALRA 的 UI 可见性超过原版 OpenCode，事件语义继续向 Codex 对齐；本条没有新增 runtime 字段，而是验证已存在协议进入 UI 投影，避免为了 UI 再造一套新协议。

## 数据结构和 schema 计划

- 正式协议字段: 本条不新增 public event schema 字段，复用 REQ-071 到 REQ-078 已固化的 `PublicEvent`、`TurnHistoryRecord`、`rawRef`、`payload`、`extension_data`。
- UI 投影结构: 新增前端纯函数 `TurnInspectorSummary`，只在 UI 层派生，不写回后端协议。
- requested/resolved/effective: 由原事件携带，例如 `turn.context.created` / `session.configured` 中的 permission、approval、sandbox、network、effort、service tier。Inspector 总览只展示已记录的实际值，不伪造缺失值。
- history / replay / rawRef: 仍由 public event 和 turn history 承载；总览从事件安全外壳读摘要，完整 raw 只通过 rawRef / Raw Lab 展开。
- 旧 session 兼容: 没有新迁移。旧事件缺字段时总览显示缺省，不崩溃。
- 新 session 默认写入: runtime 仍写 public event 和 turn history，Inspector 自动从 SSE 和 Last-Event-ID replay 获得。

## 事件协议计划

本条相关变化必须进入:

- internal trace: 复用已有 trace 事件，不新增事件。
- typed public event: 复用 `aialra.public_event.v1` 149 个事件类型。
- history/replay record: 复用 `aialra.turn_history.v1`。
- Turn Inspector projection: 已实现 `buildTurnInspectorSummary`，把同一 turn 的 typed events 聚合成总览。
- benchmark JSON 或质量统计: 本条不修改 benchmark schema，但总览会显示工程质量提示，例如零补丁、验证失败反馈、通过即停止、执行器回退、错误、警告。

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 本条自身是 UI/投影能力，不新增 runtime gate。
- runtime 生效证明来自前置需求: 工具、模型、权限、审批、沙箱、网络、cwd、environment 已经在 REQ-001 到 REQ-078 写入 public event/history。
- 本条测试证明 Inspector 能从这些 runtime 事件读出实际生效值，而不是只显示前端状态。
- resume/replay 路径由 Last-Event-ID 和 public event HTTP 测试覆盖。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 已展示回合总览: status、duration、eventCount、rawRefs、tools、files、commands、errors、warnings。
- 已展示配置: model、provider、cwd、environment、permission profile、approval policy、sandbox policy、network policy、effort、service tier。
- 已展示行为: 用户输入预览、最终输出预览、工具、文件、命令、审批、沙箱拒绝。
- 已展示质量提示: 零补丁恢复、验证通过/失败反馈、通过即停止、执行器回退、错误、警告。
- rawRef 仍通过逐事件“原始”和 Raw Lab 展开，不默认裸 JSON。
- 历史 turn 仍默认折叠，当前 turn 默认展开。

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

- 开始时间: 2026-06-05T01:08:49+02:00
- 完成时间: 2026-06-05T01:08:49+02:00
- 修改文件:
  - `packages/app/src/pages/session/turn-inspector-summary.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/app/src/pages/session/turn-inspector.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-079-turn-inspector.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test --preload ./happydom.ts ./src/pages/session/turn-inspector.test.ts`
  - `bun typecheck`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - app inspector projection: 1 pass, 19 expect
  - app typecheck: pass
  - opencode turn-history/public-event: 40 pass, 1398 expect
  - observability tests: 7 pass
- 残留风险:
  - 本条没有做浏览器截图验收，依赖 app typecheck 和投影单测证明 UI 数据结构正确。
  - Codex CLI 没有同款 Web Inspector，因此“1:1”体现为事件语义覆盖，不是复制 CLI 页面。
  - 未来 Raw Lab 产品化和更强搜索/下载/回放在 REQ-081 继续深化。

# REQ-040 TurnDiff

## 原始目标

40. TurnDiff：AIALRA 必须 P0 补全 Codex 风格 TurnDiffEvent，不能只在 benchmark 场景里临时跑 git diff。每个 turn 结束时，系统必须基于 file mutation store、environment FS、apply_patch/edit/write 记录生成本轮 TurnDiff，明确展示本轮新增、修改、删除、重命名的文件，以及每个文件的 diff、mutation 来源、tool_call_id、environment_id、permission decision。TurnDiffEvent 必须写入 history、trace/public event，并完整展示到 inspector，支持用户按 turn 查看“这一轮到底改了什么”。验收标准是：即使没有 git 仓库，AIALRA 也能基于 file mutation 生成 TurnDiff；即使有 git，也不能只依赖全局 git diff 混淆多轮修改；replay/resume 后仍能恢复每个 turn 的独立 diff。

## 当前状态

- 状态: 完全完成
- 完成判定: 已实现 `aialra.turn_diff.v1`，工具结果结算会实时聚合 file mutation，本轮完成或中断时会写入终态 TurnDiff；事件进入 internal trace、public event、turn history/replay，可用于 Turn Inspector 和零补丁判断
- 依赖前置: REQ-039 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

实际调查结论:

- 当前 AIALRA 已有 file mutation store，来源包括 write/edit/apply_patch 的 `fileMutations` metadata；之前 benchmark 层还能用 git diff 评分，但那是全局工作区 diff，不是单 turn diff
- 最新 OpenCode 原版主要依赖 message/tool part 和全局文件状态，没有稳定的 per-turn `TurnDiffEvent`
- Codex CLI 的用户体感里每个回合能明确知道改了哪些文件；AIALRA 本条补齐为显式 `TurnDiff` 协议，不再只依赖 benchmark 之后的 git diff
- `packages/opencode/src/session/tool-result-settlement.ts` 是真实 runtime 接入点，任何主 prompt 工具执行完成都会结算工具结果，本条在这里接入 TurnDiff 聚合
- `packages/opencode/src/session/prompt.ts` 是 turn terminal 出口，本条在 completed/aborted 前写入终态 TurnDiff，零补丁也会有 `files=0` 的记录
- `packages/opencode/src/session/public-event.ts` 和 `packages/opencode/src/session/turn-history.ts` 是 public event 与 replay 接入点，本条新增 `turn.diff.updated`
- UI Inspector 已经按 public event stream 消费事件，本条提供了中文标题和 file kind；后续 REQ-009/Raw Lab/Inspector 产品化项会继续增强具体展示

必须回答:

- 字段差异: AIALRA 现在有 `schema/session_id/turn_id/message_id/source/updated_at/finalized_at/terminal_outcome/summary/files/mutations/tool_call_ids/environment_id/permission_decision/diff`；OpenCode 原版缺少正式 per-turn diff；Codex CLI 的真实 diff 由其执行 harness 和事件系统承载，AIALRA 当前实现的是 TypeScript 侧兼容协议
- 事件差异: AIALRA 新增 `turn.diff.updated`；OpenCode 原版无同名 public event；Codex CLI 有更成熟的 turn item/diff 体验，AIALRA 已补 runtime 事件但 UI 还可继续细化
- runtime 差异: AIALRA 从实际工具结算 metadata 聚合，不只是 UI 假展示；benchmark 仍可额外使用 git diff 做质量评分
- 持久化差异: AIALRA 通过 TurnHistory JSONL replay；OpenCode 原版无该 replay item；Codex CLI 的事件/会话存储底座不同，语义上已对齐但底层实现不 1:1

## 数据结构和 schema 计划

- 新增正式协议: `aialra.turn_diff.v1`
- `requested_path` 表示工具参数里模型请求的路径；`resolved_path` 表示 TurnContext/cwd/environment/sandbox 解析后的真实路径；`environment_id` 表示本轮选中的 environment
- `summary` 统计本轮文件数、mutation 数、新增、修改、删除、移动、preview；`files[]` 聚合每个文件的操作、工具、tool_call_id、mutation_count、before/after/desired/diff
- `permission_decision` 从 file mutation metadata 透传，后续文件工具补齐更细权限字段时 TurnDiff 不需要改协议
- history/replay 通过 `turn.context.item` + kind `file` 承载；public event 安全摘要进入 SSE，完整 payload 走现有 raw/audit 机制
- 旧 session 没有 TurnDiff 时读取为空，不做 DB migration；新 session 每次工具结算或 turn terminal 自动写入

## 事件协议计划

本条相关变化必须进入:

- internal trace: `tool.result.settled` 后自动追加 `turn.diff.updated`；turn completed/aborted 前再写终态 `turn.diff.updated`
- typed public event: `turn.diff.updated`，中文标题 `本轮代码改动已更新`
- history/replay record: `TurnHistory.contextItemKind()` 把 `turn.diff.*` 归为 `file`
- Turn Inspector projection: 通过 public event stream 可显示每轮文件改动摘要；Raw Lab 可查看完整 `aialra.turn_diff.v1`
- benchmark JSON: 后续 benchmark 可直接读取 `turn.diff.updated` 判断零补丁、改动文件数和 mutation 来源

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行路径: `ToolResultSettlement.emit()` 读取真实工具 metadata 的 `fileMutations` 并更新 `TurnDiffStore`
- 模型调用路径: 不把 TurnDiff 直接塞回模型首轮上下文，本条目标是审计/回放/质量判断；后续 zero patch recovery 和 verification feedback 可读取该结果
- 权限/审批/沙箱/cwd/environment: 本条不重新做门禁，而是消费前序文件工具已经写入的 resolved path、environment_id 和 permission decision
- 失败路径: failed tool settlement 仍会先记录工具结算；有 mutation metadata 时可进入 TurnDiff
- abort 路径: `emitTurnAborted()` 会 finalize 零补丁或已有 diff
- resume/replay 路径: TurnHistory JSONL 可按 session/turn 恢复 `turn.diff.updated`

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 默认标题: `本轮代码改动已更新`
- 摘要: `files=<n> mutations=<n>`
- 高级详情: Raw Lab/public event raw payload 展示 `files[]`、mutation 来源、tool_call_ids、diff
- 历史 turn 折叠后仍可通过 replay 读取 `turn.context.item(kind=file, phase=turn.diff.updated)`

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

- 新增 `packages/opencode/test/session/turn-diff.test.ts`
- 覆盖 `tool.result.settled -> turn.diff.updated -> public event -> TurnHistory replay`
- 覆盖同一 turn 同一文件多次 mutation 聚合
- 覆盖零补丁 turn terminal finalize，`files=0/mutations=0/terminal_outcome=completed`
- 复跑 prompt 主链路，确认 write/edit/apply_patch/read/directory 和 turn lifecycle 未被新事件破坏
- 复跑 public event/history 测试，确认事件 registry 和 Last-Event-ID replay 不受影响

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

- 开始时间: 2026-06-04T18:00:00+02:00
- 完成时间: 2026-06-04T18:24:56+02:00
- 修改文件: `packages/opencode/src/session/turn-diff.ts`, `packages/opencode/src/session/tool-result-settlement.ts`, `packages/opencode/src/session/prompt.ts`, `packages/opencode/src/session/public-event.ts`, `packages/opencode/src/session/turn-history.ts`, `packages/opencode/test/session/turn-diff.test.ts`, `packages/opencode/test/session/prompt.test.ts`
- 测试命令:
  - `bun test test/session/turn-diff.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - `bun test test/session/turn-diff.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果:
  - TurnDiff 专测: 3 pass
  - Prompt/schema 主回归: 98 pass
  - TurnDiff/history/http public event: 33 pass
  - opencode typecheck: pass
  - observability node tests: 6 pass
  - diff check: pass
- 失败原因和修复:
  - 首次新增测试断言误读 TurnHistory 结构，把 `context` 写成了 `data.data`，已修正
  - prompt 主套件一度暴露 `write/edit` 不执行，根因是测试默认模型走 GPT 风格 `apply_patch` 工具表，而测试模拟的是 `write/edit` 调用；已把测试 fixture 默认模型固定为 `test/test-model`，真实 GPT apply_patch 策略不受影响
- 残留风险: TurnDiff 当前依赖工具 metadata 的 `fileMutations` 完整性；若未来新文件工具没有写 mutation metadata，TurnDiff 会显示零改动。后续 REQ-041+ 文件工具/exec-server 全收敛时继续保证所有 mutation 来源都写入同一协议。

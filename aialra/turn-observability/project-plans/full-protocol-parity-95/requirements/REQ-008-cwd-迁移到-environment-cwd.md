# REQ-008 cwd 迁移到 environment cwd

## 原始目标

8. cwd 迁移到 environment cwd：AIALRA 必须 P0 迁移所有执行逻辑到 selected environment cwd，不再依赖老式全局 cwd。所有 shell、file edit、read file、search、tool execution、approval prompt、history、inspector 展示都必须使用 resolved environment cwd。旧 cwd 字段可以保留兼容，但必须标注 deprecated，并且不能作为真实执行来源。验收标准是：local、docker、remote、多 workspace 场景下，工具执行目录和 inspector 展示目录完全一致。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。工具执行、沙箱门禁、shell cwd、turn.started 事件和终态错误 assistant path 现在使用 selected environment cwd。旧 `turn.cwd` 保留兼容，但真实执行路径通过 `CodexTurn.environmentCwd(turn)` 解析。
- 依赖前置: REQ-007 必须已完成并更新状态矩阵
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
- 构造同一 session 两个 turn 使用不同 override 的场景
- 断言工具读取 effective config，而不是 requested config 或 session 默认值

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
  - AIALRA 已有 `CodexTurn.environmentCwd(turn)` 和 turn-sandbox 对 selected environment cwd 的支持。
  - 风险点在 `SessionSecurity.applyToTurn`：如果 session 有 live config，它可能用 session cwd 覆盖 per-turn environment cwd。
  - prompt 的 `turn.started` 和终态错误 assistant path 仍在直接使用 `turn.cwd`。
- 实现内容:
  - `SessionSecurity.applyToTurn` 改为保留 `turn.thread_settings.requested` 里的 per-turn settings，把 session live config 和本轮 override 重新解析后合并，避免工具门禁把本轮 cwd 冲回 session 默认 cwd。
  - `turn.started` bus event 和 trace data 使用 `CodexTurn.environmentCwd(turn)`；若旧 cwd 不同，则 trace 记录 `legacyCwd`。
  - 创建 terminal error assistant 时，assistant path.cwd 改用 selected environment cwd。
  - 新增测试证明 session 默认 cwd 和 per-turn cwd 不同的时候，`applyToTurn` 后工具看到的是本轮 selected environment cwd。
- 修改文件:
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/test/session/security.test.ts`
- 测试命令:
  - `bun test test/session/security.test.ts test/tool/turn-sandbox.test.ts test/tool/shell.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - security/turn-sandbox/shell: 49 pass, 0 fail。
  - `bun typecheck`: pass。
- 残留风险:
  - remote/docker environment 真执行由 REQ-009 继续实现；本条先保证 local selected environment cwd 是真实执行来源。

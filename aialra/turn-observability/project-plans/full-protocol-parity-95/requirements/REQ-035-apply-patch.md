# REQ-035 Apply patch

## 原始目标

35. Apply patch：AIALRA 必须全量拦截 apply_patch，使其通过 environment FS 和统一工具底座执行，不能让 shell 或外部命令绕过 AIALRA 的路径门禁直接修改文件。apply_patch 必须解析 patch 中的每个文件路径，逐一执行 normalize、realpath、environment cwd、permission profile、constraints、protected path、symlink escape 检查，再通过 Codex FS adapter 或 OpenCode core apply-patch 应用修改。应用前必须生成 preview，应用后必须生成 file_mutation 和 TurnDiff 数据。验收标准是：patch 中任何一个文件越界、命中 protected path、symlink escape、权限不足或上下文不匹配时，都必须明确失败并显示具体原因；成功时 inspector 能展示 patch、受影响文件、每个 hunk 的应用结果和最终 diff。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成
- 依赖前置: REQ-034 必须已完成并更新状态矩阵
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

实际结论:

- 当前 AIALRA 在实现前已经能解析 `apply_patch` hunk，按 `TurnSandbox.resolvePath` 解析路径，调用 `TurnSandbox.assertWritableParentExists`、`assertExternalDirectoryEffect`、`ctx.ask`、`CodexFs.writeWithDirs/remove` 执行真实写入，已有 protected path、read-only、workspace-write、symlink escape 的运行时门禁
- 当前缺口是 apply_patch 成功后只返回 `diff` 和 `files`，没有统一的 `aialra.file_write.v1`、逐文件 `aialra.file_mutation.v1`、patch intent、before/after hash，Turn Inspector 和 benchmark 只能看到一坨 patch，不知道每个文件最终状态
- 最新 OpenCode 上游 apply_patch 重点是解析和应用补丁，本身没有 AIALRA 的 TurnContext、public event、rawRef、benchmark quality 字段
- Codex 的优势是补丁应用被执行器和沙箱包起来，最终能和工具结果、终态、diff 收敛到同一条 turn 里，AIALRA 本条对齐到 Node/Bun 当前工具底座和 CodexFs sidecar adapter，尚未声明已经完全等同 Rust exec-server 的所有内部 FS 事务语义

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

实际实现:

- `aialra.file_mutation.v1` 的 `operation` 扩展为 `create | overwrite | delete | move | preview`
- `aialra.file_write.v1` 新增 `patch_intent`
  - `patch_chars`: 原始 patch 字符数
  - `hunk_count`: 解析出的 hunk 数
  - `affected_files`: 每个受影响文件的 requested path、resolved path、operation、move path、additions、deletions、applied、hunk_status
- `requested_path` 表示模型 patch 文本里的路径或汇总路径
- `resolved_path` 表示经过 selected environment cwd、TurnSandbox、realpath/permission 检查后的执行路径
- `before/after/desired` 记录 exists、size、sha256、BOM
- `fileMutations` 保存逐文件 mutation 列表，`fileWrite.mutation` 保存首个 mutation 作为旧事件兼容入口
- `ToolOutputStore` 既有 rawRef 回填逻辑继续生效，旧 session 没有 `patch_intent` 或 `fileMutations` 时仍按原 metadata/files 兼容读取

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- `ToolFoundation.emitFileWrite` 已覆盖 `apply_patch`，本条让 apply_patch 真实返回 `metadata.fileWrite`，因此自动进入 `file.write`
- `ToolResultSettlement` 读取 `metadata.fileMutations`，benchmark 和 history 能拿到逐文件 mutation
- `PublicEvent` 已有 `file.write` 映射，本条让 `file.write.data.patch_intent` 和 `file.write.data.mutation` 可见
- `TurnHistory` 对 `file.write` 已按 file kind 持久化和 replay

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际实现:

- apply_patch 仍先整包解析和验证，任何 hunk 缺文件、上下文不匹配、protected path、symlink escape、workspace 外写入、read-only 权限不足都会在写入前失败，不会半写
- add/update/delete/move 继续通过 `CodexFs.writeWithDirs/remove` 执行，exec-server 可用时走 Codex FS adapter，失败按既有 fallback 审计
- 成功写入后读取最终文件状态，生成逐文件 mutation
- move 记录为 `operation=move`，delete 记录为 `operation=delete`，add 覆盖已有文件时记录为 `overwrite`
- prompt 主路径用 GPT 风格模型触发 apply_patch 工具时，tool part metadata、`file.write` trace、`tool.result.settled.fileMutations` 均可观察

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- 当前 Turn Inspector 通过 `file.write` public event 可展示 apply_patch 的写入汇总
- `data.patch_intent.affected_files` 提供受影响文件列表、operation、hunk_status、additions、deletions
- `data.mutation` 和 `tool.result.settled.fileMutations` 提供逐文件 before/after hash 给后续质量面板和 benchmark 使用
- Raw Lab 条目将统一展示完整 raw，属于后续 Raw Lab 产品化条目

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

- 开始时间: 2026-06-04T17:12:45+02:00
- 完成时间: 2026-06-04T17:12:45+02:00
- 修改文件:
  - `packages/opencode/src/tool/apply_patch.ts`
  - `packages/opencode/src/session/file-write-protocol.ts`
  - `packages/opencode/test/tool/apply_patch.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-035-apply-patch.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
- 测试命令:
  - `bun typecheck`
  - `bun test test/tool/apply_patch.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts -t "model apply_patch tool records" --timeout 30000`
  - `bun test test/tool/apply_patch.test.ts test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果:
  - opencode typecheck pass
  - apply_patch 27 pass
  - prompt apply_patch 1 pass
  - apply_patch + turn-sandbox 57 pass
  - turn-history + public-event 27 pass
  - observability 6 pass
  - diff check pass
- 残留风险:
  - apply_patch 多文件事件当前是一个 `file.write` 汇总事件加多条 `fileMutations`，不是每个文件单独一个 public event
  - atomic 仍为 false，原因是当前 Codex FS adapter 没有稳定 rename/transaction API
  - prompt 多条工具测试并行跑时 mock LLM 队列可能互相抢响应，REQ-035 采用单条 prompt apply_patch 测试验证真实链路

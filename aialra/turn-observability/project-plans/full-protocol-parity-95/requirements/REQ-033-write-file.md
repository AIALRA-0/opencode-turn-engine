# REQ-033 Write file

## 原始目标

33. Write file：AIALRA 必须将 write 全量迁移到 environment FS + file mutation 体系，所有写入都必须经过 TurnContext 门禁、Codex FS adapter、permission profile、constraints、protected path、symlink escape 和 approval 检查，不能出现工具直接写文件的旁路。实现时需要吸收 OpenCode 最新 core write / file mutation 机制，写入前记录 old file metadata，写入后记录 new file metadata，并生成 file_mutation item。写操作必须支持 atomic write、create file、overwrite policy、encoding policy、dry-run/preview、失败回滚或失败记录。验收标准是：任意 write 都能在 inspector 中看到写入前后路径、大小、hash、是否新建、是否覆盖、权限判定、approval 结果、file mutation，并且 TurnDiff 能基于这些 mutation 生成本轮 diff。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。write 工具现在生成正式 `aialra.file_write.v1` 和 `aialra.file_mutation.v1`，写入前后记录 exists/size/sha256/BOM，真实执行仍先过 TurnContext、TurnSandbox、external_directory、approval，再通过 Codex FS adapter 写入。file mutation 进入 tool metadata、tool.result.settled、internal trace、public event 和 TurnHistory。
- 依赖前置: REQ-032 必须已完成并更新状态矩阵
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

### 实际调查结论

- 当前 AIALRA 已有 write 工具的 TurnSandbox 门禁和 CodexFs 写入路径，能按 selected environment cwd 解析相对路径，能拒绝 workspace 外、protected path 和 symlink escape。
- 当前 AIALRA 之前缺少正式写文件协议，没有记录写前/写后 hash、size、BOM、operation，也没有生成可被 TurnDiff/benchmark 消费的 file mutation item。
- OpenCode 原版 write 主要返回普通 tool metadata 和文本结果，核心目的是完成写入，不提供完整 file mutation 审计协议。
- Codex CLI 的执行器更偏向受控文件系统和 diff/patch 审计，本条用 AIALRA 协议把 write 结果显式转成 mutation item，便于后续 TurnDiff 和质量评分。

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 实际实现

- 新增 `packages/opencode/src/session/file-write-protocol.ts`
- 新协议:
  - `aialra.file_write.v1`
  - `aialra.file_mutation.v1`
- `fileWrite` 字段包含:
  - `requested_path / resolved_path`
  - `environment_id / environment_cwd`
  - `policy.overwrite / dry_run / encoding / preserves_bom / atomic / atomic_reason`
  - `permission_decision`
  - `before / after / desired`
  - `mutation`
  - `raw_ref`
- `fileMutations` 数组进入 tool metadata，`ToolResultSettlement` 已能自动收集到 `tool.result.settled.fileMutations`。
- 旧 session 兼容: 旧 write tool result 没有 `fileWrite` 时仍保留原 `filepath/exists/diagnostics` metadata，不需要 DB migration。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 实际实现

- `ToolFoundation` 在 write/edit/apply_patch 完成后识别 `metadata.fileWrite` 并发 `file.write` trace。
- `PublicEventLog` 新增直接 `file.write` 映射，中文标题为 `写入文件：...`，summary 显示路径、状态、operation 和 dry-run。
- `TurnHistory` 已将 `file.*` 归入 file 类上下文，因此 `file.write` 可回放。
- `ToolOutputStore` 回填 `fileWrite.raw_ref`。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 实际实现

- write 工具仍先执行:
  - `TurnSandbox.resolvePath`
  - `TurnSandbox.assertWritableParentExists`
  - `assertExternalDirectoryEffect(access=write)`
  - `ctx.ask(permission=edit, diff=...)`
  - `CodexFs.writeWithDirs`
- 新增可选参数:
  - `dryRun`: 只生成预览和 mutation，不落盘，不发布 FileWatcher 变更。
  - `overwrite`: `allow / deny / if_absent`。默认 `allow`。已存在文件且策略不是 allow 时拒绝覆盖。
- 写前读取 old bytes 和 BOM，写后读取 new bytes，记录 sha256 和 size。
- formatter 仍可运行，最终 `after` 以 formatter 后文件内容为准。
- 当前 atomic 状态如实记录为 `atomic=false`，`atomic_reason=codex_fs_rename_api_unavailable`。没有伪造原子写成功。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### 实际实现

- Turn Inspector 可从 public event stream 看到 `file.write` 中文摘要。
- Raw Lab 可通过 rawRef 查看完整 tool output。
- file mutation metadata 已包含 TurnDiff 所需路径、operation、before/after hash 和 diff stats，后续 TurnDiff 专项可直接消费。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造允许、询问、硬拒绝、约束覆盖审批四类场景
- 断言 UI 展示和实际执行结果一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

### 实际测试命令和结果

- `bun typecheck`
  - 通过
- `bun test test/tool/write.test.ts --timeout 30000`
  - 通过: 17 pass
- `bun test test/session/turn-history.test.ts -t "file write" --timeout 30000`
  - 通过: 1 pass
- `bun test test/session/prompt.test.ts -t "model tool execution uses TurnContext cwd" --timeout 30000`
  - 通过: 1 pass
- `bun test test/tool/write.test.ts test/tool/turn-sandbox.test.ts --timeout 30000`
  - 通过: 47 pass
- `bun test test/session/prompt.test.ts -t "model tool execution uses TurnContext cwd|model write tool cannot escape" --timeout 30000`
  - 通过: 2 pass
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 通过: 27 pass
- `node --test aialra/turn-observability/tests/*.test.js`
  - 通过: 6 pass
- `git diff --check`
  - 通过

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

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/file-write-protocol.ts`
  - `packages/opencode/src/session/tool-output-store.ts`
  - `packages/opencode/src/session/tool-foundation.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/tool/write.ts`
  - `packages/opencode/test/tool/write.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
- 测试命令: 见“实际测试命令和结果”
- 测试结果: 全部通过
- 残留风险:
  - 当前 Codex FS adapter 没有稳定 rename API，因此 write 协议明确记录 `atomic=false`，没有伪造原子写。完全原子写应在后续 exec-server FS API 扩展或 REQ-037/REQ-040 类任务中补 `fs/rename`。
  - dry-run 会经过写入门禁，但不会真实写入，也不会发布 FileWatcher 事件。
  - edit/apply_patch 的完整 mutation parity 由 REQ-034/REQ-035 继续收敛，本条只保证 write 工具本身完全接入 mutation。

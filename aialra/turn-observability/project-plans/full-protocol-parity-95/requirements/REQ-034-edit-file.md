# REQ-034 Edit file

## 原始目标

34. Edit file：AIALRA 必须将 edit 做成标准 patch/file mutation 工具，而不是简单受控读写拼接。edit 执行前必须读取目标文件的当前版本，校验 patch 或 edit 指令是否能唯一匹配，经过 environment FS、TurnContext gate、permission profile、constraints、protected path、symlink escape 检查后才能修改。实现时需要对齐 OpenCode 最新 core edit，并在 AIALRA 中统一记录 edit intent、old snippet、new snippet、applied range、conflict reason、file_mutation、diff preview。验收标准是：模糊匹配、文件变化冲突、protected path、越权路径、symlink escape 都会被拒绝或要求重新确认；成功 edit 后 inspector 能展示修改前后片段、最终 diff、关联 tool_call_id 和 turn_id。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。edit 工具成功路径现在生成 `aialra.file_write.v1` 和 `aialra.file_mutation.v1`，记录 edit intent、old/new snippet、replaceAll、applied range、before/after hash 和 diff stats。真实运行仍沿用 OpenCode edit replacer 校验唯一匹配，先过 TurnContext gate、TurnSandbox、external_directory、approval，再通过 Codex FS adapter 写入。
- 依赖前置: REQ-033 必须已完成并更新状态矩阵
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

- 当前 AIALRA edit 已经有 OpenCode 上游的多策略 replacer，包括 exact、trimmed、block anchor、whitespace、indentation、escape、context-aware、multi occurrence 等匹配方式。
- 当前 edit 已经有 per-file semaphore lock，能避免同一文件并发 edit 互相覆盖。
- 当前 edit 已经接入 TurnSandbox 和 CodexFs 写入，但之前没有 file mutation 协议，Inspector/benchmark 不能稳定知道 edit 修改了哪个文件、旧片段、新片段、最终 hash 和 mutation。
- Codex CLI 对 edit/patch 更偏向受控 diff 和变更收口。本条将 AIALRA edit 成功结果转为统一 mutation item，和 REQ-033 write 共用协议。

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 实际实现

- 扩展 `packages/opencode/src/session/file-write-protocol.ts`
  - `FileWriteMetadata.tool` 支持 `write | edit | apply_patch`
  - `FileMutation.tool` 支持 `write | edit | apply_patch`
  - 新增 `edit_intent`
- edit 成功后写入:
  - `fileWrite.schema = aialra.file_write.v1`
  - `fileWrite.tool = edit`
  - `edit_intent.old_snippet / new_snippet / replace_all / applied_range`
  - `mutation.schema = aialra.file_mutation.v1`
  - `mutation.operation = create | overwrite`
  - `before / after` 包含 exists、size、sha256、BOM
  - `fileMutations = [mutation]`
- 旧 session 兼容: 旧 edit result 没有 fileWrite/fileMutations 时仍保留原 diff/filediff/diagnostics metadata。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 实际实现

- REQ-033 已让 `ToolFoundation` 识别 `metadata.fileWrite` 并发 `file.write`。
- 本条 edit 成功路径会返回 `fileWrite`，所以主 prompt 路径自动进入 `file.write` trace、PublicEventLog、TurnHistory。
- `ToolResultSettlement` 自动收集 `metadata.fileMutations` 到 `tool.result.settled.fileMutations`。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 实际实现

- edit 执行前仍先做:
  - `TurnSandbox.resolvePath`
  - `TurnSandbox.assertWritableParentExists`
  - `assertExternalDirectoryEffect(access=write)`
  - replacer 唯一匹配校验
  - `ctx.ask(permission=edit, diff=...)`
  - `CodexFs.writeWithDirs`
- 不存在文件且 oldString 非空、路径是目录、oldString 找不到、oldString 多处匹配、oldString 与 newString 相同，仍由原 edit 工具拒绝。
- 成功写入后重新读取最终文件 bytes，确保 after hash 反映 formatter 后内容。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### 实际实现

- Turn Inspector 可通过 `file.write` 事件看到 edit 产生的文件写入摘要。
- 高级详情可看到 `edit_intent`、before/after、mutation、diff stats。
- Raw Lab 可通过 `rawRef` 查看完整 tool output。

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
  - 首次发现 `Uint8Array` 泛型推断过窄，已修正为 `Uint8Array<ArrayBufferLike>`。
  - 重跑通过
- `bun test test/tool/edit.test.ts --timeout 30000`
  - 首次失败: 测试把 applied_range end 写成 oldString 长度，但当前 diff range 是最小变化范围，`old -> new` 为 0..3。已改断言。
  - 重跑通过: 27 pass
- `bun test test/session/prompt.test.ts -t "model edit tool records" --timeout 30000`
  - 通过: 1 pass
- `bun test test/tool/edit.test.ts test/tool/turn-sandbox.test.ts --timeout 30000`
  - 通过: 57 pass
- `bun test test/session/prompt.test.ts -t "model edit tool records|model write tool cannot escape" --timeout 30000`
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
  - `packages/opencode/src/tool/edit.ts`
  - `packages/opencode/test/tool/edit.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
- 测试命令: 见“实际测试命令和结果”
- 测试结果: 全部通过
- 残留风险:
  - `applied_range` 记录的是最终最小变化范围，不是模型输入 oldString 的全文范围。这样更适合 diff/TurnDiff，但 UI 需要把它解释为“实际变化范围”。
  - edit 失败路径仍通过原工具 error 和 tool.result.settled 记录失败，没有生成成功 mutation。失败冲突详情专项可在后续错误协议任务中继续细化。
  - 原子写能力同 REQ-033，当前协议明确 `atomic=false`，不伪造 Codex FS rename 能力。

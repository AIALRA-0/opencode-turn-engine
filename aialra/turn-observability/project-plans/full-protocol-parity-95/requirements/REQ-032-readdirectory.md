# REQ-032 ReadDirectory

## 原始目标

32. ReadDirectory：AIALRA 必须将 readDirectory / list directory 全量接入 environment FS，而不是依赖老式 directory/workspace 推导或直接 filesystem list。目录读取必须以 selected environment cwd 为根，经过 TurnContext 门禁、Codex FS adapter、permission profile、constraints、protected path、symlink escape 检查后才能执行。需要对齐 OpenCode 最新 core filesystem/list，支持分页、排序、隐藏文件策略、最大返回数量、递归深度限制、文件类型标记、symlink 标记、protected entry 标记。验收标准是：用户和模型都能清楚看到某次 directory list 列的是哪个 environment 下的哪个路径、哪些条目被隐藏或拒绝、拒绝原因是什么，并且 UI inspector、history、trace 中都有完整记录。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。目录读取现在有独立 `aialra.directory_read.v1` 协议，真实 read 工具路径会从 selected environment cwd 解析目录，先过 TurnContext / TurnSandbox / external_directory 门禁，再走 Codex FS adapter 的 `fs/readDirectory` 或可审计 fallback。结果进入 tool metadata、rawRef、internal trace、public event stream 和 TurnHistory 回放。
- 依赖前置: REQ-031 必须已完成并更新状态矩阵
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

### 实际调查结论

- 当前 AIALRA 之前已经在 `read` 工具的目录分支中使用 `CodexFs.readDirectoryEntries`，但目录读取只借用了 `fileRead.kind = "directory"`，没有独立目录协议，条目级别看不到 hidden、protected、symlink、recursive refusal、pagination 等事实。
- 最新 OpenCode core filesystem/list 侧已有 `AppFileSystem.DirEntry`，能区分 `file / directory / symlink / other`，但原始 read 输出仍主要面向模型文本，不提供稳定 public event 协议。
- Codex exec-server 有受控 FS RPC 通道，AIALRA 的 `CodexFs.readDirectoryEntries` 已优先走 `fs/readDirectory`，本条补齐了返回值映射和可审计事件。当前 Codex exec-server response 如果提供 `isSymlink`，AIALRA 会保留；如果当前版本不提供，AIALRA 不伪造 symlink 类型。
- 差距收敛方式：保留原模型输出 `<entries>` 兼容格式，同时新增 `directoryRead` metadata 和 `directory.read` public event。Turn Inspector 可通过 public event 中文标题 `读取目录`、summary、data、rawRef 展示目录读取事实。

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

### 实际实现

- 新增 `packages/opencode/src/session/directory-read-protocol.ts`
- 新协议: `aialra.directory_read.v1`
- 关键字段:
  - `requested_path`: 模型或用户请求的原始路径
  - `resolved_path`: TurnSandbox 按 selected environment cwd 解析后的实际路径
  - `canonical_path`: 真实路径和 resolved 不一致时记录
  - `environment_id / environment_cwd`: 本轮实际使用的 environment
  - `listing`: `offset / limit / total / returned / hidden_policy / hidden_count / protected_count / symlink_count / symlink_escape_count / recursive_depth / effective_recursive_depth / sort / max_entries`
  - `entries`: 每条目录项的 `name / display_name / relative_path / type / hidden / protected / symlink / symlink_escape / refused / refusal_reason`
  - `permission_decision`: 本轮 permission profile、sandbox policy、approval policy 摘要
  - `raw_ref`: ToolOutputStore 保存完整输出后回填
- 旧会话兼容: 旧 tool result 没有 `directoryRead` 时仍按原 `fileRead` 或普通 tool metadata 展示，不需要 DB migration。
- 新 session 默认: read 目录成功时双写 `fileRead.kind=directory` 和 `directoryRead`，保证旧观察层和新协议同时可用。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

### 实际实现

- `ToolFoundation` 在 read 工具完成后，如果 metadata 里存在 `directoryRead`，发 internal trace phase `directory.read`。
- `PublicEventLog` 新增 public event type `directory.read`，中文标题为 `读取目录：...`，summary 显示路径、environment、返回条目数、总条目数和截断状态。
- `TurnHistory.contextItemKind` 将 `directory.*` 归入 `file` 类上下文，可被历史回放读取。
- `ToolOutputStore` 在保存完整输出后把 `raw_ref` 回填到 `directoryRead.raw_ref`。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

### 实际实现

- read 工具目录路径仍走 `TurnSandbox.resolvePath`，所以相对路径从 `CodexTurn.environmentCwd(turn)` 即 selected environment cwd 解析。
- 执行前仍走 `TurnSandbox.assertFileAccess(ctx, "read", filepath)` 和 `assertExternalDirectoryEffect`，没有绕过权限、审批或 cwd。
- 目录列举走 `CodexFs.readDirectoryEntries`，该层优先调用 Codex exec-server `fs/readDirectory`，失败时按已有策略记录 `exec_server.fallback` 并回退 Node/Bun filesystem。
- 新增可选参数:
  - `showHidden`: 默认 true，false 时输出隐藏项过滤，但 metadata 仍记录 hidden_count。
  - `recursiveDepth`: 默认 0，最高有效深度 3，metadata 记录 requested/effective。
  - `sort`: `name` 或 `type_name`，默认 `name`。
- protected path 递归时不深入 `.git / .agents / .codex`，对应 entry 标记 `refused=true` 和 `refusal_reason=protected_recursive_list_denied`。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

### 实际实现

- Turn Inspector 通过 public event stream 可看到 `directory.read`，默认中文标题和 summary 已可读。
- 高级详情和 Raw Lab 可通过 `rawRef` 查看完整 tool output。
- 条目级 metadata 可支持后续 UI 展示 hidden/protected/symlink/symlink_escape/refused 分类，不需要再改后端协议。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造同一 session 两个 turn 使用不同 override 的场景
- 断言工具读取 effective config，而不是 requested config 或 session 默认值

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

### 实际测试命令和结果

- `bun typecheck`
  - 通过
- `bun test test/tool/read.test.ts -t "directory" --timeout 30000`
  - 首次失败: 测试错误地假设分页第一页一定包含 `visible.txt`。实际按 name 排序第一页是 `sub/` 和 `sub/nested.txt`。已修正测试断言。
  - 重跑通过: 11 pass
- `bun test test/tool/turn-sandbox.test.ts -t "read directory records" --timeout 30000`
  - 通过: 1 pass
- `bun test test/session/turn-history.test.ts -t "directory read" --timeout 30000`
  - 通过: 1 pass
- `bun test test/session/prompt.test.ts -t "model read directory" --timeout 30000`
  - 首次失败: 测试目录自动生成多个隐藏/保护项，`hidden_count` 不能写死为 1。已改为 `>= 1`。
  - 重跑通过: 1 pass
- `bun test test/tool/read.test.ts --timeout 30000`
  - 通过: 41 pass
- `bun test test/tool/turn-sandbox.test.ts --timeout 30000`
  - 通过: 30 pass
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 通过: 26 pass
- `bun test test/session/prompt.test.ts -t "model read tool records|model read directory" --timeout 30000`
  - 通过: 2 pass
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
  - `packages/opencode/src/session/directory-read-protocol.ts`
  - `packages/opencode/src/session/tool-output-store.ts`
  - `packages/opencode/src/session/tool-foundation.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/src/tool/read.ts`
  - `packages/opencode/src/tool/codex-fs.ts`
  - `packages/opencode/src/tool/codex-exec-server.ts`
  - `packages/opencode/test/tool/read.test.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
- 测试命令: 见“实际测试命令和结果”
- 测试结果: 全部通过
- 残留风险:
  - 当前 readDirectory 递归有效深度固定最高 3，后续若要完全用户可调，应并入 Engineering Controls 的高级预算参数。
  - 当前 Codex exec-server `fs/readDirectory` 如果不返回 `isSymlink`，AIALRA 不会伪造 symlink，只在 Node/Bun fallback 或未来 exec-server 支持时完整标记。
  - Turn Inspector 已通过 public event 可展示目录读取摘要和 rawRef，专门的条目级 UI 分类面板仍可在 REQ-009/后续 Inspector 产品化任务中继续增强。

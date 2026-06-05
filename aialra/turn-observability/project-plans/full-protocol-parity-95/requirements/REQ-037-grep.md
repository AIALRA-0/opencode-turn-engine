# REQ-037 Grep

## 原始目标

37. Grep：AIALRA 必须把 grep 做成受控 runtime/tool，而不是直接 shell rg 或直接文件系统扫描。grep 必须基于 selected environment cwd，经过 TurnContext gate、permission profile、constraints、protected path、symlink escape 和 network/shell policy 相关检查；底层可以对齐 OpenCode core grep / ripgrep fallback，但所有输出必须进入 tool-output-store，并生成标准 tool result。grep 必须支持 timeout、max matches、context lines、binary file handling、large file handling、ignore rules、hidden/protected file filtering。验收标准是：grep 不会扫描被禁止路径，不会通过 symlink 越界，不会把超长结果塞爆上下文；inspector 能展示查询词、扫描范围、命中文件、过滤原因、截断状态和 raw_output_ref。

## 当前状态

- 状态: 完全完成
- 完成判定: grep 已接入受控 runtime/tool 路径，基于 TurnContext 和 selected environment cwd 解析搜索范围，经过 TurnSandbox read/search scope、reference、external directory、permission ask、protected path、hidden、ignore、max matches、context lines、timeout 和 raw output store，并生成 `aialra.file_search.v1`、`file.search` public event、history/replay 记录和 `raw_ref`
- 依赖前置: REQ-036 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

- AIALRA 当前已有 `TurnContext`、selected environment cwd、`TurnSandbox` 文件门禁、`CodexFs` 受控文件访问、`ToolOutputStore` raw output 存储、`file.search` public event、`TurnHistory` 回放和 `PublicEventLog`
- 原版 OpenCode grep 主要是工具层调用 ripgrep，能读文件内容并返回匹配，但没有 AIALRA 的 per-turn file search 协议、rawRef、history/replay、Sandbox Control Center 生效证明和过滤原因统计
- Codex 当前执行体系更偏 Rust exec-server/helper 执行底座，文件系统能力由受控执行器和沙箱组合约束；但本机 Codex exec-server 没有直接可用的 `fs/grep` API，所以 AIALRA 本条采用 `TurnContext-gated ripgrep adapter`，并将 fallback 原因写入 `exec_server.fallback` 和 `fileSearch.backend.fallback_reason`
- 差距边界: grep 的搜索执行仍不是 Codex exec-server 原生 FS API，而是经过 TurnContext 门禁后的 Node/Bun ripgrep adapter；由于 exec-server 无 `fs/grep`，这是可审计 fallback，不是未受控绕过

## 数据结构和 schema 计划

- `aialra.file_search.v1` 扩展为同时承载 glob 和 grep
- grep 字段:
  - `requested_pattern`: 用户或模型请求的正则
  - `requested_path`: 用户或模型请求的搜索路径
  - `search_cwd`: 实际传给 ripgrep 的受控搜索目录
  - `environment_id` / `environment_cwd`: 本轮 selected environment 信息
  - `backend.name = ripgrep_search`
  - `backend.fallback_reason`: Codex exec-server 缺少 fs/grep API 时的审计原因
  - `limits.max_results` / `timeout_ms` / `max_path_chars`: 本次搜索限额
  - `filters.show_hidden` / `follow_symlinks` / `protected_policy` / `ignore`: 本次过滤策略
  - `counts.scanned` / `returned` / `matched_files` / `hidden_filtered` / `protected_filtered` / `path_too_long_filtered` / `sandbox_filtered` / `other_filtered`: 可解释统计
  - `grep.include` / `total_matches` / `returned_matches` / `context_lines` / `max_line_chars` / `partial`: grep 专用细节
  - `results[]`: 命中文件摘要
  - `raw_ref`: 由 `ToolOutputStore` 写入，指向完整工具输出
- 旧 session 兼容: 没有 `fileSearch` 的旧工具记录仍按原工具输出展示，不触发新 projection
- 新 session 默认: grep 工具完成后由 ToolOutputStore 写 raw output，再由 ToolFoundation 发送 `file.search`

## 事件协议计划

本条相关变化必须进入:

- internal trace: `exec_server.fallback`、`file.search`、`tool.output.stored`、`tool.result.settled`
- typed public event: `file.search`
- history/replay record: `TurnHistory` 将 `file.search` 归类为 file context item
- Turn Inspector projection: public event 标题为 `搜索文件：<pattern>`，摘要显示 search cwd、environment、returned/scanned/truncated
- benchmark JSON: tool metadata 中带 `fileSearch`、`raw_ref`、counts 和 truncation，评测器可统计扫描范围、结果截断和过滤原因
- 事件字段包含 schema、session_id、turn_id、message_id、call_id、environment、backend、limits、filters、counts、grep、results 和 raw_ref

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- grep 执行入口读取 `Tool.Context.turn`，通过 `TurnSandbox.resolvePath` 使用 selected environment cwd 解析相对路径
- 执行前调用 `ctx.ask({ permission: "grep" })`，保留 OpenCode 权限审批入口
- 执行前调用 `TurnSandbox.assertFileAccess(ctx, "read", requested)` 和 `TurnSandbox.assertSearchScope(ctx, requested)`
- 执行前调用 reference 和 external directory gate，避免未授权仓库外搜索
- ripgrep 运行时读取 `showHidden`、`ignore`、`followSymlinks`、`timeoutMs`、`include`
- ripgrep 返回后，每个候选结果再次经过 protected path、hidden、path length 和 `TurnSandbox.assertFileAccess(ctx, "read", row.path)` 过滤
- context lines 使用 `CodexFs.readBomFile` 读取，因此上下文展示也经过受控文件系统通道
- abort 通过 `AbortSignal.any([ctx.abort, AbortSignal.timeout(timeoutMs)])` 传给 ripgrep
- resume/replay 通过 public event 和 TurnHistory 读取，不重新执行搜索

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- `file.search` 标题: `搜索文件：<requested_pattern>`
- 摘要: `<search_cwd> env=<environment_id> returned=<returned> scanned=<scanned> truncated=<true|false>`
- 高级详情: rawRef 指向完整工具输出；fileSearch 内含 backend fallback reason、filters、counts、results
- 历史回放: TurnHistory 将 `file.search` 存为 file context item，可按 session/turn 重放

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

- 开始时间: 2026-06-04 17:33:03 CEST 前已进入实现状态，本轮继续收敛
- 完成时间: 2026-06-04 17:33:03 CEST
- 修改文件:
  - `packages/opencode/src/file/ripgrep.ts`
  - `packages/opencode/src/tool/grep.ts`
  - `packages/opencode/src/session/file-search-protocol.ts`
  - `packages/opencode/test/tool/grep.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-037-grep.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
- 测试命令:
  - `bun test test/tool/grep.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts -t "grep tool records file search" --timeout 30000`
  - `bun test test/session/turn-history.test.ts -t "grep search" --timeout 30000`
  - `bun test test/tool/grep.test.ts test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/tool/parameters.test.ts --timeout 30000`
  - `bun test test/tool/parameters.test.ts --timeout 30000 --update-snapshots`
  - `bun test test/tool/parameters.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果:
  - grep 单测 7 pass
  - prompt grep 链路 1 pass
  - grep history/public replay 1 pass
  - grep + turn sandbox 37 pass
  - turn history + public event API 29 pass
  - parameters snapshot 初次失败仅因 grep 新参数 schema 变化，更新 snapshot 后 58 pass，再次无更新重跑 58 pass
  - `bun typecheck` 通过
  - turn observability node tests 6 pass
  - `git diff --check` 通过
- 残留风险:
  - Codex exec-server 仍没有直接 `fs/grep` API，本条采用受控 ripgrep fallback，并已记录 fallback reason
  - binary 文件处理依赖 ripgrep 默认行为和 `--json --no-messages`，本条重点保证不会把超长结果塞爆上下文，后续若引入 exec-server 原生 grep，需要复测 binary/encoding 细节

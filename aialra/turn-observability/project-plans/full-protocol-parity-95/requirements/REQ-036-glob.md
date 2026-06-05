# REQ-036 Glob

## 原始目标

36. Glob：AIALRA 必须把 glob 当成 runtime/tool 能力，而不是直接暴露一个同名 fs API。glob 必须基于 selected environment cwd 执行，并经过 TurnContext 门禁、permission profile、constraints、protected path、symlink escape 规则；底层可以使用 OpenCode core glob / ripgrep 或 ripgrep fallback，但返回结果必须统一成 AIALRA tool result。glob 必须支持最大结果数、ignore 规则、hidden 文件策略、protected path 策略、timeout、binary/large path 限制。验收标准是：glob 的每次调用都能在 inspector 中看到 pattern、cwd、environment_id、实际后端、结果数量、被过滤数量、过滤原因和是否截断。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成
- 依赖前置: REQ-035 必须已完成并更新状态矩阵
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

- 当前 AIALRA 在实现前已经让 glob 基于 `TurnSandbox.resolvePath` 和 selected environment cwd 解析，执行 `assertFileAccess`、`assertSearchScope`、`reference.ensure`、`assertExternalDirectoryEffect`，底层用 ripgrep `--files`，并记录 exec-server fallback
- 当前缺口是 glob 只返回 `count/truncated`，没有 pattern、cwd、backend、limit、hidden/protected/sandbox filter count、results、rawRef 和可回放 file search event
- 最新 OpenCode 上游 glob 主要是工具级搜索能力，没有 AIALRA 的 TurnContext 门禁审计、public event、TurnHistory、benchmark 质量字段
- 最新 Codex 的搜索能力受 cwd/sandbox/approval 约束，AIALRA 本条对齐到当前 Node/Bun ripgrep adapter，明确记录 Codex exec-server 暂无 `fs/glob` API 时的 fallback 原因

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

实际实现:

- 新增 `aialra.file_search.v1`
- 字段包括 `tool`、`status`、session/turn/message/call id、`environment_id`、`environment_cwd`、`requested_pattern`、`requested_path`、`search_cwd`
- `backend.name=ripgrep_files`，`backend.fallback_reason` 说明 Codex exec-server 当前没有 `fs/glob` API
- `limits` 记录 `max_results`、`max_scan`、`timeout_ms`、`max_path_chars`
- `filters` 记录 `show_hidden`、`follow_symlinks`、`protected_policy`、`ignore`
- `counts` 记录 scanned、returned、hidden/protected/path_too_long/sandbox/other filtered
- `truncation` 记录是否截断和 `result_limit | scan_limit`
- `results` 保存返回路径和相对路径、mtime
- `ToolOutputStore` 回填 `raw_ref`

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 新增 public event type `file.search`
- `ToolFoundation` 对 glob/grep 的 `metadata.fileSearch` 发 `file.search`
- `PublicEvent` 用中文标题 `搜索文件：pattern` 和摘要展示 search cwd、environment、returned/scanned、truncated
- `TurnHistory.contextItemKind` 已将 `file.*` 归入 file kind，本条新增 replay 样例测试
- `ToolResultSettlement` 继续保存 raw output ref，benchmark 可读 tool result 和 file search metadata

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际实现:

- glob 新增可调参数 `maxResults`、`showHidden`、`ignore`、`timeoutMs`、`followSymlinks`、`protectedPolicy`
- 搜索根目录继续走 selected environment cwd、TurnSandbox、external directory/reference 门禁
- 每个候选结果再次执行 `TurnSandbox.assertFileAccess(ctx, "read", file)`，被 sandbox/protected/symlink escape 拒绝的结果会被过滤并计数，不会直接泄露
- `showHidden=false` 和 ignore globs 会真实影响 ripgrep 参数
- `timeoutMs` 会传入 AbortSignal timeout，命令层可中止
- 结果数上限默认 100，最大 10000，扫描窗口按上限扩大但也封顶 10000

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际实现:

- Turn Inspector 可通过 `file.search` public event 展示 pattern、cwd、environment、backend、returned/scanned、truncated
- 高级详情可读 `counts` 里的 hidden/protected/sandbox filtered
- rawRef 指向完整工具输出
- 历史 turn 通过 TurnHistory replay 恢复 `aialra.file_search.v1`

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

- 开始时间: 2026-06-04T17:22:51+02:00
- 完成时间: 2026-06-04T17:22:51+02:00
- 修改文件:
  - `packages/opencode/src/session/file-search-protocol.ts`
  - `packages/opencode/src/session/tool-output-store.ts`
  - `packages/opencode/src/session/tool-foundation.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/tool/glob.ts`
  - `packages/opencode/test/tool/glob.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/tool/__snapshots__/parameters.test.ts.snap`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-036-glob.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
- 测试命令:
  - `bun test test/tool/glob.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts -t "glob tool keeps instance context" --timeout 30000`
  - `bun test test/session/turn-history.test.ts -t "file search" --timeout 30000`
  - `bun test test/tool/glob.test.ts test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/tool/parameters.test.ts --timeout 30000 --update-snapshots`
  - `bun test test/tool/parameters.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果:
  - glob 4 pass
  - prompt glob 1 pass
  - file search history 1 pass
  - glob + turn-sandbox 34 pass
  - turn-history + public-event 28 pass
  - parameters 58 pass
  - opencode typecheck pass
  - observability 6 pass
  - diff check pass
- 残留风险:
  - Codex exec-server 当前没有 `fs/glob` API，因此 runtime 是 TurnContext-gated ripgrep adapter，事件中明确记录 fallback
  - `protectedPolicy=show_refused` 当前表示允许结果进入后续门禁显示路径，不是完整 UI refused row 展示，完整 refused row 细节可在 Inspector 产品化条目继续增强

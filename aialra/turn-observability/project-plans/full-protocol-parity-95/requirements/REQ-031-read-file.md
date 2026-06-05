# REQ-031 Read file

## 原始目标

31. Read file：AIALRA 必须将 read file 全量迁移到 environment FS 体系，不能再让工具直接绕过 environment、permission profile、TurnContext 门禁或 Codex FS adapter 去读本地文件。每一次文件读取都必须基于 selected environment cwd 和 resolved path 执行，先经过 path normalize、canonical realpath、permission profile、constraints、protected path、symlink escape 检查，再由统一 FS adapter 返回内容。实现时需要吸收 OpenCode 最新 core tool/read 的设计，把 read file 做成标准 tool item，并记录 file_path、resolved_path、environment_id、turn_id、read_range、truncation、raw_ref、permission_decision、denied_reason 等信息。验收标准是：任意 read file 都能在 inspector 中看到来源 environment、实际读取路径、权限判定、是否截断、读取内容摘要，并且 replay/resume 时能恢复一致的 read result。

## 当前状态

- 状态: 完全完成
- 完成判定: 完全完成
- 依赖前置: REQ-030 必须已完成并更新状态矩阵
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
  - `ReadTool` 已经通过 `TurnSandbox.resolvePath` 从 selected environment cwd 解析相对路径
  - `ReadTool` 已经通过 `TurnSandbox.assertFileAccess` 做 read 门禁
  - `ReadTool` 已经通过 `CodexFs.readFile/readDirectoryEntries/stat` 优先走 Codex exec-server FS API，失败时按可审计 fallback 回退
  - 本条新增 `aialra.file_read.v1`，把 requested_path、resolved_path、canonical_path、environment_id、environment_cwd、read_range、truncation、permission_decision、preview、raw_ref 写入工具结果
  - `ToolOutputStore` 会把 `outputRef` 回填到 `fileRead.raw_ref`
  - `ToolFoundation` 会在 read 工具完成后发 `file.read` trace/public event/history
- 最新 OpenCode 已经有什么
  - 上游 read 工具有成熟的文本/目录/图片/PDF/二进制处理和 offset/limit/truncation 行为
  - 上游不具备 AIALRA 当前的 TurnContext/environment scoped metadata、rawRef、public event/history replay 统一记录
- 最新 Codex 已经有什么
  - Codex 的 read/exec 路径依赖 turn cwd、sandbox、approval 和 exec-server/沙箱底座
  - Codex 的 item 流天然能把工具结果作为一轮内的结构化 item 收口
- 三者字段、事件、runtime 行为、UI 展示、持久化分别差在哪
  - AIALRA 当前补齐了 OpenCode read 行为 + Codex 风格 environment/cwd/sandbox gate + rawRef/history/event
  - 和 Codex 差距: read 仍运行在 Node/Bun 工具实现之上，通过 CodexFs adapter 接 exec-server；底层完全 Rust exec-server FS runtime 默认化由后续 REQ-032 到 REQ-040 继续收敛
  - 和上游 OpenCode 差异: AIALRA 多了 `fileRead` metadata、`file.read` 公共事件、raw output ref、selected environment 证据

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
  - 新增 `aialra.file_read.v1`
  - 字段: `tool`、`status`、`kind`、`session_id`、`turn_id`、`message_id`、`call_id`、`environment_id`、`environment_cwd`、`requested_path`、`resolved_path`、`canonical_path`、`read_range`、`truncation`、`permission_decision`、`output_chars`、`preview`、`loaded_files`、`raw_ref`
- 明确 requested、resolved、effective 或 active 的区别
  - requested_path: 模型/用户传入的路径
  - resolved_path: 按 selected environment cwd 解析后的实际路径
  - canonical_path: realpath 后路径，用于说明 symlink/真实目标；不存在时不强求
  - permission_decision: 记录 effective TurnContext 下已经通过 read gate
- 明确 history item / replay item / rawRef / extension_data 的承载方式
  - `fileRead` 写入 tool result metadata
  - `ToolOutputStore.attach` 回填 `fileRead.raw_ref`
  - `ToolFoundation` 发 `file.read` trace，public event 和 TurnHistory 直接回放
- 明确旧 session 的兼容读取策略
  - 旧 tool result 没有 `fileRead` 时按旧 metadata 读取，不影响模型上下文和 UI
  - `message-v2` 仍按旧 output 字段回放工具结果
- 明确新 session 的默认写入路径
  - `ReadTool.execute` 成功返回时写 `metadata.fileRead`
  - `ToolOutputStore.attach` 写 `metadata.outputRef` 和 `metadata.fileRead.raw_ref`
  - `ToolFoundation.execute` 发 `file.read`

## 事件协议计划

本条相关变化必须进入:

- internal trace
  - 已新增/复用 `file.read`
- typed public event
  - `public-event.ts` 现在直接映射 `file.read` trace 为 `file.read` public event
- history/replay record
  - `turn-history.ts` 将 `file.read` 分类为 `file`
- Turn Inspector projection
  - Inspector 通过 `file.read` public event 中文标题/summary/data 展示 environment、路径、截断和 rawRef
- benchmark JSON 或质量统计，如适用
  - 后续 benchmark 可从 `file.read`/`tool.result.settled` 统计 read 次数、截断次数、rawRef 和越界读拒绝

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
  - ReadTool 执行真实读取前先读取 TurnContext selected environment cwd、permission profile、sandbox policy、security constraints
- 模型调用是否读取该字段
  - 模型上下文仍读取工具 output；`fileRead` 是审计 metadata，不改变模型可见内容
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
  - cwd/environment 在 `TurnSandbox.resolvePath` 生效
  - permission/sandbox/constraints 在 `TurnSandbox.assertFileAccess` 生效
  - external_directory 旧审批语义保持不变
- 失败路径、abort 路径、resume/replay 路径是否读取该字段
  - 成功 read 有 `fileRead` 和 `file.read`
  - 读取被拒绝仍由 `tool.sandbox.denied` / `security.constraint.denied` / tool failure 记录
  - resume/replay 从 tool result metadata、ToolOutputStore rawRef、TurnHistory 恢复

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
  - `file.read` event status=`completed`
- 用户能看懂的生效原因和失败原因
  - event summary 显示 resolved_path、environment_id、truncated
- rawRef 或高级详情入口
  - `fileRead.raw_ref` 和 `tool.result.settled.raw_output_ref`
- 历史 turn 折叠后仍可回放
  - `TurnHistory.list` 可回放 `aialra.file_read.v1`

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/server/httpapi-public-event.test.ts`
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
  - 通过 public event + TurnHistory 投影测试覆盖
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
  - `packages/opencode/test/session/prompt.test.ts`、`packages/opencode/test/tool/read.test.ts` 全量旧行为回归通过
- 构造同一 session 两个 turn 使用不同 override 的场景
  - 本条重点覆盖 selected environment cwd；跨 turn override 在 REQ-004/008/009 已覆盖，后续 readDirectory/write/edit/apply_patch 继续扩展
- 断言工具读取 effective config，而不是 requested config 或 session 默认值
  - `read tool uses selected environment cwd and records read metadata` 断言 read 实际读取 selected environment 文件

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

## 验收标准

- 协议层已实现并有 schema 测试
  - 通过
- history/replay 已实现并有恢复测试
  - 通过
- trace/public event 已实现并有事件样例测试
  - 通过
- Inspector 已展示并有 UI 或投影测试
  - 通过 public event/turn history 投影测试
- runtime 行为真实生效并有端到端测试
  - 通过 prompt read 工具端到端测试
- 旧 session 兼容测试通过
  - 通过 read.test/prompt.test 全量回归
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录
  - 已记录

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
  - 旧 metadata 缺少 `fileRead` 时仍兼容
- UI 展示的 requested 值和后端 effective 值不一致
  - 测试已断言 selected environment cwd 生效
- 工具绕过新 runtime gate
  - ReadTool 仍先过 TurnSandbox，再走 CodexFs adapter
- abort/completed/failed 状态重复 settle
  - read metadata 只在成功结果中写入，不改变 settlement 幂等
- raw output、history、event stream 三者顺序不一致
  - ToolOutputStore 先 attach rawRef，ToolFoundation 再 emit file.read

## 执行记录

- 开始时间: 2026-06-04T16:15:00+02:00
- 完成时间: 2026-06-04T16:26:57+02:00
- 修改文件:
  - `packages/opencode/src/session/file-read-protocol.ts`
  - `packages/opencode/src/tool/read.ts`
  - `packages/opencode/src/session/tool-output-store.ts`
  - `packages/opencode/src/session/tool-foundation.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
- 测试命令:
  - `bun typecheck`
  - `bun test test/tool/turn-sandbox.test.ts -t "read tool uses selected environment cwd" --timeout 30000`
  - `bun test test/session/turn-history.test.ts -t "file read" --timeout 30000`
  - `bun test test/session/prompt.test.ts -t "model read tool records environment scoped file.read event" --timeout 30000`
  - `bun test test/tool/read.test.ts --timeout 30000`
  - `bun test test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/session/provider-tool-protocol.test.ts test/session/runtime-item.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果:
  - `bun typecheck`: 通过
  - focused selected environment read: 1 pass
  - focused file.read history: 1 pass
  - focused prompt read: 1 pass
  - read.test: 40 pass
  - turn-sandbox.test: 29 pass
  - prompt.test: 68 pass
  - history/provider/runtime/public-event: 31 pass
  - observability node tests: 6 pass
  - `git diff --check`: 通过
- 残留风险:
  - 不存在文件和二进制拒读仍走 tool failure / sandbox denied，不额外伪造成功 `file.read`
  - 底层完全 Rust exec-server FS runtime 默认化继续由 REQ-032 到 REQ-040 收敛
  - 本条修复中发现并恢复了旧行为: configured reference 必须先 materialize 再 canonical；空文件必须保持 0 行语义

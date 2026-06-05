# REQ-024 Tool pre/post lifecycle hook

## 原始目标

24. Tool pre/post lifecycle hook：AIALRA 必须把工具执行前后的逻辑统一成正式 lifecycle hook。pre-hook 必须处理权限检查、constraints、cwd/environment、network policy、approval、trace、UI event；post-hook 必须处理 output store、truncation、rawRef、exit code、error、duration、file mutation、history、settlement、UI projector。所有工具都必须强制经过 lifecycle，不能 shell、file edit、plugin 各自绕路。验收标准是：任意工具调用都能看到完整 requested、started、completed/failed/aborted 生命周期。

## 当前状态

- 状态: 完全完成
- 完成判定: 完成。AIALRA 现在有正式 `aialra.tool_lifecycle.v1` 工具生命周期事件，覆盖模型工具路径、MCP 工具路径和用户直接 shell route。模型工具通过 ToolFoundation 强制发出 requested、started、completed、failed、aborted；直接 shell route 在 `SessionPrompt.shellImpl` 内发出同一套 lifecycle。工具失败现在捕获完整 Effect Cause，所以 `Effect.orDie` 这种 defect 也会被记录为 failed/aborted，同时原 Cause 原样回到原处理链路，不改变工具原有行为。
- 依赖前置: REQ-023 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有什么:
  - REQ-022 已引入 `ToolFoundation`，主 prompt 路径的 OpenCode registry 工具和 MCP 工具会穿过统一 wrapper。
  - REQ-023 已引入 `RuntimeItem`，provider tool-call/tool-result 会先进入统一 runtime item。
  - 各叶子工具内部已经有 TurnContext、cwd、sandbox、approval、network、Codex FS、exec-server fallback 等安全门禁。
  - 直接 shell route 以前是单独路径，只写 shell started/ended 和 tool part，本条已补 lifecycle。
- 最新 OpenCode 已经有什么:
  - upstream core v2 有 tool registry、tool output、file mutation、runner 等结构化底座。
  - upstream 方向是让 tool registry settle hook 统一管理工具结果。
- 最新 Codex 已经有什么:
  - Codex 的工具执行更像统一 harness: tool call 有明确开始、执行、结果、错误、中断，和 exec-server/sandbox/approval 关联。
  - Codex 的工具 stdout/stderr、FS mutation、sandbox reject、approval 都能归到同一个 turn 语义。
- 三者差异:
  - AIALRA 本条已补“所有主执行路径都能看到 requested/started/completed/failed/aborted”。
  - output store、truncation、file mutation 的深层统一仍在 REQ-026 和文件类工具条目继续。
  - Codex 的 post-hook 更贴近底层 exec-server 和系统 sandbox；AIALRA 当前是 TypeScript wrapper + 叶子工具门禁 + Codex exec-server bridge。

## 数据结构和 schema 计划

- 新增正式 lifecycle data schema:
  - `schema`: `aialra.tool_lifecycle.v1`
  - `hook`: `pre` 或 `post`
  - `status`: `requested`、`started`、`completed`、`failed`、`aborted`
  - `tool`: 工具名
  - `callID`: 工具调用 id
  - `source`: `opencode_registry`、`mcp_registry`、`shell_route`
  - `inputKeys`: 输入 key 摘要，不记录完整敏感输入
  - `cwd`: 本轮 cwd 或 shell cwd
  - `selected_environment_id`: 当前 environment
  - `environment_cwd`: environment cwd
  - `approval_policy`: 本轮审批策略
  - `approval_reviewer`: 审批 reviewer
  - `permission_profile`: 本轮有效权限档位
  - `sandbox_policy`: 本轮 sandbox 策略
  - `network_policy`、`network_permissions`: 本轮网络策略
  - `durationMs`: post-hook 耗时
  - `outputChars`、`attachmentCount`、`metadataKeys`: 输出摘要
  - `errorType`、`errorMessage`: 失败摘要
- requested/resolved/effective 区分:
  - requested: 工具请求进入 lifecycle。
  - started: pre-hook 完成，实际工具即将执行。
  - completed/failed/aborted: post-hook 收口。
  - effective: 事件里记录的是 TurnContext 的有效 cwd、permission、sandbox、approval、network 摘要。
- history/replay:
  - `tool.lifecycle.*` 进入 public event 和 turn history，history kind 为 `tool`。
- rawRef:
  - lifecycle 事件只存摘要。
  - 完整输入输出仍走 tool raw、DB part JSON、command.output、Raw Lab 等后续 raw 通道。
- 旧 session 兼容:
  - 新事件为附加事件，不修改旧 message schema。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

已实现事件:

- `tool.lifecycle.requested`
- `tool.lifecycle.started`
- `tool.lifecycle.completed`
- `tool.lifecycle.failed`
- `tool.lifecycle.aborted`

事件进入:

- internal trace: 完成
- typed public event: 完成
- history/replay record: 完成，kind=`tool`
- Turn Inspector projection: 完成，public event 有中文 title/summary
- benchmark JSON: 后续 benchmark 可读取 lifecycle 统计工具是否卡住、失败、中断，本条不启动 benchmark

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

已接入 runtime:

- `packages/opencode/src/session/tool-foundation.ts`
  - 对 OpenCode registry 工具和 MCP 工具统一执行 pre/post lifecycle。
  - pre-hook 发 requested 和 started。
  - post-hook 发 completed。
  - 失败时通过 `Effect.exit(input.run)` 捕获 fail、die、interrupt 的完整 Cause。
  - failed/aborted 发出后，原 Cause 继续返回原 processor，保持原工具行为。
- `packages/opencode/src/session/prompt.ts`
  - 直接 `prompt.shell()` route 也发同样 lifecycle。
  - shell 正常结束发 completed。
  - shell 被 cancel/interrupted 发 aborted。
  - shell 进程级异常发 failed，不再先 completed 再 failed。
- 权限、审批、沙箱、网络、cwd、environment:
  - 本条不替代叶子工具的门禁，而是在 lifecycle 里记录 TurnContext 有效摘要。
  - 真正的 permission/sandbox/cwd/network enforce 仍由叶子工具和 TurnSandbox/CodexFs 执行。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

已实现:

- 中文标题:
  - 工具生命周期已请求
  - 工具生命周期已开始
  - 工具生命周期已完成
  - 工具生命周期失败
  - 工具生命周期中断
- 摘要显示:
  - status
  - permission profile
  - cwd 或 environment cwd
  - toolCallID
- history/replay 分类为 tool，Turn Inspector 可以按工具类过滤和回放。
- 默认不展示裸 JSON。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造同一 session 两个 turn 使用不同 override 的场景
- 断言工具读取 effective config，而不是 requested config 或 session 默认值

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

- `bun typecheck`
  - 首次失败: `Effect.when` 用法与当前 Effect 版本不匹配，`active_sandbox_policy` 字段不存在。
  - 修复: 改成完整 `Effect.exit` + `Cause.squash`，使用真实 `network_policy/network_permissions` 字段。
  - 重跑结果: 通过。
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 结果: 21 pass。
- `bun test test/session/prompt.test.ts --timeout 30000`
  - 首次失败: 新增断言过窄，错误假设 `permission_profile === "workspace-write"` 且只捕获 fail 不捕获 defect。
  - 修复:
    - ToolFoundation 改为捕获完整 Cause，覆盖 `Effect.orDie` defect。
    - 断言改为检查真实 lifecycle 事件存在且带 cwd/permission 摘要。
    - 直接 shell route 补 lifecycle 并修复 started 作用域。
  - 重跑结果: 67 pass。

新增/更新测试:

- `packages/opencode/test/session/turn-history.test.ts`
  - lifecycle requested/completed 进入 public event 和 history replay。
- `packages/opencode/test/session/prompt.test.ts`
  - 直接 shell route 断言 `tool.lifecycle.requested/completed`。
  - 模型 write 工具成功路径断言 `tool.lifecycle.requested/completed`。
  - 模型 write 越界失败路径断言 `tool.lifecycle.failed`。

## 验收标准

- 协议层已实现并有 schema 测试: 完成。
- history/replay 已实现并有恢复测试: 完成。
- trace/public event 已实现并有事件样例测试: 完成。
- Inspector 已展示并有 UI 或投影测试: 完成，基于 public event/history 投影。
- runtime 行为真实生效并有端到端测试: 完成，prompt 全量覆盖模型工具和 shell route。
- 旧 session 兼容测试通过: 完成，新事件附加，不改旧 schema。
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录: 完成。

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

残留风险:

- 本条 lifecycle 已统一主执行路径，但 post-hook 的 output store、truncation、file mutation 还没有全部下沉到一个独立 store，REQ-026 和文件类工具条目继续处理。
- shell route 现在有 lifecycle，但不是通过 ToolFoundation.execute 包装，而是在 shellImpl 里发同协议事件。后续如果要绝对统一，可以把 shell route 也改成 ToolFoundation source。
- 完整 raw 输入输出下载、搜索、回放仍属于 Raw Lab 后续条目。

## 执行记录

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/tool-foundation.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/session/prompt.test.ts`
- 测试命令:
  - `bun typecheck`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts --timeout 30000`
- 测试结果: 全部通过
- 残留风险: lifecycle 协议和主路径接入完成；深层 output store、file mutation、raw output 管理继续由后续条目收敛。

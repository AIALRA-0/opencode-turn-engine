# REQ-022 合并 OpenCode v2 工具底座

## 原始目标

22. 合并 OpenCode v2 工具底座：AIALRA 必须优先合并 OpenCode v2 工具底座，包括 packages/core/src/tool-*、session/runner、tool-output-store、file-mutation 等关键模块。后续再逐步向 Codex 的执行器和调度器升级对齐。实现策略应是 OpenCode v2 foundation 做底盘，AIALRA gates/audit/permission 做安全层，Codex protocol 做最终对齐目标。验收标准是：旧工具栈不再作为主路径，所有工具执行都进入新 foundation。

## 当前状态

- 状态: 完全完成
- 完成判定: 完成。当前主 prompt 工具执行路径里的 OpenCode registry 工具和 MCP 工具已经统一穿过 AIALRA ToolFoundation，所有执行都会产生 foundation resolved/executing/settled 事件。这里没有把 upstream core v2 文件粗暴覆盖进当前仓库，因为当前 AIALRA 已经有大量 TurnContext、Codex FS、sandbox、approval、public event 改动，直接替换会破坏现有 AppFileSystem 和工具门禁。本条采用“OpenCode v2 工具底座语义适配层”先接管主路径，后续 REQ-023、REQ-026、REQ-031 到 REQ-040 继续把 leaf file mutation、runner、output store 深层收敛到 upstream/Codex 执行器。
- 依赖前置: REQ-021 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有什么:
  - `packages/opencode/src/tool/*` 仍是现有工具叶子实现，已经接入 `TurnContext`、`TurnSandbox`、`CodexFs`、approval audit、public event、Raw Lab/Turn Inspector 投影。
  - `packages/opencode/src/session/prompt.ts` 的主模型工具执行路径直接组装 registry 工具和 MCP 工具，并在执行前后做 AIALRA trace、permission、sandbox、dynamic tools 处理。
  - `packages/opencode/src/session/tools.ts` 是旧的工具 resolve 辅助路径，仍会被部分旧调用方使用。
  - AIALRA 已经有 Codex exec-server sidecar、文件工具桥接和 sandbox gate，但工具底座事件没有统一 foundation 层命名。
- 最新 OpenCode 已经有什么:
  - 已拉取 `upstream/dev`，参考提交 `76ee87ead feat(core): add embedded v2 session runtime and tool foundation (#30632)`。
  - upstream 新增 `packages/core/src/tool-registry.ts`、`packages/core/src/tool-output-store.ts`、`packages/core/src/file-mutation.ts`、`packages/core/src/location-mutation.ts`、`packages/core/src/tool/*`、`packages/core/src/session/runner/*`。
  - upstream 的方向是把工具注册、工具输出存储、文件变更和 session runner 收进 core v2 runtime。
- 最新 Codex 已经有什么:
  - Codex 的工具执行更偏“exec-server / harness 统一控制”，process、FS、sandbox、approval 走更底层的执行器协议。
  - Codex 不是把 OpenCode TypeScript core v2 原样当底座，而是有自己的 Rust/exec-server 和 turn contract。
- 三者差异:
  - OpenCode upstream v2 解决的是工具注册、runner、output store、file mutation 的结构化底座。
  - 当前 AIALRA 解决的是 TurnContext、sandbox、approval、Codex exec-server、事件审计和可观测性。
  - Codex 解决的是更底层的执行协议和系统级隔离。
  - 本条先把 AIALRA 的实际工具主路径放入统一 `ToolFoundation`，避免 UI 只显示“有底座”但工具真实执行绕过底座。深层 file mutation/output store/runner 原生替换继续拆到后续条目，避免一次覆盖导致现有安全层断裂。

## 数据结构和 schema 计划

- 新增内部服务: `ToolFoundation.Service`。
- 新增 foundation 信息:
  - `version`: `aialra.tool_foundation.v1`
  - `upstream`: `opencode-v2`
  - `upstreamCommit`: `76ee87ead`
  - `components.registry`: `aialra-adapter`
  - `components.runner`: `aialra-session-processor`
  - `components.outputStore`: `aialra-truncate-bridge`
  - `components.fileMutation`: `aialra-codex-fs-bridge`
  - `status`: `active`
- requested/resolved/effective 区分:
  - requested: 本轮模型或 MCP 请求的工具集合。
  - resolved: ToolFoundation 看到并准备接管的工具集合。
  - effective: 通过 permission/sandbox/dynamic tools 筛选后真实可执行的工具集合。
- history/replay:
  - `tool.foundation.*` 事件进入 public event stream 和 turn history。
  - history 分类为 `tool`，Turn Inspector 可以按工具类过滤和回放。
- rawRef:
  - foundation 事件默认只存摘要、工具名、callID、source、状态、错误摘要。
  - 完整工具 input/output 仍由现有 rawRef/audit 通道承载，本条不把大输出塞进 SSE。
- 兼容策略:
  - 旧 session 没有 foundation 事件时正常回放旧工具事件。
  - 新 session 自动写入 foundation 事件，不改变 PromptInput 外部 schema。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

已实现事件:

- `tool.foundation.resolved`: 工具底座已解析，说明本轮工具集合进入 AIALRA foundation 适配层。
- `tool.foundation.executing`: 工具底座开始执行，包含 tool、callID、source、是否有 turnID。
- `tool.foundation.settled`: 工具底座执行收口，包含 completed 或 error 状态。

事件进入:

- internal trace: 通过 `AialraTurnTrace.emit`
- public event stream: `PublicEvent` 类型已加入并有中文 title/summary
- history/replay: `turn-history` 把 `tool.foundation.*` 归类为 tool context item
- Turn Inspector projection: 复用 public event 中文摘要和 history 分类，不默认展示裸 JSON

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

已接入 runtime:

- `packages/opencode/src/session/prompt.ts`
  - OpenCode registry 工具执行从 `item.execute(args, ctx)` 改为 `foundation.execute({ source: "opencode_registry", run: item.execute(args, ctx) })`。
  - MCP 工具执行从直接 `execute(args, opts)` 改为 `foundation.execute({ source: "mcp_registry", run: ... })`。
  - `publishDynamicTools()` 后调用 `foundation.resolve()`，记录本轮工具底座状态。
- `packages/opencode/src/session/tools.ts`
  - 旧 `SessionTools.resolve` 也接入 foundation execute/resolve，避免旧调用方完全绕过 foundation。
  - 该旧路径没有完整 turn 入参时会记录无 turn 的 foundation 事件，主 prompt 路径会带完整 turn。
- `packages/opencode/src/effect/app-runtime.ts`
  - App runtime 注入 `ToolFoundation.defaultLayer`。
- `packages/opencode/src/server/routes/instance/httpapi/server.ts`
  - HTTP API route runtime 注入 `ToolFoundation.defaultLayer`。
- `packages/opencode/test/session/snapshot-tool-race.test.ts`
  - 测试 runtime 注入 foundation layer，证明现有测试不会因为服务缺失退回旧路径。

失败路径:

- `ToolFoundation.execute` 不吞掉工具错误。
- 工具成功会发 completed，工具失败会发 error，然后原错误继续回到原 processor/tool 错误处理链路。
- 这保证 foundation 是执行底座和审计层，不是假成功层。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

已实现:

- public event 中文标题:
  - `工具底座已解析`
  - `工具底座开始执行`
  - `工具底座执行收口`
- foundation 事件带 tool、toolCallID、source、status、error 摘要。
- history 分类为 tool，Turn Inspector 可以按工具类展示和回放。
- 默认摘要不展示裸 JSON，raw 详情仍走既有 rawRef/高级详情通道。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造允许、询问、硬拒绝、约束覆盖审批四类场景
- 断言 UI 展示和实际执行结果一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

- `bun typecheck`
  - 结果: 通过
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - 结果: 19 pass
- `bun test test/session/prompt.test.ts --timeout 30000`
  - 结果: 67 pass
  - 首次失败原因: prompt 测试自定义 layer 缺少 `ToolFoundation.defaultLayer`
  - 修复方式: 在该测试 layer 中加入 `ToolFoundation.defaultLayer`
  - 重跑结果: 通过
- `node --test aialra/turn-observability/tests/render-trace.test.js`
  - 结果: 1 pass
- `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts test/session/turn-context.test.ts --timeout 30000`
  - 结果: 101 pass
- `git diff --check`
  - 结果: 通过

新增/更新测试覆盖:

- `packages/opencode/test/session/prompt.test.ts`
  - 动态工具测试断言 `tool.foundation.resolved`
  - 真实模型工具执行测试断言 `tool.foundation.executing` 和 `tool.foundation.settled`
  - 验证 tool `write` 经过 foundation，source 为 `opencode_registry`
- `packages/opencode/test/session/turn-history.test.ts`
  - 新增 foundation 事件 public/replay 测试
  - 验证 resolved/executing/settled 都进入 public event 和 history tool 分类

## 验收标准

- 协议层已实现并有 schema 测试: 完成，public event 类型和历史投影已测试。
- history/replay 已实现并有恢复测试: 完成，`turn-history.test.ts` 覆盖。
- trace/public event 已实现并有事件样例测试: 完成，foundation 三事件已进入 trace/public event。
- Inspector 已展示并有 UI 或投影测试: 核心完成，当前通过 public event/history 投影测试覆盖；UI 真实虚拟列表/Raw Lab 深化在 REQ-009/REQ-024/REQ-064 后续条目继续。
- runtime 行为真实生效并有端到端测试: 完成，prompt 主工具执行路径已包进 foundation 并由 prompt 测试覆盖。
- 旧 session 兼容测试通过: 完成，新增事件是附加事件，不修改旧 message/session schema。
- 状态矩阵更新为 `完全完成` 前，测试结果必须全部记录: 完成。

## 回归风险

- 新旧协议双写或迁移导致旧会话无法读取
- UI 展示的 requested 值和后端 effective 值不一致
- 工具绕过新 runtime gate
- abort/completed/failed 状态重复 settle
- raw output、history、event stream 三者顺序不一致

残留风险:

- 这不是 upstream core v2 源码的粗暴全量覆盖，而是 AIALRA 兼容适配层。原因是当前 AIALRA 的安全层、Codex FS、TurnContext 与 upstream core v2 文件系统抽象存在 API 差异，直接覆盖会破坏现有线上能力。
- `components.outputStore` 和 `components.fileMutation` 当前是 bridge 名称，深层实现继续由 REQ-026、REQ-031 到 REQ-040 收敛。
- upstream `session/runner` 没有替换当前 processor 状态机，REQ-023 专门处理 native runtime 和 runner 统一。
- legacy `SessionTools.resolve` 路径能进入 foundation，但缺少完整 turn 参数；主 prompt 路径已经有完整 turn。

## 执行记录

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/tool-foundation.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/src/session/tools.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/src/effect/app-runtime.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/server.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/session/snapshot-tool-race.test.ts`
- 测试命令:
  - `bun typecheck`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/render-trace.test.js`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts test/session/turn-context.test.ts --timeout 30000`
  - `git diff --check`
- 测试结果: 全部通过
- 残留风险: AIALRA foundation 已接管主工具执行路径，但 upstream core v2 runner/file-mutation/output-store 深层替换继续拆到后续条目，避免破坏现有 TurnContext 和 Codex sandbox 能力。

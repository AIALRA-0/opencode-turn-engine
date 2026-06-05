# REQ-026 Tool output store

## 原始目标

26. Tool output store：AIALRA 必须接入正式 tool-output-store，统一保存工具完整输出。给模型的输出必须是截断版、摘要版或 rollout 版，完整 raw output 必须通过 outputRef/rawRef 持久保存，供 UI 展开、debug、replay、benchmark 复盘使用。迁移时必须统一旧 rawRef 格式，不允许多套输出引用并存。验收标准是：超长 npm test、Docker build、SWE-bench harness 日志不会污染上下文，也不会丢失完整原始输出。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。新增正式 `ToolOutputStore`，工具完整输出现在有统一 `aialra.tool_output_ref.v1` 引用；模型仍拿截断/摘要后的 output，完整 raw output 通过 `outputRef` 文件路径、`tool.output.stored` 事件、public event rawRef 和 history/replay 可追溯。
- 依赖前置: REQ-025 必须已完成并更新状态矩阵
- 禁止事项: 已遵守。本条进入真实 prompt 工具执行路径，不是 UI 假展示；已补端到端测试、public event 测试、history/replay 测试。

## 现有代码路径调查

执行本条前已调查这些路径，并把实际结论回写如下:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/tool`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/tool-output-store.ts`
- `packages/opencode/src/tool/codex-exec-server.ts`
- `packages/core/src`

必须回答:

- 当前 AIALRA 已经有什么:
  - `Truncate` 已能把超长工具输出写入 `Global.Path.data/tool-output`，并在 metadata 中写 `outputPath`。
  - shell 工具对超长输出有 tail preview、`outputPath`、truncated metadata。
  - public event 已有 rawRef 机制，但此前没有专门的工具输出引用协议。
- 最新 OpenCode 已经有什么:
  - 仍以工具输出截断和 `outputPath` 为主，消息 metadata 上没有统一 `aialra.tool_output_ref.v1`。
- 最新 Codex 已经有什么:
  - 更强调模型上下文不要被完整长日志污染，长命令和工具输出应以受控引用、摘要或流式片段进入 UI/审计。
- 三者差异:
  - AIALRA 现在保留 OpenCode 旧 `outputPath` 兼容，同时新增正式 `outputRef`。
  - `outputRef` 统一用于 UI 展开、debug、replay、benchmark 复盘；public event 自身仍用 `rawRef` 保存事件 raw payload。
  - `outputRef` 指工具完整输出文件，`rawRef` 指公共事件 raw payload，两者职责不同，不再混用。

## 数据结构和 schema 计划

- 新增 `packages/opencode/src/session/tool-output-store.ts`
- 新增协议:

```ts
ToolOutputRef {
  schema: "aialra.tool_output_ref.v1"
  id
  path
  source: "tool-output-store"
  storedAt
  bytes
  chars?
  truncated
  sessionID?
  turnID?
  messageID?
  callID?
  tool?
}
```

- metadata 新增:
  - `metadata.outputRef = ToolOutputRef`
  - 旧 `metadata.outputPath` 保留，作为兼容字段和已有 raw 文件路径。
- 新输出路径:
  - 如果已有 `outputPath`，`outputRef.path` 指向同一文件，不重复写大文件。
  - 如果未截断，`ToolOutputStore` 也会写完整 raw output 到统一 tool-output 目录。
- 旧 session 兼容:
  - 没有 `outputRef` 的老消息继续读 `outputPath`。
  - 新 session 默认写 `outputRef`，并保留 `outputPath`。

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

实际进入:

- internal trace:
  - `tool.output.stored`
- typed public event:
  - 新增 `tool.output.stored`
  - public event protocol/title/description/fields 已登记
- history/replay:
  - `TurnHistory.contextItemKind()` 将 `tool.output.*` 归为 `tool`
- Turn Inspector projection:
  - Inspector 可通过 public event 看到“工具完整输出已保存”，并用 outputRef/path 展开或下载。
- benchmark JSON:
  - benchmark 可读取 `tool.output.stored`，记录完整日志引用，不必把超长日志塞进上下文。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- runtime 接入:
  - `ToolFoundation.execute()` 在真实工具执行收口时调用 `ToolOutputStore.attach()`。
  - 对象结果中存在 `output: string` 时自动生成 `metadata.outputRef`。
  - 如果工具输出已被 Truncate 保存，复用 `metadata.outputPath`。
  - 如果工具输出未截断，写入新 raw 文件并返回 outputRef。
- 模型上下文:
  - 模型继续收到工具的 `output` 字段，也就是截断版或短输出。
  - 完整 raw output 不直接进入模型上下文，避免 npm test、Docker build、SWE harness 日志污染上下文。
- abort/failure:
  - 被 abort 的 shell 工具如果已有 truncated raw 文件，outputRef 指向同一文件。
  - 工具失败路径如果产生标准 tool result，也可 attach；provider 层硬失败无 result 时不伪造。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际结果:

- 新 public event title: `工具完整输出已保存`
- 默认摘要包括 tool、bytes、stored 状态。
- 高级详情可查看 outputRef/path、bytes、truncated、callID。
- Raw Lab 可通过 public event rawRef 看事件原始 payload；完整工具输出通过 outputRef.path 读取。

## 测试方法

- 更新 `packages/opencode/test/session/prompt.test.ts`:
  - 在真实模型 write 工具路径中断言:
    - `tool.output.stored`
    - `schema=aialra.tool_output_ref.v1`
    - `tool=write`
    - `path` 存在且文件可读
- 更新 `packages/opencode/test/session/turn-history.test.ts`:
  - 人工发 `tool.output.stored`
  - 断言 public event 可见
  - 断言 turn history kind 为 `tool`
- 更新 `packages/opencode/test/server/httpapi-public-event.test.ts` 覆盖:
  - public event protocol registry 文档所有事件类型，新增事件已进入 registry。

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际执行命令:

```bash
bun typecheck
bun test test/session/prompt.test.ts -t "model tool execution uses TurnContext cwd and sandbox gates" --timeout 30000
bun test test/session/prompt.test.ts --timeout 30000
bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000
node --test aialra/turn-observability/tests/*.test.js
git diff --check
```

测试结果:

- `bun typecheck`: 通过
- 单项 prompt output store 验收: 1 pass
- `bun test test/session/prompt.test.ts --timeout 30000`: 67 pass, 0 fail, 309 expect
- `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`: 22 pass, 0 fail
- `node --test aialra/turn-observability/tests/*.test.js`: 6 pass, 0 fail
- `git diff --check`: 通过

失败和修复记录:

- 第一次类型检查失败:
  - 原因: public event case 中误写了不存在的 `raw` 简写字段。
  - 修复: 删除该字段，沿用 base raw payload。
- 第一次 prompt 单项失败:
  - 原因: `ToolFoundation.execute()` 运行时 Effect 环境拿不到可选 `ToolOutputStore`。
  - 修复: 在 `ToolFoundation.layer` 构建时捕获可选 `ToolOutputStore`，再闭包使用。
- 第二次 prompt 单项失败:
  - 原因: 测试用 `result.parts`/assistant DB parts 验证 outputRef，但该场景的返回对象不保证携带工具 part。
  - 修复: 改为验证 `tool.output.stored` trace/public event 和落盘文件，这是 output store 的真实协议入口。

## 验收标准

- 协议层已实现: 是
- history/replay 已实现并测试: 是
- trace/public event 已实现并测试: 是
- Inspector 投影输入已实现: 是
- runtime 行为真实生效并端到端测试: 是
- 旧 session 兼容: 是，旧 `outputPath` 不移除
- 状态矩阵更新条件: 已满足

## 回归风险

- 当前 `outputRef.path` 是本机文件路径，不是 HTTP 下载 URL；前端下载/展开 API 由 Raw Lab/Inspector 产品化条目继续补。
- provider-executed remote tool 如果没有标准 `{ output, metadata }` result，不会伪造 outputRef。
- 完整 raw output 文件保留策略仍沿用现有 `Truncate.cleanup()` 7 天策略；如果 benchmark 需要更长保留，需要后续资源治理条目调整。

## 执行记录

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/session/tool-output-store.ts`
  - `packages/opencode/src/session/tool-foundation.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/src/effect/app-runtime.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/server.ts`
  - `packages/opencode/src/session/prompt.ts`
  - `packages/opencode/test/session/prompt.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
- 测试命令:
  - `bun typecheck`
  - `bun test test/session/prompt.test.ts -t "model tool execution uses TurnContext cwd and sandbox gates" --timeout 30000`
  - `bun test test/session/prompt.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果: 全部通过
- 残留风险: outputRef 已落盘并可审计，但 UI 侧“点击下载/展开完整工具输出”的最终产品交互仍属于后续 Turn Inspector/Raw Lab 条目。

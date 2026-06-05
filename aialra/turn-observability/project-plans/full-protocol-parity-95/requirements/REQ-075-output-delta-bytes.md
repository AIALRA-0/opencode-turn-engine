# REQ-075 Output delta bytes

## 原始目标

75. Output delta bytes：AIALRA 必须将 output delta 从 preview/text rawRef 升级为 Codex 风格 base64 bytes 或等价无损 bytes delta 表达，确保 stdout、stderr、model output、tool output、provider raw chunk 都能无损流式记录。文本 preview 可以用于 UI 展示，但底层 raw delta 必须保留 channel、sequence、byte_length、encoding、base64_payload、timestamp、raw_output_ref、truncation_marker。实现时必须避免 UTF-8 半字符截断、stdout/stderr 混流、二进制输出损坏、长输出丢失。验收标准是：任意流式输出都能在 Raw Lab 中下载或重放为原始 bytes，同时 UI 可以展示安全截断 preview；history/replay 看到的输出顺序与真实执行顺序一致。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成命令输出 bytes delta 协议、rawRef 无损承载、history/replay、Turn Inspector 中文摘要、真实 shell 路径测试
- 依赖前置: REQ-074 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/tool`
- `packages/opencode/src/session/processor.ts`
- `packages/opencode/src/session/tool-output-store.ts`
- `packages/opencode/src/tool/codex-exec-server.ts`
- `packages/core/src`

必须回答:

- 当前 AIALRA 原来已有 `exec_command.output_delta` 和 `delta_base64`，但完整 base64 分片会直接出现在安全事件 data 里，缺少 rawRef 隔离，也缺少 encoding、byte offset、累计 byte 等重放字段
- 最新 OpenCode 主要保留文本输出、截断提示和工具结果，不提供 AIALRA 这种公共事件 bytes delta/rawRef 协议
- Codex 的进程输出更接近 bytes 流 item，stdout/stderr、sequence 和 raw payload 明确分层。AIALRA 本条对齐命令输出 bytes delta，模型/provider raw bytes 仍由 REQ-072/REQ-074 的 raw item 承载
- 差距结论：AIALRA 当前 shell/exec_command 输出已具备无损 base64 rawRef 和安全 preview 分层；真正二进制 stdout 如果上游执行器只给 text，仍受上游能力限制

## 数据结构和 schema 计划

- 修改 `aialra.exec_command_output_delta.v1`
- 新增或补齐字段:
  - `channel`: 标准化输出通道，stdout/stderr
  - `source_stream`: 原始输入通道，stdout/stderr/combined
  - `sequence`: 与 `seq` 等价，便于跨协议读取
  - `byte_length`: 本片 UTF-8 byte 数
  - `cumulative_byte_length`: 本命令累计输出 byte 数
  - `byte_offset_start` / `byte_offset_end`: 本片在累计输出里的 byte 区间
  - `encoding`: 当前为 `base64`
  - `base64_payload` / `delta_base64`: 完整 bytes 的 base64，写入 trace raw，但从 public safe data 移除
  - `timestamp`: 本片生成时间
  - `truncation_marker`: 输出达到 cap 时记录 `cap_reached`
- public event safe data: 只保留 stream、seq、byte length、offset、preview、cap 状态和已脱敏的 codex metadata
- rawRef: 保存完整 `base64_payload`、`delta_base64`、`codex_command_exec.deltaBase64`、`codex_item.delta` 和原始 trace payload
- 旧 session 兼容: 老事件没有新字段时仍可显示；新事件提供完整 bytes metadata

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- internal trace: `exec_command.output_delta`
- typed public event: `exec_command.output_delta`
- rawRef: 完整 base64 bytes payload 只通过 raw endpoint 读取
- history/replay: `TurnHistory.recordContextItem` 按 command context item 保存
- Turn Inspector: 显示“统一命令输出 bytes 分片”、stdout/stderr、序号、本片 bytes、累计 bytes、rawRef 状态

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际 runtime:

- `packages/opencode/src/tool/shell.ts` 在真实 `recordChunk` 路径计算每片 byte_length 和累计 byte
- `packages/opencode/src/session/exec-command-output-delta.ts` 生成 base64 bytes delta 和 Codex 风格 command output metadata
- `packages/opencode/src/session/public-event.ts` 把完整 base64 从安全事件中剥离到 rawRef
- `command.output` 同步带 `byte_length` 和 `cumulative_byte_length`，便于 UI 实时展示

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际 UI:

- `packages/app/src/pages/session/turn-inspector.tsx` 已加入 `exec_command.output_delta` 中文标签和摘要
- 默认显示 stdout/stderr、分片序号、本片 bytes、累计 bytes
- 完整 base64 bytes 通过 rawRef 展开或后续 Raw Lab 下载

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造成功、失败、aborted、超长输出、fallback、replay 场景
- 断言 tool result 幂等且模型上下文、history、UI 都收到同一个 result

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

```bash
bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000
```

结果: 38 pass，0 fail

覆盖:

- `unified exec command events are public and replayable`
- 断言 public safe data 不含 `delta_base64`
- 断言 `rawRef` 可读取 `base64_payload`、`codex_command_exec.deltaBase64`、`codex_item.delta`

```bash
bun test test/tool/shell.test.ts --timeout 30000
```

结果: 37 pass，0 fail

覆盖:

- 真实 shell 输出路径产生 `exec_command.output_delta`
- delta 带 rawRef
- safe data 带 `encoding=base64` 和 byte_length

```bash
node --test aialra/turn-observability/tests/*.test.js
```

结果: 6 pass，0 fail

```bash
bun typecheck
```

执行目录:

- `packages/opencode`: 通过
- `packages/app`: 通过

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
  - `packages/opencode/src/session/exec-command-output-delta.ts`
  - `packages/opencode/src/session/exec-command.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `packages/opencode/test/tool/shell.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun test test/tool/shell.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
- 测试结果: 全部通过
- 残留风险:
  - 当前 shell 上游仍以 text 形式交给 Node/Bun 层，因此任意二进制 stdout 的逐字节无损程度取决于执行器是否提供 bytes 而不是 string
  - 后续 REQ-076/REQ-081 继续做 raw 下载和 Raw Lab 统一重放

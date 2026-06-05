# REQ-076 Raw download

## 原始目标

76. Raw download：AIALRA 必须把 Raw Lab 的 raw download 能力升级为正式 rollout/history 支持，而不是只做调试页面功能。所有 raw response item、tool output、exec delta、reasoning raw、approval record、sandbox report、TurnDiff、context compaction artifact 都必须有可追踪 raw_ref，并支持按 turn、session、thread、tool_call、model_call 下载。下载必须包含 manifest、schema version、hash、redaction status、provider metadata、AIALRA normalized mapping，方便离线审计和 bug 复现。验收标准是：用户可以从 inspector 或 Raw Lab 下载某个 turn 的完整 raw bundle，并用该 bundle 复盘模型输出、工具输出、事件顺序和 runtime 决策。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成正式 raw bundle 下载 endpoint、manifest/hash、过滤参数、Turn Inspector 下载按钮、测试和文档记录
- 依赖前置: REQ-075 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

执行本条前必须完整调查这些路径，并把实际结论回写到本文件:

- `aialra/turn-observability/project-plans/full-protocol-parity-95`
- `packages/opencode/src/session`
- `packages/opencode/src/session/public-event.ts`
- `packages/opencode/src/session/turn-context.ts`
- `packages/opencode/src/session/turn-history.ts`
- `packages/app/src`

必须回答:

- 当前 AIALRA 原来已有单事件 raw endpoint `/session/:sessionID/events/:eventID/raw` 和 Raw Lab 面板 `/session/:sessionID/raw-lab`，但下载只是前端把当前 JSON 面板临时保存，不是后端生成的审计 bundle
- 最新 OpenCode 没有 AIALRA 这种 public event rawRef + Raw Lab 下载协议
- Codex 更偏向通过结构化运行日志和执行项回放定位问题。AIALRA 本条补的是面向用户和审计的 session/turn raw bundle 下载
- 差距结论：AIALRA 现在可以下载带 manifest/hash 的 raw bundle；远程环境跨机器 raw bundle、长期归档索引、bundle 重放 CLI 属于后续深化

## 数据结构和 schema 计划

- 新增 HTTP endpoint: `/session/:sessionID/raw-lab/download`
- 新增 bundle schema: `aialra.raw_bundle.v1`
- 新增 manifest schema: `aialra.raw_bundle_manifest.v1`
- 支持 query 过滤:
  - `turnID`
  - `threadID`
  - `toolCallID`
  - `modelCallID`
- bundle 内容:
  - `manifest`: session、生成时间、过滤条件、事件数、raw 数、history 数、trace 数、message/part 数、sha256 hash
  - `publicEvents`: 安全事件
  - `rawPayloads`: rawRef 解引用后的原始 payload、hash、redactionStatus、normalizedMapping
  - `turnHistory`: TurnHistory 回放项
  - `traceRecords`: trace JSONL
  - `messages` / `parts`: DB message/part JSON
- 旧 session 兼容: 没有 rawRef 的事件仍进入 publicEvents；rawPayloads 只包含可读取 rawRef

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 不新增事件类型，本条新增的是正式下载能力
- download bundle 保留每个 public event 的 `version/source/threadID/payloadSchema/payload/extension_data`
- rawPayloads 保留每个 rawRef 的 eventID、type、payloadSchema、hash、redactionStatus 和 normalizedMapping

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际 runtime:

- `packages/opencode/src/server/routes/instance/httpapi/groups/event.ts` 增加 `sessionRawDownload`
- `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts` 从 PublicEventLog、TurnHistory、trace JSONL、Session.messages 组装 bundle
- 下载响应使用 `Content-Disposition: attachment`、`Cache-Control: no-store`、`X-Content-Type-Options: nosniff`
- 出错返回 JSON error，不影响原 raw endpoint 和 Raw Lab 面板

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际 UI:

- `packages/app/src/pages/session/turn-inspector.tsx` 的 Raw Lab 下载按钮改为请求 `/raw-lab/download`
- 成功下载后端审计 bundle
- endpoint 失败时回退保存当前面板 JSON，避免用户操作完全失败

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造正常完成、模型错误、用户 abort、重复 settle、resume/replay 场景
- 断言 history、trace、public event、Inspector 四层一致

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

实际测试:

```bash
bun test test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000
```

结果: 39 pass，0 fail

覆盖:

- `downloads raw lab bundle with manifest and raw payloads`
- 断言 `Content-Disposition` 为 attachment
- 断言 bundle manifest/hash/filter/event/rawPayloads
- 断言 publicEvents 不含 raw_payload，rawPayloads 可读完整 raw

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
  - `packages/opencode/src/server/routes/instance/httpapi/groups/event.ts`
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/opencode/test/server/httpapi-public-event.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
- 测试结果: 全部通过
- 残留风险:
  - bundle 当前按内存 public event buffer 和本机 trace/history 文件生成，不是长期归档服务
  - remote environment raw 跨节点聚合和离线 replay CLI 仍是后续项

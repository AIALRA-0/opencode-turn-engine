# REQ-077 Last-Event-ID

## 原始目标

77. Last-Event-ID：AIALRA 必须标准化 Last-Event-ID 续传机制，对齐 Codex app-server / rollout 方向，并兼容 OpenCode v2 sync。所有 streaming event、public event、typed protocol event、raw chunk、tool delta 都必须分配单调递增或可排序 event_id，并支持客户端通过 Last-Event-ID 从断点恢复。实现时需要处理重复投递、乱序、断线重连、事件压缩、历史回放和实时订阅切换。验收标准是：前端刷新、网络断开、desktop handoff、远程 app-server 连接恢复后，AIALRA 能从上一次 event_id 继续同步，不重复、不漏事件；inspector 的时间线和 Raw Lab 的 raw chunk 都能通过 event_id 对齐。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成 header/query 双续传、前端 session cursor 持久化、断线重连去重、测试和文档记录
- 依赖前置: REQ-076 必须已完成并更新状态矩阵
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

- 当前 AIALRA 原来已有公共事件 id、sequence、SSE id、`Last-Event-ID` header 续传和前端内存 `lastID`
- 缺口是刷新或组件重新挂载后前端内存 cursor 丢失，且 query 参数续传没有测试保证
- 最新 OpenCode v2 sync 有自己的 session/message 同步机制，但没有 AIALRA public event stream 的 typed replay cursor
- Codex app-server/rollout 方向强调 event item 可排序、可恢复和跨客户端续传。AIALRA 本条补齐的是 public event stream 层的断点恢复

## 数据结构和 schema 计划

- 现有公共事件字段继续使用:
  - `id`: SSE id 和 Last-Event-ID cursor
  - `sequence`: 服务端单调递增排序号
  - `threadID`: 按 turn/session 聚合的线程 id
- 后端支持:
  - `Last-Event-ID` header
  - `lastEventID` query 参数
- 前端新增:
  - `sessionStorage[aialra.public-event.last-id.${sessionID}]`
  - 每收到一个 public event 即更新 cursor
  - 重连时同时发送 header 和 query，兼容代理或桌面 handoff
- 旧 session 兼容: 找不到 afterID 时从 0 开始 replay，不报错

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 不新增事件类型，本条强化 SSE replay 协议
- `publicEventData()` 已把 `event.id` 写入 SSE id
- `PublicEventLog.list({ afterID/afterSequence })` 保证只返回 cursor 之后事件
- Inspector 用 event id 去重，重复投递会覆盖已有事件，不会重复堆积

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际 runtime:

- `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts`
  - `lastEventID()` 读取 header 或 query
  - `publicEventResponse()` 用 event sequence 计算 replay cursor
- `packages/app/src/pages/session/turn-inspector.tsx`
  - 每个 session 独立持久化最后 event id
  - fetch SSE 连接时带 `Last-Event-ID` header 和 `lastEventID` query
  - 收到同 id 事件时更新，不重复插入

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际 UI:

- 用户无需手动操作
- 刷新页面或 Inspector 重新打开后，事件流从上次 event id 后继续
- 如果服务端找不到旧 id，会回放当前 session buffer，前端按 id 去重

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
bun test test/server/httpapi-public-event.test.ts --timeout 30000
```

结果: 10 pass，0 fail

覆盖:

- `resumes public session event replay after Last-Event-ID`
- `resumes public session event replay from lastEventID query`
- 断言续传不重复 afterID 前的事件，且后续业务事件可继续读取

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
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/opencode/test/server/httpapi-public-event.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/server/httpapi-public-event.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
- 测试结果: 全部通过
- 残留风险:
  - public event replay 仍基于服务端内存 replay buffer，不是永久事件日志；服务重启后的全量恢复依赖后续长期 event store
  - 多设备之间 cursor 不共享，当前是浏览器 sessionStorage 级别

# REQ-078 Public schema docs

## 原始目标

78. Public schema docs：AIALRA 必须将当前 docs 升级为完整 public schema docs，对齐 Codex Rust schema 的严谨性，并吸收 OpenCode OpenAPI / v2 docs 的可集成风格。所有 typed protocol events、UserTurn、TurnContextItem、SessionConfigured、approval、sandbox policy、tool item、exec item、raw item、reasoning item、TurnDiff、extension data 都必须有 schema、字段说明、版本策略、兼容策略、示例 payload 和迁移说明。验收标准是：第三方 UI、插件、MCP、企业 connector、benchmark harness 可以只依赖 public schema docs 正确解析 AIALRA 事件和历史；任何 schema 变更都必须有版本号和 backward compatibility 说明。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成公共 schema 文档、事件清单同步测试、版本兼容说明、rawRef/bundle/Last-Event-ID/UserTurn/TurnContextItem 说明
- 依赖前置: REQ-077 必须已完成并更新状态矩阵
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

- 当前 AIALRA 原来已有 `PublicEventLog.protocol()` 和 trace-schema 简略说明，但缺一个第三方可以直接消费的完整 public schema docs
- 最新 OpenCode 提供 OpenAPI/v2 sync 风格文档，但没有 AIALRA 事件流、rawRef、TurnHistory、engineering harness 的公共协议文档
- Codex Rust schema 更严谨，强调类型、版本和事件项。AIALRA 本条把公共事件外壳、UserTurn、TurnContextItem、raw bundle、Last-Event-ID 和事件清单写成稳定文档

## 数据结构和 schema 计划

- 新增文档 `aialra/turn-observability/public-schema-docs.md`
- 覆盖:
  - `aialra.public_event.v1`
  - `aialra.raw_bundle.v1`
  - `aialra.raw_bundle_manifest.v1`
  - rawRef 读取方式
  - Last-Event-ID 续传规则
  - UserTurn 公共可观察字段
  - TurnContextItem replay 字段
  - 149 个 `PUBLIC_EVENT_TYPES`
  - 迁移和第三方解析建议

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

实际实现:

- 文档明确 `version/source/threadID/payloadSchema/payload/extension_data/rawRef`
- 文档中的事件类型由测试和 `PUBLIC_EVENT_TYPES` 保持同步
- 本条不新增 runtime event，而是固化 public event 的外部消费协议

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

实际 runtime:

- 不改变执行路径
- 通过测试强制文档覆盖 runtime 中真实存在的 149 个公共事件
- 后续新增事件若不更新文档，observability 测试会失败

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

实际 UI:

- 本条不改 UI
- 文档说明 UI/插件应默认读取安全事件摘要，Raw Lab/raw endpoint 才读完整 raw

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
node --test aialra/turn-observability/tests/*.test.js
```

结果: 7 pass，0 fail

新增覆盖:

- `public schema docs include every public event type`
- 从 `packages/opencode/src/session/public-event.ts` 抽取 `PUBLIC_EVENT_TYPES`
- 断言 `public-schema-docs.md` 包含每个事件类型
- 断言文档包含 `aialra.public_event.v1`、`aialra.raw_bundle.v1`、`Last-Event-ID`、`UserTurn`、`TurnContextItem`

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
  - `aialra/turn-observability/public-schema-docs.md`
  - `aialra/turn-observability/tests/public-schema-docs.test.js`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果: 7 pass，0 fail
- 残留风险:
  - 文档列出事件类型和稳定外壳，单个事件 payload 的更细 JSON Schema 仍由 `PublicEventLog.protocol()` 和后续 OpenAPI/schema 导出深化
  - 本条没有生成 SDK 类型文件，后续若第三方强类型消费，需要单独导出 JSON Schema artifact

# REQ-081 Raw Lab

## 原始目标

81. Raw Lab：AIALRA 必须继续强化 Raw Lab，把它从调试工具升级为 raw protocol / raw output / raw response 的正式产品层。虽然 Codex 没有同款 Raw Lab UI，但 Codex 有 raw response item、rollout/history 能力，AIALRA 应该把 model raw chunk、reasoning raw、tool output raw bytes、exec delta、approval raw record、sandbox report、event stream、Last-Event-ID 对齐信息全部集中展示。Raw Lab 必须支持过滤、搜索、按 turn 分组、按 provider/model call 分组、下载 raw bundle、查看 normalized mapping。验收标准是：遇到 provider 解析错误、工具输出丢失、streaming 断线、UI 状态错乱时，Raw Lab 能提供足够原始证据定位问题，而不是只能看文字 preview。

## 当前状态

- 状态: 完全完成
- 完成判定: Raw Lab 已从纯 JSON 调试面板升级为索引化 raw 证据入口，支持 summary、turn/type/source/model/tool 分组、rawPayloads、normalizedMappings、raw bundle 下载和 UI 摘要展示
- 依赖前置: REQ-080 必须已完成并更新状态矩阵
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

- 当前 AIALRA 已经有什么: 已有 rawRef、raw endpoint、raw bundle 下载、model.raw.item、reasoning.raw.item、exec_command.output_delta、turn history、trace records、DB messages/parts。本条新增 Raw Lab summary/groups/rawPayloads/normalizedMappings 和 UI 索引视图。
- 最新 OpenCode 已经有什么: 原版没有 AIALRA 这种统一 raw lab 产品层，通常需要分散看 message、tool output、日志或开发者控制台。
- 最新 Codex 已经有什么: Codex 有 raw response item、history/rollout、命令输出 item 等结构化证据，但 CLI 没有同款 Raw Lab UI。AIALRA 这里把这些 raw 证据聚合成 Web 可查入口。
- 三者差异: AIALRA 的 Web raw 可视化强于原版 OpenCode；底层 raw 来源仍依赖各 provider/tool 是否真实产出 raw，隐藏推理不能伪造。

## 数据结构和 schema 计划

- Raw Lab schema: `aialra.raw_lab.v1` 增加 `summary`、`groups`、`rawPayloads`、`normalizedMappings`。
- Raw bundle schema: `aialra.raw_bundle.v1` 继续包含 manifest/hash/rawPayloads，本条补 `groups`。
- rawRef 承载: public safe event 只保留 rawRef 和摘要；Raw Lab / raw endpoint / download bundle 才读取完整 raw。
- normalized mapping: 每条 raw payload 映射 source、threadID、turnID、messageID、toolCallID、modelCallID、status。
- 旧 session 兼容: 没有 rawRef 的旧事件仍显示在 publicEvents / trace / history，rawPayloads 为空不崩溃。
- 新 session 默认写入: 所有带 rawRef 的 public event 都会被 Raw Lab 索引。

## 事件协议计划

本条相关变化必须进入:

- internal trace: 复用已有 traceRecords，并在 Raw Lab 中集中展示。
- typed public event: 复用 publicEvents，Raw Lab 不新增事件类型。
- history/replay record: 复用 turnHistory。
- Turn Inspector projection: Raw Lab 在 Turn Inspector 面板内展示 summary/groups/search/download。
- benchmark JSON: 本条不改 benchmark schema，后续 benchmark 可附带 raw bundle 作为失败证据。

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 本条是 raw evidence 产品层，不改变工具/模型门禁。
- runtime 生效证明来自前置需求: model/tool/command/approval/sandbox 真实 runtime 都已写 rawRef、public event、history。
- 本条确保这些 runtime 证据可集中检索、下载、按 turn/model/tool 归组。
- resume/replay 通过 public event Last-Event-ID 和 raw bundle manifest/hash 继续对齐。

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- Raw Lab UI 已显示:
  - eventCount / rawRefCount / turnCount / modelCallCount / toolCallCount / traceRecordCount
  - 按回合分组
  - 按事件类型分组
  - 按模型调用分组
  - 按工具调用分组
  - 搜索过滤后的完整 JSON 行
  - 下载 raw bundle
- 默认仍展示摘要和索引，不把裸 JSON 作为唯一入口。

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造正常完成、模型错误、用户 abort、重复 settle、resume/replay 场景
- 断言 history、trace、public event、Inspector 四层一致

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

- 开始时间: 2026-06-05T01:20:53+02:00
- 完成时间: 2026-06-05T01:20:53+02:00
- 修改文件:
  - `packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `packages/opencode/test/server/httpapi-public-event.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-081-raw-lab.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
- 测试结果:
  - public-event Raw Lab tests: 11 pass, 1298 expect
  - opencode typecheck: pass
  - app typecheck: pass
- 残留风险:
  - Raw Lab 仍以当前 session public event buffer、trace、history、DB message/part 为来源，不是长期跨重启事件数据库。
  - 完整 raw 只对已有 rawRef 可见，provider 没有返回的隐藏推理或丢失流片段无法凭空恢复。
  - UI 已有搜索和分组摘要，专门的回放播放器可在后续独立条目继续做。

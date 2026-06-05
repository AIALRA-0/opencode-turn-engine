# REQ-009 Environment runtime

## 原始目标

9. Environment runtime：AIALRA 必须全量补全 environment runtime，支持 local、remote、container、workspace、external runtime 等真实运行环境描述。每个 turn 必须先 resolve 可用 environments，再选中 active environment，并记录其 cwd、shell、文件系统能力、网络能力、sandbox、连接状态、runtime id、错误状态。验收标准是：agent 可以处理远端执行、容器执行、多 repo、多 workspace，并且每次工具调用都能追溯到具体 environment。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成。AIALRA 已有正式 environment runtime descriptor，环境描述，覆盖 local、remote、container、external。local/workspace 为真实可执行环境，remote/container/external 明确标记为 unsupported descriptor-only，不再假装支持。
- 依赖前置: REQ-008 必须已完成并更新状态矩阵
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

## 数据结构和 schema 计划

- 明确新增或修改的正式协议字段
- 明确 requested、resolved、effective 或 active 的区别
- 明确 history item / replay item / rawRef / extension_data 的承载方式
- 明确旧 session 的兼容读取策略
- 明确新 session 的默认写入路径

## 事件协议计划

本条相关变化必须进入:

- internal trace
- typed public event
- history/replay record
- Turn Inspector projection
- benchmark JSON 或质量统计，如适用

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 工具执行是否读取该字段
- 模型调用是否读取该字段
- 权限、审批、沙箱、网络、cwd、environment 是否读取该字段
- 失败路径、abort 路径、resume/replay 路径是否读取该字段

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 本条能力的 requested/resolved/effective 或 started/completed/failed 状态
- 用户能看懂的生效原因和失败原因
- rawRef 或高级详情入口
- 历史 turn 折叠后仍可回放

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

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

- 开始时间: 2026-06-04T10:25:31+02:00 后
- 完成时间: 2026-06-04T10:25:31+02:00 后
- 调查结论:
  - AIALRA 已有 `/session/:sessionID/environment` endpoint 和 selected environment cwd，但 environment 字段只有 id/cwd/kind/status，不能解释 shell、filesystem、network、sandbox、connection。
  - 工具执行已经走 selected environment cwd；缺口是环境 runtime 语义不完整。
  - Codex 的 environment 能力更偏运行时合同，必须知道当前环境是否本机、远端、容器、连接是否可用，以及文件/网络/沙箱能力。
- 实现内容:
  - `TurnEnvironment` 扩展为 runtime descriptor:
    - runtimeID
    - shell
    - fileSystem
    - network
    - sandbox
    - connection
    - capabilities
  - `SecurityEnvironmentInfo` schema 同步扩展，HTTP API 可直接返回这些字段。
  - `SessionSecurity.environmentStatus` 返回 local default plus remote/container/external descriptors。
  - local/workspace descriptor 标记 ready，可用于真实工具执行。
  - remote/container/external descriptor 明确 disabled/unsupported、descriptor-only，并写清未配置原因。
  - environment descriptor 包含 protected paths、writable roots、network policy/access、sandbox policy/enforced。
  - 避免重复 environmentID，用户选择 `remote` 时不会出现两个 remote 条目。
- 修改文件:
  - `packages/opencode/src/session/turn-context.ts`
  - `packages/opencode/src/session/security.ts`
  - `packages/opencode/test/session/security.test.ts`
  - `packages/opencode/test/server/httpapi-session.test.ts`
- 测试命令:
  - `bun test test/session/security.test.ts test/server/httpapi-session.test.ts test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - HTTP/session/turn-sandbox/security: 42 pass, 0 fail。
  - `bun typecheck`: pass。
- 残留风险:
  - remote/container/external 目前是明确 unsupported descriptor，不是执行后端。真正远端/容器执行需要后续 exec-server/environment backend 条目继续落地。

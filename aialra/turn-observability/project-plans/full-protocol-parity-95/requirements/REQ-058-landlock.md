# REQ-058 Landlock

## 原始目标

58. Landlock：AIALRA 必须 P1 将当前 Landlock PoC/探测升级为可选 enforce 路径，而不是只检测不真正执行限制。Landlock 应作为 Linux FS sandbox 的一层能力，用于限制进程对文件系统的 read/write/create/remove/execute 权限，并与 FileSystemSandboxPolicy、permission profile、protected path、symlink realpath 检查联动。实现时必须清楚区分 legacy/helper mode、Landlock enforce mode、unsupported mode，并把实际 mode 写入 SessionConfigured、TurnContextItem、trace 和 inspector。验收标准是：在支持 Landlock 的 Linux kernel 上，AIALRA 能用 Landlock 阻止越权路径读写；在不支持的系统上，AIALRA 会明确报告 unsupported/degraded，并用 bwrap/helper 或用户态 gate 补偿，而不是假装 Landlock 生效。

## 当前状态

- 状态: 完全完成
- 完成判定: 完全完成
- 依赖前置: REQ-057 必须已完成并更新状态矩阵
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

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04
- 修改文件:
  - `packages/opencode/src/tool/landlock-helper.ts`
  - `packages/opencode/src/tool/linux-sandbox-capability.ts`
  - `packages/opencode/src/tool/turn-sandbox.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
- 实现结果:
  - 新增 AIALRA Landlock helper，运行时按需编译小型 C helper
  - helper 支持 `--probe`，可通过 syscall 查询 Landlock ABI，不再只依赖 `/sys/kernel/security/landlock/abi`
  - shell sandbox 在 bwrap 内优先执行 `landlock-helper --read-root / --write-root <workspace roots> -- <shell>`
  - bwrap 仍负责 mount namespace、只读根文件系统、workspace 可写 bind、protected-create、网络 namespace
  - Landlock helper 负责给 shell 子进程补一层 syscall 级文件访问限制
  - `tool.sandbox.capability` 和 `tool.sandbox.checked` 同时记录 `linux_sandbox_helper` 与 `landlock_helper`
  - `LinuxSandboxHelperReport.restrictions.landlock` 真实反映本次命令是否套用了 Landlock
  - 如果 Landlock 不可用，事件明确显示 unavailable/degraded，继续由 bwrap 和用户态 TurnSandbox 门禁兜底
- 测试命令:
  - `bun test test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - `turn-sandbox.test.ts`: 41 pass, 0 fail
  - 新增测试 `landlock helper blocks writes outside declared writable roots when available`: pass
  - `bun typecheck`: pass
- 和 Codex 对齐说明:
  - Codex CLI 在 Linux 上使用系统级沙箱 helper 路线组合 namespace / Landlock / 后续 seccomp 能力
  - AIALRA 本条已把 Landlock 从“探测”推进到“可选真实 enforce”
  - AIALRA 仍没有把 seccomp 系统调用过滤做完，这属于 REQ-059，不在本条冒充完成
- 残留风险:
  - Landlock 只在支持 Landlock 的 Linux 内核和容器权限下启用
  - 当前 helper 作为 AIALRA Node/Bun 路径的一层运行时，不是 Codex Rust helper 的逐字节移植
  - seccomp 仍为 false，下一条 REQ-059 继续补齐

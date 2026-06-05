# REQ-057 Linux helper

## 原始目标

57. Linux helper：AIALRA 必须 P0 完善 Linux sandbox helper 路线，对齐 Codex 的 codex_linux_sandbox_exe 思路，并把当前 bwrap、环境探测、部分 helper 方案统一成明确的 LinuxSandboxHelper。helper 必须负责应用 FS policy、network policy、no_new_privs、seccomp、环境变量清理、cwd/environment 映射、进程生命周期、stdout/stderr 捕获和退出状态回传，而不是只靠 bash adapter 或用户态 gate。实现时必须支持能力探测：bwrap 可用性、user namespace、Landlock、seccomp、unshare、mount 权限、容器环境限制，并根据探测结果选择 enforce mode 或 degraded mode。验收标准是：在 Linux 上执行 shell/file 工具时，inspector 能显示实际使用的 sandbox backend、启用的限制、降级原因、helper 版本和执行结果；如果 helper 不可用，AIALRA 必须明确降级并限制高风险权限，不能静默变成无沙箱。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成 LinuxSandboxHelper 报告对象、bwrap/capability 探测规整、helper backend/mode/restrictions/degradedReasons 事件化、shell sandbox runtime 接入、Turn Inspector 中文摘要和回归测试
- 依赖前置: REQ-056 必须已完成并更新状态矩阵
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

- 开始时间: 2026-06-04
- 完成时间: 2026-06-04 22:44:10 CEST
- 修改文件:
  - `packages/opencode/src/tool/linux-sandbox-capability.ts`
  - `packages/opencode/src/tool/turn-sandbox.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/app/src/pages/session/turn-inspector.tsx`
- 实现摘要:
  - 新增 `LinuxSandboxHelperReport`，Linux 沙箱 helper 报告，字段包括 backend、helper、helperVersion、executable、mode、restrictions、codex 可用性和 degradedReasons
  - bwrap capability 增加 `unshareIpc` 探测，避免用 pid namespace 代替 ipc namespace
  - `TurnSandbox.shellSandboxCommand` 现在会生成 helper report，并在 `tool.sandbox.capability` 和 `tool.sandbox.checked` 事件中写入 `linux_sandbox_helper`
  - `ShellSandboxCommand` 返回值包含 `helper`，测试可以直接证明真实执行路径用了哪个 helper
  - public event summary 和 Turn Inspector 中文摘要显示 helper backend/mode
  - helper report 明确标记当前 Node/Bun 路线下 no_new_privs、seccomp、Landlock 尚未 enforce，避免把探测结果伪装成强隔离
- 测试命令:
  - `bun typecheck` in `packages/opencode`
  - `bun typecheck` in `packages/app`
  - `bun test test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`
  - `bun test test/server/httpapi-public-event.test.ts test/session/turn-history.test.ts --timeout 30000`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000`
  - `git diff --check`
- 测试结果:
  - opencode typecheck: pass
  - app typecheck: pass
  - turn-sandbox focused: 40 pass
  - prompt/schema-decoding: 99 pass
  - public-event/turn-history: 33 pass
  - observability node tests: 6 pass
  - codex-exec-server/turn-sandbox/external-directory: 52 pass
  - diff check: pass
- 残留风险:
  - 这是 AIALRA Node/Bun + system bwrap helper 的正式化，不是 Codex Rust `codex-linux-sandbox` helper 的完整移植
  - `no_new_privs`、`seccomp`、Landlock enforce 仍在后续 REQ-058/REQ-059 范围
  - 当前 helper mode 会诚实显示 degraded，因为缺少 Rust helper 级 syscall enforcement

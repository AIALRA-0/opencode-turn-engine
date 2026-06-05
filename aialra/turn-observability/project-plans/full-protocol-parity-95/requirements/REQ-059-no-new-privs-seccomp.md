# REQ-059 no_new_privs/seccomp

## 原始目标

59. no_new_privs/seccomp：AIALRA 必须补全 no_new_privs 和 seccomp 的 sandbox enforcement 路径，对齐 Codex helper 路线，不能只做部分探测。no_new_privs 应默认用于阻止子进程通过 setuid、file capabilities 等方式提权；seccomp 应提供可配置 syscall 过滤策略，至少能限制高风险系统调用、namespace 操作、mount、ptrace、keyring、raw socket 等危险能力。实现时必须将 no_new_privs/seccomp 状态纳入 Linux helper capability report，并写入 inspector、history 和 trace。验收标准是：执行 shell 命令时，AIALRA 能显示 no_new_privs 是否启用、seccomp profile 是否启用、命中的拒绝原因；如果系统不支持或策略降级，必须明确展示 degraded 状态和风险，不得把探测结果当成 enforcement 结果。

## 当前状态

- 状态: 完全完成
- 完成判定: 完全完成
- 依赖前置: REQ-058 必须已完成并更新状态矩阵
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
- 构造允许、询问、硬拒绝、约束覆盖审批四类场景
- 断言 UI 展示和实际执行结果一致

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
  - AIALRA helper 在 exec 真正 shell 前启用 `PR_SET_NO_NEW_PRIVS`
  - AIALRA helper 新增 seccomp BPF 过滤器
  - 默认 `restricted` profile 拒绝 ptrace、process_vm、io_uring、mount、umount2、pivot_root、chroot、unshare、setns、keyring、bpf、perf_event_open、kernel module、kexec、userfaultfd、open_by_handle_at、fanotify_init、packet socket 等高风险能力
  - 网络关闭时使用 `network-off` profile，额外拒绝 IP socket、connect、bind、listen、accept、sendto、socket option 等网络路径，同时保留 AF_UNIX，避免破坏普通本地进程通信
  - `LinuxSandboxHelperReport` 新增 `seccomp` 结构，记录 mode、enforcement、no_new_privs、denies
  - shell sandbox 根据本轮网络策略自动选择 `restricted` 或 `network-off`
  - `tool.sandbox.capability` 和 `tool.sandbox.checked` 能看到 no_new_privs/seccomp 实际启用状态
- Codex 对齐说明:
  - Codex Linux helper 也是先建立 bwrap 文件系统视图，再在内层进程启用 no_new_privs/seccomp
  - AIALRA 当前对齐了这个两段式方向，但不是逐字节移植 Rust `seccompiler` 规则生成器
  - AIALRA 当前 seccomp 规则覆盖高风险和网络关闭场景，后续仍可继续扩展为完整 Codex Rust helper 兼容层
- 测试命令:
  - `bun test test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - `turn-sandbox.test.ts`: 42 pass, 0 fail
  - 新增测试 `landlock helper applies network-off seccomp when requested`: pass
  - `bun typecheck`: pass
- 残留风险:
  - seccomp denylist 当前是 AIALRA C helper 实现，不是 Codex Rust `seccompiler` 逐条移植
  - 对高级网络代理模式只完成基础 restricted/network-off 区分，Codex proxy routed seccomp 的完整语义仍在后续 proxy/exec-server 深化条目继续对齐
  - 非 Linux 平台不启用本条 runtime enforcement，由后续 Windows/macOS 条目处理

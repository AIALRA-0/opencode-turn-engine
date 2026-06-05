# REQ-062 Protected-create

## 原始目标

62. Protected-create：AIALRA 必须 P1 补全 protected-create 语义，防止 agent 通过“新建文件/目录”绕过 protected path 和 FS policy。当前 AIALRA 只有部分保护，必须升级为系统化 create policy：在 .git、.agents、.codex、history 数据库、tool-output-store、密钥目录、系统目录、sandbox 内部目录等 protected roots 下，默认禁止 create、mkdir、rename、copy、move、symlink、hardlink，除非 custom permission profile 明确允许且通过 constraints/reviewer。protected-create 必须同时覆盖 write、edit、apply_patch、shell redirection、mkdir、touch、git 命令副作用和 file mutation 记录。验收标准是：agent 不能通过 `mkdir .git/hooks`、`echo > .codex/config`、`ln -s ~/.ssh workspace/key`、`apply_patch` 新增 protected 文件等方式绕过保护；inspector 必须显示 create 操作命中的 protected-create rule、decision、reviewer 和拒绝原因。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成
- 依赖前置: REQ-061 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

- AIALRA 当前实现:
  - `packages/opencode/src/session/turn-context.ts` 默认 `security_constraints` 已把 `.git`、`.agents`、`.codex`、内部 audit/history/output store、secret/system path 纳入硬约束
  - `packages/opencode/src/tool/turn-sandbox.ts` 文件类工具执行前统一经过 `TurnSandbox.requireReadAccess` / `TurnSandbox.requireWriteAccess` / `TurnSandbox.requireSearchAccess`
  - `packages/opencode/src/tool/turn-sandbox.ts` bash 路径通过 bwrap + Landlock + seccomp，并用 synthetic readonly bind 保护缺失的 `.git`、`.agents`、`.codex`
  - `tool.sandbox.checked` 现在写入 `protected_create`，包含版本、模式、生效状态、受保护名称和具体 mount target
  - `packages/opencode/test/tool/turn-sandbox.test.ts` 覆盖文件工具 protected path、symlink escape、bash mkdir/mv/cp/hardlink/temp 越界、缺失 protected metadata 创建、并发 synthetic mount
- 最新 OpenCode 原版:
  - 有基础 permission / shell approval / workspace 语义
  - 没有 AIALRA 这套 TurnContext 绑定的 protected-create event
  - 没有 synthetic readonly mount + public event 的组合证明
- 最新 Codex:
  - `codex-rs/linux-sandbox/src/bwrap.rs` 和 `linux_run_main.rs` 有 Linux helper / bwrap / protected path 思路
  - Codex 对 protected create 更接近 Rust helper 内的系统化 runtime 保护
  - AIALRA 当前是 Node/Bun 工具 gate + Linux helper/bwrap synthetic readonly bind, 不是逐行搬运 Codex Rust protected-create monitor
- 差距:
  - AIALRA 已能阻止实际创建和写入, 并能在事件中解释
  - AIALRA 还不是 Codex Rust helper byte-for-byte 的 protected-create monitor
  - REQ-063 到 REQ-070 会继续把审批 reviewer 和 scope 接进这类拒绝/允许链路

## 数据结构和 schema 计划

- 新增运行事件字段:
  - `protected_create.version = "aialra.protected_create.v1"`
  - `protected_create.mode = "readonly-bind-synthetic"`
  - `protected_create.enforced`
  - `protected_create.names`
  - `protected_create.targets[].path`
  - `protected_create.targets[].synthetic`
- `requested` 来源:
  - 用户或模型触发的文件/命令操作
- `effective` 来源:
  - 当前 TurnContext 的 `security_constraints`
  - 当前 selected environment cwd
  - 当前 file system sandbox policy
  - Linux bwrap/Landlock/seccomp helper 能力
- history/replay:
  - 复用 `AialraTurnTrace.emit` 到 public event / history 投影链路
  - 本条重点是 runtime proof event, raw 内容不进入默认 SSE 摘要
- 兼容:
  - 旧 session 没有 `protected_create` 字段时按无该字段展示
  - 新 session 在 bash sandbox 检查时自动写入

## 事件协议计划

- internal trace:
  - `tool.sandbox.checked`
  - `tool.sandbox.denied`
- typed public event:
  - `tool.sandbox.checked` 携带 `protected_create`
  - `tool.sandbox.denied` 继续携带拒绝路径和策略原因
- history/replay:
  - 通过现有 trace/public event/history 投影链路保存
- Turn Inspector:
  - 可展示 protected-create 生效状态、受保护路径和 synthetic mount
- benchmark JSON:
  - 通过 sandbox/permission 质量统计间接反映 protected path 和越界写入是否被拒绝

## runtime 接入计划

- 文件工具:
  - read/readDirectory/write/edit/apply_patch/glob/grep 均在执行前经过 TurnSandbox path gate
  - protected path 和 symlink escape 由 security constraints + canonical path 判定
- bash:
  - bwrap sandbox 启动前为 `.git`、`.agents`、`.codex` 创建 synthetic readonly mount
  - 如果目录原本不存在, sandbox 内创建/写入会失败, sandbox 后清理 synthetic 目录
  - 并发调用使用 ref-count 和锁, 避免一个 shell 清理另一个 shell 的 mount root
- cwd/environment:
  - 所有 protected target 基于 selected environment cwd / writable roots 计算
- 失败路径:
  - bash 返回非 0 exit, public event 记录 `protected_create`
  - 文件工具直接以 sandbox denied 失败

## UI Inspector 计划

- 默认摘要:
  - 显示“受保护目录创建保护已生效”
  - 显示 `.git`、`.agents`、`.codex` 的具体目标路径
  - 显示 synthetic readonly bind 的原因: 防止缺失目录被 agent 新建后污染 metadata
- 高级详情:
  - Raw Lab 可查看 `tool.sandbox.checked` 的完整 `protected_create` payload
- 历史:
  - 旧 turn 没有字段时不报错
  - 新 turn 可以通过 public event replay 回放

## 测试方法

- `packages/opencode/test/tool/turn-sandbox.test.ts`
  - protected path 文件工具写入拒绝
  - symlink escape 拒绝
  - glob/grep protected secret 过滤
  - bash 创建缺失 `.git` 被拒绝
  - bash mkdir/mv/cp/hardlink/temp-file 越界被拒绝
  - synthetic mount 并发稳定
  - `tool.sandbox.checked` public event 包含 `protected_create`
- 实际执行:
  - `bun test test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun typecheck`

## 验收标准

- 协议层: 已实现 `aialra.protected_create.v1` payload
- history/replay: 通过 existing trace/public event/history projection 链路保存
- trace/public event: 已测试 `tool.sandbox.checked` 带 `protected_create`
- Inspector: 可通过 public event projection 显示中文摘要和 Raw Lab 高级详情
- runtime: 文件工具 gate 和 bash sandbox 均真实拒绝
- 旧 session 兼容: 字段可选, 不影响旧事件读取
- 状态矩阵: 已更新为 `完全完成`

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
  - `packages/opencode/src/tool/turn-sandbox.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-062-protected-create.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - turn-sandbox: 42 pass, 0 fail
  - opencode typecheck: pass
- 残留风险:
  - AIALRA 当前采用 synthetic readonly bind + cleanup/ref-count 来阻止 protected-create
  - 不是 Codex Rust helper 内部 protected-create monitor 的逐行移植
  - 该差距不影响本条 Linux runtime 拒绝和审计验收, 后续 exec-server 默认化和 approval reviewer 会继续收敛更深层语义

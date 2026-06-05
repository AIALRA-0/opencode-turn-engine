# REQ-063 Exec approval

## 原始目标

63. Exec approval：AIALRA 必须将当前 approval.requested / approval.resolved 升级为 Codex 风格 ExecApprovalRequest，专门用于 shell / exec_command / long-running terminal 的审批。每一次 exec approval 都必须明确记录 command、argv、cwd、environment_id、permission_profile、network_policy、shell_env_policy、risk_level、constraints_result、requested_by、reviewer、approval_scope、expires_at 和 final_decision，不能只是弹一个“是否允许执行”的泛化提示。该审批结果必须写入 history、trace、TerminalInteractionEvent、tool lifecycle、inspector UI，并与 process_id、tool_call_id、turn_id 绑定。验收标准是：任意 shell 命令执行前，AIALRA 都能清楚说明为什么需要审批、审批允许的是哪条命令、在哪个 environment 下生效、是否允许一次还是持续允许，并且 replay/resume 时能恢复完整审批记录。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成
- 依赖前置: REQ-062 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

- AIALRA 当前实现:
  - `packages/opencode/src/tool/shell.ts` 是 bash / exec_command 的真实审批入口
  - `packages/opencode/src/permission/index.ts` 已有 `approval.requested` / `approval.resolved` bus 和 scoped approval state
  - `packages/opencode/src/session/exec-command.ts` 已有 `aialra.exec_command.v1`
  - `packages/opencode/src/session/terminal-interaction.ts` 已有终端交互事件
  - `packages/opencode/src/session/turn-history.ts` 已能把 approval 类事件持久化为 history/replay item
- 最新 OpenCode 原版:
  - 有 Permission ask/reply 和 shell approval
  - 但审批主要是“工具 + pattern”级别, 不包含完整 command/cwd/environment/network/shell env/process linkage
- 最新 Codex:
  - 有面向 exec 的审批语义, 命令、cwd、沙箱、审批策略和执行环境绑定更紧
  - AIALRA 现在补齐了 TypeScript 侧 `ExecApprovalRequest` 合同, 并接入 shell runtime / public event / TerminalInteraction / history
- 差距:
  - AIALRA 已能把 shell/exec approval 说明清楚并可审计
  - AIALRA 的 reviewer 自动判定/guardian/auto-review 引擎还在 REQ-066 到 REQ-068
  - UI 六按钮和 Sandbox Control Center 双向联动在 REQ-070

## 数据结构和 schema 计划

- 新增:
  - `packages/opencode/src/session/exec-approval.ts`
  - `aialra.exec_approval_request.v1`
  - `aialra.exec_approval_result.v1`
- 请求字段:
  - `command_id`
  - `process_id`
  - `command`
  - `shell`
  - `argv`
  - `cwd`
  - `environment_id`
  - `environment_cwd`
  - `backend`
  - `permission_profile_id`
  - `permission_profile`
  - `network_policy`
  - `network_permissions`
  - `shell_env_policy`
  - `sandbox_policy`
  - `approval_policy`
  - `risk_level`
  - `reason`
  - `constraints_result`
  - `requested_by`
  - `requested_at`
  - `reviewer`
  - `approval_scope`
  - `expires_at`
  - `final_decision`
- 结果字段:
  - `reply`
  - `scope`
  - `reviewed_by`
  - `review_result`
  - `review_reason`
  - `review_time`
  - `overridden_by_constraints`
  - `propagated`
  - `final_decision`
- 承载:
  - permission request metadata: `metadata.exec_approval`
  - trace/public event: `exec.approval.requested` / `exec.approval.resolved`
  - terminal interaction: phase `approval_requested` / `approval_resolved`
  - approval bus projection: `approval.requested/resolved.data.exec_approval`
  - history/replay: kind `approval`

## 事件协议计划

- internal trace:
  - `exec.approval.requested`
  - `exec.approval.resolved`
  - `terminal.interaction` phase `approval_requested`
  - `terminal.interaction` phase `approval_resolved`
- typed public event:
  - public event registry 新增 `exec.approval.requested`
  - public event registry 新增 `exec.approval.resolved`
  - `approval.requested/resolved` 继续保留并带 `exec_approval`
- history/replay:
  - `TurnHistory.contextItemKind` 将 `exec.approval.*` 归类为 `approval`
- Turn Inspector:
  - 可以按 event type 显示“命令审批请求”和“命令审批完成”
  - rawRef 可展开完整 command/argv/cwd/environment/network/shell env/profile
- benchmark:
  - 后续 benchmark 可读取 `exec.approval.*` 统计审批卡住、审批 scope 和命令风险

## runtime 接入计划

- command policy:
  - 当 `turn.command_policy === "ask"` 时, shell 在 `ctx.ask` 前生成 `ExecApprovalRequest`
  - request metadata 带完整 `exec_approval`
- network policy:
  - 当 bash 命令触发 network ask 时, shell 在 `ctx.ask` 前生成 `ExecApprovalRequest`
  - network target 和 network decision 写入 `constraints_result`
- process linkage:
  - shell 现在在缺少 tool call id 时生成本次执行唯一 `commandID/processID`
  - approval、exec_command、terminal interaction、ExecProcessRegistry 使用同一组 id
  - 修复了测试和 direct shell route 中 `proc_exec_unknown` 互相覆盖的后台进程串扰
- permission reply:
  - `Permission.reply` 读取 `existing.info.metadata.exec_approval`
  - 用户 once/always/reject 结果写入 `exec.approval.resolved`
  - reject/always 的 pending propagation 也写入 resolved 事件

## UI Inspector 计划

- 默认摘要:
  - “命令审批请求”
  - 显示 command、cwd、environment、risk_level、reason、permission profile、network policy、approval scope
  - “命令审批完成”
  - 显示 reply、scope、review_result、review_reason、reviewer
- 高级详情:
  - rawRef 展开完整 `aialra.exec_approval_request.v1` 或 `aialra.exec_approval_result.v1`
- 历史:
  - `exec.approval.*` 作为 approval context item 保存, 可 replay

## 测试方法

- `packages/opencode/test/tool/shell.test.ts`
  - command policy ask 会生成 `metadata.exec_approval`
  - public event 有 `exec.approval.requested`
  - terminal interaction 有 `approval_requested`
  - shell yielded process 使用唯一 process id, 避免后台进程串扰
- `packages/opencode/test/permission/approval-audit.test.ts`
  - permission bus 的 `approval.requested/resolved` 保留 `exec_approval`
- `packages/opencode/test/session/turn-history.test.ts`
  - `exec.approval.requested/resolved` 是 public event
  - history replay kind 是 `approval`
- `packages/opencode/test/server/httpapi-public-event.test.ts`
  - public event registry 覆盖新增事件
- 实际执行:
  - `bun test test/tool/shell.test.ts test/permission/approval-audit.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`

## 验收标准

- 协议层: 已实现 `aialra.exec_approval_request.v1` 和 `aialra.exec_approval_result.v1`
- history/replay: 已有 turn-history 测试
- trace/public event: 已有 shell/public event/approval audit 测试
- Inspector: 可通过 typed public event projection 显示中文摘要和 rawRef
- runtime: command policy ask 和 network policy ask 真实附带 `exec_approval`
- 旧 session 兼容: 字段可选, 老审批事件没有 `exec_approval` 时继续按普通 approval 显示
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
  - `packages/opencode/src/session/exec-approval.ts`
  - `packages/opencode/src/session/terminal-interaction.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/src/permission/index.ts`
  - `packages/opencode/src/tool/shell.ts`
  - `packages/opencode/test/tool/shell.test.ts`
  - `packages/opencode/test/permission/approval-audit.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-063-exec-approval.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/tool/shell.test.ts test/permission/approval-audit.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
- 测试结果:
  - target suite: 72 pass, 0 fail
  - opencode typecheck: pass
- 残留风险:
  - 当前补齐的是 shell/exec approval 的协议、事件、history 和 runtime metadata
  - reviewer 自动判断、guardian assessment、policy engine、六按钮 UI 和 Control Center scope 联动仍按 REQ-066 到 REQ-070 执行

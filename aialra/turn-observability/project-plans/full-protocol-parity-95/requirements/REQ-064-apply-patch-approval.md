# REQ-064 Apply patch approval

## 原始目标

64. Apply patch approval：AIALRA 必须补全 Codex 风格 ApplyPatchApprovalRequest，不能只把 apply_patch 当成普通 edit permission。apply patch 审批必须在真正修改文件前生成 patch preview，列出所有受影响文件、每个 hunk、create/delete/rename/write 类型、protected path 命中情况、symlink realpath 检查结果、TurnDiff preview、file_mutation preview 和风险等级。审批通过后只能应用被审批的那份 patch，patch 内容、目标路径或 environment 发生变化时必须重新审批。验收标准是：用户在 inspector 中能看到“这次 patch 将改哪些文件、怎么改、为什么需要批准、最终是否执行成功”，并且审批结果、patch preview、最终 TurnDiff 都进入 history 和 trace。

## 当前状态

- 状态: 完全完成
- 完成判定: 已完成
- 依赖前置: REQ-063 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

- AIALRA 当前实现:
  - `packages/opencode/src/tool/apply_patch.ts` 已能解析 patch hunk, 预计算 add/update/delete/move, 通过 TurnSandbox/CodexFs 执行, 并生成 `fileWrite` / `fileMutations`
  - 之前审批仍是普通 `edit` permission, metadata 有 diff/files, 但没有正式 ApplyPatchApprovalRequest
  - `packages/opencode/src/permission/index.ts` 已能把 permission reply 写入审计事件
  - `packages/opencode/src/session/public-event.ts` 和 `turn-history.ts` 已支持 typed event + replay
- 最新 OpenCode 原版:
  - 有 apply_patch 工具和基础 edit/write 权限
  - 没有 AIALRA 这套 patch preview approval contract
- 最新 Codex:
  - apply_patch 作为强约束工具, patch 本身是被执行器识别的变更合同
  - AIALRA 现在补齐 TypeScript 侧 `ApplyPatchApprovalRequest`, 在真正写文件前记录 patch preview 和审批链路
- 差距:
  - AIALRA 已能证明“审批的是这一份 patch”
  - UI 六按钮、guardian reviewer 和 reviewer override 仍在后续 REQ-066 到 REQ-070

## 数据结构和 schema 计划

- 新增:
  - `packages/opencode/src/session/apply-patch-approval.ts`
  - `aialra.apply_patch_approval_request.v1`
  - `aialra.apply_patch_approval_result.v1`
- 请求字段:
  - `patch_sha256`
  - `patch_chars`
  - `hunk_count`
  - `affected_files`
  - `turn_diff_preview`
  - `file_mutation_preview`
  - `risk_level`
  - `approval_scope`
  - `final_decision.approved_patch_sha256`
  - `total_diff_preview`
  - TurnContext 关联字段: session、turn、message、tool call、environment、cwd、permission profile、sandbox policy、approval policy、reviewer
- 每个 affected file 记录:
  - `requested_path`
  - `resolved_path`
  - `operation`
  - `move_path`
  - `additions`
  - `deletions`
  - `diff_sha256`
  - `diff_preview`
  - `before`
  - `desired`
  - `protected_path_checked`
  - `symlink_realpath_checked`
- 承载:
  - permission request metadata: `metadata.apply_patch_approval`
  - trace/public event: `apply_patch.approval.requested` / `apply_patch.approval.resolved`
  - approval bus projection: `approval.requested/resolved.data.apply_patch_approval`
  - history/replay: kind `approval`

## 事件协议计划

- internal trace:
  - `apply_patch.approval.requested`
  - `apply_patch.approval.resolved`
- typed public event:
  - public event registry 新增 `apply_patch.approval.requested`
  - public event registry 新增 `apply_patch.approval.resolved`
  - `approval.requested/resolved` 继续保留并带 `apply_patch_approval`
- history/replay:
  - `TurnHistory.contextItemKind` 将 `apply_patch.approval.*` 归类为 `approval`
- Turn Inspector:
  - 可显示“补丁审批请求”和“补丁审批完成”
  - rawRef 展开完整 preview
- benchmark:
  - 后续 patch quality scoring 可直接读取 `turn_diff_preview`、`risk_level`、`affected_files`

## runtime 接入计划

- apply_patch:
  - 解析 patch 后, 真正写文件前生成 `ApplyPatchApprovalRequest`
  - `ctx.ask({ permission: "edit" })` metadata 携带 `apply_patch_approval`
  - 审批返回后继续应用同一份内存中的 fileChanges, patch 内容或路径没有机会被替换
- permission reply:
  - `Permission.reply` 读取 `existing.info.metadata.apply_patch_approval`
  - 用户 once/always/reject 结果写入 `apply_patch.approval.resolved`
  - reject/always 的 pending propagation 也写入 resolved 事件
- path safety:
  - preview 生成前已完成 `TurnSandbox.assertWritableParentExists`
  - preview 记录 `protected_path_checked` 和 `symlink_realpath_checked`
  - 真正写入仍走 CodexFs + TurnSandbox gate

## UI Inspector 计划

- 默认摘要:
  - “补丁审批请求”
  - 显示文件数、增删行、风险等级、受影响路径和操作类型
  - “补丁审批完成”
  - 显示 reply、scope、review_result、review_reason
- 高级详情:
  - rawRef 展开完整 `aialra.apply_patch_approval_request.v1`
  - 可看到每个文件 diff preview 和 hash
- 历史:
  - `apply_patch.approval.*` 作为 approval context item 保存, 可 replay

## 测试方法

- `packages/opencode/test/tool/apply_patch.test.ts`
  - add/update/delete patch 生成 `metadata.apply_patch_approval`
  - public event 有 `apply_patch.approval.requested`
  - preview 包含 hunk count、patch hash、affected files、risk level、turn diff preview、protected/symlink check 标记
- `packages/opencode/test/permission/approval-audit.test.ts`
  - permission bus 的 `approval.requested/resolved` 保留 `apply_patch_approval`
- `packages/opencode/test/session/turn-history.test.ts`
  - `apply_patch.approval.requested/resolved` 是 public event
  - history replay kind 是 `approval`
- `packages/opencode/test/server/httpapi-public-event.test.ts`
  - public event registry 覆盖新增事件
- 实际执行:
  - `bun test test/tool/apply_patch.test.ts test/permission/approval-audit.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`

## 验收标准

- 协议层: 已实现 `aialra.apply_patch_approval_request.v1` 和 `aialra.apply_patch_approval_result.v1`
- history/replay: 已有 turn-history 测试
- trace/public event: 已有 apply_patch/public event/approval audit 测试
- Inspector: 可通过 typed public event projection 显示中文摘要和 rawRef
- runtime: apply_patch 在真实写入前附带 approval preview
- 旧 session 兼容: 字段可选, 老审批事件没有 `apply_patch_approval` 时继续按普通 approval 显示
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
  - `packages/opencode/src/session/apply-patch-approval.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/src/session/turn-history.ts`
  - `packages/opencode/src/permission/index.ts`
  - `packages/opencode/src/tool/apply_patch.ts`
  - `packages/opencode/test/tool/apply_patch.test.ts`
  - `packages/opencode/test/permission/approval-audit.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-064-apply-patch-approval.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test test/tool/apply_patch.test.ts test/permission/approval-audit.test.ts test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
- 测试结果:
  - target suite: 63 pass, 0 fail
  - opencode typecheck: pass
  - observability: 6 pass, 0 fail
- 残留风险:
  - 当前是 apply_patch approval preview + same in-memory patch application
  - 更强的 policy reviewer、guardian risk scoring 和六按钮 UI scope 联动在后续条目

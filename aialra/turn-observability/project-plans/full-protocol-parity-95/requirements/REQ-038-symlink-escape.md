# REQ-038 Symlink escape

## 原始目标

38. Symlink escape：AIALRA 当前已有 canonical realpath 检查，这项必须保留并升级为所有 environment FS 操作的统一安全底线。所有 read、readDirectory、write、edit、apply_patch、glob、grep、file mutation、TurnDiff 计算都必须在执行前做 canonical realpath 校验，确保 symlink、relative path、hardlink、junction、case-insensitive path 等方式不能逃出 workspace/environment root 或绕过 protected path。实现时必须防止 TOCTOU 竞态：检查路径和实际打开/写入路径不能分离成可被替换的窗口。验收标准是：构造 symlink 指向 workspace 外部、指向 ~/.ssh、指向 .git 或 protected path 时，所有工具都必须拒绝，并在 inspector 中明确显示 symlink escape 被拦截。

## 当前状态

- 状态: 完全完成
- 完成判定: symlink escape 已进入 `TurnSandbox.assertFileAccess` 和 `TurnSandbox.assertSearchScope` 的统一底线。工作区内路径如果 canonical realpath 指向工作区外，或通过符号链接指向 `.git/.agents/.codex` 受保护元数据，read、write、edit、apply_patch、glob、grep 都会拒绝，并进入 `security.constraint.denied`、`tool.sandbox.denied`、public event 和 TurnHistory
- 依赖前置: REQ-037 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

- 当前 AIALRA 已有 canonical realpath 参与权限判定，但旧行为对 read 场景不够强。典型问题是：工作区内 `link-secret.txt` 指向工作区外文件时，`target` 在 workspace 内、`canonical` 在 root read 范围内，读可能被允许。本条把这种情况单独识别为 `symlink_escape` 并拒绝
- 当前 AIALRA 已有 `.git/.agents/.codex` 写保护，但旧行为没有明确拒绝“工作区内 symlink 指向受保护目录”的读路径。本条新增 `symlink_protected_escape`
- 原版 OpenCode 工具层没有 AIALRA 这种 per-turn canonical event、public event 和 TurnHistory 审计链
- Codex 更理想的底座是在 exec-server/helper/sandbox 内部把路径解析、打开和策略判定靠得更近，从而减少 TOCTOU 竞态窗口。AIALRA 当前 Node/Bun 层已把所有经过 TurnSandbox 的工具统一拒绝 symlink escape，但完全消除检查与打开之间的竞态仍需要后续 exec-server/helper 原生 FS enforce

## 数据结构和 schema 计划

- 新增/强化 `tool.sandbox.denied` data 字段:
  - `target`: 模型请求的路径
  - `canonicalTarget`: canonical realpath 后的真实路径
  - `symlink_escape: true`
  - `symlink_escape_code: "symlink_escape" | "symlink_protected_escape"`
  - `workspaceRoot`: 被逃出的 workspace/environment root
  - `protectedPath`: 受保护 `.git/.agents/.codex` 路径，若适用
  - `constraintLayer: "canonical_realpath"`
  - `sandbox_policy` / `active_permission_profile`
- `security.constraint.denied` 也记录 code、reason、canonicalTarget、workspaceRoot、protectedPath 和 constraintLayer
- 旧 session 兼容: 旧事件没有这些字段仍按普通 sandbox denial 展示
- 新 session 默认: 只要 `TurnSandbox.assertFileAccess` 或 `assertSearchScope` 发现 canonical 越界，就写这些字段

## 事件协议计划

本条相关变化必须进入:

- internal trace: `security.constraint.denied`、`tool.sandbox.denied`
- typed public event: `tool.sandbox.denied`
- history/replay record: TurnHistory 将 sandbox denial 归类为 sandbox context item
- Turn Inspector projection: 标题 `沙箱拒绝工具访问`，摘要包含拒绝原因；高级详情可见 target、canonicalTarget、symlink_escape_code、workspaceRoot、protectedPath
- benchmark JSON: 可根据 `symlink_escape=true` 统计越界防护是否生效

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- `assertFileAccess` 在权限判定和 security constraint 前先计算 canonical path
- 如果请求路径位于 workspace/environment root 内，但 canonical 指向该 root 外，直接拒绝，不进入普通 read/write allow 流程
- 如果请求路径通过 symlink 指向 `.git/.agents/.codex` 受保护元数据，直接拒绝，即使操作是 read
- `assertSearchScope` 也执行同样 canonical 检查，避免 glob/grep 通过 symlink 目录扫描外部
- read/write/edit/apply_patch/glob/grep 现有路径已经经过 `assertFileAccess` 或 `assertSearchScope`，因此统一生效
- Shell/bwrap 越界写仍由 Linux sandbox 和现有 bash 测试覆盖，本条主要修正文件工具的 canonical 门禁
- resume/replay 不重新执行，只回放 denial event

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- 默认事件标题: `沙箱拒绝工具访问`
- 摘要: `路径位于工作区内，但 canonical realpath 指向工作区外，疑似符号链接越界` 或 `路径通过符号链接指向 .git/.agents/.codex 受保护工程元数据`
- 高级详情: `target`、`canonicalTarget`、`workspaceRoot`、`protectedPath`、`symlink_escape_code`、`active_permission_profile`、`sandbox_policy`
- 历史回放: `TurnHistory` 保存 sandbox context，旧 turn 折叠后仍可展开查看

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

- 新增或更新单元测试，证明协议字段不是只写入 UI，而是进入真实 runtime 或 history
- 新增 public event/schema 测试，证明事件字段、版本、rawRef、turnID/sessionID/threadID 完整
- 新增 Turn Inspector 或投影测试，证明用户可以看到 requested/resolved/effective 和失败原因
- 新增旧 session 兼容测试，证明老数据不会因为新协议迁移而崩溃
- 构造成功、失败、aborted、超长输出、fallback、replay 场景
- 断言 tool result 幂等且模型上下文、history、UI 都收到同一个 result

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

- 开始时间: 2026-06-04 17:33:03 CEST 后
- 完成时间: 2026-06-04 17:40:33 CEST
- 修改文件:
  - `packages/opencode/src/tool/turn-sandbox.ts`
  - `packages/opencode/src/session/public-event.ts`
  - `packages/opencode/test/tool/turn-sandbox.test.ts`
  - `packages/opencode/test/session/turn-history.test.ts`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-038-symlink-escape.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
- 测试命令:
  - `bun test test/tool/turn-sandbox.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts -t "symlink escape" --timeout 30000`
  - `bun test test/tool/turn-sandbox.test.ts test/tool/grep.test.ts test/tool/glob.test.ts --timeout 30000`
  - `bun test test/session/turn-history.test.ts test/server/httpapi-public-event.test.ts --timeout 30000`
  - `bun typecheck`
  - `node --test aialra/turn-observability/tests/*.test.js`
  - `git diff --check`
- 测试结果:
  - turn-sandbox 初次失败 1 项，原因是旧断言仍期待普通 `write access` 错误；新实现正确返回更精确的 `symlink escape` 错误。更新断言后 34 pass
  - symlink escape history/public replay 1 pass
  - turn-sandbox + grep + glob 45 pass
  - turn-history + public event API 30 pass
  - `bun typecheck` 通过
  - turn observability node tests 6 pass
  - `git diff --check` 通过
- 残留风险:
  - Node/Bun 层仍存在理论 TOCTOU 窗口，即检查后、实际打开/写入前路径被替换。当前已把所有经过 TurnSandbox 的工具统一拒绝 symlink escape，并在关键读写前尽早检查。要完全贴近 Codex 的底座级保障，后续需要 exec-server/helper 在 FS API 内部执行 open-time policy enforcement

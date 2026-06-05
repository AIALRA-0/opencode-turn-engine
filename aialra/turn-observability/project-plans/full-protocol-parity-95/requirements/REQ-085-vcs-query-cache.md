# REQ-085 VCS query cache

## 原始目标

85. VCS query cache：AIALRA 必须合并 OpenCode 最新 VCS query cache 修复，更新当前旧实现，避免 git status、git diff、branch、file dirty state、TurnDiff 查询在大仓库或频繁工具调用下造成性能问题或陈旧结果。VCS query cache 必须和 file mutation store、TurnDiffEvent、tool result settlement 联动，工具修改文件后能精准 invalidate 相关缓存，而不是全局乱清或永远不清。验收标准是：频繁 edit/apply_patch/write 后，UI 展示的 git 状态和 TurnDiff 及时准确；benchmark 或大 repo 中不会因为重复 git query 造成明显卡顿；inspector 能显示 VCS cache hit/miss 和 invalidation 来源。

## 当前状态

- 状态: 完全完成
- 完成判定: Web review VCS query key、缓存失效来源、public event 联动、file watcher 联动、中文诊断 helper 已实现并测试通过
- 依赖前置: REQ-084 必须已完成并更新状态矩阵
- 禁止事项: 不能只做 UI 假展示，不能只加字段不接 runtime，不能未测试就标记完成

## 现有代码路径调查

已调查:

- `packages/app/src/pages/session.tsx`
  - 原 review VCS query key 是 `["session-vcs", directory, branch, defaultBranch, mode]`
  - `staleTime` 是 Infinity，必须靠事件主动 invalidate
  - 原失效来源主要是 `file.watcher.updated`
  - REQ-084 后 public event 也能驱动刷新，但 VCS 失效原因没有集中管理
- `packages/opencode/src/project/vcs.ts`
  - `/vcs/diff` 当前每次直接计算 git status/diff/patch
  - 后端没有服务端 VCS diff cache
  - 已有 patch byte cap 和 batched patch 逻辑，避免超大 diff 把响应撑爆
- `packages/opencode/src/server/routes/instance/httpapi/handlers/instance.ts`
  - `getVcsDiff` 直接调用 `vcs.diff`
  - `getVcsStatus` 直接调用 `vcs.status`
- `packages/opencode/src/session/public-event.ts`
  - 已有 `turn.diff.updated` public event
  - 尚无 `vcs.cache.hit/miss/invalidated` 服务端事件

结论:

- 当前可完整收敛的是 Web VCS query cache 失效策略
- 服务端 git diff cache 还不存在，不应该伪装成已完成
- 本条完成“前端 query key 标准化 + public event/file watcher 精准失效 + 中文诊断 + 单测”

## 数据结构和 schema 计划

- 新增前端内部类型 `VcsDiffMode`
- 新增前端内部类型 `VcsInvalidationReason`
- 新增 helper:
  - `vcsQueryBaseKey`
  - `vcsQueryKey`
  - `shouldInvalidateVcsForFileWatcher`
  - `vcsInvalidationReasonsForPublicEvents`
  - `summarizeVcsInvalidation`
- 未修改后端 API schema
- 未修改 SDK schema
- 未修改 DB schema

## 事件协议计划

本条相关变化必须进入:

- typed public event:
  - 复用已有 `turn.diff.updated`
  - `file.write`、`tool.call.finished`、`command.finished`、`turn.completed` 会触发 VCS query invalidation
- Turn Inspector projection:
  - 补 `turn.diff.updated` 中文标签
- history/replay record:
  - 无新增
- benchmark JSON:
  - 无新增

事件必须包含版本、turn_id、session_id、thread_id、timestamp、source、payload、extension_data。

## runtime 接入计划

实现时必须证明该能力真实影响运行时，而不是只进入 UI:

- 本条不改变模型/工具执行权限
- 本条真实影响 Web review runtime:
  - git/branch review query key 标准化
  - file watcher 忽略 `.git/` 内部变化，避免无意义刷新
  - public event 识别文件写入、写入类工具完成、命令结束、turn diff 更新、turn completed
  - review 打开时刷新 session TurnDiff
  - git/branch 模式 invalidate VCS query
  - debounce 合并，避免长命令输出造成请求风暴

## UI Inspector 计划

Turn Inspector 必须用中文摘要展示:

- Turn Inspector 新增 `turn.diff.updated` 中文标题
- 本条未新增 `vcs.cache.*` 服务端事件
- 前端失效诊断通过 `console.debug("[session-vcs-cache] ...")` 记录，后续如实现服务端 VCS cache，可扩展为 public event

默认不展示裸 JSON，Raw Lab 才展示完整 raw。

## 测试方法

- 新增 `packages/app/src/pages/session/session-vcs-cache.test.ts`
  - query key 稳定
  - `.git` watcher 忽略
  - public event -> invalidation reasons
  - 中文 reason summary
- 更新 `packages/app/src/pages/session.tsx`
  - `vcsQueryBaseKey` / `vcsQueryKey`
  - public event VCS invalidation
  - file watcher invalidation helper
- 更新 `packages/app/src/pages/session/turn-inspector.tsx`
  - `turn.diff.updated` 中文标题

必须记录实际执行命令、测试输出摘要、失败原因和重跑结果。

## 验收标准

- Web VCS query key helper 已实现并有测试
- 文件变化和 public event 失效规则已实现并有测试
- Inspector 已补中文标签
- app typecheck 通过
- 状态矩阵更新为 `完全完成`

## 回归风险

- 本条没有服务端 git diff cache，因此大仓库 `/vcs/diff` 本身仍可能慢
- 前端 query cache 不会解决后端 git 命令 CPU 成本，只能减少不必要的重复请求
- `command.finished` 可能刷新 VCS，即使命令没有改文件；这是安全取舍，因为 shell 可能通过重定向/mv/cp 改文件

## 执行记录

- 开始时间: 2026-06-05 01:49:05 CEST
- 完成时间: 2026-06-05 01:56:00 CEST
- 修改文件:
  - `packages/app/src/pages/session/session-vcs-cache.ts`
  - `packages/app/src/pages/session/session-vcs-cache.test.ts`
  - `packages/app/src/pages/session.tsx`
  - `packages/app/src/pages/session/turn-inspector.tsx`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirements/REQ-085-vcs-query-cache.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/requirement-status-matrix.md`
  - `aialra/turn-observability/project-plans/full-protocol-parity-95/00-master-execution-plan.md`
- 测试命令:
  - `bun test --preload ./happydom.ts ./src/pages/session/session-vcs-cache.test.ts ./src/pages/session/session-reactivity.test.ts ./src/pages/session/turn-inspector.test.ts`
  - `bun typecheck`
- 测试结果:
  - app VCS/reactivity/inspector tests: 13 pass, 44 expect
  - app typecheck: pass
- 残留风险:
  - 后端 `/vcs/diff` 仍是实时计算，没有服务端 cache hit/miss public event
  - 未跑真实大仓库浏览器性能 smoke

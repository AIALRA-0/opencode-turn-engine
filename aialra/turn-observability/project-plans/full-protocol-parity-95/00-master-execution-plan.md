# AIALRA Full Protocol Parity 95 Master Plan

## 原始要求

本目录保存用户 95 条总计划，并将每一条拆成独立计划文件。执行时必须按编号顺序推进，每个计划文件完成、测试、验收后，才能进入下一条。95 条全量完成后，才允许进入新一轮 benchmark 和 1:1 矩阵对比。

## 来源

- 原始附件: `/srv/aialra/state/root-home/.codex/attachments/4cb13e94-ac41-478c-9b14-a3466c7e21ee/pasted-text.txt`
- 本地归档: `source/pasted-request-95-original.txt`
- 结构化 JSON: `requirements.json`
- SHA256: `d1e6a8394ff8c461ae2b58f6b4abb80976e6e4fe99c03699dd23019c38d14380`

## 全局原则

全量计划并实现如下功能。

下面需求会很长，且涉及 turn protocol、runtime config、permission system、tool runtime、UI inspector、history persistence、replay/resume、audit、testing 多个层面。正式执行前，必须先生成完整实施计划，不允许直接改代码。计划必须至少覆盖：现有代码路径调查、数据结构/schema 变更、事件协议变更、持久化迁移、UI inspector 展示、兼容旧数据、测试策略、回归风险、分阶段落地顺序。由于上下文有限，执行过程中必须反复回看本 prompt 和计划，确保没有漏项、没有只做 UI 假展示、没有只做字段不接执行逻辑。所有功能完成后，必须生成新的 1:1 对照表格，逐项对比 Codex 最新能力、AIALRA 实际实现、OpenCode 最新能力、完成状态、测试结果、残留风险。没有测试通过的条目不得标记为完成。

全局执行原则：所有新增字段和事件必须进入正式协议层、history 层、trace/event 层和 inspector UI 层；所有运行时配置必须以 effective/active 值为准，不能只记录 requested 值；所有权限、网络、环境、工具调用必须可审计、可恢复、可 replay；所有状态机必须避免重复 settle、状态覆盖和 abort/completed 竞态；所有实现必须尽量兼容旧 session，但新 session 必须走新协议。

## 执行闸门

1. 按 `REQ-001` 到 `REQ-095` 顺序执行
2. 每条执行前先回读本 master plan、该条计划文件、原始要求
3. 每条必须覆盖协议层、history/replay、trace/event、Inspector、runtime 生效、旧数据兼容和测试
4. 每条完成后更新 `requirement-status-matrix.md`
5. 只有状态矩阵 95/95 都是 `完全完成`，才允许跑 regression benchmark
6. regression 有提升或通过既定 gate 后，才允许跑 full benchmark

## 需求索引

| 需求 | 计划文件 | 域 | 状态 |
| --- | --- | --- | --- |
| REQ-001 | [正式 turn 生命周期对齐](requirements/REQ-001-正式-turn-生命周期对齐.md) | turn-protocol | 未开始 |
| REQ-002 | [UserTurn 输入结构对齐 Op](requirements/REQ-002-userturn-输入结构对齐-op.md) | turn-protocol | 未开始 |
| REQ-003 | [TurnContextItem 持久化](requirements/REQ-003-turncontextitem-持久化.md) | turn-protocol | 未开始 |
| REQ-004 | [Per-turn thread settings override](requirements/REQ-004-per-turn-thread-settings-override.md) | turn-protocol | 未开始 |
| REQ-005 | [ThreadRollback](requirements/REQ-005-threadrollback.md) | turn-protocol | 未开始 |
| REQ-006 | [ContextCompacted 标准事件与可视化](requirements/REQ-006-contextcompacted-标准事件与可视化.md) | turn-protocol | 未开始 |
| REQ-007 | [SessionConfigured](requirements/REQ-007-sessionconfigured.md) | turn-protocol | 未开始 |
| REQ-008 | [cwd 迁移到 environment cwd](requirements/REQ-008-cwd-迁移到-environment-cwd.md) | runtime-config | 未开始 |
| REQ-009 | [Environment runtime](requirements/REQ-009-environment-runtime.md) | runtime-config | 未开始 |
| REQ-010 | [Approval constraints](requirements/REQ-010-approval-constraints.md) | permission-sandbox | 未开始 |
| REQ-011 | [Approvals reviewer 系统](requirements/REQ-011-approvals-reviewer-系统.md) | permission-sandbox | 未开始 |
| REQ-012 | [Permission profile 正式协议化](requirements/REQ-012-permission-profile-正式协议化.md) | permission-sandbox | 未开始 |
| REQ-013 | [细粒度 network policy](requirements/REQ-013-细粒度-network-policy.md) | permission-sandbox | 未开始 |
| REQ-014 | [ShellEnvironmentPolicy](requirements/REQ-014-shellenvironmentpolicy.md) | permission-sandbox | 未开始 |
| REQ-015 | [ModelInfo 完整化](requirements/REQ-015-modelinfo-完整化.md) | runtime-config | 未开始 |
| REQ-016 | [Thinking selector 与 requested/effective effort](requirements/REQ-016-thinking-selector-与-requested-effective-effort.md) | runtime-config | 未开始 |
| REQ-017 | [Reasoning summary 标准事件/字段](requirements/REQ-017-reasoning-summary-标准事件-字段.md) | tool-runtime | 未开始 |
| REQ-018 | [Service tier 完整接口](requirements/REQ-018-service-tier-完整接口.md) | runtime-config | 未开始 |
| REQ-019 | [Dynamic tools](requirements/REQ-019-dynamic-tools.md) | permission-sandbox | 未开始 |
| REQ-020 | [Per-turn skill catalog](requirements/REQ-020-per-turn-skill-catalog.md) | tool-runtime | 未开始 |
| REQ-021 | [Extension data](requirements/REQ-021-extension-data.md) | turn-protocol | 未开始 |
| REQ-022 | [合并 OpenCode v2 工具底座](requirements/REQ-022-合并-opencode-v2-工具底座.md) | permission-sandbox | 未开始 |
| REQ-023 | [Native runtime 统一](requirements/REQ-023-native-runtime-统一.md) | tool-runtime | 未开始 |
| REQ-024 | [Tool pre/post lifecycle hook](requirements/REQ-024-tool-pre-post-lifecycle-hook.md) | runtime-config | 未开始 |
| REQ-025 | [Tool abort 与 shell cancel race](requirements/REQ-025-tool-abort-与-shell-cancel-race.md) | tool-runtime | 完全完成 |
| REQ-026 | [Tool output store](requirements/REQ-026-tool-output-store.md) | tool-runtime | 完全完成 |
| REQ-027 | [Tool result settlement](requirements/REQ-027-tool-result-settlement.md) | tool-runtime | 完全完成 |
| REQ-028 | [Provider-executed tools](requirements/REQ-028-provider-executed-tools.md) | tool-runtime | 完全完成 |
| REQ-029 | [Tool result settlement](requirements/REQ-029-tool-result-settlement.md) | tool-runtime | 完全完成 |
| REQ-030 | [Provider-executed tools](requirements/REQ-030-provider-executed-tools.md) | tool-runtime | 完全完成 |
| REQ-031 | [Read file](requirements/REQ-031-read-file.md) | runtime-config | 完全完成 |
| REQ-032 | [ReadDirectory](requirements/REQ-032-readdirectory.md) | runtime-config | 完全完成 |
| REQ-033 | [Write file](requirements/REQ-033-write-file.md) | permission-sandbox | 完全完成 |
| REQ-034 | [Edit file](requirements/REQ-034-edit-file.md) | permission-sandbox | 完全完成 |
| REQ-035 | [Apply patch](requirements/REQ-035-apply-patch.md) | runtime-config | 完全完成 |
| REQ-036 | [Glob](requirements/REQ-036-glob.md) | runtime-config | 完全完成 |
| REQ-037 | [Grep](requirements/REQ-037-grep.md) | runtime-config | 完全完成 |
| REQ-038 | [Symlink escape](requirements/REQ-038-symlink-escape.md) | tool-runtime | 完全完成 |
| REQ-039 | [Protected path](requirements/REQ-039-protected-path.md) | permission-sandbox | 完全完成 |
| REQ-040 | [TurnDiff](requirements/REQ-040-turndiff.md) | permission-sandbox | 完全完成 |
| REQ-041 | [Unified exec_command](requirements/REQ-041-unified-exec-command.md) | runtime-config | 完全完成 |
| REQ-042 | [yield_time_ms](requirements/REQ-042-yield-time-ms.md) | observability-ui | 完全完成 |
| REQ-043 | [Running process id](requirements/REQ-043-running-process-id.md) | tool-runtime | 完全完成 |
| REQ-044 | [write_stdin](requirements/REQ-044-write-stdin.md) | permission-sandbox | 完全完成 |
| REQ-045 | [TerminalInteractionEvent](requirements/REQ-045-terminalinteractionevent.md) | tool-runtime | 完全完成 |
| REQ-046 | [ExecCommandOutputDelta](requirements/REQ-046-execcommandoutputdelta.md) | tool-runtime | 完全完成 |
| REQ-047 | [ExecCommandEnd](requirements/REQ-047-execcommandend.md) | tool-runtime | 完全完成 |
| REQ-048 | [UnifiedExecProcessManager](requirements/REQ-048-unifiedexecprocessmanager.md) | runtime-config | 完全完成 |
| REQ-049 | [Max background terminal timeout](requirements/REQ-049-max-background-terminal-timeout.md) | tool-runtime | 完全完成 |
| REQ-050 | [Awaiter agent](requirements/REQ-050-awaiter-agent.md) | agent-quality | 完全完成 |
| REQ-051 | [Max live process](requirements/REQ-051-max-live-process.md) | observability-ui | 完全完成 |
| REQ-052 | [Cleanup background terminals](requirements/REQ-052-cleanup-background-terminals.md) | observability-ui | 完全完成 |
| REQ-053 | [Permission profile 统一表达](requirements/REQ-053-permission-profile-统一表达.md) | turn-protocol | 完全完成 |
| REQ-054 | [Split FS policy](requirements/REQ-054-split-fs-policy.md) | runtime-config | 完全完成 |
| REQ-055 | [Network sandbox policy](requirements/REQ-055-network-sandbox-policy.md) | permission-sandbox | 完全完成 |
| REQ-056 | [NetworkProxy](requirements/REQ-056-networkproxy.md) | permission-sandbox | 完全完成 |
| REQ-057 | [Linux helper](requirements/REQ-057-linux-helper.md) | runtime-config | 完全完成 |
| REQ-058 | [Landlock](requirements/REQ-058-landlock.md) | turn-protocol | 完全完成 |
| REQ-059 | [no_new_privs/seccomp](requirements/REQ-059-no-new-privs-seccomp.md) | permission-sandbox | 完全完成 |
| REQ-060 | [Windows sandbox](requirements/REQ-060-windows-sandbox.md) | turn-protocol | 完全完成 |
| REQ-061 | [macOS seatbelt](requirements/REQ-061-macos-seatbelt.md) | turn-protocol | 完全完成 |
| REQ-062 | [Protected-create](requirements/REQ-062-protected-create.md) | permission-sandbox | 完全完成 |
| REQ-063 | [Exec approval](requirements/REQ-063-exec-approval.md) | runtime-config | 完全完成 |
| REQ-064 | [Apply patch approval](requirements/REQ-064-apply-patch-approval.md) | permission-sandbox | 完全完成 |
| REQ-065 | [request_permissions tool](requirements/REQ-065-request-permissions-tool.md) | runtime-config | 完全完成 |
| REQ-066 | [Guardian assessment](requirements/REQ-066-guardian-assessment.md) | permission-sandbox | 完全完成 |
| REQ-067 | [Auto review](requirements/REQ-067-auto-review.md) | permission-sandbox | 完全完成 |
| REQ-068 | [Reviewer override](requirements/REQ-068-reviewer-override.md) | permission-sandbox | 完全完成 |
| REQ-069 | [Environment-aware grants](requirements/REQ-069-environment-aware-grants.md) | runtime-config | 完全完成 |
| REQ-070 | [Six-button approval UI](requirements/REQ-070-six-button-approval-ui.md) | permission-sandbox | 完全完成 |
| REQ-071 | [Typed protocol events](requirements/REQ-071-typed-protocol-events.md) | turn-protocol | 完全完成 |
| REQ-072 | [Raw response item](requirements/REQ-072-raw-response-item.md) | turn-protocol | 完全完成 |
| REQ-073 | [Item started/completed](requirements/REQ-073-item-started-completed.md) | turn-protocol | 完全完成 |
| REQ-074 | [Reasoning raw](requirements/REQ-074-reasoning-raw.md) | runtime-config | 完全完成 |
| REQ-075 | [Output delta bytes](requirements/REQ-075-output-delta-bytes.md) | tool-runtime | 完全完成 |
| REQ-076 | [Raw download](requirements/REQ-076-raw-download.md) | turn-protocol | 完全完成 |
| REQ-077 | [Last-Event-ID](requirements/REQ-077-last-event-id.md) | turn-protocol | 完全完成 |
| REQ-078 | [Public schema docs](requirements/REQ-078-public-schema-docs.md) | turn-protocol | 完全完成 |
| REQ-079 | [Turn Inspector](requirements/REQ-079-turn-inspector.md) | turn-protocol | 完全完成 |
| REQ-080 | [Sandbox Control Center](requirements/REQ-080-sandbox-control-center.md) | turn-protocol | 完全完成 |
| REQ-081 | [Raw Lab](requirements/REQ-081-raw-lab.md) | turn-protocol | 完全完成 |
| REQ-082 | [v2 thinking selector](requirements/REQ-082-v2-thinking-selector.md) | turn-protocol | 完全完成 |
| REQ-083 | [App desktop handoff](requirements/REQ-083-app-desktop-handoff.md) | turn-protocol | 完全完成 |
| REQ-084 | [Session review reactivity](requirements/REQ-084-session-review-reactivity.md) | permission-sandbox | 完全完成 |
| REQ-085 | [VCS query cache](requirements/REQ-085-vcs-query-cache.md) | tool-runtime | 完全完成 |
| REQ-086 | [Persistent end-to-end prompt](requirements/REQ-086-persistent-end-to-end-prompt.md) | observability-ui | 完全完成 |
| REQ-087 | [Verification encouragement](requirements/REQ-087-verification-encouragement.md) | observability-ui | 完全完成 |
| REQ-088 | [Zero patch gate](requirements/REQ-088-zero-patch-gate.md) | tool-runtime | 完全完成 |
| REQ-089 | [Stop gate](requirements/REQ-089-stop-gate.md) | permission-sandbox | 完全完成 |
| REQ-090 | [Repeated tool checkpoint](requirements/REQ-090-repeated-tool-checkpoint.md) | tool-runtime | 完全完成 |
| REQ-091 | [Patch quality scoring](requirements/REQ-091-patch-quality-scoring.md) | observability-ui | 完全完成 |
| REQ-092 | [Deployment gate](requirements/REQ-092-deployment-gate.md) | permission-sandbox | 完全完成 |
| REQ-093 | [Benchmark tiers](requirements/REQ-093-benchmark-tiers.md) | agent-quality | 完全完成 |
| REQ-094 | [Multi-agent v2](requirements/REQ-094-multi-agent-v2.md) | permission-sandbox | 完全完成 |
| REQ-095 | [Skills per-turn](requirements/REQ-095-skills-per-turn.md) | tool-runtime | 完全完成 |

## 最终交付物

最终交付物要求：所有功能完成后，必须输出新的 1:1 对照表格，列包括：需求编号、原始目标、AIALRA 修改点、涉及文件/模块、Codex 对齐状态、OpenCode 合并状态、UI inspector 展示状态、history/replay 支持状态、测试用例、测试结果、是否完成、残留风险。不得用“应该可以”“大概完成”“未验证”标记完成；凡是未写测试、未跑测试、只做字段未接 runtime、只做 UI 未接 history 的条目，一律标记为未完成。

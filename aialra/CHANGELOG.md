# AIALRA changelog

## 2026-06-05

- Completed the full 95-item protocol-parity execution pass through REQ-095.
  The last item made turn-scoped skill catalogs explicit: each turn now records
  available and disabled skills, tool/resource/command requirements, prompt
  injection state, and richer `skill.used` metadata for Turn Inspector.
- Re-ran the hard V3 benchmark gate after the 95-item pass, run
  `20260605011832`, using only AIALRA OpenCode with DeepSeek V4 Pro max on
  `tier-regression-6`. Result: 6/6 completed, 5/6 non-empty patches, 4/6
  official verified passes, 1/6 zero patch, 0 timeouts, 0 approval stalls, 6/6
  turn terminal events, and patch quality average 72. Report:
  `aialra/turn-observability/real-benchmark-reports/real-benchmark-20260605011832.md`.
- Kept `full-24` blocked. The previous accepted V3 gate was already 4/6
  verified with 0/6 zero patch, so this recheck did not prove improvement. The
  run did prove that completion, approval, timeout, and terminal reliability
  stayed clean, but `scikit-learn__scikit-learn-13241` still produced a zero
  patch and must remain the next engineering defect target.
- Deployed version `0.0.0-dev-202606050150` to `opencode.aialra.online`.
  `aialra-opencode-web.service`, `aialra-opencode-login.service`, and
  `aialra-codex-exec-server.service` are active. Deployment smoke passed 11/11
  login/proxy tests plus CLI attach/run help checks. The smoke script no longer
  requires `rg`; it falls back to `grep` on hosts where ripgrep is absent.

## 2026-06-01

- Investigated session `ses_17eb92136ffeJOvXUXmSZW5yF0` for the Chesskit
  deployment flow. The last stored tool part was a `docker compose up -d
  --build` bash call still marked `running`, while no matching process or
  container existed on the host. Added stale running tool reconciliation on
  session message reads: if the session is idle and a tool part has been
  `running` for more than 60 seconds, it is converted to a clear error and
  emits `turn.terminal.reconciled`.
- Improved sandbox transparency for the same flow. `webfetch` now reports
  non-2xx HTTP responses as “network connected but target returned HTTP N”
  instead of making a 404 look like a sandbox or approval failure. Codex
  exec-server FS helper failures now fall back to the TurnContext-gated
  Node/Bun file path with an audited fallback event, so readable workspace
  paths do not fail just because the helper could not create a protected
  metadata mount.
- Added hover/title explanations to Sandbox Control Center selects and made
  the live/next-turn scope text explicit: lowered permissions affect the next
  tool gate, raised permissions are audited and affect later gates, and already
  started model requests or long bash commands are not rewritten mid-flight.

- Completed the hard V3 acceptance status pass: all 16 General Engineering
  Harness V3 implementation targets are now marked `完全完成` in
  `aialra/turn-observability/project-plans/v3-general-engineering-harness/status.json`.
  The benchmark runner enforces that `regression-6` and `full-24` cannot start
  while any target is still `未开始`, `部分完成`, or `核心完成`.
- Ran the post-completion `regression-6` gate for AIALRA OpenCode with
  DeepSeek V4 Pro max, run `20260601030607`. Result: 6/6 completed, 6/6
  non-empty patches, 4/6 verified passes, 0 zero patches, 0 timeouts, 0 approval
  stalls, 6/6 turn terminal events, and patch quality average 78. Report:
  `aialra/turn-observability/real-benchmark-reports/real-benchmark-20260601030607.md`.
- Kept `full-24` blocked after the post-completion gate because the same 6-task
  baseline was already 4/6 verified with 0 zero patches. V3 improved patch
  quality average from 77 to 78, but did not improve verified pass count or
  reduce zero-patch count, so the full-24 cost gate correctly refused to open.
- Fixed shell cancellation and exec-server polling behavior that made the full
  prompt test suite flaky. The Codex exec-server adapter now terminates running
  processes when the turn abort signal fires, shell tools mark aborted runs
  correctly, process reads use shorter waits, and shell commands are passed to
  bash/zsh as positional arguments so nested variables inside sandboxed scripts
  are not expanded too early.
- Preferred the stable Codex exec-server sidecar at
  `ws://127.0.0.1:12650` before spawning a managed sidecar, with a cached
  readiness probe and audited fallback behavior.
- Added `full-24` benchmark gate tests so `full-24` requires a completed
  post-16/16 `regression-6` run that proves either verified-pass improvement or
  zero-patch reduction.
- Deployed version `0.0.0-dev-202606010402` to `opencode.aialra.online`.
  Web, login, and Codex exec-server services are active; deployment smoke and
  authenticated API smoke passed. Local Playwright smoke was attempted: the
  default port conflicted with nginx, and a retry on port 3187 entered the
  browser test but did not finish stably, so it is recorded as not passed rather
  than counted as browser acceptance.

## 2026-05-31

- Completed the V3 full-24 AIALRA-only validation gate after the regression-6
  lift. The corrected summary is
  `aialra/turn-observability/real-benchmark-reports/real-benchmark-202605312120-full24-aialra-v3-corrected-summary.md`.
  Final corrected result: 24 cases, total score 452, patch quality average 58,
  23/24 completed, 20/24 non-empty patches, 4/24 zero patches, 7/24 official
  verified passes, 13/24 official verification attempts, 1 progress-aware
  logical timeout, 0 approval stalls, and 24/24 turn terminal events.
- Fixed two benchmark runner correctness issues discovered during the full-24
  gate. Repair verification now writes and reads attempt-specific official
  harness directories such as `official-harness-repair-1`, so a repair run
  cannot accidentally reuse the initial failed report. Repository mirror cache
  promises are now revalidated on disk before reuse, so manual disk cleanup
  cannot leave the runner pointing at a deleted bare mirror.
- Added a TurnContext search-scope gate for `glob` and `grep`. Recursive search
  outside the selected environment workspace now goes through
  `tool.sandbox.denied` for workspace-scoped profiles instead of allowing a
  model to accidentally scan `/` and stall a high-difficulty task.
- Added corrected benchmark rerun reports for the infrastructure-affected rows:
  `real-benchmark-202605312120-full24-aialra-v3-rerun-infra.md` and
  `real-benchmark-202605312120-full24-aialra-v3-rerun-infra-results.json`.
  These replace the two rows where a manual repo-cache cleanup caused worktree
  preparation failures, and the corrected summary clearly marks those rows as
  `infra rerun`.
- Added the AIALRA General Engineering Harness V3 planning set under
  `aialra/turn-observability/project-plans/v3-general-engineering-harness/`.
  The folder contains a master plan plus 16 per-target project plans so future
  implementation can resume from files instead of depending on chat context.
- Started V3 engineering defect closure. Engineering controls now include
  `zeroPatchRecoveryMax`, exposed in Sandbox Control Center advanced settings.
  Engineering turns that are expected to produce a diff but try to finish before
  any write-like tool activity now emit `engineering.zero_patch.detected`,
  request repair through `engineering.zero_patch.recovery_requested`, and
  eventually emit `engineering.zero_patch.exhausted` when the user-configured
  recovery budget is spent.
- Added terminal reconciliation visibility. Completed turns now emit
  `turn.terminal.reconciled`, and empty assistant finals emit
  `turn.terminal.anomaly` before the normal `turn.completed` event so users and
  benchmark reports can distinguish a clean final from an empty-output anomaly.
- Extended Turn Inspector labels and summaries for zero-patch recovery and
  terminal reconciliation events.
- Extended the real benchmark report with patch quality scoring. Reports now
  include a per-target average quality score and per-case explanations for
  verification status, non-empty patch, source-file relevance, test-file
  changes, patch size, generated-file churn, clean terminal state, and repair
  success.
- Upgraded `EngineeringRun` to `aialra.engineering_run.v3`. Each engineering
  turn now carries structured artifacts: suspected files, edit plan,
  verification plan, verification results, repair feedback, and final summary.
  Updates emit `engineering.artifact.updated` so Turn Inspector can explain what
  the agent has learned or changed without showing raw JSON first.
- Tightened zero-patch recovery. The prompt loop now checks `git status
  --porcelain` from the selected environment cwd before accepting a final answer.
  If the model called write-like tools but the workspace still has no diff or
  untracked file, the harness feeds the zero-patch problem back into repair.
- Extended TurnContext parity fields and trace output with `approvals_reviewer`,
  `effort`, `summary`, `service_tier`, `selected_environment_id`,
  selected-environment cwd, and `http_context`. Path resolution now uses the
  selected environment cwd instead of only the legacy single cwd string.
- Extended approval audit scope. The six approval buttons now send an auditable
  scope such as `turn-command`, `turn-all`, `always-command`, or `always-all`;
  public events and Turn Inspector can distinguish what the user actually chose.
- Added Codex exec-server adapter entry points for `fs/copy` and `http/request`
  and mapped exec-server HTTP phases into the public event stream. These are
  protocol adapters; product use still depends on the sidecar supporting the
  corresponding method.

- Completed AIALRA General Engineering Harness v2 validation. Regression-6 run
  `20260531080150` improved the AIALRA DeepSeek V4 Pro max target from the prior
  3/6 baseline to 4/6 verified passes, so the release gate allowed an
  AIALRA-only full-24 run.
- Completed AIALRA-only full-24 run `20260531093837` with DeepSeek V4 Pro max.
  Final result: 24/24 completed, 6/24 verified passes, 18/24 non-empty patches,
  0 approval stalls, 0 timeouts, 0 benchmark runner infrastructure errors, and
  total scored result 417. The full report is
  `aialra/turn-observability/real-benchmark-reports/real-benchmark-20260531093837.md`.
- Fixed benchmark runner false failures discovered during full-24. OpenCode
  startup wait now defaults to 30 minutes, `RERUN_TIMED_OUT` can rerun
  progress-aware timeout rows, and cleanup retry failures no longer overwrite a
  real agent result with an `ENOTEMPTY` infrastructure error.
- Added `engineering.phase_gate.premature_final`. When a model finds the likely
  fix but stops to ask whether it should proceed, the harness now records the
  event, injects a bounded continuation reminder, and keeps the turn moving
  toward a minimal edit and validation instead of accepting the premature final
  answer.
- Added AIALRA General Engineering Harness v2 planning and first implementation pass. EngineeringRun now stores feedback items for verification failures, loop checkpoints, and phase gates, so repair reminders can include the concrete failure summary instead of generic guidance.
- Added a real phase gate for engineering runs. When a bug/refactor/security task tries to call edit/write/apply_patch before any localization tool has run, the attempt is blocked, the run moves to plan, and Turn Inspector shows `engineering.phase_gate.blocked_tool`.
- Enhanced verification feedback. Failed validation commands now extract a concise failure summary and key output lines into public event data and encrypted raw audit still keeps the full command output.
- Added optional benchmark repair rounds to `run-real-benchmark.mjs`. `AIALRA_REAL_BENCH_REPAIR_ROUNDS=1` can feed verification failures back into the same AIALRA OpenCode session during regression-6 or full-24 runs, while default behavior remains unchanged.
- Added the V2 project plan and full-24 gate policy in `aialra/turn-observability/general-engineering-harness-v2-plan.md`. Full-24 should only run when regression-6 shows a real lift; otherwise the next step is V3 diagnosis rather than another expensive full run.
- Fixed new sessions missing from the native left sidebar. The session list now falls back to the current route directory while workspace path metadata is still loading, and the active session route forces a bounded refresh when the sidebar cache does not yet contain that session.
- Tightened the sidebar session fix for servers that report a very broad project root such as `/`. When workspace mode is off, the native left sidebar now displays and creates sessions for the active URL directory instead of filtering against the broad project root. Browser verification created session `ses_183203663ffe0ytgU8isGg0KnH` under `/srv/aialra/turn-harness-target` and confirmed it appeared in the left sidebar.
- Fixed Sandbox Control Center advanced engineering controls so the advanced section can be closed again. The frontend now sends only the changed engineering patch, and the backend no longer treats `advancedEnabled=false` as a mode reset.
- Restored the native OpenCode sidebar layout after the V2 titlebar/right-panel hotfix proved too broad. The app now defaults `newLayoutDesigns` to false, runs a one-time client setting migration back to the native layout, no longer forces file tree, Turn Inspector, or Sandbox Control Center panels into the V2 new-session page, and auto-opens the URL workspace in the sidebar so the expanded native sidebar is not blank.
- Added AIALRA General Engineering Harness v1, a shared engineering-control layer for all models. The new layer adds four user-facing modes: fast, balanced, deep, and long. Advanced budgets cover verification rounds, localization tool budget, repeated-tool thresholds, total tool calls, patch limits, output limits, no-progress minutes, and single-command timeout.
- Extended Sandbox Control Center with Engineering Controls. The main UI stays simple with one engineering mode selector; advanced numeric controls are hidden until explicitly enabled.
- Added internal `EngineeringRun` state with phases: intake, clarify, localize, plan, edit, verify, repair, finalize, and blocked. New public events include `engineering.run.started`, `engineering.phase.changed`, `engineering.verification.finished`, `engineering.stop_gate.activated`, `engineering.stop_gate.blocked_tool`, `engineering.loop.warning`, `engineering.loop.checkpoint`, `engineering.loop.blocked`, `engineering.reasoning.recorded`, and `engineering.run.finished`.
- Connected tool execution to the engineering gate. Repeated identical tool calls now emit warning/checkpoint/block events based on the user-selected mode. Total tool-call budgets are also enforced when configured.
- Added a verification-driven stop gate for shell commands that look like test or validation commands. When a command such as `npm test`, `pytest`, `bun test`, `go test`, `cargo test`, or `typecheck` exits successfully, the turn records verification success, enters finalize phase, and blocks further read/bash/edit/write/apply_patch style tool calls so the model must produce the final report.
- Recorded provider reasoning context availability through `engineering.reasoning.recorded`. This records size and metadata keys, not raw secrets; raw reasoning remains governed by the existing raw/audit policy.
- Added benchmark tiering to `run-real-benchmark.mjs`: `AIALRA_REAL_BENCH_TIER=smoke`, `regression-6`, or `full-24`. This lets us run cheap daily smoke checks, medium regression checks, and full expensive release benchmarks separately.
- Added benchmark cleanup and Claude Code + DeepSeek PoC entry scripts. Cleanup is dry-run by default and only deletes with `AIALRA_BENCH_CLEANUP_APPLY=1`. The Claude Code PoC records missing environment prerequisites instead of pretending the comparison is complete.
- Added focused tests for EngineeringHarness lifecycle, verification stop gate, repeated-tool intervention, and public security event updates.
- Deployed version `0.0.0-dev-202605310521` to `opencode.aialra.online`. `aialra-opencode-web.service`, `aialra-opencode-login.service`, and `aialra-codex-exec-server.service` were restarted and active. E2E smoke passed, and `/config`, `/question`, `/project/current`, `/command`, `/session/status`, `/provider`, and `/lsp` returned 200 from the authenticated origin smoke.
- Deployed sidebar follow-up version `0.0.0-dev-202605310658` to `opencode.aialra.online`. `aialra-opencode-web.service`, `aialra-opencode-login.service`, and `aialra-codex-exec-server.service` were active, and the deployment smoke passed after the web service finished binding its port.
- Deployed final V2 validation version `0.0.0-dev-202605311418` to
  `opencode.aialra.online`. Engineering, prompt, observability, exec-server,
  sandbox, typecheck, app build, single-binary build, deployment build, and e2e
  smoke all passed. Web, login, and Codex exec-server services were restarted
  and active.

## 2026-05-30

- Completed the first full 24-case high-difficulty real benchmark matrix across
  five max-effort combinations: Codex CLI `gpt-5.5` with `xhigh`, debug1
  original OpenCode with Kimicode, AIALRA OpenCode with Kimicode, debug1
  original OpenCode with DeepSeek V4 Pro `max`, and AIALRA OpenCode with
  DeepSeek V4 Pro `max`.
- The final run `20260530071350` produced 120/120 results with no duplicate rows
  and no remaining infrastructure errors after targeted reruns. The corrected
  report no longer treats a fixed wall-clock budget as a benchmark timeout:
  all legacy fixed-time timeouts were rerun or reclassified, leaving 0 fixed
  timeouts and 9 progress-aware logical stalls. Codex CLI resolved 7 verified
  cases, AIALRA DeepSeek V4 Pro resolved 5, debug1 DeepSeek V4 Pro resolved 6,
  debug1 Kimicode resolved 3, and AIALRA Kimicode resolved 3.
- Added progress-aware benchmark timeout detection. The runner now distinguishes
  slow-but-working runs from real stalls by tracking message growth, tool calls,
  public events, and git diff changes. It also detects non-productive tool churn
  where the patch stops changing but the agent keeps issuing tool calls, as seen
  in the final AIALRA Kimicode Element Web case.
- Added benchmark runner resume and cleanup support. `AIALRA_REAL_BENCH_RUN_ID`
  resumes an existing run, completed target worktrees and official harness
  scratch directories are removed by default, `AIALRA_REAL_BENCH_KEEP_WORKTREES=1`
  preserves them, and `AIALRA_REAL_BENCH_DOCKER_PRUNE=1` can prune unused Docker
  artifacts after each job.
- Added timeout protection to benchmark HTTP JSON requests so unhealthy OpenCode
  provider endpoints cannot hang the whole run during target validation.
- Added the full benchmark report and machine-readable results under
  `aialra/turn-observability/real-benchmark-reports/`, plus a dedicated analysis
  report explaining pass rates, timeout/zero-patch behavior, architecture gaps,
  and the next harness direction.
- Added the first real benchmark execution runner. The runner loads the
  benchmark manifest, fetches the full public problem statement and test patch,
  clones the real GitHub repository, checks out the recorded base commit, runs
  Codex CLI, debug1 original OpenCode, and the AIALRA fork on isolated worktrees,
  saves each model patch, and writes a scored Markdown report.
- Ran the first real three-way SWE-bench Lite task, `psf__requests-2674`, across
  all three targets with parallel execution. AIALRA OpenCode and Codex CLI both
  resolved the task under the official SWE-bench Docker harness; debug1
  original OpenCode completed but did not resolve the task.
- Hardened the real benchmark runner so a missing local test executable records
  a verification failure instead of crashing the whole run.
- Added a real agent benchmark case selector for A/B planning. The selector
  pulls public rows from SWE-bench Verified, SWE-bench Lite, and SWE-bench Pro,
  scores them by difficulty, fail-to-pass coverage, pass-to-pass coverage,
  patch/test complexity, and prompt-token balance, then writes a traceable
  Markdown and JSON manifest under `aialra/turn-observability/benchmark-cases/`.
- Added `AIALRA_AB_PARALLEL` to the three-way A/B runner so smoke and benchmark
  runs can execute multiple target/case jobs concurrently when model provider
  rate limits allow it. The runner now gives every target/case pair a unique
  outside-workspace probe path, so parallel runs do not contaminate one another.
- Updated the harness playbook to separate smoke/harness checks from high
  difficulty benchmark selection, and to state clearly that the new SWE-bench
  manifest is a selection step, not a completed official SWE-bench execution.
- Restored AIALRA session toolbar buttons in the upstream V2 titlebar branch.
  The left project/sidebar toggle, terminal, file tree, Turn Inspector, and
  Sandbox Control Center controls are now present in the new layout path as
  well as the old layout path.
- Polished Sandbox Control Center styling to match the surrounding OpenCode
  side panels more closely. The panel now uses divider sections instead of
  stacked gray cards, keeps controls compact, and still avoids Chinese full
  stops in touched UI strings.
- Added explicit session security policies for `networkPolicy` and
  `commandPolicy`. The default is now workspace-write, approval on request,
  network ask, command ask, Codex executor, and step budget disabled.
- Made the default command/network policies real backend behavior. Bash now
  asks for command approval when `commandPolicy=ask`, detects common network
  commands such as curl/npm/git clone, asks for `network` approval when
  `networkPolicy=ask`, and only opens the bwrap network namespace for that
  approved command.
- Fixed approval audit payload loss in `Permission.ask`. Approval requests now
  preserve turnID, approval policy, permission profile, sandbox policy, and
  tool call metadata when they enter the bus and public event stream.
- Added public event support for `sandbox.command.changed` and Chinese Turn
  Inspector summaries for command policy changes.
- Added tests proving the new defaults are not UI-only: shell command policy
  asks before a normal command, network policy asks before a network command,
  Sandbox Control Center changes emit audit events, and prompt/schema still
  passes 90 tests.
- Deployed `0.0.0-dev-202605292231`. Web, login, and Codex exec-server
  services are active; e2e smoke passed; API smoke returned 200 for config,
  question, project/current, command, session/status, provider, lsp,
  session message, and session security.
- Routed bash commands that already have a `TurnContext` through the turn
  sandbox gates instead of the legacy shell-pattern approval layer. This keeps
  no-turn OpenCode compatibility, preserves explicit `commandPolicy=ask`
  approvals, and fixes the A/B natural sandbox/network cases that previously
  stopped at a generic approval prompt.
- Added `AIALRA_AB_CASES` to the A/B harness so a failed subset can be
  re-run by case id without burning the full benchmark. Targeted AIALRA re-run
  `ab-comparison-20260530035321.md` covers `14-sandbox-natural` and
  `15-network-natural`; both now complete with no approval wait, no outside
  write, a turn terminal state, and score 15/15.
- Deployed `0.0.0-dev-202605300438`. Web, login, and Codex exec-server
  services are active; e2e smoke passed 11 tests; API smoke returned 200 for
  config, question, project/current, command, session/status, provider, and lsp.

## 2026-05-29

- Synced the fork with the latest upstream OpenCode `dev` branch. The merge
  includes upstream ACP promotion and stats fixes, while preserving the AIALRA
  TurnContext, sandbox, exec-server, public event, and UI control layers.
- Changed the weak-model step budget from a default hard 80-step stop into an
  explicit Sandbox Control Center option. The default is now unlimited unless
  `agent.steps`, `AIALRA_TURN_MAX_STEPS`, or the user-enabled step budget says
  otherwise.
- Added session security fields and public event support for
  `turn.step_budget.changed`, with tests proving Sandbox Control Center changes
  can live-update tool gates.
- Reworked approval UI actions into six clear choices: reject, allow once,
  allow this command for this turn, allow all commands for this turn, always
  allow this command, and always allow all commands. The current-turn choices
  are remembered by the Web client without bypassing filesystem or network
  sandbox gates.
- Hardened the login proxy against transient upstream failures. Idempotent API
  requests retry once after socket reset, upstream failures return compact JSON
  or text 503 responses instead of large HTML error pages, and SDK client
  errors redact Cloudflare-style HTML pages into short readable messages.
- Polished Sandbox Control Center copy: removed the duplicate current-directory
  subtitle, removed non-interactive audit/advanced blocks, clarified live
  effect scope, renamed `disabled` to “关闭内置门禁”, and removed Chinese full
  stops from touched UI strings.
- Removed the visible folded-history notice from Turn Inspector. Old turns
  still collapse by default, but the UI no longer renders the extra “已折叠历史回合日志” box.
- Updated the A/B harness report format with scoring rules, per-case scores,
  and full prompt text for every scenario.
- Fixed the A/B harness timeout path so a stuck child process kills the whole
  child process group, records a timeout, and lets the report finish instead
  of wedging the comparison runner.
- Re-ran the full 15-case A/B harness after the timeout fix. Report
  `ab-comparison-20260529211021.md` ranks AIALRA OpenCode first by total score
  at 301, Codex CLI second at 292, and debug1 original OpenCode third at 289.
  AIALRA had 15/15 turn terminals and 0 outside writes, but still waited for
  approval in the natural sandbox and network cases, so approval/reviewer
  product behavior remains unfinished.
- Verified the full regression set after the upstream merge and UI/security
  changes: prompt/schema 90 pass, public-event HTTP 4 pass, exec-server plus
  sandbox/external-directory 28 pass, login proxy 6 pass, app/opencode
  typecheck, app build, and opencode single-binary build.
- Added a Kimi performance investigation report and applied the simple config
  fix of adding explicit `timeout` and `chunkTimeout` to the Kimi provider.

## 2026-05-19

- Split Sandbox Control Center（沙盒控制中心） out of Turn Inspector（回合检查器）
  into its own right-side panel and header button. Users now control execution
  rules in a separate Chinese UI with dropdowns for 权限档位、审批策略、网络访问、
  命令执行, and 执行后端, while Turn Inspector stays focused on explaining what
  happened in the current turn.
- Added session security endpoints:
  `GET /session/:sessionID/security` and
  `PATCH /session/:sessionID/security`. Changes are audited through public
  events: `sandbox.profile.changed`, `sandbox.network.changed`,
  `approval.policy.changed`, `executor.backend.changed`, `environment.selected`,
  and the new unified audit event `sandbox.control.changed`.
- Wired saved security settings into new `UserTurn`/`TurnContext` creation and
  live tool gates. File and bash tools now consult the same session security
  settings when a user changes permissions or network access in the UI. Purely
  reading the executor preference no longer creates default security state, so
  explicit test/user TurnContext values are not overwritten.
- Added Codex exec-server `fs/readDirectory` support and routed the read tool's
  directory listing path through `CodexFs.readDirectoryEntries` when the Codex
  backend is enabled. File reads/writes and directory listing now share the same
  controlled exec-server filesystem channel.
- Expanded Turn Inspector filters and Chinese summaries to cover model, sandbox,
  network, and executor events. The panel now includes a “跳到最新” control and
  keeps raw expansion state stable when new log events arrive.
- Upgraded the A/B harness from toy prompts to layered evaluation. Smoke cases
  remain for service health, but the main score now comes from SWE-style local
  repositories with failing tests and vague, colloquial prompts that do not
  name files, functions, or commands. The first fixture set covers date
  boundary regressions, empty-input handling, parser escaping, stale cache,
  CLI override behavior, cwd path handling, minimum regression tests, and
  weak-model loop risk.
- Re-ran the nine-prompt A/B harness. The latest report
  `ab-comparison-20260519201455.md` shows Codex CLI and AIALRA OpenCode both
  at 9/9 success with 0 stuck turns, 0 approval waits, 0 outside writes, and
  9/9 turn terminals; debug1 original OpenCode remains 5/9 because several
  outside-write and loop-risk cases still stop at approval or lack terminal
  turn evidence.
- Verified the Linux sandbox probe again on the current host: kernel
  `6.8.0-106-generic` has Landlock configured and ordered in LSM, bwrap
  `0.9.0` is available, but this container currently denies bwrap user/network
  namespace setup and `/proc` mounts. The Codex Linux sandbox helper still
  enforces workspace-write in the real write probe.
- Added explicit bwrap user-namespace and network-namespace probes. When a
  container exposes `/usr/bin/bwrap` but cannot create the needed namespaces,
  OpenCode no longer blindly adds failing bwrap flags that make ordinary bash
  commands fail; the public event stream records the degraded network sandbox
  capability instead.
- Stabilized the full `prompt.test.ts` + `schema-decoding.test.ts` regression
  command. The previous shell cancel/concurrency failures were caused by test
  readiness timing and hard timeout windows, not by exec-server fallback or
  session idle cleanup. The full 90-test command now passes under the required
  30-second per-test timeout.
- Connected `read`, `write`, `edit`, and `apply_patch` file content paths to
  the Codex exec-server filesystem API when `AIALRA_EXEC_BACKEND=codex` and a
  turn context is present. The OpenCode TurnContext gates still run first, and
  exec-server transport failures emit fallback events before using the existing
  Node/Bun filesystem executor. Codex RPC sandbox rejections do not silently
  fallback.
- Added a stable Codex exec-server systemd sidecar:
  `aialra-codex-exec-server.service`, listening on `ws://127.0.0.1:12650`,
  with logs under `/srv/aialra/logs/codex-exec-server/service.log`. The AIALRA
  OpenCode service now connects to this sidecar by default and keeps Node/Bun
  fallback for availability.
- Added public event mappings and Chinese Turn Inspector summaries for
  exec-server filesystem operations, so users can see when Codex exec-server
  handled `fs/readFile`, `fs/writeFile`, `fs/createDirectory`, or `fs/remove`.
- Updated the latest exec-server event summaries to include `fs/readDirectory`
  after directory listing moved onto the Codex filesystem API.
- Expanded profile parity tests to cover `disabled`, `external`, and bash
  network isolation behavior in addition to read-only, workspace-write,
  full-access, protected metadata, symlink escape, and bwrap behavior.
- Upgraded the Linux sandbox probe from kernel-only Landlock guessing to an
  actual Codex Linux sandbox write test. The current host has Landlock compiled
  in and ordered in the LSM list; Codex's Linux sandbox helper can enforce
  workspace-write on this host, while this Node probe still does not itself
  apply Landlock syscalls.
- Reduced stale terminal 404 noise in the Web UI. Workspace terminal state now
  validates persisted PTY ids against the server on startup and removes ids
  that no longer exist, so a server restart should not leave the browser
  repeatedly opening WebSockets for missing terminal sessions.
- Reduced duplicate approval/question notifications in the Web UI. The
  notification path now skips the current visible session before playing
  sounds or posting system notifications, suppresses duplicate pending prompts
  for the same session, and fingerprints equivalent permission requests for a
  short cooldown window.
- Expanded the A/B harness from five strict prompts to seven prompts by adding
  colloquial and emotional real-use cases. Reports now include per-case and
  overall "who is better and why" conclusions, not only raw tables.
- Re-ran the seven-prompt A/B harness after deploying the exec-server FS and
  sandbox changes. The latest report
  `ab-comparison-20260519153559.md` shows Codex CLI and AIALRA both at 7/7
  success with 0 stuck turns, 0 approval waits, 0 outside writes, and 7/7 turn
  terminals. debug1 original OpenCode remains 4/7 because it waits for
  approval and lacks terminal turn evidence in the outside-write and mixed
  scenarios.
- Routed legacy external-directory checks through TurnContext sandbox decisions
  when a turn context is present. This keeps workspace-write outside writes
  denied, but lets safe read-only verification of an outside path finish
  without hanging the turn on an OpenCode legacy `external_directory` approval.
- Deployed an isolated original OpenCode control group at
  `debug1.aialra.online`. It uses independent ports, systemd services, data
  directories, environment file, logs, nginx vhost, TLS certificate, login
  proxy, and Sensenova bridge, so AIALRA fork behavior can be compared against
  upstream behavior without sharing runtime state.
- Added a three-way A/B comparison harness for original Codex CLI, debug1
  original OpenCode, and the AIALRA OpenCode fork. The harness runs fixed
  prompts under `/srv/aialra/turn-harness-target`, records stuck/approval/turn
  terminal/cwd/sandbox/tool-count/duration/explainability metrics, and writes
  Markdown reports under `aialra/turn-observability/ab-reports/`.
- Diagnosed the previous Codex exec-server WebSocket failure. The globally
  installed `codex-cli 0.125.0-alpha.3` prints a WebSocket URL but does not
  complete the expected HTTP 101 handshake for the current client. A local
  source build from `/srv/aialra/apps/codex-turn-engine/codex-rs` does expose a
  working `/readyz`, `initialize`, and `process/start/read` protocol. The AIALRA
  fork now points `AIALRA_EXEC_BACKEND=codex` at that source-built binary for
  bash execution, with explicit fallback events if the sidecar cannot be used.
- Fixed a Linux bwrap protected-metadata race. Concurrent bash commands no
  longer remove each other's synthetic read-only `.git`, `.agents`, or `.codex`
  mount points while another command is still starting.
- Fixed Turn Inspector raw payload expansion. The backend raw endpoint was
  already returning 200, but the Solid store update kept the previous
  `loading=true` flag when merging the successful payload. Raw success and
  failure states now clear `loading`, so the UI shows the JSON payload or an
  error instead of spinning forever.
- Improved Turn Inspector browsing behavior. A new turn auto-expands while
  older turns auto-collapse by default, preserving manual expansion for
  historical debugging and reducing long-session rendering pressure.
- Reduced duplicate desktop/system notifications for session idle/error and
  permission prompts by deduping terminal and approval notification keys.
- Strengthened the Linux bash sandbox. OpenCode now records bwrap/Codex
  helper/Landlock capability details, uses more Codex-like bwrap flags, skips
  `/proc` mounting in containers that reject it, and protects missing
  `.git`, `.agents`, and `.codex` paths with read-only synthetic mounts so bash
  cannot create those metadata directories.
- Added `tool.sandbox.capability`, `turn.budget_limited`,
  `turn.repeated_tool.warning`, and exec-server adapter trace/public-event
  mappings so Turn Inspector can explain sandbox capability checks, weak-model
  loop budgets, repeated tool patterns, and executor fallback.
- Added a Codex exec-server compatibility adapter with initialize/initialized,
  process start/read/terminate support, an optional `AIALRA_EXEC_BACKEND=codex`
  shell path, and fallback to the current Node/Bun executor when the sidecar is
  unavailable. The local installed Codex CLI currently advertises exec-server
  but fails WebSocket handshake, so this backend is not enabled by default.
- Added first-pass weak-model loop protection. Turns now have a default hard
  agent-loop budget of 80 steps, configurable with `AIALRA_TURN_MAX_STEPS`;
  exceeding it writes an assistant error, emits Codex reason `budget_limited`,
  and returns the session to idle.
- Added Linux sandbox capability probing via
  `aialra/turn-observability/scripts/probe-linux-sandbox.mjs` and expanded
  profile parity tests for read-only, workspace, full-access, protected
  metadata, and bwrap behavior.

## 2026-05-18

- Turn Inspector user experience fix: localized the panel, filters, statuses,
  button tooltip, and command palette action into Chinese; grouped events by
  turn with visible separators; added bottom-pinned auto-scroll that only
  follows new output when the user is already at the bottom; and added a
  12-second timeout plus Chinese error text for raw payload expansion.
- Public event stream reliability fix: session/public SSE now emits an
  immediate `ping` event and periodic 20-second pings so Cloudflare does not
  close quiet streams with 524. Tests now skip ping frames and wait for the
  first real `aialra.public_event.v1` event.
- Browser/CSP fix: UI CSP now allows same-origin workers via
  `worker-src 'self' blob:` and allows the Cloudflare beacon script. The login
  proxy applies the same worker/child-src allowances and lets manifest/icon
  files pass through without showing the login HTML, so `/site.webmanifest`
  returns valid JSON before and after login.
- Implemented the first public turn event stream. Added
  `aialra.public_event.v1`, replay buffers, `GET /event/public`,
  `GET /session/:sessionID/events/public`, and
  `GET /session/:sessionID/events/:eventID/raw`. Internal turn traces now feed
  the public event log even when JSONL tracing is disabled, while the legacy
  `/event` stream remains unchanged.
- Added encrypted raw event audit support. Safe public events contain only
  summaries and bounded structured fields; raw trace/bus payloads are stored via
  `rawRef`, encrypted with `AIALRA_EVENT_AUDIT_KEY` when configured, or kept
  in bounded memory with an `audit.encryption.unavailable` warning when the key
  is missing. The memory fallback defaults to 64 KiB per raw payload via
  `AIALRA_EVENT_MEMORY_RAW_LIMIT_BYTES`, and the audit directory is ignored by
  git.
- Added Turn Inspector UI in the session right panel. The header now has a
  Turn Inspector toggle next to the file tree toggle, layout state persists
  `layout.turnInspector.opened` and `layout.turnInspector.width`, and the panel
  displays turn/model/tool/file/command/approval/final events with filters and
  authenticated raw payload expansion.
- Bound approval audit events to turn context. `Permission.Request` now accepts
  optional `turnID`, `approvalPolicy`, `permissionProfile`, and `sandboxPolicy`;
  tool-triggered permission asks fill these fields from the active
  `TurnContext`, and permission bus events map to
  `approval.requested/resolved` public events.
- Added a next-stage public event stream and exec-server roadmap. The design
  maps the current internal trace/bus events into a user-readable and
  machine-consumable event model, then uses that model as the data source for a
  Turn Inspector UI.
- Documented the Codex exec-server protocol, process model, filesystem sandbox
  model, environment abstraction, and Linux sandbox differences based on the
  local Codex source tree. The recommended migration path is a Rust exec-server
  sidecar with a TypeScript adapter and the current Node/Bun executor as a
  temporary fallback.
- Added the next validation plan for approval auditing, profile parity tests,
  Linux bwrap parity, Landlock evaluation, debug1 original-OpenCode A/B
  benchmarking, and Kimi/weak-model loop diagnosis.

## 2026-05-17

- Added Codex-style tool executor gates for turn-scoped filesystem and shell
  execution. `read`, `write`, `edit`, `apply_patch`, and `bash` now receive the
  active `TurnContext`; relative paths resolve from `TurnContext.cwd`, direct
  filesystem writes are checked against the turn permission profile and sandbox
  policy, symlink escapes are denied, and protected workspace metadata paths
  such as `.git`, `.agents`, and `.codex` are read-only under the workspace
  profile.
- Added Linux `bubblewrap` execution for `bash` under managed turn sandboxes.
  Shell commands run with the host root mounted read-only and only the turn's
  writable roots bound writable, so shell writes outside the turn workspace are
  blocked by the operating system instead of only by prompt-level permission
  checks.
- Added trace events `tool.sandbox.checked` and `tool.sandbox.denied`, plus
  direct tool tests and prompt-level tool execution tests that verify
  TurnContext cwd routing and sandbox denial behavior.

- Added the first Codex-style turn lifecycle events to OpenCode prompt turns:
  `turn.started`, `turn.completed`, and `turn.aborted`. These are emitted on
  the session bus and mirrored into the AIALRA trace stream.
- Added an internal `aialra.user_turn.v1` / `TurnContext` contract with Codex
  field names for cwd, approval policy, sandbox policy, permission profile,
  model, final output schema, collaboration mode, environments, and stream
  retry limits. This remains internal and does not change the public SDK,
  OpenAPI, prompt schema, or database schema.
- Added the first permission-profile enforcement bridge: `approval_policy=never`
  converts existing ask rules into deny rules, and read-only profiles deny
  write/edit/shell/apply-patch style actions before tool execution.
- Added Codex-compatible provider options:
  `request_max_retries`, `stream_max_retries`, and `stream_idle_timeout_ms`.
  `stream_idle_timeout_ms` takes precedence over legacy `chunkTimeout`, while
  `chunkTimeout` remains supported for existing OpenCode configs.
- Wired model processing to Codex-style retry accounting. Request failures use
  `request_max_retries`; stream failures such as idle aborts, reset connections,
  or streams that close without a terminal finish use `stream_max_retries` and
  emit `model.stream.retrying`.
- Ensured prompt turn terminal events set session status back to idle, so a
  prompt turn should no longer remain in an endless "thinking" state without a
  `turn.completed` or `turn.aborted` event.
- Extended trace documentation and renderer samples to include `turn.context`,
  lifecycle events, and stream/request retry events.

## 2026-05-16

- Added the first Codex-style prompt intake frame for OpenCode turns. Each
  prompt now creates an internal `aialra.turn_frame.v1` structure with route,
  model, agent, explicit context labels, part counts, and non-synthetic text
  length, without adding public API or database schema changes.
- Added server-side explicit context completion for raw text prompts. API,
  paste, and command prompts that include clear `@file`, `@agent`, or configured
  `@reference` mentions now reuse the existing OpenCode resolver and append only
  missing synthetic parts, while keeping the original text unchanged.
- Extended turn traces with top-level `turnID`, `prompt.explicit_context_resolved`,
  and `turn.frame.created`, and propagated `turnID` through loop, model,
  processor, stream, tool, and final events.
- Updated observability docs and renderer tests so timelines can compare a full
  prompt intake to final response chain by turn.

## 2026-05-15

- Added the first OpenCode turn observability layer behind `AIALRA_TURN_TRACE`.
- Added JSONL trace events for prompt entry, user message creation, run-loop
  decisions, assistant message creation, tool resolution, model context build,
  processor lifecycle, model stream steps, text part boundaries, and tool calls.
- Added `aialra/turn-observability/` docs, schema notes, ignored local trace
  storage, a timeline renderer, and renderer tests.
- Updated deployment scripts to default `AIALRA_TURN_TRACE_DIR` to
  `aialra/turn-observability/traces` when tracing is enabled.
- Added fork-build-aware deployment scripts and tracked systemd unit templates
  so `opencode.aialra.online` can run the fork binary instead of the pinned
  upstream npm runtime.
- Deployed the fork binary to the server, enabled structural turn traces in the
  web service, and recorded verification in
  `aialra/turn-observability/verification-2026-05-15.md`.

## 2026-06-01

- Added turn abort source auditing with `turn.abort.requested` and `turn.abort.resolved` public events. Stop button, prompt Escape, prompt Ctrl+G, empty-submit stop, route halt, API, benchmark runner, system reconciler, and unknown sources are now represented explicitly.
- Replaced hard-coded shell abort metadata with structured abort metadata that records source, source label, actor, request id, and reason.
- Added real-time `command.output` public events for bash output chunks and added `sandbox.effective` events so users can see the actual cwd, policy, approval, command, and network settings that reached backend execution.
- Added `http.request.classified` events for webfetch/http so non-2xx target responses, timeouts, and network-policy denial are distinguishable in Turn Inspector.
- Added Raw Lab to Turn Inspector and `GET /session/:sessionID/raw-lab` for unified public event, rawRef, trace JSONL, DB message, and DB part inspection with search and JSON download.
- Expanded EngineeringRun deployment classification and stop-gate verification command recognition to include deployment, UI/e2e, build, lint, health-check, Docker, and systemd commands.
- Limited Codex exec-server default execution to real TurnContext-backed tool calls so legacy/internal calls without a turn do not accidentally use the sidecar.

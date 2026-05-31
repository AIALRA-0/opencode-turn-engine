# AIALRA General Engineering Harness V3 Master Plan

## Status

- Created: 2026-05-31
- Scope: planning first, implementation after plan calibration
- Rule: this file is the root checkpoint for V3 work

## Original User Requirement Snapshot

The user requested that before executing the long task list, every target must receive its own detailed project plan file so the work does not depend on chat context. After planning, implementation should proceed end to end, periodically re-reading the plans and the original prompt to prevent context drift.

The 16 requested targets are:

1. Turn terminal reconciler
2. TurnContext and Codex UserTurn semantic parity
3. File tools fully converged to exec-server FS API
4. Environment-scoped cwd
5. Outside-workspace write audit
6. Linux sandbox parity with Codex source
7. Exec-server as default backend for process, FS, HTTP
8. Stable public event stream protocol
9. Productized Turn Inspector
10. Approval reviewer semantics
11. EngineeringRun V3 structured artifacts
12. Verification feedback loop
13. Stop gate completion
14. Zero patch recovery
15. Patch quality scoring in benchmark reports
16. Benchmark gate: tier-regression-6 before full-24

## First-Principles Goal

AIALRA should not rely on a model "being smart enough" to behave like a good coding agent.

The harness must enforce the basic engineering loop:

```text
understand -> locate -> plan -> edit -> verify -> repair -> stop -> report
```

For every user prompt:

```text
one turn starts
the turn owns cwd, permissions, sandbox, model, approvals, execution backend, events, and engineering state
tools cannot bypass the turn contract
verification failures return to the model as concrete feedback
success stops further tool churn
zero patch is treated as an engineering failure unless the task is explicitly analysis-only
the user can see what happened in plain language
```

## Execution Order

The implementation order is intentionally not the same as the user list. The order below reduces risk and gives earlier measurable wins.

1. Terminal reconciler and zero patch recovery
   - closes unfinished turn and empty-output failures first
   - directly addresses benchmark defects
2. EngineeringRun V3, verification feedback, stop gate
   - makes the agent loop self-correcting
3. Patch quality scoring and benchmark gate
   - lets us measure whether changes helped without burning full benchmark cost
4. TurnContext parity and environment-scoped cwd
   - strengthens the per-turn contract
5. FS API convergence, outside-write audit, exec-server default backend
   - strengthens execution guarantees
6. Linux sandbox parity
   - deeper hard isolation, Linux-first
7. Public event protocol, Turn Inspector productization, approval reviewer semantics
   - converts internals into user-visible, auditable product behavior

## Required Work Pattern

For every target:

1. Re-read its plan file
2. Inspect current implementation before edits
3. Implement the smallest coherent slice that reaches the stated behavior
4. Add or update tests
5. Update docs and changelog
6. Run relevant tests
7. Record result and any deviation in this plan folder or the status playbook

## Global Test Commands

These commands are the default post-implementation regression set unless a stage says otherwise:

```bash
bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000
node --test aialra/turn-observability/tests/*.test.js
AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun --cwd packages/opencode test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000
bun --cwd packages/opencode typecheck
bun --cwd packages/app typecheck
bun --cwd packages/app build
bun --cwd packages/opencode build --single
git diff --check
```

## Benchmark Gate

Do not immediately run the full five-combination benchmark.

Run this first:

```text
tier-regression-6
target: AIALRA DeepSeek V4 Pro max only
success condition: verified pass improves or zero patch decreases
```

Only then run:

```text
full-24 AIALRA-only
```

Five-combination full benchmark is reserved for release-level comparison.

## Documentation Requirements

Every stage must update, as relevant:

- `aialra/CHANGELOG.md`
- `aialra/assistant-output-log.md`
- `aialra/turn-observability/harness-status-and-test-playbook.md`
- `aialra/turn-observability/trace-schema.md`
- public event stream documentation
- benchmark report output

Each update must answer:

```text
原来是什么
现在是什么
和 Codex 还差什么
用户怎么观察
测试结果是什么
是否已经部署
```

## Completion Criteria

V3 is not complete until:

- every `turn.started` has exactly one terminal outcome
- zero patch is recovered or explicitly blocked for engineering tasks
- verification failure returns as structured repair feedback
- verification pass activates stop gate
- patch quality is scored and explained in benchmark reports
- tier-regression-6 has run and been compared with baseline
- all new behavior appears in public events and Turn Inspector where user-facing
- docs, tests, commit, push, and deployment are done

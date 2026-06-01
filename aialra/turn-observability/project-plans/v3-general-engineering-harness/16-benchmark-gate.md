# 16 Benchmark Gate Plan

## Original Task

所有都完成后，先跑 tier-regression-6，只跑 AIALRA DeepSeek V4 Pro max。若 verified pass 提升或 zero patch 下降，再跑 full-24 AIALRA-only。不要一上来跑五组合大测。

## Human Goal

不要每次大改都烧完整 benchmark 成本。

先用较小但有代表性的回归集判断：

```text
有没有变好
有没有变差
是否值得跑 full-24
```

## Benchmark Tiers

### tier-smoke

- fastest
- 3 to 5 cases
- used after small code changes

### tier-regression-6

- default V3 gate
- AIALRA DeepSeek V4 Pro max only
- tests hard cases from previous failures
- expected to show zero patch and validation feedback impact

### full-24 AIALRA-only

- run only if regression gate improves
- measures total AIALRA quality after V3

### full-24 five-combo

- expensive release comparison
- Codex xhigh
- debug1 Kimicode max
- AIALRA Kimicode max
- debug1 DeepSeek V4 Pro max
- AIALRA DeepSeek V4 Pro max

## Gate Rule

Hard gate:

```text
Do not run regression-6 until all 16 V3 implementation targets are 完全完成.
Do not run full-24 until the post-completion regression-6 gate passes.
```

The runner enforces this by reading:

```text
project-plans/v3-general-engineering-harness/status.json
```

If any target is `未开始`, `部分完成`, or `核心完成`, `regression-6` and `full-24` exit before cloning repos or calling models.

After 16/16 are complete, run full-24 AIALRA-only only if:

```text
verified pass count improves
or zero patch count decreases
```

If not:

```text
do not burn full-24
write failure analysis
create V4 plan
```

## Required Metrics

- verified pass
- completed
- terminal clean
- zero patch
- patch quality score
- tool count
- duration
- approval stalls
- timeout or logic deadlock
- repair attempts
- stop gate activations
- feedback items

## Report Requirements

Report must include:

- exact prompts
- model and effort
- case IDs
- worktree paths
- score table
- quality explanation
- failure reason
- delta versus previous baseline
- recommendation to run or skip full-24

## Cleanup

Before big runs:

- remove old worktrees beyond retention
- keep markdown reports
- keep JSON summaries
- keep key failure logs
- delete orphan processes

## Milestones

1. Ensure tier-regression-6 manifest is current
2. Add hard 16/16 completion gate to benchmark runner
3. Add quality score to report
4. Add cleanup command if missing
5. Mark every implementation target 完全完成 in status.json
6. Run tier-regression-6
7. Decide full-24 AIALRA-only
8. Write comparison

## 2026-06-01 Post-Completion Regression Result

Run:

```text
20260601030607
```

Report:

```text
aialra/turn-observability/real-benchmark-reports/real-benchmark-20260601030607.md
```

Result:

```text
verified pass: 4/6
zero patch: 0/6
timeout: 0
approval stuck: 0
turn terminal: 6/6
patch quality average: 78
```

Baseline on the same 6 tasks:

```text
verified pass: 4/6
zero patch: 0/6
patch quality average: 77
```

Decision:

```text
full-24 remains blocked
```

Reason:

```text
verified pass did not improve
zero patch did not decrease
```

## Done Means

Benchmark cost is controlled, every expensive run has a written reason, and no benchmark can start before the 16 implementation targets are truly complete.

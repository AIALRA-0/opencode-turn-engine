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

Run full-24 AIALRA-only only if:

```text
verified pass count improves
or zero patch count decreases
or patch quality score improves materially
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
2. Add gate rule to benchmark runner
3. Add quality score to report
4. Add cleanup command if missing
5. Run tier-regression-6
6. Decide full-24 AIALRA-only
7. Write comparison

## Done Means

Benchmark cost is controlled, and every expensive run has a written reason.

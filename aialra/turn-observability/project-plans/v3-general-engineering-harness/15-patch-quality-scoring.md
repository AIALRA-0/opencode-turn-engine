# 15 Patch Quality Scoring Plan

## Original Task

benchmark 报告不能只看是否完成，要加入 patch 质量：是否改到相关文件、是否包含测试、patch 大小是否合理、是否验证通过、是否有零补丁、是否有无关大改。输出每题质量解释。

## Human Goal

评分不能只看“有没有结束”。

一个 agent 可能：

```text
跑完了
也写了 patch
但 patch 改错地方
或者乱改太多
或者没有测试
```

Benchmark report must explain quality, not just completion.

## Quality Factors

| Factor | Meaning |
| --- | --- |
| verified pass | 官方或项目测试是否通过 |
| non-zero patch | 是否真的有改动 |
| relevant files | 是否改到和问题相关的文件 |
| includes tests | 是否补或改了测试 |
| patch size sane | patch 是否过大或过小 |
| no unrelated churn | 是否避免无关大改 |
| no approval stall | 是否没有停在审批 |
| no terminal anomaly | 是否有正常终态 |
| repair used feedback | 是否根据失败反馈修正 |

## Score Proposal

Keep existing completion score but add:

```text
patchQualityScore: 0 to 100
```

Suggested weights:

- verified pass: 35
- non-zero patch: 15
- relevant files: 15
- includes tests when appropriate: 10
- patch size sane: 10
- no unrelated churn: 5
- terminal clean: 5
- feedback-aware repair: 5

## Relevant File Heuristic

Sources:

- files mentioned in problem
- files touched by tests
- stack trace files
- suspectedFiles from EngineeringRun
- official test patch paths if allowed only after agent run

Gold patch must not be visible to agent, but benchmark scorer may compare after run.

## Report Output

Each case must include:

```text
patch quality score
why this score
which files changed
whether tests were changed
patch size
unrelated churn warning
zero patch warning
```

## Tests

- zero patch scores low
- verified pass scores high
- huge unrelated patch penalized
- small relevant patch rewarded
- test addition rewarded when expected
- report includes explanation text

## Milestones

1. Define quality scoring schema
2. Implement scorer in benchmark runner
3. Add report tables
4. Add per-case explanation
5. Add JSON output
6. Add tests

## Done Means

The user can compare two agents that both “completed” and understand whose patch was actually better.

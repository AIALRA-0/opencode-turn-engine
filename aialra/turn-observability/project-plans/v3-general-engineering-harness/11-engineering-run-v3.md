# 11 EngineeringRun V3 Plan

## Original Task

请实现 EngineeringRun V3。每个阶段必须有结构化产物：intake schema、suspectedFiles、editPlan、verificationPlan、verificationResult、repairFeedback、finalSummary。阶段转换必须可测试。零补丁、空 final、无进展、验证失败都必须回流到 repair 或 blocked。

## Human Goal

工程 agent 不能只靠模型自由发挥。

每个工程任务都应该留下结构化轨迹：

```text
任务是什么
怀疑哪些文件
打算怎么改
怎么验证
验证结果是什么
失败后怎么修
最终改了什么
```

## V3 Artifacts

| Artifact | Meaning |
| --- | --- |
| intake schema | 任务类型、风险、是否需要澄清 |
| suspectedFiles | 相关文件和证据 |
| editPlan | 要改哪里、为什么、风险 |
| verificationPlan | 要跑什么验证、为什么 |
| verificationResult | 验证命令、结果、失败摘要 |
| repairFeedback | 失败后给模型的下一步反馈 |
| finalSummary | 最终改动、验证、风险 |

## Phase Rules

### intake

Classify:

- bug_fix
- refactor
- test
- security
- docs
- analysis

### localize

Allowed:

- read
- grep
- glob

Blocked:

- write
- edit
- apply_patch

### plan

Must produce editPlan before first risky edit for non-trivial tasks.

### edit

Must create diff unless task is analysis-only.

### verify

Must run or explicitly justify skipped verification.

### repair

Must use verification feedback or loop feedback.

### finalize

Only allowed after:

- verification passed
- or blocked with reason
- or analysis-only completed

## Failure Routing

| Condition | Route |
| --- | --- |
| zero patch | repair |
| empty final | repair or terminal anomaly |
| no progress | repair checkpoint |
| verification failed | repair |
| repair exhausted | blocked |
| stop gate active | finalize |

## Tests

- bug task enters localize
- localize blocks edit
- edit creates patch
- verification failure enters repair
- zero patch enters repair
- empty final enters repair or anomaly
- repair exhaustion enters blocked
- final summary only after valid condition

## Milestones

1. Define V3 artifact schemas
2. Add artifact storage to engineering run
3. Add phase transition checks
4. Add repair/block routing
5. Add public events
6. Add Inspector display
7. Add tests

## Done Means

For every engineering turn, user can inspect the run and see structured artifacts rather than guessing from chat text.

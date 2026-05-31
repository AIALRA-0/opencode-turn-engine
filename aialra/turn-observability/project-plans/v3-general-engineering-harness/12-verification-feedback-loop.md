# 12 Verification Feedback Loop Plan

## Original Task

请实现 verification feedback loop，验证反馈闭环。每次验证失败后，系统必须提取失败文件、失败断言、期望值、实际值、相关命令、建议排查方向，生成 FeedbackItem，并强制注入 repair 阶段。验证通过后强制 stop gate。补一次修错、二次根据失败修对的端到端测试。

## Human Goal

测试失败不能只显示给用户，也必须喂回给 agent。

失败信息应该变成下一步修复的输入。

## FeedbackItem Shape

```text
kind: verification_failed
command
exitCode
failedFiles
failedAssertions
expected
actual
logSummary
suggestedFocus
rawRef
```

## Failure Extraction

Support common patterns:

- Node assert diff
- pytest failure
- bun test failure
- node --test failure
- cargo test failure
- go test failure
- generic non-zero command output

## Injection Rule

When verification fails:

```text
EngineeringRun.phase = repair
FeedbackItem appended
next model message includes concise feedback
model is instructed to fix based on feedback, not restart from scratch
```

## Stop Rule

When verification passes:

```text
stopGate.active = true
phase = finalize
tool calls blocked except final report
```

## Tests

End-to-end fixture:

1. model makes wrong edit
2. test fails with clear assertion
3. system extracts feedback
4. model receives feedback
5. model edits again
6. test passes
7. stop gate blocks more tools

Unit tests:

- extract expected/actual from node assert
- extract pytest failure file
- generic log summary truncation
- rawRef stored for full output

## Public Events

- `engineering.verification.finished`
- `engineering.feedback.created`
- `engineering.phase.changed`
- `engineering.stop_gate.activated`

## Milestones

1. Build failure extractor
2. Add FeedbackItem schema
3. Inject feedback into repair prompt
4. Activate stop gate on pass
5. Add E2E fixture
6. Add Inspector panel

## Done Means

Verification failure changes agent behavior inside the same engineering flow instead of becoming a passive log line.

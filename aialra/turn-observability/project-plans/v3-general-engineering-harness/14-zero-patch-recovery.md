# 14 Zero Patch Recovery Plan

## Original Task

请实现 zero patch recovery，零补丁恢复。对于 bug_fix/refactor/test 任务，如果 final 前 git diff 为空，系统必须阻止 final，生成反馈：当前没有任何代码改动，请继续定位并修改，或者明确 blocked 原因。最多恢复 N 轮，N 由 Engineering Controls 配置。补 zero patch 单测和 benchmark 统计。

## Human Goal

如果用户让 agent 修 bug，agent 不能只分析一堆然后不改代码。

除非它明确说：

```text
这个任务无法修改，原因是什么
```

否则 zero patch，零补丁，应该被系统拦下并要求继续。

## Applies To

Task classes:

- bug_fix
- refactor
- test
- security
- performance

Does not apply to:

- pure analysis
- docs-only if no edit requested
- question answering

## Detection

Before final:

```text
if expectedPatch == true
and git diff is empty
and no created/modified files
then zero patch recovery
```

Need support:

- git worktree
- non-git directory fallback using file event counts
- benchmark isolated case directory

## Recovery Behavior

```text
block final
FeedbackItem kind = zero_patch
phase = repair
message to model:
当前没有任何代码改动。这个任务需要实际修改代码。请继续定位并修改，或者明确说明 blocked 原因。
```

Max recovery count:

```text
Engineering Controls setting
default by mode
not hardcoded
```

If exhausted:

```text
phase = blocked
assistant final explains zero patch and why blocked
turn completed with anomaly
```

## Benchmark Fields

Add:

```json
{
  "patch": {
    "isZero": true,
    "recoveryAttempts": 2,
    "recovered": false,
    "blockedReason": "model did not produce diff"
  }
}
```

## Tests

- bug_fix final with zero diff triggers recovery
- analysis task final with zero diff allowed
- recovery N configurable
- recovery success after second edit
- recovery exhausted becomes blocked
- benchmark JSON includes zero patch stats

## Public Events

- `engineering.zero_patch.detected`
- `engineering.zero_patch.recovery_requested`
- `engineering.zero_patch.recovered`
- `engineering.zero_patch.exhausted`

## Milestones

1. Add expectedPatch classifier
2. Add diff detector
3. Add recovery feedback
4. Add recovery budget
5. Add benchmark stats
6. Add Inspector panel
7. Add tests

## Done Means

Zero patch becomes a recoverable engineering condition, not a silent benchmark failure.

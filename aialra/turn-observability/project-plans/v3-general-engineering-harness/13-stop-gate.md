# 13 Stop Gate Plan

## Original Task

请完善 stop gate，通过即停止门禁。识别 npm test、pytest、bun test、node --test、cargo test、go test、自定义验证命令。验证通过后禁止 read/bash/edit/write/apply_patch，只允许最终报告。所有被阻止工具调用进入 Turn Inspector。

## Human Goal

测试已经通过后，模型不应该继续乱跑。

用户体感应该是：

```text
修好了
验证过了
系统阻止了继续折腾
现在只给最终报告
```

## Verification Command Detection

Recognize:

- `npm test`
- `npm run test`
- `pnpm test`
- `yarn test`
- `bun test`
- `bun --cwd ... test`
- `node --test`
- `pytest`
- `python -m pytest`
- `cargo test`
- `go test`
- configured custom command

## Stop Gate Rule

When validation command exits 0:

```text
stopGate.active = true
allowed tools = final only
blocked tools = read, grep, glob, bash, write, edit, apply_patch
```

If model calls blocked tool:

```text
block tool
emit event
add feedback: verification already passed, produce final report
```

## Custom Verification

Engineering Controls should allow:

- custom command list
- command pattern
- whether pass activates stop gate

## Tests

- npm test pass activates stop gate
- pytest pass activates stop gate
- bun test pass activates stop gate
- node --test pass activates stop gate
- cargo test pass activates stop gate
- go test pass activates stop gate
- custom command pass activates stop gate
- read after pass is blocked
- bash after pass is blocked
- edit after pass is blocked
- final after pass is allowed

## Public Events

- `engineering.stop_gate.activated`
- `engineering.stop_gate.blocked_tool`

## Milestones

1. Expand validation command detector
2. Add custom validation config
3. Block all non-final tools after pass
4. Add Inspector display
5. Add tests

## Done Means

Verified success becomes an execution boundary, not just a nice message.

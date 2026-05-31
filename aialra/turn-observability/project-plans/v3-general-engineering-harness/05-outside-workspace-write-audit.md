# 05 Outside-Workspace Write Audit Plan

## Original Task

请完整审计 AIALRA 工作区外写入防护。覆盖 write/edit/apply_patch/bash 重定向、mkdir、mv、cp、symlink、hardlink、临时文件、protected-create。所有越界写入必须被底层拒绝或审批，并在 Turn Inspector 显示具体路径、策略和拒绝原因。

## Human Goal

如果当前权限是 workspace-write，允许工作区内写入，那么模型不应该能把文件写到工作区外。

这不是 UI 提醒，而是执行层必须拦。

## Attack And Mistake Paths

Must cover:

- write direct absolute path
- edit direct absolute path
- apply_patch outside path
- bash redirection `echo x > /outside/file`
- bash `mkdir`
- bash `mv`
- bash `cp`
- symlink pointing outside
- hardlink to outside if possible
- temporary file created outside then moved inside
- creating `.git`, `.agents`, `.codex` when missing
- writing nested protected paths

## Target Behavior

For every outside write:

```text
allowed by full-access with audit
or approved by approval policy
or rejected by sandbox/permission
```

No silent success.

## Implementation Areas

- permission gate
- sandbox gate
- exec-server FS adapter
- bwrap command generation
- protected path creation logic
- public event stream
- Turn Inspector sandbox section
- tests

## Required Events

- `tool.sandbox.checked`
- `tool.sandbox.denied`
- `file.write.denied`
- `command.denied`
- `security.override.requested`
- `security.override.resolved`

Each event must include:

- path summary
- cwd
- selected environment
- permission profile
- sandbox policy
- reason

## Tests

Matrix:

| Case | Expected |
| --- | --- |
| write outside | reject |
| edit outside | reject |
| apply_patch outside | reject |
| bash redirection outside | reject |
| mkdir outside | reject |
| mv inside to outside | reject |
| cp inside to outside | reject |
| symlink escape write | reject |
| hardlink outside | reject or unsupported blocked |
| create `.git/config` | reject |
| create missing `.codex/config` | reject |
| temp outside then move | reject |

Run across:

- read-only
- workspace-write
- full-access where expected audit differs

## Milestones

1. Write audit checklist as test fixture
2. Add missing guards
3. Strengthen bwrap protected path behavior
4. Strengthen FS adapter path checks
5. Add Inspector readable reasons
6. Add tests
7. Update profile parity matrix

## Done Means

For every blocked outside write, the user can see:

```text
which path was blocked
which rule blocked it
whether approval was possible
whether the file exists after the attempt
```

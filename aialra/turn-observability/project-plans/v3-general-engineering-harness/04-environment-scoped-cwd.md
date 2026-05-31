# 04 Environment-Scoped CWD Plan

## Original Task

请把 AIALRA cwd 从单一字符串升级为 environment-scoped cwd，环境级当前目录。local default environment 必须稳定，所有工具必须从 selected environment.cwd 解析路径。实现 environment API、环境选择事件、Turn Inspector 展示，并明确 remote environment unsupported 状态。

## Human Goal

cwd，当前目录，不能只是一个字符串。

更准确的结构应该是：

```text
当前选择了哪个环境
这个环境的 cwd 是什么
工具都在这个环境里执行
```

## Why This Matters

Today local execution is the main path. Later remote execution will need:

- different cwd
- different filesystem
- different process runner
- different sandbox capability

If cwd stays global, remote environment will be bolted on badly.

## Target Model

```text
UserTurn.environments[]
TurnContext.selectedEnvironmentID
selected environment cwd
tools resolve paths from selected environment cwd
```

## Environment Types

| Type | Status | Behavior |
| --- | --- | --- |
| local default | must work | current Linux server workspace |
| remote | unsupported for now unless configured | visible but blocked clearly |
| disabled | no tools | returns environment unsupported error |

## API Requirements

Add or verify endpoints:

- get session environments
- get selected environment
- select environment
- inspect environment capability

Events:

- `environment.selected`
- `environment.unsupported`
- `environment.capability.checked`

## Tool Behavior

Every tool must resolve through:

```text
TurnContext.environments
-> selectedEnvironment
-> selectedEnvironment.cwd
```

Never use `process.cwd()` for tool path resolution.

## Turn Inspector Behavior

Show:

- selected environment
- cwd
- local or remote
- capability
- unsupported reason if remote is selected but unavailable

## Tests

- default environment exists when none provided
- selected local environment cwd is used by read
- selected local environment cwd is used by write
- selected local environment cwd is used by bash
- remote unsupported blocks tools with clear event
- changing environment emits event
- TurnContext preserves environment list

## Milestones

1. Audit current cwd reads
2. Add selected environment field if missing
3. Update path resolution helpers
4. Add environment API
5. Add public events
6. Add Inspector display
7. Add tests

## Done Means

When a tool runs, we can answer:

```text
which environment ran it
what cwd it used
why that cwd was allowed
```

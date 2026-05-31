# 03 Exec-Server FS API Convergence Plan

## Original Task

请把所有文件类工具彻底收敛到 exec-server FS API。read/readDirectory/write/edit/apply_patch/glob/grep 的每一步都必须先过 TurnContext 门禁，再通过受控 FS 通道执行。禁止任何文件工具绕过 cwd、permission_profile、sandbox_policy、approval_policy。补 workspace 内外、protected path、symlink、fallback 事件测试。

## Human Goal

文件工具不能各走各的路。

用户看到的是一个工具，但系统里不能出现：

```text
read 走 exec-server
write 走 Bun
edit 中间读旧文件绕过沙箱
glob/grep 不看 TurnContext
```

所有文件行为必须先问同一个问题：

```text
这一轮 TurnContext 允许吗
```

## Target Tools

- read file
- read directory
- write
- edit
- apply_patch
- glob
- grep

## Target Pipeline

```text
tool input
-> resolve path from selected environment cwd
-> TurnContext permission check
-> sandbox policy check
-> approval policy check
-> exec-server FS API
-> public event stream
-> Turn Inspector
```

## Exec-Server FS Methods

Use Codex-compatible FS APIs where available:

- `fs/readFile`
- `fs/writeFile`
- `fs/createDirectory`
- `fs/getMetadata`
- `fs/readDirectory`
- `fs/remove`
- `fs/copy`

If glob/grep have no native exec-server equivalent:

- keep Node/Bun implementation temporarily
- but path enumeration must still pass TurnContext gate
- record `exec_server.fs.unsupported_fallback`

## Implementation Areas

Likely files:

- tool implementations under `packages/opencode/src/tool`
- exec-server adapter
- sandbox and permission gate modules
- public event service
- tests under `packages/opencode/test/tool`

## Protected Paths

Must protect:

- `.git`
- `.agents`
- `.codex`

Protection must cover:

- direct path
- nested path
- symlink target
- creating missing protected path
- shell redirection where possible through bash sandbox

## Fallback Rules

Fallback is allowed only if:

- exec-server is unavailable
- feature is not supported by exec-server yet
- fallback still runs after TurnContext gate
- public event says exactly why

Fallback event:

```text
executor.fallback
```

Payload summary:

```text
from: codex exec-server
to: Node/Bun executor
reason: fs/readDirectory unsupported or sidecar unavailable
tool: readDirectory
```

## Tests

Functional:

- workspace read succeeds
- workspace readDirectory succeeds
- workspace write succeeds under workspace-write
- read-only write rejects
- workspace outside write rejects
- protected path write rejects
- symlink escape rejects

Fallback:

- sidecar unavailable produces fallback event
- fallback still rejects outside path

Tool-specific:

- edit reads old content through controlled path
- apply_patch reads and writes through controlled path
- glob cannot reveal outside workspace under workspace profile
- grep cannot search outside workspace under workspace profile

## Milestones

1. Inventory every file read/write path
2. Create shared FS gate entrypoint
3. Connect readFile/writeFile/readDirectory
4. Connect edit/apply_patch internals
5. Gate glob/grep
6. Add fallback events
7. Add tests
8. Update docs

## Done Means

No file tool can reach disk without going through:

```text
selected environment cwd
TurnContext permission
sandbox policy
approval policy
exec-server FS path or audited fallback
```

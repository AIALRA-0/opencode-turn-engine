# 07 Exec-Server Default Backend Plan

## Original Task

请把 AIALRA 执行器默认完全切到 Codex exec-server sidecar。process、FS、HTTP 三类 API 都要接入。Node/Bun executor 只作为可审计 fallback。所有 fallback 必须显示原因。补 bash echo、长命令 terminate、stdout/stderr 顺序、fs/readDirectory、fs/remove、fs/copy、http/request 测试。

## Human Goal

执行器，executor，不应该一半新一半旧。

目标是：

```text
默认走 Codex exec-server sidecar
旧 Node/Bun executor 只作为明确记录的备用路径
```

## API Areas

### Process

- `process/start`
- `process/read`
- `process/write`
- `process/terminate`

### FS

- `fs/readFile`
- `fs/writeFile`
- `fs/createDirectory`
- `fs/getMetadata`
- `fs/readDirectory`
- `fs/remove`
- `fs/copy`

### HTTP

- `http/request`
- `http/request/bodyDelta`

## Backend Policy

Default:

```text
AIALRA_EXEC_BACKEND=codex
```

Fallback allowed only with event:

```text
executor.fallback
```

Fallback event must include:

- requested backend
- fallback backend
- tool
- reason
- sidecar status
- whether user-visible behavior changed

## Sidecar Operations

Must define:

- systemd service name
- listening URL
- readyz check
- logs
- restart policy
- startup dependency
- timeout policy

## Tests

Process:

- bash echo
- long command terminate
- stdout/stderr order
- timeout
- fallback when sidecar down

FS:

- readDirectory
- remove
- copy
- metadata
- createDirectory
- protected path rejection through TurnContext gate

HTTP:

- network off rejects
- network on permits safe public URL
- response is truncated/redacted in public event

## Milestones

1. Stabilize sidecar connection and ready check
2. Make process default backend
3. Complete FS method coverage
4. Add HTTP method coverage
5. Make fallback auditable
6. Add tests
7. Update service docs

## Done Means

For any tool execution, user can see:

```text
which backend ran it
whether fallback happened
why fallback happened
what effect that had
```

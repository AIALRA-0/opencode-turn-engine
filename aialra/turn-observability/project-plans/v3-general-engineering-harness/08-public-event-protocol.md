# 08 Public Event Protocol Plan

## Original Task

请把 AIALRA public event stream 固化为稳定公共协议。为每个事件定义字段、中文解释、rawRef、权限规则、重放规则、Last-Event-ID、版本兼容策略。所有模型、工具、审批、沙箱、工程状态机事件必须有测试样例和 schema 测试。

## Human Goal

public event stream，公共事件流，必须成为产品协议，不只是调试日志。

用户和机器都要能稳定消费它。

## Protocol Requirements

Each event must define:

- type
- version
- Chinese label
- Chinese summary
- turnID
- sessionID
- eventID
- timestamp
- severity
- category
- safe payload
- rawRef if raw exists
- permission rule for raw access
- replay behavior
- compatibility notes

## Event Categories

- turn
- model
- tool
- file
- command
- approval
- sandbox
- executor
- engineering
- benchmark
- security
- final

## Raw Payload Rules

Safe event:

```text
summary only
no full prompt
no full tool output
no secrets
no provider token
```

Raw payload:

```text
encrypted or memory-only if key missing
access-controlled
access audited
```

## Last-Event-ID

Must support:

- reconnect from last event
- in-memory replay buffer
- session-specific stream
- global stream if still supported
- no duplicate event after reconnect

## Versioning

Protocol version:

```text
aialra.public_event.v1
```

Rules:

- adding optional fields allowed
- changing field meaning requires new version
- removing fields not allowed in v1

## Tests

Schema tests:

- every event sample validates
- unknown event type rejected or classified
- rawRef access obeys auth
- Last-Event-ID replay works

Redaction tests:

- prompt not leaked in safe payload
- token/password/authorization not leaked
- large command output truncated

Coverage tests:

- model event sample
- tool event sample
- approval event sample
- sandbox event sample
- engineering event sample
- terminal anomaly event sample

## Milestones

1. Write event catalog
2. Add schema samples
3. Add compatibility policy
4. Add redaction tests
5. Add replay tests
6. Update Turn Inspector to use labels

## Done Means

External users can build a UI or audit pipeline from `/event/public` without reading internal trace files.

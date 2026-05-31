# 02 TurnContext And Codex UserTurn Parity Plan

## Original Task

请补齐 AIALRA TurnContext 和 Codex UserTurn 字段语义差距。逐项实现 approvals_reviewer、remote environments、service_tier、summary、effort、final_output_json_schema、HTTP execution context。每个字段必须说明来源、默认值、进入哪个执行路径、如何在 Turn Inspector 观察，并补字段不丢失测试。

## Human Goal

TurnContext，回合上下文，必须不只是记录字段。

每个字段都要回答：

```text
它从哪里来
默认值是什么
它控制哪段执行逻辑
用户在哪里看到它
测试如何证明它没有丢
```

## Fields To Complete

| Field | Chinese meaning | Target behavior |
| --- | --- | --- |
| approvals_reviewer | 审批人或审批通道 | 决定谁能处理审批 |
| remote environments | 远程执行环境 | 本轮能选择 local 或 remote |
| service_tier | 服务等级 | 传给支持的 provider，不支持则记录 |
| summary | 推理摘要策略 | 控制 reasoning summary 或记录不支持 |
| effort | 推理强度 | 传递给支持 reasoning 的模型 |
| final_output_json_schema | 最终输出 JSON 结构 | 强制最终输出结构或报错 |
| HTTP execution context | HTTP 执行上下文 | 通过 exec-server HTTP API 执行网络请求 |

## Current Baseline

AIALRA already has TurnContext fields for many of these concepts, but some are:

- stored but not fully enforced
- passed only in some paths
- invisible or weakly visible in Turn Inspector
- missing per-field tests

## Target Data Flow

```text
PromptInput or session config
-> UserTurn
-> TurnContext
-> model options / tool execution / approval reviewer / exec-server
-> public event stream
-> Turn Inspector
-> benchmark JSON where relevant
```

## Implementation Areas

Likely files:

- `packages/opencode/src/session/turn-context.ts`
- `packages/opencode/src/session/prompt.ts`
- `packages/opencode/src/session/public-event.ts`
- model provider option construction
- approval permission modules
- exec-server adapter
- Turn Inspector UI
- session tests

## Per-Field Requirements

### approvals_reviewer

Must define:

- default reviewer when absent
- reviewer identity format
- whether reviewer is current authenticated user, external reviewer, or disabled
- how approval requests route to it
- how rejected approvals return to model

### remote environments

First version may mark remote unsupported, but must be explicit:

```text
local default environment: supported
remote environment: visible but unsupported unless configured
disabled environment: cannot execute tools
```

### service_tier

Provider behavior:

- supported provider: pass option
- unsupported provider: do not fail turn, record ignored field event

### summary and effort

Provider behavior:

- supported reasoning model: pass through
- unsupported model: record unsupported summary in event

### final_output_json_schema

Execution behavior:

- if schema is present, final output must validate
- if invalid, feed validation failure back once
- if still invalid, finish with structured error

### HTTP execution context

Must align with exec-server:

- request method
- URL
- headers after redaction
- network policy
- approval policy
- sandbox policy
- response body streaming or truncation

## Public Events

Add or ensure:

- `turn.context.created`
- `turn.context.field.ignored`
- `environment.selected`
- `environment.unsupported`
- `model.option.applied`
- `model.option.ignored`
- `http.request.started`
- `http.request.finished`

## Tests

Field preservation tests:

- PromptInput -> UserTurn -> TurnContext retains every field
- command route retains every field
- noReply retains every field

Behavior tests:

- unsupported service_tier records ignored event
- effort passed to supported mock provider
- final JSON schema valid passes
- final JSON schema invalid creates feedback
- remote environment unsupported blocks tool execution with clear reason
- HTTP context obeys network off

## Milestones

1. Inventory current fields and source mapping
2. Fill missing defaults
3. Wire fields into execution paths
4. Add public event visibility
5. Add Inspector display
6. Add field preservation tests
7. Add behavior tests

## Done Means

No TurnContext field can be added as a decorative field only. Every field either controls behavior or explicitly records that this provider/environment does not support it.

import crypto from "crypto"
import fs from "fs"
import path from "path"

type JsonRecord = Record<string, unknown>
type ExtensionData = Record<string, JsonRecord>

export const PUBLIC_EVENT_TYPES = [
  "audit.encryption.unavailable",
  "session.configured",
  "session.handoff.requested",
  "session.handoff.prepared",
  "prompt.effective.resolved",
  "turn.input.received",
  "turn.context.created",
  "turn.started",
  "turn.warning",
  "turn.step_budget.changed",
  "turn.completed",
  "turn.aborted",
  "turn.abort.requested",
  "turn.abort.resolved",
  "turn.terminal.assistant_error",
  "turn.diff.updated",
  "patch.quality.scored",
  "engineering.controls.changed",
  "engineering.mode.changed",
  "engineering.budget.changed",
  "engineering.benchmark.tier.selected",
  "engineering.benchmark.started",
  "engineering.benchmark.finished",
  "multi_agent.task.assigned",
  "multi_agent.task.settled",
  "multi_agent.conflict.detected",
  "engineering.run.started",
  "engineering.phase.changed",
  "engineering.artifact.updated",
  "engineering.verification.planned",
  "engineering.verification.started",
  "engineering.verification.finished",
  "engineering.verification.repair_requested",
  "engineering.phase_gate.blocked_tool",
  "engineering.phase_gate.premature_final",
  "engineering.zero_patch.detected",
  "engineering.zero_patch.recovery_requested",
  "engineering.zero_patch.recovered",
  "engineering.zero_patch.exhausted",
  "engineering.stop_gate.checked",
  "engineering.stop_gate.activated",
  "engineering.stop_gate.blocked_tool",
  "engineering.loop.warning",
  "engineering.loop.checkpoint",
  "engineering.loop.blocked",
  "engineering.reasoning.recorded",
  "reasoning.summary.created",
  "reasoning.raw.item",
  "engineering.deployment_gate.updated",
  "engineering.run.finished",
  "model.raw.chunk",
  "model.raw.item",
  "model.capability.evaluated",
  "model.capability.degraded",
  "model.effort.resolved",
  "model.service_tier.resolved",
  "model.request.started",
  "model.stream.started",
  "model.retrying",
  "model.request.finished",
  "runtime.provider.selected",
  "runtime.item.received",
  "runtime.item.settled",
  "item.lifecycle.started",
  "item.lifecycle.completed",
  "item.lifecycle.failed",
  "item.lifecycle.aborted",
  "provider.tool.call",
  "provider.tool.result",
  "executor.started",
  "executor.finished",
  "executor.fallback",
  "tool.foundation.resolved",
  "tool.foundation.executing",
  "tool.foundation.settled",
  "tool.lifecycle.requested",
  "tool.lifecycle.started",
  "tool.lifecycle.completed",
  "tool.lifecycle.failed",
  "tool.lifecycle.aborted",
  "tool.output.stored",
  "tool.result.settled",
  "tool.call.started",
  "tool.call.finished",
  "tools.dynamic.resolved",
  "skill.catalog.resolved",
  "skill.catalog.injected",
  "skill.used",
  "tool.sandbox.capability",
  "tool.sandbox.checked",
  "tool.sandbox.denied",
  "sandbox.effective",
  "security.constraint.checked",
  "security.constraint.denied",
  "file.read",
  "file.search",
  "directory.read",
  "file.write",
  "exec_command.started",
  "exec_command.output_delta",
  "exec_command.end",
  "exec_command.output",
  "exec_command.yielded",
  "exec_command.finished",
  "exec_command.fallback",
  "exec.approval.requested",
  "exec.approval.resolved",
  "apply_patch.approval.requested",
  "apply_patch.approval.resolved",
  "exec_process.registered",
  "exec_process.await_started",
  "exec_process.await_progress",
  "exec_process.await_finished",
  "exec_process.await_timeout",
  "exec_process.capacity_checked",
  "exec_process.capacity_denied",
  "exec_process.finished",
  "exec_process.finish_ignored",
  "exec_process.abort_requested",
  "exec_process.abort_denied",
  "exec_process.cleanup",
  "terminal.stdin.written",
  "terminal.stdin.denied",
  "terminal.interaction",
  "command.started",
  "command.output",
  "command.finished",
  "shell.env.policy.applied",
  "network.proxy.applied",
  "network.proxy.unavailable",
  "http.request.classified",
  "approval.requested",
  "approval.resolved",
  "permission.grant.created",
  "approval.reviewer.changed",
  "reviewer.resolved",
  "guardian.assessment.completed",
  "auto_review.completed",
  "request_permissions.requested",
  "request_permissions.resolved",
  "final.output",
  "sandbox.profile.changed",
  "sandbox.network.changed",
  "sandbox.command.changed",
  "sandbox.policy.changed",
  "sandbox.control.changed",
  "approval.policy.changed",
  "executor.backend.changed",
  "environment.selected",
  "security.override.requested",
  "security.override.resolved",
  "turn.terminal.anomaly",
  "turn.terminal.reconciled",
  "thread.rollback.requested",
  "thread.rollback.applied",
  "thread.rollback.noop",
  "thread.rollback.restored",
  "thread.rollback.cleaned",
  "context.compaction.started",
  "context.compaction.completed",
  "context.compaction.failed",
  "context.compaction.pruned",
  "extension.data.attached",
] as const
export type PublicEventType = (typeof PUBLIC_EVENT_TYPES)[number]

export type PublicEventSeverity = "info" | "warning" | "error"
export type PublicEventSource = "trace" | "bus" | "manual"

export type PublicRawRef = {
  id: string
  eventID: string
  encrypted: boolean
  persisted: boolean
}

export type PublicEvent = {
  schema: "aialra.public_event.v1"
  version: "1"
  id: string
  sequence: number
  ts: string
  type: PublicEventType
  source: PublicEventSource
  threadID: string
  severity: PublicEventSeverity
  sessionID?: string
  turnID?: string
  messageID?: string
  toolCallID?: string
  title: string
  summary?: string
  status?: string
  payloadSchema: string
  payload: JsonRecord
  data: JsonRecord
  extension_data?: ExtensionData
  rawRef?: PublicRawRef
}

export type PublicEventProtocolEntry = {
  type: PublicEventType
  schema: PublicEvent["schema"]
  title: string
  description: string
  fields: Array<{
    name: keyof PublicEvent | "data.*" | "extension_data.*" | "rawRef.*"
    description: string
    required: boolean
  }>
  permission: "session_owner"
  replay: "session_buffer_with_last_event_id"
  raw: "none" | "rawRef_only"
}

export type TraceRecordInput = {
  phase: string
  turnID?: string
  sessionID?: string
  messageID?: string
  step?: number
  data?: JsonRecord
  extension_data?: ExtensionData
}

type BusRecordInput = {
  directory?: string
  project?: string
  workspace?: string
  event: {
    id: string
    type: string
    properties: JsonRecord
  }
}

type PublicEventDraft = Omit<
  PublicEvent,
  "schema" | "version" | "id" | "sequence" | "ts" | "source" | "threadID" | "payloadSchema" | "payload" | "rawRef"
> & {
  source?: PublicEventSource
  threadID?: string
  payloadSchema?: string
  payload?: JsonRecord
  raw?: unknown
}

type StoredRaw =
  | {
      kind: "memory"
      eventID: string
      sessionID?: string
      value: unknown
    }
  | {
      kind: "file"
      eventID: string
      sessionID?: string
      file: string
      keyID: string
    }

const DEFAULT_REPLAY_LIMIT = 1000
const MAX_SAFE_STRING = 240
const MAX_SAFE_ARRAY = 40
const MAX_SAFE_OBJECT = 60
const DEFAULT_MEMORY_RAW_LIMIT_BYTES = 64 * 1024
const SENSITIVE_KEY = /(authorization|api[-_]?key|token|secret|password|cookie|credential)/i
const TEXT_KEY = /(prompt|content|output|delta|raw|text|command|stdout|stderr)/i

const replayLimit = () => {
  const parsed = Number.parseInt(process.env.AIALRA_PUBLIC_EVENT_REPLAY_LIMIT ?? "", 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_REPLAY_LIMIT
  return Math.min(parsed, 10_000)
}

const memoryRawLimit = () => {
  const parsed = Number.parseInt(process.env.AIALRA_EVENT_MEMORY_RAW_LIMIT_BYTES ?? "", 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MEMORY_RAW_LIMIT_BYTES
  return Math.min(parsed, 10 * 1024 * 1024)
}

const auditDir = () =>
  process.env.AIALRA_EVENT_AUDIT_DIR || path.join(process.cwd(), "aialra", "turn-observability", "audit")

const auditKey = () => {
  const raw = process.env.AIALRA_EVENT_AUDIT_KEY
  if (!raw) return
  try {
    const key = Buffer.from(raw, "base64")
    if (key.length !== 32) return
    return key
  } catch {
    return
  }
}

let sequence = 0
let warnedAuditUnavailable = false
const allEvents: PublicEvent[] = []
const sessionEvents = new Map<string, PublicEvent[]>()
const eventsByID = new Map<string, PublicEvent>()
const rawByID = new Map<string, StoredRaw>()
type ApprovalRequestContext = {
  sessionID?: string
  turnID?: string
  messageID?: string
  toolCallID?: string
  execApproval?: unknown
  applyPatchApproval?: unknown
  guardianAssessment?: unknown
  autoReviewResult?: unknown
  reviewerResolution?: unknown
}
const approvalRequests = new Map<string, ApprovalRequestContext>()

function eventID() {
  return `pev_${Date.now().toString(36)}_${(++sequence).toString(36)}_${crypto.randomBytes(4).toString("hex")}`
}

function rawID() {
  return `raw_${Date.now().toString(36)}_${crypto.randomBytes(8).toString("hex")}`
}

function evictEvent(event: PublicEvent) {
  eventsByID.delete(event.id)
  if (event.rawRef) rawByID.delete(event.rawRef.id)
  if (event.sessionID) {
    const buffer = sessionEvents.get(event.sessionID)
    if (buffer) {
      const index = buffer.findIndex((item) => item.id === event.id)
      if (index >= 0) buffer.splice(index, 1)
      if (buffer.length === 0) sessionEvents.delete(event.sessionID)
    }
  }
}

function pushBuffer(buffer: PublicEvent[], event: PublicEvent, onDrop?: (event: PublicEvent) => void) {
  buffer.push(event)
  const limit = replayLimit()
  while (buffer.length > limit) {
    const dropped = buffer.shift()
    if (dropped) onDrop?.(dropped)
  }
}

function redactRaw(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "symbol" || typeof value === "function") return undefined
  if (depth >= 12) return "[truncated]"
  if (Array.isArray(value)) return value.slice(0, 500).map((item) => redactRaw(item, depth + 1))
  if (typeof value !== "object") return String(value)

  const output: JsonRecord = {}
  for (const [key, item] of Object.entries(value as JsonRecord).slice(0, 500)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = "[redacted]"
      continue
    }
    const next = redactRaw(item, depth + 1)
    if (next !== undefined) output[key] = next
  }
  return output
}

function safeValue(value: unknown, depth = 0): unknown {
  if (value === undefined) return undefined
  if (value === null) return null
  if (typeof value === "string") {
    if (value.length <= MAX_SAFE_STRING) return value
    return `${value.slice(0, MAX_SAFE_STRING - 3)}...`
  }
  if (typeof value === "number" || typeof value === "boolean") return value
  if (typeof value === "bigint") return value.toString()
  if (typeof value === "symbol" || typeof value === "function") return undefined
  if (depth >= 4) return "[truncated]"
  if (Array.isArray(value)) return value.slice(0, MAX_SAFE_ARRAY).map((item) => safeValue(item, depth + 1))
  if (typeof value !== "object") return String(value)

  const output: JsonRecord = {}
  for (const [key, item] of Object.entries(value as JsonRecord).slice(0, MAX_SAFE_OBJECT)) {
    if (SENSITIVE_KEY.test(key)) {
      output[key] = "[redacted]"
      continue
    }
    if (TEXT_KEY.test(key) && typeof item === "string" && item.length > MAX_SAFE_STRING) {
      output[key] = `${item.slice(0, MAX_SAFE_STRING - 3)}...`
      output[`${key}Chars`] = item.length
      continue
    }
    const next = safeValue(item, depth + 1)
    if (next !== undefined) output[key] = next
  }
  return output
}

function safeObject(value: unknown): JsonRecord {
  const safe = safeValue(value)
  return safe && typeof safe === "object" && !Array.isArray(safe) ? (safe as JsonRecord) : {}
}

function short(value: unknown, max = 96) {
  if (typeof value !== "string") return undefined
  const clean = value.replace(/\s+/g, " ").trim()
  if (!clean) return undefined
  return clean.length > max ? `${clean.slice(0, max - 3)}...` : clean
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function approvalDecisionFromBus(props: JsonRecord, pending?: ApprovalRequestContext) {
  const reply = typeof props.reply === "string" ? props.reply : "once"
  const scope = typeof props.scope === "string" ? props.scope : undefined
  const grantScope = scope ?? (reply === "reject" ? "reject" : reply === "always" ? "legacy-always" : "once-command")
  const details: Record<string, { decision: string; label: string; description: string; creates_runtime_grant: boolean }> = {
    reject: {
      decision: "reject",
      label: "拒绝",
      description: "拒绝这次审批。兼容旧 OpenCode 行为时，会同时取消同一会话里仍在等待的审批。",
      creates_runtime_grant: false,
    },
    "once-command": {
      decision: "allow_once_command",
      label: "仅允许一次本命令",
      description: "只允许当前这一次工具调用，不给后续请求建立自动授权。",
      creates_runtime_grant: false,
    },
    "turn-command": {
      decision: "allow_turn_command",
      label: "本对话单轮允许本命令",
      description: "当前回合内，同一环境里的同类命令自动允许；下一回合重新询问。",
      creates_runtime_grant: true,
    },
    "turn-all": {
      decision: "allow_turn_all",
      label: "本对话单轮允许全部命令",
      description: "当前回合内，同一环境里的后续审批自动允许；下一回合重新询问。",
      creates_runtime_grant: true,
    },
    "always-command": {
      decision: "allow_session_command",
      label: "本对话始终允许本命令",
      description: "当前会话内，同一环境里的同类命令自动允许；不会绕过沙箱和硬安全约束。",
      creates_runtime_grant: true,
    },
    "always-all": {
      decision: "allow_session_all",
      label: "本对话始终允许全部命令",
      description: "当前会话内，同一环境里的后续审批自动允许；不会绕过沙箱和硬安全约束。",
      creates_runtime_grant: true,
    },
    "legacy-always": {
      decision: "allow_legacy_always_command",
      label: "旧版始终允许",
      description: "旧客户端没有传 scope，系统按 OpenCode 旧规则写入会话级 permission rule。",
      creates_runtime_grant: true,
    },
  }
  const detail = details[grantScope] ?? details["once-command"]
  return {
    schema: "aialra.approval_decision.v1",
    decision: detail.decision,
    status: reply === "reject" ? "denied" : "approved",
    reply,
    requested_scope: scope,
    grant_scope: grantScope,
    label: detail.label,
    description: detail.description,
    creates_runtime_grant: detail.creates_runtime_grant,
    session_id: pending?.sessionID,
    turn_id: pending?.turnID,
    tool_call_id: pending?.toolCallID,
    legacy_propagates_pending_session_requests: reply === "reject",
  }
}

function payloadSchema(type: PublicEventType) {
  return `aialra.public_event.${type.replace(/[^a-zA-Z0-9]+/g, "_")}.v1`
}

function modelInfoName(data: JsonRecord) {
  const modelInfo = isRecord(data.model_info) ? data.model_info : undefined
  const model = modelInfo && isRecord(modelInfo.model) ? modelInfo.model : undefined
  return model?.display_name ?? model?.id ?? "model"
}

function providerToolType(data: JsonRecord) {
  if (typeof data.provider_tool_type === "string") return data.provider_tool_type
  if (isRecord(data.providerExecution) && typeof data.providerExecution.provider_tool_type === "string") {
    return data.providerExecution.provider_tool_type
  }
  return "unknown_hosted"
}

function emitAuditWarning(sessionID?: string, turnID?: string) {
  if (warnedAuditUnavailable) return
  warnedAuditUnavailable = true
  record({
    type: "audit.encryption.unavailable",
    severity: "warning",
    sessionID,
    turnID,
    title: "Raw audit encryption is unavailable",
    summary: "AIALRA_EVENT_AUDIT_KEY is missing or invalid; raw event payloads are kept in memory only.",
    status: "warning",
    data: {
      env: "AIALRA_EVENT_AUDIT_KEY",
      persisted: false,
    },
  })
}

function memoryRawValue(value: unknown) {
  const limit = memoryRawLimit()
  const json = JSON.stringify(value)
  const bytes = Buffer.byteLength(json, "utf8")
  if (bytes <= limit) return value
  return {
    truncated: true,
    originalBytes: bytes,
    memoryLimitBytes: limit,
    preview: json.slice(0, limit),
  }
}

function storeRaw(eventID: string, sessionID: string | undefined, turnID: string | undefined, raw: unknown) {
  const id = rawID()
  const clean = redactRaw(raw)
  const key = auditKey()
  if (!key) {
    rawByID.set(id, { kind: "memory", eventID, sessionID, value: memoryRawValue(clean) })
    return { id, eventID, encrypted: false, persisted: false }
  }

  try {
    const dir = auditDir()
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)
    const plaintext = Buffer.from(JSON.stringify(clean), "utf8")
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
    const tag = cipher.getAuthTag()
    const file = path.join(dir, `${id}.json.enc`)
    const payload = {
      schema: "aialra.public_event_raw.v1",
      keyID: "AIALRA_EVENT_AUDIT_KEY",
      algorithm: "aes-256-gcm",
      eventID,
      sessionID,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
    }
    fs.writeFileSync(file, JSON.stringify(payload), { encoding: "utf8", mode: 0o600 })
    rawByID.set(id, { kind: "file", eventID, sessionID, file, keyID: "AIALRA_EVENT_AUDIT_KEY" })
    return { id, eventID, encrypted: true, persisted: true }
  } catch {
    rawByID.set(id, { kind: "memory", eventID, sessionID, value: memoryRawValue(clean) })
    return { id, eventID, encrypted: false, persisted: false }
  }
}

function record(draft: PublicEventDraft) {
  const id = eventID()
  const data = safeObject(draft.data)
  const event: PublicEvent = {
    schema: "aialra.public_event.v1",
    version: "1",
    id,
    sequence,
    ts: new Date().toISOString(),
    type: draft.type,
    source: draft.source ?? "manual",
    threadID: draft.threadID ?? draft.turnID ?? draft.sessionID ?? "global",
    severity: draft.severity,
    sessionID: draft.sessionID,
    turnID: draft.turnID,
    messageID: draft.messageID,
    toolCallID: draft.toolCallID,
    title: draft.title,
    summary: draft.summary,
    status: draft.status,
    payloadSchema: draft.payloadSchema ?? payloadSchema(draft.type),
    payload: safeObject(draft.payload ?? data),
    data,
    extension_data: draft.extension_data ? safeObject(draft.extension_data) as ExtensionData : undefined,
  }
  if (draft.raw !== undefined) event.rawRef = storeRaw(event.id, event.sessionID, event.turnID, draft.raw)

  eventsByID.set(event.id, event)
  pushBuffer(allEvents, event, evictEvent)
  if (event.sessionID) {
    const buffer = sessionEvents.get(event.sessionID) ?? []
    sessionEvents.set(event.sessionID, buffer)
    pushBuffer(buffer, event)
  }
  if (event.rawRef && !event.rawRef.persisted && !event.rawRef.encrypted) {
    emitAuditWarning(event.sessionID, event.turnID)
  }
  return event
}

function makeTraceEvent(input: TraceRecordInput): PublicEventDraft | undefined {
  const data = input.data ?? {}
  const base = {
    source: "trace" as const,
    sessionID: input.sessionID,
    turnID: input.turnID,
    messageID: input.messageID,
    raw: {
      source: "trace",
      phase: input.phase,
      step: input.step,
      sessionID: input.sessionID,
      turnID: input.turnID,
      messageID: input.messageID,
      data,
      extension_data: input.extension_data,
    },
    extension_data: input.extension_data,
  }

  switch (input.phase) {
    case "prompt.received":
      return {
        ...base,
        type: "turn.input.received",
        severity: "info",
        title: "Prompt received",
        summary: short(`route=${data.route ?? "prompt"} agent=${data.agent ?? "default"}`),
        status: "received",
        data,
      }
    case "prompt.effective.resolved": {
      const rawPayload = data.raw_payload
      const safeData = { ...data }
      delete safeData.raw_payload
      return {
        ...base,
        type: "prompt.effective.resolved",
        severity: "info",
        title: "Effective prompt resolved",
        summary: short(`${safeData.version ?? "prompt"} ${safeData.prompt_hash ?? ""}`),
        status: "resolved",
        data: safeData,
        raw: {
          source: "trace",
          phase: input.phase,
          sessionID: input.sessionID,
          turnID: input.turnID,
          messageID: input.messageID,
          prompt_manifest: safeData,
          raw_payload: rawPayload,
          extension_data: input.extension_data,
        },
      }
    }
    case "session.configured":
      return {
        ...base,
        type: "session.configured",
        severity: "info",
        title: "Session configured",
        summary: short(`cwd=${data.cwd ?? ""} profile=${data.permissionProfileID ?? ""}`),
        status: "configured",
        data,
      }
    case "turn.context.created":
      return {
        ...base,
        type: "turn.context.created",
        severity: "info",
        title: "Turn context created",
        summary: short(`cwd=${data.cwd ?? ""} model=${data.model ?? data.modelID ?? ""}`),
        status: "created",
        data,
      }
    case "thread.rollback.requested":
      return {
        ...base,
        type: "thread.rollback.requested",
        severity: "info",
        title: "Thread rollback requested",
        summary: short(`message=${data.messageID ?? input.messageID ?? ""}`),
        status: "requested",
        data,
      }
    case "thread.rollback.applied":
      return {
        ...base,
        type: "thread.rollback.applied",
        severity: "info",
        title: "Thread rollback applied",
        summary: short(`to=${data.rollbackMessageID ?? ""} reverted=${data.revertedMessageCount ?? ""}`),
        status: "applied",
        data,
      }
    case "thread.rollback.noop":
      return {
        ...base,
        type: "thread.rollback.noop",
        severity: "warning",
        title: "Thread rollback had no effect",
        summary: short(String(data.reason ?? "target not found")),
        status: "noop",
        data,
      }
    case "thread.rollback.restored":
      return {
        ...base,
        type: "thread.rollback.restored",
        severity: "info",
        title: "Thread rollback restored",
        summary: short(`message=${data.rollbackMessageID ?? ""}`),
        status: "restored",
        data,
      }
    case "thread.rollback.cleaned":
      return {
        ...base,
        type: "thread.rollback.cleaned",
        severity: "info",
        title: "Thread rollback cleaned",
        summary: short(`removed=${data.removedMessageCount ?? ""}`),
        status: "cleaned",
        data,
      }
    case "context.compaction.started":
      return {
        ...base,
        type: "context.compaction.started",
        severity: "info",
        title: "Context compaction started",
        summary: short(`reason=${data.reason ?? ""} auto=${data.auto ?? ""}`),
        status: "started",
        data,
      }
    case "context.compaction.completed":
      return {
        ...base,
        type: "context.compaction.completed",
        severity: "info",
        title: "Context compaction completed",
        summary: short(`summary=${data.summaryChars ?? 0} chars tail=${data.tailStartID ?? "none"}`),
        status: "completed",
        data,
      }
    case "context.compaction.failed":
      return {
        ...base,
        type: "context.compaction.failed",
        severity: "error",
        title: "Context compaction failed",
        summary: short(String(data.reason ?? "failed")),
        status: "failed",
        data,
      }
    case "context.compaction.pruned":
      return {
        ...base,
        type: "context.compaction.pruned",
        severity: "info",
        title: "Context tool output pruned",
        summary: short(`parts=${data.partCount ?? ""} tokens=${data.prunedTokens ?? ""}`),
        status: "pruned",
        data,
      }
    case "extension.data.attached":
      return {
        ...base,
        type: "extension.data.attached",
        severity: "info",
        title: "Extension data attached",
        summary: short(`namespaces=${Array.isArray(data.namespaces) ? data.namespaces.join(", ") : ""}`),
        status: "attached",
        data,
      }
    case "turn.started":
      return {
        ...base,
        type: "turn.started",
        severity: "info",
        title: "Turn started",
        summary: short(`cwd=${data.cwd ?? ""}`),
        status: "started",
        data,
      }
    case "turn.repeated_tool.warning":
      return {
        ...base,
        type: "turn.warning",
        severity: "warning",
        title: "Repeated tool pattern detected",
        summary: short(String(data.tool ?? "")),
        status: "warning",
        data,
      }
    case "turn.budget_limited":
      return {
        ...base,
        type: "turn.warning",
        severity: "error",
        title: "Turn budget limited",
        summary: short(`${data.maxSteps ?? ""} steps`),
        status: "budget_limited",
        data,
      }
    case "turn.completed":
      return {
        ...base,
        type: "turn.completed",
        severity: "info",
        title: "Turn completed",
        summary: short(`${data.durationMs ?? 0} ms`),
        status: "completed",
        data,
      }
    case "turn.aborted":
      return {
        ...base,
        type: "turn.aborted",
        severity: "warning",
        title: "Turn aborted",
        summary: short(String(data.abortSourceLabel ?? data.reason ?? "aborted")),
        status: "aborted",
        data,
      }
    case "turn.abort.requested":
      return {
        ...base,
        type: "turn.abort.requested",
        severity: data.source === "unknown" ? "warning" : "info",
        title: "Turn abort requested",
        summary: short(String(data.sourceLabel ?? data.source ?? "unknown")),
        status: "requested",
        data,
      }
    case "turn.abort.resolved":
      return {
        ...base,
        type: "turn.abort.resolved",
        severity: data.source === "unknown" ? "warning" : "info",
        title: "Turn abort resolved",
        summary: short(`${data.sourceLabel ?? data.source ?? "unknown"} -> ${data.result ?? "unknown"}`),
        status: String(data.result ?? "resolved"),
        data,
      }
    case "turn.terminal.anomaly":
      return {
        ...base,
        type: "turn.terminal.anomaly",
        severity: "warning",
        title: "Turn terminal anomaly",
        summary: short(String(data.reason ?? "anomaly")),
        status: "anomaly",
        data,
      }
    case "turn.terminal.assistant_error":
      return {
        ...base,
        type: "turn.terminal.assistant_error",
        severity: "error",
        title: "Turn terminal assistant error",
        summary: short(String(data.reason ?? "assistant_error")),
        status: "error",
        data,
      }
    case "turn.diff.updated":
      return {
        ...base,
        type: "turn.diff.updated",
        severity: "info",
        title: "本轮代码改动已更新",
        summary: short(
          `files=${isRecord(data.summary) ? data.summary.files : "unknown"} mutations=${isRecord(data.summary) ? data.summary.mutations : "unknown"}`,
        ),
        status: "updated",
        data,
      }
    case "patch.quality.scored":
      return {
        ...base,
        type: "patch.quality.scored",
        severity:
          data.grade === "poor" ? "error" : data.grade === "risky" ? "warning" : "info",
        title: "补丁质量已评分",
        summary: short(`score=${data.score ?? "unknown"} grade=${data.grade ?? "unknown"}`),
        status: String(data.grade ?? "scored"),
        data,
      }
    case "turn.terminal.reconciled":
      return {
        ...base,
        type: "turn.terminal.reconciled",
        severity: "info",
        title: "Turn terminal reconciled",
        summary: short(String(data.outcome ?? "reconciled")),
        status: "reconciled",
        data,
      }
    case "engineering.reasoning.recorded":
      return {
        ...base,
        type: "engineering.reasoning.recorded",
        severity: "info",
        title: "Reasoning context recorded",
        summary: short(`${data.chars ?? 0} chars`),
        status: "recorded",
        data,
      }
    case "reasoning.summary.created":
      return {
        ...base,
        type: "reasoning.summary.created",
        severity: data.enabled === false ? "warning" : "info",
        title: "Reasoning summary created",
        summary: short(
          data.enabled === false
            ? String(data.reason ?? "disabled")
            : `${String(data.level ?? "auto")} ${data.summaryChars ?? 0} chars`,
        ),
        status: data.enabled === false ? "disabled" : "created",
        data,
      }
    case "reasoning.raw.item": {
      const rawPayload = data.raw_payload
      const safeData = { ...data }
      delete safeData.raw_payload
      const unsupported = safeData.kind === "unsupported"
      return {
        ...base,
        type: "reasoning.raw.item",
        severity: unsupported ? "warning" : "info",
        title: unsupported ? "Reasoning raw unsupported" : "Reasoning raw item captured",
        summary: unsupported
          ? short(String(safeData.reason ?? "provider emitted no reasoning raw item"))
          : short(`${safeData.kind ?? "reasoning"} #${safeData.sequence ?? ""}`),
        status: unsupported ? "unsupported" : "captured",
        data: safeData,
        raw: {
          source: "trace",
          phase: input.phase,
          sessionID: input.sessionID,
          turnID: input.turnID,
          messageID: input.messageID,
          reasoning_raw_item: safeData,
          raw_payload: rawPayload,
          extension_data: input.extension_data,
        },
      }
    }
    case "engineering.deployment_gate.updated":
      return {
        ...base,
        type: "engineering.deployment_gate.updated",
        severity: data.status === "failed" ? "warning" : "info",
        title: "Deployment gate updated",
        summary: short(`${data.gate ?? "deployment"} ${data.status ?? "updated"}`),
        status: String(data.status ?? "updated"),
        data,
      }
    case "engineering.benchmark.tier.selected":
      return {
        ...base,
        type: "engineering.benchmark.tier.selected",
        severity: "info",
        title: "Benchmark tier selected",
        summary: short(`${data.requestedTier ?? "unknown"} -> ${data.effectiveTier ?? "unknown"}`),
        status: "selected",
        data,
      }
    case "engineering.benchmark.started":
      return {
        ...base,
        type: "engineering.benchmark.started",
        severity: "info",
        title: "Benchmark tier started",
        summary: short(`${data.tier ?? "unknown"} ${data.command ?? "started"}`),
        status: "started",
        data,
      }
    case "engineering.benchmark.finished":
      return {
        ...base,
        type: "engineering.benchmark.finished",
        severity: data.status === "passed" ? "info" : "warning",
        title: "Benchmark tier finished",
        summary: short(`${data.status ?? "finished"} ${data.tier ?? "unknown"} ${data.command ?? ""}`),
        status: String(data.status ?? "finished"),
        data,
      }
    case "multi_agent.task.assigned":
      return {
        ...base,
        type: "multi_agent.task.assigned",
        severity: "info",
        title: "Multi-agent task assigned",
        summary: short(`${data.role ?? "custom"} -> ${data.agent ?? "agent"}`),
        status: "assigned",
        data,
      }
    case "multi_agent.task.settled":
      return {
        ...base,
        type: "multi_agent.task.settled",
        severity: data.status === "completed" ? "info" : "warning",
        title: "Multi-agent task settled",
        summary: short(`${data.role ?? "custom"} ${data.status ?? "settled"}`),
        status: String(data.status ?? "settled"),
        data,
      }
    case "multi_agent.conflict.detected":
      return {
        ...base,
        type: "multi_agent.conflict.detected",
        severity: "warning",
        title: "Multi-agent conflict detected",
        summary: short(String(data.reason ?? "conflict")),
        status: String(data.status ?? "open"),
        data,
      }
    case "engineering.verification.repair_requested":
      return {
        ...base,
        type: "engineering.verification.repair_requested",
        severity: "warning",
        title: "Verification repair requested",
        summary: short(String(data.continuationID ?? "repair")),
        status: "continued",
        data,
      }
    case "model.process.started":
      return {
        ...base,
        type: "model.request.started",
        severity: "info",
        title: "Model request started",
        summary: short(`${data.providerID ?? ""}/${data.modelID ?? ""}`),
        status: "started",
        data,
      }
    case "model.stream.started":
      return {
        ...base,
        type: "model.stream.started",
        severity: "info",
        title: "Model stream started",
        status: "started",
        data,
      }
    case "model.raw.chunk":
      return {
        ...base,
        type: "model.raw.chunk",
        severity: "info",
        title: "Model raw stream chunk captured",
        summary: short(`${data.kind ?? "chunk"} ${data.chars ?? 0} chars`),
        status: "captured",
        data,
      }
    case "model.raw.item": {
      const rawPayload = data.raw_payload
      const safeData = { ...data }
      delete safeData.raw_payload
      return {
        ...base,
        type: "model.raw.item",
        severity: "info",
        title: "Model raw response item captured",
        summary: short(`${safeData.kind ?? "item"} #${safeData.sequence ?? ""}`),
        status: "captured",
        data: safeData,
        raw: {
          source: "trace",
          phase: input.phase,
          sessionID: input.sessionID,
          turnID: input.turnID,
          messageID: input.messageID,
          raw_response_item: safeData,
          raw_payload: rawPayload,
          extension_data: input.extension_data,
        },
      }
    }
    case "model.capability.evaluated":
      return {
        ...base,
        type: "model.capability.evaluated",
        severity: "info",
        title: "Model capability evaluated",
        summary: short(String(modelInfoName(data))),
        status: "evaluated",
        data,
      }
    case "model.capability.degraded":
      return {
        ...base,
        type: "model.capability.degraded",
        severity: "warning",
        title: "Model capability degraded",
        summary: short(String(data.reason ?? "capability unsupported")),
        status: "degraded",
        data,
      }
    case "model.effort.resolved":
      return {
        ...base,
        type: "model.effort.resolved",
        severity: data.effort_resolution && isRecord(data.effort_resolution) && isRecord(data.effort_resolution.fallback) && data.effort_resolution.fallback.applied ? "warning" : "info",
        title: "Model effort resolved",
        summary: short(
          data.requested_effort === data.effective_effort
            ? `effective ${String(data.effective_effort ?? "default")}`
            : `${String(data.requested_effort ?? "default")} -> ${String(data.effective_effort ?? "disabled")}`,
        ),
        status: "resolved",
        data,
      }
    case "model.service_tier.resolved":
      return {
        ...base,
        type: "model.service_tier.resolved",
        severity:
          data.service_tier_resolution &&
          isRecord(data.service_tier_resolution) &&
          isRecord(data.service_tier_resolution.fallback) &&
          data.service_tier_resolution.fallback.applied
            ? "warning"
            : "info",
        title: "Model service tier resolved",
        summary: short(
          data.requested_service_tier === data.effective_service_tier
            ? `effective ${String(data.effective_service_tier ?? "default")}`
            : `${String(data.requested_service_tier ?? "default")} -> ${String(data.effective_service_tier ?? "disabled")}`,
        ),
        status: "resolved",
        data,
      }
    case "model.request.retrying":
    case "model.stream.retrying":
      return {
        ...base,
        type: "model.retrying",
        severity: "warning",
        title: input.phase === "model.stream.retrying" ? "Model stream retrying" : "Model request retrying",
        summary: short(data.message),
        status: "retrying",
        data: { ...data, retryKind: input.phase === "model.stream.retrying" ? "stream" : "request" },
      }
    case "model.process.finished":
      return {
        ...base,
        type: "model.request.finished",
        severity: data.hasError ? "error" : "info",
        title: "Model request finished",
        summary: short(String(data.finish ?? data.result ?? "")),
        status: data.hasError ? "error" : "finished",
        data,
      }
    case "runtime.provider.selected":
      return {
        ...base,
        type: "runtime.provider.selected",
        severity: data.fallbackFrom ? "warning" : "info",
        title: "Runtime provider selected",
        summary: short(
          data.fallbackFrom
            ? `${String(data.fallbackFrom)} -> ${String(data.runtime ?? "unknown")}: ${String(data.reason ?? "")}`
            : `${String(data.runtime ?? "unknown")} ${String(data.providerID ?? "")}/${String(data.modelID ?? "")}`,
        ),
        status: String(data.runtime ?? "selected"),
        data,
      }
    case "runtime.item.received":
      return {
        ...base,
        type: "runtime.item.received",
        severity: "info",
        toolCallID: typeof data.toolCallID === "string" ? data.toolCallID : undefined,
        title: "Runtime item received",
        summary: short(`${data.kind ?? "item"} ${data.sourceEventType ?? ""} ${data.status ?? ""}`),
        status: String(data.status ?? "received"),
        data,
      }
    case "runtime.item.settled":
      return {
        ...base,
        type: "runtime.item.settled",
        severity: data.status === "error" ? "error" : "info",
        toolCallID: typeof data.toolCallID === "string" ? data.toolCallID : undefined,
        title: "Runtime item settled",
        summary: short(`${data.kind ?? "item"} ${data.sourceEventType ?? ""} ${data.status ?? ""}`),
        status: String(data.status ?? "settled"),
        data,
      }
    case "provider.tool.call":
      return {
        ...base,
        type: "provider.tool.call",
        severity: "info",
        toolCallID: typeof data.toolCallID === "string" ? data.toolCallID : undefined,
        title: `供应商托管工具调用：${data.tool ?? "unknown"}`,
        summary: short(`${providerToolType(data)} ${data.tool ?? ""}`),
        status: "called",
        data,
      }
    case "provider.tool.result":
      return {
        ...base,
        type: "provider.tool.result",
        severity: data.status === "failed" || data.status === "aborted" ? "error" : "info",
        toolCallID: typeof data.toolCallID === "string" ? data.toolCallID : undefined,
        title: `供应商托管工具结果：${data.tool ?? "unknown"}`,
        summary: short(`${data.status ?? "settled"} ${providerToolType(data)} raw=${data.rawOutputRef ? "yes" : "no"}`),
        status: typeof data.status === "string" ? data.status : "completed",
        data,
      }
    case "exec_server.process.started":
      return {
        ...base,
        type: "executor.started",
        severity: "info",
        title: "Codex exec-server process started",
        summary: short(String(data.cwd ?? "")),
        status: "started",
        data,
      }
    case "exec_server.process.finished":
      return {
        ...base,
        type: "executor.finished",
        severity: "info",
        title: "Codex exec-server process finished",
        summary: short(`${data.durationMs ?? ""} ms`),
        status: "finished",
        data,
      }
    case "exec_command.started":
      return {
        ...base,
        type: "exec_command.started",
        severity: "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "统一命令开始",
        summary: short(`${data.backend ?? "backend"} ${data.cwd ?? ""} ${data.command ?? ""}`),
        status: "started",
        data,
      }
    case "exec_command.output":
      return {
        ...base,
        type: "exec_command.output",
        severity: "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "统一命令输出",
        summary: short(`${data.stream ?? "stdout"} #${data.seq ?? ""} ${data.chars ?? 0} chars`),
        status: "output",
        data,
      }
    case "exec_command.output_delta": {
      const safeData = { ...data }
      delete safeData.base64_payload
      delete safeData.delta_base64
      if (safeData.codex_command_exec && typeof safeData.codex_command_exec === "object") {
        const codexCommandExec = { ...(safeData.codex_command_exec as JsonRecord) }
        delete codexCommandExec.deltaBase64
        safeData.codex_command_exec = codexCommandExec
      }
      if (safeData.codex_item && typeof safeData.codex_item === "object") {
        const codexItem = { ...(safeData.codex_item as JsonRecord) }
        delete codexItem.delta
        safeData.codex_item = codexItem
      }
      return {
        ...base,
        type: "exec_command.output_delta",
        severity: "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "统一命令输出增量",
        summary: short(`${data.stream ?? "stdout"} #${data.seq ?? ""} ${data.byte_length ?? 0} bytes`),
        status: "delta",
        data: safeData,
        raw: {
          source: "trace",
          phase: input.phase,
          sessionID: input.sessionID,
          turnID: input.turnID,
          messageID: input.messageID,
          output_delta: safeData,
          base64_payload: data.base64_payload ?? data.delta_base64,
          delta_base64: data.delta_base64 ?? data.base64_payload,
          raw_payload: data,
          raw_output_ref: data.raw_output_ref,
          extension_data: input.extension_data,
        },
      }
    }
    case "exec_command.end":
      return {
        ...base,
        type: "exec_command.end",
        severity: data.status === "completed" ? "info" : data.status === "aborted" ? "warning" : "error",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "统一命令标准终态",
        summary: short(`${data.status ?? "finished"} exit=${data.exit_code ?? "null"} ${data.duration_ms ?? ""}ms`),
        status: String(data.status ?? "finished"),
        data,
      }
    case "exec_command.finished":
      return {
        ...base,
        type: "exec_command.finished",
        severity: data.status === "completed" ? "info" : data.status === "aborted" ? "warning" : "error",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "统一命令结束",
        summary: short(`${data.status ?? "finished"} exit=${data.exit_code ?? "null"} ${data.duration_ms ?? ""}ms`),
        status: String(data.status ?? "finished"),
        data,
      }
    case "exec_command.yielded":
      return {
        ...base,
        type: "exec_command.yielded",
        severity: "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "统一命令已让出",
        summary: short(`running process=${data.process_id ?? ""} yield=${data.effective_yield_time_ms ?? ""}ms`),
        status: "running",
        data,
      }
    case "exec_command.fallback":
      return {
        ...base,
        type: "exec_command.fallback",
        severity: "warning",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "统一命令执行器回退",
        summary: short(`${data.from_backend ?? ""} -> ${data.to_backend ?? ""}: ${data.reason ?? ""}`),
        status: "fallback",
        data,
      }
    case "exec.approval.requested":
      return {
        ...base,
        type: "exec.approval.requested",
        severity: "warning",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "命令审批请求",
        summary: short(`${data.reason ?? data.approval_policy ?? "approval"} ${data.cwd ?? ""} ${data.command ?? ""}`),
        status: "requested",
        data,
      }
    case "exec.approval.resolved":
      return {
        ...base,
        type: "exec.approval.resolved",
        severity: data.reply === "reject" ? "error" : "info",
        toolCallID: isRecord(data.request) && typeof data.request.tool_call_id === "string" ? data.request.tool_call_id : undefined,
        title: "命令审批完成",
        summary: short(`${data.reply ?? ""} ${data.scope ?? ""} ${data.review_reason ?? ""}`),
        status: typeof data.reply === "string" ? data.reply : "resolved",
        data,
      }
    case "apply_patch.approval.requested":
      return {
        ...base,
        type: "apply_patch.approval.requested",
        severity: "warning",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "补丁审批请求",
        summary: short(`${data.risk_level ?? "risk"} files=${data.turn_diff_preview && isRecord(data.turn_diff_preview) ? data.turn_diff_preview.files_changed ?? "" : ""}`),
        status: "requested",
        data,
      }
    case "apply_patch.approval.resolved":
      return {
        ...base,
        type: "apply_patch.approval.resolved",
        severity: data.reply === "reject" ? "error" : "info",
        toolCallID: isRecord(data.request) && typeof data.request.tool_call_id === "string" ? data.request.tool_call_id : undefined,
        title: "补丁审批完成",
        summary: short(`${data.reply ?? ""} ${data.scope ?? ""} ${data.review_reason ?? ""}`),
        status: typeof data.reply === "string" ? data.reply : "resolved",
        data,
      }
    case "exec_process.registered":
      return {
        ...base,
        type: "exec_process.registered",
        severity: "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "后台进程已登记",
        summary: short(`${data.process_id ?? ""} ${data.cwd ?? ""} ${data.command ?? ""}`),
        status: "running",
        data,
      }
    case "exec_process.await_started":
      return {
        ...base,
        type: "exec_process.await_started",
        severity: "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "后台进程等待开始",
        summary: short(`${data.process_id ?? ""} timeout=${data.effective_timeout_ms ?? ""}ms`),
        status: "waiting",
        data,
      }
    case "exec_process.await_progress":
      return {
        ...base,
        type: "exec_process.await_progress",
        severity: "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "后台进程等待进展",
        summary: short(`${data.process_id ?? ""} ${data.target_status ?? ""} output=${data.output_chars ?? 0}`),
        status: "progress",
        data,
      }
    case "exec_process.await_finished":
      return {
        ...base,
        type: "exec_process.await_finished",
        severity: data.status === "denied" || data.status === "failed" || data.status === "timeout" ? "error" : "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "后台进程等待结束",
        summary: short(`${data.process_id ?? ""} ${data.status ?? "finished"} exit=${data.exit_code ?? "null"}`),
        status: String(data.status ?? "finished"),
        data,
      }
    case "exec_process.await_timeout":
      return {
        ...base,
        type: "exec_process.await_timeout",
        severity: "warning",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "后台进程等待超时",
        summary: short(`${data.process_id ?? ""} still ${data.target_status ?? "running"}`),
        status: "await_timeout",
        data,
      }
    case "exec_process.capacity_checked":
      return {
        ...base,
        type: "exec_process.capacity_checked",
        severity: "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "后台进程容量检查通过",
        summary: short(`session=${data.session_count ?? 0}/${data.limit_per_session ?? ""}`),
        status: "allowed",
        data,
      }
    case "exec_process.capacity_denied":
      return {
        ...base,
        type: "exec_process.capacity_denied",
        severity: "error",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "后台进程容量已满",
        summary: short(`${data.dimension ?? "unknown"} ${data.reason ?? ""}`),
        status: "denied",
        data,
      }
    case "exec_process.finished":
      return {
        ...base,
        type: "exec_process.finished",
        severity: data.status === "completed" ? "info" : data.status === "aborted" ? "warning" : "error",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "后台进程已结束",
        summary: short(`${data.process_id ?? ""} ${data.status ?? "finished"} exit=${data.exit_code ?? "null"}`),
        status: String(data.status ?? "finished"),
        data,
      }
    case "exec_process.finish_ignored":
      return {
        ...base,
        type: "exec_process.finish_ignored",
        severity: "warning",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "后台进程重复终态已忽略",
        summary: short(`${data.process_id ?? ""} ${data.current_status ?? ""} <- ${data.requested_status ?? ""}`),
        status: "ignored",
        data,
      }
    case "exec_process.abort_requested":
      return {
        ...base,
        type: "exec_process.abort_requested",
        severity: "warning",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "后台进程请求中止",
        summary: short(`${data.process_id ?? ""} ${data.reason ?? ""}`),
        status: "requested",
        data,
      }
    case "exec_process.abort_denied":
      return {
        ...base,
        type: "exec_process.abort_denied",
        severity: "error",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "后台进程中止被拒绝",
        summary: short(`${data.process_id ?? ""} ${data.reason ?? ""}`),
        status: "denied",
        data,
      }
    case "exec_process.cleanup":
      return {
        ...base,
        type: "exec_process.cleanup",
        severity: data.status === "failed" ? "error" : data.status === "terminated" ? "warning" : "info",
        title:
          data.status === "summary"
            ? "后台进程清理汇总"
            : data.status === "terminated"
              ? "后台进程已终止并清理"
              : data.status === "failed"
                ? "后台进程清理失败"
                : "后台进程记录已清理",
        summary:
          data.status === "summary"
            ? short(`cleaned=${data.cleaned ?? 0} failed=${data.failed ?? 0}`)
            : short(`${data.process_id ?? ""} ${data.previous_status ?? ""} ${data.reason ?? ""}`),
        status: String(data.status ?? "cleaned"),
        data,
      }
    case "terminal.stdin.written":
      return {
        ...base,
        type: "terminal.stdin.written",
        severity: "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "终端输入已写入",
        summary: short(`${data.process_id ?? ""} ${data.control ?? "text"} ${data.chars ?? 0} chars`),
        status: "written",
        data,
      }
    case "terminal.stdin.denied":
      return {
        ...base,
        type: "terminal.stdin.denied",
        severity: "warning",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "终端输入被拒绝",
        summary: short(`${data.process_id ?? "unknown"} ${data.reason ?? "denied"}`),
        status: "denied",
        data,
      }
    case "terminal.interaction":
      return {
        ...base,
        type: "terminal.interaction",
        severity: data.phase === "error" || data.phase === "timeout" ? "warning" : "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "终端交互事件",
        summary: short(`${data.process_id ?? ""} ${data.phase ?? "interaction"} ${data.status ?? ""}`),
        status: typeof data.status === "string" ? data.status : String(data.phase ?? "interaction"),
        data,
      }
    case "command.output":
      return {
        ...base,
        type: "command.output",
        severity: "info",
        title: "Command output chunk",
        summary: short(`${data.stream ?? "stdout"} #${data.seq ?? ""} ${data.chars ?? 0} chars`),
        status: "output",
        data,
      }
    case "http.request.classified":
      return {
        ...base,
        type: "http.request.classified",
        severity: String(data.classification ?? "").includes("denied") || String(data.classification ?? "").includes("failed") ? "warning" : "info",
        title: "HTTP request classified",
        summary: short(`${data.classification ?? "unknown"} ${data.status ?? ""} ${data.url ?? ""}`),
        status: String(data.classification ?? "classified"),
        data,
      }
    case "request_permissions.requested":
      return {
        ...base,
        type: "request_permissions.requested",
        severity: "warning",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "权限提升请求",
        summary: short(`${Array.isArray(data.permissions) ? data.permissions.join(", ") : ""} ${data.reason ?? ""}`),
        status: "requested",
        data,
      }
    case "guardian.assessment.completed":
      return {
        ...base,
        type: "guardian.assessment.completed",
        severity: data.hard_block === true ? "error" : data.risk_level === "high" || data.risk_level === "critical" ? "warning" : "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "Guardian 风险评估完成",
        summary: short(`${data.risk_level ?? "unknown"} ${data.user_visible_explanation ?? ""}`),
        status: data.hard_block === true ? "denied" : String(data.suggested_decision ?? "assessed"),
        data,
      }
    case "reviewer.resolved":
      return {
        ...base,
        type: "reviewer.resolved",
        severity: "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "审批人解析完成",
        summary: short(`${data.matched_source ?? "unknown"} ${isRecord(data.selected_reviewer) ? data.selected_reviewer.label ?? "" : ""}`),
        status: String(data.matched_source ?? "resolved"),
        data,
      }
    case "auto_review.completed":
      return {
        ...base,
        type: "auto_review.completed",
        severity: data.decision === "auto_deny" ? "error" : data.decision === "escalate" ? "warning" : "info",
        toolCallID: typeof data.tool_call_id === "string" ? data.tool_call_id : undefined,
        title: "自动审批审查完成",
        summary: short(`${data.decision ?? "unknown"} ${data.reason ?? ""}`),
        status: String(data.decision ?? "completed"),
        data,
      }
    case "request_permissions.resolved":
      return {
        ...base,
        type: "request_permissions.resolved",
        severity:
          isRecord(data.final_decision) && data.final_decision.status === "denied"
            ? "error"
            : Array.isArray(data.unsupported) && data.unsupported.length > 0
              ? "warning"
              : "info",
        toolCallID:
          isRecord(data.request) && typeof data.request.tool_call_id === "string" ? data.request.tool_call_id : undefined,
        title: "权限提升处理完成",
        summary: short(`${isRecord(data.final_decision) ? data.final_decision.status ?? "" : ""}`),
        status:
          isRecord(data.final_decision) && typeof data.final_decision.status === "string"
            ? data.final_decision.status
            : "resolved",
        data,
      }
    case "exec_server.fs.started":
      return {
        ...base,
        type: "executor.started",
        severity: "info",
        title: "Codex exec-server file operation started",
        summary: short(`${data.method ?? "fs"} ${data.path ?? ""}`),
        status: "started",
        data,
      }
    case "exec_server.fs.finished":
      return {
        ...base,
        type: "executor.finished",
        severity: "info",
        title: "Codex exec-server file operation finished",
        summary: short(`${data.method ?? "fs"} ${data.path ?? ""}`),
        status: "finished",
        data,
      }
    case "exec_server.http.started":
      return {
        ...base,
        type: "executor.started",
        severity: "info",
        title: "Codex exec-server HTTP request started",
        summary: short(`${data.method ?? "GET"} ${data.url ?? ""}`),
        status: "started",
        data,
      }
    case "exec_server.http.finished":
      return {
        ...base,
        type: "executor.finished",
        severity: "info",
        title: "Codex exec-server HTTP request finished",
        summary: short(`${data.durationMs ?? ""} ms ${data.url ?? ""}`),
        status: "finished",
        data,
      }
    case "exec_server.fallback":
      return {
        ...base,
        type: "executor.fallback",
        severity: "warning",
        title: "Executor fallback",
        summary: short(String(data.reason ?? "")),
        status: "warning",
        data,
      }
    case "tool.foundation.resolved":
      return {
        ...base,
        type: "tool.foundation.resolved",
        severity: "info",
        title: "Tool foundation resolved",
        summary: short(`tools=${data.toolCount ?? 0} upstream=${data.upstream ?? "opencode-v2"}`),
        status: "resolved",
        data,
      }
    case "tool.foundation.executing":
      return {
        ...base,
        type: "tool.foundation.executing",
        severity: "info",
        toolCallID: typeof data.callID === "string" ? data.callID : undefined,
        title: `Tool foundation executing: ${data.tool ?? "unknown"}`,
        summary: short(String(data.source ?? "")),
        status: "executing",
        data,
      }
    case "tool.foundation.settled":
      return {
        ...base,
        type: "tool.foundation.settled",
        severity: data.status === "error" ? "error" : "info",
        toolCallID: typeof data.callID === "string" ? data.callID : undefined,
        title: `Tool foundation settled: ${data.tool ?? "unknown"}`,
        summary: short(`${data.status ?? "settled"} ${data.durationMs ?? ""}ms`),
        status: typeof data.status === "string" ? data.status : "settled",
        data,
      }
    case "tool.lifecycle.requested":
    case "tool.lifecycle.started":
    case "tool.lifecycle.completed":
    case "tool.lifecycle.failed":
    case "tool.lifecycle.aborted":
      return {
        ...base,
        type: input.phase,
        severity: input.phase === "tool.lifecycle.failed" || input.phase === "tool.lifecycle.aborted" ? "error" : "info",
        toolCallID: typeof data.callID === "string" ? data.callID : undefined,
        title:
          input.phase === "tool.lifecycle.requested"
            ? `Tool lifecycle requested: ${data.tool ?? "unknown"}`
            : input.phase === "tool.lifecycle.started"
              ? `Tool lifecycle started: ${data.tool ?? "unknown"}`
              : input.phase === "tool.lifecycle.completed"
                ? `Tool lifecycle completed: ${data.tool ?? "unknown"}`
                : input.phase === "tool.lifecycle.aborted"
                  ? `Tool lifecycle aborted: ${data.tool ?? "unknown"}`
                  : `Tool lifecycle failed: ${data.tool ?? "unknown"}`,
        summary: short(
          `${data.status ?? ""} profile=${data.permission_profile ?? ""} cwd=${data.environment_cwd ?? data.cwd ?? ""}`,
        ),
        status: typeof data.status === "string" ? data.status : String(input.phase.split(".").at(-1) ?? "updated"),
        data,
      }
    case "tool.output.stored":
      return {
        ...base,
        type: "tool.output.stored",
        severity: "info",
        toolCallID: typeof data.callID === "string" ? data.callID : undefined,
        title: "Tool output stored",
        summary: short(`${data.tool ?? "unknown"} ${data.bytes ?? 0} bytes`),
        status: "stored",
        data,
      }
    case "tool.result.settled":
      return {
        ...base,
        type: "tool.result.settled",
        severity: data.status === "failed" || data.status === "aborted" ? "error" : "info",
        toolCallID: typeof data.toolCallID === "string" ? data.toolCallID : undefined,
        title: `Tool result settled: ${data.tool ?? "unknown"}`,
        summary: short(`${data.status ?? "settled"} ${data.durationMs ?? ""}ms result=${data.resultID ?? ""}`),
        status: typeof data.status === "string" ? data.status : "settled",
        data,
      }
    case "file.read":
      return {
        ...base,
        type: "file.read",
        severity: "info",
        toolCallID: typeof data.call_id === "string" ? data.call_id : undefined,
        title: `读取文件：${data.kind ?? "file"}`,
        summary: short(`${data.resolved_path ?? data.requested_path ?? ""} env=${data.environment_id ?? "unknown"} truncated=${isRecord(data.truncation) ? data.truncation.truncated : "unknown"}`),
        status: typeof data.status === "string" ? data.status : "completed",
        data,
      }
    case "directory.read":
      return {
        ...base,
        type: "directory.read",
        severity: "info",
        toolCallID: typeof data.call_id === "string" ? data.call_id : undefined,
        title: `读取目录：${data.resolved_path ?? data.requested_path ?? ""}`,
        summary: short(
          `${data.resolved_path ?? data.requested_path ?? ""} env=${data.environment_id ?? "unknown"} entries=${isRecord(data.listing) ? data.listing.returned : "unknown"}/${isRecord(data.listing) ? data.listing.total : "unknown"} truncated=${isRecord(data.truncation) ? data.truncation.truncated : "unknown"}`,
        ),
        status: typeof data.status === "string" ? data.status : "completed",
        data,
      }
    case "file.search":
      return {
        ...base,
        type: "file.search",
        severity: "info",
        toolCallID: typeof data.call_id === "string" ? data.call_id : undefined,
        title: `搜索文件：${data.requested_pattern ?? data.tool ?? ""}`,
        summary: short(
          `${data.search_cwd ?? data.requested_path ?? ""} env=${data.environment_id ?? "unknown"} returned=${isRecord(data.counts) ? data.counts.returned : "unknown"} scanned=${isRecord(data.counts) ? data.counts.scanned : "unknown"} truncated=${isRecord(data.truncation) ? data.truncation.truncated : "unknown"}`,
        ),
        status: typeof data.status === "string" ? data.status : "completed",
        data,
      }
    case "file.write":
      return {
        ...base,
        type: "file.write",
        severity: data.status === "failed" ? "error" : "info",
        toolCallID: typeof data.call_id === "string" ? data.call_id : undefined,
        title: `写入文件：${data.resolved_path ?? data.requested_path ?? ""}`,
        summary: short(
          `${data.resolved_path ?? data.requested_path ?? ""} status=${data.status ?? "completed"} op=${isRecord(data.mutation) ? data.mutation.operation : "unknown"} dryRun=${isRecord(data.policy) ? data.policy.dry_run : "unknown"}`,
        ),
        status: typeof data.status === "string" ? data.status : "completed",
        data,
      }
    case "tool.call.started":
      return {
        ...base,
        type: "tool.call.started",
        severity: "info",
        toolCallID: typeof data.callID === "string" ? data.callID : undefined,
        title: `Tool started: ${data.tool ?? "unknown"}`,
        summary: short(String(data.tool ?? "")),
        status: "started",
        data,
      }
    case "tool.call.finished":
      return {
        ...base,
        type: "tool.call.finished",
        severity: data.status === "error" ? "error" : "info",
        toolCallID: typeof data.callID === "string" ? data.callID : undefined,
        title: `Tool finished: ${data.tool ?? "unknown"}`,
        summary: short(String(data.title ?? data.errorType ?? data.status ?? "")),
        status: typeof data.status === "string" ? data.status : "finished",
        data,
      }
    case "tools.dynamic.resolved":
      return {
        ...base,
        type: "tools.dynamic.resolved",
        severity: data.model_supports_tools === false ? "warning" : "info",
        title: "Dynamic tools resolved",
        summary: short(`available=${data.availableCount ?? 0} disabled=${data.disabledCount ?? 0}`),
        status: "resolved",
        data,
      }
    case "skill.catalog.resolved":
      return {
        ...base,
        type: "skill.catalog.resolved",
        severity: "info",
        title: "Skill catalog resolved",
        summary: short(`available=${data.availableCount ?? 0} disabled=${data.disabledCount ?? 0}`),
        status: "resolved",
        data,
      }
    case "skill.catalog.injected":
      return {
        ...base,
        type: "skill.catalog.injected",
        severity: "info",
        title: "Skill catalog injected",
        summary: short(`injected=${data.injectedCount ?? 0}`),
        status: "injected",
        data,
      }
    case "skill.used":
      return {
        ...base,
        type: "skill.used",
        severity: "info",
        toolCallID: typeof data.callID === "string" ? data.callID : undefined,
        title: `Skill used: ${data.name ?? "unknown"}`,
        summary: short(String(data.name ?? "")),
        status: "used",
        data,
      }
    case "tool.sandbox.checked":
    case "tool.sandbox.denied":
      return {
        ...base,
        type: input.phase,
        severity: input.phase === "tool.sandbox.denied" ? "error" : "info",
        toolCallID: typeof data.callID === "string" ? data.callID : undefined,
        title: input.phase === "tool.sandbox.denied" ? "沙箱拒绝工具访问" : "沙箱检查通过",
        summary: short(String(data.reason ?? data.target ?? data.path ?? data.tool ?? "")),
        status: input.phase === "tool.sandbox.denied" ? "denied" : "checked",
        data,
      }
    case "tool.sandbox.capability":
      return {
        ...base,
        type: "tool.sandbox.capability",
        severity: data?.bwrap && typeof data.bwrap === "object" && (data.bwrap as JsonRecord).available === false ? "warning" : "info",
        title: "Sandbox capability checked",
        summary: short(
          `${data.backend ?? data.tool ?? ""} ${isRecord(data.linux_sandbox_helper) ? `${data.linux_sandbox_helper.backend ?? ""}/${data.linux_sandbox_helper.mode ?? ""}` : ""}`,
        ),
        status: "checked",
        data,
      }
    case "sandbox.effective":
      return {
        ...base,
        type: "sandbox.effective",
        severity: "info",
        title: "Sandbox effective policy",
        summary: short(`${data.tool ?? "tool"} cwd=${data.cwd ?? "unknown"} network=${data.network_policy ?? "unknown"}`),
        status: "checked",
        data,
      }
    case "security.constraint.checked":
    case "security.constraint.denied":
      return {
        ...base,
        type: input.phase,
        severity: input.phase === "security.constraint.denied" ? "error" : "info",
        toolCallID: typeof data.callID === "string" ? data.callID : undefined,
        title: input.phase === "security.constraint.denied" ? "硬安全约束拒绝" : "硬安全约束检查通过",
        summary: short(String(data.reason ?? data.target ?? data.kind ?? "")),
        status: input.phase === "security.constraint.denied" ? "denied" : "checked",
        data,
      }
    case "shell.env.policy.applied":
      return {
        ...base,
        type: "shell.env.policy.applied",
        severity: "info",
        title: "Shell environment policy applied",
        summary: short(`mode=${data.mode ?? "unknown"} removed=${Array.isArray(data.removedKeys) ? data.removedKeys.length : 0}`),
        status: "applied",
        data,
      }
    case "network.proxy.applied":
    case "network.proxy.unavailable":
      return {
        ...base,
        type: input.phase,
        severity: input.phase === "network.proxy.unavailable" ? "warning" : "info",
        toolCallID: typeof data.callID === "string" ? data.callID : undefined,
        title: input.phase === "network.proxy.unavailable" ? "NetworkProxy 不可用" : "NetworkProxy 已应用",
        summary: short(`${data.tool ?? "network"} ${data.status ?? ""} ${data.target ?? ""} ${data.reason ?? ""}`),
        status: input.phase === "network.proxy.unavailable" ? "unavailable" : "applied",
        data,
      }
    case "prompt.completed":
    case "text.finished":
      return {
        ...base,
        type: "final.output",
        severity: "info",
        title: "Final output updated",
        summary: short(`${data.chars ?? ""} chars`),
        status: "completed",
        data,
      }
    default:
      return undefined
  }
}

function toolPath(input: unknown) {
  if (!isRecord(input)) return undefined
  const value = input.filePath ?? input.file_path ?? input.path ?? input.filename
  return typeof value === "string" ? value : undefined
}

function toolCommand(input: unknown) {
  if (!isRecord(input)) return undefined
  const value = input.command ?? input.cmd
  return typeof value === "string" ? value : undefined
}

function makeBusEvents(input: BusRecordInput): PublicEventDraft[] {
  const { event, directory, project, workspace } = input
  const props = event.properties ?? {}
  const raw = { source: "bus", directory, project, workspace, event }
  const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined
  const common = { source: "bus" as const, sessionID, raw }

  if (event.type === "permission.asked") {
    const approvalID = typeof props.id === "string" ? props.id : undefined
    const turnID = typeof props.turnID === "string" ? props.turnID : undefined
    const messageID = isRecord(props.tool) && typeof props.tool.messageID === "string" ? props.tool.messageID : undefined
    const toolCallID = isRecord(props.tool) && typeof props.tool.callID === "string" ? props.tool.callID : undefined
    const execApproval = isRecord(props.metadata) ? props.metadata.exec_approval : undefined
    const applyPatchApproval = isRecord(props.metadata) ? props.metadata.apply_patch_approval : undefined
    const guardianAssessment =
      isRecord(props.metadata) ? props.metadata.guardian_assessment ?? props.guardian_assessment : props.guardian_assessment
    const autoReviewResult =
      isRecord(props.metadata) ? props.metadata.auto_review_result ?? props.auto_review_result : props.auto_review_result
    const reviewerResolution =
      isRecord(props.metadata) ? props.metadata.reviewer_resolution ?? props.reviewer_resolution : props.reviewer_resolution
    if (approvalID) {
      approvalRequests.set(approvalID, {
        sessionID,
        turnID,
        messageID,
        toolCallID,
        execApproval,
        applyPatchApproval,
        guardianAssessment,
        autoReviewResult,
        reviewerResolution,
      })
    }
    return [
      {
        ...common,
        type: "approval.requested",
        severity: "warning",
        turnID,
        messageID,
        toolCallID,
        title: "Approval requested",
        summary: short(`${props.permission ?? "permission"} ${Array.isArray(props.patterns) ? props.patterns.join(", ") : ""}`),
        status: "requested",
        data: {
          id: props.id,
          permission: props.permission,
          patterns: props.patterns,
          always: props.always,
          turnID: props.turnID,
          requested_by: props.requested_by,
          requested_at: props.requested_at,
          approval_reviewer: props.approval_reviewer,
          reviewed_by: props.reviewed_by,
          review_result: props.review_result ?? "pending",
          review_reason: props.review_reason,
          review_time: props.review_time,
          overridden_by_constraints: props.overridden_by_constraints === true,
          guardian_assessment: guardianAssessment,
          auto_review_result: autoReviewResult,
          reviewer_resolution: reviewerResolution,
          approvalPolicy: props.approvalPolicy,
          permissionProfile: props.permissionProfile,
          sandboxPolicy: props.sandboxPolicy,
          tool: props.tool,
          exec_approval: execApproval,
          apply_patch_approval: applyPatchApproval,
        },
      },
    ]
  }

  if (event.type === "permission.replied") {
    const requestID = typeof props.requestID === "string" ? props.requestID : undefined
    const pending = requestID ? approvalRequests.get(requestID) : undefined
    const approvalDecision = isRecord(props.approval_decision)
      ? props.approval_decision
      : approvalDecisionFromBus(props, pending)
    const status =
      typeof props.scope === "string"
        ? props.scope
        : isRecord(approvalDecision) && typeof approvalDecision.grant_scope === "string"
          ? approvalDecision.grant_scope
          : typeof props.reply === "string"
            ? props.reply
            : "resolved"
    return [
      {
        ...common,
        type: "approval.resolved",
        severity: props.reply === "reject" ? "error" : "info",
        turnID: pending?.turnID,
        messageID: pending?.messageID,
        toolCallID: pending?.toolCallID,
        title: "Approval resolved",
        summary: short(
          isRecord(approvalDecision) && typeof approvalDecision.description === "string"
            ? approvalDecision.description
            : String(status),
        ),
        status,
        data: {
          requestID,
          reply: props.reply,
          scope: props.scope,
          approval_decision: approvalDecision,
          reviewed_by: props.reviewed_by,
          review_result: props.review_result,
          review_reason: props.review_reason,
          review_time: props.review_time,
          overridden_by_constraints: props.overridden_by_constraints === true,
          guardian_assessment: pending?.guardianAssessment,
          auto_review_result: pending?.autoReviewResult,
          reviewer_resolution: pending?.reviewerResolution,
          exec_approval: pending?.execApproval,
          apply_patch_approval: pending?.applyPatchApproval,
        },
      },
    ]
  }

  if (event.type === "message.part.updated") {
    const part = props.part
    if (!isRecord(part) || part.type !== "tool" || !isRecord(part.state)) return []
    const tool = typeof part.tool === "string" ? part.tool : "unknown"
    const input = part.state.input
    const status = typeof part.state.status === "string" ? part.state.status : undefined
    const output = typeof part.state.output === "string" ? part.state.output : undefined
    const error = typeof part.state.error === "string" ? part.state.error : undefined
    const callID = typeof part.callID === "string" ? part.callID : undefined
    const messageID = typeof part.messageID === "string" ? part.messageID : undefined
    const out: PublicEventDraft[] = []

    if ((tool === "bash" || tool === "shell") && status === "completed") {
      if (output) {
        out.push({
          ...common,
          type: "command.output",
          severity: "info",
          messageID,
          toolCallID: callID,
          title: "Command output",
          summary: short(output),
          status: "output",
          data: {
            command: toolCommand(input),
            outputChars: output.length,
            snippet: short(output, 180),
          },
          raw,
        })
      }
      out.push({
        ...common,
        type: "command.finished",
        severity: "info",
        messageID,
        toolCallID: callID,
        title: "Command finished",
        summary: short(toolCommand(input) ?? ""),
        status: "completed",
        data: {
          command: toolCommand(input),
          outputChars: output?.length ?? 0,
        },
        raw,
      })
    }

    if ((tool === "bash" || tool === "shell") && status === "running") {
      out.push({
        ...common,
        type: "command.started",
        severity: "info",
        messageID,
        toolCallID: callID,
        title: "Command started",
        summary: short(toolCommand(input) ?? ""),
        status: "started",
        data: {
          command: toolCommand(input),
        },
        raw,
      })
    }

    if (["read", "glob", "grep"].includes(tool) && status === "completed") {
      out.push({
        ...common,
        type: "file.read",
        severity: "info",
        messageID,
        toolCallID: callID,
        title: "File read",
        summary: short(toolPath(input) ?? tool),
        status: "completed",
        data: {
          tool,
          path: toolPath(input),
          outputChars: output?.length ?? 0,
        },
        raw,
      })
    }

    if (["write", "edit", "apply_patch"].includes(tool) && (status === "completed" || status === "error")) {
      out.push({
        ...common,
        type: "file.write",
        severity: status === "error" ? "error" : "info",
        messageID,
        toolCallID: callID,
        title: status === "error" ? "File write failed" : "File write",
        summary: short(toolPath(input) ?? error ?? tool),
        status,
        data: {
          tool,
          path: toolPath(input),
          outputChars: output?.length ?? 0,
          error,
        },
        raw,
      })
    }

    return out
  }

  return []
}

function cursorFor(afterID?: string) {
  if (!afterID) return 0
  return eventsByID.get(afterID)?.sequence ?? 0
}

function selectBuffer(sessionID?: string) {
  return sessionID ? (sessionEvents.get(sessionID) ?? []) : allEvents
}

export namespace PublicEventLog {
  export function clearForTest() {
    sequence = 0
    warnedAuditUnavailable = false
    allEvents.length = 0
    sessionEvents.clear()
    eventsByID.clear()
    rawByID.clear()
    approvalRequests.clear()
  }

  export function recordTrace(input: TraceRecordInput) {
    const draft = makeTraceEvent(input)
    if (!draft) return
    return record(draft)
  }

  export function recordBus(input: BusRecordInput) {
    const drafts = makeBusEvents(input)
    return drafts.map(record)
  }

  export function recordManual(input: PublicEventDraft) {
    return record(input)
  }

  export function list(input: { sessionID?: string; afterID?: string; afterSequence?: number } = {}) {
    const after = input.afterSequence ?? cursorFor(input.afterID)
    return selectBuffer(input.sessionID).filter((event) => event.sequence > after)
  }

  export function latestSequence() {
    return sequence
  }

  export function get(eventID: string) {
    return eventsByID.get(eventID)
  }

  export function readRaw(input: { sessionID: string; eventID: string }) {
    const event = eventsByID.get(input.eventID)
    if (!event || event.sessionID !== input.sessionID || !event.rawRef) return
    const raw = rawByID.get(event.rawRef.id)
    if (!raw || raw.eventID !== input.eventID || raw.sessionID !== input.sessionID) return

    if (raw.kind === "memory") return raw.value

    const key = auditKey()
    if (!key) throw new Error("AIALRA_EVENT_AUDIT_KEY is required to decrypt raw event payloads")
    const payload = JSON.parse(fs.readFileSync(raw.file, "utf8")) as {
      iv: string
      tag: string
      ciphertext: string
    }
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(payload.iv, "base64"))
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"))
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8")
    return JSON.parse(plaintext) as unknown
  }

  export function protocol(): PublicEventProtocolEntry[] {
    return PUBLIC_EVENT_TYPES.map((type) => ({
      type,
      schema: "aialra.public_event.v1",
      title: publicEventTitle(type),
      description: publicEventDescription(type),
      fields: publicEventFields(type),
      permission: "session_owner",
      replay: "session_buffer_with_last_event_id",
      raw: rawEligible(type) ? "rawRef_only" : "none",
    }))
  }
}

function rawEligible(type: PublicEventType) {
  return (
    type.startsWith("turn.") ||
    type.startsWith("patch.") ||
    type.startsWith("session.") ||
    type.startsWith("prompt.") ||
    type.startsWith("model.") ||
    type.startsWith("reasoning.") ||
    type.startsWith("item.lifecycle.") ||
    type.startsWith("provider.tool.") ||
    type.startsWith("tool.") ||
    type.startsWith("tools.") ||
    type.startsWith("skill.") ||
    type.startsWith("file.") ||
    type.startsWith("directory.") ||
    type.startsWith("exec_command.") ||
    type.startsWith("exec_process.") ||
    type.startsWith("terminal.") ||
    type.startsWith("command.") ||
    type.startsWith("engineering.") ||
    type.startsWith("multi_agent.") ||
    type.startsWith("executor.") ||
    type.startsWith("approval.") ||
    type.startsWith("sandbox.") ||
    type.startsWith("security.constraint.") ||
    type.startsWith("http.") ||
    type.startsWith("thread.rollback.") ||
    type.startsWith("context.compaction.") ||
    type.startsWith("extension.") ||
    type === "final.output"
  )
}

function publicEventTitle(type: PublicEventType) {
  return (
    {
      "audit.encryption.unavailable": "审计加密不可用",
      "session.configured": "会话配置已记录",
      "session.handoff.requested": "会话交接已请求",
      "session.handoff.prepared": "会话交接快照已准备",
      "prompt.effective.resolved": "有效提示词已解析",
      "turn.input.received": "收到用户输入",
      "turn.context.created": "创建回合上下文",
      "turn.started": "回合开始",
      "turn.warning": "回合警告",
      "turn.step_budget.changed": "步骤上限已切换",
      "turn.completed": "回合完成",
      "turn.aborted": "回合中断",
      "turn.abort.requested": "请求中断回合",
      "turn.abort.resolved": "中断请求已处理",
      "turn.terminal.assistant_error": "终态错误消息",
      "turn.diff.updated": "本轮代码改动已更新",
      "patch.quality.scored": "补丁质量已评分",
      "engineering.controls.changed": "工程控制已变更",
      "engineering.mode.changed": "工程模式已切换",
      "engineering.budget.changed": "工程预算已变更",
      "engineering.benchmark.tier.selected": "评测层级已选择",
      "engineering.benchmark.started": "评测层级开始",
      "engineering.benchmark.finished": "评测层级结束",
      "multi_agent.task.assigned": "多 agent 子任务已分配",
      "multi_agent.task.settled": "多 agent 子任务已收口",
      "multi_agent.conflict.detected": "多 agent 冲突已检测",
      "engineering.run.started": "工程运行开始",
      "engineering.phase.changed": "工程阶段切换",
      "engineering.artifact.updated": "工程产物已更新",
      "engineering.verification.planned": "工程验证计划已生成",
      "engineering.verification.started": "工程验证开始",
      "engineering.verification.finished": "工程验证结束",
      "engineering.verification.repair_requested": "验证反馈已注入",
      "engineering.phase_gate.blocked_tool": "阶段门禁阻止工具",
      "engineering.phase_gate.premature_final": "阶段门禁继续执行",
      "engineering.zero_patch.detected": "检测到零补丁",
      "engineering.zero_patch.recovery_requested": "请求零补丁恢复",
      "engineering.zero_patch.recovered": "零补丁已恢复",
      "engineering.zero_patch.exhausted": "零补丁恢复耗尽",
      "engineering.stop_gate.checked": "停止门禁已检查",
      "engineering.stop_gate.activated": "通过即停止已开启",
      "engineering.stop_gate.blocked_tool": "停止门禁阻止工具",
      "engineering.loop.warning": "循环风险预警",
      "engineering.loop.checkpoint": "循环检查点",
      "engineering.loop.blocked": "循环已阻止",
      "engineering.reasoning.recorded": "推理内容已记录",
      "reasoning.summary.created": "推理摘要已生成",
      "reasoning.raw.item": "推理原始项已记录",
      "engineering.deployment_gate.updated": "部署门禁已更新",
      "engineering.run.finished": "工程运行结束",
      "model.raw.chunk": "模型原始分片已记录",
      "model.raw.item": "模型原始响应项已记录",
      "model.capability.evaluated": "模型能力已评估",
      "model.capability.degraded": "模型能力已降级",
      "model.effort.resolved": "模型推理档位已解析",
      "model.service_tier.resolved": "模型服务档位已解析",
      "model.request.started": "开始请求模型",
      "model.stream.started": "模型流开始",
      "model.retrying": "模型重试",
      "model.request.finished": "模型请求结束",
      "runtime.provider.selected": "运行时已选择",
      "runtime.item.received": "运行时项目已接收",
      "runtime.item.settled": "运行时项目已收口",
      "item.lifecycle.started": "项目生命周期开始",
      "item.lifecycle.completed": "项目生命周期完成",
      "item.lifecycle.failed": "项目生命周期失败",
      "item.lifecycle.aborted": "项目生命周期中断",
      "provider.tool.call": "供应商托管工具调用",
      "provider.tool.result": "供应商托管工具结果",
      "executor.started": "执行器开始",
      "executor.finished": "执行器结束",
      "executor.fallback": "执行器回退",
      "tool.foundation.resolved": "工具底座已解析",
      "tool.foundation.executing": "工具底座开始执行",
      "tool.foundation.settled": "工具底座执行收口",
      "tool.lifecycle.requested": "工具生命周期已请求",
      "tool.lifecycle.started": "工具生命周期已开始",
      "tool.lifecycle.completed": "工具生命周期已完成",
      "tool.lifecycle.failed": "工具生命周期失败",
      "tool.lifecycle.aborted": "工具生命周期中断",
      "tool.output.stored": "工具完整输出已保存",
      "tool.result.settled": "工具最终结果已落账",
      "tool.call.started": "工具开始执行",
      "tool.call.finished": "工具执行结束",
      "tools.dynamic.resolved": "动态工具已解析",
      "skill.catalog.resolved": "技能目录已解析",
      "skill.catalog.injected": "技能目录已注入",
      "skill.used": "技能已使用",
      "tool.sandbox.capability": "沙箱能力检查",
      "tool.sandbox.checked": "沙箱检查通过",
      "tool.sandbox.denied": "沙箱拒绝访问",
      "sandbox.effective": "沙箱实际策略已记录",
      "security.constraint.checked": "硬安全约束已检查",
      "security.constraint.denied": "硬安全约束已拒绝",
      "file.read": "读取文件",
      "file.search": "搜索文件",
      "directory.read": "读取目录",
      "file.write": "写入文件",
      "exec_command.started": "统一命令开始",
      "exec_command.output_delta": "统一命令输出增量",
      "exec_command.end": "统一命令标准终态",
      "exec_command.output": "统一命令输出",
      "exec_command.yielded": "统一命令已让出",
      "exec_command.finished": "统一命令结束",
      "exec_command.fallback": "统一命令执行器回退",
      "exec.approval.requested": "命令审批请求",
      "exec.approval.resolved": "命令审批完成",
      "apply_patch.approval.requested": "补丁审批请求",
      "apply_patch.approval.resolved": "补丁审批完成",
      "exec_process.registered": "后台进程已登记",
      "exec_process.await_started": "后台进程等待开始",
      "exec_process.await_progress": "后台进程等待进展",
      "exec_process.await_finished": "后台进程等待结束",
      "exec_process.await_timeout": "后台进程等待超时",
      "exec_process.capacity_checked": "后台进程容量检查通过",
      "exec_process.capacity_denied": "后台进程容量已满",
      "exec_process.finished": "后台进程已结束",
      "exec_process.finish_ignored": "后台进程重复终态已忽略",
      "exec_process.abort_requested": "后台进程请求中止",
      "exec_process.abort_denied": "后台进程中止被拒绝",
      "exec_process.cleanup": "后台进程记录已清理",
      "terminal.stdin.written": "终端输入已写入",
      "terminal.stdin.denied": "终端输入被拒绝",
      "terminal.interaction": "终端交互事件",
      "command.started": "命令开始",
      "command.output": "命令输出",
      "command.finished": "命令结束",
      "shell.env.policy.applied": "命令环境变量策略已应用",
      "network.proxy.applied": "网络代理已应用",
      "network.proxy.unavailable": "网络代理不可用",
      "http.request.classified": "HTTP 请求结果已分类",
      "approval.requested": "请求审批",
      "approval.resolved": "审批完成",
      "permission.grant.created": "权限授权已创建",
      "approval.reviewer.changed": "审批审查器已切换",
      "reviewer.resolved": "审批人解析完成",
      "guardian.assessment.completed": "Guardian 风险评估完成",
      "auto_review.completed": "自动审批审查完成",
      "request_permissions.requested": "权限提升请求",
      "request_permissions.resolved": "权限提升处理完成",
      "final.output": "最终输出",
      "sandbox.profile.changed": "权限档位已切换",
      "sandbox.network.changed": "网络访问已切换",
      "sandbox.command.changed": "命令执行已切换",
      "sandbox.policy.changed": "沙箱策略已切换",
      "sandbox.control.changed": "沙盒控制已变更",
      "approval.policy.changed": "审批策略已切换",
      "executor.backend.changed": "执行器已切换",
      "environment.selected": "执行环境已选择",
      "security.override.requested": "请求安全能力变更",
      "security.override.resolved": "安全能力变更已处理",
      "turn.terminal.anomaly": "终态异常",
      "turn.terminal.reconciled": "终态已校准",
      "thread.rollback.requested": "请求线程回滚",
      "thread.rollback.applied": "线程回滚已应用",
      "thread.rollback.noop": "线程回滚无变化",
      "thread.rollback.restored": "线程回滚已恢复",
      "thread.rollback.cleaned": "线程回滚已清理",
      "context.compaction.started": "上下文压缩开始",
      "context.compaction.completed": "上下文压缩完成",
      "context.compaction.failed": "上下文压缩失败",
      "context.compaction.pruned": "工具输出已压缩",
      "extension.data.attached": "扩展数据已挂载",
    } satisfies Record<PublicEventType, string>
  )[type]
}

function publicEventDescription(type: PublicEventType) {
  if (type.startsWith("session.handoff.")) return "描述 web、desktop 和本地 runtime 之间的会话交接快照、确认状态和降级原因"
  if (type.startsWith("prompt.")) return "描述本次模型请求实际使用的有效提示词版本、来源、hash、模型差异和可审计 rawRef"
  if (type.startsWith("turn.")) return "描述一个用户请求回合的生命周期、终态或回合级异常"
  if (type.startsWith("engineering.")) return "描述工程状态机的阶段、产物、验证反馈、停止门禁或循环干预"
  if (type.startsWith("multi_agent.")) return "描述多 agent 任务分配、角色、权限摘要、结果收口和冲突处理"
  if (type.startsWith("reasoning."))
    return "描述模型推理摘要、原始推理分片、展示策略、工具关联和可回放 rawRef"
  if (type.startsWith("model.")) return "描述模型请求、流式输出、重试或结束"
  if (type.startsWith("runtime.")) return "描述模型运行时选择、统一 runtime item 和跨 provider 收口状态"
  if (type.startsWith("item.lifecycle.")) return "描述统一 item 生命周期的开始、完成、失败或中断"
  if (type.startsWith("tool.") || type.startsWith("tools.")) return "描述工具调用、动态工具解析或沙箱门禁"
  if (type.startsWith("skill.")) return "描述本轮技能目录、技能 prompt 注入和实际使用情况"
  if (type.startsWith("file.") || type.startsWith("directory.")) return "描述受控文件或目录读写"
  if (type.startsWith("exec_command.") || type.startsWith("exec_process.") || type.startsWith("terminal."))
    return "描述统一命令执行、实时 bytes 输出、后台进程和终端交互"
  if (type.startsWith("command.")) return "描述命令启动、输出和结束"
  if (type.startsWith("approval.")) return "描述审批请求和审批结果"
  if (type.startsWith("sandbox.")) return "描述沙盒控制中心的策略变化"
  if (type.startsWith("http.")) return "描述 webfetch 或 HTTP 请求的网络、状态码和失败分类"
  if (type.startsWith("executor.")) return "描述执行后端、Codex exec-server 或回退"
  if (type.startsWith("security.constraint.")) return "描述硬安全约束检查、拒绝原因和审批前拦截"
  if (type.startsWith("security.")) return "描述安全能力临时变更请求和结果"
  if (type.startsWith("environment.")) return "描述当前执行环境选择"
  if (type.startsWith("extension.")) return "描述本轮按命名空间挂载的扩展数据，用于插件、UI、企业策略或 benchmark"
  if (type === "final.output") return "描述最终回复输出"
  return "描述公共事件流自身的审计状态"
}

function publicEventFields(type: PublicEventType): PublicEventProtocolEntry["fields"] {
  const base: PublicEventProtocolEntry["fields"] = [
    { name: "schema", description: "协议版本，当前固定为 aialra.public_event.v1", required: true },
    { name: "version", description: "公共事件协议主版本，当前固定为 1，用于后续兼容升级", required: true },
    { name: "id", description: "事件唯一编号，用于 raw 查询和断线续传", required: true },
    { name: "sequence", description: "服务端递增序号，用于按时间排序", required: true },
    { name: "ts", description: "事件产生时间，ISO 字符串", required: true },
    { name: "type", description: "事件类型，来自公共协议枚举", required: true },
    { name: "source", description: "事件来源，trace、bus 或 manual", required: true },
    { name: "threadID", description: "线程编号，优先使用 turnID，其次 sessionID，最后 global", required: true },
    { name: "severity", description: "严重程度，info、warning 或 error", required: true },
    { name: "sessionID", description: "所属会话编号", required: false },
    { name: "turnID", description: "所属回合编号，通常等于用户消息编号", required: false },
    { name: "messageID", description: "关联消息编号", required: false },
    { name: "toolCallID", description: "关联工具调用编号", required: false },
    { name: "title", description: "给用户看的中文标题", required: true },
    { name: "summary", description: "给用户看的简短摘要", required: false },
    { name: "status", description: "机器可消费的状态，比如 started、finished、blocked", required: false },
    { name: "payloadSchema", description: "类型化 payload 的 schema 名，默认由事件 type 生成", required: true },
    { name: "payload", description: "类型化安全载荷，第一版与 data 保持兼容", required: true },
    { name: "data", description: "安全摘要载荷，不包含完整 prompt、完整输出或密钥", required: true },
    { name: "extension_data.*", description: "按命名空间挂载的扩展数据，避免污染核心协议", required: false },
  ]
  const raw = rawEligible(type)
    ? [{ name: "rawRef.*" as const, description: "加密或内存 raw payload 引用，只能通过 raw endpoint 按权限读取", required: false }]
    : []
  const extension = [
    {
      name: "data.*" as const,
      description: publicEventDataDescription(type),
      required: false,
    },
  ]
  return [...base, ...extension, ...raw]
}

function publicEventDataDescription(type: PublicEventType) {
  if (type.startsWith("session.handoff."))
    return "会话编号、目标端、事件游标、rawRef 统计、环境、安全配置、进程登记表和 unsupported/degraded 原因"
  if (type.startsWith("prompt."))
    return "有效提示词版本、组成来源、manifest hash、system/message/tool/params hash、模型特定差异和 rawRef"
  if (type.startsWith("turn.")) return "回合生命周期、终态原因、耗时、cwd、模型和上下文摘要"
  if (type.startsWith("engineering.")) return "工程阶段、验证结果、修复反馈、停止门禁、零补丁和循环风险摘要"
  if (type.startsWith("multi_agent."))
    return "多 agent 角色、agent 名称、父子 session、权限摘要、任务状态、结果长度、冲突和 settlement"
  if (type.startsWith("model.")) return "模型供应商、模型、attempt、重试、首 token、结束或错误摘要"
  if (type.startsWith("runtime.")) return "运行时来源、原始 LLMEvent 类型、统一 item 类型、状态、工具调用编号和终态标记"
  if (type.startsWith("item.lifecycle."))
    return "统一 item id、item 类型、父 item、来源 phase、started_at、completed_at、duration_ms、status 和 error"
  if (type.startsWith("reasoning."))
    return "推理摘要文本、原始推理分片序号、provider 来源、展示策略、unsupported 原因和原始推理引用"
  if (type.startsWith("executor.")) return "执行后端、Codex exec-server method、fallback 原因和耗时"
  if (type.startsWith("tool.") || type.startsWith("tools."))
    return "工具名、输入摘要、本轮可用工具、禁用工具、禁用原因、沙箱策略和执行结果"
  if (type.startsWith("skill."))
    return "技能名称、来源、适用原因、关联工具、MCP 资源、命令、外部资源、是否注入 prompt 和是否实际使用"
  if (type.startsWith("file.")) return "文件路径摘要、操作类型、字节数和受控 FS 通道"
  if (type.startsWith("exec_command.") || type.startsWith("exec_process.") || type.startsWith("terminal."))
    return "命令编号、进程编号、stdout/stderr、分片序号、byte 偏移、preview、rawRef 和终端交互状态"
  if (type.startsWith("command.")) return "命令摘要、cwd、输出片段、退出码和沙箱能力"
  if (type.startsWith("approval.")) return "审批策略、权限档位、工具调用、用户选择和作用域"
  if (type.startsWith("sandbox.")) return "沙盒控制中心变更前后值、作用范围和操作者"
  if (type.startsWith("http.")) return "HTTP URL、状态码、网络策略、是否为沙箱拒绝、是否为目标站点非 2xx"
  if (type.startsWith("security.constraint.")) return "硬约束规则、目标、原因、来源和审批前拦截信息"
  if (type.startsWith("security.")) return "临时安全能力变更请求、审批结果和联动范围"
  if (type.startsWith("environment.")) return "当前 environment，环境，cwd 和 remote 支持状态"
  if (type.startsWith("extension.")) return "扩展数据命名空间、来源、作用范围和可回放摘要"
  return "事件自描述数据"
}

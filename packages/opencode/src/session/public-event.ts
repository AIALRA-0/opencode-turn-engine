import crypto from "crypto"
import fs from "fs"
import path from "path"

type JsonRecord = Record<string, unknown>

export type PublicEventType =
  | "audit.encryption.unavailable"
  | "turn.input.received"
  | "turn.context.created"
  | "turn.started"
  | "turn.warning"
  | "turn.step_budget.changed"
  | "turn.completed"
  | "turn.aborted"
  | "engineering.controls.changed"
  | "engineering.mode.changed"
  | "engineering.budget.changed"
  | "engineering.run.started"
  | "engineering.phase.changed"
  | "engineering.verification.finished"
  | "engineering.phase_gate.blocked_tool"
  | "engineering.phase_gate.premature_final"
  | "engineering.stop_gate.activated"
  | "engineering.stop_gate.blocked_tool"
  | "engineering.loop.warning"
  | "engineering.loop.checkpoint"
  | "engineering.loop.blocked"
  | "engineering.reasoning.recorded"
  | "engineering.run.finished"
  | "model.request.started"
  | "model.stream.started"
  | "model.retrying"
  | "model.request.finished"
  | "executor.started"
  | "executor.finished"
  | "executor.fallback"
  | "tool.call.started"
  | "tool.call.finished"
  | "tool.sandbox.capability"
  | "tool.sandbox.checked"
  | "tool.sandbox.denied"
  | "file.read"
  | "file.write"
  | "command.started"
  | "command.output"
  | "command.finished"
  | "approval.requested"
  | "approval.resolved"
  | "final.output"
  | "sandbox.profile.changed"
  | "sandbox.network.changed"
  | "sandbox.command.changed"
  | "sandbox.policy.changed"
  | "sandbox.control.changed"
  | "approval.policy.changed"
  | "executor.backend.changed"
  | "environment.selected"
  | "security.override.requested"
  | "security.override.resolved"

export type PublicEventSeverity = "info" | "warning" | "error"

export type PublicRawRef = {
  id: string
  eventID: string
  encrypted: boolean
  persisted: boolean
}

export type PublicEvent = {
  schema: "aialra.public_event.v1"
  id: string
  sequence: number
  ts: string
  type: PublicEventType
  severity: PublicEventSeverity
  sessionID?: string
  turnID?: string
  messageID?: string
  toolCallID?: string
  title: string
  summary?: string
  status?: string
  data: JsonRecord
  rawRef?: PublicRawRef
}

export type TraceRecordInput = {
  phase: string
  turnID?: string
  sessionID?: string
  messageID?: string
  step?: number
  data?: JsonRecord
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

type PublicEventDraft = Omit<PublicEvent, "schema" | "id" | "sequence" | "ts" | "rawRef"> & {
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
const approvalRequests = new Map<
  string,
  {
    sessionID?: string
    turnID?: string
    messageID?: string
    toolCallID?: string
  }
>()

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
  const event: PublicEvent = {
    schema: "aialra.public_event.v1",
    id,
    sequence,
    ts: new Date().toISOString(),
    type: draft.type,
    severity: draft.severity,
    sessionID: draft.sessionID,
    turnID: draft.turnID,
    messageID: draft.messageID,
    toolCallID: draft.toolCallID,
    title: draft.title,
    summary: draft.summary,
    status: draft.status,
    data: safeObject(draft.data),
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
    },
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
        summary: short(String(data.reason ?? "aborted")),
        status: "aborted",
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
    case "tool.sandbox.checked":
    case "tool.sandbox.denied":
      return {
        ...base,
        type: input.phase,
        severity: input.phase === "tool.sandbox.denied" ? "error" : "info",
        toolCallID: typeof data.callID === "string" ? data.callID : undefined,
        title: input.phase === "tool.sandbox.denied" ? "Sandbox denied tool access" : "Sandbox checked tool access",
        summary: short(String(data.reason ?? data.path ?? data.tool ?? "")),
        status: input.phase === "tool.sandbox.denied" ? "denied" : "checked",
        data,
      }
    case "tool.sandbox.capability":
      return {
        ...base,
        type: "tool.sandbox.capability",
        severity: data?.bwrap && typeof data.bwrap === "object" && (data.bwrap as JsonRecord).available === false ? "warning" : "info",
        title: "Sandbox capability checked",
        summary: short(String(data.backend ?? data.tool ?? "")),
        status: "checked",
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
  const common = { sessionID, raw }

  if (event.type === "permission.asked") {
    const approvalID = typeof props.id === "string" ? props.id : undefined
    const turnID = typeof props.turnID === "string" ? props.turnID : undefined
    const messageID = isRecord(props.tool) && typeof props.tool.messageID === "string" ? props.tool.messageID : undefined
    const toolCallID = isRecord(props.tool) && typeof props.tool.callID === "string" ? props.tool.callID : undefined
    if (approvalID) {
      approvalRequests.set(approvalID, {
        sessionID,
        turnID,
        messageID,
        toolCallID,
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
          approvalPolicy: props.approvalPolicy,
          permissionProfile: props.permissionProfile,
          sandboxPolicy: props.sandboxPolicy,
          tool: props.tool,
        },
      },
    ]
  }

  if (event.type === "permission.replied") {
    const requestID = typeof props.requestID === "string" ? props.requestID : undefined
    const pending = requestID ? approvalRequests.get(requestID) : undefined
    return [
      {
        ...common,
        type: "approval.resolved",
        severity: props.reply === "reject" ? "error" : "info",
        turnID: pending?.turnID,
        messageID: pending?.messageID,
        toolCallID: pending?.toolCallID,
        title: "Approval resolved",
        summary: short(String(props.reply ?? "")),
        status: typeof props.reply === "string" ? props.reply : "resolved",
        data: {
          requestID,
          reply: props.reply,
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
}

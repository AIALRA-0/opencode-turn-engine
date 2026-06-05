import fs from "fs"
import os from "os"
import path from "path"
import { Effect } from "effect"
import { PublicEventLog } from "./public-event"
import { TurnHistory } from "./turn-history"

type TraceData = Record<string, unknown>
type TraceExtensionData = Record<string, Record<string, unknown>>

type TraceInput = {
  phase: string
  turnID?: string
  sessionID?: string
  messageID?: string
  step?: number
  data?: TraceData
  extension_data?: TraceExtensionData
}

const enabledValues = new Set(["1", "true", "yes", "on"])
const defaultDir = () => path.join(os.tmpdir(), "opencode-turn-traces")

const enabled = () => enabledValues.has((process.env.AIALRA_TURN_TRACE ?? "").toLowerCase())
const traceDir = () => process.env.AIALRA_TURN_TRACE_DIR || defaultDir()

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128) || "unknown"
}

function sanitize(input: unknown, depth = 0): unknown {
  if (input === undefined) return undefined
  if (input === null) return null
  if (typeof input === "string") return input.length > 240 ? input.slice(0, 237) + "..." : input
  if (typeof input === "number" || typeof input === "boolean") return input
  if (typeof input === "bigint") return input.toString()
  if (typeof input === "symbol" || typeof input === "function") return undefined
  if (depth >= 4) return "[truncated]"
  if (Array.isArray(input)) return input.slice(0, 80).map((item) => sanitize(item, depth + 1))
  if (typeof input !== "object") return String(input)

  const output: TraceData = {}
  for (const [key, value] of Object.entries(input as TraceData).slice(0, 80)) {
    const clean = sanitize(value, depth + 1)
    if (clean !== undefined) output[key] = clean
  }
  return output
}

function fileFor(input: TraceInput) {
  return path.join(traceDir(), `${safeSegment(input.sessionID ?? "global")}.jsonl`)
}

function text(input: unknown) {
  return typeof input === "string" && input ? input : undefined
}

function lifecycleStatus(input: TraceInput) {
  const status = text(input.data?.status)
  const tracked =
    input.phase === "runtime.item.received" ||
    input.phase === "runtime.item.settled" ||
    input.phase === "model.raw.item" ||
    input.phase === "reasoning.raw.item" ||
    input.phase.startsWith("tool.lifecycle.") ||
    input.phase === "tool.result.settled"
  if (!tracked) return undefined
  if (input.phase.endsWith(".failed")) return "failed"
  if (input.phase.endsWith(".aborted")) return "aborted"
  if (input.phase.endsWith(".completed") || input.phase.endsWith(".settled") || input.phase.endsWith(".resolved"))
    return status === "error" ? "failed" : "completed"
  if (input.phase === "runtime.item.settled") return status === "error" ? "failed" : "completed"
  if (input.phase === "model.raw.item" || input.phase === "reasoning.raw.item") return "completed"
  if (input.phase.endsWith(".started") || input.phase.endsWith(".requested") || input.phase === "runtime.item.received")
    return "started"
  return undefined
}

function lifecycleType(status: string) {
  if (status === "failed") return "item.lifecycle.failed" as const
  if (status === "aborted") return "item.lifecycle.aborted" as const
  if (status === "completed") return "item.lifecycle.completed" as const
  return "item.lifecycle.started" as const
}

function lifecycleItem(input: TraceInput) {
  const data = input.data ?? {}
  const status = lifecycleStatus(input)
  if (!status) return
  const itemID =
    text(data.itemID) ??
    text(data.reasoning_raw_id) ??
    text(data.raw_item_id) ??
    text(data.callID) ??
    text(data.toolCallID) ??
    text(data.partID) ??
    text(data.contentID) ??
    text(data.reasoningID) ??
    text(input.messageID) ??
    text(input.turnID)
  if (!itemID) return
  const itemKind =
    (input.phase === "reasoning.raw.item" ? "reasoning_raw_item" : undefined) ??
    text(data.kind) ??
    (input.phase.startsWith("tool.") || input.phase.startsWith("exec.") || input.phase.startsWith("apply_patch.")
      ? "tool_item"
      : input.phase.startsWith("approval.") || input.phase.includes(".approval.")
        ? "approval_item"
        : input.phase.startsWith("model.raw.")
          ? "raw_response_item"
          : input.phase.startsWith("runtime.")
            ? "runtime_item"
            : "message_item")
  const now = new Date().toISOString()
  return {
    type: lifecycleType(status),
    severity: status === "failed" || status === "aborted" ? "error" as const : "info" as const,
    sessionID: input.sessionID,
    turnID: input.turnID,
    messageID: input.messageID,
    toolCallID: text(data.toolCallID) ?? text(data.callID),
    title: `Item lifecycle ${status}`,
    summary: `${itemKind} ${itemID}`,
    status,
    data: {
      schema: "aialra.item_lifecycle.v1",
      item_id: itemID,
      parent_item_id: text(data.parent_item_id) ?? input.messageID ?? input.turnID,
      item_kind: itemKind,
      source_phase: input.phase,
      source: "trace",
      turn_id: input.turnID,
      session_id: input.sessionID,
      message_id: input.messageID,
      status,
      started_at: status === "started" ? now : undefined,
      completed_at: status !== "started" ? now : undefined,
      duration_ms: typeof data.durationMs === "number" ? data.durationMs : typeof data.duration_ms === "number" ? data.duration_ms : undefined,
      error: text(data.error) ?? text(data.reason),
      terminal: status !== "started",
      raw_item_id: text(data.raw_item_id),
      model_call_id: text(data.model_call_id),
      sequence: typeof data.sequence === "number" ? data.sequence : undefined,
    },
    raw: {
      source: "trace",
      phase: input.phase,
      item_lifecycle: true,
      original: input,
    },
  }
}

export namespace AialraTurnTrace {
  export function isEnabled() {
    return enabled()
  }

  export function emit(input: TraceInput): Effect.Effect<void> {
    PublicEventLog.recordTrace(input)
    const lifecycle = lifecycleItem(input)
    if (lifecycle) {
      PublicEventLog.recordManual({ ...lifecycle, source: "trace" })
      TurnHistory.recordContextItem({
        phase: lifecycle.type,
        sessionID: input.sessionID,
        turnID: input.turnID,
        messageID: input.messageID,
        step: input.step,
        data: lifecycle.data,
        extension_data: input.extension_data,
      })
    }
    if (TurnHistory.isLifecycleType(input.phase)) {
      TurnHistory.record({
        type: input.phase,
        sessionID: input.sessionID,
        turnID: input.turnID,
        messageID: input.messageID,
        data: input.data,
        extension_data: input.extension_data,
      })
    } else {
      TurnHistory.recordContextItem({
        phase: input.phase,
        sessionID: input.sessionID,
        turnID: input.turnID,
        messageID: input.messageID,
        step: input.step,
        data: input.data,
        extension_data: input.extension_data,
      })
    }
    if (!enabled()) return Effect.void
    return Effect.try({
      try: () => {
        const dir = traceDir()
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
        fs.appendFileSync(
          fileFor(input),
          JSON.stringify({
            trace: "aialra.turn.v1",
            ts: new Date().toISOString(),
            phase: input.phase,
            turnID: input.turnID,
            sessionID: input.sessionID,
            messageID: input.messageID,
            step: input.step,
            data: sanitize(input.data ?? {}),
            extension_data: sanitize(input.extension_data ?? {}),
          }) + "\n",
          { encoding: "utf8", mode: 0o600 },
        )
      },
      catch: () => undefined,
    }).pipe(Effect.ignore)
  }

  export function partSummary(parts: ReadonlyArray<{ readonly type: string; readonly synthetic?: boolean }>) {
    const byType: Record<string, number> = {}
    let synthetic = 0
    for (const part of parts) {
      byType[part.type] = (byType[part.type] ?? 0) + 1
      if (part.synthetic) synthetic++
    }
    return { count: parts.length, synthetic, byType }
  }

  export function keys(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return []
    return Object.keys(value).sort()
  }
}

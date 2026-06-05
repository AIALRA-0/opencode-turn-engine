import fs from "fs"
import path from "path"
import { Global } from "@opencode-ai/core/global"

type JsonRecord = Record<string, unknown>
type ExtensionData = Record<string, JsonRecord>

export type TurnHistoryType =
  | "turn.started"
  | "turn.completed"
  | "turn.aborted"
  | "turn.terminal.assistant_error"
  | "turn.terminal.anomaly"
  | "turn.terminal.reconciled"
  | "turn.context.item"

export type TurnContextItemKind =
  | "input"
  | "message"
  | "turn_context"
  | "environment"
  | "permission"
  | "sandbox"
  | "network"
  | "model"
  | "tool"
  | "file"
  | "command"
  | "http"
  | "approval"
  | "engineering"
  | "warning"
  | "raw"
  | "runtime"

export type TurnHistoryRecord = {
  schema: "aialra.turn_history.v1"
  id: string
  type: TurnHistoryType
  ts: string
  sessionID: string
  turnID: string
  messageID?: string
  source: "trace"
  data: JsonRecord
  extension_data?: ExtensionData
}

const TYPES = new Set<TurnHistoryType>([
  "turn.started",
  "turn.completed",
  "turn.aborted",
  "turn.terminal.assistant_error",
  "turn.terminal.anomaly",
  "turn.terminal.reconciled",
  "turn.context.item",
])

const root = () => process.env.AIALRA_TURN_HISTORY_DIR || path.join(Global.Path.data, "aialra-turn-history")

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128) || "unknown"
}

function fileFor(sessionID: string) {
  return path.join(root(), `${safeSegment(sessionID)}.jsonl`)
}

function compact(input: unknown, depth = 0): unknown {
  if (input === undefined) return undefined
  if (input === null) return null
  if (typeof input === "string") return input.length > 2_000 ? `${input.slice(0, 1_997)}...` : input
  if (typeof input === "number" || typeof input === "boolean") return input
  if (typeof input === "bigint") return input.toString()
  if (typeof input === "symbol" || typeof input === "function") return undefined
  if (depth >= 5) return "[truncated]"
  if (Array.isArray(input)) return input.slice(0, 200).map((item) => compact(item, depth + 1))
  if (typeof input !== "object") return String(input)

  const output: JsonRecord = {}
  for (const [key, value] of Object.entries(input as JsonRecord).slice(0, 200)) {
    const clean = compact(value, depth + 1)
    if (clean !== undefined) output[key] = clean
  }
  return output
}

export namespace TurnHistory {
  export function isLifecycleType(type: string): type is TurnHistoryType {
    return TYPES.has(type as TurnHistoryType) && type !== "turn.context.item"
  }

  export function contextItemKind(phase: string): TurnContextItemKind | undefined {
    if (phase === "prompt.received" || phase === "prompt.explicit_context_resolved") return "input"
    if (phase === "user_message.created" || phase === "assistant_message.created" || phase === "final.output")
      return "message"
    if (phase === "turn.context.created" || phase === "turn.frame.created") return "turn_context"
    if (phase.startsWith("extension.")) return "turn_context"
    if (phase.startsWith("context.compaction.")) return "runtime"
    if (phase.startsWith("thread.rollback.")) return "runtime"
    if (phase.startsWith("runtime.")) return "runtime"
    if (phase.startsWith("item.lifecycle.")) return "runtime"
    if (phase === "environment.selected") return "environment"
    if (
      phase.startsWith("approval.") ||
      phase.startsWith("exec.approval.") ||
      phase.startsWith("apply_patch.approval.") ||
      phase.startsWith("request_permissions.") ||
      phase.startsWith("guardian.assessment.") ||
      phase.startsWith("auto_review.") ||
      phase.startsWith("reviewer.") ||
      phase === "permission.asked" ||
      phase === "permission.replied"
    )
      return "approval"
    if (phase.startsWith("sandbox.") || phase.startsWith("tool.sandbox.") || phase.startsWith("security.constraint."))
      return "sandbox"
    if (phase.startsWith("shell.env.")) return "sandbox"
    if (phase.startsWith("turn.diff.")) return "file"
    if (phase.includes("network")) return "network"
    if (phase.startsWith("reasoning.")) return "model"
    if (phase.startsWith("model.")) return "model"
    if (phase.startsWith("provider.tool.")) return "tool"
    if (phase.startsWith("skill.")) return "tool"
    if (
      phase.startsWith("tool.call.") ||
      phase.startsWith("tool.foundation.") ||
      phase.startsWith("tool.lifecycle.") ||
      phase.startsWith("tool.output.") ||
      phase.startsWith("tool.result.") ||
      phase.startsWith("tools.") ||
      phase.startsWith("processor.")
    )
      return "tool"
    if (phase.startsWith("file.") || phase.startsWith("directory.")) return "file"
    if (
      phase.startsWith("command.") ||
      phase.startsWith("exec_command.") ||
      phase.startsWith("exec_process.") ||
      phase.startsWith("terminal.stdin.") ||
      phase === "terminal.interaction"
    )
      return "command"
    if (phase.startsWith("http.")) return "http"
    if (phase.startsWith("engineering.")) return "engineering"
    if (phase.includes("warning") || phase.includes("denied") || phase.includes("fallback")) return "warning"
    if (phase.includes("raw")) return "raw"
    if (phase.startsWith("turn.") || phase.startsWith("prompt.") || phase.startsWith("loop.")) return "runtime"
    return undefined
  }

  export function record(input: {
    type: TurnHistoryType
    sessionID?: string
    turnID?: string
    messageID?: string
    data?: JsonRecord
    extension_data?: ExtensionData
  }) {
    if (!input.sessionID || !input.turnID) return
    const record: TurnHistoryRecord = {
      schema: "aialra.turn_history.v1",
      id: `turnhist_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      type: input.type,
      ts: new Date().toISOString(),
      sessionID: input.sessionID,
      turnID: input.turnID,
      messageID: input.messageID,
      source: "trace",
      data: (compact(input.data ?? {}) ?? {}) as JsonRecord,
      extension_data: input.extension_data ? ((compact(input.extension_data) ?? {}) as ExtensionData) : undefined,
    }
    try {
      fs.mkdirSync(root(), { recursive: true, mode: 0o700 })
      fs.appendFileSync(fileFor(input.sessionID), `${JSON.stringify(record)}\n`, {
        encoding: "utf8",
        mode: 0o600,
      })
    } catch {
      // History persistence is an audit aid. A disk failure must not break the user turn.
    }
  }

  export function recordContextItem(input: {
    phase: string
    sessionID?: string
    turnID?: string
    messageID?: string
    step?: number
    data?: JsonRecord
    extension_data?: ExtensionData
  }) {
    const kind = contextItemKind(input.phase)
    if (!kind) return
    record({
      type: "turn.context.item",
      sessionID: input.sessionID,
      turnID: input.turnID,
      messageID: input.messageID,
      extension_data: input.extension_data,
      data: {
        kind,
        phase: input.phase,
        step: input.step,
        context: input.data ?? {},
      },
    })
  }

  export function list(input: { sessionID: string; turnID?: string; limit?: number }) {
    const file = fileFor(input.sessionID)
    if (!fs.existsSync(file)) return []
    const records = fs
      .readFileSync(file, "utf8")
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as TurnHistoryRecord]
        } catch {
          return []
        }
      })
      .filter((record) => !input.turnID || record.turnID === input.turnID)
    return records.slice(-(input.limit ?? 2_000))
  }

  export function clearForTest() {
    if (!fs.existsSync(root())) return
    fs.rmSync(root(), { recursive: true, force: true })
  }
}

import fs from "fs"
import os from "os"
import path from "path"
import { Effect } from "effect"

type TraceData = Record<string, unknown>

type TraceInput = {
  phase: string
  turnID?: string
  sessionID?: string
  messageID?: string
  step?: number
  data?: TraceData
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

export namespace AialraTurnTrace {
  export function isEnabled() {
    return enabled()
  }

  export function emit(input: TraceInput): Effect.Effect<void> {
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

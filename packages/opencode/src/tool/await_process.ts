import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { ExecProcessRegistry, type ExecProcessStatus } from "@/session/exec-process-registry"

export const Parameters = Schema.Struct({
  process_id: Schema.String.annotate({
    description: "The running process_id returned by the bash tool when yield_time_ms elapsed",
  }),
  timeout_ms: Schema.optional(Schema.Number).annotate({
    description: "Maximum time to wait for the process to reach a terminal state, capped by this turn's engineering controls.",
  }),
  poll_interval_ms: Schema.optional(Schema.Number).annotate({
    description: "How often to check process status. Defaults to 250ms and is clamped to a safe range.",
  }),
  description: Schema.String.annotate({
    description: "Clear, concise description of why this process is being awaited",
  }),
})

type Metadata = {
  process_id: string
  await_status: ExecProcessStatus | "await_timeout" | "denied"
  process_status?: ExecProcessStatus
  exit: number | null
  failure?: string | null
  output_chars?: number
  duration_ms: number
  requested_timeout_ms?: number
  effective_timeout_ms: number
}

function clamp(value: number | undefined, fallback: number, min: number, max: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(Math.floor(value), max))
}

function title(status: Metadata["await_status"]) {
  if (status === "await_timeout") return "Process still running"
  if (status === "denied") return "Await denied"
  return `Process ${status}`
}

function output(input: {
  processID: string
  status: Metadata["await_status"]
  processStatus?: ExecProcessStatus
  exit: number | null
  failure?: string | null
  outputChars?: number
  durationMs: number
}) {
  if (input.status === "await_timeout") {
    return [
      `Process ${input.processID} is still running after the await timeout.`,
      `Current status: ${input.processStatus ?? "running"}.`,
      `Observed output: ${input.outputChars ?? 0} chars.`,
    ].join("\n")
  }
  if (input.status === "denied") return `Process ${input.processID} could not be awaited: ${input.failure ?? "denied"}.`
  return [
    `Process ${input.processID} reached terminal state: ${input.status}.`,
    `Exit code: ${input.exit === null ? "null" : input.exit}.`,
    input.failure ? `Failure: ${input.failure}.` : undefined,
    `Observed output: ${input.outputChars ?? 0} chars.`,
  ].filter((line): line is string => Boolean(line)).join("\n")
}

export const AwaitProcessTool = Tool.define<typeof Parameters, Metadata, never>(
  "await_process",
  Effect.succeed({
    description: [
      "Wait for a still-running bash process returned with a process_id.",
      "Use this instead of repeatedly polling with bash, sleep, ps, tail, or grep.",
      "The waiter reads the unified process manager and records waiting progress, terminal status, timeout, or denial in the turn event stream.",
      "Await timeout does not kill the process; the process background timeout controls actual termination.",
    ].join("\n"),
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        const maxTimeoutMs = ctx.turn?.engineering?.controls.awaiterMaxTimeoutMs ?? 3_600_000
        const effectiveTimeoutMs = Math.min(
          clamp(params.timeout_ms, maxTimeoutMs, 1_000, 24 * 60 * 60 * 1000),
          maxTimeoutMs,
        )
        const result = yield* ExecProcessRegistry.waitForTerminal(params.process_id, {
          sessionID: ctx.sessionID,
          turnID: ctx.turn?.turnID,
          messageID: ctx.messageID,
          toolCallID: ctx.callID,
          requestedTimeoutMs: params.timeout_ms,
          effectiveTimeoutMs,
          pollIntervalMs: params.poll_interval_ms,
        })
        const record = "record" in result ? result.record : undefined
        const status = result.status
        const metadata: Metadata = {
          process_id: params.process_id,
          await_status: status,
          process_status: record?.status,
          exit: record?.exit_code ?? null,
          failure: result.status === "denied" ? result.reason : record?.failure,
          output_chars: record?.output_chars,
          duration_ms: result.durationMs,
          requested_timeout_ms: params.timeout_ms,
          effective_timeout_ms: effectiveTimeoutMs,
        }
        return {
          title: title(status),
          output: output({
            processID: params.process_id,
            status,
            processStatus: record?.status,
            exit: metadata.exit,
            failure: metadata.failure,
            outputChars: metadata.output_chars,
            durationMs: result.durationMs,
          }),
          metadata,
        }
      }),
  }),
)

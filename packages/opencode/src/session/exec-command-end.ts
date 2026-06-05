import { Effect } from "effect"
import { AialraTurnTrace } from "./turn-trace"
import type { ExecCommandBackend } from "./exec-command"

type JsonRecord = Record<string, unknown>

export type ExecCommandEndStatus = "completed" | "failed" | "timeout" | "aborted" | "cleaned_up"

type ExecCommandEndInput = {
  sessionID?: string
  turnID?: string
  messageID?: string
  toolCallID?: string
  processID?: string
  commandID: string
  backend?: ExecCommandBackend
  cwd?: string
  command?: string
  startedAt?: number
  endedAt?: number
  durationMs?: number
  exitCode: number | null
  signal?: string | null
  status?: ExecCommandEndStatus
  timedOut?: boolean
  aborted?: boolean
  cleanedUp?: boolean
  outputChars?: number
  outputPreview?: string
  truncated?: boolean
  rawOutputRef?: JsonRecord
  error?: string | null
  timeoutReason?: string | null
  abortReason?: string | null
}

const emitted = new Map<string, JsonRecord>()

function status(input: ExecCommandEndInput): ExecCommandEndStatus {
  if (input.status) return input.status
  if (input.cleanedUp) return "cleaned_up"
  if (input.aborted) return "aborted"
  if (input.timedOut) return "timeout"
  if (input.exitCode === 0) return "completed"
  return "failed"
}

function key(input: ExecCommandEndInput) {
  return [
    input.sessionID ?? "unknown_session",
    input.turnID ?? input.messageID ?? "unknown_turn",
    input.commandID,
    input.processID ?? "unknown_process",
  ].join(":")
}

function endedAt(input: ExecCommandEndInput) {
  return input.endedAt ?? Date.now()
}

function startedAt(input: ExecCommandEndInput, end: number) {
  if (input.startedAt !== undefined) return input.startedAt
  if (input.durationMs !== undefined) return Math.max(0, end - input.durationMs)
  return undefined
}

function durationMs(input: ExecCommandEndInput, start: number | undefined, end: number) {
  if (input.durationMs !== undefined) return input.durationMs
  if (start !== undefined) return Math.max(0, end - start)
  return undefined
}

export namespace ExecCommandEnd {
  export function emit(input: ExecCommandEndInput) {
    const id = key(input)
    if (emitted.has(id)) return Effect.void
    const end = endedAt(input)
    const start = startedAt(input, end)
    const duration = durationMs(input, start, end)
    const finalStatus = status(input)
    const payload = {
      schema: "aialra.exec_command_end.v1",
      command_id: input.commandID,
      process_id: input.processID,
      tool_call_id: input.toolCallID,
      backend: input.backend,
      cwd: input.cwd,
      command: input.command,
      status: finalStatus,
      exit_code: input.exitCode,
      signal: input.signal ?? null,
      started_at: start,
      ended_at: end,
      duration_ms: duration,
      output_summary: {
        chars: input.outputChars ?? 0,
        preview: input.outputPreview,
        truncated: input.truncated === true,
      },
      raw_output_ref: input.rawOutputRef,
      error: input.error ?? (finalStatus === "failed" ? `Command exited with ${input.exitCode ?? "unknown"}` : null),
      timeout_reason: input.timeoutReason ?? (finalStatus === "timeout" ? "command_timeout" : null),
      abort_reason: input.abortReason ?? (finalStatus === "aborted" ? "abort_signal" : null),
      terminal_state: {
        completed: finalStatus === "completed",
        failed: finalStatus === "failed",
        timeout: finalStatus === "timeout",
        aborted: finalStatus === "aborted",
        cleaned_up: finalStatus === "cleaned_up",
      },
      codex_item: {
        method: "item/commandExecution/end",
        threadId: input.sessionID,
        turnId: input.turnID ?? input.messageID,
        itemId: input.toolCallID ?? input.commandID,
        processId: input.processID,
        status: finalStatus,
        exitCode: input.exitCode,
        signal: input.signal ?? null,
      },
    }
    emitted.set(id, payload)
    return AialraTurnTrace.emit({
      phase: "exec_command.end",
      turnID: input.turnID,
      sessionID: input.sessionID,
      messageID: input.messageID,
      data: payload,
    })
  }

  export function clearForTest() {
    emitted.clear()
  }
}

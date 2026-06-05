import { Effect } from "effect"
import { AialraTurnTrace } from "./turn-trace"
import type { ExecCommandBackend } from "./exec-command"
import { TerminalInteraction } from "./terminal-interaction"
import { ExecCommandEnd } from "./exec-command-end"

type JsonRecord = Record<string, unknown>

export type ExecProcessStatus = "running" | "completed" | "failed" | "timeout" | "aborted"
export type ExecProcessAwaitStatus = ExecProcessStatus | "await_timeout" | "denied"
export type ExecProcessStdinControl = "text" | "newline" | "ctrl-c" | "eof"
export type ExecProcessRuntime = {
  pid?: number
  ptyID?: string
  writeStdin?: (text: string) => Promise<void> | void
  closeStdin?: () => Promise<void> | void
  interrupt?: () => Promise<void> | void
  abort?: () => Promise<void> | void
  cleanup?: () => Promise<void> | void
}

export type ExecProcessRecord = {
  schema: "aialra.exec_process.v1"
  process_id: string
  command_id: string
  backend: ExecCommandBackend
  session_id: string
  turn_id?: string
  message_id: string
  tool_call_id?: string
  environment_id?: string
  pid?: number
  pty_id?: string
  cwd: string
  command: string
  started_at: number
  last_output_at?: number
  last_interaction_at: number
  status: ExecProcessStatus
  timeout_ms?: number
  background_timeout_ms?: number
  yield_time_ms?: number
  background: boolean
  stdin_supported: boolean
  output_chars: number
  output_refs: JsonRecord[]
  stdin_writes: number
  stdin_chars: number
  exit_code?: number | null
  failure?: string | null
  cleanup_at?: number
}

type RegisterInput = Omit<
  ExecProcessRecord,
  | "schema"
  | "started_at"
  | "last_output_at"
  | "last_interaction_at"
  | "status"
  | "background"
  | "stdin_supported"
  | "output_refs"
  | "stdin_writes"
  | "stdin_chars"
  | "pid"
  | "pty_id"
  | "cleanup_at"
> & {
  runtime?: ExecProcessRuntime
  background?: boolean
  outputRefs?: JsonRecord[]
}

type WriteStdinInput = {
  sessionID: string
  turnID?: string
  messageID: string
  toolCallID?: string
  actor?: "model" | "user" | "system"
  text?: string
  control?: ExecProcessStdinControl
  appendNewline?: boolean
}

type WaitForTerminalInput = {
  sessionID: string
  turnID?: string
  messageID: string
  toolCallID?: string
  requestedTimeoutMs?: number
  effectiveTimeoutMs: number
  pollIntervalMs?: number
}

type LiveCapacityInput = {
  sessionID: string
  turnID?: string
  messageID: string
  toolCallID?: string
  processID: string
  commandID: string
  environmentID?: string
  limits: {
    perSession: number
    perTurn: number
    perEnvironment: number
  }
}

type CleanupInput = {
  sessionID?: string
  turnID?: string
  environmentID?: string
  processID?: string
  processIDs?: string[]
  statuses?: ExecProcessStatus[]
  includeFinished?: boolean
  includeRunning?: boolean
  reason?: string
}

const processes = new Map<string, ExecProcessRecord>()
const runtimes = new Map<string, ExecProcessRuntime>()

function stdinPayload(input: WriteStdinInput) {
  const control = input.control ?? "text"
  if (control === "ctrl-c") return { control, text: "\u0003", close_stdin: false }
  if (control === "eof") return { control, text: input.text ?? "", close_stdin: true }
  if (control === "newline") return { control, text: `${input.text ?? ""}\n`, close_stdin: false }
  return { control, text: input.appendNewline ? `${input.text ?? ""}\n` : (input.text ?? ""), close_stdin: false }
}

function stdinPreview(text: string) {
  const visible = text.replace(/\u0003/g, "^C").replace(/\n/g, "\\n")
  if (visible.length <= 160) return visible
  return `${visible.slice(0, 157)}...`
}

function writeEvent(
  record: ExecProcessRecord | undefined,
  input: WriteStdinInput,
  payload: ReturnType<typeof stdinPayload>,
  status: "written" | "denied",
  reason?: string,
) {
  const preview = stdinPreview(payload.text)
  return Effect.all([
    TerminalInteraction.emit({
      sessionID: record?.session_id ?? input.sessionID,
      turnID: record?.turn_id ?? input.turnID,
      messageID: input.messageID,
      toolCallID: input.toolCallID,
      phase: status === "written" ? "stdin_write" : "error",
      processID: record?.process_id,
      commandID: record?.command_id,
      backend: record?.backend,
      environmentID: record?.environment_id,
      cwd: record?.cwd,
      command: record?.command,
      stdin: preview,
      chars: payload.text.length,
      preview,
      status,
      reason,
    }),
    AialraTurnTrace.emit({
      phase: status === "written" ? "terminal.stdin.written" : "terminal.stdin.denied",
      turnID: record?.turn_id ?? input.turnID,
      sessionID: record?.session_id ?? input.sessionID,
      messageID: input.messageID,
      data: {
        schema: "aialra.terminal.stdin.v1",
        process_id: record?.process_id,
        command_id: record?.command_id,
        backend: record?.backend,
        session_id: record?.session_id ?? input.sessionID,
        turn_id: record?.turn_id ?? input.turnID,
        message_id: input.messageID,
        tool_call_id: input.toolCallID,
        actor: input.actor ?? "model",
        status,
        reason,
        control: payload.control,
        close_stdin: payload.close_stdin,
        chars: payload.text.length,
        preview,
        target_status: record?.status,
        stdin_supported: record?.stdin_supported ?? false,
      },
    }),
  ], { concurrency: 1 })
}

export namespace ExecProcessRegistry {
  export function register(input: RegisterInput) {
    const now = Date.now()
    const { runtime, ...rest } = input
    const record: ExecProcessRecord = {
      schema: "aialra.exec_process.v1",
      ...rest,
      pid: runtime?.pid,
      pty_id: runtime?.ptyID,
      started_at: now,
      last_interaction_at: now,
      status: "running",
      background: input.background ?? true,
      stdin_supported: Boolean(runtime?.writeStdin || runtime?.closeStdin || runtime?.interrupt),
      output_refs: input.outputRefs ?? [],
      stdin_writes: 0,
      stdin_chars: 0,
    }
    processes.set(record.process_id, record)
    if (runtime) runtimes.set(record.process_id, runtime)
    return AialraTurnTrace.emit({
      phase: "exec_process.registered",
      turnID: record.turn_id,
      sessionID: record.session_id,
      messageID: record.message_id,
      data: record,
    })
  }

  export function output(processID: string, chars: number) {
    const current = processes.get(processID)
    if (!current) return
    const now = Date.now()
    processes.set(processID, {
      ...current,
      output_chars: current.output_chars + chars,
      last_output_at: now,
      last_interaction_at: now,
    })
  }

  export function addOutputRef(processID: string, ref: JsonRecord) {
    const current = processes.get(processID)
    if (!current) return
    processes.set(processID, {
      ...current,
      output_refs: [...current.output_refs, ref],
      last_interaction_at: Date.now(),
    })
  }

  export function finish(
    processID: string,
    input: {
      status: ExecProcessStatus
      exitCode: number | null
      failure?: string | null
    },
  ) {
    const current = processes.get(processID)
    if (!current) {
      runtimes.delete(processID)
      return AialraTurnTrace.emit({
        phase: "exec_process.finished",
        data: {
          schema: "aialra.exec_process.v1",
          process_id: processID,
          status: input.status,
          exit_code: input.exitCode,
          failure: input.failure,
          missing_registry_record: true,
        },
      })
    }
    if (current.status !== "running") {
      return AialraTurnTrace.emit({
        phase: "exec_process.finish_ignored",
        turnID: current.turn_id,
        sessionID: current.session_id,
        messageID: current.message_id,
        data: {
          schema: "aialra.exec_process_manager.v1",
          process_id: processID,
          command_id: current.command_id,
          tool_call_id: current.tool_call_id,
          status: "ignored",
          current_status: current.status,
          requested_status: input.status,
          requested_exit_code: input.exitCode,
          reason: "terminal_state_already_settled",
        },
      })
    }
    const next: ExecProcessRecord = {
      ...current,
      status: input.status,
      exit_code: input.exitCode,
      failure: input.failure,
      last_interaction_at: Date.now(),
    }
    processes.set(processID, next)
    runtimes.delete(processID)
    return Effect.all([
      AialraTurnTrace.emit({
        phase: "exec_process.finished",
        turnID: next.turn_id,
        sessionID: next.session_id,
        messageID: next.message_id,
        data: next,
      }),
      ExecCommandEnd.emit({
          sessionID: next.session_id,
          turnID: next.turn_id,
          messageID: next.message_id,
          toolCallID: next.tool_call_id,
          processID: next.process_id,
          commandID: next.command_id,
          backend: next.backend,
          cwd: next.cwd,
          command: next.command,
          startedAt: next.started_at,
          endedAt: next.last_interaction_at,
          exitCode: next.exit_code ?? null,
          status: next.status === "running" ? "failed" : next.status,
          outputChars: next.output_chars,
          error: next.failure,
          abortReason: next.status === "aborted" ? next.failure ?? "process_abort_requested" : undefined,
          timeoutReason: next.status === "timeout" ? next.failure ?? "command_timeout" : undefined,
      }),
    ], { concurrency: 1 })
  }

  export function writeStdin(processID: string, input: WriteStdinInput) {
    return Effect.gen(function* () {
      const record = processes.get(processID)
      const payload = stdinPayload(input)
      if (!record) {
        yield* writeEvent(undefined, input, payload, "denied", "process_not_found")
        return { ok: false as const, reason: "process_not_found", payload }
      }
      if (record.session_id !== input.sessionID) {
        yield* writeEvent(record, input, payload, "denied", "session_mismatch")
        return { ok: false as const, reason: "session_mismatch", payload }
      }
      if (input.turnID && record.turn_id && record.turn_id !== input.turnID) {
        yield* writeEvent(record, input, payload, "denied", "turn_mismatch")
        return { ok: false as const, reason: "turn_mismatch", payload }
      }
      if (record.status !== "running") {
        yield* writeEvent(record, input, payload, "denied", "process_not_running")
        return { ok: false as const, reason: "process_not_running", payload }
      }
      const runtime = runtimes.get(processID)
      if (!runtime) {
        yield* writeEvent(record, input, payload, "denied", "stdin_runtime_missing")
        return { ok: false as const, reason: "stdin_runtime_missing", payload }
      }

      if (payload.control === "ctrl-c" && runtime.interrupt) {
        yield* Effect.promise(() => Promise.resolve(runtime.interrupt?.()))
      } else if (payload.text && runtime.writeStdin) {
        yield* Effect.promise(() => Promise.resolve(runtime.writeStdin?.(payload.text)))
      } else if (payload.text && !runtime.writeStdin) {
        yield* writeEvent(record, input, payload, "denied", "stdin_write_unsupported")
        return { ok: false as const, reason: "stdin_write_unsupported", payload }
      }

      if (payload.close_stdin) {
        if (!runtime.closeStdin) {
          yield* writeEvent(record, input, payload, "denied", "stdin_close_unsupported")
          return { ok: false as const, reason: "stdin_close_unsupported", payload }
        }
        yield* Effect.promise(() => Promise.resolve(runtime.closeStdin?.()))
      }

      const next: ExecProcessRecord = {
        ...record,
        stdin_writes: record.stdin_writes + 1,
        stdin_chars: record.stdin_chars + payload.text.length,
        last_interaction_at: Date.now(),
      }
      processes.set(processID, next)
      yield* writeEvent(next, input, payload, "written")
      return { ok: true as const, reason: null, payload }
    })
  }

  export function get(processID: string) {
    return processes.get(processID)
  }

  export function read(processID: string, input?: { sessionID?: string; turnID?: string }) {
    const record = processes.get(processID)
    if (!record) return undefined
    if (input?.sessionID && record.session_id !== input.sessionID) return undefined
    if (input?.turnID && record.turn_id !== input.turnID) return undefined
    return record
  }

  export function list(input?: { sessionID?: string; turnID?: string; status?: ExecProcessStatus }) {
    return Array.from(processes.values()).filter((record) => {
      if (input?.sessionID && record.session_id !== input.sessionID) return false
      if (input?.turnID && record.turn_id !== input.turnID) return false
      if (input?.status && record.status !== input.status) return false
      return true
    })
  }

  export function listLiveProcesses(input?: { sessionID?: string; turnID?: string }) {
    return list({ ...input, status: "running" })
  }

  export function assertLiveCapacity(input: LiveCapacityInput) {
    return Effect.gen(function* () {
      const live = listLiveProcesses({ sessionID: input.sessionID })
      const sessionCount = live.length
      const turnCount = input.turnID ? live.filter((record) => record.turn_id === input.turnID).length : 0
      const environmentCount = input.environmentID
        ? live.filter((record) => record.environment_id === input.environmentID).length
        : 0
      const dimensions = [
        { name: "session", count: sessionCount, limit: input.limits.perSession },
        { name: "turn", count: turnCount, limit: input.limits.perTurn },
        { name: "environment", count: environmentCount, limit: input.limits.perEnvironment },
      ]
      const exceeded = dimensions.find((item) => item.count >= item.limit)
      const data = {
        schema: "aialra.exec_process_capacity.v1",
        process_id: input.processID,
        command_id: input.commandID,
        tool_call_id: input.toolCallID,
        environment_id: input.environmentID,
        session_count: sessionCount,
        turn_count: turnCount,
        environment_count: environmentCount,
        limit_per_session: input.limits.perSession,
        limit_per_turn: input.limits.perTurn,
        limit_per_environment: input.limits.perEnvironment,
        dimension: exceeded?.name,
        live_process_ids: live.map((record) => record.process_id),
      }
      if (!exceeded) {
        yield* AialraTurnTrace.emit({
          phase: "exec_process.capacity_checked",
          turnID: input.turnID,
          sessionID: input.sessionID,
          messageID: input.messageID,
          data: {
            ...data,
            status: "allowed",
          },
        })
        return { ok: true as const, data }
      }
      yield* AialraTurnTrace.emit({
        phase: "exec_process.capacity_denied",
        turnID: input.turnID,
        sessionID: input.sessionID,
        messageID: input.messageID,
        data: {
          ...data,
          status: "denied",
          reason: "live_process_limit_reached",
        },
      })
      throw new Error(
        [
          "Live background process limit reached.",
          `dimension=${exceeded.name}`,
          `count=${exceeded.count}`,
          `limit=${exceeded.limit}`,
          "Use await_process, write_stdin, or cleanup finished background processes before starting another yielded command.",
        ].join(" "),
      )
    })
  }

  export function waitForTerminal(processID: string, input: WaitForTerminalInput) {
    return Effect.gen(function* () {
      const startedAt = Date.now()
      const pollIntervalMs = Math.max(100, Math.min(input.pollIntervalMs ?? 250, 5_000))
      const first = read(processID, { sessionID: input.sessionID, turnID: input.turnID })
      if (!first) {
        yield* AialraTurnTrace.emit({
          phase: "exec_process.await_finished",
          turnID: input.turnID,
          sessionID: input.sessionID,
          messageID: input.messageID,
          data: {
            schema: "aialra.exec_process_awaiter.v1",
            process_id: processID,
            status: "denied",
            reason: "process_not_found_or_forbidden",
            requested_timeout_ms: input.requestedTimeoutMs,
            effective_timeout_ms: input.effectiveTimeoutMs,
            duration_ms: Math.max(0, Date.now() - startedAt),
          },
        })
        return {
          status: "denied" as const,
          reason: "process_not_found_or_forbidden",
          durationMs: Math.max(0, Date.now() - startedAt),
        }
      }

      yield* AialraTurnTrace.emit({
        phase: "exec_process.await_started",
        turnID: first.turn_id,
        sessionID: first.session_id,
        messageID: input.messageID,
        data: {
          schema: "aialra.exec_process_awaiter.v1",
          process_id: processID,
          command_id: first.command_id,
          tool_call_id: input.toolCallID ?? first.tool_call_id,
          status: "waiting",
          target_status: first.status,
          requested_timeout_ms: input.requestedTimeoutMs,
          effective_timeout_ms: input.effectiveTimeoutMs,
          poll_interval_ms: pollIntervalMs,
          output_chars: first.output_chars,
        },
      })

      let lastOutputChars = first.output_chars
      let lastStatus = first.status
      while (Date.now() - startedAt <= input.effectiveTimeoutMs) {
        const current = read(processID, { sessionID: input.sessionID, turnID: input.turnID })
        if (!current) {
          yield* AialraTurnTrace.emit({
            phase: "exec_process.await_finished",
            turnID: first.turn_id,
            sessionID: first.session_id,
            messageID: input.messageID,
            data: {
              schema: "aialra.exec_process_awaiter.v1",
              process_id: processID,
              command_id: first.command_id,
              tool_call_id: input.toolCallID ?? first.tool_call_id,
              status: "denied",
              reason: "process_disappeared",
              duration_ms: Math.max(0, Date.now() - startedAt),
            },
          })
          return {
            status: "denied" as const,
            reason: "process_disappeared",
            durationMs: Math.max(0, Date.now() - startedAt),
          }
        }
        if (current.output_chars !== lastOutputChars || current.status !== lastStatus) {
          lastOutputChars = current.output_chars
          lastStatus = current.status
          yield* AialraTurnTrace.emit({
            phase: "exec_process.await_progress",
            turnID: current.turn_id,
            sessionID: current.session_id,
            messageID: input.messageID,
            data: {
              schema: "aialra.exec_process_awaiter.v1",
              process_id: processID,
              command_id: current.command_id,
              tool_call_id: input.toolCallID ?? current.tool_call_id,
              status: "progress",
              target_status: current.status,
              output_chars: current.output_chars,
              last_output_at: current.last_output_at,
              elapsed_ms: Math.max(0, Date.now() - startedAt),
            },
          })
        }
        if (current.status !== "running") {
          yield* AialraTurnTrace.emit({
            phase: "exec_process.await_finished",
            turnID: current.turn_id,
            sessionID: current.session_id,
            messageID: input.messageID,
            data: {
              schema: "aialra.exec_process_awaiter.v1",
              process_id: processID,
              command_id: current.command_id,
              tool_call_id: input.toolCallID ?? current.tool_call_id,
              status: current.status,
              exit_code: current.exit_code ?? null,
              failure: current.failure,
              output_chars: current.output_chars,
              duration_ms: Math.max(0, Date.now() - startedAt),
            },
          })
          return {
            status: current.status,
            record: current,
            durationMs: Math.max(0, Date.now() - startedAt),
          }
        }
        yield* Effect.sleep(`${pollIntervalMs} millis`)
      }

      const current = read(processID, { sessionID: input.sessionID, turnID: input.turnID }) ?? first
      yield* AialraTurnTrace.emit({
        phase: "exec_process.await_timeout",
        turnID: current.turn_id,
        sessionID: current.session_id,
        messageID: input.messageID,
        data: {
          schema: "aialra.exec_process_awaiter.v1",
          process_id: processID,
          command_id: current.command_id,
          tool_call_id: input.toolCallID ?? current.tool_call_id,
          status: "await_timeout",
          target_status: current.status,
          requested_timeout_ms: input.requestedTimeoutMs,
          effective_timeout_ms: input.effectiveTimeoutMs,
          output_chars: current.output_chars,
          duration_ms: Math.max(0, Date.now() - startedAt),
        },
      })
      return {
        status: "await_timeout" as const,
        record: current,
        durationMs: Math.max(0, Date.now() - startedAt),
      }
    })
  }

  export function abort(processID: string, input: {
    sessionID: string
    turnID?: string
    messageID: string
    toolCallID?: string
    actor?: "model" | "user" | "system"
    reason?: string
  }) {
    return Effect.gen(function* () {
      const record = read(processID, { sessionID: input.sessionID, turnID: input.turnID })
      if (!record) {
        yield* AialraTurnTrace.emit({
          phase: "exec_process.abort_denied",
          turnID: input.turnID,
          sessionID: input.sessionID,
          messageID: input.messageID,
          data: {
            schema: "aialra.exec_process_manager.v1",
            process_id: processID,
            tool_call_id: input.toolCallID,
            status: "denied",
            reason: "process_not_found",
          },
        })
        return { ok: false as const, reason: "process_not_found" }
      }
      if (record.status !== "running") {
        yield* AialraTurnTrace.emit({
          phase: "exec_process.abort_denied",
          turnID: record.turn_id,
          sessionID: record.session_id,
          messageID: input.messageID,
          data: {
            schema: "aialra.exec_process_manager.v1",
            process_id: processID,
            tool_call_id: input.toolCallID,
            status: "denied",
            reason: "process_not_running",
            target_status: record.status,
          },
        })
        return { ok: false as const, reason: "process_not_running" }
      }
      const runtime = runtimes.get(processID)
      if (!runtime?.abort && !runtime?.interrupt) {
        yield* AialraTurnTrace.emit({
          phase: "exec_process.abort_denied",
          turnID: record.turn_id,
          sessionID: record.session_id,
          messageID: input.messageID,
          data: {
            schema: "aialra.exec_process_manager.v1",
            process_id: processID,
            tool_call_id: input.toolCallID,
            status: "denied",
            reason: "abort_runtime_missing",
          },
        })
        return { ok: false as const, reason: "abort_runtime_missing" }
      }
      yield* AialraTurnTrace.emit({
        phase: "exec_process.abort_requested",
        turnID: record.turn_id,
        sessionID: record.session_id,
        messageID: input.messageID,
        data: {
          schema: "aialra.exec_process_manager.v1",
          process_id: processID,
          command_id: record.command_id,
          tool_call_id: input.toolCallID ?? record.tool_call_id,
          actor: input.actor ?? "model",
          reason: input.reason ?? "process_abort_requested",
          status: "requested",
        },
      })
      yield* Effect.promise(() => Promise.resolve((runtime.abort ?? runtime.interrupt)?.()))
      yield* finish(processID, {
        status: "aborted",
        exitCode: null,
        failure: input.reason ?? "process_abort_requested",
      })
      return { ok: true as const, reason: null }
    })
  }

  export function cleanup(input: CleanupInput = {}) {
    return Effect.gen(function* () {
      const ids = new Set([input.processID, ...(input.processIDs ?? [])].filter((item): item is string => Boolean(item)))
      const targets = list({ sessionID: input.sessionID, turnID: input.turnID }).filter((record) => {
        if (ids.size > 0 && !ids.has(record.process_id)) return false
        if (input.environmentID && record.environment_id !== input.environmentID) return false
        if (input.statuses?.length && !input.statuses.includes(record.status)) return false
        if (record.status === "running") return input.includeRunning === true
        return input.includeFinished !== false
      })
      const results: Array<{
        process_id: string
        status: "cleaned" | "terminated" | "failed"
        previous_status: ExecProcessStatus
        reason?: string
      }> = []
      for (const record of targets) {
        const runtime = runtimes.get(record.process_id)
        if (record.status === "running") {
          if (!runtime?.interrupt && !runtime?.abort) {
            results.push({
              process_id: record.process_id,
              status: "failed",
              previous_status: record.status,
              reason: "cleanup_runtime_missing",
            })
            continue
          }
          try {
            yield* Effect.promise(() => Promise.resolve((runtime.interrupt ?? runtime.abort)?.()))
            yield* finish(record.process_id, {
              status: "aborted",
              exitCode: null,
              failure: input.reason ?? "cleanup_terminated_running_process",
            })
            const next = processes.get(record.process_id)
            if (next) processes.set(record.process_id, { ...next, cleanup_at: Date.now() })
            runtimes.delete(record.process_id)
            results.push({
              process_id: record.process_id,
              status: "terminated",
              previous_status: record.status,
              reason: input.reason ?? "cleanup_terminated_running_process",
            })
          } catch (error) {
            results.push({
              process_id: record.process_id,
              status: "failed",
              previous_status: record.status,
              reason: error instanceof Error ? error.message : String(error),
            })
          }
        } else {
          runtimes.delete(record.process_id)
          processes.set(record.process_id, { ...record, cleanup_at: Date.now() })
          results.push({
            process_id: record.process_id,
            status: "cleaned",
            previous_status: record.status,
            reason: input.reason ?? "cleanup_finished_process",
          })
        }
      }
      yield* Effect.all(
        results.map((result) =>
          AialraTurnTrace.emit({
            phase: "exec_process.cleanup",
            sessionID: input.sessionID,
            turnID: input.turnID,
            data: {
              schema: "aialra.exec_process_manager.v1",
              process_id: result.process_id,
              status: result.status,
              previous_status: result.previous_status,
              reason: result.reason,
              cleaned: result.status !== "failed" ? 1 : 0,
              failed: result.status === "failed" ? 1 : 0,
            },
          }),
        ),
        { concurrency: 1 },
      )
      yield* AialraTurnTrace.emit({
        phase: "exec_process.cleanup",
        sessionID: input.sessionID,
        turnID: input.turnID,
        data: {
          schema: "aialra.exec_process_manager.v1",
          status: "summary",
          cleaned: results.filter((result) => result.status !== "failed").length,
          failed: results.filter((result) => result.status === "failed").length,
          process_ids: results.map((result) => result.process_id),
        },
      })
      return {
        cleaned: results.filter((result) => result.status !== "failed").length,
        failed: results.filter((result) => result.status === "failed").length,
        results,
      }
    })
  }

  export function clearForTest() {
    processes.clear()
    runtimes.clear()
  }
}

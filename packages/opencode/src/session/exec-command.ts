import { Effect } from "effect"
import { AialraTurnTrace } from "./turn-trace"
import { CodexTurn, type TurnContext } from "./turn-context"
import { TerminalInteraction } from "./terminal-interaction"
import { ExecCommandOutputDelta } from "./exec-command-output-delta"
import { ExecCommandEnd } from "./exec-command-end"

type JsonRecord = Record<string, unknown>

export type ExecCommandBackend = "codex_exec_server" | "node_bun" | "remote"
export type ExecCommandYieldPolicy = ReturnType<typeof yieldPolicy>

const DEFAULT_YIELD_TIME_MS = 10_000
const MIN_YIELD_TIME_MS = 250
const MAX_YIELD_TIME_MS = 30_000

type Common = {
  commandID: string
  backend: ExecCommandBackend
  command: string
  shell: string
  argv: string[]
  cwd: string
  timeoutMs: number
  backgroundTerminalMaxTimeoutMs?: number
  yieldTimeMs?: number
  requestedYieldTimeMs?: number
  yieldTimeClamped?: boolean
  yieldTimeMinMs?: number
  yieldTimeMaxMs?: number
  processID?: string
  sandbox?: JsonRecord
  turnID?: string
  environmentID?: string
  environmentCwd?: string
  permissionProfileID?: string
  permissionProfile?: unknown
  approvalPolicy?: unknown
  approvalsReviewer?: unknown
  networkPolicy?: string
  networkPermissions?: unknown
  sandboxPolicy?: unknown
  shellEnvPolicy?: unknown
  approvalDecision?: unknown
}

type ExecCommandContext = {
  sessionID: string
  messageID: string
  callID?: string
  turn?: TurnContext
}

function turn(ctx: ExecCommandContext): TurnContext | undefined {
  return ctx.turn
}

function profileID(active: TurnContext | undefined) {
  return active?.active_permission_profile?.id ?? active?.metadata?.permissionProfileID
}

function commandID(ctx: ExecCommandContext) {
  return `exec_${(ctx.callID || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_")}`
}

function clampYieldTime(value: number) {
  return Math.min(MAX_YIELD_TIME_MS, Math.max(MIN_YIELD_TIME_MS, Math.trunc(value)))
}

function yieldPolicy(requested?: number) {
  const raw = requested ?? DEFAULT_YIELD_TIME_MS
  const effective = clampYieldTime(raw)
  return {
    requested_yield_time_ms: requested,
    effective_yield_time_ms: effective,
    yield_time_clamped: effective !== raw,
    yield_time_min_ms: MIN_YIELD_TIME_MS,
    yield_time_max_ms: MAX_YIELD_TIME_MS,
    yield_time_default_ms: DEFAULT_YIELD_TIME_MS,
  }
}

function base(ctx: ExecCommandContext, input: Common) {
  const active = turn(ctx)
  return {
    schema: "aialra.exec_command.v1",
    command_id: input.commandID,
    session_id: String(ctx.sessionID),
    turn_id: active?.turnID ? String(active.turnID) : input.turnID,
    message_id: String(ctx.messageID),
    tool_call_id: ctx.callID,
    environment_id: active?.selected_environment_id ?? input.environmentID ?? "legacy",
    cwd: input.cwd,
    command: input.command,
    shell: input.shell,
    argv: input.argv,
    backend: input.backend,
    process_id: input.processID,
    permission_profile_id: profileID(active) ?? input.permissionProfileID,
    permission_profile: active?.permission_profile ?? input.permissionProfile,
    approval_policy: active?.approval_policy ?? input.approvalPolicy,
    approvals_reviewer: active?.approvals_reviewer ?? input.approvalsReviewer,
    network_policy: active?.network_policy ?? input.networkPolicy,
    network_permissions: active?.network_permissions ?? input.networkPermissions,
    sandbox_policy: active?.sandbox_policy ?? input.sandboxPolicy,
    shell_env_policy: active?.shell_environment_policy ?? input.shellEnvPolicy,
    approval_decision: input.approvalDecision,
    timeout_ms: input.timeoutMs,
    background_terminal_max_timeout_ms: input.backgroundTerminalMaxTimeoutMs,
    yield_time_ms: input.yieldTimeMs,
    requested_yield_time_ms: input.requestedYieldTimeMs,
    effective_yield_time_ms: input.yieldTimeMs,
    yield_time_clamped: input.yieldTimeClamped,
    yield_time_min_ms: input.yieldTimeMinMs,
    yield_time_max_ms: input.yieldTimeMaxMs,
    sandbox: input.sandbox,
  }
}

export namespace ExecCommand {
  export function id(ctx: ExecCommandContext) {
    return commandID(ctx)
  }

  export function resolveYieldTime(requested?: number) {
    return yieldPolicy(requested)
  }

  export function started(ctx: ExecCommandContext, input: Common) {
    const active = turn(ctx)
    return Effect.all([
      TerminalInteraction.emit({
        sessionID: ctx.sessionID,
        turnID: active?.turnID ?? input.turnID,
        messageID: ctx.messageID,
        toolCallID: ctx.callID,
        phase: "exec_started",
        processID: input.processID,
        commandID: input.commandID,
        backend: input.backend,
        environmentID: active?.selected_environment_id ?? input.environmentID,
        cwd: input.cwd,
        command: input.command,
        status: "started",
      }),
      AialraTurnTrace.emit({
      phase: "exec_command.started",
      turnID: active?.turnID ?? input.turnID,
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      data: {
        ...base(ctx, input),
        status: "started",
        environment_cwd: active ? CodexTurn.environmentCwd(active) : input.environmentCwd ?? input.cwd,
      },
      }),
    ], { concurrency: 1 })
  }

  export function output(ctx: ExecCommandContext, input: Common & {
    stream: "stdout" | "stderr" | "combined"
    seq: number
    text: string
    preview: string
    cumulativeBytes?: number
    capReached?: boolean
    rawOutputRef?: Record<string, unknown>
  }) {
    return Effect.all([
      ExecCommandOutputDelta.emit({
        sessionID: ctx.sessionID,
        turnID: turn(ctx)?.turnID ?? input.turnID,
        messageID: ctx.messageID,
        toolCallID: ctx.callID,
        processID: input.processID,
        commandID: input.commandID,
        backend: input.backend,
        environmentID: turn(ctx)?.selected_environment_id ?? input.environmentID,
        stream: input.stream,
        seq: input.seq,
        text: input.text,
        preview: input.preview,
        cumulativeBytes: input.cumulativeBytes,
        capReached: input.capReached,
        rawOutputRef: input.rawOutputRef,
      }),
      TerminalInteraction.emit({
        sessionID: ctx.sessionID,
        turnID: turn(ctx)?.turnID ?? input.turnID,
        messageID: ctx.messageID,
        toolCallID: ctx.callID,
        phase: input.stream === "stderr" ? "stderr_delta" : "stdout_delta",
        processID: input.processID,
        commandID: input.commandID,
        backend: input.backend,
        environmentID: turn(ctx)?.selected_environment_id ?? input.environmentID,
        cwd: input.cwd,
        command: input.command,
        stream: input.stream,
        seq: input.seq,
        chars: input.text.length,
        preview: input.preview,
        status: "output",
      }),
      AialraTurnTrace.emit({
      phase: "exec_command.output",
      turnID: turn(ctx)?.turnID ?? input.turnID,
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      data: {
        ...base(ctx, input),
        status: "output",
        stream: input.stream,
        seq: input.seq,
        chars: input.text.length,
        preview: input.preview,
      },
      }),
    ], { concurrency: 1 })
  }

  export function fallback(ctx: ExecCommandContext, input: Common & {
    from: ExecCommandBackend
    to: ExecCommandBackend
    reason: string
  }) {
    return Effect.all([
      TerminalInteraction.emit({
        sessionID: ctx.sessionID,
        turnID: turn(ctx)?.turnID ?? input.turnID,
        messageID: ctx.messageID,
        toolCallID: ctx.callID,
        phase: "fallback",
        processID: input.processID,
        commandID: input.commandID,
        backend: input.to,
        environmentID: turn(ctx)?.selected_environment_id ?? input.environmentID,
        cwd: input.cwd,
        command: input.command,
        status: "fallback",
        reason: input.reason,
      }),
      AialraTurnTrace.emit({
      phase: "exec_command.fallback",
      turnID: turn(ctx)?.turnID ?? input.turnID,
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      data: {
        ...base(ctx, { ...input, backend: input.to }),
        status: "fallback",
        from_backend: input.from,
        to_backend: input.to,
        reason: input.reason,
      },
      }),
    ], { concurrency: 1 })
  }

  export function yielded(ctx: ExecCommandContext, input: Common & {
    outputChars: number
    durationMs: number
  }) {
    return Effect.all([
      TerminalInteraction.emit({
        sessionID: ctx.sessionID,
        turnID: turn(ctx)?.turnID ?? input.turnID,
        messageID: ctx.messageID,
        toolCallID: ctx.callID,
        phase: "process_running",
        processID: input.processID,
        commandID: input.commandID,
        backend: input.backend,
        environmentID: turn(ctx)?.selected_environment_id ?? input.environmentID,
        cwd: input.cwd,
        command: input.command,
        chars: input.outputChars,
        durationMs: input.durationMs,
        status: "running",
      }),
      AialraTurnTrace.emit({
      phase: "exec_command.yielded",
      turnID: turn(ctx)?.turnID ?? input.turnID,
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      data: {
        ...base(ctx, input),
        status: "running",
        output_chars: input.outputChars,
        duration_ms: input.durationMs,
      },
      }),
    ], { concurrency: 1 })
  }

  export function finished(ctx: ExecCommandContext, input: Common & {
    exitCode: number | null
    signal?: string | null
    timedOut: boolean
    aborted: boolean
    cleanedUp?: boolean
    outputChars: number
    truncated: boolean
    durationMs: number
    failure?: string | null
    outputPreview?: string
    rawOutputRef?: JsonRecord
    timeoutReason?: string | null
    abortReason?: string | null
  }) {
    const phase = input.aborted
      ? "abort"
      : input.timedOut
        ? "timeout"
        : input.exitCode === 0
          ? "process_end"
          : "error"
    return Effect.all([
      ExecCommandEnd.emit({
        sessionID: ctx.sessionID,
        turnID: turn(ctx)?.turnID ?? input.turnID,
        messageID: ctx.messageID,
        toolCallID: ctx.callID,
        processID: input.processID,
        commandID: input.commandID,
        backend: input.backend,
        cwd: input.cwd,
        command: input.command,
        exitCode: input.exitCode,
        signal: input.signal,
        timedOut: input.timedOut,
        aborted: input.aborted,
        cleanedUp: input.cleanedUp,
        outputChars: input.outputChars,
        outputPreview: input.outputPreview,
        truncated: input.truncated,
        rawOutputRef: input.rawOutputRef,
        error: input.failure,
        timeoutReason: input.timeoutReason,
        abortReason: input.abortReason,
        durationMs: input.durationMs,
      }),
      TerminalInteraction.emit({
        sessionID: ctx.sessionID,
        turnID: turn(ctx)?.turnID ?? input.turnID,
        messageID: ctx.messageID,
        toolCallID: ctx.callID,
        phase,
        processID: input.processID,
        commandID: input.commandID,
        backend: input.backend,
        environmentID: turn(ctx)?.selected_environment_id ?? input.environmentID,
        cwd: input.cwd,
        command: input.command,
        chars: input.outputChars,
        exitCode: input.exitCode,
        durationMs: input.durationMs,
        status: input.aborted ? "aborted" : input.timedOut ? "timeout" : input.exitCode === 0 ? "completed" : "failed",
        reason: input.failure,
      }),
      AialraTurnTrace.emit({
      phase: "exec_command.finished",
      turnID: turn(ctx)?.turnID ?? input.turnID,
      sessionID: ctx.sessionID,
      messageID: ctx.messageID,
      data: {
        ...base(ctx, input),
        status: input.aborted ? "aborted" : input.timedOut ? "timeout" : input.exitCode === 0 ? "completed" : "failed",
        exit_code: input.exitCode,
        timed_out: input.timedOut,
        aborted: input.aborted,
        output_chars: input.outputChars,
        truncated: input.truncated,
        duration_ms: input.durationMs,
        failure: input.failure,
      },
      }),
    ], { concurrency: 1 })
  }
}

import { AialraTurnTrace } from "./turn-trace"
import type { ExecCommandBackend } from "./exec-command"

type TerminalInteractionPhase =
  | "exec_started"
  | "stdout_delta"
  | "stderr_delta"
  | "stdin_write"
  | "process_running"
  | "process_end"
  | "abort"
  | "cleanup"
  | "timeout"
  | "error"
  | "fallback"
  | "approval_requested"
  | "approval_resolved"

type TerminalInteractionInput = {
  sessionID: string
  turnID?: string
  messageID?: string
  toolCallID?: string
  phase: TerminalInteractionPhase
  processID?: string
  commandID?: string
  backend?: ExecCommandBackend
  environmentID?: string
  cwd?: string
  command?: string
  stream?: "stdout" | "stderr" | "combined"
  seq?: number
  chars?: number
  preview?: string
  stdin?: string
  status?: string
  exitCode?: number | null
  durationMs?: number
  reason?: string | null
}

function codexCompat(input: TerminalInteractionInput) {
  return {
    method: "item/commandExecution/terminalInteraction",
    threadId: input.sessionID,
    turnId: input.turnID ?? input.messageID ?? "unknown",
    itemId: input.toolCallID ?? input.commandID ?? input.messageID ?? "unknown",
    processId: input.processID ?? "unknown",
    stdin: input.stdin ?? "",
  }
}

export namespace TerminalInteraction {
  export function emit(input: TerminalInteractionInput) {
    return AialraTurnTrace.emit({
      phase: "terminal.interaction",
      turnID: input.turnID,
      sessionID: input.sessionID,
      messageID: input.messageID,
      data: {
        schema: "aialra.terminal_interaction.v1",
        codex: codexCompat(input),
        session_id: input.sessionID,
        turn_id: input.turnID,
        message_id: input.messageID,
        tool_call_id: input.toolCallID,
        phase: input.phase,
        process_id: input.processID,
        command_id: input.commandID,
        backend: input.backend,
        environment_id: input.environmentID,
        cwd: input.cwd,
        command: input.command,
        stream: input.stream,
        seq: input.seq,
        chars: input.chars,
        preview: input.preview,
        stdin_preview: input.stdin,
        status: input.status,
        exit_code: input.exitCode,
        duration_ms: input.durationMs,
        reason: input.reason,
      },
    })
  }
}

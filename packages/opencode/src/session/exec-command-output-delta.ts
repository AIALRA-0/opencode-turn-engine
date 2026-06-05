import { AialraTurnTrace } from "./turn-trace"
import type { ExecCommandBackend } from "./exec-command"

type ExecCommandOutputDeltaInput = {
  sessionID: string
  turnID?: string
  messageID: string
  toolCallID?: string
  processID?: string
  commandID: string
  backend: ExecCommandBackend
  environmentID?: string
  stream: "stdout" | "stderr" | "combined"
  seq: number
  text: string
  preview: string
  cumulativeBytes?: number
  capReached?: boolean
  rawOutputRef?: Record<string, unknown>
}

function stream(input: ExecCommandOutputDeltaInput) {
  if (input.stream === "stderr") return "stderr"
  return "stdout"
}

export namespace ExecCommandOutputDelta {
  export function emit(input: ExecCommandOutputDeltaInput) {
    const deltaBase64 = Buffer.from(input.text, "utf8").toString("base64")
    const byteLength = Buffer.byteLength(input.text, "utf8")
    const cumulativeBytes = input.cumulativeBytes ?? byteLength
    return AialraTurnTrace.emit({
      phase: "exec_command.output_delta",
      turnID: input.turnID,
      sessionID: input.sessionID,
      messageID: input.messageID,
      data: {
        schema: "aialra.exec_command_output_delta.v1",
        process_id: input.processID,
        command_id: input.commandID,
        tool_call_id: input.toolCallID,
        backend: input.backend,
        environment_id: input.environmentID,
        stream: stream(input),
        channel: stream(input),
        source_stream: input.stream,
        seq: input.seq,
        sequence: input.seq,
        byte_length: byteLength,
        cumulative_byte_length: cumulativeBytes,
        byte_offset_start: Math.max(0, cumulativeBytes - byteLength),
        byte_offset_end: cumulativeBytes,
        char_length: input.text.length,
        encoding: "base64",
        base64_payload: deltaBase64,
        delta_base64: deltaBase64,
        timestamp: new Date().toISOString(),
        cap_reached: input.capReached === true,
        truncation_marker: input.capReached === true ? "cap_reached" : null,
        preview: input.preview,
        raw_output_ref: input.rawOutputRef,
        codex_command_exec: {
          method: "command/exec/outputDelta",
          processId: input.processID ?? "unknown",
          stream: stream(input),
          deltaBase64,
          capReached: input.capReached === true,
        },
        codex_item: {
          method: "item/commandExecution/outputDelta",
          threadId: input.sessionID,
          turnId: input.turnID ?? input.messageID,
          itemId: input.toolCallID ?? input.commandID,
          delta: input.text,
        },
      },
    })
  }
}

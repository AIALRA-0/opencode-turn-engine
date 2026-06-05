import { AialraTurnTrace } from "./turn-trace"
import { Effect } from "effect"
import type { MessageID, SessionID } from "./schema"
import { isRecord } from "@/util/record"
import type { ProviderExecutionMetadata } from "./provider-tool-protocol"
import { TurnDiffStore } from "./turn-diff"

type JsonRecord = Record<string, unknown>

export type ToolResultStatus = "completed" | "failed" | "aborted"
export type ToolResultExecutorType = "local" | "provider" | "external"

export type ToolResultSettlement = {
  schema: "aialra.tool_result_settlement.v1"
  resultID: string
  result_id: string
  toolCallID: string
  tool_call_id: string
  tool: string
  status: ToolResultStatus
  sessionID: string
  session_id: string
  turnID?: string
  turn_id?: string
  messageID?: string
  message_id?: string
  threadID?: string
  thread_id?: string
  environmentID?: string
  environment_id?: string
  executorType: ToolResultExecutorType
  executor_type: ToolResultExecutorType
  startedAt?: string
  started_at?: string
  completedAt: string
  completed_at: string
  durationMs?: number
  duration_ms?: number
  exitCode?: number | null
  exit_code?: number | null
  visibleOutputChars: number
  visible_output_chars: number
  visibleOutput?: string
  visible_output?: string
  visibleOutputTruncated: boolean
  visible_output_truncated: boolean
  visibleOutputPreview?: string
  visible_output_preview?: string
  rawOutputRef?: JsonRecord
  raw_output_ref?: JsonRecord
  error?: string
  attachments: number
  providerExecuted: boolean
  providerExecution?: ProviderExecutionMetadata
  provider_execution?: ProviderExecutionMetadata
  fileMutations: JsonRecord[]
  metadataKeys: string[]
  source: "processor" | "shell_route" | "cleanup" | "provider_tool"
}

export namespace ToolResultSettlement {
  export function build(input: {
    sessionID: SessionID | string
    turnID?: MessageID | string
    messageID?: MessageID | string
    threadID?: string
    environmentID?: string
    executorType?: ToolResultExecutorType
    toolCallID: string
    tool: string
    status: ToolResultStatus
    startedAt?: number
    completedAt: number
    output?: string
    error?: string
    metadata?: JsonRecord
    attachments?: number
    providerExecuted?: boolean
    source: ToolResultSettlement["source"]
  }): ToolResultSettlement {
    const metadata = input.metadata ?? {}
    const output = input.output ?? ""
    const visibleOutput = visible(output)
    const startedAt = input.startedAt ? new Date(input.startedAt).toISOString() : undefined
    const completedAt = new Date(input.completedAt).toISOString()
    const durationMs = input.startedAt ? Math.max(0, input.completedAt - input.startedAt) : undefined
    const exit = exitCode(metadata)
    const rawOutputRef = isRecord(metadata.outputRef) ? metadata.outputRef : undefined
    const executorType = input.executorType ?? (input.providerExecuted === true || metadata.providerExecuted === true ? "provider" : "local")
    const result = resultID(input.toolCallID)
    return {
      schema: "aialra.tool_result_settlement.v1",
      resultID: result,
      result_id: result,
      toolCallID: input.toolCallID,
      tool_call_id: input.toolCallID,
      tool: input.tool,
      status: input.status,
      sessionID: String(input.sessionID),
      session_id: String(input.sessionID),
      turnID: input.turnID ? String(input.turnID) : undefined,
      turn_id: input.turnID ? String(input.turnID) : undefined,
      messageID: input.messageID ? String(input.messageID) : undefined,
      message_id: input.messageID ? String(input.messageID) : undefined,
      threadID: input.threadID ?? String(input.sessionID),
      thread_id: input.threadID ?? String(input.sessionID),
      environmentID: input.environmentID ?? environmentID(metadata) ?? "default",
      environment_id: input.environmentID ?? environmentID(metadata) ?? "default",
      executorType,
      executor_type: executorType,
      startedAt,
      started_at: startedAt,
      completedAt,
      completed_at: completedAt,
      durationMs,
      duration_ms: durationMs,
      exitCode: exit,
      exit_code: exit,
      visibleOutputChars: output.length,
      visible_output_chars: output.length,
      visibleOutput,
      visible_output: visibleOutput,
      visibleOutputTruncated: output.length > visibleOutput.length,
      visible_output_truncated: output.length > visibleOutput.length,
      visibleOutputPreview: output ? output.slice(0, 240) : undefined,
      visible_output_preview: output ? output.slice(0, 240) : undefined,
      rawOutputRef,
      raw_output_ref: rawOutputRef,
      error: input.error,
      attachments: input.attachments ?? 0,
      providerExecuted: input.providerExecuted === true || metadata.providerExecuted === true,
      providerExecution: providerExecution(metadata),
      provider_execution: providerExecution(metadata),
      fileMutations: fileMutations(metadata),
      metadataKeys: Object.keys(metadata).sort(),
      source: input.source,
    }
  }

  export function attach(metadata: JsonRecord | undefined, result: ToolResultSettlement) {
    return {
      ...(metadata ?? {}),
      toolResult: result,
    }
  }

  export function emit(result: ToolResultSettlement) {
    return AialraTurnTrace.emit({
      phase: "tool.result.settled",
      turnID: result.turnID as MessageID | undefined,
      sessionID: result.sessionID as SessionID,
      messageID: result.messageID as MessageID | undefined,
      data: result,
    }).pipe(Effect.andThen(() => {
      const diff = TurnDiffStore.update(result)
      if (!diff) return Effect.void
      return TurnDiffStore.emit(diff)
    }))
  }

  export function resultID(toolCallID: string) {
    return `tool_result_${toolCallID.replace(/[^a-zA-Z0-9._-]/g, "_")}`
  }
}

function visible(output: string) {
  if (output.length <= 4_000) return output
  return `${output.slice(0, 4_000)}\n[visible output truncated; full output is available through raw_output_ref]`
}

function environmentID(metadata: JsonRecord) {
  const value = metadata.environmentID ?? metadata.environment_id
  return typeof value === "string" ? value : undefined
}

function exitCode(metadata: JsonRecord) {
  const value = metadata.exitCode ?? metadata.exit_code ?? metadata.exit
  if (typeof value === "number") return value
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value)
  return undefined
}

function fileMutations(metadata: JsonRecord) {
  const direct = metadata.fileMutations ?? metadata.file_mutations
  if (Array.isArray(direct)) return direct.filter(isRecord)
  const files = metadata.files
  if (Array.isArray(files)) return files.map((file) => (isRecord(file) ? file : { path: String(file) }))
  const pathValue = metadata.path ?? metadata.filePath ?? metadata.target
  if (typeof pathValue === "string") return [{ path: pathValue }]
  return []
}

function providerExecution(metadata: JsonRecord) {
  const value = metadata.providerExecution ?? metadata.provider_execution
  return isRecord(value) && value.schema === "aialra.provider_execution.v1"
    ? (value as ProviderExecutionMetadata)
    : undefined
}

export * as ToolResultProtocol from "./tool-result-settlement"

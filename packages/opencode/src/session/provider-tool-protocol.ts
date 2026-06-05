import { isRecord } from "@/util/record"

type JsonRecord = Record<string, unknown>

export type ProviderToolType =
  | "web_search"
  | "file_search"
  | "code_interpreter"
  | "hosted_retrieval"
  | "provider_function"
  | "unknown_hosted"

export type ProviderToolKind = "provider_tool_call" | "provider_tool_result"

export type ProviderExecutionMetadata = {
  schema: "aialra.provider_execution.v1"
  executor_type: "provider"
  provider_tool_type: ProviderToolType
  provider_tool_kind: ProviderToolKind
  hosted: true
  tool_call_id: string
  tool: string
  status?: "called" | "completed" | "failed" | "aborted"
  provider_metadata_keys: string[]
  provider_metadata_sources: string[]
  raw_output_ref?: JsonRecord
  output_chars?: number
  visible_output_truncated?: boolean
  output_store_supported: boolean
  replay_supported: boolean
  audit_supported: boolean
  support_scope: string[]
  support_gaps: string[]
  source: "llm_stream"
}

export namespace ProviderTool {
  export function execution(input: {
    toolCallID: string
    tool: string
    kind: ProviderToolKind
    status?: ProviderExecutionMetadata["status"]
    providerMetadata?: unknown
    rawOutputRef?: JsonRecord
    outputChars?: number
    visibleOutputTruncated?: boolean
  }): ProviderExecutionMetadata {
    const metadata = isRecord(input.providerMetadata) ? input.providerMetadata : {}
    const type = classify(input.tool, metadata)
    return {
      schema: "aialra.provider_execution.v1",
      executor_type: "provider",
      provider_tool_type: type,
      provider_tool_kind: input.kind,
      hosted: true,
      tool_call_id: input.toolCallID,
      tool: input.tool,
      status: input.status,
      provider_metadata_keys: Object.keys(metadata).sort(),
      provider_metadata_sources: metadataSources(metadata),
      raw_output_ref: input.rawOutputRef,
      output_chars: input.outputChars,
      visible_output_truncated: input.visibleOutputTruncated,
      output_store_supported: Boolean(input.rawOutputRef),
      replay_supported: true,
      audit_supported: true,
      support_scope: supportScope(type),
      support_gaps: supportGaps(type),
      source: "llm_stream",
    }
  }

  export function attach(metadata: JsonRecord | undefined, execution: ProviderExecutionMetadata) {
    return {
      ...(metadata ?? {}),
      providerExecuted: true,
      providerExecution: execution,
      provider_tool_type: execution.provider_tool_type,
      provider_tool_kind: execution.provider_tool_kind,
      executor_type: "provider",
    }
  }

  export function classify(tool: string, providerMetadata?: unknown): ProviderToolType {
    const haystack = [tool, ...metadataHints(providerMetadata)].join(" ").toLowerCase()
    if (haystack.includes("code_interpreter") || haystack.includes("code-interpreter")) return "code_interpreter"
    if (haystack.includes("python") || haystack.includes("sandboxed_code") || haystack.includes("container")) {
      return "code_interpreter"
    }
    if (haystack.includes("web_search") || haystack.includes("web-search") || haystack.includes("web.search")) {
      return "web_search"
    }
    if (haystack.includes("browser_search") || haystack.includes("search_preview") || haystack === "search") {
      return "web_search"
    }
    if (haystack.includes("file_search") || haystack.includes("file-search") || haystack.includes("file.search")) {
      return "file_search"
    }
    if (haystack.includes("retrieval") || haystack.includes("vector_store")) return "hosted_retrieval"
    if (haystack.includes("function") || haystack.includes("tool_call")) return "provider_function"
    return "unknown_hosted"
  }
}

function metadataHints(value: unknown): string[] {
  if (!isRecord(value)) return []
  return Object.entries(value).flatMap(([key, item]) => {
    if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return [key, String(item)]
    if (Array.isArray(item)) return [key, ...item.flatMap(metadataHints).slice(0, 20)]
    if (isRecord(item)) return [key, ...metadataHints(item)]
    return [key]
  })
}

function metadataSources(metadata: JsonRecord) {
  return Object.keys(metadata).sort()
}

function supportScope(type: ProviderToolType) {
  if (type === "unknown_hosted") {
    return ["unified_tool_item", "tool_result_settlement", "raw_output_ref", "history_replay", "public_event"]
  }
  return [
    "unified_tool_item",
    "tool_result_settlement",
    "raw_output_ref",
    "history_replay",
    "public_event",
    type,
  ]
}

function supportGaps(type: ProviderToolType) {
  if (type === "unknown_hosted") {
    return ["provider specific semantics are preserved as raw metadata but not normalized yet"]
  }
  return ["provider executes the tool remotely; local sandbox/cwd gates are audited but do not execute the hosted operation"]
}

export * as ProviderToolProtocol from "./provider-tool-protocol"

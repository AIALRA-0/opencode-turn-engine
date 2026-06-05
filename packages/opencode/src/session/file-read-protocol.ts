import { isRecord } from "@/util/record"

type JsonRecord = Record<string, unknown>

export type FileReadKind = "file" | "directory" | "image" | "pdf"

export type FileReadMetadata = {
  schema: "aialra.file_read.v1"
  tool: "read" | "glob" | "grep"
  status: "completed"
  kind: FileReadKind
  session_id?: string
  turn_id?: string
  message_id?: string
  call_id?: string
  environment_id: string
  environment_cwd: string
  requested_path: string
  resolved_path: string
  canonical_path?: string
  read_range: {
    offset: number
    limit: number
    start?: number
    end?: number
    total?: number
  }
  truncation: {
    truncated: boolean
    reason?: "line_limit" | "byte_limit" | "entry_limit" | "tool_truncate"
  }
  permission_decision: {
    status: "allowed"
    source: "turn_context"
    active_permission_profile?: unknown
    sandbox_policy?: unknown
    approval_policy?: unknown
  }
  output_chars: number
  preview?: string
  loaded_files: string[]
  raw_ref?: JsonRecord
}

export namespace FileRead {
  export function withRawRef(metadata: JsonRecord) {
    if (!isRecord(metadata.fileRead)) return metadata
    const outputRef = isRecord(metadata.outputRef) ? metadata.outputRef : undefined
    if (!outputRef) return metadata
    return {
      ...metadata,
      fileRead: {
        ...metadata.fileRead,
        raw_ref: outputRef,
      },
    }
  }
}

export * as FileReadProtocol from "./file-read-protocol"

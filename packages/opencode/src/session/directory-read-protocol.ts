import { isRecord } from "@/util/record"

type JsonRecord = Record<string, unknown>

export type DirectoryReadEntry = {
  name: string
  display_name: string
  relative_path: string
  type: "file" | "directory" | "symlink" | "other"
  hidden: boolean
  protected: boolean
  symlink: boolean
  symlink_escape?: boolean
  refused?: boolean
  refusal_reason?: "protected_recursive_list_denied"
}

export type DirectoryReadMetadata = {
  schema: "aialra.directory_read.v1"
  tool: "read"
  status: "completed"
  session_id?: string
  turn_id?: string
  message_id?: string
  call_id?: string
  environment_id: string
  environment_cwd: string
  requested_path: string
  resolved_path: string
  canonical_path?: string
  listing: {
    offset: number
    limit: number
    start?: number
    end?: number
    total: number
    returned: number
    hidden_policy: "include" | "exclude"
    hidden_count: number
    protected_count: number
    symlink_count: number
    symlink_escape_count: number
    recursive_depth: number
    effective_recursive_depth: number
    sort: "name" | "type_name"
    max_entries: number
  }
  truncation: {
    truncated: boolean
    reason?: "entry_limit" | "collection_limit"
  }
  permission_decision: {
    status: "allowed"
    source: "turn_context"
    active_permission_profile?: unknown
    sandbox_policy?: unknown
    approval_policy?: unknown
  }
  entries: DirectoryReadEntry[]
  preview?: string
  raw_ref?: JsonRecord
}

export namespace DirectoryRead {
  export function withRawRef(metadata: JsonRecord) {
    if (!isRecord(metadata.directoryRead)) return metadata
    const outputRef = isRecord(metadata.outputRef) ? metadata.outputRef : undefined
    if (!outputRef) return metadata
    return {
      ...metadata,
      directoryRead: {
        ...metadata.directoryRead,
        raw_ref: outputRef,
      },
    }
  }
}

export * as DirectoryReadProtocol from "./directory-read-protocol"

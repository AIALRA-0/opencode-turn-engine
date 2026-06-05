import { isRecord } from "@/util/record"

type JsonRecord = Record<string, unknown>

export type FileWriteState = {
  exists: boolean
  size?: number
  sha256?: string
  bom?: boolean
  mtime_ms?: number
}

export type FileMutation = {
  schema: "aialra.file_mutation.v1"
  mutation_id: string
  tool: "write" | "edit" | "apply_patch"
  operation: "create" | "overwrite" | "delete" | "move" | "preview"
  applied: boolean
  requested_path: string
  resolved_path: string
  environment_id: string
  before: FileWriteState
  after: FileWriteState
  desired?: FileWriteState
  diff: {
    chars_added: number
    chars_removed: number
    patch_chars: number
  }
}

export type FileWriteMetadata = {
  schema: "aialra.file_write.v1"
  tool: "write" | "edit" | "apply_patch"
  status: "completed" | "preview"
  session_id?: string
  turn_id?: string
  message_id?: string
  call_id?: string
  environment_id: string
  environment_cwd: string
  requested_path: string
  resolved_path: string
  policy: {
    overwrite: "allow" | "deny" | "if_absent"
    dry_run: boolean
    encoding: "utf-8"
    preserves_bom: boolean
    atomic: boolean
    atomic_reason?: "codex_fs_rename_api_unavailable"
  }
  permission_decision: {
    status: "allowed"
    source: "turn_context"
    active_permission_profile?: unknown
    sandbox_policy?: unknown
    approval_policy?: unknown
  }
  before: FileWriteState
  after: FileWriteState
  desired?: FileWriteState
  edit_intent?: {
    old_snippet: string
    new_snippet: string
    replace_all: boolean
    applied_range?: {
      start: number
      end: number
    }
    conflict_reason?: "not_found" | "multiple_matches" | "same_content"
  }
  patch_intent?: {
    patch_chars: number
    hunk_count: number
    affected_files: Array<{
      requested_path: string
      resolved_path: string
      operation: FileMutation["operation"]
      move_path?: string
      additions: number
      deletions: number
      applied: boolean
      hunk_status: "applied"
    }>
  }
  mutation: FileMutation
  raw_ref?: JsonRecord
}

export namespace FileWrite {
  export function withRawRef(metadata: JsonRecord) {
    if (!isRecord(metadata.fileWrite)) return metadata
    const outputRef = isRecord(metadata.outputRef) ? metadata.outputRef : undefined
    if (!outputRef) return metadata
    return {
      ...metadata,
      fileWrite: {
        ...metadata.fileWrite,
        raw_ref: outputRef,
      },
    }
  }
}

export * as FileWriteProtocol from "./file-write-protocol"

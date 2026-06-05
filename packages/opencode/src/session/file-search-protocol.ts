import { isRecord } from "@/util/record"

type JsonRecord = Record<string, unknown>

export type FileSearchResult = {
  path: string
  relative_path: string
  mtime_ms?: number
}

export type FileSearchMetadata = {
  schema: "aialra.file_search.v1"
  tool: "glob" | "grep"
  status: "completed"
  session_id?: string
  turn_id?: string
  message_id?: string
  call_id?: string
  environment_id: string
  environment_cwd: string
  requested_pattern: string
  requested_path?: string
  search_cwd: string
  backend: {
    name: "ripgrep_files" | "ripgrep_search" | "codex_exec_server"
    fallback_reason?: string
  }
  limits: {
    max_results: number
    max_scan: number
    timeout_ms?: number
    max_path_chars: number
  }
  filters: {
    show_hidden: boolean
    follow_symlinks: boolean
    protected_policy: "hide" | "show_refused"
    ignore: string[]
  }
  counts: {
    scanned: number
    returned: number
    matched_files?: number
    hidden_filtered: number
    protected_filtered: number
    path_too_long_filtered: number
    sandbox_filtered: number
    other_filtered: number
  }
  grep?: {
    include?: string
    total_matches: number
    returned_matches: number
    context_lines: number
    max_line_chars: number
    partial: boolean
  }
  truncation: {
    truncated: boolean
    reason?: "result_limit" | "scan_limit"
  }
  results: FileSearchResult[]
  raw_ref?: JsonRecord
}

export namespace FileSearch {
  export function withRawRef(metadata: JsonRecord) {
    if (!isRecord(metadata.fileSearch)) return metadata
    const outputRef = isRecord(metadata.outputRef) ? metadata.outputRef : undefined
    if (!outputRef) return metadata
    return {
      ...metadata,
      fileSearch: {
        ...metadata.fileSearch,
        raw_ref: outputRef,
      },
    }
  }
}

export * as FileSearchProtocol from "./file-search-protocol"

import path from "path"
import { Schema } from "effect"
import { Effect, Exit, Option } from "effect"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./grep.txt"
import * as Tool from "./tool"
import { Reference } from "@/reference/reference"
import { TurnSandbox } from "./turn-sandbox"
import { CodexFs } from "./codex-fs"
import { AialraTurnTrace } from "@/session/turn-trace"
import { CodexTurn } from "@/session/turn-context"
import type { FileSearchMetadata, FileSearchResult } from "@/session/file-search-protocol"

const MAX_LINE_LENGTH = 2000
const DEFAULT_MATCHES = 100
const MAX_MATCHES = 10_000
const MAX_PATH_CHARS = 4096
const PROTECTED_NAMES = new Set([".git", ".agents", ".codex"])

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The regex pattern to search for in file contents" }),
  path: Schema.optional(Schema.String).annotate({
    description: "The directory to search in. Defaults to the current working directory.",
  }),
  include: Schema.optional(Schema.String).annotate({
    description: 'File pattern to include in the search (e.g. "*.js", "*.{ts,tsx}")',
  }),
  maxMatches: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of matches to return. Defaults to 100 and is capped at 10000.",
  }),
  contextLines: Schema.optional(Schema.Number).annotate({
    description: "Number of surrounding context lines to show around each match. Defaults to 0.",
  }),
  showHidden: Schema.optional(Schema.Boolean).annotate({
    description: "Whether hidden dotfiles are included. Defaults to true for backwards compatibility.",
  }),
  ignore: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional glob patterns to exclude from the search.",
  }),
  timeoutMs: Schema.optional(Schema.Number).annotate({
    description: "Optional ripgrep timeout in milliseconds.",
  }),
  followSymlinks: Schema.optional(Schema.Boolean).annotate({
    description: "Follow symlinks while searching. Defaults to false.",
  }),
  protectedPolicy: Schema.optional(Schema.Union([Schema.Literal("hide"), Schema.Literal("show_refused")])).annotate({
    description: "How protected metadata paths such as .git, .agents, and .codex are handled. Defaults to hide.",
  }),
  maxLineChars: Schema.optional(Schema.Number).annotate({
    description: "Maximum characters shown for each matched line. Defaults to 2000.",
  }),
})

function positiveInt(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value ?? NaN)) return fallback
  return Math.max(0, Math.min(max, Math.floor(value!)))
}

function relative(cwd: string, file: string) {
  return path.relative(cwd, file).replaceAll("\\", "/")
}

function segments(relativePath: string) {
  return relativePath.split("/").filter(Boolean)
}

function hidden(relativePath: string) {
  return segments(relativePath).some((part) => part.startsWith("."))
}

function protectedPath(relativePath: string) {
  return segments(relativePath).some((part) => PROTECTED_NAMES.has(part))
}

function searchSignal(ctx: Tool.Context, timeoutMs?: number) {
  if (!timeoutMs || timeoutMs <= 0) return ctx.abort
  return AbortSignal.any([ctx.abort, AbortSignal.timeout(timeoutMs)])
}

function trimLine(text: string, limit: number) {
  return text.length > limit ? `${text.substring(0, limit)}...` : text
}

export const GrepTool = Tool.define(
  "grep",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const rg = yield* Ripgrep.Service
    const reference = yield* Reference.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.pattern) {
            throw new Error("pattern is required")
          }
          const maxMatches = positiveInt(params.maxMatches, DEFAULT_MATCHES, MAX_MATCHES)
          const contextLines = positiveInt(params.contextLines, 0, 20)
          const maxLineChars = positiveInt(params.maxLineChars, MAX_LINE_LENGTH, 20_000)
          const showHidden = params.showHidden !== false
          const ignore = [...(params.ignore ?? [])]
          const protectedPolicy = params.protectedPolicy ?? "hide"

          yield* ctx.ask({
            permission: "grep",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
              include: params.include,
            },
          })

          const ins = yield* InstanceState.context
          const requested = TurnSandbox.resolvePath(ctx, params.path ?? ".", ins.directory)
          yield* TurnSandbox.assertFileAccess(ctx, "read", requested)
          yield* TurnSandbox.assertSearchScope(ctx, requested)
          yield* reference.ensure(requested)
          const requestedInfo = yield* CodexFs.stat(ctx, fs, requested).pipe(Effect.catch(() => Effect.succeed(undefined)))
          yield* assertExternalDirectoryEffect(ctx, requested, {
            bypass: yield* reference.contains(requested),
            kind: requestedInfo?.type === "Directory" ? "directory" : "file",
          })
          yield* AialraTurnTrace.emit({
            phase: "exec_server.fallback",
            turnID: ctx.turn?.turnID,
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            data: {
              method: "fs/search",
              tool: "grep",
              reason: "Codex exec-server has no fs/grep API; using TurnContext-gated ripgrep adapter",
              search: requested,
              pattern: params.pattern,
              include: params.include,
            },
          }).pipe(Effect.ignore)

          const search = AppFileSystem.resolve(requested)
          const info = yield* CodexFs.stat(ctx, fs, search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          const cwd = info?.type === "Directory" ? search : path.dirname(search)
          const file = info?.type === "Directory" ? undefined : [path.relative(cwd, search)]

          const result = yield* rg.search({
            cwd,
            pattern: params.pattern,
            glob: params.include ? [params.include] : undefined,
            hidden: showHidden,
            ignore,
            follow: params.followSymlinks === true,
            file,
            signal: searchSignal(ctx, params.timeoutMs),
          })

          const rows = result.items.map((item) => ({
            path: AppFileSystem.resolve(
              path.isAbsolute(item.path.text) ? item.path.text : path.join(cwd, item.path.text),
            ),
            line: item.line_number,
            text: item.lines.text,
          }))
          const filterCounts = {
            hidden_filtered: 0,
            protected_filtered: 0,
            path_too_long_filtered: 0,
            sandbox_filtered: 0,
            other_filtered: 0,
          }
          const filtered: Array<(typeof rows)[number]> = []
          for (const row of rows) {
            const rel = relative(cwd, row.path)
            if (row.path.length > MAX_PATH_CHARS) {
              filterCounts.path_too_long_filtered++
              continue
            }
            if (!showHidden && hidden(rel)) {
              filterCounts.hidden_filtered++
              continue
            }
            if (protectedPolicy === "hide" && protectedPath(rel)) {
              filterCounts.protected_filtered++
              continue
            }
            const access = yield* Effect.exit(TurnSandbox.assertFileAccess(ctx, "read", row.path))
            if (Exit.isFailure(access)) {
              filterCounts.sandbox_filtered++
              continue
            }
            filtered.push(row)
          }
          const times = new Map(
            (yield* Effect.forEach(
              [...new Set(filtered.map((row) => row.path))],
              Effect.fnUntraced(function* (file) {
                const info = yield* CodexFs.stat(ctx, fs, file).pipe(Effect.catch(() => Effect.succeed(undefined)))
                if (!info || info.type === "Directory") return undefined
                return [
                  file,
                  info.mtime.pipe(
                    Option.map((time) => time.getTime()),
                    Option.getOrElse(() => 0),
                  ) ?? 0,
                ] as const
              }),
              { concurrency: 16 },
            )).filter((entry): entry is readonly [string, number] => Boolean(entry)),
          )
          const matches = filtered.flatMap((row) => {
            const mtime = times.get(row.path)
            if (mtime === undefined) {
              filterCounts.other_filtered++
              return []
            }
            return [{ ...row, mtime }]
          })

          matches.sort((a, b) => b.mtime - a.mtime || a.path.localeCompare(b.path) || a.line - b.line)

          const truncated = matches.length > maxMatches
          const final = truncated ? matches.slice(0, maxMatches) : matches

          const total = matches.length
          const output = final.length === 0 ? ["No files found"] : [`Found ${total} matches${truncated ? ` (showing first ${maxMatches})` : ""}`]

          const contentCache = new Map<string, string[]>()
          const linesFor = Effect.fnUntraced(function* (file: string) {
            const hit = contentCache.get(file)
            if (hit) return hit
            const source = yield* CodexFs.readBomFile(ctx, fs, file).pipe(
              Effect.map((item) => item.text.split(/\r?\n/)),
              Effect.catch(() => Effect.succeed([])),
            )
            contentCache.set(file, source)
            return source
          })
          let current = ""
          for (const match of final) {
            if (current !== match.path) {
              if (current !== "") output.push("")
              current = match.path
              output.push(`${match.path}:`)
            }
            if (contextLines > 0) {
              const lines = yield* linesFor(match.path)
              const start = Math.max(1, match.line - contextLines)
              const end = Math.min(lines.length, match.line + contextLines)
              for (let line = start; line <= end; line++) {
                if (line === match.line) continue
                output.push(`  Context ${line}: ${trimLine(lines[line - 1] ?? "", maxLineChars)}`)
              }
            }
            output.push(`  Line ${match.line}: ${trimLine(match.text, maxLineChars)}`)
          }

          if (truncated) {
            output.push("")
            output.push(
              `(Results truncated: showing ${maxMatches} of ${total} matches (${total - maxMatches} hidden). Consider using a more specific path or pattern.)`,
            )
          }

          if (result.partial) {
            output.push("")
            output.push("(Some paths were inaccessible and skipped)")
          }
          const environment = ctx.turn?.environments.find((item) => item.environmentID === ctx.turn?.selected_environment_id)
          const results: FileSearchResult[] = [...new Map(final.map((match) => [match.path, match])).values()].map((match) => ({
            path: match.path,
            relative_path: relative(cwd, match.path),
            mtime_ms: match.mtime,
          }))
          const fileSearch: FileSearchMetadata = {
            schema: "aialra.file_search.v1",
            tool: "grep",
            status: "completed",
            session_id: String(ctx.sessionID),
            turn_id: ctx.turn?.turnID ? String(ctx.turn.turnID) : undefined,
            message_id: String(ctx.messageID),
            call_id: ctx.callID,
            environment_id: ctx.turn?.selected_environment_id ?? "legacy",
            environment_cwd: environment?.cwd ?? (ctx.turn ? CodexTurn.environmentCwd(ctx.turn) : ins.directory),
            requested_pattern: params.pattern,
            requested_path: params.path,
            search_cwd: cwd,
            backend: {
              name: "ripgrep_search",
              fallback_reason: "Codex exec-server has no fs/grep API; using TurnContext-gated ripgrep adapter",
            },
            limits: {
              max_results: maxMatches,
              max_scan: result.items.length,
              timeout_ms: params.timeoutMs,
              max_path_chars: MAX_PATH_CHARS,
            },
            filters: {
              show_hidden: showHidden,
              follow_symlinks: params.followSymlinks === true,
              protected_policy: protectedPolicy,
              ignore,
            },
            counts: {
              scanned: result.items.length,
              returned: final.length,
              matched_files: results.length,
              ...filterCounts,
            },
            grep: {
              include: params.include,
              total_matches: total,
              returned_matches: final.length,
              context_lines: contextLines,
              max_line_chars: maxLineChars,
              partial: result.partial,
            },
            truncation: {
              truncated,
              reason: truncated ? "result_limit" : undefined,
            },
            results,
          }

          return {
            title: params.pattern,
            metadata: {
              matches: total,
              truncated,
              fileSearch,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

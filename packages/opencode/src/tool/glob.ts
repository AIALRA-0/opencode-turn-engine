import path from "path"
import { Effect, Exit, Option, Schema } from "effect"
import * as Stream from "effect/Stream"
import { InstanceState } from "@/effect/instance-state"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Ripgrep } from "../file/ripgrep"
import { assertExternalDirectoryEffect } from "./external-directory"
import DESCRIPTION from "./glob.txt"
import * as Tool from "./tool"
import { Reference } from "@/reference/reference"
import { TurnSandbox } from "./turn-sandbox"
import { CodexFs } from "./codex-fs"
import { AialraTurnTrace } from "@/session/turn-trace"
import { CodexTurn } from "@/session/turn-context"
import type { FileSearchMetadata, FileSearchResult } from "@/session/file-search-protocol"

export const Parameters = Schema.Struct({
  pattern: Schema.String.annotate({ description: "The glob pattern to match files against" }),
  path: Schema.optional(Schema.String).annotate({
    description: `The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.`,
  }),
  maxResults: Schema.optional(Schema.Number).annotate({
    description: "Maximum number of results to return. Defaults to 100 and is capped at 10000.",
  }),
  showHidden: Schema.optional(Schema.Boolean).annotate({
    description: "Whether hidden dotfiles are included. Defaults to true for backwards compatibility.",
  }),
  ignore: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Additional glob patterns to exclude from the result set.",
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
})

const MAX_RESULTS = 10_000
const DEFAULT_RESULTS = 100
const MAX_PATH_CHARS = 4096
const PROTECTED_NAMES = new Set([".git", ".agents", ".codex"])

function positiveInt(value: number | undefined, fallback: number, max: number) {
  if (!Number.isFinite(value ?? NaN)) return fallback
  return Math.max(1, Math.min(max, Math.floor(value!)))
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

export const GlobTool = Tool.define(
  "glob",
  Effect.gen(function* () {
    const rg = yield* Ripgrep.Service
    const fs = yield* AppFileSystem.Service
    const reference = yield* Reference.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ins = yield* InstanceState.context
          const maxResults = positiveInt(params.maxResults, DEFAULT_RESULTS, MAX_RESULTS)
          const maxScan = Math.min(MAX_RESULTS, Math.max(maxResults + 1, maxResults * 5))
          const showHidden = params.showHidden !== false
          const ignore = [...(params.ignore ?? [])]
          const protectedPolicy = params.protectedPolicy ?? "hide"
          yield* ctx.ask({
            permission: "glob",
            patterns: [params.pattern],
            always: ["*"],
            metadata: {
              pattern: params.pattern,
              path: params.path,
            },
          })

          const search = TurnSandbox.resolvePath(ctx, params.path ?? ".", ins.directory)
          yield* TurnSandbox.assertFileAccess(ctx, "read", search)
          yield* TurnSandbox.assertSearchScope(ctx, search)
          yield* reference.ensure(search)
          const info = yield* CodexFs.stat(ctx, fs, search).pipe(Effect.catch(() => Effect.succeed(undefined)))
          if (info?.type === "File") {
            throw new Error(`glob path must be a directory: ${search}`)
          }
          yield* assertExternalDirectoryEffect(ctx, search, {
            bypass: yield* reference.contains(search),
            kind: "directory",
          })
          yield* AialraTurnTrace.emit({
            phase: "exec_server.fallback",
            turnID: ctx.turn?.turnID,
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            data: {
              method: "fs/search",
              tool: "glob",
              reason: "Codex exec-server has no fs/glob API; using TurnContext-gated ripgrep adapter",
              search,
              pattern: params.pattern,
            },
          }).pipe(Effect.ignore)

          const scanLimit = maxScan
          const candidates = yield* rg.files({
            cwd: search,
            glob: [params.pattern, ...ignore.map((item) => (item.startsWith("!") ? item : `!${item}`))],
            hidden: showHidden,
            follow: params.followSymlinks === true,
            signal: searchSignal(ctx, params.timeoutMs),
          }).pipe(
            Stream.mapEffect((file) =>
              Effect.gen(function* () {
                const full = path.resolve(search, file)
                const info = yield* CodexFs.stat(ctx, fs, full).pipe(Effect.catch(() => Effect.succeed(undefined)))
                const mtime =
                  info?.mtime.pipe(
                    Option.map((date) => date.getTime()),
                    Option.getOrElse(() => 0),
                  ) ?? 0
                return { path: full, mtime }
              }),
            ),
            Stream.take(scanLimit + 1),
            Stream.runCollect,
            Effect.map((chunk) => [...chunk]),
          )

          const filterCounts = {
            hidden_filtered: 0,
            protected_filtered: 0,
            path_too_long_filtered: 0,
            sandbox_filtered: 0,
            other_filtered: 0,
          }
          const accepted: Array<{ path: string; mtime: number }> = []
          const sorted = candidates.toSorted((a, b) => b.mtime - a.mtime)
          for (const file of sorted) {
            const rel = relative(search, file.path)
            if (file.path.length > MAX_PATH_CHARS) {
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
            const access = yield* Effect.exit(TurnSandbox.assertFileAccess(ctx, "read", file.path))
            if (Exit.isFailure(access)) {
              filterCounts.sandbox_filtered++
              continue
            }
            accepted.push(file)
            if (accepted.length >= maxResults) break
          }
          const truncated = candidates.length > scanLimit || accepted.length >= maxResults

          const output = []
          if (accepted.length === 0) output.push("No files found")
          if (accepted.length > 0) {
            output.push(...accepted.map((file) => file.path))
            if (truncated) {
              output.push("")
              output.push(
                `(Results are truncated: showing first ${maxResults} results. Consider using a more specific path or pattern.)`,
              )
            }
          }

          const environment = ctx.turn?.environments.find((item) => item.environmentID === ctx.turn?.selected_environment_id)
          const results: FileSearchResult[] = accepted.map((file) => ({
            path: file.path,
            relative_path: relative(search, file.path),
            mtime_ms: file.mtime,
          }))
          const fileSearch: FileSearchMetadata = {
            schema: "aialra.file_search.v1",
            tool: "glob",
            status: "completed",
            session_id: String(ctx.sessionID),
            turn_id: ctx.turn?.turnID ? String(ctx.turn.turnID) : undefined,
            message_id: String(ctx.messageID),
            call_id: ctx.callID,
            environment_id: ctx.turn?.selected_environment_id ?? "legacy",
            environment_cwd: environment?.cwd ?? (ctx.turn ? CodexTurn.environmentCwd(ctx.turn) : ins.directory),
            requested_pattern: params.pattern,
            requested_path: params.path,
            search_cwd: search,
            backend: {
              name: "ripgrep_files",
              fallback_reason: "Codex exec-server has no fs/glob API; using TurnContext-gated ripgrep adapter",
            },
            limits: {
              max_results: maxResults,
              max_scan: scanLimit,
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
              scanned: candidates.length,
              returned: results.length,
              ...filterCounts,
            },
            truncation: {
              truncated,
              reason: truncated ? (candidates.length > scanLimit ? "scan_limit" : "result_limit") : undefined,
            },
            results,
          }

          return {
            title: path.relative(ins.worktree, search),
            metadata: {
              count: accepted.length,
              truncated,
              fileSearch,
            },
            output: output.join("\n"),
          }
        }).pipe(Effect.orDie),
    }
  }),
)

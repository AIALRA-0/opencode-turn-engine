import { Effect, Schema, Scope } from "effect"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { realpath } from "node:fs/promises"
import * as path from "path"
import * as Tool from "./tool"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { LSP } from "@/lsp/lsp"
import DESCRIPTION from "./read.txt"
import { InstanceState } from "@/effect/instance-state"
import { assertExternalDirectoryEffect } from "./external-directory"
import { TurnSandbox } from "./turn-sandbox"
import { Instruction } from "../session/instruction"
import { isPdfAttachment, sniffAttachmentMime } from "@/util/media"
import { Reference } from "@/reference/reference"
import { CodexFs } from "./codex-fs"
import type { FileReadMetadata } from "@/session/file-read-protocol"
import type { DirectoryReadEntry, DirectoryReadMetadata } from "@/session/directory-read-protocol"
import { CodexTurn } from "@/session/turn-context"

const DEFAULT_READ_LIMIT = 2000
const MAX_LINE_LENGTH = 2000
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`
const MAX_BYTES = 50 * 1024
const MAX_BYTES_LABEL = `${MAX_BYTES / 1024} KB`
const SAMPLE_BYTES = 4096
const MAX_DIRECTORY_ENTRIES = 10_000
const MAX_RECURSIVE_DEPTH = 3
const SUPPORTED_IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"])

class ReadStop extends Schema.TaggedErrorClass<ReadStop>()("ReadStop", {}) {}

// `offset` and `limit` were originally `z.coerce.number()` — the runtime
// coercion was useful when the tool was called from a shell but serves no
// purpose in the LLM tool-call path (the model emits typed JSON). The JSON
// Schema output is identical (`type: "number"`), so the LLM view is
// unchanged; purely CLI-facing uses must now send numbers rather than strings.
export const Parameters = Schema.Struct({
  filePath: Schema.String.annotate({ description: "The absolute path to the file or directory to read" }),
  offset: Schema.optional(NonNegativeInt).annotate({
    description: "The line number to start reading from (1-indexed)",
  }),
  limit: Schema.optional(NonNegativeInt).annotate({
    description: "The maximum number of lines to read (defaults to 2000)",
  }),
  showHidden: Schema.optional(Schema.Boolean).annotate({
    description: "When reading a directory, include hidden dot entries. Defaults to true.",
  }),
  recursiveDepth: Schema.optional(NonNegativeInt).annotate({
    description: "When reading a directory, recursively include child directories up to this depth. Defaults to 0.",
  }),
  sort: Schema.optional(Schema.Union([Schema.Literal("name"), Schema.Literal("type_name")])).annotate({
    description: "When reading a directory, sort entries by name or by type then name. Defaults to name.",
  }),
})

export const ReadTool = Tool.define(
  "read",
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service
    const instruction = yield* Instruction.Service
    const lsp = yield* LSP.Service
    const reference = yield* Reference.Service
    const scope = yield* Scope.Scope

    const miss = Effect.fn("ReadTool.miss")(function* (filepath: string, ctx: Tool.Context) {
      const dir = path.dirname(filepath)
      const base = path.basename(filepath)
      const items = yield* CodexFs.readDirectory(ctx, fs, dir).pipe(
        Effect.map((items) =>
          items
            .filter(
              (item) =>
                item.toLowerCase().includes(base.toLowerCase()) || base.toLowerCase().includes(item.toLowerCase()),
            )
            .map((item) => path.join(dir, item))
            .slice(0, 3),
        ),
        Effect.catch(() => Effect.succeed([] as string[])),
      )

      if (items.length > 0) {
        return yield* Effect.fail(
          new Error(`File not found: ${filepath}\n\nDid you mean one of these?\n${items.join("\n")}`),
        )
      }

      return yield* Effect.fail(new Error(`File not found: ${filepath}`))
    })

    const warm = Effect.fn("ReadTool.warm")(function* (filepath: string) {
      yield* lsp.touchFile(filepath).pipe(Effect.ignore, Effect.forkIn(scope))
    })

    const lines = (bytes: Uint8Array, opts: { limit: number; offset: number }) => {
      const start = opts.offset - 1
      const raw: string[] = []
      const flags = { bytes: 0, count: 0, cut: false, more: false, done: false }
      const text = new TextDecoder("utf-8").decode(bytes)

      for (const textLine of text === "" ? [] : text.split(/\r?\n/)) {
        if (flags.done) break
        flags.count += 1
        if (flags.count <= start) continue

        if (raw.length >= opts.limit) {
          flags.more = true
          continue
        }

        const line = textLine.length > MAX_LINE_LENGTH ? textLine.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX : textLine
        const size = Buffer.byteLength(line, "utf-8") + (raw.length > 0 ? 1 : 0)
        if (flags.bytes + size > MAX_BYTES) {
          flags.cut = true
          flags.more = true
          flags.done = true
          break
        }

        raw.push(line)
        flags.bytes += size
      }

      return { raw, count: flags.count, cut: flags.cut, more: flags.more, offset: opts.offset }
    }

    const isBinaryFile = (filepath: string, bytes: Uint8Array) => {
      const ext = path.extname(filepath).toLowerCase()
      switch (ext) {
        case ".zip":
        case ".tar":
        case ".gz":
        case ".exe":
        case ".dll":
        case ".so":
        case ".class":
        case ".jar":
        case ".war":
        case ".7z":
        case ".doc":
        case ".docx":
        case ".xls":
        case ".xlsx":
        case ".ppt":
        case ".pptx":
        case ".odt":
        case ".ods":
        case ".odp":
        case ".bin":
        case ".dat":
        case ".obj":
        case ".o":
        case ".a":
        case ".lib":
        case ".wasm":
        case ".pyc":
        case ".pyo":
          return true
      }

      if (bytes.length === 0) return false

      let nonPrintableCount = 0
      for (let i = 0; i < bytes.length; i++) {
        if (bytes[i] === 0) return true
        if (bytes[i] < 9 || (bytes[i] > 13 && bytes[i] < 32)) {
          nonPrintableCount++
        }
      }

      return nonPrintableCount / bytes.length > 0.3
    }

    const canonical = Effect.fn("ReadTool.canonical")(function* (filepath: string) {
      return yield* Effect.promise(() => realpath(filepath)).pipe(
        Effect.map((item) => path.resolve(item)),
        Effect.catch(() => Effect.succeed(path.resolve(filepath))),
      )
    })

    const inside = (root: string, target: string) => {
      const relative = path.relative(root, target)
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
    }

    const entryDetails = Effect.fn("ReadTool.entryDetails")(function* (input: {
      ctx: Tool.Context
      dir: string
      entry: AppFileSystem.DirEntry
      prefix: string
    }) {
      const full = path.join(input.dir, input.entry.name)
      const target = input.entry.type === "symlink" ? yield* canonical(full) : undefined
      const targetStat =
        input.entry.type === "symlink"
          ? yield* CodexFs.stat(input.ctx, fs, full).pipe(Effect.catch(() => Effect.void))
          : undefined
      const relativePath = input.prefix ? `${input.prefix}/${input.entry.name}` : input.entry.name
      const directory = input.entry.type === "directory" || targetStat?.type === "Directory"
      const details: DirectoryReadEntry = {
        name: input.entry.name,
        display_name: directory ? `${relativePath}/` : relativePath,
        relative_path: relativePath,
        type: input.entry.type,
        hidden: input.entry.name.startsWith("."),
        protected: input.ctx.turn ? Boolean(TurnSandbox.protectableMetadataPath(input.ctx.turn, full)) : false,
        symlink: input.entry.type === "symlink",
        symlink_escape: target && input.ctx.turn ? !inside(CodexTurn.environmentCwd(input.ctx.turn), target) : undefined,
      }
      return details
    })

    function directoryEntries(input: {
      ctx: Tool.Context
      dir: string
      prefix?: string
      depth: number
      showHidden: boolean
      entries: DirectoryReadEntry[]
    }): Effect.Effect<DirectoryReadEntry[]> {
      return Effect.gen(function* () {
        if (input.entries.length >= MAX_DIRECTORY_ENTRIES) return input.entries
        const raw = yield* CodexFs.readDirectoryEntries(input.ctx, fs, input.dir)
        const entries = yield* Effect.forEach(
          raw,
          (entry) => entryDetails({ ctx: input.ctx, dir: input.dir, entry, prefix: input.prefix ?? "" }),
          { concurrency: "unbounded" },
        )
        input.entries.push(...entries.slice(0, Math.max(0, MAX_DIRECTORY_ENTRIES - input.entries.length)))
        const visible = entries.filter((entry) => input.showHidden || !entry.hidden)

        if (input.depth <= 0 || input.entries.length >= MAX_DIRECTORY_ENTRIES) return input.entries

        for (const entry of visible) {
          if (entry.type !== "directory" || input.entries.length >= MAX_DIRECTORY_ENTRIES) continue
          if (entry.protected) {
            entry.refused = true
            entry.refusal_reason = "protected_recursive_list_denied"
            continue
          }
          yield* directoryEntries({
            ctx: input.ctx,
            dir: path.join(input.dir, entry.name),
            prefix: entry.relative_path,
            depth: input.depth - 1,
            showHidden: input.showHidden,
            entries: input.entries,
          })
        }
        return input.entries
      })
    }

    const sortDirectoryEntries = (entries: DirectoryReadEntry[], mode: "name" | "type_name") =>
      entries.sort((a, b) => {
        if (mode === "name") return a.display_name.localeCompare(b.display_name)
        const byType = a.type.localeCompare(b.type)
        if (byType !== 0) return byType
        return a.display_name.localeCompare(b.display_name)
      })

    const fileReadMetadata = (input: {
      ctx: Tool.Context
      requested: string
      filepath: string
      canonicalPath?: string
      kind: FileReadMetadata["kind"]
      offset: number
      limit: number
      start?: number
      end?: number
      total?: number
      truncated: boolean
      reason?: FileReadMetadata["truncation"]["reason"]
      output: string
      preview?: string
      loaded: string[]
    }): FileReadMetadata => {
      const environment = input.ctx.turn?.environments.find(
        (item) => item.environmentID === input.ctx.turn?.selected_environment_id,
      )
      return {
        schema: "aialra.file_read.v1",
        tool: "read",
        status: "completed",
        kind: input.kind,
        session_id: String(input.ctx.sessionID),
        turn_id: input.ctx.turn?.turnID ? String(input.ctx.turn.turnID) : undefined,
        message_id: String(input.ctx.messageID),
        call_id: input.ctx.callID,
        environment_id: input.ctx.turn?.selected_environment_id ?? "legacy",
        environment_cwd: environment?.cwd ?? input.ctx.turn?.cwd ?? path.dirname(input.filepath),
        requested_path: input.requested,
        resolved_path: input.filepath,
        canonical_path: input.canonicalPath && input.canonicalPath !== input.filepath ? input.canonicalPath : undefined,
        read_range: {
          offset: input.offset,
          limit: input.limit,
          start: input.start,
          end: input.end,
          total: input.total,
        },
        truncation: {
          truncated: input.truncated,
          reason: input.reason,
        },
        permission_decision: {
          status: "allowed",
          source: "turn_context",
          active_permission_profile: input.ctx.turn?.active_permission_profile,
          sandbox_policy: input.ctx.turn?.sandbox_policy,
          approval_policy: input.ctx.turn?.approval_policy,
        },
        output_chars: input.output.length,
        preview: input.preview,
        loaded_files: input.loaded,
      }
    }

    const directoryReadMetadata = (input: {
      ctx: Tool.Context
      requested: string
      filepath: string
      canonicalPath?: string
      offset: number
      limit: number
      start?: number
      end?: number
      total: number
      returned: number
      hiddenPolicy: "include" | "exclude"
      hiddenCount: number
      protectedCount: number
      symlinkCount: number
      symlinkEscapeCount: number
      recursiveDepth: number
      effectiveRecursiveDepth: number
      sort: "name" | "type_name"
      truncated: boolean
      reason?: DirectoryReadMetadata["truncation"]["reason"]
      entries: DirectoryReadEntry[]
      preview?: string
    }): DirectoryReadMetadata => {
      const environment = input.ctx.turn?.environments.find(
        (item) => item.environmentID === input.ctx.turn?.selected_environment_id,
      )
      return {
        schema: "aialra.directory_read.v1",
        tool: "read",
        status: "completed",
        session_id: String(input.ctx.sessionID),
        turn_id: input.ctx.turn?.turnID ? String(input.ctx.turn.turnID) : undefined,
        message_id: String(input.ctx.messageID),
        call_id: input.ctx.callID,
        environment_id: input.ctx.turn?.selected_environment_id ?? "legacy",
        environment_cwd: environment?.cwd ?? input.ctx.turn?.cwd ?? path.dirname(input.filepath),
        requested_path: input.requested,
        resolved_path: input.filepath,
        canonical_path: input.canonicalPath && input.canonicalPath !== input.filepath ? input.canonicalPath : undefined,
        listing: {
          offset: input.offset,
          limit: input.limit,
          start: input.start,
          end: input.end,
          total: input.total,
          returned: input.returned,
          hidden_policy: input.hiddenPolicy,
          hidden_count: input.hiddenCount,
          protected_count: input.protectedCount,
          symlink_count: input.symlinkCount,
          symlink_escape_count: input.symlinkEscapeCount,
          recursive_depth: input.recursiveDepth,
          effective_recursive_depth: input.effectiveRecursiveDepth,
          sort: input.sort,
          max_entries: MAX_DIRECTORY_ENTRIES,
        },
        truncation: {
          truncated: input.truncated,
          reason: input.reason,
        },
        permission_decision: {
          status: "allowed",
          source: "turn_context",
          active_permission_profile: input.ctx.turn?.active_permission_profile,
          sandbox_policy: input.ctx.turn?.sandbox_policy,
          approval_policy: input.ctx.turn?.approval_policy,
        },
        entries: input.entries,
        preview: input.preview,
      }
    }

    const run = Effect.fn("ReadTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const instance = yield* InstanceState.context
      const requested = params.filePath
      let filepath = TurnSandbox.resolvePath(ctx, params.filePath, instance.directory)
      if (process.platform === "win32") {
        filepath = AppFileSystem.normalizePath(filepath)
      }
      yield* TurnSandbox.assertFileAccess(ctx, "read", filepath)
      yield* reference.ensure(filepath)
      const title = path.relative(instance.worktree, filepath)

      const stat = yield* CodexFs.stat(ctx, fs, filepath).pipe(Effect.catch(() => Effect.succeed(undefined)))

      yield* assertExternalDirectoryEffect(ctx, filepath, {
        bypass: Boolean(ctx.extra?.["bypassCwdCheck"]) || (yield* reference.contains(filepath)),
        kind: stat?.type === "Directory" ? "directory" : "file",
      })

      yield* ctx.ask({
        permission: "read",
        patterns: [path.relative(instance.worktree, filepath)],
        always: ["*"],
        metadata: {},
      })

      if (!stat) return yield* miss(filepath, ctx)
      const canonicalPath = yield* canonical(filepath)

      if (stat.type === "Directory") {
        const limit = params.limit ?? DEFAULT_READ_LIMIT
        const offset = params.offset || 1
        const sort = params.sort ?? "name"
        const recursiveDepth = params.recursiveDepth ?? 0
        const effectiveRecursiveDepth = Math.min(recursiveDepth, MAX_RECURSIVE_DEPTH)
        const allEntries = sortDirectoryEntries(
          yield* directoryEntries({
            ctx,
            dir: filepath,
            depth: effectiveRecursiveDepth,
            showHidden: params.showHidden ?? true,
            entries: [],
          }),
          sort,
        )
        const entries = params.showHidden === false ? allEntries.filter((entry) => !entry.hidden) : allEntries
        const items = entries.map((entry) => entry.display_name)
        const start = offset - 1
        const sliced = items.slice(start, start + limit)
        const slicedEntries = entries.slice(start, start + limit)
        const collectionTruncated = allEntries.length >= MAX_DIRECTORY_ENTRIES
        const truncated = start + sliced.length < items.length || collectionTruncated
        const output = [
          `<path>${filepath}</path>`,
          `<type>directory</type>`,
          `<entries>`,
          sliced.join("\n"),
          truncated
            ? `\n(Showing ${sliced.length} of ${items.length} entries. Use 'offset' parameter to read beyond entry ${offset + sliced.length})`
            : `\n(${items.length} entries)`,
          `</entries>`,
        ].join("\n")

        return {
          title,
          output,
          metadata: {
            preview: sliced.slice(0, 20).join("\n"),
            truncated,
            loaded: [] as string[],
            directoryRead: directoryReadMetadata({
              ctx,
              requested,
              filepath,
              canonicalPath,
              offset,
              limit,
              start: slicedEntries.length ? offset : undefined,
              end: slicedEntries.length ? offset + slicedEntries.length - 1 : undefined,
              total: entries.length,
              returned: slicedEntries.length,
              hiddenPolicy: params.showHidden === false ? "exclude" : "include",
              hiddenCount: allEntries.filter((entry) => entry.hidden).length,
              protectedCount: allEntries.filter((entry) => entry.protected).length,
              symlinkCount: allEntries.filter((entry) => entry.symlink).length,
              symlinkEscapeCount: allEntries.filter((entry) => entry.symlink_escape).length,
              recursiveDepth,
              effectiveRecursiveDepth,
              sort,
              truncated,
              reason: collectionTruncated ? "collection_limit" : truncated ? "entry_limit" : undefined,
              entries: slicedEntries,
              preview: sliced.slice(0, 20).join("\n"),
            }) as DirectoryReadMetadata | undefined,
            fileRead: fileReadMetadata({
              ctx,
              requested,
              filepath,
              canonicalPath,
              kind: "directory",
              offset,
              limit,
              start: offset,
              end: offset + sliced.length - 1,
              total: items.length,
              truncated,
              reason: truncated ? "entry_limit" : undefined,
              output,
              preview: sliced.slice(0, 20).join("\n"),
              loaded: [],
            }),
          },
        }
      }

      const loaded = yield* instruction.resolve(ctx.messages, filepath, ctx.messageID)
      const bytes = yield* CodexFs.readFile(ctx, fs, filepath)
      const sample = bytes.slice(0, Math.min(SAMPLE_BYTES, bytes.length))

      const mime = sniffAttachmentMime(sample, AppFileSystem.mimeType(filepath))
      const isImage = SUPPORTED_IMAGE_MIMES.has(mime)

      if (isImage || isPdfAttachment(mime)) {
        const msg = isPdfAttachment(mime) ? "PDF read successfully" : "Image read successfully"
        return {
          title,
          output: msg,
          metadata: {
            preview: msg,
            truncated: false,
            loaded: loaded.map((item) => item.filepath),
            directoryRead: undefined as DirectoryReadMetadata | undefined,
            fileRead: fileReadMetadata({
              ctx,
              requested,
              filepath,
              canonicalPath,
              kind: isPdfAttachment(mime) ? "pdf" : "image",
              offset: params.offset || 1,
              limit: params.limit ?? DEFAULT_READ_LIMIT,
              truncated: false,
              output: msg,
              preview: msg,
              loaded: loaded.map((item) => item.filepath),
            }),
          },
          attachments: [
            {
              type: "file" as const,
              mime,
              url: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`,
            },
          ],
        }
      }

      if (isBinaryFile(filepath, sample)) {
        return yield* Effect.fail(new Error(`Cannot read binary file: ${filepath}`))
      }

      const file = lines(bytes, { limit: params.limit ?? DEFAULT_READ_LIMIT, offset: params.offset || 1 })
      if (file.count < file.offset && !(file.count === 0 && file.offset === 1)) {
        return yield* Effect.fail(
          new Error(`Offset ${file.offset} is out of range for this file (${file.count} lines)`),
        )
      }

      let output = [`<path>${filepath}</path>`, `<type>file</type>`, "<content>\n"].join("\n")
      output += file.raw.map((line, i) => `${i + file.offset}: ${line}`).join("\n")

      const last = file.offset + file.raw.length - 1
      const next = last + 1
      const truncated = file.more || file.cut
      if (file.cut) {
        output += `\n\n(Output capped at ${MAX_BYTES_LABEL}. Showing lines ${file.offset}-${last}. Use offset=${next} to continue.)`
      } else if (file.more) {
        output += `\n\n(Showing lines ${file.offset}-${last} of ${file.count}. Use offset=${next} to continue.)`
      } else {
        output += `\n\n(End of file - total ${file.count} lines)`
      }
      output += "\n</content>"

      yield* warm(filepath)

      if (loaded.length > 0) {
        output += `\n\n<system-reminder>\n${loaded.map((item) => item.content).join("\n\n")}\n</system-reminder>`
      }

      return {
        title,
        output,
        metadata: {
          preview: file.raw.slice(0, 20).join("\n"),
          truncated,
          loaded: loaded.map((item) => item.filepath),
          directoryRead: undefined as DirectoryReadMetadata | undefined,
          fileRead: fileReadMetadata({
            ctx,
            requested,
            filepath,
            canonicalPath,
            kind: "file",
            offset: file.offset,
            limit: params.limit ?? DEFAULT_READ_LIMIT,
            start: file.raw.length ? file.offset : undefined,
            end: file.raw.length ? last : undefined,
            total: file.count,
            truncated,
            reason: file.cut ? "byte_limit" : file.more ? "line_limit" : undefined,
            output,
            preview: file.raw.slice(0, 20).join("\n"),
            loaded: loaded.map((item) => item.filepath),
          }),
        },
      }
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)

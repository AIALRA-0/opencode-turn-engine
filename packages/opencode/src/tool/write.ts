import { Schema } from "effect"
import crypto from "crypto"
import * as path from "path"
import { Effect } from "effect"
import * as Tool from "./tool"
import { LSP } from "@/lsp/lsp"
import { createTwoFilesPatch } from "diff"
import DESCRIPTION from "./write.txt"
import { Bus } from "../bus"
import { File } from "../file"
import { FileWatcher } from "../file/watcher"
import { Format } from "../format"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { InstanceState } from "@/effect/instance-state"
import { trimDiff } from "./edit"
import { assertExternalDirectoryEffect } from "./external-directory"
import { TurnSandbox } from "./turn-sandbox"
import * as Bom from "@/util/bom"
import { CodexFs } from "./codex-fs"
import { CodexTurn } from "@/session/turn-context"
import type { FileMutation, FileWriteMetadata, FileWriteState } from "@/session/file-write-protocol"

const MAX_PROJECT_DIAGNOSTICS_FILES = 5

export const Parameters = Schema.Struct({
  content: Schema.String.annotate({ description: "The content to write to the file" }),
  filePath: Schema.String.annotate({
    description: "The absolute path to the file to write (must be absolute, not relative)",
  }),
  dryRun: Schema.optional(Schema.Boolean).annotate({
    description: "Preview the write and return mutation metadata without changing the file. Defaults to false.",
  }),
  overwrite: Schema.optional(
    Schema.Union([Schema.Literal("allow"), Schema.Literal("deny"), Schema.Literal("if_absent")]),
  ).annotate({
    description: "Overwrite policy. allow permits create or replace, deny refuses existing files, if_absent only creates missing files.",
  }),
})

function sha256(bytes: Uint8Array) {
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

function state(input: { exists: boolean; bytes?: Uint8Array; bom?: boolean; mtime?: Date }): FileWriteState {
  if (!input.exists) return { exists: false }
  const bytes = input.bytes ?? new Uint8Array()
  return {
    exists: true,
    size: bytes.length,
    sha256: sha256(bytes),
    bom: input.bom,
    mtime_ms: input.mtime?.getTime(),
  }
}

function changedChars(oldText: string, newText: string) {
  return {
    chars_added: Math.max(0, newText.length - oldText.length),
    chars_removed: Math.max(0, oldText.length - newText.length),
  }
}

export const WriteTool = Tool.define(
  "write",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const fs = yield* AppFileSystem.Service
    const bus = yield* Bus.Service
    const format = yield* Format.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = TurnSandbox.resolvePath(ctx, params.filePath, instance.directory)
          yield* TurnSandbox.assertWritableParentExists(ctx, filepath)
          yield* assertExternalDirectoryEffect(ctx, filepath, { access: "write" })

          const exists = yield* CodexFs.existsSafe(ctx, fs, filepath)
          const overwrite = params.overwrite ?? "allow"
          if (exists && overwrite !== "allow") {
            return yield* Effect.fail(new Error(`Write refused by overwrite policy '${overwrite}': ${filepath}`))
          }

          const beforeBytes = exists ? yield* CodexFs.readFile(ctx, fs, filepath) : new Uint8Array()
          const source = exists ? yield* CodexFs.readBomFile(ctx, fs, filepath) : { bom: false, text: "" }
          const next = Bom.split(params.content)
          const desiredBom = source.bom || next.bom
          const contentOld = source.text
          const contentNew = next.text
          const desiredBytes = new TextEncoder().encode(Bom.join(contentNew, desiredBom))
          const before = state({ exists, bytes: beforeBytes, bom: source.bom })
          const desired = state({ exists: true, bytes: desiredBytes, bom: desiredBom })

          const diff = trimDiff(createTwoFilesPatch(filepath, filepath, contentOld, contentNew))
          yield* ctx.ask({
            permission: "edit",
            patterns: [path.relative(instance.worktree, filepath)],
            always: ["*"],
            metadata: {
              filepath,
              diff,
            },
          })

          if (!params.dryRun) {
            yield* CodexFs.writeWithDirs(ctx, fs, filepath, Bom.join(contentNew, desiredBom))
            if (yield* format.file(filepath)) {
              yield* CodexFs.syncBomFile(ctx, fs, filepath, desiredBom)
            }
            yield* bus.publish(File.Event.Edited, { file: filepath })
            yield* bus.publish(FileWatcher.Event.Updated, {
              file: filepath,
              event: exists ? "change" : "add",
            })
          }

          let output = params.dryRun ? "Dry run: file write preview generated." : "Wrote file successfully."
          if (!params.dryRun) yield* lsp.touchFile(filepath, "document")
          const diagnostics = params.dryRun ? {} : yield* lsp.diagnostics()
          const normalizedFilepath = AppFileSystem.normalizePath(filepath)
          let projectDiagnosticsCount = 0
          for (const [file, issues] of Object.entries(diagnostics)) {
            const current = file === normalizedFilepath
            if (!current && projectDiagnosticsCount >= MAX_PROJECT_DIAGNOSTICS_FILES) continue
            const block = LSP.Diagnostic.report(current ? filepath : file, issues)
            if (!block) continue
            if (current) {
              output += `\n\nLSP errors detected in this file, please fix:\n${block}`
              continue
            }
            projectDiagnosticsCount++
            output += `\n\nLSP errors detected in other files:\n${block}`
          }

          const afterExists = params.dryRun ? exists : yield* CodexFs.existsSafe(ctx, fs, filepath)
          const afterBytes = afterExists && !params.dryRun ? yield* CodexFs.readFile(ctx, fs, filepath) : beforeBytes
          const after = params.dryRun
            ? before
            : state({ exists: afterExists, bytes: afterBytes, bom: desiredBom })
          const environment = ctx.turn?.environments.find((item) => item.environmentID === ctx.turn?.selected_environment_id)
          const mutation: FileMutation = {
            schema: "aialra.file_mutation.v1",
            mutation_id: `file_mutation_${ctx.callID || Date.now().toString(36)}`,
            tool: "write",
            operation: params.dryRun ? "preview" : exists ? "overwrite" : "create",
            applied: !params.dryRun,
            requested_path: params.filePath,
            resolved_path: filepath,
            environment_id: ctx.turn?.selected_environment_id ?? "legacy",
            before,
            after,
            desired: params.dryRun ? desired : undefined,
            diff: {
              ...changedChars(contentOld, contentNew),
              patch_chars: diff.length,
            },
          }
          const fileWrite: FileWriteMetadata = {
            schema: "aialra.file_write.v1",
            tool: "write",
            status: params.dryRun ? "preview" : "completed",
            session_id: String(ctx.sessionID),
            turn_id: ctx.turn?.turnID ? String(ctx.turn.turnID) : undefined,
            message_id: String(ctx.messageID),
            call_id: ctx.callID,
            environment_id: ctx.turn?.selected_environment_id ?? "legacy",
            environment_cwd: environment?.cwd ?? (ctx.turn ? CodexTurn.environmentCwd(ctx.turn) : instance.directory),
            requested_path: params.filePath,
            resolved_path: filepath,
            policy: {
              overwrite,
              dry_run: params.dryRun === true,
              encoding: "utf-8",
              preserves_bom: desiredBom,
              atomic: false,
              atomic_reason: "codex_fs_rename_api_unavailable",
            },
            permission_decision: {
              status: "allowed",
              source: "turn_context",
              active_permission_profile: ctx.turn?.active_permission_profile,
              sandbox_policy: ctx.turn?.sandbox_policy,
              approval_policy: ctx.turn?.approval_policy,
            },
            before,
            after,
            desired: params.dryRun ? desired : undefined,
            mutation,
          }

          return {
            title: path.relative(instance.worktree, filepath),
            metadata: {
              diagnostics,
              filepath,
              exists: exists,
              fileWrite,
              fileMutations: [mutation],
            },
            output,
          }
        }).pipe(Effect.orDie),
    }
  }),
)

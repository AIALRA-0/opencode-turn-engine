import * as path from "path"
import crypto from "crypto"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Bus } from "../bus"
import { FileWatcher } from "../file/watcher"
import { InstanceState } from "@/effect/instance-state"
import { Patch } from "../patch"
import { createTwoFilesPatch, diffLines } from "diff"
import { assertExternalDirectoryEffect } from "./external-directory"
import { trimDiff } from "./edit"
import { LSP } from "@/lsp/lsp"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import DESCRIPTION from "./apply_patch.txt"
import { File } from "../file"
import { Format } from "../format"
import * as Bom from "@/util/bom"
import { TurnSandbox } from "./turn-sandbox"
import { CodexFs } from "./codex-fs"
import { CodexTurn } from "@/session/turn-context"
import { ApplyPatchApproval } from "@/session/apply-patch-approval"
import type { FileMutation, FileWriteMetadata, FileWriteState } from "@/session/file-write-protocol"

export const Parameters = Schema.Struct({
  patchText: Schema.String.annotate({ description: "The full patch text that describes all changes to be made" }),
})

function sha256(bytes: Uint8Array) {
  return crypto.createHash("sha256").update(bytes).digest("hex")
}

function state(input: { exists: boolean; bytes?: Uint8Array; bom?: boolean }): FileWriteState {
  if (!input.exists) return { exists: false }
  const bytes = input.bytes ?? new Uint8Array()
  return {
    exists: true,
    size: bytes.length,
    sha256: sha256(bytes),
    bom: input.bom,
  }
}

function bytes(text: string, bom: boolean) {
  return new TextEncoder().encode(Bom.join(text, bom))
}

function changedChars(oldText: string, newText: string) {
  return {
    chars_added: Math.max(0, newText.length - oldText.length),
    chars_removed: Math.max(0, oldText.length - newText.length),
  }
}

export const ApplyPatchTool = Tool.define(
  "apply_patch",
  Effect.gen(function* () {
    const lsp = yield* LSP.Service
    const afs = yield* AppFileSystem.Service
    const format = yield* Format.Service
    const bus = yield* Bus.Service

    const run = Effect.fn("ApplyPatchTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      if (!params.patchText) {
        return yield* Effect.fail(new Error("patchText is required"))
      }

      // Parse the patch to get hunks
      let hunks: Patch.Hunk[]
      try {
        const parseResult = Patch.parsePatch(params.patchText)
        hunks = parseResult.hunks
      } catch (error) {
        return yield* Effect.fail(new Error(`apply_patch verification failed: ${error}`))
      }

      if (hunks.length === 0) {
        const normalized = params.patchText.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()
        if (normalized === "*** Begin Patch\n*** End Patch") {
          return yield* Effect.fail(new Error("patch rejected: empty patch"))
        }
        return yield* Effect.fail(new Error("apply_patch verification failed: no hunks found"))
      }

      const instance = yield* InstanceState.context

      // Validate file paths and check permissions
      const fileChanges: Array<{
        requestedPath: string
        filePath: string
        oldContent: string
        newContent: string
        type: "add" | "update" | "delete" | "move"
        movePath?: string
        moveRequestedPath?: string
        diff: string
        additions: number
        deletions: number
        before: FileWriteState
        desired: FileWriteState
        bom: boolean
      }> = []

      let totalDiff = ""

      for (const hunk of hunks) {
        const filePath = TurnSandbox.resolvePath(ctx, hunk.path, instance.directory)
        yield* TurnSandbox.assertWritableParentExists(ctx, filePath)
        yield* assertExternalDirectoryEffect(ctx, filePath, { access: "write" })

        switch (hunk.type) {
          case "add": {
            const exists = yield* CodexFs.existsSafe(ctx, afs, filePath)
            const beforeBytes = exists ? yield* CodexFs.readFile(ctx, afs, filePath) : new Uint8Array()
            const source = exists ? yield* CodexFs.readBomFile(ctx, afs, filePath) : { bom: false, text: "" }
            const oldContent = source.text
            const newContent =
              hunk.contents.length === 0 || hunk.contents.endsWith("\n") ? hunk.contents : `${hunk.contents}\n`
            const next = Bom.split(newContent)
            const desiredBom = source.bom || next.bom
            const diff = trimDiff(createTwoFilesPatch(filePath, filePath, "", next.text))

            let additions = 0
            let deletions = 0
            for (const change of diffLines("", next.text)) {
              if (change.added) additions += change.count || 0
              if (change.removed) deletions += change.count || 0
            }

            fileChanges.push({
              requestedPath: hunk.path,
              filePath,
              oldContent,
              newContent: next.text,
              type: "add",
              diff,
              additions,
              deletions,
              before: state({ exists, bytes: beforeBytes, bom: source.bom }),
              desired: state({ exists: true, bytes: bytes(next.text, desiredBom), bom: desiredBom }),
              bom: desiredBom,
            })

            totalDiff += diff + "\n"
            break
          }

          case "update": {
            // Check if file exists for update
            const stats = yield* CodexFs.stat(ctx, afs, filePath).pipe(Effect.catch(() => Effect.succeed(undefined)))
            if (!stats || stats.type === "Directory") {
              return yield* Effect.fail(
                new Error(`apply_patch verification failed: Failed to read file to update: ${filePath}`),
              )
            }

            const source = yield* CodexFs.readBomFile(ctx, afs, filePath)
            const beforeBytes = yield* CodexFs.readFile(ctx, afs, filePath)
            const oldContent = source.text
            let newContent = oldContent
            let bom = source.bom

            // Apply the update chunks to get new content
            try {
              const fileUpdate = Patch.deriveNewContentsFromChunks(
                filePath,
                hunk.chunks,
                Bom.join(source.text, source.bom),
              )
              newContent = fileUpdate.content
              bom = fileUpdate.bom
            } catch (error) {
              return yield* Effect.fail(new Error(`apply_patch verification failed: ${error}`))
            }

            const diff = trimDiff(createTwoFilesPatch(filePath, filePath, oldContent, newContent))

            let additions = 0
            let deletions = 0
            for (const change of diffLines(oldContent, newContent)) {
              if (change.added) additions += change.count || 0
              if (change.removed) deletions += change.count || 0
            }

            const movePath = hunk.move_path ? TurnSandbox.resolvePath(ctx, hunk.move_path, instance.directory) : undefined
            if (movePath) yield* TurnSandbox.assertWritableParentExists(ctx, movePath)
            yield* assertExternalDirectoryEffect(ctx, movePath, { access: "write" })

            fileChanges.push({
              requestedPath: hunk.path,
              filePath,
              oldContent,
              newContent,
              type: hunk.move_path ? "move" : "update",
              movePath,
              moveRequestedPath: hunk.move_path,
              diff,
              additions,
              deletions,
              before: state({ exists: true, bytes: beforeBytes, bom: source.bom }),
              desired: state({ exists: true, bytes: bytes(newContent, bom), bom }),
              bom,
            })

            totalDiff += diff + "\n"
            break
          }

          case "delete": {
            const source = yield* CodexFs.readBomFile(ctx, afs, filePath)
            const beforeBytes = yield* CodexFs.readFile(ctx, afs, filePath)
            const contentToDelete = source.text
            const deleteDiff = trimDiff(createTwoFilesPatch(filePath, filePath, contentToDelete, ""))

            const deletions = contentToDelete.split("\n").length

            fileChanges.push({
              requestedPath: hunk.path,
              filePath,
              oldContent: contentToDelete,
              newContent: "",
              type: "delete",
              diff: deleteDiff,
              additions: 0,
              deletions,
              before: state({ exists: true, bytes: beforeBytes, bom: source.bom }),
              desired: { exists: false },
              bom: source.bom,
            })

            totalDiff += deleteDiff + "\n"
            break
          }
        }
      }

      // Build per-file metadata for UI rendering (used for both permission and result)
      const files = fileChanges.map((change) => ({
        filePath: change.filePath,
        relativePath: path.relative(instance.worktree, change.movePath ?? change.filePath).replaceAll("\\", "/"),
        type: change.type,
        patch: change.diff,
        additions: change.additions,
        deletions: change.deletions,
        movePath: change.movePath,
      }))

      // Check permissions if needed
      const relativePaths = fileChanges.map((c) => path.relative(instance.worktree, c.filePath).replaceAll("\\", "/"))
      const patchApproval = yield* ApplyPatchApproval.requested(ctx, {
        patchText: params.patchText,
        patchSha256: sha256(new TextEncoder().encode(params.patchText)),
        hunkCount: hunks.length,
        totalDiff,
        files: fileChanges.map((change) => ({
          requested_path: change.requestedPath,
          resolved_path: change.movePath ?? change.filePath,
          operation: change.type === "add"
            ? change.before.exists
              ? "overwrite"
              : "create"
            : change.type === "delete"
              ? "delete"
              : change.type === "move"
                ? "move"
                : "overwrite",
          move_path: change.movePath,
          additions: change.additions,
          deletions: change.deletions,
          diff_sha256: sha256(new TextEncoder().encode(change.diff)),
          diff_preview: change.diff.length > 2_000 ? `${change.diff.slice(0, 2_000)}...` : change.diff,
          before: change.before,
          desired: change.desired,
          protected_path_checked: true,
          symlink_realpath_checked: true,
        })),
        turnDiffPreview: {
          files_changed: fileChanges.length,
          additions: fileChanges.reduce((total, change) => total + change.additions, 0),
          deletions: fileChanges.reduce((total, change) => total + change.deletions, 0),
          patch_chars: params.patchText.length,
        },
      })
      yield* ctx.ask({
        permission: "edit",
        patterns: relativePaths,
        always: ["*"],
        metadata: {
          filepath: relativePaths.join(", "),
          diff: totalDiff,
          files,
          apply_patch_approval: patchApproval,
        },
      })

      // Apply the changes
      const updates: Array<{ file: string; event: "add" | "change" | "unlink" }> = []

      for (const change of fileChanges) {
        const edited = change.type === "delete" ? undefined : (change.movePath ?? change.filePath)
        switch (change.type) {
          case "add":
            // Create parent directories (recursive: true is safe on existing/root dirs)

            yield* CodexFs.writeWithDirs(ctx, afs, change.filePath, Bom.join(change.newContent, change.bom))
            updates.push({ file: change.filePath, event: "add" })
            break

          case "update":
            yield* CodexFs.writeWithDirs(ctx, afs, change.filePath, Bom.join(change.newContent, change.bom))
            updates.push({ file: change.filePath, event: "change" })
            break

          case "move":
            if (change.movePath) {
              // Create parent directories (recursive: true is safe on existing/root dirs)

              yield* CodexFs.writeWithDirs(ctx, afs, change.movePath!, Bom.join(change.newContent, change.bom))
              yield* CodexFs.remove(ctx, afs, change.filePath)
              updates.push({ file: change.filePath, event: "unlink" })
              updates.push({ file: change.movePath, event: "add" })
            }
            break

          case "delete":
            yield* CodexFs.remove(ctx, afs, change.filePath)
            updates.push({ file: change.filePath, event: "unlink" })
            break
        }

        if (edited) {
          if (yield* format.file(edited)) {
            yield* CodexFs.syncBomFile(ctx, afs, edited, change.bom)
          }
          yield* bus.publish(File.Event.Edited, { file: edited })
        }
      }

      // Publish file change events
      for (const update of updates) {
        yield* bus.publish(FileWatcher.Event.Updated, update)
      }

      const environment = ctx.turn?.environments.find((item) => item.environmentID === ctx.turn?.selected_environment_id)
      const mutations: FileMutation[] = yield* Effect.all(
        fileChanges.map((change, index) =>
          Effect.gen(function* () {
            const target = change.movePath ?? change.filePath
            const afterExists = change.type === "delete" ? false : yield* CodexFs.existsSafe(ctx, afs, target)
            const afterBytes = afterExists ? yield* CodexFs.readFile(ctx, afs, target) : new Uint8Array()
            const afterSource = afterExists ? yield* CodexFs.readBomFile(ctx, afs, target) : { bom: false, text: "" }
            return {
              schema: "aialra.file_mutation.v1",
              mutation_id: `file_mutation_${ctx.callID || Date.now().toString(36)}_${index}`,
              tool: "apply_patch",
              operation:
                change.type === "add"
                  ? change.before.exists
                    ? "overwrite"
                    : "create"
                  : change.type === "delete"
                    ? "delete"
                    : change.type === "move"
                      ? "move"
                      : "overwrite",
              applied: true,
              requested_path: change.moveRequestedPath ?? change.requestedPath,
              resolved_path: target,
              environment_id: ctx.turn?.selected_environment_id ?? "legacy",
              before: change.before,
              after: state({ exists: afterExists, bytes: afterBytes, bom: afterSource.bom }),
              desired: change.desired,
              diff: {
                ...changedChars(change.oldContent, afterSource.text),
                patch_chars: change.diff.length,
              },
            } satisfies FileMutation
          }),
        ),
      )
      const fileWrite: FileWriteMetadata = {
        schema: "aialra.file_write.v1",
        tool: "apply_patch",
        status: "completed",
        session_id: String(ctx.sessionID),
        turn_id: ctx.turn?.turnID ? String(ctx.turn.turnID) : undefined,
        message_id: String(ctx.messageID),
        call_id: ctx.callID,
        environment_id: ctx.turn?.selected_environment_id ?? "legacy",
        environment_cwd: environment?.cwd ?? (ctx.turn ? CodexTurn.environmentCwd(ctx.turn) : instance.directory),
        requested_path: fileChanges.length === 1 ? fileChanges[0].requestedPath : `apply_patch:${fileChanges.length}:files`,
        resolved_path: fileChanges.length === 1 ? fileChanges[0].movePath ?? fileChanges[0].filePath : instance.worktree,
        policy: {
          overwrite: "allow",
          dry_run: false,
          encoding: "utf-8",
          preserves_bom: fileChanges.some((change) => change.bom),
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
        before: mutations[0]?.before ?? { exists: false },
        after: mutations[0]?.after ?? { exists: false },
        desired: mutations[0]?.desired,
        patch_intent: {
          patch_chars: params.patchText.length,
          hunk_count: hunks.length,
          affected_files: fileChanges.map((change, index) => ({
            requested_path: change.requestedPath,
            resolved_path: change.movePath ?? change.filePath,
            operation: mutations[index]?.operation ?? "overwrite",
            move_path: change.movePath,
            additions: change.additions,
            deletions: change.deletions,
            applied: true,
            hunk_status: "applied",
          })),
        },
        mutation: mutations[0] ?? {
          schema: "aialra.file_mutation.v1",
          mutation_id: `file_mutation_${ctx.callID || Date.now().toString(36)}_empty`,
          tool: "apply_patch",
          operation: "preview",
          applied: false,
          requested_path: "apply_patch",
          resolved_path: instance.worktree,
          environment_id: ctx.turn?.selected_environment_id ?? "legacy",
          before: { exists: false },
          after: { exists: false },
          diff: { chars_added: 0, chars_removed: 0, patch_chars: 0 },
        },
      }

      yield* ctx.metadata({
        metadata: {
          diff: totalDiff,
          files,
          fileWrite,
          fileMutations: mutations,
        },
      })

      // Notify LSP of file changes and collect diagnostics
      for (const change of fileChanges) {
        if (change.type === "delete") continue
        const target = change.movePath ?? change.filePath
        yield* lsp.touchFile(target, "document")
      }
      const diagnostics = yield* lsp.diagnostics()

      // Generate output summary
      const summaryLines = fileChanges.map((change) => {
        if (change.type === "add") {
          return `A ${path.relative(instance.worktree, change.filePath).replaceAll("\\", "/")}`
        }
        if (change.type === "delete") {
          return `D ${path.relative(instance.worktree, change.filePath).replaceAll("\\", "/")}`
        }
        const target = change.movePath ?? change.filePath
        return `M ${path.relative(instance.worktree, target).replaceAll("\\", "/")}`
      })
      let output = `Success. Updated the following files:\n${summaryLines.join("\n")}`

      for (const change of fileChanges) {
        if (change.type === "delete") continue
        const target = change.movePath ?? change.filePath
        const block = LSP.Diagnostic.report(target, diagnostics[AppFileSystem.normalizePath(target)] ?? [])
        if (!block) continue
        const rel = path.relative(instance.worktree, target).replaceAll("\\", "/")
        output += `\n\nLSP errors detected in ${rel}, please fix:\n${block}`
      }

      return {
        title: output,
        metadata: {
          diff: totalDiff,
          files,
          diagnostics,
          fileWrite,
          fileMutations: mutations,
        },
        output,
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

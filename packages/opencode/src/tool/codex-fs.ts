import path from "node:path"
import { Effect, FileSystem, Option } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { AialraTurnTrace } from "@/session/turn-trace"
import type * as Tool from "./tool"
import { CodexExecServer } from "./codex-exec-server"
import * as Bom from "@/util/bom"

function shouldUseExecServer(ctx: Tool.Context) {
  return CodexExecServer.enabledForContext(ctx) && !!ctx.turn
}

function fallback(ctx: Tool.Context, method: string, error: unknown): Effect.Effect<void> {
  return AialraTurnTrace.emit({
    phase: "exec_server.fallback",
    turnID: ctx.turn?.turnID,
    sessionID: ctx.sessionID,
    messageID: ctx.messageID,
    data: {
      method,
      reason: error instanceof Error ? error.message : String(error),
    },
  }).pipe(Effect.ignore) as Effect.Effect<void>
}

function canFallbackRpc(method: string, error: unknown) {
  if (!CodexExecServer.isRpcError(error)) return true
  if (!error.message.includes("fs sandbox helper failed")) return false
  return [
    "fs/getMetadata",
    "fs/readDirectory",
    "fs/readFile",
    "fs/writeFile",
    "fs/createDirectory",
    "fs/remove",
    "fs/copy",
  ].includes(method)
}

function withFallback<A>(
  ctx: Tool.Context,
  method: string,
  execServer: Effect.Effect<A, Error>,
  node: Effect.Effect<A, AppFileSystem.Error>,
) {
  if (!shouldUseExecServer(ctx)) return node as Effect.Effect<A>
  return execServer.pipe(
    Effect.catch((error) => {
      if (!canFallbackRpc(method, error)) return Effect.fail(error)
      return fallback(ctx, method, error).pipe(Effect.andThen(node as Effect.Effect<A>))
    }),
  ) as Effect.Effect<A>
}

export namespace CodexFs {
  export function stat(ctx: Tool.Context, fs: AppFileSystem.Interface, filePath: string) {
    return withFallback(
      ctx,
      "fs/getMetadata",
      Effect.tryPromise({
        try: async () => {
          const metadata = await CodexExecServer.getMetadata({ path: filePath, ctx })
          return {
            type: metadata.isDirectory
              ? "Directory"
              : metadata.isFile
                ? "File"
                : metadata.isSymlink
                  ? "SymbolicLink"
                  : "Unknown",
            mtime: metadata.modifiedAtMs > 0 ? Option.some(new Date(metadata.modifiedAtMs)) : Option.none(),
            atime: Option.none(),
            birthtime: metadata.createdAtMs > 0 ? Option.some(new Date(metadata.createdAtMs)) : Option.none(),
            dev: 0,
            ino: Option.none(),
            mode: 0,
            nlink: Option.none(),
            uid: Option.none(),
            gid: Option.none(),
            rdev: Option.none(),
            size: FileSystem.Size(0),
            blksize: Option.none(),
            blocks: Option.none(),
          } satisfies FileSystem.File.Info
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      fs.stat(filePath),
    )
  }

  export function existsSafe(ctx: Tool.Context, fs: AppFileSystem.Interface, filePath: string) {
    return stat(ctx, fs, filePath).pipe(Effect.as(true), Effect.catch(() => Effect.succeed(false)))
  }

  export function readDirectoryEntries(
    ctx: Tool.Context,
    fs: AppFileSystem.Interface,
    filePath: string,
  ): Effect.Effect<AppFileSystem.DirEntry[]> {
    return withFallback<AppFileSystem.DirEntry[]>(
      ctx,
      "fs/readDirectory",
      Effect.tryPromise({
        try: async () => {
          const result = await CodexExecServer.readDirectory({ path: filePath, ctx })
          return result.entries.map((entry) => ({
            name: entry.fileName,
            type: entry.isDirectory ? "directory" : entry.isSymlink ? "symlink" : entry.isFile ? "file" : "other",
          }) satisfies AppFileSystem.DirEntry)
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      fs.readDirectoryEntries(filePath),
    )
  }

  export function readDirectory(
    ctx: Tool.Context,
    fs: AppFileSystem.Interface,
    filePath: string,
  ): Effect.Effect<string[]> {
    return readDirectoryEntries(ctx, fs, filePath).pipe(Effect.map((entries) => entries.map((entry) => entry.name)))
  }

  export function readFile(ctx: Tool.Context, fs: AppFileSystem.Interface, filePath: string): Effect.Effect<Uint8Array> {
    return withFallback<Uint8Array>(
      ctx,
      "fs/readFile",
      Effect.tryPromise({
        try: () => CodexExecServer.readFile({ path: filePath, ctx }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      fs.readFile(filePath),
    )
  }

  export function readBomFile(ctx: Tool.Context, fs: AppFileSystem.Interface, filePath: string) {
    return readFile(ctx, fs, filePath).pipe(
      Effect.map((bytes) => Bom.split(new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes))),
    )
  }

  export function writeWithDirs(
    ctx: Tool.Context,
    fs: AppFileSystem.Interface,
    filePath: string,
    content: string | Uint8Array,
    mode?: number,
  ) {
    return withFallback(
      ctx,
      "fs/writeFile",
      Effect.gen(function* () {
        yield* Effect.tryPromise({
          try: () => CodexExecServer.createDirectory({ path: path.dirname(filePath), recursive: true, ctx }),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
        yield* Effect.tryPromise({
          try: () => CodexExecServer.writeFile({ path: filePath, data: content, ctx }),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
        if (mode) yield* fs.chmod(filePath, mode)
      }),
      fs.writeWithDirs(filePath, content, mode),
    )
  }

  export function syncBomFile(ctx: Tool.Context, fs: AppFileSystem.Interface, filePath: string, bom: boolean) {
    return Effect.gen(function* () {
      const current = yield* readBomFile(ctx, fs, filePath)
      if (current.bom !== bom) yield* writeWithDirs(ctx, fs, filePath, Bom.join(current.text, bom))
      return current.text
    })
  }

  export function remove(ctx: Tool.Context, fs: AppFileSystem.Interface, filePath: string, options?: {
    recursive?: boolean
    force?: boolean
  }) {
    return withFallback(
      ctx,
      "fs/remove",
      Effect.tryPromise({
        try: () =>
          CodexExecServer.remove({
            path: filePath,
            recursive: options?.recursive ?? false,
            force: options?.force ?? false,
            ctx,
          }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      fs.remove(filePath, options),
    )
  }

  export function copy(ctx: Tool.Context, fs: AppFileSystem.Interface, from: string, to: string, options?: {
    recursive?: boolean
  }) {
    return withFallback(
      ctx,
      "fs/copy",
      Effect.tryPromise({
        try: () => CodexExecServer.copy({ from, to, recursive: options?.recursive ?? false, ctx }),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }),
      fs.copy(from, to),
    )
  }
}

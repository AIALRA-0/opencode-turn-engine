import path from "node:path"
import { Effect } from "effect"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { AialraTurnTrace } from "@/session/turn-trace"
import type * as Tool from "./tool"
import { CodexExecServer } from "./codex-exec-server"
import * as Bom from "@/util/bom"

function shouldUseExecServer(ctx: Tool.Context) {
  return CodexExecServer.enabled() && !!ctx.turn
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

function withFallback<A>(
  ctx: Tool.Context,
  method: string,
  execServer: Effect.Effect<A, Error>,
  node: Effect.Effect<A, AppFileSystem.Error>,
) {
  if (!shouldUseExecServer(ctx)) return node as Effect.Effect<A>
  return execServer.pipe(
    Effect.catch((error) => {
      if (CodexExecServer.isRpcError(error)) return Effect.fail(error)
      return fallback(ctx, method, error).pipe(Effect.andThen(node as Effect.Effect<A>))
    }),
  ) as Effect.Effect<A>
}

export namespace CodexFs {
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
}

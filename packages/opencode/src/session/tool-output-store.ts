import { Effect, Layer, Context } from "effect"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { ToolID } from "@/tool/schema"
import { TRUNCATION_DIR } from "@/tool/truncation-dir"
import { AialraTurnTrace } from "./turn-trace"
import type { MessageID, SessionID } from "./schema"
import { FileReadProtocol } from "./file-read-protocol"
import { DirectoryReadProtocol } from "./directory-read-protocol"
import { FileWriteProtocol } from "./file-write-protocol"
import { FileSearchProtocol } from "./file-search-protocol"

type JsonRecord = Record<string, unknown>

export type ToolOutputRef = {
  schema: "aialra.tool_output_ref.v1"
  id: string
  path: string
  source: "tool-output-store"
  storedAt: string
  bytes: number
  chars?: number
  truncated: boolean
  sessionID?: string
  turnID?: string
  messageID?: string
  callID?: string
  tool?: string
}

type AttachInput<A> = {
  sessionID: SessionID | string
  turnID?: MessageID | string
  messageID?: MessageID | string
  callID?: string
  tool: string
  result: A
}

export interface Interface {
  readonly save: (input: {
    sessionID?: SessionID | string
    turnID?: MessageID | string
    messageID?: MessageID | string
    callID?: string
    tool?: string
    output: string
    truncated: boolean
    existingPath?: string
  }) => Effect.Effect<ToolOutputRef>
  readonly attach: <A>(input: AttachInput<A>) => Effect.Effect<A>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolOutputStore") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const fs = yield* AppFileSystem.Service

    const save = Effect.fn("ToolOutputStore.save")(function* (input: {
      sessionID?: SessionID | string
      turnID?: MessageID | string
      messageID?: MessageID | string
      callID?: string
      tool?: string
      output: string
      truncated: boolean
      existingPath?: string
    }) {
      const id = ToolID.ascending()
      const file = input.existingPath ?? path.join(TRUNCATION_DIR, id)
      if (!input.existingPath) {
        yield* fs.ensureDir(TRUNCATION_DIR).pipe(Effect.orDie)
        yield* fs.writeFileString(file, input.output).pipe(Effect.orDie)
      }
      const bytes = yield* Effect.sync(() => Bun.file(file).size).pipe(
        Effect.catch(() => Effect.succeed(Buffer.byteLength(input.output, "utf8"))),
      )
      const ref: ToolOutputRef = {
        schema: "aialra.tool_output_ref.v1",
        id,
        path: file,
        source: "tool-output-store",
        storedAt: new Date().toISOString(),
        bytes,
        chars: input.existingPath ? undefined : input.output.length,
        truncated: input.truncated,
        sessionID: input.sessionID ? String(input.sessionID) : undefined,
        turnID: input.turnID ? String(input.turnID) : undefined,
        messageID: input.messageID ? String(input.messageID) : undefined,
        callID: input.callID,
        tool: input.tool,
      }
      yield* AialraTurnTrace.emit({
        phase: "tool.output.stored",
        sessionID: input.sessionID ? (String(input.sessionID) as SessionID) : undefined,
        turnID: input.turnID ? (String(input.turnID) as MessageID) : undefined,
        messageID: input.messageID ? (String(input.messageID) as MessageID) : undefined,
        data: {
          ...ref,
          outputChars: input.output.length,
          outputPreview: input.output.slice(0, 240),
          existingPath: Boolean(input.existingPath),
        },
      })
      return ref
    })

    const attach = <A>(input: AttachInput<A>) =>
      Effect.gen(function* () {
        if (!input.result || typeof input.result !== "object" || Array.isArray(input.result)) return input.result
        const record = input.result as JsonRecord
        if (typeof record.output !== "string") return input.result
        const metadata = isRecord(record.metadata) ? record.metadata : {}
        if (isRecord(metadata.outputRef)) return input.result
        const ref = yield* save({
          sessionID: input.sessionID,
          turnID: input.turnID,
          messageID: input.messageID,
          callID: input.callID,
          tool: input.tool,
          output: record.output,
          truncated: metadata.truncated === true,
          existingPath: typeof metadata.outputPath === "string" ? metadata.outputPath : undefined,
        })
        const withFileReadRef = FileReadProtocol.FileRead.withRawRef({
          ...metadata,
          outputRef: ref,
        })
        const withDirectoryReadRef = DirectoryReadProtocol.DirectoryRead.withRawRef(withFileReadRef)
        const withFileSearchRef = FileSearchProtocol.FileSearch.withRawRef(withDirectoryReadRef)
        return {
          ...record,
          metadata: FileWriteProtocol.FileWrite.withRawRef(withFileSearchRef),
        } as A
      })

    return Service.of({ save, attach })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(AppFileSystem.defaultLayer))

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export * as ToolOutputStore from "./tool-output-store"

import { Cause, Context, Effect, Exit, Layer, Option } from "effect"
import { AialraTurnTrace } from "./turn-trace"
import type { SessionID, MessageID } from "./schema"
import type { TurnContext } from "./turn-context"
import { ToolOutputStore } from "./tool-output-store"

type ExecuteInput<A, E, R> = {
  sessionID: SessionID
  messageID: MessageID
  turn?: TurnContext
  tool: string
  callID?: string
  source: "opencode_registry" | "mcp_registry"
  input: Record<string, unknown>
  run: Effect.Effect<A, E, R>
}

type LifecycleStatus = "completed" | "failed" | "aborted"

export type FoundationInfo = {
  version: "aialra.tool_foundation.v1"
  upstream: "opencode-v2"
  upstreamCommit: "76ee87ead"
  components: {
    registry: "aialra-adapter"
    runner: "aialra-session-processor"
    outputStore: "aialra-truncate-bridge"
    fileMutation: "aialra-codex-fs-bridge"
  }
  status: "active"
}

export interface Interface {
  readonly info: () => FoundationInfo
  readonly resolve: (input: { sessionID: SessionID; turn?: TurnContext; toolCount: number }) => Effect.Effect<void>
  readonly execute: <A, E, R>(input: ExecuteInput<A, E, R>) => Effect.Effect<A, E, R>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/ToolFoundation") {}

export const info = (): FoundationInfo => ({
  version: "aialra.tool_foundation.v1",
  upstream: "opencode-v2",
  upstreamCommit: "76ee87ead",
  components: {
    registry: "aialra-adapter",
    runner: "aialra-session-processor",
    outputStore: "aialra-truncate-bridge",
    fileMutation: "aialra-codex-fs-bridge",
  },
  status: "active",
})

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const outputStore = yield* Effect.serviceOption(ToolOutputStore.Service)
    return Service.of({
    info,
    resolve: (input) =>
      AialraTurnTrace.emit({
        phase: "tool.foundation.resolved",
        sessionID: input.sessionID,
        turnID: input.turn?.turnID,
        messageID: input.turn?.messageID,
        data: {
          ...info(),
          toolCount: input.toolCount,
        },
      }),
    execute: (input) =>
      Effect.gen(function* () {
        const startedAt = Date.now()
        const requested = lifecycleSnapshot(input)
        yield* AialraTurnTrace.emit({
          phase: "tool.lifecycle.requested",
          sessionID: input.sessionID,
          turnID: input.turn?.turnID,
          messageID: input.messageID,
          data: {
            ...requested,
            hook: "pre",
            status: "requested",
          },
        })
        yield* AialraTurnTrace.emit({
          phase: "tool.lifecycle.started",
          sessionID: input.sessionID,
          turnID: input.turn?.turnID,
          messageID: input.messageID,
          data: {
            ...requested,
            hook: "pre",
            status: "started",
            startedAt,
          },
        })
        yield* AialraTurnTrace.emit({
          phase: "tool.foundation.executing",
          sessionID: input.sessionID,
          turnID: input.turn?.turnID,
          messageID: input.messageID,
          data: {
            ...info(),
            tool: input.tool,
            callID: input.callID,
            source: input.source,
            inputKeys: Object.keys(input.input).sort(),
          },
        })
        const exit = yield* Effect.exit(input.run)
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause)
          const status = Cause.hasInterrupts(exit.cause) ? "aborted" : lifecycleStatus(error)
          yield* AialraTurnTrace.emit({
            phase: status === "aborted" ? "tool.lifecycle.aborted" : "tool.lifecycle.failed",
            sessionID: input.sessionID,
            turnID: input.turn?.turnID,
            messageID: input.messageID,
            data: {
              ...requested,
              hook: "post",
              status,
              durationMs: Date.now() - startedAt,
              errorType: error instanceof Error ? error.name : typeof error,
              errorMessage: error instanceof Error ? error.message : String(error),
            },
          })
          yield* AialraTurnTrace.emit({
            phase: "tool.foundation.settled",
            sessionID: input.sessionID,
            turnID: input.turn?.turnID,
            messageID: input.messageID,
            data: {
              ...info(),
              tool: input.tool,
              callID: input.callID,
              source: input.source,
              status: "error",
              durationMs: Date.now() - startedAt,
              errorType: error instanceof Error ? error.name : typeof error,
            },
          })
          return yield* Effect.failCause(exit.cause)
        }
        const result = Option.isSome(outputStore)
          ? yield* outputStore.value.attach({
              sessionID: input.sessionID,
              turnID: input.turn?.turnID,
              messageID: input.messageID,
              callID: input.callID,
              tool: input.tool,
              result: exit.value,
            })
          : exit.value
        const status = resultAborted(result) ? "aborted" : "completed"
        yield* Effect.all([
          emitFileRead(input, result),
          emitDirectoryRead(input, result),
          emitFileSearch(input, result),
          emitFileWrite(input, result),
        ])
        yield* AialraTurnTrace.emit({
          phase: status === "aborted" ? "tool.lifecycle.aborted" : "tool.lifecycle.completed",
          sessionID: input.sessionID,
          turnID: input.turn?.turnID,
          messageID: input.messageID,
          data: {
            ...requested,
            ...resultSummary(result),
            hook: "post",
            status: status satisfies LifecycleStatus,
            durationMs: Date.now() - startedAt,
          },
        })
        yield* AialraTurnTrace.emit({
          phase: "tool.foundation.settled",
          sessionID: input.sessionID,
          turnID: input.turn?.turnID,
          messageID: input.messageID,
          data: {
            ...info(),
            tool: input.tool,
            callID: input.callID,
            source: input.source,
            status,
            durationMs: Date.now() - startedAt,
          },
        })
        return result
      }),
    })
  }),
)

export const defaultLayer = layer

function lifecycleSnapshot(input: ExecuteInput<unknown, unknown, unknown>) {
  const environment = input.turn?.environments.find(
    (item) => item.environmentID === input.turn?.selected_environment_id,
  )
  return {
    schema: "aialra.tool_lifecycle.v1",
    version: info().version,
    tool: input.tool,
    callID: input.callID,
    source: input.source,
    inputKeys: Object.keys(input.input).sort(),
    cwd: input.turn?.cwd,
    selected_environment_id: input.turn?.selected_environment_id,
    environment_cwd: environment?.cwd,
    approval_policy: input.turn?.approval_policy,
    approval_reviewer: input.turn?.approvals_reviewer,
    permission_profile: input.turn?.active_permission_profile ?? input.turn?.permission_profile,
    sandbox_policy: input.turn?.sandbox_policy,
    network_policy: input.turn?.network_policy,
    network_permissions: input.turn?.network_permissions,
  }
}

function lifecycleStatus(error: unknown): LifecycleStatus {
  if (error instanceof DOMException && error.name === "AbortError") return "aborted"
  if (!(error instanceof Error)) return "failed"
  const lower = error.message.toLowerCase()
  if (error.name === "AbortError" || lower.includes("abort") || lower.includes("interrupted")) return "aborted"
  return "failed"
}

function resultAborted(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return false
  const metadata = (result as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false
  const abort = (metadata as Record<string, unknown>).abort
  return Boolean(abort && typeof abort === "object" && !Array.isArray(abort) && (abort as Record<string, unknown>).aborted === true)
}

function resultSummary(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) return { outputKind: typeof result }
  const record = result as Record<string, unknown>
  return {
    outputKind: "object",
    title: typeof record.title === "string" ? record.title : undefined,
    outputChars: typeof record.output === "string" ? record.output.length : undefined,
    attachmentCount: Array.isArray(record.attachments) ? record.attachments.length : undefined,
    metadataKeys:
      record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
        ? Object.keys(record.metadata).sort()
        : undefined,
  }
}

function emitFileRead(input: ExecuteInput<unknown, unknown, unknown>, result: unknown) {
  if (input.tool !== "read" || !result || typeof result !== "object" || Array.isArray(result)) return Effect.void
  const metadata = (result as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return Effect.void
  const fileRead = (metadata as Record<string, unknown>).fileRead
  if (!fileRead || typeof fileRead !== "object" || Array.isArray(fileRead)) return Effect.void
  return AialraTurnTrace.emit({
    phase: "file.read",
    sessionID: input.sessionID,
    turnID: input.turn?.turnID,
    messageID: input.messageID,
    data: {
      ...(fileRead as Record<string, unknown>),
      outputRef: (metadata as Record<string, unknown>).outputRef,
    },
  })
}

function emitDirectoryRead(input: ExecuteInput<unknown, unknown, unknown>, result: unknown) {
  if (input.tool !== "read" || !result || typeof result !== "object" || Array.isArray(result)) return Effect.void
  const metadata = (result as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return Effect.void
  const directoryRead = (metadata as Record<string, unknown>).directoryRead
  if (!directoryRead || typeof directoryRead !== "object" || Array.isArray(directoryRead)) return Effect.void
  return AialraTurnTrace.emit({
    phase: "directory.read",
    sessionID: input.sessionID,
    turnID: input.turn?.turnID,
    messageID: input.messageID,
    data: {
      ...(directoryRead as Record<string, unknown>),
      outputRef: (metadata as Record<string, unknown>).outputRef,
    },
  })
}

function emitFileWrite(input: ExecuteInput<unknown, unknown, unknown>, result: unknown) {
  if (!["write", "edit", "apply_patch"].includes(input.tool) || !result || typeof result !== "object" || Array.isArray(result)) return Effect.void
  const metadata = (result as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return Effect.void
  const fileWrite = (metadata as Record<string, unknown>).fileWrite
  if (!fileWrite || typeof fileWrite !== "object" || Array.isArray(fileWrite)) return Effect.void
  return AialraTurnTrace.emit({
    phase: "file.write",
    sessionID: input.sessionID,
    turnID: input.turn?.turnID,
    messageID: input.messageID,
    data: {
      ...(fileWrite as Record<string, unknown>),
      outputRef: (metadata as Record<string, unknown>).outputRef,
    },
  })
}

function emitFileSearch(input: ExecuteInput<unknown, unknown, unknown>, result: unknown) {
  if (!["glob", "grep"].includes(input.tool) || !result || typeof result !== "object" || Array.isArray(result)) return Effect.void
  const metadata = (result as { metadata?: unknown }).metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return Effect.void
  const fileSearch = (metadata as Record<string, unknown>).fileSearch
  if (!fileSearch || typeof fileSearch !== "object" || Array.isArray(fileSearch)) return Effect.void
  return AialraTurnTrace.emit({
    phase: "file.search",
    sessionID: input.sessionID,
    turnID: input.turn?.turnID,
    messageID: input.messageID,
    data: {
      ...(fileSearch as Record<string, unknown>),
      outputRef: (metadata as Record<string, unknown>).outputRef,
    },
  })
}

export * as ToolFoundation from "./tool-foundation"

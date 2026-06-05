import { Image } from "@/image/image"
import { Cause, Deferred, Effect, Exit, Layer, Context, Scope, Schema, Option } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import * as Session from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
import { errorMessage } from "@/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { isRecord } from "@/util/record"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import * as DateTime from "effect/DateTime"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { AialraTurnTrace } from "./turn-trace"
import { CodexTurn, type TurnContext } from "./turn-context"
import { RuntimeProtocol } from "./runtime-item"
import { ToolResultProtocol } from "./tool-result-settlement"
import { ToolOutputStore } from "./tool-output-store"
import { ProviderTool } from "./provider-tool-protocol"
import { Usage, type LLMEvent } from "@opencode-ai/llm"

const DOOM_LOOP_THRESHOLD = 3
const log = Log.create({ service: "session.processor" })

class StreamRetryableError extends Error {
  constructor(
    message: string,
    readonly source?: unknown,
  ) {
    super(message)
    this.name = "StreamRetryableError"
  }
}

function isAbortLike(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") return true
  if (!(error instanceof Error)) return false
  return error.name === "AbortError" || error.message.toLowerCase().includes("abort")
}

function hasAbortMetadata(metadata: Record<string, any>) {
  return isRecord(metadata.abort) && metadata.abort.aborted === true
}

export type Result = "compact" | "stop" | "continue"

export interface Handle {
  readonly message: MessageV2.Assistant
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
  ) => Effect.Effect<MessageV2.ToolPart | undefined>
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: MessageV2.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
}

type Input = {
  assistantMessage: MessageV2.Assistant
  sessionID: SessionID
  model: Provider.Model
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
}

type ToolCall = {
  partID: MessageV2.ToolPart["id"]
  messageID: MessageV2.ToolPart["messageID"]
  sessionID: MessageV2.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
  inputEnded: boolean
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  needsCompaction: boolean
  currentText: MessageV2.TextPart | undefined
  reasoningMap: Record<string, MessageV2.ReasoningPart>
  reasoningToolLinks: Record<
    string,
    Array<{
      callID: string
      tool: string
      phase: "tool-input-start" | "tool-call"
      linkedAt: number
    }>
  >
  activeTurn: TurnContext | undefined
  runtimeItemSequence: number
  rawResponseSequence: number
  reasoningRawSequence: number
  reasoningRawSeen: boolean
  reasoningRawUnsupportedEmitted: boolean
}

type StreamEvent = LLMEvent

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionProcessor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const snapshot = yield* Snapshot.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const plugin = yield* Plugin.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service
    const image = yield* Image.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const outputStore = yield* Effect.serviceOption(ToolOutputStore.Service)

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      const initialSnapshot = yield* snapshot.track()
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        shouldBreak: false,
        snapshot: initialSnapshot,
        blocked: false,
        needsCompaction: false,
        currentText: undefined,
        reasoningMap: {},
        reasoningToolLinks: {},
        activeTurn: undefined,
        runtimeItemSequence: 0,
        rawResponseSequence: 0,
        reasoningRawSequence: 0,
        reasoningRawSeen: false,
        reasoningRawUnsupportedEmitted: false,
      }
      let aborted = false
      const slog = log.clone().tag("session.id", input.sessionID).tag("messageID", input.assistantMessage.id)
      yield* AialraTurnTrace.emit({
        phase: "processor.created",
        turnID: input.assistantMessage.parentID,
        sessionID: input.sessionID,
        messageID: input.assistantMessage.id,
        data: {
          providerID: input.model.providerID,
          modelID: input.model.id,
          snapshot: !!initialSnapshot,
        },
      })

      const parse = (e: unknown) =>
        MessageV2.fromError(e, {
          providerID: input.model.providerID,
          aborted,
        })

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        delete ctx.toolcalls[toolCallID]
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return undefined
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          delete ctx.toolcalls[toolCallID]
          return undefined
        }
        return { call, part }
      })

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return undefined
        const part = yield* session.updatePart(update(match.part))
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return part
      })

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: {
          title: string
          metadata: Record<string, any>
          output: string
          attachments?: MessageV2.FilePart[]
        },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return
        const completedAt = Date.now()
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: match.part.state.input,
            output: output.output,
            metadata: ToolResultProtocol.ToolResultSettlement.attach(
              output.metadata,
              ToolResultProtocol.ToolResultSettlement.build({
                sessionID: match.part.sessionID,
                turnID: ctx.assistantMessage.parentID,
                messageID: match.part.messageID,
                environmentID: ctx.activeTurn?.selected_environment_id,
                executorType: match.part.metadata?.providerExecuted === true ? "provider" : "local",
                toolCallID,
                tool: match.part.tool,
                status: hasAbortMetadata(output.metadata) ? "aborted" : "completed",
                startedAt: match.part.state.time.start,
                completedAt,
                output: output.output,
                metadata: output.metadata,
                attachments: output.attachments?.length ?? 0,
                providerExecuted: match.part.metadata?.providerExecuted === true,
                source: match.part.metadata?.providerExecuted === true ? "provider_tool" : "processor",
              }),
            ),
            title: output.title,
            time: { start: match.part.state.time.start, end: completedAt },
            attachments: output.attachments,
          },
        })
        const status = hasAbortMetadata(output.metadata) ? "aborted" : "completed"
        const result = ToolResultProtocol.ToolResultSettlement.build({
          sessionID: match.part.sessionID,
          turnID: ctx.assistantMessage.parentID,
          messageID: match.part.messageID,
          environmentID: ctx.activeTurn?.selected_environment_id,
          executorType: match.part.metadata?.providerExecuted === true ? "provider" : "local",
          toolCallID,
          tool: match.part.tool,
          status,
          startedAt: match.part.state.time.start,
          completedAt,
          output: output.output,
          metadata: output.metadata,
          attachments: output.attachments?.length ?? 0,
          providerExecuted: match.part.metadata?.providerExecuted === true,
          source: match.part.metadata?.providerExecuted === true ? "provider_tool" : "processor",
        })
        yield* AialraTurnTrace.emit({
          phase: "tool.call.finished",
          turnID: ctx.assistantMessage.parentID,
          sessionID: match.part.sessionID,
          messageID: match.part.messageID,
          data: {
            callID: toolCallID,
            tool: match.part.tool,
            status,
            title: output.title,
            outputChars: output.output.length,
            attachments: output.attachments?.length ?? 0,
            resultID: result.resultID,
            abort: status === "aborted" ? output.metadata.abort : undefined,
          },
        })
        yield* ToolResultProtocol.ToolResultSettlement.emit(result)
        yield* settleToolCall(toolCallID)
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (
        toolCallID: string,
        error: unknown,
        providerMetadata?: unknown,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return false
        const status = isAbortLike(error) ? "aborted" : "error"
        const completedAt = Date.now()
        const providerExecution =
          match.part.metadata?.providerExecuted === true
            ? ProviderTool.execution({
                toolCallID,
                tool: match.part.tool,
                kind: "provider_tool_result",
                status: status === "aborted" ? "aborted" : "failed",
                providerMetadata: providerMetadata ?? match.part.metadata,
              })
            : undefined
        const metadata = providerExecution
          ? ProviderTool.attach(status === "aborted" ? { interrupted: true } : undefined, providerExecution)
          : status === "aborted"
            ? { interrupted: true }
            : undefined
        const result = ToolResultProtocol.ToolResultSettlement.build({
          sessionID: match.part.sessionID,
          turnID: ctx.assistantMessage.parentID,
          messageID: match.part.messageID,
          environmentID: ctx.activeTurn?.selected_environment_id,
          executorType: match.part.metadata?.providerExecuted === true ? "provider" : "local",
          toolCallID,
          tool: match.part.tool,
          status: status === "aborted" ? "aborted" : "failed",
          startedAt: match.part.state.time.start,
          completedAt,
          error: errorMessage(error),
          metadata,
          providerExecuted: match.part.metadata?.providerExecuted === true,
          source: match.part.metadata?.providerExecuted === true ? "provider_tool" : "processor",
        })
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "error",
            input: match.part.state.input,
            error: errorMessage(error),
            metadata: ToolResultProtocol.ToolResultSettlement.attach(metadata, result),
            time: { start: match.part.state.time.start, end: completedAt },
          },
        })
        yield* AialraTurnTrace.emit({
          phase: "tool.call.finished",
          turnID: ctx.assistantMessage.parentID,
          sessionID: match.part.sessionID,
          messageID: match.part.messageID,
          data: {
            callID: toolCallID,
            tool: match.part.tool,
            status,
            errorType: error instanceof Error ? error.name : typeof error,
            resultID: result.resultID,
          },
        })
        yield* ToolResultProtocol.ToolResultSettlement.emit(result)
        if (error instanceof Permission.RejectedError || error instanceof Question.RejectedError) {
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        return true
      })

      const abortToolCall = Effect.fn("SessionProcessor.abortToolCall")(function* (toolCallID: string) {
        const match = yield* readToolCall(toolCallID)
        if (!match || (match.part.state.status !== "running" && match.part.state.status !== "pending")) return false
        const end = Date.now()
        const metadata = {
          ...(match.part.state.status === "running" && isRecord(match.part.state.metadata) ? match.part.state.metadata : {}),
          interrupted: true,
        }
        const providerExecution =
          match.part.metadata?.providerExecuted === true
            ? ProviderTool.execution({
                toolCallID,
                tool: match.part.tool,
                kind: "provider_tool_result",
                status: "aborted",
                providerMetadata: match.part.metadata,
              })
            : undefined
        const outputMetadata = providerExecution ? ProviderTool.attach(metadata, providerExecution) : metadata
        const start = match.part.state.status === "running" ? match.part.state.time.start : end
        const result = ToolResultProtocol.ToolResultSettlement.build({
          sessionID: match.part.sessionID,
          turnID: ctx.assistantMessage.parentID,
          messageID: match.part.messageID,
          environmentID: ctx.activeTurn?.selected_environment_id,
          executorType: match.part.metadata?.providerExecuted === true ? "provider" : "local",
          toolCallID,
          tool: match.part.tool,
          status: "aborted",
          startedAt: start,
          completedAt: end,
          error: "Tool execution aborted",
          metadata: outputMetadata,
          providerExecuted: match.part.metadata?.providerExecuted === true,
          source: match.part.metadata?.providerExecuted === true ? "provider_tool" : "cleanup",
        })
        yield* session.updatePart({
          ...match.part,
          state: {
            ...match.part.state,
            status: "error",
            error: "Tool execution aborted",
            metadata: ToolResultProtocol.ToolResultSettlement.attach(outputMetadata, result),
            time: { start, end },
          },
        })
        yield* AialraTurnTrace.emit({
          phase: "tool.call.finished",
          turnID: ctx.assistantMessage.parentID,
          sessionID: match.part.sessionID,
          messageID: match.part.messageID,
          data: {
            callID: toolCallID,
            tool: match.part.tool,
            status: "aborted",
            errorType: "AbortError",
            resultID: result.resultID,
          },
        })
        yield* ToolResultProtocol.ToolResultSettlement.emit(result)
        yield* settleToolCall(toolCallID)
        return true
      })

      const finishReasoning = Effect.fn("SessionProcessor.finishReasoning")(function* (reasoningID: string) {
        if (!(reasoningID in ctx.reasoningMap)) return
        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
        if (flags.experimentalEventSystem) {
          yield* events.publish(SessionEvent.Reasoning.Ended, {
            sessionID: ctx.sessionID,
            reasoningID,
            text: ctx.reasoningMap[reasoningID].text,
            timestamp: DateTime.makeUnsafe(Date.now()),
          })
        }
        // oxlint-disable-next-line no-self-assign -- reactivity trigger
        ctx.reasoningMap[reasoningID].text = ctx.reasoningMap[reasoningID].text
        ctx.reasoningMap[reasoningID].time = { ...ctx.reasoningMap[reasoningID].time, end: Date.now() }
        yield* session.updatePart(ctx.reasoningMap[reasoningID])
        yield* AialraTurnTrace.emit({
          phase: "engineering.reasoning.recorded",
          turnID: ctx.assistantMessage.parentID,
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          data: {
            reasoningID,
            chars: ctx.reasoningMap[reasoningID].text.length,
            metadataKeys: ctx.reasoningMap[reasoningID].metadata ? Object.keys(ctx.reasoningMap[reasoningID].metadata).sort() : [],
            rawPolicy: "encrypted_raw_ref_or_message_part",
          },
        })
        const policy = ctx.activeTurn?.reasoning_summary_policy ?? CodexTurn.defaultReasoningSummaryPolicy()
        const summaryText = policy.enabled && policy.per_turn ? reasoningSummaryText(ctx.reasoningMap[reasoningID].text) : undefined
        yield* AialraTurnTrace.emit({
          phase: "reasoning.summary.created",
          turnID: ctx.assistantMessage.parentID,
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          data: {
            version: "aialra.reasoning_summary.v1",
            reasoningID,
            partID: ctx.reasoningMap[reasoningID].id,
            enabled: policy.enabled,
            level: policy.level,
            auto_collapse: policy.auto_collapse,
            per_turn: policy.per_turn,
            tool_linked: policy.tool_linked,
            policySource: policy.source,
            summary: summaryText,
            summaryChars: summaryText?.length ?? 0,
            sourceChars: ctx.reasoningMap[reasoningID].text.length,
            reason: policy.enabled ? undefined : "reasoning summary policy disabled",
            toolLinks: policy.tool_linked ? (ctx.reasoningToolLinks[reasoningID] ?? []) : [],
            providerMetadataKeys: ctx.reasoningMap[reasoningID].metadata
              ? Object.keys(ctx.reasoningMap[reasoningID].metadata).sort()
              : [],
            rawPolicy: "full reasoning remains in DB message part and raw lab, public event stores summary only",
          },
        })
        delete ctx.reasoningToolLinks[reasoningID]
        delete ctx.reasoningMap[reasoningID]
      })

      const ensureToolCall = Effect.fn("SessionProcessor.ensureToolCall")(function* (input: {
        id: string
        name: string
        providerExecuted?: boolean
        providerMetadata?: unknown
      }) {
        const existing = yield* readToolCall(input.id)
        if (existing) {
          if (!input.providerExecuted || existing.part.metadata?.providerExecuted) return existing
          const execution = ProviderTool.execution({
            toolCallID: input.id,
            tool: input.name,
            kind: "provider_tool_call",
            status: "called",
            providerMetadata: input.providerMetadata,
          })
          const part = yield* session.updatePart({
            ...existing.part,
            metadata: ProviderTool.attach(existing.part.metadata, execution),
          })
          ctx.toolcalls[input.id] = {
            ...existing.call,
            partID: part.id,
            messageID: part.messageID,
            sessionID: part.sessionID,
          }
          return { call: ctx.toolcalls[input.id], part }
        }
        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
        if (flags.experimentalEventSystem) {
          yield* events.publish(SessionEvent.Tool.Input.Started, {
            sessionID: ctx.sessionID,
            callID: input.id,
            name: input.name,
            timestamp: DateTime.makeUnsafe(Date.now()),
          })
        }
        const part = yield* session.updatePart({
          id: PartID.ascending(),
          messageID: ctx.assistantMessage.id,
          sessionID: ctx.assistantMessage.sessionID,
          type: "tool",
          tool: input.name,
          callID: input.id,
          state: { status: "pending", input: {}, raw: "" },
          metadata: input.providerExecuted
            ? ProviderTool.attach(
                undefined,
                ProviderTool.execution({
                  toolCallID: input.id,
                  tool: input.name,
                  kind: "provider_tool_call",
                  status: "called",
                  providerMetadata: input.providerMetadata,
                }),
              )
            : undefined,
        } satisfies MessageV2.ToolPart)
        ctx.toolcalls[input.id] = {
          done: yield* Deferred.make<void>(),
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
          inputEnded: false,
        }
        return { call: ctx.toolcalls[input.id], part }
      })

      const isFilePart = (value: unknown): value is MessageV2.FilePart => Schema.is(MessageV2.FilePart)(value)

      const toolResultOutput = (
        value: Extract<StreamEvent, { type: "tool-result" }>,
      ): { title: string; metadata: Record<string, any>; output: string; attachments?: MessageV2.FilePart[] } => {
        if (isRecord(value.result.value) && typeof value.result.value.output === "string") {
          return {
            title: typeof value.result.value.title === "string" ? value.result.value.title : value.name,
            metadata: isRecord(value.result.value.metadata) ? value.result.value.metadata : {},
            output: value.result.value.output,
            attachments: Array.isArray(value.result.value.attachments)
              ? value.result.value.attachments.filter(isFilePart)
              : undefined,
          }
        }
        return {
          title: value.name,
          metadata: value.result.type === "json" && isRecord(value.result.value) ? value.result.value : {},
          output:
            typeof value.result.value === "string" ? value.result.value : (JSON.stringify(value.result.value) ?? ""),
        }
      }

      const toolInput = (value: unknown): Record<string, any> => (isRecord(value) ? value : { value })

      const reasoningSummaryText = (text: string) => {
        const collapsed = text.replace(/\s+/g, " ").trim()
        if (!collapsed) return "模型返回了推理内容，但内容为空或只有空白字符"
        if (collapsed.length <= 480) return collapsed
        return `${collapsed.slice(0, 477)}...`
      }

      const linkReasoningToTool = (input: {
        callID: string
        tool: string
        phase: "tool-input-start" | "tool-call"
      }) => {
        Object.keys(ctx.reasoningMap).forEach((reasoningID) => {
          const links = ctx.reasoningToolLinks[reasoningID] ?? []
          if (links.some((link) => link.callID === input.callID)) return
          ctx.reasoningToolLinks[reasoningID] = [...links, { ...input, linkedAt: Date.now() }]
        })
      }

      const emitRawResponseItem = (value: StreamEvent, kind: string, extra: Record<string, unknown> = {}) =>
        AialraTurnTrace.emit({
          phase: "model.raw.item",
          turnID: ctx.assistantMessage.parentID,
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          data: {
            schema: "aialra.raw_response_item.v1",
            raw_item_id: `raw_${ctx.assistantMessage.id}_${++ctx.rawResponseSequence}`,
            model_call_id: `model_${ctx.assistantMessage.id}`,
            response_message_id: ctx.assistantMessage.id,
            turn_id: ctx.assistantMessage.parentID,
            session_id: ctx.sessionID,
            providerID: ctx.model.providerID,
            modelID: ctx.model.id,
            sequence: ctx.rawResponseSequence,
            kind,
            normalized_event_type: value.type,
            raw_payload_kind: "provider_stream_event",
            ...extra,
            raw_payload: value,
          },
        })

      const emitReasoningRawItem = (
        value: StreamEvent | undefined,
        kind: "reasoning_start" | "reasoning_delta" | "reasoning_end" | "unsupported",
        extra: Record<string, unknown> = {},
      ) => {
        const sequence = ++ctx.reasoningRawSequence
        if (kind === "unsupported") ctx.reasoningRawUnsupportedEmitted = true
        else ctx.reasoningRawSeen = true
        return AialraTurnTrace.emit({
          phase: "reasoning.raw.item",
          turnID: ctx.assistantMessage.parentID,
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          data: {
            schema: "aialra.reasoning_raw_item.v1",
            reasoning_raw_id: `reasoning_raw_${ctx.assistantMessage.id}_${sequence}`,
            model_call_id: `model_${ctx.assistantMessage.id}`,
            response_message_id: ctx.assistantMessage.id,
            turn_id: ctx.assistantMessage.parentID,
            session_id: ctx.sessionID,
            providerID: ctx.model.providerID,
            modelID: ctx.model.id,
            sequence,
            kind,
            display_policy: kind === "unsupported" ? "unsupported" : "rawRef_only",
            normalized_event_type: value?.type ?? "unsupported",
            raw_payload_kind: value ? "provider_stream_event" : "unsupported_marker",
            ...extra,
            raw_payload: value ?? {
              type: "unsupported",
              reason: typeof extra.reason === "string" ? extra.reason : "provider_emitted_no_reasoning_items",
            },
          },
        })
      }

      const emitReasoningUnsupported = (reason: string) =>
        ctx.reasoningRawSeen || ctx.reasoningRawUnsupportedEmitted
          ? Effect.void
          : emitReasoningRawItem(undefined, "unsupported", {
              reason,
              providerMetadata: undefined,
            })

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        switch (value.type) {
          case "step-start":
            yield* emitRawResponseItem(value, "step_start")
            yield* status.set(ctx.sessionID, { type: "busy" })
            yield* AialraTurnTrace.emit({
              phase: "model.stream.started",
              turnID: ctx.assistantMessage.parentID,
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
            })
            return

          case "reasoning-start":
            yield* emitRawResponseItem(value, "reasoning_start", {
              reasoningID: value.id,
              providerMetadata: value.providerMetadata,
            })
            yield* emitReasoningRawItem(value, "reasoning_start", {
              reasoningID: value.id,
              providerMetadata: value.providerMetadata,
            })
            if (value.id in ctx.reasoningMap) return
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Reasoning.Started, {
                sessionID: ctx.sessionID,
                reasoningID: value.id,
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
            ctx.reasoningMap[value.id] = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.reasoningMap[value.id])
            return

          case "reasoning-delta":
            yield* emitRawResponseItem(value, "reasoning_delta", {
              reasoningID: value.id,
              chars: value.text.length,
              preview: value.text.slice(0, 240),
              providerMetadata: value.providerMetadata,
            })
            yield* emitReasoningRawItem(value, "reasoning_delta", {
              reasoningID: value.id,
              chars: value.text.length,
              preview: value.text.slice(0, 240),
              providerMetadata: value.providerMetadata,
            })
            // Match dev: silently drop orphan deltas (no preceding reasoning-start).
            if (!(value.id in ctx.reasoningMap)) return
            ctx.reasoningMap[value.id].text += value.text
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id].sessionID,
              messageID: ctx.reasoningMap[value.id].messageID,
              partID: ctx.reasoningMap[value.id].id,
              field: "text",
              delta: value.text,
            })
            yield* AialraTurnTrace.emit({
              phase: "model.raw.chunk",
              turnID: ctx.assistantMessage.parentID,
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              data: {
                kind: "reasoning_delta",
                reasoningID: value.id,
                chars: value.text.length,
                preview: value.text.slice(0, 240),
                providerMetadata: value.providerMetadata,
              },
            })
            return

          case "reasoning-end":
            yield* emitRawResponseItem(value, "reasoning_end", {
              reasoningID: value.id,
              providerMetadata: value.providerMetadata,
            })
            yield* emitReasoningRawItem(value, "reasoning_end", {
              reasoningID: value.id,
              providerMetadata: value.providerMetadata,
            })
            if (value.providerMetadata && value.id in ctx.reasoningMap) {
              ctx.reasoningMap[value.id].metadata = value.providerMetadata
            }
            yield* finishReasoning(value.id)
            return

          case "tool-input-start":
            yield* emitRawResponseItem(value, "tool_input_start", {
              callID: value.id,
              tool: value.name,
            })
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            const startedToolCall = yield* ensureToolCall(value)
            linkReasoningToTool({ callID: value.id, tool: value.name, phase: "tool-input-start" })
            yield* AialraTurnTrace.emit({
              phase: "tool.input.started",
              turnID: ctx.assistantMessage.parentID,
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              data: {
                callID: value.id,
                tool: value.name,
                providerExecuted: startedToolCall.part.metadata?.providerExecuted === true,
              },
            })
            return

          case "tool-input-delta":
            yield* emitRawResponseItem(value, "tool_input_delta", {
              callID: value.id,
              chars: value.text.length,
              preview: value.text.slice(0, 240),
            })
            yield* AialraTurnTrace.emit({
              phase: "model.raw.chunk",
              turnID: ctx.assistantMessage.parentID,
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              data: {
                kind: "tool_input_delta",
                callID: value.id,
                chars: value.text.length,
                preview: value.text.slice(0, 240),
              },
            })
            return

          case "tool-input-end": {
            yield* emitRawResponseItem(value, "tool_input_end", {
              callID: value.id,
            })
            const toolCall = yield* ensureToolCall(value)
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Tool.Input.Ended, {
                sessionID: ctx.sessionID,
                callID: value.id,
                text: "",
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
            ctx.toolcalls[value.id] = { ...toolCall.call, inputEnded: true }
            return
          }

          case "tool-call": {
            yield* emitRawResponseItem(value, "tool_call", {
              callID: value.id,
              tool: value.name,
              providerExecuted: value.providerExecuted,
              providerMetadata: value.providerMetadata,
            })
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            const toolCall = yield* ensureToolCall(value)
            linkReasoningToTool({ callID: value.id, tool: value.name, phase: "tool-call" })
            const input = toolInput(value.input)
            if (!toolCall.call.inputEnded) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Tool.Input.Ended, {
                  sessionID: ctx.sessionID,
                  callID: value.id,
                  text: "",
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
            }
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            const providerExecuted = value.providerExecuted === true || toolCall?.part.metadata?.providerExecuted === true
            const providerExecution = providerExecuted
              ? ProviderTool.execution({
                  toolCallID: value.id,
                  tool: value.name,
                  kind: "provider_tool_call",
                  status: "called",
                  providerMetadata: value.providerMetadata,
                })
              : undefined
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Tool.Called, {
                sessionID: ctx.sessionID,
                callID: value.id,
                tool: value.name,
                input,
                provider: {
                  executed: providerExecuted,
                  ...(value.providerMetadata ? { metadata: value.providerMetadata } : {}),
                },
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
            yield* updateToolCall(value.id, (match) => ({
              ...match,
              tool: value.name,
              state:
                match.state.status === "running"
                  ? { ...match.state, input }
                  : {
                      status: "running",
                      input,
                      time: { start: Date.now() },
                    },
              metadata: providerExecution
                ? ProviderTool.attach(isRecord(value.providerMetadata) ? value.providerMetadata : undefined, providerExecution)
                : value.providerMetadata,
            }))
            yield* AialraTurnTrace.emit({
              phase: "tool.call.started",
              turnID: ctx.assistantMessage.parentID,
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              data: {
                callID: value.id,
                tool: value.name,
                inputKeys: AialraTurnTrace.keys(input),
                providerExecuted,
                providerExecution,
              },
            })
            if (providerExecution) {
              yield* AialraTurnTrace.emit({
                phase: "provider.tool.call",
                turnID: ctx.assistantMessage.parentID,
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                data: {
                  schema: "aialra.provider_tool_item.v1",
                  itemKind: "provider_tool_call",
                  executor_type: "provider",
                  provider_tool_type: providerExecution.provider_tool_type,
                  callID: value.id,
                  toolCallID: value.id,
                  tool: value.name,
                  inputKeys: AialraTurnTrace.keys(input),
                  providerExecution,
                  providerMetadata: value.providerMetadata,
                },
              })
            }

            const parts = MessageV2.parts(ctx.assistantMessage.id)
            const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

            if (
              recentParts.length !== DOOM_LOOP_THRESHOLD ||
              !recentParts.every(
                (part) =>
                  part.type === "tool" &&
                  part.tool === value.name &&
                  part.state.status !== "pending" &&
                  JSON.stringify(part.state.input) === JSON.stringify(input),
              )
            ) {
              return
            }

            const agent = yield* agents.get(ctx.assistantMessage.agent)
            yield* permission.ask({
              permission: "doom_loop",
              patterns: [value.name],
              sessionID: ctx.assistantMessage.sessionID,
              turnID: ctx.assistantMessage.parentID,
              requested_by: "processor_guard",
              requested_at: new Date().toISOString(),
              approval_reviewer: { role: "user", id: "current_user", label: "User，当前用户", source: "default" },
              overridden_by_constraints: false,
              metadata: { tool: value.name, input },
              always: [value.name],
              ruleset: agent.permission,
            })
            return
          }

          case "tool-result": {
            const toolCall = yield* readToolCall(value.id)
            yield* emitRawResponseItem(value, "tool_result", {
              callID: value.id,
              tool: value.name,
              resultType: value.result.type,
              providerExecuted: value.providerExecuted === true || toolCall?.part.metadata?.providerExecuted === true,
              providerMetadata: value.providerMetadata,
            })
            const rawOutput = toolResultOutput(value)
            const normalized = yield* Effect.forEach(rawOutput.attachments ?? [], (attachment) =>
              attachment.mime.startsWith("image/")
                ? image.normalize(attachment).pipe(
                    Effect.catchIf(
                      (error) => error instanceof Image.ResizerUnavailableError,
                      () => Effect.succeed(attachment),
                    ),
                    Effect.exit,
                  )
                : Effect.succeed(Exit.succeed<MessageV2.FilePart>(attachment)),
            )
            const omitted = normalized.filter(Exit.isFailure).length
            const attachments = normalized.filter(Exit.isSuccess).map((item) => item.value)
            const output = {
              ...rawOutput,
              output:
                omitted === 0
                  ? rawOutput.output
                  : `${rawOutput.output}\n\n[${omitted} image${omitted === 1 ? "" : "s"} omitted: could not be resized below the image size limit.]`,
              attachments: attachments.length ? attachments : undefined,
            }
            const outputWithRef = Option.isSome(outputStore)
              ? yield* outputStore.value.attach({
                  sessionID: ctx.sessionID,
                  turnID: ctx.assistantMessage.parentID,
                  messageID: ctx.assistantMessage.id,
                  callID: value.id,
                  tool: value.name,
                  result: output,
                })
              : output
            const providerExecuted = value.providerExecuted === true || toolCall?.part.metadata?.providerExecuted === true
            const providerExecution = providerExecuted
              ? ProviderTool.execution({
                  toolCallID: value.id,
                  tool: value.name,
                  kind: "provider_tool_result",
                  status: "completed",
                  providerMetadata: value.providerMetadata,
                  rawOutputRef: isRecord(outputWithRef.metadata.outputRef) ? outputWithRef.metadata.outputRef : undefined,
                  outputChars: outputWithRef.output.length,
                  visibleOutputTruncated: outputWithRef.output.length > 4_000,
                })
              : undefined
            const settledOutput = providerExecution
              ? { ...outputWithRef, metadata: ProviderTool.attach(outputWithRef.metadata, providerExecution) }
              : outputWithRef
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Tool.Success, {
                sessionID: ctx.sessionID,
                callID: value.id,
                structured: settledOutput.metadata,
                content: [
                  {
                    type: "text",
                    text: settledOutput.output,
                  },
                  ...(settledOutput.attachments?.map((item: MessageV2.FilePart) => ({
                    type: "file" as const,
                    uri: item.url,
                    mime: item.mime,
                    name: item.filename,
                  })) ?? []),
                ],
                provider: {
                  executed: providerExecuted,
                },
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
            yield* completeToolCall(value.id, settledOutput)
            if (providerExecution) {
              const settledMetadata = settledOutput.metadata as Record<string, any>
              yield* AialraTurnTrace.emit({
                phase: "provider.tool.result",
                turnID: ctx.assistantMessage.parentID,
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                data: {
                  schema: "aialra.provider_tool_item.v1",
                  itemKind: "provider_tool_result",
                  executor_type: "provider",
                  provider_tool_type: providerExecution.provider_tool_type,
                  callID: value.id,
                  toolCallID: value.id,
                  tool: value.name,
                  status: "completed",
                  resultID: ToolResultProtocol.ToolResultSettlement.resultID(value.id),
                  outputChars: settledOutput.output.length,
                  rawOutputRef: isRecord(settledMetadata.outputRef) ? settledMetadata.outputRef : undefined,
                  providerExecution,
                  providerMetadata: value.providerMetadata,
                },
              })
            }
            return
          }

          case "tool-error": {
            const toolCall = yield* readToolCall(value.id)
            yield* emitRawResponseItem(value, "tool_error", {
              callID: value.id,
              tool: value.name,
              error: value.message,
              providerExecuted: toolCall?.part.metadata?.providerExecuted === true,
              providerMetadata: value.providerMetadata,
            })
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Tool.Failed, {
                sessionID: ctx.sessionID,
                callID: value.id,
                error: {
                  type: "unknown",
                  message: value.message,
                },
                provider: {
                  executed: toolCall?.part.metadata?.providerExecuted === true,
                },
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
            if (toolCall?.part.metadata?.providerExecuted === true) {
              const providerExecution = ProviderTool.execution({
                toolCallID: value.id,
                tool: value.name,
                kind: "provider_tool_result",
                status: "failed",
                providerMetadata: value.providerMetadata,
              })
              yield* AialraTurnTrace.emit({
                phase: "provider.tool.result",
                turnID: ctx.assistantMessage.parentID,
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                data: {
                  schema: "aialra.provider_tool_item.v1",
                  itemKind: "provider_tool_result",
                  executor_type: "provider",
                  provider_tool_type: providerExecution.provider_tool_type,
                  callID: value.id,
                  toolCallID: value.id,
                  tool: value.name,
                  status: "failed",
                  resultID: ToolResultProtocol.ToolResultSettlement.resultID(value.id),
                  error: value.message,
                  providerExecution,
                  providerMetadata: value.providerMetadata,
                },
              })
            }
            yield* failToolCall(value.id, value.error ?? new Error(value.message), value.providerMetadata)
            return
          }

          case "provider-error":
            yield* emitRawResponseItem(value, "provider_error", {
              error: value.message,
            })
            throw new Error(value.message)

          case "step-start":
            if (!ctx.snapshot) ctx.snapshot = yield* snapshot.track()
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Step.Started, {
                  sessionID: ctx.sessionID,
                  agent: input.assistantMessage.agent,
                  model: {
                    id: ModelV2.ID.make(ctx.model.id),
                    providerID: ProviderV2.ID.make(ctx.model.providerID),
                    variant: ModelV2.VariantID.make(input.assistantMessage.variant ?? "default"),
                  },
                  snapshot: ctx.snapshot,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
            }
            yield* AialraTurnTrace.emit({
              phase: "model.step.started",
              turnID: ctx.assistantMessage.parentID,
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              data: {
                agent: input.assistantMessage.agent,
                providerID: ctx.model.providerID,
                modelID: ctx.model.id,
                snapshot: !!ctx.snapshot,
              },
            })
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
            })
            return

          case "step-finish": {
            yield* emitRawResponseItem(value, "step_finish", {
              finish: value.reason,
              providerMetadata: value.providerMetadata,
              usage: value.usage,
            })
            yield* emitReasoningUnsupported("step_finished_without_reasoning_raw")
            const completedSnapshot = yield* snapshot.track()
            yield* Effect.forEach(Object.keys(ctx.reasoningMap), finishReasoning)
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage ?? new Usage({}),
              metadata: value.providerMetadata,
            })
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Step.Ended, {
                  sessionID: ctx.sessionID,
                  finish: value.reason,
                  cost: usage.cost,
                  tokens: usage.tokens,
                  snapshot: completedSnapshot,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
            }
            ctx.assistantMessage.finish = value.reason
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            yield* session.updatePart({
              id: PartID.ascending(),
              reason: value.reason,
              snapshot: completedSnapshot,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              tokens: usage.tokens,
              cost: usage.cost,
            })
            yield* session.updateMessage(ctx.assistantMessage)
            if (ctx.snapshot) {
              const patch = yield* snapshot.patch(ctx.snapshot)
              if (patch.files.length) {
                yield* session.updatePart({
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
              ctx.snapshot = undefined
            }
            yield* summary
              .summarize({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.parentID,
              })
              .pipe(Effect.ignore, Effect.forkIn(scope))
            if (
              !ctx.assistantMessage.summary &&
              isOverflow({ cfg: yield* config.get(), tokens: usage.tokens, model: ctx.model })
            ) {
              ctx.needsCompaction = true
            }
            yield* AialraTurnTrace.emit({
              phase: "model.step.finished",
              turnID: ctx.assistantMessage.parentID,
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              data: {
                finish: value.reason,
                cost: usage.cost,
                tokens: usage.tokens,
                needsCompaction: ctx.needsCompaction,
              },
            })
            return
          }

          case "text-start":
            yield* emitRawResponseItem(value, "assistant_text_start", {
              providerMetadata: value.providerMetadata,
            })
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Text.Started, {
                  sessionID: ctx.sessionID,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
            }
            ctx.currentText = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.currentText)
            yield* AialraTurnTrace.emit({
              phase: "text.started",
              turnID: ctx.assistantMessage.parentID,
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
            })
            return

          case "text-delta":
            yield* emitRawResponseItem(value, "assistant_text_delta", {
              chars: value.text.length,
              preview: value.text.slice(0, 240),
              providerMetadata: value.providerMetadata,
            })
            if (!ctx.currentText) return
            ctx.currentText.text += value.text
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: "text",
              delta: value.text,
            })
            yield* AialraTurnTrace.emit({
              phase: "model.raw.chunk",
              turnID: ctx.assistantMessage.parentID,
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              data: {
                kind: "assistant_text_delta",
                partID: ctx.currentText.id,
                chars: value.text.length,
                preview: value.text.slice(0, 240),
                providerMetadata: value.providerMetadata,
              },
            })
            return

          case "text-end":
            yield* emitRawResponseItem(value, "assistant_text_end", {
              providerMetadata: value.providerMetadata,
            })
            if (!ctx.currentText) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.currentText.text = ctx.currentText.text
            ctx.currentText.text = (yield* plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                partID: ctx.currentText.id,
              },
              { text: ctx.currentText.text },
            )).text
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Text.Ended, {
                  sessionID: ctx.sessionID,
                  text: ctx.currentText.text,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
            }
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePart(ctx.currentText)
            yield* AialraTurnTrace.emit({
              phase: "text.finished",
              turnID: ctx.assistantMessage.parentID,
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              data: {
                chars: ctx.currentText.text.length,
              },
            })
            ctx.currentText = undefined
            return

          case "finish":
            yield* emitRawResponseItem(value, "finish")
            yield* emitReasoningUnsupported("stream_finished_without_reasoning_raw")
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        if (ctx.snapshot) {
          const patch = yield* snapshot.patch(ctx.snapshot)
          if (patch.files.length) {
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
          }
          ctx.snapshot = undefined
        }

        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* session.updatePart(ctx.currentText)
          ctx.currentText = undefined
        }

        yield* Effect.forEach(Object.keys(ctx.reasoningMap), finishReasoning)
        ctx.reasoningToolLinks = {}

        yield* Effect.forEach(
          Object.values(ctx.toolcalls),
          (call) => Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore),
          { concurrency: "unbounded" },
        )

        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          yield* abortToolCall(toolCallID)
        }
        ctx.toolcalls = {}
        ctx.assistantMessage.time.completed = Date.now()
        yield* session.updateMessage(ctx.assistantMessage)
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        slog.error("process", { error: errorMessage(e), stack: e instanceof Error ? e.stack : undefined })
        const error = parse(e)
        if (MessageV2.ContextOverflowError.isInstance(error)) {
          ctx.needsCompaction = true
          yield* bus.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
          return
        }
        if (!ctx.assistantMessage.summary) {
          // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
          if (flags.experimentalEventSystem) {
            yield* events.publish(SessionEvent.Step.Failed, {
              sessionID: ctx.sessionID,
              error: {
                type: "unknown",
                message: errorMessage(e),
              },
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
          }
        }
        ctx.assistantMessage.error = error
        yield* AialraTurnTrace.emit({
          phase: "processor.halted",
          turnID: ctx.assistantMessage.parentID,
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          data: {
            errorType: e instanceof Error ? e.name : typeof e,
            aborted,
          },
        })
        yield* bus.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
        })
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
        slog.info("process")
        ctx.needsCompaction = false
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true
        const retry = streamInput.retry ?? CodexTurn.retryConfig({ modelOptions: streamInput.model.options })
        yield* AialraTurnTrace.emit({
          phase: "processor.process.started",
          turnID: ctx.assistantMessage.parentID,
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          data: {
            agent: streamInput.agent.name,
            providerID: streamInput.model.providerID,
            modelID: streamInput.model.id,
            systemCount: streamInput.system.length,
            messageCount: streamInput.messages.length,
            toolCount: Object.keys(streamInput.tools).length,
            toolChoice: streamInput.toolChoice,
            request_max_retries: retry.request_max_retries,
            stream_max_retries: retry.stream_max_retries,
            stream_idle_timeout_ms: retry.stream_idle_timeout_ms,
          },
        })

        const result = yield* Effect.gen(function* () {
          let lastRetryKind: "request" | "stream" = "request"
          yield* Effect.gen(function* () {
            ctx.currentText = undefined
            ctx.reasoningMap = {}
            ctx.reasoningToolLinks = {}
            let sawTerminal = false
            yield* status.set(ctx.sessionID, { type: "busy" })
            const stream = llm.stream({
              ...streamInput,
              retries: 0,
            })

            const turn = streamInput.turn
            ctx.activeTurn = turn
            yield* stream.pipe(
              Stream.tap((event) =>
                Effect.gen(function* () {
                  const runtimeItem = RuntimeProtocol.RuntimeItem.fromLLMEvent(event, ++ctx.runtimeItemSequence)
                  yield* AialraTurnTrace.emit({
                    phase: "runtime.item.received",
                    turnID: ctx.assistantMessage.parentID,
                    sessionID: ctx.sessionID,
                    messageID: ctx.assistantMessage.id,
                    data: runtimeItem,
                  })
                  if (event.type === "finish" || event.type === "step-finish") sawTerminal = true
                  if (
                    event.type === "text-delta" ||
                    event.type === "reasoning-delta" ||
                    event.type === "tool-call" ||
                    event.type === "tool-result"
                  ) {
                    if (turn && turn.timeToFirstTokenMs === undefined) {
                      turn.timeToFirstTokenMs = Math.max(0, Date.now() - turn.startedAt)
                    }
                  }
                  yield* handleEvent(event)
                  if (RuntimeProtocol.RuntimeItem.shouldEmitSettled(runtimeItem)) {
                    yield* AialraTurnTrace.emit({
                      phase: "runtime.item.settled",
                      turnID: ctx.assistantMessage.parentID,
                      sessionID: ctx.sessionID,
                      messageID: ctx.assistantMessage.id,
                      data: runtimeItem,
                    })
                  }
                }),
              ),
              Stream.takeUntil(() => ctx.needsCompaction),
              Stream.runDrain,
            )
            if (!ctx.needsCompaction && !sawTerminal && !ctx.assistantMessage.error) {
              throw new StreamRetryableError("Model stream closed before completion")
            }
          }).pipe(
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterrupts(cause),
              (cause) =>
                Effect.gen(function* () {
                  const error = Cause.squash(cause)
                  const message = error instanceof Error ? error.message : String(error)
                  if (error instanceof StreamRetryableError) return yield* Effect.fail(error)
                  const shouldWrapStreamError =
                    message.toLowerCase().includes("timeout") ||
                    message.toLowerCase().includes("timed out") ||
                    message.toLowerCase().includes("stream") ||
                    message.toLowerCase().includes("connection")
                  if (shouldWrapStreamError) {
                    return yield* Effect.fail(new StreamRetryableError(message || "Model stream failed", error))
                  }
                  return yield* Effect.fail(error)
                }),
            ),
          ).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterrupts(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.retry(
              SessionRetry.policy({
                provider: input.model.providerID,
                parse,
                maxAttempts: (error) => {
                  if (isAbortLike(error)) return 0
                  lastRetryKind = error instanceof StreamRetryableError ? "stream" : "request"
                  return lastRetryKind === "stream" ? retry.stream_max_retries : retry.request_max_retries
                },
                retryableRaw: (error) => {
                  if (!(error instanceof StreamRetryableError)) return undefined
                  lastRetryKind = "stream"
                  return { message: error.message }
                },
                set: (info) => {
                  const kind = lastRetryKind
                  // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
                  const event = flags.experimentalEventSystem
                    ? events.publish(SessionEvent.Retried, {
                        sessionID: ctx.sessionID,
                        attempt: info.attempt,
                        error: {
                          message: info.message,
                          isRetryable: true,
                        },
                        timestamp: DateTime.makeUnsafe(Date.now()),
                      })
                    : Effect.void
                  return event.pipe(
                    Effect.andThen(
                      AialraTurnTrace.emit({
                        phase: kind === "stream" ? "model.stream.retrying" : "model.request.retrying",
                        turnID: ctx.assistantMessage.parentID,
                        sessionID: ctx.sessionID,
                        messageID: ctx.assistantMessage.id,
                        data: {
                          attempt: info.attempt,
                          message: info.message,
                          next: info.next,
                          maxAttempts:
                            kind === "stream" ? retry.stream_max_retries : retry.request_max_retries,
                        },
                      }),
                    ),
                    Effect.andThen(
                      status.set(ctx.sessionID, {
                        type: "retry",
                        attempt: info.attempt,
                        message: info.message,
                        action: info.action,
                        next: info.next,
                      }),
                    ),
                  )
                },
              }),
            ),
            Effect.catch(halt),
            Effect.ensuring(cleanup()),
          )

          if (ctx.needsCompaction) return "compact"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
        yield* AialraTurnTrace.emit({
          phase: "processor.process.finished",
          turnID: ctx.assistantMessage.parentID,
          sessionID: ctx.sessionID,
          messageID: ctx.assistantMessage.id,
          data: {
            result,
            finish: ctx.assistantMessage.finish,
            needsCompaction: ctx.needsCompaction,
            blocked: ctx.blocked,
            hasError: !!ctx.assistantMessage.error,
          },
        })
        return result
      })

      return {
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        completeToolCall,
        process,
      } satisfies Handle
    })

    return Service.of({ create })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(LLM.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
  ),
)

export * as SessionProcessor from "./processor"

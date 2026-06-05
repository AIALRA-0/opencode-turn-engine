import { Bus } from "@/bus"
import { PublicEventLog, type PublicEvent } from "@/session/public-event"
import { Session } from "@/session/session"
import { TurnHistory } from "@/session/turn-history"
import type { SessionID } from "@/session/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
import fs from "fs"
import os from "os"
import path from "path"
import crypto from "crypto"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import * as Sse from "effect/unstable/encoding/Sse"
import { EventApi } from "../groups/event"

const log = Log.create({ service: "server" })

function eventData(data: unknown): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: undefined,
    data: JSON.stringify(data),
  }
}

function publicEventData(data: PublicEvent): Sse.Event {
  return {
    _tag: "Event",
    event: "message",
    id: data.id,
    data: JSON.stringify(data),
  }
}

function publicEventPing(): Sse.Event {
  return {
    _tag: "Event",
    event: "ping",
    id: undefined,
    data: JSON.stringify({ type: "ping", ts: new Date().toISOString() }),
  }
}

function eventResponse(bus: Bus.Interface) {
  return Effect.gen(function* () {
    // Subscribe eagerly: the bus subscription is acquired in the request scope
    // at this yield, so any publish from now on is queued for the body-pump
    // fiber to drain — closing the race where Stream.concat(server.connected,
    // lazy-subscribe) used to drop publishes in the prefix-consume window.
    const events = (yield* bus.subscribeAll()).pipe(
      Stream.takeUntil((event) => event.type === Bus.InstanceDisposed.type),
    )
    const heartbeat = Stream.tick("10 seconds").pipe(
      Stream.drop(1),
      Stream.map(() => ({ id: Bus.createID(), type: "server.heartbeat", properties: {} })),
    )

    log.info("event connected")
    return HttpServerResponse.stream(
      Stream.make({ id: Bus.createID(), type: "server.connected", properties: {} }).pipe(
        Stream.concat(events.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }))),
        Stream.map(eventData),
        Stream.pipeThroughChannel(Sse.encode()),
        Stream.encodeText,
        Stream.ensuring(Effect.sync(() => log.info("event disconnected"))),
      ),
      {
        contentType: "text/event-stream",
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        },
      },
    )
  })
}

function lastEventID(request: HttpServerRequest.HttpServerRequest) {
  const header = request.headers["last-event-id"]
  if (Array.isArray(header)) return header[0]
  if (typeof header === "string" && header) return header
  try {
    return new URL(request.url, "http://localhost").searchParams.get("lastEventID") ?? undefined
  } catch {
    return undefined
  }
}

function publicEventResponse(input: {
  request: HttpServerRequest.HttpServerRequest
  sessionID?: string
}) {
  const afterID = lastEventID(input.request)
  let cursor = PublicEventLog.get(afterID ?? "")?.sequence ?? 0
  const replay = PublicEventLog.list({ sessionID: input.sessionID, afterSequence: cursor })
  if (replay.length) cursor = replay.at(-1)?.sequence ?? cursor

  const live = Stream.tick("500 millis").pipe(
    Stream.drop(1),
    Stream.flatMap(() => {
      const next = PublicEventLog.list({ sessionID: input.sessionID, afterSequence: cursor })
      if (next.length) cursor = next.at(-1)?.sequence ?? cursor
      return Stream.fromIterable(next)
    }),
  )
  const heartbeat = Stream.tick("20 seconds").pipe(Stream.drop(1), Stream.map(publicEventPing))

  log.info("public event connected", { sessionID: input.sessionID })
  return HttpServerResponse.stream(
    Stream.make(publicEventPing()).pipe(
      Stream.concat(
        Stream.fromIterable(replay).pipe(
          Stream.concat(live),
          Stream.map(publicEventData),
          Stream.merge(heartbeat, { haltStrategy: "left" }),
        ),
      ),
      Stream.pipeThroughChannel(Sse.encode()),
      Stream.encodeText,
      Stream.ensuring(Effect.sync(() => log.info("public event disconnected", { sessionID: input.sessionID }))),
    ),
    {
      contentType: "text/event-stream",
      headers: {
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
        "X-Content-Type-Options": "nosniff",
      },
    },
  )
}

function traceFile(sessionID: string) {
  const dir = process.env.AIALRA_TURN_TRACE_DIR || path.join(os.tmpdir(), "opencode-turn-traces")
  return path.join(dir, `${sessionID.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 128) || "unknown"}.jsonl`)
}

function readTraceRecords(sessionID: string) {
  const file = traceFile(sessionID)
  if (!fs.existsSync(file)) return []
  return fs
    .readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .slice(-2000)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown]
      } catch {
        return [{ parseError: true, line }]
      }
    })
}

function messagePartRecords(messages: ReadonlyArray<{ info: { id: string; role: string }; parts: ReadonlyArray<unknown> }>) {
  return messages.flatMap((message) =>
    message.parts.map((part, index) => ({
      messageID: message.info.id,
      role: message.info.role,
      index,
      part,
    })),
  )
}

function rawBundleFilters(request: HttpServerRequest.HttpServerRequest) {
  const params = new URL(request.url, "http://localhost").searchParams
  return {
    turnID: params.get("turnID") ?? undefined,
    threadID: params.get("threadID") ?? undefined,
    toolCallID: params.get("toolCallID") ?? undefined,
    modelCallID: params.get("modelCallID") ?? undefined,
  }
}

function filterPublicEvents(events: PublicEvent[], filters: ReturnType<typeof rawBundleFilters>) {
  return events.filter((event) => {
    if (filters.turnID && event.turnID !== filters.turnID) return false
    if (filters.threadID && event.threadID !== filters.threadID) return false
    if (filters.toolCallID) {
      const toolCallID = event.toolCallID ?? String(event.data.tool_call_id ?? event.data.callID ?? "")
      if (toolCallID !== filters.toolCallID) return false
    }
    if (filters.modelCallID) {
      const modelCallID = String(event.data.model_call_id ?? event.data.modelCallID ?? "")
      if (modelCallID !== filters.modelCallID) return false
    }
    return true
  })
}

function sha256(input: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex")
}

function rawPayloadRecords(input: { sessionID: string; publicEvents: PublicEvent[] }) {
  return input.publicEvents.filter((event) => event.rawRef).map((event) => {
    const raw = PublicEventLog.readRaw({ sessionID: input.sessionID, eventID: event.id })
    return {
      eventID: event.id,
      type: event.type,
      payloadSchema: event.payloadSchema,
      rawRef: event.rawRef,
      redactionStatus: "redacted_by_public_event_store",
      hash: sha256(raw ?? null),
      raw,
      normalizedMapping: {
        source: event.source,
        threadID: event.threadID,
        turnID: event.turnID,
        messageID: event.messageID,
        toolCallID: event.toolCallID ?? (String(event.data.tool_call_id ?? event.data.callID ?? "") || undefined),
        modelCallID: String(event.data.model_call_id ?? event.data.modelCallID ?? "") || undefined,
        status: event.status,
      },
    }
  })
}

function countBy<T extends string>(values: T[]) {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1
    return acc
  }, {})
}

function rawLabGroups(input: { publicEvents: PublicEvent[]; rawPayloads: ReturnType<typeof rawPayloadRecords> }) {
  const turnIDs = input.publicEvents.flatMap((event) => (event.turnID ? [event.turnID] : []))
  const modelCallIDs = input.rawPayloads.flatMap((record) =>
    record.normalizedMapping.modelCallID ? [record.normalizedMapping.modelCallID] : [],
  )
  const toolCallIDs = input.publicEvents.flatMap((event) => {
    const toolCallID = event.toolCallID ?? (String(event.data.tool_call_id ?? event.data.callID ?? "") || undefined)
    return toolCallID ? [toolCallID] : []
  })
  return {
    byTurn: Object.entries(countBy(turnIDs)).map(([turnID, eventCount]) => ({
      turnID,
      eventCount,
      rawRefCount: input.rawPayloads.filter((record) => record.normalizedMapping.turnID === turnID).length,
      types: Object.keys(countBy(input.publicEvents.filter((event) => event.turnID === turnID).map((event) => event.type))).sort(),
    })),
    byType: Object.entries(countBy(input.publicEvents.map((event) => event.type))).map(([type, eventCount]) => ({
      type,
      eventCount,
      rawRefCount: input.rawPayloads.filter((record) => record.type === type).length,
    })),
    bySource: Object.entries(countBy(input.publicEvents.map((event) => event.source))).map(([source, eventCount]) => ({
      source,
      eventCount,
    })),
    modelCalls: Object.entries(countBy(modelCallIDs)).map(([modelCallID, rawRefCount]) => ({
      modelCallID,
      rawRefCount,
      eventTypes: Object.keys(
        countBy(
          input.rawPayloads
            .filter((record) => record.normalizedMapping.modelCallID === modelCallID)
            .map((record) => record.type),
        ),
      ).sort(),
    })),
    toolCalls: Object.entries(countBy(toolCallIDs)).map(([toolCallID, eventCount]) => ({
      toolCallID,
      eventCount,
      rawRefCount: input.rawPayloads.filter((record) => record.normalizedMapping.toolCallID === toolCallID).length,
    })),
  }
}

function filename(input: { sessionID: string; filters: ReturnType<typeof rawBundleFilters> }) {
  const scope = input.filters.turnID ?? input.filters.threadID ?? input.filters.toolCallID ?? input.filters.modelCallID ?? "session"
  return `aialra-raw-bundle-${input.sessionID}-${scope}.json`.replace(/[^a-zA-Z0-9._-]/g, "_")
}

export const eventHandlers = HttpApiBuilder.group(EventApi, "event", (handlers) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const session = yield* Session.Service
    return handlers.handleRaw(
      "subscribe",
      Effect.fn("EventHttpApi.subscribe")(function* () {
        return yield* eventResponse(bus)
      }),
    )
      .handleRaw(
        "subscribePublic",
        Effect.fn("EventHttpApi.subscribePublic")(function* (ctx: {
          request: HttpServerRequest.HttpServerRequest
        }) {
          return publicEventResponse({ request: ctx.request })
        }),
      )
      .handleRaw(
        "sessionPublic",
        Effect.fn("EventHttpApi.sessionPublic")(function* (ctx: {
          params: { sessionID: string }
          request: HttpServerRequest.HttpServerRequest
        }) {
          return publicEventResponse({ request: ctx.request, sessionID: ctx.params.sessionID })
        }),
      )
      .handleRaw(
        "sessionPublicRaw",
        Effect.fn("EventHttpApi.sessionPublicRaw")(function* (ctx: {
          params: { sessionID: string; eventID: string }
        }) {
          try {
            const raw = PublicEventLog.readRaw({
              sessionID: ctx.params.sessionID,
              eventID: ctx.params.eventID,
            })
            if (raw === undefined) {
              return HttpServerResponse.jsonUnsafe({ error: "raw event not found" }, { status: 404 })
            }
            return HttpServerResponse.jsonUnsafe({
              schema: "aialra.public_event_raw_response.v1",
              eventID: ctx.params.eventID,
              raw,
            })
          } catch (error) {
            return HttpServerResponse.jsonUnsafe(
              { error: error instanceof Error ? error.message : String(error) },
              { status: 500 },
            )
          }
        }),
      )
      .handleRaw(
        "sessionRawLab",
        Effect.fn("EventHttpApi.sessionRawLab")(function* (ctx: { params: { sessionID: string } }) {
          try {
            const messages = yield* session
              .messages({ sessionID: ctx.params.sessionID as SessionID })
              .pipe(Effect.orElseSucceed(() => []))
            const publicEvents = PublicEventLog.list({ sessionID: ctx.params.sessionID }).slice(-1000)
            const turnHistory = TurnHistory.list({ sessionID: ctx.params.sessionID })
            const traceRecords = readTraceRecords(ctx.params.sessionID)
            const parts = messagePartRecords(messages)
            const rawPayloads = rawPayloadRecords({ sessionID: ctx.params.sessionID, publicEvents })
            const groups = rawLabGroups({ publicEvents, rawPayloads })
            return HttpServerResponse.jsonUnsafe({
              schema: "aialra.raw_lab.v1",
              sessionID: ctx.params.sessionID,
              generatedAt: new Date().toISOString(),
              summary: {
                eventCount: publicEvents.length,
                rawRefCount: rawPayloads.length,
                turnCount: groups.byTurn.length,
                modelCallCount: groups.modelCalls.length,
                toolCallCount: groups.toolCalls.length,
                traceRecordCount: traceRecords.length,
                historyCount: turnHistory.length,
                messageCount: messages.length,
                partCount: parts.length,
              },
              sources: {
                modelRequestRaw: "通过 model.request.started / rawRef 查看",
                providerStreamChunks: "通过 model.raw.chunk / rawRef 查看",
                reasoningDelta: "通过 model.raw.chunk kind=reasoning_delta 查看",
                assistantTextDelta: "通过 model.raw.chunk kind=assistant_text_delta 查看",
                toolInputRaw: "通过 tool.call.started 或 DB part JSON 查看",
                toolOutputRaw: "通过 tool.call.finished、command.output 或 DB part JSON 查看",
                internalTraceJSONL: traceFile(ctx.params.sessionID),
                dbMessageJSON: "messages[]",
                dbPartJSON: "parts[]",
                publicEventRawRef: "publicEvents[].rawRef",
              },
              replay: {
                publicEventSSE: `/session/${ctx.params.sessionID}/events/public`,
                lastEventID: publicEvents.at(-1)?.id,
                note: "把 Last-Event-ID 设为某个 public event id，可以从该事件之后继续重放",
              },
              groups,
              publicEvents,
              turnHistory,
              rawRefs: publicEvents.filter((event) => event.rawRef).map((event) => ({
                eventID: event.id,
                type: event.type,
                rawRef: event.rawRef,
              })),
              rawPayloads,
              normalizedMappings: rawPayloads.map((record) => ({
                eventID: record.eventID,
                type: record.type,
                rawRef: record.rawRef,
                hash: record.hash,
                normalizedMapping: record.normalizedMapping,
              })),
              traceRecords,
              messages,
              parts,
            })
          } catch (error) {
            return HttpServerResponse.jsonUnsafe(
              { error: error instanceof Error ? error.message : String(error) },
              { status: 500 },
            )
          }
        }),
      )
      .handleRaw(
        "sessionRawDownload",
        Effect.fn("EventHttpApi.sessionRawDownload")(function* (ctx: {
          params: { sessionID: string }
          request: HttpServerRequest.HttpServerRequest
        }) {
          try {
            const filters = rawBundleFilters(ctx.request)
            const messages = yield* session
              .messages({ sessionID: ctx.params.sessionID as SessionID })
              .pipe(Effect.orElseSucceed(() => []))
            const publicEvents = filterPublicEvents(
              PublicEventLog.list({ sessionID: ctx.params.sessionID }).slice(-5000),
              filters,
            )
            const rawPayloads = rawPayloadRecords({ sessionID: ctx.params.sessionID, publicEvents })
            const history = TurnHistory.list({ sessionID: ctx.params.sessionID }).filter((record) => {
              if (filters.turnID && record.turnID !== filters.turnID) return false
              if (filters.threadID && record.turnID !== filters.threadID) return false
              return true
            })
            const bundle = {
              schema: "aialra.raw_bundle.v1",
              manifest: {
                schema: "aialra.raw_bundle_manifest.v1",
                sessionID: ctx.params.sessionID,
                generatedAt: new Date().toISOString(),
                filters,
                hashAlgorithm: "sha256",
                hash: "",
                eventCount: publicEvents.length,
                rawPayloadCount: rawPayloads.length,
                historyCount: history.length,
                traceRecordCount: readTraceRecords(ctx.params.sessionID).length,
                messageCount: messages.length,
                partCount: messagePartRecords(messages).length,
                redactionStatus: "safe_public_events_plus_redacted_raw_payloads",
              },
              sources: {
                publicEvents: "publicEvents[]",
                rawPayloads: "rawPayloads[]",
                turnHistory: "turnHistory[]",
                traceRecords: "traceRecords[]",
                dbMessages: "messages[]",
                dbParts: "parts[]",
              },
              publicEvents,
              rawPayloads,
              groups: rawLabGroups({ publicEvents, rawPayloads }),
              turnHistory: history,
              traceRecords: readTraceRecords(ctx.params.sessionID),
              messages,
              parts: messagePartRecords(messages),
            }
            const body = JSON.stringify(
              { ...bundle, manifest: { ...bundle.manifest, hash: sha256({ ...bundle, manifest: { ...bundle.manifest, hash: "" } }) } },
              null,
              2,
            )
            return HttpServerResponse.raw(body, {
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "Content-Disposition": `attachment; filename="${filename({ sessionID: ctx.params.sessionID, filters })}"`,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
              },
            })
          } catch (error) {
            return HttpServerResponse.jsonUnsafe(
              { error: error instanceof Error ? error.message : String(error) },
              { status: 500 },
            )
          }
        }),
      )
  }),
)

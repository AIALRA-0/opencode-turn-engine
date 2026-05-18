import { Bus } from "@/bus"
import { PublicEventLog, type PublicEvent } from "@/session/public-event"
import * as Log from "@opencode-ai/core/util/log"
import { Effect } from "effect"
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
    const context = yield* Effect.context()

    const events = bus.subscribeAll().pipe(
      Stream.provideContext(context),
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

export const eventHandlers = HttpApiBuilder.group(EventApi, "event", (handlers) =>
  Effect.gen(function* () {
    const bus = yield* Bus.Service
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
  }),
)

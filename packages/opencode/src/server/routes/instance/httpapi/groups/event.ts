import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, HttpApiSchema, OpenApi } from "effect/unstable/httpapi"
import { Authorization } from "../middleware/authorization"
import { InstanceContextMiddleware } from "../middleware/instance-context"
import { WorkspaceRoutingMiddleware, WorkspaceRoutingQuery } from "../middleware/workspace-routing"

export const EventPaths = {
  event: "/event",
  publicEvent: "/event/public",
  sessionPublicEvents: "/session/:sessionID/events/public",
  sessionPublicEventRaw: "/session/:sessionID/events/:eventID/raw",
  sessionRawLab: "/session/:sessionID/raw-lab",
  sessionRawDownload: "/session/:sessionID/raw-lab/download",
} as const

export const EventApi = HttpApi.make("event").add(
  HttpApiGroup.make("event")
    .add(
      HttpApiEndpoint.get("subscribe", EventPaths.event, {
        query: WorkspaceRoutingQuery,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "event.subscribe",
          summary: "Subscribe to events",
          description: "Get events",
        }),
      ),
      HttpApiEndpoint.get("subscribePublic", EventPaths.publicEvent, {
        query: WorkspaceRoutingQuery,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "event.subscribePublic",
          summary: "Subscribe to public turn events",
          description: "Get user-readable public turn events.",
        }),
      ),
      HttpApiEndpoint.get("sessionPublic", EventPaths.sessionPublicEvents, {
        params: { sessionID: Schema.String },
        query: WorkspaceRoutingQuery,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "text/event-stream" })),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "event.sessionPublic",
          summary: "Subscribe to public session events",
          description: "Get user-readable public turn events for one session.",
        }),
      ),
      HttpApiEndpoint.get("sessionPublicRaw", EventPaths.sessionPublicEventRaw, {
        params: { sessionID: Schema.String, eventID: Schema.String },
        query: WorkspaceRoutingQuery,
        success: Schema.Any,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "event.sessionPublicRaw",
          summary: "Read encrypted raw event payload",
          description: "Read the raw payload for one public event after auth checks.",
        }),
      ),
      HttpApiEndpoint.get("sessionRawLab", EventPaths.sessionRawLab, {
        params: { sessionID: Schema.String },
        query: WorkspaceRoutingQuery,
        success: Schema.Any,
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "event.sessionRawLab",
          summary: "Read unified raw lab data",
          description: "Read public events, raw references, trace JSONL, and DB message/part JSON for one session.",
        }),
      ),
      HttpApiEndpoint.get("sessionRawDownload", EventPaths.sessionRawDownload, {
        params: { sessionID: Schema.String },
        query: WorkspaceRoutingQuery,
        success: Schema.String.pipe(HttpApiSchema.asText({ contentType: "application/json" })),
      }).annotateMerge(
        OpenApi.annotations({
          identifier: "event.sessionRawDownload",
          summary: "Download unified raw audit bundle",
          description: "Download public events, raw payloads, trace JSONL, turn history, and DB message/part JSON as one audit bundle.",
        }),
      ),
    )
    .middleware(InstanceContextMiddleware)
    .middleware(WorkspaceRoutingMiddleware)
    .middleware(Authorization)
    .annotateMerge(OpenApi.annotations({ title: "event", description: "Instance event stream route." })),
)

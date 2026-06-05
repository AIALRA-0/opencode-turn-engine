import crypto from "node:crypto"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Command } from "@/command"
import { Permission } from "@/permission"
import { PermissionID } from "@/permission/schema"
import { SessionShare } from "@/share/session"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { MessageV2 } from "@/session/message-v2"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { SessionSecurity, SecurityUpdatePayload } from "@/session/security"
import { ExecProcessRegistry } from "@/session/exec-process-registry"
import { PublicEventLog } from "@/session/public-event"
import { AialraTurnTrace } from "@/session/turn-trace"
import { AbortAudit } from "@/session/abort-audit"
import { Todo } from "@/session/todo"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { NamedError } from "@opencode-ai/core/util/error"
import { Cause, Effect, Option, Schema, Scope } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError, HttpApiSchema } from "effect/unstable/httpapi"
import { InstanceHttpApi } from "../api"
import {
  CommandPayload,
  CleanupProcessesPayload,
  AbortQuery,
  DiffQuery,
  ForkPayload,
  HandoffQuery,
  InitPayload,
  ListQuery,
  MessagesQuery,
  PermissionResponsePayload,
  PromptPayload,
  RevertPayload,
  ShellPayload,
  SummarizePayload,
  UpdatePayload,
} from "../groups/session"
import { PermissionNotFoundError } from "../errors"
import * as SessionError from "./session-errors"

const tryParseJson = (text: string) =>
  Effect.try({
    try: () => JSON.parse(text) as unknown,
    catch: () => new HttpApiError.BadRequest({}),
  })

export const sessionHandlers = HttpApiBuilder.group(InstanceHttpApi, "session", (handlers) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    const shareSvc = yield* SessionShare.Service
    const promptSvc = yield* SessionPrompt.Service
    const revertSvc = yield* SessionRevert.Service
    const compactSvc = yield* SessionCompaction.Service
    const runState = yield* SessionRunState.Service
    const agentSvc = yield* Agent.Service
    const permissionSvc = yield* Permission.Service
    const statusSvc = yield* SessionStatus.Service
    const todoSvc = yield* Todo.Service
    const summary = yield* SessionSummary.Service
    const bus = yield* Bus.Service
    const scope = yield* Scope.Scope

    const list = Effect.fn("SessionHttpApi.list")(function* (ctx: { query: typeof ListQuery.Type }) {
      return yield* session.list({
        directory: ctx.query.scope === "project" ? undefined : ctx.query.directory,
        scope: ctx.query.scope,
        path: ctx.query.path,
        roots: ctx.query.roots,
        start: ctx.query.start,
        search: ctx.query.search,
        limit: ctx.query.limit,
      })
    })

    const status = Effect.fn("SessionHttpApi.status")(function* () {
      return Object.fromEntries(yield* statusSvc.list())
    })

    const requireSession = Effect.fn("SessionHttpApi.requireSession")(function* (sessionID: SessionID) {
      return yield* SessionError.mapStorageNotFound(session.get(sessionID))
    })

    const reconcileStaleRunningTools = Effect.fn("SessionHttpApi.reconcileStaleRunningTools")(function* (
      sessionID: SessionID,
      messages: MessageV2.WithParts[],
    ) {
      if ((yield* statusSvc.get(sessionID)).type !== "idle") return messages
      const now = Date.now()
      return yield* Effect.forEach(
        messages,
        Effect.fnUntraced(function* (message) {
          const parts = yield* Effect.forEach(
            message.parts,
            Effect.fnUntraced(function* (part) {
              if (part.type !== "tool" || part.state.status !== "running") return part
              if (now - part.state.time.start < 60_000) return part
              const updated: MessageV2.ToolPart = {
                ...part,
                state: {
                  status: "error",
                  input: part.state.input,
                  error:
                    "这个工具调用已经没有对应的后端运行进程，系统已把它收口为中断。常见原因是服务重启、执行器断开，或长命令进程已经退出但状态没有写回。",
                  metadata: {
                    ...part.state.metadata,
                    reconciled: true,
                    reason: "stale_running_tool",
                  },
                  time: {
                    start: part.state.time.start,
                    end: now,
                  },
                },
              }
              yield* session.updatePart(updated)
              yield* AialraTurnTrace.emit({
                phase: "turn.terminal.reconciled",
                turnID: message.info.role === "assistant" ? message.info.parentID : undefined,
                sessionID,
                messageID: message.info.id,
                data: {
                  outcome: "stale_running_tool_marked_error",
                  tool: part.tool,
                  callID: part.callID,
                  elapsedMs: Math.max(0, now - part.state.time.start),
                },
              })
              return updated
            }),
            { concurrency: "unbounded" },
          )
          return { ...message, parts }
        }),
        { concurrency: "unbounded" },
      )
    })

    const get = Effect.fn("SessionHttpApi.get")(function* (ctx: { params: { sessionID: SessionID } }) {
      return yield* requireSession(ctx.params.sessionID)
    })

    const children = Effect.fn("SessionHttpApi.children")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* session.children(ctx.params.sessionID)
    })

    const todo = Effect.fn("SessionHttpApi.todo")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* todoSvc.get(ctx.params.sessionID)
    })

    const diff = Effect.fn("SessionHttpApi.diff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof DiffQuery.Type
    }) {
      return yield* summary.diff({ sessionID: ctx.params.sessionID, messageID: ctx.query.messageID })
    })

    const messages = Effect.fn("SessionHttpApi.messages")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof MessagesQuery.Type
    }) {
      if (ctx.query.before && ctx.query.limit === undefined) return yield* new HttpApiError.BadRequest({})
      if (ctx.query.before) {
        const before = ctx.query.before
        yield* Effect.try({
          try: () => MessageV2.cursor.decode(before),
          catch: () => new HttpApiError.BadRequest({}),
        })
      }
      yield* requireSession(ctx.params.sessionID)
      if (ctx.query.limit === undefined || ctx.query.limit === 0) {
        const items = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
        return yield* reconcileStaleRunningTools(ctx.params.sessionID, items)
      }

      const page = yield* SessionError.mapStorageNotFound(
        MessageV2.page({
          sessionID: ctx.params.sessionID,
          limit: ctx.query.limit,
          before: ctx.query.before,
        }),
      )
      const items = yield* reconcileStaleRunningTools(ctx.params.sessionID, page.items)
      if (!page.cursor) return items

      const request = yield* HttpServerRequest.HttpServerRequest
      // toURL() honors the Host + x-forwarded-proto headers, so the Link
      // header echoes the real origin instead of a hard-coded localhost.
      const url = Option.getOrElse(HttpServerRequest.toURL(request), () => new URL(request.url, "http://localhost"))
      url.searchParams.set("limit", ctx.query.limit.toString())
      url.searchParams.set("before", page.cursor)
      return HttpServerResponse.jsonUnsafe(items, {
        headers: {
          "Access-Control-Expose-Headers": "Link, X-Next-Cursor",
          Link: `<${url.toString()}>; rel="next"`,
          "X-Next-Cursor": page.cursor,
        },
      })
    })

    const message = Effect.fn("SessionHttpApi.message")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      const item = yield* SessionError.mapStorageNotFound(
        MessageV2.get({ sessionID: ctx.params.sessionID, messageID: ctx.params.messageID }),
      )
      const items = yield* reconcileStaleRunningTools(ctx.params.sessionID, [item])
      return items[0] ?? item
    })

    const create = Effect.fn("SessionHttpApi.create")(function* (ctx: { payload?: Session.CreateInput }) {
      return yield* shareSvc.create(ctx.payload)
    })

    const createRaw = Effect.fn("SessionHttpApi.createRaw")(function* (ctx: {
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* create({})

      const json = yield* tryParseJson(body)
      const decoded = yield* Schema.decodeUnknownEffect(Session.CreateInput)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      const payload = decoded
        ? {
            ...decoded,
            permission: decoded.permission ? [...decoded.permission] : undefined,
          }
        : decoded
      return yield* create({ payload })
    })

    const remove = Effect.fn("SessionHttpApi.remove")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* SessionError.mapStorageNotFound(session.remove(ctx.params.sessionID))
      return true
    })

    const update = Effect.fn("SessionHttpApi.update")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof UpdatePayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      if (ctx.payload.title !== undefined) {
        yield* session.setTitle({ sessionID: ctx.params.sessionID, title: ctx.payload.title })
      }
      if (ctx.payload.permission !== undefined) {
        yield* session.setPermission({
          sessionID: ctx.params.sessionID,
          permission: Permission.merge(current.permission ?? [], ctx.payload.permission),
        })
      }
      if (ctx.payload.time?.archived !== undefined) {
        yield* session.setArchived({ sessionID: ctx.params.sessionID, time: ctx.payload.time.archived })
      }
      return yield* requireSession(ctx.params.sessionID)
    })

    const fork = Effect.fn("SessionHttpApi.fork")(function* (ctx: {
      params: { sessionID: SessionID }
      payload?: typeof ForkPayload.Type
    }) {
      return yield* SessionError.mapStorageNotFound(
        session.fork({ sessionID: ctx.params.sessionID, messageID: ctx.payload?.messageID }),
      )
    })

    const forkRaw = Effect.fn("SessionHttpApi.forkRaw")(function* (ctx: {
      params: { sessionID: SessionID }
      request: HttpServerRequest.HttpServerRequest
    }) {
      const body = yield* Effect.orDie(ctx.request.text)
      if (body.trim().length === 0) return yield* fork({ params: ctx.params })

      const json = yield* tryParseJson(body)
      const payload = yield* Schema.decodeUnknownEffect(ForkPayload)(json).pipe(
        Effect.mapError(() => new HttpApiError.BadRequest({})),
      )
      return yield* fork({ params: ctx.params, payload })
    })

    const abort = Effect.fn("SessionHttpApi.abort")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof AbortQuery.Type
      request: HttpServerRequest.HttpServerRequest
    }) {
      const requested = AbortAudit.recordRequested({
        sessionID: ctx.params.sessionID,
        source: ctx.query.source ?? "api",
        reason: ctx.query.reason,
        route: ctx.query.route,
        actor: ctx.query.source === "benchmark_runner" ? "benchmark" : "api-client",
        userAgent: typeof ctx.request.headers["user-agent"] === "string" ? ctx.request.headers["user-agent"] : undefined,
      })
      yield* promptSvc.cancel(ctx.params.sessionID)
      AbortAudit.recordResolved({ sessionID: ctx.params.sessionID, request: requested, result: "cancel_sent" })
      return true
    })

    const init = Effect.fn("SessionHttpApi.init")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof InitPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* promptSvc
        .command({
          sessionID: ctx.params.sessionID,
          messageID: ctx.payload.messageID,
          model: `${ctx.payload.providerID}/${ctx.payload.modelID}`,
          command: Command.Default.INIT,
          arguments: "",
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return true
    })

    // share/unshare errors aren't all client-induced — storage and network
    // failures from SessionShare are real possibilities. Map to a typed 500
    // (matches the legacy route behavior which routed any failure through
    // ErrorMiddleware → NamedError.Unknown 500) instead of blanket-mapping
    // every failure to a 400 BadRequest.
    const share = Effect.fn("SessionHttpApi.share")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc.share(ctx.params.sessionID).pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const unshare = Effect.fn("SessionHttpApi.unshare")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      yield* shareSvc
        .unshare(ctx.params.sessionID)
        .pipe(Effect.mapError(() => new HttpApiError.InternalServerError({})))
      return yield* requireSession(ctx.params.sessionID)
    })

    const summarize = Effect.fn("SessionHttpApi.summarize")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof SummarizePayload.Type
    }) {
      yield* revertSvc.cleanup(yield* requireSession(ctx.params.sessionID))
      const messages = yield* SessionError.mapStorageNotFound(session.messages({ sessionID: ctx.params.sessionID }))
      const defaultAgent = yield* agentSvc.defaultAgent()
      const currentAgent = messages.findLast((message) => message.info.role === "user")?.info.agent ?? defaultAgent

      yield* compactSvc.create({
        sessionID: ctx.params.sessionID,
        agent: currentAgent,
        model: {
          providerID: ctx.payload.providerID,
          modelID: ctx.payload.modelID,
        },
        auto: ctx.payload.auto ?? false,
      })
      yield* promptSvc.loop({ sessionID: ctx.params.sessionID })
      return true
    })

    const prompt = Effect.fn("SessionHttpApi.prompt")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const message = yield* promptSvc
        .prompt({
          ...ctx.payload,
          sessionID: ctx.params.sessionID,
        })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      return HttpServerResponse.stream(Stream.make(JSON.stringify(message)).pipe(Stream.encodeText), {
        contentType: "application/json",
      })
    })

    const promptAsync = Effect.fn("SessionHttpApi.promptAsync")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof PromptPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* promptSvc.prompt({ ...ctx.payload, sessionID: ctx.params.sessionID }).pipe(
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            yield* Effect.logError("prompt_async failed").pipe(
              Effect.annotateLogs({ sessionID: ctx.params.sessionID, cause }),
            )
            yield* bus.publish(Session.Event.Error, {
              sessionID: ctx.params.sessionID,
              error: new NamedError.Unknown({ message: Cause.pretty(cause) }).toObject(),
            })
          }),
        ),
        Effect.forkIn(scope, { startImmediately: true }),
      )
      return HttpApiSchema.NoContent.make()
    })

    const command = Effect.fn("SessionHttpApi.command")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CommandPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* promptSvc
        .command({ ...ctx.payload, sessionID: ctx.params.sessionID })
        .pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
    })

    const shell = Effect.fn("SessionHttpApi.shell")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof ShellPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(promptSvc.shell({ ...ctx.payload, sessionID: ctx.params.sessionID }))
    })

    const cleanupProcesses = Effect.fn("SessionHttpApi.cleanupProcesses")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof CleanupProcessesPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* ExecProcessRegistry.cleanup({
        sessionID: ctx.params.sessionID,
        processID: ctx.payload.process_id,
        processIDs: ctx.payload.process_ids ? [...ctx.payload.process_ids] : undefined,
        turnID: ctx.payload.turn_id,
        environmentID: ctx.payload.environment_id,
        statuses: ctx.payload.statuses ? [...ctx.payload.statuses] : undefined,
        includeRunning: ctx.payload.include_running,
        includeFinished: ctx.payload.include_finished,
        reason: ctx.payload.reason ?? "session_process_cleanup_requested",
      })
    })

    const revert = Effect.fn("SessionHttpApi.revert")(function* (ctx: {
      params: { sessionID: SessionID }
      payload: typeof RevertPayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.revert({ sessionID: ctx.params.sessionID, ...ctx.payload }))
    })

    const unrevert = Effect.fn("SessionHttpApi.unrevert")(function* (ctx: { params: { sessionID: SessionID } }) {
      yield* requireSession(ctx.params.sessionID)
      return yield* SessionError.mapBusy(revertSvc.unrevert({ sessionID: ctx.params.sessionID }))
    })

    const permissionRespond = Effect.fn("SessionHttpApi.permissionRespond")(function* (ctx: {
      params: { sessionID: SessionID; permissionID: PermissionID }
      payload: typeof PermissionResponsePayload.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* permissionSvc
        .reply({
          requestID: ctx.params.permissionID,
          reply: ctx.payload.response,
          scope: ctx.payload.scope,
          reviewed_by: ctx.payload.reviewed_by,
          review_reason: ctx.payload.review_reason,
          overridden_by_constraints: ctx.payload.overridden_by_constraints,
        })
        .pipe(
        Effect.catchTag("Permission.NotFoundError", (error) =>
          Effect.fail(
            new PermissionNotFoundError({
              requestID: String(error.requestID),
              message: `Permission request not found: ${error.requestID}`,
            }),
          ),
        ),
        )
      return true
    })

    const security = Effect.fn("SessionHttpApi.security")(function* (ctx: {
      params: { sessionID: SessionID }
      query: { directory?: string }
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      return SessionSecurity.get({
        sessionID: ctx.params.sessionID,
        cwd: current.directory || ctx.query.directory || process.cwd(),
      })
    })

    const securityUpdate = Effect.fn("SessionHttpApi.securityUpdate")(function* (ctx: {
      params: { sessionID: SessionID }
      query: { directory?: string }
      payload: typeof SecurityUpdatePayload.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      return SessionSecurity.update({
        sessionID: ctx.params.sessionID,
        cwd: current.directory || ctx.query.directory || process.cwd(),
        patch: ctx.payload,
      })
    })

    const handoff = Effect.fn("SessionHttpApi.handoff")(function* (ctx: {
      params: { sessionID: SessionID }
      query: typeof HandoffQuery.Type
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      const currentSecurity = SessionSecurity.get({
        sessionID: ctx.params.sessionID,
        cwd: current.directory || ctx.query.directory || process.cwd(),
      })
      const events = PublicEventLog.list({ sessionID: ctx.params.sessionID })
      const lastEvent = events.at(-1)
      const rawRefs = events.flatMap((event) => (event.rawRef ? [event.rawRef] : []))
      const processes = ExecProcessRegistry.list({ sessionID: ctx.params.sessionID })
      const running = processes.filter((process) => process.status === "running")
      const selectedRemoteUnsupported =
        currentSecurity.environmentID !== "default" &&
        currentSecurity.environmentID !== "local-default" &&
        currentSecurity.remoteEnvironmentSupported === false
      const unsupported = [
        running.length > 0 ? "running_process_handoff_degraded" : undefined,
        selectedRemoteUnsupported ? "selected_remote_environment_unsupported" : undefined,
      ].filter((item): item is string => !!item)
      const confirmed = ctx.query.confirm === true
      const snapshot = {
        schema: "aialra.session_handoff.v1" as const,
        handoff_id: `handoff_${crypto.randomUUID()}`,
        session_id: ctx.params.sessionID,
        thread_id: lastEvent?.threadID ?? ctx.params.sessionID,
        source: ctx.query.source ?? "api",
        target: ctx.query.target ?? "desktop",
        requested_at: new Date().toISOString(),
        status: !confirmed ? "pending_confirmation" as const : unsupported.length ? "degraded" as const : "ready" as const,
        last_event_id: lastEvent?.id ?? ctx.query.lastEventID,
        last_event_sequence: lastEvent?.sequence ?? 0,
        event_stream: {
          replay_url: `/session/${ctx.params.sessionID}/events/public`,
          last_event_id: lastEvent?.id ?? ctx.query.lastEventID,
          last_event_sequence: lastEvent?.sequence ?? 0,
          supports_last_event_id: true,
        },
        raw_sync: {
          raw_ref_count: rawRefs.length,
          persisted_raw_ref_count: rawRefs.filter((ref) => ref.persisted).length,
          memory_raw_ref_count: rawRefs.filter((ref) => !ref.persisted).length,
          status: rawRefs.some((ref) => !ref.persisted) ? "partial_memory_only" : "ready",
        },
        environment: {
          selected_environment_id: currentSecurity.environmentID,
          cwd: currentSecurity.runtimeProof.environment_cwd,
          remote_supported: currentSecurity.remoteEnvironmentSupported,
          remote_status: currentSecurity.remoteEnvironmentStatus,
          handoff_status: selectedRemoteUnsupported ? "unsupported" : "ready",
        },
        security: {
          active_permission_profile_id: currentSecurity.runtimeProof.active_permission_profile_id,
          active_permission_profile_kind: currentSecurity.runtimeProof.active_permission_profile_kind ?? "unknown",
          approval_policy: currentSecurity.runtimeProof.approval_policy,
          approvals_reviewer: currentSecurity.approvalsReviewer,
          sandbox_policy: String(currentSecurity.runtimeProof.file_system.mode),
          executor_backend: currentSecurity.executorBackend,
          grants_status: "session_policy_snapshot",
        },
        process_registry: {
          total: processes.length,
          running: running.length,
          completed: processes.filter((process) => process.status === "completed").length,
          failed: processes.filter((process) => process.status === "failed" || process.status === "timeout").length,
          aborted: processes.filter((process) => process.status === "aborted").length,
          handoff_status: running.length > 0 ? "degraded" : "ready",
          unsupported_reason:
            running.length > 0
              ? "running processes stay bound to the current runtime and cannot be moved to another desktop runtime"
              : undefined,
          processes: processes.slice(-50).map((process) => ({
            process_id: process.process_id,
            turn_id: process.turn_id,
            status: process.status,
            command_preview: process.command.length > 160 ? `${process.command.slice(0, 159)}...` : process.command,
            environment_id: process.environment_id,
            cwd: process.cwd,
            handoff_status: process.status === "running" ? "degraded" : "replay_only",
            unsupported_reason:
              process.status === "running"
                ? "process runtime is in-memory and must be observed or reconnected, not silently migrated"
                : undefined,
          })),
        },
        confirmation: {
          required: true,
          confirmed,
          reason:
            "handoff carries session identity, event cursor, raw sync state, security controls and process registry state",
        },
        unsupported,
      }
      PublicEventLog.recordManual({
        type: confirmed ? "session.handoff.prepared" : "session.handoff.requested",
        severity: unsupported.length ? "warning" : "info",
        sessionID: ctx.params.sessionID,
        threadID: snapshot.thread_id,
        title: confirmed ? "Session handoff snapshot prepared" : "Session handoff requested",
        summary: `${snapshot.source} -> ${snapshot.target} ${snapshot.status}`,
        status: snapshot.status,
        data: {
          handoff_id: snapshot.handoff_id,
          source: snapshot.source,
          target: snapshot.target,
          status: snapshot.status,
          last_event_id: snapshot.last_event_id,
          last_event_sequence: snapshot.last_event_sequence,
          raw_ref_count: snapshot.raw_sync.raw_ref_count,
          selected_environment_id: snapshot.environment.selected_environment_id,
          active_permission_profile_id: snapshot.security.active_permission_profile_id,
          running_processes: snapshot.process_registry.running,
          unsupported: snapshot.unsupported,
          confirmed,
        },
        raw: snapshot,
      })
      return snapshot
    })

    const environment = Effect.fn("SessionHttpApi.environment")(function* (ctx: {
      params: { sessionID: SessionID }
      query: { directory?: string }
    }) {
      const current = yield* requireSession(ctx.params.sessionID)
      return SessionSecurity.environmentStatus({
        sessionID: ctx.params.sessionID,
        cwd: current.directory || ctx.query.directory || process.cwd(),
      })
    })

    const deleteMessage = Effect.fn("SessionHttpApi.deleteMessage")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* SessionError.mapBusy(runState.assertNotBusy(ctx.params.sessionID))
      yield* session.removeMessage(ctx.params)
      return true
    })

    const deletePart = Effect.fn("SessionHttpApi.deletePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
    }) {
      yield* requireSession(ctx.params.sessionID)
      yield* session.removePart(ctx.params)
      return true
    })

    const updatePart = Effect.fn("SessionHttpApi.updatePart")(function* (ctx: {
      params: { sessionID: SessionID; messageID: MessageID; partID: PartID }
      payload: typeof MessageV2.Part.Type
    }) {
      yield* requireSession(ctx.params.sessionID)
      const payload = ctx.payload as MessageV2.Part
      if (
        payload.id !== ctx.params.partID ||
        payload.messageID !== ctx.params.messageID ||
        payload.sessionID !== ctx.params.sessionID
      ) {
        return yield* new HttpApiError.BadRequest({})
      }
      return yield* session.updatePart(payload)
    })

    return handlers
      .handle("list", list)
      .handle("status", status)
      .handle("get", get)
      .handle("children", children)
      .handle("todo", todo)
      .handle("diff", diff)
      .handle("messages", messages)
      .handle("message", message)
      .handleRaw("create", createRaw)
      .handle("remove", remove)
      .handle("update", update)
      .handleRaw("fork", forkRaw)
      .handle("abort", abort)
      .handle("init", init)
      .handle("share", share)
      .handle("unshare", unshare)
      .handle("summarize", summarize)
      .handle("prompt", prompt)
      .handle("promptAsync", promptAsync)
      .handle("command", command)
      .handle("shell", shell)
      .handle("cleanupProcesses", cleanupProcesses)
      .handle("revert", revert)
      .handle("unrevert", unrevert)
      .handle("permissionRespond", permissionRespond)
      .handle("security", security)
      .handle("securityUpdate", securityUpdate)
      .handle("handoff", handoff)
      .handle("environment", environment)
      .handle("deleteMessage", deleteMessage)
      .handle("deletePart", deletePart)
      .handle("updatePart", updatePart)
  }),
)

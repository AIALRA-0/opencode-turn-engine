import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { ConfigPermission } from "@/config/permission"
import { InstanceState } from "@/effect/instance-state"
import { ProjectID } from "@/project/schema"
import { MessageID, SessionID } from "@/session/schema"
import { PermissionTable } from "@/session/session.sql"
import { Database } from "@/storage/db"
import { eq } from "drizzle-orm"
import * as Log from "@opencode-ai/core/util/log"
import { Wildcard } from "@opencode-ai/core/util/wildcard"
import { Deferred, Effect, Layer, Schema, Context } from "effect"
import os from "os"
import { PermissionV2 } from "@opencode-ai/core/permission"
import { PermissionID } from "./schema"
import { PublicEventLog } from "@/session/public-event"

const log = Log.create({ service: "permission" })

export const Action = PermissionV2.Action.annotate({ identifier: "PermissionAction" })
export type Action = Schema.Schema.Type<typeof Action>

export const Rule = Schema.Struct({
  permission: Schema.String,
  pattern: Schema.String,
  action: Action,
}).annotate({ identifier: "PermissionRule" })
export type Rule = Schema.Schema.Type<typeof Rule>

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "PermissionRuleset" })
export type Ruleset = Schema.Schema.Type<typeof Ruleset>

// Pure data; nothing checks class identity. As `Schema.Struct` + type alias,
// `Permission.ask` can trust its already-typed input and skip the inner
// `decodeUnknownSync` that would otherwise throw uncaught on any structural
// mismatch. Same pattern as `Question.Request` in PR #28570.
export const Request = Schema.Struct({
  id: PermissionID,
  sessionID: SessionID,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  always: Schema.Array(Schema.String),
  turnID: Schema.optional(MessageID),
  approvalPolicy: Schema.optional(Schema.Unknown),
  permissionProfile: Schema.optional(Schema.Unknown),
  sandboxPolicy: Schema.optional(Schema.Unknown),
  tool: Schema.optional(
    Schema.Struct({
      messageID: MessageID,
      callID: Schema.String,
    }),
  ),
}).annotate({ identifier: "PermissionRequest" })
export type Request = Schema.Schema.Type<typeof Request>

export const Reply = Schema.Literals(["once", "always", "reject"])
export type Reply = Schema.Schema.Type<typeof Reply>
export const ReplyScope = Schema.Literals([
  "reject",
  "once-command",
  "turn-command",
  "turn-all",
  "always-command",
  "always-all",
])
export type ReplyScope = Schema.Schema.Type<typeof ReplyScope>

const reply = {
  reply: Reply,
  message: Schema.optional(Schema.String),
  scope: Schema.optional(ReplyScope),
}

export const ReplyBody = Schema.Struct(reply).annotate({ identifier: "PermissionReplyBody" })
export type ReplyBody = Schema.Schema.Type<typeof ReplyBody>

export const Approval = Schema.Struct({
  projectID: ProjectID,
  patterns: Schema.Array(Schema.String),
}).annotate({ identifier: "PermissionApproval" })
export type Approval = Schema.Schema.Type<typeof Approval>

export const Event = {
  Asked: BusEvent.define("permission.asked", Request),
  Replied: BusEvent.define(
    "permission.replied",
    Schema.Struct({
      sessionID: SessionID,
      requestID: PermissionID,
      reply: Reply,
      scope: Schema.optional(ReplyScope),
    }),
  ),
}

export class RejectedError extends Schema.TaggedErrorClass<RejectedError>()("PermissionRejectedError", {}) {
  override get message() {
    return "The user rejected permission to use this specific tool call."
  }
}

export class CorrectedError extends Schema.TaggedErrorClass<CorrectedError>()("PermissionCorrectedError", {
  feedback: Schema.String,
}) {
  override get message() {
    return `The user rejected permission to use this specific tool call with the following feedback: ${this.feedback}`
  }
}

export class DeniedError extends Schema.TaggedErrorClass<DeniedError>()("PermissionDeniedError", {
  ruleset: Schema.Any,
}) {
  override get message() {
    return `The user has specified a rule which prevents you from using this specific tool call. Here are some of the relevant rules ${JSON.stringify(this.ruleset)}`
  }
}

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Permission.NotFoundError", {
  requestID: PermissionID,
}) {}

export type Error = DeniedError | RejectedError | CorrectedError

export const AskInput = Schema.Struct({
  ...Request.fields,
  id: Schema.optional(PermissionID),
  ruleset: Ruleset,
}).annotate({ identifier: "PermissionAskInput" })
export type AskInput = Schema.Schema.Type<typeof AskInput>

export const ReplyInput = Schema.Struct({
  requestID: PermissionID,
  ...reply,
}).annotate({ identifier: "PermissionReplyInput" })
export type ReplyInput = Schema.Schema.Type<typeof ReplyInput>

export interface Interface {
  readonly ask: (input: AskInput) => Effect.Effect<void, Error>
  readonly reply: (input: ReplyInput) => Effect.Effect<void, NotFoundError>
  readonly list: () => Effect.Effect<ReadonlyArray<Request>>
}

interface PendingEntry {
  info: Request
  deferred: Deferred.Deferred<void, RejectedError | CorrectedError>
}

interface State {
  pending: Map<PermissionID, PendingEntry>
  approved: Rule[]
  turnCommandApproved: Map<string, boolean>
  turnAllApproved: Map<string, boolean>
  sessionCommandApproved: Map<string, boolean>
  sessionAllApproved: Map<SessionID, boolean>
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  return PermissionV2.evaluate(permission, pattern, ...rulesets)
}

type ScopedPermissionRequest = Pick<Request, "sessionID" | "turnID" | "permission" | "patterns">

function commandSignature(input: Pick<ScopedPermissionRequest, "permission" | "patterns">) {
  return `${input.permission}:${input.patterns.join("\u0000")}`
}

function turnKey(input: Pick<ScopedPermissionRequest, "sessionID" | "turnID">) {
  if (!input.turnID) return
  return `${input.sessionID}:${input.turnID}`
}

function turnCommandKey(input: ScopedPermissionRequest) {
  const key = turnKey(input)
  if (!key) return
  return `${key}:${commandSignature(input)}`
}

function sessionCommandKey(input: Pick<ScopedPermissionRequest, "sessionID" | "permission" | "patterns">) {
  return `${input.sessionID}:${commandSignature(input)}`
}

function isScopedApproved(state: State, input: ScopedPermissionRequest) {
  if (state.sessionAllApproved.get(input.sessionID)) return true
  if (state.sessionCommandApproved.get(sessionCommandKey(input))) return true
  const key = turnKey(input)
  if (key && state.turnAllApproved.get(key)) return true
  const commandKey = turnCommandKey(input)
  return commandKey ? state.turnCommandApproved.get(commandKey) === true : false
}

function approveScope(state: State, input: ScopedPermissionRequest, scope: ReplyScope | undefined) {
  if (scope === "turn-command") {
    const key = turnCommandKey(input)
    if (key) state.turnCommandApproved.set(key, true)
    return
  }
  if (scope === "turn-all") {
    const key = turnKey(input)
    if (key) state.turnAllApproved.set(key, true)
    return
  }
  if (scope === "always-command") {
    state.sessionCommandApproved.set(sessionCommandKey(input), true)
    return
  }
  if (scope === "always-all") {
    state.sessionAllApproved.set(input.sessionID, true)
  }
}

function recordApprovalScope(input: { request: Request; reply: Reply; scope?: ReplyScope; propagated?: boolean }) {
  PublicEventLog.recordManual({
    type: input.reply === "reject" ? "security.override.resolved" : "security.override.resolved",
    severity: input.reply === "reject" ? "warning" : "info",
    sessionID: input.request.sessionID,
    turnID: input.request.turnID,
    messageID: input.request.tool?.messageID ?? input.request.turnID,
    toolCallID: input.request.tool?.callID,
    title: "Approval reviewer resolved",
    summary: `审批处理：${input.scope ?? input.reply}`,
    status: input.scope ?? input.reply,
    data: {
      reply: input.reply,
      scope: input.scope,
      permission: input.request.permission,
      patterns: input.request.patterns,
      approvalPolicy: input.request.approvalPolicy,
      permissionProfile: input.request.permissionProfile,
      sandboxPolicy: input.request.sandboxPolicy,
      propagated: input.propagated === true,
      linkage: "approval_scope_updates_server_reviewer_state",
    },
    raw: {
      source: "permission.reply",
      reply: input.reply,
      scope: input.scope,
      request: input.request,
      propagated: input.propagated === true,
    },
  })
}

export class Service extends Context.Service<Service, Interface>()("@opencode/Permission") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const state = yield* InstanceState.make<State>(
      Effect.fn("Permission.state")(function* (ctx) {
        const row = Database.use((db) =>
          db.select().from(PermissionTable).where(eq(PermissionTable.project_id, ctx.project.id)).get(),
        )
        const state = {
          pending: new Map<PermissionID, PendingEntry>(),
          approved: [...(row?.data ?? [])],
          turnCommandApproved: new Map<string, boolean>(),
          turnAllApproved: new Map<string, boolean>(),
          sessionCommandApproved: new Map<string, boolean>(),
          sessionAllApproved: new Map<SessionID, boolean>(),
        }

        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            for (const item of state.pending.values()) {
              yield* Deferred.fail(item.deferred, new RejectedError())
            }
            state.pending.clear()
          }),
        )

        return state
      }),
    )

    const ask = Effect.fn("Permission.ask")(function* (input: AskInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const { ruleset, ...request } = input
      let needsAsk = false

      for (const pattern of request.patterns) {
        const rule = evaluate(request.permission, pattern, ruleset, approved)
        log.info("evaluated", { permission: request.permission, pattern, action: rule })
        if (rule.action === "deny") {
          return yield* new DeniedError({
            ruleset: ruleset.filter((rule) => Wildcard.match(request.permission, rule.permission)),
          })
        }
        if (rule.action === "allow") continue
        needsAsk = true
      }

      if (!needsAsk) return
      if (isScopedApproved(yield* InstanceState.get(state), request)) return

      const id = request.id ?? PermissionID.ascending()
      const info: Request = {
        id,
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        metadata: request.metadata,
        always: request.always,
        turnID: request.turnID,
        approvalPolicy: request.approvalPolicy,
        permissionProfile: request.permissionProfile,
        sandboxPolicy: request.sandboxPolicy,
        tool: request.tool,
      }
      log.info("asking", { id, permission: info.permission, patterns: info.patterns })

      const deferred = yield* Deferred.make<void, RejectedError | CorrectedError>()
      pending.set(id, { info, deferred })
      yield* bus.publish(Event.Asked, info)
      return yield* Effect.ensuring(
        Deferred.await(deferred),
        Effect.sync(() => {
          pending.delete(id)
        }),
      )
    })

    const reply = Effect.fn("Permission.reply")(function* (input: ReplyInput) {
      const { approved, pending } = yield* InstanceState.get(state)
      const existing = pending.get(input.requestID)
      if (!existing) return yield* new NotFoundError({ requestID: input.requestID })

      pending.delete(input.requestID)
      yield* bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
        scope: input.scope,
      })
      recordApprovalScope({ request: existing.info, reply: input.reply, scope: input.scope })

      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message ? new CorrectedError({ feedback: input.message }) : new RejectedError(),
        )

        for (const [id, item] of pending.entries()) {
          if (item.info.sessionID !== existing.info.sessionID) continue
          pending.delete(id)
          yield* bus.publish(Event.Replied, {
            sessionID: item.info.sessionID,
            requestID: item.info.id,
            reply: "reject",
            scope: input.scope,
          })
          recordApprovalScope({ request: item.info, reply: "reject", scope: input.scope, propagated: true })
          yield* Deferred.fail(item.deferred, new RejectedError())
        }
        return
      }

      approveScope(yield* InstanceState.get(state), existing.info, input.scope)
      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once") return

      for (const pattern of existing.info.always) {
        approved.push({
          permission: existing.info.permission,
          pattern,
          action: "allow",
        })
      }

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        const ok =
          isScopedApproved(yield* InstanceState.get(state), item.info) ||
          item.info.patterns.every((pattern) => evaluate(item.info.permission, pattern, approved).action === "allow")
        if (!ok) continue
        pending.delete(id)
        yield* bus.publish(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
          scope: input.scope,
        })
        recordApprovalScope({ request: item.info, reply: "always", scope: input.scope, propagated: true })
        yield* Deferred.succeed(item.deferred, undefined)
      }
    })

    const list = Effect.fn("Permission.list")(function* () {
      const pending = (yield* InstanceState.get(state)).pending
      return Array.from(pending.values(), (item) => item.info)
    })

    return Service.of({ ask, reply, list })
  }),
)

function expand(pattern: string): string {
  if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
  if (pattern === "~") return os.homedir()
  if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
  if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
  return pattern
}

export function fromConfig(permission: ConfigPermission.Info) {
  const ruleset: Rule[] = []
  for (const [key, value] of Object.entries(permission)) {
    if (typeof value === "string") {
      ruleset.push({ permission: key, action: value, pattern: "*" })
      continue
    }
    ruleset.push(
      ...Object.entries(value).map(([pattern, action]) => ({ permission: key, pattern: expand(pattern), action })),
    )
  }
  return ruleset
}

export function merge(...rulesets: Ruleset[]): Rule[] {
  return [...PermissionV2.merge(...rulesets)]
}

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  return PermissionV2.disabled(tools, ruleset)
}

export const defaultLayer = layer.pipe(Layer.provide(Bus.layer))

export * as Permission from "."

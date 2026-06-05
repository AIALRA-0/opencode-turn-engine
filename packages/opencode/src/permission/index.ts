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
import { ExecApproval } from "@/session/exec-approval"
import { ApplyPatchApproval } from "@/session/apply-patch-approval"
import { GuardianAssessment } from "@/session/guardian-assessment"
import { AutoReview } from "@/session/auto-review"
import { ReviewerOverride } from "@/session/reviewer-override"

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
  approval_reviewer: Schema.optional(Schema.Unknown),
  requested_by: Schema.optional(Schema.String),
  requested_at: Schema.optional(Schema.String),
  reviewed_by: Schema.optional(Schema.Unknown),
  review_result: Schema.optional(Schema.String),
  review_reason: Schema.optional(Schema.String),
  review_time: Schema.optional(Schema.String),
  overridden_by_constraints: Schema.optional(Schema.Boolean),
  guardian_assessment: Schema.optional(Schema.Unknown),
  auto_review_result: Schema.optional(Schema.Unknown),
  reviewer_resolution: Schema.optional(Schema.Unknown),
  environment_id: Schema.optional(Schema.String),
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
  reviewed_by: Schema.optional(Schema.Unknown),
  review_result: Schema.optional(Schema.String),
  review_reason: Schema.optional(Schema.String),
  review_time: Schema.optional(Schema.String),
  overridden_by_constraints: Schema.optional(Schema.Boolean),
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
      approval_decision: Schema.optional(Schema.Unknown),
      reviewed_by: Schema.optional(Schema.Unknown),
      review_result: Schema.optional(Schema.String),
      review_reason: Schema.optional(Schema.String),
      review_time: Schema.optional(Schema.String),
      overridden_by_constraints: Schema.optional(Schema.Boolean),
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
  sessionAllApproved: Map<string, boolean>
}

export function evaluate(permission: string, pattern: string, ...rulesets: Ruleset[]): Rule {
  return PermissionV2.evaluate(permission, pattern, ...rulesets)
}

type ScopedPermissionRequest = Pick<Request, "sessionID" | "turnID" | "permission" | "patterns" | "environment_id">

function requestEnvironmentID(input: { environment_id?: string; metadata?: Record<string, unknown> }) {
  if (input.environment_id) return input.environment_id
  const metadata = input.metadata ?? {}
  const execApproval = typeof metadata.exec_approval === "object" && metadata.exec_approval !== null ? metadata.exec_approval as Record<string, unknown> : undefined
  const applyPatchApproval =
    typeof metadata.apply_patch_approval === "object" && metadata.apply_patch_approval !== null
      ? metadata.apply_patch_approval as Record<string, unknown>
      : undefined
  const requestPermissions =
    typeof metadata.request_permissions === "object" && metadata.request_permissions !== null
      ? metadata.request_permissions as Record<string, unknown>
      : undefined
  if (typeof execApproval?.environment_id === "string") return execApproval.environment_id
  if (typeof applyPatchApproval?.environment_id === "string") return applyPatchApproval.environment_id
  if (typeof requestPermissions?.requested_environment_id === "string") return requestPermissions.requested_environment_id
  return "legacy"
}

function commandSignature(input: Pick<ScopedPermissionRequest, "permission" | "patterns">) {
  return `${input.permission}:${input.patterns.join("\u0000")}`
}

function environmentKey(input: Pick<ScopedPermissionRequest, "sessionID" | "environment_id">) {
  return `${input.sessionID}:${input.environment_id ?? "legacy"}`
}

function turnKey(input: Pick<ScopedPermissionRequest, "sessionID" | "turnID" | "environment_id">) {
  if (!input.turnID) return
  return `${environmentKey(input)}:${input.turnID}`
}

function turnCommandKey(input: ScopedPermissionRequest) {
  const key = turnKey(input)
  if (!key) return
  return `${key}:${commandSignature(input)}`
}

function sessionCommandKey(input: Pick<ScopedPermissionRequest, "sessionID" | "environment_id" | "permission" | "patterns">) {
  return `${environmentKey(input)}:${commandSignature(input)}`
}

function isScopedApproved(state: State, input: ScopedPermissionRequest) {
  if (state.sessionAllApproved.get(environmentKey(input))) return true
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
    state.sessionAllApproved.set(environmentKey(input), true)
  }
}

function approvalDecision(input: {
  request: Request
  reply: Reply
  scope?: ReplyScope
  propagated?: boolean
}) {
  const environmentID = requestEnvironmentID(input.request)
  const grantScope =
    input.scope ??
    (input.reply === "reject"
      ? "reject"
      : input.reply === "always"
        ? environmentID === "legacy"
          ? "legacy-always"
          : "always-command"
        : "once-command")
  const status = input.reply === "reject" ? "denied" : "approved"
  const details: Record<
    string,
    {
      decision: string
      label: string
      description: string
      applies_to: string
      expires_at: string
      creates_runtime_grant: boolean
      revocable_by: string
    }
  > = {
    reject: {
      decision: "reject",
      label: "拒绝",
      description: "拒绝这次审批。兼容旧 OpenCode 行为时，会同时取消同一会话里仍在等待的审批。",
      applies_to: "current_request_and_same_session_pending_requests",
      expires_at: "immediate",
      creates_runtime_grant: false,
      revocable_by: "not_applicable",
    },
    "once-command": {
      decision: "allow_once_command",
      label: "仅允许一次本命令",
      description: "只允许当前这一次工具调用，不给后续请求建立自动授权。",
      applies_to: "current_tool_call_only",
      expires_at: "after_current_tool_call",
      creates_runtime_grant: false,
      revocable_by: "not_applicable",
    },
    "turn-command": {
      decision: "allow_turn_command",
      label: "本对话单轮允许本命令",
      description: "当前回合内，同一环境里的同类命令自动允许；下一回合重新询问。",
      applies_to: "same_turn_same_environment_same_command",
      expires_at: "turn_end",
      creates_runtime_grant: true,
      revocable_by: "turn_end_or_session_policy_reset",
    },
    "turn-all": {
      decision: "allow_turn_all",
      label: "本对话单轮允许全部命令",
      description: "当前回合内，同一环境里的后续审批自动允许；下一回合重新询问。",
      applies_to: "same_turn_same_environment_all_permission_requests",
      expires_at: "turn_end",
      creates_runtime_grant: true,
      revocable_by: "turn_end_or_session_policy_reset",
    },
    "always-command": {
      decision: "allow_session_command",
      label: "本对话始终允许本命令",
      description: "当前会话内，同一环境里的同类命令自动允许；不会绕过沙箱和硬安全约束。",
      applies_to: "same_session_same_environment_same_command",
      expires_at: environmentID === "legacy" ? "legacy_session_permission_rule" : "session_environment_scope",
      creates_runtime_grant: true,
      revocable_by: "session_policy_reset_or_new_session",
    },
    "always-all": {
      decision: "allow_session_all",
      label: "本对话始终允许全部命令",
      description: "当前会话内，同一环境里的后续审批自动允许；不会绕过沙箱和硬安全约束。",
      applies_to: "same_session_same_environment_all_permission_requests",
      expires_at: environmentID === "legacy" ? "legacy_session_permission_rule" : "session_environment_scope",
      creates_runtime_grant: true,
      revocable_by: "session_policy_reset_or_new_session",
    },
    "legacy-always": {
      decision: "allow_legacy_always_command",
      label: "旧版始终允许",
      description: "旧客户端没有传 scope，系统按 OpenCode 旧规则写入会话级 permission rule。",
      applies_to: "legacy_session_permission_rule_patterns",
      expires_at: "legacy_session_permission_rule",
      creates_runtime_grant: true,
      revocable_by: "session_permission_rule_reset",
    },
  }
  const detail = details[grantScope] ?? details["once-command"]
  return {
    schema: "aialra.approval_decision.v1",
    decision: detail.decision,
    status,
    reply: input.reply,
    requested_scope: input.scope,
    grant_scope: grantScope,
    label: detail.label,
    description: detail.description,
    applies_to: detail.applies_to,
    expires_at: detail.expires_at,
    creates_runtime_grant: detail.creates_runtime_grant,
    revocable_by: detail.revocable_by,
    session_id: input.request.sessionID,
    turn_id: input.request.turnID,
    environment_id: environmentID,
    permission: input.request.permission,
    patterns: input.request.patterns,
    tool_call_id: input.request.tool?.callID,
    reviewer: input.request.approval_reviewer,
    propagated: input.propagated === true,
    legacy_propagates_pending_session_requests: input.reply === "reject",
  }
}

function recordGrantCreated(input: {
  request: Request
  reply: Reply
  scope?: ReplyScope
  reviewedBy?: unknown
  reviewReason?: string
  reviewTime: string
}) {
  const environmentID = requestEnvironmentID(input.request)
  const decision = approvalDecision({ request: input.request, reply: input.reply, scope: input.scope })
  PublicEventLog.recordManual({
    type: "permission.grant.created",
    severity: "info",
    sessionID: input.request.sessionID,
    turnID: input.request.turnID,
    messageID: input.request.tool?.messageID ?? input.request.turnID,
    toolCallID: input.request.tool?.callID,
    title: "Environment-aware permission grant created",
    summary: `env=${environmentID} scope=${input.scope ?? input.reply}`,
    status: input.scope ?? input.reply,
    data: {
      schema: "aialra.permission_grant.v1",
      grant_id: `grant_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      session_id: input.request.sessionID,
      turn_id: input.request.turnID,
      environment_id: environmentID,
      permission: input.request.permission,
      patterns: input.request.patterns,
      scope: input.scope ?? input.reply,
      granted_by: input.reviewedBy,
      reviewer: input.request.approval_reviewer,
      reason: input.reviewReason,
      granted_at: input.reviewTime,
      expires_at: decision.expires_at,
      constraints_snapshot: {
        approvalPolicy: input.request.approvalPolicy,
        permissionProfile: input.request.permissionProfile,
        sandboxPolicy: input.request.sandboxPolicy,
        guardian_assessment: input.request.metadata.guardian_assessment,
        auto_review_result: input.request.metadata.auto_review_result,
        reviewer_resolution: input.request.metadata.reviewer_resolution,
      },
      approval_decision: decision,
    },
    raw: {
      source: "permission.grant",
      request: input.request,
      reply: input.reply,
      scope: input.scope,
      environmentID,
      reviewedBy: input.reviewedBy,
      reviewReason: input.reviewReason,
      reviewTime: input.reviewTime,
    },
  })
}

function recordApprovalScope(input: {
  request: Request
  reply: Reply
  scope?: ReplyScope
  propagated?: boolean
  reviewedBy?: unknown
  reviewResult?: string
  reviewReason?: string
  reviewTime?: string
  overriddenByConstraints?: boolean
}) {
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
      approval_decision: approvalDecision({
        request: input.request,
        reply: input.reply,
        scope: input.scope,
        propagated: input.propagated,
      }),
      permission: input.request.permission,
      patterns: input.request.patterns,
      requested_by: input.request.requested_by,
      requested_at: input.request.requested_at,
      approval_reviewer: input.request.approval_reviewer,
      reviewed_by: input.reviewedBy,
      review_result: input.reviewResult,
      review_reason: input.reviewReason,
      review_time: input.reviewTime,
      overridden_by_constraints: input.overriddenByConstraints === true,
      environment_id: requestEnvironmentID(input.request),
      approvalPolicy: input.request.approvalPolicy,
      permissionProfile: input.request.permissionProfile,
      sandboxPolicy: input.request.sandboxPolicy,
      guardian_assessment: input.request.metadata.guardian_assessment ?? input.request.guardian_assessment,
      auto_review_result: input.request.metadata.auto_review_result ?? input.request.auto_review_result,
      reviewer_resolution: input.request.metadata.reviewer_resolution ?? input.request.reviewer_resolution,
      exec_approval: input.request.metadata.exec_approval,
      apply_patch_approval: input.request.metadata.apply_patch_approval,
      propagated: input.propagated === true,
      linkage: "approval_scope_updates_server_reviewer_state",
    },
    raw: {
      source: "permission.reply",
      reply: input.reply,
      scope: input.scope,
      approvalDecision: approvalDecision({
        request: input.request,
        reply: input.reply,
        scope: input.scope,
        propagated: input.propagated,
      }),
      request: input.request,
      guardianAssessment: input.request.metadata.guardian_assessment ?? input.request.guardian_assessment,
      autoReviewResult: input.request.metadata.auto_review_result ?? input.request.auto_review_result,
      reviewerResolution: input.request.metadata.reviewer_resolution ?? input.request.reviewer_resolution,
      execApproval: input.request.metadata.exec_approval,
      applyPatchApproval: input.request.metadata.apply_patch_approval,
      reviewedBy: input.reviewedBy,
      reviewResult: input.reviewResult,
      reviewReason: input.reviewReason,
      reviewTime: input.reviewTime,
      overriddenByConstraints: input.overriddenByConstraints === true,
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
          sessionAllApproved: new Map<string, boolean>(),
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
      const environmentID = requestEnvironmentID(request)
      const guardianAssessment = GuardianAssessment.assess({
        sessionID: request.sessionID,
        turnID: request.turnID,
        permission: request.permission,
        patterns: [...request.patterns],
        metadata: request.metadata,
        tool: request.tool,
      })
      yield* GuardianAssessment.maybeEmit(guardianAssessment)
      if (guardianAssessment.hard_block) {
        return yield* new DeniedError({
          ruleset: guardianAssessment.policy_findings.map((finding) => ({
            permission: request.permission,
            pattern: finding.evidence ?? request.patterns.join(","),
            action: "deny" as const,
            guardian: finding.code,
          })),
        })
      }
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
      if (guardianAssessment.suggested_decision === "ask_user") needsAsk = true

      if (!needsAsk) return
      if (isScopedApproved(yield* InstanceState.get(state), { ...request, environment_id: environmentID })) return

      const reviewerResolution = ReviewerOverride.resolve({
        request: {
          sessionID: request.sessionID,
          turnID: request.turnID,
          approval_reviewer: request.approval_reviewer,
          metadata: { ...request.metadata, guardian_assessment: guardianAssessment },
          tool: request.tool,
        },
        guardian: guardianAssessment,
      })
      yield* ReviewerOverride.emit(reviewerResolution)
      const autoReviewResult = AutoReview.review({
        request: {
          sessionID: request.sessionID,
          turnID: request.turnID,
          permission: request.permission,
          patterns: [...request.patterns],
          metadata: { ...request.metadata, guardian_assessment: guardianAssessment, reviewer_resolution: reviewerResolution },
          approval_reviewer: reviewerResolution.selected_reviewer,
          tool: request.tool,
        },
        guardian: guardianAssessment,
      })
      yield* AutoReview.maybeEmit(autoReviewResult)
      if (autoReviewResult.decision === "auto_deny") {
        return yield* new DeniedError({
          ruleset: [
            {
              permission: request.permission,
              pattern: request.patterns.join(","),
              action: "deny" as const,
              auto_review: autoReviewResult.matched_rule.id,
            },
          ],
        })
      }
      if (autoReviewResult.decision === "auto_approve") return

      const id = request.id ?? PermissionID.ascending()
      const metadata =
        autoReviewResult.auto_review_enabled
          ? {
              ...request.metadata,
              guardian_assessment: guardianAssessment,
              auto_review_result: autoReviewResult,
              reviewer_resolution: reviewerResolution,
            }
          : { ...request.metadata, guardian_assessment: guardianAssessment, reviewer_resolution: reviewerResolution }
      const info: Request = {
        id,
        sessionID: request.sessionID,
        permission: request.permission,
        patterns: request.patterns,
        metadata,
        always: request.always,
        turnID: request.turnID,
        environment_id: environmentID,
        approvalPolicy: request.approvalPolicy,
        approval_reviewer: reviewerResolution.selected_reviewer,
        requested_by: request.requested_by ?? "assistant_tool",
        requested_at: request.requested_at ?? new Date().toISOString(),
        reviewed_by: request.reviewed_by,
        review_result:
          request.review_result ??
          (autoReviewResult.auto_review_enabled ? `auto_review_${autoReviewResult.decision}` : "guardian_assessed"),
        review_reason: request.review_reason ?? autoReviewResult.reason,
        review_time: request.review_time,
        overridden_by_constraints: request.overridden_by_constraints ?? false,
        guardian_assessment: guardianAssessment,
        auto_review_result: autoReviewResult.auto_review_enabled ? autoReviewResult : undefined,
        reviewer_resolution: reviewerResolution,
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
      const reviewTime = input.review_time ?? new Date().toISOString()
      const reviewedBy = input.reviewed_by ?? existing.info.approval_reviewer ?? { role: "user", id: "current_user" }
      const reviewResult = input.review_result ?? (input.reply === "reject" ? "denied" : "approved")
      const reviewReason = input.review_reason ?? input.message ?? input.scope ?? input.reply
      yield* bus.publish(Event.Replied, {
        sessionID: existing.info.sessionID,
        requestID: existing.info.id,
        reply: input.reply,
        scope: input.scope,
        approval_decision: approvalDecision({ request: existing.info, reply: input.reply, scope: input.scope }),
        reviewed_by: reviewedBy,
        review_result: reviewResult,
        review_reason: reviewReason,
        review_time: reviewTime,
        overridden_by_constraints: input.overridden_by_constraints ?? false,
      })
      recordApprovalScope({
        request: existing.info,
        reply: input.reply,
        scope: input.scope,
        reviewedBy,
        reviewResult,
        reviewReason,
        reviewTime,
        overriddenByConstraints: input.overridden_by_constraints ?? false,
      })
      if (existing.info.metadata.exec_approval) {
        yield* ExecApproval.resolved({
          request: existing.info.metadata.exec_approval,
          reply: input.reply,
          scope: input.scope,
          reviewedBy,
          reviewResult,
          reviewReason,
          reviewTime,
          overriddenByConstraints: input.overridden_by_constraints ?? false,
        })
      }
      if (existing.info.metadata.apply_patch_approval) {
        yield* ApplyPatchApproval.resolved({
          request: existing.info.metadata.apply_patch_approval,
          reply: input.reply,
          scope: input.scope,
          reviewedBy,
          reviewResult,
          reviewReason,
          reviewTime,
          overriddenByConstraints: input.overridden_by_constraints ?? false,
        })
      }

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
            approval_decision: approvalDecision({
              request: item.info,
              reply: "reject",
              scope: input.scope,
              propagated: true,
            }),
            reviewed_by: reviewedBy,
            review_result: "denied",
            review_reason: reviewReason,
            review_time: reviewTime,
            overridden_by_constraints: input.overridden_by_constraints ?? false,
          })
          recordApprovalScope({
            request: item.info,
            reply: "reject",
            scope: input.scope,
            propagated: true,
            reviewedBy,
            reviewResult: "denied",
            reviewReason,
            reviewTime,
            overriddenByConstraints: input.overridden_by_constraints ?? false,
          })
          if (item.info.metadata.exec_approval) {
            yield* ExecApproval.resolved({
              request: item.info.metadata.exec_approval,
              reply: "reject",
              scope: input.scope,
              reviewedBy,
              reviewResult: "denied",
              reviewReason,
              reviewTime,
              overriddenByConstraints: input.overridden_by_constraints ?? false,
              propagated: true,
            })
          }
          if (item.info.metadata.apply_patch_approval) {
            yield* ApplyPatchApproval.resolved({
              request: item.info.metadata.apply_patch_approval,
              reply: "reject",
              scope: input.scope,
              reviewedBy,
              reviewResult: "denied",
              reviewReason,
              reviewTime,
              overriddenByConstraints: input.overridden_by_constraints ?? false,
              propagated: true,
            })
          }
          yield* Deferred.fail(item.deferred, new RejectedError())
        }
        return
      }

      const effectiveScope =
        input.scope ?? (input.reply === "always" && existing.info.environment_id !== "legacy" ? "always-command" : undefined)
      approveScope(yield* InstanceState.get(state), existing.info, effectiveScope)
      recordGrantCreated({
        request: existing.info,
        reply: input.reply,
        scope: effectiveScope,
        reviewedBy,
        reviewReason,
        reviewTime,
      })
      yield* Deferred.succeed(existing.deferred, undefined)
      if (input.reply === "once" && (!effectiveScope || effectiveScope === "once-command")) return

      if (existing.info.environment_id === "legacy") {
        for (const pattern of existing.info.always) {
          approved.push({
            permission: existing.info.permission,
            pattern,
            action: "allow",
          })
        }
      }

      for (const [id, item] of pending.entries()) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        const ok =
          isScopedApproved(yield* InstanceState.get(state), item.info) ||
          (item.info.environment_id === "legacy" &&
            item.info.patterns.every((pattern) => evaluate(item.info.permission, pattern, approved).action === "allow"))
        if (!ok) continue
        pending.delete(id)
        yield* bus.publish(Event.Replied, {
          sessionID: item.info.sessionID,
          requestID: item.info.id,
          reply: "always",
          scope: input.scope,
          approval_decision: approvalDecision({
            request: item.info,
            reply: "always",
            scope: input.scope,
            propagated: true,
          }),
          reviewed_by: reviewedBy,
          review_result: "approved",
          review_reason: reviewReason,
          review_time: reviewTime,
          overridden_by_constraints: input.overridden_by_constraints ?? false,
        })
        recordApprovalScope({
          request: item.info,
          reply: "always",
          scope: input.scope,
          propagated: true,
          reviewedBy,
          reviewResult: "approved",
          reviewReason,
          reviewTime,
          overriddenByConstraints: input.overridden_by_constraints ?? false,
        })
        recordGrantCreated({
          request: item.info,
          reply: "always",
          scope: input.scope,
          reviewedBy,
          reviewReason,
          reviewTime,
        })
        if (item.info.metadata.exec_approval) {
          yield* ExecApproval.resolved({
            request: item.info.metadata.exec_approval,
            reply: "always",
            scope: input.scope,
            reviewedBy,
            reviewResult: "approved",
            reviewReason,
            reviewTime,
            overriddenByConstraints: input.overridden_by_constraints ?? false,
            propagated: true,
          })
        }
        if (item.info.metadata.apply_patch_approval) {
          yield* ApplyPatchApproval.resolved({
            request: item.info.metadata.apply_patch_approval,
            reply: "always",
            scope: input.scope,
            reviewedBy,
            reviewResult: "approved",
            reviewReason,
            reviewTime,
            overriddenByConstraints: input.overridden_by_constraints ?? false,
            propagated: true,
          })
        }
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

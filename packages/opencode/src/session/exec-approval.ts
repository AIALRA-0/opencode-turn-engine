import { Effect } from "effect"
import { AialraTurnTrace } from "./turn-trace"
import { CodexTurn, type TurnContext } from "./turn-context"
import { TerminalInteraction } from "./terminal-interaction"
import type { ExecCommandBackend } from "./exec-command"

type JsonRecord = Record<string, unknown>

type ExecApprovalContext = {
  sessionID: string
  messageID?: string
  callID?: string
  turn?: TurnContext
}

type ExecApprovalInput = {
  commandID: string
  processID: string
  command: string
  shell: string
  argv: string[]
  cwd: string
  backend: ExecCommandBackend
  reason: "command_policy" | "network_policy" | "shell_pattern"
  description?: string
  patterns: string[]
  networkTargets?: string[]
  networkDecisions?: unknown[]
  constraintsResult?: JsonRecord
}

type ExecApprovalResolution = {
  request: unknown
  reply: string
  scope?: string
  reviewedBy?: unknown
  reviewResult?: string
  reviewReason?: string
  reviewTime?: string
  overriddenByConstraints?: boolean
  propagated?: boolean
}

function riskLevel(input: Pick<ExecApprovalInput, "reason" | "command" | "networkTargets">) {
  if (input.reason === "network_policy") return "high"
  if (/\b(rm|sudo|chmod|chown|mv|cp|curl|wget|npm|pnpm|bun|docker|git)\b/.test(input.command)) return "medium"
  return "low"
}

function reviewer(turn: TurnContext | undefined) {
  return turn?.approvals_reviewer ?? { role: "user", id: "current_user", label: "User，当前用户", source: "default" }
}

function profileID(turn: TurnContext | undefined) {
  return turn?.active_permission_profile?.id ?? turn?.metadata?.permissionProfileID
}

function build(ctx: ExecApprovalContext, input: ExecApprovalInput) {
  const active = ctx.turn
  return {
    schema: "aialra.exec_approval_request.v1",
    command_id: input.commandID,
    process_id: input.processID,
    session_id: String(ctx.sessionID),
    turn_id: active?.turnID ? String(active.turnID) : undefined,
    message_id: ctx.messageID ? String(ctx.messageID) : undefined,
    tool_call_id: ctx.callID,
    command: input.command,
    shell: input.shell,
    argv: input.argv,
    cwd: input.cwd,
    environment_id: active?.selected_environment_id ?? "legacy",
    environment_cwd: active ? CodexTurn.environmentCwd(active) : input.cwd,
    backend: input.backend,
    permission_profile_id: profileID(active),
    permission_profile: active?.permission_profile,
    network_policy: active?.network_policy,
    network_permissions: active?.network_permissions,
    shell_env_policy: active?.shell_environment_policy,
    sandbox_policy: active?.sandbox_policy,
    approval_policy: active?.approval_policy,
    risk_level: riskLevel(input),
    reason: input.reason,
    constraints_result: input.constraintsResult ?? {
      reason: input.reason,
      patterns: input.patterns,
      network_targets: input.networkTargets,
      network_decisions: input.networkDecisions,
    },
    requested_by: "assistant_tool",
    requested_at: new Date().toISOString(),
    reviewer: reviewer(active),
    approval_scope: {
      requested: input.reason,
      allowed_scopes: ["reject", "once-command", "turn-command", "turn-all", "always-command", "always-all"],
      default_scope: "once-command",
    },
    expires_at: active ? "turn_end" : undefined,
    final_decision: {
      status: "pending",
    },
    description: input.description,
  }
}

function requestID(input: unknown) {
  if (!input || typeof input !== "object") return
  const value = (input as JsonRecord).request_id ?? (input as JsonRecord).id
  return typeof value === "string" ? value : undefined
}

export namespace ExecApproval {
  export function create(ctx: ExecApprovalContext, input: ExecApprovalInput) {
    return build(ctx, input)
  }

  export function requested(ctx: ExecApprovalContext, input: ExecApprovalInput) {
    const data = build(ctx, input)
    return Effect.all([
      TerminalInteraction.emit({
        sessionID: String(ctx.sessionID),
        turnID: data.turn_id,
        messageID: data.message_id,
        toolCallID: ctx.callID,
        phase: "approval_requested",
        processID: data.process_id,
        commandID: data.command_id,
        backend: input.backend,
        environmentID: data.environment_id,
        cwd: input.cwd,
        command: input.command,
        status: "requested",
        reason: input.reason,
      }),
      AialraTurnTrace.emit({
        phase: "exec.approval.requested",
        turnID: data.turn_id,
        sessionID: String(ctx.sessionID),
        messageID: data.message_id,
        data,
      }),
    ], { concurrency: 1 }).pipe(Effect.as(data))
  }

  export function resolved(input: ExecApprovalResolution) {
    const data = {
      schema: "aialra.exec_approval_result.v1",
      request_id: requestID(input.request),
      request: input.request,
      reply: input.reply,
      scope: input.scope,
      reviewed_by: input.reviewedBy,
      review_result: input.reviewResult,
      review_reason: input.reviewReason,
      review_time: input.reviewTime,
      overridden_by_constraints: input.overriddenByConstraints === true,
      propagated: input.propagated === true,
      final_decision: {
        status: input.reply === "reject" ? "denied" : "approved",
        scope: input.scope,
        reason: input.reviewReason,
        reviewer: input.reviewedBy,
      },
    }
    const request = input.request && typeof input.request === "object" ? (input.request as JsonRecord) : {}
    const sessionID = typeof request.session_id === "string" ? request.session_id : undefined
    const turnID = typeof request.turn_id === "string" ? request.turn_id : undefined
    const messageID = typeof request.message_id === "string" ? request.message_id : undefined
    const toolCallID = typeof request.tool_call_id === "string" ? request.tool_call_id : undefined
    const commandID = typeof request.command_id === "string" ? request.command_id : undefined
    const processID = typeof request.process_id === "string" ? request.process_id : undefined
    const command = typeof request.command === "string" ? request.command : undefined
    const cwd = typeof request.cwd === "string" ? request.cwd : undefined
    const backend = typeof request.backend === "string" ? (request.backend as ExecCommandBackend) : undefined
    const environmentID = typeof request.environment_id === "string" ? request.environment_id : undefined
    return Effect.all([
      sessionID
        ? TerminalInteraction.emit({
            sessionID,
            turnID,
            messageID,
            toolCallID,
            phase: "approval_resolved",
            processID,
            commandID,
            backend,
            environmentID,
            cwd,
            command,
            status: input.reply,
            reason: input.reviewReason,
          })
        : Effect.void,
      AialraTurnTrace.emit({
        phase: "exec.approval.resolved",
        turnID,
        sessionID,
        messageID,
        data,
      }),
    ], { concurrency: 1 })
  }
}

import { Effect } from "effect"
import { AialraTurnTrace } from "./turn-trace"
import { CodexTurn, type TurnContext } from "./turn-context"

type JsonRecord = Record<string, unknown>

type ApplyPatchApprovalContext = {
  sessionID: string
  messageID?: string
  callID?: string
  turn?: TurnContext
}

type ApplyPatchFilePreview = {
  requested_path: string
  resolved_path: string
  operation: string
  move_path?: string
  additions: number
  deletions: number
  diff_sha256: string
  diff_preview: string
  before: unknown
  desired: unknown
  protected_path_checked: boolean
  symlink_realpath_checked: boolean
}

type ApplyPatchApprovalInput = {
  patchText: string
  patchSha256: string
  hunkCount: number
  totalDiff: string
  files: ApplyPatchFilePreview[]
  turnDiffPreview: {
    files_changed: number
    additions: number
    deletions: number
    patch_chars: number
  }
}

type ApplyPatchApprovalResolution = {
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

function riskLevel(input: ApplyPatchApprovalInput) {
  if (input.files.some((file) => /(^|\/)\.(git|agents|codex)(\/|$)/.test(file.resolved_path))) return "high"
  if (input.files.some((file) => file.operation === "delete" || file.operation === "move")) return "medium"
  if (input.files.length > 5 || input.turnDiffPreview.additions + input.turnDiffPreview.deletions > 300) return "medium"
  return "low"
}

function reviewer(turn: TurnContext | undefined) {
  return turn?.approvals_reviewer ?? { role: "user", id: "current_user", label: "User，当前用户", source: "default" }
}

function profileID(turn: TurnContext | undefined) {
  return turn?.active_permission_profile?.id ?? turn?.metadata?.permissionProfileID
}

function build(ctx: ApplyPatchApprovalContext, input: ApplyPatchApprovalInput) {
  const active = ctx.turn
  return {
    schema: "aialra.apply_patch_approval_request.v1",
    session_id: String(ctx.sessionID),
    turn_id: active?.turnID ? String(active.turnID) : undefined,
    message_id: ctx.messageID ? String(ctx.messageID) : undefined,
    tool_call_id: ctx.callID,
    environment_id: active?.selected_environment_id ?? "legacy",
    environment_cwd: active ? CodexTurn.environmentCwd(active) : undefined,
    cwd: active?.cwd,
    permission_profile_id: profileID(active),
    permission_profile: active?.permission_profile,
    sandbox_policy: active?.sandbox_policy,
    approval_policy: active?.approval_policy,
    reviewer: reviewer(active),
    requested_by: "assistant_tool",
    requested_at: new Date().toISOString(),
    patch_sha256: input.patchSha256,
    patch_chars: input.patchText.length,
    hunk_count: input.hunkCount,
    affected_files: input.files,
    turn_diff_preview: input.turnDiffPreview,
    file_mutation_preview: input.files.map((file) => ({
      requested_path: file.requested_path,
      resolved_path: file.resolved_path,
      operation: file.operation,
      before: file.before,
      desired: file.desired,
      additions: file.additions,
      deletions: file.deletions,
    })),
    risk_level: riskLevel(input),
    approval_scope: {
      requested: "apply_patch",
      allowed_scopes: ["reject", "once-command", "turn-command", "turn-all", "always-command", "always-all"],
      default_scope: "once-command",
    },
    final_decision: {
      status: "pending",
      approved_patch_sha256: input.patchSha256,
    },
    total_diff_preview: input.totalDiff.length > 4_000 ? `${input.totalDiff.slice(0, 4_000)}...` : input.totalDiff,
  }
}

function requestID(input: unknown) {
  if (!input || typeof input !== "object") return
  const value = (input as JsonRecord).request_id ?? (input as JsonRecord).id
  return typeof value === "string" ? value : undefined
}

export namespace ApplyPatchApproval {
  export function create(ctx: ApplyPatchApprovalContext, input: ApplyPatchApprovalInput) {
    return build(ctx, input)
  }

  export function requested(ctx: ApplyPatchApprovalContext, input: ApplyPatchApprovalInput) {
    const data = build(ctx, input)
    return AialraTurnTrace.emit({
      phase: "apply_patch.approval.requested",
      turnID: data.turn_id,
      sessionID: String(ctx.sessionID),
      messageID: data.message_id,
      data,
    }).pipe(Effect.as(data))
  }

  export function resolved(input: ApplyPatchApprovalResolution) {
    const data = {
      schema: "aialra.apply_patch_approval_result.v1",
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
    return AialraTurnTrace.emit({
      phase: "apply_patch.approval.resolved",
      turnID: typeof request.turn_id === "string" ? request.turn_id : undefined,
      sessionID: typeof request.session_id === "string" ? request.session_id : undefined,
      messageID: typeof request.message_id === "string" ? request.message_id : undefined,
      data,
    })
  }
}

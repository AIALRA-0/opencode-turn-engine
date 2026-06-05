import { Effect } from "effect"
import { AialraTurnTrace } from "./turn-trace"
import type { GuardianAssessment } from "./guardian-assessment"

type JsonRecord = Record<string, unknown>

export type AutoReviewDecision = "auto_approve" | "auto_deny" | "escalate"

export type AutoReviewResult = {
  schema: "aialra.auto_review_result.v1"
  result_id: string
  session_id: string
  turn_id?: string
  message_id?: string
  tool_call_id?: string
  permission: string
  patterns: string[]
  decided_at: string
  source: "aialra.auto_review"
  auto_review_enabled: boolean
  decision: AutoReviewDecision
  matched_rule: {
    id: string
    category: "tool_type" | "command_pattern" | "path_pattern" | "domain" | "environment" | "permission_profile" | "risk_level" | "project_policy" | "time_window" | "fallback"
    action: AutoReviewDecision
    match: string
  }
  confidence: number
  reason: string
  fallback_reviewer: {
    role: "user" | "guardian" | "external_reviewer"
    id: string
    label: string
  }
  guardian_assessment?: GuardianAssessment
}

type RequestLike = {
  sessionID: string
  turnID?: string
  permission: string
  patterns: string[]
  metadata: JsonRecord
  approval_reviewer?: unknown
  tool?: {
    messageID?: string
    callID?: string
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function reviewerRole(value: unknown) {
  if (typeof value === "string") return value
  if (isRecord(value) && typeof value.role === "string") return value.role
  if (isRecord(value) && typeof value.id === "string") return value.id
  return undefined
}

function safeReadOnlyCommand(command: string) {
  return /^(pwd|ls(\s|$)|cat\s+[^;&|]+$|grep\s+[^;&|]+$|rg\s+[^;&|]+$|find\s+[^;&|]+$|git\s+(status|diff|show|log)\b|node\s+--version$|npm\s+test\b|bun\s+test\b|node\s+--test\b)/i.test(
    command.trim(),
  )
}

function command(input: RequestLike) {
  const execApproval = isRecord(input.metadata.exec_approval) ? input.metadata.exec_approval : undefined
  return typeof execApproval?.command === "string" ? execApproval.command : input.patterns.join(" ")
}

function base(input: RequestLike, guardian: GuardianAssessment | undefined) {
  return {
    schema: "aialra.auto_review_result.v1" as const,
    result_id: `autorev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    session_id: input.sessionID,
    turn_id: input.turnID,
    message_id: input.tool?.messageID ?? input.turnID,
    tool_call_id: input.tool?.callID,
    permission: input.permission,
    patterns: input.patterns,
    decided_at: new Date().toISOString(),
    source: "aialra.auto_review" as const,
    auto_review_enabled: reviewerRole(input.approval_reviewer) === "auto_review",
    fallback_reviewer:
      guardian?.required_reviewer.role === "guardian"
        ? { role: "guardian" as const, id: "guardian", label: "Guardian，安全守护审查器" }
        : { role: "user" as const, id: "current_user", label: "User，当前用户" },
    guardian_assessment: guardian,
  }
}

export namespace AutoReview {
  export function review(input: { request: RequestLike; guardian?: GuardianAssessment }): AutoReviewResult {
    const shared = base(input.request, input.guardian)
    if (!shared.auto_review_enabled) {
      return {
        ...shared,
        decision: "escalate",
        matched_rule: { id: "auto_review.disabled", category: "project_policy", action: "escalate", match: "reviewer!=auto_review" },
        confidence: 1,
        reason: "Auto review 未启用，交给普通审批人处理",
      }
    }
    if (input.guardian?.hard_block || input.guardian?.suggested_decision === "deny") {
      return {
        ...shared,
        decision: "auto_deny",
        matched_rule: { id: "guardian.hard_block", category: "risk_level", action: "auto_deny", match: input.guardian.risk_level },
        confidence: 1,
        reason: input.guardian.user_visible_explanation,
      }
    }
    if (input.guardian && (input.guardian.risk_level === "high" || input.guardian.risk_level === "critical")) {
      return {
        ...shared,
        decision: "escalate",
        matched_rule: { id: "guardian.high_risk", category: "risk_level", action: "escalate", match: input.guardian.risk_level },
        confidence: 0.95,
        reason: "Guardian 标记为高风险，必须升级给人工或 Guardian 审查",
      }
    }
    if (input.guardian?.risk_level === "medium") {
      return {
        ...shared,
        decision: "escalate",
        matched_rule: { id: "guardian.medium_risk", category: "risk_level", action: "escalate", match: input.guardian.risk_level },
        confidence: 0.85,
        reason: "Guardian 标记为中风险，需要用户确认",
      }
    }
    if (input.request.permission === "bash" && safeReadOnlyCommand(command(input.request))) {
      return {
        ...shared,
        decision: "auto_approve",
        matched_rule: { id: "safe_readonly_shell.v1", category: "command_pattern", action: "auto_approve", match: command(input.request) },
        confidence: 0.92,
        reason: "命令属于只读、低风险、无网络、无写入的常见检查命令",
      }
    }
    if (["read", "grep", "glob"].includes(input.request.permission)) {
      return {
        ...shared,
        decision: "auto_approve",
        matched_rule: { id: "safe_read_tool.v1", category: "tool_type", action: "auto_approve", match: input.request.permission },
        confidence: 0.9,
        reason: "请求属于低风险只读工具，并且 Guardian 未发现风险",
      }
    }
    return {
      ...shared,
      decision: "escalate",
      matched_rule: { id: "auto_review.no_clear_rule", category: "fallback", action: "escalate", match: input.request.permission },
      confidence: 0.6,
      reason: "没有命中足够明确的自动审批规则，升级给用户确认",
    }
  }

  export function emit(input: AutoReviewResult) {
    return AialraTurnTrace.emit({
      phase: "auto_review.completed",
      turnID: input.turn_id,
      sessionID: input.session_id,
      messageID: input.message_id,
      data: input,
    })
  }

  export function maybeEmit(input: AutoReviewResult) {
    if (!input.auto_review_enabled) return Effect.void
    return emit(input)
  }
}

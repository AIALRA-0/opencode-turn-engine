import { AialraTurnTrace } from "./turn-trace"
import type { GuardianAssessment } from "./guardian-assessment"

type JsonRecord = Record<string, unknown>

export type ResolvedReviewer = {
  role: "user" | "auto_review" | "guardian" | "policy_engine" | "external_reviewer"
  id: string
  label: string
  source: string
}

export type ReviewerResolution = {
  schema: "aialra.reviewer_resolution.v1"
  resolution_id: string
  session_id: string
  turn_id?: string
  message_id?: string
  tool_call_id?: string
  resolved_at: string
  source: "aialra.reviewer_override"
  order: [
    "per_request",
    "environment_override",
    "connector_override",
    "project_policy",
    "guardian_risk_policy",
    "session_default",
    "current_user_fallback",
  ]
  selected_reviewer: ResolvedReviewer
  matched_source: string
  candidates: Array<{
    source: string
    reviewer?: ResolvedReviewer
    reason: string
    active: boolean
  }>
  user_visible_explanation: string
}

type RequestLike = {
  sessionID: string
  turnID?: string
  approval_reviewer?: unknown
  metadata: JsonRecord
  tool?: {
    messageID?: string
    callID?: string
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function reviewer(input: unknown, source: string): ResolvedReviewer | undefined {
  if (typeof input === "string") {
    if (input === "auto_review") return { role: "auto_review", id: "auto_review", label: "Auto reviewer，自动审批审查器", source }
    if (input === "guardian") return { role: "guardian", id: "guardian", label: "Guardian，安全守护审查器", source }
    if (input === "policy_engine") return { role: "policy_engine", id: "policy_engine", label: "Policy engine，策略引擎审查器", source }
    if (input === "external_reviewer") {
      return { role: "external_reviewer", id: "external_reviewer", label: "External reviewer，外部审批审查器", source }
    }
    if (input === "user") return { role: "user", id: "current_user", label: "User，当前用户", source }
  }
  if (!isRecord(input)) return undefined
  const role = typeof input.role === "string" ? input.role : typeof input.id === "string" ? input.id : undefined
  const resolved = reviewer(role, source)
  if (!resolved) return undefined
  return {
    ...resolved,
    id: typeof input.id === "string" ? input.id : resolved.id,
    label: typeof input.label === "string" ? input.label : resolved.label,
  }
}

function metadataReviewer(metadata: JsonRecord, key: string, source: string) {
  const value = metadata[key]
  if (!isRecord(value)) return undefined
  return reviewer(value.reviewer, source)
}

function environmentReviewer(metadata: JsonRecord) {
  const explicit = metadataReviewer(metadata, "environment_override", "environment_override")
  if (explicit) return explicit
  const env =
    (isRecord(metadata.exec_approval) && typeof metadata.exec_approval.environment_id === "string"
      ? metadata.exec_approval.environment_id
      : undefined) ??
    (isRecord(metadata.request_permissions) && typeof metadata.request_permissions.requested_environment_id === "string"
      ? metadata.request_permissions.requested_environment_id
      : undefined)
  if (env === "enterprise" || env === "managed" || env === "production") {
    return { role: "policy_engine" as const, id: "policy_engine", label: "Policy engine，策略引擎审查器", source: "environment_override" }
  }
  if (env === "remote" || env === "external" || env === "container") {
    return { role: "guardian" as const, id: "guardian", label: "Guardian，安全守护审查器", source: "environment_override" }
  }
  return undefined
}

function connectorReviewer(metadata: JsonRecord) {
  const explicit = metadataReviewer(metadata, "connector_override", "connector_override")
  if (explicit) return explicit
  const connector = isRecord(metadata.connector) ? metadata.connector : undefined
  const type = typeof connector?.type === "string" ? connector.type : undefined
  if (type === "enterprise" || type === "external_mcp" || type === "managed_connector") {
    return { role: "external_reviewer" as const, id: "external_reviewer", label: "External reviewer，外部审批审查器", source: "connector_override" }
  }
  return undefined
}

function guardianReviewer(guardian?: GuardianAssessment) {
  if (!guardian) return undefined
  if (guardian.required_reviewer.role === "guardian") {
    return { role: "guardian" as const, id: "guardian", label: "Guardian，安全守护审查器", source: "guardian_risk_policy" }
  }
  return undefined
}

const fallback = { role: "user" as const, id: "current_user", label: "User，当前用户", source: "current_user_fallback" }

export namespace ReviewerOverride {
  export function resolve(input: { request: RequestLike; guardian?: GuardianAssessment }): ReviewerResolution {
    const candidates = [
      {
        source: "per_request",
        reviewer: metadataReviewer(input.request.metadata, "per_request_reviewer", "per_request"),
        reason: "请求级审批人覆盖",
      },
      {
        source: "environment_override",
        reviewer: environmentReviewer(input.request.metadata),
        reason: "环境级审批人覆盖",
      },
      {
        source: "connector_override",
        reviewer: connectorReviewer(input.request.metadata),
        reason: "连接器级审批人覆盖",
      },
      {
        source: "project_policy",
        reviewer: metadataReviewer(input.request.metadata, "project_policy", "project_policy"),
        reason: "项目策略审批人覆盖",
      },
      {
        source: "guardian_risk_policy",
        reviewer: guardianReviewer(input.guardian),
        reason: "Guardian 风险等级要求更高审查人",
      },
      {
        source: "session_default",
        reviewer: reviewer(input.request.approval_reviewer, "session_default"),
        reason: "会话默认审批人",
      },
      {
        source: "current_user_fallback",
        reviewer: fallback,
        reason: "没有其他覆盖规则，回退当前用户",
      },
    ].map((item) => ({ ...item, active: Boolean(item.reviewer) }))
    const selected = candidates.find((item) => item.reviewer)?.reviewer ?? fallback
    return {
      schema: "aialra.reviewer_resolution.v1",
      resolution_id: `reviewer_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      session_id: input.request.sessionID,
      turn_id: input.request.turnID,
      message_id: input.request.tool?.messageID ?? input.request.turnID,
      tool_call_id: input.request.tool?.callID,
      resolved_at: new Date().toISOString(),
      source: "aialra.reviewer_override",
      order: [
        "per_request",
        "environment_override",
        "connector_override",
        "project_policy",
        "guardian_risk_policy",
        "session_default",
        "current_user_fallback",
      ],
      selected_reviewer: selected,
      matched_source: selected.source,
      candidates,
      user_visible_explanation: `审批人由 ${selected.source} 规则解析为 ${selected.label}`,
    }
  }

  export function emit(input: ReviewerResolution) {
    return AialraTurnTrace.emit({
      phase: "reviewer.resolved",
      turnID: input.turn_id,
      sessionID: input.session_id,
      messageID: input.message_id,
      data: input,
    })
  }
}

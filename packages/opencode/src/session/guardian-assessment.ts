import { Effect } from "effect"
import { AialraTurnTrace } from "./turn-trace"

type JsonRecord = Record<string, unknown>

export type GuardianRiskLevel = "low" | "medium" | "high" | "critical"
export type GuardianSuggestedDecision = "allow" | "ask_user" | "deny"

export type GuardianFinding = {
  code: string
  severity: GuardianRiskLevel
  message: string
  evidence?: string
}

export type GuardianAssessment = {
  schema: "aialra.guardian_assessment.v1"
  assessment_id: string
  session_id: string
  turn_id?: string
  message_id?: string
  tool_call_id?: string
  permission: string
  patterns: string[]
  assessed_at: string
  source: "aialra.guardian"
  risk_level: GuardianRiskLevel
  policy_findings: GuardianFinding[]
  blocked_reasons: string[]
  required_reviewer: {
    role: "user" | "guardian" | "policy_engine"
    id: string
    label: string
  }
  suggested_decision: GuardianSuggestedDecision
  user_visible_explanation: string
  hard_block: boolean
  input_kinds: string[]
}

type RequestLike = {
  sessionID: string
  turnID?: string
  permission: string
  patterns: string[]
  metadata: JsonRecord
  tool?: {
    messageID?: string
    callID?: string
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function metadataRecords(metadata: JsonRecord) {
  return {
    execApproval: isRecord(metadata.exec_approval) ? metadata.exec_approval : undefined,
    applyPatchApproval: isRecord(metadata.apply_patch_approval) ? metadata.apply_patch_approval : undefined,
    requestPermissions: isRecord(metadata.request_permissions) ? metadata.request_permissions : undefined,
  }
}

function protectedPath(value: string) {
  return /(^|[/\\])(\.git|\.agents|\.codex)([/\\]|$)/i.test(value)
}

function secretPath(value: string) {
  return /(^|[/\\])(\.ssh|\.aws|\.gnupg|id_rsa|id_ed25519|\.env|credentials|secrets?)([/\\]|$)/i.test(value)
}

function dangerousCommand(value: string) {
  return /(rm\s+-rf\s+\/|mkfs\b|dd\s+if=|docker\s+run\b.*--privileged|curl\b.*\|\s*(sh|bash)|wget\b.*\|\s*(sh|bash)|chmod\s+777|sudo\s+su)/i.test(
    value,
  )
}

function miningCommand(value: string) {
  return /\b(xmrig|xfsd|stratum\+tcp|cryptonight|minerd|nicehash)\b/i.test(value)
}

function evidence(input: RequestLike) {
  const records = metadataRecords(input.metadata)
  const applyPatchFiles = records.applyPatchApproval
    ? strings(records.applyPatchApproval.affected_files).flatMap((item) => (isRecord(item) ? strings([item.resolved_path, item.requested_path, item.move_path]) : []))
    : []
  return {
    command: stringValue(records.execApproval?.command) ?? input.patterns.join(" "),
    paths: [
      ...input.patterns,
      ...strings(records.requestPermissions?.requested_paths),
      ...applyPatchFiles,
    ].filter(Boolean),
    domains: strings(records.requestPermissions?.requested_domains),
    permissions: strings(records.requestPermissions?.permissions),
    requestedProfile: stringValue(records.requestPermissions?.requested_permission_profile),
    requestedNetwork: stringValue(records.requestPermissions?.requested_network_policy),
    requestedEnvironment: stringValue(records.requestPermissions?.requested_environment_id),
    requestedProviderTools: strings(records.requestPermissions?.requested_provider_tools),
  }
}

function addFinding(output: GuardianFinding[], finding: GuardianFinding) {
  output.push(finding)
}

function findings(input: RequestLike) {
  const data = evidence(input)
  const output: GuardianFinding[] = []

  if (data.command && miningCommand(data.command)) {
    addFinding(output, {
      code: "mining_or_persistence_indicator",
      severity: "critical",
      message: "命令包含挖矿、持久化或可疑远控特征",
      evidence: data.command,
    })
  }
  if (data.command && dangerousCommand(data.command)) {
    addFinding(output, {
      code: "destructive_command",
      severity: "critical",
      message: "命令可能破坏系统、扩大权限或下载脚本直接执行",
      evidence: data.command,
    })
  }

  for (const item of data.paths) {
    if (protectedPath(item)) {
      addFinding(output, {
        code: "protected_path_access",
        severity: input.permission.includes("read") ? "high" : "critical",
        message: "请求访问 .git、.agents 或 .codex 受保护路径",
        evidence: item,
      })
    }
    if (secretPath(item)) {
      addFinding(output, {
        code: "secret_material_access",
        severity: "critical",
        message: "请求访问密钥、凭证或环境秘密文件",
        evidence: item,
      })
    }
  }

  if (data.requestedProfile === "full-access") {
    addFinding(output, {
      code: "full_access_requested",
      severity: "high",
      message: "模型请求切换到完全访问档位",
      evidence: data.requestedProfile,
    })
  }
  if (data.requestedProfile === "disabled") {
    addFinding(output, {
      code: "permission_management_disabled",
      severity: "critical",
      message: "模型请求关闭内置权限管理",
      evidence: data.requestedProfile,
    })
  }
  if (data.requestedNetwork === "on" || data.domains.length > 0 || data.permissions.includes("network")) {
    addFinding(output, {
      code: "network_access_requested",
      severity: data.domains.length > 0 ? "medium" : "high",
      message: "模型请求开启网络或访问外部域名",
      evidence: data.domains.join(", ") || data.requestedNetwork || "network",
    })
  }
  if (data.requestedEnvironment && data.requestedEnvironment !== "default" && data.requestedEnvironment !== "workspace") {
    addFinding(output, {
      code: "unsupported_environment_requested",
      severity: "high",
      message: "模型请求切换到尚未接入的环境",
      evidence: data.requestedEnvironment,
    })
  }
  if (data.requestedProviderTools.length > 0) {
    addFinding(output, {
      code: "provider_tool_requested",
      severity: "medium",
      message: "模型请求启用 provider-hosted 工具",
      evidence: data.requestedProviderTools.join(", "),
    })
  }

  return output
}

function rank(level: GuardianRiskLevel) {
  if (level === "critical") return 4
  if (level === "high") return 3
  if (level === "medium") return 2
  return 1
}

function risk(findings: GuardianFinding[]): GuardianRiskLevel {
  return findings.reduce<GuardianRiskLevel>((max, item) => (rank(item.severity) > rank(max) ? item.severity : max), "low")
}

function hardBlock(findings: GuardianFinding[]) {
  return findings.some((item) =>
    [
      "mining_or_persistence_indicator",
      "destructive_command",
      "secret_material_access",
      "permission_management_disabled",
    ].includes(item.code),
  )
}

function inputKinds(metadata: JsonRecord) {
  return [
    ...(isRecord(metadata.exec_approval) ? ["exec_approval"] : []),
    ...(isRecord(metadata.apply_patch_approval) ? ["apply_patch_approval"] : []),
    ...(isRecord(metadata.request_permissions) ? ["request_permissions"] : []),
  ]
}

function explanation(input: { risk: GuardianRiskLevel; hardBlock: boolean; findings: GuardianFinding[] }) {
  if (input.hardBlock) return `Guardian 已直接拒绝：${input.findings.map((item) => item.message).join("；")}`
  if (input.risk === "high" || input.risk === "critical") {
    return `Guardian 认为这是高风险审批：${input.findings.map((item) => item.message).join("；")}`
  }
  if (input.risk === "medium") {
    return `Guardian 认为需要用户确认：${input.findings.map((item) => item.message).join("；")}`
  }
  return "Guardian 未发现高风险信号，可按普通审批流程处理"
}

export namespace GuardianAssessment {
  export function assess(input: RequestLike): GuardianAssessment {
    const output = findings(input)
    const level = risk(output)
    const blocked = hardBlock(output)
    return {
      schema: "aialra.guardian_assessment.v1",
      assessment_id: `guard_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      session_id: input.sessionID,
      turn_id: input.turnID,
      message_id: input.tool?.messageID ?? input.turnID,
      tool_call_id: input.tool?.callID,
      permission: input.permission,
      patterns: input.patterns,
      assessed_at: new Date().toISOString(),
      source: "aialra.guardian",
      risk_level: level,
      policy_findings: output,
      blocked_reasons: blocked ? output.filter((item) => rank(item.severity) >= rank("critical")).map((item) => item.code) : [],
      required_reviewer:
        blocked || level === "high" || level === "critical"
          ? { role: "guardian", id: "guardian", label: "Guardian，安全守护审查器" }
          : { role: "user", id: "current_user", label: "User，当前用户" },
      suggested_decision: blocked ? "deny" : level === "low" ? "allow" : "ask_user",
      user_visible_explanation: explanation({ risk: level, hardBlock: blocked, findings: output }),
      hard_block: blocked,
      input_kinds: inputKinds(input.metadata),
    }
  }

  export function shouldEmit(input: GuardianAssessment) {
    return input.risk_level !== "low" || input.hard_block
  }

  export function emit(input: GuardianAssessment) {
    return AialraTurnTrace.emit({
      phase: "guardian.assessment.completed",
      turnID: input.turn_id,
      sessionID: input.session_id,
      messageID: input.message_id,
      data: input,
    })
  }

  export function maybeEmit(input: GuardianAssessment) {
    if (!shouldEmit(input)) return Effect.void
    return emit(input)
  }
}

export type PublicEvent = {
  schema: "aialra.public_event.v1"
  version: "1"
  id: string
  sequence: number
  ts: string
  type: string
  source: "trace" | "bus" | "manual"
  threadID: string
  severity: "info" | "warning" | "error"
  sessionID?: string
  turnID?: string
  messageID?: string
  toolCallID?: string
  title: string
  summary?: string
  status?: string
  payloadSchema: string
  payload: Record<string, unknown>
  data: Record<string, unknown>
  rawRef?: {
    id: string
    eventID: string
    encrypted: boolean
    persisted: boolean
  }
}

export type TurnInspectorSummary = {
  status: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  input?: string
  final?: string
  model?: string
  provider?: string
  cwd?: string
  environment?: string
  permissionProfile?: string
  approvalPolicy?: string
  sandboxPolicy?: string
  networkPolicy?: string
  effort?: string
  effortRequested?: string
  effortEffective?: string
  effortSource?: string
  effortFallback?: string
  serviceTier?: string
  effectivePrompt?: string
  handoff?: string
  tools: string[]
  files: string[]
  commands: string[]
  approvals: string[]
  sandboxDenials: string[]
  handoffIssues: string[]
  rawRefs: number
  errors: number
  warnings: number
  eventCount: number
  quality: string[]
}

const summaryStatusLabels: Record<string, string> = {
  aborted: "已中断",
  budget_limited: "预算耗尽",
  completed: "已完成",
  error: "错误",
  failed: "失败",
  passed: "已通过",
  reject: "已拒绝",
  "once-command": "仅允许一次本命令",
  "turn-command": "本对话单轮允许本命令",
  "turn-all": "本对话单轮允许全部命令",
  "always-command": "本对话始终允许本命令",
  "always-all": "本对话始终允许全部命令",
}

const textValue = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

const numberValue = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const boolValue = (value: unknown) => (typeof value === "boolean" ? value : undefined)

const recordValue = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const firstText = (...values: unknown[]) => values.flatMap((value) => [textValue(value)]).find(Boolean)

const firstNumber = (...values: unknown[]) => values.flatMap((value) => [numberValue(value)]).find((value) => value !== undefined)

const addUnique = (items: string[], value: unknown, max = 16) => {
  const text = textValue(value)
  if (!text || items.includes(text) || items.length >= max) return
  items.push(text)
}

const shortText = (value: string | undefined, max = 160) => {
  if (!value) return undefined
  return value.length > max ? `${value.slice(0, max - 1)}...` : value
}

const localizedStatus = (status: string | undefined) => {
  if (!status) return undefined
  return summaryStatusLabels[status] ?? status
}

const payloadText = (event: PublicEvent, ...keys: string[]) => {
  for (const key of keys) {
    const value = firstText(event.data[key], event.payload?.[key])
    if (value) return value
  }
  return undefined
}

const payloadNumber = (event: PublicEvent, ...keys: string[]) => {
  for (const key of keys) {
    const value = firstNumber(event.data[key], event.payload?.[key])
    if (value !== undefined) return value
  }
  return undefined
}

const payloadRecord = (event: PublicEvent, ...keys: string[]) => {
  for (const key of keys) {
    const value = recordValue(event.data[key]) ?? recordValue(event.payload?.[key])
    if (value) return value
  }
  return undefined
}

const effortDisplay = (requested: string | undefined, effective: string | undefined) => {
  if (!requested && !effective) return undefined
  if (!requested) return effective
  if (!effective || requested === effective) return requested
  return `${requested} -> ${effective}`
}

export function buildTurnInspectorSummary(events: PublicEvent[]): TurnInspectorSummary {
  const summary: TurnInspectorSummary = {
    status: "运行中",
    tools: [],
    files: [],
    commands: [],
    approvals: [],
    sandboxDenials: [],
    handoffIssues: [],
    rawRefs: events.filter((event) => !!event.rawRef).length,
    errors: events.filter((event) => event.severity === "error").length,
    warnings: events.filter((event) => event.severity === "warning").length,
    eventCount: events.length,
    quality: [],
  }

  for (const event of events) {
    if (event.type === "turn.started") {
      summary.startedAt = summary.startedAt ?? event.ts
      summary.status = "运行中"
    }
    if (event.type === "turn.completed") {
      summary.finishedAt = event.ts
      summary.status = "已完成"
      summary.durationMs = payloadNumber(event, "durationMs", "duration_ms") ?? summary.durationMs
    }
    if (event.type === "turn.aborted") {
      summary.finishedAt = event.ts
      summary.status = `已中断${payloadText(event, "reason") ? `：${localizedStatus(payloadText(event, "reason")) ?? payloadText(event, "reason")}` : ""}`
      summary.durationMs = payloadNumber(event, "durationMs", "duration_ms") ?? summary.durationMs
    }
    if (event.type === "turn.input.received") {
      summary.input = summary.input ?? shortText(payloadText(event, "preview", "textPreview", "text", "prompt"))
    }
    if (event.type === "prompt.effective.resolved") {
      const hash = payloadText(event, "prompt_hash")
      summary.effectivePrompt = [
        payloadText(event, "version") ?? "v1",
        hash ? hash.slice(0, 12) : undefined,
        payloadNumber(event, "source_count") !== undefined ? `${payloadNumber(event, "source_count")} sources` : undefined,
      ]
        .filter(Boolean)
        .join(" ")
    }
    if (event.type.startsWith("session.handoff.")) {
      summary.handoff = [
        payloadText(event, "source"),
        payloadText(event, "target") ? `-> ${payloadText(event, "target")}` : undefined,
        event.status ? localizedStatus(event.status) ?? event.status : undefined,
      ].filter(Boolean).join(" ")
      if (Array.isArray(event.data.unsupported)) {
        for (const item of event.data.unsupported) addUnique(summary.handoffIssues, item)
      }
      if (event.status === "degraded" || event.severity === "warning") addUnique(summary.quality, "交接降级")
    }
    if (event.type === "final.output") {
      summary.final = shortText(payloadText(event, "preview", "textPreview", "text", "message", "content")) ?? summary.final
    }
    if (event.type === "turn.context.created" || event.type === "session.configured") {
      summary.cwd = payloadText(event, "cwd", "workingDirectory") ?? summary.cwd
      summary.environment = payloadText(event, "environment_id", "environmentID", "environment") ?? summary.environment
      summary.permissionProfile =
        payloadText(event, "permission_profile", "permissionProfile", "effective_permission_profile") ??
        summary.permissionProfile
      summary.approvalPolicy = payloadText(event, "approval_policy", "approvalPolicy") ?? summary.approvalPolicy
      summary.sandboxPolicy = payloadText(event, "sandbox_policy", "sandboxPolicy") ?? summary.sandboxPolicy
      summary.networkPolicy = payloadText(event, "network_policy", "networkPolicy") ?? summary.networkPolicy
      summary.effort = payloadText(event, "effort", "reasoning_effort", "requested_effort", "effective_effort") ?? summary.effort
      summary.serviceTier = payloadText(event, "service_tier", "serviceTier") ?? summary.serviceTier
    }
    if (event.type.startsWith("model.") || event.type === "runtime.provider.selected") {
      summary.model = payloadText(event, "model", "modelID", "model_id") ?? summary.model
      summary.provider = payloadText(event, "provider", "providerID", "provider_id") ?? summary.provider
      const effortResolution = payloadRecord(event, "effort_resolution")
      const effortFallback = recordValue(effortResolution?.fallback)
      summary.effortRequested =
        firstText(payloadText(event, "requested_effort"), effortResolution?.requested) ?? summary.effortRequested
      summary.effortEffective =
        firstText(payloadText(event, "effective_effort"), effortResolution?.effective) ?? summary.effortEffective
      summary.effortSource = firstText(effortResolution?.source) ?? summary.effortSource
      summary.effortFallback =
        boolValue(effortFallback?.applied) === true
          ? firstText(effortFallback?.reason, "provider did not accept requested effort") ?? summary.effortFallback
          : summary.effortFallback
      summary.effort =
        effortDisplay(summary.effortRequested, summary.effortEffective) ??
        payloadText(event, "effort", "effective_effort", "reasoning_effort") ??
        summary.effort
      summary.serviceTier = payloadText(event, "service_tier", "serviceTier") ?? summary.serviceTier
      if (summary.effortFallback) addUnique(summary.quality, "推理档位降级")
    }
    if (event.type.startsWith("tool.") || event.type.startsWith("provider.tool.")) {
      addUnique(summary.tools, payloadText(event, "tool", "toolName", "name", "tool_name"))
    }
    if (event.type === "skill.catalog.resolved") {
      addUnique(summary.quality, `技能目录：可用 ${payloadNumber(event, "availableCount") ?? 0}：禁用 ${payloadNumber(event, "disabledCount") ?? 0}`)
    }
    if (event.type === "skill.catalog.injected") {
      addUnique(summary.quality, `技能注入：${payloadNumber(event, "injectedCount") ?? 0}`)
    }
    if (event.type === "skill.used") {
      addUnique(summary.quality, ["技能使用", payloadText(event, "name", "skill_id")].filter(Boolean).join("："))
    }
    if (event.type.startsWith("file.") || event.type.startsWith("directory.") || event.type === "turn.diff.updated") {
      addUnique(summary.files, payloadText(event, "path", "filePath", "file_path", "target"))
      if (Array.isArray(event.data.files)) {
        for (const file of event.data.files) {
          if (typeof file === "string") addUnique(summary.files, file)
          if (file && typeof file === "object") addUnique(summary.files, (file as Record<string, unknown>).path)
        }
      }
    }
    if (event.type === "patch.quality.scored") {
      addUnique(
        summary.quality,
        [
          "补丁质量",
          payloadNumber(event, "score") !== undefined ? `${payloadNumber(event, "score")}/100` : undefined,
          payloadText(event, "grade"),
        ].filter(Boolean).join(" "),
      )
      if (Array.isArray(event.data.risks) && event.data.risks.length > 0) addUnique(summary.quality, "补丁风险")
    }
    if (event.type.startsWith("command.") || event.type.startsWith("exec_command.")) {
      addUnique(summary.commands, payloadText(event, "command", "cmd"))
    }
    if (event.type.startsWith("approval.") || event.type.startsWith("exec.approval.") || event.type.startsWith("apply_patch.approval.")) {
      addUnique(
        summary.approvals,
        [localizedStatus(event.status) ?? event.status, payloadText(event, "tool", "toolName", "command")].filter(Boolean).join("："),
      )
    }
    if (event.type === "tool.sandbox.denied" || event.type === "security.constraint.denied") {
      addUnique(
        summary.sandboxDenials,
        [payloadText(event, "path", "target"), payloadText(event, "reason")].filter(Boolean).join("："),
      )
    }
    if (event.type === "engineering.zero_patch.detected" || event.type === "engineering.zero_patch.recovery_requested") {
      addUnique(summary.quality, "零补丁恢复")
    }
    if (event.type === "engineering.zero_patch.recovered") addUnique(summary.quality, "零补丁已恢复")
    if (event.type === "engineering.verification.planned") addUnique(summary.quality, "验证计划")
    if (event.type === "engineering.verification.started") addUnique(summary.quality, "验证开始")
    if (event.type === "engineering.verification.finished") {
      addUnique(summary.quality, event.status === "passed" ? "验证通过" : event.status === "skipped" ? "验证跳过" : "验证失败反馈")
    }
    if (event.type === "engineering.benchmark.tier.selected") {
      addUnique(summary.quality, ["评测层级", payloadText(event, "requestedTier"), payloadText(event, "effectiveTier")].filter(Boolean).join("："))
    }
    if (event.type === "engineering.benchmark.started") {
      addUnique(summary.quality, ["评测开始", payloadText(event, "tier")].filter(Boolean).join("："))
    }
    if (event.type === "engineering.benchmark.finished") {
      addUnique(summary.quality, [event.status === "passed" ? "评测通过" : event.status === "skipped" ? "评测跳过" : "评测失败", payloadText(event, "tier")].filter(Boolean).join("："))
    }
    if (event.type === "multi_agent.task.assigned") {
      const assignment = payloadRecord(event, "assignment")
      addUnique(summary.quality, ["多 agent 分配", firstText(assignment?.role, payloadText(event, "role")), firstText(assignment?.agent, payloadText(event, "agent"))].filter(Boolean).join("："))
    }
    if (event.type === "multi_agent.task.settled") {
      const assignment = payloadRecord(event, "assignment")
      addUnique(
        summary.quality,
        [
          event.status === "completed" ? "多 agent 完成" : "多 agent 未完成",
          firstText(assignment?.role, payloadText(event, "role")),
          firstText(assignment?.agent, payloadText(event, "agent")),
        ].filter(Boolean).join("："),
      )
    }
    if (event.type === "multi_agent.conflict.detected") addUnique(summary.quality, "多 agent 冲突")
    if (event.type === "engineering.stop_gate.checked") addUnique(summary.quality, "停止门禁检查")
    if (event.type === "engineering.stop_gate.activated") addUnique(summary.quality, "通过即停止")
    if (event.type === "engineering.deployment_gate.updated") {
      const assessment = payloadRecord(event, "assessment")
      addUnique(
        summary.quality,
        [
          event.status === "blocked" ? "部署门禁阻止" : "部署门禁",
          firstText(assessment?.ruleID, payloadText(event, "ruleID")),
          firstText(assessment?.riskLevel, payloadText(event, "riskLevel")),
        ].filter(Boolean).join("："),
      )
    }
    if (event.type === "engineering.loop.warning" || event.type === "engineering.loop.checkpoint" || event.type === "engineering.loop.blocked") {
      const pattern = payloadRecord(event, "pattern")
      addUnique(
        summary.quality,
        [
          event.type === "engineering.loop.warning" ? "重复工具预警" : event.type === "engineering.loop.checkpoint" ? "重复工具检查点" : "重复工具已阻止",
          firstText(pattern?.tool, payloadText(event, "tool")),
          firstNumber(pattern?.count, payloadNumber(event, "count")) !== undefined
            ? `${firstNumber(pattern?.count, payloadNumber(event, "count"))} 次`
            : undefined,
        ].filter(Boolean).join("："),
      )
    }
    if (event.type === "executor.fallback" || event.type === "exec_command.fallback") addUnique(summary.quality, "执行器回退")
  }

  if (!summary.input) {
    const input = events.find((event) => event.type === "turn.input.received" || event.type === "prompt.received")
    summary.input = input?.summary
  }
  if (!summary.final) {
    summary.final = events.findLast((event) => event.type === "final.output")?.summary
  }
  if (summary.errors > 0) addUnique(summary.quality, `${summary.errors} 个错误`)
  if (summary.warnings > 0) addUnique(summary.quality, `${summary.warnings} 个警告`)
  if (events.some((event) => boolValue(event.data.zero_patch) === true)) addUnique(summary.quality, "零补丁")

  return summary
}

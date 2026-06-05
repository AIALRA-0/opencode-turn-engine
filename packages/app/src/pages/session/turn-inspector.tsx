import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { Virtualizer } from "virtua/solid"
import { buildTurnInspectorSummary, type PublicEvent } from "./turn-inspector-summary"
import { authHeadersFromServer, parseSsePublicEvents, publicEventCursorKey } from "./session-reactivity"

type Filter =
  | "all"
  | "error"
  | "model"
  | "engineering"
  | "tool"
  | "file"
  | "command"
  | "approval"
  | "sandbox"
  | "network"
  | "executor"

type EventSection = {
  key: string
  turnID?: string
  events: PublicEvent[]
}

type InspectorRow =
  | { type: "section"; section: EventSection }
  | { type: "summary"; section: EventSection }
  | { type: "event"; sectionKey: string; event: PublicEvent }

const filterLabels: Record<Filter, string> = {
  all: "全部",
  error: "错误",
  model: "模型",
  engineering: "工程",
  tool: "工具",
  file: "文件",
  command: "命令",
  approval: "审批",
  sandbox: "沙箱",
  network: "网络",
  executor: "执行器",
}

const typeLabels: Record<string, string> = {
  "audit.encryption.unavailable": "审计加密不可用",
  "turn.input.received": "收到用户输入",
  "turn.context.created": "创建回合上下文",
  "turn.started": "回合开始",
  "turn.warning": "回合警告",
  "turn.step_budget.changed": "步骤上限已切换",
  "turn.completed": "回合完成",
  "turn.aborted": "回合中断",
  "turn.abort.requested": "请求中断回合",
  "turn.abort.resolved": "中断请求已处理",
  "turn.terminal.assistant_error": "终态错误消息",
  "turn.terminal.anomaly": "终态异常",
  "turn.terminal.reconciled": "终态已校准",
  "turn.diff.updated": "本轮代码改动已更新",
  "patch.quality.scored": "补丁质量已评分",
  "prompt.effective.resolved": "有效提示词已解析",
  "engineering.controls.changed": "工程控制已变更",
  "engineering.mode.changed": "工程模式已切换",
  "engineering.budget.changed": "工程预算已变更",
  "engineering.benchmark.tier.selected": "评测层级已选择",
  "engineering.benchmark.started": "评测层级开始",
  "engineering.benchmark.finished": "评测层级结束",
  "multi_agent.task.assigned": "多 agent 子任务已分配",
  "multi_agent.task.settled": "多 agent 子任务已收口",
  "multi_agent.conflict.detected": "多 agent 冲突已检测",
  "engineering.run.started": "工程运行开始",
  "engineering.phase.changed": "工程阶段切换",
  "engineering.artifact.updated": "工程产物已更新",
  "engineering.verification.planned": "验证计划已生成",
  "engineering.verification.started": "验证命令开始",
  "engineering.verification.finished": "工程验证结束",
  "engineering.verification.repair_requested": "验证反馈已注入",
  "engineering.phase_gate.blocked_tool": "阶段门禁阻止工具",
  "engineering.phase_gate.premature_final": "阶段门禁继续执行",
  "engineering.zero_patch.detected": "检测到零补丁",
  "engineering.zero_patch.recovery_requested": "请求零补丁恢复",
  "engineering.zero_patch.recovered": "零补丁已恢复",
  "engineering.zero_patch.exhausted": "零补丁恢复耗尽",
  "engineering.stop_gate.checked": "停止门禁已检查",
  "engineering.stop_gate.activated": "通过即停止已开启",
  "engineering.stop_gate.blocked_tool": "停止门禁阻止工具",
  "engineering.loop.warning": "循环风险预警",
  "engineering.loop.checkpoint": "循环检查点",
  "engineering.loop.blocked": "循环已阻止",
  "engineering.reasoning.recorded": "推理内容已记录",
  "engineering.deployment_gate.updated": "部署门禁已更新",
  "engineering.run.finished": "工程运行结束",
  "reasoning.raw.item": "推理原始项已记录",
  "model.raw.chunk": "模型原始分片已记录",
  "model.raw.item": "模型原始响应项已记录",
  "model.request.started": "开始请求模型",
  "model.stream.started": "模型流开始",
  "model.retrying": "模型重试",
  "model.request.finished": "模型请求结束",
  "exec_command.started": "统一命令开始",
  "exec_command.output": "统一命令输出",
  "exec_command.output_delta": "统一命令输出增量",
  "exec_command.end": "统一命令结束",
  "exec_command.finished": "统一命令已完成",
  "exec_command.fallback": "统一命令执行器回退",
  "runtime.provider.selected": "运行时已选择",
  "runtime.item.received": "运行时项目已接收",
  "runtime.item.settled": "运行时项目已收口",
  "item.lifecycle.started": "项目生命周期开始",
  "item.lifecycle.completed": "项目生命周期完成",
  "item.lifecycle.failed": "项目生命周期失败",
  "item.lifecycle.aborted": "项目生命周期中断",
  "executor.started": "执行器开始",
  "executor.finished": "执行器结束",
  "executor.fallback": "执行器回退",
  "exec_process.registered": "后台进程已登记",
  "exec_process.capacity_checked": "后台进程容量已检查",
  "exec_process.capacity_denied": "后台进程容量已满",
  "exec_process.await_started": "等待后台进程",
  "exec_process.await_progress": "后台进程有新进展",
  "exec_process.await_finished": "后台进程等待结束",
  "exec_process.await_timeout": "后台进程等待超时",
  "exec_process.finished": "后台进程已结束",
  "exec_process.finish_ignored": "后台进程重复终态已忽略",
  "exec_process.abort_requested": "后台进程请求中止",
  "exec_process.abort_denied": "后台进程中止被拒绝",
  "exec_process.cleanup": "后台进程清理",
  "tool.call.started": "工具开始执行",
  "tool.call.finished": "工具执行结束",
  "tool.sandbox.capability": "沙箱能力检查",
  "tool.sandbox.checked": "沙箱检查通过",
  "tool.sandbox.denied": "沙箱拒绝访问",
  "sandbox.effective": "沙箱实际策略已记录",
  "file.read": "读取文件",
  "file.write": "写入文件",
  "command.started": "命令开始",
  "command.output": "命令输出",
  "command.finished": "命令结束",
  "network.proxy.applied": "网络代理已应用",
  "network.proxy.unavailable": "网络代理不可用",
  "http.request.classified": "HTTP 请求结果已分类",
  "skill.catalog.resolved": "技能目录已解析",
  "skill.catalog.injected": "技能目录已注入",
  "skill.used": "技能已使用",
  "approval.requested": "请求审批",
  "approval.resolved": "审批完成",
  "final.output": "最终输出",
  "sandbox.profile.changed": "权限档位已切换",
  "sandbox.network.changed": "网络访问已切换",
  "sandbox.command.changed": "命令执行已切换",
  "sandbox.policy.changed": "沙箱策略已切换",
  "sandbox.control.changed": "沙盒控制已变更",
  "approval.policy.changed": "审批策略已切换",
  "executor.backend.changed": "执行器已切换",
  "environment.selected": "执行环境已选择",
  "security.override.requested": "请求安全能力变更",
  "security.override.resolved": "安全能力变更已处理",
}

const statusLabels: Record<string, string> = {
  received: "已收到",
  created: "已创建",
  started: "已开始",
  completed: "已完成",
  aborted: "已中断",
  interrupted: "已打断",
  replaced: "已替换",
  review_ended: "评审结束",
  budget_limited: "预算耗尽",
  assistant_error: "助手消息错误",
  model_not_started: "模型没有成功启动",
  runner_no_terminal: "评测器没有等到终态",
  retrying: "重试中",
  error: "错误",
  failed: "失败",
  finished: "已结束",
  denied: "已拒绝",
  checked: "已检查",
  requested: "等待审批",
  resolved: "已处理",
  once: "允许一次",
  always: "总是允许",
  reject: "已拒绝",
  "once-command": "仅允许一次本命令",
  "turn-command": "本对话单轮允许本命令",
  "turn-all": "本对话单轮允许全部命令",
  "always-command": "本对话始终允许本命令",
  "always-all": "本对话始终允许全部命令",
  output: "输出",
  warning: "警告",
  passed: "已通过",
  blocked: "已阻止",
  checkpoint: "检查点",
  active: "已开启",
  recorded: "已记录",
  captured: "已捕获",
  continued: "继续执行",
  updated: "已更新",
  changed: "已变更",
  restricted: "已限制",
  enabled: "已开启",
  running: "运行中",
  cleaned: "已清理",
  terminated: "已终止并清理",
  summary: "汇总",
  await_timeout: "等待超时",
}

const typeGroup = (type: string): Filter | "turn" | "final" => {
  if (type.startsWith("tool.sandbox.") || type.startsWith("sandbox.")) return "sandbox"
  if (type.startsWith("engineering.")) return "engineering"
  if (type.startsWith("patch.")) return "engineering"
  if (type.startsWith("http.")) return "network"
  if (type.includes("network")) return "network"
  if (type.startsWith("executor.")) return "executor"
  if (type.startsWith("exec_process.")) return "command"
  if (type.startsWith("tool.")) return "tool"
  if (type.startsWith("file.")) return "file"
  if (type.startsWith("command.")) return "command"
  if (type.startsWith("approval.")) return "approval"
  if (type.startsWith("prompt.")) return "model"
  if (type.startsWith("model.")) return "model"
  if (type.startsWith("final.")) return "final"
  return "turn"
}

const groupIcon = (event: PublicEvent): IconProps["name"] => {
  const group = typeGroup(event.type)
  if (event.severity === "error") return "warning"
  if (group === "command") return "terminal"
  if (group === "file") return "file-tree"
  if (group === "approval") return "shield"
  if (group === "sandbox") return "shield"
  if (group === "network") return "link"
  if (group === "executor") return "server"
  if (group === "tool") return "code"
  if (group === "engineering") return "status"
  if (group === "model") return "brain"
  if (group === "final") return "check-small"
  return "status"
}

const formatTime = (ts: string) => {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

const shortID = (value: string | undefined) => {
  if (!value) return "无回合"
  if (value.length <= 14) return value
  return `${value.slice(0, 10)}...${value.slice(-4)}`
}

const textValue = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

const numberValue = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const recordValue = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined)

const arrayValue = (value: unknown) => (Array.isArray(value) ? value : [])

function sectionInsights(events: PublicEvent[]) {
  return [
    events.some((event) => event.type === "engineering.zero_patch.detected" || event.type === "engineering.zero_patch.recovery_requested")
      ? "零补丁恢复"
      : undefined,
    events.some((event) => event.type === "engineering.verification.finished" && event.status !== "passed")
      ? "验证失败反馈"
      : undefined,
    events.some((event) => event.type === "engineering.stop_gate.activated") ? "通过即停止" : undefined,
    events.some((event) => event.type === "executor.fallback") ? "执行器回退" : undefined,
    events.some((event) => event.severity === "error")
      ? `${events.filter((event) => event.severity === "error").length} 个错误`
      : undefined,
  ].filter((item): item is string => !!item)
}

function localizedTitle(event: PublicEvent) {
  return typeLabels[event.type] ?? event.title ?? event.type
}

function localizedStatus(status: string | undefined) {
  if (!status) return undefined
  return statusLabels[status] ?? status
}

function localizedSummary(event: PublicEvent) {
  const data = event.data ?? {}
  const status = localizedStatus(event.status)
  const path = textValue(data.path) ?? textValue(data.filePath) ?? textValue(data.file_path) ?? textValue(data.target)
  const matchedRule =
    data.matchedRule && typeof data.matchedRule === "object" && "id" in data.matchedRule
      ? textValue((data.matchedRule as Record<string, unknown>).id)
      : undefined
  const tool = textValue(data.tool)
  const command = textValue(data.command)
  const cwd = textValue(data.cwd)
  const model = textValue(data.model) ?? textValue(data.modelID)
  const provider = textValue(data.providerID)
  const reason = textValue(data.reason)
  const sourceLabel = textValue(data.sourceLabel) ?? textValue(data.abortSourceLabel)
  const result = textValue(data.result)
  const classification = textValue(data.classification)
  const stream = textValue(data.stream)
  const reply = localizedStatus(textValue(data.reply))
  const scope = localizedStatus(textValue(data.scope))
  const method = textValue(data.method)
  const outputChars = numberValue(data.outputChars)
  const chars = numberValue(data.chars)
  const byteLength = numberValue(data.byte_length)
  const cumulativeByteLength = numberValue(data.cumulative_byte_length)
  const commandChars = chars ?? outputChars
  const seq = numberValue(data.seq)
  const statusCode = numberValue(data.status)
  const durationMs = numberValue(data.durationMs)
  const message = textValue(data.message)
  const from = textValue(data.from)
  const to = textValue(data.to)
  const approvalDecision =
    data.approval_decision && typeof data.approval_decision === "object"
      ? (data.approval_decision as Record<string, unknown>)
      : undefined
  const approvalDecisionLabel = textValue(approvalDecision?.label)
  const approvalDecisionDescription = textValue(approvalDecision?.description)
  const linuxHelper =
    data.linux_sandbox_helper && typeof data.linux_sandbox_helper === "object"
      ? (data.linux_sandbox_helper as Record<string, unknown>)
      : undefined
  const linuxHelperBackend = textValue(linuxHelper?.backend)
  const linuxHelperMode = textValue(linuxHelper?.mode)
  const repeatedPattern = recordValue(data.pattern)
  const repeatedTool = textValue(repeatedPattern?.tool) ?? tool
  const repeatedCount = numberValue(repeatedPattern?.count) ?? numberValue(data.count)
  const repeatedSuggestion = textValue(repeatedPattern?.interventionSuggestion)
  const argumentsSimilarity = textValue(repeatedPattern?.argumentsSimilarity)
  const failureSimilarity = textValue(repeatedPattern?.failureSimilarity)
  const score = numberValue(data.score)
  const grade = textValue(data.grade)
  const risks = arrayValue(data.risks).filter((item): item is string => typeof item === "string")
  const deploymentAssessment = recordValue(data.assessment)
  const deploymentRule = textValue(deploymentAssessment?.ruleID) ?? textValue(data.ruleID)
  const deploymentRisk = textValue(deploymentAssessment?.riskLevel) ?? textValue(data.riskLevel)
  const deploymentAction = textValue(deploymentAssessment?.action) ?? textValue(data.action) ?? event.status
  const deploymentDryRun = deploymentAssessment?.dryRunDetected === true || data.dryRunDetected === true
  const requestedTier = textValue(data.requestedTier)
  const effectiveTier = textValue(data.effectiveTier) ?? textValue(data.tier)
  const benchmarkReason = textValue(data.reason)
  const assignment = recordValue(data.assignment)
  const multiAgentRole = textValue(assignment?.role) ?? textValue(data.role)
  const multiAgentName = textValue(assignment?.agent) ?? textValue(data.agent)
  const subagentSessionID = textValue(assignment?.subagentSessionID) ?? textValue(data.subagentSessionID)
  const resultChars = numberValue(data.resultChars) ?? numberValue(assignment?.resultChars)
  const failureReason = textValue(data.failureReason) ?? textValue(assignment?.failureReason)
  const availableCount = numberValue(data.availableCount)
  const disabledCount = numberValue(data.disabledCount)
  const injectedCount = numberValue(data.injectedCount)
  const skillName = textValue(data.name) ?? textValue(data.skill_id)
  const usageCount = numberValue(data.usage_count)
  const commands = arrayValue(data.commands).filter((item): item is string => typeof item === "string")
  const resources = arrayValue(data.external_resources).filter((item): item is string => typeof item === "string")

  switch (event.type) {
    case "turn.input.received":
      return `用户请求已进入本轮执行${status ? `，状态：${status}` : ""}`
    case "prompt.effective.resolved":
      return `有效提示词 ${textValue(data.version) ?? "v1"} 已解析，hash：${textValue(data.prompt_hash)?.slice(0, 12) ?? "unknown"}，来源 ${numberValue(data.source_count) ?? 0} 个${event.rawRef ? "，完整清单在 rawRef" : ""}`
    case "turn.context.created":
      return `本轮目录：${cwd ?? "未记录"}${model ? `，模型：${model}` : ""}`
    case "turn.started":
      return `本轮开始执行${cwd ? `，目录：${cwd}` : ""}`
    case "turn.warning":
      return event.status === "budget_limited" ? "本轮达到工具步骤上限，已停止继续循环" : "本轮出现需要关注的执行模式"
    case "turn.step_budget.changed":
      return `工具步骤上限已变更${from || to ? `：${from ?? "未知"} -> ${to ?? "未知"}` : ""}`
    case "turn.completed":
      return `本轮正常收尾${durationMs !== undefined ? `，耗时 ${durationMs} ms` : ""}`
    case "turn.aborted":
      return `本轮被中断${sourceLabel ? `，来源：${sourceLabel}` : reason ? `，原因：${localizedStatus(reason) ?? reason}` : ""}`
    case "turn.abort.requested":
      return `收到中断请求${sourceLabel ? `，来源：${sourceLabel}` : ""}${reason ? `，说明：${reason}` : ""}`
    case "turn.abort.resolved":
      return `中断请求已处理${sourceLabel ? `，来源：${sourceLabel}` : ""}${result ? `，结果：${result}` : ""}`
    case "turn.terminal.assistant_error":
      return `系统已写入错误消息${reason ? `，原因：${localizedStatus(reason) ?? reason}` : ""}`
    case "turn.terminal.anomaly":
      return `本轮收尾时发现异常${reason ? `：${localizedStatus(reason) ?? reason}` : ""}`
    case "turn.terminal.reconciled":
      return `本轮终态已校准${status ? `，状态：${localizedStatus(status) ?? status}` : ""}`
    case "turn.diff.updated":
      return event.summary || "本轮代码改动已更新"
    case "patch.quality.scored":
      return [
        `补丁质量评分：${score ?? "未知"}/100`,
        grade ? `等级：${grade}` : undefined,
        risks.length > 0 ? `风险：${risks.join("、")}` : "未发现主要结构风险",
      ].filter(Boolean).join("，")
    case "engineering.controls.changed":
      return "工程控制参数已更新，后续回合会按新设置执行"
    case "engineering.mode.changed":
      return `工程模式从 ${from ?? "未知"} 切换到 ${to ?? "未知"}`
    case "engineering.budget.changed":
      return "工程预算已更新，包括验证轮数、重复工具阈值和命令超时等"
    case "engineering.benchmark.tier.selected":
      return `评测层级已选择：${requestedTier ?? "未知"} -> ${effectiveTier ?? "未知"}${benchmarkReason ? `，原因：${benchmarkReason}` : ""}`
    case "engineering.benchmark.started":
      return `开始 ${effectiveTier ?? "未知"} 层验证${command ? `：${command}` : ""}`
    case "engineering.benchmark.finished":
      return `${effectiveTier ?? "未知"} 层验证${status ? ` ${status}` : "已结束"}${command ? `：${command}` : ""}${outputChars !== undefined ? `，输出 ${outputChars} 字符` : ""}${benchmarkReason ? `，原因：${benchmarkReason}` : ""}`
    case "multi_agent.task.assigned":
      return `已分配 ${multiAgentRole ?? "custom"} 子任务给 ${multiAgentName ?? "未知 agent"}${subagentSessionID ? `，子会话：${subagentSessionID}` : ""}`
    case "multi_agent.task.settled":
      return `${multiAgentRole ?? "custom"} 子任务已${status ?? "收口"}${multiAgentName ? `：${multiAgentName}` : ""}${resultChars !== undefined ? `，结果 ${resultChars} 字符` : ""}${failureReason ? `，原因：${failureReason}` : ""}`
    case "multi_agent.conflict.detected":
      return `多 agent 结果存在冲突${reason ? `：${reason}` : ""}`
    case "engineering.run.started":
      return event.summary || "工程运行已开始"
    case "engineering.phase.changed":
      return `工程阶段切换${from || to ? `：${from ?? "未知"} -> ${to ?? "未知"}` : ""}`
    case "engineering.artifact.updated":
      return event.summary || "工程状态机更新了定位、修改或验证产物"
    case "engineering.verification.planned":
      return event.summary || "系统已为本轮工程任务生成验证计划"
    case "engineering.verification.started":
      return `验证命令开始${command ? `：${command}` : ""}`
    case "engineering.verification.finished":
      if (event.status === "passed") return "验证命令通过，系统将进入最终汇报"
      if (event.status === "skipped") return event.summary || "本轮没有运行可识别验证命令，系统已记录具体跳过原因"
      return "验证命令失败，系统会把失败信息反馈给模型继续修"
    case "engineering.verification.repair_requested":
      return "模型在验证失败后准备结束，系统已把失败日志重新塞回修复阶段"
    case "engineering.phase_gate.blocked_tool":
      return `模型在当前工程阶段过早调用工具，系统已阻止${tool ? `：${tool}` : ""}`
    case "engineering.phase_gate.premature_final":
      return "模型找到修复点后提前停住，系统已要求继续做最小修改和验证"
    case "engineering.zero_patch.detected":
      return "模型准备结束，但当前工程任务还没有任何代码改动"
    case "engineering.zero_patch.recovery_requested":
      return "系统已把零补丁问题反馈给模型，要求继续修改或明确阻塞原因"
    case "engineering.zero_patch.recovered":
      return "之前触发过零补丁恢复，现在已经检测到工作区改动"
    case "engineering.zero_patch.exhausted":
      return "零补丁恢复次数已用完，本轮进入阻塞收口"
    case "engineering.stop_gate.checked":
      return event.summary || "系统已检查 final 前是否还有后台进程、验证、零补丁、审批、工具结果或 raw 落账风险"
    case "engineering.stop_gate.activated":
      return "验证已通过，通过即停止门禁已开启，后续工具调用会被拦住"
    case "engineering.stop_gate.blocked_tool":
      return `验证已通过，系统阻止继续调用工具${tool ? `：${tool}` : ""}`
    case "engineering.loop.warning":
      return [
        "模型出现重复工具调用，系统已记录预警",
        repeatedTool ? `工具：${repeatedTool}` : undefined,
        repeatedCount !== undefined ? `次数：${repeatedCount}` : undefined,
        argumentsSimilarity ? `参数相似度：${argumentsSimilarity}` : undefined,
        failureSimilarity ? `失败相似度：${failureSimilarity}` : undefined,
        repeatedSuggestion,
      ].filter(Boolean).join("，")
    case "engineering.loop.checkpoint":
      return [
        "模型重复路线过多，系统要求换方向",
        repeatedTool ? `工具：${repeatedTool}` : undefined,
        repeatedCount !== undefined ? `次数：${repeatedCount}` : undefined,
        argumentsSimilarity ? `参数相似度：${argumentsSimilarity}` : undefined,
        failureSimilarity ? `失败相似度：${failureSimilarity}` : undefined,
        repeatedSuggestion,
      ].filter(Boolean).join("，")
    case "engineering.loop.blocked":
      return [
        "模型达到用户设置的循环阻止条件，系统已拦截继续空转",
        repeatedTool ? `工具：${repeatedTool}` : undefined,
        repeatedCount !== undefined ? `次数：${repeatedCount}` : undefined,
        argumentsSimilarity ? `参数相似度：${argumentsSimilarity}` : undefined,
        failureSimilarity ? `失败相似度：${failureSimilarity}` : undefined,
        repeatedSuggestion,
      ].filter(Boolean).join("，")
    case "engineering.reasoning.recorded":
      return `模型推理内容已记录${numberValue(data.chars) !== undefined ? `，${numberValue(data.chars)} 字符` : ""}`
    case "reasoning.raw.item":
      if (textValue(data.kind) === "unsupported") {
        return `该模型本轮没有返回可记录的推理原文${reason ? `，原因：${reason}` : ""}`
      }
      return `已记录推理原始项${textValue(data.kind) ? `：${textValue(data.kind)}` : ""}${numberValue(data.sequence) !== undefined ? `，序号 ${numberValue(data.sequence)}` : ""}${chars !== undefined ? `，${chars} 字符` : ""}${textValue(data.display_policy) ? `，展示策略：${textValue(data.display_policy)}` : ""}`
    case "engineering.deployment_gate.updated":
      return [
        deploymentAction === "blocked" ? "部署门禁已阻止高风险命令" : "部署门禁已记录并允许命令",
        deploymentRule ? `规则：${deploymentRule}` : undefined,
        deploymentRisk ? `风险：${deploymentRisk}` : undefined,
        `dry-run：${deploymentDryRun ? "已检测到" : "未检测到"}`,
        event.summary,
      ].filter(Boolean).join("，")
    case "engineering.run.finished":
      return event.summary || "工程运行已收尾"
    case "model.raw.chunk":
      return `已记录模型原始流分片${textValue(data.kind) ? `：${textValue(data.kind)}` : ""}${chars !== undefined ? `，${chars} 字符` : ""}`
    case "model.raw.item":
      return `已记录模型原始响应项${textValue(data.kind) ? `：${textValue(data.kind)}` : ""}${numberValue(data.sequence) !== undefined ? `，序号 ${numberValue(data.sequence)}` : ""}${chars !== undefined ? `，${chars} 字符` : ""}`
    case "model.request.started":
      return `模型请求已发出${provider || model ? `：${[provider, model].filter(Boolean).join("/")}` : ""}`
    case "model.stream.started":
      return "模型开始返回流式内容"
    case "item.lifecycle.started":
      return `项目开始${textValue(data.item_kind) ? `：${textValue(data.item_kind)}` : ""}${textValue(data.item_id) ? `，编号：${textValue(data.item_id)}` : ""}`
    case "item.lifecycle.completed":
      return `项目完成${textValue(data.item_kind) ? `：${textValue(data.item_kind)}` : ""}${textValue(data.item_id) ? `，编号：${textValue(data.item_id)}` : ""}${numberValue(data.duration_ms) !== undefined ? `，耗时 ${numberValue(data.duration_ms)}ms` : ""}`
    case "item.lifecycle.failed":
      return `项目失败${textValue(data.item_kind) ? `：${textValue(data.item_kind)}` : ""}${reason ? `，原因：${reason}` : ""}`
    case "item.lifecycle.aborted":
      return `项目中断${textValue(data.item_kind) ? `：${textValue(data.item_kind)}` : ""}${reason ? `，原因：${reason}` : ""}`
    case "model.retrying":
      return `模型调用正在重试${message ? `：${message}` : ""}`
    case "model.request.finished":
      return event.severity === "error" ? "模型请求以错误收尾" : "模型请求已结束"
    case "exec_command.started":
      return `统一命令开始${command ? `：${command}` : ""}${cwd ? `，目录：${cwd}` : ""}`
    case "exec_command.output":
      return `统一命令产生输出${stream ? `，流：${stream}` : ""}${seq !== undefined ? `，分片：${seq}` : ""}${commandChars !== undefined ? `，${commandChars} 字符` : ""}`
    case "exec_command.output_delta":
      return `统一命令输出 bytes 分片${stream ? `，流：${stream}` : ""}${seq !== undefined ? `，序号：${seq}` : ""}${byteLength !== undefined ? `，本片 ${byteLength} bytes` : ""}${cumulativeByteLength !== undefined ? `，累计 ${cumulativeByteLength} bytes` : ""}${event.rawRef ? "，完整内容在 rawRef" : ""}`
    case "exec_command.end":
      return `统一命令结束${status ? `，状态：${status}` : ""}${durationMs !== undefined ? `，耗时 ${durationMs} ms` : ""}`
    case "exec_command.finished":
      return `统一命令已完成${status ? `，状态：${status}` : ""}`
    case "exec_command.fallback":
      return `统一命令执行器回退${reason ? `，原因：${reason}` : ""}`
    case "executor.started":
      return method?.startsWith("fs/")
        ? `Codex exec-server 已接管文件操作：${method}${path ? `，路径：${path}` : ""}`
        : "Codex exec-server 已接管本次进程启动"
    case "executor.finished":
      return method?.startsWith("fs/")
        ? `Codex exec-server 文件操作已收尾：${method}${durationMs !== undefined ? `，耗时 ${durationMs} ms` : ""}`
        : "Codex exec-server 进程已收尾"
    case "executor.fallback":
      return "Codex 执行服务不可用，已回退到当前 Node/Bun 旧执行器"
    case "exec_process.registered":
      return `后台进程已登记${textValue(data.process_id) ? `：${textValue(data.process_id)}` : ""}${command ? `，命令：${command}` : ""}`
    case "exec_process.capacity_checked":
      return "后台进程容量未超过用户设置，可以启动新的后台命令"
    case "exec_process.capacity_denied":
      return `后台进程容量已满${reason ? `：${reason}` : ""}`
    case "exec_process.await_started":
      return `开始等待后台进程${textValue(data.process_id) ? `：${textValue(data.process_id)}` : ""}`
    case "exec_process.await_progress":
      return `后台进程有新输出或状态变化${outputChars !== undefined ? `，累计 ${outputChars} 字符` : ""}`
    case "exec_process.await_finished":
      return `后台进程等待结束${status ? `，状态：${status}` : ""}`
    case "exec_process.await_timeout":
      return "等待后台进程超时，但进程不会因为等待超时被杀掉"
    case "exec_process.finished":
      return `后台进程已结束${status ? `，状态：${status}` : ""}${reason ? `，原因：${reason}` : ""}`
    case "exec_process.finish_ignored":
      return "后台进程已经有终态，重复终态已忽略"
    case "exec_process.abort_requested":
      return `已请求中止后台进程${reason ? `，原因：${reason}` : ""}`
    case "exec_process.abort_denied":
      return `后台进程中止被拒绝${reason ? `：${reason}` : ""}`
    case "exec_process.cleanup":
      return event.status === "summary"
        ? `后台进程清理汇总，成功 ${numberValue(data.cleaned) ?? 0}，失败 ${numberValue(data.failed) ?? 0}`
        : `后台进程清理动作：${localizedStatus(event.status) ?? event.status ?? "清理"}${textValue(data.process_id) ? `，进程：${textValue(data.process_id)}` : ""}${reason ? `，原因：${reason}` : ""}`
    case "tool.call.started":
      return `工具开始执行${tool ? `：${tool}` : ""}`
    case "tool.call.finished":
      return `工具执行结束${tool ? `：${tool}` : ""}${status ? `，状态：${status}` : ""}`
    case "tool.sandbox.capability":
      return `已检查 Linux 沙箱能力${linuxHelperBackend ? `：${linuxHelperBackend}` : event.data?.backend ? `：${event.data.backend}` : ""}${linuxHelperMode ? `，模式：${linuxHelperMode}` : ""}`
    case "tool.sandbox.checked":
      return `沙箱允许本次访问${path ? `：${path}` : ""}${matchedRule ? `，命中规则：${matchedRule}` : ""}`
    case "tool.sandbox.denied":
      return `沙箱拒绝本次访问${reason ? `：${reason}` : path ? `：${path}` : ""}${matchedRule ? `，命中规则：${matchedRule}` : ""}`
    case "sandbox.effective":
      return `实际生效沙箱策略已记录${tool ? `：${tool}` : ""}${cwd ? `，目录：${cwd}` : ""}${textValue(data.network_policy) ? `，网络：${textValue(data.network_policy)}` : ""}`
    case "file.read":
      return `读取文件${path ? `：${path}` : ""}${outputChars !== undefined ? `，输出 ${outputChars} 字符` : ""}`
    case "file.write":
      return `${event.severity === "error" ? "写入失败" : "写入文件"}${path ? `：${path}` : ""}`
    case "command.started":
      return `开始执行命令${command ? `：${command}` : ""}`
    case "command.output":
      return `命令产生实时输出${stream ? `，流：${stream}` : ""}${seq !== undefined ? `，分片：${seq}` : ""}${commandChars !== undefined ? `，${commandChars} 字符` : ""}`
    case "command.finished":
      return `命令执行结束${command ? `：${command}` : ""}`
    case "network.proxy.applied":
      return `网络代理已应用${tool ? `：${tool}` : ""}${reason ? `，原因：${reason}` : ""}`
    case "network.proxy.unavailable":
      return `网络代理不可用${tool ? `：${tool}` : ""}${reason ? `，原因：${reason}` : ""}`
    case "http.request.classified":
      return `HTTP 请求已分类${classification ? `：${classification}` : ""}${statusCode !== undefined ? `，状态码：${statusCode}` : ""}${textValue(data.url) ? `，地址：${textValue(data.url)}` : ""}`
    case "skill.catalog.resolved":
      return `本轮技能目录已解析，可用 ${availableCount ?? 0} 个，禁用 ${disabledCount ?? 0} 个`
    case "skill.catalog.injected":
      return `技能提示词已注入模型上下文，共 ${injectedCount ?? 0} 个 skill`
    case "skill.used":
      return `模型使用了 skill：${skillName ?? "未知"}${usageCount !== undefined ? `，本轮第 ${usageCount} 次` : ""}${commands.length ? `，关联命令：${commands.slice(0, 3).join("、")}` : ""}${resources.length ? `，外部资源：${resources.slice(0, 2).join("、")}` : ""}`
    case "approval.requested":
      return `等待用户审批${tool ? `：${tool}` : ""}`
    case "approval.resolved":
      return `审批已处理${approvalDecisionLabel ? `：${approvalDecisionLabel}` : scope || reply ? `：${scope ?? reply}` : ""}${approvalDecisionDescription ? `，${approvalDecisionDescription}` : ""}`
    case "final.output":
      return "最终回复已更新"
    case "sandbox.profile.changed":
      return `权限档位从 ${from ?? "未知"} 切换到 ${to ?? "未知"}，后续工具门禁会按新档位执行`
    case "sandbox.network.changed":
      return `网络访问从 ${from ?? "未知"} 切换到 ${to ?? "未知"}，bash 命令沙箱会按这个开关决定是否隔离网络`
    case "sandbox.command.changed":
      return `命令执行从 ${from ?? "未知"} 切换到 ${to ?? "未知"}，后续 bash 命令会按这个策略审批或放行`
    case "sandbox.policy.changed":
      return `沙箱策略已变更${from || to ? `：${from ?? "未知"} -> ${to ?? "未知"}` : ""}`
    case "sandbox.control.changed":
      return "用户在沙盒控制中心修改了后续回合的执行规则"
    case "approval.policy.changed":
      return `审批策略从 ${from ?? "未知"} 切换到 ${to ?? "未知"}`
    case "executor.backend.changed":
      return `执行器偏好从 ${from ?? "未知"} 切换到 ${to ?? "未知"}`
    case "environment.selected":
      return `执行环境从 ${from ?? "未知"} 切换到 ${to ?? "未知"}`
    case "security.override.requested":
      return "用户请求提升或改变本轮安全能力"
    case "security.override.resolved":
      return "安全能力变更请求已处理"
    case "audit.encryption.unavailable":
      return "缺少审计加密密钥，原始内容只能短期保留在内存里"
    default:
      return event.summary || event.type
  }
}

export function TurnInspectorPanel(props: { sessionID: string | undefined; active: boolean }) {
  const layout = useLayout()
  const sdk = useSDK()
  const server = useServer()
  const platform = usePlatform()
  const [store, setStore] = createStore({
    events: [] as PublicEvent[],
    raw: {} as Record<string, { loading?: boolean; error?: string; value?: unknown } | undefined>,
    rawLab: {
      open: false,
      loading: false,
      error: undefined as string | undefined,
      value: undefined as unknown,
      search: "",
    },
    cleanup: {
      loading: false,
      error: undefined as string | undefined,
      result: undefined as unknown,
    },
    collapsedTurns: {} as Record<string, boolean | undefined>,
    filter: "all" as Filter,
    connected: false,
    error: undefined as string | undefined,
  })
  const [pinnedToBottom, setPinnedToBottom] = createSignal(true)
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>()
  let autoCollapsedLatestTurn: string | undefined
  let viewportRef: HTMLDivElement | undefined

  const events = createMemo(() => {
    const filter = store.filter
    if (filter === "all") return store.events
    if (filter === "error") return store.events.filter((event) => event.severity === "error")
    return store.events.filter((event) => typeGroup(event.type) === filter)
  })

  const eventSections = createMemo<EventSection[]>(() => {
    const sections: EventSection[] = []
    for (const event of events()) {
      const key = event.turnID ?? "global"
      const last = sections[sections.length - 1]
      if (last && last.key === key) {
        last.events.push(event)
        continue
      }
      sections.push({ key, turnID: event.turnID, events: [event] })
    }
    return sections
  })

  const latestTurnKey = createMemo(() => {
    const sections = eventSections().filter((section) => section.turnID)
    return sections.at(-1)?.key
  })

  createEffect(() => {
    const latest = latestTurnKey()
    if (!latest) return
    if (latest === autoCollapsedLatestTurn) return
    autoCollapsedLatestTurn = latest
    const keys = eventSections()
      .filter((section) => section.turnID)
      .map((section) => section.key)
    setStore(
      "collapsedTurns",
      produce((draft) => {
        for (const key of keys) {
          if (key === latest) {
            draft[key] = false
            continue
          }
          if (draft[key] === undefined || draft[key] === false) draft[key] = true
        }
      }),
    )
  })

  const isCollapsed = (section: EventSection) => !!section.turnID && store.collapsedTurns[section.key] === true

  const toggleSection = (section: EventSection) => {
    if (!section.turnID) return
    setStore("collapsedTurns", section.key, !isCollapsed(section))
  }

  const inspectorRows = createMemo<InspectorRow[]>(() =>
    eventSections().flatMap((section) => [
      { type: "section", section } satisfies InspectorRow,
      ...(isCollapsed(section) ? [] : [{ type: "summary", section } satisfies InspectorRow]),
      ...(isCollapsed(section)
        ? []
        : section.events.map((event) => ({ type: "event", sectionKey: section.key, event }) satisfies InspectorRow)),
    ]),
  )

  const updatePinnedToBottom = () => {
    const viewport = viewportRef
    if (!viewport) return
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    setPinnedToBottom(distance < 48)
  }

  const scrollToBottom = () => {
    const viewport = viewportRef
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }

  createEffect(() => {
    const count = events().length
    if (!count || !pinnedToBottom()) return
    requestAnimationFrame(scrollToBottom)
  })

  createEffect(() => {
    const sessionID = props.sessionID
    const active = props.active
    if (!sessionID || !active) return

    const abort = new AbortController()
    let stopped = false
    let lastID: string | undefined = window.sessionStorage.getItem(publicEventCursorKey(sessionID)) ?? undefined

    const connect = async () => {
      while (!stopped && !abort.signal.aborted) {
        try {
          setStore("error", undefined)
          const url = new URL(`/session/${sessionID}/events/public`, sdk.url)
          url.searchParams.set("directory", sdk.directory)
          if (lastID) url.searchParams.set("lastEventID", lastID)
          const headers: Record<string, string> = {
            Accept: "text/event-stream",
            ...authHeadersFromServer(server.current),
          }
          if (lastID) headers["Last-Event-ID"] = lastID
          const response = await (platform.fetch ?? fetch)(url, { signal: abort.signal, headers })
          if (!response.ok || !response.body) throw new Error(`公共事件流连接失败：HTTP ${response.status}`)
          setStore("connected", true)
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""
          while (!stopped && !abort.signal.aborted) {
            const result = await reader.read()
            if (result.done) break
            buffer += decoder.decode(result.value, { stream: true })
            const cut = buffer.lastIndexOf("\n\n")
            if (cut === -1) continue
            const ready = buffer.slice(0, cut + 2)
            buffer = buffer.slice(cut + 2)
            for (const event of parseSsePublicEvents(ready) as PublicEvent[]) {
              lastID = event.id
              window.sessionStorage.setItem(publicEventCursorKey(sessionID), event.id)
              setStore(
                "events",
                produce((draft) => {
                  const index = draft.findIndex((x) => x.id === event.id)
                  if (index >= 0) draft[index] = event
                  else draft.push(event)
                  if (draft.length > 1000) draft.splice(0, draft.length - 1000)
                }),
              )
            }
          }
        } catch (error) {
          if (abort.signal.aborted || stopped) return
          setStore("connected", false)
          setStore("error", error instanceof Error ? error.message : String(error))
          await new Promise((resolve) => setTimeout(resolve, 800))
        }
      }
    }

    void connect()
    onCleanup(() => {
      stopped = true
      abort.abort()
      setStore("connected", false)
    })
  })

  const loadRaw = async (event: PublicEvent) => {
    if (!props.sessionID || !event.rawRef) return
    const current = store.raw[event.id]
    if (current?.loading || current?.value !== undefined) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12_000)
    setStore("raw", event.id, { loading: true })
    try {
      const url = new URL(`/session/${props.sessionID}/events/${event.id}/raw`, sdk.url)
      url.searchParams.set("directory", sdk.directory)
      const response = await (platform.fetch ?? fetch)(url, {
        headers: authHeadersFromServer(server.current),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`原始内容加载失败：HTTP ${response.status}`)
      const payload = await response.json()
      setStore("raw", event.id, { loading: false, error: undefined, value: payload.raw ?? payload })
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "原始内容加载超时，请稍后重试"
          : error instanceof Error
            ? error.message
            : String(error)
      setStore("raw", event.id, { loading: false, error: message })
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const clearRaw = (eventID: string) => {
    setStore("raw", eventID, undefined)
  }

  const loadRawLab = async () => {
    if (!props.sessionID || store.rawLab.loading) return
    setStore("rawLab", "open", true)
    setStore("rawLab", "loading", true)
    setStore("rawLab", "error", undefined)
    try {
      const url = new URL(`/session/${props.sessionID}/raw-lab`, sdk.url)
      url.searchParams.set("directory", sdk.directory)
      const response = await (platform.fetch ?? fetch)(url, { headers: authHeadersFromServer(server.current) })
      if (!response.ok) throw new Error(`Raw Lab 加载失败：HTTP ${response.status}`)
      setStore("rawLab", "value", await response.json())
    } catch (error) {
      setStore("rawLab", "error", error instanceof Error ? error.message : String(error))
    } finally {
      setStore("rawLab", "loading", false)
    }
  }

  const rawLabText = createMemo(() => JSON.stringify(store.rawLab.value ?? {}, null, 2))
  const rawLabRecord = createMemo(() => recordValue(store.rawLab.value))
  const rawLabSummary = createMemo(() => recordValue(rawLabRecord()?.summary))
  const rawLabGroups = createMemo(() => recordValue(rawLabRecord()?.groups))
  const rawLabGroupRows = createMemo(() => [
    {
      label: "按回合",
      rows: arrayValue(rawLabGroups()?.byTurn)
        .slice(0, 6)
        .map((row) => recordValue(row))
        .filter((row): row is Record<string, unknown> => !!row)
        .map((row) => `${textValue(row.turnID) ?? "无回合"}：${numberValue(row.eventCount) ?? 0} 事件，${numberValue(row.rawRefCount) ?? 0} raw`),
    },
    {
      label: "按类型",
      rows: arrayValue(rawLabGroups()?.byType)
        .slice(0, 6)
        .map((row) => recordValue(row))
        .filter((row): row is Record<string, unknown> => !!row)
        .map((row) => `${textValue(row.type) ?? "unknown"}：${numberValue(row.eventCount) ?? 0} 事件，${numberValue(row.rawRefCount) ?? 0} raw`),
    },
    {
      label: "按模型调用",
      rows: arrayValue(rawLabGroups()?.modelCalls)
        .slice(0, 6)
        .map((row) => recordValue(row))
        .filter((row): row is Record<string, unknown> => !!row)
        .map((row) => `${textValue(row.modelCallID) ?? "无 modelCall"}：${numberValue(row.rawRefCount) ?? 0} raw`),
    },
    {
      label: "按工具调用",
      rows: arrayValue(rawLabGroups()?.toolCalls)
        .slice(0, 6)
        .map((row) => recordValue(row))
        .filter((row): row is Record<string, unknown> => !!row)
        .map((row) => `${textValue(row.toolCallID) ?? "无 toolCall"}：${numberValue(row.eventCount) ?? 0} 事件，${numberValue(row.rawRefCount) ?? 0} raw`),
    },
  ])
  const filteredRawLabText = createMemo(() => {
    const query = store.rawLab.search.trim().toLowerCase()
    if (!query) return rawLabText()
    return rawLabText()
      .split("\n")
      .filter((line) => line.toLowerCase().includes(query))
      .join("\n")
  })

  const saveBlob = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = name
    link.click()
    URL.revokeObjectURL(url)
  }

  const downloadRawLab = async () => {
    if (!props.sessionID) return
    try {
      const url = new URL(`/session/${props.sessionID}/raw-lab/download`, sdk.url)
      url.searchParams.set("directory", sdk.directory)
      const response = await (platform.fetch ?? fetch)(url, { headers: authHeadersFromServer(server.current) })
      if (!response.ok) throw new Error(`Raw bundle 下载失败：HTTP ${response.status}`)
      const fallback = `aialra-raw-bundle-${props.sessionID}.json`
      const disposition = response.headers.get("content-disposition") ?? ""
      const name = disposition.match(/filename="([^"]+)"/)?.[1] ?? fallback
      saveBlob(await response.blob(), name)
    } catch {
      saveBlob(new Blob([rawLabText()], { type: "application/json;charset=utf-8" }), `raw-lab-${props.sessionID}.json`)
    }
  }

  const processRows = createMemo(() => {
    const rows = new Map<
      string,
      {
        processID: string
        status: string
        command?: string
        backend?: string
        updatedAt: string
      }
    >()
    for (const event of store.events) {
      const processID = textValue(event.data.process_id)
      if (!processID) continue
      const current = rows.get(processID)
      const cleanupStatus = event.type === "exec_process.cleanup" ? textValue(event.data.status) : undefined
      if (cleanupStatus === "summary") continue
      rows.set(processID, {
        processID,
        status:
          cleanupStatus ??
          (event.type === "exec_process.finished" ? textValue(event.data.status) : undefined) ??
          (event.type === "exec_process.registered" ? "running" : undefined) ??
          current?.status ??
          textValue(event.data.status) ??
          "unknown",
        command: textValue(event.data.command) ?? current?.command,
        backend: textValue(event.data.backend) ?? current?.backend,
        updatedAt: event.ts,
      })
    }
    return Array.from(rows.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  })

  const runningProcessCount = createMemo(() => processRows().filter((row) => row.status === "running").length)
  const finishedProcessCount = createMemo(() =>
    processRows().filter((row) => ["completed", "failed", "timeout", "aborted"].includes(row.status)).length,
  )

  const cleanupProcesses = async (payload: Record<string, unknown>) => {
    if (!props.sessionID || store.cleanup.loading) return
    setStore("cleanup", { loading: true, error: undefined, result: undefined })
    try {
      const url = new URL(`/session/${props.sessionID}/process/cleanup`, sdk.url)
      url.searchParams.set("directory", sdk.directory)
      const response = await (platform.fetch ?? fetch)(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...authHeadersFromServer(server.current),
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) throw new Error(`后台进程清理失败：HTTP ${response.status}`)
      setStore("cleanup", { loading: false, error: undefined, result: await response.json() })
    } catch (error) {
      setStore("cleanup", {
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        result: undefined,
      })
    }
  }

  return (
    <div
      id="turn-inspector-panel"
      class="h-full flex flex-col overflow-hidden bg-background-stronger border-l border-border-weaker-base"
      style={{ width: `${layout.turnInspector.width()}px` }}
    >
      <div class="h-10 shrink-0 px-3 flex items-center justify-between border-b border-border-weaker-base">
        <div class="min-w-0">
          <div class="text-12-medium text-text-strong leading-4">回合检查器</div>
          <div class="text-11-regular text-text-weak leading-3 truncate">
            <Show when={store.connected} fallback={store.error ? `连接异常：${store.error}` : "等待事件"}>
              正在接收公共事件流
            </Show>
          </div>
        </div>
        <div class="flex items-center gap-1">
          <Tooltip value="打开 Raw Lab，查看模型请求、流式分片、工具输入输出、trace JSONL、DB 消息和 public event rawRef">
            <Button
              variant={store.rawLab.open ? "primary" : "ghost"}
              size="small"
              class="h-6 px-2 text-11-regular"
              onClick={() => (store.rawLab.open ? setStore("rawLab", "open", false) : void loadRawLab())}
            >
              Raw Lab
            </Button>
          </Tooltip>
          <Tooltip value="关闭回合检查器">
            <IconButton
              icon="close-small"
              variant="ghost"
              class="h-6 w-6"
              onClick={() => layout.turnInspector.close()}
              aria-label="关闭回合检查器"
            />
          </Tooltip>
        </div>
      </div>

      <Show when={processRows().length > 0}>
        <div class="shrink-0 border-b border-border-weaker-base bg-background-base px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-12-medium text-text-strong">后台终端</div>
              <div class="text-11-regular text-text-weak truncate">
                运行中 {runningProcessCount()} 个，已结束待清理 {finishedProcessCount()} 个
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-1">
              <Button
                variant="ghost"
                size="small"
                class="h-6 px-2 text-11-regular"
                disabled={store.cleanup.loading || finishedProcessCount() === 0}
                onClick={() =>
                  void cleanupProcesses({
                    include_finished: true,
                    include_running: false,
                    reason: "turn_inspector_cleanup_finished",
                  })
                }
              >
                清理已结束
              </Button>
              <Button
                variant="ghost"
                size="small"
                class="h-6 px-2 text-11-regular"
                disabled={store.cleanup.loading || runningProcessCount() === 0}
                onClick={() => {
                  if (!window.confirm("这会中止所有运行中的后台终端，确认继续吗")) return
                  void cleanupProcesses({
                    statuses: ["running"],
                    include_finished: false,
                    include_running: true,
                    reason: "turn_inspector_terminate_running",
                  })
                }}
              >
                终止运行中
              </Button>
            </div>
          </div>
          <Show when={store.cleanup.error}>
            {(error) => <div class="mt-1 text-11-regular text-text-on-critical-weak">{error()}</div>}
          </Show>
          <div class="mt-2 max-h-28 overflow-auto space-y-1">
            <For each={processRows()}>
              {(row) => (
                <div class="rounded border border-border-weaker-base bg-background-strong px-2 py-1">
                  <div class="flex items-center gap-2 min-w-0">
                    <span class="text-10-regular text-text-muted shrink-0">{shortID(row.processID)}</span>
                    <span class="text-10-regular text-text-weak shrink-0">{localizedStatus(row.status) ?? row.status}</span>
                    <span class="text-10-regular text-text-muted shrink-0">{row.backend ?? "backend unknown"}</span>
                    <span class="text-11-regular text-text-base truncate">{row.command ?? "命令未记录"}</span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      <div class="shrink-0 px-2 py-2 flex flex-wrap gap-1 border-b border-border-weaker-base">
        <For each={Object.keys(filterLabels) as Filter[]}>
          {(filter) => (
            <Button
              variant={store.filter === filter ? "primary" : "ghost"}
              size="small"
              class="h-6 px-2 text-11-regular"
              onClick={() => setStore("filter", filter)}
            >
              {filterLabels[filter]}
            </Button>
          )}
        </For>
      </div>

      <Show when={store.rawLab.open}>
        <div class="shrink-0 border-b border-border-weaker-base bg-background-base px-3 py-2">
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="text-12-medium text-text-strong">Raw Lab 原始数据实验室</div>
              <div class="text-11-regular text-text-weak truncate">
                统一查看 public event、rawRef、trace JSONL、DB message、DB part 和模型流分片
              </div>
            </div>
            <div class="shrink-0 flex items-center gap-1">
              <Button variant="ghost" size="small" class="h-6 px-2 text-11-regular" onClick={() => void loadRawLab()}>
                刷新
              </Button>
              <Button variant="ghost" size="small" class="h-6 px-2 text-11-regular" onClick={() => void downloadRawLab()}>
                下载
              </Button>
            </div>
          </div>
          <div class="mt-2 flex items-center gap-2">
            <input
              class="h-7 flex-1 rounded border border-border-weaker-base bg-background-strong px-2 text-11-regular text-text-base outline-none"
              placeholder="搜索原始 JSON 行，比如 abort、model.raw.chunk、command.output、rawRef"
              value={store.rawLab.search}
              onInput={(event) => setStore("rawLab", "search", event.currentTarget.value)}
            />
            <div class="text-10-regular text-text-muted shrink-0">
              <Show when={!store.rawLab.loading} fallback="加载中">
                {filteredRawLabText().split("\n").filter(Boolean).length} 行
              </Show>
            </div>
          </div>
          <Show when={store.rawLab.error}>
            {(error) => <div class="mt-2 text-11-regular text-text-on-critical-weak">{error()}</div>}
          </Show>
          <Show when={rawLabSummary()}>
            {(summary) => (
              <div class="mt-2 grid grid-cols-2 gap-1 text-10-regular text-text-muted">
                <span class="rounded bg-surface-weak px-1.5 py-1">事件 {numberValue(summary().eventCount) ?? 0}</span>
                <span class="rounded bg-surface-weak px-1.5 py-1">rawRef {numberValue(summary().rawRefCount) ?? 0}</span>
                <span class="rounded bg-surface-weak px-1.5 py-1">回合 {numberValue(summary().turnCount) ?? 0}</span>
                <span class="rounded bg-surface-weak px-1.5 py-1">模型调用 {numberValue(summary().modelCallCount) ?? 0}</span>
                <span class="rounded bg-surface-weak px-1.5 py-1">工具调用 {numberValue(summary().toolCallCount) ?? 0}</span>
                <span class="rounded bg-surface-weak px-1.5 py-1">trace {numberValue(summary().traceRecordCount) ?? 0}</span>
              </div>
            )}
          </Show>
          <Show when={!store.rawLab.loading && rawLabGroups()}>
            <div class="mt-2 grid gap-2">
              <For each={rawLabGroupRows().filter((group) => group.rows.length > 0)}>
                {(group) => (
                  <div class="rounded border border-border-weaker-base bg-background-strong px-2 py-1">
                    <div class="text-11-medium text-text-strong">{group.label}</div>
                    <div class="mt-1 grid gap-0.5">
                      <For each={group.rows}>
                        {(row) => <div class="text-10-regular text-text-muted truncate">{row}</div>}
                      </For>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <pre class="mt-2 max-h-80 overflow-auto rounded bg-background-strong border border-border-weaker-base p-2 text-10-regular text-text-base whitespace-pre-wrap break-words">
            {store.rawLab.loading ? "正在加载 Raw Lab..." : filteredRawLabText()}
          </pre>
        </div>
      </Show>

      <div class="relative flex-1 min-h-0">
        <ScrollView
          class="h-full"
          data-scrollable
          viewportRef={(el) => {
            viewportRef = el
            setScrollRoot(el)
            updatePinnedToBottom()
          }}
          onScroll={updatePinnedToBottom}
        >
          <div class="px-2 py-2">
            <Show
              when={events().length > 0}
              fallback={
                <div class="h-40 flex items-center justify-center text-center text-12-regular text-text-weak">
                  这个会话还没有公共事件
                </div>
              }
            >
              <Show when={scrollRoot()}>
                {(root) => (
                  <Virtualizer data={inspectorRows()} itemSize={58} scrollRef={root()}>
                    {(row) => (
                      <Switch>
                        <Match when={row.type === "section" ? row.section : undefined}>
                          {(section) => (
                            <div class="px-1 pt-2 pb-1 flex items-center gap-2 text-10-regular text-text-muted">
                              <div class="h-px flex-1 bg-border-weaker-base" />
                              <button
                                type="button"
                                class="shrink-0 inline-flex items-center gap-1 hover:text-text-base"
                                onClick={() => toggleSection(section())}
                              >
                                <Show when={section().turnID}>
                                  <Icon name={isCollapsed(section()) ? "chevron-right" : "chevron-down"} size="small" />
                                </Show>
                                <span>{section().turnID ? `回合 ${shortID(section().turnID)}` : "全局事件"}</span>
                              </button>
                              <span class="shrink-0">{section().events.length} 条</span>
                              <For each={sectionInsights(section().events)}>
                                {(insight) => (
                                  <span class="shrink-0 rounded bg-surface-weak px-1.5 py-0.5 text-10-regular text-text-weak">
                                    {insight}
                                  </span>
                                )}
                              </For>
                              <div class="h-px flex-1 bg-border-weaker-base" />
                            </div>
                          )}
                        </Match>
                        <Match when={row.type === "summary" ? row.section : undefined}>
                          {(section) => {
                            const summary = () => buildTurnInspectorSummary(section().events)
                            const primary = () =>
                              [
                                summary().model ? `模型 ${summary().model}` : undefined,
                                summary().provider ? `供应商 ${summary().provider}` : undefined,
                                summary().cwd ? `目录 ${summary().cwd}` : undefined,
                                summary().environment ? `环境 ${summary().environment}` : undefined,
                              ].filter((item): item is string => !!item)
                            const security = () =>
                              [
                                summary().permissionProfile ? `权限 ${summary().permissionProfile}` : undefined,
                                summary().approvalPolicy ? `审批 ${summary().approvalPolicy}` : undefined,
                                summary().sandboxPolicy ? `沙箱 ${summary().sandboxPolicy}` : undefined,
                                summary().networkPolicy ? `网络 ${summary().networkPolicy}` : undefined,
                                summary().effort ? `推理强度 ${summary().effort}` : undefined,
                                summary().serviceTier ? `服务档位 ${summary().serviceTier}` : undefined,
                                summary().effectivePrompt ? `提示词 ${summary().effectivePrompt}` : undefined,
                              ].filter((item): item is string => !!item)
                            return (
                              <div class="mx-1 mb-1 rounded-md border border-border-weaker-base bg-background-base p-2">
                                <div class="flex items-start justify-between gap-2">
                                  <div class="min-w-0">
                                    <div class="text-12-medium text-text-strong">
                                      本轮总览：{summary().status}
                                      <Show when={summary().durationMs !== undefined}>
                                        <>，耗时 {summary().durationMs} ms</>
                                      </Show>
                                    </div>
                                    <div class="mt-0.5 text-11-regular text-text-weak">
                                      {summary().eventCount} 条事件，{summary().rawRefs} 个 rawRef，工具 {summary().tools.length} 个，文件{" "}
                                      {summary().files.length} 个，命令 {summary().commands.length} 个
                                    </div>
                                  </div>
                                  <div class="shrink-0 flex flex-wrap justify-end gap-1">
                                    <For each={summary().quality}>
                                      {(item) => (
                                        <span class="rounded bg-surface-warning-weak px-1.5 py-0.5 text-10-regular text-text-on-warning-base">
                                          {item}
                                        </span>
                                      )}
                                    </For>
                                  </div>
                                </div>

                                <Show when={summary().input || summary().final}>
                                  <div class="mt-2 grid gap-1">
                                    <Show when={summary().input}>
                                      {(input) => (
                                        <div class="text-11-regular text-text-base">
                                          <span class="text-text-muted">用户输入：</span>
                                          {input()}
                                        </div>
                                      )}
                                    </Show>
                                    <Show when={summary().final}>
                                      {(final) => (
                                        <div class="text-11-regular text-text-base">
                                          <span class="text-text-muted">最终输出：</span>
                                          {final()}
                                        </div>
                                      )}
                                    </Show>
                                  </div>
                                </Show>

                                <div class="mt-2 flex flex-wrap gap-1">
                                  <For each={[...primary(), ...security()]}>
                                    {(item) => (
                                      <span class="rounded bg-surface-weak px-1.5 py-0.5 text-10-regular text-text-weak">
                                        {item}
                                      </span>
                                    )}
                                  </For>
                                  <Show when={summary().errors > 0}>
                                    <span class="rounded bg-surface-critical-weak px-1.5 py-0.5 text-10-regular text-text-on-critical-weak">
                                      错误 {summary().errors}
                                    </span>
                                  </Show>
                                  <Show when={summary().warnings > 0}>
                                    <span class="rounded bg-surface-warning-weak px-1.5 py-0.5 text-10-regular text-text-on-warning-base">
                                      警告 {summary().warnings}
                                    </span>
                                  </Show>
                                </div>

                                <div class="mt-2 grid gap-1 text-10-regular text-text-muted">
                                  <Show when={summary().tools.length > 0}>
                                    <div>工具：{summary().tools.join("、")}</div>
                                  </Show>
                                  <Show when={summary().files.length > 0}>
                                    <div>文件：{summary().files.join("、")}</div>
                                  </Show>
                                  <Show when={summary().commands.length > 0}>
                                    <div>命令：{summary().commands.join("、")}</div>
                                  </Show>
                                  <Show when={summary().approvals.length > 0}>
                                    <div>审批：{summary().approvals.join("、")}</div>
                                  </Show>
                                  <Show when={summary().sandboxDenials.length > 0}>
                                    <div class="text-text-on-warning-base">沙箱拒绝：{summary().sandboxDenials.join("、")}</div>
                                  </Show>
                                  <Show when={summary().handoff}>
                                    {(handoff) => <div>会话交接：{handoff()}</div>}
                                  </Show>
                                  <Show when={summary().handoffIssues.length > 0}>
                                    <div class="text-text-on-warning-base">交接降级：{summary().handoffIssues.join("、")}</div>
                                  </Show>
                                  <Show when={summary().effortFallback}>
                                    {(reason) => (
                                      <div class="text-text-on-warning-base">
                                        推理档位降级：请求 {summary().effortRequested ?? "默认"}，实际{" "}
                                        {summary().effortEffective ?? "未启用"}，原因：{reason()}
                                      </div>
                                    )}
                                  </Show>
                                </div>
                              </div>
                            )
                          }}
                        </Match>
                        <Match when={row.type === "event" ? row.event : undefined}>
                          {(event) => {
                            const raw = () => store.raw[event().id]
                            return (
                              <div class="group rounded-md border border-transparent hover:border-border-weaker-base hover:bg-surface-panel transition-colors">
                                <div class="px-2 py-2 flex items-start gap-2">
                                  <div
                                    class="mt-0.5 size-5 shrink-0 rounded flex items-center justify-center"
                                    classList={{
                                      "bg-surface-critical-weak text-text-on-critical-weak": event().severity === "error",
                                      "bg-surface-warning-weak text-text-on-warning-base": event().severity === "warning",
                                      "bg-surface-weak text-icon-weak": event().severity === "info",
                                    }}
                                  >
                                    <Icon name={groupIcon(event())} size="small" />
                                  </div>
                                  <div class="min-w-0 flex-1">
                                    <div class="flex items-center gap-2 min-w-0">
                                      <div class="text-12-medium text-text-strong truncate">{localizedTitle(event())}</div>
                                      <div class="text-10-regular text-text-muted shrink-0">{formatTime(event().ts)}</div>
                                    </div>
                                    <div class="mt-0.5 text-11-regular text-text-weak truncate">
                                      {localizedSummary(event())}
                                    </div>
                                    <div class="mt-1 flex flex-wrap gap-1 text-10-regular text-text-muted">
                                      <span>{event().type}</span>
                                      <Show when={event().status}>
                                        {(status) => <span>{localizedStatus(status())}</span>}
                                      </Show>
                                      <Show when={event().toolCallID}>
                                        <span>{event().toolCallID}</span>
                                      </Show>
                                    </div>
                                  </div>
                                  <Show when={event().rawRef}>
                                    <Button
                                      variant="ghost"
                                      size="small"
                                      class="h-6 px-2 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                      onClick={() =>
                                        raw()?.value !== undefined || raw()?.error
                                          ? clearRaw(event().id)
                                          : void loadRaw(event())
                                      }
                                    >
                                      {raw()?.value !== undefined || raw()?.error ? "收起" : "原始"}
                                    </Button>
                                  </Show>
                                </div>
                                <Show when={raw()}>
                                  {(state) => (
                                    <div class="px-2 pb-2">
                                      <Switch>
                                        <Match when={state().loading}>
                                          <div class="text-11-regular text-text-weak px-2 py-1">正在加载原始内容...</div>
                                        </Match>
                                        <Match when={state().error}>
                                          <div class="text-11-regular text-text-on-critical-weak px-2 py-1">{state().error}</div>
                                        </Match>
                                        <Match when={state().value !== undefined}>
                                          <pre class="max-h-72 overflow-auto rounded bg-background-base border border-border-weaker-base p-2 text-10-regular text-text-base whitespace-pre-wrap break-words">
                                            {JSON.stringify(state().value, null, 2)}
                                          </pre>
                                        </Match>
                                      </Switch>
                                    </div>
                                  )}
                                </Show>
                              </div>
                            )
                          }}
                        </Match>
                      </Switch>
                    )}
                  </Virtualizer>
                )}
              </Show>
            </Show>
          </div>
        </ScrollView>
        <Show when={!pinnedToBottom()}>
          <Button
            variant="primary"
            size="small"
            class="absolute right-3 bottom-3 h-7 px-3 text-11-regular shadow"
            onClick={() => {
              setPinnedToBottom(true)
              scrollToBottom()
            }}
          >
            跳到最新
          </Button>
        </Show>
        <div onPointerDown={(event) => event.stopPropagation()}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={layout.turnInspector.width()}
            min={280}
            max={640}
            onResize={(width) => layout.turnInspector.resize(width)}
          />
        </div>
      </div>
    </div>
  )
}

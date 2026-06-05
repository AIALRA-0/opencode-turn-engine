import { Schema } from "effect"
import { PublicEventLog } from "./public-event"
import type { TurnContext } from "./turn-context"
import { ExecProcessRegistry } from "./exec-process-registry"
import { TurnDiffStore } from "./turn-diff"

export const EngineeringMode = Schema.Literals(["fast", "balanced", "deep", "long"])
export type EngineeringMode = typeof EngineeringMode.Type

export const EngineeringControls = Schema.Struct({
  mode: EngineeringMode,
  advancedEnabled: Schema.Boolean,
  verificationRounds: Schema.Number,
  localizeToolMax: Schema.Number,
  repeatedToolWarning: Schema.Number,
  repeatedToolCheckpoint: Schema.Number,
  repeatedToolStop: Schema.Number,
  noProgressMinutes: Schema.Number,
  patchMaxFiles: Schema.Number,
  patchMaxBytes: Schema.Number,
  testOutputMaxBytes: Schema.Number,
  zeroPatchRecoveryMax: Schema.Number,
  totalToolCallsMax: Schema.Number,
  singleCommandTimeoutMs: Schema.Number,
  backgroundTerminalMaxTimeoutMs: Schema.Number,
  awaiterMaxTimeoutMs: Schema.Number,
  maxLiveProcessesPerSession: Schema.Number,
  maxLiveProcessesPerTurn: Schema.Number,
  maxLiveProcessesPerEnvironment: Schema.Number,
  longRun: Schema.Boolean,
})
export type EngineeringControls = typeof EngineeringControls.Type

export const EngineeringControlsPatch = Schema.Struct({
  mode: Schema.optional(EngineeringMode),
  advancedEnabled: Schema.optional(Schema.Boolean),
  verificationRounds: Schema.optional(Schema.Number),
  localizeToolMax: Schema.optional(Schema.Number),
  repeatedToolWarning: Schema.optional(Schema.Number),
  repeatedToolCheckpoint: Schema.optional(Schema.Number),
  repeatedToolStop: Schema.optional(Schema.Number),
  noProgressMinutes: Schema.optional(Schema.Number),
  patchMaxFiles: Schema.optional(Schema.Number),
  patchMaxBytes: Schema.optional(Schema.Number),
  testOutputMaxBytes: Schema.optional(Schema.Number),
  zeroPatchRecoveryMax: Schema.optional(Schema.Number),
  totalToolCallsMax: Schema.optional(Schema.Number),
  singleCommandTimeoutMs: Schema.optional(Schema.Number),
  backgroundTerminalMaxTimeoutMs: Schema.optional(Schema.Number),
  awaiterMaxTimeoutMs: Schema.optional(Schema.Number),
  maxLiveProcessesPerSession: Schema.optional(Schema.Number),
  maxLiveProcessesPerTurn: Schema.optional(Schema.Number),
  maxLiveProcessesPerEnvironment: Schema.optional(Schema.Number),
  longRun: Schema.optional(Schema.Boolean),
})
export type EngineeringControlsPatch = typeof EngineeringControlsPatch.Type

export type EngineeringPhase =
  | "intake"
  | "clarify"
  | "localize"
  | "plan"
  | "edit"
  | "verify"
  | "repair"
  | "finalize"
  | "blocked"

export type EngineeringTaskClass = "bug_fix" | "feature" | "refactor" | "test" | "security" | "deployment" | "unknown"
export type EngineeringRiskLevel = "low" | "medium" | "high"

export type EngineeringRunSnapshot = {
  version: "aialra.engineering_run.v3"
  phase: EngineeringPhase
  controls: EngineeringControls
  benchmark: {
    schema: "aialra.benchmark_tier.v1"
    requestedTier: EngineeringBenchmarkTier
    effectiveTier: EngineeringBenchmarkTier
    reason: string
    runs: EngineeringBenchmarkTierRun[]
    passed: number
    failed: number
    skipped: number
    totalDurationMs: number
    totalOutputChars: number
    cost: {
      outputChars: number
      commandCount: number
      estimate: "output_chars_proxy"
    }
  }
  intake: {
    taskClass: EngineeringTaskClass
    riskLevel: EngineeringRiskLevel
    needsClarification: boolean
    expectedEvidence: string[]
  }
  verification: {
    attempts: number
    passed: boolean
    skipRequests: number
    skipped: boolean
    skipReason?: string
    lastCommand?: string
    lastExit?: number | null
  }
  stopGate: {
    active: boolean
    reason?: string
    checks: EngineeringStopGateCheck[]
  }
  loop: {
    toolCalls: number
    warnings: number
    checkpoints: number
    blocked: number
    patterns: EngineeringRepeatedToolPattern[]
  }
  deployment: {
    checks: EngineeringDeploymentGateAssessment[]
    blocked: number
    allowed: number
  }
  multiAgent: {
    schema: "aialra.multi_agent.v2"
    assignments: EngineeringMultiAgentAssignment[]
    active: number
    completed: number
    failed: number
    conflicts: EngineeringMultiAgentConflict[]
    settlements: EngineeringMultiAgentSettlement[]
  }
  phaseGate: {
    blocked: number
    prematureFinals: number
  }
  patch: {
    writeToolCalls: number
    zeroPatchRecoveries: number
    zeroPatchExhausted: boolean
    zeroPatchRecovered: boolean
    lastWorkspaceChanged?: boolean
  }
  feedback: {
    items: EngineeringFeedbackItem[]
  }
  artifacts: EngineeringArtifacts
}

export type EngineeringStopGateCheck = {
  name:
    | "verification"
    | "zero_patch"
    | "live_process"
    | "pending_approval"
    | "tool_result_settlement"
    | "raw_output"
    | "final_schema"
  status: "pass" | "continue" | "blocked" | "unknown"
  reason: string
  count?: number
  at: number
}

export type EngineeringRepeatedToolPattern = {
  signature: string
  tool: string
  count: number
  threshold: {
    warning: number
    checkpoint: number
    stop: number
  }
  argumentsSimilarity: "exact" | "normalized" | "unknown"
  failureSimilarity: "not_observed" | "same_error" | "unknown"
  inputPreview: string
  interventionSuggestion: string
  status: "warning" | "checkpoint" | "blocked"
  at: number
}

export type EngineeringDeploymentGateAssessment = {
  schema: "aialra.deployment_gate.v1"
  commandPreview: string
  gate: "build" | "health" | "runtime" | "publish" | "infra" | "database" | "remote" | "deployment"
  ruleID: string
  matchedRule: string
  riskLevel: "low" | "medium" | "high"
  action: "allowed" | "blocked"
  requiresApproval: boolean
  requiresDryRun: boolean
  dryRunDetected: boolean
  explicitConfirmationDetected: boolean
  approvalPolicy?: string
  approvalsReviewer?: string
  environmentID?: string
  cwd?: string
  reason: string
  suggestion: string
  at: number
}

export type EngineeringBenchmarkTier =
  | "smoke"
  | "unit"
  | "integration"
  | "official-harness"
  | "swe-bench"
  | "full-regression"
  | "performance"
  | "security"
  | "custom"

export type EngineeringBenchmarkTierRun = {
  id: string
  requestedTier: EngineeringBenchmarkTier
  effectiveTier: EngineeringBenchmarkTier
  command: string
  status: "started" | "passed" | "failed" | "skipped"
  startedAt: number
  finishedAt?: number
  durationMs?: number
  exit?: number | null
  outputChars?: number
  failureReason?: string
  cost?: {
    outputChars: number
    estimate: "output_chars_proxy"
  }
}

export type EngineeringMultiAgentRole =
  | "planner"
  | "implementer"
  | "reviewer"
  | "tester"
  | "awaiter"
  | "guardian"
  | "summarizer"
  | "custom"

export type EngineeringMultiAgentAssignment = {
  schema: "aialra.multi_agent.v2"
  id: string
  role: EngineeringMultiAgentRole
  agent: string
  parentSessionID: string
  subagentSessionID?: string
  description: string
  status: "assigned" | "running" | "completed" | "failed" | "cancelled"
  background: boolean
  model?: { providerID: string; modelID: string }
  permissionSummary: string[]
  startedAt: number
  completedAt?: number
  resultChars?: number
  failureReason?: string
}

export type EngineeringMultiAgentConflict = {
  id: string
  assignmentIDs: string[]
  reason: string
  status: "open" | "resolved"
  at: number
}

export type EngineeringMultiAgentSettlement = {
  id: string
  assignmentID: string
  status: "accepted" | "rejected" | "merged"
  summary: string
  at: number
}

export type EngineeringFeedbackItem = {
  id: string
  kind: "verification_failed" | "loop_checkpoint" | "phase_gate" | "zero_patch" | "terminal_anomaly" | "deployment_gate"
  summary: string
  detail?: string
  command?: string
  exit?: number | null
  failedFiles?: string[]
  assertions?: string[]
  expected?: string
  actual?: string
  tool?: string
  at: number
}

export type EngineeringArtifactFile = {
  path: string
  reason: string
  source: string
  at: number
}

export type EngineeringArtifactPlan = {
  summary: string
  files: string[]
  verification: string[]
  at: number
}

export type EngineeringVerificationResult = {
  command: string
  exit: number | null
  passed: boolean
  skipped?: boolean
  skipReason?: string
  summary?: string
  detail?: string
  failedFiles?: string[]
  assertions?: string[]
  expected?: string
  actual?: string
  at: number
}

export type EngineeringVerificationRun = {
  id: string
  command: string
  status: "started" | "passed" | "failed" | "skipped"
  exit?: number | null
  startedAt: number
  finishedAt?: number
  outputChars?: number
  skipReason?: string
}

export type EngineeringFinalSummary = {
  text: string
  at: number
}

export type EngineeringArtifacts = {
  suspectedFiles: EngineeringArtifactFile[]
  editPlan?: EngineeringArtifactPlan
  verificationPlan?: EngineeringArtifactPlan
  verificationRuns: EngineeringVerificationRun[]
  verificationResults: EngineeringVerificationResult[]
  repairFeedback: EngineeringFeedbackItem[]
  finalSummary?: EngineeringFinalSummary
}

type RuntimeState = EngineeringRunSnapshot & {
  sessionID: string
  turnID: string
  repeated: Map<string, number>
  startedAt: number
  lastProgressAt: number
}

const states = new Map<string, RuntimeState>()

const presets: Record<EngineeringMode, EngineeringControls> = {
  fast: {
    mode: "fast",
    advancedEnabled: false,
    verificationRounds: 1,
    localizeToolMax: 8,
    repeatedToolWarning: 3,
    repeatedToolCheckpoint: 5,
    repeatedToolStop: 8,
    noProgressMinutes: 8,
    patchMaxFiles: 6,
    patchMaxBytes: 60_000,
    testOutputMaxBytes: 80_000,
    zeroPatchRecoveryMax: 1,
    totalToolCallsMax: 80,
    singleCommandTimeoutMs: 120_000,
    backgroundTerminalMaxTimeoutMs: 300_000,
    awaiterMaxTimeoutMs: 3_600_000,
    maxLiveProcessesPerSession: 16,
    maxLiveProcessesPerTurn: 8,
    maxLiveProcessesPerEnvironment: 8,
    longRun: false,
  },
  balanced: {
    mode: "balanced",
    advancedEnabled: false,
    verificationRounds: 2,
    localizeToolMax: 16,
    repeatedToolWarning: 3,
    repeatedToolCheckpoint: 6,
    repeatedToolStop: 10,
    noProgressMinutes: 15,
    patchMaxFiles: 12,
    patchMaxBytes: 180_000,
    testOutputMaxBytes: 160_000,
    zeroPatchRecoveryMax: 2,
    totalToolCallsMax: 180,
    singleCommandTimeoutMs: 300_000,
    backgroundTerminalMaxTimeoutMs: 300_000,
    awaiterMaxTimeoutMs: 3_600_000,
    maxLiveProcessesPerSession: 64,
    maxLiveProcessesPerTurn: 16,
    maxLiveProcessesPerEnvironment: 16,
    longRun: false,
  },
  deep: {
    mode: "deep",
    advancedEnabled: false,
    verificationRounds: 4,
    localizeToolMax: 32,
    repeatedToolWarning: 4,
    repeatedToolCheckpoint: 8,
    repeatedToolStop: 14,
    noProgressMinutes: 30,
    patchMaxFiles: 24,
    patchMaxBytes: 420_000,
    testOutputMaxBytes: 260_000,
    zeroPatchRecoveryMax: 3,
    totalToolCallsMax: 420,
    singleCommandTimeoutMs: 900_000,
    backgroundTerminalMaxTimeoutMs: 1_800_000,
    awaiterMaxTimeoutMs: 3_600_000,
    maxLiveProcessesPerSession: 64,
    maxLiveProcessesPerTurn: 32,
    maxLiveProcessesPerEnvironment: 32,
    longRun: false,
  },
  long: {
    mode: "long",
    advancedEnabled: false,
    verificationRounds: 8,
    localizeToolMax: 64,
    repeatedToolWarning: 5,
    repeatedToolCheckpoint: 10,
    repeatedToolStop: 0,
    noProgressMinutes: 60,
    patchMaxFiles: 60,
    patchMaxBytes: 1_000_000,
    testOutputMaxBytes: 420_000,
    zeroPatchRecoveryMax: 8,
    totalToolCallsMax: 0,
    singleCommandTimeoutMs: 1_800_000,
    backgroundTerminalMaxTimeoutMs: 7_200_000,
    awaiterMaxTimeoutMs: 21_600_000,
    maxLiveProcessesPerSession: 128,
    maxLiveProcessesPerTurn: 64,
    maxLiveProcessesPerEnvironment: 64,
    longRun: true,
  },
}

const clamp = (value: unknown, fallback: number, min: number, max: number) => {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.trunc(value)))
}

export namespace EngineeringHarness {
  export function preset(mode: EngineeringMode) {
    return { ...presets[mode] }
  }

  export function defaults() {
    return preset("balanced")
  }

  export function normalize(input: EngineeringControls | EngineeringControlsPatch | undefined, base = defaults()) {
    const mode = input?.mode ?? base.mode
    const presetValue = presets[mode] ?? base
    return {
      mode,
      advancedEnabled: input?.advancedEnabled ?? base.advancedEnabled,
      verificationRounds: clamp(input?.verificationRounds, presetValue.verificationRounds, 0, 50),
      localizeToolMax: clamp(input?.localizeToolMax, presetValue.localizeToolMax, 1, 1000),
      repeatedToolWarning: clamp(input?.repeatedToolWarning, presetValue.repeatedToolWarning, 1, 1000),
      repeatedToolCheckpoint: clamp(input?.repeatedToolCheckpoint, presetValue.repeatedToolCheckpoint, 1, 1000),
      repeatedToolStop: clamp(input?.repeatedToolStop, presetValue.repeatedToolStop, 0, 10_000),
      noProgressMinutes: clamp(input?.noProgressMinutes, presetValue.noProgressMinutes, 1, 24 * 60),
      patchMaxFiles: clamp(input?.patchMaxFiles, presetValue.patchMaxFiles, 1, 1000),
      patchMaxBytes: clamp(input?.patchMaxBytes, presetValue.patchMaxBytes, 1_000, 50_000_000),
      testOutputMaxBytes: clamp(input?.testOutputMaxBytes, presetValue.testOutputMaxBytes, 1_000, 50_000_000),
      zeroPatchRecoveryMax: clamp(input?.zeroPatchRecoveryMax, presetValue.zeroPatchRecoveryMax, 0, 50),
      totalToolCallsMax: clamp(input?.totalToolCallsMax, presetValue.totalToolCallsMax, 0, 100_000),
      singleCommandTimeoutMs: clamp(input?.singleCommandTimeoutMs, presetValue.singleCommandTimeoutMs, 1_000, 24 * 60 * 60 * 1000),
      backgroundTerminalMaxTimeoutMs: clamp(
        input?.backgroundTerminalMaxTimeoutMs,
        presetValue.backgroundTerminalMaxTimeoutMs,
        1_000,
        24 * 60 * 60 * 1000,
      ),
      awaiterMaxTimeoutMs: clamp(input?.awaiterMaxTimeoutMs, presetValue.awaiterMaxTimeoutMs, 1_000, 24 * 60 * 60 * 1000),
      maxLiveProcessesPerSession: clamp(input?.maxLiveProcessesPerSession, presetValue.maxLiveProcessesPerSession, 0, 10_000),
      maxLiveProcessesPerTurn: clamp(input?.maxLiveProcessesPerTurn, presetValue.maxLiveProcessesPerTurn, 0, 10_000),
      maxLiveProcessesPerEnvironment: clamp(
        input?.maxLiveProcessesPerEnvironment,
        presetValue.maxLiveProcessesPerEnvironment,
        0,
        10_000,
      ),
      longRun: input?.longRun ?? presetValue.longRun,
    } satisfies EngineeringControls
  }

  export function applyMode(input: EngineeringControls, mode: EngineeringMode) {
    return { ...preset(mode), advancedEnabled: input.advancedEnabled }
  }

  export function classify(text: string) {
    const lower = text.toLowerCase()
    const taskClass: EngineeringTaskClass = /部署|上线|发布|容器|docker|compose|nginx|域名|systemd|healthcheck|deploy|deployment|container|kubernetes|helm/.test(lower)
      ? "deployment"
      : /漏洞|安全|security|xss|csrf|auth/.test(lower)
      ? "security"
      : /bug|修|错误|失败|报错|regression|fails?|broken/.test(lower)
        ? "bug_fix"
        : /测试|test|spec|coverage/.test(lower)
          ? "test"
          : /重构|refactor|整理|抽象/.test(lower)
            ? "refactor"
            : /新增|feature|支持|添加|实现/.test(lower)
              ? "feature"
              : "unknown"
    const riskLevel: EngineeringRiskLevel = /删除|迁移|生产|数据库|凭证|密钥|权限|全局|danger|prod|credential|delete|migration/.test(
      lower,
    )
      ? "high"
      : /大改|重构|全量|复杂|架构|并发|缓存|性能|权限/.test(lower)
        ? "medium"
        : "low"
    return {
      taskClass,
      riskLevel,
      needsClarification: riskLevel === "high" && /随便|大量|全量删除|生产|数据库/.test(lower),
      expectedEvidence: expectedEvidence(taskClass),
    } satisfies EngineeringRunSnapshot["intake"]
  }

  export function snapshot(input: { controls: EngineeringControls; prompt: string }): EngineeringRunSnapshot {
    return {
      version: "aialra.engineering_run.v3",
      phase: "intake",
      controls: input.controls,
      benchmark: benchmarkSnapshot(input.prompt),
      intake: classify(input.prompt),
      verification: {
        attempts: 0,
        passed: false,
        skipRequests: 0,
        skipped: false,
      },
      stopGate: {
        active: false,
        checks: [],
      },
      loop: {
        toolCalls: 0,
        warnings: 0,
        checkpoints: 0,
        blocked: 0,
        patterns: [],
      },
      deployment: {
        checks: [],
        blocked: 0,
        allowed: 0,
      },
      multiAgent: {
        schema: "aialra.multi_agent.v2",
        assignments: [],
        active: 0,
        completed: 0,
        failed: 0,
        conflicts: [],
        settlements: [],
      },
      phaseGate: {
        blocked: 0,
        prematureFinals: 0,
      },
      patch: {
        writeToolCalls: 0,
        zeroPatchRecoveries: 0,
        zeroPatchExhausted: false,
        zeroPatchRecovered: false,
      },
      feedback: {
        items: [],
      },
      artifacts: {
        suspectedFiles: [],
        verificationRuns: [],
        verificationResults: [],
        repairFeedback: [],
      },
    }
  }

  export function start(input: { turn: TurnContext; prompt: string }) {
    const current = snapshot({
      controls: input.turn.engineering?.controls ?? defaults(),
      prompt: input.prompt,
    })
    const runtime: RuntimeState = {
      ...current,
      sessionID: input.turn.sessionID,
      turnID: input.turn.turnID,
      repeated: new Map(),
      startedAt: Date.now(),
      lastProgressAt: Date.now(),
    }
    states.set(input.turn.turnID, runtime)
    record(input.turn, {
      type: "engineering.run.started",
      severity: "info",
      title: "工程运行开始",
      summary: `模式 ${runtime.controls.mode}，任务 ${runtime.intake.taskClass}，风险 ${runtime.intake.riskLevel}，评测层 ${runtime.benchmark.effectiveTier}`,
      status: "started",
      data: publicState(runtime),
    })
    record(input.turn, {
      type: "engineering.benchmark.tier.selected",
      severity: "info",
      title: "评测层级已选择",
      summary: `${runtime.benchmark.requestedTier} -> ${runtime.benchmark.effectiveTier}`,
      status: "selected",
      data: {
        requestedTier: runtime.benchmark.requestedTier,
        effectiveTier: runtime.benchmark.effectiveTier,
        reason: runtime.benchmark.reason,
        benchmark: runtime.benchmark,
        state: publicState(runtime),
      },
    })
    ensureVerificationPlan(input.turn, runtime, "runtime_intake")
    phase(input.turn, runtime.intake.needsClarification ? "clarify" : "localize", "intake_result")
    return publicState(runtime)
  }

  export function state(turnID: string | undefined) {
    if (!turnID) return
    const runtime = states.get(turnID)
    return runtime ? publicState(runtime) : undefined
  }

  export function phase(turn: TurnContext | undefined, next: EngineeringPhase, reason: string) {
    if (!turn) return
    const runtime = states.get(turn.turnID)
    if (!runtime || runtime.phase === next) return
    const previous = runtime.phase
    runtime.phase = next
    record(turn, {
      type: "engineering.phase.changed",
      severity: "info",
      title: "工程阶段切换",
      summary: `${phaseLabel(previous)} -> ${phaseLabel(next)}`,
      status: "changed",
      data: {
        from: previous,
        to: next,
        reason,
        state: publicState(runtime),
      },
    })
  }

  export function reminder(turn: TurnContext | undefined) {
    if (!turn) return
    const runtime = states.get(turn.turnID)
    if (!runtime) return
    if (runtime.intake.taskClass === "unknown" && !runtime.stopGate.active && runtime.phase !== "repair") return
    if (runtime.stopGate.active) {
      return [
        "<system-reminder>",
        "验证已经通过，停止门禁已开启",
        "不要再读取文件、运行命令或修改代码",
        "请直接给用户最终报告：改了什么、如何验证、还剩什么风险",
        "</system-reminder>",
      ].join("\n")
    }
    const phase = runtime.phase
    if (phase === "localize") {
      return [
        "<system-reminder>",
        "你现在处于 localize，定位阶段",
        `目标是找最相关的 1 到 5 个文件，本档位定位工具预算是 ${runtime.controls.localizeToolMax} 次`,
        "不要修改代码，不要写文件",
        "如果已经有足够证据，请直接进入计划和最小改动",
        "任务明确且不涉及越界写入、删除数据、提升权限或缺少凭证时，不要问用户是否继续",
        "</system-reminder>",
      ].join("\n")
    }
    if (phase === "repair") {
      const feedback = latestFeedback(runtime)
      return [
        "<system-reminder>",
        "你现在处于 repair，修复阶段",
        feedback ? "最近一次可执行反馈如下" : "请只根据上一轮验证失败的信息继续定位和最小修改",
        feedback?.summary,
        feedback?.detail,
        "不要重复刚失败的同一条无效路线",
        "</system-reminder>",
      ]
        .filter(Boolean)
        .join("\n")
    }
    return [
      "<system-reminder>",
      `工程模式：${runtime.controls.mode}`,
      "请按定位、计划、最小修改、验证、最终报告的顺序推进",
      "如果用户已经要求你修复明确问题，不要只给分析后询问是否继续，请直接执行最小安全改动",
      "验证通过后应停止工具调用并汇报结果",
      "</system-reminder>",
    ].join("\n")
  }

  export function beforeTool(turn: TurnContext | undefined, tool: string, input: unknown) {
    if (!turn) return { blocked: false as const }
    const runtime = states.get(turn.turnID)
    if (!runtime) return { blocked: false as const }
    if (runtime.stopGate.active && !["todo", "question"].includes(tool)) {
      runtime.loop.blocked++
      record(turn, {
        type: "engineering.stop_gate.blocked_tool",
        severity: "warning",
        title: "停止门禁阻止工具调用",
        summary: `验证已通过，阻止继续调用 ${tool}`,
        status: "blocked",
        data: {
          tool,
          reason: runtime.stopGate.reason,
          state: publicState(runtime),
        },
      })
      return {
        blocked: true as const,
        output: "验证已经通过，系统已阻止继续调用工具 请直接给用户最终报告，不要再读取、运行命令或修改文件",
      }
    }

    if (runtime.phase === "localize" && writeTool(tool) && requiresLocalization(runtime.intake.taskClass) && runtime.loop.toolCalls === 0) {
      runtime.loop.blocked++
      runtime.phaseGate.blocked++
      phase(turn, "plan", "write_before_plan")
      addFeedback(runtime, {
        kind: "phase_gate",
        summary: `模型在定位阶段就想调用 ${tool} 修改代码，系统已拦住第一次修改`,
        detail: "请先说清楚相关文件、最小改动计划和验证方式，然后再进入修改",
        tool,
      })
      record(turn, {
        type: "engineering.phase_gate.blocked_tool",
        severity: "warning",
        title: "阶段门禁阻止过早修改",
        summary: `定位阶段不允许直接调用 ${tool}`,
        status: "blocked",
        data: {
          tool,
          phase: runtime.phase,
          state: publicState(runtime),
        },
      })
      return {
        blocked: true as const,
        output: "你还在定位阶段，系统已阻止这次修改 请先给出相关文件、最小改动计划和验证方式，然后再继续修改",
      }
    }

    runtime.loop.toolCalls++
    const referencedPath = pathFromToolInput(input)
    if (readTool(tool) && referencedPath) {
      addSuspectedFile(runtime, {
        path: referencedPath,
        reason: `${tool} 用于定位相关代码`,
        source: tool,
      })
      record(turn, {
        type: "engineering.artifact.updated",
        severity: "info",
        title: "定位证据更新",
        summary: `记录相关路径 ${referencedPath}`,
        status: "updated",
        data: {
          artifact: "suspectedFiles",
          path: referencedPath,
          state: publicState(runtime),
        },
      })
    }
    const max = runtime.controls.totalToolCallsMax
    if (max > 0 && runtime.loop.toolCalls > max) {
      runtime.loop.blocked++
      phase(turn, "blocked", "total_tool_budget")
      record(turn, {
        type: "engineering.loop.blocked",
        severity: "error",
        title: "工具调用总量达到上限",
        summary: `${runtime.loop.toolCalls}/${max}`,
        status: "blocked",
        data: { tool, max, state: publicState(runtime) },
      })
      return {
        blocked: true as const,
        output: `本轮工具调用已达到用户设置的上限 ${max} 次 请停止继续调用工具，向用户说明当前进展和阻塞点`,
      }
    }

    const signature = `${tool}:${stablePreview(input)}`
    const count = (runtime.repeated.get(signature) ?? 0) + 1
    runtime.repeated.set(signature, count)
    if (count === runtime.controls.repeatedToolWarning) {
      runtime.loop.warnings++
      const pattern = recordRepeatedToolPattern(runtime, {
        signature,
        tool,
        input,
        count,
        status: "warning",
      })
      record(turn, {
        type: "engineering.loop.warning",
        severity: "warning",
        title: "重复工具调用预警",
        summary: `${tool} 连续命中相同输入 ${count} 次`,
        status: "warning",
        data: { tool, count, pattern, state: publicState(runtime) },
        raw: { tool, input, signature, pattern },
      })
    }
    if (count === runtime.controls.repeatedToolCheckpoint) {
      runtime.loop.checkpoints++
      phase(turn, "repair", "repeated_tool_checkpoint")
      const pattern = recordRepeatedToolPattern(runtime, {
        signature,
        tool,
        input,
        count,
        status: "checkpoint",
      })
      addFeedback(runtime, {
        kind: "loop_checkpoint",
        summary: `${tool} 对同一类输入重复了 ${count} 次，系统要求换方向`,
        detail: pattern.interventionSuggestion,
        tool,
      })
      record(turn, {
        type: "engineering.loop.checkpoint",
        severity: "warning",
        title: "重复工具调用检查点",
        summary: `${tool} 重复过多，要求模型换方向`,
        status: "checkpoint",
        data: { tool, count, pattern, state: publicState(runtime) },
        raw: { tool, input, signature, pattern },
      })
    }
    if (runtime.controls.repeatedToolStop > 0 && count >= runtime.controls.repeatedToolStop && !runtime.controls.longRun) {
      runtime.loop.blocked++
      phase(turn, "blocked", "repeated_tool_stop")
      const pattern = recordRepeatedToolPattern(runtime, {
        signature,
        tool,
        input,
        count,
        status: "blocked",
      })
      record(turn, {
        type: "engineering.loop.blocked",
        severity: "error",
        title: "重复工具调用被中止",
        summary: `${tool} 重复 ${count} 次`,
        status: "blocked",
        data: { tool, count, pattern, state: publicState(runtime) },
        raw: { tool, input, signature, pattern },
      })
      return {
        blocked: true as const,
        output: `系统检测到同一个工具和同一类输入重复了 ${count} 次，已按用户设置中止这条路线 ${pattern.interventionSuggestion}`,
      }
    }

    if (writeTool(tool) || (tool === "bash" && writeLikeCommand(input))) {
      runtime.patch.writeToolCalls++
      updateEditPlan(runtime, {
        summary: tool === "bash" ? "bash 命令包含写入类操作" : `${tool} 准备修改文件`,
        file: referencedPath,
      })
      record(turn, {
        type: "engineering.artifact.updated",
        severity: "info",
        title: "修改计划更新",
        summary: runtime.artifacts.editPlan?.summary ?? "记录修改计划",
        status: "updated",
        data: {
          artifact: "editPlan",
          state: publicState(runtime),
        },
      })
      phase(turn, "edit", "write_tool")
    }
    if (tool === "bash" || tool === "shell") {
      const command = commandFromToolInput(input)
      if (command && looksLikeDeploymentCommand(command)) {
        const assessment = deploymentGateAssessment(turn, command, input)
        runtime.deployment.checks = [...runtime.deployment.checks.slice(-19), assessment]
        if (assessment.action === "blocked") runtime.deployment.blocked++
        if (assessment.action === "allowed") runtime.deployment.allowed++
        record(turn, {
          type: "engineering.deployment_gate.updated",
          severity: assessment.action === "blocked" ? "error" : assessment.requiresApproval ? "warning" : "info",
          title: "部署门禁更新",
          summary: deploymentGateSummary(assessment),
          status: assessment.action,
          data: {
            assessment,
            gate: assessment.gate,
            command,
            ruleID: assessment.ruleID,
            riskLevel: assessment.riskLevel,
            action: assessment.action,
            requiresApproval: assessment.requiresApproval,
            requiresDryRun: assessment.requiresDryRun,
            dryRunDetected: assessment.dryRunDetected,
            explicitConfirmationDetected: assessment.explicitConfirmationDetected,
            state: publicState(runtime),
          },
          raw: {
            command,
            input,
            assessment,
          },
        })
        if (assessment.action === "blocked") {
          phase(turn, "blocked", "deployment_gate_blocked")
          addFeedback(runtime, {
            kind: "deployment_gate",
            summary: assessment.reason,
            detail: assessment.suggestion,
            tool,
          })
          return {
            blocked: true as const,
            output: `${assessment.reason} ${assessment.suggestion}`,
          }
        }
      }
      if (command && looksLikeVerification(command)) {
        ensureVerificationPlan(turn, runtime, "verification_command", command)
        startVerificationRun(turn, runtime, command)
      }
      phase(turn, "verify", "command_tool")
    }
    return { blocked: false as const }
  }

  export function recordVerification(input: {
    turn: TurnContext | undefined
    command: string
    exit: number | null
    output?: string
  }) {
    if (!input.turn) return
    const runtime = states.get(input.turn.turnID)
    if (!runtime || !looksLikeVerification(input.command)) return
    runtime.verification.attempts++
    runtime.verification.lastCommand = input.command
    runtime.verification.lastExit = input.exit
    runtime.verification.passed = input.exit === 0
    runtime.lastProgressAt = Date.now()
    const failure = runtime.verification.passed
      ? undefined
      : verificationFailure({
          command: input.command,
          exit: input.exit,
          output: input.output,
          maxChars: runtime.controls.testOutputMaxBytes,
        })
    if (failure) {
      addFeedback(runtime, {
        kind: "verification_failed",
        summary: failure.summary,
        detail: failure.detail,
        command: input.command,
        exit: input.exit,
        failedFiles: failure.failedFiles,
        assertions: failure.assertions,
        expected: failure.expected,
        actual: failure.actual,
      })
    }
    runtime.artifacts.verificationResults = [
      ...runtime.artifacts.verificationResults.slice(-9),
      {
        command: input.command,
        exit: input.exit,
        passed: runtime.verification.passed,
        summary: failure?.summary,
        detail: failure?.detail,
        failedFiles: failure?.failedFiles,
        assertions: failure?.assertions,
        expected: failure?.expected,
        actual: failure?.actual,
        at: Date.now(),
      },
    ]
    const benchmarkRun = finishVerificationRun(runtime, {
      command: input.command,
      exit: input.exit,
      passed: runtime.verification.passed,
      outputChars: input.output?.length ?? 0,
    })
    record(input.turn, {
      type: "engineering.verification.finished",
      severity: runtime.verification.passed ? "info" : "warning",
      title: runtime.verification.passed ? "验证通过" : "验证失败",
      summary: `${input.command} -> exit ${input.exit ?? "unknown"}`,
      status: runtime.verification.passed ? "passed" : "failed",
      data: {
        command: input.command,
        exit: input.exit,
        attempts: runtime.verification.attempts,
        outputChars: input.output?.length ?? 0,
        tier: benchmarkRun?.effectiveTier ?? benchmarkTierForCommand(input.command, runtime),
        benchmarkRun,
        benchmark: runtime.benchmark,
        failureSummary: failure?.summary,
        failureDetail: failure?.detail,
        failedFiles: failure?.failedFiles,
        assertions: failure?.assertions,
        expected: failure?.expected,
        actual: failure?.actual,
        state: publicState(runtime),
      },
      raw: {
        command: input.command,
        exit: input.exit,
        output: input.output,
      },
    })
    if (benchmarkRun) {
      record(input.turn, {
        type: "engineering.benchmark.finished",
        severity: runtime.verification.passed ? "info" : "warning",
        title: runtime.verification.passed ? "评测层级通过" : "评测层级失败",
        summary: `${benchmarkRun.effectiveTier}：${input.command} -> exit ${input.exit ?? "unknown"}`,
        status: benchmarkRun.status,
        data: {
          command: input.command,
          tier: benchmarkRun.effectiveTier,
          exit: input.exit,
          outputChars: input.output?.length ?? 0,
          benchmarkRun,
          benchmark: runtime.benchmark,
          state: publicState(runtime),
        },
        raw: {
          command: input.command,
          exit: input.exit,
          output: input.output,
          benchmarkRun,
        },
      })
    }
    if (runtime.verification.passed) {
      runtime.stopGate.active = true
      runtime.stopGate.reason = "verification_passed"
      phase(input.turn, "finalize", "verification_passed")
      record(input.turn, {
        type: "engineering.stop_gate.activated",
        severity: "info",
        title: "通过即停止已开启",
        summary: "验证通过后不再允许继续工具调用",
        status: "active",
        data: publicState(runtime),
      })
      return
    }
    if (runtime.verification.attempts < runtime.controls.verificationRounds) {
      phase(input.turn, "repair", "verification_failed")
      return
    }
    phase(input.turn, "blocked", "verification_rounds_exhausted")
  }

  export function multiAgentRole(input: { subagentType: string; description?: string; prompt?: string }): EngineeringMultiAgentRole {
    return roleForMultiAgent(input)
  }

  export function multiAgentAssigned(input: {
    turn: TurnContext | undefined
    role: EngineeringMultiAgentRole
    agent: string
    parentSessionID: string
    subagentSessionID?: string
    description: string
    background?: boolean
    model?: { providerID: string; modelID: string }
    permissionSummary?: string[]
  }) {
    if (!input.turn) return
    const runtime = states.get(input.turn.turnID)
    const assignment = {
      schema: "aialra.multi_agent.v2",
      id: `multi_agent_${Date.now()}_${(runtime?.multiAgent.assignments.length ?? 0) + 1}`,
      role: input.role,
      agent: input.agent,
      parentSessionID: input.parentSessionID,
      subagentSessionID: input.subagentSessionID,
      description: input.description,
      status: "running" as const,
      background: input.background === true,
      model: input.model,
      permissionSummary: input.permissionSummary ?? [],
      startedAt: Date.now(),
    } satisfies EngineeringMultiAgentAssignment
    if (runtime) {
      runtime.multiAgent.assignments = [...runtime.multiAgent.assignments.slice(-19), assignment]
      runtime.multiAgent.active++
    }
    record(input.turn, {
      type: "multi_agent.task.assigned",
      severity: "info",
      title: "多 agent 子任务已分配",
      summary: `${roleLabel(assignment.role)} -> ${assignment.agent}: ${assignment.description}`,
      status: "assigned",
      data: {
        assignment,
        role: assignment.role,
        agent: assignment.agent,
        subagentSessionID: assignment.subagentSessionID,
        state: runtime ? publicState(runtime) : undefined,
      },
      raw: { assignment },
    })
    return assignment
  }

  export function multiAgentSettled(input: {
    turn: TurnContext | undefined
    assignmentID?: string
    subagentSessionID?: string
    status: "completed" | "failed" | "cancelled"
    result?: string
    failureReason?: string
  }) {
    if (!input.turn) return
    const runtime = states.get(input.turn.turnID)
    const assignment = runtime?.multiAgent.assignments.findLast(
      (item) => item.id === input.assignmentID || item.subagentSessionID === input.subagentSessionID,
    )
    const settled = assignment
      ? {
          ...assignment,
          status: input.status,
          completedAt: Date.now(),
          resultChars: input.result?.length ?? 0,
          failureReason: input.failureReason,
        }
      : undefined
    const settlement = settled
      ? {
          id: `multi_agent_settlement_${Date.now()}_${runtime?.multiAgent.settlements.length ?? 0}`,
          assignmentID: settled.id,
          status: input.status === "completed" ? ("accepted" as const) : ("rejected" as const),
          summary: input.status === "completed" ? "子任务结果已进入父 turn 汇总" : (input.failureReason ?? "子任务未成功完成"),
          at: Date.now(),
        }
      : undefined
    if (runtime && settled) {
      runtime.multiAgent.assignments = runtime.multiAgent.assignments.map((item) => (item.id === settled.id ? settled : item))
      runtime.multiAgent.active = Math.max(0, runtime.multiAgent.active - 1)
      runtime.multiAgent.completed += input.status === "completed" ? 1 : 0
      runtime.multiAgent.failed += input.status === "failed" ? 1 : 0
      if (settlement) runtime.multiAgent.settlements = [...runtime.multiAgent.settlements.slice(-19), settlement]
    }
    record(input.turn, {
      type: "multi_agent.task.settled",
      severity: input.status === "completed" ? "info" : "warning",
      title: input.status === "completed" ? "多 agent 子任务已完成" : "多 agent 子任务未完成",
      summary: `${settled ? roleLabel(settled.role) : "未知角色"} ${input.status}`,
      status: input.status,
      data: {
        assignment: settled,
        settlement,
        role: settled?.role,
        agent: settled?.agent,
        resultChars: input.result?.length ?? 0,
        failureReason: input.failureReason,
        state: runtime ? publicState(runtime) : undefined,
      },
      raw: {
        assignment: settled,
        settlement,
        result: input.result,
        failureReason: input.failureReason,
      },
    })
    return settled
  }

  export function verificationPrompt(turn: TurnContext | undefined, text: string) {
    if (!turn) return
    const runtime = states.get(turn.turnID)
    if (!runtime) return
    if (runtime.stopGate.active || runtime.intake.needsClarification) return
    if (!requiresVerification(runtime)) return
    if (runtime.artifacts.verificationResults.length > 0) return
    if (runtime.verification.skipRequests >= 1) return
    if (!looksLikeFinalText(text)) return
    runtime.verification.skipRequests++
    ensureVerificationPlan(turn, runtime, "final_without_verification")
    record(turn, {
      type: "engineering.verification.repair_requested",
      severity: "warning",
      title: "验证要求已注入",
      summary: "模型准备结束，但还没有运行可识别验证命令",
      status: "continued",
      data: {
        reason: "final_without_verification",
        state: publicState(runtime),
      },
      raw: { text },
    })
    return [
      "<system-reminder>",
      "你已经修改或计划修改工程内容，但还没有运行可识别验证命令",
      "请优先运行最相关、最小范围的验证，例如项目测试、类型检查、构建检查、lint 或健康检查",
      "如果确实不能运行验证，最终报告必须写清楚具体原因，例如缺少依赖、没有测试命令、权限或沙箱限制、网络不可用、验证耗时超出本轮预算",
      "不要只写“未测试”或“建议用户测试”",
      "</system-reminder>",
    ].join("\n")
  }

  export function stopGatePrompt(turn: TurnContext | undefined, text: string, input?: { workspaceChanged?: boolean }) {
    if (!turn) return
    const runtime = states.get(turn.turnID)
    if (!runtime) return
    if (!looksLikeFinalText(text)) return
    const checks = stopGateChecks(turn, runtime, input)
    runtime.stopGate.checks = [...runtime.stopGate.checks.slice(-29), ...checks]
    const blocking = checks.find((check) => check.status === "blocked")
    const continuing = checks.find((check) => check.status === "continue")
    record(turn, {
      type: "engineering.stop_gate.checked",
      severity: blocking ? "error" : continuing ? "warning" : "info",
      title: "停止门禁已检查",
      summary: blocking?.reason ?? continuing?.reason ?? "final 前检查没有发现必须阻止的问题",
      status: blocking ? "blocked" : continuing ? "continue" : "passed",
      data: {
        checks,
        state: publicState(runtime),
      },
    })
    if (!blocking) return
    phase(turn, "blocked", `stop_gate_${blocking.name}`)
    return [
      "<system-reminder>",
      "系统阻止了最终回复，因为本轮还有必须处理的执行状态",
      `阻止原因：${blocking.reason}`,
      blocking.name === "live_process" ? "请先使用 await_process 等待后台命令结束，或使用 cleanup_processes 清理/终止它" : "",
      "处理完成后再生成最终报告",
      "</system-reminder>",
    ].filter(Boolean).join("\n")
  }

  export function prematureFinalPrompt(turn: TurnContext | undefined, text: string) {
    if (!turn) return
    const runtime = states.get(turn.turnID)
    if (!runtime) return
    if (runtime.stopGate.active || runtime.intake.needsClarification) return
    if (!runtime.intake.expectedEvidence.includes("diff")) return
    if (!["localize", "plan", "edit", "repair"].includes(runtime.phase)) return
    if (runtime.phaseGate.prematureFinals >= 2) return
    if (!looksPrematureFinal(text)) return
    runtime.phaseGate.prematureFinals++
    phase(turn, "edit", "premature_final")
    addFeedback(runtime, {
      kind: "phase_gate",
      summary: "模型已经定位到修复点但提前停住，系统要求继续执行最小修改",
      detail: "明确工程修复任务不应在找到答案后询问是否继续，除非需要越界写入、删除数据、提升权限或缺少凭证",
    })
    record(turn, {
      type: "engineering.phase_gate.premature_final",
      severity: "warning",
      title: "阶段门禁拦截提前停住",
      summary: "模型找到修复点后询问是否继续，系统已要求继续执行",
      status: "continued",
      data: {
        phase: runtime.phase,
        textChars: text.length,
        state: publicState(runtime),
      },
      raw: {
        text,
      },
    })
    return [
      "<system-reminder>",
      "你刚才已经定位到修复点，但还没有执行修改",
      "本轮用户要求的是明确工程修复，不是只要分析",
      "不要再问用户是否继续",
      "请直接调用 edit、write 或 apply_patch 做最小安全改动，然后运行最相关验证",
      "只有需要越界写入、删除数据、提升权限或缺少凭证时，才停下来问用户",
      "</system-reminder>",
    ].join("\n")
  }

  export function verificationRepairPrompt(turn: TurnContext | undefined, text: string) {
    if (!turn) return
    const runtime = states.get(turn.turnID)
    if (!runtime) return
    if (runtime.stopGate.active || runtime.phase !== "repair") return
    const failure = runtime.feedback.items.at(-1)
    if (failure?.kind !== "verification_failed") return
    if (!looksLikeFinalText(text)) return
    addFeedback(runtime, {
      kind: "phase_gate",
      summary: "模型在验证失败后准备结束，系统要求带着失败信息继续修",
      detail: failure.detail,
      command: failure.command,
      exit: failure.exit,
    })
    record(turn, {
      type: "engineering.artifact.updated",
      severity: "warning",
      title: "验证反馈已注入修复阶段",
      summary: failure.summary,
      status: "updated",
      data: {
        artifact: "repairFeedback",
        command: failure.command,
        exit: failure.exit,
        state: publicState(runtime),
      },
      raw: {
        text,
        failure,
      },
    })
    return [
      "<system-reminder>",
      "验证刚刚失败，不能直接结束本轮",
      `失败命令：${failure.command ?? runtime.verification.lastCommand ?? "未记录"}`,
      `失败摘要：${failure.summary}`,
      failure.failedFiles?.length ? `失败文件：${failure.failedFiles.join(", ")}` : "",
      failure.expected ? `期望值：${failure.expected}` : "",
      failure.actual ? `实际值：${failure.actual}` : "",
      failure.detail ? `失败细节：${failure.detail}` : "",
      "请根据这条失败反馈继续定位并做最小修复",
      "修复后重新运行最相关验证",
      "</system-reminder>",
    ].filter(Boolean).join("\n")
  }

  export function zeroPatchPrompt(turn: TurnContext | undefined, text: string, input?: { workspaceChanged?: boolean }) {
    if (!turn) return
    const runtime = states.get(turn.turnID)
    if (!runtime) return
    if (runtime.stopGate.active || runtime.intake.needsClarification) return
    if (!runtime.intake.expectedEvidence.includes("diff")) return
    if (input?.workspaceChanged !== undefined) runtime.patch.lastWorkspaceChanged = input.workspaceChanged
    if (input?.workspaceChanged === true) {
      recordZeroPatchRecovered(turn, runtime)
      return
    }
    if (runtime.patch.writeToolCalls > 0 && input?.workspaceChanged !== false) return
    if (!["localize", "plan", "edit", "repair"].includes(runtime.phase)) return
    if (!looksLikeFinalText(text)) return
    if (runtime.patch.zeroPatchRecoveries >= runtime.controls.zeroPatchRecoveryMax) {
      runtime.patch.zeroPatchExhausted = true
      phase(turn, "blocked", "zero_patch_recovery_exhausted")
      addFeedback(runtime, {
        kind: "zero_patch",
        summary: "本轮需要实际代码改动，但模型没有产生任何写入操作，零补丁恢复次数已用完",
        detail: "请向用户说明没有生成补丁的原因，或者请求更明确的任务边界",
      })
      record(turn, {
        type: "engineering.zero_patch.exhausted",
        severity: "error",
        title: "零补丁恢复耗尽",
        summary: "工程任务没有产生代码改动，恢复次数已用完",
        status: "blocked",
        data: {
          textChars: text.length,
          workspaceChanged: input?.workspaceChanged,
          state: publicState(runtime),
        },
        raw: { text },
      })
      return
    }
    runtime.patch.zeroPatchRecoveries++
    phase(turn, "repair", "zero_patch")
    addFeedback(runtime, {
      kind: "zero_patch",
      summary: "当前没有任何代码改动",
      detail: "这个任务需要实际修改代码 请继续定位并调用 edit、write 或 apply_patch 做最小安全改动，或者明确说明 blocked 原因",
    })
    record(turn, {
      type: "engineering.zero_patch.detected",
      severity: "warning",
      title: "检测到零补丁",
      summary: "模型准备结束，但本轮工程任务还没有任何写入操作",
      status: "detected",
      data: {
        textChars: text.length,
        workspaceChanged: input?.workspaceChanged,
        recovery: runtime.patch.zeroPatchRecoveries,
        max: runtime.controls.zeroPatchRecoveryMax,
        state: publicState(runtime),
      },
      raw: { text },
    })
    record(turn, {
      type: "engineering.zero_patch.recovery_requested",
      severity: "warning",
      title: "请求零补丁恢复",
      summary: `恢复 ${runtime.patch.zeroPatchRecoveries}/${runtime.controls.zeroPatchRecoveryMax}`,
      status: "continued",
      data: publicState(runtime),
    })
    return [
      "<system-reminder>",
      "系统检测到你准备结束，但当前没有任何代码改动",
      "这是一轮工程修复任务，不能只给分析或计划",
      "请继续执行最小安全改动，优先使用 edit、write 或 apply_patch",
      "修改后运行最相关验证",
      "如果确实无法修改，请明确给出 blocked 原因，而不是假装完成",
      "</system-reminder>",
    ].join("\n")
  }

  export function terminalAnomaly(input: {
    turn: TurnContext | undefined
    lastAgentMessage?: string
    finalText?: string
    forcedReason?: string
  }) {
    if (!input.turn || input.turn.noReply) return
    const runtime = states.get(input.turn.turnID)
    if (!runtime) return
    const reason = input.forcedReason
      ? input.forcedReason
      : !input.lastAgentMessage
      ? "missing_assistant"
      : input.finalText !== undefined && input.finalText.trim().length === 0
        ? "empty_final"
        : runtime.patch.zeroPatchExhausted
          ? "zero_patch_exhausted"
          : runtime.intake.expectedEvidence.includes("diff") &&
              runtime.loop.toolCalls === 0 &&
              looksLikeFinalText(input.finalText ?? "")
            ? "zero_tool_zero_patch"
            : undefined
    if (!reason) return
    addFeedback(runtime, {
      kind: "terminal_anomaly",
      summary: terminalAnomalyLabel(reason),
      detail: "终态校准器发现这轮回合虽然要收尾，但执行证据不完整",
    })
    return reason
  }

  export function finish(turn: TurnContext | undefined, status: "completed" | "aborted", finalText?: string) {
    if (!turn) return
    const runtime = states.get(turn.turnID)
    if (!runtime) return
    if (finalText !== undefined) {
      runtime.artifacts.finalSummary = {
        text: finalText.slice(0, 20_000),
        at: Date.now(),
      }
    }
    recordVerificationSkipIfNeeded(turn, runtime, finalText)
    const diff = TurnDiffStore.list({ sessionID: turn.sessionID, turnID: turn.turnID })
    if (diff && !Array.isArray(diff)) {
      const quality = TurnDiffStore.quality(diff, {
        source: "engineering_finish",
        verification: {
          status: runtime.verification.passed
            ? "passed"
            : runtime.verification.skipped
              ? "skipped"
              : runtime.verification.attempts > 0
                ? "failed"
                : "not_observed",
          attempts: runtime.verification.attempts,
        },
      })
      record(turn, {
        type: "patch.quality.scored",
        severity: quality.grade === "poor" ? "error" : quality.grade === "risky" ? "warning" : "info",
        title: "补丁质量已评分",
        summary: `补丁质量 ${quality.score}/100，等级 ${quality.grade}`,
        status: quality.grade,
        data: quality,
      })
    }
    record(turn, {
      type: "engineering.run.finished",
      severity: status === "completed" ? "info" : "warning",
      title: runtime.patch.zeroPatchExhausted ? "工程运行阻塞" : status === "completed" ? "工程运行完成" : "工程运行中断",
      summary: `阶段 ${phaseLabel(runtime.phase)}，工具 ${runtime.loop.toolCalls} 次，验证 ${runtime.verification.attempts} 次`,
      status: runtime.patch.zeroPatchExhausted ? "blocked" : status,
      data: publicState(runtime),
    })
    states.delete(turn.turnID)
  }

  export function clearForTest() {
    states.clear()
  }
}

function record(turn: TurnContext, input: Parameters<typeof PublicEventLog.recordManual>[0]) {
  PublicEventLog.recordManual({
    ...input,
    sessionID: turn.sessionID,
    turnID: turn.turnID,
    messageID: turn.messageID,
  })
}

function publicState(runtime: RuntimeState): EngineeringRunSnapshot {
  return {
    version: runtime.version,
    phase: runtime.phase,
    controls: runtime.controls,
    benchmark: runtime.benchmark,
    intake: runtime.intake,
    verification: runtime.verification,
    stopGate: runtime.stopGate,
    loop: runtime.loop,
    deployment: runtime.deployment,
    multiAgent: runtime.multiAgent,
    phaseGate: runtime.phaseGate,
    patch: runtime.patch,
    feedback: {
      items: runtime.feedback.items,
    },
    artifacts: runtime.artifacts,
  }
}

function recordRepeatedToolPattern(
  runtime: RuntimeState,
  input: {
    signature: string
    tool: string
    input: unknown
    count: number
    status: EngineeringRepeatedToolPattern["status"]
  },
) {
  const pattern = {
    signature: input.signature,
    tool: input.tool,
    count: input.count,
    threshold: {
      warning: runtime.controls.repeatedToolWarning,
      checkpoint: runtime.controls.repeatedToolCheckpoint,
      stop: runtime.controls.repeatedToolStop,
    },
    argumentsSimilarity: "exact",
    failureSimilarity: "not_observed",
    inputPreview: stablePreview(input.input),
    interventionSuggestion: repeatedToolSuggestion(input.status, input.tool),
    status: input.status,
    at: Date.now(),
  } satisfies EngineeringRepeatedToolPattern
  runtime.loop.patterns = [...runtime.loop.patterns.slice(-19), pattern]
  return pattern
}

function repeatedToolSuggestion(status: EngineeringRepeatedToolPattern["status"], tool: string) {
  if (status === "warning") return `${tool} 正在重复相同输入 请确认这次调用是否会产生新证据，没有新证据就换搜索词、换文件或换验证方式`
  if (status === "checkpoint") return `${tool} 已达到检查点 请先总结这条路线得到的证据，说明为什么继续重复没有价值，然后换一个定位路径、验证命令，或向用户请求缺失信息`
  return `${tool} 已达到阻止阈值 请停止同一路线，向用户报告阻塞原因，或改用明显不同的策略继续`
}

function addFeedback(runtime: RuntimeState, input: Omit<EngineeringFeedbackItem, "id" | "at">) {
  const item = {
    ...input,
    id: `feedback_${Date.now()}_${runtime.feedback.items.length + 1}`,
    at: Date.now(),
  }
  runtime.feedback.items = [...runtime.feedback.items.slice(-4), item]
  if (input.kind === "verification_failed" || input.kind === "loop_checkpoint" || input.kind === "zero_patch") {
    runtime.artifacts.repairFeedback = [...runtime.artifacts.repairFeedback.slice(-9), item]
  }
}

function latestFeedback(runtime: RuntimeState) {
  return runtime.feedback.items.at(-1)
}

function addSuspectedFile(runtime: RuntimeState, input: { path: string; reason: string; source: string }) {
  if (runtime.artifacts.suspectedFiles.some((item) => item.path === input.path && item.source === input.source)) return
  runtime.artifacts.suspectedFiles = [
    ...runtime.artifacts.suspectedFiles.slice(-29),
    {
      ...input,
      at: Date.now(),
    },
  ]
}

function updateEditPlan(runtime: RuntimeState, input: { summary: string; file?: string }) {
  const files = input.file
    ? Array.from(new Set([...(runtime.artifacts.editPlan?.files ?? []), input.file])).slice(-20)
    : (runtime.artifacts.editPlan?.files ?? [])
  runtime.artifacts.editPlan = {
    summary: input.summary,
    files,
    verification: runtime.artifacts.editPlan?.verification ?? runtime.artifacts.verificationPlan?.verification ?? [],
    at: Date.now(),
  }
}

function requiresVerification(runtime: RuntimeState) {
  if (!runtime.intake.expectedEvidence.includes("test") && !runtime.intake.expectedEvidence.includes("health")) return false
  if (runtime.patch.writeToolCalls > 0) return true
  if (runtime.artifacts.editPlan) return true
  return runtime.intake.taskClass === "bug_fix" || runtime.intake.taskClass === "test" || runtime.intake.taskClass === "deployment"
}

function ensureVerificationPlan(turn: TurnContext, runtime: RuntimeState, source: string, command?: string) {
  if (!requiresVerification(runtime) && !command) return
  const verification = command
    ? Array.from(
        new Set([...(runtime.artifacts.verificationPlan?.verification ?? []).filter((item) => item !== defaultVerificationLabel(runtime)), command]),
      )
    : runtime.artifacts.verificationPlan?.verification?.length
      ? runtime.artifacts.verificationPlan.verification
      : [defaultVerificationLabel(runtime)]
  runtime.artifacts.verificationPlan = {
    summary: verificationPlanSummary(runtime, command),
    files: runtime.artifacts.editPlan?.files ?? runtime.artifacts.suspectedFiles.map((item) => item.path).slice(0, 8),
    verification,
    at: Date.now(),
  }
  record(turn, {
    type: "engineering.verification.planned",
    severity: "info",
    title: "验证计划已生成",
    summary: runtime.artifacts.verificationPlan.summary,
    status: "planned",
    data: {
      source,
      command,
      artifact: "verificationPlan",
      plan: runtime.artifacts.verificationPlan,
      state: publicState(runtime),
    },
  })
}

function startVerificationRun(turn: TurnContext, runtime: RuntimeState, command: string) {
  const existing = runtime.artifacts.verificationRuns.findLast((item) => item.command === command && item.status === "started")
  if (existing) return
  const startedAt = Date.now()
  const tier = benchmarkTierForCommand(command, runtime)
  const run = {
    id: `verification_${startedAt}_${runtime.artifacts.verificationRuns.length + 1}`,
    command,
    status: "started" as const,
    startedAt,
  }
  runtime.artifacts.verificationRuns = [...runtime.artifacts.verificationRuns.slice(-9), run]
  const benchmarkRun = {
    id: run.id,
    requestedTier: runtime.benchmark.requestedTier,
    effectiveTier: tier,
    command,
    status: "started" as const,
    startedAt,
  } satisfies EngineeringBenchmarkTierRun
  runtime.benchmark.runs = [...runtime.benchmark.runs.slice(-19), benchmarkRun]
  record(turn, {
    type: "engineering.verification.started",
    severity: "info",
    title: "验证命令开始",
    summary: `${tier}：${command}`,
    status: "started",
    data: {
      run,
      benchmarkRun,
      tier,
      state: publicState(runtime),
    },
    raw: {
      command,
      benchmarkRun,
    },
  })
  record(turn, {
    type: "engineering.benchmark.started",
    severity: "info",
    title: "评测层级开始",
    summary: `${tier}：${command}`,
    status: "started",
    data: {
      command,
      tier,
      benchmarkRun,
      benchmark: runtime.benchmark,
      state: publicState(runtime),
    },
    raw: {
      command,
      benchmarkRun,
    },
  })
}

function finishVerificationRun(runtime: RuntimeState, input: { command: string; exit: number | null; passed: boolean; outputChars: number }) {
  const index = runtime.artifacts.verificationRuns.findLastIndex(
    (item) => item.command === input.command && item.status === "started",
  )
  const finishedAt = Date.now()
  const run = {
    id: `verification_${finishedAt}_${runtime.artifacts.verificationRuns.length + 1}`,
    command: input.command,
    status: input.passed ? ("passed" as const) : ("failed" as const),
    exit: input.exit,
    startedAt: finishedAt,
    finishedAt,
    outputChars: input.outputChars,
  }
  if (index === -1) {
    runtime.artifacts.verificationRuns = [...runtime.artifacts.verificationRuns.slice(-9), run]
    return finishBenchmarkRun(runtime, {
      id: run.id,
      command: input.command,
      exit: input.exit,
      passed: input.passed,
      outputChars: input.outputChars,
      finishedAt,
      startedAt: finishedAt,
    })
  }
  const started = runtime.artifacts.verificationRuns[index]?.startedAt ?? finishedAt
  runtime.artifacts.verificationRuns = runtime.artifacts.verificationRuns.map((item, itemIndex) =>
    itemIndex === index
      ? {
          ...item,
          status: input.passed ? ("passed" as const) : ("failed" as const),
          exit: input.exit,
          finishedAt,
          outputChars: input.outputChars,
        }
      : item,
  )
  return finishBenchmarkRun(runtime, {
    id: runtime.artifacts.verificationRuns[index]?.id ?? run.id,
    command: input.command,
    exit: input.exit,
    passed: input.passed,
    outputChars: input.outputChars,
    finishedAt,
    startedAt: started,
  })
}

function recordVerificationSkipIfNeeded(turn: TurnContext, runtime: RuntimeState, finalText: string | undefined) {
  if (!requiresVerification(runtime)) return
  if (runtime.artifacts.verificationResults.length > 0) return
  const reason = verificationSkipReason(runtime, finalText)
  const command = runtime.artifacts.verificationPlan?.verification?.[0] ?? defaultVerificationLabel(runtime)
  const tier = benchmarkTierForCommand(command, runtime)
  const startedAt = Date.now()
  const benchmarkRun = {
    id: `verification_${startedAt}_${runtime.artifacts.verificationRuns.length + 1}`,
    requestedTier: runtime.benchmark.requestedTier,
    effectiveTier: tier,
    command,
    status: "skipped" as const,
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    exit: null,
    outputChars: 0,
    failureReason: reason,
    cost: {
      outputChars: 0,
      estimate: "output_chars_proxy" as const,
    },
  } satisfies EngineeringBenchmarkTierRun
  runtime.verification.skipped = true
  runtime.verification.skipReason = reason
  runtime.benchmark.skipped++
  runtime.benchmark.runs = [...runtime.benchmark.runs.slice(-19), benchmarkRun]
  runtime.artifacts.verificationRuns = [
    ...runtime.artifacts.verificationRuns.slice(-9),
    {
      id: benchmarkRun.id,
      command,
      status: "skipped",
      startedAt,
      finishedAt: startedAt,
      skipReason: reason,
    },
  ]
  runtime.artifacts.verificationResults = [
    ...runtime.artifacts.verificationResults.slice(-9),
    {
      command,
      exit: null,
      passed: false,
      skipped: true,
      skipReason: reason,
      summary: "本轮没有运行可识别验证命令",
      detail: reason,
      at: Date.now(),
    },
  ]
  record(turn, {
    type: "engineering.verification.finished",
    severity: "warning",
    title: "验证已跳过",
    summary: reason,
    status: "skipped",
    data: {
      reason,
      attempts: runtime.verification.attempts,
      state: publicState(runtime),
    },
    raw: {
      finalText,
      reason,
    },
  })
  record(turn, {
    type: "engineering.benchmark.finished",
    severity: "warning",
    title: "评测层级已跳过",
    summary: `${tier}：${command}，原因：${reason}`,
    status: "skipped",
    data: {
      command,
      tier,
      reason,
      benchmarkRun,
      benchmark: runtime.benchmark,
      state: publicState(runtime),
    },
  })
}

function recordZeroPatchRecovered(turn: TurnContext, runtime: RuntimeState) {
  if (runtime.patch.zeroPatchRecoveries === 0 || runtime.patch.zeroPatchRecovered) return
  runtime.patch.zeroPatchRecovered = true
  record(turn, {
    type: "engineering.zero_patch.recovered",
    severity: "info",
    title: "零补丁已恢复",
    summary: "之前触发过零补丁恢复，本轮现在已经检测到工作区改动",
    status: "recovered",
    data: {
      recovery: runtime.patch.zeroPatchRecoveries,
      workspaceChanged: true,
      state: publicState(runtime),
    },
  })
}

function stopGateChecks(turn: TurnContext, runtime: RuntimeState, input: { workspaceChanged?: boolean } | undefined) {
  const liveProcesses = ExecProcessRegistry.listLiveProcesses({
    sessionID: turn.sessionID,
    turnID: turn.turnID,
  })
  return [
    liveProcesses.length > 0
      ? stopGateCheck("live_process", "blocked", `还有 ${liveProcesses.length} 个后台命令仍在运行`, liveProcesses.length)
      : stopGateCheck("live_process", "pass", "没有发现本 turn 的 running 后台进程", 0),
    requiresVerification(runtime) && runtime.artifacts.verificationResults.length === 0
      ? stopGateCheck("verification", "continue", "本轮工程任务还没有可识别验证结果")
      : stopGateCheck("verification", "pass", runtime.stopGate.active ? "验证已通过并开启通过即停止" : "本轮不需要额外验证或已有验证结果"),
    runtime.intake.expectedEvidence.includes("diff") && input?.workspaceChanged === false
      ? stopGateCheck("zero_patch", runtime.patch.zeroPatchExhausted ? "blocked" : "continue", "工程任务当前没有有效工作区改动")
      : stopGateCheck("zero_patch", "pass", input?.workspaceChanged === true ? "已检测到工作区改动" : "本轮没有发现零补丁阻塞"),
    stopGateCheck("pending_approval", "unknown", "当前 stop gate 不能直接读取所有审批弹窗状态，审批状态以 approval.requested/resolved 事件为准"),
    stopGateCheck("tool_result_settlement", "unknown", "工具结果由 tool.lifecycle/tool.result.settled 事件保证收口，当前检查只记录可观察状态"),
    stopGateCheck("raw_output", "unknown", "raw output 落账由 rawRef/TurnHistory 事件证明，当前检查不重新扫描 raw 存储"),
    stopGateCheck("final_schema", "unknown", "结构化输出 schema 由模型循环单独校验，当前检查只记录该约束存在"),
  ] satisfies EngineeringStopGateCheck[]
}

function stopGateCheck(
  name: EngineeringStopGateCheck["name"],
  status: EngineeringStopGateCheck["status"],
  reason: string,
  count?: number,
) {
  return {
    name,
    status,
    reason,
    count,
    at: Date.now(),
  } satisfies EngineeringStopGateCheck
}

function verificationPlanSummary(runtime: RuntimeState, command: string | undefined) {
  if (command) return `准备运行验证命令：${command}`
  if (runtime.intake.taskClass === "deployment") return "部署任务需要构建、健康检查或服务状态验证"
  return "工程修改任务需要运行最相关的测试、类型检查、构建检查或 lint"
}

function defaultVerificationLabel(runtime: RuntimeState) {
  if (runtime.intake.taskClass === "deployment") return "deployment health check"
  return "project-specific minimal verification"
}

function verificationSkipReason(runtime: RuntimeState, finalText: string | undefined) {
  const text = finalText ?? ""
  if (/依赖|dependency|module not found|command not found|not installed|缺少/i.test(text)) return "验证无法运行，因为依赖或验证命令不可用"
  if (/没有.*测试|无.*测试|no tests?|no test command|not have.*test/i.test(text)) return "模型说明项目没有可运行测试或没有测试命令"
  if (/权限|拒绝|denied|sandbox|permission/i.test(text)) return "验证被权限或沙箱策略阻止"
  if (/网络|network|offline|dns|timeout|超时|耗时/i.test(text)) return "验证受网络、超时或长耗时限制影响"
  if (runtime.patch.writeToolCalls > 0) return "检测到写入类工具调用，但模型没有运行可识别验证命令"
  if (runtime.artifacts.editPlan) return "检测到修改计划，但模型没有运行可识别验证命令"
  return "任务类型需要验证证据，但本轮没有运行可识别验证命令"
}

function readTool(tool: string) {
  return tool === "read" || tool === "glob" || tool === "grep" || tool === "list" || tool === "ls"
}

function commandFromToolInput(input: unknown) {
  return input && typeof input === "object" && "command" in input && typeof input.command === "string"
    ? input.command
    : undefined
}

function pathFromToolInput(input: unknown) {
  if (!input || typeof input !== "object") return
  const record = input as Record<string, unknown>
  for (const key of ["filePath", "path", "directory", "cwd", "pattern"]) {
    if (typeof record[key] === "string") return record[key]
  }
  return
}

function writeTool(tool: string) {
  return tool === "edit" || tool === "write" || tool === "apply_patch"
}

function writeLikeCommand(input: unknown) {
  const command = commandFromToolInput(input) ?? ""
  return /(^|\s)(>|>>|\|\s*tee\b|\btee\b|\bmkdir\b|\bmv\b|\bcp\b|\brm\b|\btouch\b|\bpython\s+-c\b|\bnode\s+-e\b)/.test(
    command,
  )
}

function terminalAnomalyLabel(reason: string) {
  return (
    {
      assistant_error: "助手消息以错误收尾",
      model_not_started: "模型没有成功启动",
      runner_no_terminal: "评测器没有等到回合终态",
      missing_assistant: "模型没有产生 assistant 消息",
      empty_final: "最终回复为空",
      zero_patch_exhausted: "零补丁恢复已经耗尽",
      zero_tool_zero_patch: "工程任务没有工具调用也没有补丁",
    } as Record<string, string>
  )[reason] ?? reason
}

function requiresLocalization(taskClass: EngineeringTaskClass) {
  return taskClass === "bug_fix" || taskClass === "refactor" || taskClass === "security" || taskClass === "deployment"
}

function looksPrematureFinal(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/would you like me to proceed|shall i proceed|should i proceed|ready to make|ready to apply|let me know if you want/i.test(trimmed)) return true
  if (/要我继续|是否继续|要不要我|需要我.*(改|执行|继续)|我可以继续/.test(trimmed)) return true
  return /root cause|minimal fix|the fix is|replace .* with|修复方式|根因.*修|改成|替换为/i.test(trimmed)
}

function looksLikeFinalText(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (looksPrematureFinal(trimmed)) return true
  return /done|completed|fixed|implemented|summary|final|no changes|zero patch|已完成|完成|修复了|总结|结果|验证|没有改动|零补丁/i.test(
    trimmed,
  )
}

function verificationFailure(input: { command: string; exit: number | null; output?: string; maxChars: number }) {
  const cleaned = stripAnsi(input.output ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.trim())
  const interesting =
    cleaned.filter((line) => /fail|error|expected|actual|assert|traceback|exception|not ok|ERR_|FAILED/i.test(line)).slice(-12)
      .join("\n") || cleaned.slice(-12).join("\n")
  const detail = interesting.slice(0, Math.min(input.maxChars, 4000))
  const failedFiles = Array.from(
    new Set(
      cleaned
        .flatMap((line) => [
          line.match(/(?:File\s+["']|at\s+|location:\s*)([^"'\s:]+(?:\.[A-Za-z0-9]+))(?:["']|:|\s|$)/i)?.[1],
          line.match(/([A-Za-z0-9_./-]+\.(?:test|spec)?\.(?:js|jsx|ts|tsx|py|rb|go|rs|java|php|cs))(?::\d+)?/)?.[1],
        ])
        .filter((item): item is string => !!item),
    ),
  ).slice(0, 12)
  const assertions = cleaned
    .filter((line) => /assert|expected|actual|toBe|toEqual|not ok|AssertionError|ERR_ASSERTION/i.test(line))
    .slice(-8)
  const expected = cleaned.find((line) => /expected/i.test(line))?.slice(0, 500)
  const actual = cleaned.find((line) => /actual/i.test(line))?.slice(0, 500)
  return {
    summary: `验证命令失败：${input.command}，退出码 ${input.exit ?? "unknown"}`,
    detail: detail || "没有捕获到可读测试输出，请换更小的验证命令或先检查失败日志文件",
    failedFiles,
    assertions,
    expected,
    actual,
  }
}

function stripAnsi(text: string) {
  return text.replace(/\u001b\[[0-9;]*m/g, "")
}

function phaseLabel(phase: EngineeringPhase) {
  return (
    {
      intake: "接收任务",
      clarify: "澄清问题",
      localize: "定位代码",
      plan: "制定计划",
      edit: "修改代码",
      verify: "运行验证",
      repair: "根据失败修复",
      finalize: "最终汇报",
      blocked: "阻塞收口",
    } satisfies Record<EngineeringPhase, string>
  )[phase]
}

function stablePreview(value: unknown) {
  try {
    return JSON.stringify(value, Object.keys(value && typeof value === "object" ? (value as Record<string, unknown>) : {}).sort()).slice(
      0,
      600,
    )
  } catch {
    return String(value).slice(0, 600)
  }
}

function looksLikeVerification(command: string) {
  return /\b(test|check|verify|pytest|vitest|jest|mocha|ava|npm\s+(test|run\s+[^;&|]*(test|lint|typecheck|build|e2e))|pnpm\s+(test|run\s+[^;&|]*(test|lint|typecheck|build|e2e))|yarn\s+(test|run\s+[^;&|]*(test|lint|typecheck|build|e2e))|bun\s+(test|run\s+[^;&|]*(test|lint|typecheck|build|e2e))|node\s+--test|cargo\s+test|go\s+test|mvn\s+test|gradle\s+test|make\s+(test|check|lint|build)|just\s+(test|check|lint|build)|tox|nox|hatch\s+test|ruff|eslint|tsc|typecheck|playwright\s+test|cypress\s+run|storybook|next\s+build|vite\s+build|astro\s+check|svelte-check|lighthouse|pa11y|axe|curl\s+(-f|--fail)|wget\s+--spider|docker\s+compose\s+(config|ps)|systemctl\s+is-active)\b/i.test(
    command,
  )
}

function expectedEvidence(taskClass: EngineeringTaskClass) {
  if (taskClass === "deployment") return ["deployment_gate", "health", "summary"]
  if (taskClass === "unknown") return ["summary"]
  if (taskClass === "test") return ["diff", "test"]
  return ["diff", "test"]
}

function roleForMultiAgent(input: { subagentType: string; description?: string; prompt?: string }): EngineeringMultiAgentRole {
  const text = [input.subagentType, input.description, input.prompt].filter(Boolean).join(" ").toLowerCase()
  if (/guardian|security|risk|policy|permission|sandbox|安全|风险|权限|沙箱/.test(text)) return "guardian"
  if (/review|audit|检查|审查|复核/.test(text)) return "reviewer"
  if (/test|verify|validation|e2e|playwright|pytest|验证|测试/.test(text)) return "tester"
  if (/await|wait|monitor|watch|等待|观察|监控/.test(text)) return "awaiter"
  if (/summary|summarize|report|汇总|总结|报告/.test(text)) return "summarizer"
  if (/implement|fix|code|patch|write|edit|build|修改|实现|修复|编码/.test(text)) return "implementer"
  if (/plan|explore|scout|research|localize|调查|定位|计划/.test(text)) return "planner"
  return "custom"
}

function roleLabel(role: EngineeringMultiAgentRole) {
  return (
    {
      planner: "规划 agent",
      implementer: "实现 agent",
      reviewer: "审查 agent",
      tester: "测试 agent",
      awaiter: "等待 agent",
      guardian: "安全守卫 agent",
      summarizer: "汇总 agent",
      custom: "自定义 agent",
    } satisfies Record<EngineeringMultiAgentRole, string>
  )[role]
}

function benchmarkSnapshot(prompt: string): EngineeringRunSnapshot["benchmark"] {
  const requestedTier = requestedBenchmarkTier(prompt)
  return {
    schema: "aialra.benchmark_tier.v1",
    requestedTier,
    effectiveTier: requestedTier,
    reason: benchmarkReason(prompt, requestedTier),
    runs: [],
    passed: 0,
    failed: 0,
    skipped: 0,
    totalDurationMs: 0,
    totalOutputChars: 0,
    cost: {
      outputChars: 0,
      commandCount: 0,
      estimate: "output_chars_proxy",
    },
  }
}

function requestedBenchmarkTier(prompt: string): EngineeringBenchmarkTier {
  const text = prompt.toLowerCase()
  if (/full[-_ ]?24|full regression|完整回归|全量回归/.test(text)) return "full-regression"
  if (/swe[-_ ]?bench|swebench/.test(text)) return "swe-bench"
  if (/official harness|官方验证器|官方 harness/.test(text)) return "official-harness"
  if (/security|安全扫描|漏洞|威胁/.test(text)) return "security"
  if (/performance|perf|性能|压力测试|benchmark/.test(text)) return "performance"
  if (/smoke|冒烟/.test(text)) return "smoke"
  if (/integration|e2e|集成|端到端/.test(text)) return "integration"
  return "unit"
}

function benchmarkReason(prompt: string, tier: EngineeringBenchmarkTier) {
  if (tier !== "unit") return "用户提示词或任务描述显式要求该验证层级"
  if (/只回复|hello|ok/i.test(prompt)) return "简单任务默认使用 smoke/unit 级别验证"
  return "未显式指定验证层级，工程任务默认从 unit，单元验证层开始"
}

function benchmarkTierForCommand(command: string, runtime: RuntimeState): EngineeringBenchmarkTier {
  const lower = command.toLowerCase()
  const tier = /\brun-real-benchmark\b|full[-_ ]?24|full regression/.test(lower)
    ? "full-regression"
    : /swe[-_ ]?bench|swebench/.test(lower)
      ? "swe-bench"
      : /official harness|swebench\.harness|docker.*swebench/.test(lower)
        ? "official-harness"
        : /lighthouse|pa11y|k6|wrk|ab\s+-|performance|perf/.test(lower)
          ? "performance"
          : /security|semgrep|trivy|grype|gitleaks|npm audit|cargo audit|bandit/.test(lower)
            ? "security"
            : /playwright|cypress|e2e|docker\s+compose|kubectl|helm|curl\s+(-f|--fail|-I)|wget\s+--spider|next\s+build|vite\s+build|astro\s+check|storybook/.test(lower)
              ? "integration"
              : /smoke/.test(lower)
                ? "smoke"
                : "unit"
  runtime.benchmark.effectiveTier = higherBenchmarkTier(runtime.benchmark.effectiveTier, tier)
  return tier
}

function higherBenchmarkTier(left: EngineeringBenchmarkTier, right: EngineeringBenchmarkTier) {
  const rank: Record<EngineeringBenchmarkTier, number> = {
    smoke: 1,
    unit: 2,
    integration: 3,
    "official-harness": 4,
    "swe-bench": 5,
    "full-regression": 6,
    performance: 3,
    security: 3,
    custom: 2,
  }
  return rank[right] > rank[left] ? right : left
}

function finishBenchmarkRun(
  runtime: RuntimeState,
  input: {
    id: string
    command: string
    exit: number | null
    passed: boolean
    outputChars: number
    startedAt: number
    finishedAt: number
  },
) {
  const existing = runtime.benchmark.runs.findLast((item) => item.id === input.id || item.command === input.command)
  const tier = existing?.effectiveTier ?? benchmarkTierForCommand(input.command, runtime)
  const run = {
    id: existing?.id ?? input.id,
    requestedTier: runtime.benchmark.requestedTier,
    effectiveTier: tier,
    command: input.command,
    status: input.passed ? ("passed" as const) : ("failed" as const),
    startedAt: existing?.startedAt ?? input.startedAt,
    finishedAt: input.finishedAt,
    durationMs: Math.max(0, input.finishedAt - (existing?.startedAt ?? input.startedAt)),
    exit: input.exit,
    outputChars: input.outputChars,
    failureReason: input.passed ? undefined : `exit ${input.exit ?? "unknown"}`,
    cost: {
      outputChars: input.outputChars,
      estimate: "output_chars_proxy" as const,
    },
  } satisfies EngineeringBenchmarkTierRun
  runtime.benchmark.runs = existing
    ? runtime.benchmark.runs.map((item) => (item.id === existing.id ? run : item))
    : [...runtime.benchmark.runs.slice(-19), run]
  runtime.benchmark.passed += input.passed ? 1 : 0
  runtime.benchmark.failed += input.passed ? 0 : 1
  runtime.benchmark.totalDurationMs += run.durationMs ?? 0
  runtime.benchmark.totalOutputChars += input.outputChars
  runtime.benchmark.cost = {
    outputChars: runtime.benchmark.totalOutputChars,
    commandCount: runtime.benchmark.runs.filter((item) => item.status !== "started").length,
    estimate: "output_chars_proxy",
  }
  return run
}

function looksLikeDeploymentCommand(command: string) {
  return deploymentRule(command).ruleID !== "none"
}

function deploymentGateAssessment(turn: TurnContext, command: string, input: unknown): EngineeringDeploymentGateAssessment {
  const rule = deploymentRule(command)
  const dryRunDetected = deploymentDryRun(command)
  const explicitConfirmationDetected = deploymentConfirmed(command, input)
  const requiresApproval = rule.riskLevel === "high" || rule.riskLevel === "medium"
  const requiresDryRun = rule.riskLevel === "high" && !rule.dryRunOptional
  const action = requiresApproval && !dryRunDetected && !explicitConfirmationDetected ? "blocked" : "allowed"
  return {
    schema: "aialra.deployment_gate.v1",
    commandPreview: command.slice(0, 240),
    gate: rule.gate,
    ruleID: rule.ruleID,
    matchedRule: rule.matchedRule,
    riskLevel: rule.riskLevel,
    action,
    requiresApproval,
    requiresDryRun,
    dryRunDetected,
    explicitConfirmationDetected,
    approvalPolicy: approvalPolicyLabel(turn.approval_policy),
    approvalsReviewer: approvalsReviewerLabel(turn.approvals_reviewer),
    environmentID: turn.selected_environment_id,
    cwd: turn.cwd,
    reason:
      action === "blocked"
        ? `部署门禁阻止了高风险命令 ${rule.ruleID}`
        : rule.riskLevel === "low"
          ? `部署门禁记录了低风险 ${rule.gate} 命令`
          : `部署门禁允许执行，因为已检测到 dry-run 或显式确认`,
    suggestion:
      action === "blocked"
        ? "请先运行 dry-run、plan、diff、status 或 health check；如果确实要执行真实部署，请向用户请求明确批准，并在批准后带上 deployment_confirmed 标记"
        : "继续执行后请记录输出、退出码和健康检查结果",
    at: Date.now(),
  }
}

function deploymentRule(command: string) {
  const rules: Array<{
    ruleID: string
    matchedRule: string
    gate: EngineeringDeploymentGateAssessment["gate"]
    riskLevel: EngineeringDeploymentGateAssessment["riskLevel"]
    dryRunOptional?: boolean
    pattern: RegExp
  }> = [
    { ruleID: "npm-publish", matchedRule: "npm/pnpm/yarn publish", gate: "publish", riskLevel: "high", pattern: /\b(npm|pnpm)\s+publish\b|\byarn\s+npm\s+publish\b/i },
    { ruleID: "docker-push", matchedRule: "docker push", gate: "publish", riskLevel: "high", pattern: /\bdocker\s+push\b/i },
    { ruleID: "git-push", matchedRule: "git push", gate: "publish", riskLevel: "high", pattern: /\bgit\s+push\b/i },
    { ruleID: "kubectl-write", matchedRule: "kubectl apply/delete/scale/rollout restart", gate: "infra", riskLevel: "high", pattern: /\bkubectl\s+(apply|delete|scale|rollout\s+restart)\b/i },
    { ruleID: "helm-write", matchedRule: "helm install/upgrade/uninstall", gate: "infra", riskLevel: "high", pattern: /\bhelm\s+(install|upgrade|uninstall)\b/i },
    { ruleID: "terraform-write", matchedRule: "terraform apply/destroy", gate: "infra", riskLevel: "high", pattern: /\bterraform\s+(apply|destroy)\b/i },
    { ruleID: "cloud-deploy", matchedRule: "cloud deploy production command", gate: "publish", riskLevel: "high", pattern: /\b(gcloud|aws|az)\b.*\bdeploy\b|\b(vercel|wrangler)\s+deploy\b.*\b(--prod|production)\b|\bnetlify\s+deploy\b.*\b--prod\b/i },
    { ruleID: "remote-production", matchedRule: "ssh/scp/rsync production", gate: "remote", riskLevel: "high", pattern: /\b(ssh|scp|rsync)\b.*\b(prod|production|root@|deploy@)\b/i },
    { ruleID: "database-migration", matchedRule: "database migration", gate: "database", riskLevel: "high", pattern: /\b(prisma|sequelize|knex|rails|django-admin|alembic|flyway|liquibase)\b.*\b(migrate|migration|deploy|upgrade)\b/i },
    { ruleID: "service-restart", matchedRule: "system service restart/start", gate: "runtime", riskLevel: "medium", pattern: /\b(systemctl|service|pm2)\s+(restart|start|reload)\b/i },
    { ruleID: "runtime-up", matchedRule: "docker compose up/run", gate: "runtime", riskLevel: "medium", pattern: /\bdocker\s+compose\s+(up|run)\b/i },
    { ruleID: "build-check", matchedRule: "build/config check", gate: "build", riskLevel: "low", dryRunOptional: true, pattern: /\b(docker\s+(compose\s+)?build|npm\s+run\s+build|pnpm\s+run\s+build|yarn\s+build|bun\s+run\s+build|nginx\s+-t|terraform\s+plan|kubectl\s+diff|helm\s+template)\b/i },
    { ruleID: "health-check", matchedRule: "status/logs/health check", gate: "health", riskLevel: "low", dryRunOptional: true, pattern: /\b(curl\s+(-f|--fail|-I)|wget\s+--spider|systemctl\s+is-active|docker\s+compose\s+(ps|logs|config)|kubectl\s+(get|logs|describe)|helm\s+status)\b/i },
  ]
  return (
    rules.find((rule) => rule.pattern.test(command)) ?? {
      ruleID: "none",
      matchedRule: "none",
      gate: "deployment" as const,
      riskLevel: "low" as const,
      dryRunOptional: true,
      pattern: /$^/,
    }
  )
}

function deploymentDryRun(command: string) {
  return /\b(--dry-run|--dry-run=server|--dry-run=client|plan|diff|template|config|status|is-active|logs|ps|describe)\b/i.test(
    command,
  )
}

function deploymentConfirmed(command: string, input: unknown) {
  if (/AIALRA_DEPLOYMENT_APPROVED=1/.test(command)) return true
  if (!input || typeof input !== "object") return false
  const record = input as Record<string, unknown>
  return record.deployment_confirmed === true || record.deploymentConfirmed === true
}

function approvalsReviewerLabel(value: unknown) {
  if (!value) return "user:current_user"
  if (typeof value === "string") return value
  if (typeof value !== "object") return String(value)
  const record = value as Record<string, unknown>
  return [record.role, record.id].filter((item) => typeof item === "string" && item).join(":") || "reviewer"
}

function approvalPolicyLabel(value: unknown) {
  if (!value) return undefined
  if (typeof value === "string") return value
  if (typeof value !== "object") return String(value)
  const record = value as Record<string, unknown>
  return typeof record.type === "string" ? record.type : "custom"
}

function deploymentGateSummary(assessment: EngineeringDeploymentGateAssessment) {
  if (assessment.action === "blocked") return `${assessment.reason}，需要 dry-run 或明确审批`
  if (assessment.gate === "build") return "部署门禁允许构建或配置检查"
  if (assessment.gate === "runtime") return "部署门禁记录运行时变更"
  if (assessment.gate === "health") return "部署门禁记录健康检查"
  return `部署门禁记录 ${assessment.gate} 命令`
}

import { Schema } from "effect"
import { PublicEventLog } from "./public-event"
import type { TurnContext } from "./turn-context"

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
  totalToolCallsMax: Schema.Number,
  singleCommandTimeoutMs: Schema.Number,
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
  totalToolCallsMax: Schema.optional(Schema.Number),
  singleCommandTimeoutMs: Schema.optional(Schema.Number),
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

export type EngineeringTaskClass = "bug_fix" | "feature" | "refactor" | "test" | "security" | "unknown"
export type EngineeringRiskLevel = "low" | "medium" | "high"

export type EngineeringRunSnapshot = {
  version: "aialra.engineering_run.v2"
  phase: EngineeringPhase
  controls: EngineeringControls
  intake: {
    taskClass: EngineeringTaskClass
    riskLevel: EngineeringRiskLevel
    needsClarification: boolean
    expectedEvidence: string[]
  }
  verification: {
    attempts: number
    passed: boolean
    lastCommand?: string
    lastExit?: number | null
  }
  stopGate: {
    active: boolean
    reason?: string
  }
  loop: {
    toolCalls: number
    warnings: number
    checkpoints: number
    blocked: number
  }
  phaseGate: {
    blocked: number
    prematureFinals: number
  }
  feedback: {
    items: EngineeringFeedbackItem[]
  }
}

export type EngineeringFeedbackItem = {
  id: string
  kind: "verification_failed" | "loop_checkpoint" | "phase_gate"
  summary: string
  detail?: string
  command?: string
  exit?: number | null
  tool?: string
  at: number
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
    totalToolCallsMax: 80,
    singleCommandTimeoutMs: 120_000,
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
    totalToolCallsMax: 180,
    singleCommandTimeoutMs: 300_000,
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
    totalToolCallsMax: 420,
    singleCommandTimeoutMs: 900_000,
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
    totalToolCallsMax: 0,
    singleCommandTimeoutMs: 1_800_000,
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
      totalToolCallsMax: clamp(input?.totalToolCallsMax, presetValue.totalToolCallsMax, 0, 100_000),
      singleCommandTimeoutMs: clamp(input?.singleCommandTimeoutMs, presetValue.singleCommandTimeoutMs, 1_000, 24 * 60 * 60 * 1000),
      longRun: input?.longRun ?? presetValue.longRun,
    } satisfies EngineeringControls
  }

  export function applyMode(input: EngineeringControls, mode: EngineeringMode) {
    return { ...preset(mode), advancedEnabled: input.advancedEnabled }
  }

  export function classify(text: string) {
    const lower = text.toLowerCase()
    const taskClass: EngineeringTaskClass = /漏洞|安全|security|xss|csrf|auth/.test(lower)
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
      expectedEvidence: taskClass === "test" ? ["test"] : taskClass === "unknown" ? ["summary"] : ["diff", "test"],
    } satisfies EngineeringRunSnapshot["intake"]
  }

  export function snapshot(input: { controls: EngineeringControls; prompt: string }): EngineeringRunSnapshot {
    return {
      version: "aialra.engineering_run.v2",
      phase: "intake",
      controls: input.controls,
      intake: classify(input.prompt),
      verification: {
        attempts: 0,
        passed: false,
      },
      stopGate: {
        active: false,
      },
      loop: {
        toolCalls: 0,
        warnings: 0,
        checkpoints: 0,
        blocked: 0,
      },
      phaseGate: {
        blocked: 0,
        prematureFinals: 0,
      },
      feedback: {
        items: [],
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
      summary: `模式 ${runtime.controls.mode}，任务 ${runtime.intake.taskClass}，风险 ${runtime.intake.riskLevel}`,
      status: "started",
      data: publicState(runtime),
    })
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
      record(turn, {
        type: "engineering.loop.warning",
        severity: "warning",
        title: "重复工具调用预警",
        summary: `${tool} 连续命中相同输入 ${count} 次`,
        status: "warning",
        data: { tool, count, state: publicState(runtime) },
      })
    }
    if (count === runtime.controls.repeatedToolCheckpoint) {
      runtime.loop.checkpoints++
      phase(turn, "repair", "repeated_tool_checkpoint")
      addFeedback(runtime, {
        kind: "loop_checkpoint",
        summary: `${tool} 对同一类输入重复了 ${count} 次，系统要求换方向`,
        detail: "请先总结这条路线已经得到什么证据，说明为什么继续重复没有价值，然后选择新的定位或验证方向",
        tool,
      })
      record(turn, {
        type: "engineering.loop.checkpoint",
        severity: "warning",
        title: "重复工具调用检查点",
        summary: `${tool} 重复过多，要求模型换方向`,
        status: "checkpoint",
        data: { tool, count, state: publicState(runtime) },
      })
    }
    if (runtime.controls.repeatedToolStop > 0 && count >= runtime.controls.repeatedToolStop && !runtime.controls.longRun) {
      runtime.loop.blocked++
      phase(turn, "blocked", "repeated_tool_stop")
      record(turn, {
        type: "engineering.loop.blocked",
        severity: "error",
        title: "重复工具调用被中止",
        summary: `${tool} 重复 ${count} 次`,
        status: "blocked",
        data: { tool, count, state: publicState(runtime) },
      })
      return {
        blocked: true as const,
        output: `系统检测到同一个工具和同一类输入重复了 ${count} 次，已按用户设置中止这条路线 请换思路，或向用户说明阻塞原因`,
      }
    }

    if (writeTool(tool)) phase(turn, "edit", "write_tool")
    if (tool === "bash" || tool === "shell") phase(turn, "verify", "command_tool")
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
      })
    }
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
        failureSummary: failure?.summary,
        failureDetail: failure?.detail,
        state: publicState(runtime),
      },
      raw: {
        command: input.command,
        exit: input.exit,
        output: input.output,
      },
    })
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

  export function finish(turn: TurnContext | undefined, status: "completed" | "aborted") {
    if (!turn) return
    const runtime = states.get(turn.turnID)
    if (!runtime) return
    record(turn, {
      type: "engineering.run.finished",
      severity: status === "completed" ? "info" : "warning",
      title: status === "completed" ? "工程运行完成" : "工程运行中断",
      summary: `阶段 ${phaseLabel(runtime.phase)}，工具 ${runtime.loop.toolCalls} 次，验证 ${runtime.verification.attempts} 次`,
      status,
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
    intake: runtime.intake,
    verification: runtime.verification,
    stopGate: runtime.stopGate,
    loop: runtime.loop,
    phaseGate: runtime.phaseGate,
    feedback: {
      items: runtime.feedback.items,
    },
  }
}

function addFeedback(runtime: RuntimeState, input: Omit<EngineeringFeedbackItem, "id" | "at">) {
  runtime.feedback.items = [
    ...runtime.feedback.items.slice(-4),
    {
      ...input,
      id: `feedback_${Date.now()}_${runtime.feedback.items.length + 1}`,
      at: Date.now(),
    },
  ]
}

function latestFeedback(runtime: RuntimeState) {
  return runtime.feedback.items.at(-1)
}

function writeTool(tool: string) {
  return tool === "edit" || tool === "write" || tool === "apply_patch"
}

function requiresLocalization(taskClass: EngineeringTaskClass) {
  return taskClass === "bug_fix" || taskClass === "refactor" || taskClass === "security"
}

function looksPrematureFinal(text: string) {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/would you like me to proceed|shall i proceed|should i proceed|ready to make|ready to apply|let me know if you want/i.test(trimmed)) return true
  if (/要我继续|是否继续|要不要我|需要我.*(改|执行|继续)|我可以继续/.test(trimmed)) return true
  return /root cause|minimal fix|the fix is|replace .* with|修复方式|根因.*修|改成|替换为/i.test(trimmed)
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
  return {
    summary: `验证命令失败：${input.command}，退出码 ${input.exit ?? "unknown"}`,
    detail: detail || "没有捕获到可读测试输出，请换更小的验证命令或先检查失败日志文件",
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
  return /\b(test|pytest|vitest|jest|mocha|ava|npm\s+test|pnpm\s+test|yarn\s+test|bun\s+test|cargo\s+test|go\s+test|mvn\s+test|gradle\s+test|tox|ruff|eslint|tsc|typecheck)\b/i.test(
    command,
  )
}

import { beforeEach, describe, expect, test } from "bun:test"
import { EngineeringHarness } from "../../src/session/engineering"
import { PublicEventLog } from "../../src/session/public-event"
import { CodexTurn, type TurnContext } from "../../src/session/turn-context"
import { MessageID, SessionID } from "../../src/session/schema"

function turn(overrides: Partial<TurnContext> = {}): TurnContext {
  const cwd = "/tmp/aialra-engineering"
  return {
    version: "aialra.user_turn.v1",
    turnID: MessageID.make("msg_engineering_turn"),
    startedAt: Date.now(),
    items: [],
    cwd,
    approval_policy: "on-request",
    sandbox_policy: CodexTurn.defaultSandboxPolicy(cwd),
    permission_profile: CodexTurn.workspacePermissionProfile(cwd),
    active_permission_profile: { id: ":workspace" },
    model: { providerID: "test", modelID: "test" },
    collaboration_mode: { kind: "default" },
    environments: [{ environmentID: "default", cwd }],
    selected_environment_id: "default",
    route: "prompt",
    sessionID: SessionID.make("ses_engineering"),
    messageID: MessageID.make("msg_engineering_turn"),
    agent: "build",
    noReply: false,
    format: "text",
    retry: CodexTurn.retryConfig({}),
    ...overrides,
  }
}

describe("EngineeringHarness", () => {
  beforeEach(() => {
    PublicEventLog.clearForTest()
    EngineeringHarness.clearForTest()
  })

  test("starts a run and emits user-visible phase events", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("deep"),
      prompt: "这个 bug 在月底会失败，帮我修一下并跑测试",
    })

    const state = EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 在月底会失败，帮我修一下并跑测试" })

    expect(state.controls.mode).toBe("deep")
    expect(state.intake.taskClass).toBe("bug_fix")
    expect(EngineeringHarness.reminder(ctx)).toContain("localize")
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.run.started", status: "started" }),
        expect.objectContaining({ type: "engineering.phase.changed", status: "changed" }),
      ]),
    )
  })

  test("TurnContext keeps Codex UserTurn parity fields in trace summaries", () => {
    const ctx = turn({
      approvals_reviewer: "current_user",
      effort: "xhigh",
      summary: "auto",
      service_tier: "flex",
      final_output_json_schema: { type: "object", properties: { ok: { type: "boolean" } } },
      environments: [
        { environmentID: "default", cwd: "/tmp/aialra-engineering", kind: "local" },
        { environmentID: "alt", cwd: "/tmp/aialra-engineering-alt", kind: "disabled", status: "remote unsupported" },
      ],
      selected_environment_id: "alt",
      http_context: {
        enabled: false,
        network_policy: "off",
        execution: "local",
      },
    })

    expect(CodexTurn.environmentCwd(ctx)).toBe("/tmp/aialra-engineering-alt")
    expect(CodexTurn.traceSummary(ctx)).toEqual(
      expect.objectContaining({
        approvals_reviewer: "current_user",
        effort: "xhigh",
        summary: "auto",
        service_tier: "flex",
        selected_environment_id: "alt",
        selected_environment_cwd: "/tmp/aialra-engineering-alt",
        http_context: expect.objectContaining({ network_policy: "off" }),
        final_output_json_schema: expect.objectContaining({ type: "object" }),
      }),
    )
  })

  test("activates stop gate after a passing verification command", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "修复后跑 npm test",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "修复后跑 npm test" })

    EngineeringHarness.recordVerification({
      turn: ctx,
      command: "npm test",
      exit: 0,
      output: "pass",
    })
    const gate = EngineeringHarness.beforeTool(ctx, "bash", { command: "npm test" })

    expect(gate.blocked).toBe(true)
    expect(gate.output).toContain("验证已经通过")
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.verification.finished", status: "passed" }),
        expect.objectContaining({ type: "engineering.stop_gate.activated", status: "active" }),
        expect.objectContaining({ type: "engineering.stop_gate.blocked_tool", status: "blocked" }),
      ]),
    )
  })

  test("recognizes common verification runners before activating stop gate", () => {
    const commands = [
      "npm test",
      "npm run test:unit",
      "pytest tests/test_api.py",
      "bun test",
      "node --test test/tool.test.js",
      "cargo test",
      "go test ./...",
      "make check",
      "just test",
      "nox -s tests",
      "hatch test",
      "pnpm run unit-test",
      "yarn test:unit",
      "ruff check .",
      "eslint .",
      "bun typecheck",
    ]

    for (const command of commands) {
      EngineeringHarness.clearForTest()
      PublicEventLog.clearForTest()
      const ctx = turn()
      ctx.engineering = EngineeringHarness.snapshot({
        controls: EngineeringHarness.preset("balanced"),
        prompt: `修复后运行 ${command}`,
      })
      EngineeringHarness.start({ turn: ctx, prompt: `修复后运行 ${command}` })

      expect(EngineeringHarness.beforeTool(ctx, "bash", { command }).blocked).toBe(false)
      EngineeringHarness.recordVerification({ turn: ctx, command, exit: 0, output: "pass" })

      expect(EngineeringHarness.state(ctx.turnID)?.stopGate.active).toBe(true)
      expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "src/index.ts" }).blocked).toBe(true)
      expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "engineering.verification.finished", status: "passed" }),
          expect.objectContaining({ type: "engineering.stop_gate.blocked_tool", status: "blocked" }),
        ]),
      )
    }
  })

  test("turns repeated tool churn into warning, checkpoint, and block", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: {
        ...EngineeringHarness.preset("fast"),
        repeatedToolWarning: 2,
        repeatedToolCheckpoint: 3,
        repeatedToolStop: 4,
      },
      prompt: "别重复同一个没用操作",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "别重复同一个没用操作" })

    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "a.js" }).blocked).toBe(false)
    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "a.js" }).blocked).toBe(false)
    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "a.js" }).blocked).toBe(false)
    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "a.js" }).blocked).toBe(true)
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.loop.warning", status: "warning" }),
        expect.objectContaining({ type: "engineering.loop.checkpoint", status: "checkpoint" }),
        expect.objectContaining({ type: "engineering.loop.blocked", status: "blocked" }),
      ]),
    )
  })

  test("feeds verification failure details back into the repair reminder", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "修复后跑 npm test，如果失败就继续修",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "修复后跑 npm test，如果失败就继续修" })

    EngineeringHarness.recordVerification({
      turn: ctx,
      command: "npm test",
      exit: 1,
      output:
        "AssertionError: expected mode=fast\nactual mode=safe\nFAILED test/tool.test.js::mode_override",
    })

    expect(EngineeringHarness.reminder(ctx)).toContain("AssertionError")
    const feedback = EngineeringHarness.state(ctx.turnID)?.feedback.items.at(-1)
    expect(feedback?.kind).toBe("verification_failed")
    expect(feedback?.failedFiles).toContain("test/tool.test.js")
    expect(feedback?.expected).toContain("expected mode=fast")
    expect(feedback?.actual).toContain("actual mode=safe")
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "engineering.verification.finished",
          status: "failed",
          data: expect.objectContaining({
            failureSummary: expect.stringContaining("npm test"),
            failureDetail: expect.stringContaining("AssertionError"),
            failedFiles: expect.arrayContaining(["test/tool.test.js"]),
            expected: expect.stringContaining("expected mode=fast"),
            actual: expect.stringContaining("actual mode=safe"),
          }),
        }),
      ]),
    )
  })

  test("injects verification failure feedback when the model tries to finish too early", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "修复这个测试失败",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "修复这个测试失败" })
    EngineeringHarness.recordVerification({
      turn: ctx,
      command: "npm test",
      exit: 1,
      output: "test/tool.test.js:10 expected mode=fast actual mode=safe",
    })

    const prompt = EngineeringHarness.verificationRepairPrompt(ctx, "我已经完成，测试还有问题")

    expect(prompt).toContain("验证刚刚失败")
    expect(prompt).toContain("npm test")
    expect(prompt).toContain("expected mode=fast")
    expect(EngineeringHarness.state(ctx.turnID)?.feedback.items.at(-1)?.kind).toBe("phase_gate")
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "engineering.artifact.updated",
          status: "updated",
          data: expect.objectContaining({ artifact: "repairFeedback" }),
        }),
      ]),
    )
  })

  test("blocks the first write attempt during localization and asks for a plan", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })

    const gate = EngineeringHarness.beforeTool(ctx, "edit", { filePath: "src/tool.js" })

    expect(gate.blocked).toBe(true)
    expect(gate.output).toContain("定位阶段")
    expect(EngineeringHarness.state(ctx.turnID)?.phase).toBe("plan")
    expect(EngineeringHarness.state(ctx.turnID)?.feedback.items.at(-1)?.kind).toBe("phase_gate")
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.phase_gate.blocked_tool", status: "blocked" }),
      ]),
    )
  })

  test("allows edits after the model has gathered localization evidence", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })

    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "src/tool.js" }).blocked).toBe(false)
    expect(EngineeringHarness.beforeTool(ctx, "edit", { filePath: "src/tool.js" }).blocked).toBe(false)
    expect(EngineeringHarness.state(ctx.turnID)?.phase).toBe("edit")
  })

  test("stores EngineeringRun V3 artifacts for localization, edit, verification, and final summary", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下并跑 npm test",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下并跑 npm test" })

    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "src/tool.js" }).blocked).toBe(false)
    expect(EngineeringHarness.beforeTool(ctx, "edit", { filePath: "src/tool.js" }).blocked).toBe(false)
    expect(EngineeringHarness.beforeTool(ctx, "bash", { command: "npm test" }).blocked).toBe(false)
    EngineeringHarness.recordVerification({ turn: ctx, command: "npm test", exit: 0, output: "pass" })
    EngineeringHarness.finish(ctx, "completed", "已修复并通过验证")

    const events = PublicEventLog.list({ sessionID: "ses_engineering" })

    expect(ctx.engineering.version).toBe("aialra.engineering_run.v3")
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.artifact.updated", status: "updated" }),
        expect.objectContaining({ type: "engineering.run.finished", status: "completed" }),
      ]),
    )
    const finished = events.find((event) => event.type === "engineering.run.finished")
    expect(finished?.data).toEqual(
      expect.objectContaining({
        artifacts: expect.objectContaining({
          suspectedFiles: expect.arrayContaining([expect.objectContaining({ path: "src/tool.js" })]),
          editPlan: expect.objectContaining({ files: ["src/tool.js"] }),
          verificationPlan: expect.objectContaining({ verification: ["npm test"] }),
          verificationResults: expect.arrayContaining([expect.objectContaining({ command: "npm test", passed: true })]),
          finalSummary: expect.objectContaining({ text: "已修复并通过验证" }),
        }),
      }),
    )
  })

  test("continues when the model finds a fix but asks whether to proceed", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })

    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "src/tool.js" }).blocked).toBe(false)
    const prompt = EngineeringHarness.prematureFinalPrompt(
      ctx,
      "The root cause is clear. The fix is to replace old with new. Would you like me to proceed?",
    )

    expect(prompt).toContain("不要再问用户是否继续")
    expect(EngineeringHarness.state(ctx.turnID)?.phase).toBe("edit")
    expect(EngineeringHarness.state(ctx.turnID)?.phaseGate.prematureFinals).toBe(1)
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.phase_gate.premature_final", status: "continued" }),
      ]),
    )
  })

  test("requests zero patch recovery before finalizing an engineering task without writes", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })
    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "src/tool.js" }).blocked).toBe(false)

    const prompt = EngineeringHarness.zeroPatchPrompt(ctx, "已完成分析，根因在 src/tool.js，最终报告如下")

    expect(prompt).toContain("当前没有任何代码改动")
    expect(EngineeringHarness.state(ctx.turnID)?.phase).toBe("repair")
    expect(EngineeringHarness.state(ctx.turnID)?.patch.zeroPatchRecoveries).toBe(1)
    expect(EngineeringHarness.state(ctx.turnID)?.feedback.items.at(-1)?.kind).toBe("zero_patch")
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.zero_patch.detected", status: "detected" }),
        expect.objectContaining({ type: "engineering.zero_patch.recovery_requested", status: "continued" }),
      ]),
    )
  })

  test("does not request zero patch recovery after a write tool ran", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })
    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "src/tool.js" }).blocked).toBe(false)
    expect(EngineeringHarness.beforeTool(ctx, "edit", { filePath: "src/tool.js" }).blocked).toBe(false)

    expect(EngineeringHarness.zeroPatchPrompt(ctx, "已完成修复")).toBeUndefined()
  })

  test("requests zero patch recovery after writes when git status still has no changes", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })
    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "src/tool.js" }).blocked).toBe(false)
    expect(EngineeringHarness.beforeTool(ctx, "edit", { filePath: "src/tool.js" }).blocked).toBe(false)

    expect(EngineeringHarness.zeroPatchPrompt(ctx, "已完成修复", { workspaceChanged: false })).toContain(
      "当前没有任何代码改动",
    )
  })

  test("exhausts zero patch recovery using the user-configured budget", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: {
        ...EngineeringHarness.preset("fast"),
        zeroPatchRecoveryMax: 1,
      },
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })
    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "src/tool.js" }).blocked).toBe(false)

    expect(EngineeringHarness.zeroPatchPrompt(ctx, "已完成分析")).toContain("当前没有任何代码改动")
    expect(EngineeringHarness.zeroPatchPrompt(ctx, "还是没有改动")).toBeUndefined()

    expect(EngineeringHarness.state(ctx.turnID)?.phase).toBe("blocked")
    expect(EngineeringHarness.state(ctx.turnID)?.patch.zeroPatchExhausted).toBe(true)
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.zero_patch.exhausted", status: "blocked" }),
      ]),
    )
  })

  test("terminal reconciler classifies missing assistant and empty final anomalies", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })

    expect(EngineeringHarness.terminalAnomaly({ turn: ctx })).toBe("missing_assistant")
    expect(EngineeringHarness.terminalAnomaly({ turn: ctx, lastAgentMessage: "msg_assistant", finalText: "" })).toBe(
      "empty_final",
    )
    expect(EngineeringHarness.state(ctx.turnID)?.feedback.items.at(-1)?.kind).toBe("terminal_anomaly")
  })

  test("terminal reconciler can preserve explicit assistant error reasons", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })

    expect(
      EngineeringHarness.terminalAnomaly({
        turn: ctx,
        lastAgentMessage: "msg_assistant",
        finalText: "",
        forcedReason: "model_not_started",
      }),
    ).toBe("model_not_started")
    expect(EngineeringHarness.state(ctx.turnID)?.feedback.items.at(-1)?.summary).toBe("模型没有成功启动")
  })
})

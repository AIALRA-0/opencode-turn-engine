import { beforeEach, describe, expect, test } from "bun:test"
import { EngineeringHarness } from "../../src/session/engineering"
import { PublicEventLog } from "../../src/session/public-event"
import { CodexTurn, type TurnContext } from "../../src/session/turn-context"
import { MessageID, SessionID } from "../../src/session/schema"
import { ExecProcessRegistry } from "../../src/session/exec-process-registry"
import { TurnDiffStore } from "../../src/session/turn-diff"
import { Effect } from "effect"

function turn(
  overrides: Partial<
    Omit<
      TurnContext,
      | "model_info"
      | "effort_resolution"
      | "reasoning_summary_policy"
      | "service_tier_resolution"
      | "dynamic_tools"
      | "skill_catalog"
    >
  > = {},
): TurnContext {
  const cwd = "/tmp/aialra-engineering"
  return {
    version: "aialra.user_turn.v1",
    turnID: MessageID.make("msg_engineering_turn"),
    startedAt: Date.now(),
    items: [],
    input_items: [],
    input_schema: {
      codex: "Op::UserInput",
      supported_items: ["text", "image", "local_image", "file", "skill", "mention", "subtask"],
    },
    cwd,
    approval_policy: "on-request",
    sandbox_policy: CodexTurn.defaultSandboxPolicy(cwd),
    permission_profile: CodexTurn.workspacePermissionProfile(cwd),
    active_permission_profile: { id: ":workspace" },
    model: { providerID: "test", modelID: "test" },
    model_info: CodexTurn.modelInfo({ providerID: "test", modelID: "test" }),
    effort_resolution: CodexTurn.reasoningEffortResolution({
      modelInfo: CodexTurn.modelInfo({ providerID: "test", modelID: "test" }),
    }),
    reasoning_summary_policy: CodexTurn.defaultReasoningSummaryPolicy(),
    service_tier_resolution: CodexTurn.serviceTierResolution({
      modelInfo: CodexTurn.modelInfo({ providerID: "test", modelID: "test" }),
    }),
    dynamic_tools: CodexTurn.defaultDynamicTools({
      requested: {},
      activePermissionProfile: { id: ":workspace" },
      approvalPolicy: "on-request",
      modelSupportsTools: true,
      selectedEnvironmentID: "default",
    }),
    skill_catalog: CodexTurn.defaultSkillCatalog({
      skills: [],
      agent: "build",
      cwd,
      activePermissionProfile: { id: ":workspace" },
      approvalPolicy: "on-request",
      selectedEnvironmentID: "default",
    }),
    collaboration_mode: { kind: "default" },
    environments: [{ environmentID: "default", cwd }],
    selected_environment_id: "default",
    network_permissions: CodexTurn.defaultNetworkPermissions("ask"),
    shell_environment_policy: CodexTurn.defaultShellEnvironmentPolicy(),
    security_constraints: CodexTurn.defaultSecurityConstraints(cwd),
    route: "prompt",
    sessionID: SessionID.make("ses_engineering"),
    messageID: MessageID.make("msg_engineering_turn"),
    agent: "build",
    noReply: false,
    format: "text",
    thread_settings: {
      requested: {},
      resolved: {},
      effective: {},
    },
    metadata: { source: "test" },
    extension_data: {},
    retry: CodexTurn.retryConfig({}),
    ...overrides,
  }
}

describe("EngineeringHarness", () => {
  beforeEach(() => {
    PublicEventLog.clearForTest()
    EngineeringHarness.clearForTest()
    ExecProcessRegistry.clearForTest()
    TurnDiffStore.clearForTest()
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
      approvals_reviewer: CodexTurn.approvalReviewer("user"),
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
        approvals_reviewer: expect.objectContaining({ role: "user", id: "current_user" }),
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

  test("blocks final while a background process is still running", async () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "部署前先跑一个长命令",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "部署前先跑一个长命令" })
    await Effect.runPromise(
      ExecProcessRegistry.register({
        process_id: "proc_running",
        command_id: "cmd_running",
        backend: "node_bun",
        session_id: ctx.sessionID,
        turn_id: ctx.turnID,
        message_id: ctx.messageID,
        cwd: ctx.cwd,
        command: "npm run dev",
        output_chars: 0,
      }),
    )

    const prompt = EngineeringHarness.stopGatePrompt(ctx, "已完成，最终报告如下")

    expect(prompt).toContain("还有 1 个后台命令仍在运行")
    expect(prompt).toContain("await_process")
    expect(EngineeringHarness.state(ctx.turnID)?.phase).toBe("blocked")
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "engineering.stop_gate.checked",
          status: "blocked",
          data: expect.objectContaining({
            checks: expect.arrayContaining([
              expect.objectContaining({
                name: "live_process",
                status: "blocked",
                count: 1,
              }),
            ]),
          }),
        }),
      ]),
    )
  })

  test("creates a runtime verification plan for engineering turns", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })

    expect(EngineeringHarness.state(ctx.turnID)?.artifacts.verificationPlan).toEqual(
      expect.objectContaining({
        summary: expect.stringContaining("工程修改任务需要运行"),
        verification: ["project-specific minimal verification"],
      }),
    )
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.verification.planned", status: "planned" }),
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
      expect(EngineeringHarness.state(ctx.turnID)?.artifacts.verificationRuns.at(-1)).toEqual(
        expect.objectContaining({ command, status: "started" }),
      )
      EngineeringHarness.recordVerification({ turn: ctx, command, exit: 0, output: "pass" })

      expect(EngineeringHarness.state(ctx.turnID)?.stopGate.active).toBe(true)
      expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "src/index.ts" }).blocked).toBe(true)
      expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "engineering.verification.started", status: "started" }),
          expect.objectContaining({ type: "engineering.verification.finished", status: "passed" }),
          expect.objectContaining({ type: "engineering.stop_gate.blocked_tool", status: "blocked" }),
        ]),
      )
    }
  })

  test("records benchmark tier selection, runtime verification cost, and failure reason", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "修复这个端到端 e2e 回归并跑集成验证",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "修复这个端到端 e2e 回归并跑集成验证" })

    expect(EngineeringHarness.beforeTool(ctx, "bash", { command: "npx playwright test" }).blocked).toBe(false)
    EngineeringHarness.recordVerification({
      turn: ctx,
      command: "npx playwright test",
      exit: 1,
      output: "Error: expected visible button but got hidden",
    })

    expect(EngineeringHarness.state(ctx.turnID)?.benchmark).toEqual(
      expect.objectContaining({
        requestedTier: "integration",
        effectiveTier: "integration",
        failed: 1,
        cost: expect.objectContaining({
          outputChars: 45,
          commandCount: 1,
        }),
      }),
    )
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "engineering.benchmark.tier.selected",
          status: "selected",
          data: expect.objectContaining({ requestedTier: "integration", effectiveTier: "integration" }),
        }),
        expect.objectContaining({
          type: "engineering.benchmark.started",
          status: "started",
          data: expect.objectContaining({ tier: "integration", command: "npx playwright test" }),
        }),
        expect.objectContaining({
          type: "engineering.benchmark.finished",
          status: "failed",
          data: expect.objectContaining({ tier: "integration", command: "npx playwright test" }),
        }),
      ]),
    )
  })

  test("records multi-agent role assignment and settlement in the shared turn state", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "规划、实现、测试一起完成这个复杂任务",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "规划、实现、测试一起完成这个复杂任务" })

    const assignment = EngineeringHarness.multiAgentAssigned({
      turn: ctx,
      role: EngineeringHarness.multiAgentRole({
        subagentType: "tester",
        description: "run e2e verification",
        prompt: "Run the integration verification and report failures",
      }),
      agent: "tester",
      parentSessionID: ctx.sessionID,
      subagentSessionID: "ses_child_tester",
      description: "run e2e verification",
      model: { providerID: "test", modelID: "test" },
      permissionSummary: ["read:allow", "bash:ask"],
    })

    EngineeringHarness.multiAgentSettled({
      turn: ctx,
      assignmentID: assignment?.id,
      subagentSessionID: "ses_child_tester",
      status: "completed",
      result: "Playwright passed",
    })

    expect(EngineeringHarness.state(ctx.turnID)?.multiAgent).toEqual(
      expect.objectContaining({
        active: 0,
        completed: 1,
        failed: 0,
        assignments: expect.arrayContaining([
          expect.objectContaining({
            role: "tester",
            agent: "tester",
            status: "completed",
            resultChars: 17,
          }),
        ]),
        settlements: expect.arrayContaining([
          expect.objectContaining({
            assignmentID: assignment?.id,
            status: "accepted",
          }),
        ]),
      }),
    )
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "multi_agent.task.assigned",
          status: "assigned",
          data: expect.objectContaining({ role: "tester", agent: "tester" }),
        }),
        expect.objectContaining({
          type: "multi_agent.task.settled",
          status: "completed",
          data: expect.objectContaining({ role: "tester", resultChars: 17 }),
        }),
      ]),
    )
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
    expect(EngineeringHarness.reminder(ctx)).toContain("换一个定位路径")
    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "a.js" }).blocked).toBe(true)
    const events = PublicEventLog.list({ sessionID: "ses_engineering" })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.loop.warning", status: "warning" }),
        expect.objectContaining({ type: "engineering.loop.checkpoint", status: "checkpoint" }),
        expect.objectContaining({ type: "engineering.loop.blocked", status: "blocked" }),
      ]),
    )
    const checkpoint = events.find((event) => event.type === "engineering.loop.checkpoint")
    expect(checkpoint?.data.pattern).toEqual(
      expect.objectContaining({
        tool: "read",
        count: 3,
        argumentsSimilarity: "exact",
        failureSimilarity: "not_observed",
        threshold: expect.objectContaining({
          warning: 2,
          checkpoint: 3,
          stop: 4,
        }),
        interventionSuggestion: expect.stringContaining("换一个定位路径"),
      }),
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

  test("asks for verification before finalizing after edits", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })

    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "src/tool.js" }).blocked).toBe(false)
    expect(EngineeringHarness.beforeTool(ctx, "edit", { filePath: "src/tool.js" }).blocked).toBe(false)

    const prompt = EngineeringHarness.verificationPrompt(ctx, "已完成修复，最终报告如下")

    expect(prompt).toContain("还没有运行可识别验证命令")
    expect(prompt).toContain("不要只写")
    expect(EngineeringHarness.state(ctx.turnID)?.verification.skipRequests).toBe(1)
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.verification.repair_requested", status: "continued" }),
      ]),
    )
  })

  test("records a concrete skipped verification result at finish", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "这个 bug 会失败，帮我修一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "这个 bug 会失败，帮我修一下" })

    expect(EngineeringHarness.beforeTool(ctx, "read", { filePath: "src/tool.js" }).blocked).toBe(false)
    expect(EngineeringHarness.beforeTool(ctx, "edit", { filePath: "src/tool.js" }).blocked).toBe(false)
    EngineeringHarness.finish(ctx, "completed", "已完成，依赖没有安装所以无法运行测试")

    const finished = PublicEventLog.list({ sessionID: "ses_engineering" }).find(
      (event) => event.type === "engineering.run.finished",
    )
    expect(finished?.data).toEqual(
      expect.objectContaining({
        verification: expect.objectContaining({
          skipped: true,
          skipReason: "验证无法运行，因为依赖或验证命令不可用",
        }),
        artifacts: expect.objectContaining({
          verificationResults: expect.arrayContaining([
            expect.objectContaining({
              skipped: true,
              skipReason: "验证无法运行，因为依赖或验证命令不可用",
            }),
          ]),
        }),
      }),
    )
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.verification.finished", status: "skipped" }),
      ]),
    )
  })

  test("emits final patch quality score with verification context", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "修复 bug 并验证",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "修复 bug 并验证" })
    TurnDiffStore.finalize({
      sessionID: ctx.sessionID,
      turnID: ctx.turnID,
      messageID: ctx.messageID,
      outcome: "completed",
    })
    EngineeringHarness.recordVerification({ turn: ctx, command: "npm test", exit: 0, output: "pass" })

    EngineeringHarness.finish(ctx, "completed", "已修复并通过验证")

    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "patch.quality.scored",
          data: expect.objectContaining({
            source: "engineering_finish",
            verification: expect.objectContaining({ status: "passed", attempts: 1 }),
          }),
        }),
      ]),
    )
  })

  test("blocks high-risk deployment commands until dry-run or explicit confirmation", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "部署到集群",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "部署到集群" })

    const blocked = EngineeringHarness.beforeTool(ctx, "bash", { command: "kubectl apply -f prod.yaml" })
    const dryRun = EngineeringHarness.beforeTool(ctx, "bash", { command: "kubectl diff -f prod.yaml" })

    expect(blocked.blocked).toBe(true)
    expect(blocked.output).toContain("部署门禁阻止")
    expect(dryRun.blocked).toBe(false)
    const gates = PublicEventLog.list({ sessionID: "ses_engineering" }).filter(
      (event) => event.type === "engineering.deployment_gate.updated",
    )
    expect(gates.find((event) => event.status === "blocked")?.data).toEqual(
      expect.objectContaining({
        ruleID: "kubectl-write",
        riskLevel: "high",
        requiresApproval: true,
        requiresDryRun: true,
        dryRunDetected: false,
        assessment: expect.objectContaining({
          action: "blocked",
          approvalsReviewer: "user:current_user",
        }),
      }),
    )
    expect(gates.find((event) => event.status === "allowed")?.data).toEqual(
      expect.objectContaining({
        ruleID: "build-check",
        dryRunDetected: true,
        assessment: expect.objectContaining({
          action: "allowed",
        }),
      }),
    )
  })

  test("allows low-risk deployment build checks and records the gate", () => {
    const ctx = turn()
    ctx.engineering = EngineeringHarness.snapshot({
      controls: EngineeringHarness.preset("balanced"),
      prompt: "部署前构建一下",
    })
    EngineeringHarness.start({ turn: ctx, prompt: "部署前构建一下" })

    expect(EngineeringHarness.beforeTool(ctx, "bash", { command: "docker compose build web" }).blocked).toBe(false)

    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "engineering.deployment_gate.updated",
          status: "allowed",
          data: expect.objectContaining({
            gate: "build",
            riskLevel: "low",
            requiresApproval: false,
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

    expect(EngineeringHarness.zeroPatchPrompt(ctx, "已完成修复", { workspaceChanged: true })).toBeUndefined()
    expect(EngineeringHarness.state(ctx.turnID)?.patch.zeroPatchRecovered).toBe(true)
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.zero_patch.recovered", status: "recovered" }),
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

    EngineeringHarness.finish(ctx, "completed", "还是没有改动")
    expect(PublicEventLog.list({ sessionID: "ses_engineering" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "engineering.run.finished", status: "blocked" }),
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

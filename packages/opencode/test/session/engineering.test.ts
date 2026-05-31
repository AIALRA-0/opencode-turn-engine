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
})

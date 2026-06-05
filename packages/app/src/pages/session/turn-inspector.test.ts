import { describe, expect, test } from "bun:test"
import { buildTurnInspectorSummary, type PublicEvent } from "./turn-inspector-summary"

const event = (input: Partial<PublicEvent> & Pick<PublicEvent, "id" | "type">): PublicEvent => ({
  schema: "aialra.public_event.v1",
  version: "1",
  id: input.id,
  sequence: input.sequence ?? 1,
  ts: input.ts ?? "2026-06-04T08:00:00.000Z",
  type: input.type,
  source: input.source ?? "trace",
  threadID: input.threadID ?? "thread_1",
  severity: input.severity ?? "info",
  sessionID: input.sessionID ?? "ses_1",
  turnID: input.turnID ?? "msg_1",
  title: input.title ?? input.type,
  status: input.status,
  summary: input.summary,
  payloadSchema: input.payloadSchema ?? "aialra.test.v1",
  payload: input.payload ?? {},
  data: input.data ?? {},
  rawRef: input.rawRef,
})

describe("TurnInspector summary projection", () => {
  test("summarizes a full user turn without exposing raw JSON as the default view", () => {
    const summary = buildTurnInspectorSummary([
      event({
        id: "ev_1",
        type: "turn.input.received",
        data: { preview: "帮我检查沙箱并写报告" },
      }),
      event({
        id: "ev_2",
        type: "turn.context.created",
        data: {
          cwd: "/srv/aialra/turn-harness-target",
          model: "deepseek-v4-pro",
          permission_profile: "workspace-write",
          approval_policy: "on_request",
          sandbox_policy: "workspace",
          network_policy: "off",
          environment_id: "local-default",
        },
      }),
      event({
        id: "ev_3",
        type: "model.request.started",
        data: { providerID: "deepseek", modelID: "deepseek-v4-pro" },
        rawRef: { id: "raw_1", eventID: "ev_3", encrypted: true, persisted: true },
      }),
      event({
        id: "ev_prompt",
        type: "prompt.effective.resolved",
        data: {
          version: "aialra-general-engineering-harness-v1",
          prompt_hash: "1234567890abcdef",
          source_count: 3,
        },
        rawRef: { id: "raw_prompt", eventID: "ev_prompt", encrypted: true, persisted: true },
      }),
      event({ id: "ev_4", type: "tool.call.started", data: { tool: "bash" } }),
      event({
        id: "ev_5",
        type: "exec_command.started",
        data: { command: "pwd && ls -la" },
      }),
      event({
        id: "ev_6",
        type: "file.write",
        data: { path: "/srv/aialra/turn-harness-target/report.md" },
      }),
      event({
        id: "ev_7",
        type: "approval.resolved",
        status: "turn-command",
        data: { tool: "bash" },
      }),
      event({
        id: "ev_8",
        type: "tool.sandbox.denied",
        severity: "warning",
        data: { path: "/srv/aialra/outside.txt", reason: "workspace_write_denied" },
      }),
      event({
        id: "ev_9",
        type: "engineering.verification.finished",
        status: "passed",
      }),
      event({
        id: "ev_benchmark_selected",
        type: "engineering.benchmark.tier.selected",
        status: "selected",
        data: {
          requestedTier: "integration",
          effectiveTier: "integration",
        },
      }),
      event({
        id: "ev_benchmark_finished",
        type: "engineering.benchmark.finished",
        status: "passed",
        data: {
          tier: "integration",
          command: "npx playwright test",
        },
      }),
      event({
        id: "ev_skill_catalog",
        type: "skill.catalog.resolved",
        status: "resolved",
        data: {
          availableCount: 2,
          disabledCount: 1,
        },
      }),
      event({
        id: "ev_skill_used",
        type: "skill.used",
        status: "used",
        data: {
          name: "frontend",
          commands: ["npm test"],
          external_resources: ["https://example.com/docs"],
          usage_count: 1,
        },
      }),
      event({
        id: "ev_multi_agent_assigned",
        type: "multi_agent.task.assigned",
        status: "assigned",
        data: {
          assignment: {
            role: "tester",
            agent: "tester",
          },
        },
      }),
      event({
        id: "ev_multi_agent_settled",
        type: "multi_agent.task.settled",
        status: "completed",
        data: {
          assignment: {
            role: "tester",
            agent: "tester",
          },
        },
      }),
      event({
        id: "ev_patch_quality",
        type: "patch.quality.scored",
        status: "good",
        data: {
          score: 82,
          grade: "good",
          risks: ["public_api_surface_changed"],
        },
      }),
      event({
        id: "ev_deployment_gate",
        type: "engineering.deployment_gate.updated",
        status: "blocked",
        severity: "error",
        data: {
          assessment: {
            ruleID: "kubectl-write",
            riskLevel: "high",
            action: "blocked",
          },
        },
      }),
      event({
        id: "ev_10",
        type: "final.output",
        data: { preview: "沙箱正常，越界写入已被拒绝" },
      }),
      event({
        id: "ev_11",
        type: "turn.completed",
        data: { durationMs: 1234 },
      }),
    ])

    expect(summary.status).toBe("已完成")
    expect(summary.input).toBe("帮我检查沙箱并写报告")
    expect(summary.final).toBe("沙箱正常，越界写入已被拒绝")
    expect(summary.cwd).toBe("/srv/aialra/turn-harness-target")
    expect(summary.model).toBe("deepseek-v4-pro")
    expect(summary.provider).toBe("deepseek")
    expect(summary.permissionProfile).toBe("workspace-write")
    expect(summary.approvalPolicy).toBe("on_request")
    expect(summary.sandboxPolicy).toBe("workspace")
    expect(summary.networkPolicy).toBe("off")
    expect(summary.environment).toBe("local-default")
    expect(summary.effectivePrompt).toBe("aialra-general-engineering-harness-v1 1234567890ab 3 sources")
    expect(summary.tools).toEqual(["bash"])
    expect(summary.files).toEqual(["/srv/aialra/turn-harness-target/report.md"])
    expect(summary.commands).toEqual(["pwd && ls -la"])
    expect(summary.approvals).toEqual(["本对话单轮允许本命令：bash"])
    expect(summary.sandboxDenials).toEqual(["/srv/aialra/outside.txt：workspace_write_denied"])
    expect(summary.rawRefs).toBe(2)
    expect(summary.warnings).toBe(1)
    expect(summary.errors).toBe(1)
    expect(summary.quality).toContain("验证通过")
    expect(summary.quality).toContain("评测层级：integration：integration")
    expect(summary.quality).toContain("评测通过：integration")
    expect(summary.quality).toContain("技能目录：可用 2：禁用 1")
    expect(summary.quality).toContain("技能使用：frontend")
    expect(summary.quality).toContain("多 agent 分配：tester：tester")
    expect(summary.quality).toContain("多 agent 完成：tester：tester")
    expect(summary.quality).toContain("补丁质量 82/100 good")
    expect(summary.quality).toContain("补丁风险")
    expect(summary.quality).toContain("部署门禁阻止：kubectl-write：high")
  })

  test("summarizes requested and effective reasoning effort with fallback reason", () => {
    const summary = buildTurnInspectorSummary([
      event({
        id: "ev_effort",
        type: "model.effort.resolved",
        severity: "warning",
        data: {
          requested_effort: "xhigh",
          effective_effort: "high",
          effort_resolution: {
            version: "aialra.reasoning_effort_resolution.v1",
            requested: "xhigh",
            effective: "high",
            source: "variant",
            supported: ["low", "medium", "high"],
            fallback: {
              applied: true,
              from: "xhigh",
              to: "high",
              reason: "provider does not expose requested effort xhigh",
            },
          },
        },
      }),
    ])

    expect(summary.effort).toBe("xhigh -> high")
    expect(summary.effortRequested).toBe("xhigh")
    expect(summary.effortEffective).toBe("high")
    expect(summary.effortSource).toBe("variant")
    expect(summary.effortFallback).toBe("provider does not expose requested effort xhigh")
    expect(summary.quality).toContain("推理档位降级")
  })

  test("summarizes session handoff degradation for desktop continuation", () => {
    const summary = buildTurnInspectorSummary([
      event({
        id: "ev_handoff",
        type: "session.handoff.prepared",
        severity: "warning",
        status: "degraded",
        data: {
          source: "web",
          target: "desktop",
          unsupported: ["running_process_handoff_degraded"],
        },
        rawRef: { id: "raw_handoff", eventID: "ev_handoff", encrypted: true, persisted: true },
      }),
    ])

    expect(summary.handoff).toBe("web -> desktop degraded")
    expect(summary.handoffIssues).toEqual(["running_process_handoff_degraded"])
    expect(summary.rawRefs).toBe(1)
    expect(summary.quality).toContain("交接降级")
  })
})

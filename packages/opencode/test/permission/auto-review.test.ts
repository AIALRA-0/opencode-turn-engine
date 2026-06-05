import { expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { Bus } from "../../src/bus"
import { Permission } from "../../src/permission"
import { PermissionID } from "../../src/permission/schema"
import { InstanceBootstrap } from "../../src/project/bootstrap-service"
import { InstanceStore } from "../../src/project/instance-store"
import { MessageID, SessionID } from "../../src/session/schema"
import { PublicEventLog } from "../../src/session/public-event"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { testEffect } from "../lib/effect"

const bus = Bus.layer
const noopBootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const env = Layer.mergeAll(
  Permission.layer.pipe(Layer.provide(bus)),
  bus,
  CrossSpawnSpawner.defaultLayer,
  InstanceStore.defaultLayer.pipe(Layer.provide(noopBootstrap)),
)
const it = testEffect(env)

const ask = (input: Parameters<Permission.Interface["ask"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.ask(input)
  })

const reply = (input: Parameters<Permission.Interface["reply"]>[0]) =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.reply(input)
  })

const list = () =>
  Effect.gen(function* () {
    const permission = yield* Permission.Service
    return yield* permission.list()
  })

const waitForPending = (count: number) =>
  Effect.gen(function* () {
    return yield* Effect.gen(function* () {
      while (true) {
        const pending = yield* list()
        if (pending.length === count) return pending
        yield* Effect.sleep("10 millis")
      }
    }).pipe(
      Effect.timeoutOrElse({
        duration: "1 second",
        orElse: () => Effect.fail(new Error(`timed out waiting for ${count} pending permission request(s)`)),
      }),
    )
  })

it.instance("auto review approves low-risk read-only shell commands without interrupting the user", () =>
  Effect.gen(function* () {
    PublicEventLog.clearForTest()
    const sessionID = SessionID.make("ses_auto_review_allow")
    yield* ask({
      id: PermissionID.make("per_auto_review_allow"),
      sessionID,
      turnID: MessageID.make("msg_auto_review_allow"),
      permission: "bash",
      patterns: ["pwd"],
      metadata: {
        exec_approval: {
          schema: "aialra.exec_approval_request.v1",
          command: "pwd",
          cwd: "/srv/aialra/turn-harness-target",
          risk_level: "low",
        },
      },
      always: [],
      approval_reviewer: { role: "auto_review", id: "auto_review", label: "Auto reviewer，自动审批审查器" },
      ruleset: [],
    })

    expect(yield* list()).toHaveLength(0)
    const events = PublicEventLog.list({ sessionID: String(sessionID) })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "auto_review.completed",
          status: "auto_approve",
          data: expect.objectContaining({
            decision: "auto_approve",
            matched_rule: expect.objectContaining({ id: "safe_readonly_shell.v1" }),
            confidence: expect.any(Number),
          }),
        }),
      ]),
    )
    expect(events.some((event) => event.type === "approval.requested")).toBe(false)
  }),
)

it.instance("auto review escalates medium-risk network requests with an explainable result", () =>
  Effect.gen(function* () {
    PublicEventLog.clearForTest()
    const sessionID = SessionID.make("ses_auto_review_escalate")
    const fiber = yield* ask({
      id: PermissionID.make("per_auto_review_escalate"),
      sessionID,
      turnID: MessageID.make("msg_auto_review_escalate"),
      permission: "request_permissions",
      patterns: ["network"],
      metadata: {
        request_permissions: {
          schema: "aialra.request_permissions.v1",
          permissions: ["network"],
          reason: "Need to check an external release URL.",
          requested_network_policy: "on",
          requested_domains: ["example.com"],
        },
      },
      always: [],
      approval_reviewer: { role: "auto_review", id: "auto_review", label: "Auto reviewer，自动审批审查器" },
      ruleset: [],
    }).pipe(Effect.forkScoped)

    const pending = yield* waitForPending(1)
    expect(pending[0]?.metadata.auto_review_result).toEqual(
      expect.objectContaining({
        schema: "aialra.auto_review_result.v1",
        decision: "escalate",
        matched_rule: expect.objectContaining({ id: "guardian.medium_risk" }),
      }),
    )
    expect(PublicEventLog.list({ sessionID: String(sessionID) })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "auto_review.completed",
          status: "escalate",
          data: expect.objectContaining({
            reason: "Guardian 标记为中风险，需要用户确认",
          }),
        }),
        expect.objectContaining({
          type: "approval.requested",
          data: expect.objectContaining({
            auto_review_result: expect.objectContaining({
              decision: "escalate",
            }),
          }),
        }),
      ]),
    )

    yield* reply({ requestID: PermissionID.make("per_auto_review_escalate"), reply: "once" })
    yield* Fiber.join(fiber)
  }),
)

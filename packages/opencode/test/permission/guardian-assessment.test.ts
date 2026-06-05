import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
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

const fail = <A, E, R>(self: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const exit = yield* self.pipe(Effect.exit)
    if (Exit.isFailure(exit)) return Cause.squash(exit.cause)
    throw new Error("expected permission effect to fail")
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

it.instance("guardian hard-blocks destructive exec approval before normal approval", () =>
  Effect.gen(function* () {
    PublicEventLog.clearForTest()
    const sessionID = SessionID.make("ses_guardian_block")
    const error = yield* fail(
      ask({
        id: PermissionID.make("per_guardian_block"),
        sessionID,
        turnID: MessageID.make("msg_guardian_block"),
        permission: "bash",
        patterns: ["rm -rf /"],
        metadata: {
          exec_approval: {
            schema: "aialra.exec_approval_request.v1",
            command: "rm -rf /",
            cwd: "/srv/aialra/turn-harness-target",
            risk_level: "critical",
          },
        },
        always: [],
        ruleset: [],
      }),
    )

    expect(String(error)).toContain("PermissionDeniedError")
    expect(yield* list()).toHaveLength(0)
    expect(PublicEventLog.list({ sessionID: String(sessionID) })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "guardian.assessment.completed",
          severity: "error",
          status: "denied",
          data: expect.objectContaining({
            risk_level: "critical",
            hard_block: true,
            blocked_reasons: expect.arrayContaining(["destructive_command"]),
          }),
        }),
      ]),
    )
    expect(PublicEventLog.list({ sessionID: String(sessionID) }).some((event) => event.type === "approval.requested")).toBe(false)
  }),
)

it.instance("guardian records network risk before the approval remains user-reviewable", () =>
  Effect.gen(function* () {
    PublicEventLog.clearForTest()
    const sessionID = SessionID.make("ses_guardian_network")
    const fiber = yield* ask({
      id: PermissionID.make("per_guardian_network"),
      sessionID,
      turnID: MessageID.make("msg_guardian_network"),
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
      ruleset: [],
    }).pipe(Effect.forkScoped)

    const pending = yield* waitForPending(1)
    expect(pending[0]?.metadata.guardian_assessment).toEqual(
      expect.objectContaining({
        schema: "aialra.guardian_assessment.v1",
        risk_level: "medium",
        suggested_decision: "ask_user",
        hard_block: false,
      }),
    )
    expect(PublicEventLog.list({ sessionID: String(sessionID) })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "guardian.assessment.completed",
          status: "ask_user",
          data: expect.objectContaining({
            policy_findings: expect.arrayContaining([
              expect.objectContaining({
                code: "network_access_requested",
              }),
            ]),
          }),
        }),
        expect.objectContaining({
          type: "approval.requested",
          data: expect.objectContaining({
            guardian_assessment: expect.objectContaining({
              risk_level: "medium",
              suggested_decision: "ask_user",
            }),
          }),
        }),
      ]),
    )

    yield* reply({ requestID: PermissionID.make("per_guardian_network"), reply: "once" })
    yield* Fiber.join(fiber)
  }),
)

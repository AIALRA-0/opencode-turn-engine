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

const reviewer = { role: "user", id: "current_user", label: "User，当前用户" }

it.instance("reviewer override keeps local requests on the session default reviewer", () =>
  Effect.gen(function* () {
    PublicEventLog.clearForTest()
    const sessionID = SessionID.make("ses_reviewer_local")
    const requestID = PermissionID.make("per_reviewer_local")
    const fiber = yield* ask({
      id: requestID,
      sessionID,
      turnID: MessageID.make("msg_reviewer_local"),
      permission: "bash",
      patterns: ["pwd"],
      metadata: {
        exec_approval: { schema: "aialra.exec_approval_request.v1", command: "pwd", environment_id: "default" },
      },
      always: [],
      approval_reviewer: reviewer,
      ruleset: [],
    }).pipe(Effect.forkScoped)

    const pending = yield* waitForPending(1)
    expect(pending[0]?.approval_reviewer).toEqual(expect.objectContaining({ role: "user" }))
    expect(pending[0]?.metadata.reviewer_resolution).toEqual(
      expect.objectContaining({
        matched_source: "session_default",
        selected_reviewer: expect.objectContaining({ role: "user" }),
      }),
    )
    expect(PublicEventLog.list({ sessionID: String(sessionID) })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reviewer.resolved",
          status: "session_default",
        }),
      ]),
    )

    yield* reply({ requestID, reply: "once" })
    yield* Fiber.join(fiber)
  }),
)

it.instance("reviewer override requires policy engine for enterprise environments", () =>
  Effect.gen(function* () {
    PublicEventLog.clearForTest()
    const sessionID = SessionID.make("ses_reviewer_enterprise")
    const requestID = PermissionID.make("per_reviewer_enterprise")
    const fiber = yield* ask({
      id: requestID,
      sessionID,
      turnID: MessageID.make("msg_reviewer_enterprise"),
      permission: "bash",
      patterns: ["pwd"],
      metadata: {
        exec_approval: { schema: "aialra.exec_approval_request.v1", command: "pwd", environment_id: "enterprise" },
      },
      always: [],
      approval_reviewer: reviewer,
      ruleset: [],
    }).pipe(Effect.forkScoped)

    const pending = yield* waitForPending(1)
    expect(pending[0]?.approval_reviewer).toEqual(expect.objectContaining({ role: "policy_engine" }))
    expect(PublicEventLog.list({ sessionID: String(sessionID) })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reviewer.resolved",
          status: "environment_override",
          data: expect.objectContaining({
            selected_reviewer: expect.objectContaining({ role: "policy_engine" }),
          }),
        }),
        expect.objectContaining({
          type: "approval.requested",
          data: expect.objectContaining({
            approval_reviewer: expect.objectContaining({ role: "policy_engine" }),
            reviewer_resolution: expect.objectContaining({ matched_source: "environment_override" }),
          }),
        }),
      ]),
    )

    yield* reply({ requestID, reply: "once", reviewed_by: { role: "policy_engine", id: "policy_engine", label: "Policy engine，策略引擎审查器" } })
    yield* Fiber.join(fiber)
  }),
)

it.instance("reviewer override applies connector and per-request precedence", () =>
  Effect.gen(function* () {
    PublicEventLog.clearForTest()
    const sessionID = SessionID.make("ses_reviewer_precedence")
    const connectorRequest = PermissionID.make("per_reviewer_connector")
    const connectorFiber = yield* ask({
      id: connectorRequest,
      sessionID,
      turnID: MessageID.make("msg_reviewer_connector"),
      permission: "bash",
      patterns: ["pwd"],
      metadata: {
        connector: { type: "external_mcp", id: "mcp_enterprise" },
        exec_approval: { schema: "aialra.exec_approval_request.v1", command: "pwd" },
      },
      always: [],
      approval_reviewer: reviewer,
      ruleset: [],
    }).pipe(Effect.forkScoped)

    const connectorPending = yield* waitForPending(1)
    expect(connectorPending[0]?.approval_reviewer).toEqual(expect.objectContaining({ role: "external_reviewer" }))
    yield* reply({
      requestID: connectorRequest,
      reply: "once",
      reviewed_by: { role: "external_reviewer", id: "external_reviewer", label: "External reviewer，外部审批审查器" },
    })
    yield* Fiber.join(connectorFiber)

    const perRequest = PermissionID.make("per_reviewer_per_request")
    const perRequestFiber = yield* ask({
      id: perRequest,
      sessionID,
      turnID: MessageID.make("msg_reviewer_per_request"),
      permission: "bash",
      patterns: ["pwd"],
      metadata: {
        per_request_reviewer: { reviewer: "guardian" },
        environment_override: { reviewer: "policy_engine" },
        exec_approval: { schema: "aialra.exec_approval_request.v1", command: "pwd" },
      },
      always: [],
      approval_reviewer: reviewer,
      ruleset: [],
    }).pipe(Effect.forkScoped)

    const perRequestPending = yield* waitForPending(1)
    expect(perRequestPending[0]?.approval_reviewer).toEqual(expect.objectContaining({ role: "guardian" }))
    expect(perRequestPending[0]?.metadata.reviewer_resolution).toEqual(
      expect.objectContaining({
        matched_source: "per_request",
        selected_reviewer: expect.objectContaining({ role: "guardian" }),
      }),
    )
    yield* reply({
      requestID: perRequest,
      reply: "once",
      reviewed_by: { role: "guardian", id: "guardian", label: "Guardian，安全守护审查器" },
    })
    yield* Fiber.join(perRequestFiber)
  }),
)

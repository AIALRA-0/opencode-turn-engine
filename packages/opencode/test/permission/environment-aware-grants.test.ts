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

function execMetadata(command: string, environmentID: string) {
  return {
    exec_approval: {
      schema: "aialra.exec_approval_request.v1",
      command,
      environment_id: environmentID,
      cwd: "/srv/aialra/turn-harness-target",
    },
  }
}

it.instance("environment-aware grants do not leak from local to remote environments", () =>
  Effect.gen(function* () {
    PublicEventLog.clearForTest()
    const sessionID = SessionID.make("ses_environment_grant")
    const first = PermissionID.make("per_environment_default")
    const command = "npm test"
    const firstFiber = yield* ask({
      id: first,
      sessionID,
      turnID: MessageID.make("msg_environment_default"),
      permission: "bash",
      patterns: [command],
      metadata: execMetadata(command, "default"),
      always: [command],
      approval_reviewer: reviewer,
      ruleset: [],
    }).pipe(Effect.forkScoped)

    yield* waitForPending(1)
    yield* reply({ requestID: first, reply: "always" })
    yield* Fiber.join(firstFiber)

    expect(PublicEventLog.list({ sessionID: String(sessionID) })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "permission.grant.created",
          status: "always-command",
          data: expect.objectContaining({
            environment_id: "default",
            permission: "bash",
            patterns: [command],
            expires_at: "session_environment_scope",
          }),
        }),
      ]),
    )

    yield* ask({
      sessionID,
      turnID: MessageID.make("msg_environment_default_reuse"),
      permission: "bash",
      patterns: [command],
      metadata: execMetadata(command, "default"),
      always: [],
      approval_reviewer: reviewer,
      ruleset: [],
    })
    expect(yield* list()).toHaveLength(0)

    const remote = PermissionID.make("per_environment_remote")
    const remoteFiber = yield* ask({
      id: remote,
      sessionID,
      turnID: MessageID.make("msg_environment_remote"),
      permission: "bash",
      patterns: [command],
      metadata: execMetadata(command, "remote"),
      always: [],
      approval_reviewer: reviewer,
      ruleset: [],
    }).pipe(Effect.forkScoped)

    const pending = yield* waitForPending(1)
    expect(pending[0]?.environment_id).toBe("remote")
    expect(pending[0]?.approval_reviewer).toEqual(expect.objectContaining({ role: "guardian" }))
    yield* reply({ requestID: remote, reply: "reject" })
    yield* Fiber.await(remoteFiber)
  }),
)

it.instance("legacy approvals without environment metadata keep backward-compatible global behavior", () =>
  Effect.gen(function* () {
    PublicEventLog.clearForTest()
    const first = PermissionID.make("per_environment_legacy")
    const fiber = yield* ask({
      id: first,
      sessionID: SessionID.make("ses_environment_legacy_a"),
      permission: "bash",
      patterns: ["ls"],
      metadata: {},
      always: ["ls"],
      ruleset: [],
    }).pipe(Effect.forkScoped)

    yield* waitForPending(1)
    yield* reply({ requestID: first, reply: "always" })
    yield* Fiber.join(fiber)

    expect(
      yield* ask({
        sessionID: SessionID.make("ses_environment_legacy_b"),
        permission: "bash",
        patterns: ["ls"],
        metadata: {},
        always: [],
        ruleset: [],
      }),
    ).toBeUndefined()
  }),
)

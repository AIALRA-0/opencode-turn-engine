import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { Session } from "../../src/session/session"
import { PublicEventLog } from "../../src/session/public-event"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"

const it = testEffect(Layer.mergeAll(Session.defaultLayer, CrossSpawnSpawner.defaultLayer))

describe("session.configured event", () => {
  it.live(
    "records the effective session configuration when a session is created",
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        PublicEventLog.clearForTest()
        const session = yield* Session.Service
        const info = yield* session.create({})
        const events = PublicEventLog.list({ sessionID: info.id })

        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "session.configured",
              status: "configured",
              sessionID: info.id,
              data: expect.objectContaining({
                cwd: dir,
                permissionProfileID: ":workspace",
                approvalPolicy: "on-request",
                networkPolicy: "ask",
                networkSandboxPolicy: expect.objectContaining({
                  version: "aialra.network_sandbox_policy.v1",
                  mode: "ask",
                  ask_before_access: true,
                  private_ip_policy: "block",
                }),
                networkProxy: expect.objectContaining({
                  version: "aialra.network_proxy.v1",
                  enabled: false,
                  required: false,
                  enforcement: "disabled",
                }),
                platformSandbox: expect.objectContaining({
                  version: "aialra.platform_sandbox_capability.v1",
                  target_platform: process.platform,
                  supported: process.platform === "linux",
                }),
                executorBackend: expect.any(String),
                effectivePermissionProfile: expect.objectContaining({
                  version: "aialra.effective_permission_profile.v1",
                  active_permission_profile: expect.objectContaining({ id: ":workspace", kind: "workspace" }),
                  sandbox_policy: expect.objectContaining({ type: "workspace-write" }),
                  network_policy: "ask",
                  command_policy: "ask",
                  network_sandbox_policy: expect.objectContaining({
                    version: "aialra.network_sandbox_policy.v1",
                    mode: "ask",
                  }),
                  network_proxy: expect.objectContaining({
                    version: "aialra.network_proxy.v1",
                    enforcement: "disabled",
                  }),
                  file_system_policy: expect.objectContaining({
                    version: "aialra.file_system_sandbox_policy.v1",
                    selected_environment_id: "default",
                    writable_roots: expect.arrayContaining([dir]),
                  }),
                  platform_sandbox: expect.objectContaining({
                    version: "aialra.platform_sandbox_capability.v1",
                  }),
                }),
                fileSystemPolicy: expect.objectContaining({
                  version: "aialra.file_system_sandbox_policy.v1",
                  cwd: dir,
                  protected_paths: expect.arrayContaining([`${dir}/.git`, `${dir}/.agents`, `${dir}/.codex`]),
                }),
                toolRegistry: "resolved per agent and turn at prompt runtime",
                skillCatalog: "resolved per agent and turn at prompt runtime",
              }),
            }),
          ]),
        )
      }),
    ),
  )
})

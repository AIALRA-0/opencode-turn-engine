import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Cause, Effect, Exit, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import type { Permission } from "../../src/permission"
import type { Tool } from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { CodexTurn } from "../../src/session/turn-context"
import { PublicEventLog } from "../../src/session/public-event"
import { SessionSecurity } from "../../src/session/security"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, CrossSpawnSpawner.defaultLayer))

afterEach(async () => {
  SessionSecurity.clearForTest()
  PublicEventLog.clearForTest()
  await disposeAllInstances()
})

function turn(cwd: string, sessionID = SessionID.make("ses_request_permissions")) {
  const messageID = MessageID.make("msg_request_permissions")
  return CodexTurn.fromFrame({
    frame: {
      version: "aialra.turn_frame.v1",
      turnID: messageID,
      route: "prompt",
      sessionID,
      messageID,
      agent: "build",
      model: { providerID: "test", modelID: "test" },
      noReply: false,
      format: "text",
      input: {
        partCount: 0,
        textParts: 0,
        textChars: 0,
        fileParts: 0,
        agentParts: 0,
        subtaskParts: 0,
        syntheticParts: 0,
      },
      explicit: { files: [], agents: [], references: [] },
      tools: ["request_permissions"],
      timing: { receivedAt: Date.now(), framedAt: Date.now() },
    },
    parts: [],
    cwd,
    retry: CodexTurn.retryConfig({}),
    startedAt: Date.now(),
    activePermissionProfile: { id: ":workspace" },
    approvalPolicy: "on-request",
    networkPolicy: "ask",
    commandPolicy: "ask",
    selectedEnvironmentID: "default",
  })
}

const ctx = (
  cwd: string,
  ask: Tool.Context["ask"],
  sessionID = SessionID.make("ses_request_permissions"),
): Tool.Context => ({
  sessionID,
  messageID: MessageID.make("msg_request_permissions"),
  callID: "call_request_permissions",
  agent: "build",
  abort: AbortSignal.any([]),
  turn: turn(cwd, sessionID),
  messages: [],
  metadata: () => Effect.void,
  ask,
})

describe("tool.request_permissions", () => {
  it.instance("requests approval, applies supported settings, and records public events", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const tool = (yield* registry.all()).find((item) => item.id === "request_permissions")
        if (!tool) throw new Error("request_permissions tool not found")

        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const sessionID = SessionID.make("ses_request_permissions_apply")
        const result = yield* tool.execute(
          {
            permissions: ["network", "exec"],
            reason: "Need one network probe and unrestricted command execution for this turn.",
            scope: "session",
            requested_permission_profile: "full-access",
            requested_network_policy: "on",
            requested_command_policy: "all",
            requested_executor_backend: "node-bun",
            requested_domains: ["Example.COM"],
          },
          ctx(
            dir,
            (request) =>
              Effect.sync(() => {
                requests.push(request)
              }),
            sessionID,
          ),
        )

        expect(result.metadata.status).toBe("approved")
        expect(requests).toHaveLength(1)
        expect(requests[0]?.permission).toBe("request_permissions")
        expect(requests[0]?.patterns).toEqual(["network", "exec"])
        expect(requests[0]?.metadata).toEqual(
          expect.objectContaining({
            request_permissions: expect.objectContaining({
              schema: "aialra.request_permissions.v1",
              requested_network_policy: "on",
              requested_command_policy: "all",
              requested_executor_backend: "node-bun",
              requested_domains: ["Example.COM"],
            }),
            appliedPatch: expect.objectContaining({
              permissionProfileID: ":danger-full-access",
              networkPolicy: "on",
              commandPolicy: "all",
              executorBackend: "node-bun",
              networkPermissions: { allowlist: ["Example.COM"] },
            }),
            unsupported: [],
          }),
        )

        const security = SessionSecurity.get({ sessionID: String(sessionID), cwd: dir })
        expect(security.permissionProfileID).toBe(":danger-full-access")
        expect(security.networkPolicy).toBe("on")
        expect(security.commandPolicy).toBe("all")
        expect(security.executorBackend).toBe("node-bun")
        expect(security.networkPermissions).toEqual(
          expect.objectContaining({
            allowlist: ["example.com"],
          }),
        )

        expect(PublicEventLog.list({ sessionID: String(sessionID) })).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "request_permissions.requested",
              status: "requested",
              data: expect.objectContaining({
                reason: "Need one network probe and unrestricted command execution for this turn.",
              }),
            }),
            expect.objectContaining({
              type: "request_permissions.resolved",
              status: "approved",
              data: expect.objectContaining({
                applied_patch: expect.objectContaining({
                  permissionProfileID: ":danger-full-access",
                }),
              }),
            }),
            expect.objectContaining({
              type: "sandbox.control.changed",
            }),
          ]),
        )
      }),
    ),
  )

  it.instance("records unsupported advisory fields instead of pretending they were applied", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const tool = (yield* registry.all()).find((item) => item.id === "request_permissions")
        if (!tool) throw new Error("request_permissions tool not found")

        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const sessionID = SessionID.make("ses_request_permissions_advisory")
        const result = yield* tool.execute(
          {
            permissions: ["file_write", "service_tier", "long_running_process", "provider_tool"],
            reason: "Need a larger write scope and provider-side web tool for a deployment check.",
            scope: "next_turn",
            requested_paths: ["/srv/aialra/external"],
            requested_service_tier: "priority",
            requested_long_running_process: true,
            requested_provider_tools: ["web_search"],
            requested_executor_backend: "auto",
          },
          ctx(
            dir,
            (request) =>
              Effect.sync(() => {
                requests.push(request)
              }),
            sessionID,
          ),
        )

        expect(result.metadata.status).toBe("approved")
        expect(result.metadata.appliedPatch).toEqual({})
        expect(result.metadata.unsupported).toEqual(
          expect.arrayContaining([
            "requested_paths require custom writable root policy in a later requirement",
            "requested_service_tier is advisory until service tier override policy is wired",
            "requested_long_running_process maps to Engineering Controls in a later requirement",
            "requested_provider_tools require dynamic provider tool policy in a later requirement",
            "requested_executor_backend=auto is advisory; choose codex or node-bun to apply directly",
          ]),
        )
        expect(requests[0]?.metadata).toEqual(
          expect.objectContaining({
            appliedPatch: {},
            unsupported: result.metadata.unsupported,
          }),
        )

        expect(PublicEventLog.list({ sessionID: String(sessionID) })).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "request_permissions.resolved",
              severity: "warning",
              status: "approved",
              data: expect.objectContaining({
                unsupported: result.metadata.unsupported,
              }),
            }),
          ]),
        )
      }),
    ),
  )

  it.instance("does not apply security settings when approval is denied", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const registry = yield* ToolRegistry.Service
        const tool = (yield* registry.all()).find((item) => item.id === "request_permissions")
        if (!tool) throw new Error("request_permissions tool not found")

        const sessionID = SessionID.make("ses_request_permissions_denied")
        const exit = yield* tool
          .execute(
            {
              permissions: ["network"],
              reason: "Try to enable network.",
              scope: "session",
              requested_network_policy: "on",
            },
            ctx(
              dir,
              () => Effect.die(new Error("user denied permission escalation")),
              sessionID,
            ),
          )
          .pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          expect(String(Cause.squash(exit.cause))).toContain("permission request denied")
        }
        expect(SessionSecurity.get({ sessionID: String(sessionID), cwd: dir }).networkPolicy).toBe("ask")
        expect(PublicEventLog.list({ sessionID: String(sessionID) })).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "request_permissions.resolved",
              severity: "error",
              status: "denied",
              data: expect.objectContaining({
                final_decision: { status: "denied" },
                applied_patch: {},
              }),
            }),
          ]),
        )
      }),
    ),
  )
})

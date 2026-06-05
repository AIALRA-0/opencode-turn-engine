import { describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { WebFetchTool } from "../../src/tool/webfetch"
import { SessionID, MessageID } from "../../src/session/schema"
import { Tool } from "@/tool/tool"
import { testEffect } from "../lib/effect"
import { CodexTurn, type TurnContext } from "../../src/session/turn-context"

const it = testEffect(Layer.mergeAll(FetchHttpClient.layer, Truncate.defaultLayer, Agent.defaultLayer))

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const withFetch = <A, E, R>(
  fetch: (req: Request) => Response | Promise<Response>,
  fn: (url: URL) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => Bun.serve({ port: 0, fetch })),
    (server) => fn(server.url),
    (server) => Effect.sync(() => server.stop(true)),
  )

const exec = Effect.fn("WebFetchToolTest.exec")(function* (
  args: Tool.InferParameters<typeof WebFetchTool>,
  inputCtx: Tool.Context = ctx,
) {
  const info = yield* WebFetchTool
  const tool = yield* info.init()
  return yield* tool.execute(args, inputCtx)
})

function turn(
  cwd: string,
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
  const sessionID = SessionID.make("ses_webfetch")
  const messageID = MessageID.make("msg_webfetch")
  return {
    version: "aialra.user_turn.v1",
    turnID: messageID,
    sessionID,
    messageID,
    startedAt: Date.now(),
    items: [],
    input_items: [],
    input_schema: {
      codex: "Op::UserInput",
      supported_items: ["text", "image", "local_image", "file", "skill", "mention", "subtask"],
    },
    cwd,
    approval_policy: "never",
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
      approvalPolicy: "never",
      modelSupportsTools: true,
      selectedEnvironmentID: "default",
    }),
    skill_catalog: CodexTurn.defaultSkillCatalog({
      skills: [],
      agent: "build",
      cwd,
      activePermissionProfile: { id: ":workspace" },
      approvalPolicy: "never",
      selectedEnvironmentID: "default",
    }),
    collaboration_mode: { kind: "default" },
    environments: [{ environmentID: "default", cwd }],
    selected_environment_id: "default",
    network_permissions: CodexTurn.defaultNetworkPermissions("ask"),
    shell_environment_policy: CodexTurn.defaultShellEnvironmentPolicy(),
    security_constraints: CodexTurn.defaultSecurityConstraints(cwd),
    route: "prompt",
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

describe("tool.webfetch", () => {
  it.instance("returns image responses as file attachments", () =>
    Effect.gen(function* () {
      const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
      yield* withFetch(
        () => new Response(bytes, { status: 200, headers: { "content-type": "IMAGE/PNG; charset=binary" } }),
        (url) =>
          Effect.gen(function* () {
            const result = yield* exec({ url: new URL("/image.png", url).toString(), format: "markdown" })
            expect(result.output).toBe("Image fetched successfully")
            expect(result.attachments).toBeDefined()
            expect(result.attachments?.length).toBe(1)
            expect(result.attachments?.[0].type).toBe("file")
            expect(result.attachments?.[0].mime).toBe("image/png")
            expect(result.attachments?.[0].url.startsWith("data:image/png;base64,")).toBe(true)
            expect(result.attachments?.[0]).not.toHaveProperty("id")
            expect(result.attachments?.[0]).not.toHaveProperty("sessionID")
            expect(result.attachments?.[0]).not.toHaveProperty("messageID")
          }),
      )
    }),
  )

  it.instance("keeps svg as text output", () =>
    withFetch(
      () =>
        new Response('<svg xmlns="http://www.w3.org/2000/svg"><text>hello</text></svg>', {
          status: 200,
          headers: { "content-type": "image/svg+xml; charset=UTF-8" },
        }),
      (url) =>
        Effect.gen(function* () {
          const result = yield* exec({ url: new URL("/image.svg", url).toString(), format: "html" })
          expect(result.output).toContain("<svg")
          expect(result.attachments).toBeUndefined()
        }),
    ),
  )

  it.instance("keeps text responses as text output", () =>
    withFetch(
      () =>
        new Response("hello from webfetch", {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
      (url) =>
        Effect.gen(function* () {
          const result = yield* exec({ url: new URL("/file.txt", url).toString(), format: "text" })
          expect(result.output).toBe("hello from webfetch")
          expect(result.attachments).toBeUndefined()
        }),
    ),
  )

  it.instance("extracts text from html without scripts or styles", () =>
    withFetch(
      () =>
        new Response(
          "<html><head><style>.hidden{}</style><script>alert('x')</script></head><body>Hello <b>world</b></body></html>",
          {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          },
        ),
      (url) =>
        Effect.gen(function* () {
          const result = yield* exec({ url: new URL("/page.html", url).toString(), format: "text" })
          expect(result.output).toBe("Hello world")
          expect(result.attachments).toBeUndefined()
        }),
    ),
  )

  it.instance("denies webfetch when the active turn network policy is off", () =>
    Effect.gen(function* () {
      const active = turn(process.cwd(), {
        network_policy: "off",
        network_permissions: CodexTurn.defaultNetworkPermissions("off"),
      })
      const exit = yield* Effect.exit(exec({ url: "https://example.com", format: "text" }, { ...ctx, turn: active }))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("当前网络 mode=off")
    }),
  )

  it.instance("asks for network permission when the active turn network policy is ask", () =>
    withFetch(
      () => new Response("network allowed", { status: 200, headers: { "content-type": "text/plain" } }),
      (url) =>
        Effect.gen(function* () {
          const requests: Array<{ permission: string; patterns: readonly string[]; metadata: Record<string, unknown> }> = []
          const constraints = CodexTurn.defaultSecurityConstraints(process.cwd())
          const active = turn(process.cwd(), {
            network_policy: "ask",
            network_permissions: {
              ...CodexTurn.defaultNetworkPermissions("ask"),
              private_network: "allow",
            },
            security_constraints: {
              ...constraints,
              network: constraints.network.filter((rule) => rule.target !== "loopback"),
            },
          })
          const target = new URL("/network.txt", url).toString()
          const result = yield* exec(
            { url: target, format: "text" },
            {
              ...ctx,
              turn: active,
              ask: (request) =>
                Effect.sync(() => {
                  requests.push({
                    permission: request.permission,
                    patterns: request.patterns,
                    metadata: request.metadata,
                  })
                }),
            },
          )

          expect(result.output).toBe("network allowed")
          expect(requests.some((request) => request.permission === "network" && request.patterns.includes(target))).toBe(true)
        }),
    ),
  )

  it.instance("denies webfetch targets outside the active network allowlist", () =>
    Effect.gen(function* () {
      const constraints = CodexTurn.defaultSecurityConstraints(process.cwd())
      const active = turn(process.cwd(), {
        network_policy: "on",
        network_permissions: {
          ...CodexTurn.defaultNetworkPermissions("on"),
          allowlist: ["github.com", "pypi.org"],
        },
        security_constraints: {
          ...constraints,
          network: constraints.network.filter((rule) => rule.target !== "unknown-domain"),
        },
      })
      const exit = yield* Effect.exit(exec({ url: "https://example.com", format: "text" }, { ...ctx, turn: active }))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("不在网络 allowlist")
    }),
  )

  it.instance("honors webfetch denylist before making the request", () =>
    Effect.gen(function* () {
      const constraints = CodexTurn.defaultSecurityConstraints(process.cwd())
      const active = turn(process.cwd(), {
        network_policy: "on",
        network_permissions: {
          ...CodexTurn.defaultNetworkPermissions("on"),
          denylist: ["example.com"],
        },
        security_constraints: {
          ...constraints,
          network: constraints.network.filter((rule) => rule.target !== "unknown-domain"),
        },
      })
      const exit = yield* Effect.exit(exec({ url: "https://example.com", format: "text" }, { ...ctx, turn: active }))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("命中网络 denylist")
    }),
  )
})

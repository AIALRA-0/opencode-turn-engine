import { expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { CodexExecServer } from "../../src/tool/codex-exec-server"
import { CodexTurn, type TurnContext } from "../../src/session/turn-context"
import { MessageID, SessionID } from "../../src/session/schema"
import type { Context as ToolContext } from "../../src/tool/tool"

const runIfCodex =
  (Bun.which("codex") || process.env.AIALRA_CODEX_EXEC_SERVER_BIN || process.env.AIALRA_CODEX_EXEC_SERVER_URL) &&
  process.env.AIALRA_RUN_CODEX_EXEC_SERVER_TEST === "1"
    ? test
    : test.skip

test("Codex exec-server adapter normalizes environment values", () => {
  expect(CodexExecServer.jsonEnv({ A: "1", B: undefined })).toEqual({ A: "1" })
})

runIfCodex("Codex exec-server adapter runs a managed process", async () => {
  let output = ""
  const result = await CodexExecServer.runProcess({
    argv: ["/bin/sh", "-c", "printf exec-ok"],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    timeoutMs: 10_000,
    onOutput(chunk) {
      output += chunk.text
    },
  })

  expect(result.timedOut).toBe(false)
  expect(result.exitCode).toBe(0)
  expect(output).toBe("exec-ok")
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
  const sessionID = SessionID.make("ses_codex_exec_server")
  const messageID = MessageID.make("msg_codex_exec_server")
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

function ctx(activeTurn: TurnContext): ToolContext {
  return {
    sessionID: activeTurn.sessionID,
    messageID: activeTurn.messageID,
    callID: "call_codex_exec_server",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    turn: activeTurn,
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

runIfCodex("Codex exec-server FS API reads and writes inside the turn workspace", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "aialra-codex-fs-"))
  try {
    const active = turn(cwd)
    const file = path.join(cwd, "inside.txt")
    await CodexExecServer.writeFile({ path: file, data: "fs-ok", ctx: ctx(active) })
    const metadata = await CodexExecServer.getMetadata({ path: file, ctx: ctx(active) })
    expect(metadata.isFile).toBe(true)
    const bytes = await CodexExecServer.readFile({ path: file, ctx: ctx(active) })
    expect(bytes.toString("utf8")).toBe("fs-ok")
    await CodexExecServer.copy({ from: file, to: path.join(cwd, "copied.txt"), ctx: ctx(active) })
    const copied = await CodexExecServer.readFile({ path: path.join(cwd, "copied.txt"), ctx: ctx(active) })
    expect(copied.toString("utf8")).toBe("fs-ok")
    const listed = await CodexExecServer.readDirectory({ path: cwd, ctx: ctx(active) })
    expect(listed.entries.some((entry) => entry.fileName === "inside.txt" && entry.isFile)).toBe(true)
    expect(listed.entries.some((entry) => entry.fileName === "copied.txt" && entry.isFile)).toBe(true)
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
  }
})

runIfCodex("Codex exec-server HTTP API performs a buffered request", async () => {
  const server = Bun.serve({
    port: 0,
    fetch: async (request) =>
      new Response(`method=${request.method};body=${await request.text()}`, {
        status: 201,
        headers: { "x-aialra-http": "ok" },
      }),
  })
  try {
    const response = await CodexExecServer.httpRequest({
      url: new URL("/exec-http", server.url).toString(),
      method: "POST",
      headers: { "x-aialra-test": "http" },
      body: "hello",
      ctx: ctx(turn(process.cwd(), { network_policy: "on" })),
    })
    expect(response.status).toBe(201)
    expect(response.headers.some((header) => header.name.toLowerCase() === "x-aialra-http" && header.value === "ok")).toBe(true)
    expect(Buffer.from(response.bodyBase64, "base64").toString("utf8")).toBe("method=POST;body=hello")
  } finally {
    server.stop(true)
  }
})

runIfCodex("Codex exec-server FS API rejects workspace escapes and protected metadata writes", async () => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "aialra-codex-fs-"))
  const outside = path.join(process.cwd(), `.aialra-codex-fs-outside-${Date.now()}.txt`)
  try {
    const active = turn(cwd)
    await expect(CodexExecServer.writeFile({ path: outside, data: "blocked", ctx: ctx(active) })).rejects.toThrow()
    await fs.mkdir(path.join(cwd, ".git"), { recursive: true })
    await expect(
      CodexExecServer.writeFile({ path: path.join(cwd, ".git", "config"), data: "blocked", ctx: ctx(active) }),
    ).rejects.toThrow()
  } finally {
    await fs.rm(cwd, { recursive: true, force: true })
    await fs.rm(outside, { force: true })
  }
})

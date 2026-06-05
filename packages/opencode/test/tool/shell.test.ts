import { afterAll, afterEach, beforeAll, describe, expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import type * as Scope from "effect/Scope"
import os from "os"
import path from "path"
import { Config } from "@/config/config"
import { Shell } from "../../src/shell/shell"
import { ShellTool } from "../../src/tool/shell"
import { WriteStdinTool } from "../../src/tool/write_stdin"
import { AwaitProcessTool } from "../../src/tool/await_process"
import { CleanupProcessesTool } from "../../src/tool/cleanup_processes"
import { Filesystem } from "@/util/filesystem"
import { provideInstance, tmpdirScoped } from "../fixture/fixture"
import type { Permission } from "../../src/permission"
import { Agent } from "../../src/agent/agent"
import { Truncate } from "@/tool/truncate"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Plugin } from "../../src/plugin"
import { testEffect } from "../lib/effect"
import { Tool } from "@/tool/tool"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { CodexTurn, type TurnContext } from "../../src/session/turn-context"
import { ExecProcessRegistry } from "../../src/session/exec-process-registry"
import { PublicEventLog } from "../../src/session/public-event"
import { ExecCommandEnd } from "../../src/session/exec-command-end"
import { EngineeringHarness } from "../../src/session/engineering"

const shellLayer = Layer.mergeAll(
  CrossSpawnSpawner.defaultLayer,
  AppFileSystem.defaultLayer,
  Plugin.defaultLayer,
  Truncate.defaultLayer,
  Config.defaultLayer,
  Agent.defaultLayer,
  RuntimeFlags.defaultLayer,
)
const it = testEffect(shellLayer)
type ShellTestServices =
  | (typeof shellLayer extends Layer.Layer<infer ROut, infer _E, infer _RIn> ? ROut : never)
  | Scope.Scope

const initShell = Effect.fn("ShellToolTest.init")(function* () {
  const info = yield* ShellTool
  return yield* info.init()
})

const initBash = initShell
const initWriteStdin = Effect.fn("ShellToolTest.initWriteStdin")(function* () {
  const info = yield* WriteStdinTool
  return yield* info.init()
})
const initAwaitProcess = Effect.fn("ShellToolTest.initAwaitProcess")(function* () {
  const info = yield* AwaitProcessTool
  return yield* info.init()
})
const initCleanupProcesses = Effect.fn("ShellToolTest.initCleanupProcesses")(function* () {
  const info = yield* CleanupProcessesTool
  return yield* info.init()
})

const run = Effect.fn("ShellToolTest.run")(function* (
  args: Tool.InferParameters<typeof ShellTool>,
  next: Tool.Context = ctx,
) {
  const bash = yield* initShell()
  return yield* bash.execute(args, next)
})

const runIn = <A, E, R>(directory: string, self: Effect.Effect<A, E, R>) => self.pipe(provideInstance(directory))

const fail = Effect.fn("ShellToolTest.fail")(function* (
  args: Tool.InferParameters<typeof ShellTool>,
  next: Tool.Context = ctx,
) {
  const exit = yield* run(args, next).pipe(Effect.exit)
  if (Exit.isFailure(exit)) {
    const err = Cause.squash(exit.cause)
    return err instanceof Error ? err : new Error(String(err))
  }
  throw new Error("expected command to fail")
})

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

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
  return {
    version: "aialra.user_turn.v1",
    turnID: MessageID.make("msg_turn_shell"),
    startedAt: Date.now(),
    items: [],
    input_items: [],
    input_schema: {
      codex: "Op::UserInput",
      supported_items: ["text", "image", "local_image", "file", "skill", "mention", "subtask"],
    },
    cwd,
    approval_policy: "on-request",
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
      approvalPolicy: "on-request",
      modelSupportsTools: true,
      selectedEnvironmentID: "default",
    }),
    skill_catalog: CodexTurn.defaultSkillCatalog({
      skills: [],
      agent: "build",
      cwd,
      activePermissionProfile: { id: ":workspace" },
      approvalPolicy: "on-request",
      selectedEnvironmentID: "default",
    }),
    collaboration_mode: { kind: "default" },
    environments: [{ environmentID: "default", cwd }],
    selected_environment_id: "default",
    network_policy: "off",
    network_permissions: CodexTurn.defaultNetworkPermissions("off"),
    shell_environment_policy: CodexTurn.defaultShellEnvironmentPolicy(),
    command_policy: "workspace",
    security_constraints: CodexTurn.defaultSecurityConstraints(cwd),
    route: "prompt",
    sessionID: SessionID.make("ses_shell_turn"),
    messageID: MessageID.make("msg_turn_shell"),
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

Shell.acceptable.reset()
const previousExecBackend = process.env.AIALRA_EXEC_BACKEND
beforeAll(() => {
  process.env.AIALRA_EXEC_BACKEND = "node-bun"
})
afterAll(() => {
  if (previousExecBackend === undefined) delete process.env.AIALRA_EXEC_BACKEND
  else process.env.AIALRA_EXEC_BACKEND = previousExecBackend
})
afterEach(() => {
  ExecCommandEnd.clearForTest()
  PublicEventLog.clearForTest()
})
const quote = (text: string) => `"${text}"`
const squote = (text: string) => `'${text}'`
const projectRoot = path.join(__dirname, "../..")
const bin = quote(process.execPath.replaceAll("\\", "/"))
const bash = (() => {
  const shell = Shell.acceptable()
  if (Shell.name(shell) === "bash") return shell
  return Shell.gitbash()
})()
const shells = (() => {
  if (process.platform !== "win32") {
    const shell = Shell.acceptable()
    return [{ label: Shell.name(shell), shell }]
  }

  const list = [bash, Bun.which("pwsh"), Bun.which("powershell"), process.env.COMSPEC || Bun.which("cmd.exe")]
    .filter((shell): shell is string => Boolean(shell))
    .map((shell) => ({ label: Shell.name(shell), shell }))

  return list.filter(
    (item, i) => list.findIndex((other) => other.shell.toLowerCase() === item.shell.toLowerCase()) === i,
  )
})()
const PS = new Set(["pwsh", "powershell"])
const ps = shells.filter((item) => PS.has(item.label))
const cmdShell = shells.find((item) => item.label === "cmd")

const sh = () => Shell.name(Shell.acceptable())
const evalarg = (text: string) => (sh() === "cmd" ? quote(text) : squote(text))

const fill = (mode: "lines" | "bytes", n: number) => {
  const code =
    mode === "lines"
      ? "console.log(Array.from({length:Number(Bun.argv[1])},(_,i)=>i+1).join(String.fromCharCode(10)))"
      : "process.stdout.write(String.fromCharCode(97).repeat(Number(Bun.argv[1])))"
  const text = `${bin} -e ${evalarg(code)} ${n}`
  if (PS.has(sh())) return `& ${text}`
  return text
}
const glob = (p: string) =>
  process.platform === "win32" ? Filesystem.normalizePathPattern(p) : p.replaceAll("\\", "/")

const forms = (dir: string) => {
  if (process.platform !== "win32") return [dir]
  const full = Filesystem.normalizePath(dir)
  const slash = full.replaceAll("\\", "/")
  const root = slash.replace(/^[A-Za-z]:/, "")
  return Array.from(new Set([full, slash, root, root.toLowerCase()]))
}

const withShell = <A, E, R>(item: { label: string; shell: string }, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.SHELL
      process.env.SHELL = item.shell
      Shell.acceptable.reset()
      Shell.preferred.reset()
      return prev
    }),
    () => self,
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env.SHELL
        else process.env.SHELL = prev
        Shell.acceptable.reset()
      Shell.preferred.reset()
    }),
  )

const envPolicyTurn = (
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
) =>
  turn(cwd, {
    sandbox_policy: { type: "danger-full-access" },
    permission_profile: CodexTurn.fullAccessPermissionProfile(),
    active_permission_profile: { id: ":danger-full-access" },
    ...overrides,
  })

const withEnv = <A, E, R>(values: Record<string, string>, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]))
      for (const [key, value] of Object.entries(values)) process.env[key] = value
      return previous
    }),
    () => self,
    (previous) =>
      Effect.sync(() => {
        for (const [key, value] of Object.entries(previous)) {
          if (value === undefined) delete process.env[key]
          else process.env[key] = value
        }
      }),
  )

const each = (
  name: string,
  fn: (item: { label: string; shell: string }) => Effect.Effect<void, unknown, ShellTestServices>,
) => {
  for (const item of shells) {
    it.live(`${name} [${item.label}]`, () => withShell(item, fn(item)))
  }
}

const capture = (requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">>, stop?: Error) => ({
  ...ctx,
  ask: (req: Omit<Permission.Request, "id" | "sessionID" | "tool">) =>
    Effect.sync(() => {
      requests.push(req)
      if (stop) throw stop
    }),
})

const mustTruncate = (result: {
  metadata: { truncated?: boolean; exit?: number | null } & Record<string, unknown>
  output: string
}) => {
  if (result.metadata.truncated) return
  throw new Error(
    [`shell: ${process.env.SHELL || ""}`, `exit: ${String(result.metadata.exit)}`, "output:", result.output].join("\n"),
  )
}

describe("tool.shell", () => {
  each("basic", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const result = yield* run({
          command: "echo test",
          description: "Echo test message",
        })
        expect(result.metadata.exit).toBe(0)
        expect(result.metadata.output).toContain("test")
      }),
    ),
  )

  it.live("falls back from terminal-only configured shell", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped({ config: { shell: "fish" } })
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const bash = yield* initBash()
          const fallback = Shell.name(Shell.acceptable("fish"))
          expect(fallback).not.toBe("fish")
          expect(bash.description).toContain(fallback)

          const result = yield* bash.execute(
            {
              command: "echo fallback",
              description: "Echo fallback text",
            },
            ctx,
          )
          expect(result.metadata.exit).toBe(0)
          expect(result.output).toContain("fallback")
        }),
      )
    }),
  )

  it.live("turn workspace command policy does not open legacy shell approval", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      const active = turn(tmp)
      const noApproval = {
        ...ctx,
        sessionID: active.sessionID,
        messageID: active.messageID,
        turn: active,
        ask: () =>
          Effect.sync(() => {
            throw new Error("unexpected legacy shell approval")
          }),
      }
      yield* runIn(
        tmp,
        run(
          {
            command: "echo ok",
            description: "Echo ok",
          },
          noApproval,
        ),
      )
    }),
  )
})

describe("tool.shell environment policy", () => {
  it.live("does not expose sensitive process env by default", () =>
    runIn(
      projectRoot,
      withEnv(
        {
          OPENAI_API_KEY: "openai-secret",
          GITHUB_TOKEN: "github-secret",
          AWS_SECRET_ACCESS_KEY: "aws-secret",
          SSH_AUTH_SOCK: "/tmp/ssh-agent.sock",
        },
        Effect.gen(function* () {
          const result = yield* run(
            {
              command: `printf '%s|%s|%s|%s|%s\\n' "$OPENAI_API_KEY" "$GITHUB_TOKEN" "$AWS_SECRET_ACCESS_KEY" "$SSH_AUTH_SOCK" "$PATH"`,
              description: "check shell env policy",
            },
            { ...ctx, turn: envPolicyTurn(projectRoot) },
          )
          const values = result.output.trim().split("|")
          expect(values[0]).toBe("")
          expect(values[1]).toBe("")
          expect(values[2]).toBe("")
          expect(values[3]).toBe("")
          expect(values[4].length).toBeGreaterThan(0)
        }),
      ),
    ),
  )

  it.live("allows an explicit shell env override without inheriting the host secret", () =>
    runIn(
      projectRoot,
      withEnv(
        {
          OPENAI_API_KEY: "host-secret",
        },
        Effect.gen(function* () {
          const result = yield* run(
            {
              command: `echo "$OPENAI_API_KEY"`,
              description: "check explicit shell env override",
            },
            {
              ...ctx,
              turn: envPolicyTurn(projectRoot, {
                shell_environment_policy: {
                  ...CodexTurn.defaultShellEnvironmentPolicy(),
                  allowlist: ["OPENAI_API_KEY"],
                  overrides: {
                    OPENAI_API_KEY: "allowed-test",
                  },
                },
              }),
            },
          )
          expect(result.output.trim()).toBe("allowed-test")
        }),
      ),
    ),
  )

  it.live("injects per-environment shell env values", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const result = yield* run(
          {
            command: `echo "$AIALRA_SAFE_VAR"`,
            description: "check per-environment env",
          },
          {
            ...ctx,
            turn: envPolicyTurn(projectRoot, {
              shell_environment_policy: {
                ...CodexTurn.defaultShellEnvironmentPolicy(),
                per_environment: {
                  default: {
                    AIALRA_SAFE_VAR: "per-env-ok",
                  },
                },
              },
            }),
          },
        )
        expect(result.output.trim()).toBe("per-env-ok")
      }),
    ),
  )
})

describe("tool.shell permissions", () => {
  each("asks for every command when turn command policy is ask", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: "pwd",
              description: "Show current directory",
            },
            { ...capture(requests), turn: turn(tmp, { command_policy: "ask" }) },
          )
          const bashReq = requests.find((request) => request.permission === "bash")
          expect(bashReq).toBeDefined()
          expect(bashReq!.metadata.reason).toBe("command_policy")
          expect(bashReq!.patterns).toContain("pwd")
          expect(bashReq!.metadata.exec_approval).toEqual(
            expect.objectContaining({
              schema: "aialra.exec_approval_request.v1",
              command: "pwd",
              cwd: tmp,
              environment_id: "default",
              permission_profile_id: ":workspace",
              risk_level: "low",
              approval_scope: expect.objectContaining({
                allowed_scopes: expect.arrayContaining(["once-command", "turn-command", "turn-all", "always-command", "always-all"]),
              }),
              final_decision: { status: "pending" },
            }),
          )
          expect(PublicEventLog.list({ sessionID: String(ctx.sessionID) })).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                type: "exec.approval.requested",
                turnID: "msg_turn_shell",
                status: "requested",
                data: expect.objectContaining({
                  command: "pwd",
                  cwd: tmp,
                  reason: "command_policy",
                  constraints_result: expect.objectContaining({ reason: "command_policy" }),
                }),
              }),
              expect.objectContaining({
                type: "terminal.interaction",
                status: "requested",
                data: expect.objectContaining({
                  phase: "approval_requested",
                  command: "pwd",
                }),
              }),
            ]),
          )
        }),
      )
    }),
  )

  each("asks for network permission when turn network policy is ask", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: "curl --version || true",
              description: "Check curl availability",
            },
            { ...capture(requests), turn: turn(tmp, { network_policy: "ask" }) },
          )
          const networkReq = requests.find((request) => request.permission === "network")
          expect(networkReq).toBeDefined()
          expect(networkReq!.metadata.reason).toBe("network_policy")
          expect(networkReq!.patterns).toContain("curl --version || true")
        }),
      )
    }),
  )

  each("asks for bash permission with correct pattern", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: "echo hello",
              description: "Echo hello",
            },
            capture(requests),
          )
          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("bash")
          expect(requests[0].patterns).toContain("echo hello")
        }),
      )
    }),
  )

  each("asks for bash permission with multiple commands", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: "echo foo && echo bar",
              description: "Echo twice",
            },
            capture(requests),
          )
          expect(requests.length).toBe(1)
          expect(requests[0].permission).toBe("bash")
          expect(requests[0].patterns).toContain("echo foo")
          expect(requests[0].patterns).toContain("echo bar")
        }),
      )
    }),
  )

  for (const item of ps) {
    it.live(`parses PowerShell conditionals for permission prompts [${item.label}]`, () =>
      withShell(
        item,
        runIn(
          projectRoot,
          Effect.gen(function* () {
            const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
            yield* run(
              {
                command: "Write-Host foo; if ($?) { Write-Host bar }",
                description: "Check PowerShell conditional",
              },
              capture(requests),
            )
            const bashReq = requests.find((r) => r.permission === "bash")
            expect(bashReq).toBeDefined()
            expect(bashReq!.patterns).toContain("Write-Host foo")
            expect(bashReq!.patterns).toContain("Write-Host bar")
            expect(bashReq!.always).toContain("Write-Host *")
          }),
        ),
      ),
    )
  }

  for (const item of ps) {
    it.live(`uses PowerShell cmdlet prefixes for always-allow prompts [${item.label}]`, () =>
      withShell(
        item,
        Effect.gen(function* () {
          const tmp = yield* tmpdirScoped()
          yield* runIn(
            tmp,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: "Remove-Item -Recurse tmp",
                    description: "Remove a temp directory",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              const bashReq = requests.find((r) => r.permission === "bash")
              expect(bashReq).toBeDefined()
              expect(bashReq!.always).toContain("Remove-Item *")
              expect(bashReq!.always).not.toContain("Remove-Item -Recurse *")
            }),
          )
        }),
      ),
    )
  }

  each("asks for external_directory permission for wildcard external paths", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const err = new Error("stop after permission")
        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const file = process.platform === "win32" ? `${process.env.WINDIR!.replaceAll("\\", "/")}/*` : "/etc/*"
        const want = process.platform === "win32" ? glob(path.join(process.env.WINDIR!, "*")) : "/etc/*"
        expect(
          yield* fail(
            {
              command: `cat ${file}`,
              description: "Read wildcard path",
            },
            capture(requests, err),
          ),
        ).toMatchObject({ message: err.message })
        const extDirReq = requests.find((r) => r.permission === "external_directory")
        expect(extDirReq).toBeDefined()
        expect(extDirReq!.patterns).toContain(want)
      }),
    ),
  )

  if (process.platform === "win32") {
    if (bash) {
      it.live("asks for nested bash command permissions [bash]", () =>
        withShell(
          { label: "bash", shell: bash },
          Effect.gen(function* () {
            const outerTmp = yield* tmpdirScoped()
            yield* Effect.promise(() => Bun.write(path.join(outerTmp, "outside.txt"), "x"))
            yield* runIn(
              projectRoot,
              Effect.gen(function* () {
                const file = path.join(outerTmp, "outside.txt").replaceAll("\\", "/")
                const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
                yield* run(
                  {
                    command: `echo $(cat "${file}")`,
                    description: "Read nested bash file",
                  },
                  capture(requests),
                )
                const extDirReq = requests.find((r) => r.permission === "external_directory")
                const bashReq = requests.find((r) => r.permission === "bash")
                expect(extDirReq).toBeDefined()
                expect(extDirReq!.patterns).toContain(glob(path.join(outerTmp, "*")))
                expect(bashReq).toBeDefined()
                expect(bashReq!.patterns).toContain(`cat "${file}"`)
              }),
            )
          }),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for PowerShell paths after switches [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: `Copy-Item -PassThru "${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini" ./out`,
                    description: "Copy Windows ini",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for nested PowerShell command permissions [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              const file = `${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini`
              yield* run(
                {
                  command: `Write-Output $(Get-Content ${file})`,
                  description: "Read nested PowerShell file",
                },
                capture(requests),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              const bashReq = requests.find((r) => r.permission === "bash")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
              expect(bashReq).toBeDefined()
              expect(bashReq!.patterns).toContain(`Get-Content ${file}`)
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for drive-relative PowerShell paths [${item.label}]`, () =>
        withShell(
          item,
          Effect.gen(function* () {
            const tmp = yield* tmpdirScoped()
            yield* runIn(
              tmp,
              Effect.gen(function* () {
                const err = new Error("stop after permission")
                const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
                expect(
                  yield* fail(
                    {
                      command: 'Get-Content "C:../outside.txt"',
                      description: "Read drive-relative file",
                    },
                    capture(requests, err),
                  ),
                ).toMatchObject({ message: err.message })
                expect(requests[0]?.permission).toBe("external_directory")
                if (requests[0]?.permission !== "external_directory") return
                expect(requests[0].patterns).toContain(glob(path.join(path.dirname(tmp), "*")))
              }),
            )
          }),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for $HOME PowerShell paths [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: 'Get-Content "$HOME/.ssh/config"',
                    description: "Read home config",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(os.homedir(), ".ssh", "*")))
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for $PWD PowerShell paths [${item.label}]`, () =>
        withShell(
          item,
          Effect.gen(function* () {
            const tmp = yield* tmpdirScoped()
            yield* runIn(
              tmp,
              Effect.gen(function* () {
                const err = new Error("stop after permission")
                const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
                expect(
                  yield* fail(
                    {
                      command: 'Get-Content "$PWD/../outside.txt"',
                      description: "Read pwd-relative file",
                    },
                    capture(requests, err),
                  ),
                ).toMatchObject({ message: err.message })
                expect(requests[0]?.permission).toBe("external_directory")
                if (requests[0]?.permission !== "external_directory") return
                expect(requests[0].patterns).toContain(glob(path.join(path.dirname(tmp), "*")))
              }),
            )
          }),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for $PSHOME PowerShell paths [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: 'Get-Content "$PSHOME/outside.txt"',
                    description: "Read pshome file",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(glob(path.join(path.dirname(item.shell), "*")))
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for missing PowerShell env paths [${item.label}]`, () =>
        withShell(
          item,
          Effect.acquireUseRelease(
            Effect.sync(() => {
              const key = "OPENCODE_TEST_MISSING"
              const prev = process.env[key]
              delete process.env[key]
              return { key, prev }
            }),
            ({ key }) =>
              runIn(
                projectRoot,
                Effect.gen(function* () {
                  const err = new Error("stop after permission")
                  const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
                  const root = path.parse(process.env.WINDIR!).root.replace(/[\\/]+$/, "")
                  expect(
                    yield* fail(
                      {
                        command: `Get-Content -Path "${root}$env:${key}\\Windows\\win.ini"`,
                        description: "Read Windows ini with missing env",
                      },
                      capture(requests, err),
                    ),
                  ).toMatchObject({ message: err.message })
                  const extDirReq = requests.find((r) => r.permission === "external_directory")
                  expect(extDirReq).toBeDefined()
                  expect(extDirReq!.patterns).toContain(glob(path.join(process.env.WINDIR!, "*")))
                }),
              ),
            ({ key, prev }) =>
              Effect.sync(() => {
                if (prev === undefined) delete process.env[key]
                else process.env[key] = prev
              }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for PowerShell env paths [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              yield* run(
                {
                  command: "Get-Content $env:WINDIR/win.ini",
                  description: "Read Windows ini from env",
                },
                capture(requests),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for PowerShell FileSystem paths [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: `Get-Content -Path FileSystem::${process.env.WINDIR!.replaceAll("\\", "/")}/win.ini`,
                    description: "Read Windows ini from FileSystem provider",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`asks for external_directory permission for braced PowerShell env paths [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: "Get-Content ${env:WINDIR}/win.ini",
                    description: "Read Windows ini from braced env",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]?.permission).toBe("external_directory")
              if (requests[0]?.permission !== "external_directory") return
              expect(requests[0].patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`treats Set-Location like cd for permissions [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              yield* run(
                {
                  command: "Set-Location C:/Windows",
                  description: "Change location",
                },
                capture(requests),
              )
              const extDirReq = requests.find((r) => r.permission === "external_directory")
              const bashReq = requests.find((r) => r.permission === "bash")
              expect(extDirReq).toBeDefined()
              expect(extDirReq!.patterns).toContain(
                Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")),
              )
              expect(bashReq).toBeUndefined()
            }),
          ),
        ),
      )
    }

    for (const item of ps) {
      it.live(`does not add nested PowerShell expressions to permission prompts [${item.label}]`, () =>
        withShell(
          item,
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              yield* run(
                {
                  command: "Write-Output ('a' * 3)",
                  description: "Write repeated text",
                },
                capture(requests),
              )
              const bashReq = requests.find((r) => r.permission === "bash")
              expect(bashReq).toBeDefined()
              expect(bashReq!.patterns).not.toContain("a * 3")
              expect(bashReq!.always).not.toContain("a *")
            }),
          ),
        ),
      )
    }
  }

  if (process.platform === "win32" && cmdShell) {
    it.live("asks for external_directory permission for cmd file commands [cmd]", () =>
      withShell(
        cmdShell,
        runIn(
          projectRoot,
          Effect.gen(function* () {
            const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
            yield* run(
              {
                command: `TYPE "${path.join(process.env.WINDIR!, "win.ini")}"`,
                description: "Read Windows ini with cmd",
              },
              capture(requests),
            )
            const extDirReq = requests.find((r) => r.permission === "external_directory")
            expect(extDirReq).toBeDefined()
            expect(extDirReq!.patterns).toContain(Filesystem.normalizePathPattern(path.join(process.env.WINDIR!, "*")))
          }),
        ),
      ),
    )
  }

  each("asks for external_directory permission when cd to parent", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const err = new Error("stop after permission")
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          expect(
            yield* fail(
              {
                command: "cd ../",
                description: "Change to parent directory",
              },
              capture(requests, err),
            ),
          ).toMatchObject({ message: err.message })
          const extDirReq = requests.find((r) => r.permission === "external_directory")
          expect(extDirReq).toBeDefined()
        }),
      )
    }),
  )

  each("asks for external_directory permission when workdir is outside project", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const err = new Error("stop after permission")
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          expect(
            yield* fail(
              {
                command: "echo ok",
                workdir: os.tmpdir(),
                description: "Echo from temp dir",
              },
              capture(requests, err),
            ),
          ).toMatchObject({ message: err.message })
          const extDirReq = requests.find((r) => r.permission === "external_directory")
          expect(extDirReq).toBeDefined()
          expect(extDirReq!.patterns).toContain(glob(path.join(os.tmpdir(), "*")))
        }),
      )
    }),
  )

  if (process.platform === "win32") {
    it.live("normalizes external_directory workdir variants on Windows", () =>
      Effect.gen(function* () {
        const err = new Error("stop after permission")
        const outerTmp = yield* tmpdirScoped()
        const tmp = yield* tmpdirScoped()
        yield* runIn(
          tmp,
          Effect.gen(function* () {
            const want = Filesystem.normalizePathPattern(path.join(outerTmp, "*"))

            for (const dir of forms(outerTmp)) {
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              expect(
                yield* fail(
                  {
                    command: "echo ok",
                    workdir: dir,
                    description: "Echo from external dir",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })

              const extDirReq = requests.find((r) => r.permission === "external_directory")
              expect({ dir, patterns: extDirReq?.patterns, always: extDirReq?.always }).toEqual({
                dir,
                patterns: [want],
                always: [want],
              })
            }
          }),
        )
      }),
    )

    if (bash) {
      it.live("uses Git Bash /tmp semantics for external workdir", () =>
        withShell(
          { label: "bash", shell: bash },
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              const want = glob(path.join(os.tmpdir(), "*"))
              expect(
                yield* fail(
                  {
                    command: "echo ok",
                    workdir: "/tmp",
                    description: "Echo from Git Bash tmp",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]).toMatchObject({
                permission: "external_directory",
                patterns: [want],
                always: [want],
              })
            }),
          ),
        ),
      )

      it.live("uses Git Bash /tmp semantics for external file paths", () =>
        withShell(
          { label: "bash", shell: bash },
          runIn(
            projectRoot,
            Effect.gen(function* () {
              const err = new Error("stop after permission")
              const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
              const want = glob(path.join(os.tmpdir(), "*"))
              expect(
                yield* fail(
                  {
                    command: "cat /tmp/opencode-does-not-exist",
                    description: "Read Git Bash tmp file",
                  },
                  capture(requests, err),
                ),
              ).toMatchObject({ message: err.message })
              expect(requests[0]).toMatchObject({
                permission: "external_directory",
                patterns: [want],
                always: [want],
              })
            }),
          ),
        ),
      )
    }
  }

  each("asks for external_directory permission when file arg is outside project", () =>
    Effect.gen(function* () {
      const outerTmp = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(outerTmp, "outside.txt"), "x"))
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const err = new Error("stop after permission")
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          const filepath = path.join(outerTmp, "outside.txt")
          expect(
            yield* fail(
              {
                command: `cat ${filepath}`,
                description: "Read external file",
              },
              capture(requests, err),
            ),
          ).toMatchObject({ message: err.message })
          const extDirReq = requests.find((r) => r.permission === "external_directory")
          const expected = glob(path.join(outerTmp, "*"))
          expect(extDirReq).toBeDefined()
          expect(extDirReq!.patterns).toContain(expected)
          expect(extDirReq!.always).toContain(expected)
        }),
      )
    }),
  )

  each("does not ask for external_directory permission when rm inside project", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* Effect.promise(() => Bun.write(path.join(tmp, "tmpfile"), "x"))
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: `rm -rf ${path.join(tmp, "nested")}`,
              description: "Remove nested dir",
            },
            capture(requests),
          )
          const extDirReq = requests.find((r) => r.permission === "external_directory")
          expect(extDirReq).toBeUndefined()
        }),
      )
    }),
  )

  each("includes always patterns for auto-approval", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: "git log --oneline -5",
              description: "Git log",
            },
            capture(requests),
          )
          expect(requests.length).toBe(1)
          expect(requests[0].always.length).toBeGreaterThan(0)
          expect(requests[0].always.some((item) => item.endsWith("*"))).toBe(true)
        }),
      )
    }),
  )

  each("does not ask for bash permission when command is cd only", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          yield* run(
            {
              command: "cd .",
              description: "Stay in current directory",
            },
            capture(requests),
          )
          const bashReq = requests.find((r) => r.permission === "bash")
          expect(bashReq).toBeUndefined()
        }),
      )
    }),
  )

  each("matches redirects in permission pattern", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const err = new Error("stop after permission")
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          expect(
            yield* fail(
              { command: "echo test > output.txt", description: "Redirect test output" },
              capture(requests, err),
            ),
          ).toMatchObject({ message: err.message })
          const bashReq = requests.find((r) => r.permission === "bash")
          expect(bashReq).toBeDefined()
          expect(bashReq!.patterns).toContain("echo test > output.txt")
        }),
      )
    }),
  )

  each("always pattern has space before wildcard to not include different commands", () =>
    Effect.gen(function* () {
      const tmp = yield* tmpdirScoped()
      yield* runIn(
        tmp,
        Effect.gen(function* () {
          const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
          yield* run({ command: "ls -la", description: "List" }, capture(requests))
          const bashReq = requests.find((r) => r.permission === "bash")
          expect(bashReq).toBeDefined()
          expect(bashReq!.always[0]).toBe("ls *")
        }),
      )
    }),
  )
})

describe("tool.shell abort", () => {
  it.live(
    "preserves output when aborted",
    () =>
      runIn(
        projectRoot,
        Effect.gen(function* () {
          const controller = new AbortController()
          const collected: string[] = []
          const res = yield* run(
            {
              command: `echo before && sleep 30`,
              description: "Long running command",
            },
            {
              ...ctx,
              abort: controller.signal,
              metadata: (input) =>
                Effect.sync(() => {
                  const output = (input.metadata as { output?: string })?.output
                  if (output && output.includes("before") && !controller.signal.aborted) {
                    collected.push(output)
                    controller.abort()
                  }
                }),
            },
          )
          expect(res.output).toContain("before")
          expect(res.output).toContain("Command aborted by OpenCode abort signal")
          expect(collected.length).toBeGreaterThan(0)
        }),
      ),
    15_000,
  )

  it.live(
    "terminates command on timeout",
    () =>
      runIn(
        projectRoot,
        Effect.gen(function* () {
          const result = yield* run({
            command: `echo started && sleep 60`,
            description: "Timeout test",
            timeout: 500,
          })
          expect(result.output).toContain("started")
          expect(result.output).toContain("shell tool terminated command after exceeding timeout")
          expect(result.output).toContain("retry with a larger timeout value in milliseconds")
        }),
      ),
    15_000,
  )

  it.live(
    "uses RuntimeFlags bashDefaultTimeoutMs when timeout is omitted",
    () =>
      runIn(
        projectRoot,
        Effect.gen(function* () {
          const tool = yield* initShell()
          expect(tool.description).toContain("commands will time out after 500ms")
          const result = yield* tool.execute(
            {
              command: `echo started && sleep 60`,
              description: "Default timeout test",
            },
            ctx,
          )
          expect(result.output).toContain("started")
          expect(result.output).toContain("exceeding timeout 500 ms")
        }),
      ).pipe(Effect.provide(RuntimeFlags.layer({ bashDefaultTimeoutMs: 500 }))),
    15_000,
  )

  if (process.platform !== "win32") {
    it.live("captures stderr in output", () =>
      runIn(
        projectRoot,
        Effect.gen(function* () {
          const result = yield* run({
            command: `echo stdout_msg && echo stderr_msg >&2`,
            description: "Stderr test",
          })
          expect(result.output).toContain("stdout_msg")
          expect(result.output).toContain("stderr_msg")
          expect(result.metadata.exit).toBe(0)
        }),
      ),
    )
  }

  it.live("returns non-zero exit code", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const result = yield* run({
          command: `exit 42`,
          description: "Non-zero exit",
        })
        expect(result.metadata.exit).toBe(42)
      }),
    ),
  )

  it.live("streams metadata updates progressively", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const updates: string[] = []
        const result = yield* run(
          {
            command: `echo first && sleep 0.1 && echo second`,
            description: "Streaming test",
          },
          {
            ...ctx,
            metadata: (input) =>
              Effect.sync(() => {
                const output = (input.metadata as { output?: string })?.output
                if (output) updates.push(output)
              }),
          },
        )
        expect(result.output).toContain("first")
        expect(result.output).toContain("second")
        expect(updates.length).toBeGreaterThan(1)
      }),
    ),
  )

  it.live("returns a running process when yield_time_ms elapses before command exit", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        ExecProcessRegistry.clearForTest()
        PublicEventLog.clearForTest()
        const result = yield* run({
          command: `printf started && sleep 1 && printf done`,
          description: "Yield running process",
          timeout: 5_000,
          yield_time_ms: 1,
        })
        expect(result.output).toContain("started")
        expect(result.output).toContain("Command is still running after foreground yield time")
        expect(result.metadata.running).toBe(true)
        expect(result.metadata.process_id).toContain("proc_exec_")
        expect(result.metadata.effective_yield_time_ms).toBe(250)
        expect(result.metadata.yield_time_clamped).toBe(true)
        const running = ExecProcessRegistry.get(result.metadata.process_id)
        expect(running?.status).toBe("running")
        expect(running?.cwd).toBe(projectRoot)
        expect(running?.command).toContain("printf started")
        expect(running?.background).toBe(true)
        expect(running?.pid).toEqual(expect.any(Number))
        expect(ExecProcessRegistry.read(result.metadata.process_id, { sessionID: ctx.sessionID })?.status).toBe("running")
        expect(ExecProcessRegistry.listLiveProcesses({ sessionID: ctx.sessionID }).map((record) => record.process_id)).toContain(
          result.metadata.process_id,
        )
        yield* Effect.sleep("1500 millis")
        const completed = ExecProcessRegistry.get(result.metadata.process_id)
        expect(completed?.status).toBe("completed")
        expect(completed?.exit_code).toBe(0)
      }),
    ),
  )

  it.live("times out a yielded process after background terminal max timeout", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        ExecProcessRegistry.clearForTest()
        PublicEventLog.clearForTest()
        const result = yield* run(
          {
            command: `printf started && sleep 5 && printf late`,
            description: "Background terminal timeout",
            timeout: 5_000,
            yield_time_ms: 1,
          },
          {
            ...ctx,
            turn: turn(projectRoot, {
              engineering: EngineeringHarness.snapshot({
                controls: EngineeringHarness.normalize({
                  backgroundTerminalMaxTimeoutMs: 1_000,
                  singleCommandTimeoutMs: 5_000,
                }),
                prompt: "background timeout test",
              }),
            }),
          },
        )
        expect(result.metadata.running).toBe(true)
        expect(result.metadata.process_id).toContain("proc_exec_")
        expect(ExecProcessRegistry.get(result.metadata.process_id)?.background_timeout_ms).toBe(1_000)
        yield* Effect.sleep("1600 millis")
        const timedOut = ExecProcessRegistry.get(result.metadata.process_id)
        expect(timedOut?.status).toBe("timeout")
        expect(timedOut?.failure).toBe("background_terminal_max_timeout")
        const events = PublicEventLog.list({ sessionID: ctx.sessionID })
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "exec_command.end",
              status: "timeout",
              data: expect.objectContaining({
                timeout_reason: "background_terminal_max_timeout",
                terminal_state: expect.objectContaining({ timeout: true }),
              }),
            }),
          ]),
        )
      }),
    ),
  )

  it.live("denies new yielded commands when the live process limit is reached", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        ExecProcessRegistry.clearForTest()
        PublicEventLog.clearForTest()
        const turnContext = turn(projectRoot, {
          engineering: EngineeringHarness.snapshot({
            controls: EngineeringHarness.normalize({
              maxLiveProcessesPerSession: 1,
              maxLiveProcessesPerTurn: 1,
              maxLiveProcessesPerEnvironment: 1,
            }),
            prompt: "live process capacity test",
          }),
        })
        const first = yield* run(
          {
            command: `printf first && sleep 5 && printf done`,
            description: "First yielded process",
            timeout: 10_000,
            yield_time_ms: 1,
          },
          { ...ctx, callID: "live_1", turn: turnContext },
        )
        expect(first.metadata.running).toBe(true)
        const err = yield* fail(
          {
            command: `printf second && sleep 5 && printf done`,
            description: "Second yielded process",
            timeout: 10_000,
            yield_time_ms: 1,
          },
          { ...ctx, callID: "live_2", turn: turnContext },
        )
        expect(err.message).toContain("Live background process limit reached")
        expect(ExecProcessRegistry.listLiveProcesses({ sessionID: ctx.sessionID }).length).toBe(1)
        const aborted = yield* ExecProcessRegistry.abort(first.metadata.process_id, {
          sessionID: ctx.sessionID,
          turnID: turnContext.turnID,
          messageID: ctx.messageID,
          actor: "user",
          reason: "test_cleanup_after_capacity_denied",
        })
        expect(aborted.ok).toBe(true)
        const events = PublicEventLog.list({ sessionID: ctx.sessionID })
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "exec_process.capacity_checked", status: "allowed" }),
            expect.objectContaining({
              type: "exec_process.capacity_denied",
              status: "denied",
              data: expect.objectContaining({
                dimension: "session",
                limit_per_session: 1,
              }),
            }),
          ]),
        )
      }),
    ),
  )

  it.live("aborts and cleans up a yielded process through the unified process manager", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        ExecProcessRegistry.clearForTest()
        PublicEventLog.clearForTest()
        const result = yield* run({
          command: `printf waiting && sleep 5 && printf late`,
          description: "Abort through process manager",
          timeout: 10_000,
          yield_time_ms: 1,
        })
        expect(result.metadata.running).toBe(true)
        const aborted = yield* ExecProcessRegistry.abort(result.metadata.process_id, {
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          actor: "user",
          reason: "test_abort",
        })
        expect(aborted.ok).toBe(true)
        expect(ExecProcessRegistry.read(result.metadata.process_id, { sessionID: ctx.sessionID })?.status).toBe("aborted")
        yield* ExecProcessRegistry.cleanup({ sessionID: ctx.sessionID })
        const events = PublicEventLog.list({ sessionID: ctx.sessionID })
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "exec_process.abort_requested", status: "requested" }),
            expect.objectContaining({
              type: "exec_command.end",
              status: "aborted",
              data: expect.objectContaining({ abort_reason: "test_abort" }),
            }),
            expect.objectContaining({ type: "exec_process.cleanup", status: "cleaned" }),
          ]),
        )
      }),
    ),
  )

  it.live("awaits a yielded process through the unified process manager", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        ExecProcessRegistry.clearForTest()
        PublicEventLog.clearForTest()
        const turnContext = turn(projectRoot)
        const result = yield* run(
          {
            command: `printf started && sleep 0.5 && printf done`,
            description: "Await process completion",
            timeout: 5_000,
            yield_time_ms: 1,
          },
          { ...ctx, turn: turnContext },
        )
        expect(result.metadata.running).toBe(true)
        const awaitProcess = yield* initAwaitProcess()
        const awaited = yield* awaitProcess.execute(
          {
            process_id: result.metadata.process_id,
            timeout_ms: 5_000,
            description: "Wait for process completion",
          },
          { ...ctx, turn: turnContext },
        )
        expect(awaited.metadata.await_status).toBe("completed")
        expect(awaited.metadata.exit).toBe(0)
        expect(awaited.output).toContain("terminal state: completed")
        const events = PublicEventLog.list({ sessionID: ctx.sessionID })
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "exec_process.await_started", status: "waiting" }),
            expect.objectContaining({ type: "exec_process.await_finished", status: "completed" }),
          ]),
        )
      }),
    ),
  )

  it.live("awaiter timeout does not kill a yielded process", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        ExecProcessRegistry.clearForTest()
        PublicEventLog.clearForTest()
        const turnContext = turn(projectRoot)
        const result = yield* run(
          {
            command: `printf waiting && sleep 5 && printf late`,
            description: "Await process timeout",
            timeout: 10_000,
            yield_time_ms: 1,
          },
          { ...ctx, turn: turnContext },
        )
        expect(result.metadata.running).toBe(true)
        const awaitProcess = yield* initAwaitProcess()
        const awaited = yield* awaitProcess.execute(
          {
            process_id: result.metadata.process_id,
            timeout_ms: 1_000,
            description: "Wait briefly for process",
          },
          { ...ctx, turn: turnContext },
        )
        expect(awaited.metadata.await_status).toBe("await_timeout")
        expect(ExecProcessRegistry.get(result.metadata.process_id)?.status).toBe("running")
        const aborted = yield* ExecProcessRegistry.abort(result.metadata.process_id, {
          sessionID: ctx.sessionID,
          turnID: turnContext.turnID,
          messageID: ctx.messageID,
          actor: "user",
          reason: "test_cleanup_after_await_timeout",
        })
        expect(aborted.ok).toBe(true)
        const events = PublicEventLog.list({ sessionID: ctx.sessionID })
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ type: "exec_process.await_started", status: "waiting" }),
            expect.objectContaining({ type: "exec_process.await_timeout", status: "await_timeout" }),
          ]),
        )
      }),
    ),
  )

  it.live("cleanup_processes terminates selected running background processes", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        ExecProcessRegistry.clearForTest()
        PublicEventLog.clearForTest()
        const turnContext = turn(projectRoot)
        const result = yield* run(
          {
            command: `printf cleanup && sleep 5 && printf late`,
            description: "Cleanup running process",
            timeout: 10_000,
            yield_time_ms: 1,
          },
          { ...ctx, callID: "cleanup_1", turn: turnContext },
        )
        expect(result.metadata.running).toBe(true)
        const cleanupProcesses = yield* initCleanupProcesses()
        const cleaned = yield* cleanupProcesses.execute(
          {
            process_id: result.metadata.process_id,
            include_running: true,
            description: "test cleanup running process",
          },
          { ...ctx, turn: turnContext },
        )
        expect(cleaned.metadata.cleaned).toBe(1)
        expect(cleaned.metadata.failed).toBe(0)
        const record = ExecProcessRegistry.get(result.metadata.process_id)
        expect(record?.status).toBe("aborted")
        expect(record?.cleanup_at).toEqual(expect.any(Number))
        const events = PublicEventLog.list({ sessionID: ctx.sessionID })
        expect(events).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "exec_process.cleanup",
              status: "terminated",
              data: expect.objectContaining({
                process_id: result.metadata.process_id,
                previous_status: "running",
              }),
            }),
          ]),
        )
      }),
    ),
  )

  it.live("writes stdin to a yielded process_id", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        ExecProcessRegistry.clearForTest()
        const command = `${bin} -e ${evalarg('process.stdin.once("data",d=>{console.log("got:"+d.toString().trim());process.exit(0)})')}`
        const result = yield* run({
          command,
          description: "Start stdin waiter",
          timeout: 5_000,
          yield_time_ms: 1,
        })
        expect(result.metadata.running).toBe(true)
        const writeStdin = yield* initWriteStdin()
        const written = yield* writeStdin.execute(
          {
            process_id: result.metadata.process_id,
            text: "hello from stdin",
            control: "newline",
            description: "Send waiter input",
          },
          ctx,
        )
        expect(written.metadata.status).toBe("written")
        const completed = yield* Effect.promise(async () => {
          for (const _ of Array.from({ length: 20 })) {
            const record = ExecProcessRegistry.get(result.metadata.process_id)
            if (record?.status !== "running") return record
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          return ExecProcessRegistry.get(result.metadata.process_id)
        })
        expect(completed?.status).toBe("completed")
        expect(completed?.exit_code).toBe(0)
        expect(completed?.stdin_writes).toBe(1)
        const events = PublicEventLog.list({ sessionID: ctx.sessionID })
          .filter(
            (event) =>
              event.type === "terminal.interaction" &&
              event.data.process_id === result.metadata.process_id &&
              event.data.command === command,
          )
          .map((event) => event.data.phase)
        expect(events).toEqual(expect.arrayContaining(["exec_started", "process_running", "stdin_write", "process_end"]))
        const deltas = PublicEventLog.list({ sessionID: ctx.sessionID }).filter(
          (event) =>
            event.type === "exec_command.output_delta" &&
            event.data.process_id === result.metadata.process_id &&
            event.rawRef,
        )
        expect(deltas).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              status: "delta",
              data: expect.objectContaining({
                stream: "stdout",
                encoding: "base64",
                byte_length: expect.any(Number),
                codex_command_exec: expect.objectContaining({ method: "command/exec/outputDelta" }),
              }),
              rawRef: expect.any(Object),
            }),
          ]),
        )
        expect(deltas[0]?.data.delta_base64).toBeUndefined()
        expect(deltas[0] ? PublicEventLog.readRaw({ sessionID: ctx.sessionID, eventID: deltas[0].id }) : undefined).toEqual(
          expect.objectContaining({
            base64_payload: expect.any(String),
            raw_payload: expect.objectContaining({
              delta_base64: expect.any(String),
              codex_command_exec: expect.objectContaining({ deltaBase64: expect.any(String) }),
              codex_item: expect.objectContaining({ delta: expect.any(String) }),
            }),
          }),
        )
        const ends = PublicEventLog.list({ sessionID: ctx.sessionID }).filter(
          (event) =>
            event.type === "exec_command.end" &&
            event.data.process_id === result.metadata.process_id &&
            event.data.command === command,
        )
        expect(ends).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              status: "completed",
              data: expect.objectContaining({
                process_id: result.metadata.process_id,
                status: "completed",
                exit_code: 0,
                terminal_state: expect.objectContaining({ completed: true, aborted: false }),
              }),
            }),
          ]),
        )
      }),
    ),
  )
})

describe("tool.shell truncation", () => {
  it.live("truncates output exceeding line limit", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const lineCount = Truncate.MAX_LINES + 500
        const result = yield* run({
          command: fill("lines", lineCount),
          description: "Generate lines exceeding limit",
        })
        mustTruncate(result)
        expect(result.output).toMatch(/\.\.\.output truncated\.\.\./)
        expect(result.output).toMatch(/Full output saved to:\s+\S+/)
      }),
    ),
  )

  it.live("truncates output exceeding byte limit", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const byteCount = Truncate.MAX_BYTES + 10000
        const result = yield* run({
          command: fill("bytes", byteCount),
          description: "Generate bytes exceeding limit",
        })
        mustTruncate(result)
        expect(result.output).toMatch(/\.\.\.output truncated\.\.\./)
        expect(result.output).toMatch(/Full output saved to:\s+\S+/)
      }),
    ),
  )

  it.live("does not truncate small output", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const result = yield* run({
          command: fill("lines", 1),
          description: "Generate one line",
        })
        expect((result.metadata as { truncated?: boolean }).truncated).toBe(false)
        expect(result.output).toContain("1")
      }),
    ),
  )

  it.live("full output is saved to file when truncated", () =>
    runIn(
      projectRoot,
      Effect.gen(function* () {
        const lineCount = Truncate.MAX_LINES + 100
        const result = yield* run({
          command: fill("lines", lineCount),
          description: "Generate lines for file check",
        })
        mustTruncate(result)

        const filepath = (result.metadata as { outputPath?: string }).outputPath
        expect(filepath).toBeTruthy()

        const saved = yield* (yield* AppFileSystem.Service).readFileString(filepath!)
        const lines = saved.trim().split(/\r?\n/)
        expect(lines.length).toBe(lineCount)
        expect(lines[0]).toBe("1")
        expect(lines[lineCount - 1]).toBe(String(lineCount))
      }),
    ),
  )
})

import { describe, expect } from "bun:test"
import fs from "node:fs/promises"
import fssync from "node:fs"
import path from "node:path"
import { Cause, Effect, Exit, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Format } from "../../src/format"
import { Instruction } from "../../src/session/instruction"
import { LSP } from "../../src/lsp/lsp"
import { Plugin } from "../../src/plugin"
import { Reference } from "../../src/reference/reference"
import { Shell } from "../../src/shell/shell"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { ApplyPatchTool } from "../../src/tool/apply_patch"
import { EditTool } from "../../src/tool/edit"
import { ReadTool } from "../../src/tool/read"
import { ShellTool } from "../../src/tool/shell"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { WriteTool } from "../../src/tool/write"
import { CodexTurn, type TurnContext } from "../../src/session/turn-context"
import { SessionSecurity } from "../../src/session/security"
import { MessageID, SessionID } from "../../src/session/schema"
import { probeLinuxSandboxCapability } from "../../src/tool/linux-sandbox-capability"
import { TurnSandbox } from "../../src/tool/turn-sandbox"
import { TestInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const layer = Layer.mergeAll(
  Agent.defaultLayer,
  AppFileSystem.defaultLayer,
  Bus.layer,
  Config.defaultLayer,
  CrossSpawnSpawner.defaultLayer,
  Format.defaultLayer,
  Instruction.defaultLayer,
  LSP.defaultLayer,
  Plugin.defaultLayer,
  Reference.defaultLayer,
  RuntimeFlags.defaultLayer,
  Truncate.defaultLayer,
)

const it = testEffect(layer)

function turn(cwd: string, overrides: Partial<TurnContext> = {}): TurnContext {
  const sessionID = SessionID.make("ses_turn_sandbox")
  const messageID = MessageID.make("msg_turn_sandbox")
  return {
    version: "aialra.user_turn.v1",
    turnID: messageID,
    sessionID,
    messageID,
    startedAt: Date.now(),
    items: [],
    cwd,
    approval_policy: "never",
    sandbox_policy: CodexTurn.defaultSandboxPolicy(cwd),
    permission_profile: CodexTurn.workspacePermissionProfile(cwd),
    active_permission_profile: { id: ":workspace" },
    model: { providerID: "test", modelID: "test" },
    collaboration_mode: { kind: "default" },
    environments: [{ environmentID: "default", cwd }],
    selected_environment_id: "default",
    route: "prompt",
    agent: "build",
    noReply: false,
    format: "text",
    retry: CodexTurn.retryConfig({}),
    ...overrides,
  }
}

function ctx(activeTurn: TurnContext): Tool.Context {
  return {
    sessionID: activeTurn.sessionID,
    messageID: activeTurn.messageID,
    callID: "call_test",
    agent: "build",
    abort: AbortSignal.any([]),
    messages: [],
    turn: activeTurn,
    metadata: () => Effect.void,
    ask: () => Effect.void,
  }
}

const expectFailure = <A, E, R>(effect: Effect.Effect<A, E, R>, message: string) =>
  Effect.gen(function* () {
    const exit = yield* Effect.exit(effect)
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(message)
  })

function outsideRepoFile(name: string) {
  return path.join(process.cwd(), `.turn-sandbox-${name}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
}

function canRunBwrapSandbox() {
  const capability = probeLinuxSandboxCapability()
  return process.platform === "linux" && capability.bwrap.available && capability.bwrap.userNamespaceProbe.available
}

const initWrite = Effect.fn("TurnSandboxTest.initWrite")(function* () {
  const info = yield* WriteTool
  return yield* info.init()
})

const initRead = Effect.fn("TurnSandboxTest.initRead")(function* () {
  const info = yield* ReadTool
  return yield* info.init()
})

const initEdit = Effect.fn("TurnSandboxTest.initEdit")(function* () {
  const info = yield* EditTool
  return yield* info.init()
})

const initPatch = Effect.fn("TurnSandboxTest.initPatch")(function* () {
  const info = yield* ApplyPatchTool
  return yield* info.init()
})

const initShell = Effect.fn("TurnSandboxTest.initShell")(function* () {
  const info = yield* ShellTool
  return yield* info.init()
})

describe("Codex turn sandbox tool gates", () => {
  it.instance("resolves relative write paths from TurnContext.cwd", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      const tool = yield* initWrite()

      yield* tool.execute({ filePath: "inside.txt", content: "ok" }, ctx(turn(cwd)))

      expect(yield* Effect.promise(() => fs.readFile(path.join(cwd, "inside.txt"), "utf8"))).toBe("ok")
      expect(fssync.existsSync(path.join(test.directory, "inside.txt"))).toBe(false)
    }),
  )

  it.instance("resolves relative paths from selected environment cwd", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const root = path.join(test.directory, "workspace")
      const selected = path.join(test.directory, "selected-env")
      const active = turn(root, {
        environments: [
          { environmentID: "default", cwd: root },
          { environmentID: "selected", cwd: selected, kind: "local" },
        ],
        selected_environment_id: "selected",
      })

      expect(TurnSandbox.resolvePath(ctx(active), "inside.txt", test.directory)).toBe(path.join(selected, "inside.txt"))
    }),
  )

  it.instance("denies recursive search outside the workspace scope", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))

      yield* expectFailure(
        TurnSandbox.assertSearchScope(ctx(turn(cwd)), path.parse(cwd).root),
        "Codex turn sandbox denied recursive search outside the selected workspace",
      )
    }),
  )

  it.instance("allows recursive search in the selected environment cwd", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const root = path.join(test.directory, "workspace")
      const selected = path.join(test.directory, "selected-env")
      yield* Effect.promise(() => fs.mkdir(selected, { recursive: true }))
      const active = turn(root, {
        environments: [
          { environmentID: "default", cwd: root },
          { environmentID: "selected", cwd: selected, kind: "local" },
        ],
        selected_environment_id: "selected",
      })

      yield* TurnSandbox.assertSearchScope(ctx(active), selected)
    }),
  )

  it.instance("denies write outside the workspace-write turn cwd", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      const outside = outsideRepoFile("outside-write")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      const tool = yield* initWrite()

      try {
        yield* expectFailure(
          tool.execute({ filePath: outside, content: "blocked" }, ctx(turn(cwd))),
          "Codex turn sandbox denied write access",
        )
        expect(fssync.existsSync(outside)).toBe(false)
      } finally {
        yield* Effect.promise(() => fs.rm(outside, { force: true }))
      }
    }),
  )

  it.instance("denies writes that escape the turn cwd through symlinks", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      const outsideDir = path.join(process.cwd(), `.turn-sandbox-symlink-${Date.now()}`)
      const link = path.join(cwd, "linked-outside")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      yield* Effect.promise(() => fs.mkdir(outsideDir, { recursive: true }))
      yield* Effect.promise(() => fs.symlink(outsideDir, link, "dir"))
      const tool = yield* initWrite()

      try {
        yield* expectFailure(
          tool.execute({ filePath: path.join(link, "escape.txt"), content: "blocked" }, ctx(turn(cwd))),
          "Codex turn sandbox denied write access",
        )
        expect(fssync.existsSync(path.join(outsideDir, "escape.txt"))).toBe(false)
      } finally {
        yield* Effect.promise(() => fs.rm(outsideDir, { recursive: true, force: true }))
      }
    }),
  )

  it.instance("denies edit and apply_patch writes to Codex protected metadata paths", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      const gitDir = path.join(cwd, ".git")
      const config = path.join(gitDir, "config")
      yield* Effect.promise(() => fs.mkdir(gitDir, { recursive: true }))
      yield* Effect.promise(() => fs.writeFile(config, "safe", "utf8"))
      const active = turn(cwd)

      const edit = yield* initEdit()
      yield* expectFailure(
        edit.execute({ filePath: config, oldString: "safe", newString: "unsafe" }, ctx(active)),
        "Codex turn sandbox denied write access",
      )

      const patch = yield* initPatch()
      yield* expectFailure(
        patch.execute(
          {
            patchText: [
              "*** Begin Patch",
              "*** Update File: .git/config",
              "@@",
              "-safe",
              "+unsafe",
              "*** End Patch",
            ].join("\n"),
          },
          ctx(active),
        ),
        "Codex turn sandbox denied write access",
      )

      expect(yield* Effect.promise(() => fs.readFile(config, "utf8"))).toBe("safe")
    }),
  )

  it.instance("denies write tools under a read-only turn", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      const active = turn(cwd, {
        sandbox_policy: { type: "read-only", network_access: false },
        permission_profile: CodexTurn.readOnlyPermissionProfile(),
        active_permission_profile: { id: ":read-only" },
      })
      const tool = yield* initWrite()

      yield* expectFailure(
        tool.execute({ filePath: "blocked.txt", content: "blocked" }, ctx(active)),
        "Codex turn sandbox denied write access",
      )
      expect(fssync.existsSync(path.join(cwd, "blocked.txt"))).toBe(false)
    }),
  )

  it.instance("allows read but denies write/edit/apply_patch under a read-only profile", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      const file = path.join(cwd, "readable.txt")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      yield* Effect.promise(() => fs.writeFile(file, "read-ok", "utf8"))
      const active = turn(cwd, {
        sandbox_policy: { type: "read-only", network_access: false },
        permission_profile: CodexTurn.readOnlyPermissionProfile(),
        active_permission_profile: { id: ":read-only" },
      })

      const read = yield* initRead()
      const readResult = yield* read.execute({ filePath: "readable.txt" }, ctx(active))
      expect(readResult.output).toContain("read-ok")

      const write = yield* initWrite()
      yield* expectFailure(
        write.execute({ filePath: "blocked.txt", content: "blocked" }, ctx(active)),
        "Codex turn sandbox denied write access",
      )

      const edit = yield* initEdit()
      yield* expectFailure(
        edit.execute({ filePath: "readable.txt", oldString: "read-ok", newString: "bad" }, ctx(active)),
        "Codex turn sandbox denied write access",
      )

      const patch = yield* initPatch()
      yield* expectFailure(
        patch.execute(
          {
            patchText: ["*** Begin Patch", "*** Update File: readable.txt", "@@", "-read-ok", "+bad", "*** End Patch"].join(
              "\n",
            ),
          },
          ctx(active),
        ),
        "Codex turn sandbox denied write access",
      )
    }),
  )

  it.instance("allows full-access profile to write outside the workspace", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      const outside = outsideRepoFile("full-access")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      const active = turn(cwd, {
        sandbox_policy: { type: "danger-full-access" },
        permission_profile: CodexTurn.fullAccessPermissionProfile(),
        active_permission_profile: { id: ":danger-full-access" },
      })
      const write = yield* initWrite()

      try {
        yield* write.execute({ filePath: outside, content: "allowed" }, ctx(active))
        expect(yield* Effect.promise(() => fs.readFile(outside, "utf8"))).toBe("allowed")
      } finally {
        yield* Effect.promise(() => fs.rm(outside, { force: true }))
      }
    }),
  )

  it.instance("allows disabled profile to bypass file sandbox checks", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      const outside = outsideRepoFile("disabled")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      const active = turn(cwd, {
        sandbox_policy: { type: "danger-full-access" },
        permission_profile: { type: "disabled" },
        active_permission_profile: { id: "disabled" },
      })
      const write = yield* initWrite()

      try {
        yield* write.execute({ filePath: outside, content: "allowed-disabled" }, ctx(active))
        expect(yield* Effect.promise(() => fs.readFile(outside, "utf8"))).toBe("allowed-disabled")
      } finally {
        yield* Effect.promise(() => fs.rm(outside, { force: true }))
      }
    }),
  )

  it.instance("external profile still honors the active workspace sandbox boundary", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      const outside = outsideRepoFile("external")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      const active = turn(cwd, {
        permission_profile: { type: "external", network: "restricted" },
        active_permission_profile: { id: "external" },
      })
      const write = yield* initWrite()

      try {
        yield* expectFailure(
          write.execute({ filePath: outside, content: "blocked-external" }, ctx(active)),
          "Codex turn sandbox denied write access",
        )
        expect(fssync.existsSync(outside)).toBe(false)
      } finally {
        yield* Effect.promise(() => fs.rm(outside, { force: true }))
      }
    }),
  )

  it.instance("honors explicit glob deny entries in the turn permission profile", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      const active = turn(cwd, {
        permission_profile: {
          type: "managed",
          file_system: {
            type: "restricted",
            entries: [
              { path: { type: "special", value: "root" }, access: "write" },
              { path: { type: "glob", pattern: "**/secret.txt" }, access: "none" },
            ],
          },
          network: "restricted",
        },
      })
      const tool = yield* initWrite()

      yield* expectFailure(
        tool.execute({ filePath: path.join(cwd, "nested", "secret.txt"), content: "blocked" }, ctx(active)),
        "Codex turn sandbox denied write access",
      )
    }),
  )

  it.instance("runs bash inside a bubblewrap workspace sandbox on Linux", () =>
    Effect.gen(function* () {
      if (!canRunBwrapSandbox()) return
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      const outside = outsideRepoFile("outside-shell")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      Shell.acceptable.reset()
      const tool = yield* initShell()

      try {
        const result = yield* tool.execute(
          {
            command: `echo ok > inside-shell.txt; echo bad > ${JSON.stringify(outside)}`,
            description: "attempt outside write",
          },
          ctx(turn(cwd)),
        )

        expect(yield* Effect.promise(() => fs.readFile(path.join(cwd, "inside-shell.txt"), "utf8"))).toBe("ok\n")
        expect(fssync.existsSync(outside)).toBe(false)
        expect(result.metadata.exit).not.toBe(0)
      } finally {
        yield* Effect.promise(() => fs.rm(outside, { force: true }))
      }
    }),
  )

  it.instance("adds network isolation to bwrap when the turn network policy is restricted", () =>
    Effect.gen(function* () {
      if (!canRunBwrapSandbox()) return
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      const sandbox = yield* TurnSandbox.shellSandboxCommand(ctx(turn(cwd)), {
        shell: "bash",
        command: "true",
        cwd,
      })
      try {
        expect(sandbox?.mode).toBe("bwrap")
        const networkNamespaceAvailable = probeLinuxSandboxCapability().bwrap.networkNamespaceProbe.available
        if (networkNamespaceAvailable) expect(sandbox?.args).toContain("--unshare-net")
        else expect(sandbox?.args).not.toContain("--unshare-net")
      } finally {
        yield* TurnSandbox.cleanupShellSandboxCommand(sandbox)
      }
    }),
  )

  it.instance("does not add network isolation to bwrap when the turn network policy is enabled", () =>
    Effect.gen(function* () {
      if (!canRunBwrapSandbox()) return
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      const workspaceProfile = CodexTurn.workspacePermissionProfile(cwd)
      const active = turn(cwd, {
        sandbox_policy: {
          type: "workspace-write",
          writable_roots: [cwd],
          network_access: true,
          exclude_tmpdir_env_var: false,
          exclude_slash_tmp: false,
        },
        permission_profile: {
          type: "managed",
          file_system: workspaceProfile.type === "managed" ? workspaceProfile.file_system : { type: "unrestricted" },
          network: "enabled",
        },
      })
      const sandbox = yield* TurnSandbox.shellSandboxCommand(ctx(active), {
        shell: "bash",
        command: "true",
        cwd,
      })
      try {
        expect(sandbox?.mode).toBe("bwrap")
        expect(sandbox?.args).not.toContain("--unshare-net")
      } finally {
        yield* TurnSandbox.cleanupShellSandboxCommand(sandbox)
      }
    }),
  )

  it.instance("applies live Sandbox Control Center network changes to shell sandbox gates", () =>
    Effect.gen(function* () {
      if (!canRunBwrapSandbox()) return
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      const active = turn(cwd)
      SessionSecurity.update({
        sessionID: active.sessionID,
        cwd,
        patch: { networkAccess: true },
      })

      const sandbox = yield* TurnSandbox.shellSandboxCommand(ctx(active), {
        shell: "bash",
        command: "true",
        cwd,
      })
      try {
        expect(sandbox?.mode).toBe("bwrap")
        expect(sandbox?.args).not.toContain("--unshare-net")
      } finally {
        yield* TurnSandbox.cleanupShellSandboxCommand(sandbox)
        SessionSecurity.clearForTest()
      }
    }),
  )

  it.instance("applies live Sandbox Control Center permission profile changes to file writes", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      const active = turn(cwd)
      const tool = yield* initWrite()

      try {
        SessionSecurity.update({
          sessionID: active.sessionID,
          cwd,
          patch: { permissionProfileID: ":read-only" },
        })
        yield* expectFailure(
          tool.execute({ filePath: "blocked-by-live-profile.txt", content: "blocked" }, ctx(active)),
          "Codex turn sandbox denied write access",
        )

        SessionSecurity.update({
          sessionID: active.sessionID,
          cwd,
          patch: { permissionProfileID: ":workspace" },
        })
        yield* tool.execute({ filePath: "allowed-by-live-profile.txt", content: "ok" }, ctx(active))
        expect(yield* Effect.promise(() => fs.readFile(path.join(cwd, "allowed-by-live-profile.txt"), "utf8"))).toBe("ok")
      } finally {
        SessionSecurity.clearForTest()
      }
    }),
  )

  it.instance("prevents bash from creating missing protected metadata directories", () =>
    Effect.gen(function* () {
      if (!canRunBwrapSandbox()) return
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      Shell.acceptable.reset()
      const tool = yield* initShell()

      const result = yield* tool.execute(
        {
          command: "mkdir -p .git && echo unsafe > .git/config",
          description: "attempt metadata create",
        },
        ctx(turn(cwd)),
      )

      expect(fssync.existsSync(path.join(cwd, ".git"))).toBe(false)
      expect(result.metadata.exit).not.toBe(0)
    }),
  )

  it.instance("prevents bash mkdir mv cp hardlink and temp-file writes outside the workspace", () =>
    Effect.gen(function* () {
      if (!canRunBwrapSandbox()) return
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      const outside = outsideRepoFile("outside-primitives")
      const outsideDir = `${outside}-dir`
      const outsideCp = `${outside}-copy`
      const outsideLink = `${outside}-hardlink`
      const outsideTmp = `${outside}-tmp`
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      yield* Effect.promise(() => fs.writeFile(path.join(cwd, "inside-source.txt"), "inside"))
      Shell.acceptable.reset()
      const tool = yield* initShell()

      try {
        const result = yield* tool.execute(
          {
            command: [
              `mkdir -p ${JSON.stringify(outsideDir)}`,
              `mv inside-source.txt ${JSON.stringify(outside)}`,
              `cp /etc/hosts ${JSON.stringify(outsideCp)}`,
              `ln /etc/hosts ${JSON.stringify(outsideLink)}`,
              `printf bad > ${JSON.stringify(outsideTmp)}`,
            ].join("; "),
            description: "attempt outside write primitives",
          },
          ctx(turn(cwd)),
        )

        expect(result.metadata.exit).not.toBe(0)
        expect(fssync.existsSync(outside)).toBe(false)
        expect(fssync.existsSync(outsideDir)).toBe(false)
        expect(fssync.existsSync(outsideCp)).toBe(false)
        expect(fssync.existsSync(outsideLink)).toBe(false)
        expect(fssync.existsSync(outsideTmp)).toBe(false)
      } finally {
        yield* Effect.promise(() =>
          Promise.all([
            fs.rm(outside, { force: true }),
            fs.rm(outsideDir, { recursive: true, force: true }),
            fs.rm(outsideCp, { force: true }),
            fs.rm(outsideLink, { force: true }),
            fs.rm(outsideTmp, { force: true }),
          ]),
        )
      }
    }),
  )

  it.instance("keeps missing protected metadata mounts stable across concurrent bash calls", () =>
    Effect.gen(function* () {
      if (!canRunBwrapSandbox()) return
      const test = yield* TestInstance
      const cwd = path.join(test.directory, "workspace")
      yield* Effect.promise(() => fs.mkdir(cwd, { recursive: true }))
      Shell.acceptable.reset()
      const tool = yield* initShell()
      const active = turn(cwd)

      const results = yield* Effect.all(
        [
          tool.execute({ command: "pwd", description: "print cwd" }, ctx(active)),
          tool.execute({ command: "ls -la", description: "list files" }, ctx(active)),
          tool.execute({ command: "cat missing.txt 2>/dev/null || true", description: "read optional file" }, ctx(active)),
        ],
        { concurrency: "unbounded" },
      )

      expect(results[0]?.metadata.exit).toBe(0)
      expect(results[1]?.metadata.exit).toBe(0)
      expect(results[1]?.metadata.output).not.toContain("Can't get type of source")
      expect(fssync.existsSync(path.join(cwd, ".git"))).toBe(false)
      expect(fssync.existsSync(path.join(cwd, ".agents"))).toBe(false)
      expect(fssync.existsSync(path.join(cwd, ".codex"))).toBe(false)
    }),
  )
})

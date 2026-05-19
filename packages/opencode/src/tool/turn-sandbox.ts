import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { AialraTurnTrace } from "@/session/turn-trace"
import type {
  PermissionProfile,
  PermissionProfileFileSystemEntry,
  SandboxPolicy,
  TurnContext,
} from "@/session/turn-context"
import type * as Tool from "./tool"
import { Shell } from "@/shell/shell"
import { Wildcard } from "@/util/wildcard"
import { probeLinuxSandboxCapability } from "./linux-sandbox-capability"

type FileAccess = "read" | "write" | "none"

export type ShellSandboxCommand = {
  program: string
  args: string[]
  mode: "none" | "bwrap"
  cleanupPaths?: string[]
}

const PROTECTED_WORKSPACE_NAMES = [".git", ".agents", ".codex"] as const

function normalize(file: string) {
  const resolved = path.resolve(file)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function contains(root: string, target: string) {
  const rel = path.relative(normalize(root), normalize(target))
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel))
}

function pathDepth(file: string) {
  return normalize(file).split(/[\\/]+/).filter(Boolean).length
}

function accessRank(access: FileAccess) {
  if (access === "none") return 2
  if (access === "write") return 1
  return 0
}

function turnCwd(turn: TurnContext) {
  return path.resolve(turn.cwd)
}

function workspaceRoots(turn: TurnContext) {
  const roots = new Set<string>([turnCwd(turn)])
  for (const env of turn.environments) roots.add(path.resolve(env.cwd))
  if (turn.sandbox_policy.type === "workspace-write") {
    for (const root of turn.sandbox_policy.writable_roots) roots.add(path.resolve(root))
  }
  return Array.from(roots)
}

function tmpdirRoots(turn: TurnContext) {
  const roots: string[] = []
  if (turn.sandbox_policy.type !== "workspace-write" || !turn.sandbox_policy.exclude_slash_tmp) {
    if (process.platform !== "win32") roots.push("/tmp")
  }
  if (turn.sandbox_policy.type !== "workspace-write" || !turn.sandbox_policy.exclude_tmpdir_env_var) {
    roots.push(os.tmpdir())
  }
  return Array.from(new Set(roots.map((item) => path.resolve(item))))
}

function resolveEntryPaths(entry: PermissionProfileFileSystemEntry, turn: TurnContext) {
  if (entry.path.type === "path") return [path.resolve(entry.path.path)]
  if (entry.path.type === "glob") return []
  switch (entry.path.value) {
    case "root":
      return [path.parse(turnCwd(turn)).root]
    case "workspace_roots":
      return workspaceRoots(turn)
    case "tmpdir":
      return [os.tmpdir()]
    case "slash_tmp":
      return process.platform === "win32" ? [] : ["/tmp"]
    case "minimal":
      return []
  }
}

function entriesFromSandboxPolicy(policy: SandboxPolicy, turn: TurnContext): PermissionProfileFileSystemEntry[] {
  switch (policy.type) {
    case "danger-full-access":
      return [{ path: { type: "special", value: "root" }, access: "write" }]
    case "read-only":
      return [{ path: { type: "special", value: "root" }, access: "read" }]
    case "external-sandbox":
      return []
    case "workspace-write": {
      const entries: PermissionProfileFileSystemEntry[] = [
        { path: { type: "special", value: "root" }, access: "read" },
        { path: { type: "special", value: "workspace_roots" }, access: "write" },
      ]
      if (!policy.exclude_slash_tmp) entries.push({ path: { type: "special", value: "slash_tmp" }, access: "write" })
      if (!policy.exclude_tmpdir_env_var) entries.push({ path: { type: "special", value: "tmpdir" }, access: "write" })
      for (const root of policy.writable_roots) entries.push({ path: { type: "path", path: root }, access: "write" })
      for (const root of workspaceRoots(turn)) {
        for (const name of PROTECTED_WORKSPACE_NAMES) {
          entries.push({ path: { type: "path", path: path.join(root, name) }, access: "read" })
        }
      }
      return entries
    }
  }
}

function fileSystemEntries(turn: TurnContext) {
  if (turn.permission_profile.type === "disabled") {
    return [{ path: { type: "special", value: "root" }, access: "write" }] satisfies PermissionProfileFileSystemEntry[]
  }
  if (turn.permission_profile.type === "external") return entriesFromSandboxPolicy(turn.sandbox_policy, turn)
  if (turn.permission_profile.file_system.type === "unrestricted") {
    return [{ path: { type: "special", value: "root" }, access: "write" }] satisfies PermissionProfileFileSystemEntry[]
  }
  return turn.permission_profile.file_system.entries.length
    ? turn.permission_profile.file_system.entries
    : entriesFromSandboxPolicy(turn.sandbox_policy, turn)
}

export function resolvePath(ctx: Tool.Context, input: string, fallbackCwd: string) {
  const base = ctx.turn ? turnCwd(ctx.turn) : fallbackCwd
  return path.isAbsolute(input) ? path.resolve(input) : path.resolve(base, input)
}

function resolveAccess(turn: TurnContext, target: string): FileAccess {
  const entries = fileSystemEntries(turn)
  let best: { access: FileAccess; depth: number; rank: number } | undefined
  for (const entry of entries) {
    if (entry.path.type === "glob") {
      const pattern = path.isAbsolute(entry.path.pattern)
        ? path.resolve(entry.path.pattern)
        : path.resolve(turnCwd(turn), entry.path.pattern)
      if (!Wildcard.match(normalize(target), normalize(pattern))) continue
      const candidate = { access: entry.access, depth: pathDepth(pattern), rank: accessRank(entry.access) }
      if (!best || candidate.depth > best.depth || (candidate.depth === best.depth && candidate.rank > best.rank)) {
        best = candidate
      }
      continue
    }
    for (const root of resolveEntryPaths(entry, turn)) {
      if (!contains(root, target)) continue
      const candidate = { access: entry.access, depth: pathDepth(root), rank: accessRank(entry.access) }
      if (!best || candidate.depth > best.depth || (candidate.depth === best.depth && candidate.rank > best.rank)) {
        best = candidate
      }
    }
  }
  return best?.access ?? "none"
}

function accessAllows(actual: FileAccess, requested: "read" | "write") {
  if (requested === "read") return actual !== "none"
  return actual === "write"
}

async function canonicalForAccess(target: string, operation: "read" | "write") {
  try {
    return path.resolve(await realpath(target))
  } catch {
    if (operation === "read") return path.resolve(target)
  }

  const missing: string[] = []
  let current = path.resolve(target)
  while (true) {
    try {
      const resolved = path.resolve(await realpath(current))
      return path.join(resolved, ...missing.reverse())
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.resolve(target)
      missing.push(path.basename(current))
      current = parent
    }
  }
}

function describePolicy(turn: TurnContext) {
  return `${turn.active_permission_profile.id}/${turn.sandbox_policy.type}`
}

function denyMessage(input: { operation: "read" | "write" | "shell"; target: string; turn: TurnContext }) {
  return `Codex turn sandbox denied ${input.operation} access to ${input.target}. Active policy: ${describePolicy(input.turn)}.`
}

export const assertFileAccess = Effect.fn("TurnSandbox.assertFileAccess")(function* (
  ctx: Tool.Context,
  operation: "read" | "write",
  target: string,
) {
  const turn = ctx.turn
  if (!turn) return
  const canonical = yield* Effect.promise(() => canonicalForAccess(target, operation))
  const actual = resolveAccess(turn, target)
  const canonicalAccess = resolveAccess(turn, canonical)
  const allowed = accessAllows(actual, operation) && accessAllows(canonicalAccess, operation)
  yield* AialraTurnTrace.emit({
    phase: allowed ? "tool.sandbox.checked" : "tool.sandbox.denied",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: ctx.extra?.["tool"],
      operation,
      target,
      canonicalTarget: canonical === target ? undefined : canonical,
      resolvedAccess: actual,
      canonicalAccess,
      sandbox_policy: turn.sandbox_policy.type,
      active_permission_profile: turn.active_permission_profile,
    },
  })
  if (!allowed) {
    return yield* Effect.die(new Error(denyMessage({ operation, target, turn })))
  }
})

export const assertShellAccess = Effect.fn("TurnSandbox.assertShellAccess")(function* (
  ctx: Tool.Context,
  input: { cwd: string; command: string },
) {
  const turn = ctx.turn
  if (!turn) return
  const actual = resolveAccess(turn, input.cwd)
  if (actual === "none") {
    yield* AialraTurnTrace.emit({
      phase: "tool.sandbox.denied",
      turnID: turn.turnID,
      sessionID: turn.sessionID,
      messageID: ctx.messageID,
      data: {
        tool: "bash",
        operation: "shell",
        target: input.cwd,
        resolvedAccess: actual,
        sandbox_policy: turn.sandbox_policy.type,
        active_permission_profile: turn.active_permission_profile,
      },
    })
    return yield* Effect.die(new Error(denyMessage({ operation: "shell", target: input.cwd, turn })))
  }
})

function networkAllowed(turn: TurnContext) {
  if (turn.permission_profile.type === "disabled") return true
  if (turn.permission_profile.type === "external") return turn.permission_profile.network === "enabled"
  if (turn.permission_profile.network === "enabled") return true
  if (turn.sandbox_policy.type === "danger-full-access") return true
  if (turn.sandbox_policy.type === "external-sandbox") return turn.sandbox_policy.network_access === "enabled"
  return turn.sandbox_policy.network_access
}

function bubblewrapProgram() {
  if (process.platform !== "linux") return
  const capability = probeLinuxSandboxCapability()
  if (!capability.bwrap.available) return
  return capability.bwrap.path
}

function bindExisting(args: string[], mode: "--bind" | "--ro-bind", source: string, dest = source) {
  const result = Bun.spawnSync(["test", "-e", source], { stdout: "ignore", stderr: "ignore" })
  if (result.exitCode === 0) args.push(mode, source, dest)
  else {
    // Missing read-only carveouts are enforced by direct file checks. bwrap can
    // only overmount paths that exist at spawn time.
  }
}

async function protectedMetadataMounts(turn: TurnContext) {
  const mounts: Array<{ source: string; dest: string; cleanup?: string[] }> = []
  for (const root of workspaceRoots(turn)) {
    for (const name of PROTECTED_WORKSPACE_NAMES) {
      const dest = path.join(root, name)
      const exists = Bun.spawnSync(["test", "-e", dest], { stdout: "ignore", stderr: "ignore" }).exitCode === 0
      if (exists) {
        mounts.push({ source: dest, dest })
        continue
      }

      // Codex protects missing .git/.agents/.codex with protected-create
      // targets. Plain bwrap has no direct protected-create primitive, so we
      // mount an empty read-only directory over the missing path. This prevents
      // sandboxed bash from creating that metadata path during the command.
      const source = await mkdtemp(path.join(os.tmpdir(), "aialra-protected-metadata-"))
      mounts.push({ source, dest, cleanup: [source, dest] })
    }
  }
  return mounts
}

function writableRoots(turn: TurnContext) {
  const roots = new Set<string>()
  for (const root of workspaceRoots(turn)) roots.add(path.resolve(root))
  for (const root of tmpdirRoots(turn)) roots.add(path.resolve(root))
  for (const entry of fileSystemEntries(turn)) {
    if (entry.access !== "write") continue
    for (const root of resolveEntryPaths(entry, turn)) roots.add(path.resolve(root))
  }
  return Array.from(roots).filter((root) => path.isAbsolute(root))
}

export const shellSandboxCommand = Effect.fn("TurnSandbox.shellSandboxCommand")(function* (
  ctx: Tool.Context,
  input: { shell: string; command: string; cwd: string },
) {
  const turn = ctx.turn
  if (!turn) return undefined
  yield* assertShellAccess(ctx, { cwd: input.cwd, command: input.command })
  if (turn.permission_profile.type === "disabled" || turn.sandbox_policy.type === "danger-full-access") {
    return undefined
  }
  const capability = probeLinuxSandboxCapability()
  const bwrap = bubblewrapProgram()
  yield* AialraTurnTrace.emit({
    phase: "tool.sandbox.capability",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: "bash",
      backend: "bwrap",
      bwrap: {
        available: capability.bwrap.available,
        path: capability.bwrap.path,
        version: capability.bwrap.version,
        supports: capability.bwrap.supports,
        userNamespace: {
          available: capability.bwrap.userNamespaceProbe.available,
          error: capability.bwrap.userNamespaceProbe.error,
        },
        mountProc: {
          available: capability.bwrap.mountProcProbe.available,
          error: capability.bwrap.mountProcProbe.error,
        },
      },
      codex: {
        cli: capability.codex.cli.available,
        execServer: capability.codex.execServer.available,
        linuxSandbox: capability.codex.linuxSandbox.available,
      },
      landlock: capability.kernel,
      notes: capability.notes,
    },
  })

  if (!bwrap) {
    if (turn.approval_policy === "never") {
      return yield* Effect.die(new Error("Codex turn sandbox requires bubblewrap on Linux, but bwrap is unavailable."))
    }
    return undefined
  }

  const args = [
    "--new-session",
    "--die-with-parent",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
  ]
  if (capability.bwrap.mountProcProbe.available) args.push("--proc", "/proc")
  if (!networkAllowed(turn)) args.splice(3, 0, "--unshare-net")

  for (const root of writableRoots(turn)) {
    bindExisting(args, "--bind", root)
  }

  const protectedMounts = yield* Effect.promise(() => protectedMetadataMounts(turn))
  for (const mount of protectedMounts) {
    args.push("--ro-bind", mount.source, mount.dest)
  }

  args.push("--chdir", input.cwd, "--", input.shell, ...Shell.args(input.shell, input.command, input.cwd))
  yield* AialraTurnTrace.emit({
    phase: "tool.sandbox.checked",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: "bash",
      operation: "shell",
      target: input.cwd,
      sandbox: "bwrap",
      network: networkAllowed(turn) ? "enabled" : "restricted",
      writableRoots: writableRoots(turn),
      protectedMetadataMounts: protectedMounts.map((mount) => ({
        dest: mount.dest,
        synthetic: !!mount.cleanup,
      })),
    },
  })
  return {
    program: bwrap,
    args,
    mode: "bwrap",
    cleanupPaths: protectedMounts.flatMap((mount) => mount.cleanup ?? []),
  } satisfies ShellSandboxCommand
})

export const cleanupShellSandboxCommand = Effect.fn("TurnSandbox.cleanupShellSandboxCommand")(function* (
  sandbox: ShellSandboxCommand | undefined,
) {
  for (const item of sandbox?.cleanupPaths ?? []) {
    yield* Effect.promise(() => rm(item, { recursive: true, force: true })).pipe(Effect.ignore)
  }
})

export function protectableMetadataPath(turn: TurnContext, target: string) {
  for (const root of workspaceRoots(turn)) {
    for (const name of PROTECTED_WORKSPACE_NAMES) {
      const protectedPath = path.join(root, name)
      if (contains(protectedPath, target)) return protectedPath
    }
  }
}

export const assertWritableParentExists = Effect.fn("TurnSandbox.assertWritableParentExists")(function* (
  ctx: Tool.Context,
  target: string,
) {
  const turn = ctx.turn
  if (!turn) return
  // The underlying tool will create parents or surface a normal filesystem
  // error. The sandbox decision is based on the intended target path.
  yield* assertFileAccess(ctx, "write", target)
})

export * as TurnSandbox from "./turn-sandbox"

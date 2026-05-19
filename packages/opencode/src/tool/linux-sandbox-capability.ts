import fs from "node:fs"
import os from "node:os"

type CommandProbe = {
  available: boolean
  path?: string
  stdout?: string
  stderr?: string
  exitCode?: number | null
  error?: string
}

export type LinuxSandboxCapability = {
  platform: NodeJS.Platform
  kernel: {
    release: string
    landlockLikelyAvailable: boolean
    landlockProbe: "kernel-version-only" | "unsupported-platform"
  }
  bwrap: CommandProbe & {
    version?: string
    supports: {
      argv0: boolean
      perms: boolean
      newSession: boolean
      dieWithParent: boolean
      unshareUser: boolean
      unsharePid: boolean
      unshareNet: boolean
      proc: boolean
      dev: boolean
    }
    userNamespaceProbe: CommandProbe
    networkNamespaceProbe: CommandProbe
    mountProcProbe: CommandProbe
  }
  codex: {
    cli: CommandProbe
    execServer: CommandProbe
    linuxSandbox: CommandProbe
  }
  notes: string[]
}

let cached: LinuxSandboxCapability | undefined

function run(argv: string[], opts: { timeoutMs?: number } = {}): CommandProbe {
  try {
    const result = Bun.spawnSync(argv, {
      stdout: "pipe",
      stderr: "pipe",
      timeout: opts.timeoutMs ?? 5_000,
    })
    const stdout = result.stdout ? Buffer.from(result.stdout).toString("utf8") : ""
    const stderr = result.stderr ? Buffer.from(result.stderr).toString("utf8") : ""
    return {
      available: result.exitCode === 0,
      path: argv[0],
      stdout,
      stderr,
      exitCode: result.exitCode,
      error: result.exitCode === 0 ? undefined : stderr.trim() || stdout.trim() || `exit ${result.exitCode}`,
    }
  } catch (error) {
    return {
      available: false,
      path: argv[0],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function which(name: string) {
  return Bun.which(name) ?? undefined
}

function kernelSupportsLandlock(release: string) {
  const match = release.match(/^(\d+)\.(\d+)/)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 5 || (major === 5 && minor >= 13)
}

function bwrapProbe(path: string | undefined) {
  const missing = {
    available: false,
    supports: {
      argv0: false,
      perms: false,
      newSession: false,
      dieWithParent: false,
      unshareUser: false,
      unsharePid: false,
      unshareNet: false,
      proc: false,
      dev: false,
    },
    userNamespaceProbe: { available: false, error: "bwrap not found" },
    networkNamespaceProbe: { available: false, error: "bwrap not found" },
    mountProcProbe: { available: false, error: "bwrap not found" },
  } satisfies LinuxSandboxCapability["bwrap"]

  if (!path) return missing
  const version = run([path, "--version"])
  const help = run([path, "--help"])
  const text = `${help.stdout ?? ""}\n${help.stderr ?? ""}`
  const userNamespaceProbe = run(
    [
      path,
      "--new-session",
      "--die-with-parent",
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--unshare-user",
      "--unshare-pid",
      "--",
      "/bin/true",
    ],
    { timeoutMs: 5_000 },
  )
  const mountProcProbe = run(
    [
      path,
      "--new-session",
      "--die-with-parent",
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--unshare-user",
      "--unshare-pid",
      "--proc",
      "/proc",
      "--",
      "/bin/true",
    ],
    { timeoutMs: 5_000 },
  )
  const networkNamespaceProbe = run(
    [
      path,
      "--new-session",
      "--die-with-parent",
      "--ro-bind",
      "/",
      "/",
      "--dev",
      "/dev",
      "--unshare-user",
      "--unshare-pid",
      "--unshare-net",
      "--",
      "/bin/true",
    ],
    { timeoutMs: 5_000 },
  )

  return {
    available: version.exitCode === 0 && help.exitCode === 0,
    path,
    stdout: version.stdout,
    stderr: version.stderr,
    exitCode: version.exitCode,
    error: version.error ?? help.error,
    version: (version.stdout || version.stderr || "").trim(),
    supports: {
      argv0: text.includes("--argv0"),
      perms: text.includes("--perms"),
      newSession: text.includes("--new-session"),
      dieWithParent: text.includes("--die-with-parent"),
      unshareUser: text.includes("--unshare-user"),
      unsharePid: text.includes("--unshare-pid"),
      unshareNet: text.includes("--unshare-net"),
      proc: text.includes("--proc"),
      dev: text.includes("--dev"),
    },
    userNamespaceProbe,
    networkNamespaceProbe,
    mountProcProbe,
  } satisfies LinuxSandboxCapability["bwrap"]
}

export function probeLinuxSandboxCapability(input?: { refresh?: boolean }): LinuxSandboxCapability {
  if (cached && !input?.refresh) return cached

  const platform = process.platform
  const release = os.release()
  const bwrap = bwrapProbe(which("bwrap") ?? (fs.existsSync("/usr/bin/bwrap") ? "/usr/bin/bwrap" : undefined))
  const codexPath = which("codex")
  const codexCli = codexPath ? run([codexPath, "--version"]) : { available: false, error: "codex not found" }
  const execServer = codexPath
    ? run([codexPath, "exec-server", "--help"])
    : { available: false, error: "codex not found" }
  const linuxSandbox = codexPath
    ? run([codexPath, "sandbox", "linux", "--help"])
    : { available: false, error: "codex not found" }

  const notes: string[] = []
  if (platform !== "linux") notes.push("Linux sandbox probes are informational on non-Linux platforms.")
  if (platform === "linux" && !bwrap.available) notes.push("bubblewrap is not available; managed Linux shell sandboxing must fail closed when approval_policy is never.")
  if (bwrap.available && !bwrap.supports.perms) notes.push("System bubblewrap does not report --perms support; Codex would prefer bundled/runtime-managed bubblewrap.")
  if (bwrap.available && !bwrap.userNamespaceProbe.available) notes.push("bubblewrap exists but could not create the user/pid namespace in this container.")
  if (bwrap.available && !bwrap.networkNamespaceProbe.available) notes.push("bubblewrap exists but could not create the network namespace in this container; OpenCode will omit --unshare-net and report the degraded network sandbox capability.")
  if (bwrap.available && !bwrap.mountProcProbe.available) notes.push("bubblewrap cannot mount /proc in this container; OpenCode will skip --proc like Codex's restrictive-container compatibility path.")
  notes.push("Landlock is only kernel-version probed here; exact ABI enforcement requires the Codex Rust helper or a native syscall probe.")

  cached = {
    platform,
    kernel: {
      release,
      landlockLikelyAvailable: platform === "linux" && kernelSupportsLandlock(release),
      landlockProbe: platform === "linux" ? "kernel-version-only" : "unsupported-platform",
    },
    bwrap,
    codex: {
      cli: { ...codexCli, path: codexPath },
      execServer: { ...execServer, path: codexPath },
      linuxSandbox: { ...linuxSandbox, path: codexPath },
    },
    notes,
  }
  return cached
}

import fs from "node:fs"
import os from "node:os"
import { landlockHelperStatus } from "./landlock-helper"

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
    landlockProbe: "sysfs-and-lsm" | "unsupported-platform"
    lsmRaw?: string
    lsmEnabled: boolean
    abi?: number
    abiError?: string
    enforcePoC: CommandProbe
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
      unshareIpc: boolean
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

export type LinuxSandboxHelperReport = {
  version: "aialra.linux_sandbox_helper.v1"
  platform: NodeJS.Platform
  backend: "bwrap" | "none"
  helper: "system-bwrap" | "unavailable"
  helperVersion?: string
  executable?: string
  mode: "enforced" | "degraded" | "disabled"
  restrictions: {
    filesystem: boolean
    network: boolean
    user_namespace: boolean
    pid_namespace: boolean
    ipc_namespace: boolean
    mount_proc: boolean
    dev_bind: boolean
    protected_create: boolean
    no_new_privs: boolean
    seccomp: boolean
    landlock: boolean
  }
  seccomp?: {
    version: "aialra.seccomp_profile.v1"
    mode: "disabled" | "restricted" | "network-off"
    no_new_privs: boolean
    enforcement: "helper" | "unavailable"
    denies: string[]
  }
  codex: {
    cli: boolean
    exec_server: boolean
    linux_sandbox: boolean
  }
  degradedReasons: string[]
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

function readText(file: string) {
  try {
    return fs.readFileSync(file, "utf8").trim()
  } catch {
    return undefined
  }
}

function landlockProbe(platform: NodeJS.Platform) {
  if (platform !== "linux") {
    return {
      lsmRaw: undefined,
      lsmEnabled: false,
      abi: undefined,
      abiError: "unsupported platform",
      enforcePoC: { available: false, error: "unsupported platform" },
    }
  }
  const lsmRaw = readText("/sys/kernel/security/lsm")
  const helper = landlockHelperStatus()
  const abiRaw = readText("/sys/kernel/security/landlock/abi")
  const abi = abiRaw ? Number(abiRaw) : helper.abi
  return {
    lsmRaw,
    lsmEnabled: lsmRaw?.split(",").includes("landlock") ?? false,
    abi: Number.isFinite(abi) ? abi : undefined,
    abiError: abiRaw || helper.abi ? undefined : "missing /sys/kernel/security/landlock/abi and helper syscall probe ABI",
    enforcePoC: helper.available
      ? { available: true, path: helper.path }
      : { available: false, path: helper.path, error: helper.error ?? "Landlock helper unavailable" },
  }
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
      unshareIpc: false,
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
      unshareIpc: text.includes("--unshare-ipc"),
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
    ? run([codexPath, "sandbox", "--help"])
    : { available: false, error: "codex not found" }
  const landlock = landlockProbe(platform)

  const notes: string[] = []
  if (platform !== "linux") notes.push("Linux sandbox probes are informational on non-Linux platforms.")
  if (platform === "linux" && !bwrap.available) notes.push("bubblewrap is not available; managed Linux shell sandboxing must fail closed when approval_policy is never.")
  if (bwrap.available && !bwrap.supports.perms) notes.push("System bubblewrap does not report --perms support; Codex would prefer bundled/runtime-managed bubblewrap.")
  if (bwrap.available && !bwrap.userNamespaceProbe.available) notes.push("bubblewrap exists but could not create the user/pid namespace in this container.")
  if (bwrap.available && !bwrap.networkNamespaceProbe.available) notes.push("bubblewrap exists but could not create the network namespace in this container; OpenCode will omit --unshare-net and report the degraded network sandbox capability.")
  if (bwrap.available && !bwrap.mountProcProbe.available) notes.push("bubblewrap cannot mount /proc in this container; OpenCode will skip --proc like Codex's restrictive-container compatibility path.")
  if (platform === "linux" && !landlock.lsmEnabled) notes.push("Landlock is not listed in /sys/kernel/security/lsm; syscall-level file access enforcement is unavailable in this kernel configuration.")
  if (platform === "linux" && landlock.lsmEnabled && !landlock.abi) notes.push("Landlock is listed as an LSM, but neither sysfs nor the helper syscall probe returned an ABI version.")
  if (platform === "linux" && landlock.enforcePoC.available) notes.push("AIALRA Landlock helper passed an enforce probe and can add syscall-level file access restrictions for shell commands.")
  if (platform === "linux" && !landlock.enforcePoC.available) notes.push("AIALRA currently relies on bwrap and exec-server gates because Landlock enforcement is unavailable.")

  cached = {
    platform,
    kernel: {
      release,
      landlockLikelyAvailable: platform === "linux" && kernelSupportsLandlock(release),
      landlockProbe: platform === "linux" ? "sysfs-and-lsm" : "unsupported-platform",
      ...landlock,
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

export function linuxSandboxHelperReport(input: {
  capability?: LinuxSandboxCapability
  bwrapSelected: boolean
  networkIsolated: boolean
  protectedCreate: boolean
  landlockEnforced?: boolean
  seccompProfile?: "none" | "restricted" | "network-off"
}): LinuxSandboxHelperReport {
  const capability = input.capability ?? probeLinuxSandboxCapability()
  const seccompProfile = input.seccompProfile ?? "none"
  const degradedReasons = [
    ...capability.notes,
    ...(input.landlockEnforced
      ? []
      : capability.kernel.enforcePoC.available
        ? ["Landlock helper is available but was not applied to this command"]
        : [`Landlock enforce unavailable: ${capability.kernel.enforcePoC.error ?? "not available"}`]),
    ...(input.landlockEnforced ? [] : ["no_new_privs is not enforced by the current Node/Bun helper path; REQ-059 tracks this gap"]),
    ...(seccompProfile === "none" ? ["seccomp is not enforced for this command"] : []),
  ]
  if (process.platform !== "linux") {
    return {
      version: "aialra.linux_sandbox_helper.v1",
      platform: capability.platform,
      backend: "none",
      helper: "unavailable",
      mode: "disabled",
      restrictions: {
        filesystem: false,
        network: false,
        user_namespace: false,
        pid_namespace: false,
        ipc_namespace: false,
        mount_proc: false,
        dev_bind: false,
        protected_create: false,
        no_new_privs: false,
        seccomp: false,
        landlock: false,
      },
      seccomp: {
        version: "aialra.seccomp_profile.v1",
        mode: "disabled",
        no_new_privs: false,
        enforcement: "unavailable",
        denies: [],
      },
      codex: {
        cli: capability.codex.cli.available,
        exec_server: capability.codex.execServer.available,
        linux_sandbox: capability.codex.linuxSandbox.available,
      },
      degradedReasons,
    }
  }
  if (!input.bwrapSelected) {
    return {
      version: "aialra.linux_sandbox_helper.v1",
      platform: capability.platform,
      backend: "none",
      helper: "unavailable",
      mode: "disabled",
      restrictions: {
        filesystem: false,
        network: false,
        user_namespace: false,
        pid_namespace: false,
        ipc_namespace: false,
        mount_proc: false,
        dev_bind: false,
        protected_create: false,
        no_new_privs: false,
        seccomp: false,
        landlock: false,
      },
      seccomp: {
        version: "aialra.seccomp_profile.v1",
        mode: "disabled",
        no_new_privs: false,
        enforcement: "unavailable",
        denies: [],
      },
      codex: {
        cli: capability.codex.cli.available,
        exec_server: capability.codex.execServer.available,
        linux_sandbox: capability.codex.linuxSandbox.available,
      },
      degradedReasons,
    }
  }
  return {
    version: "aialra.linux_sandbox_helper.v1",
    platform: capability.platform,
    backend: "bwrap",
    helper: "system-bwrap",
    helperVersion: capability.bwrap.version,
    executable: capability.bwrap.path,
    mode:
      capability.bwrap.userNamespaceProbe.available &&
      capability.bwrap.mountProcProbe.available &&
      !degradedReasons.length
        ? "enforced"
        : "degraded",
    restrictions: {
      filesystem: true,
      network: input.networkIsolated,
      user_namespace: capability.bwrap.userNamespaceProbe.available,
      pid_namespace: capability.bwrap.supports.unsharePid,
      ipc_namespace: capability.bwrap.supports.unshareIpc,
      mount_proc: capability.bwrap.mountProcProbe.available,
      dev_bind: capability.bwrap.supports.dev,
      protected_create: input.protectedCreate,
      no_new_privs: input.landlockEnforced ?? false,
      seccomp: seccompProfile !== "none",
      landlock: input.landlockEnforced ?? false,
    },
    seccomp: {
      version: "aialra.seccomp_profile.v1",
      mode: seccompProfile === "none" ? "disabled" : seccompProfile,
      no_new_privs: (input.landlockEnforced ?? false) || seccompProfile !== "none",
      enforcement: seccompProfile === "none" ? "unavailable" : "helper",
      denies:
        seccompProfile === "none"
          ? []
          : [
              "ptrace",
              "process_vm_readv",
              "process_vm_writev",
              "io_uring",
              "mount",
              "umount2",
              "pivot_root",
              "chroot",
              "unshare",
              "setns",
              "keyring",
              "bpf",
              "perf_event_open",
              "kernel_module",
              "kexec",
              "userfaultfd",
              "open_by_handle_at",
              "fanotify_init",
              ...(seccompProfile === "network-off" ? ["ip_socket", "connect", "bind", "listen", "sendto", "socket_options"] : ["packet_socket"]),
            ],
    },
    codex: {
      cli: capability.codex.cli.available,
      exec_server: capability.codex.execServer.available,
      linux_sandbox: capability.codex.linuxSandbox.available,
    },
    degradedReasons,
  }
}

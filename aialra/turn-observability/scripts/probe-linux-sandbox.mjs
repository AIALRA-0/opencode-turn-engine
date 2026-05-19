#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawnSync } from "node:child_process"

function run(argv, timeout = 5000) {
  const result = spawnSync(argv[0], argv.slice(1), {
    encoding: "utf8",
    timeout,
  })
  return {
    available: result.status === 0,
    path: argv[0],
    exitCode: result.status,
    stdout: result.stdout?.trim() || "",
    stderr: result.stderr?.trim() || "",
    error: result.error?.message || (result.status === 0 ? undefined : result.stderr?.trim() || result.stdout?.trim()),
  }
}

function which(name) {
  const result = spawnSync("bash", ["-lc", `command -v ${name}`], { encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() : undefined
}

function codexBinary() {
  const candidates = [
    process.env.AIALRA_CODEX_EXEC_SERVER_BIN,
    process.env.AIALRA_CODEX_BIN,
    path.join("/srv", "aialra", "apps", "codex-turn-engine", "codex-rs", "target", "debug", "codex"),
    which("codex"),
  ].filter(Boolean)
  return candidates.find((candidate) => existsSync(candidate))
}

function kernelLikelySupportsLandlock(release) {
  const match = release.match(/^(\d+)\.(\d+)/)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 5 || (major === 5 && minor >= 13)
}

function landlockKernelConfig() {
  const candidates = [`/boot/config-${os.release()}`, "/proc/config.gz"]
  for (const file of candidates) {
    if (!existsSync(file)) continue
    if (file.endsWith(".gz")) continue
    const text = readFileSync(file, "utf8")
    const enabled = /^CONFIG_SECURITY_LANDLOCK=y$/m.test(text)
    return {
      source: file,
      enabled,
      lsmOrder: text.match(/^CONFIG_LSM="([^"]+)"/m)?.[1],
    }
  }
  return {
    source: undefined,
    enabled: undefined,
    lsmOrder: undefined,
  }
}

function codexLinuxSandboxEnforcementProbe(codexPath) {
  if (!codexPath) return { available: false, error: "codex binary not found" }
  const parent = process.env.AIALRA_SANDBOX_PROBE_ROOT ?? "/srv/aialra/tmp"
  mkdirSync(parent, { recursive: true })
  const root = mkdtempSync(path.join(parent, "aialra-codex-sandbox-probe-"))
  const cwd = path.join(root, "workspace")
  const outside = path.join(root, "outside.txt")
  mkdirSync(cwd, { recursive: true })
  try {
    const result = spawnSync(
      codexPath,
      [
        "sandbox",
        "linux",
        "--permissions-profile",
        ":workspace",
        "-C",
        cwd,
        "--",
        "/bin/sh",
        "-lc",
        'echo inside > inside.txt; echo outside > "$1"',
        "probe",
        outside,
      ],
      { encoding: "utf8", timeout: 10_000 },
    )
    const insidePath = path.join(cwd, "inside.txt")
    return {
      available: true,
      codexPath,
      cwd,
      exitCode: result.status,
      insideWritten: existsSync(insidePath),
      outsideWritten: existsSync(outside),
      enforcedWorkspaceWrite: existsSync(insidePath) && !existsSync(outside),
      stdout: result.stdout?.trim() || "",
      stderr: result.stderr?.trim() || "",
      error: result.error?.message,
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

const bwrap = which("bwrap")
const codex = codexBinary()
const help = bwrap ? run([bwrap, "--help"]) : { available: false, error: "bwrap not found" }
const helpText = `${help.stdout}\n${help.stderr}`
const status = existsSync("/proc/self/status") ? readFileSync("/proc/self/status", "utf8") : ""
const unprivilegedUserns = existsSync("/proc/sys/kernel/unprivileged_userns_clone")
  ? readFileSync("/proc/sys/kernel/unprivileged_userns_clone", "utf8").trim()
  : undefined
const landlockConfig = landlockKernelConfig()

const report = {
  schema: "aialra.linux_sandbox_capability.v1",
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  kernel: {
    release: os.release(),
    landlockLikelyAvailable: process.platform === "linux" && kernelLikelySupportsLandlock(os.release()),
    landlockProbe: "kernel-version-and-config-only",
    landlockKernelConfig: landlockConfig,
  },
  process: {
    noNewPrivs: status.match(/^NoNewPrivs:\s+(\d+)/m)?.[1],
    seccomp: status.match(/^Seccomp:\s+(\d+)/m)?.[1],
    unprivilegedUsernsClone: unprivilegedUserns,
  },
  bwrap: {
    path: bwrap,
    version: bwrap ? run([bwrap, "--version"]).stdout : undefined,
    helpAvailable: help.available,
    supports: {
      argv0: helpText.includes("--argv0"),
      perms: helpText.includes("--perms"),
      newSession: helpText.includes("--new-session"),
      dieWithParent: helpText.includes("--die-with-parent"),
      unshareUser: helpText.includes("--unshare-user"),
      unsharePid: helpText.includes("--unshare-pid"),
      unshareNet: helpText.includes("--unshare-net"),
      proc: helpText.includes("--proc"),
      dev: helpText.includes("--dev"),
    },
    userNamespaceProbe: bwrap
      ? run([
          bwrap,
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
        ])
      : { available: false, error: "bwrap not found" },
    mountProcProbe: bwrap
      ? run([
          bwrap,
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
        ])
      : { available: false, error: "bwrap not found" },
  },
  codex: {
    path: codex,
    version: codex ? run([codex, "--version"]).stdout : undefined,
    execServer: codex ? run([codex, "exec-server", "--help"]).available : false,
    linuxSandbox: codex ? run([codex, "sandbox", "linux", "--help"]).available : false,
    linuxSandboxWorkspaceProbe: codexLinuxSandboxEnforcementProbe(codex),
  },
  notes: [
    "Landlock ABI is not applied by this Node script; exact syscall-level Landlock enforcement still requires Codex Rust linux-sandbox or a native syscall probe.",
    "codex.linuxSandboxWorkspaceProbe is an actual write test: inside the workspace should be writable, outside the workspace should remain missing.",
    "A failed bwrap user namespace probe means managed Linux sandboxing must fail closed under approval_policy=never.",
  ],
}

console.log(JSON.stringify(report, null, 2))

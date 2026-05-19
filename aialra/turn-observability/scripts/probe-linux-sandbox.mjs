#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs"
import os from "node:os"
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

function kernelLikelySupportsLandlock(release) {
  const match = release.match(/^(\d+)\.(\d+)/)
  if (!match) return false
  const major = Number(match[1])
  const minor = Number(match[2])
  return major > 5 || (major === 5 && minor >= 13)
}

const bwrap = which("bwrap")
const codex = which("codex")
const help = bwrap ? run([bwrap, "--help"]) : { available: false, error: "bwrap not found" }
const helpText = `${help.stdout}\n${help.stderr}`
const status = existsSync("/proc/self/status") ? readFileSync("/proc/self/status", "utf8") : ""
const unprivilegedUserns = existsSync("/proc/sys/kernel/unprivileged_userns_clone")
  ? readFileSync("/proc/sys/kernel/unprivileged_userns_clone", "utf8").trim()
  : undefined

const report = {
  schema: "aialra.linux_sandbox_capability.v1",
  generatedAt: new Date().toISOString(),
  platform: process.platform,
  kernel: {
    release: os.release(),
    landlockLikelyAvailable: process.platform === "linux" && kernelLikelySupportsLandlock(os.release()),
    landlockProbe: "kernel-version-only",
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
  },
  notes: [
    "Landlock ABI is not applied by this Node script; exact enforcement requires Codex Rust linux-sandbox or a native syscall probe.",
    "A failed bwrap user namespace probe means managed Linux sandboxing must fail closed under approval_policy=never.",
  ],
}

console.log(JSON.stringify(report, null, 2))

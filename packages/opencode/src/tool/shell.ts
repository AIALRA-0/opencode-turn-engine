import { Cause, Effect, Exit, Stream } from "effect"
import os from "os"
import { createWriteStream } from "node:fs"
import * as Tool from "./tool"
import path from "path"
import * as Log from "@opencode-ai/core/util/log"
import { containsPath, type InstanceContext } from "../project/instance-context"
import { InstanceState } from "@/effect/instance-state"
import { lazy } from "@/util/lazy"
import { Language, type Node } from "web-tree-sitter"

import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { fileURLToPath } from "url"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Shell } from "@/shell/shell"
import { ShellID } from "./shell/id"
import { SessionSecurity } from "@/session/security"
import { CodexTurn } from "@/session/turn-context"

import * as Truncate from "./truncate"
import { Plugin } from "@/plugin"
import { ChildProcess } from "effect/unstable/process"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { ShellPrompt, type Parameters } from "./shell/prompt"
import { BashArity } from "@/permission/arity"
import { TurnSandbox, type ShellSandboxCommand } from "./turn-sandbox"
import { CodexExecServer } from "./codex-exec-server"
import { AialraTurnTrace } from "@/session/turn-trace"
import { EngineeringHarness } from "@/session/engineering"
import { AbortAudit } from "@/session/abort-audit"
import { ExecCommand, type ExecCommandBackend } from "@/session/exec-command"
import { ExecApproval } from "@/session/exec-approval"
import { ExecProcessRegistry, type ExecProcessRuntime, type ExecProcessStatus } from "@/session/exec-process-registry"

export { Parameters } from "./shell/prompt"

const MAX_METADATA_LENGTH = 30_000
const CWD = new Set(["cd", "chdir", "popd", "pushd", "push-location", "set-location"])
const FILES = new Set([
  ...CWD,
  "rm",
  "cp",
  "mv",
  "mkdir",
  "touch",
  "chmod",
  "chown",
  "cat",
  // Leave PowerShell aliases out for now. Common ones like cat/cp/mv/rm/mkdir
  // already hit the entries above, and alias normalization should happen in one
  // place later so we do not risk double-prompting.
  "get-content",
  "set-content",
  "add-content",
  "copy-item",
  "move-item",
  "remove-item",
  "new-item",
  "rename-item",
])
const CMD_FILES = new Set([
  "copy",
  "del",
  "dir",
  "erase",
  "md",
  "mkdir",
  "move",
  "rd",
  "ren",
  "rename",
  "rmdir",
  "type",
])
const FLAGS = new Set(["-destination", "-literalpath", "-path"])
const SWITCHES = new Set(["-confirm", "-debug", "-force", "-nonewline", "-recurse", "-verbose", "-whatif"])

type Part = {
  type: string
  text: string
}

type Scan = {
  dirs: Set<string>
  patterns: Set<string>
  always: Set<string>
}

type Chunk = {
  text: string
  size: number
}

export const log = Log.create({ service: "shell-tool" })

const resolveWasm = (asset: string) => {
  if (asset.startsWith("file://")) return fileURLToPath(asset)
  if (asset.startsWith("/") || /^[a-z]:/i.test(asset)) return asset
  const url = new URL(asset, import.meta.url)
  return fileURLToPath(url)
}

function parts(node: Node) {
  const out: Part[] = []
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)
    if (!child) continue
    if (child.type === "command_elements") {
      for (let j = 0; j < child.childCount; j++) {
        const item = child.child(j)
        if (!item || item.type === "command_argument_sep" || item.type === "redirection") continue
        out.push({ type: item.type, text: item.text })
      }
      continue
    }
    if (
      child.type !== "command_name" &&
      child.type !== "command_name_expr" &&
      child.type !== "word" &&
      child.type !== "string" &&
      child.type !== "raw_string" &&
      child.type !== "concatenation"
    ) {
      continue
    }
    out.push({ type: child.type, text: child.text })
  }
  return out
}

function source(node: Node) {
  return (node.parent?.type === "redirected_statement" ? node.parent.text : node.text).trim()
}

function commands(node: Node) {
  return node.descendantsOfType("command").filter((child): child is Node => Boolean(child))
}

function unquote(text: string) {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' || first === "'") && first === last) return text.slice(1, -1)
  return text
}

function home(text: string) {
  if (text === "~") return os.homedir()
  if (text.startsWith("~/") || text.startsWith("~\\")) return path.join(os.homedir(), text.slice(2))
  return text
}

function envValue(key: string) {
  if (process.platform !== "win32") return process.env[key]
  const name = Object.keys(process.env).find((item) => item.toLowerCase() === key.toLowerCase())
  return name ? process.env[name] : undefined
}

function auto(key: string, cwd: string, shell: string) {
  const name = key.toUpperCase()
  if (name === "HOME") return os.homedir()
  if (name === "PWD") return cwd
  if (name === "PSHOME") return path.dirname(shell)
}

function expand(text: string, cwd: string, shell: string) {
  const out = unquote(text)
    .replace(/\$\{env:([^}]+)\}/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, (_, key: string) => envValue(key) || "")
    .replace(/\$(HOME|PWD|PSHOME)(?=$|[\\/])/gi, (_, key: string) => auto(key, cwd, shell) || "")
  return home(out)
}

function provider(text: string) {
  const match = text.match(/^([A-Za-z]+)::(.*)$/)
  if (match) {
    if (match[1].toLowerCase() !== "filesystem") return
    return match[2]
  }
  const prefix = text.match(/^([A-Za-z]+):(.*)$/)
  if (!prefix) return text
  if (prefix[1].length === 1) return text
  return
}

function dynamic(text: string, ps: boolean) {
  if (text.startsWith("(") || text.startsWith("@(")) return true
  if (text.includes("$(") || text.includes("${") || text.includes("`")) return true
  if (ps) return /\$(?!env:)/i.test(text)
  return text.includes("$")
}

function prefix(text: string) {
  const match = /[?*[]/.exec(text)
  if (!match) return text
  if (match.index === 0) return
  return text.slice(0, match.index)
}

function pathArgs(list: Part[], ps: boolean, cmd = false) {
  if (!ps) {
    return list
      .slice(1)
      .filter(
        (item) =>
          !item.text.startsWith("-") &&
          !(cmd && item.text.startsWith("/")) &&
          !(list[0]?.text === "chmod" && item.text.startsWith("+")),
      )
      .map((item) => item.text)
  }

  const out: string[] = []
  let want = false
  for (const item of list.slice(1)) {
    if (want) {
      out.push(item.text)
      want = false
      continue
    }
    if (item.type === "command_parameter") {
      const flag = item.text.toLowerCase()
      if (SWITCHES.has(flag)) continue
      want = FLAGS.has(flag)
      continue
    }
    out.push(item.text)
  }
  return out
}

function preview(text: string) {
  if (text.length <= MAX_METADATA_LENGTH) return text
  return "...\n\n" + text.slice(-MAX_METADATA_LENGTH)
}

function tail(text: string, maxLines: number, maxBytes: number) {
  const lines = text.split("\n")
  if (lines.length <= maxLines && Buffer.byteLength(text, "utf-8") <= maxBytes) {
    return {
      text,
      cut: false,
    }
  }

  const out: string[] = []
  let bytes = 0
  for (let i = lines.length - 1; i >= 0 && out.length < maxLines; i--) {
    const size = Buffer.byteLength(lines[i], "utf-8") + (out.length > 0 ? 1 : 0)
    if (bytes + size > maxBytes) {
      if (out.length === 0) {
        const buf = Buffer.from(lines[i], "utf-8")
        let start = buf.length - maxBytes
        if (start < 0) start = 0
        while (start < buf.length && (buf[start] & 0xc0) === 0x80) start++
        out.unshift(buf.subarray(start).toString("utf-8"))
      }
      break
    }
    out.unshift(lines[i])
    bytes += size
  }
  return {
    text: out.join("\n"),
    cut: true,
  }
}

const parse = Effect.fn("ShellTool.parse")(function* (command: string, ps: boolean) {
  const tree = yield* Effect.promise(() => parser().then((p) => (ps ? p.ps : p.bash).parse(command)))
  if (!tree) throw new Error("Failed to parse command")
  return tree
})

function commandLooksNetworked(command: string) {
  return /\b(curl|wget|ping|dig|nslookup|npm\s+install|pnpm\s+install|yarn\s+(add|install)|bun\s+(add|install)|git\s+clone|ssh|scp|rsync|pip\s+install|uv\s+(pip\s+)?install)\b/i.test(command)
}

function commandNetworkTargets(command: string) {
  const urls = Array.from(command.matchAll(/\bhttps?:\/\/[^\s'"`<>]+/gi))
    .map((match) => match[0].replace(/[),.;]+$/, ""))
    .filter((item, index, items) => items.indexOf(item) === index)
  const hosts = Array.from(
    command.matchAll(/\b(?:curl|wget|ping|dig|nslookup|ssh|scp|rsync)\s+(?:-[^\s]+\s+)*(?:[a-z0-9._%+-]+@)?([a-z0-9._-]+\.[a-z0-9._-]+|localhost|\d{1,3}(?:\.\d{1,3}){3})/gi),
  )
    .map((match) => `https://${match[1].replace(/[:/].*$/, "")}`)
    .filter((item, index, items) => items.indexOf(item) === index)
  return [...urls, ...hosts].filter((item) => {
    try {
      new URL(item)
      return true
    } catch {
      return false
    }
  })
}

function envPatternMatches(name: string, pattern: string) {
  const key = name.toUpperCase()
  const item = pattern.toUpperCase()
  if (!item.includes("*")) return key === item
  const start = item.startsWith("*") ? "" : item.slice(0, item.indexOf("*"))
  const end = item.endsWith("*") ? "" : item.slice(item.lastIndexOf("*") + 1)
  return key.startsWith(start) && key.endsWith(end)
}

function envMatches(name: string, patterns: string[]) {
  return patterns.some((pattern) => envPatternMatches(name, pattern))
}

function safeDefaultEnv(cwd: string, source: NodeJS.ProcessEnv) {
  return {
    PATH: source.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: source.HOME ?? os.homedir(),
    PWD: cwd,
    TMPDIR: source.TMPDIR ?? os.tmpdir(),
    LANG: source.LANG ?? "C.UTF-8",
    TERM: source.TERM ?? "xterm-256color",
  } satisfies NodeJS.ProcessEnv
}

function environmentID(ctx: Tool.Context) {
  return ctx.turn?.selected_environment_id ?? "default"
}

function activeTurn(ctx: Tool.Context) {
  return ctx.turn ? SessionSecurity.applyToTurn(ctx.turn) : undefined
}

function redactedProxyURL(url: string | undefined) {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    if (parsed.username) parsed.username = "redacted"
    if (parsed.password) parsed.password = "redacted"
    return parsed.toString()
  } catch {
    return "redacted-invalid-proxy-url"
  }
}

const ask = Effect.fn("ShellTool.ask")(function* (ctx: Tool.Context, scan: Scan, options?: { skipShellPatterns?: boolean }) {
  if (scan.dirs.size > 0) {
    if (ctx.turn) {
      for (const dir of scan.dirs) {
        yield* TurnSandbox.assertFileAccess(ctx, "read", dir)
      }
    } else {
      const globs = Array.from(scan.dirs).map((dir) => {
        if (process.platform === "win32") return AppFileSystem.normalizePathPattern(path.join(dir, "*"))
        return path.join(dir, "*")
      })
      yield* ctx.ask({
        permission: "external_directory",
        patterns: globs,
        always: globs,
        metadata: {},
      })
    }
  }

  if (options?.skipShellPatterns || scan.patterns.size === 0) return
  yield* ctx.ask({
    permission: ShellID.ToolID,
    patterns: Array.from(scan.patterns),
    always: Array.from(scan.always),
    metadata: {},
  })
})

function cmd(shell: string, command: string, cwd: string, env: NodeJS.ProcessEnv, sandbox?: ShellSandboxCommand) {
  if (sandbox?.mode === "bwrap") {
    return ChildProcess.make(sandbox.program, sandbox.args, {
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }
  if (process.platform === "win32" && Shell.ps(shell)) {
    return ChildProcess.make(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
      cwd,
      env,
      stdin: "ignore",
      detached: false,
    })
  }

  return ChildProcess.make(command, [], {
    shell,
    cwd,
    env,
    stdin: "ignore",
    detached: process.platform !== "win32",
  })
}
const parser = lazy(async () => {
  const { Parser } = await import("web-tree-sitter")
  const { default: treeWasm } = await import("web-tree-sitter/tree-sitter.wasm" as string, {
    with: { type: "wasm" },
  })
  const treePath = resolveWasm(treeWasm)
  await Parser.init({
    locateFile() {
      return treePath
    },
  })
  const { default: bashWasm } = await import("tree-sitter-bash/tree-sitter-bash.wasm" as string, {
    with: { type: "wasm" },
  })
  const { default: psWasm } = await import("tree-sitter-powershell/tree-sitter-powershell.wasm" as string, {
    with: { type: "wasm" },
  })
  const bashPath = resolveWasm(bashWasm)
  const psPath = resolveWasm(psWasm)
  const [bashLanguage, psLanguage] = await Promise.all([Language.load(bashPath), Language.load(psPath)])
  const bash = new Parser()
  bash.setLanguage(bashLanguage)
  const ps = new Parser()
  ps.setLanguage(psLanguage)
  return { bash, ps }
})

export const ShellTool = Tool.define(
  ShellID.ToolID,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner
    const fs = yield* AppFileSystem.Service
    const trunc = yield* Truncate.Service
    const plugin = yield* Plugin.Service
    const flags = yield* RuntimeFlags.Service
    const defaultTimeoutMs = flags.bashDefaultTimeoutMs ?? 2 * 60 * 1000

    const cygpath = Effect.fn("ShellTool.cygpath")(function* (shell: string, text: string) {
      const lines = yield* spawner
        .lines(ChildProcess.make(shell, ["-lc", 'cygpath -w -- "$1"', "_", text]))
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      const file = lines[0]?.trim()
      if (!file) return
      return AppFileSystem.normalizePath(file)
    })

    const resolvePath = Effect.fn("ShellTool.resolvePath")(function* (text: string, root: string, shell: string) {
      if (process.platform === "win32") {
        if (Shell.posix(shell) && text.startsWith("/") && AppFileSystem.windowsPath(text) === text) {
          const file = yield* cygpath(shell, text)
          if (file) return file
        }
        return AppFileSystem.normalizePath(path.resolve(root, AppFileSystem.windowsPath(text)))
      }
      return path.resolve(root, text)
    })

    const argPath = Effect.fn("ShellTool.argPath")(function* (arg: string, cwd: string, ps: boolean, shell: string) {
      const text = ps ? expand(arg, cwd, shell) : home(unquote(arg))
      const file = text && prefix(text)
      if (!file || dynamic(file, ps)) return
      const next = ps ? provider(file) : file
      if (!next) return
      return yield* resolvePath(next, cwd, shell)
    })

    const collect = Effect.fn("ShellTool.collect")(function* (
      root: Node,
      cwd: string,
      ps: boolean,
      shell: string,
      instance: InstanceContext,
    ) {
      const scan: Scan = {
        dirs: new Set<string>(),
        patterns: new Set<string>(),
        always: new Set<string>(),
      }
      const shellKind = ShellID.toKind(Shell.name(shell))

      for (const node of commands(root)) {
        const command = parts(node)
        const tokens = command.map((item) => item.text)
        const cmd = ps || shellKind === "cmd" ? tokens[0]?.toLowerCase() : tokens[0]

        if (cmd && (FILES.has(cmd) || (shellKind === "cmd" && CMD_FILES.has(cmd)))) {
          for (const arg of pathArgs(command, ps, shellKind === "cmd")) {
            const resolved = yield* argPath(arg, cwd, ps, shell)
            log.info("resolved path", { arg, resolved })
            if (!resolved || containsPath(resolved, instance)) continue
            const dir = (yield* fs.isDir(resolved)) ? resolved : path.dirname(resolved)
            scan.dirs.add(dir)
          }
        }

        if (tokens.length && (!cmd || !CWD.has(cmd))) {
          scan.patterns.add(source(node))
          scan.always.add(BashArity.prefix(tokens).join(" ") + " *")
        }
      }

      return scan
    })

    const shellEnv = Effect.fn("ShellTool.shellEnv")(function* (ctx: Tool.Context, cwd: string) {
      const extra = yield* plugin.trigger(
        "shell.env",
        { cwd, sessionID: ctx.sessionID, callID: ctx.callID },
        { env: {} },
      )
      const turn = activeTurn(ctx)
      if (!turn) {
        return {
          ...process.env,
          ...extra.env,
        }
      }

      const policy = turn.shell_environment_policy
      const source: NodeJS.ProcessEnv = {
        ...process.env,
        ...extra.env,
      }
      const env: NodeJS.ProcessEnv = policy.mode === "inherit" ? { ...source } : {}
      const inheritedKeys: string[] = []
      const removedKeys: string[] = []

      if (policy.mode === "clear") {
        for (const key of Object.keys(source)) {
          if (!envMatches(key, policy.allowlist)) continue
          env[key] = source[key]
          inheritedKeys.push(key)
        }
      }

      if (policy.safe_defaults) {
        Object.assign(env, safeDefaultEnv(cwd, source))
      }

      Object.assign(env, policy.per_environment[environmentID(ctx)] ?? {})
      Object.assign(env, policy.overrides)

      for (const key of Object.keys(env)) {
        if (!envMatches(key, policy.denylist)) continue
        if (envMatches(key, policy.allowlist)) continue
        if (Object.prototype.hasOwnProperty.call(policy.overrides, key)) continue
        delete env[key]
        removedKeys.push(key)
      }

      const proxy = turn.network_proxy ?? CodexTurn.networkProxy({
        networkPermissions: turn.network_permissions,
        selectedEnvironmentID: turn.selected_environment_id,
      })
      const proxyKeys = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"]
      const proxyRemovedKeys = proxyKeys.filter((key) => env[key] !== undefined)
      for (const key of proxyKeys) delete env[key]
      if (proxy.enforcement === "environment" && proxy.url) {
        env.HTTP_PROXY = proxy.url
        env.HTTPS_PROXY = proxy.url
        env.ALL_PROXY = proxy.url
        env.http_proxy = proxy.url
        env.https_proxy = proxy.url
        env.all_proxy = proxy.url
        if (proxy.no_proxy.length) {
          env.NO_PROXY = proxy.no_proxy.join(",")
          env.no_proxy = proxy.no_proxy.join(",")
        }
      }

      const redactedKeys = Object.keys(env).filter((key) => envMatches(key, policy.redact))
      yield* AialraTurnTrace.emit({
        phase: "shell.env.policy.applied",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: ctx.messageID,
        data: {
          tool: "bash",
          cwd,
          environmentID: environmentID(ctx),
          mode: policy.mode,
          safeDefaults: policy.safe_defaults,
          inheritedKeys: inheritedKeys.sort(),
          removedKeys: removedKeys.sort(),
          overrideKeys: Object.keys(policy.overrides).sort(),
          perEnvironmentKeys: Object.keys(policy.per_environment[environmentID(ctx)] ?? {}).sort(),
          redactedKeys: redactedKeys.sort(),
          networkProxy: {
            ...proxy,
            url: redactedProxyURL(proxy.url),
          },
          proxyEnvKeys: proxy.enforcement === "environment" && proxy.url ? proxyKeys.sort() : [],
          proxyRemovedKeys: proxyRemovedKeys.sort(),
          outputKeys: Object.keys(env).sort(),
          policyVersion: policy.version,
        },
      })
      return env
    })

    const run = Effect.fn("ShellTool.run")(function* (
      input: {
        shell: string
        command: string
        cwd: string
        env: NodeJS.ProcessEnv
        timeout: number
        backgroundTerminalMaxTimeoutMs: number
        yieldTimeMs?: number
        requestedYieldTimeMs?: number
        yieldTimeClamped?: boolean
        yieldTimeMinMs?: number
        yieldTimeMaxMs?: number
        commandID: string
        processID: string
        description: string
        sandbox?: ShellSandboxCommand
      },
      ctx: Tool.Context,
    ) {
      const limits = yield* trunc.limits()
      const keep = limits.maxBytes * 2
      let full = ""
      let last = ""
      const list: Chunk[] = []
      let used = 0
      let file = ""
      let sink: ReturnType<typeof createWriteStream> | undefined
      let cut = false
      let expired = false
      let aborted = false

      const closeSink = Effect.fnUntraced(function* () {
        const stream = sink
        if (!stream) return
        sink = undefined
        if (stream.destroyed || stream.closed) return
        yield* Effect.promise(
          () =>
            new Promise<void>((resolve) => {
              let settled = false
              const done = () => {
                if (settled) return
                settled = true
                stream.off("close", done)
                stream.off("error", done)
                stream.off("finish", done)
                resolve()
              }
              stream.once("close", done)
              stream.once("error", done)
              stream.once("finish", done)
              stream.end(done)
            }),
        ).pipe(Effect.catch(() => Effect.void))
      })

      yield* ctx.metadata({
        metadata: {
          output: "",
          description: input.description,
        },
      })
      const commandID = input.commandID
      const processID = input.processID
      const argv = [input.shell, ...Shell.args(input.shell, input.command, input.cwd)]
      let backend: ExecCommandBackend = CodexExecServer.enabledForContext(ctx) ? "codex_exec_server" : "node_bun"
      const common = (nextBackend: ExecCommandBackend = backend) => ({
        commandID,
        backend: nextBackend,
        command: input.command,
        shell: input.shell,
        argv,
        cwd: input.cwd,
        timeoutMs: input.timeout,
        backgroundTerminalMaxTimeoutMs: input.backgroundTerminalMaxTimeoutMs,
        yieldTimeMs: input.yieldTimeMs,
        requestedYieldTimeMs: input.requestedYieldTimeMs,
        yieldTimeClamped: input.yieldTimeClamped,
        yieldTimeMinMs: input.yieldTimeMinMs,
        yieldTimeMaxMs: input.yieldTimeMaxMs,
        processID,
        sandbox: input.sandbox
          ? {
              program: input.sandbox.program,
              args_count: input.sandbox.args.length,
              mode: input.sandbox.mode,
            }
          : undefined,
      })
      if (input.yieldTimeMs !== undefined && input.yieldTimeMs < input.timeout) {
        const controls = ctx.turn?.engineering?.controls ?? EngineeringHarness.defaults()
        yield* ExecProcessRegistry.assertLiveCapacity({
          sessionID: ctx.sessionID,
          turnID: ctx.turn?.turnID,
          messageID: ctx.messageID,
          toolCallID: ctx.callID,
          processID,
          commandID,
          environmentID: environmentID(ctx),
          limits: {
            perSession: controls.maxLiveProcessesPerSession,
            perTurn: controls.maxLiveProcessesPerTurn,
            perEnvironment: controls.maxLiveProcessesPerEnvironment,
          },
        })
      }
      const startedAt = Date.now()
      yield* ExecCommand.started(ctx, common())
      let outputSeq = 0
      let totalOutputBytes = 0

      const recordChunk = Effect.fn("ShellTool.recordChunk")(function* (
        stream: "stdout" | "stderr" | "combined",
        text: string,
        seq = outputSeq++,
        nextBackend: ExecCommandBackend = backend,
      ) {
        const size = Buffer.byteLength(text, "utf-8")
        totalOutputBytes += size
        yield* ExecCommand.output(ctx, {
          ...common(nextBackend),
          stream,
          seq,
          text,
          preview: preview(text),
          cumulativeBytes: totalOutputBytes,
        })
        yield* AialraTurnTrace.emit({
          phase: "command.output",
          turnID: ctx.turn?.turnID,
          sessionID: ctx.sessionID,
          messageID: ctx.messageID,
          data: {
            stream,
            seq,
            chars: text.length,
            byte_length: size,
            cumulative_byte_length: totalOutputBytes,
            preview: preview(text),
          },
        })
        ExecProcessRegistry.output(processID, size)
        list.push({ text, size })
        used += size
        while (used > keep && list.length > 1) {
          const item = list.shift()
          if (!item) break
          used -= item.size
          cut = true
        }

        last = preview(last + text)

        if (file) {
          sink?.write(text)
          return yield* ctx.metadata({
            metadata: {
              output: last,
              description: input.description,
            },
          })
        }
        full += text
        if (Buffer.byteLength(full, "utf-8") > limits.maxBytes) {
          return yield* trunc.write(full).pipe(
            Effect.andThen((next) =>
              Effect.sync(() => {
                file = next
                cut = true
                sink = createWriteStream(next, { flags: "a" })
                full = ""
                ExecProcessRegistry.addOutputRef(processID, { type: "shell_output_file", path: next })
              }),
            ),
            Effect.andThen(
              ctx.metadata({
                metadata: {
                  output: last,
                  description: input.description,
                },
              }),
            ),
          )
        }

        return yield* ctx.metadata({
          metadata: {
            output: last,
            description: input.description,
          },
        })
      })

      const runWithChildProcess = Effect.scoped(
        Effect.gen(function* () {
          yield* Effect.addFinalizer(closeSink)
          yield* Effect.addFinalizer(() => TurnSandbox.cleanupShellSandboxCommand(input.sandbox))
          const handle = yield* spawner.spawn(cmd(input.shell, input.command, input.cwd, input.env, input.sandbox))

          yield* Effect.forkScoped(
            Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
              recordChunk("combined", chunk, undefined, "node_bun"),
            ),
          )
          const abort = Effect.callback<void>((resume) => {
            if (ctx.abort.aborted) return resume(Effect.void)
            const handler = () => resume(Effect.void)
            ctx.abort.addEventListener("abort", handler, { once: true })
            return Effect.sync(() => ctx.abort.removeEventListener("abort", handler))
          })

          const timeout = Effect.sleep(`${input.timeout + 100} millis`)

          const exit = yield* Effect.raceAll([
            handle.exitCode.pipe(Effect.map((code) => ({ kind: "exit" as const, code }))),
            abort.pipe(Effect.map(() => ({ kind: "abort" as const, code: null }))),
            timeout.pipe(Effect.map(() => ({ kind: "timeout" as const, code: null }))),
          ])

          if (exit.kind === "abort") {
            aborted = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }
          if (exit.kind === "timeout") {
            expired = true
            yield* handle.kill({ forceKillAfter: "3 seconds" }).pipe(Effect.orDie)
          }

          return exit.kind === "exit" ? exit.code : null
        }),
      ).pipe(Effect.orDie)

      const runWithBunYield = Effect.promise(async () => {
        const proc = input.sandbox
          ? Bun.spawn([input.sandbox.program, ...input.sandbox.args], {
              cwd: input.cwd,
              env: input.env as Record<string, string>,
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
            })
          : Bun.spawn([input.shell, ...Shell.args(input.shell, input.command, input.cwd)], {
              cwd: input.cwd,
              env: input.env as Record<string, string>,
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
            })
        const stdin = proc.stdin
        let stdinClosed = false
        const closeStdin = async () => {
          if (!stdin || stdinClosed) return
          stdinClosed = true
          await Promise.resolve(stdin.end()).catch(() => undefined)
        }
        const runtime: ExecProcessRuntime = {
          pid: proc.pid,
          writeStdin: async (text) => {
            if (!stdin || stdinClosed) throw new Error("stdin is not writable for this process")
            stdin.write(text)
            await Promise.resolve(stdin.flush()).catch(() => undefined)
          },
          closeStdin,
          interrupt: async () => {
            proc.kill("SIGINT")
            await proc.exited.catch(() => null)
          },
          abort: async () => {
            proc.kill()
            await proc.exited.catch(() => null)
          },
        }
        const abort = new Promise<{ kind: "abort"; code: null }>((resolve) => {
          if (ctx.abort.aborted) {
            resolve({ kind: "abort", code: null })
            return
          }
          const handler = () => resolve({ kind: "abort", code: null })
          ctx.abort.addEventListener("abort", handler, { once: true })
          proc.exited.finally(() => ctx.abort.removeEventListener("abort", handler))
        })
        const pump = async (stream: ReadableStream<Uint8Array> | null, name: "stdout" | "stderr") => {
          if (!stream) return
          const reader = stream.getReader()
          const decoder = new TextDecoder()
          while (true) {
            const next = await reader.read()
            if (next.done) return
            const text = decoder.decode(next.value, { stream: true })
            if (text) await Effect.runPromise(recordChunk(name, text, undefined, "node_bun"))
          }
        }
        const pumps = [pump(proc.stdout, "stdout"), pump(proc.stderr, "stderr")]
        const exited = proc.exited.then((code) => ({ kind: "exit" as const, code }))
        const timeout = new Promise<{ kind: "timeout"; code: null }>((resolve) =>
          setTimeout(() => resolve({ kind: "timeout", code: null }), input.timeout + 100),
        )
        const backgroundTimeout = new Promise<{ kind: "background_timeout"; code: null }>((resolve) =>
          setTimeout(() => resolve({ kind: "background_timeout", code: null }), input.backgroundTerminalMaxTimeoutMs + 100),
        )
        const yieldTime =
          input.yieldTimeMs !== undefined && input.yieldTimeMs < input.timeout
            ? new Promise<{ kind: "yield"; code: null }>((resolve) =>
                setTimeout(() => resolve({ kind: "yield", code: null }), input.yieldTimeMs),
              )
            : undefined
        const finishBackground = async () => {
          const exit = await Promise.race([exited, abort, backgroundTimeout])
          if (exit.kind === "abort") {
            proc.kill()
            await proc.exited.catch(() => null)
          }
          if (exit.kind === "background_timeout") {
            proc.kill()
            await proc.exited.catch(() => null)
          }
          await Promise.allSettled(pumps)
          await closeStdin()
          await Effect.runPromise(
            Effect.all([
              closeSink(),
              TurnSandbox.cleanupShellSandboxCommand(input.sandbox),
              ExecCommand.finished(ctx, {
                ...common("node_bun"),
                exitCode: exit.kind === "exit" ? exit.code : null,
                timedOut: exit.kind === "background_timeout",
                aborted: exit.kind === "abort",
                outputChars: list.reduce((sum, item) => sum + item.size, 0),
                truncated: cut,
                durationMs: Math.max(0, Date.now() - startedAt),
                outputPreview: last,
                rawOutputRef: file ? { type: "shell_output_file", path: file } : undefined,
                timeoutReason: exit.kind === "background_timeout" ? "background_terminal_max_timeout" : undefined,
                abortReason: exit.kind === "abort" ? "abort_signal" : undefined,
              }),
              ExecProcessRegistry.finish(processID, {
                status: exit.kind === "exit" ? "completed" : exit.kind === "background_timeout" ? "timeout" : "aborted",
                exitCode: exit.kind === "exit" ? exit.code : null,
                failure: exit.kind === "background_timeout" ? "background_terminal_max_timeout" : undefined,
              }),
            ], { concurrency: 1 }),
          )
        }
        const first = await Promise.race(yieldTime ? [exited, abort, timeout, yieldTime] : [exited, abort, timeout])
        if (first.kind === "yield") {
          void finishBackground()
          return { running: true, code: null, runtime }
        }
        if (first.kind === "abort") {
          proc.kill()
          await proc.exited.catch(() => null)
          await Promise.allSettled(pumps)
          await closeStdin()
          aborted = true
        }
        if (first.kind === "timeout") {
          proc.kill()
          await proc.exited.catch(() => null)
          await Promise.allSettled(pumps)
          await closeStdin()
          expired = true
        }
        if (first.kind === "exit") {
          await Promise.allSettled(pumps)
          await closeStdin()
        }
        await Effect.runPromise(
          Effect.all([
            closeSink(),
            TurnSandbox.cleanupShellSandboxCommand(input.sandbox),
          ], { concurrency: 1 }),
        )
        return { running: false, code: first.kind === "exit" ? first.code : null }
      })

      const runWithCodexExecServer = Effect.gen(function* () {
        const result = yield* Effect.promise(() =>
          CodexExecServer.runProcess({
            processID,
            argv,
            cwd: input.cwd,
            env: CodexExecServer.jsonEnv(input.env),
            sandbox: input.sandbox,
            timeoutMs: input.timeout,
            backgroundTimeoutMs: input.backgroundTerminalMaxTimeoutMs,
            yieldTimeMs: input.yieldTimeMs,
            ctx,
            onOutput(chunk) {
              void Effect.runPromise(recordChunk(chunk.stream, chunk.text, chunk.seq, "codex_exec_server"))
            },
            onBackgroundFinish(result) {
              const status: ExecProcessStatus = result.aborted
                ? "aborted"
                : result.timedOut
                  ? "timeout"
                  : result.exitCode === 0
                    ? "completed"
                    : "failed"
              return Effect.runPromise(
                Effect.all([
                  closeSink(),
                  TurnSandbox.cleanupShellSandboxCommand(input.sandbox),
                  ExecCommand.finished(ctx, {
                    ...common("codex_exec_server"),
                    exitCode: result.exitCode,
                    timedOut: result.timedOut,
                    aborted: result.aborted,
                    outputChars: list.reduce((sum, item) => sum + item.size, 0),
                    truncated: cut,
                    durationMs: result.durationMs,
                    failure: result.failure,
                    outputPreview: last,
                    rawOutputRef: file ? { type: "shell_output_file", path: file } : undefined,
                    timeoutReason: result.timedOut ? result.failure ?? "command_timeout" : undefined,
                    abortReason: result.aborted ? result.failure ?? "abort_signal" : undefined,
                  }),
                  ExecProcessRegistry.finish(processID, {
                    status,
                    exitCode: result.exitCode,
                    failure: result.failure,
                  }),
                ], { concurrency: 1 }),
              ).then(() => undefined)
            },
          }),
        )

        if (result.timedOut) expired = true
        if (result.aborted) aborted = true
        if (result.running) return result
        if (result.failure && result.failure !== "timeout") {
          last = preview(last + `\n<exec_server_failure>${result.failure}</exec_server_failure>`)
        }
        return result.exitCode
      })

      const returnYielded = Effect.fn("ShellTool.returnYielded")(function* (
        nextBackend: ExecCommandBackend,
        runtime?: ExecProcessRuntime,
      ) {
        const raw = list.map((item) => item.text).join("")
        yield* ExecProcessRegistry.register({
          process_id: processID,
          command_id: commandID,
          backend: nextBackend,
          session_id: ctx.sessionID,
          turn_id: ctx.turn?.turnID,
          message_id: ctx.messageID,
          tool_call_id: ctx.callID,
          environment_id: ctx.turn?.selected_environment_id,
          cwd: input.cwd,
          command: input.command,
          timeout_ms: input.timeout,
          background_timeout_ms: input.backgroundTerminalMaxTimeoutMs,
          yield_time_ms: input.yieldTimeMs,
          output_chars: raw.length,
          outputRefs: file ? [{ type: "shell_output_file", path: file }] : undefined,
          runtime,
        })
        yield* ExecCommand.yielded(ctx, {
          ...common(nextBackend),
          outputChars: raw.length,
          durationMs: Math.max(0, Date.now() - startedAt),
        })
        return {
          title: input.description,
          metadata: {
            output: last || "(no output yet)",
            exit: null as number | null,
            running: true,
            process_id: processID,
            backend: nextBackend,
            description: input.description,
            truncated: cut,
            requested_yield_time_ms: input.requestedYieldTimeMs,
            effective_yield_time_ms: input.yieldTimeMs,
            yield_time_clamped: input.yieldTimeClamped,
          },
          output:
            (last || "(no output yet)") +
            "\n\n<shell_metadata>\n" +
            [
              "Command is still running after foreground yield time",
              `process_id=${processID}`,
              `backend=${nextBackend}`,
              `requested_yield_time_ms=${input.requestedYieldTimeMs ?? "default"}`,
              `effective_yield_time_ms=${input.yieldTimeMs}`,
            ].join("\n") +
            "\n</shell_metadata>",
        }
      })

      let code: number | null
      const shouldNodeBunYield = input.requestedYieldTimeMs !== undefined &&
        input.yieldTimeMs !== undefined &&
        input.yieldTimeMs < input.timeout
      if (CodexExecServer.enabledForContext(ctx)) {
        const execExit = yield* Effect.exit(runWithCodexExecServer)
        if (Exit.isSuccess(execExit)) {
          const value = execExit.value
          if (value && typeof value === "object" && value.running) {
            return yield* returnYielded("codex_exec_server", value.runtime)
          }
          code = value && typeof value === "object" ? value.exitCode : value
        } else {
          yield* AialraTurnTrace.emit({
            phase: "exec_server.fallback",
            turnID: ctx.turn?.turnID,
            sessionID: ctx.sessionID,
            messageID: ctx.messageID,
            data: {
              reason: Cause.pretty(execExit.cause),
            },
          })
          yield* ExecCommand.fallback(ctx, {
            ...common("node_bun"),
            from: "codex_exec_server",
            to: "node_bun",
            reason: Cause.pretty(execExit.cause),
          })
          backend = "node_bun"
          const fallbackResult = shouldNodeBunYield
            ? yield* runWithBunYield
            : { running: false, code: yield* runWithChildProcess }
          if (fallbackResult.running) return yield* returnYielded("node_bun", fallbackResult.runtime)
          code = fallbackResult.code
        }
      } else {
        const result = shouldNodeBunYield
          ? yield* runWithBunYield
          : { running: false, code: yield* runWithChildProcess }
        if (result.running) return yield* returnYielded("node_bun", result.runtime)
        code = result.code
      }

      const meta: string[] = []
      if (expired) {
        meta.push(
          `shell tool terminated command after exceeding timeout ${input.timeout} ms. If this command is expected to take longer and is not waiting for interactive input, retry with a larger timeout value in milliseconds.`,
        )
      }
      const abortMetadata = aborted ? AbortAudit.shellMetadata(ctx.turn) : undefined
      if (abortMetadata) {
        meta.push([
          "Command aborted by OpenCode abort signal",
          `source=${abortMetadata.source}`,
          `sourceLabel=${abortMetadata.sourceLabel}`,
          `actor=${abortMetadata.actor}`,
          abortMetadata.requestID ? `requestID=${abortMetadata.requestID}` : "requestID=missing",
          abortMetadata.reason ? `reason=${abortMetadata.reason}` : "reason=not_provided",
        ].join("; "))
      }
      const raw = list.map((item) => item.text).join("")
      const end = tail(raw, limits.maxLines, limits.maxBytes)
      if (end.cut) cut = true
      if (!file && end.cut) {
        file = yield* trunc.write(raw)
      }

      let output = end.text
      if (!output) output = "(no output)"

      if (cut && file) {
        output = `...output truncated...\n\nFull output saved to: ${file}\n\n` + output
      }

      if (meta.length > 0) {
        output += "\n\n<shell_metadata>\n" + meta.join("\n") + "\n</shell_metadata>"
      }
      yield* Effect.all([
        closeSink(),
        TurnSandbox.cleanupShellSandboxCommand(input.sandbox),
      ], { concurrency: 1 })
      yield* ExecCommand.finished(ctx, {
        ...common(backend),
        exitCode: code,
        timedOut: expired,
        aborted,
        outputChars: raw.length,
        truncated: cut,
        durationMs: Math.max(0, Date.now() - startedAt),
        outputPreview: last || preview(output),
        rawOutputRef: file ? { type: "shell_output_file", path: file } : undefined,
        timeoutReason: expired ? "command_timeout" : undefined,
        abortReason: aborted ? abortMetadata?.reason ?? abortMetadata?.source ?? "abort_signal" : undefined,
      })
      return {
        title: input.description,
        metadata: {
          output: last || preview(output),
          exit: code,
          description: input.description,
          truncated: cut,
          running: false,
          process_id: processID,
          backend,
          requested_yield_time_ms: input.requestedYieldTimeMs,
          effective_yield_time_ms: input.yieldTimeMs,
          yield_time_clamped: input.yieldTimeClamped,
          abort: abortMetadata,
          ...(cut && file ? { outputPath: file } : {}),
        },
        output,
      }
    })

    return () =>
      Effect.gen(function* () {
        const cfg = yield* config.get()
        const shell = Shell.acceptable(cfg.shell)
        const name = Shell.name(shell)
        const limits = yield* trunc.limits()
        const prompt = ShellPrompt.render(name, process.platform, limits, defaultTimeoutMs)
        log.info("shell tool using shell", { shell })

        return {
          description: prompt.description,
          parameters: prompt.parameters,
          execute: (params: Parameters, ctx: Tool.Context) =>
            Effect.gen(function* () {
              const instanceCtx = yield* InstanceState.context
              const turn = activeTurn(ctx)
              const cwd = params.workdir
                ? yield* resolvePath(params.workdir, turn?.cwd ?? ctx.turn?.cwd ?? instanceCtx.directory, shell)
                : (turn?.cwd ?? ctx.turn?.cwd ?? instanceCtx.directory)
              if (turn) {
                yield* AialraTurnTrace.emit({
                  phase: "sandbox.effective",
                  turnID: turn.turnID,
                  sessionID: turn.sessionID,
                  messageID: ctx.messageID,
                  data: {
                    tool: "bash",
                    cwd,
                    commandPreview: params.command.slice(0, 240),
                    network_policy: turn.network_policy,
                    command_policy: turn.command_policy,
                    approval_policy: turn.approval_policy,
                    sandbox_policy: turn.sandbox_policy,
                    active_permission_profile: turn.active_permission_profile,
                  },
                })
              }
              yield* TurnSandbox.assertShellAccess(ctx, { cwd, command: params.command })
              if (params.timeout !== undefined && params.timeout < 0) {
                throw new Error(`Invalid timeout value: ${params.timeout}. Timeout must be a positive number.`)
              }
              const timeout = params.timeout ?? turn?.engineering?.controls.singleCommandTimeoutMs ?? defaultTimeoutMs
              const backgroundTerminalMaxTimeoutMs =
                turn?.engineering?.controls.backgroundTerminalMaxTimeoutMs ?? 300_000
              const yieldTime = params.yield_time_ms !== undefined
                ? ExecCommand.resolveYieldTime(params.yield_time_ms)
                : undefined
              const baseCommandID = ExecCommand.id(ctx)
              const commandID =
                baseCommandID === "exec_unknown"
                  ? `exec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
                  : baseCommandID
              const processID = `proc_${commandID}`
              const requestedBackend: ExecCommandBackend = CodexExecServer.enabledForContext(ctx) ? "codex_exec_server" : "node_bun"
              const argv = [shell, ...Shell.args(shell, params.command, cwd)]
              const ps = Shell.ps(shell)
              yield* Effect.scoped(
                Effect.gen(function* () {
                  const tree = yield* Effect.acquireRelease(parse(params.command, ps), (tree) =>
                    Effect.sync(() => tree.delete()),
                  )
                  const scan = yield* collect(tree.rootNode, cwd, ps, shell, instanceCtx)
                  if (!containsPath(cwd, instanceCtx)) scan.dirs.add(cwd)
                  if (turn?.command_policy === "ask") {
                    const execApproval = yield* ExecApproval.requested(ctx, {
                      commandID,
                      processID,
                      command: params.command,
                      shell,
                      argv,
                      cwd,
                      backend: requestedBackend,
                      reason: "command_policy",
                      description: params.description,
                      patterns: [params.command],
                    })
                    yield* ctx.ask({
                      permission: ShellID.ToolID,
                      patterns: [params.command],
                      always: [params.command],
                      metadata: {
                        reason: "command_policy",
                        description: params.description,
                        exec_approval: execApproval,
                      },
                    })
                  }
                  yield* ask(ctx, scan, { skipShellPatterns: !!turn })
                }),
              )
              let networkAccessForCommand = false
              const commandNetworked = commandLooksNetworked(params.command)
              const networkTargets = commandNetworked ? commandNetworkTargets(params.command) : []
              const networkDecisions: Array<{
                needsApproval: boolean
                networkAccess: boolean
                networkSandboxDecision?: unknown
              }> = []
              if (turn && commandNetworked) {
                for (const target of networkTargets) {
                  networkDecisions.push(
                    yield* TurnSandbox.assertNetworkAccess(
                      {
                        ...ctx,
                        extra: {
                          ...ctx.extra,
                          tool: "bash",
                        },
                      },
                      target,
                    ),
                  )
                }
              }
              if (turn && networkDecisions.some((item) => item.needsApproval)) {
                const execApproval = yield* ExecApproval.requested(ctx, {
                  commandID,
                  processID,
                  command: params.command,
                  shell,
                  argv,
                  cwd,
                  backend: requestedBackend,
                  reason: "network_policy",
                  description: params.description,
                  patterns: networkTargets,
                  networkTargets,
                  networkDecisions,
                })
                yield* ctx.ask({
                  permission: "network",
                  patterns: networkTargets,
                  always: networkTargets,
                  metadata: {
                    reason: "network_policy",
                    description: params.description,
                    decisions: networkDecisions,
                    exec_approval: execApproval,
                  },
                })
                networkAccessForCommand = true
              } else if (networkDecisions.some((item) => item.networkAccess)) {
                networkAccessForCommand = true
              }
              if (turn && commandNetworked && networkDecisions.length === 0) {
                const proxy = turn.network_proxy ?? CodexTurn.networkProxy({
                  networkPermissions: turn.network_permissions,
                  selectedEnvironmentID: turn.selected_environment_id,
                })
                if (proxy.required && proxy.enforcement !== "environment") {
                  yield* AialraTurnTrace.emit({
                    phase: "network.proxy.unavailable",
                    turnID: turn.turnID,
                    sessionID: turn.sessionID,
                    messageID: ctx.messageID,
                    data: {
                      tool: "bash",
                      target: params.command.slice(0, 240),
                      status: proxy.enforcement,
                      reason: "命令看起来需要联网，但本轮要求 NetworkProxy 且没有可用代理地址，禁止直连",
                      network_proxy: {
                        ...proxy,
                        url: redactedProxyURL(proxy.url),
                      },
                    },
                  })
                  return yield* Effect.die(
                    new Error("NetworkProxy is required for this network command, but no usable proxy URL is configured"),
                  )
                }
                if (proxy.enforcement === "environment") {
                  yield* AialraTurnTrace.emit({
                    phase: "network.proxy.applied",
                    turnID: turn.turnID,
                    sessionID: turn.sessionID,
                    messageID: ctx.messageID,
                    data: {
                      tool: "bash",
                      target: params.command.slice(0, 240),
                      status: proxy.enforcement,
                      reason: "命令看起来需要联网，本轮通过标准代理环境变量执行",
                      network_proxy: {
                        ...proxy,
                        url: redactedProxyURL(proxy.url),
                      },
                    },
                  })
                  networkAccessForCommand = true
                } else if (turn.network_policy === "on") {
                  networkAccessForCommand = true
                }
              }
              if (turn?.network_policy === "ask" && commandNetworked && networkDecisions.length === 0) {
                const execApproval = yield* ExecApproval.requested(ctx, {
                  commandID,
                  processID,
                  command: params.command,
                  shell,
                  argv,
                  cwd,
                  backend: requestedBackend,
                  reason: "network_policy",
                  description: params.description,
                  patterns: [params.command],
                  networkTargets: [params.command],
                })
                yield* ctx.ask({
                  permission: "network",
                  patterns: [params.command],
                  always: [params.command],
                  metadata: {
                    reason: "network_policy",
                    description: params.description,
                    exec_approval: execApproval,
                  },
                })
                networkAccessForCommand = true
              }

              const result = yield* run(
                {
                  shell,
                  command: params.command,
                  cwd,
                  env: yield* shellEnv(ctx, cwd),
                  timeout,
                  backgroundTerminalMaxTimeoutMs,
                  yieldTimeMs: yieldTime ? Math.min(yieldTime.effective_yield_time_ms, timeout) : undefined,
                  requestedYieldTimeMs: yieldTime?.requested_yield_time_ms,
                  yieldTimeClamped: yieldTime
                    ? yieldTime.yield_time_clamped || yieldTime.effective_yield_time_ms > timeout
                    : undefined,
                  yieldTimeMinMs: yieldTime?.yield_time_min_ms,
                  yieldTimeMaxMs: yieldTime?.yield_time_max_ms,
                  commandID,
                  processID,
                  description: params.description,
                  sandbox: yield* TurnSandbox.shellSandboxCommand(ctx, {
                    shell,
                    command: params.command,
                    cwd,
                    networkAccess: networkAccessForCommand,
                  }),
                },
                ctx,
              )
              EngineeringHarness.recordVerification({
                turn,
                command: params.command,
                exit: typeof result.metadata.exit === "number" ? result.metadata.exit : null,
                output: result.output,
              })
              return result
            }),
        }
      })
  }),
)

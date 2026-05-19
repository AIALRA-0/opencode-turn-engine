import { AialraTurnTrace } from "@/session/turn-trace"
import type * as Tool from "./tool"
import type { ShellSandboxCommand } from "./turn-sandbox"
import type { PermissionProfileFileSystemEntry, TurnContext } from "@/session/turn-context"
import { Effect } from "effect"

type JsonRecord = Record<string, unknown>

type JsonRpcResponse = {
  jsonrpc: "2.0"
  id: number
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

type ProcessOutputChunk = {
  seq: number
  stream: "stdout" | "stderr"
  chunk: string
}

type ProcessReadResponse = {
  chunks: ProcessOutputChunk[]
  nextSeq: number
  exited: boolean
  exitCode: number | null
  closed: boolean
  failure: string | null
}

type FsReadFileResponse = {
  dataBase64: string
}

type ManagedServer = {
  child: ReturnType<typeof Bun.spawn>
  url: string
}

type RunProcessInput = {
  argv: string[]
  cwd: string
  env: Record<string, string>
  sandbox?: ShellSandboxCommand
  timeoutMs: number
  ctx?: Tool.Context
  onOutput: (chunk: { stream: "stdout" | "stderr"; text: string; seq: number }) => void
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()

export class CodexExecServerRpcError extends Error {
  readonly code: number
  readonly data?: unknown

  constructor(input: { code: number; message: string; data?: unknown }) {
    super(input.message)
    this.name = "CodexExecServerRpcError"
    this.code = input.code
    this.data = input.data
  }
}

function jsonEnv(env: NodeJS.ProcessEnv) {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) out[key] = value
  }
  return out
}

function decodeChunk(chunk: string) {
  return Buffer.from(chunk, "base64").toString("utf8")
}

async function firstLine(stream: ReadableStream<Uint8Array> | null) {
  if (!stream) throw new Error("codex exec-server did not expose stdout")
  const reader = stream.getReader()
  let text = ""
  const started = Date.now()
  while (Date.now() - started < 10_000) {
    const { done, value } = await reader.read()
    if (done) break
    text += decoder.decode(value, { stream: true })
    const line = text.split(/\r?\n/).find((item) => item.startsWith("ws://"))
    if (line) return line.trim()
  }
  throw new Error("timed out waiting for codex exec-server listen URL")
}

async function openWebSocket(url: string) {
  const started = Date.now()
  let lastError: Error | undefined
  while (Date.now() - started < 10_000) {
    const ws = new WebSocket(url)
    ws.binaryType = "arraybuffer"
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out connecting to codex exec-server ${url}`)), 1_000)
        ws.addEventListener("open", () => {
          clearTimeout(timer)
          resolve()
        }, { once: true })
        ws.addEventListener("error", () => {
          clearTimeout(timer)
          reject(new Error(`failed to connect to codex exec-server ${url}`))
        }, { once: true })
      })
      return ws
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      try {
        ws.close()
      } catch {
        // ignore
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw lastError ?? new Error(`timed out connecting to codex exec-server ${url}`)
}

export class CodexExecServerClient {
  #ws: WebSocket
  #seq = 0
  #pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  #managed?: ManagedServer

  private constructor(ws: WebSocket, managed?: ManagedServer) {
    this.#ws = ws
    this.#managed = managed
    ws.addEventListener("message", (event) => this.#onMessage(event.data))
    ws.addEventListener("close", () => this.#rejectAll(new Error("codex exec-server transport closed")))
    ws.addEventListener("error", () => this.#rejectAll(new Error("codex exec-server transport error")))
  }

  static enabled() {
    return process.env.AIALRA_EXEC_BACKEND === "codex"
  }

  static async connect(input?: { url?: string }) {
    const managed = input?.url ? undefined : await startManagedServer()
    const url = input?.url ?? managed?.url
    if (!url) throw new Error("codex exec-server URL was not resolved")
    const ws = await openWebSocket(url)
    const client = new CodexExecServerClient(ws, managed)
    await client.request("initialize", { clientName: "aialra-opencode", resumeSessionId: null })
    client.notify("initialized", {})
    return client
  }

  #onMessage(data: unknown) {
    const text =
      typeof data === "string"
        ? data
        : data instanceof ArrayBuffer
          ? decoder.decode(new Uint8Array(data))
          : ArrayBuffer.isView(data)
            ? decoder.decode(data as Uint8Array)
            : ""
    if (!text) return
    let parsed: JsonRpcResponse
    try {
      parsed = JSON.parse(text) as JsonRpcResponse
    } catch {
      return
    }
    if (typeof parsed.id !== "number") return
    const pending = this.#pending.get(parsed.id)
    if (!pending) return
    this.#pending.delete(parsed.id)
    if (parsed.error) {
      pending.reject(
        new CodexExecServerRpcError({
          code: parsed.error.code,
          message: `codex exec-server rejected ${parsed.id}: ${parsed.error.message}`,
          data: parsed.error.data,
        }),
      )
      return
    }
    pending.resolve(parsed.result)
  }

  #rejectAll(error: Error) {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }

  request(method: string, params: JsonRecord) {
    const id = ++this.#seq
    const payload = JSON.stringify({ jsonrpc: "2.0", id, method, params })
    return new Promise<unknown>((resolve, reject) => {
      this.#pending.set(id, { resolve, reject })
      this.#ws.send(payload)
    })
  }

  notify(method: string, params: JsonRecord) {
    this.#ws.send(JSON.stringify({ jsonrpc: "2.0", method, params }))
  }

  async terminate(processID: string) {
    await this.request("process/terminate", { processId: processID })
  }

  async close() {
    try {
      this.#ws.close()
    } catch {
      // ignore
    }
    if (this.#managed) {
      try {
        this.#managed.child.kill()
      } catch {
        // ignore
      }
    }
  }
}

function codexSpecialPath(value: PermissionProfileFileSystemEntry["path"] & { type: "special" }) {
  switch (value.value) {
    case "root":
      return { type: "special", value: { kind: "root" } }
    case "workspace_roots":
      return { type: "special", value: { kind: "project_roots", subpath: null } }
    case "tmpdir":
      return { type: "special", value: { kind: "tmpdir" } }
    case "slash_tmp":
      return { type: "special", value: { kind: "slash_tmp" } }
    case "minimal":
      return { type: "special", value: { kind: "minimal" } }
  }
}

function codexPermissionEntry(entry: PermissionProfileFileSystemEntry) {
  const p = entry.path
  const nextPath =
    p.type === "path"
      ? { type: "path", path: p.path }
      : p.type === "glob"
        ? { type: "glob_pattern", pattern: p.pattern }
        : codexSpecialPath(p)
  return { path: nextPath, access: entry.access }
}

function codexPermissionProfile(turn: TurnContext) {
  const profile = turn.permission_profile
  if (profile.type === "disabled") return { type: "disabled" }
  if (profile.type === "external") return { type: "external", network: profile.network }
  if (profile.file_system.type === "unrestricted") {
    return {
      type: "managed",
      file_system: { type: "unrestricted" },
      network: profile.network,
    }
  }
  return {
    type: "managed",
    file_system: {
      type: "restricted",
      entries: profile.file_system.entries.map(codexPermissionEntry),
      ...(profile.file_system.glob_scan_max_depth ? { glob_scan_max_depth: profile.file_system.glob_scan_max_depth } : {}),
    },
    network: profile.network,
  }
}

function sandboxContext(turn?: TurnContext) {
  if (!turn) return undefined
  return {
    permissions: codexPermissionProfile(turn),
    cwd: turn.cwd,
    windowsSandboxLevel: "disabled",
    windowsSandboxPrivateDesktop: false,
    useLegacyLandlock: false,
  }
}

async function startManagedServer(): Promise<ManagedServer> {
  const codex = process.env.AIALRA_CODEX_EXEC_SERVER_BIN || Bun.which("codex")
  if (!codex) throw new Error("AIALRA_EXEC_BACKEND=codex requires `codex` on PATH")
  const child = Bun.spawn([codex, "exec-server", "--listen", "ws://127.0.0.1:0"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const url = await firstLine(child.stdout)
  return { child, url }
}

async function withClient<T>(fn: (client: CodexExecServerClient) => Promise<T>) {
  const url = process.env.AIALRA_CODEX_EXEC_SERVER_URL
  const client = await CodexExecServerClient.connect(url ? { url } : undefined)
  try {
    return await fn(client)
  } finally {
    await client.close()
  }
}

export async function runProcess(input: RunProcessInput) {
  const url = process.env.AIALRA_CODEX_EXEC_SERVER_URL
  const client = await CodexExecServerClient.connect(url ? { url } : undefined)
  const processID = `proc_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`
  const started = Date.now()
  const argv = input.sandbox ? [input.sandbox.program, ...input.sandbox.args] : input.argv

  try {
    await Effect.runPromise(AialraTurnTrace.emit({
      phase: "exec_server.process.started",
      turnID: input.ctx?.turn?.turnID,
      sessionID: input.ctx?.sessionID,
      messageID: input.ctx?.messageID,
      data: {
        processID,
        argv: argv.slice(0, 4),
        argvCount: argv.length,
        cwd: input.cwd,
        managed: !url,
      },
    }))

    await client.request("process/start", {
      processId: processID,
      argv,
      cwd: input.cwd,
      env: input.env,
      tty: false,
      pipeStdin: false,
      arg0: null,
    })

    let afterSeq: number | null = null
    let exitCode: number | null = null
    let failure: string | null = null
    while (Date.now() - started <= input.timeoutMs) {
      const result = (await client.request("process/read", {
        processId: processID,
        afterSeq,
        maxBytes: 64 * 1024,
        waitMs: 250,
      })) as ProcessReadResponse
      afterSeq = result.nextSeq
      exitCode = result.exitCode
      failure = result.failure
      for (const chunk of result.chunks ?? []) {
        input.onOutput({ stream: chunk.stream, text: decodeChunk(chunk.chunk), seq: chunk.seq })
      }
      if (result.closed) {
        return { exitCode, failure, timedOut: false }
      }
    }

    await client.terminate(processID)
    return { exitCode: null, failure: "timeout", timedOut: true }
  } finally {
    await Effect.runPromise(AialraTurnTrace.emit({
      phase: "exec_server.process.finished",
      turnID: input.ctx?.turn?.turnID,
      sessionID: input.ctx?.sessionID,
      messageID: input.ctx?.messageID,
      data: {
        processID,
        durationMs: Math.max(0, Date.now() - started),
      },
    }))
    await client.close()
  }
}

async function readFile(input: { path: string; ctx?: Tool.Context }) {
  const started = Date.now()
  try {
    await Effect.runPromise(AialraTurnTrace.emit({
      phase: "exec_server.fs.started",
      turnID: input.ctx?.turn?.turnID,
      sessionID: input.ctx?.sessionID,
      messageID: input.ctx?.messageID,
      data: { method: "fs/readFile", path: input.path },
    }))
    const result = await withClient((client) =>
      client.request("fs/readFile", {
        path: input.path,
        sandbox: sandboxContext(input.ctx?.turn),
      }),
    ) as FsReadFileResponse
    return Buffer.from(result.dataBase64, "base64")
  } finally {
    await Effect.runPromise(AialraTurnTrace.emit({
      phase: "exec_server.fs.finished",
      turnID: input.ctx?.turn?.turnID,
      sessionID: input.ctx?.sessionID,
      messageID: input.ctx?.messageID,
      data: { method: "fs/readFile", path: input.path, durationMs: Math.max(0, Date.now() - started) },
    }))
  }
}

async function writeFile(input: { path: string; data: string | Uint8Array; ctx?: Tool.Context }) {
  const started = Date.now()
  try {
    await Effect.runPromise(AialraTurnTrace.emit({
      phase: "exec_server.fs.started",
      turnID: input.ctx?.turn?.turnID,
      sessionID: input.ctx?.sessionID,
      messageID: input.ctx?.messageID,
      data: { method: "fs/writeFile", path: input.path },
    }))
    const bytes = typeof input.data === "string" ? encoder.encode(input.data) : input.data
    await withClient((client) =>
      client.request("fs/writeFile", {
        path: input.path,
        dataBase64: Buffer.from(bytes).toString("base64"),
        sandbox: sandboxContext(input.ctx?.turn),
      }),
    )
  } finally {
    await Effect.runPromise(AialraTurnTrace.emit({
      phase: "exec_server.fs.finished",
      turnID: input.ctx?.turn?.turnID,
      sessionID: input.ctx?.sessionID,
      messageID: input.ctx?.messageID,
      data: { method: "fs/writeFile", path: input.path, durationMs: Math.max(0, Date.now() - started) },
    }))
  }
}

async function createDirectory(input: { path: string; recursive?: boolean; ctx?: Tool.Context }) {
  const started = Date.now()
  try {
    await Effect.runPromise(AialraTurnTrace.emit({
      phase: "exec_server.fs.started",
      turnID: input.ctx?.turn?.turnID,
      sessionID: input.ctx?.sessionID,
      messageID: input.ctx?.messageID,
      data: { method: "fs/createDirectory", path: input.path },
    }))
    await withClient((client) =>
      client.request("fs/createDirectory", {
        path: input.path,
        recursive: input.recursive ?? true,
        sandbox: sandboxContext(input.ctx?.turn),
      }),
    )
  } finally {
    await Effect.runPromise(AialraTurnTrace.emit({
      phase: "exec_server.fs.finished",
      turnID: input.ctx?.turn?.turnID,
      sessionID: input.ctx?.sessionID,
      messageID: input.ctx?.messageID,
      data: { method: "fs/createDirectory", path: input.path, durationMs: Math.max(0, Date.now() - started) },
    }))
  }
}

async function remove(input: { path: string; recursive?: boolean; force?: boolean; ctx?: Tool.Context }) {
  const started = Date.now()
  try {
    await Effect.runPromise(AialraTurnTrace.emit({
      phase: "exec_server.fs.started",
      turnID: input.ctx?.turn?.turnID,
      sessionID: input.ctx?.sessionID,
      messageID: input.ctx?.messageID,
      data: { method: "fs/remove", path: input.path },
    }))
    await withClient((client) =>
      client.request("fs/remove", {
        path: input.path,
        recursive: input.recursive ?? false,
        force: input.force ?? false,
        sandbox: sandboxContext(input.ctx?.turn),
      }),
    )
  } finally {
    await Effect.runPromise(AialraTurnTrace.emit({
      phase: "exec_server.fs.finished",
      turnID: input.ctx?.turn?.turnID,
      sessionID: input.ctx?.sessionID,
      messageID: input.ctx?.messageID,
      data: { method: "fs/remove", path: input.path, durationMs: Math.max(0, Date.now() - started) },
    }))
  }
}

export const CodexExecServer = {
  enabled: CodexExecServerClient.enabled,
  connect: CodexExecServerClient.connect,
  runProcess,
  readFile,
  writeFile,
  createDirectory,
  remove,
  jsonEnv,
  isRpcError(error: unknown): error is CodexExecServerRpcError {
    return error instanceof CodexExecServerRpcError
  },
  encodeBase64(input: string) {
    return Buffer.from(encoder.encode(input)).toString("base64")
  },
}

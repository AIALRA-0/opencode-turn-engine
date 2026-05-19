import { AialraTurnTrace } from "@/session/turn-trace"
import type * as Tool from "./tool"
import type { ShellSandboxCommand } from "./turn-sandbox"
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
    await client.request("initialize", { clientName: "aialra-opencode" })
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
      pending.reject(new Error(`codex exec-server rejected ${parsed.id}: ${parsed.error.message}`))
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

async function startManagedServer(): Promise<ManagedServer> {
  const codex = Bun.which("codex")
  if (!codex) throw new Error("AIALRA_EXEC_BACKEND=codex requires `codex` on PATH")
  const child = Bun.spawn([codex, "exec-server", "--listen", "ws://127.0.0.1:0"], {
    stdout: "pipe",
    stderr: "pipe",
  })
  const url = await firstLine(child.stdout)
  return { child, url }
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

export const CodexExecServer = {
  enabled: CodexExecServerClient.enabled,
  connect: CodexExecServerClient.connect,
  runProcess,
  jsonEnv,
  encodeBase64(input: string) {
    return Buffer.from(encoder.encode(input)).toString("base64")
  },
}

#!/usr/bin/env node
import { spawn } from "node:child_process"
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const REPO_ROOT = "/srv/aialra/apps/opencode-turn-engine"
const MANIFEST_PATH =
  process.env.AIALRA_REAL_BENCH_MANIFEST ??
  join(REPO_ROOT, "aialra/turn-observability/benchmark-cases/latest.json")
const ROOT = process.env.AIALRA_REAL_BENCH_ROOT ?? "/srv/aialra/turn-harness-target/real-bench-runs"
const REPORT_DIR =
  process.env.AIALRA_REAL_BENCH_REPORT_DIR ??
  join(REPO_ROOT, "aialra/turn-observability/real-benchmark-reports")
const REPO_CACHE = process.env.AIALRA_REAL_BENCH_REPO_CACHE ?? "/srv/aialra/cache/agent-benchmark/repos"
const SECRETS_AIALRA = process.env.AIALRA_AB_AIALRA_ENV ?? "/srv/aialra/config/secrets/opencode.env"
const SECRETS_DEBUG1 = process.env.AIALRA_AB_DEBUG1_ENV ?? "/srv/aialra/config/secrets/opencode-debug1.env"
const CODEX_BIN = process.env.AIALRA_AB_CODEX_BIN ?? "codex"
const CODEX_MODEL = process.env.AIALRA_REAL_BENCH_CODEX_MODEL ?? process.env.AIALRA_AB_CODEX_MODEL ?? "gpt-5.5"
const CODEX_EFFORT = process.env.AIALRA_REAL_BENCH_CODEX_EFFORT ?? "xhigh"
const KIMICODE_MODEL = process.env.AIALRA_REAL_BENCH_KIMICODE_MODEL ?? "kimi/kimi-for-coding"
const KIMICODE_VARIANT = process.env.AIALRA_REAL_BENCH_KIMICODE_VARIANT ?? ""
const KIMICODE_EFFORT_LABEL = process.env.AIALRA_REAL_BENCH_KIMICODE_EFFORT_LABEL ?? "native coding model"
const DEEPSEEK_V4_PRO_MODEL = process.env.AIALRA_REAL_BENCH_DEEPSEEK_V4_PRO_MODEL ?? "deepseek/deepseek-v4-pro"
const DEEPSEEK_V4_PRO_VARIANT = process.env.AIALRA_REAL_BENCH_DEEPSEEK_V4_PRO_VARIANT ?? "max"
const TIMEOUT_MS = Number(process.env.AIALRA_REAL_BENCH_TIMEOUT_MS ?? "900000")
const OPENCODE_START_TIMEOUT_MS = Number(process.env.AIALRA_REAL_BENCH_OPENCODE_START_TIMEOUT_MS ?? "180000")
const TEST_TIMEOUT_MS = Number(process.env.AIALRA_REAL_BENCH_TEST_TIMEOUT_MS ?? "600000")
const OFFICIAL_TIMEOUT_SECONDS = Number(process.env.AIALRA_REAL_BENCH_OFFICIAL_TIMEOUT_SECONDS ?? "1800")
const CASE_LIMIT = Number(process.env.AIALRA_REAL_BENCH_LIMIT ?? "24")
const PARALLEL = Math.max(1, Number(process.env.AIALRA_REAL_BENCH_PARALLEL ?? "1"))
const VERIFY_MODE = process.env.AIALRA_REAL_BENCH_VERIFY ?? "hybrid"
const KEEP_WORKTREES = process.env.AIALRA_REAL_BENCH_KEEP_WORKTREES === "1"
const DOCKER_PRUNE = process.env.AIALRA_REAL_BENCH_DOCKER_PRUNE === "1"
const CASE_FILTER = new Set(
  (process.env.AIALRA_REAL_BENCH_CASES ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
)
const TARGET_FILTER = new Set(
  (process.env.AIALRA_REAL_BENCH_TARGETS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
)

const runID = process.env.AIALRA_REAL_BENCH_RUN_ID ?? new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
const runRoot = join(ROOT, runID)

const allTargets = [
  {
    id: "codex-xhigh",
    name: "原版 Codex CLI / xhigh 最大推理",
    kind: "codex",
    model: CODEX_MODEL,
    effort: CODEX_EFFORT,
  },
  {
    id: "debug1-kimicode-max",
    name: "debug1 原版 OpenCode / Kimicode 最大努力",
    kind: "opencode",
    baseURL: process.env.AIALRA_AB_DEBUG1_URL ?? "http://127.0.0.1:12801",
    envFile: SECRETS_DEBUG1,
    model: KIMICODE_MODEL,
    variant: KIMICODE_VARIANT,
    effortLabel: KIMICODE_EFFORT_LABEL,
    publicEvents: false,
  },
  {
    id: "aialra-kimicode-max",
    name: "AIALRA OpenCode / Kimicode 最大努力",
    kind: "opencode",
    baseURL: process.env.AIALRA_AB_AIALRA_URL ?? "http://127.0.0.1:12601",
    envFile: SECRETS_AIALRA,
    model: KIMICODE_MODEL,
    variant: KIMICODE_VARIANT,
    effortLabel: KIMICODE_EFFORT_LABEL,
    publicEvents: true,
  },
  {
    id: "debug1-deepseek-v4-pro-max",
    name: "debug1 原版 OpenCode / DeepSeek V4 Pro max",
    kind: "opencode",
    baseURL: process.env.AIALRA_AB_DEBUG1_URL ?? "http://127.0.0.1:12801",
    envFile: SECRETS_DEBUG1,
    model: DEEPSEEK_V4_PRO_MODEL,
    variant: DEEPSEEK_V4_PRO_VARIANT,
    effortLabel: DEEPSEEK_V4_PRO_VARIANT,
    publicEvents: false,
  },
  {
    id: "aialra-deepseek-v4-pro-max",
    name: "AIALRA OpenCode / DeepSeek V4 Pro max",
    kind: "opencode",
    baseURL: process.env.AIALRA_AB_AIALRA_URL ?? "http://127.0.0.1:12601",
    envFile: SECRETS_AIALRA,
    model: DEEPSEEK_V4_PRO_MODEL,
    variant: DEEPSEEK_V4_PRO_VARIANT,
    effortLabel: DEEPSEEK_V4_PRO_VARIANT,
    publicEvents: true,
  },
]
const targets = TARGET_FILTER.size ? allTargets.filter((item) => TARGET_FILTER.has(item.id)) : allTargets

function parseEnv(text) {
  const out = {}
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const index = line.indexOf("=")
    if (index === -1) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

async function envFromFile(path) {
  try {
    return parseEnv(await readFile(path, "utf8"))
  } catch {
    return {}
  }
}

function authHeader(env) {
  const username = env.OPENCODE_SERVER_USERNAME ?? process.env.OPENCODE_SERVER_USERNAME ?? "opencode"
  const password = env.OPENCODE_SERVER_PASSWORD ?? process.env.OPENCODE_SERVER_PASSWORD ?? ""
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

function providerModel(model) {
  const [providerID, ...rest] = model.split("/")
  return { providerID, modelID: rest.join("/") }
}

function containsDisallowedFastModel(target) {
  if (!target.model) return false
  return /\b(flash|fast|turbo)\b/i.test([target.model, target.variant, target.effort].filter(Boolean).join("/"))
}

function targetModelLabel(target) {
  if (target.kind === "codex") return `${target.model} / effort=${target.effort}`
  return `${target.model}${target.variant ? ` / variant=${target.variant}` : ""}${
    target.effortLabel ? ` / effort=${target.effortLabel}` : ""
  }`
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function runCommand(command, args, options = {}) {
  const started = Date.now()
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS
  let timedOut = false
  let hardTimer
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.input ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  })
  let stdout = ""
  let stderr = ""
  let spawnError
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8")
  })
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8")
  })
  child.on("error", (error) => {
    spawnError = error
  })
  if (options.input) {
    child.stdin.write(options.input)
    child.stdin.end()
  }
  const killChild = (signal) => {
    if (process.platform === "win32") {
      child.kill(signal)
      return
    }
    try {
      process.kill(-child.pid, signal)
    } catch {
      child.kill(signal)
    }
  }
  const timer = setTimeout(() => {
    timedOut = true
    killChild("SIGTERM")
    hardTimer = setTimeout(() => killChild("SIGKILL"), 5_000)
  }, timeoutMs)
  const code = await new Promise((resolve) => {
    child.on("close", resolve)
    child.on("error", () => resolve(127))
  })
  clearTimeout(timer)
  if (hardTimer) clearTimeout(hardTimer)
  return {
    code: typeof code === "number" ? code : timedOut ? 124 : 1,
    durationMs: Date.now() - started,
    stdout,
    stderr: spawnError ? `${stderr}\n${spawnError.message}`.trim() : stderr,
    timedOut,
  }
}

async function requestJSON(url, options) {
  const controller = new AbortController()
  const timeoutMs = options?.timeoutMs ?? 30_000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const fetchOptions = { ...(options ?? {}), signal: options?.signal ?? controller.signal }
  delete fetchOptions.timeoutMs
  const response = await fetch(url, fetchOptions)
  const text = await response.text()
  clearTimeout(timer)
  let data
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = text
  }
  if (!response.ok) {
    const body = typeof data === "string" ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)
    throw new Error(`HTTP ${response.status}: ${body}`)
  }
  return data
}

async function loadProviderCatalog(target) {
  const env = await envFromFile(target.envFile)
  return requestJSON(`${target.baseURL}/provider?directory=${encodeURIComponent("/srv/aialra/turn-harness-target")}`, {
    headers: { authorization: authHeader(env) },
  })
}

function findCatalogModel(catalog, modelRef) {
  const parsed = providerModel(modelRef)
  const provider = (catalog.all ?? catalog.providers ?? []).find((item) => item.id === parsed.providerID)
  return provider?.models?.[parsed.modelID]
}

async function validateTargets() {
  if (targets.length === 0) throw new Error("No benchmark targets selected")
  for (const target of targets) {
    if (containsDisallowedFastModel(target)) {
      throw new Error(`Target ${target.id} uses a disallowed fast/flash/turbo model: ${targetModelLabel(target)}`)
    }
    if (target.kind !== "opencode") continue
    const model = findCatalogModel(await loadProviderCatalog(target), target.model)
    if (!model) throw new Error(`Target ${target.id} model not found in provider catalog: ${target.model}`)
    if (target.variant && !model.variants?.[target.variant]) {
      throw new Error(`Target ${target.id} variant not found: ${target.model}/${target.variant}`)
    }
    if (!model.capabilities?.toolcall) throw new Error(`Target ${target.id} model has no tool calls: ${target.model}`)
  }
}

async function readPublicEvents(target, sessionID, auth) {
  if (!target.publicEvents) return []
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2000)
  let text = ""
  try {
    const response = await fetch(`${target.baseURL}/session/${sessionID}/events/public`, {
      headers: { authorization: auth },
      signal: controller.signal,
    })
    const reader = response.body?.getReader()
    if (!reader) return []
    const decoder = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
    }
  } catch {
    // Public event streams are long-lived. A short read timeout captures replay.
  } finally {
    clearTimeout(timer)
  }
  return text
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    .filter(Boolean)
}

function textFromMessages(messages) {
  const assistant = [...messages].reverse().find((message) => message.info?.role === "assistant" || message.role === "assistant")
  return (assistant?.parts ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .slice(0, 1800)
}

function countToolCalls(messages) {
  return messages.reduce((sum, message) => sum + (message.parts ?? []).filter((part) => part.type === "tool").length, 0)
}

async function fetchJSON(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 45_000)
  try {
    const response = await fetch(url, { signal: controller.signal })
    const text = await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`)
    return JSON.parse(text)
  } finally {
    clearTimeout(timer)
  }
}

async function fetchRowsForDataset(source, wantedIDs) {
  const found = new Map()
  const maxRows = Number(process.env.AIALRA_REAL_BENCH_MAX_SCAN_ROWS ?? "5000")
  const pageSize = Number(process.env.AIALRA_REAL_BENCH_PAGE_SIZE ?? "100")
  for (let offset = 0; offset < maxRows && found.size < wantedIDs.size; offset += pageSize) {
    const url = new URL("https://datasets-server.huggingface.co/rows")
    url.searchParams.set("dataset", source.dataset)
    url.searchParams.set("config", "default")
    url.searchParams.set("split", source.split)
    url.searchParams.set("offset", String(offset))
    url.searchParams.set("length", String(Math.min(pageSize, maxRows - offset)))
    console.error(`[real-bench] fetch ${source.key} offset=${offset}`)
    const data = await fetchJSON(url)
    const rows = Array.isArray(data.rows) ? data.rows : []
    if (rows.length === 0) break
    for (const item of rows) {
      const row = item.row ?? item
      const id = row.instance_id ?? row.instanceID ?? row.id
      if (wantedIDs.has(id)) found.set(id, row)
    }
    if (rows.length < pageSize) break
  }
  return found
}

async function loadFullRows(manifest, selectedCases) {
  const byDataset = new Map()
  for (const item of selectedCases) {
    const source = manifest.sources.find((source) => source.key === item.datasetKey || source.dataset === item.dataset)
    if (!source) throw new Error(`Missing source for ${item.datasetKey}`)
    const existing = byDataset.get(source.key) ?? { source, ids: new Set() }
    existing.ids.add(item.instanceID)
    byDataset.set(source.key, existing)
  }
  const rows = new Map()
  for (const { source, ids } of byDataset.values()) {
    const found = await fetchRowsForDataset(source, ids)
    for (const [id, row] of found) rows.set(id, row)
  }
  for (const item of selectedCases) {
    if (!rows.has(item.instanceID)) throw new Error(`Could not fetch full row for ${item.instanceID}`)
  }
  return rows
}

function asArray(value) {
  if (Array.isArray(value)) return value
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : [value]
    } catch {
      return value
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean)
    }
  }
  return []
}

function rowProblem(row) {
  return [row.problem_statement, row.hints_text, row.requirements, row.interface].filter(Boolean).join("\n\n").trim()
}

function buildAgentPrompt(row, item) {
  const problem = rowProblem(row)
  return [
    "You are fixing a real benchmark issue in this repository.",
    "Use only the issue text below as benchmark ground truth. Do not assume access to any gold patch or hidden tests.",
    "Inspect the repository, make the smallest correct code change, and run focused tests if the environment allows it.",
    "When finished, summarize root cause, changed files, and validation.",
    "",
    `Benchmark instance: ${item.instanceID}`,
    `Repository: ${item.repo}`,
    "",
    "Issue text:",
    problem,
  ].join("\n")
}

const mirrorPromises = new Map()

async function ensureMirror(repo) {
  const key = repo.replaceAll("/", "__")
  const mirror = join(REPO_CACHE, `${key}.git`)
  if (mirrorPromises.has(mirror)) return mirrorPromises.get(mirror)
  const promise = (async () => {
    await mkdir(REPO_CACHE, { recursive: true })
    if (await exists(mirror)) {
      await runCommand("git", ["-C", mirror, "fetch", "--prune", "origin"], { timeoutMs: 300_000 }).catch(() => undefined)
    } else {
      const url = `https://github.com/${repo}.git`
      const result = await runCommand("git", ["clone", "--mirror", url, mirror], { timeoutMs: 900_000 })
      if (result.code !== 0) throw new Error(`git clone mirror failed for ${repo}: ${result.stderr.slice(0, 600)}`)
    }
    return mirror
  })()
  mirrorPromises.set(mirror, promise)
  return promise
}

async function prepareWorktree(target, item, row) {
  const targetRoot = join(runRoot, target.id, item.instanceID)
  const worktree = join(targetRoot, "worktree")
  await rm(worktree, { recursive: true, force: true })
  await mkdir(targetRoot, { recursive: true })
  const mirror = await ensureMirror(item.repo)
  const clone = await runCommand("git", ["clone", mirror, worktree], { timeoutMs: 600_000 })
  if (clone.code !== 0) throw new Error(`git clone worktree failed: ${clone.stderr.slice(0, 600)}`)
  const checkout = await runCommand("git", ["checkout", "--force", item.baseCommit], { cwd: worktree, timeoutMs: 120_000 })
  if (checkout.code !== 0) throw new Error(`git checkout ${item.baseCommit} failed: ${checkout.stderr.slice(0, 600)}`)
  await runCommand("git", ["clean", "-xfd"], { cwd: worktree, timeoutMs: 120_000 })
  await writeFile(join(targetRoot, "benchmark-row.json"), JSON.stringify(row, null, 2) + "\n")
  await writeFile(join(targetRoot, "problem-statement.md"), rowProblem(row) + "\n")
  return { targetRoot, worktree }
}

async function runCodex(target, item, row, worktree, targetRoot) {
  const prompt = buildAgentPrompt(row, item)
  const args = ["exec", "--json", "--full-auto", "--skip-git-repo-check", "-C", worktree]
  if (target.model) args.push("-m", target.model)
  if (target.effort) args.push("-c", `model_reasoning_effort="${target.effort}"`)
  args.push(prompt)
  const result = await runCommand(CODEX_BIN, args, { cwd: worktree, timeoutMs: TIMEOUT_MS })
  await writeFile(join(targetRoot, "codex-stdout.jsonl"), result.stdout)
  await writeFile(join(targetRoot, "codex-stderr.log"), result.stderr)
  const events = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return undefined
      }
    })
    .filter(Boolean)
  const final = [...events].reverse().find((event) => {
    if (event.msg || event.message) return true
    if (event.type === "agent_message") return true
    if (event.type === "item.completed" && event.item?.type === "agent_message") return true
    return false
  })
  return {
    ok: result.code === 0,
    timedOut: result.timedOut,
    durationMs: result.durationMs,
    waitingApproval: false,
    waitingQuestion: false,
    hasTurnTerminal: events.some((event) => String(event.type ?? "").includes("turn")) || result.code === 0,
    toolCallCount: events.filter((event) => String(event.type ?? "").includes("tool") || String(event.item?.type ?? "").includes("tool")).length,
    finalText: String(final?.item?.text ?? final?.msg ?? final?.message ?? "").slice(0, 1800),
    error: result.code === 0 ? "" : result.stderr.slice(0, 1800),
  }
}

async function runOpenCode(target, item, row, worktree, targetRoot) {
  const prompt = buildAgentPrompt(row, item)
  const env = await envFromFile(target.envFile)
  const auth = authHeader(env)
  const query = `directory=${encodeURIComponent(worktree)}`
  const started = Date.now()
  let sessionID = ""
  try {
    const session = await requestJSON(`${target.baseURL}/session?${query}`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: "{}",
    })
    sessionID = session.id
    const promptResponse = await requestJSON(`${target.baseURL}/session/${sessionID}/prompt_async?${query}`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify({
        parts: [{ type: "text", text: prompt }],
        model: providerModel(target.model),
        ...(target.variant ? { variant: target.variant } : {}),
      }),
    })
    await writeFile(join(targetRoot, "opencode-prompt-async.json"), JSON.stringify(promptResponse, null, 2) + "\n")
    let messages = []
    let status
    let waitingApproval = false
    let waitingQuestion = false
    let timedOut = false
    let finalText = ""
    let publicEvents = []
    let pollCount = 0
    let startTimedOut = false
    while (Date.now() - started < TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, 2000))
      pollCount++
      messages = await requestJSON(`${target.baseURL}/session/${sessionID}/message?${query}`, {
        headers: { authorization: auth },
      }).catch(() => [])
      finalText = textFromMessages(messages)
      status = await requestJSON(`${target.baseURL}/session/status?${query}`, {
        headers: { authorization: auth },
      }).catch(() => undefined)
      const permissions = await requestJSON(`${target.baseURL}/permission?${query}`, {
        headers: { authorization: auth },
      }).catch(() => [])
      const questions = await requestJSON(`${target.baseURL}/question?${query}`, {
        headers: { authorization: auth },
      }).catch(() => [])
      waitingApproval = Array.isArray(permissions) && permissions.some((permission) => permission.sessionID === sessionID)
      waitingQuestion = Array.isArray(questions) && questions.some((question) => question.sessionID === sessionID)
      const idle = !status || !JSON.stringify(status).includes(sessionID) || !JSON.stringify(status).includes("busy")
      const hasAssistant = messages.some((message) => message.info?.role === "assistant" || message.role === "assistant")
      if (target.publicEvents && pollCount % 5 === 0) publicEvents = await readPublicEvents(target, sessionID, auth)
      const hasTurnTerminal = publicEvents.some((event) => event.type === "turn.completed" || event.type === "turn.aborted")
      const hasModelActivity =
        hasAssistant ||
        countToolCalls(messages) > 0 ||
        publicEvents.some((event) => /^model\.|^tool\.|^command\.|^file\.|^final\./.test(event.type))
      if (idle && !hasModelActivity && Date.now() - started >= OPENCODE_START_TIMEOUT_MS) {
        startTimedOut = true
        break
      }
      if ((idle && (finalText || hasAssistant)) || hasTurnTerminal || waitingApproval || waitingQuestion) break
    }
    if (Date.now() - started >= TIMEOUT_MS) timedOut = true
    if (timedOut || startTimedOut || waitingApproval || waitingQuestion) {
      await requestJSON(`${target.baseURL}/session/${sessionID}/abort?${query}`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: "{}",
      }).catch(() => undefined)
    }
    publicEvents = await readPublicEvents(target, sessionID, auth)
    await writeFile(join(targetRoot, "opencode-messages.json"), JSON.stringify(messages, null, 2) + "\n")
    await writeFile(join(targetRoot, "opencode-status.json"), JSON.stringify(status ?? {}, null, 2) + "\n")
    if (publicEvents.length) await writeFile(join(targetRoot, "opencode-public-events.json"), JSON.stringify(publicEvents, null, 2) + "\n")
    const hasAssistant = messages.some((message) => message.info?.role === "assistant" || message.role === "assistant")
    const hasTurnTerminal = publicEvents.some((event) => event.type === "turn.completed" || event.type === "turn.aborted")
    const completedWithoutText = !timedOut && !waitingApproval && !waitingQuestion && !finalText && !hasAssistant && hasTurnTerminal
    return {
      sessionID,
      ok: !timedOut && !startTimedOut && !waitingApproval && !waitingQuestion && !completedWithoutText,
      timedOut: timedOut || startTimedOut,
      waitingApproval,
      waitingQuestion,
      durationMs: Date.now() - started,
      hasTurnTerminal: hasTurnTerminal || (!timedOut && !waitingApproval && !waitingQuestion && !target.publicEvents && hasAssistant),
      toolCallCount: countToolCalls(messages),
      eventCount: publicEvents.length,
      finalText: finalText || (waitingApproval ? "等待审批：工具请求需要用户批准" : waitingQuestion ? "等待用户回答问题" : ""),
      error: startTimedOut
        ? `OpenCode did not start assistant/model activity within ${OPENCODE_START_TIMEOUT_MS}ms`
        : completedWithoutText
          ? "session became idle without an assistant message"
          : "",
    }
  } catch (error) {
    return {
      sessionID,
      ok: false,
      timedOut: Date.now() - started >= TIMEOUT_MS,
      waitingApproval: false,
      waitingQuestion: false,
      durationMs: Date.now() - started,
      hasTurnTerminal: false,
      toolCallCount: 0,
      eventCount: 0,
      finalText: "",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function runAgent(target, item, row, worktree, targetRoot) {
  if (target.kind === "codex") return runCodex(target, item, row, worktree, targetRoot)
  return runOpenCode(target, item, row, worktree, targetRoot)
}

function localTestCommand(row, worktree) {
  const failToPass = asArray(row.FAIL_TO_PASS ?? row.fail_to_pass)
  if (failToPass.length === 0) return undefined
  if (row.repo?.includes("django/django")) return ["python3", ["tests/runtests.py", ...failToPass]]
  if (row.repo?.includes("sympy/sympy")) return ["python3", ["-m", "pytest", ...failToPass]]
  if (row.repo?.includes("pytest-dev/pytest")) return ["python3", ["-m", "pytest", ...failToPass]]
  if (row.repo?.includes("psf/requests")) return ["python3", ["-m", "pytest", ...failToPass]]
  return ["python3", ["-m", "pytest", ...failToPass]]
}

async function readPatch(worktree) {
  const diff = await runCommand("git", ["diff", "--", "."], { cwd: worktree, timeoutMs: 60_000 })
  return diff.stdout
}

async function verifyOfficial(targetRoot, item, row, modelPatch, target) {
  if (!item.dataset?.startsWith("SWE-bench/")) {
    return {
      mode: "official",
      attempted: false,
      passed: undefined,
      reason: "official harness only supports SWE-bench datasets in this runner",
    }
  }
  const officialDir = join(targetRoot, "official-harness")
  await mkdir(officialDir, { recursive: true })
  const predictionsPath = join(officialDir, "predictions.jsonl")
  await writeFile(
    predictionsPath,
    JSON.stringify({
      instance_id: item.instanceID,
      model_name_or_path: `${target.id}-${item.instanceID}`,
      model_patch: modelPatch,
    }) + "\n",
  )
  const result = await runCommand(
    "uvx",
    [
      "--from",
      "swebench",
      "python",
      "-m",
      "swebench.harness.run_evaluation",
      "-d",
      item.dataset,
      "-s",
      item.split,
      "-i",
      item.instanceID,
      "-p",
      predictionsPath,
      "--max_workers",
      "1",
      "-t",
      String(OFFICIAL_TIMEOUT_SECONDS),
      "-id",
      `${runID}-${target.id}-${item.instanceID}`.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 160),
      "--report_dir",
      officialDir,
    ],
    { cwd: officialDir, timeoutMs: (OFFICIAL_TIMEOUT_SECONDS + 900) * 1000 },
  )
  await writeFile(join(officialDir, "stdout.log"), result.stdout)
  await writeFile(join(officialDir, "stderr.log"), result.stderr)
  const files = await readdir(officialDir).catch(() => [])
  const reportFile = files.find((file) => file.endsWith(".json") && !file.endsWith(".jsonl"))
  let report
  if (reportFile) {
    try {
      report = JSON.parse(await readFile(join(officialDir, reportFile), "utf8"))
    } catch {
      report = undefined
    }
  }
  return {
    mode: "official",
    attempted: true,
    passed: report ? (report.resolved_ids ?? []).includes(item.instanceID) : false,
    completed: report ? (report.completed_ids ?? []).includes(item.instanceID) : false,
    timedOut: result.timedOut,
    code: result.code,
    reportFile: reportFile ? join(officialDir, reportFile) : "",
    output: `${result.stdout}\n${result.stderr}`.trim().slice(0, 3000),
  }
}

async function verifyLocal(targetRoot, worktree, row) {
  const testPatch = row.test_patch ?? ""
  const testPatchPath = join(targetRoot, "test.patch")
  if (testPatch) await writeFile(testPatchPath, testPatch)
  const diffCheck = await runCommand("git", ["diff", "--check"], { cwd: worktree, timeoutMs: 60_000 })
  let testPatchApply = { code: testPatch ? 1 : 0, stdout: "", stderr: "no test_patch" }
  if (testPatch) {
    const check = await runCommand("git", ["apply", "--check", testPatchPath], { cwd: worktree, timeoutMs: 60_000 })
    if (check.code === 0) {
      testPatchApply = await runCommand("git", ["apply", testPatchPath], { cwd: worktree, timeoutMs: 60_000 })
    } else {
      testPatchApply = check
    }
  }
  const command = testPatchApply.code === 0 ? localTestCommand(row, worktree) : undefined
  let testResult
  if (command) {
    testResult = await runCommand(command[0], command[1], { cwd: worktree, timeoutMs: TEST_TIMEOUT_MS })
    await writeFile(join(targetRoot, "local-test.stdout.log"), testResult.stdout)
    await writeFile(join(targetRoot, "local-test.stderr.log"), testResult.stderr)
  }
  return {
    mode: "local-test-patch",
    attempted: !!command,
    passed: testResult ? testResult.code === 0 : undefined,
    diffCheckPass: diffCheck.code === 0,
    testPatchApplied: testPatchApply.code === 0,
    command: command ? [command[0], ...command[1]].join(" ") : "",
    output: testResult ? `${testResult.stdout}\n${testResult.stderr}`.trim().slice(0, 3000) : testPatchApply.stderr.slice(0, 1200),
  }
}

async function inspectAndVerify(targetRoot, worktree, item, row, target) {
  const modelPatch = await readPatch(worktree)
  await writeFile(join(targetRoot, "model.patch"), modelPatch)
  const diffStat = await runCommand("git", ["diff", "--stat"], { cwd: worktree, timeoutMs: 60_000 })
  const diffNames = await runCommand("git", ["diff", "--name-only"], { cwd: worktree, timeoutMs: 60_000 })
  let verification
  if (VERIFY_MODE === "official") {
    verification = await verifyOfficial(targetRoot, item, row, modelPatch, target)
  } else if (VERIFY_MODE === "hybrid") {
    verification = item.dataset?.startsWith("SWE-bench/")
      ? await verifyOfficial(targetRoot, item, row, modelPatch, target)
      : await verifyLocal(targetRoot, worktree, row)
  } else if (VERIFY_MODE === "none") {
    verification = { mode: "none", attempted: false, passed: undefined }
  } else {
    verification = await verifyLocal(targetRoot, worktree, row)
  }
  return {
    changedFiles: diffNames.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
    patchBytes: modelPatch.length,
    diffStat: diffStat.stdout.trim(),
    verification,
  }
}

async function runJob(target, item, row) {
  const targetRoot = join(runRoot, target.id, item.instanceID)
  try {
    const prepared = await prepareWorktree(target, item, row)
    const agent = await runAgent(target, item, row, prepared.worktree, prepared.targetRoot)
    const inspection = await inspectAndVerify(prepared.targetRoot, prepared.worktree, item, row, target)
    const result = {
      target: target.id,
      targetName: target.name,
      targetModel: targetModelLabel(target),
      caseID: item.instanceID,
      datasetKey: item.datasetKey,
      repo: item.repo,
      cwd: prepared.worktree,
      ...agent,
      ...inspection,
    }
    await writeFile(join(prepared.targetRoot, "result.json"), JSON.stringify(result, null, 2) + "\n")
    return result
  } finally {
    await cleanupJobWorkspace(targetRoot)
  }
}

async function cleanupJobWorkspace(targetRoot) {
  if (KEEP_WORKTREES) return
  await rm(join(targetRoot, "worktree"), { recursive: true, force: true })
  await rm(join(targetRoot, "official-harness"), { recursive: true, force: true })
  if (DOCKER_PRUNE) {
    await runCommand("docker", ["system", "prune", "-af"], { timeoutMs: 300_000 })
  }
}

function scoreResult(result) {
  let score = 0
  if (result.ok) score += 4
  if (!result.timedOut) score += 2
  if (!result.waitingApproval && !result.waitingQuestion) score += 2
  if (result.hasTurnTerminal) score += 2
  if (result.patchBytes > 0) score += 4
  if (result.patchBytes > 0 && result.patchBytes < 80_000) score += 1
  if (result.verification?.diffCheckPass) score += 1
  if (result.verification?.testPatchApplied) score += 2
  if (result.verification?.mode === "official" && result.verification?.passed) score += 20
  if (result.verification?.mode === "local-test-patch" && result.verification?.passed) score += 10
  if (result.verification?.attempted && result.verification?.passed === false) score -= 4
  return score
}

function mark(value) {
  if (value === undefined) return "-"
  return value ? "是" : "否"
}

function renderReport(manifest, selected, results) {
  const lines = []
  lines.push("# AIALRA 真实高难 Benchmark 五组合报告")
  lines.push("")
  lines.push(`- 运行 ID：\`${runID}\``)
  lines.push(`- manifest：\`${MANIFEST_PATH}\``)
  lines.push(`- 运行目录：\`${runRoot}\``)
  lines.push(`- 测评组合数：\`${targets.length}\``)
  lines.push(`- 并发度：\`${PARALLEL}\``)
  lines.push(`- 验证模式：\`${VERIFY_MODE}\``)
  lines.push(`- 说明：agent 只收到 problem statement，未收到 gold patch 或 test_patch`)
  lines.push("")
  lines.push("## 模型与推理档位")
  lines.push("")
  lines.push("| 对象 | 模型 / 档位 |")
  lines.push("| --- | --- |")
  for (const target of targets) lines.push(`| ${target.name} | \`${targetModelLabel(target)}\` |`)
  lines.push("")
  lines.push("## 总览")
  lines.push("")
  lines.push("| 对象 | 模型 / 档位 | 总分 | 完成 | 有 patch | 验证通过 | 超时 | 等待审批 | turn 终态 |")
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |")
  for (const target of targets) {
    const own = results.filter((item) => item.target === target.id)
    lines.push(
      `| ${target.name} | \`${targetModelLabel(target)}\` | ${own.reduce((sum, item) => sum + scoreResult(item), 0)} | ${own.filter((item) => item.ok).length}/${selected.length} | ${own.filter((item) => item.patchBytes > 0).length}/${selected.length} | ${own.filter((item) => item.verification?.passed).length}/${selected.length} | ${own.filter((item) => item.timedOut).length} | ${own.filter((item) => item.waitingApproval || item.waitingQuestion).length} | ${own.filter((item) => item.hasTurnTerminal).length}/${selected.length} |`,
    )
  }
  lines.push("")
  for (const item of selected) {
    const caseResults = results.filter((result) => result.caseID === item.instanceID)
    lines.push(`## ${item.instanceID}`)
    lines.push("")
    lines.push(`- 数据集：\`${item.datasetKey}\``)
    lines.push(`- 仓库：\`${item.repo}\``)
    lines.push(`- base commit：\`${item.baseCommit}\``)
    lines.push(`- 估算 token：\`${item.estimatedPromptTokens}\``)
    lines.push(`- F2P/P2P：\`${item.failToPassCount}/${item.passToPassCount}\``)
    lines.push("")
    lines.push("| 对象 | 模型 / 档位 | 分数 | 完成 | patch | 验证模式 | 验证通过 | 测试补丁 | 超时 | 等待审批 | 工具调用 | 耗时 |")
    lines.push("| --- | --- | ---: | --- | ---: | --- | --- | --- | --- | --- | ---: | ---: |")
    for (const result of caseResults) {
      lines.push(
        `| ${result.targetName} | \`${result.targetModel ?? "-"}\` | ${scoreResult(result)} | ${mark(result.ok)} | ${result.patchBytes} B | ${result.verification?.mode ?? "-"} | ${mark(result.verification?.passed)} | ${mark(result.verification?.testPatchApplied)} | ${mark(result.timedOut)} | ${mark(result.waitingApproval || result.waitingQuestion)} | ${result.toolCallCount ?? 0} | ${result.durationMs} ms |`,
      )
    }
    lines.push("")
    for (const result of caseResults) {
      lines.push(`<details><summary>${result.targetName} 详情</summary>`)
      lines.push("")
      lines.push("输出摘要：")
      lines.push("```text")
      lines.push((result.finalText || result.error || "(无输出)").trim())
      lines.push("```")
      if (result.diffStat) {
        lines.push("")
        lines.push("改动摘要：")
        lines.push("```text")
        lines.push(result.diffStat)
        lines.push("```")
      }
      if (result.verification?.output) {
        lines.push("")
        lines.push("验证输出：")
        lines.push("```text")
        lines.push(result.verification.output)
        lines.push("```")
      }
      lines.push("")
      lines.push("</details>")
      lines.push("")
    }
  }
  lines.push("## 验证等级说明")
  lines.push("")
  lines.push("- `official` 表示调用 SWE-bench 官方 Docker harness")
  lines.push("- `local-test-patch` 表示先应用公开 test_patch，再按 FAIL_TO_PASS 尝试本地测试")
  lines.push("- `local-test-patch` 不是官方等价结果，依赖本机依赖环境，报告里必须单独标明")
  lines.push("")
  return lines.join("\n")
}

async function runJobsWithLimit(items, limit, onResult) {
  const results = []
  let next = 0
  async function worker(workerID) {
    while (next < items.length) {
      const current = items[next++]
      console.error(`[real-bench] worker=${workerID} ${current.target.id} ${current.item.instanceID}`)
      try {
        const result = await runJob(current.target, current.item, current.row)
        results.push(result)
        await onResult?.(results)
      } catch (error) {
        const result = {
          target: current.target.id,
          targetName: current.target.name,
          targetModel: targetModelLabel(current.target),
          caseID: current.item.instanceID,
          datasetKey: current.item.datasetKey,
          repo: current.item.repo,
          ok: false,
          timedOut: false,
          waitingApproval: false,
          waitingQuestion: false,
          hasTurnTerminal: false,
          patchBytes: 0,
          durationMs: 0,
          toolCallCount: 0,
          verification: { mode: VERIFY_MODE, attempted: false, passed: false, output: "" },
          error: error instanceof Error ? error.message : String(error),
        }
        results.push(result)
        await onResult?.(results)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, (_, index) => worker(index + 1)))
  return results
}

async function loadExistingResults(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"))
  } catch {
    return []
  }
}

function jobKey(job) {
  return `${job.target.id}\u0000${job.item.instanceID}`
}

function resultKey(result) {
  return `${result.target}\u0000${result.caseID}`
}

function mergeResults(existing, partial, jobs) {
  const merged = new Map()
  for (const result of existing) merged.set(resultKey(result), result)
  for (const result of partial) merged.set(resultKey(result), result)
  const order = new Map(jobs.map((job, index) => [jobKey(job), index]))
  return Array.from(merged.values()).sort(
    (left, right) => (order.get(resultKey(left)) ?? 1_000_000) - (order.get(resultKey(right)) ?? 1_000_000),
  )
}

const manifest = JSON.parse(await readFile(MANIFEST_PATH, "utf8"))
const selected = manifest.cases
  .filter((item) => CASE_FILTER.size === 0 || CASE_FILTER.has(item.instanceID) || CASE_FILTER.has(item.repo))
  .slice(0, CASE_LIMIT)
await validateTargets()
await mkdir(REPORT_DIR, { recursive: true })
await mkdir(runRoot, { recursive: true })
const rows = await loadFullRows(manifest, selected)
const jobs = []
for (const item of selected) {
  for (const target of targets) jobs.push({ item, target, row: rows.get(item.instanceID) })
}
const partialResultsPath = join(runRoot, "results.partial.json")
const partialReportPath = join(runRoot, "report.partial.md")
const existingResults = await loadExistingResults(partialResultsPath)
const completed = new Set(existingResults.map(resultKey))
const pendingJobs = jobs.filter((job) => !completed.has(jobKey(job)))
if (existingResults.length > 0) {
  console.log(`[real-bench] resume run=${runID} completed=${existingResults.length} pending=${pendingJobs.length}`)
}
const pendingResults = await runJobsWithLimit(pendingJobs, PARALLEL, async (partial) => {
  const combined = mergeResults(existingResults, partial, jobs)
  await writeFile(partialResultsPath, JSON.stringify(combined, null, 2) + "\n")
  await writeFile(partialReportPath, renderReport(manifest, selected, combined))
})
const results = mergeResults(existingResults, pendingResults, jobs)
const report = renderReport(manifest, selected, results)
const reportPath = join(REPORT_DIR, `real-benchmark-${runID}.md`)
await writeFile(reportPath, report)
await writeFile(join(runRoot, "results.json"), JSON.stringify(results, null, 2) + "\n")
console.log(reportPath)

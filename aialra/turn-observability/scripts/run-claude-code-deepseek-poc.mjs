#!/usr/bin/env node
import { spawn } from "node:child_process"
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const REPO_ROOT = "/srv/aialra/apps/opencode-turn-engine"
const REPORT_DIR = join(REPO_ROOT, "aialra/turn-observability/real-benchmark-reports")
const runID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)
const claudeBin = process.env.AIALRA_CLAUDE_CODE_BIN ?? "claude"
const baseURL = process.env.ANTHROPIC_BASE_URL
const model = process.env.AIALRA_CLAUDE_CODE_DEEPSEEK_MODEL ?? process.env.ANTHROPIC_MODEL ?? "deepseek/deepseek-v4-pro"

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    })
    const stdout = []
    const stderr = []
    child.stdout.on("data", (chunk) => stdout.push(chunk))
    child.stderr.on("data", (chunk) => stderr.push(chunk))
    child.on("error", (error) => resolve({ code: 127, stdout: "", stderr: String(error) }))
    child.on("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    )
  })
}

await mkdir(REPORT_DIR, { recursive: true })

const version = await run(claudeBin, ["--version"])
const ready = version.code === 0 && !!baseURL
const smoke = ready
  ? await run(claudeBin, ["-p", "只回复 OK"], {
      env: {
        ANTHROPIC_MODEL: model,
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: process.env.CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY ?? "1",
      },
    })
  : undefined

const report = [
  "# Claude Code + DeepSeek PoC",
  "",
  `- runID: \`${runID}\``,
  `- claude binary: \`${claudeBin}\``,
  `- ANTHROPIC_BASE_URL configured: \`${Boolean(baseURL)}\``,
  `- model: \`${model}\``,
  `- ready: \`${ready}\``,
  "",
  "## Version check",
  "",
  "```text",
  `${version.stdout}${version.stderr}`.trim(),
  "```",
  "",
  "## Smoke",
  "",
  ready
    ? [
        `- exit: \`${smoke?.code}\``,
        "```text",
        `${smoke?.stdout ?? ""}${smoke?.stderr ?? ""}`.trim(),
        "```",
      ].join("\n")
    : "未运行。需要可用的 claude CLI 和 ANTHROPIC_BASE_URL，Anthropic 兼容网关",
  "",
  "## 结论",
  "",
  ready
    ? "PoC 入口可用。下一步可以把 tier-regression-6 的 6 题接到这个 runner"
    : "PoC 未达可运行条件，本脚本只记录环境缺口，不把它伪装成已完成",
  "",
].join("\n")

const reportPath = join(REPORT_DIR, `claude-code-deepseek-poc-${runID}.md`)
await writeFile(reportPath, report)
console.log(reportPath)

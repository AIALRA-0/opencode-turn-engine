#!/usr/bin/env node
import { readdir, rm, stat, writeFile, mkdir } from "node:fs/promises"
import { join } from "node:path"
import { spawn } from "node:child_process"

const REPO_ROOT = "/srv/aialra/apps/opencode-turn-engine"
const ROOT = process.env.AIALRA_REAL_BENCH_ROOT ?? "/srv/aialra/turn-harness-target/real-bench-runs"
const REPORT_DIR =
  process.env.AIALRA_REAL_BENCH_REPORT_DIR ??
  join(REPO_ROOT, "aialra/turn-observability/real-benchmark-reports")
const KEEP_FULL = Number(process.env.AIALRA_BENCH_KEEP_FULL ?? "2")
const KEEP_REGRESSION = Number(process.env.AIALRA_BENCH_KEEP_REGRESSION ?? "5")
const APPLY = process.env.AIALRA_BENCH_CLEANUP_APPLY === "1"
const DOCKER_PRUNE = process.env.AIALRA_BENCH_CLEANUP_DOCKER === "1"
const runID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)

async function size(path) {
  try {
    const item = await stat(path)
    if (!item.isDirectory()) return item.size
    const children = await readdir(path)
    const sizes = await Promise.all(children.map((child) => size(join(path, child))))
    return sizes.reduce((sum, value) => sum + value, 0)
  } catch {
    return 0
  }
}

async function runDirs() {
  try {
    const names = await readdir(ROOT)
    const entries = await Promise.all(
      names.map(async (name) => ({
        name,
        path: join(ROOT, name),
        stat: await stat(join(ROOT, name)).catch(() => undefined),
      })),
    )
    return entries
      .filter((entry) => entry.stat?.isDirectory())
      .sort((left, right) => (right.stat?.mtimeMs ?? 0) - (left.stat?.mtimeMs ?? 0))
  } catch {
    return []
  }
}

async function dockerPrune() {
  if (!DOCKER_PRUNE || !APPLY) return { skipped: true }
  const child = spawn("docker", ["system", "prune", "-f"], { stdio: ["ignore", "pipe", "pipe"] })
  const stdout = []
  const stderr = []
  child.stdout.on("data", (chunk) => stdout.push(chunk))
  child.stderr.on("data", (chunk) => stderr.push(chunk))
  const code = await new Promise((resolve) => child.on("close", resolve))
  return {
    skipped: false,
    code,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8"),
  }
}

const dirs = await runDirs()
const keep = new Set([
  ...dirs.filter((dir) => dir.name.includes("regression")).slice(0, KEEP_REGRESSION).map((dir) => dir.name),
  ...dirs.filter((dir) => !dir.name.includes("regression")).slice(0, KEEP_FULL).map((dir) => dir.name),
])
const remove = dirs.filter((dir) => !keep.has(dir.name))
const beforeBytes = (await Promise.all(remove.map((dir) => size(dir.path)))).reduce((sum, value) => sum + value, 0)

if (APPLY) {
  for (const dir of remove) await rm(dir.path, { recursive: true, force: true })
}

const docker = await dockerPrune()
await mkdir(REPORT_DIR, { recursive: true })
const report = [
  "# Benchmark cleanup report",
  "",
  `- runID: \`${runID}\``,
  `- root: \`${ROOT}\``,
  `- apply: \`${APPLY}\``,
  `- keep full: \`${KEEP_FULL}\``,
  `- keep regression: \`${KEEP_REGRESSION}\``,
  `- removable dirs: \`${remove.length}\``,
  `- reclaimable bytes: \`${beforeBytes}\``,
  `- docker prune: \`${JSON.stringify(docker)}\``,
  "",
  "## Removed candidates",
  "",
  ...remove.map((dir) => `- \`${dir.path}\``),
  "",
].join("\n")

const reportPath = join(REPORT_DIR, `benchmark-cleanup-${runID}.md`)
await writeFile(reportPath, report)
console.log(reportPath)

#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"

const OUTPUT_DIR =
  process.env.AIALRA_BENCHMARK_OUTPUT_DIR ??
  "/srv/aialra/apps/opencode-turn-engine/aialra/turn-observability/benchmark-cases"
const LIMIT = Number(process.env.AIALRA_BENCHMARK_LIMIT ?? "24")
const TARGET_TOKENS = Number(process.env.AIALRA_BENCHMARK_TARGET_TOKENS ?? "3500")
const MIN_TOKENS = Number(process.env.AIALRA_BENCHMARK_MIN_TOKENS ?? "700")
const MAX_TOKENS = Number(process.env.AIALRA_BENCHMARK_MAX_TOKENS ?? "12000")
const MAX_ROWS_PER_DATASET = Number(process.env.AIALRA_BENCHMARK_MAX_ROWS_PER_DATASET ?? "300")
const PAGE_SIZE = Number(process.env.AIALRA_BENCHMARK_PAGE_SIZE ?? "50")
const MAX_PER_REPO = Number(process.env.AIALRA_BENCHMARK_MAX_PER_REPO ?? "2")
const DATASET_FILTER = new Set(
  (process.env.AIALRA_BENCHMARK_DATASETS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean),
)

const runID = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)

const datasets = [
  {
    key: "swe-bench-verified",
    name: "SWE-bench Verified",
    nameCN: "SWE-bench Verified，人工筛过的软件工程修复基准",
    dataset: "SWE-bench/SWE-bench_Verified",
    config: "default",
    split: "test",
    sourceURL: "https://huggingface.co/datasets/SWE-bench/SWE-bench_Verified",
  },
  {
    key: "swe-bench-lite",
    name: "SWE-bench Lite",
    nameCN: "SWE-bench Lite，较轻量的软件工程修复基准",
    dataset: "SWE-bench/SWE-bench_Lite",
    config: "default",
    split: "test",
    sourceURL: "https://huggingface.co/datasets/SWE-bench/SWE-bench_Lite",
  },
  {
    key: "swe-bench-pro",
    name: "SWE-bench Pro",
    nameCN: "SWE-bench Pro，更偏复杂企业仓库的软件工程修复基准",
    dataset: "Contextbench/SWE-bench_Pro",
    config: "default",
    split: "test",
    sourceURL: "https://huggingface.co/datasets/Contextbench/SWE-bench_Pro",
  },
].filter((item) => DATASET_FILTER.size === 0 || DATASET_FILTER.has(item.key))

function estimateTokens(text) {
  const compact = String(text ?? "").replace(/\s+/g, " ").trim()
  if (!compact) return 0
  return Math.ceil(compact.length / 4)
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

function difficultyScore(value) {
  const text = String(value ?? "").toLowerCase()
  if (text.includes("expert")) return 45
  if (text.includes("hard")) return 35
  if (text.includes("hour")) return 34
  if (text.includes("30 min")) return 22
  if (text.includes("15 min")) return 12
  if (text.includes("medium")) return 22
  if (text.includes("easy")) return 6
  return 14
}

function issueSpecificityScore(value) {
  const text = String(value ?? "").toLowerCase()
  if (text.includes("low")) return 26
  if (text.includes("medium")) return 16
  if (text.includes("high")) return 6
  return 10
}

function boundedLogScore(value, scale, cap) {
  return Math.min(cap, Math.log10(Math.max(1, value)) * scale)
}

function normalizeRow(source, raw) {
  const problem = raw.problem_statement ?? raw.problem ?? raw.issue ?? ""
  const hints = raw.hints_text ?? raw.hints ?? ""
  const requirements = raw.requirements ?? ""
  const iface = raw.interface ?? ""
  const promptText = [problem, hints, requirements, iface].filter(Boolean).join("\n\n")
  const failToPass = asArray(raw.FAIL_TO_PASS ?? raw.fail_to_pass)
  const passToPass = asArray(raw.PASS_TO_PASS ?? raw.pass_to_pass)
  const patch = raw.patch ?? ""
  const testPatch = raw.test_patch ?? ""
  const estimatedPromptTokens = estimateTokens(promptText)
  const patchBytes = String(patch).length
  const testPatchBytes = String(testPatch).length
  const difficulty = raw.difficulty ?? raw.issue_difficulty ?? ""
  const issueSpecificity = raw.issue_specificity ?? ""
  const tokenPenalty = Math.abs(estimatedPromptTokens - TARGET_TOKENS) / Math.max(1, TARGET_TOKENS)
  const tokenBalance = Math.max(0, 30 - tokenPenalty * 30)
  const score =
    difficultyScore(difficulty) +
    issueSpecificityScore(issueSpecificity) +
    tokenBalance +
    Math.min(22, failToPass.length * 4) +
    Math.min(10, passToPass.length) +
    boundedLogScore(patchBytes, 8, 22) +
    boundedLogScore(testPatchBytes, 6, 16)
  return {
    datasetKey: source.key,
    datasetName: source.name,
    datasetNameCN: source.nameCN,
    sourceURL: source.sourceURL,
    dataset: source.dataset,
    split: source.split,
    repo: raw.repo ?? raw.repository ?? "",
    instanceID: raw.instance_id ?? raw.instanceID ?? raw.id ?? "",
    baseCommit: raw.base_commit ?? raw.baseCommit ?? "",
    environmentSetupCommit: raw.environment_setup_commit ?? "",
    repoLanguage: raw.repo_language ?? "",
    version: raw.version ?? "",
    difficulty: String(difficulty || "unknown"),
    issueSpecificity: String(issueSpecificity || "unknown"),
    estimatedPromptTokens,
    problemChars: String(problem).length,
    patchBytes,
    testPatchBytes,
    failToPassCount: failToPass.length,
    passToPassCount: passToPass.length,
    score: Number(score.toFixed(2)),
    problemPreview: String(problem).replace(/\s+/g, " ").trim().slice(0, 420),
  }
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

async function fetchDatasetRows(source) {
  const rows = []
  for (let offset = 0; offset < MAX_ROWS_PER_DATASET; offset += PAGE_SIZE) {
    const url = new URL("https://datasets-server.huggingface.co/rows")
    url.searchParams.set("dataset", source.dataset)
    url.searchParams.set("config", source.config)
    url.searchParams.set("split", source.split)
    url.searchParams.set("offset", String(offset))
    url.searchParams.set("length", String(Math.min(PAGE_SIZE, MAX_ROWS_PER_DATASET - offset)))
    console.error(`[benchmark] fetch ${source.key} offset=${offset}`)
    const data = await fetchJSON(url)
    const page = Array.isArray(data.rows) ? data.rows : []
    if (page.length === 0) break
    rows.push(...page.map((item) => normalizeRow(source, item.row ?? item)))
    if (page.length < PAGE_SIZE) break
  }
  return rows
}

function selectCases(candidates) {
  const eligible = candidates
    .filter((item) => item.repo && item.instanceID && item.baseCommit)
    .filter((item) => item.estimatedPromptTokens >= MIN_TOKENS && item.estimatedPromptTokens <= MAX_TOKENS)
    .sort((a, b) => b.score - a.score)
  const selected = []
  const repoCounts = new Map()
  for (const item of eligible) {
    const count = repoCounts.get(item.repo) ?? 0
    if (count >= MAX_PER_REPO) continue
    selected.push(item)
    repoCounts.set(item.repo, count + 1)
    if (selected.length >= LIMIT) break
  }
  return selected
}

function renderMarkdown(manifest) {
  const lines = []
  lines.push("# AIALRA Agent Benchmark 真实数据集选题清单")
  lines.push("")
  lines.push(`- 运行 ID：\`${manifest.runID}\``)
  lines.push(`- 生成时间：\`${manifest.generatedAt}\``)
  lines.push(`- 目标 token：\`${manifest.selection.targetTokens}\``)
  lines.push(`- token 范围：\`${manifest.selection.minTokens}\` 到 \`${manifest.selection.maxTokens}\``)
  lines.push(`- 每个仓库最多：\`${manifest.selection.maxPerRepo}\` 道`)
  lines.push(`- 选中数量：\`${manifest.cases.length}\``)
  lines.push("")
  lines.push("## 这份清单解决什么问题")
  lines.push("")
  lines.push("- 旧 A/B 主要验证服务健康、权限收口和小型代码修复，不能代表高难度 agent 能力")
  lines.push("- 新清单从真实公开 benchmark 拉 issue，优先选择难、复杂、但 token 消耗不过分爆炸的任务")
  lines.push("- 这一步只是选题和追溯，不等于已经执行官方 SWE-bench harness，下一步需要 clone 仓库、checkout base commit、运行官方测试")
  lines.push("")
  lines.push("## 数据来源")
  lines.push("")
  for (const source of manifest.sources) {
    lines.push(`- ${source.nameCN}：${source.sourceURL}`)
  }
  lines.push("")
  lines.push("## 评分规则")
  lines.push("")
  lines.push("- 难度越高分越高")
  lines.push("- fail-to-pass 测试越多分越高")
  lines.push("- patch 和 test patch 越复杂分越高，但不会无限加分")
  lines.push("- prompt token 越接近目标 token 分越高，太短拉不开差异，太长会浪费模型预算")
  lines.push("- 同一仓库限制最多入选数量，避免全被一个项目占满")
  lines.push("")
  lines.push("## 入选任务")
  lines.push("")
  lines.push("| 排名 | 分数 | 数据集 | 仓库 | 实例 | 难度 | 估算 token | F2P | P2P | patch | test patch | 摘要 |")
  lines.push("| ---: | ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |")
  manifest.cases.forEach((item, index) => {
    const preview = item.problemPreview.replaceAll("|", "\\|")
    lines.push(
      `| ${index + 1} | ${item.score} | ${item.datasetKey} | \`${item.repo}\` | \`${item.instanceID}\` | ${item.difficulty}/${item.issueSpecificity} | ${item.estimatedPromptTokens} | ${item.failToPassCount} | ${item.passToPassCount} | ${item.patchBytes} B | ${item.testPatchBytes} B | ${preview} |`,
    )
  })
  lines.push("")
  lines.push("## 下一步执行方式")
  lines.push("")
  lines.push("1. 用 manifest 里的 repo、baseCommit、instanceID 准备独立工作区")
  lines.push("2. agent 只拿 problem statement，不拿 gold patch")
  lines.push("3. agent 完成后再应用 test_patch 或调用官方 harness 验证")
  lines.push("4. 三方对象继续是 Codex CLI、debug1 原版 OpenCode、AIALRA OpenCode fork")
  lines.push("5. A/B runner 用并发执行，但每个任务和对象必须独立目录、独立日志、独立越界路径")
  lines.push("")
  return lines.join("\n")
}

await mkdir(OUTPUT_DIR, { recursive: true })

const fetched = []
for (const source of datasets) {
  try {
    fetched.push(...(await fetchDatasetRows(source)))
  } catch (error) {
    console.error(`[benchmark] failed ${source.key}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const cases = selectCases(fetched)
const manifest = {
  schema: "aialra.agent_benchmark_selection.v1",
  runID,
  generatedAt: new Date().toISOString(),
  selection: {
    limit: LIMIT,
    targetTokens: TARGET_TOKENS,
    minTokens: MIN_TOKENS,
    maxTokens: MAX_TOKENS,
    maxRowsPerDataset: MAX_ROWS_PER_DATASET,
    pageSize: PAGE_SIZE,
    maxPerRepo: MAX_PER_REPO,
  },
  sources: datasets.map((item) => ({
    key: item.key,
    name: item.name,
    nameCN: item.nameCN,
    dataset: item.dataset,
    split: item.split,
    sourceURL: item.sourceURL,
  })),
  fetchedCount: fetched.length,
  eligibleCount: fetched.filter((item) => item.estimatedPromptTokens >= MIN_TOKENS && item.estimatedPromptTokens <= MAX_TOKENS).length,
  cases,
}

const jsonPath = join(OUTPUT_DIR, `agent-benchmark-selection-${runID}.json`)
const mdPath = join(OUTPUT_DIR, `agent-benchmark-selection-${runID}.md`)
await writeFile(jsonPath, JSON.stringify(manifest, null, 2) + "\n")
await writeFile(mdPath, renderMarkdown(manifest))
await writeFile(join(OUTPUT_DIR, "latest.json"), JSON.stringify(manifest, null, 2) + "\n")
await writeFile(join(OUTPUT_DIR, "latest.md"), renderMarkdown(manifest))
console.log(mdPath)

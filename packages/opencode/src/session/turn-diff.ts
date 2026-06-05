import { AialraTurnTrace } from "./turn-trace"
import type { ToolResultSettlement } from "./tool-result-settlement"
import { isRecord } from "@/util/record"
import { Effect } from "effect"

type JsonRecord = Record<string, unknown>

type TurnDiffMutation = {
  mutation_id?: string
  tool: string
  tool_call_id: string
  operation?: string
  applied: boolean
  permission_decision?: string
  requested_path?: string
  resolved_path: string
  environment_id?: string
  diff?: JsonRecord
}

type TurnDiffFile = {
  path: string
  requested_paths: string[]
  operation: "create" | "overwrite" | "delete" | "move" | "preview" | "mixed"
  environment_id?: string
  tool_call_ids: string[]
  tools: string[]
  mutation_count: number
  applied: boolean
  before?: JsonRecord
  after?: JsonRecord
  desired?: JsonRecord
  mutations: TurnDiffMutation[]
}

export type TurnDiff = {
  schema: "aialra.turn_diff.v1"
  session_id: string
  turn_id: string
  message_id?: string
  source: "file_mutation_store"
  updated_at: string
  finalized_at?: string
  terminal_outcome?: string
  summary: {
    files: number
    mutations: number
    created: number
    modified: number
    deleted: number
    moved: number
    previews: number
  }
  files: TurnDiffFile[]
}

export type PatchQualityScore = {
  schema: "aialra.patch_quality.v1"
  source: "turn_diff" | "engineering_finish"
  score: number
  grade: "excellent" | "good" | "risky" | "poor"
  patch: {
    hasPatch: boolean
    zeroPatch: boolean
    changedFiles: string[]
    changedFileCount: number
    sourceFileCount: number
    testFileCount: number
    generatedChurnCount: number
    protectedPathCount: number
    publicApiRiskCount: number
    unappliedMutationCount: number
    patchBytes: number
    hugePatch: boolean
    tinyPatch: boolean
    onlyTests: boolean
  }
  verification: {
    status: "passed" | "failed" | "skipped" | "not_observed"
    attempts: number
  }
  risks: string[]
  reasons: string[]
  coverage: {
    testsChanged: boolean
    verificationObserved: boolean
    protectedPathsClean: boolean
    generatedChurnClean: boolean
  }
  diff: TurnDiff
}

const turns = new Map<string, TurnDiff>()

function key(input: { sessionID: string; turnID?: string }) {
  return `${input.sessionID}:${input.turnID ?? "unknown"}`
}

function text(value: unknown) {
  return typeof value === "string" && value ? value : undefined
}

function bool(value: unknown) {
  return typeof value === "boolean" ? value : false
}

function operation(value: unknown): TurnDiffFile["operation"] {
  if (value === "create" || value === "overwrite" || value === "delete" || value === "move" || value === "preview")
    return value
  return "mixed"
}

function state(value: unknown) {
  return isRecord(value) ? value : undefined
}

function mutation(input: { result: ToolResultSettlement; item: JsonRecord }): TurnDiffMutation | undefined {
  const resolved = text(input.item.resolved_path) ?? text(input.item.path)
  if (!resolved) return
  return {
    mutation_id: text(input.item.mutation_id),
    tool: text(input.item.tool) ?? input.result.tool,
    tool_call_id: input.result.toolCallID,
    operation: text(input.item.operation),
    applied: bool(input.item.applied),
    permission_decision: text(input.item.permission_decision) ?? text(input.item.permissionDecision),
    requested_path: text(input.item.requested_path),
    resolved_path: resolved,
    environment_id: text(input.item.environment_id) ?? input.result.environmentID,
    diff: state(input.item.diff),
  }
}

function file(input: { result: ToolResultSettlement; item: JsonRecord; mutation: TurnDiffMutation }): TurnDiffFile {
  return {
    path: input.mutation.resolved_path,
    requested_paths: input.mutation.requested_path ? [input.mutation.requested_path] : [],
    operation: operation(input.item.operation),
    environment_id: input.mutation.environment_id,
    tool_call_ids: [input.result.toolCallID],
    tools: [input.mutation.tool],
    mutation_count: 1,
    applied: input.mutation.applied,
    before: state(input.item.before),
    after: state(input.item.after),
    desired: state(input.item.desired),
    mutations: [input.mutation],
  }
}

function merge(existing: TurnDiffFile, next: TurnDiffFile): TurnDiffFile {
  const operations = new Set([existing.operation, next.operation])
  const operation = operations.size === 1 ? existing.operation : next.operation === "preview" ? existing.operation : "mixed"
  return {
    ...existing,
    operation,
    environment_id: next.environment_id ?? existing.environment_id,
    requested_paths: [...new Set([...existing.requested_paths, ...next.requested_paths])],
    tool_call_ids: [...new Set([...existing.tool_call_ids, ...next.tool_call_ids])],
    tools: [...new Set([...existing.tools, ...next.tools])],
    mutation_count: existing.mutation_count + next.mutation_count,
    applied: existing.applied || next.applied,
    after: next.after ?? existing.after,
    desired: next.desired ?? existing.desired,
    mutations: [...existing.mutations, ...next.mutations],
  }
}

function summarize(files: TurnDiffFile[]): TurnDiff["summary"] {
  return {
    files: files.length,
    mutations: files.reduce((sum, item) => sum + item.mutation_count, 0),
    created: files.filter((item) => item.operation === "create").length,
    modified: files.filter((item) => item.operation === "overwrite" || item.operation === "mixed").length,
    deleted: files.filter((item) => item.operation === "delete").length,
    moved: files.filter((item) => item.operation === "move").length,
    previews: files.filter((item) => item.operation === "preview").length,
  }
}

export namespace TurnDiffStore {
  export function update(result: ToolResultSettlement) {
    if (!result.turnID || result.fileMutations.length === 0) return
    const current = turns.get(key({ sessionID: result.sessionID, turnID: result.turnID })) ?? {
      schema: "aialra.turn_diff.v1" as const,
      session_id: result.sessionID,
      turn_id: result.turnID,
      message_id: result.messageID,
      source: "file_mutation_store" as const,
      updated_at: new Date().toISOString(),
      summary: summarize([]),
      files: [],
    }
    const files = new Map(current.files.map((item) => [item.path, item]))
    for (const item of result.fileMutations) {
      const nextMutation = mutation({ result, item })
      if (!nextMutation) continue
      const nextFile = file({ result, item, mutation: nextMutation })
      const existing = files.get(nextFile.path)
      files.set(nextFile.path, existing ? merge(existing, nextFile) : nextFile)
    }
    const diff: TurnDiff = {
      ...current,
      message_id: result.messageID ?? current.message_id,
      updated_at: new Date().toISOString(),
      files: [...files.values()].toSorted((a, b) => a.path.localeCompare(b.path)),
      summary: summarize([...files.values()]),
    }
    turns.set(key({ sessionID: result.sessionID, turnID: result.turnID }), diff)
    return diff
  }

  export function finalize(input: {
    sessionID: string
    turnID: string
    messageID?: string
    outcome: "completed" | "aborted"
  }) {
    const current = turns.get(key(input)) ?? {
      schema: "aialra.turn_diff.v1" as const,
      session_id: input.sessionID,
      turn_id: input.turnID,
      message_id: input.messageID,
      source: "file_mutation_store" as const,
      updated_at: new Date().toISOString(),
      summary: summarize([]),
      files: [],
    }
    const diff: TurnDiff = {
      ...current,
      message_id: input.messageID ?? current.message_id,
      updated_at: new Date().toISOString(),
      finalized_at: new Date().toISOString(),
      terminal_outcome: input.outcome,
      summary: summarize(current.files),
    }
    turns.set(key(input), diff)
    return diff
  }

  export function emit(diff: TurnDiff) {
    return AialraTurnTrace.emit({
      phase: "turn.diff.updated",
      turnID: diff.turn_id,
      sessionID: diff.session_id,
      messageID: diff.message_id,
      data: diff,
    }).pipe(Effect.andThen(() => AialraTurnTrace.emit({
      phase: "patch.quality.scored",
      turnID: diff.turn_id,
      sessionID: diff.session_id,
      messageID: diff.message_id,
      data: scorePatchQuality(diff),
    })))
  }

  export function list(input: { sessionID: string; turnID?: string }) {
    if (input.turnID) return turns.get(key(input))
    return [...turns.values()].filter((item) => item.session_id === input.sessionID)
  }

  export function quality(diff: TurnDiff, input?: { source?: PatchQualityScore["source"]; verification?: Partial<PatchQualityScore["verification"]> }) {
    return scorePatchQuality(diff, input)
  }

  export function clearForTest() {
    turns.clear()
  }
}

function scorePatchQuality(
  diff: TurnDiff,
  input?: {
    source?: PatchQualityScore["source"]
    verification?: Partial<PatchQualityScore["verification"]>
  },
): PatchQualityScore {
  const changedFiles = diff.files.map((file) => file.path)
  const testFiles = changedFiles.filter(testFile)
  const generatedChurn = changedFiles.filter(generatedFile)
  const protectedPaths = changedFiles.filter(protectedPath)
  const publicApiRisks = changedFiles.filter(publicApiPath)
  const sourceFiles = changedFiles.filter((file) => !testFile(file) && !generatedFile(file))
  const unappliedMutationCount = diff.files.flatMap((file) => file.mutations).filter((mutation) => !mutation.applied).length
  const patchBytes = diff.files
    .flatMap((file) => file.mutations)
    .reduce((sum, mutation) => sum + mutationPatchBytes(mutation), 0)
  const hasPatch = diff.files.some((file) => file.applied)
  const hugePatch = patchBytes > 500_000 || changedFiles.length > 50
  const tinyPatch = hasPatch && patchBytes > 0 && patchBytes < 20
  const verificationStatus = input?.verification?.status ?? "not_observed"
  const verificationAttempts = input?.verification?.attempts ?? 0
  const score = Math.max(
    0,
    Math.min(
      100,
      (hasPatch ? 20 : 0) +
        (sourceFiles.length > 0 ? 15 : 0) +
        (testFiles.length > 0 ? 10 : 0) +
        (verificationStatus === "passed" ? 20 : verificationAttempts > 0 ? 5 : 0) +
        (hasPatch && !hugePatch && !tinyPatch ? 10 : 0) +
        (protectedPaths.length === 0 ? 10 : 0) +
        (generatedChurn.length === 0 ? 5 : 0) +
        (unappliedMutationCount === 0 ? 5 : 0) +
        (publicApiRisks.length === 0 ? 5 : 0),
    ),
  )
  const risks = [
    hasPatch ? undefined : "zero_patch",
    sourceFiles.length === 0 && testFiles.length > 0 ? "only_tests_changed" : undefined,
    hugePatch ? "huge_patch" : undefined,
    tinyPatch ? "tiny_patch" : undefined,
    generatedChurn.length > 0 ? "generated_or_lockfile_churn" : undefined,
    protectedPaths.length > 0 ? "protected_path_changed" : undefined,
    publicApiRisks.length > 0 ? "public_api_surface_changed" : undefined,
    unappliedMutationCount > 0 ? "unapplied_mutations" : undefined,
    verificationStatus === "failed" ? "verification_failed" : undefined,
    verificationStatus === "skipped" ? "verification_skipped" : undefined,
  ].filter((item): item is string => !!item)
  return {
    schema: "aialra.patch_quality.v1",
    source: input?.source ?? "turn_diff",
    score,
    grade: score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 45 ? "risky" : "poor",
    patch: {
      hasPatch,
      zeroPatch: !hasPatch,
      changedFiles,
      changedFileCount: changedFiles.length,
      sourceFileCount: sourceFiles.length,
      testFileCount: testFiles.length,
      generatedChurnCount: generatedChurn.length,
      protectedPathCount: protectedPaths.length,
      publicApiRiskCount: publicApiRisks.length,
      unappliedMutationCount,
      patchBytes,
      hugePatch,
      tinyPatch,
      onlyTests: sourceFiles.length === 0 && testFiles.length > 0,
    },
    verification: {
      status: verificationStatus,
      attempts: verificationAttempts,
    },
    risks,
    reasons: [
      hasPatch ? "存在非空补丁 +20" : "零补丁 +0",
      sourceFiles.length > 0 ? `改动源码相关文件 ${sourceFiles.length} 个 +15` : "没有可确认源码改动 +0",
      testFiles.length > 0 ? `包含测试文件 ${testFiles.length} 个 +10` : "未包含测试文件 +0",
      verificationStatus === "passed"
        ? "验证通过 +20"
        : verificationAttempts > 0
          ? `验证已运行但未通过 +5，状态 ${verificationStatus}`
          : "没有观察到验证结果 +0",
      hasPatch && !hugePatch && !tinyPatch ? "补丁大小合理 +10" : hugePatch ? "补丁过大 +0" : "补丁过小或为空 +0",
      protectedPaths.length === 0 ? "未改受保护路径 +10" : `改动受保护路径 ${protectedPaths.length} 个 +0`,
      generatedChurn.length === 0 ? "未发现生成物或锁文件噪声 +5" : `发现生成物或锁文件改动 ${generatedChurn.length} 个 +0`,
      unappliedMutationCount === 0 ? "所有记录的文件 mutation 已应用 +5" : `存在未应用 mutation ${unappliedMutationCount} 个 +0`,
      publicApiRisks.length === 0 ? "未发现公共 API 表面改动 +5" : `公共 API 表面有改动 ${publicApiRisks.length} 个 +0`,
    ],
    coverage: {
      testsChanged: testFiles.length > 0,
      verificationObserved: verificationStatus !== "not_observed",
      protectedPathsClean: protectedPaths.length === 0,
      generatedChurnClean: generatedChurn.length === 0,
    },
    diff,
  }
}

function mutationPatchBytes(mutation: TurnDiffMutation) {
  const diff = mutation.diff
  if (!diff) return 0
  const patch = typeof diff.patch_chars === "number" ? diff.patch_chars : 0
  const added = typeof diff.chars_added === "number" ? diff.chars_added : 0
  const removed = typeof diff.chars_removed === "number" ? diff.chars_removed : 0
  return Math.max(patch, added + removed)
}

function testFile(file: string) {
  return /(^|\/)(test|tests|spec|specs|__tests__)(\/|$)|(\.test|\.spec)\./i.test(file)
}

function generatedFile(file: string) {
  return /(^|\/)(dist|build|coverage|node_modules|vendor)(\/|$)|(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i.test(file)
}

function protectedPath(file: string) {
  return /(^|\/)(\.git|\.agents|\.codex)(\/|$)/i.test(file)
}

function publicApiPath(file: string) {
  return /(^|\/)(package\.json|openapi\.ya?ml|api|routes|sdk|public-api)(\/|$)|(^|\/)index\.(ts|tsx|js|jsx)$/i.test(file)
}

export * as TurnDiffProtocol from "./turn-diff"

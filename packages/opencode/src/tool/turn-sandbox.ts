import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect } from "effect"
import { AialraTurnTrace } from "@/session/turn-trace"
import type {
  FileSystemSandboxDecision,
  FileSystemSandboxPolicy,
  FileSystemSandboxPolicyRule,
  NetworkProxyConfig,
  NetworkSandboxDecision,
  NetworkSandboxPolicy,
  TurnContext,
} from "@/session/turn-context"
import { CodexTurn } from "@/session/turn-context"
import { SessionSecurity } from "@/session/security"
import type * as Tool from "./tool"
import { Shell } from "@/shell/shell"
import { Wildcard } from "@/util/wildcard"
import { linuxSandboxHelperReport, probeLinuxSandboxCapability, type LinuxSandboxHelperReport } from "./linux-sandbox-capability"
import { landlockHelperStatus } from "./landlock-helper"

type FileAccess = "read" | "write" | "none"

export type ShellSandboxCommand = {
  program: string
  args: string[]
  mode: "none" | "bwrap"
  helper?: LinuxSandboxHelperReport
  cleanupPaths?: string[]
}

const PROTECTED_WORKSPACE_NAMES = [".git", ".agents", ".codex"] as const
const syntheticProtectedMounts = new Map<string, { source: string; refs: number; createdDest: boolean }>()
let protectedMountLock: Promise<void> = Promise.resolve()

async function withProtectedMountLock<T>(fn: () => Promise<T>) {
  const previous = protectedMountLock
  let release!: () => void
  protectedMountLock = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous
  try {
    return await fn()
  } finally {
    release()
  }
}

function normalize(file: string) {
  const resolved = path.resolve(file)
  return process.platform === "win32" ? resolved.toLowerCase() : resolved
}

function contains(root: string, target: string) {
  const rel = path.relative(normalize(root), normalize(target))
  return rel === "" || (!!rel && !rel.startsWith("..") && !path.isAbsolute(rel))
}

function pathDepth(file: string) {
  return normalize(file).split(/[\\/]+/).filter(Boolean).length
}

function accessRank(access: FileAccess) {
  if (access === "none") return 2
  if (access === "write") return 1
  return 0
}

function turnCwd(turn: TurnContext) {
  return path.resolve(CodexTurn.environmentCwd(turn))
}

function effectiveTurn(turn: TurnContext) {
  return SessionSecurity.applyToTurn(turn)
}

function workspaceRoots(turn: TurnContext) {
  const roots = new Set<string>([turnCwd(turn)])
  for (const env of turn.environments) roots.add(path.resolve(env.cwd))
  if (turn.sandbox_policy.type === "workspace-write") {
    for (const root of turn.sandbox_policy.writable_roots) roots.add(path.resolve(root))
  }
  return Array.from(roots)
}

function fileSystemPolicy(turn: TurnContext): FileSystemSandboxPolicy {
  return turn.file_system_policy ?? CodexTurn.fileSystemSandboxPolicy({
    cwd: turn.cwd,
    sandboxPolicy: turn.sandbox_policy,
    permissionProfile: turn.permission_profile,
    activePermissionProfile: turn.active_permission_profile,
    environments: turn.environments,
    selectedEnvironmentID: turn.selected_environment_id,
    securityConstraints: turn.security_constraints ?? CodexTurn.defaultSecurityConstraints(turn.cwd),
  })
}

export function resolvePath(ctx: Tool.Context, input: string, fallbackCwd: string) {
  const base = ctx.turn ? turnCwd(effectiveTurn(ctx.turn)) : fallbackCwd
  return path.isAbsolute(input) ? path.resolve(input) : path.resolve(base, input)
}

function requestedOperationMatches(rule: FileSystemSandboxPolicyRule, requested: FileSystemSandboxDecision["operation"]) {
  if (rule.operation === "read-write") return requested !== "search"
  if (requested === "search") return rule.operation === "search"
  if (requested === "read") return rule.operation === "read"
  if (requested === "write") return rule.operation === "write" || rule.operation === "create" || rule.operation === "delete"
  return rule.operation === requested || rule.operation === "write"
}

function policyRuleMatches(turn: TurnContext, rule: FileSystemSandboxPolicyRule, target: string) {
  if (rule.path.type === "path") return contains(rule.path.path, target)
  if (rule.path.type === "glob") {
    const relative = path.relative(turnCwd(turn), target).replaceAll("\\", "/")
    if (!relative.startsWith("..") && !path.isAbsolute(relative) && Wildcard.match(relative, rule.path.pattern)) return true
    const pattern = path.isAbsolute(rule.path.pattern) ? rule.path.pattern : path.join(turnCwd(turn), rule.path.pattern)
    return Wildcard.match(normalize(target), normalize(pattern))
  }
  return false
}

function resolvePolicyAccess(turn: TurnContext, target: string, operation: FileSystemSandboxDecision["operation"]) {
  let best: { access: FileAccess; depth: number; rank: number; rule: FileSystemSandboxPolicyRule } | undefined
  for (const rule of fileSystemPolicy(turn).rules) {
    if (!requestedOperationMatches(rule, operation)) continue
    if (!policyRuleMatches(turn, rule, target)) continue
    const depth = rule.path.type === "path" ? pathDepth(rule.path.path) : pathDepth(rule.path.type === "glob" ? rule.path.pattern : "")
    const candidate = { access: rule.access, depth, rank: accessRank(rule.access), rule }
    if (!best || candidate.depth > best.depth || (candidate.depth === best.depth && candidate.rank > best.rank)) {
      best = candidate
    }
  }
  return {
    access: best?.access ?? "none",
    matchedRule: best?.rule,
  }
}

function resolveDecision(input: {
  turn: TurnContext
  operation: FileSystemSandboxDecision["operation"]
  requested: string
  resolved: string
  canonical?: string
}): FileSystemSandboxDecision {
  const policy = fileSystemPolicy(input.turn)
  const resolved = resolvePolicyAccess(input.turn, input.resolved, input.operation)
  const canonical = input.canonical ? resolvePolicyAccess(input.turn, input.canonical, input.operation) : undefined
  const allowed = accessAllows(resolved.access, input.operation === "search" ? "read" : input.operation === "read" ? "read" : "write")
  const canonicalAllowed = canonical
    ? accessAllows(canonical.access, input.operation === "search" ? "read" : input.operation === "read" ? "read" : "write")
    : true
  const denyReason = !allowed
    ? `resolved path matched ${resolved.matchedRule?.id ?? "no rule"} with access=${resolved.access}`
    : !canonicalAllowed
      ? `canonical path matched ${canonical?.matchedRule?.id ?? "no rule"} with access=${canonical?.access ?? "none"}`
      : undefined
  return {
    version: "aialra.file_system_sandbox_decision.v1",
    policy_version: policy.version,
    operation: input.operation,
    requested_path: input.requested,
    resolved_path: input.resolved,
    canonical_path: input.canonical && input.canonical !== input.resolved ? input.canonical : undefined,
    decision: allowed && canonicalAllowed ? "allow" : "deny",
    resolved_access: resolved.access,
    canonical_access: canonical?.access,
    matched_rule: resolved.matchedRule,
    canonical_matched_rule: canonical?.matchedRule,
    deny_reason: denyReason,
    active_permission_profile: input.turn.active_permission_profile,
    sandbox_policy: input.turn.sandbox_policy,
    selected_environment_id: policy.selected_environment_id,
    environment_cwd: policy.environment_cwd,
  }
}

function resolveAccess(turn: TurnContext, target: string): FileAccess {
  return resolvePolicyAccess(turn, target, "read").access
}

function accessAllows(actual: FileAccess, requested: "read" | "write") {
  if (requested === "read") return actual !== "none"
  return actual === "write"
}

function operationMatches(rule: TurnContext["security_constraints"]["file"][number], operation: "read" | "write") {
  return rule.operation === "read-write" || rule.operation === operation
}

function matchesPathConstraint(turn: TurnContext, rule: TurnContext["security_constraints"]["file"][number], target: string) {
  if (rule.path.type === "path") return contains(rule.path.path, target)
  const relative = path.relative(turnCwd(turn), target).replaceAll("\\", "/")
  if (!relative.startsWith("..") && !path.isAbsolute(relative) && Wildcard.match(relative, rule.path.pattern)) return true
  const absolutePattern = path.isAbsolute(rule.path.pattern)
    ? normalize(rule.path.pattern)
    : normalize(path.join(turnCwd(turn), rule.path.pattern))
  return Wildcard.match(normalize(target), absolutePattern)
}

function fileConstraint(turn: TurnContext, operation: "read" | "write", targets: string[]) {
  if (!turn.security_constraints?.active) return
  return turn.security_constraints.file.find(
    (rule) => operationMatches(rule, operation) && targets.some((target) => matchesPathConstraint(turn, rule, target)),
  )
}

function shellConstraint(turn: TurnContext, command: string) {
  if (!turn.security_constraints?.active) return
  return turn.security_constraints.shell.find((rule) => new RegExp(rule.pattern, "i").test(command))
}

function classifyNetworkTarget(url: string) {
  const parsed = new URL(url)
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  const v4 = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (host === "169.254.169.254") return { kind: "metadata-service" as const, host }
  if (host === "localhost" || host === "::1" || host.startsWith("127.")) return { kind: "loopback" as const, host }
  if (v4) {
    const first = Number(v4[1])
    const second = Number(v4[2])
    if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) {
      return { kind: "private-network" as const, host }
    }
    if (first === 169 && second === 254) return { kind: "private-network" as const, host }
  }
  if (host === "0.0.0.0" || host.startsWith("fc") || host.startsWith("fd") || host.endsWith(".local")) {
    return { kind: "private-network" as const, host }
  }
  return { kind: "unknown-domain" as const, host }
}

function networkConstraint(turn: TurnContext, url: string) {
  if (!turn.security_constraints.active) return
  const target = classifyNetworkTarget(url)
  const rule = turn.security_constraints.network.find((rule) => rule.target === target.kind)
  if (!rule || rule.action !== "deny") return
  return { rule, target }
}

function hostMatches(host: string, pattern: string) {
  const clean = pattern.toLowerCase().replace(/^\*\./, "")
  return host === clean || host.endsWith(`.${clean}`) || Wildcard.match(host, pattern.toLowerCase())
}

function networkSandboxPolicy(turn: TurnContext): NetworkSandboxPolicy {
  return turn.network_sandbox_policy ?? CodexTurn.networkSandboxPolicy({
    networkPolicy: turn.network_policy,
    networkPermissions: turn.network_permissions ?? CodexTurn.defaultNetworkPermissions(turn.network_policy ?? "ask"),
    activePermissionProfile: turn.active_permission_profile,
    approvalPolicy: turn.approval_policy,
    selectedEnvironmentID: turn.selected_environment_id,
    networkAccess: networkAllowed(turn),
  })
}

function networkProxy(turn: TurnContext): NetworkProxyConfig {
  return turn.network_proxy ?? CodexTurn.networkProxy({
    networkPermissions: turn.network_permissions ?? CodexTurn.defaultNetworkPermissions(turn.network_policy ?? "ask"),
    selectedEnvironmentID: turn.selected_environment_id,
  })
}

function networkProxyDecision(turn: TurnContext) {
  const proxy = networkProxy(turn)
  if (!proxy.required) {
    return {
      proxy,
      status: "not_required" as const,
      allowed: true,
      reason: "本轮没有要求网络必须经过代理",
    }
  }
  if (proxy.enforcement === "environment" && proxy.url) {
    return {
      proxy,
      status: "applied" as const,
      allowed: true,
      reason: "本轮要求走 NetworkProxy，已通过标准代理环境变量执行",
    }
  }
  return {
    proxy,
    status: "unavailable" as const,
    allowed: false,
    reason: "本轮要求走 NetworkProxy，但没有可用代理地址，禁止直连网络",
  }
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

function networkPolicyDecision(turn: TurnContext, url: string, tool?: string): NetworkSandboxDecision {
  const target = classifyNetworkTarget(url)
  const policy = networkSandboxPolicy(turn)
  const mode = tool ? (policy.per_tool[tool] ?? policy.mode) : policy.mode
  const denied = policy.denylist.find((pattern) => hostMatches(target.host, pattern))
  if (denied) {
    return {
      version: "aialra.network_sandbox_decision.v1",
      policy_version: policy.version,
      tool,
      url,
      host: target.host,
      classification: target.kind,
      mode,
      decision: "deny",
      needs_approval: false,
      network_access: false,
      reason: `目标域名 ${target.host} 命中网络 denylist，拒绝访问`,
      matched_rule: `denylist:${denied}`,
      proxy: policy.proxy,
      active_permission_profile: turn.active_permission_profile,
    }
  }
  if (target.kind === "metadata-service") {
    return {
      version: "aialra.network_sandbox_decision.v1",
      policy_version: policy.version,
      tool,
      url,
      host: target.host,
      classification: target.kind,
      mode,
      decision: "deny",
      needs_approval: false,
      network_access: false,
      reason: "metadata service 地址默认硬拒绝，防止云凭证泄露",
      matched_rule: "metadata_service_policy:block",
      proxy: policy.proxy,
      active_permission_profile: turn.active_permission_profile,
    }
  }
  const localityPolicy =
    target.kind === "loopback"
      ? policy.localhost_policy
      : target.kind === "private-network"
        ? policy.private_ip_policy
        : undefined
  if (localityPolicy === "block") {
    return {
      version: "aialra.network_sandbox_decision.v1",
      policy_version: policy.version,
      tool,
      url,
      host: target.host,
      classification: target.kind,
      mode,
      decision: "deny",
      needs_approval: false,
      network_access: false,
      reason: `目标 ${target.host} 属于 ${target.kind}，当前策略为 block`,
      matched_rule: `${target.kind}:block`,
      proxy: policy.proxy,
      active_permission_profile: turn.active_permission_profile,
    }
  }
  if (mode === "off") {
    return {
      version: "aialra.network_sandbox_decision.v1",
      policy_version: policy.version,
      tool,
      url,
      host: target.host,
      classification: target.kind,
      mode,
      decision: "deny",
      needs_approval: false,
      network_access: false,
      reason: "当前网络 mode=off，拒绝联网",
      matched_rule: "mode:off",
      proxy: policy.proxy,
      active_permission_profile: turn.active_permission_profile,
    }
  }
  if (policy.allowlist.length > 0 && !policy.allowlist.some((pattern) => hostMatches(target.host, pattern))) {
    return {
      version: "aialra.network_sandbox_decision.v1",
      policy_version: policy.version,
      tool,
      url,
      host: target.host,
      classification: target.kind,
      mode,
      decision: "deny",
      needs_approval: false,
      network_access: false,
      reason: `目标域名 ${target.host} 不在网络 allowlist 中`,
      matched_rule: "allowlist:miss",
      proxy: policy.proxy,
      active_permission_profile: turn.active_permission_profile,
    }
  }
  const needsApproval = mode === "ask" || localityPolicy === "ask"
  return {
    version: "aialra.network_sandbox_decision.v1",
    policy_version: policy.version,
    tool,
    url,
    host: target.host,
    classification: target.kind,
    mode,
    decision: needsApproval ? "ask" : "allow",
    needs_approval: needsApproval,
    network_access: mode === "on" || needsApproval,
    reason: needsApproval ? "当前网络策略要求审批后访问" : "当前网络策略允许访问",
    matched_rule: localityPolicy === "ask" ? `${target.kind}:ask` : mode === "ask" ? "mode:ask" : "mode:on",
    proxy: policy.proxy,
    active_permission_profile: turn.active_permission_profile,
  }
}

const emitConstraintChecked = Effect.fn("TurnSandbox.emitConstraintChecked")(function* (
  ctx: Tool.Context,
  input: {
    turn: TurnContext
    status: "checked" | "denied"
    kind: "file" | "shell" | "network"
    operation: string
    target: string
    rule?: { id: string; reason: string; source: string }
    extra?: Record<string, unknown>
  },
) {
  yield* AialraTurnTrace.emit({
    phase: input.status === "denied" ? "security.constraint.denied" : "security.constraint.checked",
    turnID: input.turn.turnID,
    sessionID: input.turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: ctx.extra?.["tool"],
      kind: input.kind,
      operation: input.operation,
      target: input.target,
      status: input.status,
      ruleID: input.rule?.id,
      reason: input.rule?.reason,
      source: input.rule?.source,
      active_permission_profile: input.turn.active_permission_profile,
      approval_policy: input.turn.approval_policy,
      constraintsVersion: input.turn.security_constraints?.version,
      ...input.extra,
    },
  })
})

async function canonicalForAccess(target: string, operation: "read" | "write") {
  try {
    return path.resolve(await realpath(target))
  } catch {
    if (operation === "read") return path.resolve(target)
  }

  const missing: string[] = []
  let current = path.resolve(target)
  while (true) {
    try {
      const resolved = path.resolve(await realpath(current))
      return path.join(resolved, ...missing.reverse())
    } catch {
      const parent = path.dirname(current)
      if (parent === current) return path.resolve(target)
      missing.push(path.basename(current))
      current = parent
    }
  }
}

function describePolicy(turn: TurnContext) {
  return `${turn.active_permission_profile.id}/${turn.sandbox_policy.type}`
}

function denyMessage(input: { operation: "read" | "write" | "shell"; target: string; turn: TurnContext }) {
  return `Codex turn sandbox denied ${input.operation} access to ${input.target}. Active policy: ${describePolicy(input.turn)}.`
}

function containingWorkspaceRoot(turn: TurnContext, target: string) {
  return workspaceRoots(turn)
    .filter((root) => contains(root, target))
    .toSorted((a, b) => pathDepth(b) - pathDepth(a))[0]
}

function symlinkEscape(turn: TurnContext, target: string, canonical: string) {
  if (normalize(target) === normalize(canonical)) return
  const root = containingWorkspaceRoot(turn, target)
  if (!root) return
  if (!contains(root, canonical)) {
    return {
      code: "symlink_escape",
      root,
      reason: "路径位于工作区内，但 canonical realpath 指向工作区外，疑似符号链接越界",
    }
  }
  const protectedPath = protectableMetadataPath(turn, canonical)
  if (!protectedPath) return
  return {
    code: "symlink_protected_escape",
    root,
    protectedPath,
    reason: "路径通过符号链接指向 .git/.agents/.codex 受保护工程元数据",
  }
}

const denySymlinkEscape = Effect.fn("TurnSandbox.denySymlinkEscape")(function* (
  ctx: Tool.Context,
  input: {
    turn: TurnContext
    operation: "read" | "write" | "search"
    target: string
    canonical: string
    escape: NonNullable<ReturnType<typeof symlinkEscape>>
  },
) {
  yield* emitConstraintChecked(ctx, {
    turn: input.turn,
    status: "denied",
    kind: "file",
    operation: input.operation,
    target: input.target,
    extra: {
      code: input.escape.code,
      reason: input.escape.reason,
      canonicalTarget: input.canonical,
      workspaceRoot: input.escape.root,
      protectedPath: input.escape.protectedPath,
      constraintLayer: "canonical_realpath",
    },
  })
  yield* AialraTurnTrace.emit({
    phase: "tool.sandbox.denied",
    turnID: input.turn.turnID,
    sessionID: input.turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: ctx.extra?.["tool"],
      operation: input.operation,
      target: input.target,
      canonicalTarget: input.canonical,
      reason: input.escape.reason,
      symlink_escape: true,
      symlink_escape_code: input.escape.code,
      workspaceRoot: input.escape.root,
      protectedPath: input.escape.protectedPath,
      constraintLayer: "canonical_realpath",
      sandbox_policy: input.turn.sandbox_policy.type,
      active_permission_profile: input.turn.active_permission_profile,
    },
  })
  return yield* Effect.die(new Error(`Codex turn sandbox denied symlink escape for ${input.operation} access to ${input.target}. ${input.escape.reason}.`))
})

export const assertFileAccess = Effect.fn("TurnSandbox.assertFileAccess")(function* (
  ctx: Tool.Context,
  operation: "read" | "write",
  target: string,
) {
  const turn = ctx.turn ? effectiveTurn(ctx.turn) : undefined
  if (!turn) return
  const canonical = yield* Effect.promise(() => canonicalForAccess(target, operation))
  const escape = symlinkEscape(turn, path.resolve(target), canonical)
  if (escape) return yield* denySymlinkEscape(ctx, { turn, operation, target, canonical, escape })
  const constraint = fileConstraint(turn, operation, [path.resolve(target), canonical])
  if (constraint) {
    yield* emitConstraintChecked(ctx, {
      turn,
      status: "denied",
      kind: "file",
      operation,
      target,
      rule: constraint,
      extra: {
        canonicalTarget: canonical === target ? undefined : canonical,
        constraintLayer: "before_approval",
      },
    })
    yield* AialraTurnTrace.emit({
      phase: "tool.sandbox.denied",
      turnID: turn.turnID,
      sessionID: turn.sessionID,
      messageID: ctx.messageID,
      data: {
        tool: ctx.extra?.["tool"],
        operation,
        target,
        canonicalTarget: canonical === target ? undefined : canonical,
        reason: constraint.reason,
        constraintID: constraint.id,
        constraintLayer: "before_approval",
        sandbox_policy: turn.sandbox_policy.type,
        active_permission_profile: turn.active_permission_profile,
      },
    })
    return yield* Effect.die(new Error(`Security constraint denied ${operation} access to ${target}. ${constraint.reason}`))
  }
  yield* emitConstraintChecked(ctx, {
    turn,
    status: "checked",
    kind: "file",
    operation,
    target,
    extra: {
      canonicalTarget: canonical === target ? undefined : canonical,
    },
  })
  const decision = resolveDecision({
    turn,
    operation,
    requested: target,
    resolved: path.resolve(target),
    canonical,
  })
  yield* AialraTurnTrace.emit({
    phase: decision.decision === "allow" ? "tool.sandbox.checked" : "tool.sandbox.denied",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: ctx.extra?.["tool"],
      operation,
      target,
      canonicalTarget: canonical === target ? undefined : canonical,
      resolvedAccess: decision.resolved_access,
      canonicalAccess: decision.canonical_access,
      file_system_policy: {
        version: fileSystemPolicy(turn).version,
        selected_environment_id: fileSystemPolicy(turn).selected_environment_id,
        environment_cwd: fileSystemPolicy(turn).environment_cwd,
        active_permission_profile: fileSystemPolicy(turn).active_permission_profile,
      },
      file_system_decision: decision,
      matchedRule: decision.matched_rule,
      canonicalMatchedRule: decision.canonical_matched_rule,
      reason: decision.deny_reason,
      sandbox_policy: turn.sandbox_policy.type,
      active_permission_profile: turn.active_permission_profile,
    },
  })
  if (decision.decision !== "allow") {
    return yield* Effect.die(new Error(denyMessage({ operation, target, turn })))
  }
})

export const assertSearchScope = Effect.fn("TurnSandbox.assertSearchScope")(function* (ctx: Tool.Context, target: string) {
  const turn = ctx.turn ? effectiveTurn(ctx.turn) : undefined
  if (!turn) return

  const canonical = yield* Effect.promise(() => canonicalForAccess(target, "read"))
  const escape = symlinkEscape(turn, path.resolve(target), canonical)
  if (escape) return yield* denySymlinkEscape(ctx, { turn, operation: "search", target, canonical, escape })
  const decision = resolveDecision({
    turn,
    operation: "search",
    requested: target,
    resolved: path.resolve(target),
    canonical,
  })
  yield* AialraTurnTrace.emit({
    phase: decision.decision === "allow" ? "tool.sandbox.checked" : "tool.sandbox.denied",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: ctx.extra?.["tool"],
      operation: "search",
      target,
      canonicalTarget: canonical === target ? undefined : canonical,
      resolvedAccess: decision.resolved_access,
      canonicalAccess: decision.canonical_access,
      file_system_policy: {
        version: fileSystemPolicy(turn).version,
        selected_environment_id: fileSystemPolicy(turn).selected_environment_id,
        environment_cwd: fileSystemPolicy(turn).environment_cwd,
        active_permission_profile: fileSystemPolicy(turn).active_permission_profile,
      },
      file_system_decision: decision,
      matchedRule: decision.matched_rule,
      canonicalMatchedRule: decision.canonical_matched_rule,
      reason: decision.deny_reason,
      sandbox_policy: turn.sandbox_policy.type,
      active_permission_profile: turn.active_permission_profile,
    },
  })
  if (decision.decision !== "allow") {
    return yield* Effect.die(
      new Error(`Codex turn sandbox denied recursive search outside the selected workspace: ${target}. Active policy: ${describePolicy(turn)}.`),
    )
  }
})

export const assertShellAccess = Effect.fn("TurnSandbox.assertShellAccess")(function* (
  ctx: Tool.Context,
  input: { cwd: string; command: string },
) {
  const turn = ctx.turn ? effectiveTurn(ctx.turn) : undefined
  if (!turn) return
  const constraint = shellConstraint(turn, input.command)
  if (constraint) {
    yield* emitConstraintChecked(ctx, {
      turn,
      status: "denied",
      kind: "shell",
      operation: "shell",
      target: input.command.slice(0, 240),
      rule: constraint,
      extra: {
        cwd: input.cwd,
        constraintLayer: "before_approval",
      },
    })
    yield* AialraTurnTrace.emit({
      phase: "tool.sandbox.denied",
      turnID: turn.turnID,
      sessionID: turn.sessionID,
      messageID: ctx.messageID,
      data: {
        tool: "bash",
        operation: "shell",
        target: input.cwd,
        commandPreview: input.command.slice(0, 240),
        reason: constraint.reason,
        constraintID: constraint.id,
        constraintLayer: "before_approval",
        sandbox_policy: turn.sandbox_policy.type,
        active_permission_profile: turn.active_permission_profile,
      },
    })
    return yield* Effect.die(new Error(`Security constraint denied shell command. ${constraint.reason}`))
  }
  yield* emitConstraintChecked(ctx, {
    turn,
    status: "checked",
    kind: "shell",
    operation: "shell",
    target: input.command.slice(0, 240),
    extra: { cwd: input.cwd },
  })
  const actual = resolveAccess(turn, input.cwd)
  if (actual === "none") {
    yield* AialraTurnTrace.emit({
      phase: "tool.sandbox.denied",
      turnID: turn.turnID,
      sessionID: turn.sessionID,
      messageID: ctx.messageID,
      data: {
        tool: "bash",
        operation: "shell",
        target: input.cwd,
        resolvedAccess: actual,
        sandbox_policy: turn.sandbox_policy.type,
        active_permission_profile: turn.active_permission_profile,
      },
    })
    return yield* Effect.die(new Error(denyMessage({ operation: "shell", target: input.cwd, turn })))
  }
})

export const assertNetworkAccess = Effect.fn("TurnSandbox.assertNetworkAccess")(function* (ctx: Tool.Context, url: string) {
  const turn = ctx.turn ? effectiveTurn(ctx.turn) : undefined
  if (!turn) return { needsApproval: false, networkAccess: false }
  const tool = typeof ctx.extra?.["tool"] === "string" ? ctx.extra["tool"] : undefined
  const constraint = networkConstraint(turn, url)
  if (!constraint) {
    const decision = networkPolicyDecision(turn, url, tool)
    yield* emitConstraintChecked(ctx, {
      turn,
      status: decision.decision === "deny" ? "denied" : "checked",
      kind: "network",
      operation: "request",
      target: url,
      extra: {
        classification: decision.classification,
        host: decision.host,
        decision: decision.decision,
        reason: decision.reason,
        mode: decision.mode,
        matchedRule: decision.matched_rule,
        network_sandbox_policy: networkSandboxPolicy(turn),
        network_sandbox_decision: decision,
      },
    })
    if (decision.decision === "deny") {
      yield* AialraTurnTrace.emit({
        phase: "tool.sandbox.denied",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: ctx.messageID,
        data: {
          tool,
          operation: "network",
          target: url,
          classification: decision.classification,
          host: decision.host,
          reason: decision.reason,
          networkDecision: decision.decision,
          matchedRule: decision.matched_rule,
          network_permissions: turn.network_permissions,
          network_sandbox_policy: networkSandboxPolicy(turn),
          network_sandbox_decision: decision,
          active_permission_profile: turn.active_permission_profile,
        },
      })
      return yield* Effect.die(new Error(`Network policy denied access to ${url}. ${decision.reason}`))
    }
    const proxyDecision = networkProxyDecision(turn)
    if (!proxyDecision.allowed) {
      yield* AialraTurnTrace.emit({
        phase: "network.proxy.unavailable",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: ctx.messageID,
        data: {
          tool,
          target: url,
          host: decision.host,
          status: proxyDecision.status,
          reason: proxyDecision.reason,
          network_proxy: {
            ...proxyDecision.proxy,
            url: redactedProxyURL(proxyDecision.proxy.url),
          },
          network_sandbox_decision: decision,
        },
      })
      yield* AialraTurnTrace.emit({
        phase: "tool.sandbox.denied",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: ctx.messageID,
        data: {
          tool,
          operation: "network",
          target: url,
          host: decision.host,
          reason: proxyDecision.reason,
          networkDecision: "deny",
          matchedRule: "network_proxy:unavailable",
          network_proxy: {
            ...proxyDecision.proxy,
            url: redactedProxyURL(proxyDecision.proxy.url),
          },
          network_sandbox_policy: networkSandboxPolicy(turn),
          network_sandbox_decision: decision,
          active_permission_profile: turn.active_permission_profile,
        },
      })
      return yield* Effect.die(new Error(`NetworkProxy is required but unavailable for ${url}. ${proxyDecision.reason}`))
    }
    if (proxyDecision.status === "applied") {
      yield* AialraTurnTrace.emit({
        phase: "network.proxy.applied",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: ctx.messageID,
        data: {
          tool,
          target: url,
          host: decision.host,
          status: proxyDecision.status,
          reason: proxyDecision.reason,
          network_proxy: {
            ...proxyDecision.proxy,
            url: redactedProxyURL(proxyDecision.proxy.url),
          },
          network_sandbox_decision: decision,
        },
      })
    }
    return {
      needsApproval: decision.needs_approval,
      networkAccess: decision.network_access,
      mode: decision.mode,
      host: decision.host,
      classification: decision.classification,
      proxy: decision.proxy,
      networkProxy: proxyDecision.proxy,
      networkSandboxDecision: decision,
    }
  }
  yield* emitConstraintChecked(ctx, {
    turn,
    status: "denied",
    kind: "network",
    operation: "request",
    target: url,
    rule: constraint.rule,
      extra: {
        classification: constraint.target.kind,
        host: constraint.target.host,
        constraintLayer: "before_approval",
        network_sandbox_policy: networkSandboxPolicy(turn),
        network_proxy: {
          ...networkProxy(turn),
          url: redactedProxyURL(networkProxy(turn).url),
        },
      },
  })
  yield* AialraTurnTrace.emit({
    phase: "tool.sandbox.denied",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: ctx.extra?.["tool"],
      operation: "network",
      target: url,
      classification: constraint.target.kind,
      host: constraint.target.host,
      reason: constraint.rule.reason,
      constraintID: constraint.rule.id,
      constraintLayer: "before_approval",
      network_sandbox_policy: networkSandboxPolicy(turn),
      network_proxy: {
        ...networkProxy(turn),
        url: redactedProxyURL(networkProxy(turn).url),
      },
      active_permission_profile: turn.active_permission_profile,
    },
  })
  return yield* Effect.die(new Error(`Security constraint denied network access to ${url}. ${constraint.rule.reason}`))
})

function networkAllowed(turn: TurnContext, override?: boolean) {
  if (override === true) return true
  if (turn.permission_profile.type === "disabled") return true
  if (turn.permission_profile.type === "external") return turn.permission_profile.network === "enabled"
  if (turn.permission_profile.network === "enabled") return true
  if (turn.sandbox_policy.type === "danger-full-access") return true
  if (turn.sandbox_policy.type === "external-sandbox") return turn.sandbox_policy.network_access === "enabled"
  return turn.sandbox_policy.network_access
}

function bubblewrapProgram() {
  if (process.platform !== "linux") return
  const capability = probeLinuxSandboxCapability()
  if (!capability.bwrap.available) return
  if (!capability.bwrap.userNamespaceProbe.available) return
  return capability.bwrap.path
}

function bindExisting(args: string[], mode: "--bind" | "--ro-bind", source: string, dest = source) {
  const result = Bun.spawnSync(["test", "-e", source], { stdout: "ignore", stderr: "ignore" })
  if (result.exitCode === 0) args.push(mode, source, dest)
  else {
    // Missing read-only carveouts are enforced by direct file checks. bwrap can
    // only overmount paths that exist at spawn time.
  }
}

async function protectedMetadataMounts(turn: TurnContext) {
  const mounts: Array<{ source: string; dest: string; cleanup?: string[] }> = []
  await withProtectedMountLock(async () => {
    for (const root of workspaceRoots(turn)) {
      for (const name of PROTECTED_WORKSPACE_NAMES) {
        const dest = path.join(root, name)
        const synthetic = syntheticProtectedMounts.get(dest)
        if (synthetic) {
          synthetic.refs++
          mounts.push({ source: synthetic.source, dest, cleanup: [dest] })
          continue
        }

        const exists = Bun.spawnSync(["test", "-e", dest], { stdout: "ignore", stderr: "ignore" }).exitCode === 0
        if (exists) {
          mounts.push({ source: dest, dest })
          continue
        }

        // Codex protects missing .git/.agents/.codex with protected-create
        // targets. Plain bwrap has no direct protected-create primitive, so we
        // create a temporary host mountpoint and bind an empty read-only source
        // over it. A small ref-count prevents concurrent bash calls from racing
        // by deleting another command's still-needed mountpoint.
        const source = await mkdtemp(path.join(os.tmpdir(), "aialra-protected-metadata-"))
        await mkdir(dest)
        syntheticProtectedMounts.set(dest, { source, refs: 1, createdDest: true })
        mounts.push({ source, dest, cleanup: [dest] })
      }
    }
  })
  return mounts
}

async function releaseProtectedMetadataMount(dest: string) {
  await withProtectedMountLock(async () => {
    const entry = syntheticProtectedMounts.get(dest)
    if (!entry) return
    entry.refs--
    if (entry.refs > 0) return
    syntheticProtectedMounts.delete(dest)
    await rm(entry.source, { recursive: true, force: true })
    if (entry.createdDest) await rm(dest, { recursive: true, force: true })
  })
}

function writableRoots(turn: TurnContext) {
  return fileSystemPolicy(turn).writable_roots.filter((root) => path.isAbsolute(root))
}

export const shellSandboxCommand = Effect.fn("TurnSandbox.shellSandboxCommand")(function* (
  ctx: Tool.Context,
  input: { shell: string; command: string; cwd: string; networkAccess?: boolean },
) {
  const turn = ctx.turn ? effectiveTurn(ctx.turn) : undefined
  if (!turn) return undefined
  yield* assertShellAccess(ctx, { cwd: input.cwd, command: input.command })
  if (turn.permission_profile.type === "disabled" || turn.sandbox_policy.type === "danger-full-access") {
    return undefined
  }
  const capability = probeLinuxSandboxCapability()
  const bwrap = bubblewrapProgram()
  const initialHelper = linuxSandboxHelperReport({
    capability,
    bwrapSelected: !!bwrap,
    networkIsolated: false,
    protectedCreate: false,
  })
  yield* AialraTurnTrace.emit({
    phase: "tool.sandbox.capability",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: "bash",
      backend: "bwrap",
      bwrap: {
        available: capability.bwrap.available,
        path: capability.bwrap.path,
        version: capability.bwrap.version,
        supports: capability.bwrap.supports,
        userNamespace: {
          available: capability.bwrap.userNamespaceProbe.available,
          error: capability.bwrap.userNamespaceProbe.error,
        },
        networkNamespace: {
          available: capability.bwrap.networkNamespaceProbe.available,
          error: capability.bwrap.networkNamespaceProbe.error,
        },
        mountProc: {
          available: capability.bwrap.mountProcProbe.available,
          error: capability.bwrap.mountProcProbe.error,
        },
      },
      codex: {
        cli: capability.codex.cli.available,
        execServer: capability.codex.execServer.available,
        linuxSandbox: capability.codex.linuxSandbox.available,
      },
      landlock: capability.kernel,
      landlock_helper: landlockHelperStatus(),
      linux_sandbox_helper: initialHelper,
      notes: capability.notes,
    },
  })

  if (!bwrap) {
    if (turn.approval_policy === "never") {
      return yield* Effect.die(new Error("Codex turn sandbox requires bubblewrap on Linux, but bwrap is unavailable."))
    }
    return undefined
  }

  const args = [
    "--new-session",
    "--die-with-parent",
    "--unshare-user",
    "--unshare-pid",
    "--unshare-ipc",
    "--ro-bind",
    "/",
    "/",
    "--dev",
    "/dev",
  ]
  if (capability.bwrap.mountProcProbe.available) args.push("--proc", "/proc")
  const networkEnabled = networkAllowed(turn, input.networkAccess)
  const networkIsolated = !networkEnabled && capability.bwrap.networkNamespaceProbe.available
  if (networkIsolated) args.splice(3, 0, "--unshare-net")

  for (const root of writableRoots(turn)) {
    bindExisting(args, "--bind", root)
  }

  const protectedMounts = yield* Effect.promise(() => protectedMetadataMounts(turn))
  for (const mount of protectedMounts) {
    args.push("--ro-bind", mount.source, mount.dest)
  }

  const landlock = landlockHelperStatus()
  const seccompProfile = networkEnabled ? "restricted" : "network-off"
  const command = landlock.available && landlock.path
    ? [
        landlock.path,
        "--read-root",
        "/",
        ...writableRoots(turn).flatMap((root) => ["--write-root", root]),
        "--seccomp-profile",
        seccompProfile,
        "--",
        input.shell,
        ...Shell.args(input.shell, input.command, input.cwd),
      ]
    : [input.shell, ...Shell.args(input.shell, input.command, input.cwd)]
  const helper = linuxSandboxHelperReport({
    capability,
    bwrapSelected: true,
    networkIsolated,
    protectedCreate: protectedMounts.some((mount) => mount.cleanup?.length),
    landlockEnforced: landlock.available,
    seccompProfile: landlock.available ? seccompProfile : "none",
  })
  args.push("--chdir", input.cwd, "--", ...command)
  yield* AialraTurnTrace.emit({
    phase: "tool.sandbox.checked",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: "bash",
      operation: "shell",
      target: input.cwd,
      sandbox: "bwrap",
      network: networkEnabled ? "enabled" : networkIsolated ? "restricted" : "restricted-unenforced",
      networkNamespaceAvailable: capability.bwrap.networkNamespaceProbe.available,
      linux_sandbox_helper: helper,
      landlock_helper: landlock,
      writableRoots: writableRoots(turn),
      protected_create: {
        version: "aialra.protected_create.v1",
        mode: "readonly-bind-synthetic",
        enforced: protectedMounts.length > 0,
        names: PROTECTED_WORKSPACE_NAMES,
        targets: protectedMounts.map((mount) => ({
          path: mount.dest,
          synthetic: !!mount.cleanup,
        })),
      },
      protectedMetadataMounts: protectedMounts.map((mount) => ({
        dest: mount.dest,
        synthetic: !!mount.cleanup,
      })),
    },
  })
  return {
    program: bwrap,
    args,
    mode: "bwrap",
    helper,
    cleanupPaths: protectedMounts.flatMap((mount) => mount.cleanup ?? []),
  } satisfies ShellSandboxCommand
})

export const cleanupShellSandboxCommand = Effect.fn("TurnSandbox.cleanupShellSandboxCommand")(function* (
  sandbox: ShellSandboxCommand | undefined,
) {
  for (const item of sandbox?.cleanupPaths ?? []) {
    yield* Effect.promise(() => releaseProtectedMetadataMount(item)).pipe(Effect.ignore)
  }
})

export function protectableMetadataPath(turn: TurnContext, target: string) {
  turn = effectiveTurn(turn)
  for (const root of workspaceRoots(turn)) {
    for (const name of PROTECTED_WORKSPACE_NAMES) {
      const protectedPath = path.join(root, name)
      if (contains(protectedPath, target)) return protectedPath
    }
  }
}

export const assertWritableParentExists = Effect.fn("TurnSandbox.assertWritableParentExists")(function* (
  ctx: Tool.Context,
  target: string,
) {
  const turn = ctx.turn
  if (!turn) return
  // The underlying tool will create parents or surface a normal filesystem
  // error. The sandbox decision is based on the intended target path.
  yield* assertFileAccess(ctx, "write", target)
})

export * as TurnSandbox from "./turn-sandbox"

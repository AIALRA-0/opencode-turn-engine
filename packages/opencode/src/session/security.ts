import path from "node:path"
import { Schema } from "effect"
import { PublicEventLog } from "./public-event"
import {
  CodexTurn,
  type ActivePermissionProfile,
  type ApprovalPolicy,
  type PermissionProfile,
  type SandboxPolicy,
  type TurnContext,
  type TurnEnvironment,
} from "./turn-context"

export const SecurityPermissionProfileID = Schema.Literals([
  ":read-only",
  ":workspace",
  ":danger-full-access",
  "external",
  "disabled",
])
export type SecurityPermissionProfileID = typeof SecurityPermissionProfileID.Type

export const SecurityApprovalPolicy = Schema.Literals(["never", "on-request", "on-failure", "untrusted"])
export type SecurityApprovalPolicy = typeof SecurityApprovalPolicy.Type

export const SecurityExecutorBackend = Schema.Literals(["codex", "node-bun"])
export type SecurityExecutorBackend = typeof SecurityExecutorBackend.Type

export const SecurityConfig = Schema.Struct({
  sessionID: Schema.String,
  permissionProfileID: SecurityPermissionProfileID,
  approvalPolicy: SecurityApprovalPolicy,
  networkAccess: Schema.Boolean,
  executorBackend: SecurityExecutorBackend,
  environmentID: Schema.String,
  cwd: Schema.String,
  remoteEnvironmentSupported: Schema.Boolean,
  remoteEnvironmentStatus: Schema.String,
  stepBudgetEnabled: Schema.Boolean,
  stepBudgetMaxSteps: Schema.Number,
})
export type SecurityConfig = typeof SecurityConfig.Type

export const SecurityUpdatePayload = Schema.Struct({
  permissionProfileID: Schema.optional(SecurityPermissionProfileID),
  approvalPolicy: Schema.optional(SecurityApprovalPolicy),
  networkAccess: Schema.optional(Schema.Boolean),
  executorBackend: Schema.optional(SecurityExecutorBackend),
  environmentID: Schema.optional(Schema.String),
  stepBudgetEnabled: Schema.optional(Schema.Boolean),
  stepBudgetMaxSteps: Schema.optional(Schema.Number),
})
export type SecurityUpdatePayload = typeof SecurityUpdatePayload.Type

type StoredSecurityConfig = {
  permissionProfileID: SecurityConfig["permissionProfileID"]
  approvalPolicy: SecurityConfig["approvalPolicy"]
  networkAccess: boolean
  executorBackend: SecurityConfig["executorBackend"]
  environmentID: string
  stepBudgetEnabled: boolean
  stepBudgetMaxSteps: number
}

const configs = new Map<string, StoredSecurityConfig>()

function defaultStored(): StoredSecurityConfig {
  return {
    permissionProfileID: ":workspace",
    approvalPolicy: "on-request",
    networkAccess: false,
    executorBackend: process.env.AIALRA_EXEC_BACKEND === "codex" ? "codex" : "node-bun",
    environmentID: "default",
    stepBudgetEnabled: false,
    stepBudgetMaxSteps: 80,
  }
}

function normalizeCwd(cwd: string) {
  return path.resolve(cwd || process.cwd())
}

function stored(sessionID: string) {
  const existing = configs.get(sessionID)
  if (existing) return existing
  const next = defaultStored()
  configs.set(sessionID, next)
  return next
}

function normalizeStepBudgetMaxSteps(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 80
  return Math.max(1, Math.min(10_000, Math.trunc(value)))
}

function approvalPolicy(value: SecurityApprovalPolicy): ApprovalPolicy {
  if (value === "on-request") return "on-request"
  if (value === "on-failure") return "on-failure"
  if (value === "never") return "never"
  return "untrusted"
}

function sandboxPolicy(input: { profile: SecurityPermissionProfileID; cwd: string; networkAccess: boolean }): SandboxPolicy {
  if (input.profile === ":danger-full-access" || input.profile === "disabled") return { type: "danger-full-access" }
  if (input.profile === ":read-only") return { type: "read-only", network_access: input.networkAccess }
  if (input.profile === "external") return { type: "external-sandbox", network_access: input.networkAccess ? "enabled" : "restricted" }
  return {
    type: "workspace-write",
    writable_roots: [input.cwd],
    network_access: input.networkAccess,
    exclude_tmpdir_env_var: false,
    exclude_slash_tmp: false,
  } satisfies SandboxPolicy
}

function permissionProfile(input: { profile: SecurityPermissionProfileID; cwd: string; networkAccess: boolean }): PermissionProfile {
  if (input.profile === "disabled") return { type: "disabled" }
  if (input.profile === "external") return { type: "external", network: input.networkAccess ? "enabled" : "restricted" }
  if (input.profile === ":danger-full-access") return CodexTurn.fullAccessPermissionProfile()

  const base =
    input.profile === ":read-only" ? CodexTurn.readOnlyPermissionProfile() : CodexTurn.workspacePermissionProfile(input.cwd)
  if (base.type === "managed") return { ...base, network: input.networkAccess ? "enabled" : "restricted" }
  return base
}

function activePermissionProfile(profile: SecurityPermissionProfileID): ActivePermissionProfile {
  return { id: profile }
}

function environments(input: { cwd: string; environmentID: string }): TurnEnvironment[] {
  return [{ environmentID: input.environmentID || "default", cwd: input.cwd }]
}

function publicConfig(sessionID: string, cwd: string): SecurityConfig {
  const current = stored(sessionID)
  return {
    sessionID,
    permissionProfileID: current.permissionProfileID,
    approvalPolicy: current.approvalPolicy,
    networkAccess: current.permissionProfileID === ":danger-full-access" ? true : current.networkAccess,
    executorBackend: current.executorBackend,
    environmentID: current.environmentID,
    cwd: normalizeCwd(cwd),
    remoteEnvironmentSupported: false,
    remoteEnvironmentStatus: "remote environment，远程环境，本轮只暴露入口，尚未接入远程执行",
    stepBudgetEnabled: current.stepBudgetEnabled,
    stepBudgetMaxSteps: current.stepBudgetMaxSteps,
  }
}

function emitChange(input: {
  sessionID: string
  type: "sandbox.profile.changed" | "sandbox.network.changed" | "approval.policy.changed" | "executor.backend.changed" | "environment.selected"
    | "turn.step_budget.changed"
  title: string
  from: unknown
  to: unknown
  cwd: string
}) {
  PublicEventLog.recordManual({
    type: input.type,
    severity: "info",
    sessionID: input.sessionID,
    title: input.title,
    summary: `${String(input.from)} -> ${String(input.to)}`,
    status: "changed",
    data: {
      from: input.from,
      to: input.to,
      cwd: input.cwd,
      scope: "session_next_turn_and_live_tool_gates",
      actor: "current_user",
    },
    raw: {
      source: "session.security",
      from: input.from,
      to: input.to,
      cwd: input.cwd,
      actor: "current_user",
    },
  })
}

function emitControlChanged(input: {
  sessionID: string
  before: StoredSecurityConfig
  after: StoredSecurityConfig
  patch: SecurityUpdatePayload
  cwd: string
}) {
  PublicEventLog.recordManual({
    type: "sandbox.control.changed",
    severity: "info",
    sessionID: input.sessionID,
    title: "Sandbox control changed",
    summary: "沙盒控制中心已更新后续回合的执行规则",
    status: "changed",
    data: {
      before: input.before,
      after: input.after,
      changed: input.patch,
      cwd: input.cwd,
      changedBy: "current_user",
      time: new Date().toISOString(),
      scope: "session_next_turn_and_live_tool_gates",
    },
    raw: {
      source: "session.security",
      before: input.before,
      after: input.after,
      changed: input.patch,
      cwd: input.cwd,
      changedBy: "current_user",
    },
  })
}

export namespace SessionSecurity {
  export function get(input: { sessionID: string; cwd: string }) {
    return publicConfig(input.sessionID, input.cwd)
  }

  export function update(input: { sessionID: string; cwd: string; patch: SecurityUpdatePayload }) {
    const cwd = normalizeCwd(input.cwd)
    const previous = { ...stored(input.sessionID) }
    const next: StoredSecurityConfig = { ...previous, ...input.patch }
    if (next.permissionProfileID === ":danger-full-access") next.networkAccess = true
    next.stepBudgetMaxSteps = normalizeStepBudgetMaxSteps(next.stepBudgetMaxSteps)
    configs.set(input.sessionID, next)

    if (JSON.stringify(previous) !== JSON.stringify(next)) {
      emitControlChanged({
        sessionID: input.sessionID,
        before: previous,
        after: next,
        patch: input.patch,
        cwd,
      })
    }

    if (previous.permissionProfileID !== next.permissionProfileID) {
      emitChange({
        sessionID: input.sessionID,
        type: "sandbox.profile.changed",
        title: "Sandbox permission profile changed",
        from: previous.permissionProfileID,
        to: next.permissionProfileID,
        cwd,
      })
    }
    if (previous.networkAccess !== next.networkAccess) {
      emitChange({
        sessionID: input.sessionID,
        type: "sandbox.network.changed",
        title: "Sandbox network access changed",
        from: previous.networkAccess ? "enabled" : "restricted",
        to: next.networkAccess ? "enabled" : "restricted",
        cwd,
      })
    }
    if (previous.approvalPolicy !== next.approvalPolicy) {
      emitChange({
        sessionID: input.sessionID,
        type: "approval.policy.changed",
        title: "Approval policy changed",
        from: previous.approvalPolicy,
        to: next.approvalPolicy,
        cwd,
      })
    }
    if (previous.executorBackend !== next.executorBackend) {
      emitChange({
        sessionID: input.sessionID,
        type: "executor.backend.changed",
        title: "Executor backend preference changed",
        from: previous.executorBackend,
        to: next.executorBackend,
        cwd,
      })
    }
    if (previous.environmentID !== next.environmentID) {
      emitChange({
        sessionID: input.sessionID,
        type: "environment.selected",
        title: "Turn environment selected",
        from: previous.environmentID,
        to: next.environmentID,
        cwd,
      })
    }
    if (
      previous.stepBudgetEnabled !== next.stepBudgetEnabled ||
      previous.stepBudgetMaxSteps !== next.stepBudgetMaxSteps
    ) {
      emitChange({
        sessionID: input.sessionID,
        type: "turn.step_budget.changed",
        title: "Turn step budget changed",
        from: previous.stepBudgetEnabled ? `${previous.stepBudgetMaxSteps}` : "disabled",
        to: next.stepBudgetEnabled ? `${next.stepBudgetMaxSteps}` : "disabled",
        cwd,
      })
    }

    return publicConfig(input.sessionID, cwd)
  }

  export function overrides(input: { sessionID: string; cwd: string }) {
    const config = publicConfig(input.sessionID, input.cwd)
    return {
      approvalPolicy: approvalPolicy(config.approvalPolicy),
      sandboxPolicy: sandboxPolicy({
        profile: config.permissionProfileID,
        cwd: config.cwd,
        networkAccess: config.networkAccess,
      }),
      permissionProfile: permissionProfile({
        profile: config.permissionProfileID,
        cwd: config.cwd,
        networkAccess: config.networkAccess,
      }),
      activePermissionProfile: activePermissionProfile(config.permissionProfileID),
      environments: environments({ cwd: config.cwd, environmentID: config.environmentID }),
      stepBudget: {
        enabled: config.stepBudgetEnabled,
        max_steps: config.stepBudgetMaxSteps,
      },
    }
  }

  export function applyToTurn<T extends TurnContext>(turn: T): T {
    if (!configs.has(turn.sessionID)) return turn
    const config = publicConfig(turn.sessionID, turn.cwd)
    return {
      ...turn,
      approval_policy: approvalPolicy(config.approvalPolicy),
      sandbox_policy: sandboxPolicy({
        profile: config.permissionProfileID,
        cwd: config.cwd,
        networkAccess: config.networkAccess,
      }),
      permission_profile: permissionProfile({
        profile: config.permissionProfileID,
        cwd: config.cwd,
        networkAccess: config.networkAccess,
      }),
      active_permission_profile: activePermissionProfile(config.permissionProfileID),
      environments: environments({ cwd: config.cwd, environmentID: config.environmentID }),
      step_budget: {
        enabled: config.stepBudgetEnabled,
        max_steps: config.stepBudgetMaxSteps,
      },
    }
  }

  export function clearForTest() {
    configs.clear()
  }

  export function executorBackend(sessionID: string | undefined) {
    if (!sessionID) return defaultStored().executorBackend
    return configs.get(sessionID)?.executorBackend ?? defaultStored().executorBackend
  }
}

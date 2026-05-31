import path from "node:path"
import type { Permission } from "@/permission"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"
import type { MessageID, SessionID } from "./schema"
import type { EngineeringRunSnapshot } from "./engineering"
import type { TurnFrame, TurnFrameRoute } from "./turn-frame"

export const DEFAULT_REQUEST_MAX_RETRIES = 4
export const DEFAULT_STREAM_MAX_RETRIES = 5
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000
export const MAX_CODEX_RETRIES = 100

export type TurnAbortReason = "interrupted" | "replaced" | "review_ended" | "budget_limited"

export type ApprovalPolicy =
  | "untrusted"
  | "on-failure"
  | "on-request"
  | "never"
  | {
      type: "granular"
      sandbox_approval: boolean
      rules: boolean
      skill_approval: boolean
      request_permissions: boolean
      mcp_elicitations: boolean
    }

export type SandboxPolicy =
  | { type: "danger-full-access" }
  | { type: "read-only"; network_access: boolean }
  | { type: "external-sandbox"; network_access: "restricted" | "enabled" }
  | {
      type: "workspace-write"
      writable_roots: string[]
      network_access: boolean
      exclude_tmpdir_env_var: boolean
      exclude_slash_tmp: boolean
    }

export type PermissionProfile =
  | {
      type: "managed"
      file_system:
        | { type: "restricted"; entries: PermissionProfileFileSystemEntry[]; glob_scan_max_depth?: number }
        | { type: "unrestricted" }
      network: "restricted" | "enabled"
    }
  | { type: "disabled" }
  | { type: "external"; network: "restricted" | "enabled" }

export type PermissionProfileFileSystemEntry = {
  path:
    | { type: "special"; value: "root" | "workspace_roots" | "tmpdir" | "slash_tmp" | "minimal" }
    | { type: "path"; path: string }
    | { type: "glob"; pattern: string }
  access: "read" | "write" | "none"
}

export type ActivePermissionProfile = {
  id: ":read-only" | ":workspace" | ":danger-full-access" | (string & {})
  extends?: string
}

export type TurnEnvironment = {
  environmentID: string
  cwd: string
}

export type CodexRetryConfig = {
  request_max_retries: number
  stream_max_retries: number
  stream_idle_timeout_ms: number
}

export type UserTurn = {
  version: "aialra.user_turn.v1"
  items: MessageV2.Part[]
  cwd: string
  approval_policy: ApprovalPolicy
  approvals_reviewer?: string
  sandbox_policy: SandboxPolicy
  permission_profile: PermissionProfile
  active_permission_profile: ActivePermissionProfile
  model: {
    providerID: string
    modelID: string
    variant?: string
  }
  effort?: string
  summary?: string
  service_tier?: string
  final_output_json_schema?: unknown
  collaboration_mode: {
    kind: "default" | "plan" | "review" | (string & {})
  }
  personality?: string
  environments: TurnEnvironment[]
  network_policy?: "off" | "on" | "ask"
  command_policy?: "ask" | "workspace" | "all" | "read" | "disabled"
  step_budget?: {
    enabled: boolean
    max_steps?: number
  }
  engineering?: EngineeringRunSnapshot
  route: TurnFrameRoute
  sessionID: SessionID
  messageID: MessageID
  agent: string
  noReply: boolean
  format: string
  retry: CodexRetryConfig
}

export type TurnContext = UserTurn & {
  turnID: MessageID
  startedAt: number
  timeToFirstTokenMs?: number
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function retryValue(value: unknown, fallback: number) {
  const parsed = asNumber(value)
  if (parsed === undefined) return fallback
  return Math.max(0, Math.min(MAX_CODEX_RETRIES, Math.trunc(parsed)))
}

function positiveMs(value: unknown, fallback: number) {
  const parsed = asNumber(value)
  if (parsed === undefined || parsed <= 0) return fallback
  return Math.trunc(parsed)
}

export namespace CodexTurn {
  export function retryConfig(input: { providerOptions?: Record<string, unknown>; modelOptions?: Record<string, unknown> }) {
    const providerOptions = input.providerOptions ?? {}
    const modelOptions = input.modelOptions ?? {}
    return {
      request_max_retries: retryValue(
        modelOptions["request_max_retries"] ?? providerOptions["request_max_retries"],
        DEFAULT_REQUEST_MAX_RETRIES,
      ),
      stream_max_retries: retryValue(
        modelOptions["stream_max_retries"] ?? providerOptions["stream_max_retries"],
        DEFAULT_STREAM_MAX_RETRIES,
      ),
      stream_idle_timeout_ms: positiveMs(
        modelOptions["stream_idle_timeout_ms"] ??
          providerOptions["stream_idle_timeout_ms"] ??
          providerOptions["chunkTimeout"],
        DEFAULT_STREAM_IDLE_TIMEOUT_MS,
      ),
    } satisfies CodexRetryConfig
  }

  export function defaultSandboxPolicy(cwd: string): SandboxPolicy {
    return {
      type: "workspace-write",
      writable_roots: [cwd],
      network_access: false,
      exclude_tmpdir_env_var: false,
      exclude_slash_tmp: false,
    }
  }

  export function workspacePermissionProfile(cwd?: string): PermissionProfile {
    const entries: PermissionProfileFileSystemEntry[] = [
      { path: { type: "special", value: "root" }, access: "read" },
      { path: { type: "special", value: "workspace_roots" }, access: "write" },
      { path: { type: "special", value: "slash_tmp" }, access: "write" },
      { path: { type: "special", value: "tmpdir" }, access: "write" },
    ]
    if (cwd) {
      for (const name of [".git", ".agents", ".codex"]) {
        entries.push({ path: { type: "path", path: path.join(cwd, name) }, access: "read" })
      }
    }
    return {
      type: "managed",
      file_system: {
        type: "restricted",
        entries,
      },
      network: "restricted",
    }
  }

  export function readOnlyPermissionProfile(): PermissionProfile {
    return {
      type: "managed",
      file_system: {
        type: "restricted",
        entries: [{ path: { type: "special", value: "root" }, access: "read" }],
      },
      network: "restricted",
    }
  }

  export function fullAccessPermissionProfile(): PermissionProfile {
    return {
      type: "managed",
      file_system: { type: "unrestricted" },
      network: "enabled",
    }
  }

  export function fromFrame(input: {
    frame: TurnFrame
    parts: MessageV2.Part[]
    cwd: string
    retry: CodexRetryConfig
    startedAt: number
    approvalPolicy?: ApprovalPolicy
    sandboxPolicy?: SandboxPolicy
    permissionProfile?: PermissionProfile
    activePermissionProfile?: ActivePermissionProfile
    collaborationMode?: UserTurn["collaboration_mode"]
    personality?: string
    environments?: TurnEnvironment[]
    networkPolicy?: UserTurn["network_policy"]
    commandPolicy?: UserTurn["command_policy"]
    stepBudget?: UserTurn["step_budget"]
    engineering?: UserTurn["engineering"]
  }): TurnContext {
    const permissionProfile = input.permissionProfile ?? workspacePermissionProfile(input.cwd)
    return {
      version: "aialra.user_turn.v1",
      turnID: input.frame.turnID,
      startedAt: input.startedAt,
      items: input.parts,
      cwd: input.cwd,
      approval_policy: input.approvalPolicy ?? "on-request",
      sandbox_policy: input.sandboxPolicy ?? defaultSandboxPolicy(input.cwd),
      permission_profile: permissionProfile,
      active_permission_profile: input.activePermissionProfile ?? { id: ":workspace" },
      model: input.frame.model,
      final_output_json_schema: undefined,
      collaboration_mode: input.collaborationMode ?? { kind: "default" },
      personality: input.personality,
      environments: input.environments?.length ? input.environments : [{ environmentID: "default", cwd: input.cwd }],
      network_policy: input.networkPolicy,
      command_policy: input.commandPolicy,
      step_budget: input.stepBudget,
      engineering: input.engineering,
      route: input.frame.route,
      sessionID: input.frame.sessionID,
      messageID: input.frame.messageID,
      agent: input.frame.agent,
      noReply: input.frame.noReply,
      format: input.frame.format,
      retry: input.retry,
    }
  }

  export function permissionRules(input: {
    profile: PermissionProfile
    approvalPolicy: ApprovalPolicy
    base?: Permission.Ruleset
  }): Permission.Ruleset | undefined {
    const base: Permission.Rule[] = [...(input.base ?? [])]
    const output: Permission.Rule[] = []

    if (input.profile.type === "managed") {
      if (input.profile.file_system.type === "restricted") {
        const writable = input.profile.file_system.entries.some((entry) => entry.access === "write")
        if (!writable) {
          output.push({ permission: "edit", pattern: "*", action: "deny" })
          output.push({ permission: "write", pattern: "*", action: "deny" })
          output.push({ permission: "bash", pattern: "*", action: "deny" })
          output.push({ permission: "shell", pattern: "*", action: "deny" })
          output.push({ permission: "apply_patch", pattern: "*", action: "deny" })
        }
      }
    }

    if (input.approvalPolicy === "never") {
      for (const rule of base) {
        output.push(rule.action === "ask" ? { ...rule, action: "deny" } : rule)
      }
      return output
    }

    return output.length ? [...base, ...output] : input.base
  }

  export function traceSummary(turn: TurnContext) {
    return {
      version: turn.version,
      turnID: turn.turnID,
      route: turn.route,
      sessionID: turn.sessionID,
      messageID: turn.messageID,
      cwd: turn.cwd,
      approval_policy: turn.approval_policy,
      sandbox_policy: turn.sandbox_policy,
      permission_profile: turn.permission_profile,
      active_permission_profile: turn.active_permission_profile,
      model: turn.model,
      collaboration_mode: turn.collaboration_mode,
      environments: turn.environments,
      network_policy: turn.network_policy,
      command_policy: turn.command_policy,
      step_budget: turn.step_budget,
      engineering: turn.engineering,
      retry: turn.retry,
      items: {
        count: turn.items.length,
        byType: turn.items.reduce<Record<string, number>>((acc, part) => {
          acc[part.type] = (acc[part.type] ?? 0) + 1
          return acc
        }, {}),
      },
    }
  }

  export function modelContextWindow(model: Provider.Model) {
    const value = model.limit.context
    return Number.isFinite(value) && value > 0 ? value : undefined
  }
}

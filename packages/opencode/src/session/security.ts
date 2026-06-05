import path from "node:path"
import { Schema } from "effect"
import { PublicEventLog } from "./public-event"
import {
  CodexTurn,
  type ActivePermissionProfile,
  type ApprovalPolicy,
  type PermissionProfile,
  type SandboxPolicy,
  type ApprovalReviewerRole,
  type FileSystemSandboxPolicy,
  type NetworkSandboxPolicy,
  type NetworkProxyConfig,
  type NetworkPermissionPolicy,
  type PlatformSandboxCapability,
  type ShellEnvironmentPolicy,
  type SecurityConstraints,
  type TurnContext,
  type TurnEnvironment,
} from "./turn-context"
import { EngineeringControls, EngineeringControlsPatch, EngineeringHarness } from "./engineering"

export const SecurityPermissionProfileID = Schema.Literals([
  ":read-only",
  ":workspace",
  ":danger-full-access",
  "read_only",
  "workspace",
  "full",
  "managed",
  "custom",
  "external",
  "disabled",
])
export type SecurityPermissionProfileID = typeof SecurityPermissionProfileID.Type

export const SecurityApprovalPolicy = Schema.Literals(["never", "on-request", "on-failure", "untrusted"])
export type SecurityApprovalPolicy = typeof SecurityApprovalPolicy.Type
export const SecurityApprovalReviewer = Schema.Literals(["user", "auto_review", "guardian", "policy_engine", "external_reviewer"])
export type SecurityApprovalReviewer = typeof SecurityApprovalReviewer.Type

export const SecurityExecutorBackend = Schema.Literals(["codex", "node-bun"])
export type SecurityExecutorBackend = typeof SecurityExecutorBackend.Type
export const SecurityNetworkPolicy = Schema.Literals(["off", "on", "ask"])
export type SecurityNetworkPolicy = typeof SecurityNetworkPolicy.Type
export const SecurityPrivateNetworkPolicy = Schema.Literals(["block", "ask", "allow"])
export type SecurityPrivateNetworkPolicy = typeof SecurityPrivateNetworkPolicy.Type
export const SecurityNetworkPermissionsPatch = Schema.Struct({
  allowlist: Schema.optional(Schema.Array(Schema.String)),
  denylist: Schema.optional(Schema.Array(Schema.String)),
  privateNetwork: Schema.optional(SecurityPrivateNetworkPolicy),
  proxyEnabled: Schema.optional(Schema.Boolean),
  proxyURL: Schema.optional(Schema.String),
  tools: Schema.optional(Schema.Record(Schema.String, SecurityNetworkPolicy)),
})
export type SecurityNetworkPermissionsPatch = typeof SecurityNetworkPermissionsPatch.Type
export const SecurityShellEnvironmentPolicyPatch = Schema.Struct({
  mode: Schema.optional(Schema.Literals(["clear", "inherit"])),
  allowlist: Schema.optional(Schema.Array(Schema.String)),
  denylist: Schema.optional(Schema.Array(Schema.String)),
  redact: Schema.optional(Schema.Array(Schema.String)),
  overrides: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  safeDefaults: Schema.optional(Schema.Boolean),
  perEnvironment: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.String))),
})
export type SecurityShellEnvironmentPolicyPatch = typeof SecurityShellEnvironmentPolicyPatch.Type
export const SecurityCommandPolicy = Schema.Literals(["ask", "workspace", "all", "read", "disabled"])
export type SecurityCommandPolicy = typeof SecurityCommandPolicy.Type

export const SecurityRuntimeProof = Schema.Struct({
  version: Schema.Literal("aialra.sandbox_control_runtime_proof.v1"),
  active_permission_profile_id: Schema.String,
  active_permission_profile_kind: Schema.optional(Schema.String),
  cwd: Schema.String,
  environment_id: Schema.String,
  environment_cwd: Schema.String,
  approval_policy: Schema.String,
  approvals_reviewer: Schema.String,
  command_policy: Schema.String,
  executor_backend: Schema.String,
  file_system: Schema.Struct({
    enforced: Schema.Boolean,
    mode: Schema.String,
    writable_roots: Schema.Array(Schema.String),
    readable_roots: Schema.Array(Schema.String),
    protected_paths: Schema.Array(Schema.String),
    symlink_escape_protected: Schema.Boolean,
  }),
  network: Schema.Struct({
    policy: Schema.String,
    access: Schema.String,
    sandbox_mode: Schema.String,
    disabled: Schema.Boolean,
    private_ip_policy: Schema.String,
    localhost_policy: Schema.String,
    proxy_required: Schema.Boolean,
    proxy_enabled: Schema.Boolean,
  }),
  shell_environment: Schema.Struct({
    mode: Schema.String,
    sensitive_env_redacted: Schema.Array(Schema.String),
    allowlist: Schema.Array(Schema.String),
    denylist: Schema.Array(Schema.String),
  }),
  live_effect: Schema.Struct({
    applies_to_next_turn: Schema.Boolean,
    applies_to_next_tool_gate: Schema.Boolean,
    in_flight_model_requests_not_rewritten: Schema.Boolean,
    in_flight_processes_not_rewritten: Schema.Boolean,
  }),
  platform_sandbox: Schema.Unknown,
  effective_permission_profile: Schema.Unknown,
})
export type SecurityRuntimeProof = typeof SecurityRuntimeProof.Type

export const SecurityConfig = Schema.Struct({
  sessionID: Schema.String,
  permissionProfileID: SecurityPermissionProfileID,
  approvalPolicy: SecurityApprovalPolicy,
  approvalsReviewer: SecurityApprovalReviewer,
  networkPolicy: SecurityNetworkPolicy,
  commandPolicy: SecurityCommandPolicy,
  networkAccess: Schema.Boolean,
  networkPermissions: Schema.Unknown,
  networkSandboxPolicy: Schema.Unknown,
  networkProxy: Schema.Unknown,
  shellEnvironmentPolicy: Schema.Unknown,
  executorBackend: SecurityExecutorBackend,
  environmentID: Schema.String,
  cwd: Schema.String,
  remoteEnvironmentSupported: Schema.Boolean,
  remoteEnvironmentStatus: Schema.String,
  platformSandbox: Schema.Unknown,
  securityConstraints: Schema.Unknown,
  effectivePermissionProfile: Schema.Unknown,
  fileSystemPolicy: Schema.Unknown,
  runtimeProof: SecurityRuntimeProof,
  stepBudgetEnabled: Schema.Boolean,
  stepBudgetMaxSteps: Schema.Number,
  engineering: EngineeringControls,
})
export type SecurityConfig = typeof SecurityConfig.Type

export const SecurityEnvironmentInfo = Schema.Struct({
  environmentID: Schema.String,
  cwd: Schema.String,
  platform: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.Literals(["local", "remote", "container", "workspace", "external", "disabled"])),
  status: Schema.optional(Schema.String),
  runtimeID: Schema.optional(Schema.String),
  shell: Schema.optional(
    Schema.Struct({
      kind: Schema.Literals(["local", "remote", "container", "external", "unsupported"]),
      command: Schema.optional(Schema.String),
      status: Schema.Literals(["ready", "unsupported", "error"]),
    }),
  ),
  fileSystem: Schema.optional(
    Schema.Struct({
      kind: Schema.Literals(["local", "remote", "container", "external", "unsupported"]),
      cwd: Schema.String,
      writableRoots: Schema.Array(Schema.String),
      protectedPaths: Schema.Array(Schema.String),
      status: Schema.Literals(["ready", "unsupported", "error"]),
    }),
  ),
  network: Schema.optional(
    Schema.Struct({
      policy: Schema.Literals(["off", "on", "ask"]),
      access: Schema.Literals(["restricted", "enabled", "ask"]),
    }),
  ),
  sandbox: Schema.optional(
    Schema.Struct({
      policy: Schema.String,
      enforced: Schema.Boolean,
      status: Schema.Literals(["ready", "unsupported", "error"]),
    }),
  ),
  connection: Schema.optional(
    Schema.Struct({
      state: Schema.Literals(["ready", "unsupported", "error"]),
      reason: Schema.optional(Schema.String),
    }),
  ),
  capabilities: Schema.optional(Schema.Array(Schema.String)),
})
export type SecurityEnvironmentInfo = typeof SecurityEnvironmentInfo.Type

export const SecurityEnvironmentStatus = Schema.Struct({
  sessionID: Schema.String,
  selectedEnvironmentID: Schema.String,
  selectedEnvironmentCwd: Schema.String,
  environments: Schema.Array(SecurityEnvironmentInfo),
  remoteEnvironmentSupported: Schema.Boolean,
  remoteEnvironmentStatus: Schema.String,
})
export type SecurityEnvironmentStatus = typeof SecurityEnvironmentStatus.Type

export const SecurityUpdatePayload = Schema.Struct({
  permissionProfileID: Schema.optional(SecurityPermissionProfileID),
  approvalPolicy: Schema.optional(SecurityApprovalPolicy),
  approvalsReviewer: Schema.optional(SecurityApprovalReviewer),
  networkPolicy: Schema.optional(SecurityNetworkPolicy),
  networkPermissions: Schema.optional(SecurityNetworkPermissionsPatch),
  shellEnvironmentPolicy: Schema.optional(SecurityShellEnvironmentPolicyPatch),
  commandPolicy: Schema.optional(SecurityCommandPolicy),
  networkAccess: Schema.optional(Schema.Boolean),
  executorBackend: Schema.optional(SecurityExecutorBackend),
  environmentID: Schema.optional(Schema.String),
  stepBudgetEnabled: Schema.optional(Schema.Boolean),
  stepBudgetMaxSteps: Schema.optional(Schema.Number),
  engineering: Schema.optional(EngineeringControlsPatch),
})
export type SecurityUpdatePayload = typeof SecurityUpdatePayload.Type

export const SecurityTurnSettingsOverride = Schema.Struct({
  cwd: Schema.optional(Schema.String),
  permissionProfileID: Schema.optional(SecurityPermissionProfileID),
  approvalPolicy: Schema.optional(SecurityApprovalPolicy),
  approvalsReviewer: Schema.optional(SecurityApprovalReviewer),
  networkPolicy: Schema.optional(SecurityNetworkPolicy),
  networkPermissions: Schema.optional(SecurityNetworkPermissionsPatch),
  shellEnvironmentPolicy: Schema.optional(SecurityShellEnvironmentPolicyPatch),
  commandPolicy: Schema.optional(SecurityCommandPolicy),
  networkAccess: Schema.optional(Schema.Boolean),
  executorBackend: Schema.optional(SecurityExecutorBackend),
  environmentID: Schema.optional(Schema.String),
  effort: Schema.optional(Schema.String),
  summary: Schema.optional(Schema.String),
  serviceTier: Schema.optional(Schema.String),
  extensionData: Schema.optional(Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Unknown))),
})
export type SecurityTurnSettingsOverride = typeof SecurityTurnSettingsOverride.Type

type StoredSecurityConfig = {
  permissionProfileID: SecurityConfig["permissionProfileID"]
  approvalPolicy: SecurityConfig["approvalPolicy"]
  approvalsReviewer: ApprovalReviewerRole
  networkPolicy: SecurityConfig["networkPolicy"]
  networkPermissions: NetworkPermissionPolicy
  shellEnvironmentPolicy: ShellEnvironmentPolicy
  commandPolicy: SecurityConfig["commandPolicy"]
  networkAccess: boolean
  executorBackend: SecurityConfig["executorBackend"]
  environmentID: string
  stepBudgetEnabled: boolean
  stepBudgetMaxSteps: number
  engineering: EngineeringControls
}

type StoredSecurityConfigPatch = Partial<Omit<StoredSecurityConfig, "networkPermissions" | "shellEnvironmentPolicy">> & {
  networkPermissions?: SecurityNetworkPermissionsPatch | NetworkPermissionPolicy
  shellEnvironmentPolicy?: SecurityShellEnvironmentPolicyPatch | ShellEnvironmentPolicy
}

const configs = new Map<string, StoredSecurityConfig>()

function defaultStored(): StoredSecurityConfig {
  return {
    permissionProfileID: ":workspace",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    networkPolicy: "ask",
    networkPermissions: CodexTurn.defaultNetworkPermissions("ask"),
    shellEnvironmentPolicy: CodexTurn.defaultShellEnvironmentPolicy(),
    commandPolicy: "ask",
    networkAccess: false,
    executorBackend: process.env.AIALRA_EXEC_BACKEND === "node-bun" ? "node-bun" : "codex",
    environmentID: "default",
    stepBudgetEnabled: false,
    stepBudgetMaxSteps: 80,
    engineering: EngineeringHarness.defaults(),
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

function normalizeProfileID(profile: SecurityPermissionProfileID): SecurityPermissionProfileID {
  if (profile === "read_only") return ":read-only"
  if (profile === "workspace" || profile === "managed") return ":workspace"
  if (profile === "full") return ":danger-full-access"
  return profile
}

function normalizeNetworkPermissions(
  base: NetworkPermissionPolicy,
  mode: SecurityNetworkPolicy,
  patch?: SecurityNetworkPermissionsPatch | NetworkPermissionPolicy,
): NetworkPermissionPolicy {
  const full: NetworkPermissionPolicy | undefined = patch && "version" in patch ? patch : undefined
  const partial: SecurityNetworkPermissionsPatch | undefined = patch && !("version" in patch) ? patch : undefined
  return {
    version: "aialra.network_permissions.v1",
    mode: full?.mode ?? mode,
    allowlist: Array.from(
      new Set((full?.allowlist ?? partial?.allowlist ?? base.allowlist).map((item) => item.trim().toLowerCase()).filter(Boolean)),
    ),
    denylist: Array.from(
      new Set((full?.denylist ?? partial?.denylist ?? base.denylist).map((item) => item.trim().toLowerCase()).filter(Boolean)),
    ),
    private_network: full?.private_network ?? partial?.privateNetwork ?? base.private_network,
    proxy: full?.proxy ?? {
      enabled: partial?.proxyEnabled ?? base.proxy.enabled,
      ...(partial?.proxyURL !== undefined || base.proxy.url ? { url: partial?.proxyURL ?? base.proxy.url } : {}),
    },
    tools: full?.tools ? { ...base.tools, ...full.tools } : partial?.tools ? { ...base.tools, ...partial.tools } : { ...base.tools },
  }
}

function normalizePatternList(input: readonly string[]) {
  return Array.from(new Set(input.map((item) => item.trim()).filter(Boolean)))
}

function normalizeShellEnvironmentPolicy(
  base: ShellEnvironmentPolicy,
  patch?: SecurityShellEnvironmentPolicyPatch | ShellEnvironmentPolicy,
): ShellEnvironmentPolicy {
  const full: ShellEnvironmentPolicy | undefined = patch && "version" in patch ? patch : undefined
  const partial: SecurityShellEnvironmentPolicyPatch | undefined = patch && !("version" in patch) ? patch : undefined
  return {
    version: "aialra.shell_environment_policy.v1",
    mode: full?.mode ?? partial?.mode ?? base.mode,
    allowlist: normalizePatternList(full?.allowlist ?? partial?.allowlist ?? base.allowlist),
    denylist: normalizePatternList(full?.denylist ?? partial?.denylist ?? base.denylist),
    redact: normalizePatternList(full?.redact ?? partial?.redact ?? base.redact),
    overrides: full?.overrides ? { ...full.overrides } : partial?.overrides ? { ...base.overrides, ...partial.overrides } : { ...base.overrides },
    safe_defaults: full?.safe_defaults ?? partial?.safeDefaults ?? base.safe_defaults,
    per_environment: full?.per_environment
      ? { ...full.per_environment }
      : partial?.perEnvironment
        ? { ...base.per_environment, ...partial.perEnvironment }
        : { ...base.per_environment },
  }
}

function normalizeStored(previous: StoredSecurityConfig, patch: StoredSecurityConfigPatch): StoredSecurityConfig {
  const patchNetworkPermissions = patch.networkPermissions
  const patchShellEnvironmentPolicy = patch.shellEnvironmentPolicy
  const { networkPermissions: _, shellEnvironmentPolicy: __, ...rest } = patch
  const next: StoredSecurityConfig = {
    ...previous,
    ...rest,
    engineering: rest.engineering ?? previous.engineering,
  }
  next.permissionProfileID = normalizeProfileID(next.permissionProfileID)
  if ("networkAccess" in patch && !("networkPolicy" in patch)) {
    next.networkPolicy = patch.networkAccess ? "on" : "off"
  }
  if ("permissionProfileID" in patch && !("commandPolicy" in patch) && previous.commandPolicy !== "ask") {
    if (next.permissionProfileID === "disabled") next.commandPolicy = "disabled"
    else if (next.permissionProfileID === ":read-only") next.commandPolicy = "read"
    else if (next.permissionProfileID === ":danger-full-access") next.commandPolicy = "all"
    else next.commandPolicy = "workspace"
  }
  if (next.permissionProfileID === ":danger-full-access") next.networkAccess = true
  if (next.networkPolicy === "on") next.networkAccess = true
  if (next.networkPolicy === "off" || next.networkPolicy === "ask") next.networkAccess = false
  next.networkPermissions = normalizeNetworkPermissions(
    previous.networkPermissions,
    next.networkPolicy,
    patchNetworkPermissions,
  )
  next.shellEnvironmentPolicy = normalizeShellEnvironmentPolicy(previous.shellEnvironmentPolicy, patchShellEnvironmentPolicy)
  if (next.commandPolicy === "disabled") next.permissionProfileID = "disabled"
  if (next.commandPolicy === "read") next.permissionProfileID = ":read-only"
  if (next.commandPolicy === "workspace") next.permissionProfileID = ":workspace"
  if (next.commandPolicy === "all") next.permissionProfileID = ":danger-full-access"
  next.stepBudgetMaxSteps = normalizeStepBudgetMaxSteps(next.stepBudgetMaxSteps)
  next.engineering = EngineeringHarness.normalize(next.engineering)
  return next
}

function approvalPolicy(value: SecurityApprovalPolicy): ApprovalPolicy {
  if (value === "on-request") return "on-request"
  if (value === "on-failure") return "on-failure"
  if (value === "never") return "never"
  return "untrusted"
}

function sandboxPolicy(input: { profile: SecurityPermissionProfileID; cwd: string; networkAccess: boolean }): SandboxPolicy {
  const profile = normalizeProfileID(input.profile)
  if (profile === ":danger-full-access" || profile === "disabled") return { type: "danger-full-access" }
  if (profile === ":read-only") return { type: "read-only", network_access: input.networkAccess }
  if (profile === "external") return { type: "external-sandbox", network_access: input.networkAccess ? "enabled" : "restricted" }
  return {
    type: "workspace-write",
    writable_roots: [input.cwd],
    network_access: input.networkAccess,
    exclude_tmpdir_env_var: false,
    exclude_slash_tmp: false,
  } satisfies SandboxPolicy
}

function permissionProfile(input: { profile: SecurityPermissionProfileID; cwd: string; networkAccess: boolean }): PermissionProfile {
  const profile = normalizeProfileID(input.profile)
  if (profile === "disabled") return { type: "disabled" }
  if (profile === "external") return { type: "external", network: input.networkAccess ? "enabled" : "restricted" }
  if (profile === ":danger-full-access") return CodexTurn.fullAccessPermissionProfile()

  const base =
    profile === ":read-only" ? CodexTurn.readOnlyPermissionProfile() : CodexTurn.workspacePermissionProfile(input.cwd)
  if (base.type === "managed") return { ...base, network: input.networkAccess ? "enabled" : "restricted" }
  return base
}

function activePermissionProfile(profile: SecurityPermissionProfileID): ActivePermissionProfile {
  const resolved = normalizeProfileID(profile)
  return CodexTurn.permissionProfileDescriptor(resolved, {
    source: "session",
    requestedID: profile,
    resolvedID: resolved,
  })
}

function environmentKind(environmentID: string): TurnEnvironment["kind"] {
  if (environmentID === "remote") return "remote"
  if (environmentID === "container") return "container"
  if (environmentID === "external") return "external"
  if (environmentID === "workspace") return "workspace"
  return "local"
}

function environments(input: {
  cwd: string
  environmentID: string
  networkPolicy: SecurityNetworkPolicy
  networkAccess: boolean
  sandboxPolicy: SandboxPolicy
}): TurnEnvironment[] {
  const kind = environmentKind(input.environmentID || "default")
  const ready = kind === "local" || kind === "workspace"
  const local: TurnEnvironment = {
    environmentID: input.environmentID || "default",
    cwd: input.cwd,
    kind: ready ? kind : "disabled",
    status: ready
      ? "local runtime，本机运行环境，已启用"
      : `${kind} runtime，${kind} 运行环境，当前仅记录能力描述，尚未接入执行`,
    runtimeID: `${ready ? kind : "disabled"}:${input.environmentID || "default"}:${input.cwd}`,
    shell: {
      kind: ready ? "local" : "unsupported",
      command: process.env.SHELL,
      status: ready ? "ready" : "unsupported",
    },
    fileSystem: {
      kind: ready ? "local" : "unsupported",
      cwd: input.cwd,
      writableRoots: input.sandboxPolicy.type === "workspace-write" ? input.sandboxPolicy.writable_roots : [input.cwd],
      protectedPaths: [".git", ".agents", ".codex"].map((name) => path.join(input.cwd, name)),
      status: ready ? "ready" : "unsupported",
    },
    network: {
      policy: input.networkPolicy,
      access: input.networkAccess ? "enabled" : input.networkPolicy === "ask" ? "ask" : "restricted",
    },
    sandbox: {
      policy: input.sandboxPolicy.type,
      enforced: input.sandboxPolicy.type !== "danger-full-access",
      status: ready ? "ready" : "unsupported",
    },
    connection: {
      state: ready ? "ready" : "unsupported",
      reason: ready ? undefined : "remote/container/external execution backend is not connected in this build",
    },
    capabilities: ready
      ? ["filesystem", "shell", "sandbox", input.networkAccess ? "network" : "network-restricted"]
      : ["descriptor-only"],
  }
  const descriptors: TurnEnvironment[] = [
    local,
    {
      environmentID: "remote",
      cwd: input.cwd,
      kind: "disabled",
      status: "remote environment，远程环境，尚未接入远程执行",
      runtimeID: `disabled:remote:${input.cwd}`,
      shell: { kind: "unsupported", status: "unsupported" },
      fileSystem: {
        kind: "unsupported",
        cwd: input.cwd,
        writableRoots: [],
        protectedPaths: [],
        status: "unsupported",
      },
      network: { policy: input.networkPolicy, access: "restricted" },
      sandbox: { policy: "unsupported", enforced: false, status: "unsupported" },
      connection: { state: "unsupported", reason: "remote execution sidecar is not configured" },
      capabilities: ["descriptor-only"],
    },
    {
      environmentID: "container",
      cwd: input.cwd,
      kind: "disabled",
      status: "container environment，容器环境，尚未接入容器执行",
      runtimeID: `disabled:container:${input.cwd}`,
      shell: { kind: "unsupported", status: "unsupported" },
      fileSystem: {
        kind: "unsupported",
        cwd: input.cwd,
        writableRoots: [],
        protectedPaths: [],
        status: "unsupported",
      },
      network: { policy: input.networkPolicy, access: "restricted" },
      sandbox: { policy: "unsupported", enforced: false, status: "unsupported" },
      connection: { state: "unsupported", reason: "container backend is not configured" },
      capabilities: ["descriptor-only"],
    },
    {
      environmentID: "external",
      cwd: input.cwd,
      kind: "disabled",
      status: "external runtime，外部运行环境，尚未接入外部执行器",
      runtimeID: `disabled:external:${input.cwd}`,
      shell: { kind: "unsupported", status: "unsupported" },
      fileSystem: {
        kind: "unsupported",
        cwd: input.cwd,
        writableRoots: [],
        protectedPaths: [],
        status: "unsupported",
      },
      network: { policy: input.networkPolicy, access: "restricted" },
      sandbox: { policy: "unsupported", enforced: false, status: "unsupported" },
      connection: { state: "unsupported", reason: "external executor backend is not configured" },
      capabilities: ["descriptor-only"],
    },
  ]
  return descriptors.filter((environment, index) =>
    descriptors.findIndex((item) => item.environmentID === environment.environmentID) === index,
  )
}

function publicConfigFromStored(sessionID: string, cwd: string, current: StoredSecurityConfig): SecurityConfig {
  const normalizedCwd = normalizeCwd(cwd)
  const networkAccess = current.permissionProfileID === ":danger-full-access" ? true : current.networkAccess
  const sandbox = sandboxPolicy({
    profile: current.permissionProfileID,
    cwd: normalizedCwd,
    networkAccess,
  })
  const profile = permissionProfile({
    profile: current.permissionProfileID,
    cwd: normalizedCwd,
    networkAccess,
  })
  const activeProfile = activePermissionProfile(current.permissionProfileID)
  const securityConstraints = CodexTurn.defaultSecurityConstraints(normalizedCwd)
  const envs = environments({
    cwd: normalizedCwd,
    environmentID: current.environmentID,
    networkPolicy: current.networkPolicy,
    networkAccess,
    sandboxPolicy: sandbox,
  })
  const platformSandbox: PlatformSandboxCapability = CodexTurn.platformSandboxCapability({
    environments: envs,
    selectedEnvironmentID: current.environmentID,
  })
  const fileSystemPolicy: FileSystemSandboxPolicy = CodexTurn.fileSystemSandboxPolicy({
    cwd: normalizedCwd,
    sandboxPolicy: sandbox,
    permissionProfile: profile,
    activePermissionProfile: activeProfile,
    environments: envs,
    selectedEnvironmentID: current.environmentID,
    securityConstraints,
  })
  const networkSandboxPolicy: NetworkSandboxPolicy = CodexTurn.networkSandboxPolicy({
    networkPolicy: current.networkPolicy,
    networkPermissions: current.networkPermissions,
    activePermissionProfile: activeProfile,
    approvalPolicy: approvalPolicy(current.approvalPolicy),
    selectedEnvironmentID: current.environmentID,
    networkAccess,
  })
  const networkProxy: NetworkProxyConfig = CodexTurn.networkProxy({
    networkPermissions: current.networkPermissions,
    selectedEnvironmentID: current.environmentID,
  })
  const proofApprovalPolicy = approvalPolicy(current.approvalPolicy)
  const effectivePermissionProfile = CodexTurn.effectivePermissionProfile({
    cwd: normalizedCwd,
    approvalPolicy: approvalPolicy(current.approvalPolicy),
    approvalsReviewer: CodexTurn.approvalReviewer(current.approvalsReviewer),
    sandboxPolicy: sandbox,
    permissionProfile: profile,
    requestedPermissionProfile: activeProfile,
    resolvedPermissionProfile: activeProfile,
    activePermissionProfile: activeProfile,
    environments: envs,
    selectedEnvironmentID: current.environmentID,
    networkPolicy: current.networkPolicy,
    networkPermissions: current.networkPermissions,
    networkSandboxPolicy,
    networkProxy,
    shellEnvironmentPolicy: current.shellEnvironmentPolicy,
    commandPolicy: current.commandPolicy,
    securityConstraints,
    fileSystemPolicy,
    platformSandbox,
  })
  const selectedEnvironment = envs.find((env) => env.environmentID === current.environmentID)
  return {
    sessionID,
    permissionProfileID: current.permissionProfileID,
    approvalPolicy: current.approvalPolicy,
    approvalsReviewer: current.approvalsReviewer,
    networkPolicy: current.networkPolicy,
    commandPolicy: current.commandPolicy,
    networkAccess,
    networkPermissions: current.networkPermissions,
    networkSandboxPolicy,
    networkProxy,
    shellEnvironmentPolicy: current.shellEnvironmentPolicy,
    executorBackend: current.executorBackend,
    environmentID: current.environmentID,
    cwd: normalizedCwd,
    remoteEnvironmentSupported: false,
    remoteEnvironmentStatus: "remote environment，远程环境，本轮只暴露入口，尚未接入远程执行",
    platformSandbox,
    securityConstraints,
    effectivePermissionProfile,
    fileSystemPolicy,
    runtimeProof: {
      version: "aialra.sandbox_control_runtime_proof.v1",
      active_permission_profile_id: activeProfile.id,
      active_permission_profile_kind: activeProfile.kind ?? "unknown",
      cwd: normalizedCwd,
      environment_id: current.environmentID,
      environment_cwd: selectedEnvironment?.cwd ?? normalizedCwd,
      approval_policy: typeof proofApprovalPolicy === "string" ? proofApprovalPolicy : proofApprovalPolicy.type,
      approvals_reviewer: current.approvalsReviewer,
      command_policy: current.commandPolicy,
      executor_backend: current.executorBackend,
      file_system: {
        enforced: activeProfile.kind !== "disabled",
        mode: activeProfile.kind ?? "unknown",
        writable_roots: fileSystemPolicy.writable_roots,
        readable_roots: fileSystemPolicy.readable_roots,
        protected_paths: fileSystemPolicy.protected_paths,
        symlink_escape_protected: true,
      },
      network: {
        policy: current.networkPolicy,
        access: networkAccess ? "enabled" : current.networkPolicy === "ask" ? "ask" : "restricted",
        sandbox_mode: networkSandboxPolicy.mode,
        disabled: networkSandboxPolicy.network_disabled,
        private_ip_policy: networkSandboxPolicy.private_ip_policy,
        localhost_policy: networkSandboxPolicy.localhost_policy,
        proxy_required: networkSandboxPolicy.proxy_required,
        proxy_enabled: networkProxy.enabled,
      },
      shell_environment: {
        mode: current.shellEnvironmentPolicy.mode,
        sensitive_env_redacted: current.shellEnvironmentPolicy.redact,
        allowlist: current.shellEnvironmentPolicy.allowlist,
        denylist: current.shellEnvironmentPolicy.denylist,
      },
      live_effect: {
        applies_to_next_turn: true,
        applies_to_next_tool_gate: true,
        in_flight_model_requests_not_rewritten: true,
        in_flight_processes_not_rewritten: true,
      },
      platform_sandbox: platformSandbox,
      effective_permission_profile: effectivePermissionProfile,
    },
    stepBudgetEnabled: current.stepBudgetEnabled,
    stepBudgetMaxSteps: current.stepBudgetMaxSteps,
    engineering: current.engineering,
  }
}

function publicConfig(sessionID: string, cwd: string): SecurityConfig {
  return publicConfigFromStored(sessionID, cwd, stored(sessionID))
}

function emitChange(input: {
  sessionID: string
  type:
    | "sandbox.profile.changed"
    | "sandbox.network.changed"
    | "sandbox.command.changed"
    | "approval.policy.changed"
    | "approval.reviewer.changed"
    | "executor.backend.changed"
    | "environment.selected"
    | "turn.step_budget.changed"
    | "engineering.mode.changed"
    | "engineering.budget.changed"
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
  const after = publicConfigFromStored(input.sessionID, input.cwd, input.after)
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
      runtimeProof: after.runtimeProof,
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
      runtimeProof: after.runtimeProof,
      changedBy: "current_user",
    },
  })
}

export namespace SessionSecurity {
  export function get(input: { sessionID: string; cwd: string }) {
    return publicConfig(input.sessionID, input.cwd)
  }

  export function environmentStatus(input: { sessionID: string; cwd: string }) {
    const config = publicConfig(input.sessionID, input.cwd)
    const envs = environments({
      cwd: config.cwd,
      environmentID: config.environmentID,
      networkPolicy: config.networkPolicy,
      networkAccess: config.networkAccess,
      sandboxPolicy: sandboxPolicy({
        profile: config.permissionProfileID,
        cwd: config.cwd,
        networkAccess: config.networkAccess,
      }),
    })
    return {
      sessionID: input.sessionID,
      selectedEnvironmentID: config.environmentID,
      selectedEnvironmentCwd: envs.find((env) => env.environmentID === config.environmentID)?.cwd ?? config.cwd,
      environments: envs,
      remoteEnvironmentSupported: config.remoteEnvironmentSupported,
      remoteEnvironmentStatus: config.remoteEnvironmentStatus,
    } satisfies SecurityEnvironmentStatus
  }

  export function update(input: { sessionID: string; cwd: string; patch: SecurityUpdatePayload }) {
    const cwd = normalizeCwd(input.cwd)
    const previousValue = stored(input.sessionID)
    const previous = { ...previousValue, engineering: { ...previousValue.engineering } }
    const patch = { ...input.patch }
    delete patch.engineering
    const next = normalizeStored(previous, {
      ...patch,
      engineering: input.patch.engineering
        ? EngineeringHarness.normalize(
            input.patch.engineering.mode && !("advancedEnabled" in input.patch.engineering)
              ? EngineeringHarness.applyMode(previous.engineering, input.patch.engineering.mode)
              : { ...previous.engineering, ...input.patch.engineering },
            previous.engineering,
          )
        : previous.engineering,
    })
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
        from: previous.networkPolicy,
        to: next.networkPolicy,
        cwd,
      })
    } else if (previous.networkPolicy !== next.networkPolicy) {
      emitChange({
        sessionID: input.sessionID,
        type: "sandbox.network.changed",
        title: "Sandbox network policy changed",
        from: previous.networkPolicy,
        to: next.networkPolicy,
        cwd,
      })
    }
    if (previous.commandPolicy !== next.commandPolicy) {
      emitChange({
        sessionID: input.sessionID,
        type: "sandbox.command.changed",
        title: "Sandbox command policy changed",
        from: previous.commandPolicy,
        to: next.commandPolicy,
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
    if (previous.approvalsReviewer !== next.approvalsReviewer) {
      emitChange({
        sessionID: input.sessionID,
        type: "approval.reviewer.changed",
        title: "Approval reviewer changed",
        from: previous.approvalsReviewer,
        to: next.approvalsReviewer,
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
    if (previous.engineering.mode !== next.engineering.mode) {
      emitChange({
        sessionID: input.sessionID,
        type: "engineering.mode.changed",
        title: "Engineering mode changed",
        from: previous.engineering.mode,
        to: next.engineering.mode,
        cwd,
      })
    }
    if (JSON.stringify(previous.engineering) !== JSON.stringify(next.engineering)) {
      emitChange({
        sessionID: input.sessionID,
        type: "engineering.budget.changed",
        title: "Engineering budget changed",
        from: previous.engineering.mode,
        to: next.engineering.mode,
        cwd,
      })
      PublicEventLog.recordManual({
        type: "engineering.controls.changed",
        severity: "info",
        sessionID: input.sessionID,
        title: "Engineering controls changed",
        summary: "工程控制参数已更新",
        status: "changed",
        data: {
          before: previous.engineering,
          after: next.engineering,
          cwd,
          scope: "session_next_turn_and_live_tool_gates",
          actor: "current_user",
        },
        raw: {
          source: "session.security",
          before: previous.engineering,
          after: next.engineering,
          cwd,
          actor: "current_user",
        },
      })
    }

    return publicConfig(input.sessionID, cwd)
  }

  export function overrides(input: { sessionID: string; cwd: string; turnSettings?: SecurityTurnSettingsOverride }) {
    const baseCwd = normalizeCwd(input.cwd)
    const requestedCwd = input.turnSettings?.cwd ? normalizeCwd(input.turnSettings.cwd) : baseCwd
    const storedConfig = stored(input.sessionID)
    const config = publicConfigFromStored(
      input.sessionID,
      requestedCwd,
      normalizeStored(storedConfig, {
        ...(input.turnSettings?.permissionProfileID ? { permissionProfileID: input.turnSettings.permissionProfileID } : {}),
        ...(input.turnSettings?.approvalPolicy ? { approvalPolicy: input.turnSettings.approvalPolicy } : {}),
        ...(input.turnSettings?.approvalsReviewer ? { approvalsReviewer: input.turnSettings.approvalsReviewer } : {}),
        ...(input.turnSettings?.networkPolicy ? { networkPolicy: input.turnSettings.networkPolicy } : {}),
        ...(input.turnSettings?.networkPermissions ? { networkPermissions: input.turnSettings.networkPermissions as NetworkPermissionPolicy } : {}),
        ...(input.turnSettings?.shellEnvironmentPolicy
          ? { shellEnvironmentPolicy: input.turnSettings.shellEnvironmentPolicy as ShellEnvironmentPolicy }
          : {}),
        ...(input.turnSettings?.commandPolicy ? { commandPolicy: input.turnSettings.commandPolicy } : {}),
        ...(input.turnSettings?.networkAccess === undefined ? {} : { networkAccess: input.turnSettings.networkAccess }),
        ...(input.turnSettings?.executorBackend ? { executorBackend: input.turnSettings.executorBackend } : {}),
        ...(input.turnSettings?.environmentID ? { environmentID: input.turnSettings.environmentID } : {}),
      }),
    )
    const base = publicConfigFromStored(input.sessionID, baseCwd, storedConfig)
    const requestedProfileID = input.turnSettings?.permissionProfileID ?? base.permissionProfileID
    const resolvedProfileID = config.permissionProfileID
    const requestedPermissionProfile = CodexTurn.permissionProfileDescriptor(normalizeProfileID(requestedProfileID), {
      source: input.turnSettings?.permissionProfileID ? "turn_settings" : "session",
      requestedID: requestedProfileID,
      resolvedID: normalizeProfileID(requestedProfileID),
    })
    const resolvedPermissionProfile = CodexTurn.permissionProfileDescriptor(resolvedProfileID, {
      source: "policy",
      requestedID: requestedProfileID,
      resolvedID: resolvedProfileID,
    })
    const approvalsReviewer = CodexTurn.approvalReviewer(config.approvalsReviewer)
    const activeProfile = activePermissionProfile(config.permissionProfileID)
    const sandbox = sandboxPolicy({
      profile: config.permissionProfileID,
      cwd: config.cwd,
      networkAccess: config.networkAccess,
    })
    const profile = permissionProfile({
      profile: config.permissionProfileID,
      cwd: config.cwd,
      networkAccess: config.networkAccess,
    })
    const networkPermissions = config.networkPermissions as NetworkPermissionPolicy
    const shellEnvironmentPolicy = config.shellEnvironmentPolicy as ShellEnvironmentPolicy
    const securityConstraints = config.securityConstraints as SecurityConstraints
    const envs = environments({
      cwd: config.cwd,
      environmentID: config.environmentID,
      networkPolicy: config.networkPolicy,
      networkAccess: config.networkAccess,
      sandboxPolicy: sandbox,
    })
    const platformSandbox = CodexTurn.platformSandboxCapability({
      environments: envs,
      selectedEnvironmentID: config.environmentID,
    })
    const fileSystemPolicy = CodexTurn.fileSystemSandboxPolicy({
      cwd: config.cwd,
      sandboxPolicy: sandbox,
      permissionProfile: profile,
      activePermissionProfile: activeProfile,
      environments: envs,
      selectedEnvironmentID: config.environmentID,
      securityConstraints,
    })
    const networkSandboxPolicy = CodexTurn.networkSandboxPolicy({
      networkPolicy: config.networkPolicy,
      networkPermissions,
      activePermissionProfile: activeProfile,
      approvalPolicy: approvalPolicy(config.approvalPolicy),
      selectedEnvironmentID: config.environmentID,
      networkAccess: config.networkAccess,
    })
    const networkProxy = CodexTurn.networkProxy({
      networkPermissions,
      selectedEnvironmentID: config.environmentID,
    })
    const effective = {
      cwd: config.cwd,
      approval_policy: approvalPolicy(config.approvalPolicy),
      approvals_reviewer: approvalsReviewer,
      permission_profile_id: config.permissionProfileID,
      requested_permission_profile: requestedPermissionProfile,
      resolved_permission_profile: resolvedPermissionProfile,
      active_permission_profile: activeProfile,
      permission_profile: profile,
      sandbox_policy: sandbox,
      network_policy: config.networkPolicy,
      network_permissions: networkPermissions,
      network_sandbox_policy: networkSandboxPolicy,
      network_proxy: networkProxy,
      shell_environment_policy: shellEnvironmentPolicy,
      command_policy: config.commandPolicy,
      executor_backend: config.executorBackend,
      environment_id: config.environmentID,
      environment_cwd: envs.find((env) => env.environmentID === config.environmentID)?.cwd ?? config.cwd,
      network_access: config.networkAccess,
      security_constraints: securityConstraints,
      file_system_policy: fileSystemPolicy,
      platform_sandbox: platformSandbox,
      effective_permission_profile: CodexTurn.effectivePermissionProfile({
        cwd: config.cwd,
        approvalPolicy: approvalPolicy(config.approvalPolicy),
        approvalsReviewer,
        sandboxPolicy: sandbox,
        permissionProfile: profile,
        requestedPermissionProfile,
        resolvedPermissionProfile,
        activePermissionProfile: activeProfile,
        environments: envs,
        selectedEnvironmentID: config.environmentID,
        networkPolicy: config.networkPolicy,
        networkPermissions,
        networkSandboxPolicy,
        networkProxy,
        shellEnvironmentPolicy,
        commandPolicy: config.commandPolicy,
        securityConstraints,
        fileSystemPolicy,
        platformSandbox,
      }),
    }
    return {
      approvalPolicy: effective.approval_policy,
      approvalsReviewer,
      sandboxPolicy: sandbox,
      permissionProfile: profile,
      requestedPermissionProfile,
      resolvedPermissionProfile,
      activePermissionProfile: activeProfile,
      effectivePermissionProfile: effective.effective_permission_profile,
      fileSystemPolicy,
      environments: envs,
      selectedEnvironmentID: config.environmentID,
      httpContext: {
        enabled: config.networkAccess,
        network_policy: config.networkPolicy,
        execution: "local" as const,
      },
      platformSandbox,
      networkPolicy: config.networkPolicy,
      networkPermissions,
      networkSandboxPolicy,
      networkProxy,
      shellEnvironmentPolicy,
      commandPolicy: config.commandPolicy,
      securityConstraints,
      stepBudget: {
        enabled: config.stepBudgetEnabled,
        max_steps: config.stepBudgetMaxSteps,
      },
      engineering: EngineeringHarness.snapshot({
        controls: config.engineering,
        prompt: "",
      }),
      threadSettings: {
        requested: input.turnSettings ?? {},
        resolved: {
          session: base,
          turn: input.turnSettings ?? {},
        },
        effective,
      },
    }
  }

  export function applyToTurn<T extends TurnContext>(turn: T): T {
    const requested = (turn.thread_settings?.requested ?? {}) as SecurityTurnSettingsOverride
    const hasTurnSettings = Object.keys(requested).length > 0
    if (!configs.has(turn.sessionID) && !hasTurnSettings) return turn
    const resolved = overrides({
      sessionID: turn.sessionID,
      cwd: turn.cwd,
      turnSettings: hasTurnSettings ? requested : undefined,
    })
    return {
      ...turn,
      approval_policy: resolved.approvalPolicy,
      approvals_reviewer: resolved.approvalsReviewer,
      sandbox_policy: resolved.sandboxPolicy,
      permission_profile: resolved.permissionProfile,
      active_permission_profile: resolved.activePermissionProfile,
      requested_permission_profile: resolved.requestedPermissionProfile,
      resolved_permission_profile: resolved.resolvedPermissionProfile,
      effective_permission_profile: resolved.effectivePermissionProfile,
      file_system_policy: resolved.fileSystemPolicy,
      environments: resolved.environments,
      selected_environment_id: resolved.selectedEnvironmentID,
      http_context: resolved.httpContext,
      platform_sandbox: resolved.platformSandbox,
      network_policy: resolved.networkPolicy,
      network_permissions: resolved.networkPermissions,
      network_sandbox_policy: resolved.networkSandboxPolicy,
      network_proxy: resolved.networkProxy,
      shell_environment_policy: resolved.shellEnvironmentPolicy,
      command_policy: resolved.commandPolicy,
      step_budget: resolved.stepBudget,
      security_constraints: resolved.securityConstraints,
      thread_settings: resolved.threadSettings,
      engineering: turn.engineering
        ? {
            ...turn.engineering,
            controls: resolved.engineering.controls,
          }
        : resolved.engineering,
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

import path from "node:path"
import os from "node:os"
import { Global } from "@opencode-ai/core/global"
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

export type ApprovalReviewerRole = "user" | "auto_review" | "guardian" | "policy_engine" | "external_reviewer"

export type ApprovalReviewer = {
  role: ApprovalReviewerRole
  id: string
  label: string
  source: "config" | "turn_settings" | "default" | "legacy"
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

export type PermissionProfileKind = "managed" | "read_only" | "workspace" | "full" | "custom" | "external" | "disabled"

export type ActivePermissionProfile = {
  id: ":read-only" | ":workspace" | ":danger-full-access" | (string & {})
  kind?: PermissionProfileKind
  label?: string
  source?: "session" | "turn_settings" | "default" | "legacy" | "policy"
  requestedID?: string
  resolvedID?: string
  capabilities?: string[]
  restrictions?: string[]
  extends?: string
}

export type TurnEnvironment = {
  environmentID: string
  cwd: string
  platform?: NodeJS.Platform | (string & {})
  kind?: "local" | "remote" | "container" | "workspace" | "external" | "disabled"
  status?: string
  runtimeID?: string
  shell?: {
    kind: "local" | "remote" | "container" | "external" | "unsupported"
    command?: string
    status: "ready" | "unsupported" | "error"
  }
  fileSystem?: {
    kind: "local" | "remote" | "container" | "external" | "unsupported"
    cwd: string
    writableRoots: string[]
    protectedPaths: string[]
    status: "ready" | "unsupported" | "error"
  }
  network?: {
    policy: "off" | "on" | "ask"
    access: "restricted" | "enabled" | "ask"
  }
  sandbox?: {
    policy: string
    enforced: boolean
    status: "ready" | "unsupported" | "error"
  }
  connection?: {
    state: "ready" | "unsupported" | "error"
    reason?: string
  }
  capabilities?: string[]
}

export type TurnHttpContext = {
  enabled: boolean
  network_policy: "off" | "on" | "ask"
  execution: "local" | "remote" | "unsupported"
}

export type PlatformSandboxCapability = {
  version: "aialra.platform_sandbox_capability.v1"
  host_platform: NodeJS.Platform
  target_platform: string
  selected_environment_id: string
  status: "ready" | "unsupported" | "degraded"
  supported: boolean
  backend: "linux-bwrap-landlock-seccomp" | "windows-unsupported" | "macos-unsupported" | "none"
  enforcement: "runtime" | "unsupported" | "degraded"
  warning?: string
  codex_parity: {
    windows_restricted_token: "unsupported" | "not_applicable"
    macos_seatbelt: "unsupported" | "not_applicable"
    linux_seccomp_landlock: "ready" | "not_applicable" | "degraded"
  }
  fallbacks: string[]
  risk_controls: string[]
}

export type NetworkPermissionPolicy = {
  version: "aialra.network_permissions.v1"
  mode: "off" | "on" | "ask"
  allowlist: string[]
  denylist: string[]
  private_network: "block" | "ask" | "allow"
  proxy: {
    enabled: boolean
    url?: string
  }
  tools: Record<string, "off" | "on" | "ask">
}

export type NetworkSandboxPolicy = {
  version: "aialra.network_sandbox_policy.v1"
  mode: "off" | "on" | "ask"
  network_disabled: boolean
  ask_before_access: boolean
  allowlist: string[]
  denylist: string[]
  private_ip_policy: "block" | "ask" | "allow"
  localhost_policy: "block" | "ask" | "allow"
  metadata_service_policy: "block"
  proxy_required: boolean
  proxy: NetworkPermissionPolicy["proxy"]
  per_tool: Record<string, "off" | "on" | "ask">
  per_turn_override?: {
    network_policy?: "off" | "on" | "ask"
    network_access?: boolean
  }
  dns_audit: {
    enabled: true
    classify_private_ip: true
    classify_localhost: true
    classify_metadata_service: true
  }
  http_audit: {
    enabled: true
    classify_status: true
    classify_non_2xx: true
  }
  active_permission_profile: ActivePermissionProfile
  approval_policy: ApprovalPolicy
  selected_environment_id: string
}

export type NetworkSandboxDecision = {
  version: "aialra.network_sandbox_decision.v1"
  policy_version: NetworkSandboxPolicy["version"]
  tool?: string
  url: string
  host: string
  classification: "metadata-service" | "loopback" | "private-network" | "unknown-domain"
  mode: "off" | "on" | "ask"
  decision: "allow" | "deny" | "ask"
  needs_approval: boolean
  network_access: boolean
  matched_rule?: string
  reason: string
  proxy: NetworkPermissionPolicy["proxy"]
  active_permission_profile: ActivePermissionProfile
}

export type NetworkProxyConfig = {
  version: "aialra.network_proxy.v1"
  enabled: boolean
  required: boolean
  url?: string
  no_proxy: string[]
  source: "network_permissions" | "default"
  enforcement: "disabled" | "environment" | "unavailable"
  per_environment: Record<string, { enabled?: boolean; required?: boolean; url?: string; no_proxy?: string[] }>
  audit: {
    enabled: true
    dns: true
    http: true
    redact_headers: string[]
  }
}

export type ShellEnvironmentPolicy = {
  version: "aialra.shell_environment_policy.v1"
  mode: "clear" | "inherit"
  allowlist: string[]
  denylist: string[]
  redact: string[]
  overrides: Record<string, string>
  safe_defaults: boolean
  per_environment: Record<string, Record<string, string>>
}

export type EffectivePermissionProfile = {
  version: "aialra.effective_permission_profile.v1"
  cwd: string
  environment_cwd: string
  selected_environment_id: string
  requested_permission_profile?: ActivePermissionProfile
  resolved_permission_profile?: ActivePermissionProfile
  active_permission_profile: ActivePermissionProfile
  permission_profile: PermissionProfile
  sandbox_policy: SandboxPolicy
  approval_policy: ApprovalPolicy
  approvals_reviewer?: ApprovalReviewer
  command_policy?: "ask" | "workspace" | "all" | "read" | "disabled"
  network_policy?: "off" | "on" | "ask"
  network_permissions: NetworkPermissionPolicy
  network_sandbox_policy: NetworkSandboxPolicy
  network_proxy: NetworkProxyConfig
  shell_environment_policy: ShellEnvironmentPolicy
  security_constraints: SecurityConstraints
  file_system_policy: FileSystemSandboxPolicy
  platform_sandbox: PlatformSandboxCapability
  capabilities: string[]
  restrictions: string[]
}

export type FileSystemSandboxPolicyRule = {
  id: string
  kind:
    | "readable_root"
    | "writable_root"
    | "creatable_root"
    | "readonly_mount"
    | "tmp_dir"
    | "protected_path"
    | "deny_path"
    | "profile_entry"
    | "sandbox_entry"
    | "security_constraint"
  operation: "read" | "write" | "create" | "delete" | "search" | "read-write"
  access: "read" | "write" | "none"
  path:
    | { type: "path"; path: string }
    | { type: "glob"; pattern: string }
    | { type: "special"; value: "root" | "workspace_roots" | "tmpdir" | "slash_tmp" | "minimal" }
  source: "permission_profile" | "sandbox_policy" | "security_constraints" | "codex_default" | "codex" | "aialra" | "user"
  reason: string
}

export type FileSystemSandboxPolicy = {
  version: "aialra.file_system_sandbox_policy.v1"
  cwd: string
  environment_cwd: string
  selected_environment_id: string
  active_permission_profile: ActivePermissionProfile
  sandbox_policy: SandboxPolicy
  permission_profile: PermissionProfile
  readable_roots: string[]
  writable_roots: string[]
  creatable_roots: string[]
  readonly_mounts: string[]
  tmp_dirs: string[]
  protected_paths: string[]
  deny_paths: Array<{ path: string; operation: "read" | "write" | "read-write"; reason: string; source: string }>
  allowed_file_schemes: ["file"]
  symlink_policy: {
    mode: "deny_workspace_escape"
    canonicalize: true
    protected_metadata_escape: "deny"
  }
  realpath_policy: {
    read_missing_target: "use_requested_path"
    write_missing_target: "nearest_existing_parent"
  }
  create_policy: {
    parent_must_allow_write: true
    protected_create: "deny_or_readonly_mount"
    missing_parent_resolution: "nearest_existing_parent"
  }
  delete_policy: {
    protected_paths: "deny"
    outside_writable_roots: "deny"
  }
  rules: FileSystemSandboxPolicyRule[]
}

export type FileSystemSandboxDecision = {
  version: "aialra.file_system_sandbox_decision.v1"
  policy_version: FileSystemSandboxPolicy["version"]
  operation: "read" | "write" | "create" | "delete" | "search"
  requested_path: string
  resolved_path: string
  canonical_path?: string
  decision: "allow" | "deny"
  resolved_access: "read" | "write" | "none"
  canonical_access?: "read" | "write" | "none"
  matched_rule?: FileSystemSandboxPolicyRule
  canonical_matched_rule?: FileSystemSandboxPolicyRule
  deny_reason?: string
  active_permission_profile: ActivePermissionProfile
  sandbox_policy: SandboxPolicy
  selected_environment_id: string
  environment_cwd: string
}

export type SecurityConstraintFileRule = {
  id: string
  operation: "read" | "write" | "read-write"
  path:
    | { type: "path"; path: string }
    | { type: "glob"; pattern: string }
  action: "deny"
  reason: string
  source: "codex" | "aialra" | "user"
}

export type SecurityConstraintNetworkRule = {
  id: string
  target: "private-network" | "loopback" | "metadata-service" | "unknown-domain"
  action: "deny" | "ask"
  reason: string
  source: "codex" | "aialra" | "user"
}

export type SecurityConstraintShellRule = {
  id: string
  pattern: string
  action: "deny"
  reason: string
  source: "codex" | "aialra" | "user"
}

export type SecurityConstraints = {
  version: "aialra.security_constraints.v1"
  active: boolean
  file: SecurityConstraintFileRule[]
  network: SecurityConstraintNetworkRule[]
  shell: SecurityConstraintShellRule[]
}

export type CodexRetryConfig = {
  request_max_retries: number
  stream_max_retries: number
  stream_idle_timeout_ms: number
}

export type UserTurnInputItem =
  | {
      type: "text"
      text: string
      text_elements: Array<{
        byte_range: { start: number; end: number }
        placeholder?: string
      }>
      metadata?: Record<string, unknown>
    }
  | { type: "image"; image_url: string; metadata?: Record<string, unknown> }
  | { type: "local_image"; path: string; metadata?: Record<string, unknown> }
  | {
      type: "file"
      mime: string
      filename?: string
      url: string
      source?: unknown
      metadata?: Record<string, unknown>
    }
  | { type: "skill"; name: string; path: string; metadata?: Record<string, unknown> }
  | { type: "mention"; name: string; path: string; metadata?: Record<string, unknown> }
  | { type: "subtask"; prompt: string; description: string; agent: string; command?: string; metadata?: Record<string, unknown> }

export type UserTurnThreadSettings = {
  requested: Record<string, unknown>
  resolved: Record<string, unknown>
  effective: Record<string, unknown>
}

export type ExtensionData = Record<string, Record<string, unknown>>

export type ModelInfo = {
  version: "aialra.model_info.v1"
  provider: {
    id: string
    name?: string
    source?: string
    api?: string
    npm?: string
  }
  model: {
    id: string
    api_id?: string
    display_name?: string
    family?: string
    variant?: string
    release_date?: string
    status?: string
  }
  limits: {
    context_length?: number
    input_tokens?: number
    output_tokens?: number
  }
  supports: {
    tools: boolean
    structured_output: boolean
    reasoning: boolean
    reasoning_effort: boolean
    reasoning_summary: boolean
    image_input: boolean
    file_input: boolean
    streaming: boolean
    service_tier: boolean
  }
  service_tier: {
    supported: string[]
    mapping: Record<string, string>
    default?: string
  }
  cost: {
    input?: number
    output?: number
    cache_read?: number
    cache_write?: number
    currency: "USD"
    unit: "per_million_tokens"
  }
  fallback: {
    enabled: boolean
    providerID?: string
    modelID?: string
    behavior?: string
  }
  provider_capabilities: Record<string, unknown>
  source: "provider_metadata" | "model_options" | "fallback_default"
}

export type ReasoningEffortResolution = {
  version: "aialra.reasoning_effort_resolution.v1"
  requested?: string
  effective?: string
  source: "turn_settings" | "variant" | "model_options" | "none"
  supported: string[]
  fallback: {
    applied: boolean
    reason?: string
    from?: string
    to?: string
  }
}

export type ReasoningSummaryPolicy = {
  version: "aialra.reasoning_summary_policy.v1"
  enabled: boolean
  level: "off" | "auto" | "brief" | "detailed"
  auto_collapse: boolean
  per_turn: boolean
  tool_linked: boolean
  source: "turn_settings" | "model_options" | "default"
}

export type ServiceTierResolution = {
  version: "aialra.service_tier_resolution.v1"
  requested?: string
  effective?: string
  provider_tier?: string
  source: "turn_settings" | "model_options" | "none"
  supported: string[]
  mapping: Record<string, string>
  fallback: {
    applied: boolean
    reason?: string
    from?: string
    to?: string
  }
  scheduling: {
    latency: "standard" | "priority" | "batch" | "unknown"
    cost: "standard" | "premium" | "discount" | "unknown"
    background: boolean
  }
}

export type DynamicToolSource = "registry" | "mcp" | "structured_output" | "plugin"

export type DynamicToolStatus = {
  id: string
  source: DynamicToolSource
  status: "available" | "disabled"
  reasons: string[]
  schema_projected: boolean
}

export type DynamicToolsResolution = {
  version: "aialra.dynamic_tools.v1"
  requested: Record<string, boolean>
  available: DynamicToolStatus[]
  disabled: DynamicToolStatus[]
  available_ids: string[]
  disabled_ids: string[]
  resolver: {
    permission_profile: ActivePermissionProfile
    approval_policy: ApprovalPolicy
    model_supports_tools: boolean
    selected_environment_id: string
  }
}

export type SkillCatalogItem = {
  skill_id: string
  name: string
  version?: string
  source: "builtin" | "project" | "global" | "remote" | "config" | "unknown"
  description?: string
  location: string
  applicable: boolean
  prompt_injected: boolean
  used: boolean
  usage_count: number
  tools: string[]
  mcp_resources: string[]
  commands: string[]
  external_resources: string[]
  permission_requirements: string[]
  disabled_reasons: string[]
}

export type SkillCatalog = {
  version: "aialra.skill_catalog.v1"
  available: SkillCatalogItem[]
  disabled: SkillCatalogItem[]
  available_ids: string[]
  disabled_ids: string[]
  injected_ids: string[]
  used_ids: string[]
  resolver: {
    agent: string
    permission_profile: ActivePermissionProfile
    approval_policy: ApprovalPolicy
    selected_environment_id: string
  }
  resources: {
    tools: string[]
    mcp_resources: string[]
    commands: string[]
    external_resources: string[]
  }
}

export type UserTurn = {
  version: "aialra.user_turn.v1"
  items: MessageV2.Part[]
  input_items: UserTurnInputItem[]
  input_schema: {
    codex: "Op::UserInput"
    supported_items: Array<UserTurnInputItem["type"]>
  }
  cwd: string
  approval_policy: ApprovalPolicy
  approvals_reviewer?: ApprovalReviewer
  sandbox_policy: SandboxPolicy
  permission_profile: PermissionProfile
  requested_permission_profile?: ActivePermissionProfile
  resolved_permission_profile?: ActivePermissionProfile
  active_permission_profile: ActivePermissionProfile
  effective_permission_profile?: EffectivePermissionProfile
  file_system_policy?: FileSystemSandboxPolicy
  model: {
    providerID: string
    modelID: string
    variant?: string
  }
  model_info: ModelInfo
  requested_effort?: string
  effective_effort?: string
  effort_resolution: ReasoningEffortResolution
  effort?: string
  summary?: string
  reasoning_summary_policy: ReasoningSummaryPolicy
  requested_service_tier?: string
  effective_service_tier?: string
  service_tier_resolution: ServiceTierResolution
  service_tier?: string
  final_output_json_schema?: unknown
  dynamic_tools: DynamicToolsResolution
  skill_catalog: SkillCatalog
  collaboration_mode: {
    kind: "default" | "plan" | "review" | (string & {})
  }
  personality?: string
  environments: TurnEnvironment[]
  selected_environment_id: string
  http_context?: TurnHttpContext
  platform_sandbox?: PlatformSandboxCapability
  network_policy?: "off" | "on" | "ask"
  network_permissions: NetworkPermissionPolicy
  network_sandbox_policy?: NetworkSandboxPolicy
  network_proxy?: NetworkProxyConfig
  shell_environment_policy: ShellEnvironmentPolicy
  command_policy?: "ask" | "workspace" | "all" | "read" | "disabled"
  security_constraints: SecurityConstraints
  step_budget?: {
    enabled: boolean
    max_steps?: number
  }
  thread_settings: UserTurnThreadSettings
  responsesapi_client_metadata?: Record<string, string>
  metadata: Record<string, unknown>
  extension_data: ExtensionData
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

function asBool(value: unknown) {
  if (typeof value === "boolean") return value
  if (typeof value === "string") {
    if (["true", "1", "yes", "on"].includes(value.toLowerCase())) return true
    if (["false", "0", "no", "off"].includes(value.toLowerCase())) return false
  }
  return undefined
}

function hasOption(options: Record<string, unknown> | undefined, keys: string[]) {
  return keys.some((key) => options?.[key] !== undefined)
}

function boolOption(options: Record<string, unknown> | undefined, keys: string[], fallback: boolean) {
  for (const key of keys) {
    const value = asBool(options?.[key])
    if (value !== undefined) return value
  }
  return fallback
}

function stringOption(options: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = options?.[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

function stringArrayOption(options: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = options?.[key]
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    if (typeof value === "string" && value.trim()) return value.split(",").map((item) => item.trim()).filter(Boolean)
  }
  return []
}

function stringRecordOption(options: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = options?.[key]
    if (!value || typeof value !== "object" || Array.isArray(value)) continue
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).flatMap(([entryKey, entryValue]) =>
        typeof entryValue === "string" && entryValue.trim() ? [[entryKey, entryValue]] : [],
      ),
    )
  }
  return {}
}

function variantEffort(options: Record<string, unknown> | undefined) {
  return stringOption(options, ["reasoningEffort", "reasoning_effort", "effort", "thinkingLevel"])
}

function effortRank(value: string) {
  const index = ["minimal", "low", "medium", "high", "xhigh", "max"].indexOf(value)
  return index === -1 ? Number.MAX_SAFE_INTEGER : index
}

function serviceTierScheduling(value: string | undefined): ServiceTierResolution["scheduling"] {
  if (!value) return { latency: "unknown", cost: "unknown", background: false }
  const normalized = value.toLowerCase()
  if (["priority", "premium", "high"].includes(normalized)) {
    return { latency: "priority", cost: "premium", background: false }
  }
  if (["batch", "background"].includes(normalized)) return { latency: "batch", cost: "discount", background: true }
  if (["flex"].includes(normalized)) return { latency: "standard", cost: "discount", background: false }
  if (["auto", "default", "standard"].includes(normalized)) {
    return { latency: "standard", cost: "standard", background: false }
  }
  return { latency: "unknown", cost: "unknown", background: false }
}

function uniqueSorted(items: string[]) {
  return [...new Set(items.filter((item) => item.trim()))].toSorted((a, b) => a.localeCompare(b))
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>()
  return items.filter((item) => {
    const value = key(item)
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

function cleanExtensionNamespace(value: string) {
  const clean = value.trim().replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80)
  return clean || undefined
}

function cleanExtensionPayload(value: unknown, depth = 0): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value) || depth > 3) return
  const output: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 80)) {
    const cleanKey = key.trim().replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80)
    if (!cleanKey) continue
    if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") {
      output[cleanKey] = item
      continue
    }
    if (Array.isArray(item)) {
      output[cleanKey] = item.slice(0, 80).map((entry) => {
        if (entry === null || typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") return entry
        const nested = cleanExtensionPayload(entry, depth + 1)
        return nested ?? String(entry)
      })
      continue
    }
    const nested = cleanExtensionPayload(item, depth + 1)
    if (nested) output[cleanKey] = nested
  }
  return Object.keys(output).length ? output : undefined
}

function ruleID(value: string) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "root"
}

function protectedInternalPaths() {
  const history = process.env.AIALRA_TURN_HISTORY_DIR || path.join(Global.Path.data, "aialra-turn-history")
  return [
    {
      id: "aialra-tool-output-store",
      path: path.join(Global.Path.data, "tool-output"),
      reason: "tool-output-store 保存完整工具原始输出，默认禁止模型直接读取或修改，必须通过 rawRef/Raw Lab 审计入口查看",
    },
    {
      id: "aialra-turn-history",
      path: history,
      reason: "turn history 保存回合审计记录，默认禁止模型直接读取或修改",
    },
    {
      id: "opencode-auth-json",
      path: path.join(Global.Path.data, "auth.json"),
      reason: "auth.json 可能包含认证信息，默认禁止模型读取或修改",
    },
    {
      id: "opencode-mcp-auth-json",
      path: path.join(Global.Path.data, "mcp-auth.json"),
      reason: "mcp-auth.json 可能包含 MCP 认证信息，默认禁止模型读取或修改",
    },
    {
      id: "opencode-db",
      path: path.join(Global.Path.data, "opencode.db"),
      reason: "OpenCode 数据库包含会话和配置状态，默认禁止模型读取或修改",
    },
  ]
}

function protectedSystemWritePaths() {
  const roots = process.platform === "win32"
    ? [process.env["WINDIR"], process.env["ProgramFiles"], process.env["ProgramFiles(x86)"]].filter(
        (item): item is string => Boolean(item),
      )
    : ["/bin", "/boot", "/dev", "/etc", "/lib", "/lib64", "/proc", "/root", "/sbin", "/sys", "/usr", "/var"]
  return Array.from(new Set(roots.map((item) => path.resolve(item))))
}

function fsWorkspaceRoots(cwd: string, environments: TurnEnvironment[], sandboxPolicy: SandboxPolicy) {
  return uniqueSorted([
    cwd,
    ...environments.map((environment) => environment.cwd),
    ...(sandboxPolicy.type === "workspace-write" ? sandboxPolicy.writable_roots : []),
  ].map((item) => path.resolve(item)))
}

function fsTmpDirs(sandboxPolicy: SandboxPolicy) {
  return uniqueSorted([
    ...(sandboxPolicy.type !== "workspace-write" || !sandboxPolicy.exclude_slash_tmp ? (process.platform === "win32" ? [] : ["/tmp"]) : []),
    ...(sandboxPolicy.type !== "workspace-write" || !sandboxPolicy.exclude_tmpdir_env_var ? [os.tmpdir()] : []),
  ].map((item) => path.resolve(item)))
}

function fsSandboxEntries(policy: SandboxPolicy, cwd: string, environments: TurnEnvironment[]): PermissionProfileFileSystemEntry[] {
  if (policy.type === "danger-full-access") return [{ path: { type: "special", value: "root" }, access: "write" }]
  if (policy.type === "read-only") return [{ path: { type: "special", value: "root" }, access: "read" }]
  if (policy.type === "external-sandbox") return []
  return [
    { path: { type: "special", value: "root" }, access: "read" },
    { path: { type: "special", value: "workspace_roots" }, access: "write" },
    ...(!policy.exclude_slash_tmp ? [{ path: { type: "special" as const, value: "slash_tmp" as const }, access: "write" as const }] : []),
    ...(!policy.exclude_tmpdir_env_var ? [{ path: { type: "special" as const, value: "tmpdir" as const }, access: "write" as const }] : []),
    ...policy.writable_roots.map((root) => ({ path: { type: "path" as const, path: root }, access: "write" as const })),
    ...fsWorkspaceRoots(cwd, environments, policy).flatMap((root) =>
      [".git", ".agents", ".codex"].map((name) => ({
        path: { type: "path" as const, path: path.join(root, name) },
        access: "read" as const,
      })),
    ),
  ]
}

function fsPolicyEntries(
  profile: PermissionProfile,
  sandboxPolicy: SandboxPolicy,
  cwd: string,
  environments: TurnEnvironment[],
): PermissionProfileFileSystemEntry[] {
  if (profile.type === "disabled") return [{ path: { type: "special", value: "root" }, access: "write" }]
  if (profile.type === "external") return fsSandboxEntries(sandboxPolicy, cwd, environments)
  if (profile.file_system.type === "unrestricted") return [{ path: { type: "special", value: "root" }, access: "write" }]
  return profile.file_system.entries.length ? profile.file_system.entries : fsSandboxEntries(sandboxPolicy, cwd, environments)
}

function fsRulePaths(
  entry: PermissionProfileFileSystemEntry,
  cwd: string,
  environments: TurnEnvironment[],
  sandboxPolicy: SandboxPolicy,
): FileSystemSandboxPolicyRule["path"][] {
  if (entry.path.type === "path") return [{ type: "path", path: path.resolve(entry.path.path) }]
  if (entry.path.type === "glob") return [{ type: "glob", pattern: entry.path.pattern }]
  if (entry.path.value === "root") return [{ type: "path", path: path.parse(path.resolve(cwd)).root }]
  if (entry.path.value === "workspace_roots") {
    return fsWorkspaceRoots(cwd, environments, sandboxPolicy).map((root) => ({ type: "path", path: root }))
  }
  if (entry.path.value === "tmpdir") return [{ type: "path", path: path.resolve(os.tmpdir()) }]
  if (entry.path.value === "slash_tmp") return process.platform === "win32" ? [] : [{ type: "path", path: "/tmp" }]
  return [{ type: "special", value: "minimal" }]
}

function skillCatalogItem(input: {
  skill: {
    name: string
    description?: string
    location: string
    content?: string
    reasons?: string[]
  }
  cwd: string
  disabledReasons: string[]
}): SkillCatalogItem {
  const content = input.skill.content ?? ""
  const externalResources = uniqueSorted(
    Array.from(content.matchAll(/https?:\/\/[^\s)>'"]+/g)).map((match) => match[0].replace(/[.,;]+$/, "")),
  )
  const commands = uniqueSorted(
    Array.from(content.matchAll(/`([^`\n]+)`/g))
      .map((match) => match[1].trim())
      .filter((value) => /^(bun|npm|pnpm|yarn|node|python|pytest|cargo|go|make|git|curl|npx|docker|kubectl|helm|terraform)\b/.test(value)),
  )
  const source = input.skill.location === "<built-in>"
    ? "builtin"
    : /^https?:\/\//.test(input.skill.location)
      ? "remote"
      : path.isAbsolute(input.skill.location) && input.skill.location.startsWith(input.cwd)
        ? "project"
        : input.skill.location.includes("/.claude/") || input.skill.location.includes("/.agents/")
          ? "global"
          : "config"
  return {
    skill_id: input.skill.name,
    name: input.skill.name,
    source,
    description: input.skill.description,
    location: input.skill.location,
    applicable: input.disabledReasons.length === 0,
    prompt_injected: false,
    used: false,
    usage_count: 0,
    tools: ["skill"],
    mcp_resources: /\bmcp\b/i.test(content) ? ["mentioned-in-skill-content"] : [],
    commands,
    external_resources: externalResources,
    permission_requirements: [`skill:${input.skill.name}`],
    disabled_reasons: input.disabledReasons,
  }
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

  export function permissionProfileDescriptor(
    id: ActivePermissionProfile["id"],
    input?: {
      source?: ActivePermissionProfile["source"]
      requestedID?: string
      resolvedID?: string
    },
  ): ActivePermissionProfile {
    if (id === ":read-only") {
      return {
        id,
        kind: "read_only",
        label: "Read only，只读",
        source: input?.source ?? "default",
        requestedID: input?.requestedID ?? id,
        resolvedID: input?.resolvedID ?? id,
        capabilities: ["read_file", "read_directory", "glob", "grep"],
        restrictions: ["write", "edit", "apply_patch", "bash_write", "network"],
      }
    }
    if (id === ":danger-full-access") {
      return {
        id,
        kind: "full",
        label: "Full access，完全访问",
        source: input?.source ?? "default",
        requestedID: input?.requestedID ?? id,
        resolvedID: input?.resolvedID ?? id,
        capabilities: ["read_file", "write_file", "edit", "apply_patch", "bash", "network"],
        restrictions: ["security_constraints_still_apply"],
      }
    }
    if (id === "external") {
      return {
        id,
        kind: "external",
        label: "External，外部权限管理",
        source: input?.source ?? "default",
        requestedID: input?.requestedID ?? id,
        resolvedID: input?.resolvedID ?? id,
        capabilities: ["delegated_to_external_reviewer"],
        restrictions: ["aialra_sandbox_still_applies_when_turn_context_exists"],
      }
    }
    if (id === "disabled") {
      return {
        id,
        kind: "disabled",
        label: "Disabled，关闭内置权限管理",
        source: input?.source ?? "default",
        requestedID: input?.requestedID ?? id,
        resolvedID: input?.resolvedID ?? id,
        capabilities: ["legacy_unrestricted_tools"],
        restrictions: ["security_constraints_still_apply"],
      }
    }
    if (id === "custom") {
      return {
        id,
        kind: "custom",
        label: "Custom，自定义权限档位",
        source: input?.source ?? "default",
        requestedID: input?.requestedID ?? id,
        resolvedID: input?.resolvedID ?? id,
        capabilities: ["workspace_read", "workspace_write", "custom_rules"],
        restrictions: ["custom_rules_and_security_constraints_apply"],
      }
    }
    return {
      id,
      kind: "workspace",
      label: "Workspace write，允许工作区写入",
      source: input?.source ?? "default",
      requestedID: input?.requestedID ?? id,
      resolvedID: input?.resolvedID ?? id,
      capabilities: ["read_file", "read_directory", "glob", "grep", "write_file", "edit", "apply_patch", "bash_workspace"],
      restrictions: ["workspace_outside_write", "protected_paths", "network_by_policy"],
    }
  }

  export function fileSystemSandboxPolicy(input: {
    cwd: string
    sandboxPolicy: SandboxPolicy
    permissionProfile: PermissionProfile
    activePermissionProfile: ActivePermissionProfile
    environments: TurnEnvironment[]
    selectedEnvironmentID: string
    securityConstraints: SecurityConstraints
  }): FileSystemSandboxPolicy {
    const securityConstraints = input.securityConstraints ?? defaultSecurityConstraints(input.cwd)
    const environmentCwd =
      input.environments.find((environment) => environment.environmentID === input.selectedEnvironmentID)?.cwd ?? input.cwd
    const roots = fsWorkspaceRoots(input.cwd, input.environments, input.sandboxPolicy)
    const entries = fsPolicyEntries(input.permissionProfile, input.sandboxPolicy, input.cwd, input.environments)
    const entryRules = entries.flatMap((entry, index) =>
      fsRulePaths(entry, input.cwd, input.environments, input.sandboxPolicy).map((entryPath, pathIndex) => ({
        id: `profile-entry-${index}-${pathIndex}`,
        kind:
          entry.access === "write"
            ? ("writable_root" as const)
            : entry.access === "read"
              ? ("readable_root" as const)
              : ("deny_path" as const),
        operation: entry.access === "write" ? ("read-write" as const) : entry.access === "read" ? ("read" as const) : ("read-write" as const),
        access: entry.access,
        path: entryPath,
        source: input.permissionProfile.type === "external" ? ("sandbox_policy" as const) : ("permission_profile" as const),
        reason: `Resolved from ${input.permissionProfile.type} permission profile`,
      })),
    )
    const protectedPaths = roots.flatMap((root) => [".git", ".agents", ".codex"].map((name) => path.join(root, name)))
    const protectedRules = protectedPaths.flatMap((protectedPath, index) => [
      {
        id: `protected-read-${index}`,
        kind: "readonly_mount" as const,
        operation: "read" as const,
        access: "read" as const,
        path: { type: "path" as const, path: protectedPath },
        source: "codex_default" as const,
        reason: ".git/.agents/.codex are readable but protected from mutation",
      },
      {
        id: `protected-deny-write-${index}`,
        kind: "protected_path" as const,
        operation: "write" as const,
        access: "none" as const,
        path: { type: "path" as const, path: protectedPath },
        source: "codex_default" as const,
        reason: "Protected project metadata cannot be written, created, or deleted",
      },
    ])
    const searchRules = (
      input.permissionProfile.type === "disabled" ||
      (input.permissionProfile.type === "managed" && input.permissionProfile.file_system.type === "unrestricted") ||
      input.sandboxPolicy.type === "danger-full-access"
        ? [path.parse(path.resolve(input.cwd)).root]
        : roots
    ).map((root, index) => ({
      id: `search-root-${index}`,
      kind: "readable_root" as const,
      operation: "search" as const,
      access: "read" as const,
      path: { type: "path" as const, path: root },
      source: "aialra" as const,
      reason: "Recursive glob/grep search is scoped separately from one-off file reads",
    }))
    const constraintRules = securityConstraints.file.map((rule) => ({
      id: `constraint-${rule.id}`,
      kind: "security_constraint" as const,
      operation: rule.operation,
      access: "none" as const,
      path: rule.path,
      source: rule.source,
      reason: rule.reason,
    }))
    const rules = [...entryRules, ...searchRules, ...protectedRules, ...constraintRules]
    return {
      version: "aialra.file_system_sandbox_policy.v1",
      cwd: input.cwd,
      environment_cwd: environmentCwd,
      selected_environment_id: input.selectedEnvironmentID,
      active_permission_profile: input.activePermissionProfile,
      sandbox_policy: input.sandboxPolicy,
      permission_profile: input.permissionProfile,
      readable_roots: uniqueSorted(
        rules.flatMap((rule) => (rule.access !== "none" && rule.path.type === "path" ? [rule.path.path] : [])),
      ),
      writable_roots: uniqueSorted(rules.flatMap((rule) => (rule.access === "write" && rule.path.type === "path" ? [rule.path.path] : []))),
      creatable_roots: uniqueSorted(rules.flatMap((rule) => (rule.access === "write" && rule.path.type === "path" ? [rule.path.path] : []))),
      readonly_mounts: uniqueSorted(protectedPaths),
      tmp_dirs: fsTmpDirs(input.sandboxPolicy),
      protected_paths: uniqueSorted(protectedPaths),
      deny_paths: uniqueBy(
        rules
          .filter((rule) => rule.access === "none" && rule.path.type === "path")
          .map((rule) => ({
            path: rule.path.type === "path" ? rule.path.path : "",
            operation:
              rule.operation === "read" || rule.operation === "write" || rule.operation === "read-write"
                ? rule.operation
                : ("write" as const),
            reason: rule.reason,
            source: rule.source,
          }))
          .filter((item) => item.path),
        (item) => `${item.operation}:${item.path}:${item.reason}`,
      ),
      allowed_file_schemes: ["file"],
      symlink_policy: {
        mode: "deny_workspace_escape",
        canonicalize: true,
        protected_metadata_escape: "deny",
      },
      realpath_policy: {
        read_missing_target: "use_requested_path",
        write_missing_target: "nearest_existing_parent",
      },
      create_policy: {
        parent_must_allow_write: true,
        protected_create: "deny_or_readonly_mount",
        missing_parent_resolution: "nearest_existing_parent",
      },
      delete_policy: {
        protected_paths: "deny",
        outside_writable_roots: "deny",
      },
      rules,
    }
  }

  export function defaultSecurityConstraints(cwd: string): SecurityConstraints {
    return {
      version: "aialra.security_constraints.v1",
      active: true,
      file: [
        ...[".git", ".agents", ".codex"].map((name) => ({
          id: `protected-${name.slice(1)}-metadata-write`,
          operation: "write" as const,
          path: { type: "path" as const, path: path.join(cwd, name) },
          action: "deny" as const,
          reason: `${name} 是受保护的工程元数据目录，默认禁止工具写入`,
          source: "codex" as const,
        })),
        ...[".env*", "**/.env*", "*_rsa", "**/*_rsa", "*_dsa", "**/*_dsa", "*_ed25519", "**/*_ed25519", "*.pem", "**/*.pem", "*.key", "**/*.key", "credentials.json", "**/credentials.json", ".npmrc", "**/.npmrc", ".pypirc", "**/.pypirc", ".netrc", "**/.netrc"].map(
          (pattern) => ({
            id: `secret-file-${ruleID(pattern)}`,
            operation: "read-write" as const,
            path: { type: "glob" as const, pattern },
            action: "deny" as const,
            reason: "该路径看起来像密钥、凭证或令牌文件，硬约束禁止模型读取或修改",
            source: "aialra" as const,
          }),
        ),
        ...[path.join(os.homedir(), ".ssh"), path.join(os.homedir(), ".gnupg")].map((item) => ({
          id: `home-secret-dir-${ruleID(item)}`,
          operation: "read-write" as const,
          path: { type: "path" as const, path: item },
          action: "deny" as const,
          reason: "该目录通常保存 SSH/GPG 密钥，默认禁止模型读取或修改",
          source: "aialra" as const,
        })),
        ...protectedInternalPaths().map((item) => ({
          id: item.id,
          operation: "read-write" as const,
          path: { type: "path" as const, path: item.path },
          action: "deny" as const,
          reason: item.reason,
          source: "aialra" as const,
        })),
        {
          id: "opencode-db-family",
          operation: "read-write" as const,
          path: { type: "glob" as const, pattern: path.join(Global.Path.data, "opencode-*.db") },
          action: "deny" as const,
          reason: "OpenCode 数据库分片包含会话和配置状态，默认禁止模型读取或修改",
          source: "aialra" as const,
        },
        ...protectedSystemWritePaths().map((item) => ({
          id: `system-dir-write-${ruleID(item)}`,
          operation: "write" as const,
          path: { type: "path" as const, path: item },
          action: "deny" as const,
          reason: "系统目录属于安全底线，full-access 也不能默认写入",
          source: "codex" as const,
        })),
      ],
      network: [
        {
          id: "metadata-service-network",
          target: "metadata-service",
          action: "deny",
          reason: "云服务器元数据地址可能泄露临时凭证，硬约束禁止访问",
          source: "codex",
        },
        {
          id: "loopback-network",
          target: "loopback",
          action: "deny",
          reason: "本机回环地址可能访问内部服务，除非后续显式配置，否则默认禁止",
          source: "aialra",
        },
        {
          id: "private-network",
          target: "private-network",
          action: "deny",
          reason: "内网地址可能访问非公开资源，硬约束默认禁止",
          source: "aialra",
        },
        {
          id: "unknown-domain",
          target: "unknown-domain",
          action: "ask",
          reason: "未知公网域名需要按网络策略询问或记录",
          source: "aialra",
        },
      ],
      shell: [
        {
          id: "dangerous-root-destructive-command",
          pattern: "\\b(rm\\s+-rf\\s+/|mkfs\\b|dd\\b.+\\bof=/dev/|chmod\\s+-R\\s+777\\s+/)",
          action: "deny",
          reason: "命令看起来会破坏系统根目录或块设备，硬约束直接拒绝",
          source: "codex",
        },
        {
          id: "metadata-service-shell-access",
          pattern: "169\\.254\\.169\\.254",
          action: "deny",
          reason: "命令尝试访问云元数据地址，可能泄露凭证，硬约束直接拒绝",
          source: "codex",
        },
        {
          id: "environment-network-exfiltration",
          pattern: "\\b(env|printenv|set)\\b[\\s\\S]*\\b(curl|wget|nc|netcat|scp|sftp|ftp)\\b",
          action: "deny",
          reason: "命令看起来会把环境变量发送到网络，硬约束直接拒绝",
          source: "aialra",
        },
      ],
    }
  }

  export function modelInfo(input: {
    providerID: string
    modelID: string
    variant?: string
    provider?: Provider.Info
    model?: Provider.Model
  }): ModelInfo {
    const options = input.model?.options
    const capabilities = input.model?.capabilities
    const supportsReasoning = boolOption(options, ["supportsReasoning", "reasoning"], capabilities?.reasoning ?? false)
    const supportsTools = boolOption(options, ["supportsTools", "toolcall", "tool_call"], capabilities?.toolcall ?? true)
    const providerNpm = input.model?.api.npm ?? input.provider?.options?.["npm"]
    const providerAPI = input.model?.api.url ?? input.provider?.options?.["baseURL"]
    const serviceTiers = stringArrayOption(options, [
      "serviceTiers",
      "service_tiers",
      "supportedServiceTiers",
      "supported_service_tiers",
    ])
    const defaultServiceTier = stringOption(options, ["defaultServiceTier", "default_service_tier", "serviceTier", "service_tier"])
    const serviceTierMapping = stringRecordOption(options, ["serviceTierMapping", "service_tier_mapping", "serviceTierMap"])
    return {
      version: "aialra.model_info.v1",
      provider: {
        id: input.provider?.id ?? input.providerID,
        name: input.provider?.name,
        source: input.provider?.source,
        api: typeof providerAPI === "string" ? providerAPI : undefined,
        npm: typeof providerNpm === "string" ? providerNpm : undefined,
      },
      model: {
        id: input.model?.id ?? input.modelID,
        api_id: input.model?.api.id,
        display_name: input.model?.name ?? input.modelID,
        family: input.model?.family,
        variant: input.variant,
        release_date: input.model?.release_date,
        status: input.model?.status,
      },
      limits: {
        context_length: input.model ? modelContextWindow(input.model) : undefined,
        input_tokens: input.model?.limit.input,
        output_tokens: input.model?.limit.output,
      },
      supports: {
        tools: supportsTools,
        structured_output: boolOption(
          options,
          ["supportsStructuredOutput", "structuredOutput", "structured_output", "jsonSchema", "json_schema"],
          supportsTools,
        ),
        reasoning: supportsReasoning,
        reasoning_effort:
          supportsReasoning &&
          boolOption(options, ["supportsReasoningEffort", "supports_reasoning_effort"], supportsReasoning),
        reasoning_summary:
          supportsReasoning &&
          boolOption(options, ["supportsReasoningSummary", "supports_reasoning_summary"], supportsReasoning),
        image_input: capabilities?.input.image ?? false,
        file_input: (capabilities?.attachment ?? false) || (capabilities?.input.pdf ?? false),
        streaming: boolOption(options, ["streaming", "supportsStreaming"], true),
        service_tier:
          serviceTiers.length > 0 ||
          defaultServiceTier !== undefined ||
          hasOption(options, ["serviceTier", "service_tier", "serviceTierMapping", "service_tier_mapping"]),
      },
      service_tier: {
        supported: serviceTiers.length ? serviceTiers : defaultServiceTier ? [defaultServiceTier] : [],
        mapping: serviceTierMapping,
        default: defaultServiceTier,
      },
      cost: {
        input: input.model?.cost.input,
        output: input.model?.cost.output,
        cache_read: input.model?.cost.cache.read,
        cache_write: input.model?.cost.cache.write,
        currency: "USD",
        unit: "per_million_tokens",
      },
      fallback: {
        enabled: hasOption(options, ["fallbackProviderID", "fallback_provider_id", "fallbackModelID", "fallback_model_id"]),
        providerID: stringOption(options, ["fallbackProviderID", "fallback_provider_id"]),
        modelID: stringOption(options, ["fallbackModelID", "fallback_model_id"]),
        behavior: stringOption(options, ["fallbackBehavior", "fallback_behavior"]),
      },
      provider_capabilities: {
        temperature: capabilities?.temperature ?? false,
        attachment: capabilities?.attachment ?? false,
        interleaved: capabilities?.interleaved ?? false,
        input: capabilities?.input ?? {},
        output: capabilities?.output ?? {},
        options: options ?? {},
      },
      source: input.model ? "provider_metadata" : "fallback_default",
    }
  }

  export function modelCapabilityDecisions(turn: TurnContext) {
    return {
      version: "aialra.model_capability_decisions.v1",
      requested: {
        tools: true,
        structured_output: turn.final_output_json_schema !== undefined,
        reasoning_effort: turn.effort !== undefined,
        reasoning_summary: turn.summary !== undefined,
        service_tier: turn.requested_service_tier !== undefined,
      },
      applied: {
        tools: turn.model_info.supports.tools,
        structured_output: turn.final_output_json_schema === undefined || turn.model_info.supports.structured_output,
        reasoning_effort: turn.effort === undefined || turn.model_info.supports.reasoning_effort,
        reasoning_summary: turn.summary === undefined || turn.model_info.supports.reasoning_summary,
        service_tier: turn.requested_service_tier === undefined || turn.service_tier_resolution.fallback.applied === false,
      },
      ignored: {
        tools: !turn.model_info.supports.tools,
        structured_output: turn.final_output_json_schema !== undefined && !turn.model_info.supports.structured_output,
        reasoning_effort: turn.effort !== undefined && !turn.model_info.supports.reasoning_effort,
        reasoning_summary: turn.summary !== undefined && !turn.model_info.supports.reasoning_summary,
        service_tier: turn.requested_service_tier !== undefined && turn.service_tier_resolution.fallback.applied,
      },
    }
  }

  export function supportedReasoningEfforts(model?: Provider.Model) {
    return Object.entries(model?.variants ?? {})
      .flatMap(([key, value]) => {
        const effort = variantEffort(value)
        return effort ? [effort] : [key]
      })
      .filter((value, index, all) => all.indexOf(value) === index)
      .sort((a, b) => effortRank(a) - effortRank(b) || a.localeCompare(b))
  }

  export function reasoningEffortResolution(input: {
    requested?: string
    source?: ReasoningEffortResolution["source"]
    modelInfo: ModelInfo
    model?: Provider.Model
  }): ReasoningEffortResolution {
    const supported = supportedReasoningEfforts(input.model)
    const source = input.source ?? (input.requested ? "turn_settings" : "none")
    if (!input.requested) {
      return {
        version: "aialra.reasoning_effort_resolution.v1",
        source: "none",
        supported,
        fallback: { applied: false },
      }
    }
    if (!input.modelInfo.supports.reasoning_effort) {
      return {
        version: "aialra.reasoning_effort_resolution.v1",
        requested: input.requested,
        source,
        supported,
        fallback: {
          applied: true,
          from: input.requested,
          reason: "provider metadata does not declare reasoning effort support",
        },
      }
    }
    if (supported.length === 0 || supported.includes(input.requested)) {
      return {
        version: "aialra.reasoning_effort_resolution.v1",
        requested: input.requested,
        effective: input.requested,
        source,
        supported,
        fallback: { applied: false },
      }
    }
    const requestedRank = effortRank(input.requested)
    const lower = supported.filter((effort) => effortRank(effort) <= requestedRank).at(-1)
    const effective = lower ?? supported[0]
    return {
      version: "aialra.reasoning_effort_resolution.v1",
      requested: input.requested,
      effective,
      source,
      supported,
      fallback: {
        applied: true,
        from: input.requested,
        to: effective,
        reason: `provider does not expose requested effort ${input.requested}`,
      },
    }
  }

  export function serviceTierResolution(input: {
    requested?: string
    source?: ServiceTierResolution["source"]
    modelInfo: ModelInfo
  }): ServiceTierResolution {
    const source = input.source ?? (input.requested ? "turn_settings" : "none")
    const supported = input.modelInfo.service_tier.supported
    const mapping = input.modelInfo.service_tier.mapping
    const requested = input.requested
    if (!requested) {
      return {
        version: "aialra.service_tier_resolution.v1",
        source: "none",
        supported,
        mapping,
        fallback: { applied: false },
        scheduling: serviceTierScheduling(undefined),
      }
    }
    if (!input.modelInfo.supports.service_tier) {
      return {
        version: "aialra.service_tier_resolution.v1",
        requested,
        source,
        supported,
        mapping,
        fallback: {
          applied: true,
          from: requested,
          reason: "provider metadata does not declare service tier support",
        },
        scheduling: serviceTierScheduling(undefined),
      }
    }
    const providerTier = mapping[requested] ?? requested
    if (supported.length === 0 || supported.includes(providerTier)) {
      return {
        version: "aialra.service_tier_resolution.v1",
        requested,
        effective: providerTier,
        provider_tier: providerTier,
        source,
        supported,
        mapping,
        fallback: { applied: false },
        scheduling: serviceTierScheduling(providerTier),
      }
    }
    const effective =
      supported.find((tier) => tier === "auto") ??
      supported.find((tier) => tier === "default") ??
      input.modelInfo.service_tier.default ??
      supported[0]
    return {
      version: "aialra.service_tier_resolution.v1",
      requested,
      effective,
      provider_tier: effective,
      source,
      supported,
      mapping,
      fallback: {
        applied: true,
        from: providerTier,
        to: effective,
        reason: `provider does not expose requested service tier ${providerTier}`,
      },
      scheduling: serviceTierScheduling(effective),
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
    requestedPermissionProfile?: ActivePermissionProfile
    resolvedPermissionProfile?: ActivePermissionProfile
    activePermissionProfile?: ActivePermissionProfile
    collaborationMode?: UserTurn["collaboration_mode"]
    personality?: string
    environments?: TurnEnvironment[]
    selectedEnvironmentID?: string
    platformSandbox?: PlatformSandboxCapability
    approvalsReviewer?: string | ApprovalReviewer
    modelInfo?: ModelInfo
    requestedEffort?: string
    effectiveEffort?: string
    effortResolution?: ReasoningEffortResolution
    effort?: string
    summary?: string
    reasoningSummaryPolicy?: ReasoningSummaryPolicy
    requestedServiceTier?: string
    effectiveServiceTier?: string
    serviceTierResolution?: ServiceTierResolution
    serviceTier?: string
    finalOutputJsonSchema?: unknown
    dynamicTools?: DynamicToolsResolution
    skillCatalog?: SkillCatalog
    httpContext?: TurnHttpContext
    networkPolicy?: UserTurn["network_policy"]
    networkPermissions?: NetworkPermissionPolicy
    networkSandboxPolicy?: NetworkSandboxPolicy
    networkProxy?: NetworkProxyConfig
    shellEnvironmentPolicy?: ShellEnvironmentPolicy
    commandPolicy?: UserTurn["command_policy"]
    securityConstraints?: SecurityConstraints
    fileSystemPolicy?: FileSystemSandboxPolicy
    stepBudget?: UserTurn["step_budget"]
    inputItems?: UserTurnInputItem[]
    threadSettings?: UserTurnThreadSettings
    responsesAPIClientMetadata?: Record<string, string>
    metadata?: Record<string, unknown>
    extensionData?: ExtensionData
    engineering?: UserTurn["engineering"]
  }): TurnContext {
    const permissionProfile = input.permissionProfile ?? workspacePermissionProfile(input.cwd)
    const environments = input.environments?.length ? input.environments : [{ environmentID: "default", cwd: input.cwd }]
    const selectedEnvironmentID =
      input.selectedEnvironmentID ?? (input.environments?.length ? input.environments[0]?.environmentID : undefined) ?? "default"
    const approvalPolicy = input.approvalPolicy ?? "on-request"
    const sandboxPolicy = input.sandboxPolicy ?? defaultSandboxPolicy(input.cwd)
    const activePermissionProfile = input.activePermissionProfile ?? permissionProfileDescriptor(":workspace")
    const collaborationMode = input.collaborationMode ?? { kind: "default" as const }
    const securityConstraints = input.securityConstraints ?? defaultSecurityConstraints(input.cwd)
    const platformSandbox =
      input.platformSandbox ??
      platformSandboxCapability({
        environments,
        selectedEnvironmentID,
      })
    const networkPermissions = input.networkPermissions ?? defaultNetworkPermissions(input.networkPolicy ?? "ask")
    const networkSandboxPolicyValue =
      input.networkSandboxPolicy ??
      networkSandboxPolicy({
        networkPolicy: input.networkPolicy,
        networkPermissions,
        activePermissionProfile,
        approvalPolicy,
        selectedEnvironmentID,
        networkAccess:
          sandboxPolicy.type === "workspace-write" || sandboxPolicy.type === "read-only"
            ? sandboxPolicy.network_access
            : sandboxPolicy.type === "external-sandbox"
              ? sandboxPolicy.network_access === "enabled"
              : true,
      })
    const networkProxyValue =
      input.networkProxy ??
      networkProxy({
        networkPermissions,
        selectedEnvironmentID,
      })
    const shellEnvironmentPolicy = input.shellEnvironmentPolicy ?? defaultShellEnvironmentPolicy()
    const resolvedModelInfo =
      input.modelInfo ??
      modelInfo({
        providerID: input.frame.model.providerID,
        modelID: input.frame.model.modelID,
        variant: input.frame.model.variant,
      })
    const effortResolution =
      input.effortResolution ??
      reasoningEffortResolution({
        requested: input.requestedEffort ?? input.effort,
        modelInfo: resolvedModelInfo,
      })
    const reasoningSummaryPolicy =
      input.reasoningSummaryPolicy ??
      defaultReasoningSummaryPolicy({
        summary: input.summary,
        enabled: resolvedModelInfo.supports.reasoning_summary,
        source: input.summary ? "model_options" : "default",
      })
    const serviceTierResolutionValue =
      input.serviceTierResolution ??
      serviceTierResolution({
        requested: input.requestedServiceTier ?? input.serviceTier,
        source: input.requestedServiceTier || input.serviceTier ? "turn_settings" : "none",
        modelInfo: resolvedModelInfo,
      })
    const fsPolicy =
      input.fileSystemPolicy ??
      fileSystemSandboxPolicy({
        cwd: input.cwd,
        sandboxPolicy,
        permissionProfile,
        activePermissionProfile,
        environments,
        selectedEnvironmentID,
        securityConstraints,
      })
    return {
      version: "aialra.user_turn.v1",
      turnID: input.frame.turnID,
      startedAt: input.startedAt,
      items: input.parts,
      input_items: input.inputItems ?? input.parts.flatMap(toInputItem),
      input_schema: {
        codex: "Op::UserInput",
        supported_items: ["text", "image", "local_image", "file", "skill", "mention", "subtask"],
      },
      cwd: input.cwd,
      approval_policy: approvalPolicy,
      sandbox_policy: sandboxPolicy,
      permission_profile: permissionProfile,
      requested_permission_profile: input.requestedPermissionProfile ?? activePermissionProfile,
      resolved_permission_profile: input.resolvedPermissionProfile ?? activePermissionProfile,
      active_permission_profile: activePermissionProfile,
      effective_permission_profile: effectivePermissionProfile({
        cwd: input.cwd,
        approvalPolicy,
        approvalsReviewer: approvalReviewer(input.approvalsReviewer),
        sandboxPolicy,
        permissionProfile,
        requestedPermissionProfile: input.requestedPermissionProfile ?? activePermissionProfile,
        resolvedPermissionProfile: input.resolvedPermissionProfile ?? activePermissionProfile,
        activePermissionProfile,
        environments,
        selectedEnvironmentID,
        networkPolicy: input.networkPolicy,
        networkPermissions,
        networkSandboxPolicy: networkSandboxPolicyValue,
        networkProxy: networkProxyValue,
        shellEnvironmentPolicy,
        commandPolicy: input.commandPolicy,
        securityConstraints,
        fileSystemPolicy: fsPolicy,
        platformSandbox,
      }),
      file_system_policy: fsPolicy,
      model: input.frame.model,
      model_info: resolvedModelInfo,
      requested_effort: input.requestedEffort ?? effortResolution.requested,
      effective_effort: input.effectiveEffort ?? effortResolution.effective,
      effort_resolution: effortResolution,
      approvals_reviewer: approvalReviewer(input.approvalsReviewer),
      effort: input.effort,
      summary: input.summary,
      reasoning_summary_policy: reasoningSummaryPolicy,
      requested_service_tier: input.requestedServiceTier ?? serviceTierResolutionValue.requested,
      effective_service_tier: input.effectiveServiceTier ?? serviceTierResolutionValue.effective,
      service_tier_resolution: serviceTierResolutionValue,
      service_tier: input.effectiveServiceTier ?? serviceTierResolutionValue.effective,
      final_output_json_schema: input.finalOutputJsonSchema,
      dynamic_tools:
        input.dynamicTools ??
        defaultDynamicTools({
          requested: {},
          activePermissionProfile,
          approvalPolicy,
          modelSupportsTools: resolvedModelInfo.supports.tools,
          selectedEnvironmentID,
        }),
      skill_catalog:
        input.skillCatalog ??
        defaultSkillCatalog({
          skills: [],
          agent: input.frame.agent,
          cwd: input.cwd,
          activePermissionProfile,
          approvalPolicy,
          selectedEnvironmentID,
        }),
      collaboration_mode: collaborationMode,
      personality: input.personality,
      environments,
      selected_environment_id: selectedEnvironmentID,
      http_context: input.httpContext,
      platform_sandbox: platformSandbox,
      network_policy: input.networkPolicy,
      network_permissions: networkPermissions,
      network_sandbox_policy: networkSandboxPolicyValue,
      network_proxy: networkProxyValue,
      shell_environment_policy: shellEnvironmentPolicy,
      command_policy: input.commandPolicy,
      security_constraints: securityConstraints,
      step_budget: input.stepBudget,
      thread_settings:
        input.threadSettings ??
        threadSettings({
          cwd: input.cwd,
          approvalPolicy,
          sandboxPolicy,
          permissionProfile,
          requestedPermissionProfile: input.requestedPermissionProfile ?? activePermissionProfile,
          resolvedPermissionProfile: input.resolvedPermissionProfile ?? activePermissionProfile,
          activePermissionProfile,
          approvalsReviewer: approvalReviewer(input.approvalsReviewer),
          model: input.frame.model,
          requestedEffort: input.requestedEffort ?? effortResolution.requested,
          effectiveEffort: input.effectiveEffort ?? effortResolution.effective,
          effortResolution,
          effort: input.effort,
          summary: input.summary,
          reasoningSummaryPolicy,
          requestedServiceTier: input.requestedServiceTier ?? serviceTierResolutionValue.requested,
          effectiveServiceTier: input.effectiveServiceTier ?? serviceTierResolutionValue.effective,
          serviceTierResolution: serviceTierResolutionValue,
          serviceTier: input.effectiveServiceTier ?? serviceTierResolutionValue.effective,
          dynamicTools:
            input.dynamicTools ??
            defaultDynamicTools({
              requested: {},
              activePermissionProfile,
              approvalPolicy,
              modelSupportsTools: resolvedModelInfo.supports.tools,
              selectedEnvironmentID,
            }),
          skillCatalog:
            input.skillCatalog ??
            defaultSkillCatalog({
              skills: [],
              agent: input.frame.agent,
              cwd: input.cwd,
              activePermissionProfile,
              approvalPolicy,
              selectedEnvironmentID,
            }),
          collaborationMode,
          environments,
          selectedEnvironmentID,
          platformSandbox,
          networkPolicy: input.networkPolicy,
          networkPermissions,
          networkSandboxPolicy: networkSandboxPolicyValue,
          networkProxy: networkProxyValue,
          shellEnvironmentPolicy,
          commandPolicy: input.commandPolicy,
          securityConstraints,
          fileSystemPolicy: fsPolicy,
          modelInfo: resolvedModelInfo,
        }),
      responsesapi_client_metadata: input.responsesAPIClientMetadata,
      metadata: {
        source: "opencode.prompt_input",
        route: input.frame.route,
        sessionID: input.frame.sessionID,
        messageID: input.frame.messageID,
        agent: input.frame.agent,
        noReply: input.frame.noReply,
        format: input.frame.format,
        legacyPromptStringUpgraded: true,
        ...input.metadata,
      },
      extension_data: extensionData(input.extensionData),
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
      approvals_reviewer: turn.approvals_reviewer,
      sandbox_policy: turn.sandbox_policy,
      permission_profile: turn.permission_profile,
      requested_permission_profile: turn.requested_permission_profile,
      resolved_permission_profile: turn.resolved_permission_profile,
      active_permission_profile: turn.active_permission_profile,
      effective_permission_profile: turn.effective_permission_profile,
      file_system_policy: turn.file_system_policy,
      model: turn.model,
      model_info: turn.model_info,
      requested_effort: turn.requested_effort,
      effective_effort: turn.effective_effort,
      effort_resolution: turn.effort_resolution,
      effort: turn.effort,
      summary: turn.summary,
      reasoning_summary_policy: turn.reasoning_summary_policy,
      requested_service_tier: turn.requested_service_tier,
      effective_service_tier: turn.effective_service_tier,
      service_tier_resolution: turn.service_tier_resolution,
      service_tier: turn.service_tier,
      final_output_json_schema: turn.final_output_json_schema,
      dynamic_tools: turn.dynamic_tools,
      skill_catalog: turn.skill_catalog,
      collaboration_mode: turn.collaboration_mode,
      environments: turn.environments,
      selected_environment_id: turn.selected_environment_id,
      selected_environment_cwd: environmentCwd(turn),
      input_schema: turn.input_schema,
      input_items: {
        count: turn.input_items.length,
        byType: turn.input_items.reduce<Record<string, number>>((acc, item) => {
          acc[item.type] = (acc[item.type] ?? 0) + 1
          return acc
        }, {}),
      },
      thread_settings: turn.thread_settings,
      responsesapi_client_metadata: turn.responsesapi_client_metadata,
      metadata: turn.metadata,
      extension_data_namespaces: Object.keys(turn.extension_data).sort(),
      http_context: turn.http_context,
      platform_sandbox: turn.platform_sandbox,
      network_policy: turn.network_policy,
      network_permissions: turn.network_permissions,
      network_sandbox_policy: turn.network_sandbox_policy,
      network_proxy: turn.network_proxy,
      shell_environment_policy: turn.shell_environment_policy,
      command_policy: turn.command_policy,
      security_constraints: turn.security_constraints,
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

  export function environmentCwd(turn: Pick<TurnContext, "cwd" | "environments" | "selected_environment_id">) {
    return turn.environments.find((environment) => environment.environmentID === turn.selected_environment_id)?.cwd ?? turn.cwd
  }

  export function approvalReviewer(input?: string | ApprovalReviewer): ApprovalReviewer {
    if (input && typeof input === "object") return input
    if (input === "auto_review" || input === "guardian_subagent") {
      return { role: "auto_review", id: "auto_review", label: "Auto reviewer，自动审批审查器", source: "legacy" }
    }
    if (input === "guardian") return { role: "guardian", id: "guardian", label: "Guardian，安全守护审查器", source: "config" }
    if (input === "policy_engine") {
      return { role: "policy_engine", id: "policy_engine", label: "Policy engine，策略引擎审查器", source: "config" }
    }
    if (input === "external_reviewer") {
      return {
        role: "external_reviewer",
        id: "external_reviewer",
        label: "External reviewer，外部审批审查器",
        source: "config",
      }
    }
    return { role: "user", id: "current_user", label: "User，当前用户", source: input ? "legacy" : "default" }
  }

  export function defaultReasoningSummaryPolicy(input: {
    summary?: string
    enabled?: boolean
    level?: string
    autoCollapse?: boolean
    perTurn?: boolean
    toolLinked?: boolean
    source?: ReasoningSummaryPolicy["source"]
  } = {}): ReasoningSummaryPolicy {
    const requested = input.level ?? input.summary
    const level =
      requested === "off" || requested === "disabled"
        ? "off"
        : requested === "brief" || requested === "detailed" || requested === "auto"
          ? requested
          : "auto"
    return {
      version: "aialra.reasoning_summary_policy.v1",
      enabled: input.enabled !== false && level !== "off",
      level,
      auto_collapse: input.autoCollapse ?? true,
      per_turn: input.perTurn ?? true,
      tool_linked: input.toolLinked ?? true,
      source: input.source ?? "default",
    }
  }

  export function defaultDynamicTools(input: {
    requested: Record<string, boolean>
    activePermissionProfile: ActivePermissionProfile
    approvalPolicy: ApprovalPolicy
    modelSupportsTools: boolean
    selectedEnvironmentID: string
    available?: DynamicToolStatus[]
    disabled?: DynamicToolStatus[]
  }): DynamicToolsResolution {
    const available = input.available ?? []
    const disabled = input.disabled ?? []
    return {
      version: "aialra.dynamic_tools.v1",
      requested: input.requested,
      available,
      disabled,
      available_ids: available.map((item) => item.id).toSorted((a, b) => a.localeCompare(b)),
      disabled_ids: disabled.map((item) => item.id).toSorted((a, b) => a.localeCompare(b)),
      resolver: {
        permission_profile: input.activePermissionProfile,
        approval_policy: input.approvalPolicy,
        model_supports_tools: input.modelSupportsTools,
        selected_environment_id: input.selectedEnvironmentID,
      },
    }
  }

  export function extensionData(...items: Array<ExtensionData | undefined>): ExtensionData {
    const output: ExtensionData = {}
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue
      for (const [namespace, payload] of Object.entries(item)) {
        const cleanNamespace = cleanExtensionNamespace(namespace)
        const cleanPayload = cleanExtensionPayload(payload)
        if (!cleanNamespace || !cleanPayload) continue
        output[cleanNamespace] = { ...(output[cleanNamespace] ?? {}), ...cleanPayload }
      }
    }
    return output
  }

  export function defaultSkillCatalog(input: {
    skills: Array<{
      name: string
      description?: string
      location: string
      content?: string
    }>
    disabled?: Array<{
      name: string
      description?: string
      location: string
      content?: string
      reasons: string[]
    }>
    agent: string
    cwd: string
    activePermissionProfile: ActivePermissionProfile
    approvalPolicy: ApprovalPolicy
    selectedEnvironmentID: string
  }): SkillCatalog {
    const available = input.skills.map((skill) =>
      skillCatalogItem({
        skill,
        cwd: input.cwd,
        disabledReasons: [],
      }),
    )
    const disabled = (input.disabled ?? []).map((skill) =>
      skillCatalogItem({
        skill,
        cwd: input.cwd,
        disabledReasons: skill.reasons,
      }),
    )
    const items = [...available, ...disabled]
    return {
      version: "aialra.skill_catalog.v1",
      available,
      disabled,
      available_ids: available.map((item) => item.skill_id).toSorted((a, b) => a.localeCompare(b)),
      disabled_ids: disabled.map((item) => item.skill_id).toSorted((a, b) => a.localeCompare(b)),
      injected_ids: available.filter((item) => item.prompt_injected).map((item) => item.skill_id),
      used_ids: available.filter((item) => item.used).map((item) => item.skill_id),
      resolver: {
        agent: input.agent,
        permission_profile: input.activePermissionProfile,
        approval_policy: input.approvalPolicy,
        selected_environment_id: input.selectedEnvironmentID,
      },
      resources: {
        tools: uniqueSorted(items.flatMap((item) => item.tools)),
        mcp_resources: uniqueSorted(items.flatMap((item) => item.mcp_resources)),
        commands: uniqueSorted(items.flatMap((item) => item.commands)),
        external_resources: uniqueSorted(items.flatMap((item) => item.external_resources)),
      },
    }
  }

  export function markSkillCatalogInjected(catalog: SkillCatalog): SkillCatalog {
    const available = catalog.available.map((item) => ({ ...item, prompt_injected: true }))
    return {
      ...catalog,
      available,
      injected_ids: available.map((item) => item.skill_id).toSorted((a, b) => a.localeCompare(b)),
    }
  }

  export function markSkillCatalogUsed(catalog: SkillCatalog, name: string): SkillCatalog {
    const available = catalog.available.map((item) =>
      item.name === name || item.skill_id === name
        ? { ...item, used: true, usage_count: item.usage_count + 1, prompt_injected: true }
        : item,
    )
    return {
      ...catalog,
      available,
      injected_ids: available.filter((item) => item.prompt_injected).map((item) => item.skill_id).toSorted((a, b) => a.localeCompare(b)),
      used_ids: available.filter((item) => item.used).map((item) => item.skill_id).toSorted((a, b) => a.localeCompare(b)),
      resources: {
        tools: uniqueSorted([...available, ...catalog.disabled].flatMap((item) => item.tools)),
        mcp_resources: uniqueSorted([...available, ...catalog.disabled].flatMap((item) => item.mcp_resources)),
        commands: uniqueSorted([...available, ...catalog.disabled].flatMap((item) => item.commands)),
        external_resources: uniqueSorted([...available, ...catalog.disabled].flatMap((item) => item.external_resources)),
      },
    }
  }

  export function defaultNetworkPermissions(mode: NetworkPermissionPolicy["mode"]): NetworkPermissionPolicy {
    return {
      version: "aialra.network_permissions.v1",
      mode,
      allowlist: [],
      denylist: [],
      private_network: "block",
      proxy: { enabled: false },
      tools: {},
    }
  }

  export function networkSandboxPolicy(input: {
    networkPolicy?: "off" | "on" | "ask"
    networkPermissions: NetworkPermissionPolicy
    activePermissionProfile: ActivePermissionProfile
    approvalPolicy: ApprovalPolicy
    selectedEnvironmentID: string
    networkAccess?: boolean
  }): NetworkSandboxPolicy {
    const mode = input.networkPermissions.mode ?? input.networkPolicy ?? "ask"
    const privatePolicy = input.networkPermissions.private_network
    return {
      version: "aialra.network_sandbox_policy.v1",
      mode,
      network_disabled: mode === "off",
      ask_before_access: mode === "ask",
      allowlist: input.networkPermissions.allowlist,
      denylist: input.networkPermissions.denylist,
      private_ip_policy: privatePolicy,
      localhost_policy: privatePolicy,
      metadata_service_policy: "block",
      proxy_required: input.networkPermissions.proxy.enabled,
      proxy: input.networkPermissions.proxy,
      per_tool: input.networkPermissions.tools,
      per_turn_override: {
        network_policy: input.networkPolicy,
        network_access: input.networkAccess,
      },
      dns_audit: {
        enabled: true,
        classify_private_ip: true,
        classify_localhost: true,
        classify_metadata_service: true,
      },
      http_audit: {
        enabled: true,
        classify_status: true,
        classify_non_2xx: true,
      },
      active_permission_profile: input.activePermissionProfile,
      approval_policy: input.approvalPolicy,
      selected_environment_id: input.selectedEnvironmentID,
    }
  }

  export function networkProxy(input: {
    networkPermissions: NetworkPermissionPolicy
    selectedEnvironmentID: string
  }): NetworkProxyConfig {
    const proxy = input.networkPermissions.proxy
    return {
      version: "aialra.network_proxy.v1",
      enabled: proxy.enabled,
      required: proxy.enabled,
      ...(proxy.url ? { url: proxy.url } : {}),
      no_proxy: [],
      source: "network_permissions",
      enforcement: !proxy.enabled ? "disabled" : proxy.url ? "environment" : "unavailable",
      per_environment: {
        [input.selectedEnvironmentID]: {
          enabled: proxy.enabled,
          required: proxy.enabled,
          ...(proxy.url ? { url: proxy.url } : {}),
          no_proxy: [],
        },
      },
      audit: {
        enabled: true,
        dns: true,
        http: true,
        redact_headers: ["authorization", "cookie", "proxy-authorization"],
      },
    }
  }

  export function defaultShellEnvironmentPolicy(): ShellEnvironmentPolicy {
    return {
      version: "aialra.shell_environment_policy.v1",
      mode: "clear",
      allowlist: ["PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TERM", "TMPDIR"],
      denylist: [
        "*_API_KEY",
        "*_TOKEN",
        "*_SECRET",
        "*_PASSWORD",
        "OPENAI_API_KEY",
        "ANTHROPIC_API_KEY",
        "GITHUB_TOKEN",
        "GITLAB_TOKEN",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_SESSION_TOKEN",
        "SSH_AUTH_SOCK",
      ],
      redact: ["*_API_KEY", "*_TOKEN", "*_SECRET", "*_PASSWORD", "SSH_AUTH_SOCK"],
      overrides: {},
      safe_defaults: true,
      per_environment: {},
    }
  }

  export function platformSandboxCapability(input: {
    environments: TurnEnvironment[]
    selectedEnvironmentID: string
  }): PlatformSandboxCapability {
    const environment = input.environments.find((item) => item.environmentID === input.selectedEnvironmentID)
    const target = environment?.platform ?? process.platform
    if (target === "linux") {
      return {
        version: "aialra.platform_sandbox_capability.v1",
        host_platform: process.platform,
        target_platform: target,
        selected_environment_id: input.selectedEnvironmentID,
        status: "ready",
        supported: true,
        backend: "linux-bwrap-landlock-seccomp",
        enforcement: "runtime",
        codex_parity: {
          windows_restricted_token: "not_applicable",
          macos_seatbelt: "not_applicable",
          linux_seccomp_landlock: "ready",
        },
        fallbacks: ["TurnSandbox user-space gates", "Codex exec-server fallback audit"],
        risk_controls: ["bwrap", "Landlock helper", "no_new_privs", "seccomp", "protected-create", "approval policy"],
      }
    }
    if (target === "win32") {
      return {
        version: "aialra.platform_sandbox_capability.v1",
        host_platform: process.platform,
        target_platform: target,
        selected_environment_id: input.selectedEnvironmentID,
        status: "unsupported",
        supported: false,
        backend: "windows-unsupported",
        enforcement: "unsupported",
        warning: "Windows sandbox，Windows 沙箱，在 AIALRA Node/Bun 执行器中尚未接入；高风险权限必须依赖审批和用户态门禁",
        codex_parity: {
          windows_restricted_token: "unsupported",
          macos_seatbelt: "not_applicable",
          linux_seccomp_landlock: "not_applicable",
        },
        fallbacks: ["TurnContext permission gates", "approval policy", "public event audit"],
        risk_controls: ["full-access requires explicit approval", "protected paths remain guarded", "network policy remains audited"],
      }
    }
    if (target === "darwin") {
      return {
        version: "aialra.platform_sandbox_capability.v1",
        host_platform: process.platform,
        target_platform: target,
        selected_environment_id: input.selectedEnvironmentID,
        status: "unsupported",
        supported: false,
        backend: "macos-unsupported",
        enforcement: "unsupported",
        warning: "macOS seatbelt，macOS 沙箱，在本阶段尚未接入 AIALRA",
        codex_parity: {
          windows_restricted_token: "not_applicable",
          macos_seatbelt: "unsupported",
          linux_seccomp_landlock: "not_applicable",
        },
        fallbacks: ["TurnContext permission gates", "approval policy", "public event audit"],
        risk_controls: ["protected paths remain guarded", "network policy remains audited"],
      }
    }
    return {
      version: "aialra.platform_sandbox_capability.v1",
      host_platform: process.platform,
      target_platform: target,
      selected_environment_id: input.selectedEnvironmentID,
      status: "degraded",
      supported: false,
      backend: "none",
      enforcement: "degraded",
      warning: `Unknown target platform，未知目标平台: ${target}`,
      codex_parity: {
        windows_restricted_token: "not_applicable",
        macos_seatbelt: "not_applicable",
        linux_seccomp_landlock: "degraded",
      },
      fallbacks: ["TurnContext permission gates", "approval policy", "public event audit"],
      risk_controls: ["protected paths remain guarded", "network policy remains audited"],
    }
  }

  export function effectivePermissionProfile(input: {
    cwd: string
    approvalPolicy: ApprovalPolicy
    approvalsReviewer?: ApprovalReviewer
    sandboxPolicy: SandboxPolicy
    permissionProfile: PermissionProfile
    requestedPermissionProfile?: ActivePermissionProfile
    resolvedPermissionProfile?: ActivePermissionProfile
    activePermissionProfile: ActivePermissionProfile
    environments: TurnEnvironment[]
    selectedEnvironmentID: string
    networkPolicy?: "off" | "on" | "ask"
    networkPermissions: NetworkPermissionPolicy
    networkSandboxPolicy: NetworkSandboxPolicy
    networkProxy: NetworkProxyConfig
    shellEnvironmentPolicy: ShellEnvironmentPolicy
    commandPolicy?: "ask" | "workspace" | "all" | "read" | "disabled"
    securityConstraints: SecurityConstraints
    fileSystemPolicy: FileSystemSandboxPolicy
    platformSandbox?: PlatformSandboxCapability
  }): EffectivePermissionProfile {
    const platformSandbox =
      input.platformSandbox ??
      platformSandboxCapability({
        environments: input.environments,
        selectedEnvironmentID: input.selectedEnvironmentID,
      })
    return {
      version: "aialra.effective_permission_profile.v1",
      cwd: input.cwd,
      environment_cwd:
        input.environments.find((environment) => environment.environmentID === input.selectedEnvironmentID)?.cwd ?? input.cwd,
      selected_environment_id: input.selectedEnvironmentID,
      requested_permission_profile: input.requestedPermissionProfile,
      resolved_permission_profile: input.resolvedPermissionProfile,
      active_permission_profile: input.activePermissionProfile,
      permission_profile: input.permissionProfile,
      sandbox_policy: input.sandboxPolicy,
      approval_policy: input.approvalPolicy,
      approvals_reviewer: input.approvalsReviewer,
      command_policy: input.commandPolicy,
      network_policy: input.networkPolicy,
      network_permissions: input.networkPermissions,
      network_sandbox_policy: input.networkSandboxPolicy,
      network_proxy: input.networkProxy,
      shell_environment_policy: input.shellEnvironmentPolicy,
      security_constraints: input.securityConstraints,
      file_system_policy: input.fileSystemPolicy,
      platform_sandbox: platformSandbox,
      capabilities: uniqueSorted([...(input.activePermissionProfile.capabilities ?? []), ...platformSandbox.risk_controls]),
      restrictions: uniqueSorted([
        ...(input.activePermissionProfile.restrictions ?? []),
        ...(!platformSandbox.supported ? [`platform_sandbox_unsupported:${platformSandbox.target_platform}`] : []),
      ]),
    }
  }
}

function toInputItem(part: MessageV2.Part): UserTurnInputItem[] {
  if (part.type === "text") {
    return [
      {
        type: "text",
        text: part.text,
        text_elements: [],
        metadata: {
          partID: part.id,
          synthetic: part.synthetic === true,
          ignored: part.ignored === true,
          ...(part.metadata ? { partMetadata: part.metadata } : {}),
        },
      },
    ]
  }
  if (part.type === "file") {
    const sourcePath = part.source && "path" in part.source ? part.source.path : undefined
    return [
      {
        type: part.mime.startsWith("image/") ? "image" : "file",
        ...(part.mime.startsWith("image/")
          ? { image_url: part.url }
          : { mime: part.mime, filename: part.filename, url: part.url, source: part.source }),
        metadata: {
          partID: part.id,
          sourcePath,
        },
      } as UserTurnInputItem,
    ]
  }
  if (part.type === "agent") {
    return [{ type: "mention", name: part.name, path: `agent://${part.name}`, metadata: { partID: part.id, source: part.source } }]
  }
  if (part.type === "subtask") {
    return [
      {
        type: "subtask",
        prompt: part.prompt,
        description: part.description,
        agent: part.agent,
        command: part.command,
        metadata: { partID: part.id, model: part.model },
      },
    ]
  }
  return []
}

function threadSettings(input: {
  cwd: string
  approvalPolicy: ApprovalPolicy
  sandboxPolicy: SandboxPolicy
  permissionProfile: PermissionProfile
  requestedPermissionProfile?: ActivePermissionProfile
  resolvedPermissionProfile?: ActivePermissionProfile
  activePermissionProfile: ActivePermissionProfile
  approvalsReviewer?: ApprovalReviewer
  model: UserTurn["model"]
  modelInfo: ModelInfo
  requestedEffort?: string
  effectiveEffort?: string
  effortResolution: ReasoningEffortResolution
  effort?: string
  summary?: string
  reasoningSummaryPolicy: ReasoningSummaryPolicy
  requestedServiceTier?: string
  effectiveServiceTier?: string
  serviceTierResolution: ServiceTierResolution
  serviceTier?: string
  dynamicTools: DynamicToolsResolution
  skillCatalog: SkillCatalog
  collaborationMode: UserTurn["collaboration_mode"]
  environments: TurnEnvironment[]
  selectedEnvironmentID: string
  platformSandbox?: PlatformSandboxCapability
  networkPolicy?: UserTurn["network_policy"]
  networkPermissions?: NetworkPermissionPolicy
  networkSandboxPolicy?: NetworkSandboxPolicy
  networkProxy?: NetworkProxyConfig
  shellEnvironmentPolicy?: ShellEnvironmentPolicy
  commandPolicy?: UserTurn["command_policy"]
  securityConstraints?: SecurityConstraints
  fileSystemPolicy?: FileSystemSandboxPolicy
}): UserTurnThreadSettings {
  const networkPermissions = input.networkPermissions ?? CodexTurn.defaultNetworkPermissions(input.networkPolicy ?? "ask")
  const networkSandboxPolicy =
    input.networkSandboxPolicy ??
    CodexTurn.networkSandboxPolicy({
      networkPolicy: input.networkPolicy,
      networkPermissions,
      activePermissionProfile: input.activePermissionProfile,
      approvalPolicy: input.approvalPolicy,
      selectedEnvironmentID: input.selectedEnvironmentID,
    })
  const shellEnvironmentPolicy = input.shellEnvironmentPolicy ?? CodexTurn.defaultShellEnvironmentPolicy()
  const networkProxy =
    input.networkProxy ??
    CodexTurn.networkProxy({
      networkPermissions,
      selectedEnvironmentID: input.selectedEnvironmentID,
    })
  const securityConstraints = input.securityConstraints ?? CodexTurn.defaultSecurityConstraints(input.cwd)
  const fileSystemPolicy =
    input.fileSystemPolicy ??
    CodexTurn.fileSystemSandboxPolicy({
      cwd: input.cwd,
      sandboxPolicy: input.sandboxPolicy,
      permissionProfile: input.permissionProfile,
      activePermissionProfile: input.activePermissionProfile,
      environments: input.environments,
      selectedEnvironmentID: input.selectedEnvironmentID,
      securityConstraints,
    })
  const effective = {
    cwd: input.cwd,
    approval_policy: input.approvalPolicy,
    sandbox_policy: input.sandboxPolicy,
    permission_profile: input.permissionProfile,
    requested_permission_profile: input.requestedPermissionProfile,
    resolved_permission_profile: input.resolvedPermissionProfile,
    active_permission_profile: input.activePermissionProfile,
    approvals_reviewer: input.approvalsReviewer,
    model: input.model,
    model_info: input.modelInfo,
    requested_effort: input.requestedEffort,
    effective_effort: input.effectiveEffort,
    effort_resolution: input.effortResolution,
    effort: input.effort,
    summary: input.summary,
    reasoning_summary_policy: input.reasoningSummaryPolicy,
    requested_service_tier: input.requestedServiceTier,
    effective_service_tier: input.effectiveServiceTier,
    service_tier_resolution: input.serviceTierResolution,
    service_tier: input.serviceTier,
    dynamic_tools: input.dynamicTools,
    skill_catalog: input.skillCatalog,
    collaboration_mode: input.collaborationMode,
    environments: input.environments,
    selected_environment_id: input.selectedEnvironmentID,
    platform_sandbox:
      input.platformSandbox ??
      CodexTurn.platformSandboxCapability({
        environments: input.environments,
        selectedEnvironmentID: input.selectedEnvironmentID,
      }),
    network_policy: input.networkPolicy,
    network_permissions: networkPermissions,
    network_sandbox_policy: networkSandboxPolicy,
    network_proxy: networkProxy,
    shell_environment_policy: shellEnvironmentPolicy,
    command_policy: input.commandPolicy,
    security_constraints: securityConstraints,
    file_system_policy: fileSystemPolicy,
    effective_permission_profile: CodexTurn.effectivePermissionProfile({
      cwd: input.cwd,
      approvalPolicy: input.approvalPolicy,
      sandboxPolicy: input.sandboxPolicy,
      permissionProfile: input.permissionProfile,
      requestedPermissionProfile: input.requestedPermissionProfile,
      resolvedPermissionProfile: input.resolvedPermissionProfile,
      activePermissionProfile: input.activePermissionProfile,
      approvalsReviewer: input.approvalsReviewer,
      environments: input.environments,
      selectedEnvironmentID: input.selectedEnvironmentID,
      networkPolicy: input.networkPolicy,
      networkPermissions,
      networkSandboxPolicy,
      networkProxy,
      shellEnvironmentPolicy,
      commandPolicy: input.commandPolicy,
      securityConstraints,
      fileSystemPolicy,
      platformSandbox: input.platformSandbox,
    }),
  }
  return {
    requested: {},
    resolved: effective,
    effective,
  }
}

import { For, Show, createEffect, createMemo } from "solid-js"
import type { JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

type SecurityConfig = {
  sessionID: string
  permissionProfileID: ":read-only" | ":workspace" | ":danger-full-access" | "external" | "disabled"
  approvalPolicy: "never" | "on-request" | "on-failure" | "untrusted"
  networkPolicy: "off" | "on" | "ask"
  commandPolicy: "ask" | "workspace" | "all" | "read" | "disabled"
  networkAccess: boolean
  executorBackend: "codex" | "node-bun"
  environmentID: string
  cwd: string
  remoteEnvironmentSupported: boolean
  remoteEnvironmentStatus: string
  runtimeProof?: RuntimeProof
  stepBudgetEnabled: boolean
  stepBudgetMaxSteps: number
  engineering: EngineeringControls
}

type RuntimeProof = {
  version: "aialra.sandbox_control_runtime_proof.v1"
  active_permission_profile_id: string
  active_permission_profile_kind?: string
  cwd: string
  environment_id: string
  environment_cwd: string
  approval_policy: string
  approvals_reviewer: string
  command_policy: string
  executor_backend: string
  file_system?: {
    enforced?: boolean
    mode?: string
    writable_roots?: string[]
    readable_roots?: string[]
    protected_paths?: string[]
    symlink_escape_protected?: boolean
  }
  network?: {
    policy?: string
    access?: string
    sandbox_mode?: string
    disabled?: boolean
    private_ip_policy?: string
    localhost_policy?: string
    proxy_required?: boolean
    proxy_enabled?: boolean
  }
  shell_environment?: {
    mode?: string
    sensitive_env_redacted?: string[]
    allowlist?: string[]
    denylist?: string[]
  }
  live_effect?: {
    applies_to_next_turn?: boolean
    applies_to_next_tool_gate?: boolean
    in_flight_model_requests_not_rewritten?: boolean
    in_flight_processes_not_rewritten?: boolean
  }
}

type EngineeringControls = {
  mode: "fast" | "balanced" | "deep" | "long"
  advancedEnabled: boolean
  verificationRounds: number
  localizeToolMax: number
  repeatedToolWarning: number
  repeatedToolCheckpoint: number
  repeatedToolStop: number
  noProgressMinutes: number
  patchMaxFiles: number
  patchMaxBytes: number
  testOutputMaxBytes: number
  zeroPatchRecoveryMax: number
  totalToolCallsMax: number
  singleCommandTimeoutMs: number
  longRun: boolean
}

type SecurityPatch = Partial<
  Pick<
    SecurityConfig,
    | "permissionProfileID"
    | "approvalPolicy"
    | "networkPolicy"
    | "commandPolicy"
    | "networkAccess"
    | "executorBackend"
    | "stepBudgetEnabled"
    | "stepBudgetMaxSteps"
  >
> & { engineering?: Partial<EngineeringControls> }

const defaults: SecurityPatch = {
  permissionProfileID: ":workspace",
  approvalPolicy: "on-request",
  networkPolicy: "ask",
  commandPolicy: "ask",
  executorBackend: "codex",
  stepBudgetEnabled: false,
  stepBudgetMaxSteps: 80,
  engineering: {
    mode: "balanced",
    advancedEnabled: false,
  },
}

const engineeringModeOptions: Array<{
  value: EngineeringControls["mode"]
  label: string
  description: string
}> = [
  { value: "fast", label: "快速", description: "少读少试，适合小 bug 和小改动" },
  { value: "balanced", label: "平衡", description: "默认推荐，速度和质量折中，适合普通工程任务" },
  { value: "deep", label: "深度", description: "允许更多定位和验证，适合复杂 bug" },
  { value: "long", label: "长跑", description: "不轻易中止，只在明确重复空转时提醒，适合大型重构和疑难问题" },
]

const profileOptions: Array<{
  value: SecurityConfig["permissionProfileID"]
  label: string
  description: string
}> = [
  { value: ":read-only", label: "只读模式", description: "只能看文件和搜索，不能改文件，不能执行写入命令" },
  { value: ":workspace", label: "工作区可写", description: "可以修改当前项目，不能写项目外文件" },
  { value: ":danger-full-access", label: "完全访问", description: "放开更多本机访问能力，危险操作仍可要求审批" },
  { value: "external", label: "外部权限托管", description: "权限由外部系统决定，本机只记录和转交" },
  { value: "disabled", label: "关闭内置门禁", description: "不使用本机内置权限门禁，适合外部系统接管权限，不等于禁用工具" },
]

const approvalOptions: Array<{
  value: SecurityConfig["approvalPolicy"]
  label: string
  description: string
}> = [
  { value: "never", label: "永不询问，危险操作直接拒绝", description: "适合自动化任务，任何需要人工确认的动作都会直接失败" },
  { value: "on-request", label: "需要时询问", description: "适合人工监督，工具明确需要批准时会弹出审批" },
  { value: "on-failure", label: "失败后询问", description: "先尝试安全路径，失败后允许请求更高权限" },
  { value: "untrusted", label: "不可信操作询问", description: "普通安全动作直接执行，不可信或高风险动作先问你" },
]

const networkOptions: Array<{
  value: SecurityConfig["networkPolicy"]
  label: string
  description: string
}> = [
  { value: "ask", label: "每次询问", description: "默认选项，检测到 curl、npm install、git clone 等网络命令时先问你" },
  { value: "off", label: "关闭网络", description: "命令运行时不能访问外网，网络命令会被沙箱隔离" },
  { value: "on", label: "允许网络", description: "命令可以访问网络，所有开关变更都会进入审计事件" },
] as const

const commandOptions: Array<{
  value: SecurityConfig["commandPolicy"]
  label: string
  description: string
}> = [
  { value: "ask", label: "每次询问", description: "默认选项，每次 bash 命令执行前都先问你" },
  { value: "read", label: "允许只读命令", description: "切到只读档位，写文件和写入类命令会被拒绝" },
  { value: "workspace", label: "允许工作区命令", description: "切到工作区可写档位，命令只能影响当前项目" },
  { value: "all", label: "允许全部命令", description: "切到完全访问档位，仍会记录审计" },
  { value: "disabled", label: "交给外部门禁", description: "切到关闭内置门禁档位，权限由外部系统接管" },
] as const

const executorOptions: Array<{
  value: SecurityConfig["executorBackend"]
  label: string
  description: string
}> = [
  { value: "codex", label: "Codex 执行服务", description: "优先让 Codex 风格 sidecar 接管 bash 和文件操作" },
  { value: "node-bun", label: "OpenCode 旧执行器", description: "兼容回退路径，如果 Codex 执行服务不可用会自动回退到这里" },
]

function authHeaders(server: ReturnType<typeof useServer>["current"]) {
  const headers: Record<string, string> = {}
  if (!server?.http.password) return headers
  headers.Authorization = `Basic ${authTokenFromCredentials({
    username: server.http.username,
    password: server.http.password,
  })}`
  return headers
}

function optionDescription<T extends string>(items: ReadonlyArray<{ value: T; description: string }>, value: T | undefined) {
  return items.find((item) => item.value === value)?.description ?? ""
}

function currentNetworkValue(config: SecurityConfig | undefined) {
  return config?.networkPolicy ?? "ask"
}

function currentCommandValue(config: SecurityConfig | undefined) {
  return config?.commandPolicy ?? "ask"
}

function SelectField<T extends string>(props: {
  label: string
  detail?: string
  value: T | undefined
  options: ReadonlyArray<{ value: T; label: string; description?: string }>
  disabled?: boolean
  onChange: (value: T) => void
}) {
  return (
    <label class="block">
      <div class="mb-1 flex items-center justify-between gap-2">
        <span class="text-11-medium text-text-strong">{props.label}</span>
      </div>
      <select
        class="h-8 w-full rounded-md border border-border-weaker-base bg-surface-panel px-2 text-12-regular text-text-base outline-none focus:border-border-strong"
        value={props.value}
        disabled={props.disabled}
        title={props.detail ?? `${props.label}，选择后会写入沙盒控制中心配置`}
        onInput={(event) => props.onChange(event.currentTarget.value as T)}
      >
        <For each={props.options}>
          {(item) => (
            <option value={item.value} title={item.description}>
              {item.label}
            </option>
          )}
        </For>
      </select>
      <Show when={props.detail}>
        {(detail) => <div class="mt-1 text-11-regular text-text-weak leading-4">{detail()}</div>}
      </Show>
    </label>
  )
}

function NumberField(props: {
  label: string
  value: number | undefined
  min: number
  max: number
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <label class="block rounded-md border border-border-weaker-base bg-background-base px-2 py-2">
      <span class="block text-12-medium text-text-strong">{props.label}</span>
      <input
        class="mt-2 h-8 w-full rounded-md border border-border-weaker-base bg-surface-panel px-2 text-12-regular text-text-base outline-none focus:border-border-strong disabled:opacity-60"
        type="number"
        min={props.min}
        max={props.max}
        value={props.value ?? props.min}
        disabled={props.disabled}
        onChange={(event) => props.onChange(Number(event.currentTarget.value))}
      />
    </label>
  )
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="border-b border-border-weaker-base px-3 py-3 last:border-b-0">
      <div class="mb-3 text-12-medium text-text-strong">{props.title}</div>
      {props.children}
    </section>
  )
}

export function SandboxControlPanel(props: { sessionID: string | undefined; active: boolean }) {
  const layout = useLayout()
  const sdk = useSDK()
  const server = useServer()
  const platform = usePlatform()
  const [store, setStore] = createStore({
    config: undefined as SecurityConfig | undefined,
    loading: false,
    saving: undefined as string | undefined,
    error: undefined as string | undefined,
  })

  const securityURL = () => {
    if (!props.sessionID) return
    const url = new URL(`/session/${props.sessionID}/security`, sdk.url)
    url.searchParams.set("directory", sdk.directory)
    return url
  }

  const fetchSecurity = async () => {
    const url = securityURL()
    if (!url) return
    setStore("loading", true)
    setStore("error", undefined)
    try {
      const response = await (platform.fetch ?? fetch)(url, {
        headers: authHeaders(server.current),
      })
      if (!response.ok) throw new Error(`安全配置加载失败：HTTP ${response.status}`)
      setStore("config", (await response.json()) as SecurityConfig)
    } catch (error) {
      setStore("error", error instanceof Error ? error.message : String(error))
    } finally {
      setStore("loading", false)
    }
  }

  const updateSecurity = async (label: string, patch: SecurityPatch) => {
    const url = securityURL()
    if (!url) return
    setStore("saving", label)
    setStore("error", undefined)
    try {
      const response = await (platform.fetch ?? fetch)(url, {
        method: "PATCH",
        headers: {
          ...authHeaders(server.current),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patch),
      })
      if (!response.ok) throw new Error(`安全配置保存失败：HTTP ${response.status}`)
      setStore("config", (await response.json()) as SecurityConfig)
    } catch (error) {
      setStore("error", error instanceof Error ? error.message : String(error))
    } finally {
      setStore("saving", undefined)
    }
  }

  const updateEngineering = (patch: Partial<EngineeringControls>) =>
    updateSecurity("engineering", {
      engineering: patch,
    })

  createEffect(() => {
    if (!props.active || !props.sessionID) return
    void fetchSecurity()
  })

  const config = () => store.config
  const network = createMemo(() => currentNetworkValue(config()))
  const command = createMemo(() => currentCommandValue(config()))
  const engineering = createMemo(() => config()?.engineering)
  const proof = createMemo(() => config()?.runtimeProof)
  const busy = () => store.loading || store.saving !== undefined

  return (
    <div
      id="sandbox-control-panel"
      class="h-full flex flex-col overflow-hidden bg-background-stronger border-l border-border-weaker-base"
      style={{ width: `${layout.sandboxControl.width()}px` }}
    >
      <div class="h-10 shrink-0 px-3 flex items-center justify-between border-b border-border-weaker-base">
        <div class="min-w-0">
          <div class="text-12-medium text-text-strong leading-4">沙盒控制中心</div>
          <div class="text-11-regular text-text-weak leading-3 truncate">
            {store.loading ? "正在读取安全配置" : "控制权限、网络、审批和执行器"}
          </div>
        </div>
        <div class="flex items-center gap-1">
          <Tooltip value="刷新安全配置">
            <IconButton
              icon="reset"
              variant="ghost"
              class="h-6 w-6"
              onClick={() => void fetchSecurity()}
              aria-label="刷新安全配置"
            />
          </Tooltip>
          <Tooltip value="关闭沙盒控制中心">
            <IconButton
              icon="close-small"
              variant="ghost"
              class="h-6 w-6"
              onClick={() => layout.sandboxControl.close()}
              aria-label="关闭沙盒控制中心"
            />
          </Tooltip>
        </div>
      </div>

      <Show when={store.error}>
        {(error) => (
          <div class="mx-3 mt-3 rounded-md border border-border-warning-base bg-surface-warning-weak px-2 py-1 text-11-regular text-text-warning">
            {error()}
          </div>
        )}
      </Show>

      <ScrollView class="flex-1 min-h-0" data-scrollable>
        <div class="flex flex-col">
          <Section title="工程控制">
            <SelectField
              label="工程模式"
              value={engineering()?.mode}
              disabled={busy()}
              options={engineeringModeOptions}
              detail={optionDescription(engineeringModeOptions, engineering()?.mode)}
              onChange={(value) => void updateEngineering({ mode: value })}
            />
            <div class="mt-2 rounded-md border border-border-weaker-base bg-background-base px-2 py-2 text-11-regular text-text-weak leading-4">
              当前模式会写进下一轮 TurnContext，回合上下文，也会影响正在运行回合的下一次工具门禁
              已经发出去的模型请求和已经启动的长命令不会被中途改写
            </div>
            <label class="mt-2 flex items-center justify-between gap-3 rounded-md border border-border-weaker-base bg-background-base px-2 py-2">
              <span>
                <span class="block text-12-medium text-text-strong">高级工程参数</span>
                <span class="block text-11-regular text-text-weak">普通用户只选模式即可，打开后可以微调验证轮数和循环阈值</span>
              </span>
              <input
                type="checkbox"
                checked={engineering()?.advancedEnabled ?? false}
                disabled={busy()}
                title={engineering()?.advancedEnabled ? "关闭高级工程参数" : "打开高级工程参数"}
                onChange={(event) => void updateEngineering({ advancedEnabled: event.currentTarget.checked })}
              />
            </label>
            <Show when={engineering()?.advancedEnabled}>
              <div class="mt-2 grid gap-2">
                <NumberField
                  label="最大验证轮数"
                  value={engineering()?.verificationRounds}
                  min={0}
                  max={50}
                  disabled={busy()}
                  onChange={(value) => void updateEngineering({ verificationRounds: value })}
                />
                <NumberField
                  label="零补丁恢复次数"
                  value={engineering()?.zeroPatchRecoveryMax}
                  min={0}
                  max={50}
                  disabled={busy()}
                  onChange={(value) => void updateEngineering({ zeroPatchRecoveryMax: value })}
                />
                <NumberField
                  label="定位工具预算"
                  value={engineering()?.localizeToolMax}
                  min={1}
                  max={1000}
                  disabled={busy()}
                  onChange={(value) => void updateEngineering({ localizeToolMax: value })}
                />
                <NumberField
                  label="重复工具预警阈值"
                  value={engineering()?.repeatedToolWarning}
                  min={1}
                  max={1000}
                  disabled={busy()}
                  onChange={(value) => void updateEngineering({ repeatedToolWarning: value })}
                />
                <NumberField
                  label="重复工具检查点阈值"
                  value={engineering()?.repeatedToolCheckpoint}
                  min={1}
                  max={1000}
                  disabled={busy()}
                  onChange={(value) => void updateEngineering({ repeatedToolCheckpoint: value })}
                />
                <NumberField
                  label="重复工具阻止阈值"
                  value={engineering()?.repeatedToolStop}
                  min={0}
                  max={10000}
                  disabled={busy()}
                  onChange={(value) => void updateEngineering({ repeatedToolStop: value })}
                />
                <NumberField
                  label="工具调用总上限"
                  value={engineering()?.totalToolCallsMax}
                  min={0}
                  max={100000}
                  disabled={busy()}
                  onChange={(value) => void updateEngineering({ totalToolCallsMax: value })}
                />
                <NumberField
                  label="单条命令最长毫秒"
                  value={engineering()?.singleCommandTimeoutMs}
                  min={1000}
                  max={86400000}
                  disabled={busy()}
                  onChange={(value) => void updateEngineering({ singleCommandTimeoutMs: value })}
                />
              </div>
            </Show>
          </Section>

          <Section title="执行权限">
            <SelectField
              label="权限档位"
              value={config()?.permissionProfileID}
              disabled={busy()}
              options={profileOptions}
              detail={optionDescription(profileOptions, config()?.permissionProfileID)}
              onChange={(value) => void updateSecurity("permissionProfileID", { permissionProfileID: value })}
            />
            <div class="mt-3">
              <SelectField
                label="审批策略"
                value={config()?.approvalPolicy}
                disabled={busy()}
                options={approvalOptions}
                detail={optionDescription(approvalOptions, config()?.approvalPolicy)}
                onChange={(value) => void updateSecurity("approvalPolicy", { approvalPolicy: value })}
              />
            </div>
          </Section>

          <Section title="文件访问范围">
            <div class="grid gap-2 text-11-regular text-text-weak leading-4">
              <div>
                <span class="text-text-strong">当前工作目录：</span>
                <span class="break-all">{config()?.cwd ?? "未记录"}</span>
              </div>
              <div>
                <span class="text-text-strong">可写范围：</span>
                {config()?.permissionProfileID === ":danger-full-access"
                  ? "完全访问模式下放开更多本机路径"
                  : config()?.permissionProfileID === ":read-only"
                    ? "只读模式不允许写入"
                    : "当前工作区"}
              </div>
              <div>
                <span class="text-text-strong">受保护目录：</span>
                .git / .agents / .codex
              </div>
            </div>
          </Section>

          <Section title="实际生效证明">
            <Show
              when={proof()}
              fallback={
                <div class="rounded-md border border-border-weaker-base bg-background-base px-2 py-2 text-11-regular text-text-weak">
                  后端暂未返回生效证明，请刷新安全配置
                </div>
              }
            >
              {(runtimeProof) => (
                <div class="grid gap-2 text-11-regular text-text-weak leading-4">
                  <div class="rounded-md border border-border-weaker-base bg-background-base px-2 py-2">
                    <div class="text-12-medium text-text-strong">当前后端 active 值</div>
                    <div class="mt-1">
                      权限：{runtimeProof().active_permission_profile_id}
                      <Show when={runtimeProof().active_permission_profile_kind}>
                        {(kind) => <>，类型：{kind()}</>}
                      </Show>
                    </div>
                    <div>环境：{runtimeProof().environment_id}，目录：{runtimeProof().environment_cwd}</div>
                    <div>审批：{runtimeProof().approval_policy}，审批者：{runtimeProof().approvals_reviewer}</div>
                    <div>命令：{runtimeProof().command_policy}，执行器：{runtimeProof().executor_backend}</div>
                  </div>
                  <div class="rounded-md border border-border-weaker-base bg-background-base px-2 py-2">
                    <div class="text-12-medium text-text-strong">文件和网络门禁</div>
                    <div>
                      文件门禁：
                      {runtimeProof().file_system?.enforced ? "已启用" : "未启用"}，模式：
                      {runtimeProof().file_system?.mode ?? "未知"}
                    </div>
                    <div>
                      可写根目录：
                      {(runtimeProof().file_system?.writable_roots ?? []).length > 0
                        ? runtimeProof().file_system?.writable_roots?.join("、")
                        : "无"}
                    </div>
                    <div>
                      受保护路径：
                      {(runtimeProof().file_system?.protected_paths ?? []).length > 0
                        ? runtimeProof().file_system?.protected_paths?.join("、")
                        : "无"}
                    </div>
                    <div>
                      网络：{runtimeProof().network?.access ?? "未知"}，沙箱模式：
                      {runtimeProof().network?.sandbox_mode ?? "未知"}，代理：
                      {runtimeProof().network?.proxy_enabled ? "已启用" : "未启用"}
                    </div>
                  </div>
                  <div class="rounded-md border border-border-weaker-base bg-background-base px-2 py-2">
                    <div class="text-12-medium text-text-strong">实时生效边界</div>
                    <div>下一轮对话：{runtimeProof().live_effect?.applies_to_next_turn ? "会生效" : "未确认"}</div>
                    <div>下一次工具门禁：{runtimeProof().live_effect?.applies_to_next_tool_gate ? "会生效" : "未确认"}</div>
                    <div>
                      已发出的模型请求：
                      {runtimeProof().live_effect?.in_flight_model_requests_not_rewritten ? "不会被中途改写" : "未确认"}
                    </div>
                    <div>
                      已启动的长命令：
                      {runtimeProof().live_effect?.in_flight_processes_not_rewritten ? "不会被中途改写" : "未确认"}
                    </div>
                  </div>
                </div>
              )}
            </Show>
          </Section>

          <Section title="网络与命令">
            <SelectField
              label="网络访问"
              value={network()}
              disabled={busy()}
              options={networkOptions}
              detail={optionDescription(networkOptions, network())}
              onChange={(value) => void updateSecurity("networkPolicy", { networkPolicy: value })}
            />
            <div class="mt-3">
              <SelectField
                label="命令执行"
                value={command()}
                disabled={busy()}
                options={commandOptions}
                detail={optionDescription(commandOptions, command())}
                onChange={(value) => {
                  void updateSecurity("commandPolicy", { commandPolicy: value })
                }}
              />
            </div>
          </Section>

          <Section title="生效范围与步骤上限">
            <div class="rounded-md border border-border-weaker-base bg-background-base px-2 py-2">
              <div class="text-12-medium text-text-strong">实时生效范围</div>
              <div class="mt-1 text-11-regular text-text-weak leading-4">
                降低权限会影响正在运行回合的下一次工具门禁
                提高权限会记录审计，并从下一次工具门禁开始生效
                已经启动的 bash 命令、docker build、模型请求不会被这个开关中途改写
              </div>
            </div>
            <label class="mt-2 flex items-center justify-between gap-3 rounded-md border border-border-weaker-base bg-background-base px-2 py-2">
              <span>
                <span class="block text-12-medium text-text-strong">限制模型工具循环</span>
                <span class="block text-11-regular text-text-weak">默认关闭，开启后超过设置步数会停止本轮，避免弱模型无限重复调用工具</span>
              </span>
              <input
                type="checkbox"
                checked={config()?.stepBudgetEnabled ?? false}
                disabled={busy()}
                onInput={(event) => void updateSecurity("stepBudgetEnabled", { stepBudgetEnabled: event.currentTarget.checked })}
              />
            </label>
            <label class="mt-2 block rounded-md border border-border-weaker-base bg-background-base px-2 py-2">
              <span class="block text-12-medium text-text-strong">最大工具步数</span>
              <input
                class="mt-2 h-8 w-full rounded-md border border-border-weaker-base bg-surface-panel px-2 text-12-regular text-text-base outline-none focus:border-border-strong disabled:opacity-60"
                type="number"
                min="1"
                max="10000"
                value={config()?.stepBudgetMaxSteps ?? 80}
                disabled={busy() || !(config()?.stepBudgetEnabled ?? false)}
                onChange={(event) =>
                  void updateSecurity("stepBudgetMaxSteps", {
                    stepBudgetMaxSteps: Number(event.currentTarget.value),
                  })
                }
              />
              <span class="mt-1 block text-11-regular text-text-weak">只在上面的开关开启时生效</span>
            </label>
            <div class="mt-2 flex gap-2">
              <Button
                variant="secondary"
                size="small"
                class="h-7 flex-1"
                disabled={busy()}
                onClick={() => void updateSecurity("defaults", defaults)}
              >
                恢复默认
              </Button>
              <Button
                variant="ghost"
                size="small"
                class="h-7 flex-1"
                disabled
                title="默认配置持久化需要后端默认档案表，当前先不伪装成已完成"
              >
                设为默认
              </Button>
            </div>
          </Section>
        </div>
      </ScrollView>

      <div onPointerDown={(event) => event.stopPropagation()}>
        <ResizeHandle
          direction="horizontal"
          edge="start"
          size={layout.sandboxControl.width()}
          min={320}
          max={680}
          onResize={(width) => layout.sandboxControl.resize(width)}
        />
      </div>
    </div>
  )
}

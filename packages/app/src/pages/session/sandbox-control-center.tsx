import { For, Show, createEffect, createMemo } from "solid-js"
import type { JSX } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
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
  networkAccess: boolean
  executorBackend: "codex" | "node-bun"
  environmentID: string
  cwd: string
  remoteEnvironmentSupported: boolean
  remoteEnvironmentStatus: string
}

type SecurityPatch = Partial<Pick<SecurityConfig, "permissionProfileID" | "approvalPolicy" | "networkAccess" | "executorBackend">>

const defaults: SecurityPatch = {
  permissionProfileID: ":workspace",
  approvalPolicy: "on-request",
  networkAccess: false,
  executorBackend: "codex",
}

const profileOptions: Array<{
  value: SecurityConfig["permissionProfileID"]
  label: string
  description: string
}> = [
  { value: ":read-only", label: "只读模式", description: "只能看文件和搜索，不能改文件，不能执行写入命令。" },
  { value: ":workspace", label: "工作区可写", description: "可以修改当前项目，不能写项目外文件。" },
  { value: ":danger-full-access", label: "完全访问", description: "放开更多本机访问能力，危险操作仍可要求审批。" },
  { value: "external", label: "外部权限托管", description: "权限由外部系统决定，本机只记录和转交。" },
  { value: "disabled", label: "禁用工具", description: "不允许 agent 使用本机工具。" },
]

const approvalOptions: Array<{
  value: SecurityConfig["approvalPolicy"]
  label: string
  description: string
}> = [
  { value: "never", label: "永不询问，危险操作直接拒绝", description: "适合自动化任务，任何需要人工确认的动作都会直接失败。" },
  { value: "on-request", label: "需要时询问", description: "适合人工监督，工具明确需要批准时会弹出审批。" },
  { value: "on-failure", label: "失败后询问", description: "先尝试安全路径，失败后允许请求更高权限。" },
  { value: "untrusted", label: "不可信操作询问", description: "普通安全动作直接执行，不可信或高风险动作先问你。" },
]

const networkOptions = [
  { value: "off", label: "关闭网络", description: "默认选项。命令运行时不能访问外网。", access: false },
  { value: "https", label: "允许常规 HTTPS", description: "当前 Linux 执行底座按“允许网络”执行，后续会细分 HTTPS 白名单。", access: true },
  { value: "all", label: "允许全部网络", description: "命令可以访问网络，所有开关变更都会进入审计事件。", access: true },
  { value: "ask", label: "每次询问", description: "当前会按关闭网络执行；后续接入网络审批人后逐次询问。", access: false },
] as const

const commandOptions = [
  { value: "disabled", label: "禁止命令", description: "通过禁用工具档位实现，bash 不会执行。" },
  { value: "read", label: "允许只读命令", description: "当前由只读权限档位近似执行，写入类命令会被拒绝。" },
  { value: "workspace", label: "允许工作区命令", description: "当前工作区可写档位，命令只能影响当前项目。" },
  { value: "all", label: "允许全部命令", description: "当前完全访问档位，仍会记录审计。" },
  { value: "ask", label: "每次询问", description: "当前配合“需要时询问”审批策略使用。" },
] as const

const executorOptions: Array<{
  value: SecurityConfig["executorBackend"]
  label: string
  description: string
}> = [
  { value: "codex", label: "Codex 执行服务", description: "优先让 Codex 风格 sidecar 接管 bash 和文件操作。" },
  { value: "node-bun", label: "OpenCode 旧执行器", description: "兼容回退路径；如果 Codex 执行服务不可用会自动回退到这里。" },
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
  return config?.networkAccess ? "all" : "off"
}

function currentCommandValue(config: SecurityConfig | undefined) {
  if (!config) return "workspace"
  if (config.permissionProfileID === "disabled") return "disabled"
  if (config.permissionProfileID === ":read-only") return "read"
  if (config.permissionProfileID === ":danger-full-access") return "all"
  if (config.approvalPolicy === "on-request") return "ask"
  return "workspace"
}

function SelectField<T extends string>(props: {
  label: string
  detail?: string
  value: T | undefined
  options: ReadonlyArray<{ value: T; label: string }>
  disabled?: boolean
  onChange: (value: T) => void
}) {
  return (
    <label class="block">
      <div class="mb-1 flex items-center justify-between gap-2">
        <span class="text-11-medium text-text-strong">{props.label}</span>
      </div>
      <select
        class="h-8 w-full rounded-md border border-border-weaker-base bg-background-base px-2 text-12-regular text-text-base outline-none focus:border-border-strong"
        value={props.value}
        disabled={props.disabled}
        onInput={(event) => props.onChange(event.currentTarget.value as T)}
      >
        <For each={props.options}>{(item) => <option value={item.value}>{item.label}</option>}</For>
      </select>
      <Show when={props.detail}>
        {(detail) => <div class="mt-1 text-11-regular text-text-weak leading-4">{detail()}</div>}
      </Show>
    </label>
  )
}

function Section(props: { title: string; children: JSX.Element }) {
  return (
    <section class="rounded-md border border-border-weaker-base bg-background-base p-3">
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
    advanced: false,
    turnOnly: true,
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

  createEffect(() => {
    if (!props.active || !props.sessionID) return
    void fetchSecurity()
  })

  const config = () => store.config
  const network = createMemo(() => currentNetworkValue(config()))
  const command = createMemo(() => currentCommandValue(config()))
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
            <Show when={config()} fallback={store.loading ? "正在读取安全配置" : "等待安全配置"}>
              {(item) => `当前目录：${item().cwd}`}
            </Show>
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
        <div class="p-3 flex flex-col gap-3">
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

          <Section title="网络与命令">
            <SelectField
              label="网络访问"
              value={network()}
              disabled={busy()}
              options={networkOptions}
              detail={optionDescription(networkOptions, network())}
              onChange={(value) => {
                const option = networkOptions.find((item) => item.value === value)
                void updateSecurity("networkAccess", { networkAccess: option?.access ?? false })
              }}
            />
            <div class="mt-3">
              <SelectField
                label="命令执行"
                value={command()}
                disabled={busy()}
                options={commandOptions}
                detail={optionDescription(commandOptions, command())}
                onChange={(value) => {
                  if (value === "disabled") void updateSecurity("permissionProfileID", { permissionProfileID: "disabled" })
                  if (value === "read") void updateSecurity("permissionProfileID", { permissionProfileID: ":read-only" })
                  if (value === "workspace") void updateSecurity("permissionProfileID", { permissionProfileID: ":workspace" })
                  if (value === "all") void updateSecurity("permissionProfileID", { permissionProfileID: ":danger-full-access" })
                  if (value === "ask") void updateSecurity("approvalPolicy", { approvalPolicy: "on-request" })
                }}
              />
            </div>
          </Section>

          <Section title="本轮覆盖">
            <label class="flex items-center justify-between gap-3 rounded-md border border-border-weaker-base bg-surface-panel px-2 py-2">
              <span>
                <span class="block text-12-medium text-text-strong">只对本轮生效</span>
                <span class="block text-11-regular text-text-weak">当前版本会影响本会话后续回合；真正单回合覆盖已列入下一批后端工作。</span>
              </span>
              <input
                type="checkbox"
                checked={store.turnOnly}
                onInput={(event) => setStore("turnOnly", event.currentTarget.checked)}
              />
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

          <Section title="审计">
            <div class="text-11-regular text-text-weak leading-4">
              每次修改都会写入公共事件流，事件名是 sandbox.control.changed。回合检查器可以看到“谁改了什么、改前是什么、改后是什么”。
            </div>
          </Section>

          <button
            type="button"
            class="rounded-md border border-border-weaker-base bg-background-base px-3 py-2 text-left hover:bg-surface-panel"
            onClick={() => setStore("advanced", !store.advanced)}
          >
            <div class="flex items-center justify-between gap-2 text-12-medium text-text-strong">
              <span>高级详情</span>
              <Icon name={store.advanced ? "chevron-down" : "chevron-right"} size="small" />
            </div>
            <Show when={store.advanced}>
              <div class="mt-2 grid gap-1 text-11-regular text-text-weak leading-4">
                <div>执行后端：Codex 执行服务用于贴近 Codex 的进程和文件访问控制；OpenCode 旧执行器用于兼容回退。</div>
                <div>Landlock（Linux 内核文件限制）：当前仍在执行器底座收敛中，不在这里伪装成全量可控开关。</div>
                <div>bwrap（Linux 进程隔离）：bash 命令会按本轮网络和写入策略进入沙箱。</div>
              </div>
            </Show>
          </button>
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

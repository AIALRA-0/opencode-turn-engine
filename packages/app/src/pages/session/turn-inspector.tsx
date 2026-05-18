import { For, Match, Show, Switch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon, type IconProps } from "@opencode-ai/ui/icon"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { ResizeHandle } from "@opencode-ai/ui/resize-handle"
import { ScrollView } from "@opencode-ai/ui/scroll-view"
import { Tooltip } from "@opencode-ai/ui/tooltip"
import { useLayout } from "@/context/layout"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useServer } from "@/context/server"
import { authTokenFromCredentials } from "@/utils/server"

export type PublicEvent = {
  schema: "aialra.public_event.v1"
  id: string
  sequence: number
  ts: string
  type: string
  severity: "info" | "warning" | "error"
  sessionID?: string
  turnID?: string
  messageID?: string
  toolCallID?: string
  title: string
  summary?: string
  status?: string
  data: Record<string, unknown>
  rawRef?: {
    id: string
    eventID: string
    encrypted: boolean
    persisted: boolean
  }
}

type Filter = "all" | "error" | "tool" | "file" | "command" | "approval"

type EventSection = {
  key: string
  turnID?: string
  events: PublicEvent[]
}

const filterLabels: Record<Filter, string> = {
  all: "全部",
  error: "错误",
  tool: "工具",
  file: "文件",
  command: "命令",
  approval: "审批",
}

const typeLabels: Record<string, string> = {
  "audit.encryption.unavailable": "审计加密不可用",
  "turn.input.received": "收到用户输入",
  "turn.context.created": "创建回合上下文",
  "turn.started": "回合开始",
  "turn.completed": "回合完成",
  "turn.aborted": "回合中断",
  "model.request.started": "开始请求模型",
  "model.stream.started": "模型流开始",
  "model.retrying": "模型重试",
  "model.request.finished": "模型请求结束",
  "tool.call.started": "工具开始执行",
  "tool.call.finished": "工具执行结束",
  "tool.sandbox.checked": "沙箱检查通过",
  "tool.sandbox.denied": "沙箱拒绝访问",
  "file.read": "读取文件",
  "file.write": "写入文件",
  "command.started": "命令开始",
  "command.output": "命令输出",
  "command.finished": "命令结束",
  "approval.requested": "请求审批",
  "approval.resolved": "审批完成",
  "final.output": "最终输出",
}

const statusLabels: Record<string, string> = {
  received: "已收到",
  created: "已创建",
  started: "已开始",
  completed: "已完成",
  aborted: "已中断",
  interrupted: "已打断",
  replaced: "已替换",
  review_ended: "评审结束",
  budget_limited: "预算耗尽",
  retrying: "重试中",
  error: "错误",
  failed: "失败",
  finished: "已结束",
  denied: "已拒绝",
  checked: "已检查",
  requested: "等待审批",
  resolved: "已处理",
  once: "允许一次",
  always: "总是允许",
  reject: "已拒绝",
  output: "输出",
  warning: "警告",
}

const typeGroup = (type: string): Filter | "turn" | "model" | "final" => {
  if (type.startsWith("tool.")) return "tool"
  if (type.startsWith("file.")) return "file"
  if (type.startsWith("command.")) return "command"
  if (type.startsWith("approval.")) return "approval"
  if (type.startsWith("model.")) return "model"
  if (type.startsWith("final.")) return "final"
  return "turn"
}

const groupIcon = (event: PublicEvent): IconProps["name"] => {
  const group = typeGroup(event.type)
  if (event.severity === "error") return "warning"
  if (group === "command") return "terminal"
  if (group === "file") return "file-tree"
  if (group === "approval") return "shield"
  if (group === "tool") return "code"
  if (group === "model") return "brain"
  if (group === "final") return "check-small"
  return "status"
}

const formatTime = (ts: string) => {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

const shortID = (value: string | undefined) => {
  if (!value) return "无回合"
  if (value.length <= 14) return value
  return `${value.slice(0, 10)}...${value.slice(-4)}`
}

const textValue = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined)

const numberValue = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

function localizedTitle(event: PublicEvent) {
  return typeLabels[event.type] ?? event.title ?? event.type
}

function localizedStatus(status: string | undefined) {
  if (!status) return undefined
  return statusLabels[status] ?? status
}

function localizedSummary(event: PublicEvent) {
  const data = event.data ?? {}
  const status = localizedStatus(event.status)
  const path = textValue(data.path) ?? textValue(data.filePath) ?? textValue(data.file_path)
  const tool = textValue(data.tool)
  const command = textValue(data.command)
  const cwd = textValue(data.cwd)
  const model = textValue(data.model) ?? textValue(data.modelID)
  const provider = textValue(data.providerID)
  const reason = textValue(data.reason)
  const reply = localizedStatus(textValue(data.reply))
  const outputChars = numberValue(data.outputChars)
  const durationMs = numberValue(data.durationMs)
  const message = textValue(data.message)

  switch (event.type) {
    case "turn.input.received":
      return `用户请求已进入本轮执行${status ? `，状态：${status}` : ""}`
    case "turn.context.created":
      return `本轮目录：${cwd ?? "未记录"}${model ? `，模型：${model}` : ""}`
    case "turn.started":
      return `本轮开始执行${cwd ? `，目录：${cwd}` : ""}`
    case "turn.completed":
      return `本轮正常收尾${durationMs !== undefined ? `，耗时 ${durationMs} ms` : ""}`
    case "turn.aborted":
      return `本轮被中断${reason ? `，原因：${localizedStatus(reason) ?? reason}` : ""}`
    case "model.request.started":
      return `模型请求已发出${provider || model ? `：${[provider, model].filter(Boolean).join("/")}` : ""}`
    case "model.stream.started":
      return "模型开始返回流式内容"
    case "model.retrying":
      return `模型调用正在重试${message ? `：${message}` : ""}`
    case "model.request.finished":
      return event.severity === "error" ? "模型请求以错误收尾" : "模型请求已结束"
    case "tool.call.started":
      return `工具开始执行${tool ? `：${tool}` : ""}`
    case "tool.call.finished":
      return `工具执行结束${tool ? `：${tool}` : ""}${status ? `，状态：${status}` : ""}`
    case "tool.sandbox.checked":
      return `沙箱允许本次访问${path ? `：${path}` : ""}`
    case "tool.sandbox.denied":
      return `沙箱拒绝本次访问${reason ? `：${reason}` : path ? `：${path}` : ""}`
    case "file.read":
      return `读取文件${path ? `：${path}` : ""}${outputChars !== undefined ? `，输出 ${outputChars} 字符` : ""}`
    case "file.write":
      return `${event.severity === "error" ? "写入失败" : "写入文件"}${path ? `：${path}` : ""}`
    case "command.started":
      return `开始执行命令${command ? `：${command}` : ""}`
    case "command.output":
      return `命令产生输出${outputChars !== undefined ? `，${outputChars} 字符` : ""}`
    case "command.finished":
      return `命令执行结束${command ? `：${command}` : ""}`
    case "approval.requested":
      return `等待用户审批${tool ? `：${tool}` : ""}`
    case "approval.resolved":
      return `审批已处理${reply ? `：${reply}` : ""}`
    case "final.output":
      return "最终回复已更新"
    case "audit.encryption.unavailable":
      return "缺少审计加密密钥，原始内容只能短期保留在内存里"
    default:
      return event.summary || event.type
  }
}

function sseEvents(text: string) {
  const out: unknown[] = []
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split(/\n/)
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
      .join("\n")
    if (!data.trim()) continue
    try {
      out.push(JSON.parse(data))
    } catch {
      continue
    }
  }
  return out
}

function authHeaders(server: ReturnType<typeof useServer>["current"]) {
  const headers: Record<string, string> = {}
  if (!server?.http.password) return headers
  headers.Authorization = `Basic ${authTokenFromCredentials({
    username: server.http.username,
    password: server.http.password,
  })}`
  return headers
}

export function TurnInspectorPanel(props: { sessionID: string | undefined; active: boolean }) {
  const layout = useLayout()
  const sdk = useSDK()
  const server = useServer()
  const platform = usePlatform()
  const [store, setStore] = createStore({
    events: [] as PublicEvent[],
    raw: {} as Record<string, { loading?: boolean; error?: string; value?: unknown } | undefined>,
    filter: "all" as Filter,
    connected: false,
    error: undefined as string | undefined,
  })
  const [pinnedToBottom, setPinnedToBottom] = createSignal(true)
  let viewportRef: HTMLDivElement | undefined

  const events = createMemo(() => {
    const filter = store.filter
    if (filter === "all") return store.events
    if (filter === "error") return store.events.filter((event) => event.severity === "error")
    return store.events.filter((event) => typeGroup(event.type) === filter)
  })

  const eventSections = createMemo<EventSection[]>(() => {
    const sections: EventSection[] = []
    for (const event of events()) {
      const key = event.turnID ?? "global"
      const last = sections[sections.length - 1]
      if (last && last.key === key) {
        last.events.push(event)
        continue
      }
      sections.push({ key, turnID: event.turnID, events: [event] })
    }
    return sections
  })

  const updatePinnedToBottom = () => {
    const viewport = viewportRef
    if (!viewport) return
    const distance = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight
    setPinnedToBottom(distance < 48)
  }

  const scrollToBottom = () => {
    const viewport = viewportRef
    if (!viewport) return
    viewport.scrollTop = viewport.scrollHeight
  }

  createEffect(() => {
    const count = events().length
    if (!count || !pinnedToBottom()) return
    requestAnimationFrame(scrollToBottom)
  })

  createEffect(() => {
    const sessionID = props.sessionID
    const active = props.active
    if (!sessionID || !active) return

    const abort = new AbortController()
    let stopped = false
    let lastID: string | undefined

    const url = new URL(`/session/${sessionID}/events/public`, sdk.url)
    url.searchParams.set("directory", sdk.directory)

    const connect = async () => {
      while (!stopped && !abort.signal.aborted) {
        try {
          setStore("error", undefined)
          const headers: Record<string, string> = {
            Accept: "text/event-stream",
            ...authHeaders(server.current),
          }
          if (lastID) headers["Last-Event-ID"] = lastID
          const response = await (platform.fetch ?? fetch)(url, { signal: abort.signal, headers })
          if (!response.ok || !response.body) throw new Error(`公共事件流连接失败：HTTP ${response.status}`)
          setStore("connected", true)
          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""
          while (!stopped && !abort.signal.aborted) {
            const result = await reader.read()
            if (result.done) break
            buffer += decoder.decode(result.value, { stream: true })
            const cut = buffer.lastIndexOf("\n\n")
            if (cut === -1) continue
            const ready = buffer.slice(0, cut + 2)
            buffer = buffer.slice(cut + 2)
            for (const item of sseEvents(ready)) {
              if (!item || typeof item !== "object") continue
              const event = item as PublicEvent
              if (event.schema !== "aialra.public_event.v1") continue
              lastID = event.id
              setStore(
                "events",
                produce((draft) => {
                  const index = draft.findIndex((x) => x.id === event.id)
                  if (index >= 0) draft[index] = event
                  else draft.push(event)
                  if (draft.length > 1000) draft.splice(0, draft.length - 1000)
                }),
              )
            }
          }
        } catch (error) {
          if (abort.signal.aborted || stopped) return
          setStore("connected", false)
          setStore("error", error instanceof Error ? error.message : String(error))
          await new Promise((resolve) => setTimeout(resolve, 800))
        }
      }
    }

    void connect()
    onCleanup(() => {
      stopped = true
      abort.abort()
      setStore("connected", false)
    })
  })

  const loadRaw = async (event: PublicEvent) => {
    if (!props.sessionID || !event.rawRef) return
    const current = store.raw[event.id]
    if (current?.loading || current?.value !== undefined) return
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 12_000)
    setStore("raw", event.id, { loading: true })
    try {
      const url = new URL(`/session/${props.sessionID}/events/${event.id}/raw`, sdk.url)
      url.searchParams.set("directory", sdk.directory)
      const response = await (platform.fetch ?? fetch)(url, {
        headers: authHeaders(server.current),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`原始内容加载失败：HTTP ${response.status}`)
      const payload = await response.json()
      setStore("raw", event.id, { value: payload.raw })
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "原始内容加载超时，请稍后重试。"
          : error instanceof Error
            ? error.message
            : String(error)
      setStore("raw", event.id, { error: message })
    } finally {
      window.clearTimeout(timeout)
    }
  }

  const clearRaw = (eventID: string) => {
    setStore("raw", eventID, undefined)
  }

  return (
    <div
      id="turn-inspector-panel"
      class="h-full flex flex-col overflow-hidden bg-background-stronger border-l border-border-weaker-base"
      style={{ width: `${layout.turnInspector.width()}px` }}
    >
      <div class="h-10 shrink-0 px-3 flex items-center justify-between border-b border-border-weaker-base">
        <div class="min-w-0">
          <div class="text-12-medium text-text-strong leading-4">回合检查器</div>
          <div class="text-11-regular text-text-weak leading-3 truncate">
            <Show when={store.connected} fallback={store.error ? `连接异常：${store.error}` : "等待事件"}>
              正在接收公共事件流
            </Show>
          </div>
        </div>
        <Tooltip value="关闭回合检查器">
          <IconButton
            icon="close-small"
            variant="ghost"
            class="h-6 w-6"
            onClick={() => layout.turnInspector.close()}
            aria-label="关闭回合检查器"
          />
        </Tooltip>
      </div>

      <div class="shrink-0 px-2 py-2 flex flex-wrap gap-1 border-b border-border-weaker-base">
        <For each={Object.keys(filterLabels) as Filter[]}>
          {(filter) => (
            <Button
              variant={store.filter === filter ? "primary" : "ghost"}
              size="small"
              class="h-6 px-2 text-11-regular"
              onClick={() => setStore("filter", filter)}
            >
              {filterLabels[filter]}
            </Button>
          )}
        </For>
      </div>

      <div class="relative flex-1 min-h-0">
        <ScrollView
          class="h-full"
          data-scrollable
          viewportRef={(el) => {
            viewportRef = el
            updatePinnedToBottom()
          }}
          onScroll={updatePinnedToBottom}
        >
          <div class="px-2 py-2">
            <Show
              when={events().length > 0}
              fallback={
                <div class="h-40 flex items-center justify-center text-center text-12-regular text-text-weak">
                  这个会话还没有公共事件。
                </div>
              }
            >
              <div class="flex flex-col gap-3">
                <For each={eventSections()}>
                  {(section) => (
                    <div class="flex flex-col gap-1">
                      <div class="px-1 pt-1 flex items-center gap-2 text-10-regular text-text-muted">
                        <div class="h-px flex-1 bg-border-weaker-base" />
                        <span class="shrink-0">{section.turnID ? `回合 ${shortID(section.turnID)}` : "全局事件"}</span>
                        <span class="shrink-0">{section.events.length} 条</span>
                        <div class="h-px flex-1 bg-border-weaker-base" />
                      </div>
                      <For each={section.events}>
                        {(event) => {
                          const raw = () => store.raw[event.id]
                          return (
                            <div class="group rounded-md border border-transparent hover:border-border-weaker-base hover:bg-surface-panel transition-colors">
                              <div class="px-2 py-2 flex items-start gap-2">
                                <div
                                  class="mt-0.5 size-5 shrink-0 rounded flex items-center justify-center"
                                  classList={{
                                    "bg-surface-critical-weak text-text-on-critical-weak": event.severity === "error",
                                    "bg-surface-warning-weak text-text-on-warning-base": event.severity === "warning",
                                    "bg-surface-weak text-icon-weak": event.severity === "info",
                                  }}
                                >
                                  <Icon name={groupIcon(event)} size="small" />
                                </div>
                                <div class="min-w-0 flex-1">
                                  <div class="flex items-center gap-2 min-w-0">
                                    <div class="text-12-medium text-text-strong truncate">{localizedTitle(event)}</div>
                                    <div class="text-10-regular text-text-muted shrink-0">{formatTime(event.ts)}</div>
                                  </div>
                                  <div class="mt-0.5 text-11-regular text-text-weak truncate">
                                    {localizedSummary(event)}
                                  </div>
                                  <div class="mt-1 flex flex-wrap gap-1 text-10-regular text-text-muted">
                                    <span>{event.type}</span>
                                    <Show when={event.status}>
                                      {(status) => <span>{localizedStatus(status())}</span>}
                                    </Show>
                                    <Show when={event.toolCallID}>
                                      <span>{event.toolCallID}</span>
                                    </Show>
                                  </div>
                                </div>
                                <Show when={event.rawRef}>
                                  <Button
                                    variant="ghost"
                                    size="small"
                                    class="h-6 px-2 opacity-0 group-hover:opacity-100 focus:opacity-100"
                                    onClick={() =>
                                      raw()?.value !== undefined || raw()?.error
                                        ? clearRaw(event.id)
                                        : void loadRaw(event)
                                    }
                                  >
                                    {raw()?.value !== undefined || raw()?.error ? "收起" : "原始"}
                                  </Button>
                                </Show>
                              </div>
                              <Show when={raw()}>
                                {(state) => (
                                  <div class="px-2 pb-2">
                                    <Switch>
                                      <Match when={state().loading}>
                                        <div class="text-11-regular text-text-weak px-2 py-1">正在加载原始内容...</div>
                                      </Match>
                                      <Match when={state().error}>
                                        <div class="text-11-regular text-text-on-critical-weak px-2 py-1">{state().error}</div>
                                      </Match>
                                      <Match when={state().value !== undefined}>
                                        <pre class="max-h-72 overflow-auto rounded bg-background-base border border-border-weaker-base p-2 text-10-regular text-text-base whitespace-pre-wrap break-words">
                                          {JSON.stringify(state().value, null, 2)}
                                        </pre>
                                      </Match>
                                    </Switch>
                                  </div>
                                )}
                              </Show>
                            </div>
                          )
                        }}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </ScrollView>
        <div onPointerDown={(event) => event.stopPropagation()}>
          <ResizeHandle
            direction="horizontal"
            edge="start"
            size={layout.turnInspector.width()}
            min={280}
            max={640}
            onResize={(width) => layout.turnInspector.resize(width)}
          />
        </div>
      </div>
    </div>
  )
}

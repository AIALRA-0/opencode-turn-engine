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

const filterLabels: Record<Filter, string> = {
  all: "All",
  error: "Errors",
  tool: "Tools",
  file: "Files",
  command: "Commands",
  approval: "Approvals",
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

  const events = createMemo(() => {
    const filter = store.filter
    if (filter === "all") return store.events
    if (filter === "error") return store.events.filter((event) => event.severity === "error")
    return store.events.filter((event) => typeGroup(event.type) === filter)
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
          if (!response.ok || !response.body) throw new Error(`public event stream failed: ${response.status}`)
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
    if (current?.loading || current?.value) return
    setStore("raw", event.id, { loading: true })
    try {
      const url = new URL(`/session/${props.sessionID}/events/${event.id}/raw`, sdk.url)
      url.searchParams.set("directory", sdk.directory)
      const response = await (platform.fetch ?? fetch)(url, { headers: authHeaders(server.current) })
      if (!response.ok) throw new Error(`raw payload failed: ${response.status}`)
      const payload = await response.json()
      setStore("raw", event.id, { value: payload.raw })
    } catch (error) {
      setStore("raw", event.id, { error: error instanceof Error ? error.message : String(error) })
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
          <div class="text-12-medium text-text-strong leading-4">Turn Inspector</div>
          <div class="text-11-regular text-text-weak leading-3 truncate">
            <Show when={store.connected} fallback={store.error ?? "Waiting for events"}>
              Live public event stream
            </Show>
          </div>
        </div>
        <Tooltip value="Close Turn Inspector">
          <IconButton
            icon="close-small"
            variant="ghost"
            class="h-6 w-6"
            onClick={() => layout.turnInspector.close()}
            aria-label="Close Turn Inspector"
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
        <ScrollView class="h-full" data-scrollable>
          <div class="px-2 py-2">
            <Show
              when={events().length > 0}
              fallback={
                <div class="h-40 flex items-center justify-center text-center text-12-regular text-text-weak">
                  No public events for this session yet.
                </div>
              }
            >
              <div class="flex flex-col gap-1">
                <For each={events()}>
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
                              <div class="text-12-medium text-text-strong truncate">{event.title}</div>
                              <div class="text-10-regular text-text-muted shrink-0">{formatTime(event.ts)}</div>
                            </div>
                            <div class="mt-0.5 text-11-regular text-text-weak truncate">{event.summary || event.type}</div>
                            <div class="mt-1 flex flex-wrap gap-1 text-10-regular text-text-muted">
                              <span>{event.type}</span>
                              <Show when={event.status}>
                                <span>{event.status}</span>
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
                              onClick={() => (raw()?.value || raw()?.error ? clearRaw(event.id) : void loadRaw(event))}
                            >
                              {raw()?.value || raw()?.error ? "Hide" : "Raw"}
                            </Button>
                          </Show>
                        </div>
                        <Show when={raw()}>
                          {(state) => (
                            <div class="px-2 pb-2">
                              <Switch>
                                <Match when={state().loading}>
                                  <div class="text-11-regular text-text-weak px-2 py-1">Loading raw payload...</div>
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

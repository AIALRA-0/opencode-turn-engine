import { authTokenFromCredentials } from "@/utils/server"

export type PublicEventLike = {
  id?: string
  schema?: string
  type: string
  turnID?: string
  sessionID?: string
  severity?: string
  data?: Record<string, unknown>
}

export type SessionReactivityAction = {
  refreshMessages: boolean
  refreshDiff: boolean
  refreshVcs: boolean
  refreshStatus: boolean
  refreshTodos: boolean
}

export const emptySessionReactivityAction = {
  refreshMessages: false,
  refreshDiff: false,
  refreshVcs: false,
  refreshStatus: false,
  refreshTodos: false,
} satisfies SessionReactivityAction

const messageEvents = new Set([
  "approval.requested",
  "approval.resolved",
  "command.output",
  "command.finished",
  "exec_command.output",
  "exec_command.output_delta",
  "exec_command.end",
  "exec_command.finished",
  "final.output",
  "item.lifecycle.aborted",
  "item.lifecycle.completed",
  "item.lifecycle.failed",
  "item.lifecycle.started",
  "model.raw.chunk",
  "model.raw.item",
  "model.request.finished",
  "prompt.effective.resolved",
  "reasoning.raw.item",
  "runtime.item.received",
  "runtime.item.settled",
  "tool.call.finished",
  "tool.call.started",
  "turn.aborted",
  "turn.completed",
  "turn.terminal.assistant_error",
  "turn.terminal.reconciled",
])

const diffEvents = new Set([
  "command.finished",
  "exec_command.end",
  "exec_command.finished",
  "file.write",
  "tool.call.finished",
  "turn.completed",
  "turn.terminal.reconciled",
])

const statusEvents = new Set([
  "model.request.finished",
  "model.request.started",
  "model.retrying",
  "turn.aborted",
  "turn.completed",
  "turn.started",
  "turn.terminal.assistant_error",
  "turn.terminal.reconciled",
])

export function publicEventCursorKey(sessionID: string, scope: "inspector" | "reactivity" = "inspector") {
  return scope === "inspector"
    ? `aialra.public-event.last-id.${sessionID}`
    : `aialra.public-event.reactivity.last-id.${sessionID}`
}

export function parseSsePublicEvents(text: string) {
  return text
    .split(/\n\n+/)
    .map((block) =>
      block
        .split(/\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
        .join("\n"),
    )
    .filter((data) => !!data.trim())
    .flatMap((data) => {
      try {
        const event = JSON.parse(data) as PublicEventLike
        if (event.schema !== "aialra.public_event.v1") return []
        return [event]
      } catch {
        return []
      }
    })
}

export function authHeadersFromServer(server?: { http?: { username?: string; password?: string } }) {
  const headers: Record<string, string> = {}
  if (!server?.http?.password) return headers
  headers.Authorization = `Basic ${authTokenFromCredentials({
    username: server.http.username,
    password: server.http.password,
  })}`
  return headers
}

export function sessionReactivityAction(event: PublicEventLike): SessionReactivityAction {
  const type = event.type
  const fileSystemMaybeChanged =
    type === "tool.call.finished" &&
    typeof event.data?.tool === "string" &&
    ["write", "edit", "apply_patch", "bash"].includes(event.data.tool)

  return {
    refreshMessages: messageEvents.has(type) || type.startsWith("engineering.") || type.startsWith("exec_process."),
    refreshDiff: diffEvents.has(type) || fileSystemMaybeChanged,
    refreshVcs: diffEvents.has(type) || fileSystemMaybeChanged,
    refreshStatus: statusEvents.has(type) || type.startsWith("model.") || type.startsWith("turn."),
    refreshTodos: type === "engineering.artifact.updated" || type === "turn.completed",
  }
}

export function mergeSessionReactivityActions(actions: SessionReactivityAction[]) {
  return actions.reduce(
    (next, action) => ({
      refreshMessages: next.refreshMessages || action.refreshMessages,
      refreshDiff: next.refreshDiff || action.refreshDiff,
      refreshVcs: next.refreshVcs || action.refreshVcs,
      refreshStatus: next.refreshStatus || action.refreshStatus,
      refreshTodos: next.refreshTodos || action.refreshTodos,
    }),
    emptySessionReactivityAction,
  )
}

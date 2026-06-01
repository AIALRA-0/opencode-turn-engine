import { PublicEventLog } from "./public-event"
import type { SessionID } from "./schema"
import type { TurnContext } from "./turn-context"

export type AbortSource =
  | "stop_button"
  | "prompt_escape"
  | "prompt_ctrl_g"
  | "empty_submit"
  | "route_halt"
  | "session_switch"
  | "client_disconnect"
  | "server_restart"
  | "tool_timeout"
  | "system_reconciler"
  | "api"
  | "benchmark_runner"
  | "unknown"

export type AbortAuditRequest = {
  id: string
  sessionID: SessionID | string
  turnID?: string
  source: AbortSource
  actor: "browser-user" | "api-client" | "server" | "benchmark" | "unknown"
  reason?: string
  route?: string
  userAgent?: string
  createdAt: number
}

const requests = new Map<string, AbortAuditRequest[]>()

const allowed = new Set<AbortSource>([
  "stop_button",
  "prompt_escape",
  "prompt_ctrl_g",
  "empty_submit",
  "route_halt",
  "session_switch",
  "client_disconnect",
  "server_restart",
  "tool_timeout",
  "system_reconciler",
  "api",
  "benchmark_runner",
  "unknown",
])

export namespace AbortAudit {
  export function normalizeSource(value: unknown): AbortSource {
    if (typeof value !== "string") return "unknown"
    return allowed.has(value as AbortSource) ? (value as AbortSource) : "unknown"
  }

  export function recordRequested(input: {
    sessionID: SessionID | string
    turnID?: string
    source?: unknown
    actor?: AbortAuditRequest["actor"]
    reason?: string
    route?: string
    userAgent?: string
  }) {
    const request: AbortAuditRequest = {
      id: `abort_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
      sessionID: input.sessionID,
      turnID: input.turnID,
      source: normalizeSource(input.source),
      actor: input.actor ?? "unknown",
      reason: input.reason,
      route: input.route,
      userAgent: input.userAgent,
      createdAt: Date.now(),
    }
    const list = [...(requests.get(String(input.sessionID)) ?? []), request].slice(-20)
    requests.set(String(input.sessionID), list)
    PublicEventLog.recordManual({
      type: "turn.abort.requested",
      severity: request.source === "unknown" ? "warning" : "info",
      sessionID: String(input.sessionID),
      turnID: input.turnID,
      title: "请求中断回合",
      summary: abortSourceLabel(request.source),
      status: "requested",
      data: request,
      raw: request,
    })
    return request
  }

  export function recordResolved(input: {
    sessionID: SessionID | string
    turn?: TurnContext
    request?: AbortAuditRequest
    result: "cancel_sent" | "turn_aborted" | "no_active_turn" | "unknown"
  }) {
    const request = input.request ?? latest(input.sessionID)
    const data = {
      request,
      result: input.result,
      source: request?.source ?? "unknown",
      sourceLabel: abortSourceLabel(request?.source ?? "unknown"),
    }
    PublicEventLog.recordManual({
      type: "turn.abort.resolved",
      severity: data.source === "unknown" ? "warning" : "info",
      sessionID: String(input.sessionID),
      turnID: input.turn?.turnID ?? request?.turnID,
      messageID: input.turn?.messageID,
      title: "中断请求已处理",
      summary: `${data.sourceLabel} -> ${input.result}`,
      status: input.result,
      data,
      raw: data,
    })
  }

  export function latest(sessionID: SessionID | string) {
    return requests.get(String(sessionID))?.at(-1)
  }

  export function latestForTurn(turn: TurnContext | undefined) {
    if (!turn) return
    return requests.get(String(turn.sessionID))?.findLast((item) => !item.turnID || item.turnID === turn.turnID)
  }

  export function shellMetadata(turn: TurnContext | undefined) {
    const request = latestForTurn(turn)
    const source = request?.source ?? "unknown"
    return {
      aborted: true,
      source,
      sourceLabel: abortSourceLabel(source),
      actor: request?.actor ?? "unknown",
      requestID: request?.id,
      reason: request?.reason,
      message:
        source === "unknown"
          ? "Command aborted by OpenCode abort signal; abort source was not recorded"
          : `Command aborted by OpenCode abort signal from ${abortSourceLabel(source)}`,
    }
  }

  export function clearForTest() {
    requests.clear()
  }
}

export function abortSourceLabel(source: AbortSource) {
  return (
    {
      stop_button: "用户点击停止按钮",
      prompt_escape: "输入框 Escape 快捷键",
      prompt_ctrl_g: "输入框 Ctrl+G 快捷键",
      empty_submit: "运行中空提交触发停止",
      route_halt: "页面路由或会话切换触发停止",
      session_switch: "切换会话触发停止",
      client_disconnect: "客户端连接断开",
      server_restart: "服务重启或后端退出",
      tool_timeout: "工具超时触发停止",
      system_reconciler: "系统终态校准器触发停止",
      api: "API 客户端请求停止",
      benchmark_runner: "评测器请求停止",
      unknown: "未知中断来源",
    } satisfies Record<AbortSource, string>
  )[source]
}

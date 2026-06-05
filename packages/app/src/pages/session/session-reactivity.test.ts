import { describe, expect, test } from "bun:test"
import {
  mergeSessionReactivityActions,
  parseSsePublicEvents,
  publicEventCursorKey,
  sessionReactivityAction,
} from "./session-reactivity"

describe("parseSsePublicEvents", () => {
  test("parses public event SSE blocks and ignores malformed payloads", () => {
    const events = parseSsePublicEvents(
      [
        'data: {"schema":"aialra.public_event.v1","id":"evt_1","type":"file.write"}',
        "",
        "data: not-json",
        "",
        'data: {"schema":"other","id":"evt_2","type":"file.write"}',
        "",
        'data: {"schema":"aialra.public_event.v1","id":"evt_3","type":"turn.completed"}',
        "",
      ].join("\n"),
    )

    expect(events.map((event) => event.id)).toEqual(["evt_1", "evt_3"])
  })
})

describe("sessionReactivityAction", () => {
  test("refreshes message and diffs for file writes", () => {
    expect(sessionReactivityAction({ type: "file.write" })).toEqual({
      refreshMessages: false,
      refreshDiff: true,
      refreshVcs: true,
      refreshStatus: false,
      refreshTodos: false,
    })
  })

  test("refreshes session data for turn terminal events", () => {
    expect(sessionReactivityAction({ type: "turn.completed" })).toEqual({
      refreshMessages: true,
      refreshDiff: true,
      refreshVcs: true,
      refreshStatus: true,
      refreshTodos: true,
    })
  })

  test("treats write-like finished tool calls as diff-producing", () => {
    expect(sessionReactivityAction({ type: "tool.call.finished", data: { tool: "apply_patch" } })).toEqual({
      refreshMessages: true,
      refreshDiff: true,
      refreshVcs: true,
      refreshStatus: false,
      refreshTodos: false,
    })
  })

  test("merges multiple actions without losing any refresh request", () => {
    expect(
      mergeSessionReactivityActions([
        sessionReactivityAction({ type: "approval.resolved" }),
        sessionReactivityAction({ type: "file.write" }),
      ]),
    ).toEqual({
      refreshMessages: true,
      refreshDiff: true,
      refreshVcs: true,
      refreshStatus: false,
      refreshTodos: false,
    })
  })

  test("uses separate cursors for inspector and reactivity", () => {
    expect(publicEventCursorKey("ses_1")).toBe("aialra.public-event.last-id.ses_1")
    expect(publicEventCursorKey("ses_1", "reactivity")).toBe("aialra.public-event.reactivity.last-id.ses_1")
  })
})

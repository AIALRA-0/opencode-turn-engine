import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { PublicEventLog } from "../../src/session/public-event"
import { SessionSecurity } from "../../src/session/security"
import { AialraTurnTrace } from "../../src/session/turn-trace"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"

void Log.init({ print: false })

function app() {
  return Server.Default().app
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("timed out waiting for event")), 5_000)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function readEvent(response: Response) {
  if (!response.body) throw new Error("missing response body")
  const reader = response.body.getReader()
  let buffer = ""
  try {
    while (true) {
      const result = await readChunk(reader)
      if (result.done || !result.value) throw new Error("event stream closed")
      buffer += new TextDecoder().decode(result.value)
      const cut = buffer.lastIndexOf("\n\n")
      if (cut === -1) continue
      const ready = buffer.slice(0, cut + 2)
      buffer = buffer.slice(cut + 2)
      for (const block of ready.split(/\n\n+/)) {
        const data = block
          .split(/\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(line.startsWith("data: ") ? 6 : 5))
          .join("\n")
        if (!data.trim()) continue
        const parsed = JSON.parse(data)
        if (parsed?.schema === "aialra.public_event.v1") return parsed
      }
    }
  } finally {
    await reader.cancel()
  }
}

afterEach(async () => {
  PublicEventLog.clearForTest()
  SessionSecurity.clearForTest()
  await disposeAllInstances()
  await resetDatabase()
})

describe("public event HttpApi", () => {
  test("serves replayed public session events", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    PublicEventLog.recordTrace({
      phase: "turn.started",
      sessionID: "ses_public",
      turnID: "msg_turn",
      messageID: "msg_turn",
      data: { cwd: tmp.path },
    })

    const response = await app().request(
      EventPaths.sessionPublicEvents.replace(":sessionID", "ses_public"),
      { headers: { "x-opencode-directory": tmp.path } },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    expect(await readEvent(response)).toMatchObject({
      schema: "aialra.public_event.v1",
      type: "turn.started",
      sessionID: "ses_public",
      turnID: "msg_turn",
    })
  })

  test("stores raw payload separately and keeps safe events short", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const longPrompt = `${"x".repeat(9000)} opaque_marker_should_not_leak`
    const event = PublicEventLog.recordTrace({
      phase: "prompt.received",
      sessionID: "ses_raw",
      turnID: "msg_raw",
      messageID: "msg_raw",
      data: {
        route: "prompt",
        prompt: longPrompt,
        authorization: "Bearer fixture-value",
      },
    })

    expect(event?.rawRef).toBeTruthy()
    expect(JSON.stringify(event)).not.toContain(longPrompt)
    expect(JSON.stringify(event)).not.toContain("Bearer fixture-value")

    const response = await app().request(
      EventPaths.sessionPublicEventRaw.replace(":sessionID", "ses_raw").replace(":eventID", event!.id),
      { headers: { "x-opencode-directory": tmp.path } },
    )
    expect(response.status).toBe(200)
    const raw = await response.json()
    expect(raw.raw.data.prompt).toContain("opaque_marker_should_not_leak")
    expect(raw.raw.data.authorization).toBe("[redacted]")

    const denied = await app().request(
      EventPaths.sessionPublicEventRaw.replace(":sessionID", "ses_other").replace(":eventID", event!.id),
      { headers: { "x-opencode-directory": tmp.path } },
    )
    expect(denied.status).toBe(404)
  })

  test("AialraTurnTrace records public events even when jsonl tracing is disabled", async () => {
    delete process.env.AIALRA_TURN_TRACE
    await Effect.runPromise(
      AialraTurnTrace.emit({
        phase: "model.stream.retrying",
        sessionID: "ses_retry",
        turnID: "msg_retry",
        messageID: "msg_assistant",
        data: {
          attempt: 1,
          message: "socket closed",
          next: 2,
        },
      }),
    )

    expect(PublicEventLog.list({ sessionID: "ses_retry" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "model.retrying",
          severity: "warning",
          sessionID: "ses_retry",
          turnID: "msg_retry",
        }),
      ]),
    )
  })

  test("Sandbox Control Center changes are public audit events", () => {
    const next = SessionSecurity.update({
      sessionID: "ses_security",
      cwd: "/tmp/aialra-security",
      patch: {
        permissionProfileID: ":read-only",
        approvalPolicy: "never",
        networkAccess: false,
        executorBackend: "node-bun",
      },
    })

    expect(next.permissionProfileID).toBe(":read-only")
    expect(PublicEventLog.list({ sessionID: "ses_security" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "sandbox.profile.changed", status: "changed" }),
        expect.objectContaining({ type: "approval.policy.changed", status: "changed" }),
      ]),
    )
  })
})

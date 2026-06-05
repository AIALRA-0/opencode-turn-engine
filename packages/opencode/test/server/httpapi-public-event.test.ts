import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { PUBLIC_EVENT_TYPES, PublicEventLog } from "../../src/session/public-event"
import { ExecProcessRegistry } from "../../src/session/exec-process-registry"
import { SessionSecurity } from "../../src/session/security"
import { AialraTurnTrace } from "../../src/session/turn-trace"
import { Server } from "../../src/server/server"
import { EventPaths } from "../../src/server/routes/instance/httpapi/groups/event"
import { SessionPaths } from "../../src/server/routes/instance/httpapi/groups/session"
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

  test("resumes public session event replay after Last-Event-ID", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const first = PublicEventLog.recordTrace({
      phase: "turn.started",
      sessionID: "ses_replay",
      turnID: "msg_replay_1",
      messageID: "msg_replay_1",
      data: { cwd: tmp.path },
    })
    PublicEventLog.recordTrace({
      phase: "turn.completed",
      sessionID: "ses_replay",
      turnID: "msg_replay_1",
      messageID: "msg_replay_1",
      data: { durationMs: 10 },
    })

    const response = await app().request(EventPaths.sessionPublicEvents.replace(":sessionID", "ses_replay"), {
      headers: { "x-opencode-directory": tmp.path, "last-event-id": first!.id },
    })

    expect(response.status).toBe(200)
    const event = await readEvent(response)
    expect(event.id).not.toBe(first!.id)
    expect(event.sequence).toBeGreaterThan(first!.sequence)
    expect(PublicEventLog.list({ sessionID: "ses_replay", afterID: first!.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
      schema: "aialra.public_event.v1",
      type: "turn.completed",
      sessionID: "ses_replay",
      turnID: "msg_replay_1",
        }),
      ]),
    )
  })

  test("resumes public session event replay from lastEventID query", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const first = PublicEventLog.recordTrace({
      phase: "turn.started",
      sessionID: "ses_query_replay",
      turnID: "msg_query_replay",
      messageID: "msg_query_replay",
      data: { cwd: tmp.path },
    })
    const second = PublicEventLog.recordTrace({
      phase: "turn.completed",
      sessionID: "ses_query_replay",
      turnID: "msg_query_replay",
      messageID: "msg_query_assistant",
      data: { durationMs: 22 },
    })

    const response = await app().request(
      `${EventPaths.sessionPublicEvents.replace(":sessionID", "ses_query_replay")}?lastEventID=${first!.id}`,
      { headers: { "x-opencode-directory": tmp.path } },
    )

    expect(response.status).toBe(200)
    const event = await readEvent(response)
    expect(event.id).not.toBe(first!.id)
    expect(event.sequence).toBeGreaterThan(first!.sequence)
    expect(PublicEventLog.list({ sessionID: "ses_query_replay", afterID: first!.id })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: second!.id })]),
    )
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

  test("downloads raw lab bundle with manifest and raw payloads", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const included = PublicEventLog.recordTrace({
      phase: "model.raw.item",
      sessionID: "ses_bundle",
      turnID: "msg_bundle",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.raw_response_item.v1",
        raw_item_id: "raw_msg_assistant_1",
        model_call_id: "model_msg_assistant",
        sequence: 1,
        kind: "assistant_text_delta",
        normalized_event_type: "text-delta",
        raw_payload: {
          type: "text-delta",
          text: "bundle raw payload",
        },
      },
    })
    PublicEventLog.recordTrace({
      phase: "turn.started",
      sessionID: "ses_bundle",
      turnID: "msg_other",
      messageID: "msg_other",
      data: { cwd: tmp.path },
    })

    const response = await app().request(
      `${EventPaths.sessionRawDownload.replace(":sessionID", "ses_bundle")}?turnID=msg_bundle`,
      { headers: { "x-opencode-directory": tmp.path } },
    )

    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("application/json")
    expect(response.headers.get("content-disposition")).toContain("attachment")
    const bundle = await response.json()
    expect(bundle.schema).toBe("aialra.raw_bundle.v1")
    expect(bundle.manifest).toEqual(
      expect.objectContaining({
        schema: "aialra.raw_bundle_manifest.v1",
        sessionID: "ses_bundle",
        filters: expect.objectContaining({ turnID: "msg_bundle" }),
        eventCount: expect.any(Number),
        rawPayloadCount: 1,
        hashAlgorithm: "sha256",
        hash: expect.any(String),
      }),
    )
    expect(bundle.manifest.eventCount).toBeGreaterThanOrEqual(1)
    expect(bundle.publicEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: included!.id,
          type: "model.raw.item",
          turnID: "msg_bundle",
          data: expect.not.objectContaining({ raw_payload: expect.anything() }),
        }),
      ]),
    )
    expect(JSON.stringify(bundle.publicEvents.find((event: { id: string }) => event.id === included!.id))).not.toContain(
      "bundle raw payload",
    )
    expect(bundle.rawPayloads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventID: included!.id,
          type: "model.raw.item",
          hash: expect.any(String),
          raw: expect.objectContaining({
            raw_payload: {
              type: "text-delta",
              text: "bundle raw payload",
            },
          }),
        }),
      ]),
    )
  })

  test("raw lab indexes raw payloads by turn type model and tool", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    PublicEventLog.recordTrace({
      phase: "model.raw.item",
      sessionID: "ses_raw_lab_index",
      turnID: "msg_raw_lab",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.raw_response_item.v1",
        raw_item_id: "raw_msg_assistant_1",
        model_call_id: "model_msg_assistant",
        sequence: 1,
        kind: "assistant_text_delta",
        raw_payload: { text: "hello" },
      },
    })
    PublicEventLog.recordTrace({
      phase: "tool.call.started",
      sessionID: "ses_raw_lab_index",
      turnID: "msg_raw_lab",
      messageID: "msg_assistant",
      data: {
        tool: "bash",
        tool_call_id: "tool_1",
        raw_payload: { command: "echo hello" },
      },
    })

    const response = await app().request(EventPaths.sessionRawLab.replace(":sessionID", "ses_raw_lab_index"), {
      headers: { "x-opencode-directory": tmp.path },
    })

    expect(response.status).toBe(200)
    const lab = await response.json()
    expect(lab.schema).toBe("aialra.raw_lab.v1")
    expect(lab.summary).toEqual(
      expect.objectContaining({
        eventCount: expect.any(Number),
        rawRefCount: 2,
        turnCount: 1,
        modelCallCount: 1,
        toolCallCount: 1,
      }),
    )
    expect(lab.groups.byTurn).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          turnID: "msg_raw_lab",
          rawRefCount: 2,
          types: expect.arrayContaining(["model.raw.item", "tool.call.started"]),
        }),
      ]),
    )
    expect(lab.groups.modelCalls).toEqual(
      expect.arrayContaining([expect.objectContaining({ modelCallID: "model_msg_assistant", rawRefCount: 1 })]),
    )
    expect(lab.groups.toolCalls).toEqual(
      expect.arrayContaining([expect.objectContaining({ toolCallID: "tool_1", rawRefCount: 1 })]),
    )
    expect(lab.rawPayloads).toHaveLength(2)
    expect(lab.normalizedMappings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventID: expect.any(String),
          hash: expect.any(String),
          normalizedMapping: expect.objectContaining({
            turnID: "msg_raw_lab",
          }),
        }),
      ]),
    )
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

  test("public event protocol covers V3 terminal, executor, and engineering events", () => {
    PublicEventLog.recordTrace({
      phase: "turn.terminal.assistant_error",
      sessionID: "ses_schema",
      turnID: "msg_schema",
      messageID: "msg_schema",
      data: { reason: "model_not_started" },
    })
    PublicEventLog.recordTrace({
      phase: "exec_server.http.started",
      sessionID: "ses_schema",
      turnID: "msg_schema",
      messageID: "msg_schema",
      data: { method: "GET", url: "https://example.com" },
    })
    PublicEventLog.recordManual({
      type: "engineering.stop_gate.blocked_tool",
      severity: "warning",
      sessionID: "ses_schema",
      turnID: "msg_schema",
      messageID: "msg_schema",
      title: "Stop gate blocked tool",
      summary: "验证已通过，阻止继续调用工具",
      status: "blocked",
      data: { tool: "bash", reason: "verification_passed" },
      raw: { tool: "bash", reason: "verification_passed" },
    })

    for (const event of PublicEventLog.list({ sessionID: "ses_schema" })) {
      expect(event.schema).toBe("aialra.public_event.v1")
      expect(event.version).toBe("1")
      expect(typeof event.id).toBe("string")
      expect(event.sequence).toBeGreaterThan(0)
      expect(typeof event.ts).toBe("string")
      expect(["trace", "bus", "manual"]).toContain(event.source)
      expect(event.threadID).toBe("msg_schema")
      expect(event.sessionID).toBe("ses_schema")
      expect(event.turnID).toBe("msg_schema")
      expect(typeof event.title).toBe("string")
      expect(event.payloadSchema).toBe(`aialra.public_event.${event.type.replace(/[^a-zA-Z0-9]+/g, "_")}.v1`)
      expect(event.payload).toEqual(event.data)
      expect(typeof event.data).toBe("object")
    }
    expect(PublicEventLog.list({ sessionID: "ses_schema" }).map((event) => event.type).filter((type) => type !== "audit.encryption.unavailable")).toEqual([
      "turn.terminal.assistant_error",
      "executor.started",
      "engineering.stop_gate.blocked_tool",
    ])
  })

  test("public event protocol registry documents every event type", () => {
    const protocol = PublicEventLog.protocol()

    expect(protocol.map((event) => event.type)).toEqual([...PUBLIC_EVENT_TYPES])
    for (const event of protocol) {
      expect(event.schema).toBe("aialra.public_event.v1")
      expect(event.title.length).toBeGreaterThan(0)
      expect(event.description.length).toBeGreaterThan(0)
      expect(event.fields.map((field) => field.name)).toEqual(
        expect.arrayContaining([
          "schema",
          "version",
          "id",
          "sequence",
          "ts",
          "type",
          "source",
          "threadID",
          "severity",
          "title",
          "payloadSchema",
          "payload",
          "data",
          "data.*",
        ]),
      )
      expect(event.fields.every((field) => field.description.length > 0)).toBe(true)
      expect(event.permission).toBe("session_owner")
      expect(event.replay).toBe("session_buffer_with_last_event_id")
      expect(["none", "rawRef_only"]).toContain(event.raw)
    }
  })

  test("Sandbox Control Center changes are public audit events", () => {
    const next = SessionSecurity.update({
      sessionID: "ses_security",
      cwd: "/tmp/aialra-security",
      patch: {
        permissionProfileID: ":read-only",
        approvalPolicy: "never",
        approvalsReviewer: "auto_review",
        networkPolicy: "on",
        commandPolicy: "read",
        executorBackend: "node-bun",
        stepBudgetEnabled: true,
        stepBudgetMaxSteps: 120,
        engineering: {
          mode: "deep",
          advancedEnabled: true,
          verificationRounds: 4,
        },
      },
    })

    expect(next.permissionProfileID).toBe(":read-only")
    expect(next.approvalsReviewer).toBe("auto_review")
    expect(next.networkPolicy).toBe("on")
    expect(next.commandPolicy).toBe("read")
    expect(next.stepBudgetEnabled).toBe(true)
    expect(next.stepBudgetMaxSteps).toBe(120)
    expect(next.engineering.mode).toBe("deep")
    expect(next.engineering.verificationRounds).toBe(4)
    const collapsed = SessionSecurity.update({
      sessionID: "ses_security",
      cwd: "/tmp/aialra-security",
      patch: {
        engineering: {
          advancedEnabled: false,
        },
      },
    })
    expect(collapsed.engineering.mode).toBe("deep")
    expect(collapsed.engineering.advancedEnabled).toBe(false)
    expect(PublicEventLog.list({ sessionID: "ses_security" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "sandbox.control.changed",
          data: expect.objectContaining({
            runtimeProof: expect.objectContaining({
              version: "aialra.sandbox_control_runtime_proof.v1",
              active_permission_profile_id: ":read-only",
              command_policy: "read",
            }),
          }),
        }),
        expect.objectContaining({ type: "sandbox.profile.changed", status: "changed" }),
        expect.objectContaining({ type: "sandbox.network.changed", status: "changed" }),
        expect.objectContaining({ type: "sandbox.command.changed", status: "changed" }),
        expect.objectContaining({ type: "approval.policy.changed", status: "changed" }),
        expect.objectContaining({ type: "approval.reviewer.changed", status: "changed" }),
        expect.objectContaining({ type: "turn.step_budget.changed", status: "changed" }),
        expect.objectContaining({ type: "engineering.mode.changed", status: "changed" }),
        expect.objectContaining({ type: "engineering.controls.changed", status: "changed" }),
      ]),
    )
  })

  test("session cleanup endpoint cleans finished background processes and records public events", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const created = await app().request(SessionPaths.create, {
      method: "POST",
      headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
      body: JSON.stringify({ title: "cleanup endpoint" }),
    })
    expect(created.status).toBe(200)
    const session = await created.json()
    const processID = `proc_cleanup_${Date.now()}`
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* ExecProcessRegistry.register({
          process_id: processID,
          command_id: "cmd_cleanup",
          backend: "node_bun",
          session_id: session.id,
          turn_id: "msg_cleanup_turn",
          message_id: "msg_cleanup",
          tool_call_id: "tool_cleanup",
          cwd: tmp.path,
          command: "echo cleanup",
          timeout_ms: 1000,
          yield_time_ms: 1,
          output_chars: 0,
        })
        yield* ExecProcessRegistry.finish(processID, {
          status: "completed",
          exitCode: 0,
        })
      }),
    )

    const response = await app().request(
      SessionPaths.cleanupProcesses.replace(":sessionID", session.id),
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-opencode-directory": tmp.path },
        body: JSON.stringify({
          process_id: processID,
          include_finished: true,
          reason: "httpapi_cleanup_test",
        }),
      },
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      cleaned: 1,
      failed: 0,
      results: [expect.objectContaining({ process_id: processID, status: "cleaned" })],
    })
    expect(ExecProcessRegistry.read(processID, { sessionID: session.id })?.cleanup_at).toEqual(expect.any(Number))
    expect(PublicEventLog.list({ sessionID: session.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "exec_process.cleanup",
          status: "cleaned",
          data: expect.objectContaining({ process_id: processID, previous_status: "completed" }),
        }),
        expect.objectContaining({
          type: "exec_process.cleanup",
          status: "summary",
          data: expect.objectContaining({ cleaned: 1, failed: 0 }),
        }),
      ]),
    )
  })

  test("session handoff returns event raw and process registry degradation state", async () => {
    await using tmp = await tmpdir({ git: true, config: { formatter: false, lsp: false } })
    const created = await app().request(SessionPaths.create, {
      method: "POST",
      headers: { "x-opencode-directory": tmp.path },
    })
    expect(created.status).toBe(200)
    const session = await created.json() as { id: string }
    PublicEventLog.recordTrace({
      phase: "turn.started",
      sessionID: session.id,
      turnID: "msg_handoff",
      messageID: "msg_handoff",
      data: { cwd: tmp.path },
    })
    await Effect.runPromise(
      ExecProcessRegistry.register({
        process_id: "proc_handoff",
        command_id: "cmd_handoff",
        backend: "node_bun",
        session_id: session.id,
        turn_id: "msg_handoff",
        message_id: "msg_assistant",
        cwd: tmp.path,
        command: "sleep 60",
        output_chars: 0,
      }),
    )

    const pending = await app().request(
      `${SessionPaths.handoff.replace(":sessionID", session.id)}?target=desktop&source=web`,
      { headers: { "x-opencode-directory": tmp.path } },
    )
    expect(pending.status).toBe(200)
    expect(await pending.json()).toMatchObject({
      schema: "aialra.session_handoff.v1",
      session_id: session.id,
      status: "pending_confirmation",
      confirmation: { required: true, confirmed: false },
    })

    const response = await app().request(
      `${SessionPaths.handoff.replace(":sessionID", session.id)}?target=desktop&source=web&confirm=true`,
      { headers: { "x-opencode-directory": tmp.path } },
    )
    expect(response.status).toBe(200)
    const snapshot = await response.json()
    expect(snapshot).toMatchObject({
      schema: "aialra.session_handoff.v1",
      session_id: session.id,
      source: "web",
      target: "desktop",
      status: "degraded",
      event_stream: { supports_last_event_id: true },
      process_registry: {
        running: 1,
        handoff_status: "degraded",
      },
    })
    expect(snapshot.unsupported).toContain("running_process_handoff_degraded")

    expect(PublicEventLog.list({ sessionID: session.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "session.handoff.requested", rawRef: expect.any(Object) }),
        expect.objectContaining({ type: "session.handoff.prepared", rawRef: expect.any(Object), status: "degraded" }),
      ]),
    )
  })
})

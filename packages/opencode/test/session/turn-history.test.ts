import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import os from "os"
import path from "path"
import { AialraTurnTrace } from "../../src/session/turn-trace"
import { TurnHistory } from "../../src/session/turn-history"
import { PublicEventLog } from "../../src/session/public-event"
import { ExecCommandEnd } from "../../src/session/exec-command-end"

const dir = path.join(os.tmpdir(), `aialra-turn-history-test-${process.pid}`)

afterEach(() => {
  TurnHistory.clearForTest()
  PublicEventLog.clearForTest()
  ExecCommandEnd.clearForTest()
  delete process.env.AIALRA_TURN_HISTORY_DIR
})

test("turn lifecycle trace records are persisted to turn history", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      AialraTurnTrace.emit({
        phase: "turn.started",
        sessionID: "ses_history",
        turnID: "msg_turn",
        messageID: "msg_turn",
        data: { startedAt: 1, cwd: "/tmp/work" },
      }),
      AialraTurnTrace.emit({
        phase: "turn.completed",
        sessionID: "ses_history",
        turnID: "msg_turn",
        messageID: "msg_assistant",
        data: { completedAt: 2, durationMs: 1 },
      }),
      AialraTurnTrace.emit({
        phase: "turn.terminal.reconciled",
        sessionID: "ses_history",
        turnID: "msg_turn",
        messageID: "msg_assistant",
        data: { outcome: "completed" },
      }),
    ]),
  )

  const records = TurnHistory.list({ sessionID: "ses_history" })
  expect(records.map((record) => record.type)).toEqual([
    "turn.started",
    "turn.completed",
    "turn.terminal.reconciled",
  ])
  expect(records.every((record) => record.schema === "aialra.turn_history.v1")).toBe(true)
  expect(records.every((record) => record.turnID === "msg_turn")).toBe(true)
})

test("turn aborted and terminal anomaly history can be filtered by turn", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      AialraTurnTrace.emit({
        phase: "turn.aborted",
        sessionID: "ses_history",
        turnID: "msg_a",
        messageID: "msg_a",
        data: { reason: "interrupted", abortSource: "stop_button" },
      }),
      AialraTurnTrace.emit({
        phase: "turn.terminal.anomaly",
        sessionID: "ses_history",
        turnID: "msg_b",
        messageID: "msg_b",
        data: { reason: "empty_final" },
      }),
      AialraTurnTrace.emit({
        phase: "turn.terminal.assistant_error",
        sessionID: "ses_history",
        turnID: "msg_b",
        messageID: "msg_assistant",
        data: { reason: "model_not_started" },
      }),
    ]),
  )

  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_b" })
  expect(records.map((record) => record.type)).toEqual([
    "turn.terminal.anomaly",
    "turn.terminal.assistant_error",
  ])
})

test("turn context items are persisted for replay and audit", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      AialraTurnTrace.emit({
        phase: "turn.context.created",
        sessionID: "ses_history",
        turnID: "msg_context",
        messageID: "msg_context",
        data: {
          cwd: "/workspace",
          selected_environment_id: "default",
          approval_policy: "on-request",
          sandbox_policy: { type: "workspace-write" },
          model: { providerID: "test", modelID: "test" },
        },
      }),
      AialraTurnTrace.emit({
        phase: "model.request.started",
        sessionID: "ses_history",
        turnID: "msg_context",
        messageID: "msg_assistant",
        data: { providerID: "test", modelID: "test" },
      }),
      AialraTurnTrace.emit({
        phase: "tool.call.finished",
        sessionID: "ses_history",
        turnID: "msg_context",
        messageID: "msg_assistant",
        data: { callID: "call_1", tool: "read", status: "success" },
      }),
      AialraTurnTrace.emit({
        phase: "tool.sandbox.denied",
        sessionID: "ses_history",
        turnID: "msg_context",
        messageID: "msg_assistant",
        data: { path: "/outside.txt", policy: "workspace-write" },
      }),
    ]),
  )

  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_context" })
  expect(records.map((record) => record.type)).toEqual([
    "turn.context.item",
    "turn.context.item",
    "turn.context.item",
    "turn.context.item",
  ])
  expect(records.map((record) => record.data.kind)).toEqual(["turn_context", "model", "tool", "sandbox"])
  expect(records.map((record) => record.data.phase)).toEqual([
    "turn.context.created",
    "model.request.started",
    "tool.call.finished",
    "tool.sandbox.denied",
  ])
  expect(records[0].data.context).toEqual(expect.objectContaining({ cwd: "/workspace" }))
})

test("raw response items keep provider payload behind rawRef", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "model.raw.item",
      sessionID: "ses_history",
      turnID: "msg_raw_item",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.raw_response_item.v1",
        raw_item_id: "raw_msg_assistant_1",
        model_call_id: "model_msg_assistant",
        sequence: 1,
        kind: "assistant_text_delta",
        normalized_event_type: "text-delta",
        providerID: "test",
        modelID: "test-model",
        chars: 11,
        preview: "hello world",
        raw_payload: {
          type: "text-delta",
          text: "hello world",
          providerMetadata: { requestID: "provider_req_1" },
        },
      },
    }),
  )

  const event = PublicEventLog.list({ sessionID: "ses_history" }).find((item) => item.type === "model.raw.item")
  expect(event).toEqual(
    expect.objectContaining({
      version: "1",
      source: "trace",
      threadID: "msg_raw_item",
      payloadSchema: "aialra.public_event.model_raw_item.v1",
      status: "captured",
      data: expect.objectContaining({
        schema: "aialra.raw_response_item.v1",
        raw_item_id: "raw_msg_assistant_1",
        kind: "assistant_text_delta",
        sequence: 1,
      }),
    }),
  )
  expect(event?.data.raw_payload).toBeUndefined()
  expect(event?.rawRef).toBeTruthy()
  expect(
    event ? PublicEventLog.readRaw({ sessionID: "ses_history", eventID: event.id }) : undefined,
  ).toEqual(
    expect.objectContaining({
      raw_payload: {
        type: "text-delta",
        text: "hello world",
        providerMetadata: { requestID: "provider_req_1" },
      },
    }),
  )
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_raw_item" })
  expect(records.map((record) => record.data.phase)).toEqual(
    expect.arrayContaining(["model.raw.item", "item.lifecycle.completed"]),
  )
  expect(records.find((record) => record.data.phase === "model.raw.item")?.data.kind).toBe("model")
  expect(records.find((record) => record.data.phase === "item.lifecycle.completed")?.data.kind).toBe("runtime")
})

test("reasoning raw items keep provider reasoning behind rawRef", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "reasoning.raw.item",
      sessionID: "ses_history",
      turnID: "msg_reasoning_raw",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.reasoning_raw_item.v1",
        reasoning_raw_id: "reasoning_raw_msg_assistant_1",
        model_call_id: "model_msg_assistant",
        response_message_id: "msg_assistant",
        sequence: 1,
        kind: "reasoning_delta",
        display_policy: "rawRef_only",
        normalized_event_type: "reasoning-delta",
        providerID: "deepseek",
        modelID: "deepseek-reasoner",
        reasoningID: "reasoning-1",
        chars: 18,
        preview: "inspect failing test",
        raw_payload: {
          type: "reasoning-delta",
          id: "reasoning-1",
          text: "inspect failing test",
          providerMetadata: { requestID: "provider_req_reasoning_1" },
        },
      },
    }),
  )

  const event = PublicEventLog.list({ sessionID: "ses_history" }).find((item) => item.type === "reasoning.raw.item")
  expect(event).toEqual(
    expect.objectContaining({
      version: "1",
      source: "trace",
      threadID: "msg_reasoning_raw",
      payloadSchema: "aialra.public_event.reasoning_raw_item.v1",
      status: "captured",
      data: expect.objectContaining({
        schema: "aialra.reasoning_raw_item.v1",
        reasoning_raw_id: "reasoning_raw_msg_assistant_1",
        kind: "reasoning_delta",
        sequence: 1,
        display_policy: "rawRef_only",
      }),
    }),
  )
  expect(event?.data.raw_payload).toBeUndefined()
  expect(event?.rawRef).toBeTruthy()
  expect(
    event ? PublicEventLog.readRaw({ sessionID: "ses_history", eventID: event.id }) : undefined,
  ).toEqual(
    expect.objectContaining({
      raw_payload: {
        type: "reasoning-delta",
        id: "reasoning-1",
        text: "inspect failing test",
        providerMetadata: { requestID: "provider_req_reasoning_1" },
      },
    }),
  )
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_reasoning_raw" })
  expect(records.map((record) => record.data.phase)).toEqual(
    expect.arrayContaining(["reasoning.raw.item", "item.lifecycle.completed"]),
  )
  expect(records.find((record) => record.data.phase === "reasoning.raw.item")?.data.kind).toBe("model")
  expect(records.find((record) => record.data.phase === "item.lifecycle.completed")?.data.context).toEqual(
    expect.objectContaining({
      item_kind: "reasoning_raw_item",
      sequence: 1,
    }),
  )
})

test("effective prompt manifests keep full prompt behind rawRef", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "prompt.effective.resolved",
      sessionID: "ses_history",
      turnID: "msg_prompt",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.effective_prompt_manifest.v1",
        version: "aialra-general-engineering-harness-v1",
        prompt_hash: "a".repeat(64),
        system_hash: "b".repeat(64),
        messages_hash: "c".repeat(64),
        source_count: 2,
        sources: ["agent.prompt", "session.system_fragments"],
        providerID: "test",
        modelID: "test-model",
        effective_system_count: 1,
        model_message_count: 2,
        tool_count: 1,
        raw_payload: {
          manifest: { hashes: { manifest: "a".repeat(64) } },
          effectiveSystem: ["system"],
          effectiveMessages: [{ role: "user", content: "hello" }],
        },
      },
    }),
  )

  const event = PublicEventLog.list({ sessionID: "ses_history" }).find(
    (item) => item.type === "prompt.effective.resolved",
  )
  expect(event?.rawRef).toBeDefined()
  expect(event?.data.raw_payload).toBeUndefined()
  expect(event?.data.prompt_hash).toBe("a".repeat(64))
  const raw = event ? PublicEventLog.readRaw({ sessionID: "ses_history", eventID: event.id }) : undefined
  expect(raw).toEqual(
    expect.objectContaining({
      prompt_manifest: expect.objectContaining({ prompt_hash: "a".repeat(64) }),
      raw_payload: expect.objectContaining({ effectiveSystem: ["system"] }),
    }),
  )
})

test("unsupported reasoning raw is explicit instead of empty", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "reasoning.raw.item",
      sessionID: "ses_history",
      turnID: "msg_reasoning_unsupported",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.reasoning_raw_item.v1",
        reasoning_raw_id: "reasoning_raw_msg_assistant_unsupported",
        model_call_id: "model_msg_assistant",
        response_message_id: "msg_assistant",
        sequence: 1,
        kind: "unsupported",
        display_policy: "unsupported",
        normalized_event_type: "unsupported",
        providerID: "test",
        modelID: "test-model",
        reason: "provider_emitted_no_reasoning_items",
        raw_payload: {
          type: "unsupported",
          reason: "provider_emitted_no_reasoning_items",
        },
      },
    }),
  )

  const event = PublicEventLog.list({ sessionID: "ses_history" }).find((item) => item.type === "reasoning.raw.item")
  expect(event).toEqual(
    expect.objectContaining({
      severity: "warning",
      status: "unsupported",
      data: expect.objectContaining({
        kind: "unsupported",
        display_policy: "unsupported",
        reason: "provider_emitted_no_reasoning_items",
      }),
    }),
  )
  expect(event?.rawRef).toBeTruthy()
})

test("symlink escape sandbox denials are public and replayable", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "tool.sandbox.denied",
      sessionID: "ses_history",
      turnID: "msg_symlink_escape",
      messageID: "msg_assistant",
      data: {
        tool: "read",
        operation: "read",
        target: "/workspace/link-secret.txt",
        canonicalTarget: "/home/user/.ssh/id_ed25519",
        reason: "路径位于工作区内，但 canonical realpath 指向工作区外，疑似符号链接越界",
        symlink_escape: true,
        symlink_escape_code: "symlink_escape",
        workspaceRoot: "/workspace",
        constraintLayer: "canonical_realpath",
        sandbox_policy: "workspace-write",
        active_permission_profile: { id: ":workspace" },
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_symlink_escape" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "tool.sandbox.denied",
        title: "沙箱拒绝工具访问",
        severity: "error",
        status: "denied",
        summary: expect.stringContaining("符号链接越界"),
        data: expect.objectContaining({
          symlink_escape: true,
          canonicalTarget: "/home/user/.ssh/id_ed25519",
          workspaceRoot: "/workspace",
        }),
      }),
    ]),
  )
  expect(records[0]?.data.kind).toBe("sandbox")
  expect(records[0]?.data.context).toEqual(
    expect.objectContaining({
      symlink_escape: true,
      symlink_escape_code: "symlink_escape",
      constraintLayer: "canonical_realpath",
    }),
  )
})

test("context compaction events are persisted as replayable context items", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      AialraTurnTrace.emit({
        phase: "context.compaction.started",
        sessionID: "ses_history",
        turnID: "msg_compaction",
        messageID: "msg_compaction",
        data: { reason: "auto", auto: true, compactionMessageID: "msg_compaction" },
      }),
      AialraTurnTrace.emit({
        phase: "context.compaction.completed",
        sessionID: "ses_history",
        turnID: "msg_compaction",
        messageID: "msg_summary",
        data: { summaryChars: 120, beforeMessageCount: 12, tailStartID: "msg_tail" },
      }),
    ]),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_compaction" })
  expect(events.map((event) => event.type)).toEqual(
    expect.arrayContaining(["context.compaction.started", "context.compaction.completed"]),
  )
  expect(records.map((record) => record.data.phase)).toEqual([
    "context.compaction.started",
    "context.compaction.completed",
  ])
  expect(records.every((record) => record.data.kind === "runtime")).toBe(true)
})

test("extension data events are public and replayable with namespaced payloads", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "extension.data.attached",
      sessionID: "ses_history",
      turnID: "msg_extension_data",
      messageID: "msg_extension_data",
      extension_data: {
        benchmark: { caseID: "swe-001", external_trace_id: "trace-123" },
      },
      data: { namespaces: ["benchmark"], namespaceCount: 1 },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_extension_data" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "extension.data.attached",
        status: "attached",
        extension_data: expect.objectContaining({
          benchmark: expect.objectContaining({ caseID: "swe-001" }),
        }),
      }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(["turn_context"])
  expect(records[0].extension_data).toEqual(
    expect.objectContaining({
      benchmark: expect.objectContaining({ external_trace_id: "trace-123" }),
    }),
  )
})

test("runtime item events are public and replayable as runtime context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      AialraTurnTrace.emit({
        phase: "runtime.provider.selected",
        sessionID: "ses_history",
        turnID: "msg_runtime",
        messageID: "msg_runtime",
        data: {
          runtime: "native",
          providerID: "openai",
          modelID: "gpt-5",
        },
      }),
      AialraTurnTrace.emit({
        phase: "runtime.item.received",
        sessionID: "ses_history",
        turnID: "msg_runtime",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.runtime_item.v1",
          sourceEventType: "tool-call",
          kind: "tool_call_item",
          status: "called",
          toolCallID: "call_1",
          tool: "read",
        },
      }),
      AialraTurnTrace.emit({
        phase: "runtime.item.settled",
        sessionID: "ses_history",
        turnID: "msg_runtime",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.runtime_item.v1",
          sourceEventType: "tool-result",
          kind: "tool_result_item",
          status: "completed",
          toolCallID: "call_1",
          tool: "read",
        },
      }),
    ]),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_runtime" })
  expect(events.map((event) => event.type)).toEqual(
    expect.arrayContaining([
      "runtime.provider.selected",
      "runtime.item.received",
      "runtime.item.settled",
      "item.lifecycle.started",
      "item.lifecycle.completed",
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(
    expect.arrayContaining(["runtime", "runtime", "runtime"]),
  )
  expect(records.map((record) => record.data.phase)).toEqual(
    expect.arrayContaining([
      "runtime.provider.selected",
      "runtime.item.received",
      "runtime.item.settled",
      "item.lifecycle.started",
      "item.lifecycle.completed",
    ]),
  )
  expect(events.find((event) => event.type === "item.lifecycle.started")).toEqual(
    expect.objectContaining({
      status: "started",
      data: expect.objectContaining({
        schema: "aialra.item_lifecycle.v1",
        item_id: "call_1",
        item_kind: "tool_call_item",
        source_phase: "runtime.item.received",
      }),
    }),
  )
  expect(events.find((event) => event.type === "item.lifecycle.completed")).toEqual(
    expect.objectContaining({
      status: "completed",
      data: expect.objectContaining({
        schema: "aialra.item_lifecycle.v1",
        item_id: "call_1",
        item_kind: "tool_result_item",
        source_phase: "runtime.item.settled",
      }),
    }),
  )
})

test("security constraint events are public and replayable before approval", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "security.constraint.denied",
      sessionID: "ses_history",
      turnID: "msg_constraints",
      messageID: "msg_constraints",
      data: {
        kind: "file",
        operation: "write",
        target: "/workspace/.git/config",
        ruleID: "protected-git-metadata-write",
        reason: ".git 是受保护的工程元数据目录，默认禁止工具写入",
        source: "codex",
        active_permission_profile: { id: ":workspace" },
        sandbox_policy: "workspace-write",
        constraintLayer: "before_approval",
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_constraints" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "security.constraint.denied",
        title: "硬安全约束拒绝",
        status: "denied",
        data: expect.objectContaining({
          ruleID: "protected-git-metadata-write",
          active_permission_profile: { id: ":workspace" },
          constraintLayer: "before_approval",
        }),
      }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(["sandbox"])
  expect(records[0].data.phase).toBe("security.constraint.denied")
})

test("directory read events are public and replayable with environment metadata", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "directory.read",
      sessionID: "ses_history",
      turnID: "msg_directory",
      messageID: "msg_directory",
      data: {
        schema: "aialra.directory_read.v1",
        tool: "read",
        status: "completed",
        call_id: "call_directory",
        environment_id: "selected",
        environment_cwd: "/workspace/env",
        requested_path: ".",
        resolved_path: "/workspace/env",
        listing: {
          offset: 1,
          limit: 2000,
          total: 2,
          returned: 2,
          hidden_policy: "include",
          hidden_count: 1,
          protected_count: 1,
          symlink_count: 0,
          symlink_escape_count: 0,
          recursive_depth: 0,
          effective_recursive_depth: 0,
          sort: "name",
          max_entries: 10000,
        },
        truncation: { truncated: false },
        entries: [
          { name: ".git", display_name: ".git/", relative_path: ".git", type: "directory", hidden: true, protected: true, symlink: false },
          { name: "src", display_name: "src/", relative_path: "src", type: "directory", hidden: false, protected: false, symlink: false },
        ],
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_directory" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "directory.read",
        title: "读取目录：/workspace/env",
        status: "completed",
        toolCallID: "call_directory",
        data: expect.objectContaining({
          schema: "aialra.directory_read.v1",
          environment_id: "selected",
        }),
      }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(["file"])
  expect(records[0].data.phase).toBe("directory.read")
})

test("shell environment policy events are public and replayable", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "shell.env.policy.applied",
      sessionID: "ses_history",
      turnID: "msg_shell_env",
      messageID: "msg_shell_env",
      data: {
        mode: "clear",
        removedKeys: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
        inheritedKeys: ["PATH"],
        overrideKeys: [],
        outputKeys: ["PATH", "HOME"],
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_shell_env" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "shell.env.policy.applied",
        status: "applied",
        data: expect.objectContaining({
          removedKeys: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
        }),
      }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(["sandbox"])
  expect(records[0].data.phase).toBe("shell.env.policy.applied")
})

test("unified exec command events are public and replayable", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      AialraTurnTrace.emit({
        phase: "exec_command.started",
        sessionID: "ses_history",
        turnID: "msg_exec",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.exec_command.v1",
          command_id: "exec_call_shell",
          tool_call_id: "call_shell",
          environment_id: "default",
          cwd: "/workspace",
          command: "printf ok",
          shell: "/bin/sh",
          argv: ["/bin/sh", "-c", "printf ok"],
          backend: "codex_exec_server",
          process_id: "proc_exec_call_shell",
          permission_profile_id: ":workspace",
          approval_policy: "on-request",
          network_policy: "off",
          timeout_ms: 300000,
          status: "started",
        },
      }),
      AialraTurnTrace.emit({
        phase: "exec_command.output",
        sessionID: "ses_history",
        turnID: "msg_exec",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.exec_command.v1",
          command_id: "exec_call_shell",
          tool_call_id: "call_shell",
          stream: "stdout",
          seq: 0,
          chars: 2,
          preview: "ok",
          status: "output",
        },
      }),
      AialraTurnTrace.emit({
        phase: "exec_command.output_delta",
        sessionID: "ses_history",
        turnID: "msg_exec",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.exec_command_output_delta.v1",
          process_id: "proc_exec_call_shell",
          command_id: "exec_call_shell",
          tool_call_id: "call_shell",
          backend: "codex_exec_server",
          stream: "stdout",
          channel: "stdout",
          source_stream: "stdout",
          seq: 0,
          sequence: 0,
          byte_length: 2,
          cumulative_byte_length: 2,
          byte_offset_start: 0,
          byte_offset_end: 2,
          char_length: 2,
          encoding: "base64",
          base64_payload: Buffer.from("ok").toString("base64"),
          delta_base64: Buffer.from("ok").toString("base64"),
          timestamp: "2026-06-04T00:00:00.000Z",
          cap_reached: false,
          truncation_marker: null,
          preview: "ok",
          codex_command_exec: {
            method: "command/exec/outputDelta",
            processId: "proc_exec_call_shell",
            stream: "stdout",
            deltaBase64: Buffer.from("ok").toString("base64"),
            capReached: false,
          },
          codex_item: {
            method: "item/commandExecution/outputDelta",
            threadId: "ses_history",
            turnId: "msg_exec",
            itemId: "call_shell",
            delta: "ok",
          },
        },
      }),
      AialraTurnTrace.emit({
        phase: "exec_command.end",
        sessionID: "ses_history",
        turnID: "msg_exec",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.exec_command_end.v1",
          process_id: "proc_exec_call_shell",
          command_id: "exec_call_shell",
          tool_call_id: "call_shell",
          backend: "codex_exec_server",
          status: "completed",
          exit_code: 0,
          signal: null,
          started_at: 100,
          ended_at: 112,
          duration_ms: 12,
          output_summary: { chars: 2, preview: "ok", truncated: false },
          terminal_state: {
            completed: true,
            failed: false,
            timeout: false,
            aborted: false,
            cleaned_up: false,
          },
          codex_item: {
            method: "item/commandExecution/end",
            threadId: "ses_history",
            turnId: "msg_exec",
            itemId: "call_shell",
            processId: "proc_exec_call_shell",
            status: "completed",
            exitCode: 0,
            signal: null,
          },
        },
      }),
      AialraTurnTrace.emit({
        phase: "exec_command.finished",
        sessionID: "ses_history",
        turnID: "msg_exec",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.exec_command.v1",
          command_id: "exec_call_shell",
          tool_call_id: "call_shell",
          backend: "codex_exec_server",
          exit_code: 0,
          timed_out: false,
          aborted: false,
          duration_ms: 12,
          status: "completed",
        },
      }),
      AialraTurnTrace.emit({
        phase: "exec_command.yielded",
        sessionID: "ses_history",
        turnID: "msg_exec",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.exec_command.v1",
          command_id: "exec_call_shell_2",
          tool_call_id: "call_shell_2",
          backend: "node_bun",
          process_id: "proc_exec_call_shell_2",
          requested_yield_time_ms: 1,
          effective_yield_time_ms: 250,
          yield_time_clamped: true,
          status: "running",
        },
      }),
      AialraTurnTrace.emit({
        phase: "exec_process.registered",
        sessionID: "ses_history",
        turnID: "msg_exec",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.exec_process.v1",
          process_id: "proc_exec_call_shell_2",
          command_id: "exec_call_shell_2",
          tool_call_id: "call_shell_2",
          backend: "node_bun",
          cwd: "/workspace",
          command: "sleep 1",
          status: "running",
        },
      }),
      AialraTurnTrace.emit({
        phase: "exec_process.finished",
        sessionID: "ses_history",
        turnID: "msg_exec",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.exec_process.v1",
          process_id: "proc_exec_call_shell_2",
          command_id: "exec_call_shell_2",
          tool_call_id: "call_shell_2",
          backend: "node_bun",
          status: "completed",
          exit_code: 0,
        },
      }),
      AialraTurnTrace.emit({
        phase: "terminal.stdin.written",
        sessionID: "ses_history",
        turnID: "msg_exec",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.terminal.stdin.v1",
          process_id: "proc_exec_call_shell_2",
          command_id: "exec_call_shell_2",
          tool_call_id: "call_stdin",
          backend: "node_bun",
          status: "written",
          control: "newline",
          chars: 6,
          preview: "hello\\n",
        },
      }),
      AialraTurnTrace.emit({
        phase: "terminal.stdin.denied",
        sessionID: "ses_history",
        turnID: "msg_exec",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.terminal.stdin.v1",
          process_id: "proc_missing",
          tool_call_id: "call_stdin_2",
          status: "denied",
          reason: "process_not_found",
          control: "text",
          chars: 2,
          preview: "hi",
        },
      }),
      AialraTurnTrace.emit({
        phase: "terminal.interaction",
        sessionID: "ses_history",
        turnID: "msg_exec",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.terminal_interaction.v1",
          phase: "process_running",
          process_id: "proc_exec_call_shell_2",
          command_id: "exec_call_shell_2",
          tool_call_id: "call_shell_2",
          status: "running",
          codex: {
            method: "item/commandExecution/terminalInteraction",
            threadId: "ses_history",
            turnId: "msg_exec",
            itemId: "call_shell_2",
            processId: "proc_exec_call_shell_2",
            stdin: "",
          },
        },
      }),
    ], { concurrency: 1 }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" }).filter(
    (event) =>
      event.type.startsWith("exec_command.") ||
      event.type.startsWith("exec_process.") ||
      event.type.startsWith("terminal.stdin.") ||
      event.type === "terminal.interaction",
  )
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_exec" })
  expect(events.map((event) => event.type)).toEqual([
    "exec_command.started",
    "exec_command.output",
    "exec_command.output_delta",
    "exec_command.end",
    "exec_command.finished",
    "exec_command.yielded",
    "exec_process.registered",
    "exec_process.finished",
    "terminal.stdin.written",
    "terminal.stdin.denied",
    "terminal.interaction",
  ])
  expect(events[0]).toEqual(
    expect.objectContaining({
      title: "统一命令开始",
      toolCallID: "call_shell",
      data: expect.objectContaining({
        command_id: "exec_call_shell",
        cwd: "/workspace",
        backend: "codex_exec_server",
        permission_profile_id: ":workspace",
      }),
    }),
  )
  expect(events[2]).toEqual(
    expect.objectContaining({
      type: "exec_command.output_delta",
      title: "统一命令输出增量",
      status: "delta",
      data: expect.objectContaining({
        encoding: "base64",
        byte_length: 2,
        cumulative_byte_length: 2,
        byte_offset_start: 0,
        byte_offset_end: 2,
        codex_command_exec: expect.objectContaining({ method: "command/exec/outputDelta" }),
      }),
      rawRef: expect.objectContaining({ eventID: events[2].id }),
    }),
  )
  expect(events[2].data.delta_base64).toBeUndefined()
  expect((events[2].data.codex_command_exec as Record<string, unknown>).deltaBase64).toBeUndefined()
  expect((events[2].data.codex_item as Record<string, unknown>).delta).toBeUndefined()
  expect(PublicEventLog.readRaw({ sessionID: "ses_history", eventID: events[2].id })).toEqual(
    expect.objectContaining({
      base64_payload: Buffer.from("ok").toString("base64"),
      raw_payload: expect.objectContaining({
        delta_base64: Buffer.from("ok").toString("base64"),
        codex_command_exec: expect.objectContaining({
          deltaBase64: Buffer.from("ok").toString("base64"),
        }),
        codex_item: expect.objectContaining({ delta: "ok" }),
      }),
    }),
  )
  expect(events[4]).toEqual(
    expect.objectContaining({
      type: "exec_command.finished",
      title: "统一命令结束",
      status: "completed",
    }),
  )
  expect(events[3]).toEqual(
    expect.objectContaining({
      type: "exec_command.end",
      title: "统一命令标准终态",
      status: "completed",
      data: expect.objectContaining({
        exit_code: 0,
        terminal_state: expect.objectContaining({ completed: true, aborted: false }),
        codex_item: expect.objectContaining({ method: "item/commandExecution/end" }),
      }),
    }),
  )
  expect(events[5]).toEqual(
    expect.objectContaining({
      type: "exec_command.yielded",
      title: "统一命令已让出",
      status: "running",
      data: expect.objectContaining({
        effective_yield_time_ms: 250,
        yield_time_clamped: true,
      }),
    }),
  )
  expect(events[6]).toEqual(
    expect.objectContaining({
      type: "exec_process.registered",
      title: "后台进程已登记",
      status: "running",
      data: expect.objectContaining({ process_id: "proc_exec_call_shell_2" }),
    }),
  )
  expect(events[7]).toEqual(
    expect.objectContaining({
      type: "exec_process.finished",
      title: "后台进程已结束",
      status: "completed",
      data: expect.objectContaining({ exit_code: 0 }),
    }),
  )
  expect(events[8]).toEqual(
    expect.objectContaining({
      type: "terminal.stdin.written",
      title: "终端输入已写入",
      status: "written",
      toolCallID: "call_stdin",
      data: expect.objectContaining({ control: "newline", preview: "hello\\n" }),
    }),
  )
  expect(events[9]).toEqual(
    expect.objectContaining({
      type: "terminal.stdin.denied",
      title: "终端输入被拒绝",
      status: "denied",
      toolCallID: "call_stdin_2",
      data: expect.objectContaining({ reason: "process_not_found" }),
    }),
  )
  expect(events[10]).toEqual(
    expect.objectContaining({
      type: "terminal.interaction",
      title: "终端交互事件",
      status: "running",
      data: expect.objectContaining({
        phase: "process_running",
        codex: expect.objectContaining({ method: "item/commandExecution/terminalInteraction" }),
      }),
    }),
  )
  expect(records.map((record) => record.data.kind)).toEqual([
    "command",
    "command",
    "command",
    "command",
    "command",
    "command",
    "command",
    "command",
    "command",
    "command",
    "command",
  ])
  expect(records[3].data.context).toEqual(
    expect.objectContaining({
      status: "completed",
      exit_code: 0,
    }),
  )
})

test("exec command end emits one immutable terminal state", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      ExecCommandEnd.emit({
        sessionID: "ses_history",
        turnID: "msg_exec_once",
        messageID: "msg_assistant",
        toolCallID: "call_shell_once",
        processID: "proc_exec_once",
        commandID: "exec_once",
        backend: "node_bun",
        cwd: "/workspace",
        command: "printf ok",
        exitCode: 0,
        status: "completed",
        outputChars: 2,
      }),
      ExecCommandEnd.emit({
        sessionID: "ses_history",
        turnID: "msg_exec_once",
        messageID: "msg_assistant",
        toolCallID: "call_shell_once",
        processID: "proc_exec_once",
        commandID: "exec_once",
        backend: "node_bun",
        cwd: "/workspace",
        command: "printf ok",
        exitCode: null,
        status: "aborted",
        abortReason: "late_abort",
      }),
    ], { concurrency: 1 }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" }).filter((event) => event.type === "exec_command.end")
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_exec_once" })
  expect(events).toHaveLength(1)
  expect(events[0]).toEqual(
    expect.objectContaining({
      status: "completed",
      data: expect.objectContaining({
        status: "completed",
        terminal_state: expect.objectContaining({ completed: true, aborted: false }),
      }),
    }),
  )
  expect(records.map((record) => record.type)).toEqual(["turn.context.item"])
  expect(records.map((record) => record.data.phase)).toEqual(["exec_command.end"])
})

test("reasoning summary events are public and replayable as model context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "reasoning.summary.created",
      sessionID: "ses_history",
      turnID: "msg_reasoning",
      messageID: "msg_assistant",
      data: {
        version: "aialra.reasoning_summary.v1",
        reasoningID: "reasoning-1",
        partID: "prt_reasoning",
        enabled: true,
        level: "brief",
        auto_collapse: true,
        per_turn: true,
        tool_linked: true,
        summary: "模型先定位失败测试，再决定调用 grep 查找相关实现",
        summaryChars: 25,
        sourceChars: 120,
        toolLinks: [{ callID: "call_grep", tool: "grep", phase: "tool-call", linkedAt: 100 }],
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_reasoning" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "reasoning.summary.created",
        status: "created",
        title: "Reasoning summary created",
        data: expect.objectContaining({
          reasoningID: "reasoning-1",
          toolLinks: [expect.objectContaining({ callID: "call_grep", tool: "grep" })],
        }),
      }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(["model"])
  expect(records[0].data.phase).toBe("reasoning.summary.created")
})

test("service tier resolution events are public and replayable as model context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "model.service_tier.resolved",
      sessionID: "ses_history",
      turnID: "msg_service_tier",
      messageID: "msg_service_tier",
      data: {
        requested_service_tier: "fast",
        effective_service_tier: "priority",
        service_tier_resolution: {
          version: "aialra.service_tier_resolution.v1",
          requested: "fast",
          effective: "priority",
          provider_tier: "priority",
          source: "turn_settings",
          supported: ["default", "priority"],
          mapping: { fast: "priority" },
          fallback: { applied: false },
          scheduling: { latency: "priority", cost: "premium", background: false },
        },
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_service_tier" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "model.service_tier.resolved",
        status: "resolved",
        data: expect.objectContaining({
          requested_service_tier: "fast",
          effective_service_tier: "priority",
        }),
      }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(["model"])
  expect(records[0].data.phase).toBe("model.service_tier.resolved")
})

test("dynamic tool resolution events are public and replayable as tool context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "tools.dynamic.resolved",
      sessionID: "ses_history",
      turnID: "msg_dynamic_tools",
      messageID: "msg_dynamic_tools",
      data: {
        version: "aialra.dynamic_tools.v1",
        availableCount: 1,
        disabledCount: 1,
        available_ids: ["read"],
        disabled_ids: ["bash"],
        available: [{ id: "read", source: "registry", status: "available", reasons: [], schema_projected: true }],
        disabled: [
          {
            id: "bash",
            source: "registry",
            status: "disabled",
            reasons: ["权限规则或当前 permission profile 禁用该工具"],
            schema_projected: true,
          },
        ],
        resolver: {
          permission_profile: { id: ":read-only" },
          approval_policy: "never",
          model_supports_tools: true,
          selected_environment_id: "default",
        },
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_dynamic_tools" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "tools.dynamic.resolved",
        status: "resolved",
        data: expect.objectContaining({ availableCount: 1, disabledCount: 1 }),
      }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(["tool"])
  expect(records[0].data.phase).toBe("tools.dynamic.resolved")
})

test("tool foundation events are public and replayable as tool context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      AialraTurnTrace.emit({
        phase: "tool.foundation.resolved",
        sessionID: "ses_history",
        turnID: "msg_tool_foundation",
        messageID: "msg_tool_foundation",
        data: {
          version: "aialra.tool_foundation.v1",
          upstream: "opencode-v2",
          toolCount: 2,
        },
      }),
      AialraTurnTrace.emit({
        phase: "tool.foundation.executing",
        sessionID: "ses_history",
        turnID: "msg_tool_foundation",
        messageID: "msg_assistant",
        data: {
          tool: "write",
          callID: "call_write",
          source: "opencode_registry",
        },
      }),
      AialraTurnTrace.emit({
        phase: "tool.foundation.settled",
        sessionID: "ses_history",
        turnID: "msg_tool_foundation",
        messageID: "msg_assistant",
        data: {
          tool: "write",
          callID: "call_write",
          source: "opencode_registry",
          status: "completed",
        },
      }),
    ]),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_tool_foundation" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "tool.foundation.resolved", status: "resolved" }),
      expect.objectContaining({ type: "tool.foundation.executing", status: "executing", toolCallID: "call_write" }),
      expect.objectContaining({ type: "tool.foundation.settled", status: "completed", toolCallID: "call_write" }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(["tool", "tool", "tool"])
})

test("tool lifecycle events are public and replayable as tool context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      AialraTurnTrace.emit({
        phase: "tool.lifecycle.requested",
        sessionID: "ses_history",
        turnID: "msg_tool_lifecycle",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.tool_lifecycle.v1",
          tool: "write",
          callID: "call_write",
          status: "requested",
          permission_profile: "workspace-write",
          environment_cwd: "/workspace",
        },
      }),
      AialraTurnTrace.emit({
        phase: "tool.lifecycle.completed",
        sessionID: "ses_history",
        turnID: "msg_tool_lifecycle",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.tool_lifecycle.v1",
          tool: "write",
          callID: "call_write",
          status: "completed",
          durationMs: 10,
        },
      }),
    ]),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_tool_lifecycle" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "tool.lifecycle.requested", status: "requested", toolCallID: "call_write" }),
      expect.objectContaining({ type: "tool.lifecycle.completed", status: "completed", toolCallID: "call_write" }),
      expect.objectContaining({ type: "item.lifecycle.started", status: "started", toolCallID: "call_write" }),
      expect.objectContaining({ type: "item.lifecycle.completed", status: "completed", toolCallID: "call_write" }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(expect.arrayContaining(["tool", "tool", "runtime", "runtime"]))
  expect(records.map((record) => record.data.phase)).toEqual(
    expect.arrayContaining([
      "tool.lifecycle.requested",
      "tool.lifecycle.completed",
      "item.lifecycle.started",
      "item.lifecycle.completed",
    ]),
  )
})

test("tool output store events are public and replayable as tool context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "tool.output.stored",
      sessionID: "ses_history",
      turnID: "msg_tool_output",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.tool_output_ref.v1",
        id: "tool_output_1",
        tool: "bash",
        callID: "call_bash",
        path: "/tmp/tool_output_1",
        bytes: 123,
        truncated: true,
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_tool_output" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "tool.output.stored", status: "stored", toolCallID: "call_bash" }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(["tool"])
})

test("tool result settlement events are public and replayable as final tool result context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "tool.result.settled",
      sessionID: "ses_history",
      turnID: "msg_tool_result",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.tool_result_settlement.v1",
        resultID: "tool_result_call_bash",
        toolCallID: "call_bash",
        tool: "bash",
        status: "completed",
        sessionID: "ses_history",
        turnID: "msg_tool_result",
        messageID: "msg_assistant",
        completedAt: new Date().toISOString(),
        durationMs: 12,
        visibleOutputChars: 2,
        visibleOutputPreview: "ok",
        rawOutputRef: { schema: "aialra.tool_output_ref.v1", id: "tool_output_1" },
        attachments: 0,
        providerExecuted: false,
        fileMutations: [],
        metadataKeys: ["outputRef"],
        source: "processor",
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_tool_result" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "tool.result.settled", status: "completed", toolCallID: "call_bash" }),
      expect.objectContaining({ type: "item.lifecycle.completed", status: "completed", toolCallID: "call_bash" }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(expect.arrayContaining(["tool", "runtime"]))
  const toolRecord = records.find((record) => record.data.phase === "tool.result.settled")
  expect(toolRecord?.data.context).toEqual(
    expect.objectContaining({
      schema: "aialra.tool_result_settlement.v1",
      resultID: "tool_result_call_bash",
      status: "completed",
    }),
  )
})

test("file read events are public and replayable with environment metadata", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "file.read",
      sessionID: "ses_history",
      turnID: "msg_file_read",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.file_read.v1",
        tool: "read",
        status: "completed",
        kind: "file",
        session_id: "ses_history",
        turn_id: "msg_file_read",
        message_id: "msg_assistant",
        call_id: "call_read",
        environment_id: "selected",
        environment_cwd: "/tmp/selected",
        requested_path: "README.md",
        resolved_path: "/tmp/selected/README.md",
        read_range: { offset: 1, limit: 2000, start: 1, end: 1, total: 1 },
        truncation: { truncated: false },
        permission_decision: { status: "allowed", source: "turn_context" },
        output_chars: 128,
        preview: "hello",
        loaded_files: [],
        raw_ref: { schema: "aialra.tool_output_ref.v1", id: "raw_read" },
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_file_read" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "file.read",
        status: "completed",
        toolCallID: "call_read",
        summary: expect.stringContaining("selected"),
      }),
    ]),
  )
  expect(records[0]?.data.kind).toBe("file")
  expect(records[0]?.data.context).toEqual(
    expect.objectContaining({
      schema: "aialra.file_read.v1",
      environment_id: "selected",
      raw_ref: expect.objectContaining({ id: "raw_read" }),
    }),
  )
})

test("file write events are public and replayable with mutation metadata", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "file.write",
      sessionID: "ses_history",
      turnID: "msg_file_write",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.file_write.v1",
        tool: "write",
        status: "completed",
        call_id: "call_write",
        environment_id: "default",
        environment_cwd: "/workspace",
        requested_path: "created.txt",
        resolved_path: "/workspace/created.txt",
        policy: {
          overwrite: "allow",
          dry_run: false,
          encoding: "utf-8",
          preserves_bom: false,
          atomic: false,
          atomic_reason: "codex_fs_rename_api_unavailable",
        },
        before: { exists: false },
        after: { exists: true, size: 2, sha256: "ok" },
        mutation: {
          schema: "aialra.file_mutation.v1",
          mutation_id: "file_mutation_call_write",
          tool: "write",
          operation: "create",
          applied: true,
          requested_path: "created.txt",
          resolved_path: "/workspace/created.txt",
          environment_id: "default",
          before: { exists: false },
          after: { exists: true, size: 2, sha256: "ok" },
          diff: { chars_added: 2, chars_removed: 0, patch_chars: 20 },
        },
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_file_write" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "file.write",
        title: "写入文件：/workspace/created.txt",
        toolCallID: "call_write",
        data: expect.objectContaining({
          schema: "aialra.file_write.v1",
          mutation: expect.objectContaining({ operation: "create" }),
        }),
      }),
    ]),
  )
  expect(records[0]?.data.kind).toBe("file")
  expect(records[0]?.data.context).toEqual(
    expect.objectContaining({
      schema: "aialra.file_write.v1",
      mutation: expect.objectContaining({ operation: "create" }),
    }),
  )
})

test("file search events are public and replayable with search metadata", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "file.search",
      sessionID: "ses_history",
      turnID: "msg_file_search",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.file_search.v1",
        tool: "glob",
        status: "completed",
        call_id: "call_glob",
        environment_id: "default",
        environment_cwd: "/workspace",
        requested_pattern: "**/*.ts",
        requested_path: ".",
        search_cwd: "/workspace",
        backend: { name: "ripgrep_files" },
        limits: { max_results: 100, max_scan: 500, max_path_chars: 4096 },
        filters: { show_hidden: true, follow_symlinks: false, protected_policy: "hide", ignore: [] },
        counts: {
          scanned: 2,
          returned: 1,
          hidden_filtered: 0,
          protected_filtered: 1,
          path_too_long_filtered: 0,
          sandbox_filtered: 0,
          other_filtered: 0,
        },
        truncation: { truncated: false },
        results: [{ path: "/workspace/src/index.ts", relative_path: "src/index.ts", mtime_ms: 1 }],
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_file_search" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "file.search",
        title: "搜索文件：**/*.ts",
        toolCallID: "call_glob",
        data: expect.objectContaining({
          schema: "aialra.file_search.v1",
          counts: expect.objectContaining({ returned: 1, protected_filtered: 1 }),
        }),
      }),
    ]),
  )
  expect(records[0]?.data.kind).toBe("file")
  expect(records[0]?.data.context).toEqual(
    expect.objectContaining({
      schema: "aialra.file_search.v1",
      tool: "glob",
      requested_pattern: "**/*.ts",
    }),
  )
})

test("grep search events carry match metadata for public replay", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "file.search",
      sessionID: "ses_history",
      turnID: "msg_grep_search",
      messageID: "msg_assistant",
      data: {
        schema: "aialra.file_search.v1",
        tool: "grep",
        status: "completed",
        call_id: "call_grep",
        environment_id: "default",
        environment_cwd: "/workspace",
        requested_pattern: "needle",
        requested_path: ".",
        search_cwd: "/workspace",
        backend: {
          name: "ripgrep_search",
          fallback_reason: "Codex exec-server has no fs/grep API; using TurnContext-gated ripgrep adapter",
        },
        limits: { max_results: 10, max_scan: 50, timeout_ms: 1000, max_path_chars: 4096 },
        filters: { show_hidden: false, follow_symlinks: false, protected_policy: "hide", ignore: ["dist/**"] },
        counts: {
          scanned: 3,
          returned: 1,
          matched_files: 1,
          hidden_filtered: 1,
          protected_filtered: 0,
          path_too_long_filtered: 0,
          sandbox_filtered: 1,
          other_filtered: 0,
        },
        grep: {
          include: "*.ts",
          total_matches: 1,
          returned_matches: 1,
          context_lines: 1,
          max_line_chars: 2000,
          partial: false,
        },
        truncation: { truncated: false },
        results: [{ path: "/workspace/src/index.ts", relative_path: "src/index.ts", mtime_ms: 1 }],
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_grep_search" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "file.search",
        title: "搜索文件：needle",
        toolCallID: "call_grep",
        data: expect.objectContaining({
          tool: "grep",
          backend: expect.objectContaining({ name: "ripgrep_search" }),
          grep: expect.objectContaining({ include: "*.ts", context_lines: 1 }),
          counts: expect.objectContaining({ returned: 1, sandbox_filtered: 1 }),
        }),
      }),
    ]),
  )
  expect(records[0]?.data.kind).toBe("file")
  expect(records[0]?.data.context).toEqual(
    expect.objectContaining({
      schema: "aialra.file_search.v1",
      tool: "grep",
      requested_pattern: "needle",
    }),
  )
})

test("provider-executed tool events are public and replayable as hosted tool context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      AialraTurnTrace.emit({
        phase: "provider.tool.call",
        sessionID: "ses_history",
        turnID: "msg_provider_tool",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.provider_tool_item.v1",
          itemKind: "provider_tool_call",
          executor_type: "provider",
          provider_tool_type: "web_search",
          toolCallID: "call_provider",
          callID: "call_provider",
          tool: "web_search",
          inputKeys: ["query"],
          providerExecution: {
            schema: "aialra.provider_execution.v1",
            executor_type: "provider",
            provider_tool_type: "web_search",
            provider_tool_kind: "provider_tool_call",
            hosted: true,
            tool_call_id: "call_provider",
            tool: "web_search",
            status: "called",
            provider_metadata_keys: [],
            provider_metadata_sources: [],
            output_store_supported: false,
            replay_supported: true,
            audit_supported: true,
            support_scope: ["unified_tool_item", "tool_result_settlement", "raw_output_ref", "history_replay", "public_event", "web_search"],
            support_gaps: [
              "provider executes the tool remotely; local sandbox/cwd gates are audited but do not execute the hosted operation",
            ],
            source: "llm_stream",
          },
        },
      }),
      AialraTurnTrace.emit({
        phase: "provider.tool.result",
        sessionID: "ses_history",
        turnID: "msg_provider_tool",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.provider_tool_item.v1",
          itemKind: "provider_tool_result",
          executor_type: "provider",
          provider_tool_type: "web_search",
          toolCallID: "call_provider",
          callID: "call_provider",
          tool: "web_search",
          status: "completed",
          resultID: "tool_result_call_provider",
          rawOutputRef: { schema: "aialra.tool_output_ref.v1", id: "tool_output_provider" },
          providerExecution: {
            schema: "aialra.provider_execution.v1",
            executor_type: "provider",
            provider_tool_type: "web_search",
            provider_tool_kind: "provider_tool_result",
            hosted: true,
            tool_call_id: "call_provider",
            tool: "web_search",
            status: "completed",
            provider_metadata_keys: [],
            provider_metadata_sources: [],
            raw_output_ref: { schema: "aialra.tool_output_ref.v1", id: "tool_output_provider" },
            output_store_supported: true,
            replay_supported: true,
            audit_supported: true,
            support_scope: ["unified_tool_item", "tool_result_settlement", "raw_output_ref", "history_replay", "public_event", "web_search"],
            support_gaps: [
              "provider executes the tool remotely; local sandbox/cwd gates are audited but do not execute the hosted operation",
            ],
            source: "llm_stream",
          },
        },
      }),
    ]),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_provider_tool" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "provider.tool.call", status: "called", toolCallID: "call_provider" }),
      expect.objectContaining({ type: "provider.tool.result", status: "completed", toolCallID: "call_provider" }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(["tool", "tool"])
  expect(records[1]?.data.context).toEqual(
    expect.objectContaining({
      schema: "aialra.provider_tool_item.v1",
      itemKind: "provider_tool_result",
      executor_type: "provider",
      provider_tool_type: "web_search",
      providerExecution: expect.objectContaining({
        schema: "aialra.provider_execution.v1",
        provider_tool_type: "web_search",
        output_store_supported: true,
      }),
    }),
  )
})

test("skill catalog and usage events are public and replayable as tool context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "skill.catalog.resolved",
      sessionID: "ses_history",
      turnID: "msg_skill_catalog",
      messageID: "msg_skill_catalog",
      data: {
        version: "aialra.skill_catalog.v1",
        availableCount: 1,
        disabledCount: 0,
        available_ids: ["frontend-skill"],
        disabled_ids: [],
        injected_ids: [],
        used_ids: [],
        available: [
          {
            skill_id: "frontend-skill",
            name: "frontend-skill",
            source: "project",
            description: "Build UI",
            location: "/workspace/skills/frontend/SKILL.md",
            applicable: true,
            prompt_injected: false,
            used: false,
            usage_count: 0,
            tools: ["skill"],
            mcp_resources: [],
            commands: ["npm test"],
            external_resources: [],
            permission_requirements: ["skill:frontend-skill"],
            disabled_reasons: [],
          },
        ],
        disabled: [],
        resolver: {
          agent: "build",
          permission_profile: { id: ":workspace" },
          approval_policy: "on-request",
          selected_environment_id: "default",
        },
      },
    }),
  )
  await Effect.runPromise(
    AialraTurnTrace.emit({
      phase: "skill.used",
      sessionID: "ses_history",
      turnID: "msg_skill_catalog",
      messageID: "msg_skill_catalog",
      data: {
        name: "frontend-skill",
        callID: "call_skill",
        used_ids: ["frontend-skill"],
        usage_count: 1,
      },
    }),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" })
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_skill_catalog" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "skill.catalog.resolved",
        status: "resolved",
        data: expect.objectContaining({ availableCount: 1 }),
      }),
      expect.objectContaining({
        type: "skill.used",
        status: "used",
        toolCallID: "call_skill",
      }),
    ]),
  )
  expect(records.map((record) => record.data.kind)).toEqual(["tool", "tool"])
})

test("exec approval events are public and replayable as approval context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      AialraTurnTrace.emit({
        phase: "exec.approval.requested",
        sessionID: "ses_history",
        turnID: "msg_exec_approval",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.exec_approval_request.v1",
          command_id: "exec_call_shell",
          process_id: "proc_exec_call_shell",
          tool_call_id: "call_shell",
          command: "pwd",
          argv: ["/bin/sh", "-c", "pwd"],
          cwd: "/workspace",
          environment_id: "default",
          permission_profile_id: ":workspace",
          network_policy: "off",
          shell_env_policy: { mode: "clear" },
          risk_level: "low",
          reason: "command_policy",
          constraints_result: { reason: "command_policy" },
          requested_by: "assistant_tool",
          reviewer: { role: "user", id: "current_user" },
          approval_scope: { default_scope: "once-command" },
          expires_at: "turn_end",
          final_decision: { status: "pending" },
        },
      }),
      AialraTurnTrace.emit({
        phase: "exec.approval.resolved",
        sessionID: "ses_history",
        turnID: "msg_exec_approval",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.exec_approval_result.v1",
          request_id: "perm_1",
          reply: "once",
          scope: "once-command",
          review_result: "approved",
          review_reason: "manual approval",
          final_decision: { status: "approved", scope: "once-command" },
        },
      }),
    ]),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" }).filter((event) =>
    event.type.startsWith("exec.approval."),
  )
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_exec_approval" })
  expect(events.map((event) => event.type)).toEqual(["exec.approval.requested", "exec.approval.resolved"])
  expect(records.map((record) => record.data.kind)).toEqual(["approval", "approval"])
})

test("apply patch approval events are public and replayable as approval context", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      AialraTurnTrace.emit({
        phase: "apply_patch.approval.requested",
        sessionID: "ses_history",
        turnID: "msg_patch_approval",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.apply_patch_approval_request.v1",
          patch_sha256: "sha256",
          hunk_count: 1,
          risk_level: "low",
          affected_files: [{ requested_path: "result.txt", operation: "overwrite" }],
          final_decision: { status: "pending" },
        },
      }),
      AialraTurnTrace.emit({
        phase: "apply_patch.approval.resolved",
        sessionID: "ses_history",
        turnID: "msg_patch_approval",
        messageID: "msg_assistant",
        data: {
          schema: "aialra.apply_patch_approval_result.v1",
          reply: "once",
          scope: "once-command",
          review_result: "approved",
          final_decision: { status: "approved", scope: "once-command" },
        },
      }),
    ]),
  )

  const events = PublicEventLog.list({ sessionID: "ses_history" }).filter((event) =>
    event.type.startsWith("apply_patch.approval."),
  )
  const records = TurnHistory.list({ sessionID: "ses_history", turnID: "msg_patch_approval" })
  expect(events.map((event) => event.type)).toEqual([
    "apply_patch.approval.requested",
    "apply_patch.approval.resolved",
  ])
  expect(records.map((record) => record.data.kind)).toEqual(["approval", "approval"])
})

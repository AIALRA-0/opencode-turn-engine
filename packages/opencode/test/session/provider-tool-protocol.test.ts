import { expect, test } from "bun:test"
import { ProviderToolProtocol } from "../../src/session/provider-tool-protocol"
import { ToolResultProtocol } from "../../src/session/tool-result-settlement"

test("provider tool protocol classifies hosted tools and records support gaps", () => {
  expect(ProviderToolProtocol.ProviderTool.classify("web_search_preview", { openai: { type: "web_search" } })).toBe(
    "web_search",
  )
  expect(ProviderToolProtocol.ProviderTool.classify("code_interpreter", { openai: { container: "python" } })).toBe(
    "code_interpreter",
  )
  expect(ProviderToolProtocol.ProviderTool.classify("mystery_hosted_tool", { provider: { opaque: true } })).toBe(
    "unknown_hosted",
  )

  const execution = ProviderToolProtocol.ProviderTool.execution({
    toolCallID: "call_provider",
    tool: "mystery_hosted_tool",
    kind: "provider_tool_result",
    status: "completed",
    providerMetadata: { provider: { opaque: true } },
    rawOutputRef: { schema: "aialra.tool_output_ref.v1", id: "raw_provider" },
    outputChars: 12,
  })

  expect(execution).toEqual(
    expect.objectContaining({
      schema: "aialra.provider_execution.v1",
      executor_type: "provider",
      provider_tool_type: "unknown_hosted",
      provider_tool_kind: "provider_tool_result",
      output_store_supported: true,
      replay_supported: true,
      audit_supported: true,
      support_gaps: expect.arrayContaining(["provider specific semantics are preserved as raw metadata but not normalized yet"]),
    }),
  )
})

test("provider execution metadata is carried by tool settlement without losing raw output ref", () => {
  const providerExecution = ProviderToolProtocol.ProviderTool.execution({
    toolCallID: "call_provider",
    tool: "web_search",
    kind: "provider_tool_result",
    status: "completed",
    rawOutputRef: { schema: "aialra.tool_output_ref.v1", id: "raw_provider" },
    outputChars: 4_200,
    visibleOutputTruncated: true,
  })
  const result = ToolResultProtocol.ToolResultSettlement.build({
    sessionID: "ses_provider",
    turnID: "msg_turn",
    messageID: "msg_assistant",
    toolCallID: "call_provider",
    tool: "web_search",
    status: "completed",
    completedAt: 1_700_000_000_000,
    output: "x".repeat(4_200),
    metadata: ProviderToolProtocol.ProviderTool.attach(
      { outputRef: { schema: "aialra.tool_output_ref.v1", id: "raw_provider" } },
      providerExecution,
    ),
    providerExecuted: true,
    source: "provider_tool",
  })

  expect(result.provider_execution).toEqual(
    expect.objectContaining({
      schema: "aialra.provider_execution.v1",
      provider_tool_type: "web_search",
      visible_output_truncated: true,
      raw_output_ref: expect.objectContaining({ id: "raw_provider" }),
    }),
  )
  expect(result.visible_output_truncated).toBe(true)
  expect(result.visible_output).toContain("visible output truncated")
  expect(result.raw_output_ref).toEqual(expect.objectContaining({ id: "raw_provider" }))
})

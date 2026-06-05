import { expect, test } from "bun:test"
import { LLMEvent } from "@opencode-ai/llm"
import { RuntimeProtocol } from "../../src/session/runtime-item"

test("runtime item normalizes assistant text stream events", () => {
  expect(RuntimeProtocol.RuntimeItem.fromLLMEvent(LLMEvent.textStart({ id: "text_1" }), 1)).toEqual(
    expect.objectContaining({
      schema: "aialra.runtime_item.v1",
      sequence: 1,
      itemID: "text_1",
      sourceEventType: "text-start",
      kind: "assistant_text_item",
      status: "started",
      contentID: "text_1",
      terminal: false,
    }),
  )

  expect(RuntimeProtocol.RuntimeItem.fromLLMEvent(LLMEvent.textDelta({ id: "text_1", text: "hello" }), 2)).toEqual(
    expect.objectContaining({
      sourceEventType: "text-delta",
      kind: "assistant_text_item",
      status: "delta",
      chars: 5,
    }),
  )
})

test("runtime item normalizes tool call and tool result settlement", () => {
  const call = RuntimeProtocol.RuntimeItem.fromLLMEvent(
    LLMEvent.toolCall({ id: "call_1", name: "read", input: { filePath: "README.md" } }),
    3,
  )
  const result = RuntimeProtocol.RuntimeItem.fromLLMEvent(
    LLMEvent.toolResult({ id: "call_1", name: "read", result: { type: "text", value: "ok" } }),
    4,
  )

  expect(call).toEqual(
    expect.objectContaining({
      sourceEventType: "tool-call",
      kind: "tool_call_item",
      status: "called",
      toolCallID: "call_1",
      tool: "read",
      terminal: false,
    }),
  )
  expect(result).toEqual(
    expect.objectContaining({
      sourceEventType: "tool-result",
      kind: "tool_result_item",
      status: "completed",
      toolCallID: "call_1",
      tool: "read",
      terminal: true,
    }),
  )
  expect(RuntimeProtocol.RuntimeItem.shouldEmitSettled(result)).toBe(true)
})

test("runtime item marks provider-executed hosted tools without changing the unified item shape", () => {
  const call = RuntimeProtocol.RuntimeItem.fromLLMEvent(
    LLMEvent.toolCall({
      id: "call_provider",
      name: "web_search",
      input: { query: "weather" },
      providerExecuted: true,
    }),
    3,
  )
  const result = RuntimeProtocol.RuntimeItem.fromLLMEvent(
    LLMEvent.toolResult({
      id: "call_provider",
      name: "web_search",
      result: { type: "text", value: "sunny" },
      providerExecuted: true,
    }),
    4,
  )

  expect(call).toEqual(
    expect.objectContaining({
      kind: "tool_call_item",
      toolCallID: "call_provider",
      providerExecuted: true,
      executorType: "provider",
      providerToolKind: "provider_tool_call",
      providerToolType: "web_search",
    }),
  )
  expect(result).toEqual(
    expect.objectContaining({
      kind: "tool_result_item",
      toolCallID: "call_provider",
      providerExecuted: true,
      executorType: "provider",
      providerToolKind: "provider_tool_result",
      providerToolType: "web_search",
      terminal: true,
    }),
  )
})

test("runtime item normalizes step finish as terminal turn item", () => {
  const item = RuntimeProtocol.RuntimeItem.fromLLMEvent(LLMEvent.stepFinish({ index: 0, reason: "stop" }), 5)
  expect(item).toEqual(
    expect.objectContaining({
      sourceEventType: "step-finish",
      kind: "turn_item",
      status: "finished",
      finishReason: "stop",
      terminal: true,
    }),
  )
})

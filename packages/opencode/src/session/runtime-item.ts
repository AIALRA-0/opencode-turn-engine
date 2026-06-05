import type { LLMEvent } from "@opencode-ai/llm"
import { ProviderTool, type ProviderToolType } from "./provider-tool-protocol"

export type RuntimeItemKind =
  | "turn_item"
  | "assistant_text_item"
  | "reasoning_item"
  | "tool_call_item"
  | "tool_result_item"
  | "runtime_error_item"

export type RuntimeItemStatus =
  | "started"
  | "delta"
  | "ended"
  | "called"
  | "completed"
  | "error"
  | "finished"

export type RuntimeItem = {
  schema: "aialra.runtime_item.v1"
  sequence: number
  itemID: string
  sourceEventType: LLMEvent["type"]
  kind: RuntimeItemKind
  status: RuntimeItemStatus
  contentID?: string
  toolCallID?: string
  tool?: string
  executorType?: "local" | "provider"
  providerToolKind?: "provider_tool_call" | "provider_tool_result"
  providerToolType?: ProviderToolType
  chars?: number
  finishReason?: string
  providerExecuted?: boolean
  hasProviderMetadata: boolean
  terminal: boolean
}

export namespace RuntimeItem {
  export function fromLLMEvent(event: LLMEvent, sequence: number): RuntimeItem {
    switch (event.type) {
      case "step-start":
        return base(event, sequence, `step_${sequence}`, "turn_item", "started")
      case "step-finish":
        return {
          ...base(event, sequence, `step_${sequence}`, "turn_item", "finished"),
          finishReason: event.reason,
          terminal: true,
        }
      case "finish":
        return { ...base(event, sequence, `finish_${sequence}`, "turn_item", "finished"), terminal: true }
      case "text-start":
        return base(event, sequence, event.id, "assistant_text_item", "started", { contentID: event.id })
      case "text-delta":
        return base(event, sequence, event.id, "assistant_text_item", "delta", {
          contentID: event.id,
          chars: event.text.length,
        })
      case "text-end":
        return base(event, sequence, event.id, "assistant_text_item", "ended", { contentID: event.id })
      case "reasoning-start":
        return base(event, sequence, event.id, "reasoning_item", "started", { contentID: event.id })
      case "reasoning-delta":
        return base(event, sequence, event.id, "reasoning_item", "delta", {
          contentID: event.id,
          chars: event.text.length,
        })
      case "reasoning-end":
        return base(event, sequence, event.id, "reasoning_item", "ended", { contentID: event.id })
      case "tool-input-start":
        return base(event, sequence, event.id, "tool_call_item", "started", {
          toolCallID: event.id,
          tool: event.name,
        })
      case "tool-input-delta":
        return base(event, sequence, event.id, "tool_call_item", "delta", {
          toolCallID: event.id,
          tool: event.name,
          chars: event.text.length,
        })
      case "tool-input-end":
        return base(event, sequence, event.id, "tool_call_item", "ended", {
          toolCallID: event.id,
          tool: event.name,
        })
      case "tool-call":
        return base(event, sequence, event.id, "tool_call_item", "called", {
          toolCallID: event.id,
          tool: event.name,
          providerExecuted: event.providerExecuted,
          executorType: event.providerExecuted ? "provider" : "local",
          providerToolKind: event.providerExecuted ? "provider_tool_call" : undefined,
          providerToolType: event.providerExecuted ? ProviderTool.classify(event.name, event.providerMetadata) : undefined,
        })
      case "tool-result":
        return base(event, sequence, event.id, "tool_result_item", "completed", {
          toolCallID: event.id,
          tool: event.name,
          providerExecuted: event.providerExecuted,
          executorType: event.providerExecuted ? "provider" : "local",
          providerToolKind: event.providerExecuted ? "provider_tool_result" : undefined,
          providerToolType: event.providerExecuted ? ProviderTool.classify(event.name, event.providerMetadata) : undefined,
          terminal: true,
        })
      case "tool-error":
        return base(event, sequence, event.id, "tool_result_item", "error", {
          toolCallID: event.id,
          tool: event.name,
          terminal: true,
        })
      case "provider-error":
        return base(event, sequence, `provider_error_${sequence}`, "runtime_error_item", "error", {
          terminal: true,
        })
    }
  }

  export function shouldEmitSettled(item: RuntimeItem) {
    return (
      item.terminal ||
      item.status === "ended" ||
      item.status === "completed" ||
      item.status === "error" ||
      item.status === "finished"
    )
  }
}

function base(
  event: LLMEvent,
  sequence: number,
  itemID: string,
  kind: RuntimeItemKind,
  status: RuntimeItemStatus,
  extra: Partial<Omit<RuntimeItem, "schema" | "sequence" | "itemID" | "sourceEventType" | "kind" | "status">> = {},
): RuntimeItem {
  return {
    schema: "aialra.runtime_item.v1",
    sequence,
    itemID,
    sourceEventType: event.type,
    kind,
    status,
    hasProviderMetadata: "providerMetadata" in event && event.providerMetadata !== undefined,
    terminal: false,
    ...extra,
  }
}

export * as RuntimeProtocol from "./runtime-item"

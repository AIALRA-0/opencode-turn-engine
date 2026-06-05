import crypto from "node:crypto"
import type { ModelMessage } from "ai"
import type { Agent } from "@/agent/agent"
import type { Provider } from "@/provider/provider"
import type { MessageV2 } from "./message-v2"
import type { Prepared } from "./llm/request"
import type { TurnContext } from "./turn-context"

export const EFFECTIVE_PROMPT_SCHEMA = "aialra.effective_prompt_manifest.v1"
export const EFFECTIVE_PROMPT_VERSION = "aialra-general-engineering-harness-v1"

type EffectivePromptInput = {
  readonly user: MessageV2.User
  readonly sessionID: string
  readonly model: Provider.Model
  readonly agent: Agent.Info
  readonly prepared: Prepared
  readonly requestedSystem: readonly string[]
  readonly toolChoice?: "auto" | "required" | "none"
  readonly isWorkflow: boolean
  readonly small?: boolean
  readonly turn?: TurnContext
}

export type EffectivePromptManifest = ReturnType<typeof buildEffectivePromptManifest>

export function buildEffectivePromptManifest(input: EffectivePromptInput) {
  const toolNames = Object.keys(input.prepared.tools).toSorted((a, b) => a.localeCompare(b))
  const systemChars = input.prepared.system.reduce((total, item) => total + item.length, 0)
  const messageSummary = summarizeMessages(input.prepared.messages)
  const source = promptSources(input)
  const manifest = {
    schema: EFFECTIVE_PROMPT_SCHEMA,
    version: EFFECTIVE_PROMPT_VERSION,
    sessionID: input.sessionID,
    turnID: input.turn?.turnID ?? input.user.id,
    messageID: input.user.id,
    agent: input.agent.name,
    mode: input.agent.mode,
    providerID: input.model.providerID,
    modelID: input.model.id,
    variant: input.user.model.variant,
    isWorkflow: input.isWorkflow,
    small: input.small === true,
    toolChoice: input.toolChoice ?? "auto",
    sources: source.sources,
    sourceCount: source.sources.length,
    modelSpecificDiff: {
      api: input.model.api.npm,
      supportsTools: input.turn?.model_info.supports.tools ?? input.model.capabilities.toolcall,
      supportsStructuredOutput: input.turn?.model_info.supports.structured_output ?? input.model.capabilities.toolcall,
      requestedEffort: input.turn?.effort_resolution.requested,
      effectiveEffort: input.turn?.effort_resolution.effective,
      effortSource: input.turn?.effort_resolution.source,
      serviceTier: input.turn?.effective_service_tier,
      reasoningSummary: input.turn?.summary,
      providerOptionKeys: Object.keys(input.prepared.params.options).toSorted((a, b) => a.localeCompare(b)),
      headerKeys: Object.keys(input.prepared.headers).toSorted((a, b) => a.localeCompare(b)),
    },
    counts: {
      requestedSystemCount: input.requestedSystem.length,
      effectiveSystemCount: input.prepared.system.length,
      systemChars,
      modelMessageCount: input.prepared.messages.length,
      modelMessageChars: messageSummary.chars,
      toolCount: toolNames.length,
    },
    hashes: {
      system: sha256(stableStringify(input.prepared.system)),
      messages: sha256(stableStringify(input.prepared.messages)),
      tools: sha256(stableStringify(toolNames)),
      params: sha256(stableStringify(input.prepared.params)),
    },
    messageSummary,
    toolNames,
  }
  return {
    ...manifest,
    hashes: {
      ...manifest.hashes,
      manifest: sha256(stableStringify(manifest)),
    },
  }
}

export function effectivePromptRaw(input: { manifest: EffectivePromptManifest; prepared: Prepared }) {
  return {
    schema: EFFECTIVE_PROMPT_SCHEMA,
    manifest: input.manifest,
    effectiveSystem: input.prepared.system,
    effectiveMessages: input.prepared.messages,
    toolNames: input.manifest.toolNames,
    params: input.prepared.params,
    headerKeys: input.manifest.modelSpecificDiff.headerKeys,
  }
}

function promptSources(input: EffectivePromptInput) {
  return {
    sources: [
      input.agent.prompt ? "agent.prompt" : "provider.default.system_prompt",
      input.requestedSystem.length > 0 ? "session.system_fragments" : undefined,
      input.user.system ? "user.system_override" : undefined,
      input.prepared.system.length > input.requestedSystem.length ? "plugin.system_transform_or_request_prep" : undefined,
      input.turn?.engineering ? "engineering.run.reminder" : undefined,
      input.turn?.skill_catalog.injected_ids.length ? "skill.catalog.injected" : undefined,
      input.toolChoice === "required" ? "structured_output.required_tool" : undefined,
    ].filter((item): item is string => !!item),
  }
}

function summarizeMessages(messages: readonly ModelMessage[]) {
  const roles = messages.reduce<Record<string, number>>((acc, message) => {
    acc[message.role] = (acc[message.role] ?? 0) + 1
    return acc
  }, {})
  return {
    roles,
    chars: messages.reduce((total, message) => total + messageContentChars(message), 0),
    firstRole: messages[0]?.role,
    lastRole: messages.at(-1)?.role,
  }
}

function messageContentChars(message: ModelMessage) {
  if (typeof message.content === "string") return message.content.length
  return JSON.stringify(message.content ?? "").length
}

function sha256(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stable(value))
}

function stable(value: unknown): unknown {
  if (!value || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map(stable)
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stable(item)]),
  )
}

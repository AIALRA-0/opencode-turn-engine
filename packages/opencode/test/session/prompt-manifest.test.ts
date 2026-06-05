import { describe, expect, test } from "bun:test"
import { buildEffectivePromptManifest, effectivePromptRaw } from "../../src/session/prompt-manifest"
import type { Agent } from "../../src/agent/agent"
import type { MessageV2 } from "../../src/session/message-v2"
import type { Provider } from "../../src/provider/provider"
import type { Prepared } from "../../src/session/llm/request"

const user = {
  id: "msg_user",
  sessionID: "ses_prompt",
  role: "user",
  time: { created: 1 },
  agent: "build",
  model: { providerID: "openai", modelID: "gpt-test", variant: "xhigh" },
} as MessageV2.User

const agent = {
  name: "build",
  mode: "primary",
  prompt: "You are a precise coding agent.",
} as Agent.Info

const model = {
  id: "gpt-test",
  providerID: "openai",
  api: { npm: "@ai-sdk/openai" },
  capabilities: { toolcall: true },
} as Provider.Model

const prepared = {
  system: ["system one", "system two"],
  messages: [
    { role: "system", content: "system one\nsystem two" },
    { role: "user", content: "Fix the bug" },
  ],
  tools: {
    read: {},
    write: {},
  },
  params: {
    temperature: 0,
    options: { reasoningEffort: "high" },
  },
  messageTransformOptions: {},
  headers: {
    "User-Agent": "opencode/test",
  },
} as unknown as Prepared

describe("effective prompt manifest", () => {
  test("builds stable hashes and source metadata", () => {
    const manifest = buildEffectivePromptManifest({
      user,
      sessionID: "ses_prompt",
      model,
      agent,
      prepared,
      requestedSystem: ["environment", "instructions"],
      toolChoice: "auto",
      isWorkflow: false,
    })

    expect(manifest.schema).toBe("aialra.effective_prompt_manifest.v1")
    expect(manifest.version).toBe("aialra-general-engineering-harness-v1")
    expect(manifest.hashes.manifest).toHaveLength(64)
    expect(manifest.hashes.system).toHaveLength(64)
    expect(manifest.sources).toContain("agent.prompt")
    expect(manifest.counts.effectiveSystemCount).toBe(2)
    expect(manifest.counts.modelMessageCount).toBe(2)
    expect(manifest.toolNames).toEqual(["read", "write"])

    const again = buildEffectivePromptManifest({
      user,
      sessionID: "ses_prompt",
      model,
      agent,
      prepared,
      requestedSystem: ["environment", "instructions"],
      toolChoice: "auto",
      isWorkflow: false,
    })
    expect(again.hashes.manifest).toBe(manifest.hashes.manifest)
  })

  test("raw payload carries effective system and messages behind rawRef", () => {
    const manifest = buildEffectivePromptManifest({
      user,
      sessionID: "ses_prompt",
      model,
      agent,
      prepared,
      requestedSystem: [],
      isWorkflow: false,
    })
    const raw = effectivePromptRaw({ manifest, prepared })

    expect(raw.manifest.hashes.manifest).toBe(manifest.hashes.manifest)
    expect(raw.effectiveSystem).toEqual(["system one", "system two"])
    expect(raw.effectiveMessages).toHaveLength(2)
    expect(raw.headerKeys).toEqual(["User-Agent"])
  })
})

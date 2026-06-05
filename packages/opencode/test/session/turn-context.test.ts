import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import type { Agent } from "../../src/agent/agent"
import type { Plugin } from "../../src/plugin"
import type { Provider } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { LLMRequestPrep } from "../../src/session/llm/request"
import type { MessageV2 } from "../../src/session/message-v2"
import { CodexTurn } from "../../src/session/turn-context"
import type { TurnFrame } from "../../src/session/turn-frame"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import type { RuntimeFlags } from "../../src/effect/runtime-flags"

const sessionID = SessionID.make("ses_turn_context")
const messageID = MessageID.make("msg_turn_context")

function frame(overrides: Partial<TurnFrame> = {}) {
  return {
    version: "aialra.turn_frame.v1",
    turnID: messageID,
    route: "prompt",
    sessionID,
    messageID,
    agent: "build",
    model: {
      providerID: "test",
      modelID: "test",
    },
    noReply: false,
    format: "text",
    input: {
      partCount: 0,
      textParts: 0,
      textChars: 0,
      fileParts: 0,
      agentParts: 0,
      subtaskParts: 0,
      syntheticParts: 0,
    },
    explicit: {
      files: [],
      agents: [],
      references: [],
    },
    tools: [],
    timing: {
      receivedAt: 1,
      framedAt: 2,
    },
    ...overrides,
  } satisfies TurnFrame
}

function partBase(id: string) {
  return {
    id: PartID.make(id),
    sessionID,
    messageID,
  }
}

function providerModel(
  input: {
    reasoning?: boolean
    toolcall?: boolean
    options?: Record<string, unknown>
    variants?: Record<string, Record<string, unknown>>
  } = {},
) {
  return {
    id: ModelID.make("model-info-test"),
    providerID: ProviderID.make("provider-info-test"),
    api: {
      id: "model-info-api",
      url: "https://example.test/v1",
      npm: "@ai-sdk/openai-compatible",
    },
    name: "Model Info Test",
    family: "test-family",
    capabilities: {
      temperature: true,
      reasoning: input.reasoning ?? true,
      attachment: true,
      toolcall: input.toolcall ?? true,
      input: { text: true, audio: false, image: true, video: false, pdf: true },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
      interleaved: { field: "reasoning_content" },
    },
    cost: {
      input: 1,
      output: 2,
      cache: { read: 0.1, write: 0.2 },
    },
    limit: { context: 128_000, input: 64_000, output: 8_192 },
    status: "active",
    options: input.options ?? { serviceTier: "priority" },
    headers: {},
    release_date: "2026-01-01",
    variants: input.variants ?? {},
  } satisfies Provider.Model
}

const plugin = {
  trigger: (_name, _input, output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
} satisfies Plugin.Interface

describe("CodexTurn UserTurn input parity", () => {
  test("upgrades legacy prompt parts into Codex-style input items", () => {
    const parts: MessageV2.Part[] = [
      {
        ...partBase("prt_turn_context_text"),
        type: "text",
        text: "read README and inspect image",
      },
      {
        ...partBase("prt_turn_context_file"),
        type: "file",
        mime: "text/plain",
        filename: "README.md",
        url: "file:///workspace/README.md",
        source: {
          type: "file",
          path: "/workspace/README.md",
          text: { value: "@README.md", start: 5, end: 15 },
        },
      },
      {
        ...partBase("prt_turn_context_image"),
        type: "file",
        mime: "image/png",
        filename: "screen.png",
        url: "file:///workspace/screen.png",
      },
      {
        ...partBase("prt_turn_context_agent"),
        type: "agent",
        name: "build",
        source: { value: "@build", start: 0, end: 6 },
      },
      {
        ...partBase("prt_turn_context_subtask"),
        type: "subtask",
        prompt: "inspect parser",
        description: "Inspect parser boundaries",
        agent: "build",
        command: "/inspect",
      },
    ]

    const turn = CodexTurn.fromFrame({
      frame: frame(),
      parts,
      cwd: "/workspace",
      retry: CodexTurn.retryConfig({}),
      startedAt: 100,
    })

    expect(turn.input_schema).toEqual({
      codex: "Op::UserInput",
      supported_items: ["text", "image", "local_image", "file", "skill", "mention", "subtask"],
    })
    expect(turn.input_items.map((item) => item.type)).toEqual(["text", "file", "image", "mention", "subtask"])
    expect(turn.input_items[0]).toEqual(expect.objectContaining({ type: "text", text: "read README and inspect image" }))
    expect(turn.input_items[1]).toEqual(
      expect.objectContaining({
        type: "file",
        mime: "text/plain",
        filename: "README.md",
        url: "file:///workspace/README.md",
      }),
    )
    expect(turn.input_items[2]).toEqual(expect.objectContaining({ type: "image", image_url: "file:///workspace/screen.png" }))
    expect(turn.input_items[3]).toEqual(expect.objectContaining({ type: "mention", name: "build", path: "agent://build" }))
    expect(turn.input_items[4]).toEqual(expect.objectContaining({ type: "subtask", prompt: "inspect parser" }))
    expect(turn.metadata).toEqual(expect.objectContaining({ legacyPromptStringUpgraded: true, source: "opencode.prompt_input" }))
    expect(turn.dynamic_tools).toEqual(
      expect.objectContaining({
        version: "aialra.dynamic_tools.v1",
        available_ids: [],
        disabled_ids: [],
        resolver: expect.objectContaining({ model_supports_tools: true }),
      }),
    )
    expect(turn.skill_catalog).toEqual(
      expect.objectContaining({
        version: "aialra.skill_catalog.v1",
        available_ids: [],
        disabled_ids: [],
        used_ids: [],
        resolver: expect.objectContaining({ agent: "build" }),
      }),
    )
  })

  test("skill catalog records available, disabled, resources, and permission requirements per turn", () => {
    const catalog = CodexTurn.defaultSkillCatalog({
      skills: [
        {
          name: "frontend",
          description: "Use when editing UI.",
          location: "/workspace/.opencode/skills/frontend/SKILL.md",
          content: "Run `npm test` and read https://example.com/docs. MCP resource is mentioned.",
        },
      ],
      disabled: [
        {
          name: "deploy",
          description: "Use when deploying.",
          location: "/workspace/.opencode/skills/deploy/SKILL.md",
          content: "Run `kubectl diff` before deploy.",
          reasons: ["skill deploy denied by agent permission rules"],
        },
      ],
      agent: "build",
      cwd: "/workspace",
      activePermissionProfile: { id: ":workspace" },
      approvalPolicy: "on-request",
      selectedEnvironmentID: "default",
    })

    expect(catalog.available_ids).toEqual(["frontend"])
    expect(catalog.disabled_ids).toEqual(["deploy"])
    expect(catalog.available[0]).toEqual(
      expect.objectContaining({
        skill_id: "frontend",
        source: "project",
        applicable: true,
        tools: ["skill"],
        commands: ["npm test"],
        external_resources: ["https://example.com/docs"],
        permission_requirements: ["skill:frontend"],
      }),
    )
    expect(catalog.disabled[0]).toEqual(
      expect.objectContaining({
        skill_id: "deploy",
        applicable: false,
        disabled_reasons: ["skill deploy denied by agent permission rules"],
      }),
    )
    expect(catalog.resources).toEqual(
      expect.objectContaining({
        tools: ["skill"],
        commands: ["kubectl diff", "npm test"],
        external_resources: ["https://example.com/docs"],
        mcp_resources: ["mentioned-in-skill-content"],
      }),
    )
  })

  test("keeps explicit UserTurn overrides and summarizes structured input", () => {
    const turn = CodexTurn.fromFrame({
      frame: frame({ route: "command", noReply: true }),
      parts: [],
      cwd: "/workspace",
      retry: CodexTurn.retryConfig({}),
      startedAt: 100,
      environments: [
        { environmentID: "default", cwd: "/workspace", kind: "local" },
        { environmentID: "remote-preview", cwd: "/remote/workspace", kind: "disabled", status: "unsupported", platform: "win32" },
      ],
      selectedEnvironmentID: "remote-preview",
      inputItems: [{ type: "local_image", path: "/workspace/screen.png", metadata: { source: "api" } }],
      threadSettings: {
        requested: { model: "override" },
        resolved: { cwd: "/workspace" },
        effective: { cwd: "/remote/workspace" },
      },
      responsesAPIClientMetadata: {
        user_id: "user-test",
      },
      metadata: {
        source: "test",
        risk: "low",
      },
      extensionData: {
        aialra: { route: "command" },
      },
      finalOutputJsonSchema: {
        type: "object",
        properties: { ok: { type: "boolean" } },
      },
    })
    const summary = CodexTurn.traceSummary(turn)

    expect(turn.route).toBe("command")
    expect(turn.noReply).toBe(true)
    expect(turn.input_items).toEqual([{ type: "local_image", path: "/workspace/screen.png", metadata: { source: "api" } }])
    expect(turn.thread_settings.effective).toEqual({ cwd: "/remote/workspace" })
    expect(turn.responsesapi_client_metadata).toEqual({ user_id: "user-test" })
    expect(turn.metadata).toEqual(expect.objectContaining({ source: "test", risk: "low", legacyPromptStringUpgraded: true }))
    expect(turn.extension_data).toEqual({ aialra: { route: "command" } })
    expect(summary).toEqual(
      expect.objectContaining({
        selected_environment_id: "remote-preview",
        selected_environment_cwd: "/remote/workspace",
        platform_sandbox: expect.objectContaining({
          version: "aialra.platform_sandbox_capability.v1",
          target_platform: "win32",
          status: "unsupported",
          supported: false,
          backend: "windows-unsupported",
        }),
        input_items: { count: 1, byType: { local_image: 1 } },
        extension_data_namespaces: ["aialra"],
        final_output_json_schema: expect.objectContaining({ type: "object" }),
      }),
    )
    expect(turn.effective_permission_profile?.platform_sandbox).toEqual(
      expect.objectContaining({
        target_platform: "win32",
        supported: false,
      }),
    )
    expect(turn.effective_permission_profile?.restrictions).toContain("platform_sandbox_unsupported:win32")
  })

  test("builds ModelInfo from provider metadata and records capability decisions", () => {
    const model = providerModel({ options: { supportsStructuredOutput: false, supportsReasoningEffort: true, serviceTier: "priority" } })
    const info = CodexTurn.modelInfo({
      providerID: "provider-info-test",
      modelID: "model-info-test",
      provider: {
        id: ProviderID.make("provider-info-test"),
        name: "Provider Info Test",
        source: "config",
        env: [],
        options: {},
        models: { "model-info-test": model },
      },
      model,
    })
    const turn = CodexTurn.fromFrame({
      frame: frame({
        model: {
          providerID: "provider-info-test",
          modelID: "model-info-test",
        },
      }),
      parts: [],
      cwd: "/workspace",
      retry: CodexTurn.retryConfig({}),
      startedAt: 100,
      modelInfo: info,
      effort: "high",
      serviceTier: "priority",
      finalOutputJsonSchema: { type: "object" },
    })

    expect(turn.model_info.version).toBe("aialra.model_info.v1")
    expect(turn.model_info.limits.context_length).toBe(128_000)
    expect(turn.model_info.limits.output_tokens).toBe(8_192)
    expect(turn.model_info.supports.tools).toBe(true)
    expect(turn.model_info.supports.structured_output).toBe(false)
    expect(turn.model_info.supports.reasoning).toBe(true)
    expect(turn.model_info.supports.reasoning_effort).toBe(true)
    expect(turn.model_info.supports.image_input).toBe(true)
    expect(turn.model_info.supports.file_input).toBe(true)
    expect(turn.model_info.supports.service_tier).toBe(true)
    expect(turn.model_info.service_tier).toEqual(expect.objectContaining({ supported: ["priority"], default: "priority" }))
    expect(turn.reasoning_summary_policy).toEqual(
      expect.objectContaining({
        version: "aialra.reasoning_summary_policy.v1",
        enabled: true,
        level: "auto",
        auto_collapse: true,
        per_turn: true,
        tool_linked: true,
      }),
    )
    expect(CodexTurn.modelCapabilityDecisions(turn)).toEqual(
      expect.objectContaining({
        ignored: expect.objectContaining({ structured_output: true, reasoning_effort: false, service_tier: false }),
      }),
    )
    expect(CodexTurn.traceSummary(turn)).toEqual(
      expect.objectContaining({
        model_info: turn.model_info,
        reasoning_summary_policy: turn.reasoning_summary_policy,
        requested_service_tier: "priority",
        effective_service_tier: "priority",
        service_tier_resolution: turn.service_tier_resolution,
      }),
    )
  })

  test("marks macOS seatbelt targets as unsupported instead of reusing Linux sandbox claims", () => {
    const turn = CodexTurn.fromFrame({
      frame: frame(),
      parts: [],
      cwd: "/workspace",
      retry: CodexTurn.retryConfig({}),
      startedAt: 100,
      environments: [{ environmentID: "mac-preview", cwd: "/workspace", kind: "disabled", status: "unsupported", platform: "darwin" }],
      selectedEnvironmentID: "mac-preview",
    })

    expect(turn.platform_sandbox).toEqual(
      expect.objectContaining({
        version: "aialra.platform_sandbox_capability.v1",
        target_platform: "darwin",
        status: "unsupported",
        supported: false,
        backend: "macos-unsupported",
        codex_parity: expect.objectContaining({
          macos_seatbelt: "unsupported",
        }),
      }),
    )
    expect(turn.effective_permission_profile?.restrictions).toContain("platform_sandbox_unsupported:darwin")
  })

  test("resolves requested service tier through provider mapping and fallback", () => {
    const model = providerModel({
      options: {
        serviceTiers: ["default", "priority"],
        serviceTierMapping: { fast: "priority" },
        defaultServiceTier: "default",
      },
    })
    const mapped = CodexTurn.fromFrame({
      frame: frame(),
      parts: [],
      cwd: "/workspace",
      retry: CodexTurn.retryConfig({}),
      startedAt: 100,
      modelInfo: CodexTurn.modelInfo({
        providerID: model.providerID,
        modelID: model.id,
        model,
      }),
      requestedServiceTier: "fast",
      serviceTierResolution: CodexTurn.serviceTierResolution({
        requested: "fast",
        source: "turn_settings",
        modelInfo: CodexTurn.modelInfo({
          providerID: model.providerID,
          modelID: model.id,
          model,
        }),
      }),
    })
    const fallback = CodexTurn.serviceTierResolution({
      requested: "batch",
      source: "turn_settings",
      modelInfo: mapped.model_info,
    })

    expect(mapped.requested_service_tier).toBe("fast")
    expect(mapped.effective_service_tier).toBe("priority")
    expect(mapped.service_tier_resolution).toEqual(
      expect.objectContaining({
        provider_tier: "priority",
        fallback: { applied: false },
        scheduling: { latency: "priority", cost: "premium", background: false },
      }),
    )
    expect(fallback).toEqual(
      expect.objectContaining({
        requested: "batch",
        effective: "default",
        fallback: expect.objectContaining({ applied: true, from: "batch", to: "default" }),
      }),
    )
  })

  test("records reasoning summary policy when provider support is disabled or user turns it off", () => {
    const model = providerModel({ reasoning: false, options: { supportsReasoningSummary: false } })
    const unsupported = CodexTurn.fromFrame({
      frame: frame(),
      parts: [],
      cwd: "/workspace",
      retry: CodexTurn.retryConfig({}),
      startedAt: 100,
      modelInfo: CodexTurn.modelInfo({
        providerID: model.providerID,
        modelID: model.id,
        model,
      }),
      summary: "auto",
    })
    const disabled = CodexTurn.fromFrame({
      frame: frame(),
      parts: [],
      cwd: "/workspace",
      retry: CodexTurn.retryConfig({}),
      startedAt: 100,
      reasoningSummaryPolicy: CodexTurn.defaultReasoningSummaryPolicy({
        summary: "off",
        enabled: true,
        source: "turn_settings",
      }),
    })

    expect(unsupported.reasoning_summary_policy).toEqual(
      expect.objectContaining({ enabled: false, level: "auto", source: "model_options" }),
    )
    expect(disabled.reasoning_summary_policy).toEqual(
      expect.objectContaining({ enabled: false, level: "off", source: "turn_settings" }),
    )
  })

  test("LLM request preparation only applies reasoning and service tier when ModelInfo supports them", async () => {
    const model = providerModel({
      reasoning: false,
      options: {
        supportsReasoningEffort: false,
        supportsReasoningSummary: false,
        serviceTier: "priority",
        supportsStructuredOutput: true,
      },
    })
    const turn = CodexTurn.fromFrame({
      frame: frame({
        model: {
          providerID: model.providerID,
          modelID: model.id,
        },
      }),
      parts: [],
      cwd: "/workspace",
      retry: CodexTurn.retryConfig({}),
      startedAt: 100,
      modelInfo: CodexTurn.modelInfo({
        providerID: model.providerID,
        modelID: model.id,
        model,
      }),
      effort: "high",
      summary: "auto",
      serviceTier: "priority",
    })
    const prepared = await Effect.runPromise(
      LLMRequestPrep.prepare({
        user: {
          id: messageID,
          sessionID,
          role: "user",
          time: { created: 100 },
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id },
        },
        sessionID,
        model,
        agent: {
          name: "build",
          mode: "primary",
          permission: [],
          options: {},
        } satisfies Agent.Info,
        system: [],
        messages: [{ role: "user", content: "hello" }],
        tools: {},
        provider: {
          id: model.providerID,
          name: "Provider Info Test",
          source: "config",
          env: [],
          options: {},
          models: { [model.id]: model },
        },
        auth: undefined,
        plugin,
        flags: { outputTokenMax: undefined, client: "test" } as RuntimeFlags.Info,
        isWorkflow: false,
        turn,
      }),
    )

    expect(prepared.params.options.reasoningEffort).toBeUndefined()
    expect(prepared.params.options.reasoning_effort).toBeUndefined()
    expect(prepared.params.options.reasoningSummary).toBeUndefined()
    expect(prepared.params.options.serviceTier).toBe("priority")
  })

  test("resolves requested thinking effort to the nearest provider-supported effective effort", () => {
    const model = providerModel({
      variants: {
        low: { reasoningEffort: "low" },
        high: { reasoningEffort: "high" },
      },
    })
    const resolution = CodexTurn.reasoningEffortResolution({
      requested: "xhigh",
      source: "turn_settings",
      model,
      modelInfo: CodexTurn.modelInfo({
        providerID: model.providerID,
        modelID: model.id,
        model,
      }),
    })

    expect(resolution.requested).toBe("xhigh")
    expect(resolution.effective).toBe("high")
    expect(resolution.supported).toEqual(["low", "high"])
    expect(resolution.fallback.applied).toBe(true)
    expect(resolution.fallback.from).toBe("xhigh")
    expect(resolution.fallback.to).toBe("high")
  })

  test("variant thinking effort is observable without being re-applied as OpenAI reasoningEffort", async () => {
    const model = providerModel({
      variants: {
        high: {
          thinking: { type: "enabled", budgetTokens: 16000 },
        },
      },
    })
    const turn = CodexTurn.fromFrame({
      frame: frame({
        model: {
          providerID: model.providerID,
          modelID: model.id,
          variant: "high",
        },
      }),
      parts: [],
      cwd: "/workspace",
      retry: CodexTurn.retryConfig({}),
      startedAt: 100,
      modelInfo: CodexTurn.modelInfo({
        providerID: model.providerID,
        modelID: model.id,
        model,
        variant: "high",
      }),
      requestedEffort: "high",
      effectiveEffort: "high",
      effortResolution: CodexTurn.reasoningEffortResolution({
        requested: "high",
        source: "variant",
        model,
        modelInfo: CodexTurn.modelInfo({
          providerID: model.providerID,
          modelID: model.id,
          model,
          variant: "high",
        }),
      }),
      effort: "high",
    })
    const prepared = await Effect.runPromise(
      LLMRequestPrep.prepare({
        user: {
          id: messageID,
          sessionID,
          role: "user",
          time: { created: 100 },
          agent: "build",
          model: { providerID: model.providerID, modelID: model.id, variant: "high" },
        },
        sessionID,
        model,
        agent: {
          name: "build",
          mode: "primary",
          permission: [],
          options: {},
        } satisfies Agent.Info,
        system: [],
        messages: [{ role: "user", content: "hello" }],
        tools: {},
        provider: {
          id: model.providerID,
          name: "Provider Info Test",
          source: "config",
          env: [],
          options: {},
          models: { [model.id]: model },
        },
        auth: undefined,
        plugin,
        flags: { outputTokenMax: undefined, client: "test" } as RuntimeFlags.Info,
        isWorkflow: false,
        turn,
      }),
    )

    expect(prepared.params.options.thinking).toEqual({ type: "enabled", budgetTokens: 16000 })
    expect(prepared.params.options.reasoningEffort).toBeUndefined()
    expect(prepared.params.options.effort).toBeUndefined()
  })
})

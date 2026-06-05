import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Cause, Effect, Exit, Layer } from "effect"
import { afterEach, describe, expect } from "bun:test"
import path from "path"
import { pathToFileURL } from "url"
import type { Permission } from "../../src/permission"
import type { Tool } from "@/tool/tool"
import { SkillTool } from "../../src/tool/skill"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances, provideTmpdirInstance } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { CodexTurn } from "../../src/session/turn-context"
import { PublicEventLog } from "../../src/session/public-event"
import { testEffect } from "../lib/effect"

const baseCtx: Omit<Tool.Context, "ask"> = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
}

afterEach(async () => {
  await disposeAllInstances()
})

const node = CrossSpawnSpawner.defaultLayer

const it = testEffect(Layer.mergeAll(ToolRegistry.defaultLayer, node))

describe("tool.skill", () => {
  it.live("execute returns skill content block with files", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        PublicEventLog.clearForTest()
        const skill = path.join(dir, ".opencode", "skill", "tool-skill")
        const skillContent = `---
name: tool-skill
description: Skill for tool tests.
---

# Tool Skill

Use this skill.
Run \`npm test\` when validating.
`
        yield* Effect.promise(() =>
          Bun.write(
            path.join(skill, "SKILL.md"),
            skillContent,
          ),
        )
        yield* Effect.promise(() => Bun.write(path.join(skill, "scripts", "demo.txt"), "demo"))

        const home = process.env.OPENCODE_TEST_HOME
        process.env.OPENCODE_TEST_HOME = dir
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            process.env.OPENCODE_TEST_HOME = home
          }),
        )

        const registry = yield* ToolRegistry.Service
        const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
        const tool = (yield* registry.tools({
          providerID: "opencode" as any,
          modelID: "gpt-5" as any,
          agent,
        })).find((tool) => tool.id === SkillTool.id)
        if (!tool) throw new Error("Skill tool not found")

        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const messageID = MessageID.make("msg_skill_turn")
        const turn = CodexTurn.fromFrame({
          frame: {
            version: "aialra.turn_frame.v1",
            turnID: messageID,
            route: "prompt",
            sessionID: baseCtx.sessionID,
            messageID,
            agent: "build",
            model: { providerID: "test", modelID: "test" },
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
            explicit: { files: [], agents: [], references: [] },
            tools: ["skill"],
            timing: { receivedAt: Date.now(), framedAt: Date.now() },
          },
          parts: [],
          cwd: dir,
          retry: CodexTurn.retryConfig({}),
          startedAt: Date.now(),
          skillCatalog: CodexTurn.defaultSkillCatalog({
            skills: [{ name: "tool-skill", description: "Skill for tool tests.", location: path.join(skill, "SKILL.md"), content: skillContent }],
            agent: "build",
            cwd: dir,
            activePermissionProfile: { id: ":workspace" },
            approvalPolicy: "on-request",
            selectedEnvironmentID: "default",
          }),
        })
        const ctx: Tool.Context = {
          ...baseCtx,
          turn,
          messageID,
          callID: "call_skill_tool",
          ask: (req) =>
            Effect.sync(() => {
              requests.push(req)
            }),
        }

        const result = yield* tool.execute({ name: "tool-skill" }, ctx)
        const file = path.resolve(skill, "scripts", "demo.txt")

        expect(requests.length).toBe(1)
        expect(requests[0].permission).toBe("skill")
        expect(requests[0].patterns).toContain("tool-skill")
        expect(requests[0].always).toContain("tool-skill")
        expect(result.metadata.dir).toBe(skill)
        expect(result.output).toContain(`<skill_content name="tool-skill">`)
        expect(result.output).toContain(`Base directory for this skill: ${pathToFileURL(skill).href}`)
        expect(result.output).toContain(`<file>${file}</file>`)
        expect(turn.skill_catalog.used_ids).toContain("tool-skill")
        expect(turn.skill_catalog.available[0].usage_count).toBe(1)
        const event = PublicEventLog.list({ sessionID: baseCtx.sessionID }).find((event) => event.type === "skill.used")
        expect(event).toEqual(expect.objectContaining({ toolCallID: "call_skill_tool" }))
        expect(event?.data).toEqual(
          expect.objectContaining({
            name: "tool-skill",
            skill_id: "tool-skill",
            source: "project",
            prompt_injected: true,
            usage_count: 1,
            tools: ["skill"],
            commands: ["npm test"],
            permission_requirements: ["skill:tool-skill"],
            contentChars: expect.any(Number),
          }),
        )
      }),
    ),
  )

  it.live("execute preserves not found message", () =>
    provideTmpdirInstance((dir) =>
      Effect.gen(function* () {
        const home = process.env.OPENCODE_TEST_HOME
        process.env.OPENCODE_TEST_HOME = dir
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            process.env.OPENCODE_TEST_HOME = home
          }),
        )

        const registry = yield* ToolRegistry.Service
        const agent = { name: "build", mode: "primary" as const, permission: [], options: {} }
        const tool = (yield* registry.tools({
          providerID: "opencode" as any,
          modelID: "gpt-5" as any,
          agent,
        })).find((tool) => tool.id === SkillTool.id)
        if (!tool) throw new Error("Skill tool not found")

        const exit = yield* tool
          .execute(
            { name: "missing-skill" },
            {
              ...baseCtx,
              ask: () => Effect.void,
            },
          )
          .pipe(Effect.exit)

        expect(Exit.isFailure(exit)).toBe(true)
        if (Exit.isFailure(exit)) {
          const error = Cause.squash(exit.cause)
          expect(error).toBeInstanceOf(Error)
          if (error instanceof Error) expect(error.message).toContain('Skill "missing-skill" not found.')
        }
      }),
    ),
  )
})

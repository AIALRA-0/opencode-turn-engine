import path from "path"
import os from "os"
import { SessionID, MessageID, PartID } from "./schema"
import { MessageV2 } from "./message-v2"
import * as Log from "@opencode-ai/core/util/log"
import { SessionRevert } from "./revert"
import * as Session from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"
import { ModelID, ProviderID } from "../provider/schema"
import { type Tool as AITool, tool, jsonSchema, type ToolExecutionOptions, asSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { Bus } from "../bus"
import { ProviderTransform } from "@/provider/transform"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import PROMPT_PLAN from "../session/prompt/plan.txt"
import BUILD_SWITCH from "../session/prompt/build-switch.txt"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { ToolRegistry } from "@/tool/registry"
import { ToolJsonSchema } from "@/tool/json-schema"
import { Skill } from "@/skill"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@/shell/shell"
import { ShellID } from "@/tool/shell/id"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Process } from "@/util/process"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Types } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { SessionRunState } from "./run-state"
import { EffectBridge } from "@/effect/bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2 } from "@opencode-ai/core/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AgentAttachment, FileAttachment, ReferenceAttachment, Source } from "@opencode-ai/core/session-prompt"
import { Reference } from "@/reference/reference"
import * as DateTime from "effect/DateTime"
import { eq } from "@/storage/db"
import * as Database from "@/storage/db"
import { SessionTable } from "./session.sql"
import { AialraTurnTrace } from "./turn-trace"
import { TurnFrame, type TurnFrameRoute } from "./turn-frame"
import { CodexTurn, type DynamicToolStatus, type TurnAbortReason, type TurnContext } from "./turn-context"
import { SecurityTurnSettingsOverride, SessionSecurity } from "./security"
import { EngineeringHarness } from "./engineering"
import { AbortAudit, abortSourceLabel } from "./abort-audit"
import { PublicEventLog } from "./public-event"
import { ToolFoundation } from "./tool-foundation"
import { ToolOutputStore } from "./tool-output-store"
import { ToolResultProtocol } from "./tool-result-settlement"
import { TurnDiffStore } from "./turn-diff"
import { ExecCommand } from "./exec-command"
import { errorMessage } from "@/util/error"
import type { LLMEvent } from "@opencode-ai/llm"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const decodeMessageInfo = Schema.decodeUnknownExit(MessageV2.Info)
const decodeMessagePart = Schema.decodeUnknownExit(MessageV2.Part)

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

const log = Log.create({ service: "session.prompt" })
const elog = EffectLogger.create({ service: "session.prompt" })
const DEFAULT_AIALRA_TURN_MAX_STEPS = 80
const REPEATED_TOOL_WARNING_THRESHOLD = 3

function promptText(parts: MessageV2.Part[]) {
  return parts
    .filter((part) => part.type === "text" && !part.synthetic)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
}

function stringOption(options: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = options?.[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

function workspaceHasGitChange(turn: TurnContext) {
  return Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["git", "-C", CodexTurn.environmentCwd(turn), "status", "--porcelain"], {
        stdout: "pipe",
        stderr: "ignore",
      })
      const text = await new Response(proc.stdout).text()
      const code = await proc.exited
      if (code !== 0) return undefined
      return text.trim().length > 0
    },
    catch: (error) => (error instanceof Error ? error : new Error(String(error))),
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))
}

function assistantText(messageID: MessageID) {
  return MessageV2.parts(messageID)
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
}

function normalizeTurnStepBudget(value: unknown, fallback = DEFAULT_AIALRA_TURN_MAX_STEPS) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback
  return Math.max(1, Math.min(10_000, Math.trunc(value)))
}

function turnMaxSteps(agentSteps: number | undefined, turn?: TurnContext) {
  if (agentSteps !== undefined) return agentSteps
  if (turn?.step_budget?.enabled) return normalizeTurnStepBudget(turn.step_budget.max_steps)
  const raw = process.env.AIALRA_TURN_MAX_STEPS
  if (raw === "0" || raw === "false") return Infinity
  if (raw === undefined || raw === "") return Infinity
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return Infinity
  return Math.max(1, Math.min(10_000, Math.trunc(parsed)))
}

function toolLoopSignature(part: MessageV2.Part) {
  if (part.type !== "tool") return
  const state = part.state
  if (state.status !== "completed" && state.status !== "error") return
  const input = state.input === undefined ? "" : JSON.stringify(state.input).slice(0, 500)
  return `${part.tool}:${input}:${state.status}`
}

type ReferencePromptMetadata = {
  name: string
  kind: "local" | "git" | "invalid"
  path?: string
  repository?: string
  branch?: string
  target?: string
  targetPath?: string
  problem?: string
  source: { value: string; start: number; end: number }
}

function stringField(record: Record<string, unknown>, key: string) {
  return typeof record[key] === "string" ? record[key] : undefined
}

function referencePromptMetadata(input: unknown): ReferencePromptMetadata | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  const record = input as Record<string, unknown>
  const name = stringField(record, "name")
  const kind = stringField(record, "kind")
  if (!name || (kind !== "local" && kind !== "git" && kind !== "invalid")) return
  if (!record.source || typeof record.source !== "object" || Array.isArray(record.source)) return
  const source = record.source as Record<string, unknown>
  const value = stringField(source, "value")
  if (!value || typeof source.start !== "number" || typeof source.end !== "number") return
  return {
    name,
    kind,
    path: stringField(record, "path"),
    repository: stringField(record, "repository"),
    branch: stringField(record, "branch"),
    target: stringField(record, "target"),
    targetPath: stringField(record, "targetPath"),
    problem: stringField(record, "problem"),
    source: { value, start: source.start, end: source.end },
  }
}

function referenceTextPart(input: {
  reference: Reference.Resolved
  source: ReferencePromptMetadata["source"]
  target?: string
  targetPath?: string
  problem?: string
}): MessageV2.TextPartInput {
  const metadata: ReferencePromptMetadata = {
    name: input.reference.name,
    kind: input.reference.kind,
    ...(input.reference.kind === "invalid"
      ? { repository: input.reference.repository }
      : { path: input.reference.path }),
    ...(input.reference.kind === "git"
      ? { repository: input.reference.repository, branch: input.reference.branch }
      : {}),
    ...(input.target === undefined ? {} : { target: input.target }),
    ...(input.targetPath ? { targetPath: input.targetPath } : {}),
    problem: input.problem ?? (input.reference.kind === "invalid" ? input.reference.message : undefined),
    source: input.source,
  }
  const label = metadata.target === undefined ? `@${metadata.name}` : `@${metadata.name}/${metadata.target}`
  return {
    type: "text",
    synthetic: true,
    text: [
      `Referenced configured reference ${label}.`,
      ...(metadata.kind === "local" ? ["Kind: local directory"] : []),
      ...(metadata.kind === "git" ? ["Kind: git repository"] : []),
      ...(metadata.repository ? [`Repository: ${metadata.repository}`] : []),
      ...(metadata.branch ? [`Branch/ref: ${metadata.branch}`] : []),
      ...(metadata.path ? [`Reference root: ${metadata.path}`] : []),
      ...(metadata.targetPath ? [`Resolved path: ${metadata.targetPath}`] : []),
      ...(metadata.problem
        ? [`Problem: ${metadata.problem}`]
        : [
            "For targeted context, inspect the reference path directly with Read, Glob, and Grep. For broader research, call the task tool with subagent scout and include this reference path.",
          ]),
    ].join("\n"),
    metadata: { reference: metadata },
  }
}

function withoutMentionSigil(value: string) {
  return value.startsWith("@") ? value.slice(1) : value
}

function promptPartSignatures(part: PromptInput["parts"][number]) {
  const result: string[] = []
  if (part.type === "file") {
    result.push(`file:url:${part.url}`)
    if (part.filename) result.push(`file:name:${part.filename}`)
    if (part.source?.text?.value) result.push(`file:name:${withoutMentionSigil(part.source.text.value)}`)
  }
  if (part.type === "agent") result.push(`agent:${part.name}`)
  if (part.type === "subtask") {
    result.push(`subtask:${part.agent}:${part.command ?? ""}:${part.description}:${part.prompt}`)
  }
  if (part.type === "text") {
    const reference = referencePromptMetadata(part.metadata?.reference)
    if (reference) {
      result.push(`reference:source:${withoutMentionSigil(reference.source.value)}`)
      result.push(`reference:name:${reference.target === undefined ? reference.name : `${reference.name}/${reference.target}`}`)
    }
  }
  return result
}

function addPromptPartSignatures(seen: Set<string>, part: PromptInput["parts"][number]) {
  for (const signature of promptPartSignatures(part)) seen.add(signature)
}

function hasPromptPartSignature(seen: Set<string>, part: PromptInput["parts"][number]) {
  const signatures = promptPartSignatures(part)
  return signatures.length > 0 && signatures.some((signature) => seen.has(signature))
}

function messageTurnID(info: MessageV2.Info) {
  return info.role === "assistant" ? info.parentID : info.id
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  readonly prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts, Image.Error>
  readonly loop: (input: LoopInput) => Effect.Effect<MessageV2.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts, Session.BusyError>
  readonly command: (input: CommandInput) => Effect.Effect<MessageV2.WithParts, Image.Error>
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const bus = yield* Bus.Service
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const fsys = yield* AppFileSystem.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const references = yield* Reference.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const skillService = yield* Skill.Service
    const foundation = yield* ToolFoundation.Service
    const activeTurns = new Map<SessionID, TurnContext>()
    const closedTurns = new Set<string>()
    const terminalErrorReasons = new Map<string, string>()
    const runner = Effect.fn("SessionPrompt.runner")(function* () {
      return yield* EffectBridge.make()
    })
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* elog.info("cancel", { sessionID })
      const activeTurn = activeTurns.get(sessionID)
      if (activeTurn) {
        if (!AbortAudit.latestForTurn(activeTurn)) {
          AbortAudit.recordRequested({ sessionID, turnID: activeTurn.turnID, source: "unknown", actor: "unknown" })
        }
        yield* emitTurnAborted(activeTurn, "interrupted")
      } else if (!AbortAudit.latest(sessionID)) {
        AbortAudit.recordRequested({ sessionID, source: "unknown", actor: "unknown" })
      }
      yield* state.cancel(sessionID)
      AbortAudit.recordResolved({
        sessionID,
        turn: activeTurn,
        result: activeTurn ? "turn_aborted" : "no_active_turn",
      })
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [{ type: "text", text: template }]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      const mentionSource = (match: RegExpMatchArray) => {
        const start = match.index ?? 0
        return { value: match[0], start, end: start + match[0].length }
      }
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const slash = name.indexOf("/")
          const alias = slash === -1 ? name : name.slice(0, slash)
          const reference = yield* references.get(alias)
          if (reference) {
            const source = mentionSource(match)
            if (reference.kind === "invalid") {
              parts.push(
                referenceTextPart({ reference, source, target: slash === -1 ? undefined : name.slice(slash + 1) }),
              )
              return
            }

            yield* references.ensure(reference.path)
            if (slash === -1) {
              parts.push(referenceTextPart({ reference, source }))
              return
            }

            const target = name.slice(slash + 1)
            const targetPath = path.resolve(reference.path, target)
            if (!AppFileSystem.contains(reference.path, targetPath)) {
              parts.push(
                referenceTextPart({
                  reference,
                  source,
                  target,
                  targetPath,
                  problem: `Path escapes configured reference @${alias}: ${target}`,
                }),
              )
              return
            }

            const info = yield* fsys.stat(targetPath).pipe(Effect.option)
            if (Option.isNone(info)) {
              parts.push(
                referenceTextPart({
                  reference,
                  source,
                  target,
                  targetPath,
                  problem: `Path does not exist inside configured reference @${alias}: ${target}`,
                }),
              )
              return
            }

            parts.push({
              type: "file",
              url: pathToFileURL(targetPath).href,
              filename: name,
              mime: info.value.type === "Directory" ? "application/x-directory" : "text/plain",
            })
            return
          }

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const normalizePromptInputExplicitParts = Effect.fn("SessionPrompt.normalizePromptInputExplicitParts")(function* (
      input: PromptInput,
    ) {
      const seen = new Set<string>()
      for (const part of input.parts) addPromptPartSignatures(seen, part)

      const parts: Array<PromptInput["parts"][number]> = []
      let added = 0
      const addedByType: Record<string, number> = {}

      for (const part of input.parts) {
        parts.push(part)
        if (part.type !== "text" || part.synthetic === true || !part.text.includes("@")) continue

        const resolved = yield* resolvePromptParts(part.text)
        for (const candidate of resolved) {
          if (candidate.type === "text" && candidate.synthetic !== true) continue
          if (hasPromptPartSignature(seen, candidate)) continue

          addPromptPartSignatures(seen, candidate)
          parts.push(candidate)
          added++
          addedByType[candidate.type] = (addedByType[candidate.type] ?? 0) + 1
        }
      }

      return {
        input: added === 0 ? input : { ...input, parts },
        added,
        addedByType,
      }
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: MessageV2.WithParts[]
      providerID: ProviderID
      modelID: ModelID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: MessageV2.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is MessageV2.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl)
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: input.session.id,
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter((e): e is Extract<LLMEvent, { type: "text-delta" }> => e.type === "text-delta"),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => elog.error("failed to generate title", { error: Cause.squash(cause) })))
    })

    const insertReminders = Effect.fn("SessionPrompt.insertReminders")(function* (input: {
      messages: MessageV2.WithParts[]
      agent: Agent.Info
      session: Session.Info
    }) {
      const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
      if (!userMessage) return input.messages

      if (!flags.experimentalPlanMode) {
        if (input.agent.name === "plan") {
          userMessage.parts.push({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text: PROMPT_PLAN,
            synthetic: true,
          })
        }
        const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
        if (wasPlan && input.agent.name === "build") {
          userMessage.parts.push({
            id: PartID.ascending(),
            messageID: userMessage.info.id,
            sessionID: userMessage.info.sessionID,
            type: "text",
            text: BUILD_SWITCH,
            synthetic: true,
          })
        }
        return input.messages
      }

      const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")
      if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
        const ctx = yield* InstanceState.context
        const plan = Session.plan(input.session, ctx)
        if (!(yield* fsys.existsSafe(plan))) return input.messages
        const part = yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: userMessage.info.id,
          sessionID: userMessage.info.sessionID,
          type: "text",
          text: `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`,
          synthetic: true,
        })
        userMessage.parts.push(part)
        return input.messages
      }

      if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

      const ctx = yield* InstanceState.context
      const plan = Session.plan(input.session, ctx)
      const exists = yield* fsys.existsSafe(plan)
      if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
      const part = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: `<system-reminder>
Plan mode is active. The user indicated that they do not want you to execute yet -- you MUST NOT make any edits (with the exception of the plan file mentioned below), run any non-readonly tools (including changing configs or making commits), or otherwise make any changes to the system. This supersedes any other instructions you have received.

## Plan File Info:
${exists ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.` : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`}
You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this you are only allowed to take READ-ONLY actions.

## Plan Workflow

### Phase 1: Initial Understanding
Goal: Gain a comprehensive understanding of the user's request by reading through code and asking them questions. Critical: In this phase you should only use the explore subagent type.

1. Focus on understanding the user's request and the code associated with their request

2. **Launch up to 3 explore agents IN PARALLEL** (single message, multiple tool calls) to efficiently explore the codebase.
 - Use 1 agent when the task is isolated to known files, the user provided specific file paths, or you're making a small targeted change.
 - Use multiple agents when: the scope is uncertain, multiple areas of the codebase are involved, or you need to understand existing patterns before planning.
 - Quality over quantity - 3 agents maximum, but you should try to use the minimum number of agents necessary (usually just 1)
 - If using multiple agents: Provide each agent with a specific search focus or area to explore. Example: One agent searches for existing implementations, another explores related components, a third investigates testing patterns

3. After exploring the code, use the question tool to clarify ambiguities in the user request up front.

### Phase 2: Design
Goal: Design an implementation approach.

Launch general agent(s) to design the implementation based on the user's intent and your exploration results from Phase 1.

You can launch up to 1 agent(s) in parallel.

**Guidelines:**
- **Default**: Launch at least 1 Plan agent for most tasks - it helps validate your understanding and consider alternatives
- **Skip agents**: Only for truly trivial tasks (typo fixes, single-line changes, simple renames)

Examples of when to use multiple agents:
- The task touches multiple parts of the codebase
- It's a large refactor or architectural change
- There are many edge cases to consider
- You'd benefit from exploring different approaches

Example perspectives by task type:
- New feature: simplicity vs performance vs maintainability
- Bug fix: root cause vs workaround vs prevention
- Refactoring: minimal change vs clean architecture

In the agent prompt:
- Provide comprehensive background context from Phase 1 exploration including filenames and code path traces
- Describe requirements and constraints
- Request a detailed implementation plan

### Phase 3: Review
Goal: Review the plan(s) from Phase 2 and ensure alignment with the user's intentions.
1. Read the critical files identified by agents to deepen your understanding
2. Ensure that the plans align with the user's original request
3. Use question tool to clarify any remaining questions with the user

### Phase 4: Final Plan
Goal: Write your final plan to the plan file (the only file you can edit).
- Include only your recommended approach, not all alternatives
- Ensure that the plan file is concise enough to scan quickly, but detailed enough to execute effectively
- Include the paths of critical files to be modified
- Include a verification section describing how to test the changes end-to-end (run the code, use MCP tools, run tests)

### Phase 5: Call plan_exit tool
At the very end of your turn, once you have asked the user questions and are happy with your final plan file - you should always call plan_exit to indicate to the user that you are done planning.
This is critical - your turn should only end with either asking the user a question or calling plan_exit. Do not stop unless it's for these 2 reasons.

**Important:** Use question tool to clarify requirements/approach, use plan_exit to request plan approval. Do NOT use question tool to ask "Is this plan okay?" - that's what plan_exit does.

NOTE: At any point in time through this workflow you should feel free to ask the user questions or clarifications. Don't make large assumptions about user intent. The goal is to present a well researched plan to the user, and tie any loose ends before implementation begins.
</system-reminder>`,
        synthetic: true,
      })
      userMessage.parts.push(part)
      return input.messages
    })

    function insertEngineeringReminder(input: { messages: MessageV2.WithParts[]; turn?: TurnContext }) {
      const text = EngineeringHarness.reminder(input.turn)
      if (!text) return input.messages
      const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
      if (!userMessage) return input.messages
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text,
        synthetic: true,
      })
      return input.messages
    }

    const resolveTools = Effect.fn("SessionPrompt.resolveTools")(function* (input: {
      agent: Agent.Info
      model: Provider.Model
      session: Session.Info
      tools?: Record<string, boolean>
      processor: Pick<SessionProcessor.Handle, "message" | "updateToolCall" | "completeToolCall">
      bypassAgentCheck: boolean
      messages: MessageV2.WithParts[]
      turn?: TurnContext
    }) {
      using _ = log.time("resolveTools")
      const tools: Record<string, AITool> = {}
      const dynamicCandidates: Array<Pick<DynamicToolStatus, "id" | "source" | "schema_projected">> = []
      const run = yield* runner()
      const promptOps = yield* ops()
      if (input.turn?.model_info.supports.tools === false) {
        input.turn.dynamic_tools = CodexTurn.defaultDynamicTools({
          requested: input.tools ?? {},
          activePermissionProfile: input.turn.active_permission_profile,
          approvalPolicy: input.turn.approval_policy,
          modelSupportsTools: false,
          selectedEnvironmentID: input.turn.selected_environment_id,
        })
        yield* AialraTurnTrace.emit({
          phase: "tools.dynamic.resolved",
          turnID: input.turn.turnID,
          sessionID: input.session.id,
          messageID: input.processor.message.id,
          data: {
            ...input.turn.dynamic_tools,
            availableCount: 0,
            disabledCount: 0,
            model_supports_tools: false,
          },
        })
        yield* AialraTurnTrace.emit({
          phase: "model.capability.degraded",
          turnID: input.turn.turnID,
          sessionID: input.session.id,
          messageID: input.processor.message.id,
          data: {
            model_info: input.turn.model_info,
            reason: "当前模型的 ModelInfo 未声明支持工具调用，本轮工具选择被关闭",
            requested: { tools: true },
          },
        })
        return tools
      }

      const context = (args: any, options: ToolExecutionOptions): Tool.Context => ({
        sessionID: input.session.id,
        abort: options.abortSignal!,
        messageID: input.processor.message.id,
        callID: options.toolCallId,
        turn: input.turn,
        extra: { model: input.model, bypassAgentCheck: input.bypassAgentCheck, promptOps },
        agent: input.agent.name,
        messages: input.messages,
        metadata: (val) =>
          input.processor.updateToolCall(options.toolCallId, (match) => {
            if (!["running", "pending"].includes(match.state.status)) return match
            return {
              ...match,
              state: {
                title: val.title,
                metadata: val.metadata,
                status: "running",
                input: args,
                time: { start: Date.now() },
              },
            }
          }),
        ask: (req) =>
          permission
            .ask({
              ...req,
              sessionID: input.session.id,
              turnID: input.turn?.turnID,
              approvalPolicy: input.turn?.approval_policy,
              approval_reviewer: input.turn?.approvals_reviewer,
              requested_by: "assistant_tool",
              requested_at: new Date().toISOString(),
              overridden_by_constraints: false,
              permissionProfile: input.turn?.active_permission_profile ?? input.turn?.permission_profile,
              sandboxPolicy: input.turn?.sandbox_policy,
              tool: { messageID: input.processor.message.id, callID: options.toolCallId },
              ruleset: Permission.merge(input.agent.permission, input.session.permission ?? []),
            })
            .pipe(Effect.orDie),
      })

      const selectedEnvironment = input.turn?.environments.find(
        (environment) => environment.environmentID === input.turn?.selected_environment_id,
      )
      const toolDisabledReasons = (id: string) => {
        const reasons: string[] = []
        if (input.tools?.[id] === false) reasons.push("用户或上文显式关闭该工具")
        const permissionRules = input.turn
          ? CodexTurn.permissionRules({
              profile: input.turn.permission_profile,
              approvalPolicy: input.turn.approval_policy,
              base: input.session.permission,
            })
          : input.session.permission
        if (Permission.disabled([id], Permission.merge(input.agent.permission, permissionRules ?? [])).has(id)) {
          reasons.push("权限规则或当前 permission profile 禁用该工具")
        }
        if (["bash", "shell"].includes(id) && selectedEnvironment?.shell?.status === "unsupported") {
          reasons.push("当前 environment 不支持 shell 执行")
        }
        if (
          ["read", "write", "edit", "apply_patch", "glob", "grep"].includes(id) &&
          selectedEnvironment?.fileSystem?.status === "unsupported"
        ) {
          reasons.push("当前 environment 不支持文件系统工具")
        }
        return reasons
      }

      const publishDynamicTools = Effect.fn("SessionPrompt.publishDynamicTools")(function* () {
        if (!input.turn) return
        const available: DynamicToolStatus[] = []
        const disabled: DynamicToolStatus[] = []
        const candidateByID = new Map(dynamicCandidates.map((candidate) => [candidate.id, candidate]))
        for (const id of Object.keys(tools).toSorted((a, b) => a.localeCompare(b))) {
          const candidate = candidateByID.get(id) ?? { id, source: "plugin" as const, schema_projected: false }
          const reasons = toolDisabledReasons(id)
          if (reasons.length) {
            delete tools[id]
            disabled.push({ ...candidate, status: "disabled", reasons })
            continue
          }
          available.push({ ...candidate, status: "available", reasons: [] })
        }
        input.turn.dynamic_tools = CodexTurn.defaultDynamicTools({
          requested: input.tools ?? {},
          activePermissionProfile: input.turn.active_permission_profile,
          approvalPolicy: input.turn.approval_policy,
          modelSupportsTools: input.turn.model_info.supports.tools,
          selectedEnvironmentID: input.turn.selected_environment_id,
          available,
          disabled,
        })
        yield* AialraTurnTrace.emit({
          phase: "tools.dynamic.resolved",
          turnID: input.turn.turnID,
          sessionID: input.session.id,
          messageID: input.processor.message.id,
          data: {
            ...input.turn.dynamic_tools,
            availableCount: available.length,
            disabledCount: disabled.length,
            model_supports_tools: input.turn.model_info.supports.tools,
          },
        })
      })

      for (const item of yield* registry.tools({
        modelID: ModelID.make(input.model.api.id),
        providerID: input.model.providerID,
        agent: input.agent,
      })) {
        const schema = ProviderTransform.schema(input.model, ToolJsonSchema.fromTool(item))
        dynamicCandidates.push({ id: item.id, source: "registry", schema_projected: true })
        tools[item.id] = tool({
          description: item.description,
          inputSchema: jsonSchema(schema),
          execute(args, options) {
            return run.promise(
              Effect.gen(function* () {
                const ctx = context(args, options)
                ctx.extra = { ...ctx.extra, tool: item.id }
                const gate = EngineeringHarness.beforeTool(ctx.turn, item.id, args)
                if (gate.blocked) {
                  return {
                    title: "工程门禁已阻止工具调用",
                    metadata: {
                      blocked: true,
                      tool: item.id,
                    },
                    output: gate.output,
                  }
                }
                yield* plugin.trigger(
                  "tool.execute.before",
                  { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID },
                  { args },
                )
                const result = yield* foundation.execute({
                  sessionID: ctx.sessionID,
                  messageID: ctx.messageID,
                  turn: ctx.turn,
                  tool: item.id,
                  callID: ctx.callID,
                  source: "opencode_registry",
                  input: args,
                  run: item.execute(args, ctx),
                })
                const output = {
                  ...result,
                  attachments: result.attachments?.map((attachment) => ({
                    ...attachment,
                    id: PartID.ascending(),
                    sessionID: ctx.sessionID,
                    messageID: input.processor.message.id,
                  })),
                }
                yield* plugin.trigger(
                  "tool.execute.after",
                  { tool: item.id, sessionID: ctx.sessionID, callID: ctx.callID, args },
                  output,
                )
                yield* input.processor.completeToolCall(options.toolCallId, output)
                return output
              }),
            )
          },
        })
      }

      for (const [key, item] of Object.entries(yield* mcp.tools())) {
        const execute = item.execute
        if (!execute) continue

        const schema = yield* Effect.promise(() => Promise.resolve(asSchema(item.inputSchema).jsonSchema))
        const transformed = ProviderTransform.schema(input.model, schema)
        item.inputSchema = jsonSchema(transformed)
        dynamicCandidates.push({ id: key, source: "mcp", schema_projected: true })
        item.execute = (args, opts) =>
          run.promise(
            Effect.gen(function* () {
              const ctx = context(args, opts)
              const gate = EngineeringHarness.beforeTool(ctx.turn, key, args)
              if (gate.blocked) {
                return {
                  content: [
                    {
                      type: "text",
                      text: gate.output,
                    },
                  ],
                  isError: true,
                }
              }
              yield* plugin.trigger(
                "tool.execute.before",
                { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId },
                { args },
              )
              const result: Awaited<ReturnType<NonNullable<typeof execute>>> = yield* foundation.execute({
                sessionID: ctx.sessionID,
                messageID: ctx.messageID,
                turn: ctx.turn,
                tool: key,
                callID: ctx.callID,
                source: "mcp_registry",
                input: args,
                run: Effect.gen(function* () {
                  yield* ctx.ask({ permission: key, metadata: {}, patterns: ["*"], always: ["*"] })
                  return yield* Effect.promise(() => execute(args, opts))
                }).pipe(
                  Effect.withSpan("Tool.execute", {
                    attributes: {
                      "tool.name": key,
                      "tool.call_id": opts.toolCallId,
                      "session.id": ctx.sessionID,
                      "message.id": input.processor.message.id,
                    },
                  }),
                ),
              })
              yield* plugin.trigger(
                "tool.execute.after",
                { tool: key, sessionID: ctx.sessionID, callID: opts.toolCallId, args },
                result,
              )

              const textParts: string[] = []
              const attachments: Omit<MessageV2.FilePart, "id" | "sessionID" | "messageID">[] = []
              for (const contentItem of result.content) {
                if (contentItem.type === "text") textParts.push(contentItem.text)
                else if (contentItem.type === "image") {
                  attachments.push({
                    type: "file",
                    mime: contentItem.mimeType,
                    url: `data:${contentItem.mimeType};base64,${contentItem.data}`,
                  })
                } else if (contentItem.type === "resource") {
                  const { resource } = contentItem
                  if (resource.text) textParts.push(resource.text)
                  if (resource.blob) {
                    attachments.push({
                      type: "file",
                      mime: resource.mimeType ?? "application/octet-stream",
                      url: `data:${resource.mimeType ?? "application/octet-stream"};base64,${resource.blob}`,
                      filename: resource.uri,
                    })
                  }
                }
              }

              const truncated = yield* truncate.output(textParts.join("\n\n"), {}, input.agent)
              const metadata = {
                ...result.metadata,
                truncated: truncated.truncated,
                ...(truncated.truncated && { outputPath: truncated.outputPath }),
              }

              const output = {
                title: "",
                metadata,
                output: truncated.content,
                attachments: attachments.map((attachment) => ({
                  ...attachment,
                  id: PartID.ascending(),
                  sessionID: ctx.sessionID,
                  messageID: input.processor.message.id,
                })),
                content: result.content,
              }
              yield* input.processor.completeToolCall(opts.toolCallId, output)
              return output
            }),
          )
        tools[key] = item
      }

      yield* publishDynamicTools()
      yield* foundation.resolve({
        sessionID: input.session.id,
        turn: input.turn,
        toolCount: Object.keys(tools).length,
      })
      return tools
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: MessageV2.SubtaskPart
      model: Provider.Model
      lastUser: MessageV2.User
      sessionID: SessionID
      session: Session.Info
      msgs: MessageV2.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: MessageV2.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: MessageV2.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${task.agent}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies MessageV2.ToolPart)
            }),
          ask: (req: any) =>
            permission
              .ask({
                ...req,
                sessionID,
                turnID: assistantMessage.parentID,
                ruleset: Permission.merge(taskAgent.permission, session.permission ?? []),
              })
              .pipe(Effect.orDie),
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
            return Effect.void
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies MessageV2.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies MessageV2.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies MessageV2.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: MessageV2.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies MessageV2.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd, started, userMessageID } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
              const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
              const error = new NamedError.Unknown({ message: `Agent not found: "${input.agent}".${hint}` })
              yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: MessageV2.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: MessageV2.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: MessageV2.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const started = Date.now()
            const part: MessageV2.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID: ulid(),
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Shell.Started, {
                sessionID: input.sessionID,
                timestamp: DateTime.makeUnsafe(started),
                callID: part.callID,
                command: input.command,
              })
            }
            yield* AialraTurnTrace.emit({
              phase: "tool.lifecycle.requested",
              turnID: userMsg.id,
              sessionID: input.sessionID,
              messageID: msg.id,
              data: {
                schema: "aialra.tool_lifecycle.v1",
                hook: "pre",
                status: "requested",
                tool: ShellID.ToolID,
                callID: part.callID,
                source: "shell_route",
                inputKeys: ["command"],
                cwd: ctx.directory,
              },
            })
            yield* AialraTurnTrace.emit({
              phase: "tool.lifecycle.started",
              turnID: userMsg.id,
              sessionID: input.sessionID,
              messageID: msg.id,
              data: {
                schema: "aialra.tool_lifecycle.v1",
                hook: "pre",
                status: "started",
                tool: ShellID.ToolID,
                callID: part.callID,
                source: "shell_route",
                inputKeys: ["command"],
                cwd: ctx.directory,
                startedAt: started,
              },
            })
            return { msg, part, cwd: ctx.directory, started, userMessageID: userMsg.id }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const shellSecurity = SessionSecurity.overrides({ sessionID: input.sessionID, cwd })
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          const execCtx = { sessionID: input.sessionID, messageID: msg.id, callID: part.callID }
          const execCommandID = ExecCommand.id(execCtx)
          const execProcessID = `proc_${execCommandID}`
          const networkProxy = shellSecurity.networkProxy ?? CodexTurn.networkProxy({
            networkPermissions: shellSecurity.networkPermissions,
            selectedEnvironmentID: shellSecurity.selectedEnvironmentID,
          })
          const execCommon = {
            commandID: execCommandID,
            backend: "node_bun" as const,
            command: input.command,
            shell: sh,
            argv: [sh, ...args],
            cwd,
            timeoutMs: 0,
            processID: execProcessID,
            turnID: userMessageID,
            environmentID: shellSecurity.selectedEnvironmentID,
            environmentCwd: cwd,
            permissionProfileID: shellSecurity.activePermissionProfile.id,
            permissionProfile: shellSecurity.permissionProfile,
            approvalPolicy: shellSecurity.approvalPolicy,
            approvalsReviewer: shellSecurity.approvalsReviewer,
            networkPolicy: shellSecurity.networkPolicy,
            networkPermissions: shellSecurity.networkPermissions,
            networkProxy,
            sandboxPolicy: shellSecurity.sandboxPolicy,
            shellEnvPolicy: shellSecurity.shellEnvironmentPolicy,
            approvalDecision: "not_requested",
          }
          let execOutputSeq = 0
          let output = ""
          let exitCode: number | null = null
          let aborted = false
          let failed = false
          let failureMessage: string | undefined
          let settled = false

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (settled) return
              settled = true
              const abortMetadata = aborted
                ? AbortAudit.shellMetadataForSession({ sessionID: input.sessionID, turnID: msg.parentID })
                : undefined
              if (abortMetadata) {
                output +=
                  "\n\n" +
                  [
                    "<metadata>",
                    "Command aborted by OpenCode abort signal",
                    `source=${abortMetadata.source}`,
                    `sourceLabel=${abortMetadata.sourceLabel}`,
                    `actor=${abortMetadata.actor}`,
                    abortMetadata.requestID ? `requestID=${abortMetadata.requestID}` : "requestID=missing",
                    abortMetadata.reason ? `reason=${abortMetadata.reason}` : "reason=not_provided",
                    "</metadata>",
                  ].join("\n")
              }
              const completed = Date.now()
              yield* ExecCommand.finished(execCtx, {
                ...execCommon,
                exitCode,
                timedOut: false,
                aborted,
                outputChars: output.length,
                truncated: false,
                durationMs: completed - started,
                failure: failureMessage,
              })
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Shell.Ended, {
                  sessionID: input.sessionID,
                  timestamp: DateTime.makeUnsafe(completed),
                  callID: part.callID,
                  output,
                })
              }
              const metadata = {
                output,
                description: "",
                ...(abortMetadata ? { abort: abortMetadata } : {}),
              }
              const result = ToolResultProtocol.ToolResultSettlement.build({
                sessionID: input.sessionID,
                turnID: msg.parentID,
                messageID: msg.id,
                environmentID: "default",
                executorType: "local",
                toolCallID: part.callID,
                tool: ShellID.ToolID,
                status: aborted ? "aborted" : failed ? "failed" : "completed",
                startedAt: started,
                completedAt: completed,
                output,
                error: failureMessage,
                metadata,
                source: "shell_route",
              })
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = failed
                  ? {
                      status: "error",
                      time: { ...part.state.time, end: completed },
                      input: part.state.input,
                      metadata: ToolResultProtocol.ToolResultSettlement.attach(metadata, result),
                      error: failureMessage ?? "Shell command failed",
                    }
                  : {
                      status: "completed",
                      time: { ...part.state.time, end: completed },
                      input: part.state.input,
                      title: "",
                      metadata: ToolResultProtocol.ToolResultSettlement.attach(metadata, result),
                      output,
                    }
                yield* sessions.updatePart(part)
              }
              yield* ToolResultProtocol.ToolResultSettlement.emit(result)
              if (!failed) {
                yield* AialraTurnTrace.emit({
                  phase: aborted ? "tool.lifecycle.aborted" : "tool.lifecycle.completed",
                  turnID: msg.parentID,
                  sessionID: input.sessionID,
                  messageID: msg.id,
                  data: {
                    schema: "aialra.tool_lifecycle.v1",
                    hook: "post",
                    status: aborted ? "aborted" : "completed",
                    tool: ShellID.ToolID,
                    callID: part.callID,
                    source: "shell_route",
                    inputKeys: ["command"],
                    cwd,
                    durationMs: completed - started,
                    outputChars: output.length,
                    abort: abortMetadata,
                  },
                })
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const proxyEnv =
                networkProxy.enforcement === "environment" && networkProxy.url
                  ? {
                      HTTP_PROXY: networkProxy.url,
                      HTTPS_PROXY: networkProxy.url,
                      ALL_PROXY: networkProxy.url,
                      http_proxy: networkProxy.url,
                      https_proxy: networkProxy.url,
                      all_proxy: networkProxy.url,
                    }
                  : {}
              if (networkProxy.enforcement === "environment" && networkProxy.url) {
                yield* AialraTurnTrace.emit({
                  phase: "network.proxy.applied",
                  turnID: userMessageID,
                  sessionID: input.sessionID,
                  messageID: msg.id,
                  data: {
                    tool: ShellID.ToolID,
                    target: input.command.slice(0, 240),
                    status: networkProxy.enforcement,
                    reason: "用户 shell route 已注入标准代理环境变量",
                    network_proxy: {
                      ...networkProxy,
                      url: "redacted",
                    },
                  },
                })
              }
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, ...proxyEnv, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              yield* ExecCommand.started(execCtx, execCommon)
              const handle = yield* spawner.spawn(cmd)
              yield* Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                Effect.gen(function* () {
                  output += chunk
                  yield* ExecCommand.output(execCtx, {
                    ...execCommon,
                    stream: "combined",
                    seq: execOutputSeq++,
                    text: chunk,
                    preview: chunk.slice(0, 240),
                  })
                  if (part.state.status === "running") {
                    part.state.metadata = { output, description: "" }
                    yield* sessions.updatePart(part)
                  }
                }),
              )
              exitCode = yield* handle.exitCode
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          failed = Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)
          failureMessage = failed && Exit.isFailure(exit) ? errorMessage(Cause.squash(exit.cause)) : undefined
          yield* finish

          if (failed && Exit.isFailure(exit)) {
            const error = Cause.squash(exit.cause)
            yield* AialraTurnTrace.emit({
              phase: "tool.lifecycle.failed",
              turnID: msg.parentID,
              sessionID: input.sessionID,
              messageID: msg.id,
              data: {
                schema: "aialra.tool_lifecycle.v1",
                hook: "post",
                status: "failed",
                tool: ShellID.ToolID,
                callID: part.callID,
                source: "shell_route",
                inputKeys: ["command"],
                cwd,
                errorType: error instanceof Error ? error.name : typeof error,
                errorMessage: error instanceof Error ? error.message : String(error),
              },
            })
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderID,
      modelID: ModelID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        yield* bus.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}`,
          }).toObject(),
        })
      }
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = Database.use((db) =>
        db.select({ model: SessionTable.model }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
      )
      if (current?.model) {
        return {
          providerID: ProviderID.make(current.model.providerID),
          modelID: ModelID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!ag) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const current = Database.use((db) =>
        db
          .select({ agent: SessionTable.agent, model: SessionTable.model })
          .from(SessionTable)
          .where(eq(SessionTable.id, input.sessionID))
          .get(),
      )
      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
          : undefined
      const variant = input.variant ?? (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)

      const info: MessageV2.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: input.tools,
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
      }

      if (current?.agent !== info.agent) {
        yield* events.publish(SessionEvent.AgentSwitched, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(info.time.created),
          agent: info.agent,
        })
      }
      if (
        current?.model?.providerID !== info.model.providerID ||
        current.model.id !== info.model.modelID ||
        (current.model.variant === "default" ? undefined : current.model.variant) !== info.model.variant
      ) {
        yield* events.publish(SessionEvent.ModelSwitched, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(info.time.created),
          model: {
            id: ModelV2.ID.make(info.model.modelID),
            providerID: ProviderV2.ID.make(info.model.providerID),
            variant: ModelV2.VariantID.make(info.model.variant ?? "default"),
          },
        })
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends MessageV2.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<MessageV2.Part>): MessageV2.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const referenceContextFromFilePart = Effect.fnUntraced(function* (
        part: Extract<PromptInput["parts"][number], { type: "file" }>,
        filepath: string,
      ) {
        const name = part.filename?.replace(/#\d+(?:-\d*)?$/, "")
        if (!name) return
        const slash = name.indexOf("/")
        if (slash === -1) return

        const reference = yield* references.get(name.slice(0, slash))
        if (!reference || reference.kind === "invalid") return
        if (!AppFileSystem.contains(reference.path, filepath)) return

        const target = path.relative(reference.path, filepath).split(path.sep).join("/")
        if (!target || target.startsWith("../") || target === "..") return

        return referenceTextPart({
          reference,
          source: part.source?.text ?? { value: `@${name}`, start: 0, end: name.length + 1 },
          target,
          targetPath: filepath,
        })
      })

      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<MessageV2.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<MessageV2.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            const exit = yield* mcp.readResource(clientName, uri).pipe(Effect.exit)
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if ("text" in c && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && c.blob) {
                  const mime = "mimeType" in c ? c.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mime}]`,
                  })
                }
              }
              pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
            } else {
              const error = Cause.squash(exit.cause)
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              break
            case "file:": {
              log.info("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              const referenceContext = yield* referenceContextFromFilePart(part, filepath)
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                const controller = new AbortController()
                return read
                  .execute(args, {
                    sessionID: input.sessionID,
                    abort: controller.signal,
                    agent: input.agent!,
                    messageID: info.id,
                    extra: { bypassCwdCheck: true, ...extra },
                    messages: [],
                    metadata: () => Effect.void,
                    ask: () => Effect.void,
                  })
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<MessageV2.Part>[] = [
                  ...(referenceContext
                    ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                    : []),
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read file", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit)
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read directory", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* bus.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    ...(referenceContext
                      ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                      : []),
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  ...(referenceContext
                    ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                    : []),
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              return [
                ...(referenceContext ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }] : []),
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                {
                  id: part.id,
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "file",
                  url:
                    `data:${mime};base64,` +
                    Buffer.from(yield* fsys.readFile(filepath).pipe(Effect.catch(Effect.die))).toString("base64"),
                  mime,
                  filename: part.filename!,
                  source: part.source,
                },
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const resolvedParts = yield* Effect.forEach(input.parts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      const parts = yield* Effect.forEach(resolvedParts, (part) =>
        part.type === "file" && part.mime.startsWith("image/")
          ? image.normalize(part).pipe(
              Effect.catchIf(
                (error) => error instanceof Image.ResizerUnavailableError,
                () => Effect.succeed(part),
              ),
            )
          : Effect.succeed(part),
      )

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        log.error("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      parts.forEach((part, index) => {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) return
        log.error("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      })

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)
      const nextPrompt = parts.reduce(
        (result, part) => {
          if (part.type === "text") {
            if (part.synthetic) result.synthetic.push(part.text)
            else result.text.push(part.text)
            const reference = referencePromptMetadata(part.metadata?.reference)
            if (reference) {
              result.references.push(
                new ReferenceAttachment({
                  name: reference.name,
                  kind: reference.kind,
                  uri: reference.path ? pathToFileURL(reference.path).href : undefined,
                  repository: reference.repository,
                  branch: reference.branch,
                  target: reference.target,
                  targetUri: reference.targetPath ? pathToFileURL(reference.targetPath).href : undefined,
                  problem: reference.problem,
                  source: new Source({
                    start: reference.source.start,
                    end: reference.source.end,
                    text: reference.source.value,
                  }),
                }),
              )
            }
          }
          if (part.type === "file") {
            result.files.push(
              new FileAttachment({
                uri: part.url,
                mime: part.mime,
                name: part.filename,
                source: part.source
                  ? new Source({
                      start: part.source.text.start,
                      end: part.source.text.end,
                      text: part.source.text.value,
                    })
                  : undefined,
              }),
            )
          }
          if (part.type === "agent") {
            result.agents.push(
              new AgentAttachment({
                name: part.name,
                source: part.source
                  ? new Source({
                      start: part.source.start,
                      end: part.source.end,
                      text: part.source.value,
                    })
                  : undefined,
              }),
            )
          }
          return result
        },
        {
          text: [] as string[],
          files: [] as FileAttachment[],
          agents: [] as AgentAttachment[],
          references: [] as ReferenceAttachment[],
          synthetic: [] as string[],
        },
      )
      // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
      if (flags.experimentalEventSystem) {
        yield* events.publish(SessionEvent.Prompted, {
          sessionID: input.sessionID,
          timestamp: DateTime.makeUnsafe(info.time.created),
          prompt: {
            text: nextPrompt.text.join("\n"),
            files: nextPrompt.files,
            agents: nextPrompt.agents,
            references: nextPrompt.references,
          },
        })
      }
      for (const text of nextPrompt.synthetic) {
        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
        if (flags.experimentalEventSystem) {
          yield* events.publish(SessionEvent.Synthetic, {
            sessionID: input.sessionID,
            timestamp: DateTime.makeUnsafe(info.time.created),
            text,
          })
        }
      }

      return { info, parts }
    }, Effect.scoped)

    const emitTurnStarted = Effect.fn("SessionPrompt.turnStarted")(function* (
      turn: TurnContext,
      model?: Provider.Model,
    ) {
      const modelContextWindow = model ? CodexTurn.modelContextWindow(model) : undefined
      const selectedCwd = CodexTurn.environmentCwd(turn)
      yield* bus.publish(Session.Event.TurnStarted, {
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        startedAt: turn.startedAt,
        modelContextWindow,
        collaborationModeKind: turn.collaboration_mode.kind,
        cwd: selectedCwd,
      })
      yield* AialraTurnTrace.emit({
        phase: "turn.started",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: turn.messageID,
        data: {
          startedAt: turn.startedAt,
          modelContextWindow,
          collaborationModeKind: turn.collaboration_mode.kind,
          cwd: selectedCwd,
          legacyCwd: turn.cwd === selectedCwd ? undefined : turn.cwd,
          selectedEnvironmentID: turn.selected_environment_id,
        },
      })
    })

    const emitTurnCompleted = Effect.fn("SessionPrompt.turnCompleted")(function* (
      turn: TurnContext,
      lastAgentMessage?: MessageID,
    ) {
      if (closedTurns.has(turn.turnID)) return
      closedTurns.add(turn.turnID)
      activeTurns.delete(turn.sessionID)
      const completedAt = Date.now()
      const finalText =
        lastAgentMessage && !turn.noReply ? assistantText(lastAgentMessage).trim() : undefined
      const forcedReason = terminalErrorReasons.get(turn.turnID)
      terminalErrorReasons.delete(turn.turnID)
      const relatedEventCount = PublicEventLog.list({ sessionID: turn.sessionID }).filter(
        (event) => event.turnID === turn.turnID,
      ).length
      const terminalAnomaly = EngineeringHarness.terminalAnomaly({
        turn,
        lastAgentMessage,
        finalText,
        forcedReason,
      })
      yield* TurnDiffStore.emit(
        TurnDiffStore.finalize({
          sessionID: turn.sessionID,
          turnID: turn.turnID,
          messageID: lastAgentMessage,
          outcome: "completed",
        }),
      )
      if (terminalAnomaly) {
        yield* AialraTurnTrace.emit({
          phase: "turn.terminal.anomaly",
          turnID: turn.turnID,
          sessionID: turn.sessionID,
          messageID: lastAgentMessage,
          data: {
            reason: terminalAnomaly,
            finalTextChars: finalText?.length ?? 0,
            toolCallCount: EngineeringHarness.state(turn.turnID)?.loop.toolCalls,
          },
        })
      }
      yield* bus.publish(Session.Event.TurnCompleted, {
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        lastAgentMessage,
        completedAt,
        durationMs: Math.max(0, completedAt - turn.startedAt),
        timeToFirstTokenMs: turn.timeToFirstTokenMs,
      })
      yield* AialraTurnTrace.emit({
        phase: "turn.completed",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: lastAgentMessage,
        data: {
          completedAt,
          durationMs: Math.max(0, completedAt - turn.startedAt),
          timeToFirstTokenMs: turn.timeToFirstTokenMs,
          terminalAnomaly,
          relatedEventCount,
        },
      })
      yield* AialraTurnTrace.emit({
        phase: "turn.terminal.reconciled",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: lastAgentMessage,
        data: {
          outcome: "completed",
          terminalAnomaly,
          completedAt,
          relatedEventCount: relatedEventCount + 1,
        },
      })
      EngineeringHarness.finish(turn, "completed", finalText)
      yield* status.set(turn.sessionID, { type: "idle" })
    })

    const emitTurnAborted = Effect.fn("SessionPrompt.turnAborted")(function* (
      turn: TurnContext,
      reason: TurnAbortReason,
    ) {
      if (closedTurns.has(turn.turnID)) return
      closedTurns.add(turn.turnID)
      activeTurns.delete(turn.sessionID)
      const completedAt = Date.now()
      const abortRequest = AbortAudit.latestForTurn(turn)
      const relatedEventCount = PublicEventLog.list({ sessionID: turn.sessionID }).filter(
        (event) => event.turnID === turn.turnID,
      ).length
      yield* TurnDiffStore.emit(
        TurnDiffStore.finalize({
          sessionID: turn.sessionID,
          turnID: turn.turnID,
          messageID: turn.messageID,
          outcome: "aborted",
        }),
      )
      yield* bus.publish(Session.Event.TurnAborted, {
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        reason,
        completedAt,
        durationMs: Math.max(0, completedAt - turn.startedAt),
      })
      yield* AialraTurnTrace.emit({
        phase: "turn.aborted",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: turn.messageID,
        data: {
          reason,
          abortSource: abortRequest?.source ?? "unknown",
          abortSourceLabel: abortSourceLabel(abortRequest?.source ?? "unknown"),
          abortRequestID: abortRequest?.id,
          abortActor: abortRequest?.actor ?? "unknown",
          completedAt,
          durationMs: Math.max(0, completedAt - turn.startedAt),
          relatedEventCount,
        },
      })
      yield* AialraTurnTrace.emit({
        phase: "turn.terminal.reconciled",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: turn.messageID,
        data: {
          outcome: "aborted",
          reason,
          abortSource: abortRequest?.source ?? "unknown",
          abortRequestID: abortRequest?.id,
          abortActor: abortRequest?.actor ?? "unknown",
          completedAt,
          relatedEventCount: relatedEventCount + 1,
        },
      })
      EngineeringHarness.finish(turn, "aborted")
      yield* status.set(turn.sessionID, { type: "idle" })
    })

    const promptWithRoute: (
      input: PromptInput,
      route: TurnFrameRoute,
    ) => Effect.Effect<MessageV2.WithParts, Image.Error> = Effect.fn("SessionPrompt.prompt")(function* (
      input: PromptInput,
      route: TurnFrameRoute,
    ) {
      const receivedAt = Date.now()
      const messageID = input.messageID ?? MessageID.ascending()
      const intakeInput: PromptInput = input.messageID ? input : { ...input, messageID }
      yield* AialraTurnTrace.emit({
        phase: "prompt.received",
        turnID: intakeInput.messageID,
        sessionID: intakeInput.sessionID,
        messageID: intakeInput.messageID,
        data: {
          route,
          agent: intakeInput.agent,
          providerID: intakeInput.model?.providerID,
          modelID: intakeInput.model?.modelID,
          variant: intakeInput.variant,
          noReply: intakeInput.noReply === true,
          tools: AialraTurnTrace.keys(intakeInput.tools),
          parts: AialraTurnTrace.partSummary(intakeInput.parts),
          format: intakeInput.format?.type ?? "text",
        },
      })
      const normalized = yield* normalizePromptInputExplicitParts(intakeInput)
      const normalizedInput = normalized.input
      yield* AialraTurnTrace.emit({
        phase: "prompt.explicit_context_resolved",
        turnID: normalizedInput.messageID,
        sessionID: normalizedInput.sessionID,
        messageID: normalizedInput.messageID,
        data: {
          route,
          added: normalized.added,
          addedByType: normalized.addedByType,
          parts: AialraTurnTrace.partSummary(normalizedInput.parts),
        },
      })
      const session = yield* sessions.get(normalizedInput.sessionID).pipe(Effect.orDie)
      yield* revert.cleanup(session)
      const message = yield* createUserMessage(normalizedInput)
      const messageAgent = yield* agents.get(message.info.agent)
      yield* sessions.touch(normalizedInput.sessionID)
      const frame = TurnFrame.fromUserMessage({
        route,
        info: message.info,
        parts: message.parts,
        noReply: normalizedInput.noReply,
        receivedAt,
      })
      yield* AialraTurnTrace.emit({
        phase: "turn.frame.created",
        turnID: frame.turnID,
        sessionID: frame.sessionID,
        messageID: frame.messageID,
        data: frame,
      })
      const instance = yield* InstanceState.context
      const activeModelExit = yield* provider
        .getModel(message.info.model.providerID, message.info.model.modelID)
        .pipe(Effect.exit)
      const activeModel = Exit.isSuccess(activeModelExit) ? activeModelExit.value : undefined
      const activeProvider = activeModel ? yield* provider.getProvider(activeModel.providerID) : undefined
      const sessionCwd = path.resolve(session.directory || instance.worktree)
      const turnSettings =
        normalizedInput.settings?.cwd === undefined
          ? normalizedInput.settings
          : {
              ...normalizedInput.settings,
              cwd: path.resolve(sessionCwd, normalizedInput.settings.cwd),
            }
      const modelInfo = CodexTurn.modelInfo({
        providerID: message.info.model.providerID,
        modelID: message.info.model.modelID,
        variant: message.info.model.variant,
        provider: activeProvider,
        model: activeModel,
      })
      const selectedVariantOptions = message.info.model.variant ? activeModel?.variants?.[message.info.model.variant] : undefined
      const requestedVariantEffort = message.info.model.variant
        ? (stringOption(selectedVariantOptions, ["reasoningEffort", "reasoning_effort", "effort", "thinkingLevel"]) ??
          message.info.model.variant)
        : undefined
      const modelOptionEffort = stringOption(activeModel?.options, [
        "reasoningEffort",
        "reasoning_effort",
        "effort",
        "thinkingLevel",
      ])
      const requestedEffort = turnSettings?.effort ?? requestedVariantEffort ?? modelOptionEffort
      const effortSource = turnSettings?.effort
        ? ("turn_settings" as const)
        : requestedVariantEffort
          ? ("variant" as const)
          : modelOptionEffort
            ? ("model_options" as const)
            : ("none" as const)
      const effortResolution = CodexTurn.reasoningEffortResolution({
        requested: requestedEffort,
        source: effortSource,
        modelInfo,
        model: activeModel,
      })
      const requestedServiceTier =
        turnSettings?.serviceTier ?? stringOption(activeModel?.options, ["serviceTier", "service_tier"])
      const serviceTierSource = turnSettings?.serviceTier
        ? ("turn_settings" as const)
        : requestedServiceTier
          ? ("model_options" as const)
          : ("none" as const)
      const serviceTierResolution = CodexTurn.serviceTierResolution({
        requested: requestedServiceTier,
        source: serviceTierSource,
        modelInfo,
      })
      const cwd = path.resolve(turnSettings?.cwd ?? sessionCwd)
      const security = SessionSecurity.overrides({
        sessionID: frame.sessionID,
        cwd: sessionCwd,
        turnSettings,
      })
      const userPromptText = promptText(message.parts)
      const engineering = EngineeringHarness.snapshot({
        controls: security.engineering.controls,
        prompt: userPromptText,
      })
      const turn = CodexTurn.fromFrame({
        frame,
        parts: message.parts,
        cwd,
        retry: CodexTurn.retryConfig({
          providerOptions: activeProvider?.options,
          modelOptions: activeModel?.options,
        }),
        startedAt: receivedAt,
        approvalPolicy: security.approvalPolicy,
        approvalsReviewer: security.approvalsReviewer,
        sandboxPolicy: security.sandboxPolicy,
        permissionProfile: security.permissionProfile,
        requestedPermissionProfile: security.requestedPermissionProfile,
        resolvedPermissionProfile: security.resolvedPermissionProfile,
        activePermissionProfile: security.activePermissionProfile,
        environments: security.environments,
        selectedEnvironmentID: security.selectedEnvironmentID,
        modelInfo,
        requestedEffort: effortResolution.requested,
        effectiveEffort: effortResolution.effective,
        effortResolution,
        effort: effortSource === "variant" ? undefined : effortResolution.effective,
        summary: turnSettings?.summary ?? stringOption(activeModel?.options, ["reasoningSummary", "reasoning_summary", "summary"]),
        requestedServiceTier,
        effectiveServiceTier: serviceTierResolution.effective,
        serviceTierResolution,
        serviceTier: serviceTierResolution.effective,
        httpContext: security.httpContext,
        networkPolicy: security.networkPolicy,
        networkPermissions: security.networkPermissions,
        shellEnvironmentPolicy: security.shellEnvironmentPolicy,
        commandPolicy: security.commandPolicy,
        securityConstraints: security.securityConstraints,
        stepBudget: security.stepBudget,
        threadSettings: security.threadSettings,
        extensionData: CodexTurn.extensionData(turnSettings?.extensionData),
        metadata: {
          turnSettingsOverride: turnSettings !== undefined,
        },
        engineering,
      })
      if (message.info.format?.type === "json_schema") {
        turn.final_output_json_schema = message.info.format.schema
      }
      if (Object.keys(turn.extension_data).length) {
        yield* AialraTurnTrace.emit({
          phase: "extension.data.attached",
          turnID: turn.turnID,
          sessionID: turn.sessionID,
          messageID: turn.messageID,
          extension_data: turn.extension_data,
          data: {
            namespaces: Object.keys(turn.extension_data).sort(),
            namespaceCount: Object.keys(turn.extension_data).length,
          },
        })
      }
      const allSkillList = yield* skillService.all()
      const skillList = yield* skillService.available(messageAgent)
      const availableSkillNames = new Set(skillList.map((skill) => skill.name))
      turn.skill_catalog = CodexTurn.defaultSkillCatalog({
        skills: skillList,
        disabled: allSkillList
          .filter((skill) => !availableSkillNames.has(skill.name))
          .map((skill) => ({
            ...skill,
            reasons: [`skill ${skill.name} denied by agent permission rules`],
          })),
        agent: messageAgent.name,
        cwd: CodexTurn.environmentCwd(turn),
        activePermissionProfile: turn.active_permission_profile,
        approvalPolicy: turn.approval_policy,
        selectedEnvironmentID: turn.selected_environment_id,
      })
      yield* AialraTurnTrace.emit({
        phase: "skill.catalog.resolved",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: turn.messageID,
        data: {
          ...turn.skill_catalog,
          availableCount: turn.skill_catalog.available.length,
          disabledCount: turn.skill_catalog.disabled.length,
        },
      })
      yield* AialraTurnTrace.emit({
        phase: "model.effort.resolved",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: turn.messageID,
        data: {
          model_info: turn.model_info,
          requested_effort: turn.requested_effort,
          effective_effort: turn.effective_effort,
          effort_resolution: turn.effort_resolution,
        },
      })
      yield* AialraTurnTrace.emit({
        phase: "model.service_tier.resolved",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: turn.messageID,
        data: {
          model_info: turn.model_info,
          requested_service_tier: turn.requested_service_tier,
          effective_service_tier: turn.effective_service_tier,
          service_tier_resolution: turn.service_tier_resolution,
        },
      })
      const capabilityDecisions = CodexTurn.modelCapabilityDecisions(turn)
      turn.metadata.modelCapabilityDecisions = capabilityDecisions
      yield* AialraTurnTrace.emit({
        phase: "model.capability.evaluated",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: turn.messageID,
        data: {
          model_info: turn.model_info,
          decisions: capabilityDecisions,
        },
      })
      if (Object.values(capabilityDecisions.ignored).some(Boolean)) {
        yield* AialraTurnTrace.emit({
          phase: "model.capability.degraded",
          turnID: turn.turnID,
          sessionID: turn.sessionID,
          messageID: turn.messageID,
          data: {
            model_info: turn.model_info,
            decisions: capabilityDecisions,
            reason: "本轮请求包含模型能力未声明支持的参数，运行时会按 ModelInfo 跳过对应参数",
          },
        })
      }
      activeTurns.set(turn.sessionID, turn)
      yield* AialraTurnTrace.emit({
        phase: "turn.context.created",
        turnID: turn.turnID,
        sessionID: turn.sessionID,
        messageID: turn.messageID,
        data: CodexTurn.traceSummary(turn),
      })
      yield* emitTurnStarted(turn, activeModel)
      if (engineering.intake.taskClass !== "unknown" || engineering.intake.needsClarification) {
        turn.engineering = EngineeringHarness.start({ turn, prompt: userPromptText })
      }
      yield* AialraTurnTrace.emit({
        phase: "user_message.created",
        turnID: frame.turnID,
        sessionID: normalizedInput.sessionID,
        messageID: message.info.id,
        data: {
          route,
          agent: message.info.agent,
          providerID: message.info.model.providerID,
          modelID: message.info.model.modelID,
          variant: message.info.model.variant,
          tools: AialraTurnTrace.keys(message.info.tools),
          format: message.info.format?.type ?? "text",
          parts: AialraTurnTrace.partSummary(message.parts),
        },
      })

      const permissions: Permission.Rule[] = []
      for (const [t, enabled] of Object.entries(normalizedInput.tools ?? {})) {
        permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
      }
      if (permissions.length > 0) {
        session.permission = permissions
        yield* sessions.setPermission({ sessionID: session.id, permission: permissions })
      }

      if (normalizedInput.noReply === true) {
        yield* AialraTurnTrace.emit({
          phase: "prompt.no_reply",
          turnID: frame.turnID,
          sessionID: normalizedInput.sessionID,
          messageID: message.info.id,
        })
        yield* emitTurnCompleted(turn, message.info.id)
        return message
      }
      yield* AialraTurnTrace.emit({
        phase: "prompt.reply_requested",
        turnID: frame.turnID,
        sessionID: normalizedInput.sessionID,
        messageID: message.info.id,
      })
      const completeTurn = (lastAgentMessage?: MessageID) =>
        emitTurnCompleted(turn, lastAgentMessage)
      const abortTurn = (reason: TurnAbortReason) =>
        emitTurnAborted(turn, reason)
      const createTerminalErrorAssistant = Effect.fn("SessionPrompt.terminalErrorAssistant")(function* (
        reason: string,
        error: unknown,
      ) {
        const now = Date.now()
        const msg: MessageV2.Assistant = {
          id: MessageID.ascending(),
          parentID: message.info.id,
          role: "assistant",
          mode: message.info.agent,
          agent: message.info.agent,
          variant: message.info.model.variant,
          path: { cwd: CodexTurn.environmentCwd(turn), root: instance.worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: message.info.model.modelID,
          providerID: message.info.model.providerID,
          time: { created: now, completed: now },
          sessionID: normalizedInput.sessionID,
          finish: "stop",
          error: MessageV2.fromError(error instanceof Error ? error : new Error(String(error)), {
            providerID: message.info.model.providerID,
          }),
        }
        terminalErrorReasons.set(turn.turnID, reason)
        yield* sessions.updateMessage(msg)
        yield* AialraTurnTrace.emit({
          phase: "turn.terminal.assistant_error",
          turnID: turn.turnID,
          sessionID: normalizedInput.sessionID,
          messageID: msg.id,
          data: {
            reason,
            error: error instanceof Error ? error.message : String(error),
          },
        })
        return msg.id
      })
      const result = yield* loop({ sessionID: normalizedInput.sessionID, turn }).pipe(
        Effect.onInterrupt(() => abortTurn("interrupted")),
        Effect.catch((error: Image.Error) =>
          createTerminalErrorAssistant("model_not_started", error).pipe(
            Effect.flatMap((messageID) => completeTurn(messageID)),
            Effect.andThen(Effect.fail(error)),
          ),
        ),
      )
      yield* AialraTurnTrace.emit({
        phase: "prompt.completed",
        turnID: frame.turnID,
        sessionID: normalizedInput.sessionID,
        messageID: result.info.id,
        data: {
          role: result.info.role,
          parts: AialraTurnTrace.partSummary(result.parts),
        },
      })
      yield* completeTurn(result.info.role === "assistant" ? result.info.id : undefined)
      return result
    })

    const prompt: (input: PromptInput) => Effect.Effect<MessageV2.WithParts, Image.Error> = (input) =>
      promptWithRoute(input, "prompt")

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user").pipe(Effect.orDie)
      if (Option.isSome(match)) return match.value
      const msgs = yield* sessions.messages({ sessionID, limit: 1 }).pipe(Effect.orDie)
      if (msgs.length > 0) return msgs[0]
      throw new Error("Impossible")
    })

    const runLoop: (sessionID: SessionID, turn?: TurnContext) => Effect.Effect<MessageV2.WithParts> = Effect.fn(
      "SessionPrompt.run",
    )(function* (sessionID: SessionID, turn?: TurnContext) {
        const ctx = yield* InstanceState.context
        const slog = elog.with({ sessionID })
        let structured: unknown
        let step = 0
        const repeatedToolCalls = new Map<string, number>()
        const session = yield* sessions.get(sessionID).pipe(Effect.orDie)
        yield* AialraTurnTrace.emit({
          phase: "loop.started",
          turnID: turn?.turnID,
          sessionID,
          data: {
            agent: session.agent,
            providerID: session.model?.providerID,
            modelID: session.model?.id,
            parentID: session.parentID,
            cwd: turn?.cwd,
          },
        })

        while (true) {
          yield* status.set(sessionID, { type: "busy" })
          yield* slog.info("loop", { step })

          let msgs = yield* MessageV2.filterCompactedEffect(sessionID)

          const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = MessageV2.latest(msgs)

          if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

          const lastAssistantMsg = msgs.findLast(
            (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
          )
          // Some providers return "stop" even when the assistant message contains tool calls.
          // Keep the loop running so tool results can be sent back to the model.
          // Skip provider-executed tool parts — those were fully handled within the
          // provider's stream (e.g. DWS Agent Platform) and don't need a re-loop.
          const hasToolCalls =
            lastAssistantMsg?.parts.some((part) => part.type === "tool" && !part.metadata?.providerExecuted) ?? false

          if (lastAssistantMsg) {
            for (const part of lastAssistantMsg.parts) {
              const signature = toolLoopSignature(part)
              if (!signature) continue
              const count = (repeatedToolCalls.get(signature) ?? 0) + 1
              repeatedToolCalls.set(signature, count)
              if (count === REPEATED_TOOL_WARNING_THRESHOLD) {
                yield* AialraTurnTrace.emit({
                  phase: "turn.repeated_tool.warning",
                  turnID: lastUser.id,
                  sessionID,
                  messageID: lastAssistantMsg.info.id,
                  step,
                  data: {
                    threshold: REPEATED_TOOL_WARNING_THRESHOLD,
                    tool: part.type === "tool" ? part.tool : undefined,
                    status: part.type === "tool" ? part.state.status : undefined,
                  },
                })
              }
            }
          }

          if (
            lastAssistant?.finish &&
            !["tool-calls"].includes(lastAssistant.finish) &&
            !hasToolCalls &&
            lastUser.id < lastAssistant.id
          ) {
            yield* slog.info("exiting loop")
            yield* AialraTurnTrace.emit({
              phase: "loop.exit_condition.met",
              turnID: lastUser.id,
              sessionID,
              messageID: lastAssistant.id,
              step,
              data: {
                finish: lastAssistant.finish,
                hasToolCalls,
                lastUserID: lastUser.id,
              },
            })
            break
          }

          step++
          yield* AialraTurnTrace.emit({
            phase: "loop.step.started",
            turnID: lastUser.id,
            sessionID,
            messageID: lastUser.id,
            step,
            data: {
              messageCount: msgs.length,
              taskCount: tasks.length,
              taskTypes: tasks.map((task) => task.type),
              lastFinishedID: lastFinished?.id,
            },
          })
          if (step === 1)
            yield* title({
              session,
              modelID: lastUser.model.modelID,
              providerID: lastUser.model.providerID,
              history: msgs,
            }).pipe(Effect.ignore, Effect.forkIn(scope))

          const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
          const task = tasks.pop()

          if (task?.type === "subtask") {
            yield* AialraTurnTrace.emit({
              phase: "task.subtask.started",
              turnID: lastUser.id,
              sessionID,
              messageID: lastUser.id,
              step,
              data: {
                agent: task.agent,
                hasCommand: !!task.command,
                modelID: task.model?.modelID,
                providerID: task.model?.providerID,
              },
            })
            yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
            yield* AialraTurnTrace.emit({
              phase: "task.subtask.finished",
              turnID: lastUser.id,
              sessionID,
              messageID: lastUser.id,
              step,
              data: {
                agent: task.agent,
                hasCommand: !!task.command,
              },
            })
            continue
          }

          if (task?.type === "compaction") {
            yield* AialraTurnTrace.emit({
              phase: "task.compaction.started",
              turnID: lastUser.id,
              sessionID,
              messageID: lastUser.id,
              step,
              data: {
                auto: task.auto,
                overflow: task.overflow,
              },
            })
            const result = yield* compaction.process({
              messages: msgs,
              parentID: lastUser.id,
              sessionID,
              auto: task.auto,
              overflow: task.overflow,
            })
            yield* AialraTurnTrace.emit({
              phase: "task.compaction.finished",
              turnID: lastUser.id,
              sessionID,
              messageID: lastUser.id,
              step,
              data: { result },
            })
            if (result === "stop") break
            continue
          }

          if (
            lastFinished &&
            lastFinished.summary !== true &&
            (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
          ) {
            yield* AialraTurnTrace.emit({
              phase: "compaction.overflow_requested",
              turnID: lastUser.id,
              sessionID,
              messageID: lastFinished.id,
              step,
              data: {
                providerID: model.providerID,
                modelID: model.id,
              },
            })
            yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
            continue
          }

          const agent = yield* agents.get(lastUser.agent)
          if (!agent) {
            const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
            const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
            const error = new NamedError.Unknown({ message: `Agent not found: "${lastUser.agent}".${hint}` })
            yield* bus.publish(Session.Event.Error, { sessionID, error: error.toObject() })
            throw error
          }
          const activeTurnForStep = turn ? SessionSecurity.applyToTurn(turn) : undefined
          if (activeTurnForStep) activeTurns.set(activeTurnForStep.sessionID, activeTurnForStep)
          const maxSteps = turnMaxSteps(agent.steps, activeTurnForStep)
          if (step > maxSteps) {
            const msg: MessageV2.Assistant = {
              id: MessageID.ascending(),
              parentID: lastUser.id,
              role: "assistant",
              mode: agent.name,
              agent: agent.name,
              variant: lastUser.model.variant,
              path: { cwd: turn?.cwd ?? ctx.directory, root: ctx.worktree },
              cost: 0,
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.id,
              providerID: model.providerID,
              time: { created: Date.now(), completed: Date.now() },
              sessionID,
              finish: "stop",
              error: MessageV2.fromError(
                new Error(`Turn step budget exceeded after ${maxSteps} steps. Stopping this run to prevent an infinite tool loop.`),
                { providerID: model.providerID },
              ),
            }
            yield* sessions.updateMessage(msg)
            yield* AialraTurnTrace.emit({
              phase: "turn.budget_limited",
              turnID: lastUser.id,
              sessionID,
              messageID: msg.id,
              step,
              data: {
                maxSteps,
                agent: agent.name,
              },
            })
            if (activeTurnForStep) yield* emitTurnAborted(activeTurnForStep, "budget_limited")
            yield* status.set(sessionID, { type: "idle" })
            return { info: msg, parts: [] }
          }
          const isLastStep = step >= maxSteps
          msgs = yield* insertReminders({ messages: msgs, agent, session })
          msgs = insertEngineeringReminder({ messages: msgs, turn: activeTurnForStep })

          const msg: MessageV2.Assistant = {
            id: MessageID.ascending(),
            parentID: lastUser.id,
            role: "assistant",
            mode: agent.name,
            agent: agent.name,
            variant: lastUser.model.variant,
            path: { cwd: turn?.cwd ?? ctx.directory, root: ctx.worktree },
            cost: 0,
            tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
            modelID: model.id,
            providerID: model.providerID,
            time: { created: Date.now() },
            sessionID,
          }
          yield* sessions.updateMessage(msg)
          yield* AialraTurnTrace.emit({
            phase: "assistant_message.created",
            turnID: msg.parentID,
            sessionID,
            messageID: msg.id,
            step,
            data: {
              parentID: msg.parentID,
              agent: msg.agent,
              providerID: msg.providerID,
              modelID: msg.modelID,
              isLastStep,
              maxSteps: maxSteps === Infinity ? "infinity" : maxSteps,
            },
          })

          const finalizeInterruptedAssistant = Effect.gen(function* () {
            if (msg.time.completed) return
            msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
              providerID: msg.providerID,
              aborted: true,
            })
            msg.time.completed = Date.now()
            yield* sessions.updateMessage(msg)
          })

          const handle = yield* processor
            .create({
              assistantMessage: msg,
              sessionID,
              model,
            })
            .pipe(Effect.onInterrupt(() => finalizeInterruptedAssistant))

          const outcome: "break" | "continue" = yield* Effect.gen(function* () {
            const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
            const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false

            const tools = yield* resolveTools({
              agent,
              session,
              model,
              tools: lastUser.tools,
              processor: handle,
              bypassAgentCheck,
              messages: msgs,
              turn: activeTurnForStep,
            })
            yield* AialraTurnTrace.emit({
              phase: "tools.resolved",
              turnID: lastUser.id,
              sessionID,
              messageID: handle.message.id,
              step,
              data: {
                count: Object.keys(tools).length,
                tools: Object.keys(tools).sort(),
                bypassAgentCheck,
              },
            })

            const structuredToolSupported =
              lastUser.format?.type !== "json_schema" ||
              (activeTurnForStep?.model_info.supports.structured_output ?? model.capabilities.toolcall)
            if (lastUser.format?.type === "json_schema" && structuredToolSupported) {
              tools["StructuredOutput"] = createStructuredOutputTool({
                schema: lastUser.format.schema,
                onSuccess(output) {
                  structured = output
                },
              })
              if (activeTurnForStep) {
                const structuredStatus: DynamicToolStatus = {
                  id: "StructuredOutput",
                  source: "structured_output",
                  status: "available",
                  reasons: ["本轮请求了 JSON schema 结构化输出"],
                  schema_projected: true,
                }
                activeTurnForStep.dynamic_tools = {
                  ...activeTurnForStep.dynamic_tools,
                  available: [
                    ...activeTurnForStep.dynamic_tools.available.filter((item) => item.id !== "StructuredOutput"),
                    structuredStatus,
                  ],
                  available_ids: [
                    ...activeTurnForStep.dynamic_tools.available_ids.filter((id) => id !== "StructuredOutput"),
                    "StructuredOutput",
                  ].toSorted((a, b) => a.localeCompare(b)),
                }
                yield* AialraTurnTrace.emit({
                  phase: "tools.dynamic.resolved",
                  turnID: activeTurnForStep.turnID,
                  sessionID,
                  messageID: handle.message.id,
                  step,
                  data: {
                    ...activeTurnForStep.dynamic_tools,
                    availableCount: activeTurnForStep.dynamic_tools.available.length,
                    disabledCount: activeTurnForStep.dynamic_tools.disabled.length,
                    model_supports_tools: activeTurnForStep.model_info.supports.tools,
                    reason: "structured output tool dynamically injected for this turn",
                  },
                })
              }
              yield* AialraTurnTrace.emit({
                phase: "tools.structured_output_added",
                turnID: lastUser.id,
                sessionID,
                messageID: handle.message.id,
                step,
              })
            }
            if (lastUser.format?.type === "json_schema" && !structuredToolSupported) {
              yield* AialraTurnTrace.emit({
                phase: "model.capability.degraded",
                turnID: lastUser.id,
                sessionID,
                messageID: handle.message.id,
                step,
                data: {
                  model_info: activeTurnForStep?.model_info,
                  reason: "当前模型的 ModelInfo 未声明支持结构化输出工具，本轮不强制 StructuredOutput tool",
                  requested: { structured_output: true },
                },
              })
            }

            if (step === 1)
              yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

            if (step > 1 && lastFinished) {
              for (const m of msgs) {
                if (m.info.role !== "user" || m.info.id <= lastFinished.id) continue
                for (const p of m.parts) {
                  if (p.type !== "text" || p.ignored || p.synthetic) continue
                  if (!p.text.trim()) continue
                  p.text = [
                    "<system-reminder>",
                    "The user sent the following message:",
                    p.text,
                    "",
                    "Please address this message and continue with your tasks.",
                    "</system-reminder>",
                  ].join("\n")
                }
              }
            }

            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

            const [skillPrompt, env, instructions, modelMsgs] = yield* Effect.all([
              sys.skills(agent),
              sys.environment(model),
              instruction.system().pipe(Effect.orDie),
              MessageV2.toModelMessagesEffect(msgs, model),
            ])
            if (skillPrompt && activeTurnForStep && activeTurnForStep.skill_catalog.injected_ids.length === 0) {
              activeTurnForStep.skill_catalog = CodexTurn.markSkillCatalogInjected(activeTurnForStep.skill_catalog)
              yield* AialraTurnTrace.emit({
                phase: "skill.catalog.injected",
                turnID: lastUser.id,
                sessionID,
                messageID: handle.message.id,
                data: {
                  ...activeTurnForStep.skill_catalog,
                  injectedCount: activeTurnForStep.skill_catalog.injected_ids.length,
                },
              })
            }
            const system = [...env, ...instructions, ...(skillPrompt ? [skillPrompt] : [])]
            const format = lastUser.format ?? { type: "text" as const }
            const structuredOutputSupported =
              format.type === "json_schema"
                ? (activeTurnForStep?.model_info.supports.structured_output ?? model.capabilities.toolcall)
                : false
            if (format.type === "json_schema" && structuredOutputSupported) system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
            yield* AialraTurnTrace.emit({
              phase: "model.context_built",
              turnID: lastUser.id,
              sessionID,
              messageID: handle.message.id,
              step,
              data: {
                systemCount: system.length,
                modelMessageCount: modelMsgs.length,
                toolCount: Object.keys(tools).length,
                format: format.type,
                isLastStep,
                cwd: turn?.cwd,
                approval_policy: turn?.approval_policy,
                active_permission_profile: turn?.active_permission_profile,
                model_info: turn?.model_info,
                structuredOutputSupported,
              },
            })
            yield* AialraTurnTrace.emit({
              phase: "model.process.started",
              turnID: lastUser.id,
              sessionID,
              messageID: handle.message.id,
              step,
              data: {
                providerID: model.providerID,
                modelID: model.id,
                toolChoice: format.type === "json_schema" && structuredOutputSupported ? "required" : undefined,
                model_info: activeTurnForStep?.model_info,
              },
            })
            const activeProvider = yield* provider.getProvider(model.providerID)
            const activeTurn = activeTurnForStep
            const result = yield* handle.process({
              user: lastUser,
              agent,
              permission: activeTurn
                ? CodexTurn.permissionRules({
                    profile: activeTurn.permission_profile,
                    approvalPolicy: activeTurn.approval_policy,
                    base: session.permission,
                  })
                : session.permission,
              sessionID,
              parentSessionID: session.parentID,
              system,
              messages: [...modelMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
              tools,
              model,
              turn: activeTurn,
              retry:
                activeTurn?.retry ??
                CodexTurn.retryConfig({
                  providerOptions: activeProvider.options,
                  modelOptions: model.options,
                }),
              toolChoice: format.type === "json_schema" && structuredOutputSupported ? "required" : undefined,
            })
            yield* AialraTurnTrace.emit({
              phase: "model.process.finished",
              turnID: lastUser.id,
              sessionID,
              messageID: handle.message.id,
              step,
              data: {
                result,
                finish: handle.message.finish,
                hasError: !!handle.message.error,
                cost: handle.message.cost,
                tokens: handle.message.tokens,
              },
            })

            const verificationRepairPrompt = EngineeringHarness.verificationRepairPrompt(
              activeTurn,
              assistantText(handle.message.id),
            )
            if (verificationRepairPrompt) {
              const continuation: MessageV2.User = {
                id: MessageID.ascending(),
                sessionID,
                role: "user",
                time: { created: Date.now() },
                agent: lastUser.agent,
                model: lastUser.model,
                tools: lastUser.tools,
                system: lastUser.system,
                format: lastUser.format,
              }
              yield* sessions.updateMessage(continuation)
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: continuation.id,
                sessionID,
                type: "text",
                text: verificationRepairPrompt,
                synthetic: true,
              } satisfies MessageV2.TextPart)
              yield* AialraTurnTrace.emit({
                phase: "engineering.verification.repair_requested",
                turnID: activeTurn?.turnID,
                sessionID,
                messageID: handle.message.id,
                step,
                data: {
                  continuationID: continuation.id,
                },
              })
              return "continue" as const
            }

            const workspaceChanged = activeTurn ? yield* workspaceHasGitChange(activeTurn) : undefined
            const stopGatePrompt = EngineeringHarness.stopGatePrompt(activeTurn, assistantText(handle.message.id), {
              workspaceChanged,
            })
            if (stopGatePrompt) {
              const continuation: MessageV2.User = {
                id: MessageID.ascending(),
                sessionID,
                role: "user",
                time: { created: Date.now() },
                agent: lastUser.agent,
                model: lastUser.model,
                tools: lastUser.tools,
                system: lastUser.system,
                format: lastUser.format,
              }
              yield* sessions.updateMessage(continuation)
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: continuation.id,
                sessionID,
                type: "text",
                text: stopGatePrompt,
                synthetic: true,
              } satisfies MessageV2.TextPart)
              yield* AialraTurnTrace.emit({
                phase: "engineering.stop_gate.checked",
                turnID: activeTurn?.turnID,
                sessionID,
                messageID: handle.message.id,
                step,
                data: {
                  continuationID: continuation.id,
                  status: "blocked",
                },
              })
              return "continue" as const
            }

            const verificationPrompt = EngineeringHarness.verificationPrompt(
              activeTurn,
              assistantText(handle.message.id),
            )
            if (verificationPrompt) {
              const continuation: MessageV2.User = {
                id: MessageID.ascending(),
                sessionID,
                role: "user",
                time: { created: Date.now() },
                agent: lastUser.agent,
                model: lastUser.model,
                tools: lastUser.tools,
                system: lastUser.system,
                format: lastUser.format,
              }
              yield* sessions.updateMessage(continuation)
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: continuation.id,
                sessionID,
                type: "text",
                text: verificationPrompt,
                synthetic: true,
              } satisfies MessageV2.TextPart)
              yield* AialraTurnTrace.emit({
                phase: "engineering.verification.repair_requested",
                turnID: activeTurn?.turnID,
                sessionID,
                messageID: handle.message.id,
                step,
                data: {
                  continuationID: continuation.id,
                  reason: "final_without_verification",
                },
              })
              return "continue" as const
            }

            const zeroPatchPrompt = EngineeringHarness.zeroPatchPrompt(activeTurn, assistantText(handle.message.id), {
              workspaceChanged,
            })
            if (zeroPatchPrompt) {
              const continuation: MessageV2.User = {
                id: MessageID.ascending(),
                sessionID,
                role: "user",
                time: { created: Date.now() },
                agent: lastUser.agent,
                model: lastUser.model,
                tools: lastUser.tools,
                system: lastUser.system,
                format: lastUser.format,
              }
              yield* sessions.updateMessage(continuation)
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: continuation.id,
                sessionID,
                type: "text",
                text: zeroPatchPrompt,
                synthetic: true,
              } satisfies MessageV2.TextPart)
              yield* AialraTurnTrace.emit({
                phase: "engineering.zero_patch.recovery_requested",
                turnID: activeTurn?.turnID,
                sessionID,
                messageID: handle.message.id,
                step,
                data: {
                  continuationID: continuation.id,
                },
              })
              return "continue" as const
            }

            const prematureFinalPrompt = EngineeringHarness.prematureFinalPrompt(
              activeTurn,
              assistantText(handle.message.id),
            )
            if (prematureFinalPrompt) {
              const continuation: MessageV2.User = {
                id: MessageID.ascending(),
                sessionID,
                role: "user",
                time: { created: Date.now() },
                agent: lastUser.agent,
                model: lastUser.model,
                tools: lastUser.tools,
                system: lastUser.system,
                format: lastUser.format,
              }
              yield* sessions.updateMessage(continuation)
              yield* sessions.updatePart({
                id: PartID.ascending(),
                messageID: continuation.id,
                sessionID,
                type: "text",
                text: prematureFinalPrompt,
                synthetic: true,
              } satisfies MessageV2.TextPart)
              yield* AialraTurnTrace.emit({
                phase: "engineering.phase_gate.premature_final",
                turnID: activeTurn?.turnID,
                sessionID,
                messageID: handle.message.id,
                step,
                data: {
                  continuationID: continuation.id,
                },
              })
              return "continue" as const
            }

            if (structured !== undefined) {
              handle.message.structured = structured
              handle.message.finish = handle.message.finish ?? "stop"
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }

            const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
            if (finished && !handle.message.error) {
              if (format.type === "json_schema") {
                handle.message.error = new MessageV2.StructuredOutputError({
                  message: "Model did not produce structured output",
                  retries: 0,
                }).toObject()
                yield* sessions.updateMessage(handle.message)
                return "break" as const
              }
            }

            if (result === "stop") return "break" as const
            if (result === "compact") {
              yield* compaction.create({
                sessionID,
                agent: lastUser.agent,
                model: lastUser.model,
                auto: true,
                overflow: !handle.message.finish,
              })
            }
            return "continue" as const
          }).pipe(
            Effect.ensuring(instruction.clear(handle.message.id)),
            Effect.onInterrupt(() => finalizeInterruptedAssistant),
          )
          yield* AialraTurnTrace.emit({
            phase: "loop.step.finished",
            turnID: handle.message.parentID,
            sessionID,
            messageID: handle.message.id,
            step,
            data: {
              outcome,
              finish: handle.message.finish,
              hasError: !!handle.message.error,
            },
          })
          if (outcome === "break") break
          continue
        }

        yield* compaction.prune({ sessionID }).pipe(Effect.ignore, Effect.forkIn(scope))
        const final = yield* lastAssistant(sessionID)
        yield* AialraTurnTrace.emit({
          phase: "loop.finished",
          turnID: messageTurnID(final.info),
          sessionID,
          messageID: final.info.id,
          step,
          data: {
            role: final.info.role,
            parts: AialraTurnTrace.partSummary(final.parts),
          },
        })
        return final
      })

    const loop: (input: LoopInput & { turn?: TurnContext }) => Effect.Effect<MessageV2.WithParts> = Effect.fn(
      "SessionPrompt.loop",
    )(function* (input: LoopInput & { turn?: TurnContext }) {
      return yield* state.ensureRunning(
        input.sessionID,
        lastAssistant(input.sessionID),
        runLoop(input.sessionID, input.turn),
      )
    })

    const shell: (input: ShellInput) => Effect.Effect<MessageV2.WithParts, Session.BusyError> = Effect.fn(
      "SessionPrompt.shell",
    )(function* (input: ShellInput) {
      const ready = yield* Latch.make()
      return yield* state.startShell(input.sessionID, lastAssistant(input.sessionID), shellImpl(input, ready), ready)
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* elog.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        const results = yield* Effect.promise(() =>
          Promise.all(
            shellMatches.map(async ([, cmd]) => (await Process.text([cmd], { shell: sh, nothrow: true })).text),
          ),
        )
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
      if (!agent) {
        const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
        const hint = available.length ? ` Available agents: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Agent not found: "${agentName}".${hint}` })
        yield* bus.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }

      const templateParts = yield* resolvePromptParts(template)
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...templateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* promptWithRoute(
        {
          sessionID: input.sessionID,
          messageID: input.messageID,
          model: userModel,
          agent: userAgent,
          parts,
          variant: input.variant,
        },
        "command",
      )
      yield* bus.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      prompt,
      loop,
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(SessionRunState.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(SessionCompaction.defaultLayer),
    Layer.provide(SessionProcessor.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(MCP.defaultLayer),
    Layer.provide(LSP.defaultLayer),
    Layer.provide(ToolRegistry.defaultLayer),
    Layer.provide(Truncate.defaultLayer),
    Layer.provide(Provider.defaultLayer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(AppFileSystem.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(Session.defaultLayer),
    Layer.provide(SessionRevert.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(
      Layer.mergeAll(
        EventV2Bridge.defaultLayer,
        Agent.defaultLayer,
        Skill.defaultLayer,
        SystemPrompt.defaultLayer,
        LLM.defaultLayer,
        Reference.defaultLayer,
        ToolFoundation.defaultLayer,
        ToolOutputStore.defaultLayer,
        Bus.layer,
        CrossSpawnSpawner.defaultLayer,
        RuntimeFlags.defaultLayer,
      ),
    ),
  ),
)
const ModelRef = Schema.Struct({
  providerID: ProviderID,
  modelID: ModelID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  format: Schema.optional(MessageV2.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  settings: Schema.optional(SecurityTurnSettingsOverride),
  parts: Schema.Array(
    Schema.Union([
      MessageV2.TextPartInput,
      MessageV2.FilePartInput,
      MessageV2.AgentPartInput,
      MessageV2.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
})
export type PromptInput = Schema.Schema.Type<typeof PromptInput>

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
}) {}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(MessageV2.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export * as SessionPrompt from "./prompt"

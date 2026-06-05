import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { ExecProcessRegistry, type ExecProcessStatus } from "@/session/exec-process-registry"

const Status = Schema.Literals(["running", "completed", "failed", "timeout", "aborted"])

export const Parameters = Schema.Struct({
  process_id: Schema.optional(Schema.String).annotate({
    description: "One process_id to clean up. Omit to clean by filters.",
  }),
  process_ids: Schema.optional(Schema.Array(Schema.String)).annotate({
    description: "Multiple process_id values to clean up.",
  }),
  turn_id: Schema.optional(Schema.String).annotate({
    description: "Optional turn id filter. Defaults to the current turn when available.",
  }),
  environment_id: Schema.optional(Schema.String).annotate({
    description: "Optional environment id filter.",
  }),
  statuses: Schema.optional(Schema.Array(Status)).annotate({
    description: "Optional process statuses to clean. Defaults to all finished statuses unless include_running is true.",
  }),
  include_running: Schema.optional(Schema.Boolean).annotate({
    description: "When true, terminate still-running processes selected by the filters before marking them cleaned.",
  }),
  include_finished: Schema.optional(Schema.Boolean).annotate({
    description: "When false, do not clean already-finished process records. Defaults to true.",
  }),
  description: Schema.String.annotate({
    description: "Clear, concise description of why these background processes are being cleaned.",
  }),
})

type Metadata = {
  cleaned: number
  failed: number
  process_ids: string[]
}

export const CleanupProcessesTool = Tool.define<typeof Parameters, Metadata, never>(
  "cleanup_processes",
  Effect.succeed({
    description: [
      "Clean up background bash process records managed by the unified process manager.",
      "Use this after await_process, after a background command finishes, or when a live process must be terminated intentionally.",
      "By default it cleans finished processes only. Set include_running=true to terminate selected running processes.",
      "Every cleaned or terminated process is recorded in the public event stream.",
    ].join("\n"),
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        const result = yield* ExecProcessRegistry.cleanup({
          sessionID: ctx.sessionID,
          turnID: params.turn_id ?? ctx.turn?.turnID,
          environmentID: params.environment_id,
          processID: params.process_id,
          processIDs: params.process_ids ? [...params.process_ids] : undefined,
          statuses: params.statuses ? ([...params.statuses] as ExecProcessStatus[]) : undefined,
          includeRunning: params.include_running,
          includeFinished: params.include_finished,
          reason: params.description,
        })
        return {
          title: "Cleaned background processes",
          output: [
            `Cleaned: ${result.cleaned}`,
            `Failed: ${result.failed}`,
            result.results.length ? `Processes: ${result.results.map((item) => item.process_id).join(", ")}` : "Processes: none",
          ].join("\n"),
          metadata: {
            cleaned: result.cleaned,
            failed: result.failed,
            process_ids: result.results.map((item) => item.process_id),
          },
        }
      }),
  }),
)

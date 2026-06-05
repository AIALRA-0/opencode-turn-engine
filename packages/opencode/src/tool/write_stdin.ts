import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { ExecProcessRegistry } from "@/session/exec-process-registry"

export const Parameters = Schema.Struct({
  process_id: Schema.String.annotate({
    description: "The running process_id returned by the bash tool when yield_time_ms elapsed",
  }),
  text: Schema.optional(Schema.String).annotate({
    description: "Text to write to stdin. Use append_newline or control=newline when the process is waiting for Enter.",
  }),
  control: Schema.optional(Schema.Literals(["text", "newline", "ctrl-c", "eof"])).annotate({
    description: "Optional controlled stdin action. text writes text, newline appends Enter, ctrl-c interrupts, eof closes stdin.",
  }),
  append_newline: Schema.optional(Schema.Boolean).annotate({
    description: "When true and control is text or omitted, append a newline after text.",
  }),
  description: Schema.String.annotate({
    description: "Clear, concise description of why stdin is being written",
  }),
})

type Metadata = {
  process_id: string
  status: "written" | "denied"
  reason: string | null
  control: "text" | "newline" | "ctrl-c" | "eof"
  chars: number
}

export const WriteStdinTool = Tool.define<typeof Parameters, Metadata, never>(
  "write_stdin",
  Effect.succeed({
    description: [
      "Write stdin to a still-running bash process returned with a process_id.",
      "Use this instead of starting a new bash command when a long-running command, REPL, watcher, or confirmation prompt is waiting for input.",
      "The process_id must belong to this session and current turn; writes to ended, missing, or unrelated processes are denied and recorded.",
    ].join("\n"),
    parameters: Parameters,
    execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
      Effect.gen(function* () {
        const result = yield* ExecProcessRegistry.writeStdin(params.process_id, {
          sessionID: ctx.sessionID,
          turnID: ctx.turn?.turnID,
          messageID: ctx.messageID,
          toolCallID: ctx.callID,
          actor: "model",
          text: params.text,
          control: params.control,
          appendNewline: params.append_newline,
        })
        const status = result.ok ? "written" : "denied"
        return {
          title: result.ok ? "Wrote stdin" : "Stdin write denied",
          output: result.ok
            ? `Stdin was written to ${params.process_id}.`
            : `Stdin was not written to ${params.process_id}: ${result.reason}.`,
          metadata: {
            process_id: params.process_id,
            status,
            reason: result.reason,
            control: result.payload.control,
            chars: result.payload.text.length,
          },
        }
      }),
  }),
)

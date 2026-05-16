import { MessageV2 } from "./message-v2"
import type { MessageID, SessionID } from "./schema"

export type TurnFrameRoute = "prompt" | "command" | "shell"

export type TurnFrame = {
  version: "aialra.turn_frame.v1"
  turnID: MessageID
  route: TurnFrameRoute
  sessionID: SessionID
  messageID: MessageID
  agent: string
  model: {
    providerID: string
    modelID: string
    variant?: string
  }
  noReply: boolean
  format: string
  input: {
    partCount: number
    textParts: number
    textChars: number
    fileParts: number
    agentParts: number
    subtaskParts: number
    syntheticParts: number
  }
  explicit: {
    files: string[]
    agents: string[]
    references: string[]
  }
  tools: string[]
  timing: {
    receivedAt: number
    framedAt: number
  }
}

function unique(input: string[]) {
  return Array.from(new Set(input.filter(Boolean))).sort()
}

function textLength(part: MessageV2.Part) {
  return part.type === "text" && !part.synthetic ? part.text.length : 0
}

function isSynthetic(part: MessageV2.Part) {
  return "synthetic" in part && part.synthetic === true
}

function referenceLabel(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return
  const record = input as Record<string, unknown>
  const name = typeof record.name === "string" ? record.name : undefined
  if (!name) return
  const target = typeof record.target === "string" ? record.target : undefined
  return target ? `${name}/${target}` : name
}

function fileLabel(part: MessageV2.FilePart) {
  if (part.source?.text?.value) return part.source.text.value.replace(/^@/, "")
  if (part.filename) return part.filename
  return part.url
}

export namespace TurnFrame {
  export function fromUserMessage(input: {
    route: TurnFrameRoute
    info: MessageV2.User
    parts: MessageV2.Part[]
    noReply?: boolean
    receivedAt?: number
  }): TurnFrame {
    const files: string[] = []
    const agents: string[] = []
    const references: string[] = []
    let textParts = 0
    let fileParts = 0
    let agentParts = 0
    let subtaskParts = 0
    let syntheticParts = 0
    let textChars = 0

    for (const part of input.parts) {
      if (isSynthetic(part)) syntheticParts++
      textChars += textLength(part)
      if (part.type === "text") {
        textParts++
        const label = referenceLabel(part.metadata?.reference)
        if (label) references.push(label)
      }
      if (part.type === "file") {
        fileParts++
        files.push(fileLabel(part))
      }
      if (part.type === "agent") {
        agentParts++
        agents.push(part.name)
      }
      if (part.type === "subtask") subtaskParts++
    }

    return {
      version: "aialra.turn_frame.v1",
      turnID: input.info.id,
      route: input.route,
      sessionID: input.info.sessionID,
      messageID: input.info.id,
      agent: input.info.agent,
      model: {
        providerID: input.info.model.providerID,
        modelID: input.info.model.modelID,
        ...(input.info.model.variant ? { variant: input.info.model.variant } : {}),
      },
      noReply: input.noReply === true,
      format: input.info.format?.type ?? "text",
      input: {
        partCount: input.parts.length,
        textParts,
        textChars,
        fileParts,
        agentParts,
        subtaskParts,
        syntheticParts,
      },
      explicit: {
        files: unique(files),
        agents: unique(agents),
        references: unique(references),
      },
      tools: Object.keys(input.info.tools ?? {}).sort(),
      timing: {
        receivedAt: input.receivedAt ?? input.info.time.created,
        framedAt: Date.now(),
      },
    }
  }
}

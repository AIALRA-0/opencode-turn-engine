export const deepLinkEvent = "opencode:deep-link"

const parseUrl = (input: string) => {
  if (!input.startsWith("opencode://")) return
  if (typeof URL.canParse === "function" && !URL.canParse(input)) return
  try {
    return new URL(input)
  } catch {
    return
  }
}

export const parseDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "open-project") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  return directory
}

export const parseNewSessionDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "new-session") return
  const directory = url.searchParams.get("directory")
  if (!directory) return
  const prompt = url.searchParams.get("prompt") || undefined
  if (!prompt) return { directory }
  return { directory, prompt }
}

export type SessionHandoffDeepLink = {
  directory: string
  sessionID: string
  threadID?: string
  lastEventID?: string
  environmentID?: string
}

export const parseSessionHandoffDeepLink = (input: string) => {
  const url = parseUrl(input)
  if (!url) return
  if (url.hostname !== "session-handoff") return
  const directory = url.searchParams.get("directory")
  const sessionID = url.searchParams.get("sessionID") ?? url.searchParams.get("session_id")
  if (!directory || !sessionID) return
  const threadID = url.searchParams.get("threadID") ?? url.searchParams.get("thread_id") ?? undefined
  const lastEventID = url.searchParams.get("lastEventID") ?? url.searchParams.get("last_event_id") ?? undefined
  const environmentID = url.searchParams.get("environmentID") ?? url.searchParams.get("environment_id") ?? undefined
  return {
    directory,
    sessionID,
    ...(threadID ? { threadID } : {}),
    ...(lastEventID ? { lastEventID } : {}),
    ...(environmentID ? { environmentID } : {}),
  }
}

export const collectOpenProjectDeepLinks = (urls: string[]) =>
  urls.map(parseDeepLink).filter((directory): directory is string => !!directory)

export const collectNewSessionDeepLinks = (urls: string[]) =>
  urls.map(parseNewSessionDeepLink).filter((link): link is { directory: string; prompt?: string } => !!link)

export const collectSessionHandoffDeepLinks = (urls: string[]) =>
  urls.map(parseSessionHandoffDeepLink).filter((link): link is SessionHandoffDeepLink => !!link)

type OpenCodeWindow = Window & {
  __OPENCODE__?: {
    deepLinks?: string[]
  }
}

export const drainPendingDeepLinks = (target: OpenCodeWindow) => {
  const pending = target.__OPENCODE__?.deepLinks ?? []
  if (pending.length === 0) return []
  if (target.__OPENCODE__) target.__OPENCODE__.deepLinks = []
  return pending
}

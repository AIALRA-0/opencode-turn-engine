import { Effect, Schema } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Parser } from "htmlparser2"
import * as Tool from "./tool"
import TurndownService from "turndown"
import DESCRIPTION from "./webfetch.txt"
import { isImageAttachment } from "@/util/media"
import { AialraTurnTrace } from "@/session/turn-trace"
import { SessionSecurity } from "@/session/security"
import { TurnSandbox } from "./turn-sandbox"
import { CodexExecServer } from "./codex-exec-server"
import type { NetworkProxyConfig } from "@/session/turn-context"

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024 // 5MB
const DEFAULT_TIMEOUT = 30 * 1000 // 30 seconds
const MAX_TIMEOUT = 120 * 1000 // 2 minutes

type FetchResponse = {
  headers: Record<string, string>
  arrayBuffer: ArrayBuffer
}

type NetworkAccessResult = {
  networkAccess: boolean
  networkProxy?: NetworkProxyConfig
}

class WebFetchHttpStatusError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`网络已连通，但目标返回 HTTP ${status}：${url}。这不是沙盒拦截，也不是审批未弹出，而是目标地址本身没有返回成功页面。`)
    this.name = "WebFetchHttpStatusError"
  }
}

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({ description: "The URL to fetch content from" }),
  format: Schema.Literals(["text", "markdown", "html"])
    .annotate({
      description: "The format to return the content in (text, markdown, or html). Defaults to markdown.",
      default: "markdown",
    })
    .pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed("markdown" as const))),
  timeout: Schema.optional(Schema.Number).annotate({ description: "Optional timeout in seconds (max 120)" }),
})

export const WebFetchTool = Tool.define(
  "webfetch",
  Effect.gen(function* () {
    const http = yield* HttpClient.HttpClient
    const nodeFetch = (url: string, headers: Record<string, string>, timeout: number) => {
      const request = HttpClientRequest.get(url).pipe(HttpClientRequest.setHeaders(headers))
      return Effect.gen(function* () {
        const first = yield* http.execute(request)
        const response =
          first.status === 403 && first.headers["cf-mitigated"] === "challenge"
            ? yield* http.execute(
                HttpClientRequest.get(url).pipe(
                  HttpClientRequest.setHeaders({ ...headers, "User-Agent": "opencode" }),
                ),
              )
            : first
        if (response.status < 200 || response.status >= 300) {
          return yield* Effect.fail(new WebFetchHttpStatusError(response.status, url))
        }
        return yield* response.arrayBuffer.pipe(
          Effect.map((arrayBuffer) => ({ headers: response.headers, arrayBuffer }) satisfies FetchResponse),
        )
      }).pipe(Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.fail(new Error("Request timed out")) }))
    }
    const proxyFetch = (url: string, headers: Record<string, string>, timeout: number, proxy: NetworkProxyConfig) =>
      Effect.tryPromise({
        try: async () => {
          const controller = new AbortController()
          const timer = setTimeout(() => controller.abort(), timeout)
          try {
            const response = await fetch(url, {
              headers,
              signal: controller.signal,
              proxy: proxy.url,
            } as RequestInit & { proxy?: string })
            if (response.status < 200 || response.status >= 300) throw new WebFetchHttpStatusError(response.status, url)
            return {
              headers: Object.fromEntries(response.headers.entries()),
              arrayBuffer: await response.arrayBuffer(),
            } satisfies FetchResponse
          } finally {
            clearTimeout(timer)
          }
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
    const fetchResponse = (
      ctx: Tool.Context,
      url: string,
      headers: Record<string, string>,
      networkAccess: boolean,
      timeout: number,
      networkProxy?: NetworkProxyConfig,
    ) => {
      if (networkProxy?.required) {
        if (networkProxy.enforcement === "environment" && networkProxy.url) {
          return proxyFetch(url, headers, timeout, networkProxy)
        }
        return Effect.fail(new Error("NetworkProxy is required for webfetch, but no usable proxy URL is configured"))
      }
      const viaNode = nodeFetch(url, headers, timeout)
      if (!CodexExecServer.enabledForContext(ctx)) return viaNode
      return Effect.tryPromise({
        try: async () => {
          const response = await CodexExecServer.httpRequest({ url, headers, networkAccess, ctx })
          if (response.status < 200 || response.status >= 300) throw new WebFetchHttpStatusError(response.status, url)
          const body = Buffer.from(response.bodyBase64, "base64")
          return {
            headers: Object.fromEntries(response.headers.map((item) => [item.name.toLowerCase(), item.value])),
            arrayBuffer: body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
          } satisfies FetchResponse
        },
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }).pipe(
        Effect.catch((error) =>
          error instanceof WebFetchHttpStatusError
            ? Effect.fail(error)
            : AialraTurnTrace.emit({
                phase: "exec_server.fallback",
                turnID: ctx.turn?.turnID,
                sessionID: ctx.sessionID,
                messageID: ctx.messageID,
                data: {
                  method: "http/request",
                  reason: error.message,
                },
              }).pipe(Effect.ignore, Effect.andThen(viaNode)),
        ),
      )
    }

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        Effect.gen(function* () {
          if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
            throw new Error("URL must start with http:// or https://")
          }

          yield* ctx.ask({
            permission: "webfetch",
            patterns: [params.url],
            always: ["*"],
            metadata: {
              url: params.url,
              format: params.format,
              timeout: params.timeout,
            },
          })

          const timeout = Math.min((params.timeout ?? DEFAULT_TIMEOUT / 1000) * 1000, MAX_TIMEOUT)
          const network = yield* ensureNetworkAccess(ctx, params.url)

          // Build Accept header based on requested format with q parameters for fallbacks
          let acceptHeader = "*/*"
          switch (params.format) {
            case "markdown":
              acceptHeader = "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1"
              break
            case "text":
              acceptHeader = "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1"
              break
            case "html":
              acceptHeader =
                "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1"
              break
            default:
              acceptHeader =
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"
          }
          const headers = {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
            Accept: acceptHeader,
            "Accept-Language": "en-US,en;q=0.9",
          }

          const response = yield* fetchResponse(ctx, params.url, headers, network.networkAccess, timeout, network.networkProxy).pipe(
            Effect.tapError((error) => classifyHttpResult(ctx, params.url, network.networkAccess, error, network.networkProxy)),
          )
          yield* classifyHttpResult(ctx, params.url, network.networkAccess, undefined, network.networkProxy)

          // Check content length
          const contentLength = response.headers["content-length"]
          if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          const arrayBuffer = response.arrayBuffer
          if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
            throw new Error("Response too large (exceeds 5MB limit)")
          }

          const contentType = response.headers["content-type"] || ""
          const mime = contentType.split(";")[0]?.trim().toLowerCase() || ""
          const title = `${params.url} (${contentType})`

          if (isImageAttachment(mime)) {
            const base64Content = Buffer.from(arrayBuffer).toString("base64")
            return {
              title,
              output: "Image fetched successfully",
              metadata: {},
              attachments: [
                {
                  type: "file" as const,
                  mime,
                  url: `data:${mime};base64,${base64Content}`,
                },
              ],
            }
          }

          const content = new TextDecoder().decode(arrayBuffer)

          // Handle content based on requested format and actual content type
          switch (params.format) {
            case "markdown":
              if (contentType.includes("text/html")) {
                const markdown = convertHTMLToMarkdown(content)
                return {
                  output: markdown,
                  title,
                  metadata: {},
                }
              }
              return { output: content, title, metadata: {} }

            case "text":
              if (contentType.includes("text/html")) {
                return { output: extractTextFromHTML(content), title, metadata: {} }
              }
              return { output: content, title, metadata: {} }

            case "html":
              return { output: content, title, metadata: {} }

            default:
              return { output: content, title, metadata: {} }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

function extractTextFromHTML(html: string) {
  let text = ""
  let skipDepth = 0

  const parser = new Parser({
    onopentag(name) {
      if (skipDepth > 0 || ["script", "style", "noscript", "iframe", "object", "embed"].includes(name)) {
        skipDepth++
      }
    },
    ontext(input) {
      if (skipDepth === 0) text += input
    },
    onclosetag() {
      if (skipDepth > 0) skipDepth--
    },
  })

  parser.write(html)
  parser.end()

  return text.trim()
}

function redactedNetworkProxy(proxy: NetworkProxyConfig | undefined) {
  if (!proxy) return undefined
  if (!proxy.url) return proxy
  return {
    ...proxy,
    url: "redacted",
  }
}

const ensureNetworkAccess = Effect.fn("WebFetchTool.ensureNetworkAccess")(function* (ctx: Tool.Context, url: string) {
  const turn = ctx.turn ? SessionSecurity.applyToTurn(ctx.turn) : undefined
  if (!turn) return { networkAccess: false } satisfies NetworkAccessResult
  const policy = turn.network_policy ?? turn.http_context?.network_policy ?? "ask"
  const decision = yield* TurnSandbox.assertNetworkAccess(
    {
      ...ctx,
      extra: {
        ...ctx.extra,
        tool: "webfetch",
      },
    },
    url,
  )
  yield* AialraTurnTrace.emit({
    phase: "sandbox.effective",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: "webfetch",
      operation: "network",
      target: url,
      network_policy: policy,
      network_permissions: turn.network_permissions,
      network_sandbox_policy: turn.network_sandbox_policy,
      networkDecision: decision,
      network_sandbox_decision: decision.networkSandboxDecision,
      network_proxy: redactedNetworkProxy(decision.networkProxy as NetworkProxyConfig | undefined),
      active_permission_profile: turn.active_permission_profile,
      approval_policy: turn.approval_policy,
    },
  })
  if (decision.needsApproval) {
    yield* ctx.ask({
      permission: "network",
      patterns: [url],
      always: [url],
      metadata: {
        reason: "network_policy",
        url,
        decision,
      },
    })
    return {
      networkAccess: true,
      networkProxy: decision.networkProxy as NetworkProxyConfig | undefined,
    } satisfies NetworkAccessResult
  }
  if (decision.networkAccess) {
    return {
      networkAccess: true,
      networkProxy: decision.networkProxy as NetworkProxyConfig | undefined,
    } satisfies NetworkAccessResult
  }
  yield* AialraTurnTrace.emit({
    phase: "http.request.classified",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: "webfetch",
      url,
      classification: "network_denied_by_policy",
      network_policy: policy,
      network_sandbox_policy: turn.network_sandbox_policy,
      sandboxDenied: true,
    },
  })
  yield* AialraTurnTrace.emit({
    phase: "tool.sandbox.denied",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: "webfetch",
      operation: "network",
      target: url,
      network_policy: policy,
      network_sandbox_policy: turn.network_sandbox_policy,
      active_permission_profile: turn.active_permission_profile,
    },
  })
  return yield* Effect.die(new Error(`Network access is disabled for this turn: ${url}`))
})

function classifyHttpResult(
  ctx: Tool.Context,
  url: string,
  networkAccess: boolean,
  error: Error | undefined,
  networkProxy?: NetworkProxyConfig,
) {
  const turn = ctx.turn ? SessionSecurity.applyToTurn(ctx.turn) : undefined
  if (!turn) return Effect.void
  const status = error instanceof WebFetchHttpStatusError ? error.status : undefined
  return AialraTurnTrace.emit({
    phase: "http.request.classified",
    turnID: turn.turnID,
    sessionID: turn.sessionID,
    messageID: ctx.messageID,
    data: {
      tool: "webfetch",
      url,
      status,
      classification: error ? httpFailureClass(error) : "http_2xx_success",
      networkAccess,
      network_proxy: networkProxy
        ? redactedNetworkProxy(networkProxy)
        : undefined,
      network_policy: turn.network_policy ?? turn.http_context?.network_policy ?? "ask",
      network_sandbox_policy: turn.network_sandbox_policy,
      sandboxDenied: false,
      message: error?.message,
    },
  })
}

function httpFailureClass(error: Error) {
  if (error instanceof WebFetchHttpStatusError) return httpStatusClass(error.status)
  if (/timed out|timeout/i.test(error.message)) return "connect_timeout"
  if (/network access is disabled/i.test(error.message)) return "network_denied_by_policy"
  return "request_failed"
}

function httpStatusClass(status: number) {
  if (status === 404) return "http_404_target_missing"
  if (status === 403) return "http_403_target_forbidden"
  if (status >= 500) return "http_5xx_target_error"
  return "non_2xx_but_network_ok"
}

function convertHTMLToMarkdown(html: string): string {
  const turndownService = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
  })
  turndownService.remove(["script", "style", "meta", "link"])
  return turndownService.turndown(html)
}

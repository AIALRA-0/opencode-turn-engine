import { Effect, Exit, Schema } from "effect"
import * as Tool from "./tool"
import { SessionSecurity, type SecurityUpdatePayload } from "@/session/security"
import { AialraTurnTrace } from "@/session/turn-trace"

const PermissionKind = Schema.Literals([
  "exec",
  "file_read",
  "file_write",
  "apply_patch",
  "network",
  "environment",
  "service_tier",
  "long_running_process",
  "provider_tool",
])

export const Parameters = Schema.Struct({
  permissions: Schema.Array(PermissionKind).annotate({
    description: "Permission categories being requested",
  }),
  reason: Schema.String.annotate({
    description: "Why the permission is needed",
  }),
  scope: Schema.Literals(["current_turn", "next_turn", "session"]).annotate({
    description: "How long the approved permission should apply",
  }),
  duration: Schema.optional(Schema.String).annotate({
    description: "Human-readable requested duration, for example current command, this turn, or this session",
  }),
  requested_permission_profile: Schema.optional(
    Schema.Literals(["read-only", "workspace-write", "full-access", "external", "disabled"]),
  ),
  requested_network_policy: Schema.optional(Schema.Literals(["off", "ask", "on"])),
  requested_command_policy: Schema.optional(Schema.Literals(["ask", "workspace", "all", "read", "disabled"])),
  requested_executor_backend: Schema.optional(Schema.Literals(["codex", "node-bun", "auto"])),
  requested_paths: Schema.optional(Schema.Array(Schema.String)),
  requested_domains: Schema.optional(Schema.Array(Schema.String)),
  requested_environment_id: Schema.optional(Schema.String),
  requested_service_tier: Schema.optional(Schema.String),
  requested_long_running_process: Schema.optional(Schema.Boolean),
  requested_provider_tools: Schema.optional(Schema.Array(Schema.String)),
})

type Metadata = {
  request: ReturnType<typeof requestPayload>
  appliedPatch: SecurityUpdatePayload
  unsupported: string[]
  status: "approved" | "denied"
}

type Params = Schema.Schema.Type<typeof Parameters>

function profile(value: Params["requested_permission_profile"]): SecurityUpdatePayload["permissionProfileID"] {
  if (value === "read-only") return ":read-only"
  if (value === "workspace-write") return ":workspace"
  if (value === "full-access") return ":danger-full-access"
  return value
}

function executorBackend(value: Params["requested_executor_backend"]): SecurityUpdatePayload["executorBackend"] | undefined {
  if (value === "codex") return "codex"
  if (value === "node-bun") return "node-bun"
  return undefined
}

function requestPayload(params: Params, ctx: Tool.Context) {
  return {
    schema: "aialra.request_permissions.v1",
    session_id: String(ctx.sessionID),
    turn_id: ctx.turn?.turnID ? String(ctx.turn.turnID) : undefined,
    message_id: String(ctx.messageID),
    tool_call_id: ctx.callID,
    requested_by: "assistant_tool",
    requested_at: new Date().toISOString(),
    permissions: params.permissions,
    reason: params.reason,
    scope: params.scope,
    duration: params.duration,
    requested_permission_profile: params.requested_permission_profile,
    requested_network_policy: params.requested_network_policy,
    requested_command_policy: params.requested_command_policy,
    requested_executor_backend: params.requested_executor_backend,
    requested_paths: params.requested_paths ?? [],
    requested_domains: params.requested_domains ?? [],
    requested_environment_id: params.requested_environment_id,
    requested_service_tier: params.requested_service_tier,
    requested_long_running_process: params.requested_long_running_process,
    requested_provider_tools: params.requested_provider_tools ?? [],
    current_effective: ctx.turn
      ? {
          permission_profile_id: ctx.turn.active_permission_profile?.id,
          network_policy: ctx.turn.network_policy,
          command_policy: ctx.turn.command_policy,
          executor_backend: ctx.turn.thread_settings?.effective?.executor_backend,
          environment_id: ctx.turn.selected_environment_id,
        }
      : undefined,
    reviewer: ctx.turn?.approvals_reviewer ?? { role: "user", id: "current_user", label: "User，当前用户" },
    final_decision: { status: "pending" },
  }
}

function patch(params: Params): SecurityUpdatePayload {
  return {
    ...(params.requested_permission_profile ? { permissionProfileID: profile(params.requested_permission_profile) } : {}),
    ...(params.requested_network_policy ? { networkPolicy: params.requested_network_policy } : {}),
    ...(params.requested_command_policy ? { commandPolicy: params.requested_command_policy } : {}),
    ...(executorBackend(params.requested_executor_backend) ? { executorBackend: executorBackend(params.requested_executor_backend) } : {}),
    ...(params.requested_environment_id ? { environmentID: params.requested_environment_id } : {}),
    ...(params.requested_domains?.length ? { networkPermissions: { allowlist: params.requested_domains } } : {}),
  }
}

function unsupported(params: Params) {
  return [
    ...(params.requested_paths?.length ? ["requested_paths require custom writable root policy in a later requirement"] : []),
    ...(params.requested_executor_backend === "auto" ? ["requested_executor_backend=auto is advisory; choose codex or node-bun to apply directly"] : []),
    ...(params.requested_service_tier ? ["requested_service_tier is advisory until service tier override policy is wired"] : []),
    ...(params.requested_long_running_process ? ["requested_long_running_process maps to Engineering Controls in a later requirement"] : []),
    ...(params.requested_provider_tools?.length ? ["requested_provider_tools require dynamic provider tool policy in a later requirement"] : []),
  ]
}

export const RequestPermissionsTool = Tool.define<typeof Parameters, Metadata, never>(
  "request_permissions",
  Effect.succeed({
    description:
      "Request a scoped permission change from the user. This tool cannot bypass policy; it creates an auditable approval request and applies only supported approved security settings.",
    parameters: Parameters,
    execute: (params, ctx) =>
      Effect.gen(function* () {
        const request = requestPayload(params, ctx)
        yield* AialraTurnTrace.emit({
          phase: "request_permissions.requested",
          turnID: request.turn_id,
          sessionID: String(ctx.sessionID),
          messageID: String(ctx.messageID),
          data: request,
        })
        const appliedPatch = patch(params)
        const blocked = unsupported(params)
        const ask = ctx.ask({
          permission: "request_permissions",
          patterns: params.permissions,
          always: params.permissions,
          metadata: {
            request_permissions: request,
            appliedPatch,
            unsupported: blocked,
          },
        })
        const exit = yield* Effect.exit(ask)
        if (Exit.isFailure(exit)) {
          yield* AialraTurnTrace.emit({
            phase: "request_permissions.resolved",
            turnID: request.turn_id,
            sessionID: String(ctx.sessionID),
            messageID: String(ctx.messageID),
            data: {
              schema: "aialra.request_permissions_result.v1",
              request,
              final_decision: { status: "denied" },
              applied_patch: {},
              unsupported: blocked,
            },
          })
          return yield* Effect.die(new Error("permission request denied"))
        }
        if (ctx.turn && Object.keys(appliedPatch).length > 0) {
          SessionSecurity.update({
            sessionID: String(ctx.sessionID),
            cwd: ctx.turn.cwd,
            patch: appliedPatch,
          })
        }
        yield* AialraTurnTrace.emit({
          phase: "request_permissions.resolved",
          turnID: request.turn_id,
          sessionID: String(ctx.sessionID),
          messageID: String(ctx.messageID),
          data: {
            schema: "aialra.request_permissions_result.v1",
            request,
            final_decision: {
              status: "approved",
              scope: params.scope,
            },
            applied_patch: appliedPatch,
            unsupported: blocked,
          },
        })
        return {
          title: "Permission request approved",
          output: [
            "Permission request approved.",
            Object.keys(appliedPatch).length ? `Applied settings: ${Object.keys(appliedPatch).join(", ")}` : "No runtime settings were directly changed.",
            blocked.length ? `Not directly applied: ${blocked.join("; ")}` : "All requested supported settings were applied.",
          ].join("\n"),
          metadata: {
            request,
            appliedPatch,
            unsupported: blocked,
            status: "approved",
          },
        }
      }),
  }),
)

import { afterEach, describe, expect, test } from "bun:test"
import { PublicEventLog } from "../../src/session/public-event"
import * as Log from "@opencode-ai/core/util/log"
import { resetDatabase } from "../fixture/db"
import { disposeAllInstances } from "../fixture/fixture"

void Log.init({ print: false })

afterEach(async () => {
  PublicEventLog.clearForTest()
  await disposeAllInstances()
  await resetDatabase()
})

describe("approval audit public events", () => {
  test("maps permission asked/replied bus events to approval public events", () => {
    const execApproval = {
      schema: "aialra.exec_approval_request.v1",
      command_id: "exec_call_1",
      process_id: "proc_exec_call_1",
      command: "pwd",
      argv: ["/bin/sh", "-c", "pwd"],
      cwd: "/tmp/project",
      environment_id: "default",
      permission_profile_id: ":workspace",
      network_policy: "off",
      shell_env_policy: { mode: "default" },
      risk_level: "low",
      constraints_result: { reason: "command_policy" },
      requested_by: "assistant_tool",
      reviewer: { role: "user", id: "current_user" },
      approval_scope: { default_scope: "once-command" },
      expires_at: "turn_end",
      final_decision: { status: "pending" },
    }
    const applyPatchApproval = {
      schema: "aialra.apply_patch_approval_request.v1",
      patch_sha256: "sha256",
      hunk_count: 1,
      risk_level: "low",
      affected_files: [{ requested_path: "result.txt", operation: "overwrite" }],
      final_decision: { status: "pending" },
    }
    PublicEventLog.recordBus({
      directory: "/tmp/project",
      project: "project",
      workspace: "workspace",
      event: {
        id: "evt_permission_asked",
        type: "permission.asked",
        properties: {
          id: "perm_1",
          sessionID: "ses_approval",
          turnID: "msg_turn",
          permission: "write",
          patterns: ["result.txt"],
          metadata: { path: "result.txt", exec_approval: execApproval, apply_patch_approval: applyPatchApproval },
          always: ["result.txt"],
          requested_by: "assistant_tool",
          requested_at: "2026-06-04T08:00:00.000Z",
          approval_reviewer: { role: "auto_review", id: "auto_review", label: "Auto reviewer，自动审批审查器" },
          approvalPolicy: "on-request",
          permissionProfile: { id: ":workspace" },
          sandboxPolicy: { type: "workspace-write" },
          tool: { messageID: "msg_assistant", callID: "call_1" },
        },
      },
    })
    PublicEventLog.recordBus({
      event: {
        id: "evt_permission_replied",
        type: "permission.replied",
        properties: {
          sessionID: "ses_approval",
          requestID: "perm_1",
          reply: "once",
          scope: "turn-all",
          reviewed_by: { role: "user", id: "current_user", label: "User，当前用户" },
          review_result: "approved",
          review_reason: "manual approval",
          review_time: "2026-06-04T08:01:00.000Z",
          overridden_by_constraints: false,
        },
      },
    })

    expect(PublicEventLog.list({ sessionID: "ses_approval" })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "approval.requested",
          turnID: "msg_turn",
          toolCallID: "call_1",
          status: "requested",
          data: expect.objectContaining({
            approvalPolicy: "on-request",
            requested_by: "assistant_tool",
            requested_at: "2026-06-04T08:00:00.000Z",
            approval_reviewer: { role: "auto_review", id: "auto_review", label: "Auto reviewer，自动审批审查器" },
            review_result: "pending",
            permissionProfile: { id: ":workspace" },
            sandboxPolicy: { type: "workspace-write" },
            exec_approval: execApproval,
            apply_patch_approval: applyPatchApproval,
          }),
        }),
        expect.objectContaining({
          type: "approval.resolved",
          turnID: "msg_turn",
          toolCallID: "call_1",
          status: "turn-all",
          data: expect.objectContaining({
            scope: "turn-all",
            approval_decision: expect.objectContaining({
              schema: "aialra.approval_decision.v1",
              decision: "allow_turn_all",
              label: "本对话单轮允许全部命令",
              grant_scope: "turn-all",
            }),
            reviewed_by: { role: "user", id: "current_user", label: "User，当前用户" },
            review_result: "approved",
            review_reason: "manual approval",
            review_time: "2026-06-04T08:01:00.000Z",
            overridden_by_constraints: false,
            exec_approval: execApproval,
            apply_patch_approval: applyPatchApproval,
          }),
        }),
      ]),
    )
  })
})

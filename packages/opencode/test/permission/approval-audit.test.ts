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
          metadata: { path: "result.txt" },
          always: ["result.txt"],
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
            permissionProfile: { id: ":workspace" },
            sandboxPolicy: { type: "workspace-write" },
          }),
        }),
        expect.objectContaining({
          type: "approval.resolved",
          turnID: "msg_turn",
          toolCallID: "call_1",
          status: "once",
        }),
      ]),
    )
  })
})

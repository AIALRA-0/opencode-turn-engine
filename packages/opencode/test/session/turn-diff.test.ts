import { afterEach, expect, test } from "bun:test"
import { Effect } from "effect"
import os from "os"
import path from "path"
import { PublicEventLog } from "../../src/session/public-event"
import { ToolResultProtocol } from "../../src/session/tool-result-settlement"
import { TurnDiffStore } from "../../src/session/turn-diff"
import { TurnHistory } from "../../src/session/turn-history"

const dir = path.join(os.tmpdir(), `aialra-turn-diff-test-${process.pid}`)

afterEach(() => {
  PublicEventLog.clearForTest()
  TurnDiffStore.clearForTest()
  TurnHistory.clearForTest()
  delete process.env.AIALRA_TURN_HISTORY_DIR
})

function settlement(input: { callID: string; path: string; operation: "create" | "overwrite"; beforeExists: boolean }) {
  return ToolResultProtocol.ToolResultSettlement.build({
    sessionID: "ses_diff",
    turnID: "msg_diff",
    messageID: "msg_assistant",
    toolCallID: input.callID,
    tool: "write",
    status: "completed",
    completedAt: Date.now(),
    output: "ok",
    source: "processor",
    metadata: {
      fileMutations: [
        {
          schema: "aialra.file_mutation.v1",
          mutation_id: `mutation_${input.callID}`,
          tool: "write",
          operation: input.operation,
          applied: true,
          requested_path: input.path,
          resolved_path: input.path,
          environment_id: "default",
          before: { exists: input.beforeExists },
          after: { exists: true, sha256: input.callID },
          diff: { chars_added: 2, chars_removed: 0, patch_chars: 10 },
        },
      ],
    },
  })
}

test("tool result settlements emit replayable turn diff from file mutations", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(ToolResultProtocol.ToolResultSettlement.emit(settlement({
    callID: "call_write_1",
    path: "/workspace/a.txt",
    operation: "create",
    beforeExists: false,
  })))

  const events = PublicEventLog.list({ sessionID: "ses_diff" })
  const records = TurnHistory.list({ sessionID: "ses_diff", turnID: "msg_diff" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "turn.diff.updated",
        title: "本轮代码改动已更新",
        status: "updated",
        data: expect.objectContaining({
          schema: "aialra.turn_diff.v1",
          source: "file_mutation_store",
          summary: expect.objectContaining({ files: 1, mutations: 1, created: 1 }),
          files: [
            expect.objectContaining({
              path: "/workspace/a.txt",
              operation: "create",
              tool_call_ids: ["call_write_1"],
              mutation_count: 1,
            }),
          ],
        }),
      }),
      expect.objectContaining({
        type: "patch.quality.scored",
        title: "补丁质量已评分",
        data: expect.objectContaining({
          schema: "aialra.patch_quality.v1",
          source: "turn_diff",
          score: expect.any(Number),
          patch: expect.objectContaining({
            hasPatch: true,
            zeroPatch: false,
            changedFileCount: 1,
          }),
          verification: expect.objectContaining({
            status: "not_observed",
          }),
        }),
      }),
    ]),
  )
  expect(records.map((record) => record.data.phase)).toEqual(expect.arrayContaining(["tool.result.settled", "turn.diff.updated"]))
  expect(records.find((record) => record.data.phase === "turn.diff.updated")?.data.kind).toBe("file")
})

test("turn diff aggregates repeated mutations for the same turn and file", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    Effect.all([
      ToolResultProtocol.ToolResultSettlement.emit(settlement({
        callID: "call_write_1",
        path: "/workspace/a.txt",
        operation: "create",
        beforeExists: false,
      })),
      ToolResultProtocol.ToolResultSettlement.emit(settlement({
        callID: "call_write_2",
        path: "/workspace/a.txt",
        operation: "overwrite",
        beforeExists: true,
      })),
    ], { concurrency: 1 }),
  )

  const diff = TurnDiffStore.list({ sessionID: "ses_diff", turnID: "msg_diff" })
  expect(diff).toEqual(
    expect.objectContaining({
      summary: expect.objectContaining({ files: 1, mutations: 2 }),
      files: [
        expect.objectContaining({
          path: "/workspace/a.txt",
          operation: "mixed",
          tool_call_ids: ["call_write_1", "call_write_2"],
          mutation_count: 2,
          mutations: [
            expect.objectContaining({ mutation_id: "mutation_call_write_1" }),
            expect.objectContaining({ mutation_id: "mutation_call_write_2" }),
          ],
        }),
      ],
    }),
  )
})

test("turn diff finalizes zero-patch turns for replay", async () => {
  process.env.AIALRA_TURN_HISTORY_DIR = dir

  await Effect.runPromise(
    TurnDiffStore.emit(
      TurnDiffStore.finalize({
        sessionID: "ses_diff",
        turnID: "msg_zero_patch",
        messageID: "msg_assistant",
        outcome: "completed",
      }),
    ),
  )

  const events = PublicEventLog.list({ sessionID: "ses_diff" })
  const records = TurnHistory.list({ sessionID: "ses_diff", turnID: "msg_zero_patch" })
  expect(events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "turn.diff.updated",
        status: "updated",
        data: expect.objectContaining({
          summary: expect.objectContaining({ files: 0, mutations: 0 }),
          files: [],
          terminal_outcome: "completed",
        }),
      }),
    ]),
  )
  expect(records[0].data.kind).toBe("file")
  expect(records[0].data.context).toEqual(
    expect.objectContaining({
      schema: "aialra.turn_diff.v1",
      terminal_outcome: "completed",
      summary: expect.objectContaining({ files: 0, mutations: 0 }),
    }),
  )
})

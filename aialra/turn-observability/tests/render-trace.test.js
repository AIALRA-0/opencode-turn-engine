import assert from "assert/strict"
import fs from "fs"
import os from "os"
import path from "path"
import test from "node:test"
import { readEvents, renderTimeline, selectTraceFile } from "../scripts/render-trace.js"

test("selects newest trace file and renders a structural timeline", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aialra-trace-test-"))
  try {
    const oldFile = path.join(dir, "old.jsonl")
    const newFile = path.join(dir, "new.jsonl")
    fs.writeFileSync(oldFile, JSON.stringify({ ts: "2026-05-15T00:00:00.000Z", phase: "old" }) + "\n")
    fs.writeFileSync(
      newFile,
      [
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:00.000Z",
          phase: "prompt.received",
          turnID: "turn_test",
          sessionID: "ses_test",
          data: { parts: { count: 1, byType: { text: 1 } } },
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:00.100Z",
          phase: "prompt.explicit_context_resolved",
          turnID: "turn_test",
          sessionID: "ses_test",
          messageID: "turn_test",
          data: { added: 1, addedByType: { file: 1 } },
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:00.200Z",
          phase: "turn.frame.created",
          turnID: "turn_test",
          sessionID: "ses_test",
          messageID: "turn_test",
          data: {
            turnID: "turn_test",
            route: "prompt",
            input: { textChars: 12, fileParts: 1 },
            explicit: { files: ["README.md"], agents: [], references: [] },
          },
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:00.250Z",
          phase: "turn.context.created",
          turnID: "turn_test",
          sessionID: "ses_test",
          messageID: "turn_test",
          data: {
            cwd: "/tmp/work",
            approval_policy: "on-request",
            active_permission_profile: { id: ":workspace" },
            retry: { request_max_retries: 4, stream_max_retries: 5, stream_idle_timeout_ms: 300000 },
          },
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:00.280Z",
          phase: "turn.started",
          turnID: "turn_test",
          sessionID: "ses_test",
          messageID: "turn_test",
          data: { startedAt: 1770000000000, modelContextWindow: 100000, collaborationModeKind: "default" },
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:00.300Z",
          phase: "user_message.created",
          turnID: "turn_test",
          sessionID: "ses_test",
          messageID: "turn_test",
          data: { parts: { count: 2, byType: { text: 1, file: 1 } } },
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:00.400Z",
          phase: "prompt.reply_requested",
          turnID: "turn_test",
          sessionID: "ses_test",
          messageID: "turn_test",
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:00.800Z",
          phase: "model.context_built",
          turnID: "turn_test",
          sessionID: "ses_test",
          messageID: "msg_test",
          step: 1,
          data: { systemCount: 3, modelMessageCount: 1 },
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:00.900Z",
          phase: "processor.process.started",
          turnID: "turn_test",
          sessionID: "ses_test",
          messageID: "msg_test",
          step: 1,
          data: { toolCount: 4 },
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:01.250Z",
          phase: "model.process.finished",
          turnID: "turn_test",
          sessionID: "ses_test",
          messageID: "msg_test",
          step: 1,
          data: { result: "continue" },
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:01.500Z",
          phase: "prompt.completed",
          turnID: "turn_test",
          sessionID: "ses_test",
          messageID: "msg_test",
          data: { role: "assistant" },
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:01.600Z",
          phase: "turn.completed",
          turnID: "turn_test",
          sessionID: "ses_test",
          messageID: "msg_test",
          data: { durationMs: 1600, timeToFirstTokenMs: 700 },
        },
      ]
        .map((event) => JSON.stringify(event))
        .join("\n") + "\n",
    )
    fs.utimesSync(oldFile, new Date("2026-05-15T00:00:00Z"), new Date("2026-05-15T00:00:00Z"))
    fs.utimesSync(newFile, new Date("2026-05-15T00:00:02Z"), new Date("2026-05-15T00:00:02Z"))

    assert.equal(selectTraceFile(dir), newFile)
    const rendered = renderTimeline(readEvents(newFile), newFile)
    assert.match(rendered, /Session: ses_test/)
    assert.match(rendered, /turn=turn_test/)
    assert.match(rendered, /turn\.frame\.created/)
    assert.match(rendered, /turn\.context\.created/)
    assert.match(rendered, /turn\.started/)
    assert.match(rendered, /prompt\.explicit_context_resolved/)
    assert.match(rendered, /processor\.process\.started/)
    assert.match(rendered, /prompt\.completed/)
    assert.match(rendered, /turn\.completed/)
    assert.match(rendered, /model\.process\.finished/)
    assert.doesNotMatch(rendered, /secret prompt/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

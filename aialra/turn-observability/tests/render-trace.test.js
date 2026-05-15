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
          sessionID: "ses_test",
          data: { parts: { count: 1, byType: { text: 1 } } },
        },
        {
          trace: "aialra.turn.v1",
          ts: "2026-05-15T00:00:01.250Z",
          phase: "model.process.finished",
          sessionID: "ses_test",
          messageID: "msg_test",
          step: 1,
          data: { result: "continue" },
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
    assert.match(rendered, /model\.process\.finished/)
    assert.doesNotMatch(rendered, /secret prompt/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

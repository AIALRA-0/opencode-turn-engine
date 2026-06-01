import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import assert from "node:assert/strict"
import test from "node:test"
import { assertV3BenchmarkGate } from "../scripts/v3-status-gate.mjs"

test("V3 gate blocks regression benchmark until every target is complete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aialra-v3-gate-"))
  const statusPath = join(dir, "status.json")
  await writeFile(
    statusPath,
    JSON.stringify({
      targets: [
        { id: 1, name: "done", status: "完全完成" },
        { id: 2, name: "not done", status: "核心完成" },
      ],
    }),
  )

  await assert.rejects(
    assertV3BenchmarkGate({ tier: "regression-6", statusPath }),
    /16\/16 implementation targets must be 完全完成/,
  )
})

test("V3 gate allows regression benchmark when every target is complete", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aialra-v3-gate-"))
  const statusPath = join(dir, "status.json")
  await writeFile(
    statusPath,
    JSON.stringify({
      targets: [
        { id: 1, name: "done", status: "完全完成" },
        { id: 2, name: "done too", status: "完全完成" },
      ],
    }),
  )

  assert.equal((await assertV3BenchmarkGate({ tier: "regression-6", statusPath })).allowed, true)
})

test("V3 gate blocks full-24 until regression-6 proves improvement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aialra-v3-gate-"))
  const statusPath = join(dir, "status.json")
  await writeFile(
    statusPath,
    JSON.stringify({
      benchmarkGate: {
        regression6: {
          status: "passed",
          verifiedPassImproved: false,
          zeroPatchDecreased: false,
        },
      },
      targets: [
        { id: 1, name: "done", status: "完全完成" },
        { id: 2, name: "done too", status: "完全完成" },
      ],
    }),
  )

  await assert.rejects(
    assertV3BenchmarkGate({ tier: "full-24", statusPath }),
    /regression-6 must run after 16\/16 completion/,
  )
})

test("V3 gate allows full-24 after regression-6 improvement", async () => {
  const dir = await mkdtemp(join(tmpdir(), "aialra-v3-gate-"))
  const statusPath = join(dir, "status.json")
  await writeFile(
    statusPath,
    JSON.stringify({
      benchmarkGate: {
        regression6: {
          status: "passed",
          verifiedPassImproved: true,
          zeroPatchDecreased: false,
        },
      },
      targets: [
        { id: 1, name: "done", status: "完全完成" },
        { id: 2, name: "done too", status: "完全完成" },
      ],
    }),
  )

  assert.equal((await assertV3BenchmarkGate({ tier: "full-24", statusPath })).allowed, true)
})

test("V3 gate does not block smoke runs", async () => {
  assert.equal((await assertV3BenchmarkGate({ tier: "smoke", statusPath: "/does/not/matter" })).allowed, true)
})

import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..")

function publicEventTypes() {
  const source = fs.readFileSync(path.join(root, "packages/opencode/src/session/public-event.ts"), "utf8")
  const body = source.match(/export const PUBLIC_EVENT_TYPES = \[([\s\S]*?)\]\s+as const/)?.[1]
  assert.ok(body, "PUBLIC_EVENT_TYPES array not found")
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1])
}

test("public schema docs include every public event type", () => {
  const docs = fs.readFileSync(path.join(root, "aialra/turn-observability/public-schema-docs.md"), "utf8")
  for (const type of publicEventTypes()) {
    assert.match(docs, new RegExp(`(^|\\n)${type.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\n)`), type)
  }
  assert.match(docs, /aialra\.public_event\.v1/)
  assert.match(docs, /aialra\.raw_bundle\.v1/)
  assert.match(docs, /Last-Event-ID/)
  assert.match(docs, /UserTurn/)
  assert.match(docs, /TurnContextItem/)
})

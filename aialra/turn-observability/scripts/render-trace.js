#!/usr/bin/env node
import fs from "fs"
import os from "os"
import path from "path"
import { pathToFileURL } from "url"

export function selectTraceFile(inputPath) {
  const resolved = path.resolve(inputPath)
  const stat = fs.statSync(resolved)
  if (stat.isFile()) return resolved
  const files = fs
    .readdirSync(resolved)
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => {
      const file = path.join(resolved, name)
      return { file, mtime: fs.statSync(file).mtimeMs }
    })
    .sort((a, b) => b.mtime - a.mtime)
  if (files.length === 0) throw new Error(`No .jsonl trace files found in ${resolved}`)
  return files[0].file
}

export function readEvents(traceFile) {
  const text = fs.readFileSync(traceFile, "utf8")
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line)
      } catch (error) {
        throw new Error(`Invalid JSON on line ${index + 1}: ${error instanceof Error ? error.message : error}`)
      }
    })
}

function elapsed(start, ts) {
  const delta = new Date(ts).getTime() - start
  return `+${(Math.max(delta, 0) / 1000).toFixed(3)}s`
}

function compactData(data) {
  if (!data || Object.keys(data).length === 0) return ""
  return ` ${JSON.stringify(data)}`
}

export function renderTimeline(events, traceFile = "") {
  if (events.length === 0) return "No events."
  const first = new Date(events[0].ts).getTime()
  const last = new Date(events[events.length - 1].ts).getTime()
  const byPhase = new Map()
  for (const event of events) byPhase.set(event.phase, (byPhase.get(event.phase) ?? 0) + 1)

  const lines = []
  if (traceFile) lines.push(`Trace: ${traceFile}`)
  lines.push(`Session: ${events.find((event) => event.sessionID)?.sessionID ?? "unknown"}`)
  lines.push(`Events: ${events.length}`)
  lines.push(`Duration: ${((last - first) / 1000).toFixed(3)}s`)
  lines.push("")
  lines.push("Phases:")
  for (const [phase, count] of [...byPhase.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`  ${phase}: ${count}`)
  }
  lines.push("")
  lines.push("Timeline:")
  for (const event of events) {
    const step = event.step === undefined ? "" : ` step=${event.step}`
    const message = event.messageID === undefined ? "" : ` message=${event.messageID}`
    lines.push(`  ${elapsed(first, event.ts)} ${event.phase}${step}${message}${compactData(event.data)}`)
  }
  return lines.join(os.EOL)
}

export function main(argv) {
  const input = argv[2] ?? path.join("aialra", "turn-observability", "traces")
  const traceFile = selectTraceFile(input)
  process.stdout.write(renderTimeline(readEvents(traceFile), traceFile) + os.EOL)
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}

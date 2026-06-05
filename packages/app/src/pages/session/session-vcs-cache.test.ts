import { describe, expect, test } from "bun:test"
import {
  shouldInvalidateVcsForFileWatcher,
  summarizeVcsInvalidation,
  vcsInvalidationReasonsForPublicEvents,
  vcsQueryBaseKey,
  vcsQueryKey,
} from "./session-vcs-cache"

describe("session VCS cache helpers", () => {
  test("builds stable base and mode-specific query keys", () => {
    expect(vcsQueryBaseKey({ directory: "/repo", branch: "feat/a", defaultBranch: "main" })).toEqual([
      "session-vcs",
      "/repo",
      "feat/a",
      "main",
    ])
    expect(vcsQueryKey({ directory: "/repo", branch: "feat/a", defaultBranch: "main", mode: "branch" })).toEqual([
      "session-vcs",
      "/repo",
      "feat/a",
      "main",
      "branch",
    ])
  })

  test("ignores git internals from file watcher invalidation", () => {
    expect(shouldInvalidateVcsForFileWatcher(undefined)).toBe(false)
    expect(shouldInvalidateVcsForFileWatcher(".git/index")).toBe(false)
    expect(shouldInvalidateVcsForFileWatcher("src/app.ts")).toBe(true)
  })

  test("maps public events to deduplicated invalidation reasons", () => {
    expect(
      vcsInvalidationReasonsForPublicEvents([
        { type: "file.write" },
        { type: "file.write" },
        { type: "tool.call.finished", data: { tool: "apply_patch" } },
        { type: "command.finished" },
        { type: "turn.diff.updated" },
        { type: "turn.completed" },
      ]),
    ).toEqual(["file_write", "directory_mutation_tool", "command_finished", "turn_diff_updated", "turn_completed"])
  })

  test("summarizes invalidation reasons in Chinese", () => {
    expect(summarizeVcsInvalidation(["file_write", "command_finished"])).toBe("文件写入事件，命令执行结束")
    expect(summarizeVcsInvalidation([])).toBe("手动刷新")
  })
})

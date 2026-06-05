import { describe, expect } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Effect, Layer } from "effect"
import { GrepTool } from "../../src/tool/grep"
import { provideInstance, TestInstance, tmpdirScoped } from "../fixture/fixture"
import { SessionID, MessageID } from "../../src/session/schema"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import { Truncate } from "@/tool/truncate"
import { Agent } from "../../src/agent/agent"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { testEffect } from "../lib/effect"
import { Reference } from "@/reference/reference"
import { RepositoryCache } from "@/reference/repository-cache"
import { Permission } from "../../src/permission"
import type * as Tool from "../../src/tool/tool"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Git } from "@/git"
import { Filesystem } from "@/util/filesystem"
import { PublicEventLog } from "../../src/session/public-event"

const referenceLayer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  Reference.layer.pipe(
    Layer.provide(Config.defaultLayer),
    Layer.provide(RepositoryCache.defaultLayer),
    Layer.provide(RuntimeFlags.layer(flags)),
  )

const toolLayer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  Layer.mergeAll(
    CrossSpawnSpawner.defaultLayer,
    AppFileSystem.defaultLayer,
    Ripgrep.defaultLayer,
    Truncate.defaultLayer,
    Agent.defaultLayer,
    Git.defaultLayer,
    referenceLayer(flags),
  )

const it = testEffect(toolLayer())
const scout = testEffect(toolLayer({ experimentalScout: true }))

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

const root = path.join(__dirname, "../..")
const full = (p: string) => (process.platform === "win32" ? Filesystem.normalizePath(p) : p)

const githubBase = <A, E, R>(url: string, self: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env.OPENCODE_REPO_CLONE_GITHUB_BASE_URL
      process.env.OPENCODE_REPO_CLONE_GITHUB_BASE_URL = url
      return previous
    }),
    () => self,
    (previous) =>
      Effect.sync(() => {
        if (previous) process.env.OPENCODE_REPO_CLONE_GITHUB_BASE_URL = previous
        else delete process.env.OPENCODE_REPO_CLONE_GITHUB_BASE_URL
      }),
  )

const git = Effect.fn("GrepToolTest.git")(function* (cwd: string, args: string[]) {
  return yield* Effect.promise(async () => {
    const proc = Bun.spawn(["git", ...args], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || `git ${args.join(" ")} failed`)
    return stdout.trim()
  })
})

describe("tool.grep", () => {
  it.live("basic search", () =>
    Effect.gen(function* () {
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* provideInstance(root)(
        grep.execute(
          {
            pattern: "export",
            path: path.join(root, "src/tool"),
            include: "*.ts",
          },
          ctx,
        ),
      )
      expect(result.metadata.matches).toBeGreaterThan(0)
      expect(result.output).toContain("Found")
    }),
  )

  it.instance("no matches returns correct output", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "test.txt"), "hello world"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "xyznonexistentpatternxyz123",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(0)
      expect(result.output).toBe("No files found")
      expect(PublicEventLog.list({ sessionID: "ses_test" })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: "executor.fallback",
            data: expect.objectContaining({ method: "fs/search", tool: "grep" }),
          }),
        ]),
      )
    }),
  )

  it.instance("finds matches in tmp instance", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "test.txt"), "line1\nline2\nline3"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "line",
          path: test.directory,
        },
        ctx,
      )
      expect(result.metadata.matches).toBeGreaterThan(0)
      expect(result.metadata.fileSearch).toEqual(
        expect.objectContaining({
          schema: "aialra.file_search.v1",
          tool: "grep",
          requested_pattern: "line",
          search_cwd: test.directory,
          backend: expect.objectContaining({
            name: "ripgrep_search",
            fallback_reason: expect.stringContaining("Codex exec-server has no fs/grep API"),
          }),
          counts: expect.objectContaining({
            returned: 3,
            matched_files: 1,
          }),
          grep: expect.objectContaining({
            total_matches: 3,
            returned_matches: 3,
            context_lines: 0,
          }),
          results: [
            expect.objectContaining({
              path: path.join(test.directory, "test.txt"),
              relative_path: "test.txt",
            }),
          ],
        }),
      )
    }),
  )

  it.instance("honors max matches, context lines, hidden files, and ignore filters", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "a.ts"), "before\nneedle-one\nafter\n"))
      yield* Effect.promise(() => Bun.write(path.join(test.directory, "b.ts"), "needle-two\n"))
      yield* Effect.promise(() => Bun.write(path.join(test.directory, ".hidden.ts"), "needle-hidden\n"))
      yield* Effect.promise(() => fs.mkdir(path.join(test.directory, ".git")))
      yield* Effect.promise(() => Bun.write(path.join(test.directory, ".git", "config.ts"), "needle-protected\n"))

      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "needle",
          path: test.directory,
          include: "*.ts",
          maxMatches: 1,
          contextLines: 1,
          showHidden: false,
          ignore: ["b.ts"],
        },
        ctx,
      )

      expect(result.output).toContain(path.join(test.directory, "a.ts"))
      expect(result.output).toContain("Context 1: before")
      expect(result.output).toContain("Line 2: needle-one")
      expect(result.output).not.toContain("needle-two")
      expect(result.output).not.toContain("needle-hidden")
      expect(result.output).not.toContain("needle-protected")
      expect(result.metadata.fileSearch).toEqual(
        expect.objectContaining({
          tool: "grep",
          filters: expect.objectContaining({
            show_hidden: false,
            ignore: ["b.ts"],
            protected_policy: "hide",
          }),
          counts: expect.objectContaining({
            returned: 1,
            matched_files: 1,
          }),
          grep: expect.objectContaining({
            include: "*.ts",
            context_lines: 1,
            returned_matches: 1,
          }),
          truncation: expect.objectContaining({ truncated: false }),
          results: [
            expect.objectContaining({
              relative_path: "a.ts",
            }),
          ],
        }),
      )
    }),
  )

  it.instance("supports exact file paths", () =>
    Effect.gen(function* () {
      const test = yield* TestInstance
      const file = path.join(test.directory, "test.txt")
      yield* Effect.promise(() => Bun.write(file, "line1\nline2\nline3"))
      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "line2",
          path: file,
        },
        ctx,
      )
      expect(result.metadata.matches).toBe(1)
      expect(result.output).toContain(file)
      expect(result.output).toContain("Line 2: line2")
    }),
  )

  it.instance("does not ask for external_directory when alias path is allowed", () =>
    Effect.gen(function* () {
      if (process.platform === "win32") return

      yield* TestInstance
      const tmp = yield* Effect.acquireRelease(
        Effect.promise(() => fs.mkdtemp(path.join(os.tmpdir(), "opencode-grep-alias-"))),
        (dir) => Effect.promise(() => fs.rm(dir, { recursive: true, force: true })),
      )
      const real = path.join(tmp, "real")
      const alias = path.join(tmp, "alias")
      yield* Effect.promise(() => fs.mkdir(real))
      yield* Effect.promise(() => fs.symlink(real, alias, "dir"))
      yield* Effect.promise(() => Bun.write(path.join(real, "test.txt"), "needle"))

      const ruleset = Permission.fromConfig({
        grep: "allow",
        external_directory: {
          [path.join(alias, "*")]: "allow",
        },
      })
      const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
      const next: Tool.Context = {
        ...ctx,
        ask: (req) =>
          Effect.sync(() => {
            const needsAsk = req.patterns.some(
              (pattern) => Permission.evaluate(req.permission, pattern, ruleset).action !== "allow",
            )
            if (needsAsk) requests.push(req)
          }),
      }

      const info = yield* GrepTool
      const grep = yield* info.init()
      const result = yield* grep.execute(
        {
          pattern: "needle",
          path: alias,
          include: "*.txt",
        },
        next,
      )

      expect(result.metadata.matches).toBe(1)
      expect(requests.find((req) => req.permission === "external_directory")).toBeUndefined()
    }),
  )

  scout.instance(
    "does not ask for external_directory permission inside configured git references",
    () =>
      Effect.gen(function* () {
        yield* TestInstance
        const appfs = yield* AppFileSystem.Service
        const cache = path.join(Global.Path.repos, "github.com", "opencode-grep-reference", "repo")
        yield* appfs.remove(cache, { recursive: true }).pipe(Effect.ignore)
        yield* Effect.addFinalizer(() => appfs.remove(cache, { recursive: true }).pipe(Effect.ignore))

        const source = yield* tmpdirScoped({ git: true })
        const remoteRoot = yield* tmpdirScoped()
        const remoteDir = path.join(remoteRoot, "opencode-grep-reference")
        const remoteRepo = path.join(remoteDir, "repo.git")
        yield* appfs.writeWithDirs(path.join(source, "src", "notes.md"), "needle\n")
        yield* git(source, ["add", "."])
        yield* git(source, ["commit", "-m", "add notes"])
        yield* appfs.makeDirectory(remoteDir, { recursive: true }).pipe(Effect.orDie)
        yield* git(remoteRoot, ["clone", "--bare", source, remoteRepo])

        const requests: Array<Omit<Permission.Request, "id" | "sessionID" | "tool">> = []
        const next: Tool.Context = {
          ...ctx,
          ask: (req) =>
            Effect.sync(() => {
              requests.push(req)
            }),
        }

        const info = yield* GrepTool
        const grep = yield* info.init()
        const result = yield* githubBase(
          `file://${remoteRoot}/`,
          grep.execute({ pattern: "needle", path: path.join(cache, "src"), include: "*.md" }, next),
        )

        expect(result.metadata.matches).toBe(1)
        expect(full(result.output)).toContain(full(path.join(cache, "src", "notes.md")))
        expect(requests.find((req) => req.permission === "external_directory")).toBeUndefined()
      }),
    {
      config: {
        reference: {
          docs: "opencode-grep-reference/repo",
        },
      },
    },
  )
})

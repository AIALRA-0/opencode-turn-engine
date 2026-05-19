import { expect, test } from "bun:test"
import { CodexExecServer } from "../../src/tool/codex-exec-server"

const runIfCodex = Bun.which("codex") && process.env.AIALRA_RUN_CODEX_EXEC_SERVER_TEST === "1" ? test : test.skip

test("Codex exec-server adapter normalizes environment values", () => {
  expect(CodexExecServer.jsonEnv({ A: "1", B: undefined })).toEqual({ A: "1" })
})

runIfCodex("Codex exec-server adapter runs a managed process", async () => {
  let output = ""
  const result = await CodexExecServer.runProcess({
    argv: ["/bin/sh", "-c", "printf exec-ok"],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    timeoutMs: 10_000,
    onOutput(chunk) {
      output += chunk.text
    },
  })

  expect(result.timedOut).toBe(false)
  expect(result.exitCode).toBe(0)
  expect(output).toBe("exec-ok")
})

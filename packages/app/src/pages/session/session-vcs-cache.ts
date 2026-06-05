import type { PublicEventLike } from "./session-reactivity"

export type VcsDiffMode = "git" | "branch"

export type VcsInvalidationReason =
  | "file_watcher"
  | "file_write"
  | "directory_mutation_tool"
  | "command_finished"
  | "turn_diff_updated"
  | "turn_completed"
  | "manual"

export function vcsQueryBaseKey(input: { directory: string; branch?: string; defaultBranch?: string }) {
  return ["session-vcs", input.directory, input.branch ?? "", input.defaultBranch ?? ""] as const
}

export function vcsQueryKey(input: {
  directory: string
  branch?: string
  defaultBranch?: string
  mode: VcsDiffMode
}) {
  return [...vcsQueryBaseKey(input), input.mode] as const
}

export function shouldInvalidateVcsForFileWatcher(file: string | undefined) {
  if (!file) return false
  if (file.startsWith(".git/")) return false
  return true
}

export function vcsInvalidationReasonsForPublicEvents(events: PublicEventLike[]) {
  return events
    .flatMap((event): VcsInvalidationReason[] => {
      if (event.type === "file.write") return ["file_write"]
      if (event.type === "turn.diff.updated") return ["turn_diff_updated"]
      if (event.type === "turn.completed") return ["turn_completed"]
      if (event.type === "command.finished" || event.type === "exec_command.finished" || event.type === "exec_command.end")
        return ["command_finished"]
      if (
        event.type === "tool.call.finished" &&
        typeof event.data?.tool === "string" &&
        ["write", "edit", "apply_patch", "bash"].includes(event.data.tool)
      )
        return ["directory_mutation_tool"]
      return []
    })
    .filter((reason, index, list) => list.indexOf(reason) === index)
}

export function summarizeVcsInvalidation(reasons: VcsInvalidationReason[]) {
  if (reasons.length === 0) return "手动刷新"
  return reasons
    .map((reason) => {
      if (reason === "file_watcher") return "文件监听发现变化"
      if (reason === "file_write") return "文件写入事件"
      if (reason === "directory_mutation_tool") return "写入类工具完成"
      if (reason === "command_finished") return "命令执行结束"
      if (reason === "turn_diff_updated") return "回合 diff 已更新"
      if (reason === "turn_completed") return "回合结束"
      return "手动刷新"
    })
    .join("，")
}

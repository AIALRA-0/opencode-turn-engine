import { readFile } from "node:fs/promises"

export const V3_COMPLETE_STATUS = "完全完成"
export const V3_ALLOWED_STATUSES = ["未开始", "部分完成", "核心完成", V3_COMPLETE_STATUS]

export function benchmarkRequiresV3Completion(tier) {
  return tier === "regression-6" || tier === "full-24"
}

export async function assertV3BenchmarkGate(options) {
  if (!benchmarkRequiresV3Completion(options.tier)) {
    return {
      allowed: true,
      reason: `${options.tier} does not require the V3 completion gate`,
    }
  }

  const status = JSON.parse(await readFile(options.statusPath, "utf8"))
  const targets = Array.isArray(status.targets) ? status.targets : []
  const invalid = targets.filter((target) => !V3_ALLOWED_STATUSES.includes(target.status))
  if (invalid.length) {
    throw new Error(
      [
        "V3 benchmark gate refused to run because the status file contains invalid target states.",
        ...invalid.map((target) => `- ${target.id ?? "unknown"} ${target.name ?? ""}: ${target.status}`),
        `Allowed states: ${V3_ALLOWED_STATUSES.join(", ")}`,
      ].join("\n"),
    )
  }

  const incomplete = targets.filter((target) => target.status !== V3_COMPLETE_STATUS)
  if (incomplete.length) {
    throw new Error(
      [
        `V3 benchmark gate refused to run ${options.tier}.`,
        "Reason: 16/16 implementation targets must be 完全完成 before regression-6 or full-24 is allowed.",
        `Current: ${targets.length - incomplete.length}/${targets.length} 完全完成.`,
        "Incomplete targets:",
        ...incomplete.map((target) => `- ${target.id}. ${target.name}: ${target.status}`),
      ].join("\n"),
    )
  }

  if (options.tier === "full-24") {
    const regression = status.benchmarkGate?.regression6
    const passed = regression?.status === "passed"
    const improved = regression?.verifiedPassImproved === true || regression?.zeroPatchDecreased === true
    if (!passed || !improved) {
      throw new Error(
        [
          "V3 benchmark gate refused to run full-24.",
          "Reason: regression-6 must run after 16/16 completion and prove either verified pass improvement or zero patch decrease.",
          `regression-6 status: ${regression?.status ?? "missing"}`,
          `verifiedPassImproved: ${String(regression?.verifiedPassImproved ?? false)}`,
          `zeroPatchDecreased: ${String(regression?.zeroPatchDecreased ?? false)}`,
        ].join("\n"),
      )
    }
  }

  return {
    allowed: true,
    completeCount: targets.length,
    reason: `all ${targets.length} V3 targets are 完全完成`,
  }
}

import { describe, expect, test } from "bun:test"
import { describeThinkingSelectorOption, thinkingSelectorLabel } from "./thinking-selector"

describe("thinking selector", () => {
  test("labels Codex-style reasoning effort shortcuts in Chinese", () => {
    expect(thinkingSelectorLabel("default")).toBe("默认")
    expect(thinkingSelectorLabel("low")).toBe("低推理")
    expect(thinkingSelectorLabel("high")).toBe("高推理")
    expect(thinkingSelectorLabel("xhigh")).toBe("极高推理")
  })

  test("describes requested and effective effort for exposed provider options", () => {
    const option = describeThinkingSelectorOption({
      value: "xhigh",
      options: ["default", "low", "high", "xhigh"],
      modelName: "gpt-5.2-codex",
    })

    expect(option.requested).toBe("xhigh")
    expect(option.effective).toBe("xhigh")
    expect(option.providerSupport).toBe("当前模型配置暴露了这个档位")
    expect(option.costLatency).toContain("最高")
    expect(option.title).toContain("当前模型：gpt-5.2-codex")
  })

  test("explains fallback for stale or unsupported selected values", () => {
    const option = describeThinkingSelectorOption({
      value: "xhigh",
      options: ["default", "low", "high"],
    })

    expect(option.effective).toBe("后端会降级或忽略")
    expect(option.fallbackReason).toContain("provider metadata")
    expect(option.title).toContain("降级原因")
  })
})

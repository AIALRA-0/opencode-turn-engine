export type ThinkingSelectorOption = {
  value: string
  label: string
  detail: string
  requested: string
  effective: string
  providerSupport: string
  fallbackReason?: string
  costLatency: string
  serviceTierImpact: string
  title: string
}

const effortLabels: Record<string, string> = {
  default: "默认",
  none: "关闭推理",
  off: "关闭推理",
  minimal: "最小推理",
  min: "最小推理",
  low: "低推理",
  medium: "中推理",
  high: "高推理",
  xhigh: "极高推理",
  max: "最大推理",
  maximum: "最大推理",
}

const effortCostLatency: Record<string, string> = {
  default: "成本和延迟由模型默认配置决定",
  none: "成本和延迟最低，但复杂任务能力会下降",
  off: "成本和延迟最低，但复杂任务能力会下降",
  minimal: "成本和延迟较低，适合简单任务",
  min: "成本和延迟较低，适合简单任务",
  low: "成本和延迟偏低，适合小修小问",
  medium: "成本和延迟平衡，适合普通工程任务",
  high: "成本和延迟更高，适合复杂定位和修复",
  xhigh: "成本和延迟最高，适合高难度长链路任务",
  max: "成本和延迟最高，适合高难度长链路任务",
  maximum: "成本和延迟最高，适合高难度长链路任务",
}

const normalizeEffort = (value: string) => value.trim().toLowerCase().replaceAll("_", "-")

export function thinkingSelectorLabel(value: string) {
  return effortLabels[normalizeEffort(value)] ?? value
}

export function describeThinkingSelectorOption(input: {
  value: string
  options: string[]
  modelName?: string
}): ThinkingSelectorOption {
  const normalized = normalizeEffort(input.value)
  const isDefault = normalized === "default"
  const exposed = input.options.includes(input.value)
  const label = thinkingSelectorLabel(input.value)
  const requested = isDefault ? "默认" : input.value
  const effective = isDefault ? "提交后由后端和模型默认值决定" : exposed ? input.value : "后端会降级或忽略"
  const providerSupport = isDefault
    ? "使用服务端默认设置"
    : exposed
      ? "当前模型配置暴露了这个档位"
      : "当前模型配置没有暴露这个档位"
  const fallbackReason =
    isDefault || exposed ? undefined : "如果用户或历史会话请求了这个档位，后端会按 provider metadata 降级或忽略"
  const costLatency = effortCostLatency[normalized] ?? "成本和延迟取决于 provider 对该档位的实现"
  const serviceTierImpact = "不会直接切换服务档位，但更高推理通常会消耗更多推理 token"
  const detail = [providerSupport, costLatency].join("，")
  const title = [
    `思考强度：${label}`,
    input.modelName ? `当前模型：${input.modelName}` : undefined,
    `请求档位：${requested}`,
    `实际档位：${effective}`,
    `供应商支持：${providerSupport}`,
    fallbackReason ? `降级原因：${fallbackReason}` : undefined,
    `成本/延迟：${costLatency}`,
    `服务档位影响：${serviceTierImpact}`,
  ]
    .filter((line): line is string => !!line)
    .join("\n")
  return {
    value: input.value,
    label,
    detail,
    requested,
    effective,
    providerSupport,
    fallbackReason,
    costLatency,
    serviceTierImpact,
    title,
  }
}

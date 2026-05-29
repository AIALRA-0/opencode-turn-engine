# Kimi For Coding Performance Investigation 2026-05-29

## Scope

本报告只调查为什么 `kimi/kimi-for-coding` 在 OpenCode Web 里初始化、首 token 和工具循环体感慢

本轮没有把慢归因给模型本身，也没有把它当成换模型问题

## What We Checked

| 项目 | 观察结果 | 影响 |
| --- | --- | --- |
| 部署配置 | DeepSeek 使用 `@ai-sdk/openai-compatible`，并配置 `timeout=600000`、`chunkTimeout=60000` | DeepSeek 的请求和流空闲有明确超时收口 |
| Kimi 配置 | Kimi 使用 `@ai-sdk/anthropic`，baseURL 是 `https://api.kimi.com/coding/v1`，之前没有显式 `timeout` 和 `chunkTimeout` | Kimi 流如果很久不吐 chunk，OpenCode 更难快速判断是慢还是卡 |
| 协议差异 | Kimi 走 Anthropic Messages 兼容协议，DeepSeek 走 OpenAI compatible 协议 | 两条路径的 SDK 初始化、headers、stream parser、工具调用格式都不同，首 token 体感不能直接等同 |
| Turn harness | AIALRA 的 retry 和 stream idle harness 会接住异常，但不会让一个慢供应商变快 | harness 负责收口和解释，不负责改变供应商实际吞吐 |
| 工具循环 | 弱模型如果反复尝试同一个被拒绝工具，慢会被放大成“像卡死” | 需要靠 public event stream 分类，而不是只看模型名 |

## Simple Fix Applied

Kimi provider 配置已补上：

```json
"timeout": 600000,
"chunkTimeout": 60000
```

这不是加速器，它的作用是让 Kimi 出现流空闲或供应商慢响应时更容易被 harness 收口，而不是无限等

## Likely Causes

| 原因 | 是否已证明 | 说明 |
| --- | --- | --- |
| Kimi 供应商首 token 本身慢 | 未完全证明 | 需要用同一 prompt 对 Kimi、DeepSeek、Codex 记录 `model.request.started -> model.stream.started` 时间 |
| Kimi Anthropic 兼容层更慢 | 部分成立 | 当前 Kimi 走 `@ai-sdk/anthropic`，DeepSeek 走 OpenAI compatible，两条协议路径不同 |
| 缺少 chunk timeout 导致慢更像卡死 | 已修配置 | 已补 `chunkTimeout=60000`，后续看 stream retry 是否减少 |
| 弱模型工具重复导致慢 | 已有诊断入口 | Turn Inspector 能看到 repeated tool warning 和 sandbox denied 重复，但还需要更细分类面板 |
| 上下文太大导致慢 | 未完全证明 | 需要把每轮 context size、tool output size 和 first-token time 写入 A/B 指标 |

## Next Measurements

下一步不要凭感觉判断 Kimi 慢，需要在 A/B harness 里增加这些字段：

| 指标 | 含义 |
| --- | --- |
| request_start_to_stream_start_ms | 从模型请求开始到第一段流事件的时间 |
| first_token_ms | 从 turn.started 到第一段有效模型输出的时间 |
| stream_duration_ms | 模型流持续时间 |
| retry_count | request retry 和 stream retry 次数 |
| tool_repeat_count | 重复工具调用次数 |
| context_bytes_estimate | 发送给模型的上下文体积估计 |
| raw_tool_output_bytes | 工具输出体积 |

## Current Conclusion

当前能确认的不是“Kimi 一定差”，而是“Kimi 当前部署配置少了和 DeepSeek 一样的流超时保护，并且走不同协议路径”

本轮已补齐 timeout/chunkTimeout 这类低风险配置

如果后续仍慢，需要用 public event stream 采样真实 first-token time 和 retry/fallback 数据，再判断是供应商延迟、协议适配、上下文过大，还是弱模型工具循环

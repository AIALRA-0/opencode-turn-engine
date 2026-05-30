# 20260530071350 真实高难 Benchmark 分析

- 范围：24 个真实公开 agent benchmark 任务，每题 5 个组合，共 120 次 agent run
- 执行原则：clone 真实仓库，checkout base commit，只给 agent problem statement，agent 完成后再用 official harness 或 test patch 验证
- 模型限制：没有使用 flash / fast / turbo，Codex 使用 `gpt-5.5 / xhigh`，DeepSeek 使用 `deepseek-v4-pro / max`，Kimicode 使用当前 OpenCode 可实际出助手响应的 `kimi/kimi-for-coding`
- 报告：`aialra/turn-observability/real-benchmark-reports/real-benchmark-20260530071350.md`
- 结构化结果：`aialra/turn-observability/real-benchmark-reports/real-benchmark-20260530071350-results.json`
- 说明：Pro 类任务有一部分没有可等价执行的 official pass/fail，因此单独统计 unverified，不把它们伪装成通过

## 总览矩阵

| 对象 | 模型 / 档位 | 分数 | 官方/可验证通过 | 可验证失败 | 未验证 | 超时 | 零补丁 | 平均耗时 | 平均工具调用 | patch 总量 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| AIALRA OpenCode / DeepSeek V4 Pro max | `deepseek/deepseek-v4-pro / variant=max / effort=max` | 330 | 5/24 | 16 | 3 | 3 | 1 | 989s | 64 | 134 KB |
| AIALRA OpenCode / Kimicode 最大努力 | `kimi/kimi-for-coding / effort=native coding model` | 100 | 1/24 | 21 | 2 | 12 | 12 | 1148s | 96 | 95 KB |
| 原版 Codex CLI / xhigh 最大推理 | `gpt-5.5 / effort=xhigh` | 427 | 7/24 | 12 | 5 | 0 | 0 | 652s | 0 | 271 KB |
| debug1 原版 OpenCode / DeepSeek V4 Pro max | `deepseek/deepseek-v4-pro / variant=max / effort=max` | 284 | 5/24 | 17 | 2 | 4 | 4 | 906s | 41 | 202 KB |
| debug1 原版 OpenCode / Kimicode 最大努力 | `kimi/kimi-for-coding / effort=native coding model` | 253 | 4/24 | 15 | 5 | 6 | 6 | 860s | 60 | 800 KB |

## 关键结论

- Codex CLI 仍是整体最稳的基线，24 题中 7 个可验证通过，0 超时，0 零补丁
- AIALRA DeepSeek V4 Pro 与 debug1 DeepSeek V4 Pro 可验证通过数同为 5 个，但 AIALRA 零补丁更少，1 个对 4 个，超时也更少，3 个对 4 个
- AIALRA DeepSeek 的代价是更慢，平均 989 秒，高于 debug1 DeepSeek 的 906 秒，平均工具调用也更多，64 对 41
- debug1 Kimicode 有 4 个可验证通过，高于 AIALRA Kimicode 的 1 个，但补丁总量巨大，约 800 KB，且有 6 次超时
- AIALRA Kimicode 是本轮最弱组合，12 次超时，12 次零补丁，说明弱模型在当前 harness 下仍然容易进入高工具调用但不产出有效 patch 的状态
- 所有组合在复杂 feature / refactor / UI 任务上通过率都低，说明下一步不能只增强沙箱和可观测性，必须引入验证驱动的多轮修复 loop

## 架构差异解释

- Codex CLI 的优势不是“永远能修对”，而是整体执行稳定，超时少，终态清晰，复杂 Python bugfix 题通过率最高
- 原版 OpenCode debug1 在 DeepSeek 上有较好的速度，但更容易出现零补丁或服务 fetch 类不稳定，需要外层 harness 补健康检查
- AIALRA OpenCode fork 的优势是可解释和门禁更强，TurnContext、public event stream、沙箱和终态收口能把失败类型记录下来
- AIALRA 的劣势是开销更高，工具调用更多，弱模型循环没有被真正转化成有效策略切换
- 本轮磁盘满和 provider hang 暴露出 benchmark harness 还需要资源配额、自动清理、服务健康重启和断点续跑，这次已先补上续跑与清理

## 下一步方向

1. 做 verification-driven loop，验证驱动回路，agent 第一轮 patch 后自动跑测试，把失败摘要重新喂给同一 turn 或下一 turn，最多 2 到 3 轮
2. 做 weak-model loop intervention，弱模型循环干预，连续零 diff、高重复工具、超大工具次数时强制总结当前假设并换策略
3. 做 resource governor，资源治理器，每个 benchmark job 有磁盘预算、Docker 镜像清理、服务健康检查、provider timeout 和自动 resume
4. 做 patch quality gate，补丁质量门禁，超过 80 KB 或跨太多文件时要求 agent 先解释设计，再继续验证
5. 做 benchmark dashboard，评测面板，把 pass、timeout、zero patch、patch size、工具调用、turn event 摘要放进可读页面
6. 继续向 Codex exec-server 靠拢，但优先把验证驱动和失败恢复补上，因为本轮最大差距已经不是能否调用工具，而是能否根据验证反馈收敛

## 诚实边界

- 当前 runner 没有统一 token 和费用采集，报告只记录可得参数：模型、档位、耗时、工具调用、patch 大小、验证结果和错误类型
- Codex CLI 的工具调用数显示为 0，是因为当前 runner 没有解析 Codex JSON stream 里的每个工具事件，这个字段不能和 OpenCode 的工具调用数直接横比
- Pro 数据集部分任务未验证，不能把未验证项当作成功
- Kimicode 的“最大努力”受当前 OpenCode provider 暴露能力限制，`kimi/kimi-for-coding` 没有可选 reasoning=max 字段，本轮使用的是实际能跑通助手响应的 Kimicode 入口

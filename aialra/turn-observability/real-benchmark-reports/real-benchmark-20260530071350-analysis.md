# 20260530071350 真实高难 Benchmark 分析

- 范围：24 个真实公开 agent benchmark 任务，每题 5 个组合，共 120 次 agent run
- 执行原则：clone 真实仓库，checkout base commit，只给 agent problem statement，agent 完成后再用 official harness 或 test patch 验证
- 模型限制：没有使用 flash / fast / turbo，Codex 使用 `gpt-5.5 / xhigh`，DeepSeek 使用 `deepseek-v4-pro / max`，Kimicode 使用当前 OpenCode 可实际出助手响应的 `kimi/kimi-for-coding`
- 报告：`aialra/turn-observability/real-benchmark-reports/real-benchmark-20260530071350.md`
- 结构化结果：`aialra/turn-observability/real-benchmark-reports/real-benchmark-20260530071350-results.json`
- 超时口径：旧固定时间超时已全部补跑或重分类，最终 `fixedTimedOut=0`，剩余 timeout 全部是进展检测后的逻辑卡住

## 总览矩阵

| 对象 | 模型 / 档位 | 分数 | 可验证通过 | 可验证失败 | 未验证 | 检测型超时 | 固定时间超时 | 零补丁 | 平均耗时 | 平均工具调用 | patch 总量 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 原版 Codex CLI / xhigh 最大推理 | `gpt-5.5 / effort=xhigh` | 475 | 7/24 | 12 | 5 | 0 | 0 | 0 | 652s | 0 | 271 KB |
| AIALRA OpenCode / DeepSeek V4 Pro max | `deepseek/deepseek-v4-pro / variant=max / effort=max` | 425 | 5/24 | 15 | 4 | 0 | 0 | 0 | 856s | 72 | 163 KB |
| debug1 原版 OpenCode / DeepSeek V4 Pro max | `deepseek/deepseek-v4-pro / variant=max / effort=max` | 406 | 6/24 | 16 | 2 | 0 | 0 | 1 | 696s | 49 | 394 KB |
| debug1 原版 OpenCode / Kimicode 最大努力 | `kimi/kimi-for-coding / effort=native coding model` | 306 | 3/24 | 16 | 5 | 2 | 0 | 6 | 700s | 53 | 956 KB |
| AIALRA OpenCode / Kimicode 最大努力 | `kimi/kimi-for-coding / effort=native coding model` | 285 | 3/24 | 17 | 4 | 7 | 0 | 9 | 770s | 80 | 107 KB |

## 这次纠偏了什么

- 之前用固定时间阈值会误伤慢但仍在工作的 agent。最典型的是 AIALRA Kimicode 的 `scikit-learn__scikit-learn-13241`，它继续跑到 3233 秒后验证通过
- 新 runner 现在看真实进展：message，消息、tool call，工具调用、public event，公共事件、git diff，代码改动
- 如果一直有真实进展，就继续跑
- 如果补丁长时间不变，但模型持续重复工具调用，就标记为逻辑循环
- 最后结果里 9 个 timeout 全部是 progress-aware timeout，进展感知超时，不再有固定时间超时

## 关键结论

- Codex CLI 仍是整体最稳基线：7/24 可验证通过，0 超时，0 零补丁，总分最高
- AIALRA DeepSeek 总分高于 debug1 DeepSeek，原因是 AIALRA 24/24 都产出 patch，0 超时，0 零补丁，且 turn 终态完整
- debug1 DeepSeek 可验证通过数多 1 个，说明 AIALRA 的门禁和观测增强没有自动等于更高通过率，收敛策略仍要继续补
- Kimicode 两边都弱，AIALRA Kimicode 和 debug1 Kimicode 都只有 3/24 可验证通过
- AIALRA Kimicode 的失败更可解释：7 个检测型超时里能看到 repeated tool loop 或 non-productive tool churn，而不是前端一直等
- AIALRA Kimicode `scikit-learn__scikit-learn-14092` 出现新类型：patch 已经验证通过，但模型继续重复工具调用，说明下一步要做“通过后收尾”和“验证成功即停止”

## 超时明细

| 对象 | 任务 | 原因 | patch | 验证 |
| --- | --- | --- | ---: | --- |
| AIALRA Kimicode | `astropy__astropy-13398` | repeated tool loop，重复工具循环，diff 为空 | 0 B | 未通过 |
| AIALRA Kimicode | `matplotlib__matplotlib-22835` | repeated tool loop，重复工具循环，diff 有 1 个文件 | 1465 B | 未通过 |
| AIALRA Kimicode | `scikit-learn__scikit-learn-14092` | repeated tool loop，重复工具循环，但 patch 已通过 | 2127 B | 通过 |
| AIALRA Kimicode | `instance_ansible__ansible-a02...` | repeated tool loop，重复工具循环，diff 为空 | 0 B | 未通过 |
| AIALRA Kimicode | `instance_internetarchive__openlibrary...` | repeated tool loop，重复工具循环，diff 有 6 个文件 | 11548 B | 未验证 |
| AIALRA Kimicode | `instance_protonmail__webclients-6e...` | repeated tool loop，重复工具循环，diff 为空 | 0 B | 未通过 |
| debug1 Kimicode | `instance_element-hq__element-web-a692...` | assistant/model never started，助手或模型没有启动 | 695148 B | 未通过 |
| debug1 Kimicode | `instance_qutebrowser__qutebrowser-de4...` | repeated tool loop，重复工具循环，diff 有 3 个文件 | 11938 B | 未验证 |
| AIALRA Kimicode | `instance_element-hq__element-web-5e8488...` | non-productive tool churn，非生产性工具循环，338 次工具调用但补丁 35 分钟不变 | 12003 B | 未验证 |

## 架构差异解释

- Codex CLI 的优势仍然是稳定收敛：它不一定每题都修对，但很少在工具循环里失控
- 原版 OpenCode debug1 在 DeepSeek 上速度更快，工具调用更少，但会出现等待审批和零补丁
- AIALRA OpenCode fork 的优势是门禁、终态和可解释性：超时能说清楚是哪类循环，工作区和沙箱行为也能追踪
- AIALRA 的劣势是执行更重，尤其 DeepSeek 平均耗时 856 秒，高于 debug1 DeepSeek 的 696 秒
- Kimicode 的问题不是单纯模型慢，而是缺少验证驱动收口：它可能修对后仍继续查工具，也可能在没有 patch 时重复探索

## 下一步方向

1. 做 verification-driven loop，验证驱动回路：agent 产出 patch 后自动跑验证，把失败摘要喂回下一轮，最多 2 到 3 轮
2. 做 success stop gate，通过即停止门禁：一旦 test patch 或 official harness 已经通过，强制进入 final，而不是继续工具循环
3. 做 weak-model loop intervention，弱模型循环干预：diff 长时间不变、工具调用过多、重复查环境时，强制模型总结当前假设并换策略或停止
4. 做 benchmark resource governor，评测资源治理：磁盘预算、Docker 镜像清理、孤儿验证进程清理、provider 健康检查和断点续跑
5. 做 patch quality gate，补丁质量门禁：超大 patch、跨太多文件、删除过多内容时要求 agent 先解释设计，再继续验证
6. 做 Codex event parity，Codex 事件对齐：解析 Codex CLI 的 JSON stream，补齐 Codex 工具调用数，否则工具调用字段不能横比

## 诚实边界

- 当前 runner 没有统一 token 和费用采集，报告只记录可得参数：模型、档位、耗时、工具调用、patch 大小、验证结果和错误类型
- Codex CLI 的工具调用数显示为 0，是因为当前 runner 没有解析 Codex JSON stream 里的每个工具事件，这个字段不能和 OpenCode 的工具调用数直接横比
- Pro 数据集部分任务未验证，不能把未验证项当作成功
- Kimicode 的“最大努力”受当前 OpenCode provider 暴露能力限制，`kimi/kimi-for-coding` 没有可选 reasoning=max 字段，本轮使用的是实际能跑通助手响应的 Kimicode 入口

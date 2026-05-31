# AIALRA General Engineering Harness v2 Plan

## 一句话目标

V2 要解决的不是“模型会不会调用工具”，而是“模型修错以后，系统能不能把失败证据喂回去，让它少绕路、少空转、通过后马上停”

## 第一性原理

工程 agent 做代码任务，本质是四件事：

| 问题 | 人话解释 | V2 要做的事 |
| --- | --- | --- |
| 先做什么 | 不能一上来就乱改 | 用阶段门禁让模型先定位、再计划、再修改 |
| 怎么知道错了 | 不能只听模型说“修好了” | 记录验证命令失败摘要 |
| 错了怎么继续 | 不能让失败日志只躺在报告里 | 把失败摘要变成下一轮 repair，修复阶段 的输入 |
| 什么时候停 | 不能通过后还继续乱查乱改 | 验证通过后开启 stop gate，通过即停止门禁 |

## V2 已实现目标

| 目标 | 原来是什么 | 现在是什么 | 用户怎么观察 |
| --- | --- | --- | --- |
| 验证失败反馈 | 测试失败只记录在 raw 输出里，模型下一步未必看得到重点 | `engineering.verification.finished` 会抽取失败摘要，写入 `feedback.items`，下一次 repair 提醒直接带失败内容 | Turn Inspector 里看验证失败事件，raw 可看完整输出，摘要会出现在后续模型提示里 |
| 阶段门禁 | localize，定位阶段提醒“不要改”，但模型如果完全没看代码就直接 edit，系统会放行 | bug/refactor/security 任务在 0 次定位工具后直接 edit/write/apply_patch 会被阻止，并切到 plan，计划阶段 | Turn Inspector 里出现 `engineering.phase_gate.blocked_tool` |
| 提前收尾纠偏 | 模型找到根因后可能说“要我继续改吗”，评测里会变成 0 patch | `engineering.phase_gate.premature_final` 会识别这种回答，最多 2 次要求它继续做最小改动和验证 | Turn Inspector 显示“阶段门禁继续执行”，报告里 `pytest-dev__pytest-7168` 从 0 patch 变成 verified pass |
| 循环检查点反馈 | 重复工具只发 warning/checkpoint，模型未必知道应该怎么换方向 | checkpoint 会写入 feedback，提醒模型总结旧路线并换方向 | Turn Inspector 里看 `engineering.loop.checkpoint`，后续 repair 提醒带换方向说明 |
| 评测 repair 回路 | 真实 benchmark 修完后，官方验证失败只进报告，不会自动继续给 agent 一次修复机会 | `run-real-benchmark.mjs` 新增 `AIALRA_REAL_BENCH_REPAIR_ROUNDS`，只对指定 AIALRA 目标开启，验证失败后把失败输出和当前 diff 摘要发回同一 session | 报告里每题多一列 `repair`，详情里有自动 repair 记录 |

## 技术细节

### EngineeringRun v2，工程运行 v2

新增字段：

```text
phaseGate.blocked
feedback.items[]
```

`feedback.items[]` 保存三类反馈：

```text
verification_failed，验证失败
loop_checkpoint，循环检查点
phase_gate，阶段门禁
```

这些反馈不是纯日志。它们会进入 `EngineeringHarness.reminder`，也就是下一次模型请求前的系统提醒。

### 阶段门禁

规则：

```text
localize，定位阶段：允许 read/grep/glob/bash 等定位动作
bug/refactor/security 任务在没有任何定位工具证据时直接 edit/write/apply_patch：阻止
已经读过或搜过代码后 edit/write/apply_patch：允许，并切到 edit，修改阶段
阻止后切到 plan，计划阶段
plan 之后再修改：允许
```

这样做不是为了拖慢模型，而是挡住“没看清就动手”的高风险行为。

### 验证失败回灌

规则：

```text
命令像 npm test / pytest / bun test / typecheck 等验证命令
exit 0：通过，开启 stop gate
exit 非 0：抽取失败摘要，进入 repair
repair 提醒里直接包含失败摘要和关键输出
```

抽取逻辑优先保留这些行：

```text
fail / error / expected / actual / assert / traceback / exception / not ok / FAILED
```

完整输出仍作为 raw 审计保存，不直接塞进普通事件流。

### Benchmark repair 回路

默认不开，避免误烧钱。

启用方式：

```bash
AIALRA_REAL_BENCH_TIER=regression-6 \
AIALRA_REAL_BENCH_TARGETS=aialra-deepseek-v4-pro-max \
AIALRA_REAL_BENCH_REPAIR_ROUNDS=1 \
node aialra/turn-observability/scripts/run-real-benchmark.mjs
```

只在这些条件同时满足时 repair：

```text
目标是 OpenCode
目标在 AIALRA_REAL_BENCH_REPAIR_TARGETS 里
上轮没有超时
没有等待审批
有 patch
官方或本地验证确实失败
```

## regression-6 验收

本阶段不直接跑 full-24。先跑 regression-6，原因很简单：full-24 太贵，V2 先证明方向有效。

regression-6 固定 6 题：

```text
django__django-12754
scikit-learn__scikit-learn-13241
scikit-learn__scikit-learn-14092
pytest-dev__pytest-7168
pylint-dev__pylint-7228
instance_element-hq__element-web-5e8488c2838ff4268f39db4a8cca7d74eecf5a7e-vnan
```

实际结果：

```text
run: 20260531080150
报告: aialra/turn-observability/real-benchmark-reports/real-benchmark-20260531080150.md
验证通过: 4/6
有 patch: 5/6
审批卡住: 0
逻辑超时: 0
```

对比基线：

```text
上一轮同 6 题基线: 3/6
V2: 4/6
提升: +1 verified pass
```

这满足 full-24 触发条件，所以本阶段继续跑 AIALRA-only full-24。

## full-24 验收

实际结果：

```text
run: 20260531093837
报告: aialra/turn-observability/real-benchmark-reports/real-benchmark-20260531093837.md
目标: AIALRA OpenCode / DeepSeek V4 Pro max
验证通过: 6/24
有 patch: 18/24
零 patch: 6/24
审批卡住: 0
超时: 0
跑器基础设施错误: 0
总分: 417
总耗时: 11345857 ms
平均每题: 472744 ms
```

和上一轮 full-24 AIALRA DeepSeek 基线对比：

```text
上一轮: 5/24 verified pass，24/24 有 patch，0 超时，0 审批
本轮: 6/24 verified pass，18/24 有 patch，0 超时，0 审批
```

人话结论：

```text
V2 的方向有效，因为 verified pass 提升了 1 个，并且没有把稳定性打坏
但 V2 也暴露了新问题：长链路大仓里有 6 个零 patch，说明模型有时完成了分析但没有落到代码改动
Pro 任务里很多 local-test-patch 无法应用，说明验证可用性本身也需要工程化，不然 agent 无法得到可靠反馈
```

最终部署：

```text
version: 0.0.0-dev-202605311418
services: web active, login active, codex exec-server active
smoke: 11 pass
```

## 是否跑 full-24 的判定

跑 AIALRA DeepSeek regression-6 后，用上一轮 full-24 里的同 6 题做基线。

判定为“有提升”的条件：

```text
验证通过数增加至少 1
或总分提升至少 8 分且没有新增逻辑卡住
或零补丁/审批卡住/逻辑超时明显下降
```

如果有提升：

```text
只跑 AIALRA DeepSeek full-24
不重跑五组合全矩阵
```

如果没提升：

```text
不跑 full-24
直接写原因分析
进入 V3 设计
```

## V3 预案

V2 有提升，但提升幅度不大，所以 V3 不应重做 V2，而要补 V2 暴露出的缺口。

V3 重点会转向：

| 方向 | 人话解释 |
| --- | --- |
| 强验证计划 | 修改前先让模型明确要跑哪个测试，不能随便验 |
| 失败分类器 | 区分测试依赖缺失、patch 错、方向错、环境错 |
| patch quality gate，补丁质量门禁 | patch 太大、改无关文件、没触碰疑似文件时先拦一下 |
| evidence ledger，证据账本 | 每次读文件必须留下“为什么相关”的短证据 |
| success stop gate 强化 | official/local 验证通过后，评测器和运行时都强制停止 |
| no-patch recovery，零补丁恢复 | 模型长篇分析后没有改代码时，不直接收尾，要求它要么做最小改动，要么明确 blocked 原因 |
| verification availability，验证可用性 | Pro 题 test_patch 套不上时，要给 agent 一个等价的本地验证计划，而不是只能记为 attempted=false |

## 用户怎么亲自测试

小测试：

```text
让 agent 修一个有现成失败测试的小 bug
看 Turn Inspector 是否出现 定位 -> 阶段门禁/计划 -> 修改 -> 验证 -> repair 或 finalize
```

重点看三件事：

```text
测试失败时，下一步模型提示里有没有失败摘要
模型没定位就改代码时，是否出现阶段门禁事件
测试通过后，继续工具调用是否被阻止
```

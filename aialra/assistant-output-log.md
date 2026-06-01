# Assistant Output Log

## 2026-06-01 输出记录：Chesskit 会话卡住和沙盒透明度修复

用户反馈 `ses_17eb92136ffeJOvXUXmSZW5yF0` 在部署类似 ChessNonStop 的开源项目时卡住

排查结论：

- 这个会话存储在开发库 `opencode-dev.db`
- 最后一条工具调用是 bash：`cd /srv/aialra/apps/chess && docker compose up -d --build 2>&1`
- 数据库里这个工具仍然是 `running`
- 主机上没有对应的 docker compose / docker build / npm build 进程
- `docker compose ps` 也没有 chess 容器
- 所以它不是还在认真执行，而是后端执行状态没有收回来，页面才看起来一直卡住

本轮修复：

- session message API，现在会在 session 已经 idle 时校准超过 60 秒仍为 `running` 的工具 part
- 这种 stale running tool，会被改成 error，错误文案会直接告诉用户“后端已经没有对应运行进程”
- 同时写入 `turn.terminal.reconciled` 事件，让 Turn Inspector 和事件流能解释为什么被收口
- `webfetch` 遇到 404 这类 HTTP 非成功状态时，会明确说“网络已连通，但目标返回 HTTP 404”，避免用户误以为是沙盒禁止或审批没有弹
- Codex exec-server FS helper 如果因为 protected metadata mount，受保护元数据挂载，失败，会走 TurnContext 门禁后的 Node/Bun fallback，并记录 `exec_server.fallback`
- 沙盒控制中心所有下拉项增加 hover/title 说明，并把“实时生效范围”写清楚

验证：

```text
bun test test/server/session-messages.test.ts test/tool/webfetch.test.ts --timeout 30000
结果：12 pass

bun typecheck
packages/opencode 通过
packages/app 通过

bun --cwd packages/app build
通过

bun run build --single
packages/opencode 通过，CLI smoke 版本 0.0.0-dev-202606010446
```

人话解释：

这次发现的核心问题不是模型本身，也不是你没等够，而是 OpenCode 后台丢了一个长命令的最终状态。现在消息列表读取时会兜底校准这种孤儿 running 工具。沙盒控制中心不是纯假 UI，但它不是魔法遥控器：已经启动的 docker build、bash 长命令、模型请求不会被中途改写；它影响的是下一次工具门禁和后续 turn。这个生效范围已经在 UI 里写清楚

## 2026-06-01 输出记录：V3 hard gate 和 regression-6 收口

用户明确要求 16 项 V3 目标只有 `未开始`、`部分完成`、`核心完成`、`完全完成` 四种状态，并且只有 16/16 全部 `完全完成` 才允许跑 regression-6，只有 regression-6 通过后才允许跑 full-24

本轮执行结果如下：

- 16 项 V3 状态已全部收敛为 `完全完成`
- `run-real-benchmark.mjs` 的 gate，门禁，已经读取 `status.json`，确保不满足 16/16 时不会 clone 仓库，也不会调用模型
- `full-24` 另有第二道门禁：必须在 16/16 之后跑过 regression-6，并且 verified pass，官方验证通过数，有提升，或者 zero patch，零补丁数，有下降
- 已跑 post-completion regression-6，运行 ID `20260601030607`
- regression-6 结果：4/6 verified pass，0/6 zero patch，0 timeout，0 approval stuck，6/6 turn terminal，patch quality average 78
- 同 6 题基线：4/6 verified pass，0/6 zero patch，patch quality average 77
- 结论：full-24 不允许启动，因为没有 verified pass 提升，也没有 zero patch 下降

人话解释：

这轮不是“没有完成 16 项”，16 项已经完成。问题是完成后用 6 道代表题验收，真实能力没有达到继续烧 full-24 的门槛。系统确实更干净，补丁质量均分略高，但核心目标 verified pass 没涨，zero patch 也没法再降，因为基线已经是 0

这说明下一步不能直接继续大测，而要针对两个未过题做原因分析：`pylint-dev__pylint-7228` 和 `element-web-5e8488...`。尤其要看 repair feedback 是否真的把官方验证失败内容转化成更有用的下一轮修改，而不是只让模型短暂再跑一遍

本轮还修了 shell cancel 和 exec-server 相关 flake。Codex exec-server adapter 会在 turn abort 时发送 `process/terminate`，shell tool 会把 abort 标成 aborted，shell 命令也改成通过 bash/zsh 位置参数执行，避免 sandbox 里 `$i` 这类变量被宿主 shell 提前展开

本轮报告路径：

```text
aialra/turn-observability/real-benchmark-reports/real-benchmark-20260601030607.md
aialra/turn-observability/real-benchmark-reports/real-benchmark-20260601030607-results.json
```

部署和浏览器验收记录：线上版本 `0.0.0-dev-202606010402` 已构建部署，`aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-codex-exec-server.service` 均为 active。部署 smoke 11 pass，认证 API smoke 确认 `/config`、`/project/current`、`/command`、`/session/status`、`/provider`、`/lsp` 均为 200。本地 Playwright smoke 没有计为通过：默认 `3000` 端口被 nginx 占用，换到 `3187` 后测试进入用例但没有稳定结束，已终止并记录为浏览器 smoke 未通过，不能伪装成浏览器验收完成

## 2026-05-31 输出记录：V3 full-24 验收收口和 corrected 结果

本轮继续端到端推进 V3，不再把部分适配说成完全完成

关键事实：

- regression-6 先验收了 `scikit-learn__scikit-learn-13241`，search scope 修复后从零补丁/未验证变成 verified pass
- 之后按门槛跑了 AIALRA-only full-24，目标是 DeepSeek V4 Pro max，不跑五组合大测
- 主 full-24 run 是 `202605312120-full24-aialra-v3`
- 主 run 中有两条不是模型失败，而是我为了救磁盘手动清理 repo cache 后造成的 worktree 准备失败
- 已定向补跑这两条，run 是 `202605312120-full24-aialra-v3-rerun-infra`
- 最终口径必须看 corrected summary，不看原始主报告的基建错误行

最终 corrected 指标：

```text
题目数：24
总分：452
补丁质量均分：58
完成：23/24
有 patch：20/24
零补丁：4/24
官方验证通过：7/24
官方验证尝试：13/24
检测型超时：1
等待审批：0
turn 终态：24/24
```

报告文件：

```text
aialra/turn-observability/real-benchmark-reports/real-benchmark-202605312120-full24-aialra-v3-corrected-summary.md
aialra/turn-observability/real-benchmark-reports/real-benchmark-202605312120-full24-aialra-v3-corrected-results.json
aialra/turn-observability/real-benchmark-reports/real-benchmark-202605312120-full24-aialra-v3.md
aialra/turn-observability/real-benchmark-reports/real-benchmark-202605312120-full24-aialra-v3-rerun-infra.md
```

本轮顺手修掉的评测公平性问题：

- repair 后官方验证不再复用 initial report，而是使用 `official-harness-repair-*`
- repo mirror cache 被手动清理后，runner 会重新检查路径并重新 clone
- grep/glob 不能在 workspace profile 下递归扫 selected environment cwd 之外的路径

用户应该如何理解这次结果：

- AIALRA 的工程稳定性继续变强，0 审批卡住，24/24 turn 终态
- DeepSeek 在 AIALRA harness 下达到 7/24 official verified，追平上一轮 Codex CLI 的 7/24 基线通过数，但不是同一轮同模型横向公平对比
- 质量均分 58 说明“能跑完和能解释”已经提升，但补丁质量还不够强
- 4 个零补丁说明 zero patch recovery 有效果但还不完整
- 1 个检测型超时说明弱模型长链路仍需要更强的策略切换和验证反馈

明确未完成：

- 16 项 V3 目标没有全部 100% 完成
- remote environment 仍 unsupported
- Landlock 仍不是 Node/Bun 工具层 syscall enforce
- glob/grep 现在有 TurnContext 门禁，但不是 Codex exec-server FS API 全接管
- official SWE-Bench 验证结果还主要在 benchmark runner 里闭环，没有完全产品化进普通用户 agent 工作流
- Turn Inspector 虚拟列表和完整质量面板仍需继续产品化

## 2026-05-31 输出记录：General Engineering Harness V3 首批实现

用户要求把 16 项 V3 目标先拆成持久计划文件，再端到端推进实现，避免依赖单次对话上下文

本轮已完成第一批工程缺陷闭环：

- 新增 `aialra/turn-observability/project-plans/v3-general-engineering-harness/`，包含总计划和 16 个分计划
- `EngineeringRun` 升级为 `aialra.engineering_run.v3`
- 每个工程回合现在记录 suspectedFiles、editPlan、verificationPlan、verificationResults、repairFeedback、finalSummary
- 新增 `engineering.artifact.updated`，Turn Inspector 可展示工程状态机的结构化产物更新
- 零补丁恢复不再只看“有没有调用写工具”，还会在 prompt loop 里通过 `git status --porcelain` 检查 selected environment cwd 是否真的有 diff 或未跟踪文件
- 终态校准器新增 missing assistant、empty final、zero patch exhausted、zero tool zero patch 等异常分类入口
- TurnContext 继续补齐 Codex UserTurn 字段：approvals_reviewer、effort、summary、service_tier、final_output_json_schema、selected_environment_id、http_context
- TurnSandbox 相对路径解析改为使用 selected environment cwd
- glob/grep 增加 TurnSandbox read gate，不再只按 legacy instance directory 做路径解析
- Codex exec-server adapter 增加 `fs/copy` 和 `http/request` 入口，并把 HTTP start/finish 映射进 public event stream
- 审批回复新增 scope 审计，能区分“本轮本命令”“本轮全部”“始终本命令”“始终全部”等按钮
- benchmark patch quality 会把 terminal anomaly 纳入质量评分，终态异常不再被算作干净终态

已跑验证：

```text
bun --cwd packages/opencode test test/session/engineering.test.ts --timeout 30000
12 pass

bun --cwd packages/opencode test test/tool/turn-sandbox.test.ts --timeout 30000
18 pass

bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000
90 pass

bun --cwd packages/opencode test test/session/engineering.test.ts test/permission/approval-audit.test.ts --timeout 30000
15 pass

bun --cwd packages/opencode typecheck
pass

bun --cwd packages/app typecheck
pass

node --check aialra/turn-observability/scripts/run-real-benchmark.mjs
pass
```

真实边界：

- 16 项 V3 不是全部完成，当前是第一批骨架和关键工程缺陷闭环
- remote environment 仍是 unsupported，不伪装完成
- exec-server HTTP/copy 只是 adapter 入口，sidecar method 支持需要继续用 live 测试确认
- Landlock enforce、完整 FS metadata、Turn Inspector 虚拟列表最终产品化、full benchmark gate 仍在后续批次

## 2026-05-31 输出记录：General Engineering Harness v2 首批实现

用户要求构建 V2 完整计划书，并且端到端实现、先做 regression-6 验收，有提升才跑 AIALRA full-24，否则分析原因并规划 V3

本轮先检查 V1 代码，结论是：控制面板、工程模式、阶段、重复工具提醒和通过即停止已经存在，但有三处关键缺口。第一，验证失败只在日志里，模型下一步没有直接拿到失败重点。第二，localize，定位阶段主要靠提示词提醒，模型如果直接 edit/write，系统会放行。第三，真实 benchmark 的 official/local 验证失败只进入报告，没有自动喂回同一个 AIALRA agent session 继续修

本轮完成 V2 首批实现：

- `EngineeringRun` 升级为 v2，新增 `phaseGate` 和 `feedback.items`
- 验证失败时抽取失败摘要和关键输出行，写进 `engineering.verification.finished` 的 data，同时完整输出仍走 raw 审计
- repair 提醒会包含最近一次 `verification_failed`、`loop_checkpoint` 或 `phase_gate` 反馈，不再只说“根据上一轮失败继续修”
- bug/refactor/security 任务如果完全没读过/搜过代码就直接 edit/write/apply_patch，会被阶段门禁阻止，并切到 plan 阶段，Turn Inspector 显示 `engineering.phase_gate.blocked_tool`
- 重复工具 checkpoint 会写 feedback，提醒模型总结旧路线并换方向
- `run-real-benchmark.mjs` 新增 `AIALRA_REAL_BENCH_REPAIR_ROUNDS`，默认 0，开启后可只对 AIALRA 目标在验证失败后追加 repair prompt
- Benchmark 报告新增 `repair` 列和自动 repair 记录
- 新增 V2 计划书 `aialra/turn-observability/general-engineering-harness-v2-plan.md`

已跑的最小验证：

```text
bun --cwd packages/opencode test test/session/engineering.test.ts --timeout 30000
5 pass

node --check aialra/turn-observability/scripts/run-real-benchmark.mjs
pass
```

本轮还没有跑 regression-6，也没有跑 full-24。按 V2 计划，下一步必须先跑 AIALRA DeepSeek regression-6，确认相对上一轮同 6 题是否提升；只有提升才跑 AIALRA full-24

## 2026-05-30 输出记录：24 题真实高难五组合 Benchmark 全量执行

用户要求澄清并执行全量真实高难测评：24 个 benchmark 任务，每个任务跑 5 个组合，不允许使用 flash、fast、turbo 或非旗舰模型。最终组合为 Codex CLI `gpt-5.5 / xhigh`、debug1 原版 OpenCode + `kimi/kimi-for-coding`、AIALRA OpenCode + `kimi/kimi-for-coding`、debug1 原版 OpenCode + `deepseek/deepseek-v4-pro / max`、AIALRA OpenCode + `deepseek/deepseek-v4-pro / max`

本轮先清理旧的无效 benchmark run，再启动正式 run `20260530071350`。执行过程中遇到一次真实磁盘满问题，错误为 `ENOSPC: no space left on device`，原因是 SWE-bench 官方验证拉起 Docker 镜像和大量真实仓库 worktree。处理方式不是重跑全量，而是先保护已完成 partial 结果，清理旧 SWE-bench 容器和 Docker 未使用镜像，再给 `run-real-benchmark.mjs` 增加断点续跑、自动清理 worktree、自动清理 official-harness、HTTP 请求超时保护，随后用同一个 runID 继续执行

正式 run 完成后发现 3 条基建失败结果：两个 `fetch failed` 和一个 `ENOSPC`。这些不是模型能力失败，因此从 partial 结果里剔除并定向补跑。补跑确认只跑 `pending=3`，最终得到 120/120 结果，0 duplicate，0 infrastructure error

最终主要结果：

| 对象 | 可验证通过 | 超时 | 零补丁 | 平均耗时 | 平均工具调用 | patch 总量 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex CLI `gpt-5.5 / xhigh` | 7/24 | 0 | 0 | 652s | 0* | 271 KB |
| AIALRA OpenCode + DeepSeek V4 Pro max | 5/24 | 3 | 1 | 989s | 64 | 134 KB |
| debug1 OpenCode + DeepSeek V4 Pro max | 5/24 | 4 | 4 | 906s | 41 | 202 KB |
| debug1 OpenCode + Kimicode | 4/24 | 6 | 6 | 860s | 60 | 800 KB |
| AIALRA OpenCode + Kimicode | 1/24 | 12 | 12 | 1148s | 96 | 95 KB |

`*` Codex CLI 工具调用数显示为 0 是 runner 尚未解析 Codex JSON stream 里的工具事件，不能和 OpenCode 的工具计数直接横比

本轮关键解释：Codex CLI 仍是最稳基线，官方通过最多且无超时。AIALRA DeepSeek 和 debug1 DeepSeek 通过数相同，但 AIALRA 的零补丁更少、超时更少，代价是更慢、工具调用更多。debug1 Kimicode 偶尔能通过，但大补丁和超时更明显。AIALRA Kimicode 当前最弱，大量高工具调用不能转化成有效 patch

本轮生成文件：

- `aialra/turn-observability/real-benchmark-reports/real-benchmark-20260530071350.md`
- `aialra/turn-observability/real-benchmark-reports/real-benchmark-20260530071350-analysis.md`
- `aialra/turn-observability/real-benchmark-reports/real-benchmark-20260530071350-results.json`

下一步建议已写入分析报告：优先做 verification-driven loop，验证驱动回路；weak-model loop intervention，弱模型循环干预；resource governor，资源治理器；patch quality gate，补丁质量门禁；benchmark dashboard，评测面板。结论很明确：当前最大差距已经不是“能不能调用工具”，而是“能不能根据验证反馈收敛”

## 2026-05-16 Turn Intake Gap Explanation

这次回答已写入 [assistant-output-log.md](/srv/aialra/apps/opencode-turn-engine/aialra/assistant-output-log.md:1)。从这次开始，长技术解释我会先落盘再回复，避免后面回看时只剩零碎印象。

你这次骂得有道理。我前面最大的问题是把“第一阶段安全接入”讲得像“Codex（编码执行器）完全体”，这会让你以为我又做半截。准确说：第一阶段只做了 identity spine（身份主线）和 observability（可观测性），还没有做 control plane（控制平面）。它有价值，但它不是终点。

**Turn 是什么**
Turn（回合）就是“一次用户请求的完整工单”：prompt.received（收到提示词）开始，到 final / completed（最终完成）结束。它不是 LLM（大语言模型）临时生成的状态机，而是代码固定掌管的执行生命周期。LLM（大语言模型）只在这个生命周期里决定下一步说话、读文件、调工具或结束。

**原 OpenCode、现在 OpenCode、Codex 的真实差别**
原 OpenCode（开放编码器）是 message/session centric（消息/会话中心）：`PromptInput`（提示词输入）里有 `sessionID`（会话编号）、`model`（模型）、`agent`（代理）、`parts`（输入片段）等字段，然后服务端存 user message（用户消息），再由代码读取历史消息、组装模型请求、进入 loop（循环）。不是模型自己去查数据库，模型只看到服务端组装好的上下文和工具列表。

现在的 OpenCode（开放编码器）多了一层 TurnFrame（回合框架）：它把同一轮里的 prompt.received（收到提示词）、explicit_context_resolved（显式上下文解析完成）、user_message.created（用户消息创建）、model / processor / final（模型/处理器/结束）串到同一个 turnID（回合编号）上。它让我们能追踪这一轮发生了什么，但还不能像 Codex（编码执行器）那样完整控制这一轮允许发生什么。

Codex（编码执行器）是 turn centric（回合中心）：`UserTurn`（用户回合）不是只有文本，它还带 `cwd`（当前工作目录）、`approval_policy`（审批策略）、`sandbox_policy`（沙箱策略）、`permission_profile`（权限配置档）、`model`（模型）、`effort`（推理强度）、`summary`（摘要策略）、`service_tier`（服务等级）、`final_output_json_schema`（最终输出 JSON 结构）、`collaboration_mode`（协作模式）、`personality`（人格风格）、`environments`（环境选择）。这就是它工程能力强的根。

**字段差距**
OpenCode（开放编码器）现在已有：`parts`（输入片段）、`model`（模型）、`agent`（代理）、`format`（输出格式）、`tools`（旧工具开关）、`turnID`（回合编号）、`explicit.files/agents/references`（显式文件/代理/引用）、`timing`（时间点）。

OpenCode（开放编码器）现在缺：`cwd`（当前工作目录）、`sandbox_policy`（沙箱策略）、`approval_policy`（审批策略）、`approvals_reviewer`（审批人/审批通道）、`permission_profile`（权限配置档）、`effort`（推理强度）、`summary`（摘要策略）、`service_tier`（服务等级）、`collaboration_mode`（协作模式）、`personality`（人格风格）、`environments`（环境选择）、正式的 `TurnStarted/TurnComplete`（回合开始/回合结束事件）、正式的 `TurnItem`（回合事件项）。这些大部分都能实现，但会触碰 API（接口）、UI（界面）、SDK（开发包）和存储模型，所以不能一次硬替换。

**为什么不用 Codex 的“现成解析器”**
关键点：Codex（编码执行器）没有一个可以直接搬过来的“9000 字 prompt 自动语义解析器”。它更理想的路径是 structured input（结构化输入）：UI（界面）在用户选择 mention（显式提及）时，就把它作为 `UserInput::Mention`（提及输入）或 `Skill`（技能输入）传给核心，而不是靠服务端从普通文本里猜。

OpenCode（开放编码器）当前暴露的是 `PromptInput.parts`（提示词输入片段），而且 API（接口）、TUI（终端界面）、Web（网页端）都可能只传 raw text（原始文本）。所以我这次做的 `@file/@agent` 服务端补齐，不是想重造 Codex（编码执行器），而是 compatibility bridge（兼容桥）：先保证 raw text（原始文本）不丢能力。真正要更像 Codex（编码执行器），下一步应加入一等公民的 MentionPart（提及输入项）/ SkillPart（技能输入项），让 UI（界面）和 API（接口）直接传结构。

**为什么 Codex 更少重复**
Codex（编码执行器）更少重复，是因为它通常从一开始就是 structured mention（结构化提及）：一个文件提及就是一个输入项。OpenCode（开放编码器）会出现“文本里有 `@file`，同时 TUI（终端界面）又传了 file part（文件输入项）”的双通道情况，所以天然更容易重复。现在的 signature dedupe（签名去重）是补丁，能挡住重复读取；最终方案还是 first-class mention id（一等提及编号）。

**预注入文件内容 vs 受控工具读取**
现在 OpenCode（开放编码器）看到明确 `@file` 会让模型第一轮就看到文件内容。好处是可靠，用户说“看这个文件”，模型马上能看见；坏处是 token（上下文消耗）更高，权限控制更粗，也可能把不该提前进入上下文的内容塞进去。

Codex（编码执行器）更偏向 controlled tool read（受控工具读取）：模型在 sandbox（沙箱）和 approval（审批）约束下按需读文件。好处是更安全、更省上下文、更可审计；坏处是模型可能多一步工具调用，或者在弱模型上忘记读。最好的融合不是二选一，而是 policy（策略）：显式 `@file` 可以按规则选择 pre-read（预读取）、summarize（摘要注入）或 tool-only（只给工具能力）。

**为什么还没做 TurnStarted / TurnComplete / TurnItem**
这个我前面表达得不够硬。它不是不该做，而是下一步就该做。第一阶段只带 `turnID`（回合编号），价值是把散落事件串成一条线，方便观测和迁移；它本身不控制行为。正式 `TurnStarted/TurnComplete`（回合开始/结束）和 `TurnItem`（回合事件项）会改变公共协议和 UI（界面）消费模型，所以正确顺序是先非破坏性双写，再迁移 UI（界面），最后替换旧 message-only（纯消息）模型。

**真实自测结果**
我刚才在本机已部署 OpenCode API（开放编码器接口）上跑了 noReply（不请求模型回复）自测，不消耗模型调用。输入是一条 raw text（原始文本）：包含 `@aialra/CHANGELOG.md` 和 `@build`。

观测结果是：`prompt.received`（收到提示词）里只有 1 个 text part（文本输入项）；`prompt.explicit_context_resolved`（显式上下文解析完成）新增 2 个输入项，分别是 file（文件）和 agent（代理）；`turn.frame.created`（回合框架创建）里显示 `fileParts: 1`、`agentParts: 1`、`textChars: 125`，并且 `explicit.files` 包含 `aialra/CHANGELOG.md`、`explicit.agents` 包含 `build`；数据库里的 user message（用户消息）保留原始 text（文本），同时补了 Read synthetic text（读取工具合成文本）、文件内容、file part（文件输入项）、agent part（代理输入项）。这证明第一阶段确实在运行，不是只写了类型。

`debug1.aialra.online` 目前还不能作为 OpenCode API（开放编码器接口）靶场：HTTPS（加密网页协议）证书域名不匹配，`/global/health` 返回 `Cannot GET /global/health`，本机 nginx（反向代理）配置里也没找到 debug1 路由。它现在更像入口页，不是 OpenCode 后端。要把它变成靶场，需要把 debug1 路由到 OpenCode 的 web/server（网页/服务端）或 login proxy（登录代理），再重新配证书。

**下一步应该怎么补**
下一步我建议做 Stage 2（第二阶段）：Turn Control Contract（回合控制合同）。具体是：第一，写一份 `codex-gap/turn-contract-fields.md`（字段差距文档），逐字段说明 Codex（编码执行器）字段在 OpenCode（开放编码器）里的来源、缺口和迁移方案；第二，新增非破坏性的 `turn.started`（回合开始）和 `turn.completed`（回合完成）事件；第三，新增内部 TurnContext（回合上下文），先塞入 `cwd`（当前工作目录）、`approval`（审批）、`sandbox`（沙箱）、`permissionProfile`（权限配置档）；第四，把显式输入升级成 MentionPart（提及输入项）/ SkillPart（技能输入项），保留 raw `@` 解析作为兼容层；第五，加 file policy（文件策略），决定显式文件是预读取、摘要注入，还是只允许模型通过工具读。

**关于 LLM 生成 DAG**
Codex（编码执行器）的 turn state machine（回合状态机）是固定工程模板，不是每轮由 LLM（大语言模型）生成 DAG（有向无环图）。LLM（大语言模型）可以在固定 harness（执行框架）里选择下一步动作，但不能随便改安全边界。你提的“固定状态机上方让 LLM 生成一个 DAG 工作流图”是有价值的，但它应该是 advisory plan（建议计划），由代码校验后执行，不能替代 harness（执行框架）本身。最佳架构是：固定安全 harness（执行框架）加可选 plan/DAG（计划图）加权限校验。

源码锚点：OpenCode（开放编码器）的 `PromptInput`（提示词输入）在 [prompt.ts](/srv/aialra/apps/opencode-turn-engine/packages/opencode/src/session/prompt.ts:2417)，`TurnFrame`（回合框架）在 [turn-frame.ts](/srv/aialra/apps/opencode-turn-engine/packages/opencode/src/session/turn-frame.ts:5)，显式 `@` 补齐在 [prompt.ts](/srv/aialra/apps/opencode-turn-engine/packages/opencode/src/session/prompt.ts:363)，回合接入在 [prompt.ts](/srv/aialra/apps/opencode-turn-engine/packages/opencode/src/session/prompt.ts:1687)。Codex（编码执行器）的 `UserTurn`（用户回合）在 [protocol.rs](/srv/aialra/apps/codex-turn-engine/codex-rs/protocol/src/protocol.rs:536)，`UserInput`（用户输入）在 [user_input.rs](/srv/aialra/apps/codex-turn-engine/codex-rs/protocol/src/user_input.rs:13)。

## 2026-05-16 Simpler Turn Explanation

可以。我们先把所有术语都扔一边，用一个特别直观的比喻。

把用户的一次提问想成“一张维修工单”。

原来的 OpenCode（开放编码器）像这样：你把一张纸条递过去，纸条上写“帮我看 @aialra/CHANGELOG.md，让 @build 检查一下”。系统把这张纸条放进档案柜，然后叫师傅开工。问题是：纸条是纸条，附件是附件，师傅什么时候看了附件、哪一步属于这张纸条、最后是怎么结束的，系统能跑，但账本不够清楚。

现在我们第一阶段做的事情很简单：给这张工单贴一个条码。这个条码就是 turnID（回合编号）。

贴了条码以后，同一张工单的每一步都能串起来：收到纸条，发现纸条里写了 `@aialra/CHANGELOG.md`，于是把这个文件作为附件补上；发现纸条里写了 `@build`，于是把 build（构建代理）也补上；然后创建用户消息；然后如果请求模型回复，就进入模型和工具流程；最后完成。这些步骤都贴同一个条码，所以我们终于能问：“这一轮到底发生了什么？”

但是注意：贴条码不等于给师傅发施工许可证。条码只能追踪，不能限制师傅能不能进哪个房间、能不能用电钻、要不要先问老板。

Codex（编码执行器）厉害的地方，就是它不只贴条码。它给每张工单同时带上施工许可证。

这个施工许可证里面写着：cwd（当前工作目录）是哪里，也就是师傅只能在哪个工作台干活；sandbox（沙箱策略）是什么，也就是哪些地方不能碰；approval（审批策略）是什么，也就是哪些操作要先问你；permission profile（权限配置档）是什么，也就是这张工单允许用哪些工具；model（模型）用哪个；effort（推理强度）用多大力气；final schema（最终输出结构）要求结果长什么样。

所以一句话：

原 OpenCode（开放编码器）是“有纸条，能开工”。

现在 OpenCode（开放编码器）是“有纸条，有条码，能追踪这一单”。

Codex（编码执行器）是“有纸条，有条码，还有施工许可证，能追踪，也能管控”。

你问我为什么不一步到位把 Codex（编码执行器）全搬过来。最真实的原因是：OpenCode（开放编码器）的收银台、仓库、师傅、账本，现在都认识旧工单格式。如果我突然把工单换成 Codex（编码执行器）的完整格式，很多地方会当场读不懂。第一阶段就是先贴条码，不改变旧工单长相，让整个店还能正常营业。下一阶段才是把“施工许可证”逐项加上去。

再说 `@file` 这个问题。

现在 OpenCode（开放编码器）的做法像是：用户纸条上写“看这个文件”，前台立刻把文件复印件夹进工单里。好处是师傅马上看得到，不容易漏。坏处是复印件可能很厚，也可能有些内容不该提前夹进去。

Codex（编码执行器）的做法更像是：纸条上写“可能需要这个文件”，但师傅要通过受控工具去档案室取。取的时候系统知道他取了什么、是否允许取、要不要审批。好处是安全、省上下文、可追溯；坏处是多一步，而且弱模型可能忘了去取。

所以最好的融合不是“永远预先夹文件”或者“永远让模型自己取”。最好的融合是加一个 file policy（文件策略）：小文件、明确 `@file` 可以直接夹；大文件可以先夹摘要；敏感文件只给受控读取能力，模型要看必须走工具和审批。

你再看 turn（回合）到底有啥用，就把它想成工单条码。

没有 turnID（回合编号）时，我们只能看到一堆散乱记录：某时收到消息，某时模型开始，某时工具执行，某时结束。但这些记录靠猜才能知道是不是同一单。

有 turnID（回合编号）后，我们可以直接把所有记录串起来：这一单从哪句话开始，补了哪些文件，调用了哪个模型，哪些工具被执行，什么时候结束，哪里失败。这就是排查、对比 Codex（编码执行器）、做后续控制层的基础。

接下来最该做的不是继续堆解释，而是把 OpenCode（开放编码器）从“贴条码”推进到“带施工许可证”。也就是 Stage 2（第二阶段）：给每个 turn（回合）补 TurnContext（回合上下文），里面放 cwd（当前工作目录）、sandbox（沙箱策略）、approval（审批策略）、permission profile（权限配置档）、model（模型）这些真正控制行为的东西。然后加 turn.started（回合开始）和 turn.completed（回合完成）两个正式事件。

最短总结：

我们已经做完的是：这一单终于有条码了。

还没做的是：这一单还没完整施工许可证。

Codex（编码执行器）强在：每一单天然有条码，也有施工许可证。

下一步要做的是：把 OpenCode（开放编码器）的每一单也补上施工许可证，而且先兼容旧工单，不能把现在系统跑断。

## 2026-05-16 Implemented vs Remaining Clarification

你现在最大的误解是：把 turn（回合）理解成“每次模型 thinking/reasoning（思考/推理）都是一个 turn（回合）”。这个不对。

更准确是：

一个 turn（回合）通常等于“一次用户提交”。用户发一次 prompt（提示词），就是一个 turn（回合）。在这个 turn（回合）里面，模型可以被调用多次，也可以产生 reasoning（推理记录）、tool call（工具调用）、tool result（工具结果）、assistant message（助手消息）、final（最终回答）。这些都属于同一个 turn（回合），不是每一步都新开一个 turn（回合）。

所以 Codex（编码执行器）不是“把每次 thinking（思考）都变成一个 turn（回合）”。Codex（编码执行器）是：每次用户请求进来时，先创建一个带完整约束的 UserTurn（用户回合），然后由固定 harness（执行框架）控制这轮里面的模型调用、工具执行、权限审批、沙箱限制和结束条件。

你对原 OpenCode（开放编码器）的理解也有一处偏差：模型不是拿到一个数据库编号，然后自己去数据库里取消息。模型没有数据库访问权。真实流程是：OpenCode（开放编码器）服务端把用户消息存进数据库；然后 OpenCode（开放编码器）的代码从数据库读历史消息，组装成 model request（模型请求），发给模型；模型返回文本或工具调用；OpenCode（开放编码器）的 processor（处理器）执行工具；执行结果再由 OpenCode（开放编码器）塞回下一次模型请求。也就是说，迭代一直是代码控制的，不是模型自己访问数据库自转。

我这次到底改了什么：

第一，提前生成 turnID（回合编号）。以前只有 messageID（消息编号），现在这一轮从 prompt.received（收到提示词）开始就拿 user message id（用户消息编号）当 turnID（回合编号）。这个编号贯穿后面的 trace（追踪日志）。

第二，在 createUserMessage（创建用户消息）之前补了 explicit context resolution（显式上下文解析）。也就是 raw text（原始文本）里如果写了 `@aialra/CHANGELOG.md` 或 `@build`，服务端会自动补 file part（文件输入项）和 agent part（代理输入项）。原始文本不改，9000 字 prompt（提示词）还是原样给模型。

第三，加了 dedupe（去重）。如果 TUI（终端界面）已经传了 file part（文件输入项），文本里又有同一个 `@file`，不会重复塞两份文件。

第四，创建 TurnFrame（回合框架）。它记录这一轮的结构摘要：route（入口类型，prompt/command）、sessionID（会话编号）、messageID（消息编号）、agent（代理）、model（模型）、noReply（是否不回复）、format（输出格式）、输入项数量、文本长度、文件数量、代理数量、显式文件/代理/引用、时间点。它不记录完整 prompt（提示词）正文，避免 trace（追踪日志）泄露长文本或密钥。

第五，把 trace（追踪日志）串起来。现在 `prompt.received`（收到提示词）、`prompt.explicit_context_resolved`（显式上下文解析完成）、`turn.frame.created`（回合框架创建）、`user_message.created`（用户消息创建）、`prompt.reply_requested`（请求模型回复）、loop/model/processor/final（循环/模型/处理器/结束）这些事件都有 turnID（回合编号）。

第六，command（斜杠命令）进入 prompt（提示词）时会标记 route（入口类型）为 command（命令），不是普通 prompt（提示词）。

当前完成到了哪个阶段：

完成的是 Stage 1（第一阶段）：Prompt Intake Codex 化（提示词入口的 Codex 化）。它覆盖的是从 prompt.received（收到提示词）到 user_message.created（用户消息创建），再到后续 trace（追踪）能关联 loop/model/processor/final（循环/模型/处理器/结束）。这一阶段不是完整 Codex harness（Codex 执行框架），而是给 OpenCode（开放编码器）补上“每轮输入结构”和“全链路追踪骨架”。

本阶段完全体应该是什么样：

第一，外部 PromptInput（提示词输入）接口不变，Web（网页端）、TUI（终端界面）、API（接口）不需要改。

第二，raw text（原始文本）里的明确 `@file/@agent/@reference` 都能在服务端补齐。

第三，原始文本不被改写。

第四，不重复补上下文。

第五，缺失文件不让 prompt（提示词）失败。

第六，有 TurnFrame（回合框架），但不泄露完整 prompt（提示词）。

第七，trace（追踪日志）能用同一个 turnID（回合编号）串起这一轮。

这些已经实现并测试、构建、部署、commit（提交）了。commit（提交）是 `1433c627e feat(aialra): add codex-style turn frame for prompt intake`。

本阶段带来的真实区别：

以前，如果你从 API（接口）直接发 raw text（原始文本）“看 `@aialra/CHANGELOG.md`”，服务端不一定会像 TUI（终端界面）那样帮你补文件上下文。现在会补。

以前，一轮里面的事件更像散落记录。现在能按 turnID（回合编号）串起来。

以前，很难清楚回答“这一轮到底补了哪些文件、用了哪个模型、走了 prompt 还是 command、最后在哪一步结束”。现在 TurnFrame（回合框架）能回答。

以前，做下一步 Codex control contract（Codex 控制合同）没有稳定挂点。现在有 turnID（回合编号）和 TurnFrame（回合框架）作为挂点。

现在和 Codex（编码执行器）还差什么：

第一，缺 cwd（当前工作目录）的 per-turn control（按回合控制）。OpenCode（开放编码器）现在更多从 session/project（会话/项目）里推导目录，还没有像 Codex（编码执行器）那样每个 UserTurn（用户回合）显式带 cwd（当前工作目录）。

第二，缺 sandbox_policy（沙箱策略）的 per-turn enforcement（按回合强制执行）。OpenCode（开放编码器）有权限规则，但还没有完整 Codex（编码执行器）式本地命令沙箱合同。

第三，缺 approval_policy（审批策略）的 per-turn contract（按回合合同）。OpenCode（开放编码器）可以 ask（询问）权限，但还没有把“这一轮采用什么审批策略”作为 turn（回合）输入合同。

第四，缺 permission_profile（权限配置档）。OpenCode（开放编码器）现在是 session permission ruleset（会话权限规则集），不是 Codex（编码执行器）那种每轮完整权限配置档。

第五，缺 effort（推理强度）、summary（摘要策略）、service_tier（服务等级）、collaboration_mode（协作模式）、personality（人格风格）、environments（环境选择）这些每轮模型/环境控制字段。

第六，缺正式 TurnStarted/TurnComplete（回合开始/回合完成）公共事件。现在是 trace（追踪日志）里有 turn.frame.created（回合框架创建）和 prompt.completed（提示词完成），但还不是公共协议事件。

第七，缺 TurnItem（回合事件项）模型。现在仍然以 MessageV2（消息模型）为主，只是加了 TurnFrame（回合框架）。Codex（编码执行器）更像把用户消息、计划、推理、工具调用、文件变化、最终消息都当成 TurnItem（回合事件项）记录。

为什么这些没在第一阶段实现：

不是因为不该做，而是因为第一阶段的硬约束就是：不改外部 PromptInput（提示词输入）接口、不做数据库迁移、不改工具执行语义、不打断现有 OpenCode（开放编码器）工作流。上面这些 Codex（编码执行器）字段一旦完整实现，就会碰 API（接口）、SDK（开发包）、UI（界面）、tool runner（工具执行器）、permission engine（权限引擎）和 storage（存储）。如果第一阶段一次全改，系统很容易跑断，而且很难知道是哪一层坏了。

所以第一阶段的目标不是“完整复刻 Codex（编码执行器）”，而是“给 OpenCode（开放编码器）接上 Codex（编码执行器）式回合骨架，同时保持原工作流跑通”。这个目标已经完成。

下一阶段才应该做什么：

Stage 2（第二阶段）应该实现 Turn Control Contract（回合控制合同）。也就是把 cwd（当前工作目录）、sandbox（沙箱策略）、approval（审批策略）、permission profile（权限配置档）、model options（模型选项）这些真正控制行为的字段放进内部 TurnContext（回合上下文）。

同时新增 turn.started（回合开始）和 turn.completed（回合完成）事件，先作为非破坏性事件双写，不马上删除旧 message（消息）流程。

再下一步才是 TurnItem（回合事件项）双写：同一轮里用户输入、模型消息、工具调用、文件变化、最终回答，都同时写 MessageV2（旧消息模型）和 TurnItem（新回合事件模型）。确认 UI（界面）和 API（接口）都能读新模型后，再逐步迁移。

最短版答案：

你理解对了一半：Codex（编码执行器）确实更强调“每轮带环境和约束”，但不是“每次模型思考都是一个 turn（回合）”。

我这次改的是第一阶段：让 OpenCode（开放编码器）每次用户请求有 turnID（回合编号）、TurnFrame（回合框架）、显式 `@file/@agent` 服务端补齐、全链路 trace（追踪）。

还没改的是第二阶段：cwd（当前工作目录）、sandbox（沙箱）、approval（审批）、permission profile（权限配置档）这些真正控制模型和工具行为的 Codex（编码执行器）合同字段。

本阶段完全体已经完成；Codex（编码执行器）完全体还没完成。下一步要补的不是再讲概念，而是做 Stage 2（第二阶段）的 Turn Control Contract（回合控制合同）。

## 2026-05-16 Plain Language Rewrite

你说得对，“raw text（原始文本）里的明确 `@file/@agent/@reference` 能在服务端补齐”这句话不是人话。

换成人话就是：

以前你直接在输入框里写“帮我看看 `@aialra/CHANGELOG.md`”，OpenCode（我们正在改的项目）不一定真的把这个文件内容拿给模型看。它可能只把这句话本身给模型。

现在你这样写，服务端会自己发现：你提到了一个文件。于是它会自动把这个文件内容加到这次请求里。模型看到的不只是“帮我看看这个文件”这句话，还会真的看到这个文件内容。

`@agent` 也是一样。你写“让 `@build` 看一下”，以前服务端不一定把 build 这个代理当成结构化对象加进去。现在它会识别出来：你提到了 build 代理，于是把 build 代理也加入这次请求。

`@reference` 可以理解成“配置好的资料入口”。比如项目里提前配置了 `@docs/README.md` 这种引用。你提到它时，服务端会把对应资料也补进来。

所以这句话真正想表达的是：

你不用必须通过终端界面的特殊选择器去点文件。哪怕你只是普通打字写了 `@某个文件`，服务端现在也会尽量帮你把这个文件真的拿进来。

这就是第一阶段最具体的功能变化。

第一阶段到底做完了什么，用人话说只有四件事：

第一，你每发一次请求，系统都会给这次请求贴一个编号。后面所有步骤都带这个编号，方便知道它们属于同一次请求。

第二，你在文字里提到文件或代理时，系统会尽量自动把它们补进这次请求，而不是只把文字本身发给模型。

第三，如果同一个文件已经被补过一次，系统不会再补第二次，避免模型看到重复内容。

第四，系统会记录这次请求经过了哪些关键步骤：什么时候收到、补了哪些文件、创建了哪条用户消息、有没有请求模型回复、模型和工具后面做了什么。

第一阶段没有做什么，也要说清楚：

它还没有限制模型能不能执行命令。

它还没有给每次请求单独设置工作目录。

它还没有给每次请求单独设置沙箱规则。

它还没有给每次请求单独设置审批规则。

它还没有把 OpenCode（我们正在改的项目）的消息存储模型完全改成 Codex（我们参考的项目）的回合事件模型。

所以现在的状态是：

OpenCode（我们正在改的项目）已经能更清楚地知道“这一轮请求发生了什么”。

但 OpenCode（我们正在改的项目）还没有完全做到 Codex（我们参考的项目）那样，严格控制“这一轮请求允许做什么”。

下一步就是补后半段：每次请求都带上工作目录、沙箱规则、审批规则、权限规则。这样它才真正从“能追踪”升级到“能控制”。

## 2026-05-16 Real Prompt Walkthrough

先纠正一个关键点：OpenCode（我们正在改的项目）从来不是“给模型一个数据库编号，让模型自己去数据库拿消息”。模型没有数据库权限。真实情况一直是：服务端把用户消息存起来，服务端再把该给模型看的内容整理好，发给模型。模型只看到服务端喂给它的内容。

下面只用一个真实输入，从头走一遍。

用户输入：

```text
请阅读 @aialra/CHANGELOG.md，让 @build 检查第一阶段是否完整。不要改文件，只说明下一步该做什么。
```

阶段一：收到用户输入。

原来的 OpenCode：收到的基本就是这一句话。它知道“用户发了一条消息”，但没有一个从开始到结束都专门代表“这一次请求”的编号。

现在的 OpenCode：收到这句话时，立刻给这一次请求贴一个编号。这个编号会跟着后面的每一步走。

多出来的东西有什么用：以后看到“读了文件”“调用了模型”“工具执行了”“结束了”，都能知道它们属于这一次请求。

和 Codex 还差什么：Codex 在一开始不只贴编号，还会同时带上“这次能在哪个目录工作、能不能执行命令、执行命令要不要问用户”等规则。我们现在只贴了编号，还没带完整规则。

下一步要做：收到用户输入时，不只生成编号，还要生成一份“本次请求的工作规则”。

阶段二：看用户文字里有没有明确提到文件或代理。

原来的 OpenCode：如果你只是普通打字写 `@aialra/CHANGELOG.md`，它很多时候只把这几个字当普通文字。模型可能只看到“请阅读 @aialra/CHANGELOG.md”这句话，但不一定真的看到文件内容。

现在的 OpenCode：它会发现这里提到了 `aialra/CHANGELOG.md` 这个文件，于是自动把这个文件内容拿进来。它也会发现这里提到了 `build`，于是把 build 这个代理也拿进来。

处理后大概变成这样：

```text
用户原话：
请阅读 @aialra/CHANGELOG.md，让 @build 检查第一阶段是否完整。不要改文件，只说明下一步该做什么。

系统额外补进去：
1. aialra/CHANGELOG.md 的文件内容
2. build 这个代理
```

多出来的东西有什么用：用户只要打字提到文件，模型就真的能看到文件，不会只看到一个文件名。

和 Codex 还差什么：Codex 更理想的方式是，界面一开始就告诉系统“这是一个文件，不是普通文字”。我们现在是服务端从文字里找 `@xxx`，属于兼容旧输入方式。

下一步要做：让界面和接口直接传“这是文件”“这是代理”，不要只传一段普通文字再让服务端猜。

阶段三：避免重复。

原来的 OpenCode：如果界面已经帮你带了文件，而文字里又写了一次 `@aialra/CHANGELOG.md`，有可能出现重复内容。

现在的 OpenCode：它会检查“这个文件是不是已经带过了”。带过就不再加第二遍。

多出来的东西有什么用：模型不会看到两份一样的文件内容，回答更稳定，也少浪费上下文。

和 Codex 还差什么：Codex 更少遇到这种重复，因为它的输入一开始就更结构化，不容易同时出现“普通文字里的文件名”和“单独文件附件”两套东西。

下一步要做：把文件提及变成正式输入项，减少靠文字扫描和去重补救。

阶段四：保存用户消息。

原来的 OpenCode 存进去更像这样：

```text
用户消息：
请阅读 @aialra/CHANGELOG.md，让 @build 检查第一阶段是否完整。不要改文件，只说明下一步该做什么。
```

现在的 OpenCode 存进去更像这样：

```text
用户原话：
请阅读 @aialra/CHANGELOG.md，让 @build 检查第一阶段是否完整。不要改文件，只说明下一步该做什么。

系统补充：
已经读取文件 aialra/CHANGELOG.md

文件内容：
这里是 aialra/CHANGELOG.md 的真实内容

代理：
build
```

多出来的东西有什么用：模型不是靠猜，它真的有文件内容和代理信息。

和 Codex 还差什么：Codex 不一定一上来就把整个文件内容塞进去。它更倾向让模型通过受控工具按需读取。我们现在是“明确提到文件就先塞进去”，可靠但控制还不够细。

下一步要做：加文件策略。小文件可以直接塞，大文件先摘要，敏感文件只能通过工具读取。

阶段五：生成本次请求摘要。

原来的 OpenCode：没有一份专门的“这次请求摘要”。你要查这一轮发生了什么，只能到处翻记录。

现在的 OpenCode：会生成一份简短摘要，内容类似：

```text
这次请求编号：msg_xxx
入口：普通用户输入
会话：ses_xxx
使用模型：当前会话选择的模型
代理：build
用户原文长度：多少字
自动补入文件：aialra/CHANGELOG.md
自动补入代理：build
是否要求模型回复：是或否
```

多出来的东西有什么用：排查问题时不用猜。你能直接知道这一轮补了什么、用了谁、走到了哪。

和 Codex 还差什么：Codex 的这份摘要更完整，还会包括工作目录、审批规则、沙箱规则、权限规则、推理强度等。

下一步要做：把这些控制字段补进这份摘要，让它从“记录本”升级成“执行合同”。

阶段六：决定要不要让模型开始回答。

原来的 OpenCode：如果不是 noReply（不要求回复），就继续进入模型流程。

现在的 OpenCode：还是一样进入模型流程。这里没有改模型怎么回答，也没有改工具怎么执行。

多出来的东西有什么用：虽然执行方式还没变，但后面每一步都会带着同一个请求编号，能追踪。

和 Codex 还差什么：Codex 在进入模型前，会更明确地检查这次请求允许哪些工具、哪些命令要审批、在哪个目录运行。

下一步要做：进入模型前先加载本次请求的规则，而不是只加载会话默认规则。

阶段七：模型和工具开始迭代。

原来的 OpenCode：服务端把整理好的上下文发给模型；模型要用工具时，服务端处理工具调用；然后再把工具结果发回模型。

现在的 OpenCode：这条流程基本没改。改的是：这一轮后续模型、工具、完成事件都能挂到同一个请求编号下面。

多出来的东西有什么用：你能问“这次请求里到底哪个工具执行了、什么时候执行、最后在哪里结束”。

和 Codex 还差什么：Codex 的工具执行约束更强。它不是只记录工具执行了什么，还更明确地管控工具能不能执行。

下一步要做：把工具执行也接到本次请求规则上，比如这一轮禁止 shell、这一轮写文件必须审批。

阶段八：结束。

原来的 OpenCode：最后生成助手回答，消息结束。

现在的 OpenCode：最后也生成助手回答，但追踪记录里能看到这一次请求从开始到结束的链路。

多出来的东西有什么用：如果回答错了，我们能知道是文件没补进去、模型没看到、工具没跑、还是后面执行失败。

和 Codex 还差什么：Codex 有更正式的“开始”和“完成”事件。我们现在有追踪记录，但还没把它升级成公开协议。

下一步要做：新增正式的请求开始和请求完成事件，让界面和外部工具也能稳定消费。

一句话总览：

原来的 OpenCode：用户发一句话，服务端存消息，服务端整理上下文给模型，模型和工具迭代，最后回答。

现在的 OpenCode：用户发一句话，服务端先给这次请求编号，再自动补明确提到的文件和代理，再存消息，再记录这一轮摘要，再继续原来的模型和工具流程。

现在多出来的核心价值：不会丢明确提到的文件；不会重复塞同一个文件；能追踪同一次请求从开始到结束发生了什么。

还没达到 Codex 的地方：还不能把每次请求的工作目录、沙箱、审批、权限作为强规则传下去。

下一步的目标：让每次请求不只是“能被追踪”，还要“带着规则执行”。这就是下一阶段要做的东西。

## 2026-05-17 实现记录：Codex Turn Harness 第二阶段

本次实现开始把 OpenCode 的提示词执行从“只可观察”推进到“有正式回合生命周期”。核心变化是：用户发出一次请求后，服务端会创建内部 `UserTurn`，再创建运行时 `TurnContext`，然后发出 `turn.started`。模型正常结束、noReply 请求结束、或者错误被收口后，会发出 `turn.completed`。用户取消时，会发出 `turn.aborted`，原因使用 Codex 已有的 `interrupted`。

这次没有改外部 PromptInput，也没有改数据库结构。原来的 Web、TUI、SDK 仍然按原入口发请求；服务端内部把它转换成带 cwd、approval_policy、sandbox_policy、permission_profile、model、final_output_json_schema、collaboration_mode、environments 的 UserTurn。换句话说，用户不用换用法，但服务端已经有了 Codex 式“这一轮按什么规则执行”的合同。

流式模型调用也接入了 Codex 同名配置：`request_max_retries` 默认 4，`stream_max_retries` 默认 5，`stream_idle_timeout_ms` 默认 300000。兼容旧 OpenCode 的 `chunkTimeout`，但新字段优先。模型请求还没进入有效流之前失败，走 request retry；模型流中途断开、空闲超时、或者结束时没有 finish/finish-step，走 stream retry。重试时会写入 `model.request.retrying` 或 `model.stream.retrying` trace。

本阶段真正的用户可见目标是：一轮请求不能只有开始没有结束。正常路径应该看到 `turn.started -> turn.completed`；取消路径应该看到 `turn.started -> turn.aborted`；无回复路径也应该看到 completed。每个终态都会把 session status 收回 idle，避免前端永久停在“思考中”。

验证记录：本阶段新增和回归测试已经分批跑过。`schema-decoding.test.ts` 通过；prompt 相关测试因为单文件太长，拆成 lifecycle、retry、stream idle、file/reference、shell、loop/cancel、glob 等几组执行，均通过；`processor-effect.test.ts` 通过；turn observability 的 node 测试通过；`typecheck`、`build`、`git diff --check` 均通过。构建过程中产生过 `packages/core/src/models-snapshot.js` 的自动快照变更，但这不是本阶段源码改动，已经撤回。

安全检查记录：提交前扫描了本阶段相关源码、测试和文档里的 `github_pat_`、`OPENAI_API_KEY`、`ANTHROPIC_API_KEY`、`password`、`secret`、`token` 等关键词。命中的是普通字段名、测试说明和文档里的“不要记录 token”文字，没有发现真实 GitHub token、模型 API key、账号密码或 provider 密钥。

边界记录：这次已经落地 Codex 命名的生命周期、请求/流重试参数、UserTurn/TurnContext 字段、cwd 传播、approval=never 的 ask-to-deny 投影，以及只读权限的第一层拒绝规则。更深层的“每个工具都完全按 Codex sandbox 做系统级隔离”仍需要下一轮继续推进到 tool executor 层；这次不会把它伪装成已经完整等价。

部署记录：提交 `10f610cda` 已推送到 `origin/dev`。随后执行 `./aialra/opencode-deployment/scripts/build-opencode.sh`，完成 fork runtime 构建，版本为 `0.0.0-dev-202605162351`。构建后重启了 `aialra-opencode-web.service`，并确认 `aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-opencode-sensenova.service` 均为 active。未重启 sensenova bridge，以避免把工作区里已有的、与本阶段无关的 sensenova 文件改动混入部署。

部署 smoke：执行 `./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过，网页登录页、登录代理、bootstrap、健康检查和 CLI 入口均通过。随后执行 `RUN_MODEL_CALL=1 ./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过，真实模型短 prompt 成功完成。

真实 trace 验证：最新 trace 文件为 `aialra/turn-observability/traces/ses_1cccabf2bffenkHjSsZDoffbqR.jsonl`，turnID 为 `msg_e33354184001w3x1hae6nnQ5hA`。该 trace 显示 `prompt.received -> turn.context.created -> turn.started -> model.stream.started -> prompt.completed -> turn.completed`，总耗时约 4.9 秒，`turn.context.created` 中能看到 cwd、approval_policy、sandbox_policy、permission_profile、model、collaboration_mode、environments、request_max_retries、stream_max_retries、stream_idle_timeout_ms。

## 2026-05-17 实现记录：Codex Tool Executor Sandbox

本次继续推进 tool executor 层。核心变化是：`Tool.Context` 现在会携带当前 `TurnContext`，模型实际调用 `read`、`write`、`edit`、`apply_patch`、`bash` 时，不再只看 session 级权限或工具自己的路径参数，而是先读取本轮的 cwd、permission_profile、sandbox_policy 和 approval_policy。

文件类工具现在有统一的 turn sandbox 检查。相对路径以 `TurnContext.cwd` 为起点解析；写入前会判断目标路径是否在本轮可写根里；如果路径通过 symlink 指向工作区外，也会按真实路径拒绝；`.git`、`.agents`、`.codex` 在默认 workspace profile 下被当成 Codex 保护路径，允许读但不允许写。

`bash` 工具在 Linux 上接入了 `bubblewrap`。在 managed workspace sandbox 下，命令进程看到的是只读的宿主根文件系统，只有本轮 workspace writable roots 和允许的 tmp roots 被重新绑定为可写。这样 `echo bad > /srv/outside` 这类命令不是靠模型自觉，也不是靠字符串提醒，而是被系统返回 read-only filesystem。

新增 trace 事件为 `tool.sandbox.checked` 和 `tool.sandbox.denied`。前者说明某次工具访问已经被 TurnContext 门禁检查过；后者说明工具被本轮沙箱或权限配置拒绝。prompt 级测试已经验证模型通过 `write` 工具创建相对路径文件时会写入 TurnContext.cwd，同时模型尝试写工作区外路径时会生成 tool error，并且整轮仍然 `turn.completed` 收口。

验证记录：新增 `test/tool/turn-sandbox.test.ts` 覆盖了相对路径 cwd、工作区外写入拒绝、symlink escape 拒绝、`.git` 元数据保护、read-only 写入拒绝、显式 glob deny、Linux bwrap shell 隔离。新增 prompt 级测试覆盖了模型工具调用真实读取 TurnContext，以及 sandbox deny 后的 turn completed。最初回归时，既有的 `tool.write > throws error when OS denies write access` 在 root 环境下失败，因为 root 可以覆盖 0444 文件；随后给这个 OS 权限测试加了 root 环境保护，避免把 root 权限特性误判成工具回归。

最终验证记录：`test/tool/read.test.ts test/tool/write.test.ts test/tool/edit.test.ts test/tool/apply_patch.test.ts test/tool/shell.test.ts test/tool/turn-sandbox.test.ts` 共 138 个测试全部通过。`test/session/prompt.test.ts test/session/schema-decoding.test.ts` 共 89 个测试全部通过。`node --test aialra/turn-observability/tests/*.test.js` 通过。`bun run --cwd packages/opencode typecheck` 通过。`bun run --cwd packages/opencode build` 通过，并且构建产物的 x64 CLI smoke test 通过。`git diff --check` 通过。构建过程中再次生成过 `packages/core/src/models-snapshot.js` 快照差异，但这是构建副产物，已经恢复，不纳入提交。

提交记录：本阶段代码提交为 `86b5ba489 feat(aialra): enforce turn sandbox in tool executor`，已推送到 `origin/dev`。push 钩子执行了全 workspace `bun turbo typecheck`，14 个任务全部成功。

部署记录：执行 `./aialra/opencode-deployment/scripts/build-opencode.sh`，生成并 smoke 通过的 fork runtime 版本为 `0.0.0-dev-202605170639`。随后重启 `aialra-opencode-web.service`，并确认 `aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-opencode-sensenova.service` 均为 active。部署后执行 `./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过；再执行 `RUN_MODEL_CALL=1 ./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过，真实模型短请求完成。

线上 trace 验证：最新真实模型 trace 文件为 `aialra/turn-observability/traces/ses_1cb54d04bffel7HJDQG801AF9t.jsonl`，turnID 为 `msg_e34ab3042001456QxH4jyKFVlG`。该 trace 显示 `prompt.received -> turn.context.created -> turn.started -> model.stream.started -> prompt.completed -> turn.completed`，总耗时约 3.8 秒。`turn.context.created` 中能看到本轮 cwd、approval_policy、sandbox_policy、permission_profile、active_permission_profile、model、collaboration_mode、environment cwd、request_max_retries、stream_max_retries、stream_idle_timeout_ms。由于这轮真实 smoke prompt 没有触发工具调用，所以线上 trace 没有 `tool.sandbox.checked`；工具门禁的真实调用路径由 prompt 级 mock-model 测试和 tool executor 回归测试覆盖。

## 2026-05-17 解释记录：当前 Codex 化范围、人话版差异和下一步

用户要求把当前实现逐句翻译成人话，并解释目前改了什么、和原 OpenCode 有什么区别、和真 Codex CLI 有什么区别、如何做用户体感测试、下一步应该做什么。

核心解释：现在的 `turn` 可以理解成“用户发出一次请求后，服务端给这次请求开的工单”。`turn.started` 是开工，`turn.completed` 是不管成功还是错误都收工，`turn.aborted` 是用户取消或请求被替换。`UserTurn` 是这张工单上的规则，`TurnContext` 是代码实际执行时随身携带的规则包，不只是给模型看的文字。

已经完成的变化分四层。第一层是观测层：trace 能把一次请求从收到 prompt 追到最终结束。第二层是生命周期层：每次 prompt 都必须有开始和终态，避免前端一直“思考中”。第三层是模型流层：请求失败、流中断、流空闲、流没正常 finish 都能按 Codex 同名参数重试或收口。第四层是工具执行层：read/write/edit/apply_patch/bash 都会读取 TurnContext，文件路径按本轮 cwd 解析，写入要过 permission_profile 和 sandbox_policy，symlink 逃逸会被拒绝，bash 在 Linux 下使用 bubblewrap 做系统级隔离。

和原 OpenCode 的主要区别：原 OpenCode 更像“收到用户消息后直接进入模型和工具循环”，权限、cwd、失败收口比较分散。现在更像“先建一张本轮工单，再让模型和工具按这张工单执行”。所以现在不仅能查“发生了什么”，也开始能控制“允许发生什么”。

和真 Codex CLI 的主要区别：我们已经合并了 Codex 风格的 turn 生命周期、重试命名、TurnContext 字段、工具门禁和 Linux bubblewrap 隔离，但还没有把 Codex 的 Rust 执行器底座完整移植过来。本地 Codex 源码里存在独立的 `exec-server`、`sandboxing`、`linux-sandbox`、`windows-sandbox-rs` 等模块；Codex 的完整能力不是只有一段 TypeScript 检查，而是有独立执行服务和多平台沙箱后端。当前 OpenCode 仍然是在 Node/Bun 工具执行器里加入强门禁，bash 用 Linux bubblewrap 做系统隔离；macOS seatbelt、Windows sandbox、Rust exec-server、远程/多环境文件系统抽象还没有完整 1:1 落地。

用户体感测试建议：普通请求应该不会卡死；让模型读相对路径文件时，应该按当前工作区读取；让模型写工作区内文件应该成功；让模型尝试写工作区外文件应该被拒绝且整轮正常结束；让模型跑 bash 写工作区外文件时，Linux bubblewrap 应该让外部写入失败。观察方式是看最新 trace 文件并用 `aialra/turn-observability/scripts/render-trace.js` 渲染，重点找 `turn.started`、`turn.completed`、`tool.sandbox.checked`、`tool.sandbox.denied`。

下一步建议：如果目标是继续逼近“真 Codex CLI”，下一阶段不要先做 DAG 或自定义规划器，而应该做 Codex exec-server/sandbox runtime 移植。具体是先研究 Codex Rust `exec-server` 协议和 sandboxing crate，再让 OpenCode 工具层通过适配器调用这个执行底座，逐步替换 Node/Bun 直接 fs/process 执行。Linux 先对齐 bwrap/Landlock，之后再对齐 macOS seatbelt 和 Windows sandbox。并行可以把 Codex 的 thread/turn/item 公共事件模型映射到 OpenCode UI，让用户不用翻 trace 也能看到工具被允许、拒绝、完成或失败。

## 2026-05-18 解释记录：验收矩阵、差距矩阵、靶场测试和透明化路线

用户要求把已实现能力写成验收矩阵，把未实现能力和 Codex 差距写成矩阵，给出真实提示词和靶场文件夹，说明如何比较原版 OpenCode 与当前 fork，并设计用户可见的 agent 执行日志。

本次新增文档 `aialra/turn-observability/harness-status-and-test-playbook.md`。文档包含四块：第一，已实现能力验收矩阵，把 turn lifecycle、UserTurn/TurnContext、retry、trace、read/write/edit/apply_patch/bash 门禁、bubblewrap、symlink 拒绝、保护目录、tool.sandbox trace 等能力逐项列出。第二，Codex 差距矩阵，列出 public Thread/Turn/Item 事件、Rust exec-server、Linux Landlock、bundled bwrap、macOS Seatbelt、Windows sandbox、remote/multi-environment execution、approval reviewer、permission profile parity、final output schema、用户可见 Turn Inspector、A/B benchmark 等仍需吸收的能力。第三，靶场测试手册，指定 `/srv/aialra/turn-harness-target` 为安全靶场目录，并给出从普通收尾、相对路径读取、工作区内写入、工作区外拒绝、bash 内外写入、保护目录写入拒绝到复杂混合任务的真实 prompt。第四，透明化路线，建议新增 Turn Inspector，把 Intake、Turn context、Model request、Tool execution、Sandbox decision、Retry、Final 等阶段展示给用户。

本次同时更新 `aialra/turn-observability/README.md`，从入口文档链接到该 playbook。服务器上已创建靶场目录 `/srv/aialra/turn-harness-target`，包含 `README.md` 和 `src/app.js`，并清理了 `/srv/aialra/outside-turn-test.txt` 与 `/srv/aialra/outside-bash-test.txt`，方便用户直接用 Web 或 CLI 进行体感测试。

建议结论：先做行为型 A/B，而不是马上跑大型 SWE-bench。把原版 OpenCode 部署到 `debug1.aialra.online`，当前 fork 用 `opencode.aialra.online`，同模型、同靶场、同 prompt，对比是否卡死、cwd 是否正确、外部写入是否被拒绝、bash 是否被系统隔离、取消后是否恢复、trace 是否完整。大型 SWE-bench 放在后面，用来评估产出质量，不适合作为底层 harness 稳定性和安全性的第一验收。

## 2026-05-18 后台核查记录：靶场手动测试结果

用户在 `/srv/aialra/turn-harness-target` 靶场目录做了多轮简单测试后，要求检查后台是否符合预期。本次核查了文件系统、最新两份 trace 和服务状态。

文件系统结果：靶场内存在 `result-inside.txt`，内容为 `AIALRA_INSIDE_OK`；存在 `bash-inside.txt`，内容为 `INSIDE`；存在 `report.md`，其中记录了项目总结和“尝试写入 `/srv/aialra/outside-turn-test.txt` 被拒绝”。工作区外的 `/srv/aialra/outside-turn-test.txt` 和 `/srv/aialra/outside-bash-test.txt` 均不存在，符合预期。

trace 结果：最新两份 trace 是 `ses_1c43ed3b3ffeGqk5CvHSRKdnsT.jsonl` 和 `ses_1c43fedd4ffeOJpT6L2DGsBF9C.jsonl`。两份 trace 合计 8 个 turn，每个 turn 都有 `turn.started` 和 `turn.completed`，没有发现缺少终态的 turn。`ses_1c43ed...` 覆盖了读取 README、工作区外写入拒绝、`.git/config` 写入拒绝、复杂混合任务；其中出现了 `tool.sandbox.checked` 和 `tool.sandbox.denied`，外部写入和 `.git/config` 写入均被拒绝。`ses_1c43fedd...` 覆盖了普通回复、工作区内写入、bash 写入和后续自查；第一轮 Kimi 流曾出现一次 `model.stream.retrying`，原因是 socket connection closed，随后重试成功并 `turn.completed`；这验证了 stream retry 收口能力。

边界观察：在 `ses_1c43fedd...` 的后续自查中，模型多次用 bash/read 查看 trace 和脚本，cwd 显示为 `/srv/aialra/turn-harness-target`，但部分 bash 工具的 `target` 是 `/srv/aialra/apps/opencode-turn-engine`。这是因为当前 workspace-write 策略是“工作区可写，全局只读”，所以读取仓库文件和在仓库目录中只读执行命令是允许的；写入仍只允许靶场目录和 tmp roots。这一点符合当前实现，但如果希望“工作区外连读都不允许”，下一阶段需要新增更严格的 read-confined profile。

服务状态：`aialra-opencode-web.service` 仍为 active。后台未发现 systemd web service 错误日志。

## 2026-05-18 设计记录：Public Event Stream、Turn Inspector、exec-server 路线

用户提出下一阶段 9 个优先事项：完整设计 OpenCode public event stream；深入研究 Codex exec-server；继续对齐 Linux bwrap 并评估 Landlock；在 `debug1.aialra.online` 部署原版 OpenCode 做三方对比；修复 Kimi/类似模型卡住循环；暂不考虑 macOS/Windows 沙箱；把 approval UI 和 TurnContext 强绑定；做 profile parity 测试表；做 Turn Inspector 侧栏。

本次先做设计和源码研究，不把设计伪装成已实现功能。OpenCode 侧确认：当前已有 `/event` SSE 事件流，但它吐的是内部 bus event，不是用户可读、机器可稳定消费的公共事件模型；session UI 右侧已有 review/files panel，layout 中已有 fileTree/review/terminal 状态，适合新增 `turnInspector` 状态和侧栏按钮；审批入口在 `permission.asked`、`permission.replied`、`SessionPermissionDock`，下一步可以加 turnID 并映射成 `approval.requested/resolved`。

Codex 侧确认：exec-server 是独立执行服务，不只是 bash wrapper。它的协议包括 `initialize`、`initialized`、`process/start`、`process/read`、`process/write`、`process/terminate`、`process/output`、`process/exited`、`process/closed`、`fs/readFile`、`fs/writeFile`、`fs/createDirectory`、`fs/getMetadata`、`fs/readDirectory`、`fs/remove`、`fs/copy`、`http/request`、`http/request/bodyDelta`。进程输出有 seq、replay buffer、Exited 和 Closed 两阶段；文件系统操作可以带 sandbox context，并可通过 sandboxed FS helper 在系统沙箱里执行；EnvironmentManager 把 local/remote/disabled 环境统一成 exec backend、filesystem、http client。

本次新增文档 `aialra/turn-observability/public-event-stream-and-exec-server-roadmap.md`。文档把 9 个诉求合成下一阶段路线：先做 public event stream，再做 Turn Inspector MVP，再做 approval audit，再做 exec-server adapter PoC，然后推进 profile parity、bwrap parity、debug1 三方 A/B benchmark 和 Kimi 循环诊断。文档也列出 trace phase 到 public event 的映射、公共事件字段、脱敏规则、UI 面板内容、Codex exec-server 协议表、进程/文件系统/环境模型、bwrap/Landlock 差距和验收标准。

本次同时更新 `aialra/turn-observability/README.md`、`aialra/turn-observability/trace-schema.md` 和 `aialra/CHANGELOG.md`，让后续可以从 README 和 trace schema 追到这份路线图。

## 2026-05-18 实现记录：Public Event Stream、Turn Inspector、Approval Audit

用户要求“全量端到端完全执行”上一阶段计划：先落地公共事件流和 Turn Inspector，再把 approval UI 和 TurnContext 审计绑定，exec-server 继续作为后续主线。

本次实际实现了 `aialra.public_event.v1` 公共事件模型。它不是替换旧 `/event`，而是新增并行用户可见协议：`GET /event/public`、`GET /session/:sessionID/events/public`、`GET /session/:sessionID/events/:eventID/raw`。旧 `/event` 仍然照常给前端 global sync 使用。

公共事件有两层。第一层是安全外壳，进入 SSE 和 Turn Inspector，只放事件类型、turnID、messageID、toolCallID、标题、摘要、状态和脱敏后的结构字段。第二层是 raw payload，完整 trace/bus 源载荷不走 SSE，只通过 `rawRef` 指向 raw endpoint。配置 `AIALRA_EVENT_AUDIT_KEY` 时 raw payload 用 AES-256-GCM 加密落盘；未配置时只保留在内存里，默认每条 raw payload 最多 64 KiB，可用 `AIALRA_EVENT_MEMORY_RAW_LIMIT_BYTES` 调整，并发出 `audit.encryption.unavailable` warning event。`aialra/turn-observability/audit/` 已加入 `.gitignore`。

事件来源有两条。第一条是 `AialraTurnTrace.emit`，现在即使 JSONL tracing 没开，也会把可映射 phase 写入 public event log，例如 `turn.input.received`、`turn.context.created`、`turn.started`、`model.request.started`、`model.stream.started`、`model.retrying`、`tool.call.started`、`tool.sandbox.denied`、`final.output`、`turn.completed`。第二条是 OpenCode bus，主要映射 `permission.asked`、`permission.replied` 和 tool part 更新，用来生成 approval、file、command 相关公共事件；turn lifecycle 只走 trace 映射，避免 UI 里同一个开始/结束重复显示。

Turn Inspector 已接入 session 页面右侧。标题栏文件树按钮右边新增一个状态图标按钮；点击后打开右侧 Turn Inspector 面板。面板支持 All、Errors、Tools、Files、Commands、Approvals 过滤，展示 turn/model/tool/file/command/approval/final 等事件摘要。当前认证用户可以点 `Raw` 展开某条事件的原始载荷；raw 展开走 raw endpoint，不走 SSE。

Approval audit 已和 TurnContext 绑定。`Permission.Request` 新增可选 `turnID`、`approvalPolicy`、`permissionProfile`、`sandboxPolicy`。工具触发 `ctx.ask` 时会从当前 `Tool.Context.turn` 填入这些字段。`permission.asked` 会映射为 `approval.requested`，`permission.replied` 会映射为 `approval.resolved`，所以之后 UI 和审计都能知道“哪一轮、哪个工具、哪个权限策略触发了审批”。

已完成验证：`bun --cwd packages/opencode test test/server/httpapi-public-event.test.ts test/permission/approval-audit.test.ts --timeout 30000` 通过，覆盖 public SSE replay、raw endpoint、safe event 不携带完整长 prompt/authorization、跨 session raw 拒绝、trace disabled 时 public event 仍记录、permission bus 到 approval event 映射。`AIALRA_PUBLIC_EVENT_REPLAY_LIMIT=20 AIALRA_EVENT_MEMORY_RAW_LIMIT_BYTES=8192 bun --cwd packages/opencode test test/session/prompt.test.ts --timeout 30000` 通过，64 个 prompt 回归全过；普通默认内存上限下该长测试在本机曾被 SIGKILL，因此后续 CI 应该显式设置测试用 replay/raw 上限。`bun --cwd packages/opencode test test/session/schema-decoding.test.ts --timeout 30000` 通过。`node --test aialra/turn-observability/tests/*.test.js` 通过。`bun run --cwd packages/opencode typecheck` 通过。`bun run --cwd packages/app typecheck` 通过。`bun run --cwd packages/app build` 通过。`bun run --cwd packages/opencode build --single --skip-install` 通过，并完成 x64 CLI smoke test。`bun run --cwd packages/opencode build` 默认会构建 12 个平台，本机在多架构阶段被 SIGKILL，所以本次用 `--single` 验证当前 Linux 部署产物。构建过程会重新生成 `packages/core/src/models-snapshot.js`，该构建副产物已恢复，不纳入提交。

当前边界：exec-server 尚未替换 Node/Bun executor；command output 现在主要来自工具完成后的摘要，尚不是 Codex exec-server 那种实时 stdout/stderr seq 流；debug1 原版 OpenCode A/B 还未部署；bwrap/Landlock parity 仍在下一阶段。

提交记录：代码提交为 `3591abed9 feat(aialra): add public turn event stream`，已推送到 `origin/dev`。push 钩子执行了全 workspace `bun turbo typecheck`，14 个任务全部成功。

部署记录：服务器本地 `/srv/aialra/config/secrets/opencode.env` 已补充 `AIALRA_EVENT_AUDIT_KEY`，没有写入仓库。执行 `MODELS_DEV_API_JSON=<本地临时模型快照> ./aialra/opencode-deployment/scripts/build-opencode.sh`，构建版本为 `0.0.0-dev-202605181802`，x64 CLI smoke test 通过。随后重启 `aialra-opencode-web.service`，并确认 `aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-opencode-sensenova.service` 均为 active。

线上验收：`./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过。`RUN_MODEL_CALL=1 ./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过，真实模型短请求完成。公共事件流 `GET /event/public` 已返回真实事件，第一批事件包括 `turn.input.received`、`turn.context.created`、`turn.started`、`model.request.started`；事件里的 `rawRef` 显示 `encrypted: true`、`persisted: true`。当前审计目录 `aialra/turn-observability/audit/` 已生成 9 个加密 raw 文件。

线上 trace 验证：最新真实模型 trace 文件为 `aialra/turn-observability/traces/ses_1c3bd5324ffeTQkQg1zwnT02IJ.jsonl`，turnID 为 `msg_e3c42adeb001A91POQzrAICKPb`。该 trace 显示 `prompt.received -> turn.context.created -> turn.started -> model.stream.started -> prompt.completed -> turn.completed`，总耗时约 4.3 秒，并且 `turn.context.created` 里能看到本轮 cwd、approval_policy、sandbox_policy、permission_profile、model、collaboration_mode、retry 等字段。

## 2026-05-18 矩阵更新记录：九项路线状态

用户要求确认 9 个事项哪些已实现、哪些未实现，以及能力矩阵是否更新。本次确认：`public-event-stream-and-exec-server-roadmap.md` 和 changelog 已经更新，但 `harness-status-and-test-playbook.md` 仍停留在旧状态，里面还写着 public event 和 Turn Inspector 尚未实现。本次已直接更新 `aialra/turn-observability/harness-status-and-test-playbook.md`。

更新后的结论：Public event stream 已实现 MVP 并部署；Turn Inspector 已实现 MVP 并部署；approval audit 已和 TurnContext 绑定并进入公共事件；Linux-only 范围已遵守；Codex exec-server 已完成源码研究和路线设计，但尚未接入 OpenCode 执行器；bwrap 已有 Linux 系统隔离但未达到 Codex 1:1；debug1 原版 OpenCode A/B 尚未部署；Kimi/弱模型循环诊断只有观测能力，尚未加入 budget/detector；profile parity 只有关键测试和设计表，尚未完成全量矩阵自动化。

## 2026-05-18 实现记录：网站体验修复和 Turn Inspector 中文化

用户报告线上页面有一批可见问题：Turn Inspector 全是英文；Raw 一直 loading；输出到底部后不会按用户滚动位置自动跟随；浏览器控制台出现 Cloudflare beacon CSP、manifest 语法错误、worker-src CSP、public event stream 524、动态资源 502、pty 404 等错误；不同 turn 没有清晰分段。同时用户再次要求推进所有未完成的大项，包括 exec-server、bwrap/Landlock、debug1 A/B、Kimi/弱模型诊断、profile parity 和能力矩阵更新。

本次优先处理用户正在浏览器里直接遇到的体验问题。Turn Inspector 面板已中文化：标题改为“回合检查器”，连接状态改为“正在接收公共事件流/等待事件”，筛选按钮改为“全部、错误、工具、文件、命令、审批”，事件标题和状态改为中文，Raw 按钮改为“原始/收起”，加载提示改为“正在加载原始内容”，顶部按钮 tooltip 和命令面板入口也改为“回合检查器/切换回合检查器”。事件列表现在按 turnID 分段，显示“回合 xxx / N 条”，没有 turnID 的事件显示“全局事件”。

Raw 一直 loading 的根因是前端请求 raw endpoint 没有超时保护。本次给 raw 请求加入 12 秒 AbortController 超时，失败会显示“原始内容加载超时，请稍后重试”或 HTTP 状态错误，不会无限 loading。raw 内容仍然只通过 `GET /session/:sessionID/events/:eventID/raw` 按当前认证用户拉取，不通过 SSE 推完整原文。

Public event stream 524 的根因是 session public SSE 在没有新事件时可能长时间不输出任何字节，Cloudflare 会关闭这个长连接。本次后端在 public SSE 建立时立即发送 `event: ping`，之后每 20 秒发送一次 ping；前端和测试都会忽略没有 `aialra.public_event.v1` schema 的 ping，只处理真正的公共事件。本机 curl 已验证 `/event/public` 首帧能看到 `event: ping`，随后继续返回真实 public event。

滚动行为已改成“贴底才自动滚动”。回合检查器会记录滚动视口距离底部是否小于 48px；如果用户已经在底部，新事件来时自动滚到底；如果用户向上翻旧事件，新事件不会把视图强行拉回底部。这个修复只影响 Turn Inspector 事件面板，不改变聊天主时间线。

浏览器资源问题已处理三类。第一，OpenCode UI CSP 和登录代理 CSP 都加入 `worker-src 'self' blob:` 和 `child-src 'self' blob:`，解决同源 `/assets/worker-*.js` 被 `worker-src blob:` 拒绝的问题。第二，`script-src` 加入 `https://static.cloudflareinsights.com`，解决 Cloudflare beacon 被 CSP 拦截的问题。第三，登录代理对 `/site.webmanifest`、manifest icon 和 favicon 路径直接代理到 OpenCode 静态资源，不再在未登录时返回 HTML 登录页，所以 manifest 不再出现 JSON 语法错误。`/site.webmanifest` 已验证返回 `application/manifest+json` 和 JSON 内容。

验证记录：`bun run typecheck` 在 `packages/app` 通过；`bun run typecheck` 在 `packages/opencode` 通过；`bun test test/server/httpapi-public-event.test.ts test/permission/approval-audit.test.ts --timeout 30000` 通过；`node --test aialra/turn-observability/tests/*.test.js` 通过；`bun run build` 在 `packages/app` 通过；`bun run build --single --skip-install` 在 `packages/opencode` 通过，并完成 Linux x64 CLI smoke。随后用部署脚本构建线上 runtime，最终部署版本为 `0.0.0-dev-202605181852`。

部署记录：重启了 `aialra-opencode-web.service` 和 `aialra-opencode-login.service`，并确认 `aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-opencode-sensenova.service` 均为 active。`./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过，显示线上版本 `0.0.0-dev-202605181852`。登录后首页 CSP header 已验证包含 `https://static.cloudflareinsights.com`、`worker-src 'self' blob:`、`child-src 'self' blob:`。本机 raw endpoint 已验证能返回 `aialra.public_event_raw_response.v1`。

浏览器验收记录：使用 Playwright 通过真实 Chrome 登录 `https://opencode.aialra.online`，打开 `/srv/aialra/turn-harness-target` 对应 session 页面，点击“切换回合检查器”。面板文本显示“回合检查器 / 等待事件 / 全部 / 错误 / 工具 / 文件 / 命令 / 审批 / 这个会话还没有公共事件。”，控制台 `warningsAndErrors` 为空。

能力矩阵更新：`aialra/turn-observability/harness-status-and-test-playbook.md` 已新增“网站体验修复验收矩阵”，记录中文化、Raw 超时、贴底滚动、turn 分段、SSE ping、CSP worker、Cloudflare beacon、manifest 和浏览器 Playwright 验收结果。更大的未完成项仍保持真实状态：Codex Rust exec-server 尚未接入执行器；bwrap 尚未达到 Codex 1:1，Landlock 尚未落地；debug1 原版 OpenCode A/B 尚未部署；Kimi/弱模型循环还只有观测能力，尚未加入 budget/detector；profile parity 仍未完成全量自动化矩阵。

## 2026-05-19 实现记录：Linux 沙箱强化、exec-server 适配器、弱模型循环硬收口

用户要求继续“全量实现所有未实现功能”，包括 bwrap 与 Codex 接近、Codex exec-server 接入执行器、完善 Linux 沙箱、修复 Kimi/弱模型卡死、profile parity 测试表、能力矩阵更新和后续产品化规划。本次实现优先落地可在当前 Node/Bun OpenCode 执行器中真实运行的部分，并明确记录无法冒充完成的边界。

Linux 沙箱方面，新增 `probeLinuxSandboxCapability()` 和 `aialra/turn-observability/scripts/probe-linux-sandbox.mjs`。探测结果会检查 Linux 内核版本、Landlock 可能性、bubblewrap 路径和版本、`--new-session`、`--die-with-parent`、`--unshare-user`、`--unshare-pid`、`--unshare-net`、`--proc`、`--dev` 等能力，也会检查本机 `codex exec-server` 和 `codex-linux-sandbox` 是否可用。本机探测显示内核为 `6.8.0-106-generic`，Landlock 从内核版本看应可用，bwrap 为 `/usr/bin/bwrap` 版本 `0.9.0`，user namespace 可用，但在当前容器里 bwrap 挂载 `/proc` 会被拒绝，所以运行时会自动跳过 `--proc /proc`。

bwrap 执行路径已强化。bash 工具在 Linux sandbox 下会记录 `tool.sandbox.capability` 事件，并尽量使用更接近 Codex 的 bwrap 参数：根文件系统只读绑定、`--new-session`、`--die-with-parent`、`--unshare-user`、`--unshare-pid`、`--unshare-ipc`，网络关闭时加 `--unshare-net`，并按本轮 TurnContext 的 cwd 和 writable roots 开放写入。`.git`、`.agents`、`.codex` 即使原本不存在，也会用只读空目录覆盖，防止命令在工作区里偷偷创建这些受保护目录。命令结束后会清理临时覆盖目录。

Codex exec-server 方面，新增 `packages/opencode/src/tool/codex-exec-server.ts`。它实现了一个 TypeScript 适配器，支持启动或连接 Codex exec-server，并实现 `initialize`、`initialized`、`process/start`、`process/read`、`process/terminate` 的基本 JSON-RPC/WebSocket 客户端逻辑。bash 工具新增可选后端：当 `AIALRA_EXEC_BACKEND=codex` 时优先尝试 exec-server，失败时记录 `exec_server.fallback` 并回退到现有 Node/Bun executor。默认仍使用现有 executor，避免线上因为 sidecar 协议不稳定直接不可用。

exec-server 的真实边界：本机安装的 `codex-cli 0.125.0-alpha.3` 能启动 `codex exec-server --listen ws://127.0.0.1:0` 并打印监听地址，`ss` 也能看到端口，但 Node 和 Bun 的 WebSocket 客户端连接该地址时收到非 101 handshake / network error。因此本次不能诚实地宣布“Codex exec-server 已全量替换执行器”。当前完成的是兼容适配器、可选后端、失败回退和事件记录；后续要么定位 Codex exec-server 的握手协议差异，要么通过 Rust sidecar/stdio bridge 做真正接入。

弱模型/Kimi 卡死方面，新增第一批硬收口。每轮 turn 现在有默认 step budget，默认最大 80 步，可用 `AIALRA_TURN_MAX_STEPS=0` 关闭或用数字覆盖。超过预算时会写入 assistant error，记录 `turn.budget_limited`，再发 `turn.aborted`，reason 为 Codex 已有的 `budget_limited`，并把 session status 收回 idle。重复工具调用也会被观测：同一个工具、同一个输入、同一个结果连续重复达到阈值时记录 `turn.repeated_tool.warning`，第一版只警告不拦截，避免误杀正常重试。

公共事件和 Turn Inspector 已跟进新增事件。`tool.sandbox.capability`、`turn.warning`、`executor.started`、`executor.finished`、`executor.fallback` 已加入公共事件类型和中文 UI 文案。后续用户在 Turn Inspector 里能看到沙箱能力检查、重复工具警告、exec-server 尝试和回退，而不是只能从后端 trace 文件里查。

profile parity 测试继续扩展。`packages/opencode/test/tool/turn-sandbox.test.ts` 新增 read-only profile 下 read 允许、write/edit/apply_patch 拒绝；full-access profile 下工作区外写入允许；以及 `.git` 缺失时 bash 也不能创建 `.git/config` 的 protected-create 测试。新增 `packages/opencode/test/tool/codex-exec-server.test.ts`，覆盖 exec-server 适配器环境变量序列化；真实 sidecar 测试默认跳过，需要 `AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1` 显式开启。

测试和构建结果：`bun --cwd packages/opencode test test/tool/turn-sandbox.test.ts test/tool/codex-exec-server.test.ts --timeout 30000` 通过，11 个通过、1 个 exec-server live 测试按设计跳过。`bun --cwd packages/opencode test test/session/schema-decoding.test.ts --timeout 30000` 通过，25 个通过。`node --test aialra/turn-observability/tests/*.test.js` 通过。`bun --cwd packages/opencode test test/session/prompt.test.ts --timeout 30000` 通过，65 个通过。`bun run --cwd packages/opencode typecheck` 通过。`bun run --cwd packages/app typecheck` 通过。`bun run --cwd packages/app build` 通过。`bun run --cwd packages/opencode build` 通过并完成 x64 CLI smoke。prompt 测试中几个只用于制造 running 状态的 `sleep 30` 被缩短到 `sleep 2`，忽略 TERM 的升级终止测试保留 `sleep 10`，这样测试语义不变但不会靠 30 秒自然结束兜底。

能力矩阵已更新到 `aialra/turn-observability/harness-status-and-test-playbook.md`。真实完成项包括 Linux 沙箱能力探测、bwrap protected-create、Turn Inspector 新事件中文展示、弱模型 step budget、重复工具 warning、exec-server 可选适配器和更完整的 profile parity 测试。仍未完成项包括：Codex exec-server 还不是默认全量执行器；read/write/edit/apply_patch 尚未走 Codex FS API；Landlock 只有探测/评估，未做 syscall 级 enforce；debug1 原版 OpenCode A/B 尚未部署；网络访问 profile parity 还未完成自动化；Public event/Approval UI/Turn Inspector 的产品化增强仍需继续迭代。

部署记录：本次提交 `b090ebdc7 feat(aialra): strengthen linux sandbox and loop budget` 已推送到 `origin/dev`。push 钩子执行 `bun turbo typecheck`，14 个任务全部成功。随后执行 `./aialra/opencode-deployment/scripts/build-opencode.sh`，构建版本为 `0.0.0-dev-202605190244`，Linux x64 CLI smoke 通过。重启 `aialra-opencode-web.service` 和 `aialra-opencode-login.service` 后，`aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-opencode-sensenova.service` 均为 active。执行 `systemctl daemon-reload` 后服务仍全部 active。

线上验收：`./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过，`RUN_MODEL_CALL=1 ./aialra/opencode-deployment/scripts/e2e-smoke.sh` 也通过。当前线上 fork 已部署本轮版本。部署脚本会生成 `packages/core/src/models-snapshot.js`，该文件属于构建副产物，已恢复，未进入提交。工作区剩余未提交改动只有两份本轮未触碰的 Sensenova 文件：`aialra/opencode-deployment/adapters/sensenova-openai-bridge.js` 和 `aialra/opencode-deployment/tests/sensenova-bridge.test.js`。

## 2026-05-19 解释记录：沙箱、exec-server、profile、弱模型预算的人话版

用户指出前文大量英文名词不可读，要求逐项解释。核心解释如下：bwrap 沙箱就是把 bash 命令关进一个受限制的 Linux 进程环境里，让操作系统阻止它乱写文件、乱访问目录或联网；它对 bash 是系统级硬隔离的一部分，但不是 Codex 完整 1:1，因为 Codex 还有 Rust exec-server、Linux helper、Landlock/seccomp/no_new_privs 等更底层能力，而当前 OpenCode 仍有一些文件工具走 TypeScript 里的应用层检查。Linux 沙箱探测脚本的作用是提前看服务器到底支不支持这些隔离能力，例如 bwrap 是否存在、user namespace 是否可用、`/proc` 能不能挂载；Codex 也会做类似启动检查和 warning，我们现在做的是 Node/Bun 版本的可观察探测。

Turn Inspector 是网页里的“执行过程面板”，用来让用户看到一轮请求从开始、模型、工具、审批、沙箱检查到结束到底发生了什么。`tool.sandbox.capability` 是其中一种事件，意思是“bash 沙箱启动前，这台机器的沙箱能力长什么样”。弱模型/Kimi 循环硬收口的意思是防止模型反复调用同一个工具而永远不结束；默认 80 step 指的是模型-工具循环轮数，不是 token 数，也不是单个长命令执行时间，已有 agent.steps 会优先覆盖，`AIALRA_TURN_MAX_STEPS=0` 可关闭。超限时会写一个可见错误、发 `turn.aborted`、把 session 变回可输入 idle，避免前端一直思考中。

重复工具 warning 的判定方式是工具名 + 前 500 字符输入 + 完成/错误状态连续累计到 3 次，只记录不拦截，所以不会误杀，只是让 Turn Inspector 里能看出模型可能在绕圈。这是 AIALRA 当前为诊断弱模型循环加的观测能力，不是直接照搬 Codex 原生功能。Codex exec-server 是 Codex 的独立执行服务，负责跑命令、读写文件、接沙箱和远程环境；Node/Bun executor 是 OpenCode 现有的 TypeScript/Bun 直接执行工具方式。我们新增的 TypeScript adapter 是桥，用来让 OpenCode 能和 Codex exec-server 通话，但本机 Codex exec-server WebSocket 握手当前失败，所以它只能可选启用并 fallback，不能默认替换。

profile parity 测试就是把不同权限档位逐项测清楚，例如 read-only 应该允许读但拒绝写，workspace-write 应该允许工作区内写但拒绝工作区外写，full-access 应该放开更多。Landlock 是 Linux 内核里的文件访问限制能力，意思是由内核直接拦文件读写；目前只做了“这台机器看起来支持不支持”的评估，还没有真正把文件访问交给 Landlock 拦。`read/write/edit/apply_patch` 没走 exec-server FS API 的意思是这些文件工具还没有交给 Codex 执行服务统一执行，而是先走 OpenCode 现有工具加 TurnContext 门禁；要完全 1:1，下一步必须把这些工具接到 Codex 的文件系统协议。

debug1 原版 OpenCode A/B 还没部署是事实，不应该反复拖延。当前服务器没有现成 debug1 nginx/systemd 路由，部署需要单独服务、端口、数据目录、登录/认证和模型配置隔离。下一步应把它拆成一个专门部署任务完成，而不是继续夹在沙箱改造里。Sensenova 未提交改动是工作区里本来存在的两份模型桥接相关改动，不是本轮改动；我没有提交它们，避免混入无关内容。

## 2026-05-19 实现记录：debug1 对照组、三方 A/B、Codex exec-server 源码二进制接入、Turn Inspector raw 修复

用户要求从现在开始停止零散增强，优先建立真实 A/B 对照体系，然后推进 Codex exec-server 完整接入，并修复 Turn Inspector raw 一直 loading、通知反复弹窗、页面 502/worker/CSP 等体验问题。本次实际完成如下。

debug1 原版 OpenCode 对照组已经部署。原版 anomalyco/opencode 克隆在 `/srv/aialra/apps/opencode-original`，部署包装在 `/srv/aialra/apps/opencode-original-deployment`。服务隔离如下：Web 服务 `aialra-opencode-debug1-web.service` 监听 `127.0.0.1:12801`，登录代理 `aialra-opencode-debug1-login.service` 监听 `127.0.0.1:12803`，Sensenova bridge `aialra-opencode-debug1-sensenova.service` 监听 `127.0.0.1:12802`。环境文件是 `/srv/aialra/config/secrets/opencode-debug1.env`，数据目录是 `/srv/aialra/state/opencode-debug1-home`，日志目录是 `/srv/aialra/logs/opencode-debug1/`。nginx vhost 已配置为 `debug1.aialra.online`，Let's Encrypt 证书位于 `/etc/letsencrypt/live/debug1.aialra.online/`。health smoke 结果：`https://debug1.aialra.online/health` 返回 200；本地 Basic auth API 能创建 session；模型 smoke prompt “只回复 OK” 返回 OK。

三方 A/B harness 已实现。脚本是 `aialra/turn-observability/scripts/run-ab-comparison.mjs`，固定靶场根目录 `/srv/aialra/turn-harness-target`，每次为每个目标创建独立运行目录，目标包括原版 Codex CLI、debug1 原版 OpenCode、AIALRA OpenCode fork。固定 5 个 prompt：只回复 OK；读取 README；工作区内创建文件；尝试工作区外写入；混合读写 bash 和失败恢复。记录指标包括是否卡死、是否等待审批、是否有 turn 终态、cwd、工作区外是否真的写入、工具调用次数、耗时、是否能解释过程。最新完整报告是 `aialra/turn-observability/ab-reports/ab-comparison-20260519133338.md`。

最新 A/B 结论：前三个简单场景三方都成功。第 4 个“工作区外写入”场景，Codex CLI 正确拒绝外部写入并完成，debug1 原版 OpenCode 停在审批等待且没有 turn 终态，AIALRA fork 正确拒绝外部写入并 `turn.completed`。第 5 个混合场景，Codex CLI 成功，debug1 原版 OpenCode 再次停在审批等待且没有 turn 终态，AIALRA fork 成功完成，工作区内读写和 bash 成功，外部写入被拒绝，且 public event 可解释。这个报告证明当前架构变化至少在“越界写入不挂死、能收口、能解释”这类 harness 行为上已经优于原版 OpenCode。

Codex exec-server 真实诊断已完成。本机全局安装的 `codex-cli 0.125.0-alpha.3` 可以运行 `codex exec-server --listen ws://127.0.0.1:0` 并打印监听地址，但 `/readyz` 返回空响应，Node/Bun WebSocket 客户端连接时拿不到预期 HTTP 101 升级响应。因此之前“握手失败”的真实原因不是 OpenCode adapter 随便写错，而是当前全局 codex binary 暴露出的入口和我们源码协议预期不一致。随后从 `/srv/aialra/apps/codex-turn-engine/codex-rs` 源码构建了本地 Codex binary：`/srv/aialra/apps/codex-turn-engine/codex-rs/target/debug/codex`。该源码构建版本可以 `/readyz=200`，WebSocket 能连接，`initialize` 返回 sessionId，`process/start` 能启动命令，`process/read` 能按 chunks 读取 stdout/stderr 和 exitCode。

AIALRA 主服务已切到源码构建 Codex exec-server 后端。`/srv/aialra/config/secrets/opencode.env` 已配置 `AIALRA_EXEC_BACKEND=codex` 和 `AIALRA_CODEX_EXEC_SERVER_BIN=/srv/aialra/apps/codex-turn-engine/codex-rs/target/debug/codex`。这不是仓库文件，不会提交。bash 工具现在优先使用 Codex exec-server adapter，失败时回退到现有 Node/Bun executor，并记录 fallback 事件。验证命令 `AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_EXEC_BACKEND=codex AIALRA_CODEX_EXEC_SERVER_BIN=/srv/aialra/apps/codex-turn-engine/codex-rs/target/debug/codex bun --cwd packages/opencode test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts --timeout 30000` 通过，覆盖 exec-server adapter live process 和 bwrap sandbox。

Linux bwrap 并发 protected-create race 已修。之前 A/B mixed 场景里 AIALRA fork 的 `ls -la` 曾出现 bwrap synthetic `.git` source 被并发清理导致的失败。修复方式是对 synthetic protected mount 加 ref-count/锁：多个并发 bash 共享同一 synthetic mountpoint，最后一个释放时才清理。新增测试 `keeps missing protected metadata mounts stable across concurrent bash calls`，并发跑 `pwd`、`ls -la`、`cat missing.txt || true`，验证不会再出现 `Can't get type of source`，并且 `.git/.agents/.codex` 不会遗留在工作区。最新 A/B mixed 场景已证明 AIALRA fork 的 bash `pwd`、`ls -la`、`cat` 全部成功。

Turn Inspector raw loading bug 已修。浏览器复现显示：raw endpoint 已经 200 返回，但 UI 仍停在“正在加载原始内容”。根因是 Solid store 的对象更新会合并旧对象，成功写入 `{ value }` 时没有清掉旧的 `loading: true`，所以 `Switch` 一直命中 loading 分支。现在成功路径写入 `{ loading: false, error: undefined, value }`，失败路径写入 `{ loading: false, error }`。Playwright 复测：新 session 打开回合检查器，点击“原始”，raw response 200，UI 显示 `prompt.received` JSON，`loading=false`。

Turn Inspector 历史 turn 折叠已实现。新 turn 默认展开，旧 turn 默认折叠，显示“已折叠历史回合日志。点击展开查看 N 条事件。”用户可手动展开旧回合。Playwright 复测：同一 session 连续发两轮后，Inspector 里有 2 个 turn section，并出现历史折叠提示。

通知反复弹窗已做第一批前端去重。`packages/app/src/context/notification.tsx` 对 session idle/error 终态通知按 directory/session/timestamp/error 去重，且当前正在看的 session 不触发系统通知。`packages/app/src/pages/layout.tsx` 对 permission/question 弹窗按 directory/type/session/request id 去重，避免同一审批请求被反复系统弹窗轰炸。

页面零散错误已验证。公网 `https://opencode.aialra.online` 通过 Playwright 登录，首页加载成功，控制台没有 warning/error/requestfailed。内网 `http://127.0.0.1:12601` 打开 session 页面也无控制台错误。`/provider` 和 `/project` 本地 smoke 均返回 200。此前 Cloudflare beacon、site.webmanifest、worker-src 等 CSP/manifest 修复仍有效。

测试和构建记录：`node --test aialra/turn-observability/tests/*.test.js` 通过；`bun --cwd packages/app typecheck` 通过；`bun run --cwd packages/opencode typecheck` 通过；`bun --cwd packages/app build` 通过；`bun run --cwd packages/opencode build --single` 通过并完成 Linux x64 CLI smoke。exec-server + sandbox live 测试通过。`git diff --check` 通过。`bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000` 在完整大套件里仍有 shell 取消/并发相关单个用例偶发 30 秒超时；单独重跑失败用例通过，`bun --cwd packages/opencode test test/session/prompt.test.ts -t "shell" --timeout 30000` 15 个 shell 相关用例全部通过。这说明逻辑路径可收口，但完整大套件在当前机器上还有 shell 取消类 flake，不能把它说成 30 秒全绿。

当前仍未完成并且不能冒充完成：`read/write/edit/apply_patch` 还没有走 Codex exec-server FS API；Landlock 仍只是能力评估，没有内核级 enforce；exec-server 还没有独立 systemd sidecar 化；network profile parity、approval never/on-request 的全矩阵还没有全部自动化；Turn Inspector 还没有虚拟列表，超长历史会话后还需要进一步优化。

## 2026-05-19 实现记录：exec-server FS、systemd sidecar、profile parity、测试 flake 收口

用户要求继续端到端推进，优先修复 `prompt.test.ts` / `schema-decoding` 全量 30 秒测试中的 shell 取消/并发 flake，然后把 read/write/edit/apply_patch 接入 Codex exec-server FS API，把 exec-server 推进成稳定 sidecar，深化 Linux sandbox，补 profile parity，继续 Kimi/弱模型诊断，跑 A/B，并修复页面报错。

测试 flake 先处理。完整套件之前的卡住点不是 Codex exec-server fallback，也不是 session idle 收尾坏掉，而是测试在取消 shell 或断言 retry/stream/tool trace 时等待条件太粗，偶发在 shell tool 尚未真正进入 running 状态时就取消，或在 trace 尚未 flush 到目标 phase 时就读取。现在 `prompt.test.ts` 增加 `waitForRunningTool` 和 `waitForTracePhase`，取消/并发类测试先等真实 running tool 出现，retry/idle/tool 场景先等 `turn.completed` 或 `processor.halted`。验收结果：`bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000` 全量通过，90 pass，0 fail。

Codex exec-server FS API 已接入文件工具。新增 `packages/opencode/src/tool/codex-fs.ts`，在 `AIALRA_EXEC_BACKEND=codex` 且工具上下文里有 TurnContext 时，文件内容读取/写入/删除优先走 Codex exec-server：`fs/readFile`、`fs/writeFile`、`fs/createDirectory`、`fs/remove`。OpenCode 的 TurnContext 门禁仍然先执行，所以 cwd、permission profile、sandbox policy、approval policy 不会丢。exec-server 连接失败、sidecar 不可用等传输级问题会发 `exec_server.fallback`，再回退到现有 Node/Bun 文件系统；但 Codex RPC 明确拒绝的 sandbox 错误不会静默 fallback。`read.ts`、`write.ts`、`edit.ts`、`apply_patch.ts` 已改用这个通道。

exec-server sidecar 已产品化第一版。新增系统服务 `aialra-codex-exec-server.service`，监听 `ws://127.0.0.1:12650`，日志路径 `/srv/aialra/logs/codex-exec-server/service.log`，当前为 enabled + active。`curl http://127.0.0.1:12650/readyz` 通过。AIALRA OpenCode 的环境配置增加 `AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650`，因此默认连接长期运行的 sidecar，而不是每个工具调用临时托管一个进程。这个环境文件在仓库外，不会提交。

Turn Inspector 可见性也跟上。`exec_server.fs.started` 和 `exec_server.fs.finished` 会映射为 public event 的 `executor.started` / `executor.finished`，UI 中文摘要会说明是 `fs/readFile`、`fs/writeFile`、`fs/createDirectory` 还是 `fs/remove`，并显示路径摘要和耗时。这样用户能看见“文件工具确实走了 Codex exec-server”，而不是只能相信后端改了。

Linux sandbox 探测进一步落地。`probe-linux-sandbox.mjs` 不再只按内核版本猜 Landlock，而是读取 `/boot/config-6.8.0-106-generic`，确认 `CONFIG_SECURITY_LANDLOCK=y`，LSM 顺序包含 `landlock,lockdown,yama,integrity,apparmor`。脚本还真实运行 Codex Linux sandbox workspace 写入探测：在 `/srv/aialra/tmp/.../workspace` 内写入成功，尝试写同级 workspace 外文件失败，stderr 为只读文件系统，`enforcedWorkspaceWrite=true`。这说明当前主机上 Codex Linux sandbox helper 路线能硬挡工作区外写入；但 Node/Bun 工具层本身仍没有直接调用 Landlock syscall，所以不能说 Landlock 已在 OpenCode 工具层 1:1 enforce。

profile parity 继续扩展。`turn-sandbox.test.ts` 新增 disabled profile 外部写允许、external profile 仍遵守 workspace sandbox 边界、bash 网络 restricted 时 bwrap args 包含 `--unshare-net`、网络 enabled 时不包含 `--unshare-net`。连同原有 read-only、workspace-write、full-access、symlink escape、protected metadata、bwrap workspace 测试，当前 live 命令 `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun --cwd packages/opencode test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts --timeout 30000` 通过，19 pass。

A/B harness 已扩展。原来默认 5 个强约束 prompt；现在默认 7 个，新增一个口语化真实任务和一个情绪化越界恢复任务。报告生成逻辑也升级：每个场景会自动写“本场最佳是谁、为什么”，整体结论会按完成、不卡死、不等待审批、有 turn 终态、越界写入被拒绝、过程可解释等指标打分。部署本批代码后会重新跑三方 A/B，生成新的 `ab-comparison-*.md`。

页面零散错误修复新增一项：stale PTY 404。之前如果终端 session 已经被后端删除，前端还会继续请求 connect-token 和 WebSocket，控制台反复出现 404 / Session not found。现在 `terminal.tsx` 遇到 404 会抛出可识别的“terminal session not found”，`terminal.tsx` context 会把这个 stale PTY 从本地列表移除，并避免重复报错。`tabs:outgoing.message.ready` 在当前源码中没有对应 listener 字符串，后续浏览器 smoke 需要继续确认它是否来自浏览器扩展或外部注入脚本。

当前真实边界：目录列举还没有接 Codex `fs/readDirectory`；Codex remote environment、HTTP API、实时 stdout/stderr seq 分片 UI 还没完成；Landlock 还没有在 Node/Bun 工具层 syscall enforce；approval reviewer 语义还没做到 Codex 1:1；Turn Inspector 超长历史还没有虚拟列表。

## 2026-05-19 追加修复记录：审批通知去重和 stale PTY 清理

用户反馈浏览器仍然能看到 `tabs:outgoing.message.ready`、`/lsp` 或 `/session/.../message` 502、旧 `/pty/...` 404，以及审批弹窗仍有重复。排查结论如下：`tabs:outgoing.message.ready` 在当前仓库源码中没有任何匹配，更像浏览器扩展或外部注入脚本事件，不能在 OpenCode 源码里直接修。`/lsp`、`/session/.../message` 的 502 更像部署重启或上游瞬时不可用，因为当前 `aialra-opencode-web.service` active，部署后认证 API smoke 曾显示相关接口 200；如果它继续复现，需要按具体时间查 Cloudflare/nginx/login-proxy/web 四层日志。`/pty/...` 404 的根因更明确：前端会持久化终端标签页，服务重启后旧 PTY 编号已经不存在，但页面还继续按旧编号连接。

本次代码修复两点。第一，`packages/app/src/pages/layout.tsx` 里 permission/question 通知现在先判断当前会话是否正在打开；如果用户就在当前会话，不再播放声音、不再发系统通知、不再弹 toast。它还会对同一 session 已经有待处理弹窗的情况直接跳过，并用 directory/type/session/permission/path/tool 生成短期 fingerprint，避免后端重复发等价审批事件时前端跟着重复轰炸。第二，`packages/app/src/context/terminal.tsx` 现在在终端状态加载完成后调用 `pty.list`，把本地持久化但后端已经不存在的 PTY id 清掉，从源头减少 `/pty/.../connect-token` 和 WebSocket 的 404 噪音。

验证结果：`packages/app` 的 `bun run typecheck` 通过；`packages/app` 的 `bun run build` 通过。构建只出现既有 Vite chunk/动态导入警告，没有新增类型错误或构建错误。本次修复还没有改变后端权限语义，只是前端体验和 stale terminal 状态清理。

部署结果：提交 `89863ed16 fix(aialra): dedupe approval notifications and stale terminals` 已推送到 `origin/dev`，push 钩子 `bun turbo typecheck` 通过，14 个 typecheck 任务成功。执行 `./aialra/opencode-deployment/scripts/build-opencode.sh` 后生成版本 `0.0.0-dev-202605191607`，Linux x64 CLI smoke 通过。重启 `aialra-opencode-web.service` 和 `aialra-opencode-login.service` 后，`aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-codex-exec-server.service` 均为 active。执行 `./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过。

## 2026-05-19 追加实现记录：外部路径审批收口、线上部署、A/B 复跑

本轮在第一次 A/B 复跑里发现一个真实缺口：AIALRA 已经把工作区外写入挡住了，文件也没有被创建，但模型随后为了确认文件不存在，调用 `read` 读取了同一个工作区外路径。OpenCode 旧逻辑把“工作区外读取”当成 `external_directory` 审批，于是脚本看到等待审批并中断。这不是安全破口，而是 Codex 化 turn harness 和 OpenCode legacy permission 之间的重复门禁。

修复方式：当工具上下文里已经有 TurnContext 时，外部路径是否允许由本轮 TurnContext sandbox 决定，不再额外弹 OpenCode legacy `external_directory` 审批。结果是：工作区外写入仍然按 workspace-write 被拒绝；工作区外只读确认可以继续完成，从而让这轮请求正常给用户解释“写入被拒绝，文件不存在”，而不是卡在审批。无 TurnContext 的旧调用路径仍保留原 external-directory 行为。

新增验证：`test/tool/external-directory.test.ts` 增加两项测试，确认 TurnContext 下可读外部路径不再弹审批、外部写入仍由 sandbox 拒绝且不弹审批。完整相关命令 `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun --cwd packages/opencode test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000` 通过，26 pass。`bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000` 通过，90 pass，0 fail。`node --test aialra/turn-observability/tests/*.test.js` 通过。`bun run --cwd packages/opencode typecheck`、`bun run --cwd packages/app typecheck`、`bun --cwd packages/app build`、`bun run --cwd packages/opencode build --single` 均通过。

部署记录：执行 `./aialra/opencode-deployment/scripts/build-opencode.sh`，构建版本 `0.0.0-dev-202605191525`，Linux x64 CLI smoke 通过。重启 `aialra-opencode-web.service` 和 `aialra-opencode-login.service` 后，`aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-opencode-sensenova.service`、`aialra-codex-exec-server.service` 均为 active。`./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过。页面 502 对应的本地认证 API `/config`、`/question`、`/project/current`、`/command`、`/session/status`、`/provider`、`/lsp` 均返回 200。Playwright CLI wrapper 本机 `open` 阶段这次卡住，已清理卡住进程；因此本次最终浏览器证据不把 wrapper 结果伪装成通过，只记录 API 和部署 smoke 结果。

三方 A/B 已重跑，最新报告为 `aialra/turn-observability/ab-reports/ab-comparison-20260519153559.md`。结果：Codex CLI 7/7 成功，AIALRA OpenCode fork 7/7 成功，debug1 原版 OpenCode 4/7 成功。AIALRA 在 7 个场景中 0 卡死、0 等待审批、0 越界写入、7/7 turn 终态、7/7 可解释；第 4 个越界写入、第 5 个混合任务、第 7 个情绪化越界恢复任务均不再等待审批。debug1 原版 OpenCode 在这三个场景仍停在审批等待且缺少 turn 终态。Codex CLI 和 AIALRA 在这组行为指标上同分；真实差距仍是 AIALRA 未接 `fs/readDirectory`、remote environment、完整 Codex item lifecycle、Node/Bun 层 Landlock syscall、approval reviewer 1:1 语义和超长 Inspector 虚拟列表。

## 2026-05-19 实现记录：Sandbox Control Center、会话安全开关、fs/readDirectory、Inspector 产品化推进

用户要求继续端到端推进 OpenCode Turn Harness，并强调本轮不是零散增强，而是把沙盒、权限、网络、审批、执行器和可观测性做成用户可切换、可审批、可审计、可对比的产品能力。本轮先做设计再实现，并把 `codexapp.aialra.online` 作为网页端 Codex 行为参考之一，但最终验收仍以本仓库测试、线上 smoke 和 A/B 报告为准。

本轮新增 `SessionSecurity`，会话安全配置。它保存当前 session 的 `permission_profile`（权限档位）、`approval_policy`（审批策略）、`network access`（网络访问）、`exec backend`（执行后端）和 `environment`（执行环境）。新增 API：`GET /session/:sessionID/security` 用来读取当前安全配置，`PATCH /session/:sessionID/security` 用来修改配置。每次修改都会进入 public event stream，公共事件流，例如 `sandbox.profile.changed`、`sandbox.network.changed`、`approval.policy.changed`、`executor.backend.changed`、`environment.selected`，并带上从什么值变到什么值、当前 cwd、作用范围和 actor。

这些开关不是前端假状态。新的 prompt 创建 `UserTurn` / `TurnContext` 时会读取 `SessionSecurity`，所以后续回合会按用户设置生成权限、沙箱、网络和审批策略。运行中的工具门禁也会读取这份配置：`TurnSandbox` 会在路径解析、文件读写检查、bash 沙箱构建时套用用户保存过的 session 安全配置；Codex exec-server 的 sandbox context 也会使用同一份配置。一个重要修复是：仅查询执行器偏好不能创建默认安全配置，否则会把单测或显式回合里的 read-only/full-access 覆盖成 workspace 默认值。这个问题已经通过 live exec-server 回归修复。

Turn Inspector 里新增 Sandbox Control Center，沙盒控制中心。用户现在能在右侧面板顶部看到当前目录、网络状态、执行器状态，并切换权限档位：只读、工作区可写、完全访问、外部管理、关闭内置权限；也能切换审批策略：从不审批、工具请求时审批、失败后允许审批、非信任操作先审批；还能开关 bash 网络访问，查看本地 default environment（默认环境）和 remote environment（远程环境）未支持状态。执行后端也能在 UI 中切换为 Codex exec-server 或 Node/Bun fallback。切换会触发安全审计事件。

Codex exec-server FS API 补齐了目录列举。之前 read/write/edit/apply_patch 的文件内容读写已经走 `fs/readFile`、`fs/writeFile`、`fs/createDirectory`、`fs/remove`；本轮新增 `fs/readDirectory`，read 工具读目录时也会优先通过 Codex exec-server 受控文件系统通道，失败时按既有 fallback 规则回退并记录事件。Codex RPC 明确拒绝的 sandbox 错误仍不会静默 fallback，避免绕过沙箱。

Turn Inspector 产品化继续推进。筛选项从“全部、错误、工具、文件、命令、审批”扩展到“全部、错误、模型、工具、文件、命令、审批、沙箱、网络、执行器”。新增中文事件标题和中文摘要，包括安全配置变更、网络变更、执行器 fallback、sandbox capability、sandbox denied 等。面板保留新 turn 自动展开、历史 turn 自动折叠；raw 展开状态不会被新日志刷掉；当用户停在底部时会自动滚到底，手动上翻时不抢滚动，并新增“跳到最新”按钮。

Linux sandbox 本轮重新探测。结果：当前平台是 Linux，kernel `6.8.0-106-generic`，Landlock 从内核配置和 LSM 顺序看可用；bwrap 路径 `/usr/bin/bwrap`，版本 `0.9.0`，user namespace 可用；容器不允许 bwrap 挂载 `/proc`，所以运行时仍需要跳过 `--proc /proc`；源码构建 Codex binary 的 Linux sandbox helper 真实写入探测仍能做到工作区内写入成功、工作区外写入失败。真实边界仍是：Node/Bun 工具层没有直接调用 Landlock syscall，因此不能说已经做到 Codex Linux sandbox 的 syscall 级 1:1。

A/B harness 已从 7 个 prompt 扩展到 9 个 prompt，新增网络访问场景和弱模型循环风险场景。网络场景要求模型尝试 `curl -I https://example.com --max-time 5` 并写入 `network-check.md`，用于观察默认网络关闭时是否可解释失败；循环风险场景要求最多试一次工作区外写入，防止弱模型反复尝试同一被拒绝操作。

验证记录：`bun run --cwd packages/opencode typecheck` 通过；`bun run --cwd packages/app typecheck` 通过；`bun --cwd packages/opencode test test/server/httpapi-public-event.test.ts --timeout 30000` 通过，4 pass；普通 Node/Bun 工具路径下 `bun --cwd packages/opencode test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000` 通过，24 pass、3 skip；live Codex sidecar 路径下 `AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun --cwd packages/opencode test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000` 通过，27 pass。

当前仍未完成并且不能冒充完成：remote environment（远程环境）仍是 disabled/unsupported 状态，没有远程执行；glob/grep 是否有 Codex exec-server 对应 API 仍需继续源码确认，当前仍在 TurnContext 门禁之后使用 Node/Bun 实现；approval reviewer（审批人语义）还没有 1:1 对齐 Codex；Turn Inspector 仍是折叠和 1000 条 replay buffer，不是真正虚拟列表；Landlock 没有在 Node/Bun 工具层 syscall enforce；网络开关已经影响 bash/bwrap，但网络 profile parity 还需要真实 curl/ping/npm 场景自动化矩阵继续补齐。

本轮补充验收和部署结果：三方 A/B 已按 9 个 prompt 复跑，最新报告为 `aialra/turn-observability/ab-reports/ab-comparison-20260519201455.md`。结果是 Codex CLI 9/9 成功，AIALRA OpenCode fork 9/9 成功，debug1 原版 OpenCode 5/9 成功。AIALRA 在这组行为场景里 0 卡死、0 等待审批、0 越界写入、9/9 turn 终态、9/9 可解释；原版 OpenCode 主要输在越界写入、审批等待和缺终态。网络关闭场景里 AIALRA 和 Codex 都能解释网络不可用，debug1 原版 OpenCode 默认网络可用，说明 AIALRA 的网络默认安全策略已经和原版 OpenCode 拉开差异。

完整验证命令已跑完：`bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000` 通过，90 pass；`node --test aialra/turn-observability/tests/*.test.js` 通过；普通 Node/Bun 路径下工具测试 24 pass、3 skip；live Codex sidecar 路径下工具测试 27 pass；`bun run --cwd packages/opencode typecheck`、`bun run --cwd packages/app typecheck`、`bun --cwd packages/app build`、`bun run --cwd packages/opencode build --single` 均通过。部署脚本 `./aialra/opencode-deployment/scripts/build-opencode.sh` 生成线上版本 `0.0.0-dev-202605192026`，Linux x64 CLI smoke 通过。重启 `aialra-opencode-web.service` 和 `aialra-opencode-login.service` 后，Web、login、Codex exec-server 三个服务均为 active。`./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过。认证 API smoke 显示 `/config`、`/question`、`/project/current`、`/command`、`/session/status`、`/provider`、`/lsp`、`/session/:id/message` 和 `/session/:id/security` 均返回 200。

浏览器级 Playwright smoke 这次仍不能作为通过证据：`playwright_cli.sh` 文件本身没有执行位，改用 `bash playwright_cli.sh open https://opencode.aialra.online` 后命令长时间无输出并被手动清理。因此最终线上验收采用部署 smoke、API smoke、A/B report 和构建测试结果，不把浏览器 wrapper 卡住伪装成浏览器通过。下一步若要把浏览器 smoke 固化，应该修复本机 Playwright CLI wrapper 的可执行权限和 daemon 启动稳定性，或者改为仓库内固定 Playwright 测试脚本。
## 2026-05-19 实现记录：真实工程 A/B 评测和独立沙盒控制中心

用户要求停止 toy A/B prompt，把对比体系升级成 SWE-bench 风格真实工程任务，同时把 Sandbox Control Center（沙盒控制中心）从 Turn Inspector（回合检查器）里拆出去，做成独立、中文、下拉框式、能真实影响后续 TurnContext 的产品能力。

本轮先修复开发环境权限。当前仓库和靶场目录被之前的 root 进程写成 `root:root`，本轮工具用户是 `aialra`，导致 `apply_patch` 和 A/B run 目录创建失败。已用本机已有容器镜像只调整 ownership：`/srv/aialra/apps/opencode-turn-engine` 和 `/srv/aialra/turn-harness-target` 改回 `aialra:aialra`。这不改代码内容，但恢复后续开发和评测写入能力。

Sandbox Control Center 已拆成独立面板。新文件是 `packages/app/src/pages/session/sandbox-control-center.tsx`，入口按钮放在回合检查器按钮右侧。Turn Inspector 现在只显示公共事件流；沙盒控制中心负责改规则。UI 已改成中文下拉框，不再使用混乱按钮堆，不再把英文术语裸露给用户。控制项包括权限档位、审批策略、文件访问范围说明、网络访问、命令执行、执行后端、本轮覆盖入口和审计说明。高级底层细节折叠显示，不再默认把 Landlock、bwrap、Node/Bun 等底层词堆给普通用户。

这些控制项不是纯展示。面板仍调用 `GET/PATCH /session/:sessionID/security`，后端 `SessionSecurity` 会把配置套到下一轮 `UserTurn/TurnContext`，工具门禁继续从 TurnContext 读取 cwd、permission profile、approval policy、sandbox policy、network access 和 executor backend。也就是说，用户切到只读后，下一轮写文件会被拒绝；用户开网络后，bash/bwrap 会按网络开关调整。

安全审计补齐了统一事件。之前只有 `sandbox.profile.changed`、`sandbox.network.changed`、`approval.policy.changed` 这类分散事件；现在每次控制中心 PATCH 还会写一条 `sandbox.control.changed`，raw payload 记录 before、after、changedBy、time、cwd 和作用范围。Turn Inspector 中文摘要也增加了这个事件，用户能看到“用户在沙盒控制中心修改了后续回合的执行规则”。

A/B harness 已升级为分层评测。`aialra/turn-observability/scripts/run-ab-comparison.mjs` 默认不再把 toy prompt 当主成绩。smoke 任务仍保留，用来判断服务是否活着；主评测新增 8 个 SWE-style 本地小仓库，每个都有失败测试、真实代码、口语化 prompt，并且 prompt 不告诉文件名、函数名或命令。覆盖：日期边界回归、空输入异常处理、解析器转义、缓存刷新、CLI 参数覆盖、子目录 cwd 路径、最小回归测试、弱模型循环风险。脚本会为 Codex CLI、debug1 原版 OpenCode、AIALRA fork 分别创建独立仓库，运行后再执行 `node --test`、收集 git diff、改动文件数、patch 大小、测试输出、耗时、工具调用和 turn 终态。

报告也升级了。新的 Markdown 报告会标注 case 类型、口语化提示词、三方是否完成、SWE-style 测试是否通过、patch 大小、工作区外写入是否发生、是否卡死、是否等待审批、是否有 turn 终态、是否可解释。整体评分会把“测试通过”和“合理 patch”放进主分，不再只看有没有回一句话。

当前真实边界必须说明清楚：这批 SWE-style fixtures 是本地可控的 SWE-bench 风格任务，还不是直接从官方 SWE-bench Lite/Verified 数据集导入。这样做的原因是三方线上对照需要短、稳定、无外部依赖的本地仓库；下一步要补的是官方样本导入器，而不是继续扩大 toy prompt。沙盒控制中心里“只对本轮生效”和“设为默认”目前还没有完整后端默认档案表；网络下拉框底层仍按开/关执行，还没有 HTTPS 白名单和逐次网络审批；Landlock 没有 Node/Bun 工具层 syscall enforce；approval reviewer 仍未 Codex 1:1；glob/grep 仍需继续接 exec-server 或受控 adapter；Turn Inspector 仍未做虚拟列表。

补充修复了一个真实 Linux 容器坑：工具测试暴露出当前环境里 `/usr/bin/bwrap` 存在，但 user namespace 会报 `setting up uid map: Permission denied`，network namespace 会报 `loopback: Failed RTM_NEWADDR: Operation not permitted`。之前只按“bwrap 存在”判断，会错误添加 `--unshare-net` 或直接启动不可用的 bwrap，导致普通 bash 也失败。现在 `linux-sandbox-capability.ts` 单独探测 user namespace 和 network namespace；network namespace 不可用时不再让普通 bash 全挂，而是在事件里记录网络沙箱降级为 `restricted-unenforced`。这不是完整网络隔离，硬隔离仍需要 Codex helper / seccomp / namespace 能力真的可用。

本轮验证：`node --check aialra/turn-observability/scripts/run-ab-comparison.mjs` 通过；`AIALRA_AB_CASE_LIMIT=0 AIALRA_AB_REPORT_DIR=/tmp/aialra-ab-check node aialra/turn-observability/scripts/run-ab-comparison.mjs` 通过，说明脚本能初始化并写报告；`bun --cwd packages/app typecheck` 通过；`bun --cwd packages/opencode typecheck` 通过；`bun --cwd packages/opencode test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000` 通过，24 pass、3 skip；`bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000` 通过，90 pass；`bun --cwd packages/app build` 通过；`bun --cwd packages/opencode build --single` 通过，Linux x64 smoke 版本 `0.0.0-dev-202605192152`。尚未把完整三方 SWE-style A/B 全跑完和部署上线，不能把这一部分说成线上完成。

## 2026-05-29 实现记录：upstream 同步、502 收口、步骤预算可选、审批按钮重做

用户反馈线上页面仍会短暂出现 Cloudflare 502 HTML 大页，弱模型 80 step 默认硬停误伤长任务，审批按钮含义不清，沙盒控制中心切换体感不明显，A/B 报告缺少打分和完整 prompt，并要求同步 OpenCode 官方最新版本。

本轮先同步官方 upstream。已 fetch `anomalyco/opencode` 的最新 `dev`，并合并到本地 `dev`，最新官方提交包含 ACP 正式化和 stats 修复。冲突风险文件没有盲目覆盖 AIALRA turn harness，而是保留 TurnContext、exec-server、Sandbox Control Center、public event 和工具门禁语义。

502 收口做了两层。login proxy 现在遇到上游 socket reset、连接失败或超时，会对 GET/HEAD/OPTIONS 重试一次，最终失败时返回短 JSON 或短文本 503，并加 `x-aialra-proxy-error=upstream_unavailable`，不再把大段 HTML 错误页直接给前端。SDK error interceptor 也会识别 HTML 错误页，把它压成一行“OpenCode 服务暂时不可用”的错误，同时只在 cause 里保留短截断内容。

步骤预算已从默认 80 改成默认关闭。现在默认无限执行，除非 agent 自己设置了 `steps`、环境变量 `AIALRA_TURN_MAX_STEPS` 显式设置，或者用户在沙盒控制中心开启“限制模型工具循环”。沙盒控制中心新增最大工具步数输入框，修改会写入 `turn.step_budget.changed`，下一次工具门禁会读取最新 TurnContext。

审批 UI 已改成六个短按钮：拒绝、仅本次、本轮本命令、本轮全部、始终本命令、始终全部。完整含义放在 tooltip 里。当前 turn 的“本轮本命令”和“本轮全部”由前端记忆并自动回复后续同 turn 审批，不会改写文件沙箱或网络沙箱。“始终全部”仍只是自动处理审批，不等于绕过 Sandbox Control Center。

Sandbox Control Center 文案和交互已清理。标题下面不再重复显示当前目录，因为文件访问范围里已有 cwd。没有交互的审计和高级详情模块已移除。原来的“本轮覆盖”改成“生效范围与步骤上限”，明确降低权限会影响正在运行回合的下一次工具门禁，提高权限会进入审计并影响后续工具门禁，已经发出去的模型请求不会被中途改写。`disabled` 改成“关闭内置门禁”，避免用户误以为是“禁用工具”。

Turn Inspector 历史回合现在直接折叠，不再显示“已折叠历史回合日志”提示框。新增 `turn.step_budget.changed` 中文标题和摘要。

A/B 报告脚本增加评分规则、单场分数、总分和完整提示词代码块。后续每份报告不仅说是否完成，还会写清楚 prompt、评分、耗时、工具调用数、turn 终态、是否等待审批、是否越界写入和谁最好。

Kimi 调查已写入 `aialra/turn-observability/kimi-performance-investigation-2026-05-29.md`。当前能确认的是 Kimi 走 Anthropic 兼容路径，DeepSeek 走 OpenAI compatible 路径，并且 Kimi 部署配置之前缺少显式 `timeout/chunkTimeout`。本轮已给 Kimi provider 补上 `timeout=600000` 和 `chunkTimeout=60000`。这不是加速器，但能避免慢流更像无限卡死。真正速度差异需要下一步记录 first-token time、stream duration、retry count 和 context size。

快速验证已完成：`node --test aialra/opencode-deployment/tests/login-proxy.test.js` 6 pass；`bun --cwd packages/app typecheck` 通过；`bun --cwd packages/opencode test test/server/httpapi-public-event.test.ts test/tool/turn-sandbox.test.ts --timeout 30000` 21 pass。后续还需要跑完整 prompt/schema、exec-server live、build、A/B、部署 smoke、密钥扫描、commit 和 push。

## 2026-05-29 追加实现记录：完整测试、A/B 硬超时、15 场对比报告

本轮把上游合并后的类型错位和测试卡点收掉。具体修复包括：OpenAI Responses 协议的 tool-result content 类型收窄、LLM 流事件从旧 `finish-step/start/finishReason` 对齐到新 `step-finish/step-start/reason`、prompt test 补 RepositoryCache layer、权限规则数组从 readonly 克隆成可写数组、默认模型 lookup 的错误改成内部 defect 收口，避免污染 prompt 公共错误类型。

完整验证已跑完：`bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000` 90 pass；`node --test aialra/turn-observability/tests/*.test.js` 1 pass；`AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun --cwd packages/opencode test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000` 28 pass；`bun --cwd packages/opencode test test/server/httpapi-public-event.test.ts --timeout 30000` 4 pass；`node --test aialra/opencode-deployment/tests/login-proxy.test.js` 6 pass；`bun --cwd packages/opencode typecheck`、`bun --cwd packages/app typecheck`、`bun --cwd packages/app build`、`bun --cwd packages/opencode build --single` 均通过，线上构建版本为 `0.0.0-dev-202605292138`。

第一次重跑 A/B 时发现 runner 自己有真实缺陷：`codex exec` 的底层子进程可能在 SIGTERM 后继续存活，导致整个 A/B 卡在第 10 个 CLI override 场景。已修复 `runCommand`，子进程现在用独立进程组启动，超时先 SIGTERM，5 秒后 SIGKILL，报告会记录 `timedOut`，不会把 A/B runner 卡死。

修复后完整跑完 15 场三方 A/B，报告为 `aialra/turn-observability/ab-reports/ab-comparison-20260529211021.md`。总分：AIALRA OpenCode fork 301，原版 Codex CLI 292，debug1 原版 OpenCode 289。AIALRA 13/15 成功、8 个 SWE-style 测试通过、0 卡死/超时、0 越界写入、15/15 turn 终态、15/15 可解释。真实未完成也很明确：AIALRA 在自然语言沙箱场景和网络场景仍停在审批等待，说明 approval reviewer 和网络审批产品语义还没有完全收口，不能说已经达到 Codex 完整体。

## 2026-05-30 实现记录：默认审批策略、V2 顶栏按钮和沙盒控制中心样式

用户反馈新版页面最上方工具栏按钮变少、左侧项目框入口消失、沙盒控制中心视觉过灰、默认权限策略不符合预期，并要求解释为什么自然语言沙箱和网络任务会停在审批等待

本轮先定位 UI 根因，官方 upstream 的新布局分支 `newLayoutDesigns` 会走 V2 titlebar，AIALRA 之前新增的文件树、Turn Inspector、Sandbox Control Center 按钮只挂在旧布局 fallback 分支里，所以打开新版布局后会看起来“按钮没了”，这不是左侧项目框被删除，而是新版顶栏没有暴露对应开关，现在 V2 顶栏也补回左侧项目栏开关、终端、文件树、回合检查器和沙盒控制中心按钮

沙盒控制中心 UI 已从多层灰色卡片改成更接近 OpenCode 侧栏的分隔区块，外层仍跟文件树和 Turn Inspector 一样使用右侧面板背景，内部减少大面积灰色块，select 和输入框保持紧凑，标题下面仍不重复显示当前目录，目录只在“文件访问范围”里显示

默认安全策略已按用户要求调整为：工作区可写、需要时询问、网络每次询问、命令每次询问、步骤上限关闭、优先 Codex 执行服务，后端新增 `networkPolicy` 和 `commandPolicy`，不再只是用 `networkAccess` 一个布尔值假装表达所有状态

“命令每次询问”现在是真后端行为，`commandPolicy=ask` 时，bash 工具在执行任何命令前都会发 bash 审批，即使是 `pwd` 这种普通命令也会先问，已有测试证明 `pwd` 会产生 `reason=command_policy` 的审批请求

“网络每次询问”也开始变成真实行为，bash 工具会识别常见网络命令，例如 `curl`、`wget`、`ping`、`npm install`、`git clone`、`pip install` 等，`networkPolicy=ask` 时，这类命令会先发 `network` 审批，用户批准后，只给这一次命令打开网络，不永久修改整个 session 网络开关，已有测试证明 `curl --version || true` 会产生 `reason=network_policy` 的审批请求

这也解释了为什么上一份 A/B 报告里自然语言沙箱任务和网络任务会停在审批等待：AIALRA 的安全门禁已经能挡住危险操作，但默认策略偏“人工监督”，模型遇到外部写入、网络命令或不确定命令时会选择问用户，非交互 A/B 没有人点审批，所以脚本记录为等待审批，安全没有破口，但产品语义还要继续收口：在 benchmark 场景里应显式设置自动拒绝或预审批策略，在真实产品里应让用户清楚看到“这是需要你批准的动作”

审批审计也修了一处真实问题，`Permission.ask` 之前收到 turnID、approval policy、permission profile、sandbox policy 后，在写入 bus payload 时没有保留这些字段，现在 approval 请求进入公共事件流时会保留这些上下文，Turn Inspector 能更准确地把审批挂到对应回合和工具调用下

验证结果：`bun --cwd packages/opencode test test/tool/shell.test.ts test/tool/turn-sandbox.test.ts test/server/httpapi-public-event.test.ts --timeout 30000` 46 pass；`bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000` 90 pass；`bun --cwd packages/opencode typecheck` 通过；`bun --cwd packages/app typecheck` 通过，触碰的 UI/后端文件已扫描中文句号，没有新增中文句号字符

追加验证和部署：`node --test aialra/turn-observability/tests/*.test.js` 通过；`AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun --cwd packages/opencode test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000` 28 pass；`bun --cwd packages/app build` 通过；`bun --cwd packages/opencode build --single` 通过；`./aialra/opencode-deployment/scripts/build-opencode.sh` 部署版本 `0.0.0-dev-202605292231`；`aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-codex-exec-server.service` 均为 active；`./aialra/opencode-deployment/scripts/e2e-smoke.sh` 11 pass；本地认证 API smoke 确认 `/config`、`/question`、`/project/current`、`/command`、`/session/status`、`/provider`、`/lsp`、`/session/:id/message`、`/session/:id/security` 均为 200；`git diff --check` 通过；增量密钥扫描没有命中

浏览器验收诚实记录：本机 `playwright_cli.sh` 缺少执行位，改用 `bash playwright_cli.sh` 后 `npx playwright-cli` 长时间无输出，已清理卡住进程，所以本轮没有把浏览器点击验收说成通过，UI 层以源码修复、构建通过、线上部署和用户刷新实测为准，后续应补稳定浏览器 runner

三方 A/B 诚实记录：本轮没有完整重跑 15 场三方 A/B，因为新默认策略是命令每次询问、网络每次询问，非交互 runner 遇到 bash 或网络会按设计停在审批等待，下一步必须先给 A/B harness 加安全策略档案，区分真实用户默认安全模式和无人工 benchmark 模式

## 2026-05-30 追加实现记录：TurnContext shell 门禁收口、A/B 定向复跑、线上部署

用户要求继续执行直到完全完成，并指出另一个子对话误启动了 A/B 测试

本轮先处理上一份完整 15 场 A/B 报告里的真实缺口：AIALRA 在 `14-sandbox-natural` 和 `15-network-natural` 两场里会停在“等待审批”

根因不是文件越权，也不是 turn 没有终态，而是模型发起 bash 工具调用时，虽然已经有 TurnContext，回合上下文，但 shell 工具仍会额外走 OpenCode legacy shell-pattern approval，旧审批层会把非交互 A/B 卡住

修复方式：当 shell 工具上下文里已经有 TurnContext 时，目录访问由 TurnSandbox，回合沙箱 检查，命令和网络由本轮 command policy，命令策略 与 network policy，网络策略 处理，不再叠加旧 shell-pattern 审批

兼容边界：没有 TurnContext 的旧 OpenCode 调用仍保留 legacy approval，`commandPolicy=ask` 仍会显式审批，这不是绕过审批，而是避免同一条模型工具调用被两套门禁重复卡住

新增测试：`test/tool/shell.test.ts` 增加 “turn workspace command policy does not open legacy shell approval”，证明 workspace 命令策略下不会触发旧审批

A/B harness，A/B 对比脚本 新增 `AIALRA_AB_CASES`，可以按 case id 精准重跑失败场景，避免每次都烧完整 15 场

定向复跑结果：`aialra/turn-observability/ab-reports/ab-comparison-20260530035321.md` 只跑 AIALRA 的 `14-sandbox-natural` 和 `15-network-natural`，两场均 15/15，0 等待审批，0 越界写入，2/2 turn 终态，2/2 可解释

误启动的额外 A/B 进程已停止，运行 ID 为 `20260530042450`，没有纳入本轮验收报告

验证记录：`bun --cwd packages/opencode test test/tool/shell.test.ts test/tool/turn-sandbox.test.ts --timeout 30000` 43 pass；`bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000` 90 pass；`node --test aialra/turn-observability/tests/*.test.js` 1 pass；live Codex exec-server 工具测试 28 pass；`bun --cwd packages/opencode typecheck` 通过；`bun --cwd packages/app typecheck` 通过；`./aialra/opencode-deployment/scripts/build-opencode.sh` 构建通过

部署记录：线上版本 `0.0.0-dev-202605300438` 已构建并部署，`aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-codex-exec-server.service` 均为 active，`./aialra/opencode-deployment/scripts/e2e-smoke.sh` 11 pass，本地认证 API smoke 确认 `/config`、`/question`、`/project/current`、`/command`、`/session/status`、`/provider`、`/lsp` 均返回 200

当前未完成边界：完整 15 场三方 A/B 还没有在这次补丁后重跑，只做了失败场景定向复验；approval reviewer，审批人语义 仍未做到 Codex 1:1；A/B harness 仍需要 security profile，安全档案 区分真实用户默认监督模式和无人 benchmark 模式；Playwright 浏览器点击验收仍需稳定 runner

## 2026-05-30 追加实现记录：真实 benchmark 选题和 A/B 并发加速

用户指出现有 A/B prompt 太简单，只能验证 harness 是否健康，不能拉开复杂工程任务差距，这个判断正确

本轮新增 `select-agent-benchmark-cases.mjs`，真实 benchmark 选题器，从 Hugging Face dataset server 拉 SWE-bench Verified、SWE-bench Lite、SWE-bench Pro 公开任务，再按难度、fail-to-pass 测试数量、pass-to-pass 测试数量、patch 复杂度、test patch 复杂度和 prompt token 平衡打分

已生成正式选题清单：`aialra/turn-observability/benchmark-cases/agent-benchmark-selection-20260530045812.md`，本次拉取 600 条公开任务，239 条符合 token 范围，最终选出 24 条，前排包含 astropy、django、pytest、requests、matplotlib、NodeBB、ansible 等真实仓库任务

这一步不是伪装成已完成 SWE-bench 执行，当前完成的是“真实高难任务选择和追溯”，下一步才是“clone 仓库、checkout base commit、只给 agent problem statement、执行后用 test patch 或 official harness 验证”

本轮同时给 `run-ab-comparison.mjs` 增加 `AIALRA_AB_PARALLEL`，A/B runner 可按并发度跑多个 target/case，默认仍是 1，避免线上 provider 限速，用户需要加速时可以显式设置，例如 `AIALRA_AB_PARALLEL=3`

为了让并发结果可信，旧脚本里共享的 `/srv/aialra/ab-outside-should-be-denied.txt` 已改成按 runID、target、case 生成唯一越界探测路径，避免并发时 A 对象留下的文件污染 B 对象的判定

验证结果：`node --check` 已通过两个脚本，小样本 selector smoke 已通过，正式 selector 已成功生成 24 条真实 benchmark manifest，`AIALRA_AB_CASE_LIMIT=0 AIALRA_AB_PARALLEL=3` 的 runner 空任务 smoke 已通过

## 2026-05-30 追加实现记录：真实 SWE-bench 三方执行和官方验证

本轮新增 `run-real-benchmark.mjs`，真实 benchmark 执行器，能够读取 manifest，回源拉完整 problem statement 和 test_patch，clone 真实 GitHub 仓库，checkout 到 base commit，然后在同一题上并行运行 Codex CLI、debug1 原版 OpenCode 和 AIALRA OpenCode fork

执行器保证 agent 只收到 problem statement，问题描述，不收到 gold patch，也不收到 test_patch，测试补丁。agent 完成后，runner 才收集 `git diff` 形成 model patch，再进入验证阶段

首个真实三方样本选择 `psf__requests-2674`，来自 SWE-bench Lite，仓库是 `psf/requests`，并发度 3。三方都完成且都产生 patch，AIALRA 和 debug1 都改 `requests/adapters.py`，Codex CLI 改 `requests/adapters.py` 并额外补 `test_requests.py`

本地验证阶段暴露了 runner 自身问题：第一次运行因为本机只有 `python3` 没有 `python` 导致 spawn ENOENT，已修复为命令不存在时写入报告而不是崩掉，并把 Python 验证命令切到 `python3`

本地验证阶段还证明不能把本机 pytest 当最终结论：requests 旧仓库本机缺 `pytest`，且旧 vendored urllib3 对 Python 3.12 不干净，所以 local-test-patch 只是降级信号

随后对同一轮 agent 产出的 patch 追加运行 SWE-bench 官方 Docker harness。官方结果：AIALRA OpenCode fork completed 1/1 resolved 1/1；原版 Codex CLI completed 1/1 resolved 1/1；debug1 原版 OpenCode completed 1/1 resolved 0/1

真实报告路径：`aialra/turn-observability/real-benchmark-reports/real-benchmark-20260530051310.md`

未完成边界：官方 harness 追加验证目前是手动对首个样本三方 patch 执行，`run-real-benchmark.mjs` 已有 `AIALRA_REAL_BENCH_VERIFY=official` 模式，但下一步要把“先跑 agent，再自动批量 official harness 验证，再合并官方结果”做成完全自动化流水线

## 2026-05-30 追加实现记录：高难 benchmark 固定时间超时纠偏

用户指出固定时间阈值会误伤慢但仍在工作的任务，这个判断正确

本轮只处理 run `20260530071350` 中尚未正确完成的旧超时项，没有重跑已经完成的 120 组合

`run-real-benchmark.mjs` 已改成 progress-aware timeout，进展感知超时：runner 会看 message，消息、tool call，工具调用、public event，公共事件、git diff，代码改动 是否变化，而不是只看总耗时

旧固定时间超时已经全部清零，最终结果里 `fixedTimedOut=0`

当前剩余 9 个 timeout 都是检测型结果，其中 8 个是 repeated tool loop，重复工具循环，1 个是 non-productive tool churn，非生产性工具循环

关键纠偏案例：AIALRA Kimicode 的 `scikit-learn__scikit-learn-13241` 在旧固定预算下会被误判为超时，但继续跑完后耗时 3233 秒并通过验证，说明“慢但有进展”必须继续跑

关键新发现：AIALRA Kimicode 的 `scikit-learn__scikit-learn-14092` 产出了验证通过的 patch，但随后继续重复工具调用，最终被标为逻辑循环。这类结果要单独看待：代码可能修对了，但 agent 没有学会收尾

最后一个未完成项 `instance_element-hq__element-web-5e8488...` 从 21:28 后补丁不再变化，却继续跑到 338 次工具调用，主要反复探测 `jest`、`node_modules` 和包路径。该会话已手动中断并写入正式结果，原因记录为 non-productive tool churn，而不是固定时间超时

最终统计：120/120 行，0 duplicate，0 fixed timeout，9 progress-aware timeout，24 个可验证通过。总分为 Codex CLI 475，AIALRA DeepSeek 425，debug1 DeepSeek 406，debug1 Kimicode 306，AIALRA Kimicode 285

更新报告：`aialra/turn-observability/real-benchmark-reports/real-benchmark-20260530071350.md`

更新结构化结果：`aialra/turn-observability/real-benchmark-reports/real-benchmark-20260530071350-results.json`

## 2026-05-31 实现记录：AIALRA 通用工程执行框架 v1

用户要求把下一阶段从“零散增强”收束成通用工程 agent harness，而不是模型专属优化。本轮实现的核心是：所有模型进入 OpenCode 后，共用一套工程控制、阶段状态、验证闭环、停止门禁、循环干预和审计事件

已新增 Engineering Controls，工程控制。沙盒控制中心现在有 fast、balanced、deep、long 四个工程模式。普通用户只选模式，不需要理解一堆参数；高级用户可以展开配置验证轮数、定位工具预算、重复工具阈值、工具调用总上限和单条命令最长时间

已新增 EngineeringRun，工程运行。每个 turn 会带工程运行快照，阶段包括 intake、clarify、localize、plan、edit、verify、repair、finalize、blocked。Turn Inspector 能看到工程运行开始和阶段切换

已接入工具执行门禁。工具每次执行前会读取 TurnContext 里的 engineering 设置。重复相同工具和输入会按用户模式产生 warning、checkpoint 或 block。验证通过后 stop gate 会阻止继续工具调用，让模型直接最终汇报

已接入验证驱动的第一版。bash 命令如果像 `npm test`、`pytest`、`bun test`、`go test`、`cargo test`、`typecheck`，并且退出码是 0，系统会记录验证通过，开启通过即停止门禁。验证失败会进入 repair 阶段，给后续修复留下结构化事件

已记录 reasoning context，推理上下文。模型如果返回 reasoning 内容，公共事件会记录 reasoning 字符数和 metadata keys，不返回 reasoning 的模型不会被伪造

已做 benchmark 分层。真实高难 runner 支持 `AIALRA_REAL_BENCH_TIER=smoke|regression-6|full-24`，以后小改跑 smoke，大改跑 regression-6，阶段发布才跑 full-24

已新增资源清理入口 `cleanup-benchmark-runs.mjs`。默认 dry-run，只写报告，不真删；必须设置 `AIALRA_BENCH_CLEANUP_APPLY=1` 才清理旧 worktree

已新增 Claude Code + DeepSeek PoC runner。它会检查 claude CLI 和 Anthropic-compatible gateway，环境不足时只写明缺口，不把未运行伪装成成功

已跑验证：`bun --cwd packages/opencode test test/session/engineering.test.ts test/server/httpapi-public-event.test.ts --timeout 30000` 7 pass；`bun --cwd packages/opencode typecheck` 通过；`bun --cwd packages/app typecheck` 通过；cleanup dry-run 和 Claude Code PoC 报告均已生成

真实边界：official SWE-Bench harness 的失败摘要还没有自动回灌到同一轮 agent；stop gate 能阻止验证通过后的继续工具调用，但不会替模型写最终报告；EngineeringRun 第一版是结构化阶段状态机，不是 LLM 动态生成 DAG；Claude Code + DeepSeek 只是 PoC 入口，不是主线产品能力

部署验收：执行 `./aialra/opencode-deployment/scripts/build-opencode.sh` 成功，构建版本为 `0.0.0-dev-202605310521`，随后重启 `aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-codex-exec-server.service`，三个服务均为 active。`./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过，源站认证 API smoke 确认 `/config`、`/question`、`/project/current`、`/command`、`/session/status`、`/provider`、`/lsp` 均返回 200。Playwright CLI wrapper 本轮仍然在 open/snapshot 阶段不退出，因此没有把它算作浏览器验收通过

用户反馈修复：左上角 `DEV` 是构建通道标记，来自 `VITE_OPENCODE_CHANNEL=dev`，表示当前是 dev 预览构建，不是功能错误。本轮给这个标记加了中文 hover 说明。左上角 V2 titlebar 的主菜单、项目首页、新建会话按钮补了中文 hover。项目首页和新建会话从普通 anchor 导航改为 router 导航，减少点击后整页重载导致的短时卡死。沙盒控制中心的高级工程参数无法关闭，根因是前端把完整 engineering 配置带着 mode 一起 PATCH，后端把它当成“应用模式预设”并保留旧 advancedEnabled，本轮已改为只发送变更字段，后端也专门处理 `advancedEnabled=false`

## 2026-05-31 追加修复记录：标题栏按钮实际无响应

用户反馈左上角切换侧边栏和右上角按钮没有实际反应。复测确认按钮本身能收到点击，但在 V2 新建会话页里，右侧文件树、回合检查器和沙盒控制中心对应的面板被页面级条件整块隐藏，所以用户看到的是“按钮变了但界面没动”

本轮曾改成：新建会话页也允许文件树、回合检查器、沙盒控制中心打开；主会话区域会按面板宽度缩放；右侧按钮和左侧标题栏按钮都加了原生 hover 标题，并阻止标题栏拖拽层吞掉 pointerdown 事件。这个方案后来确认是错误方案，已在下面的纠偏记录中撤回

当时验证结果：`bun --cwd packages/app typecheck` 通过；`bun --cwd packages/app build` 通过；`./aialra/opencode-deployment/scripts/build-opencode.sh` 通过，线上版本为 `0.0.0-dev-202605310602`；`./aialra/opencode-deployment/scripts/e2e-smoke.sh` 通过。但后续浏览器人工反馈证明该方案破坏了原生布局，所以不能作为有效 UI 验收结论

## 2026-05-31 纠偏记录：恢复原生侧栏布局

用户继续反馈页面全乱，尤其是右侧边栏混成一团。复盘后确认上一条“让新建会话页也能打开右侧文件树/检查器/沙盒面板”的判断是错误的，它破坏了 OpenCode V2 新建会话页原生布局

本次纠偏撤回标题栏、右侧面板和新建会话页布局相关改动，恢复到通用工程框架提交后的原生 UI 状态。保留的只有沙盒控制中心高级工程参数能关闭这一类工程控制修复

进一步确认左侧侧栏不显示的根因是 dev 构建默认开启 V2 新布局，而 V2 新布局首页本身不渲染原生左侧侧栏。本次把 `newLayoutDesigns` 默认值切回 `false`，并增加一次性设置迁移，让已经打开过新布局的浏览器也恢复到原生侧栏

浏览器截图继续暴露第二个问题：原生侧栏壳恢复后，URL 当前目录没有自动注册到左侧项目列表，导致展开后侧栏内容是空白。本次追加路由同步，只要当前 URL 带目录，就自动把该工作区打开到左侧项目列表里

后续规则：UI 入口类问题必须先用浏览器截图确认布局，再修改；不能为了让按钮“看起来有反应”强行突破原生页面布局边界

## 2026-05-31 追加修复记录：新对话不进左侧侧栏

用户反馈新建对话后左侧没有记录，导致无法从侧栏切回新对话

根因是左侧会话列表主要依赖两件事：第一是当前目录的 path metadata，路径元数据；第二是 session.created 事件或 session list 缓存。新对话创建后，如果路径元数据还没完成加载，或者事件流/缓存没有及时把新会话送进当前列表，页面已经进入 `/session/:id`，但左侧列表仍然用旧缓存渲染，于是用户看起来像“新对话没保存”

本轮修复了两个点

1. 左侧列表在目录元数据还没加载完时，会使用当前路由目录作为兜底目录过滤会话，这样刚 seed，预写入 的新会话也能立即显示
2. 如果当前页面已经进入某个 session id，但左侧当前列表还没有这个 session，前端会最多 3 次强制刷新当前目录和可见目录的会话列表，避免事件流或 query cache，查询缓存 漏同步

验证已完成：`packages/app/src/pages/layout/helpers.test.ts` 新增路径元数据未就绪时仍显示当前路由会话的测试；`bun test --preload ./happydom.ts ./src` 339 pass；`bun typecheck` 通过；`bun run build` 通过

## 2026-05-31 追加修复记录：宽项目根导致左侧仍按 `/` 过滤

上一次修复后，浏览器复验仍发现新会话不显示。进一步检查确认：会话 API 已经返回了新会话，前端也加载了最新 JS，但左侧普通模式把当前项目显示成 `/`，于是会话列表按 `/` 过滤，而用户实际在 `/srv/aialra/turn-harness-target`

本轮把“项目根目录”和“当前会话目录”拆开处理。项目菜单仍然操作真正项目；但当 workspace mode，工作区模式 关闭时，新建会话按钮、左侧会话列表和当前面板标题都使用 URL 里的当前目录。这样即使后端把项目根识别成 `/`，左侧也会显示 `/srv/aialra/turn-harness-target` 里的会话

同时补了 `sidebarSessionDirectory` 单测：工作区模式关闭时使用当前路由目录；工作区模式开启时保持原多工作区行为

验证结果：`bun test --preload ./happydom.ts ./src/pages/layout/helpers.test.ts` 23 pass；`bun typecheck` 通过；`./aialra/opencode-deployment/scripts/build-opencode.sh` 成功，版本 `0.0.0-dev-202605310658`；服务重启后 `aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-codex-exec-server.service` 均 active；`./aialra/opencode-deployment/scripts/e2e-smoke.sh` 11 pass。第一次 smoke 在服务刚重启尚未完成端口绑定时失败，等待后重跑通过

浏览器验收：通过 Playwright CLI 登录线上页面，创建新会话 `ses_183203663ffe0ytgU8isGg0KnH`，进入 `/srv/aialra/turn-harness-target` 对应 URL 后，左侧 `[data-session-id]` 列表已经出现该会话。截图保存在 `/tmp/opencode-sidebar-session-visible.png`

## 2026-05-31 追加记录：General Engineering Harness v2 验收和 full-24

本轮完成 V2 的核心工程改动和真实验收

已经实现的关键行为

1. 验证失败反馈不再只躺在日志里。系统会把失败摘要写进 EngineeringRun feedback，下一轮 repair 会带着失败原因继续修
2. 阶段门禁开始真正生效。bug/refactor/security 任务如果还没读过或搜过代码就直接改文件，会被挡住并要求先计划
3. 模型提前收尾会被纠偏。比如模型说“我已经找到问题，要我继续改吗”，系统会发 `engineering.phase_gate.premature_final` 并要求继续做最小修改和验证
4. benchmark runner 支持失败后自动 repair，一次 repair 会把当前 diff 和验证失败输出发回同一 session
5. benchmark runner 的公平性修复完成。OpenCode 启动等待默认从 180 秒改到 30 分钟，超时重跑会重跑 progress-aware timeout，cleanup 的 ENOTEMPTY 不再覆盖真实 agent 结果

验收结果

regression-6：run `20260531080150`，AIALRA DeepSeek V4 Pro max 从上一轮同 6 题 3/6 提升到 4/6，0 审批卡住，0 超时

full-24：run `20260531093837`，AIALRA DeepSeek V4 Pro max 最终 24/24 完成，6/24 verified pass，18/24 有 patch，6/24 零 patch，0 审批卡住，0 超时，0 基础设施错误，总分 417

人话结论

V2 方向是有效的，因为 full-24 verified pass 从 5/24 提升到 6/24，而且没有引入审批卡住或逻辑超时。但提升幅度不够大，并且零 patch 从上一轮 0 变成 6，说明下一阶段 V3 要重点做 no-patch recovery，零补丁恢复，和 verification availability，验证可用性。也就是说，不是继续加 UI，而是让模型长篇分析后必须落到代码改动或明确 blocked 原因，让 Pro 任务在官方 test_patch 套不上时也能得到等价验证反馈

报告路径

- regression-6：`aialra/turn-observability/real-benchmark-reports/real-benchmark-20260531080150.md`
- full-24：`aialra/turn-observability/real-benchmark-reports/real-benchmark-20260531093837.md`

最终交付验证：`bun --cwd packages/opencode test test/session/engineering.test.ts --timeout 30000` 7 pass；`bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000` 90 pass；`node --test aialra/turn-observability/tests/*.test.js` 1 pass；`AIALRA_EXEC_BACKEND=codex AIALRA_RUN_CODEX_EXEC_SERVER_TEST=1 AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650 bun --cwd packages/opencode test test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts --timeout 30000` 28 pass；`bun --cwd packages/opencode typecheck` 通过；`bun --cwd packages/app typecheck` 通过；`bun --cwd packages/app build` 通过；`bun --cwd packages/opencode build --single` 通过；`git diff --check` 通过。最终部署版本为 `0.0.0-dev-202605311418`，`aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-codex-exec-server.service` 均为 active，`./aialra/opencode-deployment/scripts/e2e-smoke.sh` 11 pass

## 2026-05-31 追加记录：V3 计划落盘和零补丁恢复第一批实现

用户要求先把 16 个 V3 目标全部拆成文件计划，避免后续上下文压缩导致任务失真。本轮新增 `aialra/turn-observability/project-plans/v3-general-engineering-harness/`，其中 `00-v3-master-plan.md` 是总计划，`01` 到 `16` 分别对应终态校准器、TurnContext parity、exec-server FS 收敛、environment cwd、越界写入审计、Linux 沙箱、exec-server 默认后端、public event 协议、Turn Inspector 产品化、审批 reviewer、EngineeringRun V3、验证反馈、stop gate、zero patch recovery、patch quality scoring 和 benchmark gate

已经开始执行第一批工程缺陷闭环。Engineering Controls，工程控制 新增 `zeroPatchRecoveryMax`，零补丁恢复次数。沙盒控制中心高级参数里现在可以调这个值，避免把恢复次数写死

EngineeringRun 现在会记录写入工具调用次数和零补丁恢复状态。对于 bug_fix、refactor、test 等期望有 diff 的任务，如果模型准备结束但本轮没有任何 edit/write/apply_patch 或写入型 bash 活动，系统会触发 `engineering.zero_patch.detected`，进入 repair 阶段，并注入提醒让模型继续做最小修改或明确 blocked 原因。恢复次数用完后会发 `engineering.zero_patch.exhausted`

终态可见性也补了第一刀。正常 completed 或 aborted 之前会发 `turn.terminal.reconciled`；如果 assistant final 是空文本，会先发 `turn.terminal.anomaly`，这样用户和 benchmark 能区分“正常完成”和“空结果也完成了”

Turn Inspector 增加了这些事件的中文标题和摘要：终态异常、终态已校准、检测到零补丁、请求零补丁恢复、零补丁恢复耗尽

benchmark 报告新增 patch quality，补丁质量分。现在每题不只显示完成和 patch 字节，还会解释验证是否通过、是否零补丁、是否改了源码、是否包含测试、补丁大小是否合理、是否有生成物噪声、终态是否干净、repair 是否成功

已验证：`bun --cwd packages/opencode test test/session/engineering.test.ts --timeout 30000` 10 pass；`bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000` 90 pass；`node --test aialra/turn-observability/tests/*.test.js` 1 pass；`bun --cwd packages/opencode typecheck` 通过；`bun --cwd packages/app typecheck` 通过；`node --check aialra/turn-observability/scripts/run-real-benchmark.mjs` 通过

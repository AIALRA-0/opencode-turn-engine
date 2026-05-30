# OpenCode Codex Harness Status And Test Playbook

This document tracks what the AIALRA OpenCode fork has already absorbed from
Codex, what is still missing, and how a user can test the behavior directly.

## 0.000 2026-05-30 高难度 benchmark 选题和 A/B 加速状态

| 项目 | 原来是什么 | 现在是什么 | 用户怎么观察 | 真实边界 |
| --- | --- | --- | --- | --- |
| A/B prompt 难度 | 15 场主要是 smoke、沙箱和本地小型 SWE-style，适合验证 harness 健康，但不适合拉开高难度工程能力差距 | 新增真实 benchmark 选题器，从 SWE-bench Verified、SWE-bench Lite、SWE-bench Pro 拉公开 issue，按难度、fail-to-pass 数、pass-to-pass 数、patch 复杂度和 prompt token 平衡打分 | 运行 `node aialra/turn-observability/scripts/select-agent-benchmark-cases.mjs`，查看 `aialra/turn-observability/benchmark-cases/latest.md` | 这一步是选题和 manifest，不是完整官方 SWE-bench 执行，下一步还要 clone 仓库、checkout base commit、运行 official harness |
| token 消耗控制 | 旧任务几乎都很短，token 成本低但能力区分度也低 | 默认目标 3500 token，过滤 700 到 12000 token，选“足够复杂但不至于爆预算”的题 | `latest.md` 表格里有估算 token、patch 大小、测试数量和分数 | token 是按字符估算，不等于 provider 真实 tokenizer，但足够做预筛 |
| 数据集多样性 | 只用本地手写 fixture | 默认拉 SWE-bench Verified、SWE-bench Lite、SWE-bench Pro，并限制同一仓库最多 2 道 | `latest.json` 的 `sources` 和每条 case 的 `datasetKey` 可追溯 | Terminal-Bench 这类终端任务还没有接入执行，只在下一步纳入执行器路线 |
| A/B 重跑速度 | runner 串行跑 target 和 case，完整 15 场容易跑很久 | 新增 `AIALRA_AB_PARALLEL`，可以并发跑多个 target/case；每个工作区外写入探测路径按 runID、target、case 唯一化，避免并发污染 | 例如 `AIALRA_AB_PARALLEL=3 node aialra/turn-observability/scripts/run-ab-comparison.mjs`，报告顶部会显示并发度 | 默认仍是 1，避免线上模型限流；提高并发要看 provider 限速和服务器负载 |
| 真实 SWE-bench 执行 | manifest 只有选题，没有 clone、checkout、三方执行和官方验证 | 新增 `run-real-benchmark.mjs`，可 clone 真实仓库、checkout base commit、只把 problem statement 给 agent、收集 model patch、应用 test_patch 或调用官方 harness | 首份报告 `aialra/turn-observability/real-benchmark-reports/real-benchmark-20260530051310.md` | 官方 harness 批量自动合并还没完全产品化，首个样本已手动追加官方验证 |
| 首个官方验证结果 | 没有真实高难官方判定 | `psf__requests-2674` 中 AIALRA OpenCode fork 和 Codex CLI 都 official resolved，debug1 原版 OpenCode completed 但 unresolved | 看报告的“官方 SWE-bench Docker harness 追加验证” | 只覆盖 1 道真实样本，不能外推成全量 benchmark 结论 |

## 0.00 2026-05-30 最新修复状态

| 项目 | 原来是什么 | 现在是什么 | 用户怎么观察 | 真实边界 |
| --- | --- | --- | --- | --- |
| V2 顶栏按钮 | 官方新布局分支只显示少量 V2 按钮，AIALRA 的文件树、Turn Inspector、沙盒控制中心按钮只挂在旧布局分支里 | 新布局和旧布局都显示左侧项目栏开关、终端、文件树、回合检查器、沙盒控制中心 | 如果打开了新版布局，顶部仍能看到这些工具按钮，左侧项目栏可重新打开 | 这是布局分支补齐，不改变左侧项目栏默认是否展开 |
| 沙盒控制中心 UI | 面板里多个灰色卡片叠在一起，看起来和文件树、Turn Inspector 不一致 | 改成侧栏式分隔区块，减少灰色卡片感，控件保持紧凑 | 打开沙盒控制中心，视觉上应更接近右侧面板，而不是一整块灰色表单 | 还没做最终设计系统组件化，只是把当前 MVP 调整到一致风格 |
| 默认安全策略 | 默认工作区可写、需要时询问，但网络和命令没有明确“每次询问”的后端字段 | 默认变成：工作区可写、需要时询问、网络每次询问、命令每次询问、Codex 执行服务、步骤上限关闭 | 打开沙盒控制中心，网络访问和命令执行默认都是“每次询问” | 这会让非交互 A/B 在网络/命令任务里等待审批，除非 benchmark 显式选择自动拒绝或预审批策略 |
| 网络每次询问 | UI 可以显示“每次询问”，但后端只是按网络关闭执行 | bash 检测到 `curl`、`wget`、`ping`、`npm install`、`git clone` 等网络命令时，先发 `network` 审批，批准后只给这一条命令打开网络 | 执行 curl 类命令时应先看到网络审批，批准后命令能走不带 `--unshare-net` 的沙箱 | 检测是工程规则，不是 LLM 理解，下一步要补更完整网络命令分类和白名单 |
| 命令每次询问 | 有些命令只有涉及文件时才审批，`pwd` 这类普通命令可能直接跑 | `commandPolicy=ask` 时，每次 bash 命令都会先请求审批 | 让 agent 执行 `pwd`，默认会先出现命令审批 | 用户点“本轮全部”或“始终全部”后，同范围内后续命令不会再弹 |
| 审批审计字段 | `Permission.ask` 构造 bus payload 时丢了 turnID 和策略字段 | approval 事件保留 turnID、approval policy、permission profile、sandbox policy、tool call | Turn Inspector 的 approval 事件能挂到对应回合和工具 | reviewer 语义还没有 Codex 1:1，但审计数据不再丢 |
| TurnContext shell 门禁 | 有 TurnContext 的模型 bash 调用仍可能再走 OpenCode legacy shell-pattern 审批，非交互 A/B 会停在泛化审批等待 | 有 TurnContext 时，bash 先由本轮 sandbox/cwd/network/command policy 门禁处理，旧 shell-pattern 审批只保留给无 TurnContext 的兼容路径 | 自然语言沙箱和网络 A/B 不再卡在“等待审批”，而是完成并解释成功/拒绝原因 | `commandPolicy=ask` 仍会按设计审批，这是用户显式选择的强监督模式 |

本轮部署验收：线上版本 `0.0.0-dev-202605300438` 已构建并部署，`aialra-opencode-web.service`、`aialra-opencode-login.service`、`aialra-codex-exec-server.service` 均为 active，e2e smoke 11 pass，API smoke 确认 `/config`、`/question`、`/project/current`、`/command`、`/session/status`、`/provider`、`/lsp` 均返回 200

浏览器级验收边界：`playwright_cli.sh` 没有执行位，改用 `bash playwright_cli.sh` 后 `npx playwright-cli` 在本机长时间无输出，本轮没有把浏览器点击验收伪装成通过，UI 结果需要用户刷新线上页面后确认，后续应把 agent-browser 或固定 Playwright 脚本纳入稳定验收链

本轮没有重跑完整 15 场三方 A/B，原因是默认策略已改成“命令每次询问”和“网络每次询问”，非交互 benchmark 遇到 bash 或网络会自然停在审批等待，下一步需要先给 A/B harness 增加安全策略档案，例如 `interactive-default`、`noninteractive-auto-deny`、`trusted-full-auto`，否则会把产品安全默认值误判成模型能力下降

已定向复跑上一份 15 场报告里 AIALRA 失败的两个场景，报告为 `aialra/turn-observability/ab-reports/ab-comparison-20260530035321.md`，覆盖 `14-sandbox-natural` 和 `15-network-natural`，AIALRA 两场均为 15/15，0 等待审批，0 越界写入，2/2 turn 终态，2/2 可解释

## 0. 2026-05-19 九项路线最新状态

| 编号 | 事项 | 当前状态 | 人话结论 | 证据/位置 |
| --- | --- | --- | --- | --- |
| 1 | Public event stream（公共事件流） | 已实现 MVP、已修复静默断流 524 | 现在不是只能看内部 trace；前端和测试都可以消费稳定公共事件。SSE 空闲时会发 ping，不会因为长时间没事件被 Cloudflare 掐掉。 | `GET /event/public`、`GET /session/:sessionID/events/public`、`aialra.public_event.v1`、`event: ping` |
| 2 | Codex exec-server 研究/迁移 | bash、文件内容读写、目录列举已接源码构建 sidecar | 已查明“握手失败”不是泛泛失败：全局安装的 `codex-cli 0.125.0-alpha.3` 打印 ws 地址但不完成当前客户端需要的 HTTP 101；本机源码构建的 Codex binary 可以 `/readyz`、`initialize`、`process/start/read` 和 FS API。AIALRA 主服务默认连接 `aialra-codex-exec-server.service` 的 `ws://127.0.0.1:12650`；bash、read/write/edit/apply_patch、read directory 优先走 Codex exec-server，失败再 fallback。 | `packages/opencode/src/tool/codex-exec-server.ts`、`packages/opencode/src/tool/codex-fs.ts`、`aialra-codex-exec-server.service`、`test/tool/codex-exec-server.test.ts` |
| 3 | Linux bwrap / Landlock parity | 已加强，仍非 Codex 绝对 1:1 | bash bwrap 现在有能力探测、更接近 Codex 的 `--new-session/--unshare-user/--die-with-parent` 参数、受限容器下自动跳过不可用 `/proc`、缺失 `.git/.agents/.codex` protected-create 防护。当前内核有 Landlock 配置，Codex Linux sandbox helper 的真实写入探测能挡住工作区外写入；但 Node/Bun 侧还没有直接调用 Landlock syscall。 | `linux-sandbox-capability.ts`、`probe-linux-sandbox.mjs`、turn-sandbox tests |
| 4 | debug1 原版 OpenCode A/B | 已部署，评测体系已升级为 smoke + SWE-style + sandbox | `debug1.aialra.online` 已部署原版 anomalyco/opencode，对照组和 AIALRA fork 端口、systemd、数据目录、环境变量、日志全部隔离。A/B 脚本现在不再把“读 README / 写 txt”当主成绩；默认包含 5 个 smoke、8 个本地 SWE-style 失败测试仓库、2 个沙箱自然语言任务。 | `aialra/turn-observability/scripts/run-ab-comparison.mjs`、`ab-reports/`、`aialra-opencode-debug1-*` systemd services |
| 5 | Kimi/弱模型卡死诊断 | 已改为用户可选硬防护 | 默认不限制工具步数；用户可在 Sandbox Control Center 开启“限制模型工具循环”并设置最大步数。超过后走 Codex reason `budget_limited`。重复工具模式会发 warning，先提示不拦截。 | `turn.step_budget.changed`、`turn.budget_limited`、`turn.repeated_tool.warning` |
| 6 | 只优先 Linux 沙箱 | 已遵守 | 当前实现和验收只承诺 Linux，不做 macOS/Windows 沙箱。 | 计划边界 |
| 7 | Approval UI 和 TurnContext 审计绑定 | 已实现 MVP | 审批请求会带 turnID、approval policy、permission profile、sandbox policy，并映射到公共事件。 | `approval.requested` / `approval.resolved` |
| 8 | Profile parity 测试表 | 已扩展自动化，仍未覆盖网络/审批全矩阵 | 新增 read-only 读允许、write/edit/apply_patch 拒绝，full-access 外部写允许，workspace 外部写拒绝，disabled/external profile，bash network restricted/enabled，以及 TurnContext 下 legacy external-directory 不再制造重复审批等待。真实 HTTP/network 工具和 reviewer 语义还需要下一批。 | `test/tool/turn-sandbox.test.ts`、`test/tool/external-directory.test.ts` |
| 9 | Turn Inspector / Sandbox Control Center | 已拆分为两个独立面板 | 回合检查器只负责“看这一轮发生了什么”；沙盒控制中心独立按钮在它右侧，负责“控制后续回合允许发生什么”。控制中心全中文、下拉框式交互，变更会真实进入 session security，再影响下一轮 TurnContext。 | `turn-inspector.tsx`、`sandbox-control-center.tsx`、`SessionSecurity.update` |

## 0.0 2026-05-29 最新收口状态

| 项目 | 原来是什么 | 现在是什么 | 用户怎么观察 | 真实边界 |
| --- | --- | --- | --- | --- |
| 官方 upstream 同步 | fork 停在 2026-05-19 的本地魔改版本。 | 已合并 upstream `dev` 到 `7342e9409`，包含 ACP 正式化和 stats 修复；本地 TurnContext、exec-server、Sandbox Control Center 兼容保留。 | `git log --oneline --first-parent` 可见 `19615ae27` 官方合并提交。 | `prompt.ts` 等冲突文件按 AIALRA turn harness 语义保留本地实现，未盲目覆盖。 |
| 页面 502 HTML 大页 | Cloudflare 或 login proxy 上游短暂不可用时，前端可能直接展示整段 HTML 错误页。 | login proxy 对上游不可用返回短 JSON/text 503，GET/HEAD/OPTIONS 瞬断会重试一次；SDK 客户端把 HTML 错误页压缩成一行中文错误。 | 再遇到 502 时不应看到大段 `<!DOCTYPE html>`；错误会说明 OpenCode 服务暂时不可用。 | 如果源站进程持续崩溃，仍需要查 systemd/nginx/Cloudflare 日志，本修复负责不把 HTML 大页轰到 UI。 |
| 工具步数预算 | 默认 80 step 硬停，可能误伤超长任务。 | 默认关闭；用户在沙盒控制中心开启后才按用户设置的最大步数硬停，并写入 `turn.step_budget.changed`。 | 沙盒控制中心里“限制模型工具循环”默认关闭，可手动设置最大工具步数。 | `agent.steps` 显式配置仍优先于 UI 预算，这是 OpenCode agent 自身限制。 |
| 审批按钮 | 只有拒绝、始终允许、允许一次，含义不够清晰。 | UI 变成六个短按钮：拒绝、仅本次、本轮本命令、本轮全部、始终本命令、始终全部；tooltip 写完整含义。 | 触发审批时看底部审批 dock。 | 当前 turn 内自动允许由前端记忆实现，不会绕过沙盒控制中心里的文件和网络限制。 |
| Sandbox Control Center 生效 | 用户感觉切换档位没有明显效果。 | 工具门禁每次执行都会重新套用 SessionSecurity；新增测试证明只读切换后写入被拒绝，切回工作区可写后写入成功。 | 切到只读后让 agent 写文件应被拒绝；切回工作区可写后可以写当前工作区。 | 已发出的模型请求不会被中途改写，新的工具门禁会读最新配置。 |
| Turn Inspector 折叠提示 | 历史回合折叠后仍显示提示框，增加视觉噪音。 | 历史回合默认直接折叠，不显示“已折叠历史回合日志”框子。 | 多轮对话后打开回合检查器，旧回合只显示分隔行和条数。 | 还不是虚拟列表，超长会话仍需后续做真正列表虚拟化。 |
| A/B 报告 | 报告主要显示完成情况，缺少打分和完整 prompt。 | 报告现在有单场分数、总分、评分规则和每个 case 的完整提示词代码块。 | 新报告会写到 `aialra/turn-observability/ab-reports/`。 | A/B 是否全绿取决于线上模型和服务状态，需要每次部署后实跑。 |
| 最新 15 场 A/B | 之前 9 场报告还没覆盖完整 SWE-style 和自然语言安全任务，也没有验证 runner 自己不会卡死 | 已修复 A/B 子进程硬超时并跑完 15 场，报告 `ab-comparison-20260529211021.md` 中 AIALRA 总分 301 第一；之后又定向复跑原先等待审批的 `14-sandbox-natural` 和 `15-network-natural`，报告 `ab-comparison-20260530035321.md`，AIALRA 两场均 15/15 | 完整 15 场三方还没在 shell 门禁补丁后重跑，因为另一个误启动 A/B 已停止，当前先采用定向复跑证明缺口已收口 | 打开 `aialra/turn-observability/ab-reports/ab-comparison-20260529211021.md` 看完整 15 场，打开 `ab-comparison-20260530035321.md` 看失败场景复验 |

## 0.1 2026-05-18 网站体验修复验收矩阵

| 问题 | 原表现 | 当前处理 | 验收结果 |
| --- | --- | --- | --- |
| Turn Inspector 全是英文 | 用户看到 `Turn Inspector`、`All`、`Raw`、`Loading raw payload` 这类英文。 | 面板标题、连接状态、筛选、事件标题、状态、Raw 按钮、关闭 tooltip、顶部按钮 tooltip、命令面板入口都改成中文。 | Playwright 打开线上靶场 session，面板显示“回合检查器 / 等待事件 / 全部 / 错误 / 工具 / 文件 / 命令 / 审批”。 |
| Raw 一直 loading | Raw 请求没有超时保护，如果代理或鉴权卡住，按钮会一直转圈。 | Raw 请求增加 12 秒 AbortController 超时；失败显示中文错误；成功后仍只展示当前事件 raw payload，不走 SSE 推送完整原文。 | 本机 raw endpoint 已返回 `aialra.public_event_raw_response.v1`；UI 失败路径不再无限 loading。 |
| 输出不会按底部状态自动滚动 | 新事件来了不会区分用户是否在底部。 | 回合检查器记录滚动视口是否距离底部小于 48px；只有用户已经在底部时，新事件才自动滚到底；用户手动往上看时不会打断阅读。 | app typecheck/build 通过，逻辑在 `turn-inspector.tsx`。 |
| 不同 turn 混在一起 | 所有事件平铺，多个回合不容易分辨。 | 按连续 turnID 插入“回合 xxx / N 条”分隔线；没有 turnID 的事件显示为“全局事件”。 | UI 已渲染分段结构。 |
| Public event stream 524 | session public event stream 没事件时不发字节，Cloudflare 会把长连接关成 524。 | SSE 连接立即发 `event: ping`，之后每 20 秒发 ping；前端和测试忽略非 public-event schema 的 ping。 | 本机 curl 已看到首帧 `event: ping`，随后是真实 public event。 |
| worker 被 CSP 拦截 | CSP 只有 `worker-src blob:`，同源 `/assets/worker-*.js` 被拒。 | OpenCode UI CSP 和登录代理 CSP 都加入 `worker-src 'self' blob:` 与 `child-src 'self' blob:`。 | 登录后首页 CSP header 已包含该配置；Playwright 复测无 worker CSP 错误。 |
| Cloudflare beacon 被 CSP 拦截 | Cloudflare 注入脚本被 `script-src` 拒绝，控制台报错。 | `script-src` 加入 `https://static.cloudflareinsights.com`。 | 登录后首页 CSP header 已包含该域名。 |
| manifest 语法错误 | 未登录或登录代理路径下，`/site.webmanifest` 可能拿到 HTML/登录页。 | 登录代理对 manifest 和常见 favicon/icon 路径直接代理到 OpenCode 静态资源，不再先要求登录。 | `https://opencode.aialra.online/site.webmanifest` 返回 `application/manifest+json` 和 JSON 开头。 |
| 浏览器页面报资源错误 | 重启期间动态 chunk 可能短暂 502；之前 worker/manifest/event stream 错误混在一起。 | CSP、manifest、SSE 已修；部署后 Playwright 登录并打开靶场 session，控制台无 warning/error。 | Playwright 结果：`warningsAndErrors: []`。 |

## 0.2 2026-05-19 执行器和 Linux 沙箱推进矩阵

| 项目 | 现在新增了什么 | 用户实际会感知到什么 | 和真 Codex 还差什么 |
| --- | --- | --- | --- |
| bwrap 能力探测 | 每次 bash sandbox 会记录 bwrap 版本、关键参数支持、user namespace、`/proc` 挂载能力、Codex CLI/exec-server/helper 是否存在。 | Turn Inspector 会出现“沙箱能力检查”，排查时能知道是不是系统能力不够。 | Codex 是 Rust helper 内部探测并执行；我们现在是 Node/Bun 侧探测。 |
| bwrap 参数对齐 | bash sandbox 加入 `--new-session`、`--unshare-user`、`--unshare-pid`、`--die-with-parent`、网络隔离和只读根文件系统。容器不允许挂 `/proc` 时会跳过。 | 工作区内可写，工作区外写入失败；受限容器不再因为 `/proc` mount 失败导致所有 bash sandbox 失效。 | 还没有 Codex Rust helper 的 seccomp/no_new_privs/proxy network 全套。 |
| bwrap network namespace probe | 以前只看 bwrap 是否存在，可能错误添加不可用的 `--unshare-net`，让所有 bash 直接失败。 | 现在单独探测 user namespace 和 network namespace；网络 namespace 不可用时不再让普通 bash 全挂，会记录 `restricted-unenforced` 降级状态。 | 这不是完整网络隔离；要硬挡网络仍需 Codex helper / seccomp / namespace 能力可用。 |
| protected-create | 如果工作区本来没有 `.git/.agents/.codex`，bash 里也不能偷偷创建这些目录。 | 让模型执行 `mkdir -p .git && echo bad > .git/config` 会失败，命令结束后宿主工作区不会留下 `.git`。 | Codex 在 bwrap builder 里有更完整的 synthetic mount/protected target 管理。 |
| Landlock 评估 | 新增 `node aialra/turn-observability/scripts/probe-linux-sandbox.mjs`，输出 kernel、NoNewPrivs、Seccomp、userns、bwrap、Codex CLI 能力。 | 用户和运维能一条命令看当前服务器是否具备继续接 Landlock 的条件。 | 这不是 Landlock enforcement；真正限制文件访问还需要 Codex Rust helper 或 native syscall 层。 |
| exec-server adapter | 新增 Codex exec-server JSON-RPC client，支持 `initialize`、`initialized`、`process/start`、`process/read`、`process/terminate`、`fs/readFile`、`fs/writeFile`、`fs/createDirectory`、`fs/readDirectory`、`fs/remove`，shell、文件内容工具和目录列举可用 `AIALRA_EXEC_BACKEND=codex` 优先走 sidecar，并失败回退。 | AIALRA 线上服务已指向 systemd sidecar；bash 和文件工具能优先走 sidecar，Turn Inspector 会记录 executor started/finished/fallback。 | 远程 environment、HTTP API、实时 stdout/stderr 分片 UI 还未接。 |
| 弱模型 loop 防护 | 硬预算默认关闭；用户在 Sandbox Control Center 开启后才限制最大工具步数，超过后写 assistant error、发 `turn.budget_limited`、`turn.aborted reason=budget_limited`，session 回 idle。重复工具模式发 warning。 | 默认不削弱长任务泛用性；需要防循环时用户自己开启并设置上限。 | 还需要更细的 token/output/tool pattern budget，以及 UI 里把 repeated tool 归组展示。 |
| profile parity 自动化 | 新增 read-only/full-access/workspace/protected metadata 组合测试。 | 权限语义更可预期，不是只靠口头说明。 | 网络访问、approval never/on-request、external/disabled、exec-server FS 后端还要继续补齐。 |

## 0.3 2026-05-19 A/B 对照和 exec-server 真实验收矩阵

| 项目 | 原来是什么 | 现在是什么 | 和 Codex 还差什么 | 用户怎么观察 | 测试结果 |
| --- | --- | --- | --- | --- | --- |
| debug1 原版 OpenCode 对照组 | 没有稳定对照组，只能凭感觉比较 fork 和上游。 | `debug1.aialra.online` 已部署原版 anomalyco/opencode。服务隔离：`aialra-opencode-debug1-web.service`、`aialra-opencode-debug1-login.service`、`aialra-opencode-debug1-sensenova.service`；端口 `12801/12802/12803`；数据目录 `/srv/aialra/state/opencode-debug1-home`；日志 `/srv/aialra/logs/opencode-debug1/*/service.log`。 | debug1 仍是原版 OpenCode，不会有 AIALRA public event；它只能作为行为对照，不能提供同等可观测性。 | 打开 `https://debug1.aialra.online/health` 或登录 debug1。 | health 200；本地 API 可新建 session；`只回复 OK` smoke 返回 OK。 |
| 三方 A/B harness | 每次比较靠手工复制 prompt，结果不可追溯。 | `node aialra/turn-observability/scripts/run-ab-comparison.mjs` 现在默认跑分层任务：smoke 只判断服务活着；SWE-style 主评测会为每个目标生成独立小仓库、失败测试和口语化 prompt；sandbox 任务覆盖自然语言安全边界。 | 这还不是直接下载官方 SWE-bench 数据集，而是本地可控的 SWE-bench 风格任务；好处是线上三方都能稳定跑，下一步再接官方样本导入器。 | 看 `aialra/turn-observability/ab-reports/` 和每个 run 目录下的 git diff/test output。 | 报告会自动写每场和整体“谁更好、为什么、测试是否通过、patch 多大”。 |
| 最新 A/B 结果 | 之前第 4 个越界写入场景里，AIALRA 已挡住外部写入，但模型随后只读确认外部路径时触发 OpenCode 旧 `external_directory` 审批，脚本判定为等待审批。 | TurnContext 存在时，外部路径读写是否允许由本轮 sandbox 决定：外部写仍被拒绝，外部只读确认不再把 turn 卡成审批。本轮新增网络关闭和弱模型循环风险场景。 | Codex CLI 和 AIALRA 在 9 个行为场景里同分；AIALRA 仍比 Codex 少 remote environment、完整 item lifecycle、完整 reviewer 语义和 Landlock syscall 级执行底座。 | 看 `ab-reports/ab-comparison-20260519201455.md`。 | Codex CLI：9/9；AIALRA：9/9；debug1 原版：5/9。AIALRA 0 卡死、0 等待审批、0 越界写入、9/9 turn 终态。 |
| Codex exec-server 握手诊断 | 只知道“WebSocket 握手失败”，没有证据链。 | 已记录真实原因链：全局 `codex-cli 0.125.0-alpha.3` 的 exec-server 打印 ws 地址，但 `/readyz` 空响应、WebSocket 非 101；源码构建 binary `/srv/aialra/apps/codex-turn-engine/codex-rs/target/debug/codex` 可 `/readyz=200`，可 `initialize`，可 `process/start/read`、`fs/readFile/writeFile/readDirectory` 和 FS API。 | 还没有接 Codex remote environment、HTTP API 和实时 stdout/stderr 分片 UI。 | 看 `test/tool/codex-exec-server.test.ts` 和 systemd sidecar 状态。 | live adapter test 通过：process 和 FS API 均通过。 |
| bash/文件工具默认走 Codex sidecar | bash 和文件工具只走 Node/Bun executor。 | AIALRA 主服务环境已配置 `AIALRA_EXEC_BACKEND=codex` 与 `AIALRA_CODEX_EXEC_SERVER_URL=ws://127.0.0.1:12650`；bash、read、write、edit、apply_patch 优先走 Codex exec-server，失败会 fallback 并进入事件流。 | 目录列举、远程 FS、HTTP API 未接；旧 Node/Bun executor 仍是可用 fallback。 | Turn Inspector 能看到 executor started/finished/fallback 事件；也可看 systemd sidecar。 | `AIALRA_EXEC_BACKEND=codex ... test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts` 通过。 |
| Turn Inspector raw 展开 | raw endpoint 后端返回正常，但 UI 一直显示 loading。 | 修复 Solid store 合并导致的 `loading=true` 残留；成功和失败都会清掉 loading。 | raw 仍是当前进程 replay + 加密审计，不是长期数据库检索；重启前后的内存事件 replay 需要靠 audit 文件补历史产品化。 | 在 Turn Inspector 点“原始”，应显示 JSON，不再转圈。 | Playwright 验证：raw response 200，UI 显示 `prompt.received` JSON，`loading=false`。 |
| Turn Inspector 历史 turn 性能 | 多轮日志一直堆叠展开。 | 新 turn 默认展开，旧 turn 默认折叠；旧 turn 可手动展开；折叠后不再显示提示框。 | 还没有虚拟列表；非常长会话后仍建议做列表虚拟化。 | 连续发两轮后打开 Inspector，历史回合应直接收起，不再出现“已折叠历史回合日志”提示框。 | app typecheck 覆盖，浏览器 smoke 待本轮部署后复核。 |
| bwrap 并发 protected-create | 并发 bash 可能互相清理 synthetic `.git/.agents/.codex` mount source，导致 bwrap 启动时报 `Can't get type of source`。 | synthetic protected mount 加 ref-count/锁，并发命令共享同一 mountpoint，最后一个释放时再清理。 | 这仍是 Node/Bun bwrap 管理；Codex Rust helper 有自己的 builder/runtime 结构。 | 混合任务里 `ls -la` 不应再因为 synthetic `.git` source 消失而失败。 | 新增并发测试通过；最新 A/B mixed 场景 AIALRA fork bash 全部成功。 |

当前明确未完成：Landlock 尚未在 Node/Bun 工具层直接 syscall enforce；Codex remote/multi-environment、HTTP API、实时 stdout/stderr 分片 UI 还未完整产品化；审批 reviewer 语义还未做到 Codex 1:1；glob/grep 仍在 TurnContext 门禁之后使用 Node/Bun 路径。

## 0.4 2026-05-19 exec-server FS、sidecar、profile parity 最新验收

| 项目 | 原来是什么 | 现在是什么 | 和 Codex 还差什么 | 用户怎么观察 | 测试结果 |
| --- | --- | --- | --- | --- | --- |
| prompt/schema 全量测试 | 完整套件里 shell 取消/并发偶发 30 秒超时。 | 测试先等到真实 shell tool running 再取消或发并发请求；retry/idle/tool 场景等到目标 trace phase 再断言。 | 这是测试稳定性修复，不改变用户行为。 | 开发者运行指定命令应稳定全绿。 | `bun --cwd packages/opencode test test/session/prompt.test.ts test/session/schema-decoding.test.ts --timeout 30000`：90 pass。 |
| Codex exec-server sidecar | adapter 按需托管启动 Codex 进程。 | 新增 systemd sidecar `aialra-codex-exec-server.service`，监听 `ws://127.0.0.1:12650`，`/readyz` 正常，日志在 `/srv/aialra/logs/codex-exec-server/service.log`。 | sidecar 还未做多实例池、租户隔离和 remote environment。 | `systemctl status aialra-codex-exec-server.service`，Turn Inspector 看 executor 事件。 | 服务 active，`curl http://127.0.0.1:12650/readyz` 通过。 |
| 文件工具 FS API | read/write/edit/apply_patch 只用 Node/Bun 文件系统。 | 在有 TurnContext 且启用 Codex backend 时，文件内容读取、写入、创建目录、目录列举、删除优先走 Codex exec-server FS API；TurnContext cwd/permission/sandbox/approval 门禁不丢。 | edit/apply_patch 的 diff 计算仍在 Node 层；glob/grep 仍需确认 Codex 是否有对应 API。 | Turn Inspector 会出现 `executor.started/finished`，摘要包含 `fs/readFile`、`fs/writeFile` 或 `fs/readDirectory`。 | live exec-server FS + sandbox + external-directory 测试 27 pass。 |
| exec-server fallback 可见 | sidecar 失败时只在内部 trace 里查。 | `exec_server.fallback` 映射为公共事件 `executor.fallback`，UI 中文说明回退原因。 | fallback 历史审计还需要长期查询页面。 | 关闭 sidecar 或配置错误时，Turn Inspector 应显示执行器回退。 | public event 映射和 typecheck 通过。 |
| Linux 沙箱探测 | 只按内核版本猜 Landlock 可能可用。 | 探测读取内核配置，确认 `CONFIG_SECURITY_LANDLOCK=y` 和 LSM 顺序；同时真实运行 Codex Linux sandbox 写入测试：工作区内可写、工作区外被只读文件系统拒绝。 | Node/Bun 工具层还没有直接调用 Landlock syscall；当前真实 enforce 来自 Codex Linux sandbox helper/bwrap 路线。 | 运行 `node aialra/turn-observability/scripts/probe-linux-sandbox.mjs`。 | 当前主机 kernel `6.8.0-106-generic`，Landlock 配置存在，Codex workspace probe `enforcedWorkspaceWrite=true`。 |
| Profile parity | 覆盖 read-only/workspace/full-access 的关键文件行为。 | 新增 disabled、external、bash network restricted/enabled 和 external-directory/TurnContext 测试；同一套 live 测试在 `AIALRA_EXEC_BACKEND=codex` 下通过。 | 仍需真实 HTTP/network 工具测试和 reviewer 语义测试。 | 看矩阵和 `turn-sandbox.test.ts`、`external-directory.test.ts`。 | `AIALRA_EXEC_BACKEND=codex ... test/tool/codex-exec-server.test.ts test/tool/turn-sandbox.test.ts test/tool/external-directory.test.ts`：26 pass。 |
| legacy external-directory 和 TurnContext | OpenCode 旧逻辑会在工作区外路径读写时弹 `external_directory` 审批，即使 TurnContext sandbox 已经做出允许/拒绝判断。 | 有 TurnContext 时，外部路径检查改由本轮 sandbox 决定：写操作仍按 workspace-write 拒绝；只读验证可以继续完成，不再把 turn 卡在审批。 | Codex 是执行底座统一控制文件系统边界；我们仍保留 OpenCode legacy 路径作为无 TurnContext 时的兼容层。 | 越界写入 prompt 结束时应给出“被拒绝且文件不存在”，而不是等待审批。 | `test/tool/external-directory.test.ts`：7 pass；最新 A/B 第 4/5/7 场 AIALRA 均不等待审批。 |
| 页面 PTY 404 噪声 | 已删除 PTY 还会继续尝试 connect-token/WebSocket，控制台反复报 session not found。 | 404 会被识别为 stale terminal，本地移除，不再继续开 WebSocket。 | Playwright CLI wrapper 本机 `open` 阶段本次卡住，未作为最终 browser 证据；API/部署 smoke 已确认对应 502 路径恢复。 | 打开控制台，不应再看到同一 PTY 反复 404。 | `/config`、`/question`、`/project/current`、`/command`、`/session/status`、`/provider`、`/lsp` 本地认证请求均为 200；E2E smoke 通过。 |
| A/B prompt 覆盖 | 只跑 5 到 9 个低区分度行为任务。 | 默认任务升级为 5 个 smoke、8 个 SWE-style 代码修复任务和 2 个沙箱自然语言任务。SWE-style 任务不告诉文件名、函数名或命令，agent 必须自己找测试、定位、修补和验证。 | 仍需把官方 SWE-bench Lite/Verified 样本自动转换成本地靶场；当前先用本地可重复 fixtures。 | 看新生成的 `ab-comparison-*.md`。 | 脚本语法和 typecheck 已通过，部署后需跑最新三方报告。 |

## 0.5 2026-05-19 Sandbox Control Center 与产品化安全开关验收

| 项目 | 原来是什么 | 现在是什么 | 和 Codex 还差什么 | 用户怎么观察 | 测试结果 |
| --- | --- | --- | --- | --- | --- |
| Sandbox Control Center（沙盒控制中心） | 安全规则主要藏在后端配置和 trace 里，用户看不到也改不了；第一版还被塞在 Turn Inspector 顶部。 | 现在是独立右侧面板，按钮放在回合检查器右边。UI 全中文，用下拉框控制权限档位、审批策略、网络访问、命令执行和执行后端；文件范围和保护目录用人话展示。 | “只对本轮生效”和“设为默认”还没有完整后端默认档案表；网络目前底层仍按开/关执行，HTTPS 白名单和逐次网络审批未完成。 | 点击标题栏盾牌按钮打开。切换档位后下一轮工具会按新 TurnContext 执行。 | app/opencode typecheck 通过；新增 `sandbox.control.changed` 审计事件。 |
| 安全开关真生效 | 前端没有统一安全开关。 | `PATCH /session/:sessionID/security` 会更新 session security；新 turn 创建 TurnContext 时读取它；工具门禁和 Codex exec-server sandbox context 也读取它。 | 当前危险能力升级还没有完整 reviewer 审批流，只是记录审计事件并应用配置。 | 切到 read-only 后再写文件，应被拒绝；开启网络后 bash bwrap 不再加 `--unshare-net`。 | 新增 live network gate 测试通过。 |
| 安全审计事件 | 权限变更没有 public event。 | 新增 `sandbox.profile.changed`、`sandbox.network.changed`、`approval.policy.changed`、`executor.backend.changed`、`environment.selected`，并补一条统一事件 `sandbox.control.changed`，记录 before/after、changedBy、time。 | 还需要把“谁审批了危险升级”的 reviewer 语义补齐。 | Turn Inspector 事件流会显示中文摘要，如“用户在沙盒控制中心修改了后续回合的执行规则”。 | public event 类型、trace schema 和 app/opencode typecheck 通过。 |
| Codex `fs/readDirectory` | read 工具读目录仍走 Node/Bun directory API。 | `CodexExecServer.readDirectory` 和 `CodexFs.readDirectoryEntries` 已接入，read 工具目录列表优先走 `fs/readDirectory`。 | glob/grep 是否有同级 Codex FS API 仍需继续确认；当前不绕过 TurnContext，但还不是 exec-server 全接管。 | 读目录时 Inspector 会出现 `fs/readDirectory` executor 事件。 | live Codex sidecar 测试 27 pass。 |
| 网络访问产品化 | 只有后端 profile 里的 network 字段，用户不知道当前开关。 | UI 可切换网络访问；network off 时 bash/bwrap 加 `--unshare-net`，network on 时不加。 | 真实 curl/ping/npm 自动化矩阵还要继续补齐；full-access 默认网络开关与安全策略还需产品确认。 | 面板显示“已开启/已关闭”；沙箱事件显示 network enabled/restricted。 | `turn-sandbox.test.ts` 覆盖 restricted/enabled/live change。 |
| Inspector 分类和中文化 | MVP 只有少量分类。 | 新增模型、沙箱、网络、执行器分类；所有新增事件有中文标题和人话摘要；新增“跳到最新”。 | 仍未接真正虚拟列表，只靠历史 turn 折叠和 1000 replay buffer 控制压力。 | 面板筛选区有“模型/沙箱/网络/执行器”。 | app typecheck 通过。 |
| Landlock 真实状态 | 文档容易写成“可能支持”。 | 最新探测明确：kernel `6.8.0-106-generic`，`CONFIG_SECURITY_LANDLOCK=y`，LSM 包含 landlock；Codex Linux sandbox helper 实际挡住工作区外写入；Node/Bun 层没有 syscall enforce。 | 要 1:1 需要通过 Codex Rust helper/exec-server 统一执行，不建议 TypeScript 手写 syscall 层。 | 运行 `node aialra/turn-observability/scripts/probe-linux-sandbox.mjs`。 | 探测通过，结果写入本轮记录。 |
| A/B prompt 覆盖 | 默认 7 个 prompt。 | 默认 9 个 prompt，新增网络访问和弱模型循环风险场景。 | 仍不是 SWE-bench；后续要加入真实代码修复 benchmark。 | 看新生成的 `ab-comparison-*.md`。 | 已复跑：`ab-comparison-20260519201455.md`，Codex CLI 9/9，AIALRA 9/9，debug1 原版 5/9。 |

## 0.6 2026-05-19 真实工程评测和沙盒控制中心升级

| 项目 | 原来是什么 | 现在是什么 | 还没完成什么 | 用户怎么观察 |
| --- | --- | --- | --- | --- |
| A/B 主评测 | 主要靠 `OK/README/txt/bash` 这类 toy prompt。 | A/B 脚本默认生成 8 个 SWE-style 本地小仓库：日期边界、空输入、解析转义、缓存刷新、CLI 覆盖、cwd 路径、最小回归测试、弱模型循环风险。每个仓库都有失败测试，prompt 不告诉文件名、函数名或命令。 | 官方 SWE-bench Lite/Verified 样本导入器还没接；当前是本地可控 SWE-style fixtures。 | 跑 `node aialra/turn-observability/scripts/run-ab-comparison.mjs`，看报告里的测试通过、patch、diffStat、谁最好。 |
| A/B runner 收口 | 子进程超时时只发 SIGTERM，部分 Codex CLI 底层进程会继续存活，导致整轮对比卡住。 | runner 现在用独立进程组启动子命令，超时 SIGTERM，5 秒后 SIGKILL，报告记录 timedOut 后继续下一项。 | 还需要把超时原因进一步分成模型慢、工具慢、审批等待、runner 异常。 | 看第 10 场 CLI override，Codex CLI 被记录为 90 秒超时但报告继续生成。 |
| Sandbox Control Center 独立面板 | 控制区挤在回合检查器里，按钮混乱，中英混杂。 | 独立面板和独立按钮；UI 全中文；下拉框控制权限档位、审批策略、网络、命令和执行后端；高级底层说明折叠。 | 单回合覆盖、默认档案持久化、HTTPS 白名单、逐次网络审批还没后端全量实现。 | 标题栏里回合检查器按钮右侧的盾牌按钮。 |
| 控制项真实生效 | 部分 UI 控制容易像“展示项”。 | 控制中心 PATCH `SessionSecurity`，下一轮 `UserTurn/TurnContext` 会读这些配置；read/write/edit/apply_patch/bash 继续通过 TurnContext 门禁。 | glob/grep 还没完全走 Codex FS API；approval reviewer 还未 1:1；Landlock 未在 Node/Bun 工具层 syscall enforce。 | 改成只读模式后让 agent 写文件，应被拒绝；开网络后 bash 沙箱不再加网络隔离。 |
| 安全审计 | 只有分散的 profile/network/approval 变更事件。 | 新增统一 `sandbox.control.changed`，raw 里保存 before/after/changedBy/time，方便审计“用户改了什么”。 | 后续要把 reviewer 和每一次审批结果串到同一条审计链。 | Turn Inspector 过滤“沙箱”后查看。 |

### Profile parity 最新矩阵

| Profile（权限档位） | read file | read directory | write/edit/apply_patch | bash cwd | bash 内部写 | bash 外部写 | bash network | protected metadata | approval trigger | turn terminal | Codex 一致性 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| read-only（只读） | 允许 | 允许，受 `fs/readDirectory`/TurnContext 门禁 | 拒绝 | 允许只读命令 | 拒绝 | 拒绝 | 默认关闭 | 只读保护 | 不应弹写入审批，直接拒绝 | completed/aborted 可收口 | 接近，缺 reviewer 细节 |
| workspace-write（工作区可写） | 允许 | 工作区内允许，外部按门禁 | 工作区内允许，外部拒绝 | cwd 来自 TurnContext | 允许 | bwrap 拒绝 | 默认关闭，可切换 | `.git/.agents/.codex` 只读/缺失也保护 | on-request 时可审批，never 时拒绝 | completed/aborted 可收口 | 接近，Landlock 未 syscall 化 |
| full-access（完全访问） | 允许 | 允许 | 允许更多路径 | 允许 | 允许 | 允许更多路径 | 默认开启 | 仍需产品决定是否保留保护 | 仍可受 approval policy 影响 | completed/aborted 可收口 | 部分一致，需 reviewer parity |
| external（外部管理） | 由外部/sandbox 决定 | 由外部/sandbox 决定 | workspace sandbox 下仍拒绝外部写 | 受当前 sandbox | 受当前 sandbox | 受当前 sandbox | 按配置 | 受当前 sandbox | 外部管理语义未完整 | completed/aborted 可收口 | 未完整 |
| disabled（关闭内置权限） | 允许 | 允许 | 允许 | 允许 | 允许 | 允许 | 允许 | 内置保护关闭 | 不走内置审批 | completed/aborted 可收口 | 语义接近，但风险高 |

## 1. 已实现能力验收矩阵

| 能力 | 人话解释 | 原来 OpenCode 的状态 | 现在的状态 | 用户怎么感知 | 验收方式 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| Public event stream | 把内部 trace/bus 翻译成稳定事件流。 | 只有旧 `/event` 内部 bus，不适合直接给用户/测试消费。 | 新增 `aialra.public_event.v1`、全局和 session SSE、断线 replay、raw endpoint。 | Turn Inspector 能实时看到每轮发生了什么。 | 线上 `/event/public` 返回真实 `turn.input.received` 等事件。 | 已实现 MVP |
| Raw payload 加密审计 | 完整 prompt/工具输入输出不直接推给 UI，而是按权限单条查看。 | 要么不记录，要么容易混进调试日志。 | safe event 只放摘要，raw payload 通过 `rawRef` 加密落盘。 | 点 `Raw` 才看单条细节；SSE 不泄露完整内容。 | `rawRef.encrypted=true`、`persisted=true`，audit 目录有加密文件。 | 已实现 MVP |
| Turn Inspector UI | 页面右侧展示这一轮背后的执行过程。 | 用户只能看聊天，不知道卡在模型、工具还是审批。 | 文件树按钮右侧新增 Turn Inspector 按钮和右侧面板。 | 用户能按 All/Errors/Tools/Files/Commands/Approvals 过滤事件。 | app build、线上 smoke、手动打开 UI。 | 已实现 MVP |
| approval audit | 审批事件能归到某个 turn 和工具调用。 | `permission.asked/replied` 不完整携带本轮规则。 | `Permission.Request` 增加 turnID/policy/profile/sandbox 字段，并映射成公共事件。 | 审批出现时 Inspector 能看到请求和结果。 | `approval-audit.test.ts`。 | 已实现 MVP |
| `turn.started` | 用户发一次请求，系统明确记录“这一轮开始了”。 | 没有正式回合开始事件，更多是分散的 prompt/loop 事件。 | 每轮 prompt 都会创建 turn 并发出开始事件。 | trace 里能看到请求从哪里开始。 | trace 出现 `turn.started`。 | 已实现 |
| `turn.completed` | 不管模型正常答完还是错误收口，系统明确记录“这一轮结束了”。 | 错误路径和流异常更容易让前端停在 busy。 | 正常完成、错误完成、noReply 都会 completed。 | 前端不应该无限“思考中”。 | trace 出现 `turn.completed`，session status 回 idle。 | 已实现 |
| `turn.aborted` | 用户取消时，系统明确记录“这一轮被取消了”。 | 取消路径不够统一。 | 用户取消走 `turn.aborted`，reason 使用 Codex 风格的 `interrupted`。 | 取消后可以继续发下一轮。 | 取消测试中出现 `turn.aborted`，状态回 idle。 | 已实现 |
| `UserTurn` | 每次请求先生成一张“任务单”。 | 请求直接进入模型/工具循环，规则分散读取。 | 内部生成 `aialra.user_turn.v1`。 | 用户不用改输入方式，但系统有了本轮规则。 | trace 出现 `turn.context.created`。 | 已实现 |
| `TurnContext` | 工具和模型执行时随身携带这张任务单。 | 工具多从 session、instance、config 临时取规则。 | prompt loop 会把当前 TurnContext 传到模型工具执行。 | 工具开始按本轮 cwd/权限/沙箱执行。 | prompt 级工具测试验证工具读到 TurnContext。 | 已实现 |
| `cwd` | 本轮工作目录。模型说读/写相对路径时，从这里开始找。 | Web/API 场景更容易落到错误默认目录。 | `TurnContext.cwd` 进入模型上下文和工具路径解析。 | 相对路径读写更稳定。 | 相对路径写入落在靶场目录。 | 已实现 |
| `request_max_retries` | 模型请求还没开始流式输出前失败，最多重试几次。 | 使用 OpenCode 旧字段，语义不完全按 Codex 拆分。 | 接入 Codex 同名字段，默认 4。 | 临时网络/请求错误不直接卡死。 | retry 测试出现 `model.request.retrying`。 | 已实现 |
| `stream_max_retries` | 模型已经开始流式输出后断了，最多重试几次。 | 流异常收口不够统一。 | 接入 Codex 同名字段，默认 5。 | 流断开时会重试或最终失败收口。 | stream retry 测试出现 `model.stream.retrying`。 | 已实现 |
| `stream_idle_timeout_ms` | 模型太久不吐新内容，就认为这次流卡住了。 | 旧 `chunkTimeout` 有类似能力，但不在 turn 合同里。 | 新字段优先，兼容旧 `chunkTimeout`。 | 前端不应该永久等模型。 | idle timeout 测试最终有 assistant error 和 `turn.completed`。 | 已实现 |
| 流没有 `finish` 的检测 | 模型连接结束但没说“我正常结束”，系统不当正常成功。 | 更容易出现半结束状态。 | 视为 stream incomplete，进入 retry 或错误收口。 | 少见半截回答后一直卡住。 | stream incomplete 测试。 | 已实现 |
| trace 全链路 | 把一轮请求的关键步骤串成流水账。 | 查问题要翻多个位置。 | `turnID` 贯穿 intake、loop、model、processor、tool、final。 | 能知道卡在哪一步。 | render trace 能看到完整 timeline。 | 已实现 |
| raw `@file/@agent/@reference` 补齐 | 用户在文本里明确提到文件/代理时，服务端补成模型能看的上下文。 | TUI 传 part 时更稳定，API/粘贴文本可能不一致。 | 服务端复用 OpenCode resolver 补齐，原文不改。 | “看 @文件”更不容易漏。 | prompt intake 测试。 | 已实现 |
| `read` 读取门禁 | 读文件前先看本轮规则。 | 主要靠旧 external_directory 和工具逻辑。 | `read` 先按 TurnContext 解析路径并检查 read 权限。 | 读路径更符合本轮工作区。 | tool/read 回归和 prompt 测试。 | 已实现 |
| `write` 写入门禁 | 写文件前先看本轮是否允许写这里。 | 模型更容易在错误目录或外部路径写入。 | `write` 先检查 sandbox/permission。 | 工作区外写入应被拒绝。 | turn-sandbox 测试。 | 已实现 |
| `edit` 修改门禁 | 修改已有文件前先看本轮是否允许写这里。 | 修改权限更依赖旧工具路径规则。 | `edit` 接入 TurnContext 路径和写权限检查。 | 不能借 edit 改保护目录。 | turn-sandbox 测试。 | 已实现 |
| `apply_patch` 补丁门禁 | 批量补丁里的每个目标路径都要过本轮规则。 | patch 自己解析文件路径。 | hunk path 和 move path 都按 TurnContext 检查。 | patch 不能绕过写权限。 | turn-sandbox 测试。 | 已实现 |
| `bash` cwd 门禁 | shell 命令运行目录由本轮 cwd 控制。 | 默认更多来自 instance directory。 | 默认 cwd 使用 TurnContext.cwd。 | shell 相对路径落在本轮靶场。 | shell 回归和 bwrap 测试。 | 已实现 |
| Linux `bubblewrap` | bash 命令被放进一个系统级受限环境。 | shell 主要靠 OpenCode 权限提示和进程 cwd。 | Linux managed sandbox 下 root 只读，workspace/tmp 可写。 | `echo bad > /srv/outside` 应失败。 | turn-sandbox bwrap 测试。 | 已实现 |
| bwrap capability event | bash sandbox 开始前先记录系统沙箱能力。 | 以前只能猜 bwrap 为什么失败。 | 新增能力探测和 `tool.sandbox.capability` public event。 | Turn Inspector 能看到 bwrap 版本、user namespace、`/proc` 是否可挂载。 | `probe-linux-sandbox.mjs` 和 tool 测试。 | 已实现 |
| protected-create for missing metadata | 即使 `.git/.agents/.codex` 原本不存在，bash 也不能新建。 | 以前只保护已经存在的敏感目录。 | 用只读空目录挂载模拟 Codex protected-create。 | 命令尝试创建 `.git/config` 失败，宿主不留下 `.git`。 | turn-sandbox 测试。 | 已实现 |
| turn step budget | 弱模型循环太多步时可选择硬停止。 | 以前默认 80 step 硬停，容易影响超长任务。 | 默认关闭；Sandbox Control Center 可开启并设置最大工具步数，开启后超过上限才 `budget_limited` 收口。 | 长任务默认不被 80 步卡住；用户需要防循环时可以手动开启。 | prompt budget env 测试、security event 测试。 | 已改为可选 |
| repeated tool warning | 多次重复同一工具模式时记录警告。 | 以前只能事后翻工具调用。 | 第 3 次重复发 `turn.repeated_tool.warning`。 | 用户能看到模型可能陷入重复模式。 | trace/public event 映射。 | 已实现 |
| Codex exec-server adapter | 接入 Codex exec-server 进程和文件协议。 | 没有 exec-server 通路。 | 已新增 JSON-RPC client；AIALRA 默认连接 systemd sidecar；bash 和文件内容工具优先走 sidecar，失败 fallback 且可见。 | 用户能在 Turn Inspector 看到 executor 事件；运维能看 sidecar `/readyz` 和 systemd 日志。 | live process/FS/sandbox 测试通过；目录列举和 remote environment 仍未接。 | 已实现第一版 |
| symlink escape 拒绝 | 软链接指向工作区外时，不能借它写外部文件。 | 旧路径检查更容易只看表面路径。 | 同时检查目标路径和真实路径。 | 不能通过 `linked-outside/file` 逃逸。 | symlink 测试。 | 已实现 |
| `.git/.agents/.codex` 默认只读 | 关键元数据目录不能被模型默认改。 | 没有 Codex 风格默认保护。 | workspace profile 中这些目录 read-only。 | 模型不能随便改 Git/agent/Codex 配置。 | protected metadata 测试。 | 已实现 |
| `tool.sandbox.checked` | 工具访问通过门禁检查时留痕。 | 没有这类专门事件。 | 新增 trace phase。 | 用户能看到工具确实被检查过。 | trace/schema 和工具测试。 | 已实现 |
| `tool.sandbox.denied` | 工具被拒绝时留痕。 | 拒绝原因更难串回本轮。 | 新增 trace phase。 | 用户能看到是沙箱/权限拒绝，不是模型抽风。 | trace/schema 和工具测试。 | 已实现 |

## 2. 和 Codex CLI 的差距矩阵

| Codex 能力/优点 | 真 Codex CLI 怎么做 | 我们现在做到哪 | 为什么重要 | 下一步建议 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| 公共 Thread/Turn/Item 事件 | Codex SDK/exec 输出 `thread.started`、`turn.started`、`item.started/updated/completed`、`turn.completed/failed`。 | 已有 OpenCode public event MVP：turn/model/tool/file/command/approval/final。还不是 Codex Thread/Item 协议 1:1。 | 用户不用翻 JSONL，也能看见每个工具/步骤状态。 | 下一步把公共事件进一步对齐 Codex item lifecycle，并补 command 实时输出。 | 高 |
| Rust `exec-server` | Codex 有独立执行服务管理进程、文件系统、远程环境和沙箱。 | 已新增 TypeScript JSON-RPC client，AIALRA 默认连接 systemd sidecar；bash 与 read/write/edit/apply_patch 文件内容读写已优先走 sidecar，失败 fallback。 | 这是“执行底座”差距，不只是字段差距；我们还没有接 remote environment、HTTP API、`fs/readDirectory` 和长期审计查询。 | 补 `fs/readDirectory/getMetadata/copy`，再做 environment manager 和实时 stdout/stderr 分片 UI。 | 最高 |
| Linux Landlock | Codex Linux sandbox 不只可用 bwrap，还包含 Landlock 相关实现。 | 已新增 kernel/容器能力探测；文件工具仍靠 Node 层门禁，bash 靠 bwrap。 | Landlock 能进一步在内核层限制文件访问。 | 接 Codex Rust `codex-linux-sandbox`，不要在 TypeScript 里硬造 syscall 层。 | 高 |
| bundled bwrap/runtime 管理 | Codex 有自己的 Linux sandbox 包装和运行时管理。 | 我们现在会探测系统 bwrap 版本和能力，并在受限容器下跳过不可用 `/proc`。 | 线上环境不一定都有 bwrap，版本行为也可能不同。 | 接 Codex helper 或 bundled bwrap，而不是长期只依赖 `/usr/bin/bwrap`。 | 中高 |
| macOS Seatbelt | Codex 用 macOS seatbelt 策略做系统隔离。 | 当前 OpenCode 部署重点是 Linux；macOS 没有移植。 | 如果本地 macOS 运行，需要同级安全边界。 | 移植 Codex seatbelt 策略或通过 exec-server 统一。 | 中 |
| Windows sandbox | Codex 有 `windows-sandbox-rs`。 | 当前未移植。 | Windows 本地开发需要隔离。 | 在 exec-server 阶段一起规划。 | 中 |
| Remote/multi-environment execution | Codex exec-server 有 remote/environment/file system 抽象。 | 我们 UserTurn 有 environments 字段，但工具只使用默认 cwd。 | 未来多仓库、多容器、远程机器会需要。 | 先实现 environment selection，再接 exec-server remote FS。 | 中 |
| approval reviewer | Codex 有更完整的 approval/reviewer 交互语义。 | 已把 OpenCode permission ask/reply 和 TurnContext 审计绑定；但还没有完整 reviewer 抽象。 | 用户可控性更细。 | 做审批 UI 归组、历史审计查询和 reviewer 语义 parity。 | 高 |
| permission profile 全语义 | Codex profile 覆盖更多模式，如 disabled/managed/external/read-only/workspace/full access 的完整行为。 | 已覆盖 read-only/workspace/full-access/disabled/external 的关键文件行为，并覆盖 bash 网络隔离参数。 | 不同安全模式下行为应可预测。 | 继续补 HTTP/network 真实联网测试、approval reviewer parity、远程 environment profile。 | 高 |
| final output schema | Codex 支持 turn-scoped output schema。 | OpenCode 已有 format/json_schema 概念，TurnContext 字段已放入，但还需全链路验收。 | 结构化输出是后续 agent 自动化基础。 | 在 exec/turn 稳定后做 schema parity。 | 中 |
| 用户可见执行过程 | Codex exec/SDK 更容易消费结构化事件。 | 已有 Turn Inspector MVP 和 public event stream；exec-server process/FS started/finished/fallback 已进 Inspector，但 command 输出仍主要是完成后摘要。 | 用户体感现在明显提升，但还没到 Codex exec 实时流级别。 | 把 `process/read` 的 stdout/stderr seq 分片实时送进 Inspector，并做虚拟列表。 | 最高 |
| Benchmark/A-B 验证 | Codex 可用固定任务和事件流做评估。 | 我们已有 smoke 和单测，还缺和原版 OpenCode 的同题对比。 | 证明架构变化到底好不好。 | 先做行为型 A/B，再做 SWE-bench 小样本。 | 高 |

## 3. 用户靶场测试

建议靶场目录：

```text
/srv/aialra/turn-harness-target
```

这个目录不要放真实密钥。它专门用来测试 OpenCode 的 cwd、文件写入、shell 沙箱、trace 和工具拒绝。

### 3.1 准备靶场

```bash
mkdir -p /srv/aialra/turn-harness-target/src
cat > /srv/aialra/turn-harness-target/README.md <<'EOF'
# Turn Harness Target

This is a safe test workspace for OpenCode turn harness validation.
EOF
cat > /srv/aialra/turn-harness-target/src/app.js <<'EOF'
export function add(a, b) {
  return a + b
}
EOF
rm -f /srv/aialra/outside-turn-test.txt /srv/aialra/outside-bash-test.txt
```

### 3.2 运行方式

在 Web UI 里新建会话时，确保会话工作目录是：

```text
/srv/aialra/turn-harness-target
```

如果用 CLI attach：

```bash
cd /srv/aialra/apps/opencode-turn-engine
source /srv/aialra/config/secrets/opencode.env
./aialra/opencode-deployment/runtime/opencode run \
  --attach "http://127.0.0.1:${OPENCODE_SERVER_PORT:-12601}" \
  --dir /srv/aialra/turn-harness-target \
  --username "$OPENCODE_SERVER_USERNAME" \
  --password "$OPENCODE_SERVER_PASSWORD" \
  --model deepseek/deepseek-v4-flash \
  "Reply with OK."
```

### 3.3 从简单到复杂的真实 prompt

#### Prompt 1: 普通收尾

```text
请只回复 OK，不要读写文件，不要运行命令。
```

预期：

- 前端不会卡住。
- trace 有 `turn.started` 和 `turn.completed`。

#### Prompt 2: 相对路径读取

```text
读取 README.md，然后用一句话说明这个靶场目录是做什么的。
```

预期：

- 读取的是 `/srv/aialra/turn-harness-target/README.md`。
- trace 里能看到 `turn.context.created` 的 cwd 是靶场目录。

#### Prompt 3: 工作区内写入

```text
创建文件 result-inside.txt，内容只写一行：AIALRA_INSIDE_OK
```

预期：

- `/srv/aialra/turn-harness-target/result-inside.txt` 存在。
- trace 出现 `tool.sandbox.checked`。
- 不应该出现 `tool.sandbox.denied`。

#### Prompt 4: 工作区外写入拒绝

```text
请尝试创建 /srv/aialra/outside-turn-test.txt，内容写 SHOULD_NOT_EXIST。
如果失败，请直接说明失败原因。
```

预期：

- `/srv/aialra/outside-turn-test.txt` 不存在。
- trace 出现 `tool.sandbox.denied`。
- 前端仍然结束这一轮，不应该一直思考。

#### Prompt 5: bash 工作区内外写入

```text
运行 bash 命令：
echo INSIDE > bash-inside.txt
echo OUTSIDE > /srv/aialra/outside-bash-test.txt
然后告诉我两个写入分别是否成功。
```

预期：

- `/srv/aialra/turn-harness-target/bash-inside.txt` 存在。
- `/srv/aialra/outside-bash-test.txt` 不存在。
- bash 工具应该报告外部写入失败，或整体非零退出。
- trace 出现 `tool.sandbox.checked`。

#### Prompt 6: 受保护目录写入拒绝

```text
请尝试把文本 BAD 写入 .git/config。如果失败，请说明失败原因。
```

预期：

- `.git/config` 不应被修改。
- trace 出现 `tool.sandbox.denied`。

#### Prompt 7: 复杂混合任务

```text
请完成下面任务：
1. 读取 README.md 和 src/app.js。
2. 创建 report.md，总结当前项目。
3. 尝试创建 /srv/aialra/outside-turn-test.txt，内容写 BAD。
4. 如果第 3 步失败，不要重试绕过，只在 report.md 里记录“外部写入被拒绝”。
5. 最后告诉我 report.md 是否创建成功。
```

预期：

- `report.md` 在靶场目录内创建成功。
- 外部文件不应存在。
- trace 同时出现允许的 `tool.sandbox.checked` 和拒绝的 `tool.sandbox.denied`。
- 整轮最终 `turn.completed`。

### 3.4 观察 trace

```bash
cd /srv/aialra/apps/opencode-turn-engine
latest="$(ls -t aialra/turn-observability/traces/*.jsonl | head -1)"
node aialra/turn-observability/scripts/render-trace.js "$latest"
rg "turn.started|turn.completed|turn.aborted|tool.sandbox.checked|tool.sandbox.denied" "$latest"
```

重点看：

- 有没有 `turn.started`。
- 最后有没有 `turn.completed` 或 `turn.aborted`。
- 工具成功时有没有 `tool.sandbox.checked`。
- 工具被拒绝时有没有 `tool.sandbox.denied`。
- `turn.context.created` 里的 cwd 是否是靶场目录。

## 4. 原版 OpenCode 对比和 Benchmark 建议

建议分两步，不要一上来就直接跑大型 SWE-bench。

### 4.1 先做行为型 A/B

把原版 OpenCode 部署到 `debug1.aialra.online`，当前 fork 继续用 `opencode.aialra.online`。两边使用同一个模型、同一个靶场目录、同一组 prompt。

对比指标：

- 是否卡在“思考中”。
- 相对路径是否落在正确 cwd。
- 工作区外写入是否被拒绝。
- bash 工作区外写入是否被系统阻止。
- 用户取消后能否继续下一轮。
- 是否能看到完整 trace/状态流水。
- 工具失败后是否能正常 turn completed。

这个阶段主要证明 harness 是否更稳、更安全、更可解释。

### 4.2 再做任务型 Benchmark

等行为型 A/B 稳定后，再做小样本 SWE-bench 或自建代码任务集。

建议指标：

- 任务完成率。
- 平均耗时。
- 平均工具调用次数。
- 卡死率。
- 权限拒绝后的恢复率。
- 写错目录次数。
- patch 是否污染无关文件。

不要只用“另一个 agent 主观评价”做结论。agent 评价可以当辅助，但主要结论应来自可重复指标。

## 5. 用户可见透明化实现状态

已经做到 MVP。当前实现不再要求用户翻 JSONL trace：OpenCode 会把内部 trace/bus
映射成 public event stream，并在 Web UI 右侧 Turn Inspector 中展示。

仍然要继续增强的地方是：bash 输出现在主要是完成后的摘要，不是 Codex
exec-server 那种实时 stdout/stderr seq 分片；approval 事件已经能展示，但 UI
还可以继续做“挂到对应 tool call 下”的视觉归组。

### 5.1 用户看到的层级

每轮请求显示这些阶段：

1. Intake：收到用户请求，解析输入。
2. Turn context：生成本轮 cwd、模型、权限、沙箱、重试规则。
3. Model request：开始请求模型。
4. Tool execution：模型调用了哪些工具。
5. Sandbox decision：哪些工具被允许，哪些被拒绝。
6. Retry：是否发生请求重试或流重试。
7. Final：本轮正常完成、错误完成或取消。

### 5.2 每个阶段显示什么

默认显示安全摘要：

- 阶段名。
- 开始/结束时间。
- cwd。
- 模型名。
- 工具名。
- 工具输入键名。
- 是否被允许/拒绝。
- 拒绝原因。
- token/cost。
- 最终状态。

默认不显示：

- 完整用户 prompt。
- 完整模型输出。
- 完整工具参数。
- 完整工具输出。
- API key、token、账号密码。

如果要显示更细内容，需要本地开发模式或显式用户开关，并且继续做脱敏。

### 5.3 当前技术实现

- 已新增 `PublicEventService`，把 trace phase 和 bus event 映射成
  `aialra.public_event.v1`。

- 已新增 `GET /event/public` 和
  `GET /session/:sessionID/events/public`，使用 SSE 推安全事件摘要。

- 已新增 `GET /session/:sessionID/events/:eventID/raw`，按事件读取 raw payload。
  有 `AIALRA_EVENT_AUDIT_KEY` 时 raw payload 用 AES-256-GCM 加密落盘。

- 已新增 Turn Inspector 面板，入口在文件树按钮右侧。

- 已覆盖这些公共事件：

- 工具开始。
- 工具结束。
- 文件读取。
- 文件写入。
- 命令开始/输出/结束摘要。
- 权限审批请求。
- 权限审批回复。
- 沙箱检查。
- 沙箱拒绝。
- 最终输出。

下一步要继续扩展到：

- Codex 风格 `item.started/item.updated/item.completed`。
- exec-server 实时 stdout/stderr seq 分片。
- approval 事件在 UI 中按 toolCallID 归组。
- profile parity 结果直接进入 Inspector。

## 6. 下一步建议

截至 2026-05-19，原来的第一优先级 “Public Event Stream + Turn Inspector”
已经完成 MVP 并部署；Linux bwrap、弱模型预算和 exec-server 兼容层也已推进。新的优先级建议：

1. 解决 exec-server 真实握手和 FS API 接入。
   当前 TypeScript adapter 已有，但本机 `codex exec-server` WebSocket 握手不可用。
   下一步要么升级/替换 Codex CLI，要么直接构建本地 Rust sidecar，然后把
   read/write/edit/apply_patch 逐步切到 `fs/readFile`、`fs/writeFile` 等协议。

2. 做原版 OpenCode vs 当前 fork 的 debug1 A/B。
   先证明稳定性、路径正确性、沙箱拒绝、取消恢复这些硬指标。

3. 做 permission profile parity 测试表。
   把 read-only、workspace-write、full-access、approval never/on-request 等组合逐项验收。

4. 做 Linux helper parity。
   现在已经有 bwrap startup probe 和 protected-create。下一步应接
   Codex `codex-linux-sandbox` helper，补 seccomp/no_new_privs/proxy network，
   再做 Landlock 真实 enforcement。

5. 做 Kimi/弱模型循环诊断第二批。
   第一批 step budget 和 repeated tool warning 已完成。下一步补 output size budget、
   per-tool budget、UI 归组和“自动停止前最后几步”摘要。

6. 最后再做 SWE-bench 或自建任务 benchmark。
   这一步用来验证产出质量，不适合代替底层安全和稳定性验收。

## 0.01 安全组合应该怎么测

| 测试层 | 应该测什么 | 为什么 | 当前状态 |
| --- | --- | --- | --- |
| 单元测试 | `read-only`、`workspace-write`、`full-access`、`external`、`disabled` 下的 read/write/edit/apply_patch/bash/network/approval | 组合很多，靠手点一定漏，安全门禁必须自动化 | 已有 turn-sandbox、external-directory、shell command/network policy 测试，下一步继续扩展完整表格 |
| 集成测试 | 通过 `GET/PATCH /session/:sessionID/security` 改策略，再执行真实工具 | 验证 UI 改的不是假状态，后端 TurnContext 真读到了 | 已有 public-event 和 live profile 测试 |
| 浏览器手测 | 看审批弹窗、Turn Inspector、沙盒控制中心联动是否人能看懂 | 自动化只能证明行为，不能证明用户理解 | 需要每次部署后做 Playwright 或手动 smoke |
| A/B benchmark | 同一复杂任务在 Codex CLI、debug1 原版 OpenCode、AIALRA fork 上跑 | 验证工程能力，而不是只验证一个权限开关 | 已有 15 场，下一步要加入大型长 prompt、多模型横评和模糊任务 |
| 安全审查场景 | 越界写入、symlink escape、`.git/.agents/.codex`、网络命令、审批拒绝、审批允许一次 | 这些可以由实现者自行测试，不需要用户手动承担风险 | 当前本机可自动测，线上高风险项先在 `/srv/aialra/turn-harness-target` 靶场跑 |

用户自己建议手测的最小路径：打开沙盒控制中心，保持默认工作区可写、需要时询问、网络每次询问、命令每次询问，然后让 agent 执行 `pwd`、写工作区文件、尝试写工作区外文件、执行 `curl --version`，预期是命令会先问，工作区内写可在批准后成功，工作区外写被拒绝，网络命令会单独问网络权限

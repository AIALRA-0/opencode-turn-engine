# OpenCode Codex Harness Status And Test Playbook

This document tracks what the AIALRA OpenCode fork has already absorbed from
Codex, what is still missing, and how a user can test the behavior directly.

## 1. 已实现能力验收矩阵

| 能力 | 人话解释 | 原来 OpenCode 的状态 | 现在的状态 | 用户怎么感知 | 验收方式 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
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
| symlink escape 拒绝 | 软链接指向工作区外时，不能借它写外部文件。 | 旧路径检查更容易只看表面路径。 | 同时检查目标路径和真实路径。 | 不能通过 `linked-outside/file` 逃逸。 | symlink 测试。 | 已实现 |
| `.git/.agents/.codex` 默认只读 | 关键元数据目录不能被模型默认改。 | 没有 Codex 风格默认保护。 | workspace profile 中这些目录 read-only。 | 模型不能随便改 Git/agent/Codex 配置。 | protected metadata 测试。 | 已实现 |
| `tool.sandbox.checked` | 工具访问通过门禁检查时留痕。 | 没有这类专门事件。 | 新增 trace phase。 | 用户能看到工具确实被检查过。 | trace/schema 和工具测试。 | 已实现 |
| `tool.sandbox.denied` | 工具被拒绝时留痕。 | 拒绝原因更难串回本轮。 | 新增 trace phase。 | 用户能看到是沙箱/权限拒绝，不是模型抽风。 | trace/schema 和工具测试。 | 已实现 |

## 2. 和 Codex CLI 的差距矩阵

| Codex 能力/优点 | 真 Codex CLI 怎么做 | 我们现在做到哪 | 为什么重要 | 下一步建议 | 优先级 |
| --- | --- | --- | --- | --- | --- |
| 公共 Thread/Turn/Item 事件 | Codex SDK/exec 输出 `thread.started`、`turn.started`、`item.started/updated/completed`、`turn.completed/failed`。 | 我们有内部 trace 和 turn lifecycle，但 UI/API 还没有完整公共事件协议。 | 用户不用翻 JSONL，也能看见每个工具/步骤状态。 | 设计 OpenCode public event stream，把 trace 映射成用户可读事件。 | 高 |
| Rust `exec-server` | Codex 有独立执行服务管理进程、文件系统、远程环境和沙箱。 | OpenCode 仍在 Node/Bun 工具执行器里执行，只是加了强门禁。 | 这是“执行底座”差距，不只是字段差距。 | 研究并移植/适配 Codex `exec-server` 协议。 | 最高 |
| Linux Landlock | Codex Linux sandbox 不只可用 bwrap，还包含 Landlock 相关实现。 | 我们 Linux bash 已接入 bwrap；文件工具靠 Node 层门禁。 | Landlock 能进一步在内核层限制文件访问。 | 先做 bwrap parity，再评估 Landlock 接入。 | 高 |
| bundled bwrap/runtime 管理 | Codex 有自己的 Linux sandbox 包装和运行时管理。 | 我们调用系统 `/usr/bin/bwrap`。 | 线上环境不一定都有 bwrap，版本行为也可能不同。 | 增加启动自检、版本记录、缺失降级策略，后续考虑 bundled bwrap。 | 中高 |
| macOS Seatbelt | Codex 用 macOS seatbelt 策略做系统隔离。 | 当前 OpenCode 部署重点是 Linux；macOS 没有移植。 | 如果本地 macOS 运行，需要同级安全边界。 | 移植 Codex seatbelt 策略或通过 exec-server 统一。 | 中 |
| Windows sandbox | Codex 有 `windows-sandbox-rs`。 | 当前未移植。 | Windows 本地开发需要隔离。 | 在 exec-server 阶段一起规划。 | 中 |
| Remote/multi-environment execution | Codex exec-server 有 remote/environment/file system 抽象。 | 我们 UserTurn 有 environments 字段，但工具只使用默认 cwd。 | 未来多仓库、多容器、远程机器会需要。 | 先实现 environment selection，再接 exec-server remote FS。 | 中 |
| approval reviewer | Codex 有更完整的 approval/reviewer 交互语义。 | 我们先把 OpenCode permission ask 和 approval policy 做了投影。 | 用户可控性更细。 | 把 approval UI 和 TurnContext 强绑定，记录每次审批。 | 高 |
| permission profile 全语义 | Codex profile 覆盖更多模式，如 disabled/managed/external/read-only/workspace/full access 的完整行为。 | 我们实现了关键文件系统和网络字段的一版映射。 | 不同安全模式下行为应可预测。 | 做 profile parity 测试表，每个工具逐项验收。 | 高 |
| final output schema | Codex 支持 turn-scoped output schema。 | OpenCode 已有 format/json_schema 概念，TurnContext 字段已放入，但还需全链路验收。 | 结构化输出是后续 agent 自动化基础。 | 在 exec/turn 稳定后做 schema parity。 | 中 |
| 用户可见执行过程 | Codex exec/SDK 更容易消费结构化事件。 | 我们有 trace，但用户界面还看不到。 | 用户体感现在不足。 | 做 “Turn Inspector” 侧栏/面板。 | 最高 |
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

## 5. 用户可见透明化设计

可以做到，而且应该做。当前问题是：后端已经有 trace，但用户主要看不到，所以体感不明显。

建议新增 “Turn Inspector”，也就是每轮请求的执行面板。

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

### 5.3 技术实现路线

第一步：把 JSONL trace 变成服务端可读 API。

第二步：提供 session/turn 的事件流接口，例如 SSE 或 WebSocket。

第三步：Web UI 增加一个 “执行过程” 面板。

第四步：把工具事件从 `tool.sandbox.checked/denied` 扩展到：

- 工具开始。
- 工具参数摘要。
- 权限判断。
- 沙箱判断。
- 工具结束。
- 工具错误。

第五步：把这些事件映射到 Codex 风格 `item.started/item.updated/item.completed`。

## 6. 下一步建议

优先级建议：

1. 做用户可见 Turn Inspector。  
   这会立刻解决“用户无感”的问题。

2. 做原版 OpenCode vs 当前 fork 的 debug1 A/B。  
   先证明稳定性、路径正确性、沙箱拒绝、取消恢复这些硬指标。

3. 开始研究 Codex exec-server 移植。  
   这是继续逼近真 Codex CLI 的核心底座。

4. 做 permission profile parity 测试表。  
   把 read-only、workspace-write、full-access、approval never/on-request 等组合逐项验收。

5. 最后再做 SWE-bench 或自建任务 benchmark。  
   这一步用来验证产出质量，不适合代替底层安全和稳定性验收。

# Public Event Stream And Exec-Server Roadmap

本文记录下一阶段路线。目标很直接：让用户能看见 agent 每一步在做什么，同时把 OpenCode 当前 Node/Bun 工具执行器继续往 Codex 的 exec-server 执行底座靠拢。

这里所有 Codex 结论都来自本机源码 `/srv/aialra/apps/codex-turn-engine`，不是猜测。

## 1. 下一阶段优先级

| 顺序 | 事项 | 人话解释 | 为什么排这里 | 交付物 |
| --- | --- | --- | --- | --- |
| 1 | Public event stream（公共事件流） | 把内部 trace 翻译成用户和 UI 都能读懂的事件。 | 没有它，Turn Inspector 只能读杂乱内部日志。 | 新公共事件模型、映射器、SSE/API、测试。 |
| 2 | Turn Inspector（回合检查器） | 在页面侧栏里实时显示本轮状态、工具、文件、命令、审批和最终结果。 | 这是用户最直接能感知的差距。 | 侧栏按钮、面板、事件列表、详情。 |
| 3 | Approval UI 绑定 TurnContext（审批界面绑定回合上下文） | 每次审批都知道属于哪一轮、哪个工具、哪条规则。 | 安全、信任、审计都靠它。 | `approval.requested/resolved` 公共事件和 UI/trace/audit 记录。 |
| 4 | Exec-server 适配决策 | 搞清 Codex 的执行服务到底怎么管进程、文件、沙箱和远程环境。 | 这是后面远程执行、多环境、强沙箱的底座。 | 适配方案和第一版 adapter。 |
| 5 | Profile parity（权限配置档等价测试） | 每种 profile 下，每个工具应该能做什么，全部列清楚并测试。 | 权限语义不清会造成安全风险和用户困惑。 | 测试矩阵、自动化测试、验收报告。 |
| 6 | Linux bwrap parity（Linux bubblewrap 对齐） | 让当前 Linux 沙箱行为继续接近 Codex。 | 重要，但最好在 exec-server 方向定好之后做。 | 差距修复、启动自检、兼容性报告。 |
| 7 | debug1 原版 OpenCode 靶场 | 部署原版 OpenCode，用同题对比 Codex、原版 OpenCode、AIALRA fork。 | 需要证明架构变化真的提升稳定性和安全性。 | `debug1.aialra.online`、对比脚本、报告。 |
| 8 | Kimi/类似模型卡住诊断 | 找出是模型流、工具循环、输出过长，还是任务提示导致长循环。 | 需要真实数据，不能只怪模型。 | 卡住分类、trace 案例、Codex 风格预算/中断策略。 |

本阶段不做 macOS/Windows 沙箱。先把 Linux 做扎实。

## 2. OpenCode 现在的事件现状

OpenCode 已经有一个原始事件入口：

```text
GET /event
```

它的位置是：

```text
packages/opencode/src/server/routes/instance/httpapi/handlers/event.ts
packages/opencode/src/server/routes/instance/httpapi/groups/event.ts
```

这条流现在会把内部 bus event（总线事件）直接吐给前端，比如 session、message、permission、question、status 这些事件。前端的主要消费入口是：

```text
packages/app/src/context/global-sync/event-reducer.ts
```

问题是：它是内部事件，不是公共协议。

内部事件的问题：

- 名字更偏代码内部，不适合让用户直接看。
- 有些事件没有 turnID，不能稳定归到某一轮。
- 有些事件适合 UI 局部更新，但不适合作为审计日志。
- trace 里有很多调试字段，不应该全部暴露给用户。
- 以后 UI 如果直接依赖内部 trace，后端一重构 UI 就容易碎。

所以新方案不是“让 Turn Inspector 直接读 trace 文件”，而是新增一层 public event stream（公共事件流）。

## 3. Public Event Stream 设计

### 3.1 目标

公共事件流要同时满足三类人：

| 使用者 | 需要什么 |
| --- | --- |
| 普通用户 | 看得懂：现在是在请求模型、读文件、跑命令、等审批，还是已经失败。 |
| 开发者 | 可调试：每一步属于哪个 turn、哪个工具、哪个文件、哪个命令。 |
| 机器/测试 | 可消费：字段稳定、顺序稳定、能自动断言 started/completed/denied。 |

### 3.2 事件外壳

每个公共事件都应该有同一套外壳。下面是字段含义，不是要求用户读 JSON。

| 字段 | 中文意思 | 说明 |
| --- | --- | --- |
| `schema` | 协议版本 | 固定从 `aialra.public_event.v1` 开始。 |
| `eventID` | 事件编号 | 每条事件唯一。 |
| `seq` | 顺序号 | 同一个 session 内单调递增，UI 用它排序。 |
| `type` | 事件类型 | 例如 `turn.started`、`tool.call.started`。 |
| `time` | 时间 | ISO 时间字符串。 |
| `level` | 严重级别 | `info`、`warning`、`error`。 |
| `sessionID` | 会话编号 | 对应 OpenCode session。 |
| `turnID` | 回合编号 | 用户一次请求的编号。 |
| `messageID` | 消息编号 | 对应 OpenCode message。 |
| `toolCallID` | 工具调用编号 | 工具事件才有。 |
| `title` | 标题 | 给 UI 显示的一句话。 |
| `summary` | 摘要 | 给用户读的简短解释。 |
| `status` | 状态 | `started`、`running`、`completed`、`denied`、`failed`。 |
| `data` | 机器字段 | 稳定、脱敏后的结构化数据。 |
| `redaction` | 脱敏说明 | 告诉 UI 哪些内容被省略。 |

红线：公共事件默认不能暴露完整用户 prompt、完整模型回复、完整工具输出、密钥、账号密码、原始系统提示词。

### 3.3 第一版事件类型

| 类型 | 用户看到什么 | 来自哪里 |
| --- | --- | --- |
| `turn.started` | 这一轮开始了。 | 已有 trace/bus。 |
| `turn.context.created` | 本轮工作目录、模型、权限、沙箱、重试规则已确定。 | 已有 trace。 |
| `turn.completed` | 这一轮正常收尾。 | 已有 trace/bus。 |
| `turn.aborted` | 这一轮被中断、替换、评审结束或预算限制。 | 已有 trace/bus。 |
| `model.request.started` | 开始请求模型。 | `model.process.started`。 |
| `model.stream.started` | 模型流开始返回。 | 已有 trace。 |
| `model.retrying` | 模型请求或流失败，正在重试。 | `model.request.retrying` / `model.stream.retrying`。 |
| `model.request.finished` | 模型请求结束。 | `model.process.finished`。 |
| `tool.call.started` | 模型开始调用某个工具。 | `tool.call.started`。 |
| `tool.call.finished` | 工具调用结束。 | `tool.call.finished`。 |
| `tool.sandbox.checked` | 工具通过了本轮门禁检查。 | 已有 trace。 |
| `tool.sandbox.denied` | 工具被本轮门禁拒绝。 | 已有 trace。 |
| `file.read` | 读取了文件。 | read 工具事件归一化。 |
| `file.write` | 写入或修改了文件。 | write/edit/apply_patch 归一化。 |
| `command.started` | bash 命令开始。 | bash 工具事件归一化。 |
| `command.output` | bash 有输出。 | 先做摘要，exec-server 接入后用真实分片。 |
| `command.finished` | bash 命令结束。 | bash 工具事件归一化。 |
| `approval.requested` | 某个操作需要用户批准。 | `permission.asked`。 |
| `approval.resolved` | 用户批准或拒绝了。 | `permission.replied`。 |
| `final.output` | 最终回答完成。 | `prompt.completed` / assistant message。 |

### 3.4 trace 到公共事件的映射

| 当前 trace phase | 公共事件 | 转换规则 |
| --- | --- | --- |
| `prompt.received` | `turn.input.received` | 只显示输入片段数量、文本长度，不显示正文。 |
| `turn.context.created` | `turn.context.created` | 显示 cwd、model、approval、sandbox、profile、retry。 |
| `turn.started` | `turn.started` | 保留 Codex 风格字段：上下文窗口、协作模式。 |
| `model.context_built` | `model.context.built` | 显示消息数、工具数、token 估计，不显示 system prompt。 |
| `model.process.started` | `model.request.started` | 显示 provider/model/step。 |
| `model.stream.started` | `model.stream.started` | 显示 attempt 信息。 |
| `model.request.retrying` | `model.retrying` | `data.kind = request`。 |
| `model.stream.retrying` | `model.retrying` | `data.kind = stream`。 |
| `tool.input.started` | `tool.input.started` | 显示工具名和参数 key，不显示参数值。 |
| `tool.call.started` | `tool.call.started` | 显示工具名、callID、step。 |
| `tool.sandbox.checked` | `tool.sandbox.checked` | 显示操作、目标路径摘要、profile、sandbox。 |
| `tool.sandbox.denied` | `tool.sandbox.denied` | 显示拒绝原因、目标路径摘要、profile、sandbox。 |
| `tool.call.finished` | `tool.call.finished` | 显示成功/失败、耗时、输出长度，不显示完整输出。 |
| `processor.process.finished` | `turn.processing.finished` | 显示本轮 processor 是否正常结束。 |
| `prompt.completed` | `final.output` | 显示最终消息 ID、finish reason、token usage。 |
| `turn.completed` | `turn.completed` | 显示耗时、首 token 时间、最后 assistant message 是否存在。 |
| `turn.aborted` | `turn.aborted` | 显示 Codex reason：interrupted/replaced/review_ended/budget_limited。 |

### 3.5 传输和持久化

建议保留旧接口：

```text
GET /event
```

新增公共接口：

```text
GET /event/public
GET /session/:sessionID/events/public
```

第一条用于全局实时流，第二条用于某个 session 的 Turn Inspector。

服务端实现方式：

1. 新增 `PublicEvent` 类型，不进入旧 MessageV2 数据库模型。
2. 新增 `PublicEventMapper`，把 bus event 和 AIALRA trace event 映射成 public event。
3. 每个 session 维护一个有限长度 replay buffer（回放缓冲），例如最近 1000 条。
4. AIALRA trace JSONL 继续保留，作为冷存储和线下调试材料。
5. 公共 SSE 支持 `Last-Event-ID`，前端断线后可以接着收。

验收标准：

- 普通 prompt 至少有 `turn.started -> model.request.started -> final.output -> turn.completed`。
- 工具 prompt 至少有 `tool.call.started -> tool.sandbox.checked/denied -> tool.call.finished`。
- 需要审批时必须有 `approval.requested -> approval.resolved`。
- 一轮不能只有 `turn.started` 没有终态。
- 公共事件不含原始密钥、完整 prompt、完整工具输出。

## 4. Turn Inspector 设计

Turn Inspector 是用户可见面板。它不替代聊天时间线，而是解释“这一轮背后发生了什么”。

### 4.1 UI 放置

当前 session 页面结构在：

```text
packages/app/src/pages/session.tsx
packages/app/src/pages/session/session-side-panel.tsx
packages/app/src/context/layout.tsx
```

现在右侧已有 review/files 面板，file tree 开关由 `layout.fileTree` 控制。建议新增：

```text
layout.turnInspector.opened
layout.turnInspector.width
```

按钮位置：放在切换文件树按钮右侧，视觉上和现有 OpenCode 图标按钮一致。

面板形态：

- 桌面端：右侧面板，和 file tree/review panel 同一区域，宽度可拖拽。
- 移动端：先不做完整侧栏，后续可作为 tab。

### 4.2 MVP 显示内容

MVP 只做 6 组：

| 组 | 显示内容 |
| --- | --- |
| Turn | 开始、上下文、完成/中断、耗时。 |
| Model | 模型、attempt、重试、首 token 时间。 |
| Tool | 工具名、开始/结束、成功/失败。 |
| File | 读了什么、写了什么、哪些被拒绝。 |
| Command | 命令摘要、cwd、退出码、输出长度。 |
| Approval | 请求原因、用户选择、对应工具。 |

MVP 不显示完整 prompt 和完整工具输出。只显示摘要和可展开的安全字段。

### 4.3 完整版显示内容

完整版再加入：

- 事件过滤：只看错误、只看工具、只看审批。
- 每个工具的耗时瀑布图。
- 每轮 token/cost 汇总。
- 文件改动 diff 链接。
- “复制安全调试包”：只复制脱敏事件，不复制密钥和原文。
- 和 trace 文件互相跳转。

### 4.4 UI 测试

必须用 Playwright 做：

- 打开会话，按钮可见。
- 发送普通 prompt，面板出现 started/completed。
- 发送读文件 prompt，面板出现 file read/tool call。
- 发送工作区外写入 prompt，面板出现 denied。
- 触发审批时，面板出现 requested/resolved。
- 面板打开/关闭不会影响聊天输入和文件树。

## 5. Approval UI 绑定 TurnContext

OpenCode 现有审批事件在：

```text
packages/opencode/src/permission/index.ts
packages/app/src/context/permission.tsx
packages/app/src/pages/session/composer/session-permission-dock.tsx
```

现在的问题：`permission.asked` 有 sessionID、permission、patterns、metadata、tool，但没有稳定的 public turn event 语义。

下一步要做：

1. `Permission.Request` 增加可选 `turnID`，由工具执行时从 `Tool.Context.turn` 带入。
2. `permission.asked` 映射成 `approval.requested`。
3. `permission.replied` 映射成 `approval.resolved`。
4. public event 中记录：
   - turnID
   - permissionID
   - tool name
   - callID
   - approval policy
   - permission profile
   - sandbox policy
   - user decision：once/always/reject
5. Turn Inspector 中把审批插到对应工具下面。

验收：

- 审批弹窗出现时，Turn Inspector 也同步出现 `approval.requested`。
- 用户点允许一次、总是允许、拒绝，都出现 `approval.resolved`。
- `approval_policy = never` 时不弹审批，公共事件显示拒绝原因是 policy 不允许询问。

## 6. Codex exec-server 研究结论

Codex exec-server 不是一个简单的 bash 包装。它是独立执行服务，统一管理进程、文件系统、HTTP 请求、远程环境和沙箱。

### 6.1 协议

协议在：

```text
/srv/aialra/apps/codex-turn-engine/codex-rs/exec-server/src/protocol.rs
```

核心方法：

| 方法 | 中文意思 | 作用 |
| --- | --- | --- |
| `initialize` | 初始化 | 建立连接，返回 exec-server session。 |
| `initialized` | 初始化完成通知 | 客户端确认可以开始使用。 |
| `process/start` | 启动进程 | 启动 bash/命令，传 argv、cwd、env、tty、stdin 等。 |
| `process/read` | 读取进程输出 | 按 seq 读取 stdout/stderr/pty 输出。 |
| `process/write` | 写入 stdin | 给进程输入内容。 |
| `process/terminate` | 终止进程 | 杀掉正在跑的命令。 |
| `process/output` | 输出通知 | 进程有新输出时推送。 |
| `process/exited` | 退出通知 | 进程退出码可用。 |
| `process/closed` | 关闭通知 | 所有输出流关闭，本进程完全结束。 |
| `fs/readFile` | 读文件 | 支持 sandbox context。 |
| `fs/writeFile` | 写文件 | 支持 sandbox context。 |
| `fs/createDirectory` | 创建目录 | 支持 sandbox context。 |
| `fs/getMetadata` | 获取元数据 | 支持 sandbox context。 |
| `fs/readDirectory` | 读目录 | 支持 sandbox context。 |
| `fs/remove` | 删除 | 支持 sandbox context。 |
| `fs/copy` | 复制 | 支持 sandbox context。 |
| `http/request` | HTTP 请求 | 可用于远程环境代理网络请求。 |
| `http/request/bodyDelta` | HTTP body 分片 | 流式返回 HTTP body。 |

### 6.2 进程模型

源码：

```text
exec-server/src/process.rs
exec-server/src/local_process.rs
```

关键点：

- 每个进程有 processID。
- 输出分 stdout/stderr/pty。
- 每个输出块有递增 seq。
- 输出会保留一段 replay history（回放历史）。
- 进程有 `Exited` 和 `Closed` 两个阶段。
- `Closed` 表示所有输出流结束，不能只看退出码。
- 支持订阅实时输出，也支持按 seq 主动 read。

这比我们当前 bash 工具强，因为它天然适合 Turn Inspector 实时展示命令输出，也适合断线恢复。

### 6.3 文件系统模型

源码：

```text
exec-server/src/local_file_system.rs
exec-server/src/sandboxed_file_system.rs
exec-server/src/fs_sandbox.rs
```

关键点：

- Codex 文件操作不是只靠调用方检查路径。
- `fs/readFile`、`fs/writeFile` 等请求可以带 `FileSystemSandboxContext`。
- 如果需要沙箱，Codex 会启动一个受沙箱保护的 FS helper（文件系统助手）执行真正读写。
- helper 环境变量是白名单，只保留 PATH/TMPDIR/TMP/TEMP 等。
- helper 也通过 `SandboxManager` 选择平台沙箱。

这和我们当前状态的差别：

| 项 | 我们现在 | Codex |
| --- | --- | --- |
| read/write/edit/apply_patch | Node/Bun 层先检查 TurnContext，再直接执行文件操作。 | 文件操作可进入沙箱 helper，由系统沙箱包住。 |
| symlink escape | 已做真实路径检查。 | 由 runtime permission + sandbox helper 双层控制。 |
| `.git/.agents/.codex` | 已在 Node 层和 bwrap 里保护。 | policy 层建模，bwrap 还会处理 missing/create protection。 |
| 远程文件系统 | 未接。 | RemoteFileSystem 通过 exec-server client。 |

### 6.4 环境模型

源码：

```text
exec-server/src/environment.rs
exec-server/src/environment_provider.rs
exec-server/src/environment_toml.rs
```

关键点：

- Codex 有 EnvironmentManager（环境管理器）。
- 默认环境可以是 local（本机）、remote（远程 exec-server），也可以 disabled（禁用）。
- 环境同时提供 exec backend（进程执行）、filesystem（文件系统）、http client（HTTP 客户端）。
- 远程环境懒连接，不是在创建对象时马上连接。

这说明：如果我们要做远程执行、多环境、多工作区，最好不要继续在每个工具里临时拼逻辑，而是抽出统一 executor adapter。

## 7. exec-server 迁移决策

有三条路。

| 方案 | 做法 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- | --- |
| A. Rust sidecar 适配 | 直接构建 Codex exec-server，OpenCode Node 通过 JSON-RPC 调它。 | 最接近 Codex，进程/FS/远程/沙箱一次对齐。 | 需要进程管理、部署二进制、Node adapter。 | 推荐主路线。 |
| B. TypeScript 兼容层 | 在 Node 内实现一份同协议 executor，先兼容接口。 | 快，能先接 Public Event/Turn Inspector。 | 沙箱和远程能力仍不完整。 | 可作为过渡层。 |
| C. 完全重写执行器 | 不复用 Codex，只按概念重写。 | 自由度高。 | 风险最大，也违背“只兼并 Codex/OpenCode”。 | 不建议。 |

推荐路线：A 为主，B 为过渡。

具体阶段：

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| E0 | 确认 Codex exec-server 构建产物、启动方式、Linux 依赖。 | 能本机启动并完成 initialize。 |
| E1 | OpenCode 新增 `ExecutorBackend` 接口，当前 Node 执行器和 Codex exec-server 都实现它。 | 工具层只依赖接口，不直接依赖 Bun.spawn。 |
| E2 | bash 先切到 exec-server `process/start/read/terminate`，保留旧执行器 fallback。 | 命令输出有 seq，Turn Inspector 能实时看。 |
| E3 | read/write/edit/apply_patch 切到 exec-server FS API，带 sandbox context。 | 文件工具不只是 Node 层门禁，而是 FS helper 沙箱执行。 |
| E4 | 接 environment manager，支持 local/remote/disabled。 | UserTurn.environments 不再只是字段。 |
| E5 | 移除只服务于过渡期的重复沙箱逻辑。 | profile parity 全部通过。 |

## 8. Linux bwrap 与 Codex 的真实差距

我们现在已经有 Linux bwrap，但它还不是 Codex 完整体。

| 能力 | 我们现在 | Codex |
| --- | --- | --- |
| bwrap 来源 | 直接调用 `/usr/bin/bwrap`。 | 有 bwrap 探测、警告、可使用 bundled runtime。 |
| user namespace | 当前参数较简化。 | 明确 `--unshare-user`，处理 root/container 场景。 |
| seccomp/no_new_privs | 当前 bash 主要靠 bwrap 文件系统视图。 | `codex-linux-sandbox` 会在 bwrap 后应用 seccomp/no_new_privs。 |
| 网络限制 | 当前用 `--unshare-net` 做基础隔离。 | 有 full/isolated/proxy-only，并用 seccomp 限制 socket。 |
| 文件系统起点 | 当前 root read-only，再 bind writable roots。 | 可 full-read，也可 tmpfs root + 最小可读根。 |
| protected metadata | 当前 `.git/.agents/.codex` 只读。 | 还处理缺失路径创建保护、symlink mount target、nested masks。 |
| unreadable glob | 当前没有完整展开 deny glob。 | 用 ripgrep 展开 existing matches 后加 mask。 |
| FS helper | 当前文件工具仍在 Node 层执行。 | 文件工具可通过 sandboxed FS helper 执行。 |
| WSL/namespace 探测 | 当前较弱。 | 有 bwrap 能力探测和明确 warning。 |

后续 bwrap parity 目标：

1. 改为优先走 Codex `codex-linux-sandbox` helper。
2. 复制 Codex 的 bwrap startup probe（启动探测）。
3. 支持 `--unshare-user`、`--new-session`、`--die-with-parent`。
4. 对网络限制加入 seccomp，而不是只靠 `--unshare-net`。
5. 支持 protected-create target，防止 `.git` 这类路径不存在时被创建。
6. 支持 unreadable glob 展开和 mask。
7. 为每次 shell 启动记录 bwrap capability event。

## 9. Landlock 评估

Codex 当前 Linux 注释说明：文件系统主要由 bwrap 控制，Landlock helper 保留为 legacy/backup utilities（旧备用能力）。Codex 代码里使用 `ABI::V5`，所以部署时不能假设所有 Linux 内核都完整支持。

评估要做：

| 检查项 | 为什么 |
| --- | --- |
| 内核是否支持 Landlock syscall | 不支持就无法启用。 |
| Landlock ABI 版本 | Codex 用 ABI V5，旧内核可能不够。 |
| 容器权限 | 容器内可能被 seccomp 或宿主策略禁用。 |
| root/非 root 表现 | 行为可能不同。 |
| 和 bwrap 叠加顺序 | 需要确认先 bwrap 还是先 Landlock。 |
| 性能 | 高频文件工具不能明显变慢。 |

建议：先按 Codex 当前方向把 bwrap + seccomp + exec-server FS helper 做扎实，再决定 Landlock 是主路径还是 fallback。

## 10. Profile Parity 测试矩阵

第一版必须覆盖这些 profile：

| profile | read | write/edit/apply_patch | bash cwd | bash 写 workspace | bash 写 workspace 外 | 网络 | 审批 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `:read-only` | 允许读允许范围 | 拒绝 | 允许只读命令 | 拒绝 | 拒绝 | 默认禁用 | 不应靠审批绕过写入 |
| `:workspace` | 允许读 | workspace/tmp 允许 | 必须从 TurnContext.cwd | 允许 | 拒绝 | 默认禁用 | ask 规则可触发 |
| `:danger-full-access` | 允许 | 允许 | cwd 仍来自 TurnContext | 允许 | 允许 | 允许 | 高危操作仍可按 approval policy 处理 |
| `external` | 由外部沙箱定义 | 由外部沙箱定义 | cwd 来自 TurnContext | 取决外部 | 取决外部 | 取决外部 | OpenCode 只记录和转发 |
| `disabled` | 允许 | 允许 | cwd 来自 TurnContext | 允许 | 允许 | 允许 | 用于无沙箱场景，必须显式可见 |

每个 profile 必须测：

- `read`
- `write`
- `edit`
- `apply_patch`
- `bash`
- 网络访问
- 审批触发
- 失败后是否 `turn.completed`
- Turn Inspector 是否显示拒绝原因

## 11. debug1 原版 OpenCode 与三方对比

目标不是让另一个 agent 主观评价，而是固定同题、固定靶场、固定指标。

三方：

| 系统 | 用途 |
| --- | --- |
| 原版 Codex CLI | 目标工程能力参考。 |
| 原版 OpenCode | 对照组。 |
| AIALRA OpenCode fork | 当前改造组。 |

部署建议：

- `opencode.aialra.online`：继续跑 AIALRA fork。
- `debug1.aialra.online`：部署原版 OpenCode。
- 两边使用独立数据目录、独立 service、独立 trace/log。
- 两边指向同一个安全靶场目录，不能放真实密钥。

测试 prompt：

| 难度 | prompt | 主要看什么 |
| --- | --- | --- |
| 1 | 只回复 OK。 | 是否快速完成、是否有终态。 |
| 2 | 读取 README.md 并总结一句话。 | cwd 是否正确。 |
| 3 | 创建 workspace 内文件。 | 写入是否稳定。 |
| 4 | 尝试写 workspace 外文件。 | 是否拒绝、是否收口。 |
| 5 | 混合读、写、bash、失败恢复。 | 工程稳定性和可解释性。 |

指标：

- 成功率
- 卡死率
- 平均耗时
- 平均工具调用次数
- 写错目录次数
- 工作区外写入是否被挡
- 用户中断后是否能继续
- 是否能看到完整事件流

SWE-bench 可以做，但应该排在行为型 A/B 之后。先证明 harness 稳，再测复杂修 bug 能力。

## 12. Kimi 或类似模型卡住循环

最近真实 trace 里看到的现象：

- Kimi 有一次简单 turn 出现 `model.stream.retrying`，原因是 socket closed，随后重试成功。
- 另一次“让模型自查 trace”的任务耗时约 139 秒，执行了多次 bash/read，但最终 completed。

这说明当前问题可能有两类：

| 类型 | 表现 | 处理方式 |
| --- | --- | --- |
| 模型流断开 | socket closed、idle timeout、无 finish。 | 现有 stream retry 已能收口，继续补 public event 可见性。 |
| 工具循环过长 | 模型反复 read/bash，自查越来越长。 | 加 Codex 风格预算和 Turn Inspector，减少让模型自己查后端日志。 |

下一步不应该简单写“弱模型不好”。应该做三件事：

1. Public event stream 先上线，让用户自己能看执行过程，不必让模型读 trace 自查。
2. 引入 Codex 风格的 budget_limited（预算限制）路径，用已有 `turn.aborted` reason，不自创新 reason。
3. 对工具输出做可见摘要和大小限制，避免模型把巨大日志读进上下文后继续滚雪球。

验收：

- 流断开：出现 `model.retrying`，最终 completed 或 failed completed。
- 工具循环过长：出现预算限制事件，前端回 idle，下一轮可继续。
- Turn Inspector 能告诉用户卡在模型流、工具循环、审批等待还是沙箱拒绝。

## 13. 建议实施顺序

### Stage 3A: Public Event Stream

实现：

- `PublicEvent` 类型。
- trace/bus 到 public event 的映射。
- `/event/public` 和 `/session/:id/events/public`。
- replay buffer。
- 脱敏测试。

验收：

- 靶场 prompt 能看到完整公共事件。
- 事件流不泄露 prompt 正文和工具输出。
- 自动测试能断言每轮有终态。

### Stage 3B: Turn Inspector MVP

实现：

- 右侧按钮。
- 面板开关和宽度。
- 事件列表。
- turn/tool/file/command/approval/final 分组。

验收：

- 用户在 Web UI 直接看到 agent 背后步骤。
- 工作区外写入拒绝能在面板里看到。

### Stage 3C: Approval Audit

实现：

- Permission.Request 带 turnID。
- `approval.requested/resolved`。
- 审批 dock 显示 turn 关联信息。
- trace/public event/audit 三路记录。

验收：

- 每次审批都能回溯到 turn、tool、policy。

### Stage 3D: Exec-Server Adapter PoC

实现：

- 构建 Codex exec-server。
- Node JSON-RPC client。
- `ExecutorBackend` 接口。
- bash 先走 exec-server，旧执行器 fallback。

验收：

- bash 输出按 seq 推给 Turn Inspector。
- terminate 能真正中断进程。
- cwd/env/timeout/exit/closed 全部可观测。

### Stage 3E: Profile Parity + bwrap Parity

实现：

- profile matrix 自动测试。
- bwrap startup probe。
- Codex Linux helper 接入评估。
- seccomp/no_new_privs 接入。

验收：

- `:read-only`、`:workspace`、`:danger-full-access` 行为稳定。
- Linux 下工作区外写入被系统级阻止。

### Stage 3F: debug1 A/B Benchmark

实现：

- 部署原版 OpenCode。
- 同题脚本。
- 三方报告。

验收：

- 每次功能实现后自动对比三方结果。
- 能解释差异原因，而不是只看主观感觉。

## 14. 最终判断

当前 AIALRA OpenCode 已经完成了“回合可追踪”和“工具强门禁”的第一大步，但用户体感还不够，因为这些能力主要在后端 trace 里。

下一步最正确的是先做公共事件流和 Turn Inspector。这样每次改动都会立刻变成用户可见、测试可断言、后续可审计的事实。

exec-server 是更深的执行底座，必须同步推进研究和 PoC，但不要在没有公共事件流的情况下直接大规模替换执行器。否则用户还是看不见发生了什么，调试难度会更高。

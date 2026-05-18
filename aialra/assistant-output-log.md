# Assistant Output Log

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

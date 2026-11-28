# 项目说明书：飞书 AI 团队

图文补充（2026-11-28）：文档写作和飞书发布遵守 `docs/文档与飞书呈现规范.md` 与 `skills/illustrated-documents/SKILL.md`，专业 Skill 契约优先。团队包 Markdown 可用 `team-figure` 有界定义或本项目相对 PNG/JPEG/WebP 配图，由平台生成/上传原生图片；旧网页引擎和本机项目不冒称已同步。协调机器人需要文档、协作者、素材上传权限；真实 API 失败需显示错误，重试复用正文与图片进度。不要读其他项目的图片或开启文档公开编辑。安装说明优先引导读 `docs/图文安装与权限指南.md`，它不代替标准 setup。

## 开放团队包（安装其他团队或分享自己的团队时）

先读 [团队包标准](docs/AI团队包规范.md)，搭建提示词在 [docs/prompts/ecosystem.md](docs/prompts/ecosystem.md)。原启航版、领航版及下文默认网页流程继续保留。

- `node scripts/team-pack.mjs init` 安装筑页、观澜和文枢三包；观澜 2.1 是 TradingAgents 固定提交的 Apache-2.0 适配，五角色十六技能，未接入 Tauric 专用数据与计算服务；Newtype 按固定提交下载到本机并保留 SUL 来源声明，不复制进 MIT 核心代码。
- `/` 是团队工作台，`/teams` 是同一入口，`/legacy` 保留旧网页项目。团队页聚焦单个当前团队，以角色实时状态和四列项目看板为首页；三、五、八角色按网格全部展示。团队生态入口切换成熟团队包，旧项目仍锁定原包。角色详情查看 Skill，项目详情保留 workflow 与原动作；本机项目不要求机器人。点“扫码连接飞书”或运行 `bots` 调用标准注册流程，各新团队创建自己的专属角色，当前团队已创建的才复用，不自行写扫码脚本。同一团队一角色一机器人，同一应用只有一条长连接。
- 第三方通过清单、角色提示词、Skill、协作 Skill、workflow.json、Workspace 和交付契约定义团队，不改平台源码。作者打包应用 [skills/team-packager/SKILL.md](skills/team-packager/SKILL.md)，实际校验、导出、干净安装后分层记录验收；打包不等于公开发布。
- `src/packages/` 是标准、不可变包存储、通用编排、工具与 HTTP；原 `src/flow/` 继续服务旧项目。新包统一使用共享 SDK/并发名额，按项目真实路径与角色隔离；锁定内容不能被源包更新静默替换。
- 团队包飞书文档见 [文档同步与反馈](docs/飞书文档同步与反馈.md)：协调机器人创建，群成员可编辑；只同步声明的 Markdown，草稿与交付按版本追加，保留人工编辑和评论。评论进入本项目 context/document-feedback.md，不得当作批准；正式任务与问答先读。保留 data/project-documents 映射，创建回执不确定时禁止重复创建。
- 包不能包含凭据、运行状态、账号身份或安装钩子；工具范围由平台代码限制。搜索密钥可选 `BRAVE_SEARCH_API_KEY`，未配时使用免费 Bing RSS；搜索摘要仅作线索，相关性和覆盖不保证。网页与 PDF 只读公网 HTTPS，PDF 依赖宿主 pdftotext（Poppler），不支持扫描件 OCR。Calculate 提供有限运算、保留输入公式与来源，不开放命令行。
- 团队包 Skill 门槛只认 SDK PostToolUse 成功回执；普通进度代表尝试，不算已成功加载。测试替身须发 `onProgress({ tool: "Skill", file: "team:<id>", status: "succeeded" })`，保持同一语义。
- 来源工具由宿主写 `context/source-ledger.jsonl` 与 `context/sources/`，确认事件写 `context/approvals.json`；角色只读，不能自行声明真人已经审阅。新项目默认选最新语义版本，旧项目锁定不变，同版本多个摘要不得静默选一个。
- 团队包旧群已完成后，新研究或新写作目标交给协调角色发开工卡；聊天补充也可由模型提出 `start`，代码校验角色与完成状态，只发提议，点卡后才建独立群。普通问答先给“已收到”卡，排队与回答更新同一张卡，不改正式确认卡。群聊等待名额最多 5 分钟，轮到后回答最多 1 分钟；明确区分排队超时与模型失败。“重试”优先恢复失败的正式步骤；没有正式失败时，只重答该角色上次失败的问题。
- 最近群聊由平台直接提供，不要求每次先读整份旧报告；文档评论后台同步，聊天不等待逐份拉取评论。团队包项目中，同一真人单独 @ 一位角色后，10 分钟内无 @ 的补充继续交给该角色；按项目和可信人员身份隔离，任意真实 @ 优先，多人点名不猜后续接收人。“结束对话/暂停对话/不用回复了”关闭接续。已有项目中的其他普通消息交给本群协调者，按只读路由选择角色；“好的”等应答不批准流程。补充和修改用独立确认卡，原网页团队复用原提议/引导卡。详见 docs/群聊协调与上下文交接.md。
- 内置网页标准包保留原角色与 Skill 文本。修改默认 `prompts/` / `team-skills/` 不会自动改已安装包；需要同步包源文件、更新版本并安装，新项目选择新内容，已有项目不热迁移。

给在这个目录里工作的 AI 编程助手（Codex、Claude Code、Grok 等）。每次开工前先读完本文件。仓库里已经是能直接运行的完整代码：用户要搭建，先选版本，再照「安装与运行」在对话里带着用户做；用户要改角色、技能或功能，照下面的约定改。想从零自己搭的人用 `learn` 分支。

## 先选版本（只给 GitHub 链接也适用）

先读 [版本导航](docs/版本导航.md)，只展示导航中已可用的版本，不把未来构想当作已实现。用户没说明要搭哪种时，先问一次：**“你想搭启航版（一个群里做网页，推荐入门），还是领航版（每个项目独立群、独立上下文和确认）？”** 等用户选择后执行对应提示词。用户已经说单群、基础入门或不需要多项目，就选启航版；明确要求多项目、多群，就选领航版。不要重复询问已明确的选择，不把已删除的人员职责管理作为可用功能。

- 启航版提示词：[docs/prompts/basic.md](docs/prompts/basic.md)。新安装默认 `TEAM_MODE=basic`，用 `node setup.mjs mode basic` 确认选择。
- 领航版提示词：[docs/prompts/projects.md](docs/prompts/projects.md)。先运行 `node setup.mjs mode projects`；已有机器人补权限用 `node setup.mjs upgrade-projects`。
- 两版均保留 3 个 AI 同事、AI 管理员助手、工作台、同一 Agent SDK 和同一 workflow。版本只是功能组合，不是重复维护两份阶段表或角色提示词。
- 已有安装先读当前模式，不要求重建。没有 `TEAM_MODE` 的旧安装：已有独立项目/建群登记时保持领航版，否则沿用启航版。已有独立项目的目录禁止切为启航版，以免绕过人员权限；要体验另一版使用独立目录，同一组机器人只运行一处。
- 未来新增版本时保留已有提示词，更新版本导航、模式装配与验证范围；`learn` 只用于历史学习。

## 安装与运行（用户要搭建时先看这里）

先读 [部署与常驻](docs/部署与常驻.md)，在初始化时确定服务实际运行位置：本地执行 `node setup.mjs deploy local`；服务器收集 SSH 主机、用户名、端口、登录方式和目录，执行 `deploy server --host … --user …`，再由 Coding Agent 在远端目录执行 `deploy server --here` 和标准 setup。已明确的选择不重复问。同一组机器人只连一处；不要先在本机扫码运行完再询问部署位置。

本地安装系统守护，macOS 为登录后自启的 LaunchAgent，Linux 为 systemd 用户服务，启用 linger 才算开机自启完成。新安装只接续崩溃前已在执行的任务；十分钟内同项目最多一次自动接续，不批准待审、不重试业务错误、不重开主动停止的项目。旧安装未选择部署时仍保持下文手工恢复行为。`npm stop` 停止系统任务；`node setup.mjs service uninstall` 移除自启并保留项目。不能宣称电脑休眠、关机或断网时仍在线。

1. 运行 `node setup.mjs`（Node 24 以上；不用先 `npm install`，它会在后台装依赖）。它每次只做下一件能做的事，最后打印 `== 下一步 ==`：照着在对话里问用户、或告诉用户要做什么，拿到回答后再运行。不要自己写扫码、建群之类的脚本。
2. 模型：问用户接口地址、密钥、模型名（Anthropic 兼容接口；火山方舟是 `https://ark.cn-beijing.volces.com/api/compatible`，不是 `/api/v3`）。密钥用户可以直接发给你，也可以自己填进 `.env` 的 `MODEL_API_KEY`。拿到后先用你的文件写入工具把密钥原样存成 `data/model-key.txt`（不要用 echo、printf 等 shell 命令写，密钥里的引号会破坏命令），再运行 `node setup.mjs model --base-url <地址> --model <模型名> --key-file data/model-key.txt`，它读完会删掉这个文件；不要把密钥放进命令行参数、不要复述。终端已有 `ANTHROPIC_*` 变量时 setup 会提示，用户说"沿用"就运行 `node setup.mjs --use-anthropic-env`。
3. 扫码：先告诉用户马上会弹出二维码页面、用飞书手机版逐个扫码并在手机上确认（3 个 AI 同事 + AI 管理员助手，共 4 张；扫管理员助手那张的人就是管理员），再运行 `node setup.mjs scan`。它会等到扫完（最长 9 分钟）：把命令超时放宽到 10 分钟，或放到后台运行并查看输出。被打断就重跑，已建成的不用再扫。
4. 扫完后它自动建入口群「AI 团队」（用户当群主）、3 个机器人发报到卡片、AI 管理员助手私聊管理员报到、后台启动团队服务。启航版直接在原群 @AI 产品经理提需求，点“就按这个开始”后在原群开工；领航版通过扫码或真实私聊识别发起人，确认开工后去新项目群继续。
5. 需要联网：Codex 先切到能联网、能运行命令的模式（默认沙箱不能联网）。

领航版：已有机器人运行 `node setup.mjs upgrade-projects` 给原产品经理增补权限，新装扫码已申请权限。人员职责页面和管理接口已删除，不再指导用户导入名册。可信扫码记录或真实私聊识别发起人。团队包连接使用 `src/packages/connections.mjs`，观澜创建 5 个专属角色、文枢创建 8 个；由包的协调机器人建群，禁止借用原产品经理。扫码完成自动连接，不必停止其他团队。当前团队绑定中断时复用凭据补绑定，不能重复创建。

扫码页统一由 `src/setup/qr-page.mjs` 渲染数字生命身份舱：角色名称、职责、能力由角色资料与 workflow 的 Agent 任务派生，不把人工确认当作 Agent 能力。`status.js` 原位刷新真实回执，分别显示等待扫码、身份创建、团队连接；保留选中角色和键盘焦点。部分失败仍允许其他角色继续扫码。已连接团队可点“查看数字同事”复用原身份查看，不创建新机器人。


日常：`npm start` 后台启动团队服务（实际起的是管理服务 `src/admin/main.mjs`，由它带起团队服务 `src/main.mjs`；日志 `data/service.log`），`npm stop` 停止，`npm run status` 查看；`node setup.mjs status` 看搭到哪了；`npm test` 跑离线测试。工作台端口是 `.env` 的 `PREVIEW_PORT`（默认 4870，被占用时 setup 会自动换）。同一组机器人只能有一处在连飞书，启动前先 `npm run status`。用户说飞书没反应、点卡片提示"目标回调服务不在线"、电脑重启或合过盖、工作台打不开时，运行 `node setup.mjs`：它会把服务拉起来，并列出停下来没做完的项目；照它的"下一步"问用户要不要接着做，要就运行它给的 `node setup.mjs resume <编号>`。以前搭好、还没有 AI 管理员助手的，`node setup.mjs` 会在服务拉起来之后提示补扫这一张码。

## 改角色和技能

用户描述想法，你来改：

| 想改什么 | 改哪里 | 何时生效 |
|---|---|---|
| 某个角色的说话方式、做事规矩 | `prompts/<角色>.md`（product、designer、developer）；所有角色共用的在 `prompts/shared.md` | 下次该角色干活时，不用重启 |
| 某个技能的做法 | `team-skills/skills/<技能>/SKILL.md` | 下次用到时，不用重启 |
| 新增技能、调整某角色能用哪些技能 | 新建 `team-skills/skills/<名字>/SKILL.md`（开头 frontmatter 写 `name`、`description`），在 `src/agents/roles.mjs` 给角色的 `skills` 加 `team:<名字>` | `npm stop && npm start` |
| 新增角色 | 照 `docs/动手搭建.md` 拓展 A：新机器人、角色说明、`roles.mjs`、阶段表 | 重启 |

用户也可以私聊 AI 管理员助手让它改（见 7.2）：它在工作副本里改，文字类测试过了直接生效，代码类要用户点"上线"。改完跑 `npm test`（会检查角色引用的说明和技能文件都存在）。想看效果可以 `node scripts/try-agent.mjs <角色> <项目目录> <任务>` 试跑一次，会花模型费用，先告诉用户。改完告诉用户：`git diff` 能看到改了什么，`git checkout -- <文件>` 能还原。

## 1. 要做什么

飞书群里有 3 个 AI 同事：AI 产品经理、AI 设计、AI 程序员。用户 @ 它们聊想法，说清一句话需求、点了开工，它们按"澄清 → PRD → 线框与主题 → 开发 → 走查 → 验收"做出一个单文件静态网页。任何时候 @ 任何一个同事，它都从自己的专业角度回应，并说清下一步。

人只在 4 个地方出手：回答澄清问题、确认 PRD、确认设计、验收（外加打回时说要改什么）。其余步骤由编排代码自动接着派。

另有一个本机网页工作台，和飞书群用同一套数据：一屏看清所有项目、每个同事在做什么，也能在网页上提需求、点按钮。

这是教学用的启蒙版：清楚、够用优先，单机运行，不追求高并发。

## 2. 整体结构

**改结构前先看施工图**：[docs/施工图.md](docs/施工图.md)（图版 docs/施工图.png）写清了每个模块放在哪个文件、负责什么、通过什么接口相连。结构有变化，同步更新施工图。

```
飞书群 ⇄ 接入层（3 条长连接）⇄ 编排（普通代码：阶段表）⇄ 3 个 Agent（Agent SDK）⇄ 工作区文件
                                     ⇅                          ⇅
                          预览服务与工作台（本机网页）            模型接口
```

目录：

```
.env / .env.example     密钥与配置（.env 不提交）
setup.mjs               一条命令搭好：模型、扫码建机器人、建群、启动服务
src/setup/              setup 的各步：.env 读写、连通检查、装依赖、扫码、建群、后台服务
prompts/                角色说明
team-skills/            技能插件 team
docs/                   施工图、实测复盘、动手搭建（从零搭的路线）
src/agents/             run.mjs（runAgent）、roles.mjs（角色表）
src/agents/capacity.mjs 管理员和团队共用的跨进程并发名额
src/projects/           directory.mjs（可信身份与历史项目权限兼容）、manager.mjs（建群、权限、上下文）、events.mjs（完整讨论与按序点名）
src/flow/               stages.mjs（阶段表）、index.mjs（编排）、validate.mjs（交付检查）、cards.mjs（飞书卡片）
src/walkthrough-page.mjs 走查页模板
src/outline.mjs         PRD 页面结构图
src/sheet.mjs           一览图
src/feishu.mjs          接入层（飞书调用遇到限频自动退避重试）
src/preview.mjs         预览服务与工作台接口
src/workbench/          消息记录
src/main.mjs            团队服务入口
src/team.mjs / src/team-mode.mjs 两版装配与选择；基础模式不装配项目管理，阶段表共用
src/admin/              管理服务与 AI 管理员助手：main.mjs（npm start 和容器的入口）、supervisor.mjs（带着团队服务跑）、bot.mjs（私聊长连接）、assistant.mjs（指令、按钮、巡检）、cards.mjs、steward.mjs 与 tools.mjs 与 prompt.md（管家）、changes.mjs 与 deploy.mjs（工作副本、分级、上线、回退）
web/                    工作台前端
scripts/                服务管理（service.mjs）、试跑与冒烟脚本
test/                   离线测试（node:test）
.github/workflows/      CI
data/                   状态、消息记录、日志（不提交）
workspace/<项目号>/     每个项目的工作区：docs/ design/ site/（不提交）
```

## 3. 技术约定

- Node.js 24，ES 模块（`.mjs`，package.json 里 `"type": "module"`），测试用 `node:test`（`npm test`）。
- `TEAM_MODE=basic|projects` 选择启航版或领航版。模式入口在 `src/team.mjs`，默认基础版；已有独立项目没有配置字段时仍按领航版启动。不要在角色说明或阶段表内分叉版本。
- 依赖只用 `@anthropic-ai/claude-agent-sdk`、`@larksuiteoapi/node-sdk`、`qrcode`，以及管家自定义工具要用的 `zod`（Agent SDK 的 peer 依赖）。确实需要别的依赖先问用户；不要手写这些库的替代实现。
- `.env`（权限 600）里的变量：`FEISHU_PRODUCT_APP_ID`、`FEISHU_PRODUCT_APP_SECRET`，DESIGNER、DEVELOPER 同理；`MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME`；可选 `PREVIEW_PORT`（工作台端口，默认 4870）、`CHROME_PATH`；部署时另有 `PREVIEW_HOST`、`PUBLIC_WORKBENCH_BASE`、`PUBLIC_PREVIEW_BASE`（compose.yaml 里设）。用 `process.loadEnvFile()` 读取。
- 密钥只在 `.env`：不写进代码、日志、命令行参数、截图；任何输出都不打印密钥，报错只写变量名；检查 `.env` 时只看变量名在不在。
- 服务只监听 127.0.0.1；在容器里才监听 0.0.0.0，并且只发布到宿主的 127.0.0.1。
- `AGENT_CONCURRENCY` 为整套服务的执行总上限，默认 3（含管理员、群聊问答和正式任务），不是每个机器人各 3 个。名额在 `data/agent-capacity/`，等待时不启动 SDK 子进程，停止可取消排队。

### 3.1 多项目与确认权限

本节仅用于领航版。启航版保留原群内按顺序做项目的行为，不启用名册与关口分权。

- 新项目一群一个项目；结束后群和工作区保留，不把同一群复用于另一个新项目。新需求从产品经理私聊、原入口群或工作台进入。升级前的旧项目按原行为兼容。
- 工作区按项目分开；SDK 工作会话存储按“项目真实路径＋角色”分开，续用号仍放在项目的 `sessions` 中。走查开新会话；只读问答每次用独立临时会话目录，避免管理员代问与正式任务同时改 SDK 配置。禁用 SDK 自动记忆，防止宿主目录记忆自动混入；跨项目共用角色说明和技能，不自动共享项目原文。
- 完整讨论写 `data/messages/<群>.jsonl`，按顺序同步到 `workspace/<项目号>/context/discussion.md`；`context/project.json` 保存人员分工。每次派活提示先读讨论。人发的普通群消息只记下，@ 角色才回复；一条消息点名多人，依次产品、设计、程序员，群内对话排队，跨群可并发。附件保留类型和引用，不声称已读懂图片或语音。
- `data/team.json` 保留可信身份和历史项目权限；应用 open_id 分开存，用 union_id / user_id 关联同一人。新团队扫码身份存入该团队绑定的 `localOwnerId`，不接受客户端传身份。
- 工作台已删除人员名册、职责编辑、分工表单和 `/api/team`、`/api/team/person|settings|import|project` 接口。历史分工只保留内部兼容和权限校验，不在工作台暴露人员管理。
- 新团队包项目默认只有发起人负责所有确认关口，不按旧名册匹配其他成员。普通群成员可以讨论；历史项目的已指定确认人、结束项目负责人仍要校验，管理员不得绕过。
- 建群请求落盘 `data/project-registry.json`，同一请求号重试复用原项目和群；群号先落盘，再邀请成员。新包的协调机器人必须排在 botRoles 第一位，应用 open_id 只用在相同应用。
- 工作台写接口要求同源、`X-Workbench: 1`、JSON ≤ 16 KB。扫码复用 setup 的 `registerMissing`，并串行写凭据和绑定；长连接按应用去重、可动态增加角色，不启动第二处连接。

## 4. Agent：一个函数，三个角色

所有地方（编排、试跑脚本、测试）都调用同一个函数：

```js
runAgent({ role, prompt, projectDir, resume, onProgress, onQueued, timeoutMs, mode, control, isolateSession })
// → { ok, text, structured?, sessionId, error?, timedOut?, stopped?, stats: { turns, durationMs, inputTokens, outputTokens } }
// onProgress({ tool, file }) 在每次工具调用时实时调用，用于进度卡片和试跑脚本
// timeoutMs 到了就中止，返回 timedOut: true
// mode: 'chat' 是群聊对话（见下），structured 是 { reply, proposal: { action, detail } }
// control：编排传一个空对象，runAgent 填上 control.steer(text) 和 control.stop()（见下）
```

测试里的假智能体必须和它同一个签名、同样的返回字段。替身比真实实现宽松，接上真的就会出错。

`runAgent` 内部调用一次 Agent SDK 的 `query({ prompt, options })`，options：

| 选项 | 取值 |
|---|---|
| `systemPrompt` | `{ type: 'custom', prompt: shared.md + 角色说明 + 本次调用模式 }`，每次运行重新读文件；模式由代码明确是只读群聊还是已经确认的正式派活，防止开工后再次只提议 start |
| `tools` | `['Read', 'Write', 'Edit', 'Glob', 'Skill']`，不给命令行；不列 `Skill` 模型就看不到技能 |
| `plugins` | `[{ type: 'local', path: 'team-skills 目录的绝对路径' }]` |
| `skills` | 这个角色的技能，如 `['team:clarify', 'team:prd-spec', 'team:spec-checklist']` |
| `canUseTool` | 只能读写 projectDir 里的文件，写只能写本角色的目录；判断前先解析真实路径（macOS 的 /tmp 实为 /private/tmp），经软链接越界的拒绝；Skill 只放行本角色的技能 |
| `settingSources` | `[]`，不读本机的 Claude Code 设置 |
| `cwd`、`model`、`maxTurns` | projectDir、`MODEL_NAME`、默认 30；有研究 MCP 工具的正式任务 60，聊天 6 |
| `env` | 只传 `PATH`、`HOME`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CONFIG_DIR`、`CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`、`ANTHROPIC_DEFAULT_HAIKU_MODEL`；新项目配置目录在 `.claude-agent-config/isolated/<项目路径摘要>/<角色>/`，旧项目保留原会话目录；智能体拿不到飞书密钥 |
| `resume` | 同一角色在同一项目里续用自己的会话；走查一律开新会话 |
| `abortController` | `timeoutMs` 到了就 abort |

**插话与停下**（传了 `control` 时）：`prompt` 改成流式输入，先送任务消息；`control.steer(text)` 把"用户在你干活时插话引导：……"以 `priority: 'now'` 送进当前这一步，第一个 `result` 到了就关上输入，之后 `steer` 返回 false。插话会让当前这一轮先出一个结果再接着干，**以最后一个 result 为准**。`control.stop()` 调 `query.interrupt()`（没有就 abort），返回 `{ ok: false, stopped: true }`；刚好做完时才点停下，按做完算。

**对话模式**（`mode: 'chat'`，群里 @ 角色聊天时用）：`tools` 只给 `['Read', 'Glob']`，不给 `plugins`、`skills`，不续用会话，`maxTurns` 6；加 `outputFormat: { type: 'json_schema', schema }`，从结果的 `structured_output` 取 `{ reply, proposal: { action, detail } }`，`action` 只能是 none、start、revise、answer、retry、end。没有项目时工作目录用 `data/chat-room/`。`canUseTool` 和 PreToolUse 钩子要放行 `StructuredOutput`（SDK 让模型调用这个工具交结果；实测不放行时模型反复被拒，拿不到结构化结果，轮数用完）。

**团队包规划模式**（`mode: 'plan'`）：只允许角色原有工具中的 `Read`、`Glob`、`Skill`，放行结构化计划输出，不挂研究 MCP、不写交付文件。编排验证计划后，再以正式任务模式开放该角色的研究和写入工具；workflow 的任务表与依赖不变。

角色表：

| 角色标识 | 名称 | 角色说明 | 能写 | 技能 |
|---|---|---|---|---|
| `product` | AI 产品经理 | `prompts/product.md` | `docs/` | `team:clarify`、`team:prd-spec`、`team:spec-checklist` |
| `designer` | AI 设计 | `prompts/designer.md` | `design/` | `team:lofi-wireframe`、`team:theme-pick`、`team:flow-walkthrough`、`team:consistency-check` |
| `developer` | AI 程序员 | `prompts/developer.md` | `site/` | `team:frontend-design` |

三个角色都能读 `docs/`、`design/`、`site/`。智能体干一次活要一到几分钟（写 PRD 约 1 分钟，画线框约 3 分半，写网页约 6 分钟），这是正常的。

## 5. 流程：阶段表与任务消息

阶段：`idle → clarifying → confirm_prd → designing → confirm_design → building → walkthrough → accept → done`，打回分支 `revise_prd`、`revise_design`、`revise_build`。只能按表跳转。

- **澄清与 PRD**（产品经理，同一个会话）：信息不够时它写 `docs/questions.json`，编排发问题卡片；用户回答后把回答发给它，它再问一轮或写 PRD。最多 3 轮，第 3 轮必须写 PRD。写出 `docs/prd.md` 后进入"确认 PRD"。
- **确认 PRD** → 设计画线框、选主题 → **确认设计** → 程序员写网页 → **自动**进入走查（设计开新会话） → **验收**。
- 打回：对应角色在群里请用户 @ 它说要改什么；改完回到同一个关口。验收时打回，程序员修改后自动再走查一轮（回归走查）。
- 只有人（消息、按钮）和编排代码能让智能体开始干活；机器人发的消息一律不理，智能体之间不直接对话。AI 管理员助手按管理员的话或按钮代为操作（见 7.2），走工作台同一套入口，阶段表照旧、不能跳步，群里写明"AI 管理员助手代你：……"。
- **群聊对话**：群里 @ 角色的话先聊，不直接开工。编排按顺序判断：机器人消息不理 → "重试""结束"这类固定指令 → 修改阶段对负责角色说的话当修改意见 → 其余进对话（`src/flow/chat.mjs`）。对话时角色只读文件，回一句话（专业角度回应 + 现状和下一步）；需要时提一个动作，发成提议卡，人点了才由代码执行。模型只提议，人点按钮，代码执行。
  - 能提的动作由代码按现状和被 @ 的角色算好写进任务消息，模型回来的提议再校验一次，不合规就只发回复：`start`（产品经理，群里没有进行中的项目）点了用 detail 开项目；`revise`（关口的负责角色：确认 PRD→产品经理、确认设计→设计、验收→程序员）点了等于打回并带上意见，直接开始改；`answer`（澄清中、有问题卡时的产品经理）点了把 detail 当回答；`retry`（停下时的负责角色）；`end`（产品经理）。
  - 每个群只留最新一条提议（记在 `state.proposals`），新提议发出后旧的收起；点按钮时核对卡片号、项目和阶段，流程已经往前走了就按过期卡片处理。
  - 对话任务消息：以"群聊对话"开头，带项目现状（名称、阶段、谁在干活、停下的原因、已有产物）、按流程的下一步、群里最近 8 条、用户这句话、这次能提的动作。
  - 模型出错或 1 分钟没回：代码回"刚才没想好怎么回答。"加下一步提示。
  - 工作台"提需求"是明确的需求，直接开项目（`handleMessage` 带 `intent: 'demand'`）。
- **干活时说话**（参照 Codex 客户端）：对正在干活的角色说的话默认先记下，回一张"<角色> · 先记下了"卡片 [现在引导][停下这一步]；点"现在引导"把这句话插进当前这一步（进度卡多一行"↪ 你的引导：……"），这一步已在收尾就仍等做完再回。这一步做完（成功或停下）后，记下的话逐条进对话。@ 别的角色照常对话。
- **停下**：群里发"停止""停下"，或点进度卡、排队卡上的"停下"，中断当前这一步，发停下卡"某某让 <角色>停下了这一步"[重试][结束项目]。干活中发"结束"，确认卡按钮是 [停下并结束][继续做]，点了先停下，这一步收尾后直接结束项目，不发停下卡。干活中说"重试"回"正在做……"。
- 出错就停：不自动重试、不重发，状态不变。群里发一张"<角色> · 这一步停下了"卡片：一句人话原因 + [重试][结束项目]；完整原因记在工作台详情和服务日志，不往群里贴。@ 对应角色发"重试"也行。交付检查没过导致的重试，任务消息末尾附上"上次交付没通过检查：……，请改正后重新交付"。
- 结束项目：点停下卡上的[结束项目]，或在群里发"结束"（先发确认卡 [结束项目][继续做]）。结束后项目标 `ended`、阶段记为 `done`、移入 archived，文件保留，群里可以重新提需求。
- 时间上限：每一步最多跑多久见 `stages.mjs` 的 `timeLimits`（澄清与改 PRD 10 分钟、设计 15、开发 20、走查 15），超时按出错处理；飞书上传图片和文件最多等 60 秒。验收后网页文件发不出去，只在群里说一句，项目照常完成。
- 服务中途停掉（电脑重启、睡眠、被关掉）：重启时把还在干活的项目标成出错，发停下卡"团队服务重启过，这一步没做完"，用户发"重试"接着做这一步（助手也可以替用户运行 `node setup.mjs resume <编号>`，见「安装与运行」）；确认卡片还没发出去就停掉的，重试只重发确认卡片。

每一步发给智能体的任务消息（角色说明里按这些说法分节，照用）：

| 阶段 | 任务消息 |
|---|---|
| clarifying | `用户的话：<原话>`；之后各轮 `用户的回答：<回答>`；第 3 轮加"这是最后一轮：不再提问，用 prd-spec 技能写 docs/prd.md，没问到的按推荐写进"假设"。" |
| revise_prd | `用户对 PRD 的修改意见：<意见>` 加"请修改 docs/prd.md，没被提到的部分保持不变。回复一句话说明改了什么。" |
| designing | "PRD 已确认。这一步画线框并选主题，按角色说明里「画线框与主题」做。" |
| revise_design | `用户对设计的修改意见：<意见>` 加"只改被提到的部分。回复一句话说明改了什么。" |
| building | "PRD、线框和主题都已确认，请开始。" |
| walkthrough | 第 1 轮"程序员已经做好网页。这一步走查网页，按角色说明里「走查网页」做，这是第 1 轮。"；之后"程序员按上一轮意见改好了网页……这是第 N 轮：上一轮的结果在 design/walkthrough.json，请做回归走查。用户这次的修改意见：<意见>，也请逐条核对是否做到。"（不带用户意见，回归走查只核对上一轮的问题）；两种都在末尾加"每屏的说明写用户在页面上看到了什么，不写函数名和代码。"（设计读源码走查，不加这句会把函数名写进飞书卡片和一览图） |
| revise_build | `用户的修改意见：<意见>` 加"也请处理 design/walkthrough.json 里标了"待改""阻塞"的屏，其余保持不变。回复一句话说明改了什么。" |

## 6. 文件契约

格式以 `team-skills/skills/*/SKILL.md` 里写的为准，下面是摘要。每一步做完，由代码检查该交的文件在不在、能不能解析、必填字段齐不齐，不信智能体说"做完了"；不对就在群里报错并停下。

| 文件 | 谁写 | 要点 |
|---|---|---|
| `docs/questions.json` | 产品经理 | `{ round, why, questions: [{ id, question, matters, options: [字符串], recommended: 选项下标（整数）, reason }] }` |
| `docs/prd.md` | 产品经理 | 第一行 `# 网页名称`；用户故事、页面与状态、功能需求 FR-xxx、成功标准 SC-xxx、假设 |
| `docs/outline.json` | 产品经理 | `{ title, blocks: [{ name, content }]（≤8）, states: [{ id, name, desc }]（≤6） }`；PRD 卡片上的页面结构图用它画（见 8.1），网页一览图的状态也从这里取 |
| `docs/checklist.md` | 产品经理 | 需求质量自查结果 |
| `design/wireframe.html` | 设计 | 单文件；内嵌 `<script type="application/json" id="design-outline">`（groups → screens → states）；地址带 `#screen=<屏>&state=<状态>` 只显示那一屏，没有时全部显示 |
| `design/theme.json` | 设计 | `{ preset, name, reason, tokens: { colors, typography, radii, spacing, shadows } }` |
| `site/index.html` | 程序员 | 单文件；支持 `#state=<状态 id>` 直达各状态；localStorage 读写包在 try/catch 里 |
| `design/walkthrough.json` | 设计（走查） | `{ round, groups: [{ title, flowNote, screens: [{ title, state, reproduce, mark, note, previous? }] }], conclusion, summary, coverage, findings }`；`mark` 只能是"可以""待改""阻塞"，`conclusion` 是"通过"或"需修改" |

## 7. 飞书

- 每个机器人一条长连接：`WSClient` + `EventDispatcher`，事件 `im.message.receive_v1`，回调 `card.action.trigger`。先调 `/open-apis/bot/v3/info` 拿到自己的 open_id。
- 过滤：只接收 `sender_type` 为 user 的消息；全部群讨论留档，@ 了同事才交给编排。三个机器人重复收到的同一条 `message_id` 只记录一次、每个被点名角色只派一次。去掉机器人 @ 占位符，保留真人 @ 名称。需要产品经理的 `im:message.group_msg` 权限。
- 同一个机器人同时只能有一条连接：启动服务前停掉自检程序；本机和服务器不能同时在线。
- 发消息 `im.v1.message.create`（`receive_id_type: 'chat_id'`），更新卡片 `im.v1.message.patch`（卡片 config 里 `update_multi: true`），图片 `im.v1.image.create`，文件 `im.v1.file.create`。
- 进度、结果、确认/打回卡片用卡片 1.0：确认与打回是普通按钮，`value` 里带 `{ action, stage, projectId, cardId }`（`cardId` 是这张卡片的编号，项目状态里记着当前等人点的那张）；链接按钮写 `url`。点过的卡片改成"✓ 某某已确认"。
- 过期卡片：按钮回调先核对 `projectId`、`stage`、`cardId`，对不上就是过期卡片。toast 只闪一下，用户会以为没反应，所以除了 toast，还要在群里回一句按现状说清下一步的话（`src/flow/guide.mjs` 的 `staleText`：没有进行中项目、正在做、停下了、在关口、在修改阶段各一句，如"这张卡片已过期，现在在「确认设计」，请点最新那张卡片"），消息记录里也记下这次点击没被接受。
- 问题卡片用卡片 2.0 表单（`schema: '2.0'`，body 里一个 `form`）：每题一个 `select_static`（`name` 为题号，`initial_index` 从 1 数、默认选中推荐项，选项 `value` 用 `String(下标)`，文字不超过 120 字）；一个 `input`（name `extra`，其他补充）；提交按钮必须写 `form_action_type: 'submit'`，回传值放在 `behaviors: [{ type: 'callback', value }]`。回调里表单的值在 `action.form_value`。
- 回调要在 3 秒内返回（返回 toast），真正的活放到后台做。
- 调用飞书失败时，日志和群里的报错都带上飞书返回的 `code` 和 `msg`（在错误的 `response.data` 里）。只写"status code 400"没法排查。
- SDK 原始错误对象可能带请求头和密钥，所有飞书 Client、WSClient 和 EventDispatcher 使用 `src/feishu-logger.mjs` 的受限日志；业务层继续记录 code/msg，不直接输出 Axios 错误对象。
- 卡片格式错了，假飞书测不出来：接上真飞书后，先往群里把每种卡片各发一张测试卡片，都能发出去再交给用户。测试卡片标题以"测试 ·"开头，项目号写 `test`，不要用真实项目号：它和正式卡片长得一样，用户很可能点错。点测试卡片只回"这是测试卡片，不会推动流程，请点正式卡片"，不改项目状态。

### 7.1 卡片长相

模型回复统一经过 `src/presentation.mjs`：先规范常见 Markdown，再用 `publicReply` 形成简短任务摘要，不能把“未通过”“未核实”改成成功。`runAgent` 共用表达规则：普通正式任务单独返回结构化 `{ reply }`（最多240字）；只读聊天和动态计划保留各自的原结构。SDK `StructuredOutput` 只交回结果，不授予文件权限。任务的 `text` 是面向用户的回复，`rawText` 保留原始结束输出，不改角色目录权限和 workflow。团队包的完整回复仍在项目 `history` 与宿主写入的 `context/task-history.json`，其他角色通过工作区读取，群里只发摘要。

卡片是用户和 AI 同事打交道的主要界面，统一按下面做：

- **每个角色一种颜色**：卡片 `header.template` 产品经理 `blue`、设计 `purple`、程序员 `green`；标题一律"角色名 · 在做什么"，如"AI 设计 · 画线框与主题""AI 程序员 · 网页已完成"。
- **进度卡**：第一行用人话写这一步在做什么（`guide.mjs` 的 `taskLine`，如"按 PRD 画线框、选主题""按你的意见改设计：……"，不放发给智能体的任务消息）；第二行只放**现在在做什么**，每次工具调用换一句人话（`activityText`）：`📖 在看 PRD`、`🧰 在用「画线框」技能`、`✍️ 在写网页`、`✏️ 在改线框`、`🔍 在找文件`，15 秒没动静换成 `💭 在思考`，不逐行罗列；用户的引导单独一行"↪ 你的引导：……"；灰字"已用 N 秒"；最下面一个 [停下] 按钮（`value` 带 `{ action: 'stop', stage, projectId, cardId }`，`cardId` 是项目上的 `progressCardId`）。最多 2 秒更新一次，被挡下的随后补上，没动静时每 30 秒刷新用时。干完标题改"角色名 · 完成"（停下或出错改"角色名 · 停下了"），第二行"✅ 已完成 / ⏹ 已停下 / ⚠️ 没做完"，灰字改成"用时 N 秒"，去掉按钮。看板和工作台"干活中"那行用同一句人话（项目上的 `activity`）。
- **排队卡**：标题"<角色> · 先记下了"；"<角色>正在<阶段>（已用 N 分钟）。这句话会在这一步做完后回复。"，灰字"你说的：……"和"急的话点“现在引导”……"，按钮 [现在引导]（主按钮，action `steer`）[停下这一步]（action `stop`）。插进去后收起成"↪ 已插进这一步：……"，做完后收起成"这一步做完了，接着回复这句话：……"。
- **结果卡**（PRD、设计、网页、走查）：先是智能体的一句话回复，再用 `{ tag: 'hr' }` 分隔要点（如"主题：……""主色：#……"），工具次数、文件清单、轮数和 token 不在群里展示，保留在工作台记录；最后是链接按钮，下面一行灰字"链接在本机打开（飞书电脑版）"，需要人确认的再放确认/打回按钮。
- **停下卡**：标题"<角色> · 这一步停下了"（这一步负责角色的颜色）；一句原因，一行灰字"点“重试”让某某再做一次；不想做了就点“结束项目”，文件都会保留。"，按钮 [重试]（蓝色主按钮）[结束项目]，`value` 带 `{ action: retry | end, stage, projectId, cardId }`（`cardId` 是项目上的 `stuckCardId`）。点过后收起成一句"✓ 某某点了重试"。**结束确认卡**：标题"AI 产品经理 · 结束这个项目？"，按钮 [结束项目]（红色）[继续做]。
- **提议卡**（群聊对话里角色的提议）：标题"<角色> · 要开始做吗？ / 要按这个改吗？ / 把这段当回答提交？ / 要重试吗？ / 结束这个项目？"（提议角色的颜色）；先是角色的回复，再用 `hr` 隔开一行灰字"需求：…… / 要改的：…… / 回答：……"；按钮 [就按这个开始][再聊聊]、[按这个改][先不改]、[提交为回答][先不提交]、[重试][结束项目]、[结束项目（红色）][继续做]，`value` 带 `{ action, stage, projectId, cardId }`（action 是 start、revise、answer、retry、end，或 dismiss、keep；没有项目时 projectId、stage 写 none）。点过后收起成"✓ 某某点了“按这个改”：……"。
- 提示语里提到按钮名用中文引号（"点“重试”"），不用方括号：卡片文字会去掉 Markdown 符号，方括号会被吃掉。
- **问题卡**：标题"AI 产品经理 · 有几个问题"（蓝色）；先一句为什么要问，每题一行粗体题目、一行灰字"这个答案影响什么"，下面是下拉框；表单下方灰字"默认已选推荐项，直接提交就是全部按推荐"。
- 灰字统一用 `<font color='grey'>…</font>`；文字用 `lark_md` 或 `markdown`，模型写的内容先去掉 Markdown 符号再放进卡片。

进度卡示例（卡片 1.0）：

```json
{ "config": { "wide_screen_mode": true, "update_multi": true },
  "header": { "title": { "tag": "plain_text", "content": "AI 设计 · 画线框与主题" }, "template": "purple" },
  "elements": [
    { "tag": "div", "text": { "tag": "lark_md", "content": "按 PRD 画线框、选主题" } },
    { "tag": "div", "text": { "tag": "lark_md", "content": "🧰 在用「画线框」技能" } },
    { "tag": "div", "text": { "tag": "lark_md", "content": "<font color='grey'>已用 48 秒 · 第 3 步</font>" } },
    { "tag": "action", "actions": [ { "tag": "button", "text": { "tag": "plain_text", "content": "停下" }, "type": "default",
      "value": { "action": "stop", "stage": "designing", "projectId": "<项目号>", "cardId": "<progressCardId>" } } ] } ] }
```

### 7.2 AI 管理员助手（私聊）

第 4 个机器人，只在飞书私聊里帮管理员照看团队。扫它的码的人就是管理员。固定的事（状态、重启、回退、提醒、按钮）由代码直接做；其他话交给"管家"：一个只有一个持续会话的智能体，能看整个仓库、调度三个同事、改角色说明和技能、小改代码。

- 配置：`.env` 的 `FEISHU_ADMIN_APP_ID`、`FEISHU_ADMIN_APP_SECRET`、`FEISHU_ADMIN_OPEN_ID`（扫码人在这个应用下的 open_id，不是密钥），由 `node setup.mjs scan` 写入；建应用时多要一个读私聊消息的权限 `im:message.p2p_msg:readonly`。三个没配齐时，管理服务只带着团队服务跑，团队服务退出它也退出，和没有管理员助手时一样。
- 进程：管理服务（`src/admin/main.mjs`）先连管理员机器人的长连接，再把团队服务当子进程拉起（`supervisor.mjs`）。团队服务意外退出或起不来时，管理服务不跟着退，私聊提醒管理员。管理员机器人没连上（凭证不对、断网）就只记日志，团队服务照常跑。
- 只听管理员：只处理私聊（`chat_type` 为 p2p）、`sender_type` 为 user 的消息，同一条 `message_id` 只处理一次；别人私聊回"我只听管理员的。"；群消息不理；卡片按钮只认管理员的 open_id（回调里的 `operator.open_id`），别人点了 toast"只有管理员能点"。
- 固定指令（代码执行，不花模型费用）：整句"状态""现状"发现状卡（团队服务是否在运行、各进行中项目的阶段、谁在干活、等你做什么、停下的原因；没在运行时带 [重启团队服务]）；整句"重启""重启团队服务"重启团队服务，有项目在干活时不重启、说清是哪个项目；整句"回退""撤销"撤销最近一次管家改动；整句"停下""停止"让正在做事的管家停下。其他话交给管家（`.env` 没配模型时统一说明现在能做什么）。
- 巡检提醒（只提醒，不诊断）：每 30 秒看一次。项目新停下（工作台快照里 `waitingFor` 为"重试"）→ 提醒卡"有项目停下了"[接着做][看看原因][先不管]，点"看看原因"才让管家只读排查（事实和推断分开写；结束后可再点）；团队服务意外退出 / 起不来 → 提醒卡"团队服务停了"（最多 5 行输出）[重启团队服务]，最近有没撤销的代码改动时多一个 [撤销上一次改动]。按"项目 + 阶段 + 停下卡"或"团队服务"去重，记在 `data/admin/alerts.json`，管理服务重启后也不重报；问题过去了（项目接着在做、团队服务恢复），没点过的提醒卡收起成一句话；同一阶段又停下时旧提醒指向新提醒。
- 代你操作：点"接着做"时先核对项目还停在提醒里的阶段和同一张停下卡，过期就把卡片改成"这张提醒过期了：……"；没过期就调工作台写接口 `POST /api/message`，带 `via: 'admin'`、`role` 为负责的角色、`text: '重试'`。管理服务启动时生成随机令牌，团队服务子进程和管理服务调用工作台写接口时分别携带它；工作台只接受令牌匹配的管理员操作。群里转述成"AI 管理员助手代你：……"，操作人记成"AI 管理员助手（代你）"；启航版工作台普通操作记成"你（工作台）"，领航版用本机操作者姓名。
- 卡片：卡片 1.0，`header.template` 用 `orange`（和三个角色区分），标题"AI 管理员助手 · ……"；按钮回调 3 秒内回 toast，重启、接着做、上线、回退放到后台做，做完把原卡片改成一句结果。

**管家**（`steward.mjs`、`tools.mjs`、角色说明 `src/admin/prompt.md`）：

- 一个持续的会话：会话号存在 `data/admin/session.json`，管理服务重启后接着用，上下文长了靠 SDK 自动压缩；没有多会话、没有"新话题"。一次只做一件事：做事时进度卡和角色干活时一样（一行在做什么 + [停下]），管理员再说的话以 `priority: 'now'` 插进当前这一步（进度卡多一行"↪ 你插话：……"），插不进去的排队；做完把进度卡改成回复 + 用时和 token。每次最多 15 分钟。
- 选项：`systemPrompt` 读 `src/admin/prompt.md`；`tools` 是 `['Read', 'Glob', 'Grep', 'Write', 'Edit']`，没有命令行；`mcpServers` 是 `createSdkMcpServer({ name: 'admin', alwaysLoad: true, tools })`（参数用 zod 写）；`cwd` 是仓库根目录；`settingSources: []`；`env` 和 `runAgent` 一样只传模型变量；`maxTurns` 60。
- 看：整个仓库能读，`.env*`、`data/model-key.txt`、`.claude-agent-config/`、`qr/` 拒绝；Grep 不能从根目录或 `data/` 本身搜，必须指定更具体的子目录。改：Write、Edit 只能写工作副本 `.admin-work/`（`git worktree`，已在 `.gitignore`），而且只能是下面允许改的地方；"看看原因"时连自定义工具也只放行 `team_status`、`ask_colleague`。
- 工具（MCP，`mcp__admin__*`）：`team_status` 看现状；`ask_colleague` 用某个角色的对话模式在项目目录里只读回答，答案只给管家；`tell_colleague` 代管理员在群里对角色说话（工作台 `POST /api/message`，`via: 'admin'`）；`press_button` 代点关口的确认或打回（工作台 `POST /api/action`，只接受最新一条完整且明确的短指令，如“确认 #3 设计”“打回 #3 网页”；动作、项目、关口须匹配，一条消息只能代点一次；多个项目在等同类关口时须带编号；诊断和测试交回无管理员原话，不能代点）；`submit_change` 交改动；`restart_team` 重启（有项目在干活时拒绝）；`revert_change` 撤销。
- 改动分级（`changes.mjs`，代码算实际改动的文件，不信模型说的）：只动 `prompts/`、`team-skills/`、`docs/` 是文字类；动了 `src/`、`web/`、`test/` 是代码类；禁区 `src/flow/stages.mjs`、`src/agents/run.mjs`、`setup.mjs`、`src/setup/`、`.env*`、`src/admin/`、`package.json`、`package-lock.json`、`Dockerfile`、`compose.yaml`、`.github/`、`data/`、`workspace/`，以及没列为能改的地方（如 `README.md`、`scripts/`），碰到一个整次作废、工作副本清空，管家改写一段开发任务交给管理员。
- 文字类：工作副本里压成一个提交（作者"AI 管理员助手"，信息"管理员助手：……"）→ 跑测试 → 线上目录 `git merge --ff-only` → 私聊"改好了"卡 [撤销这次改动]。不重启，同事下次干活就用上。
- 代码类：发签字卡（改了什么、为什么、改动文件、怎么撤销）[上线][不要]。**点"上线"后才跑测试**：模型写的代码（包括测试）在管理员同意之前一行都不执行。测试过了 → 有项目在干活就等它这一步做完（巡检时再上线）→ 快进合并 → 重启团队服务 → 60 秒内连上飞书且工作台接口能访问才算健康；不健康自动 `git revert` 再重启，撤销失败必须说明线上仍是这次改动并提醒团队服务停了。签字只对那一个提交有效：之后工作副本又变了，旧卡作废。
- 文字类测试在工作副本里跑；代码类点"上线"后，用签字提交在仓库内 `.admin-test/` 建临时 worktree，运行全部测试，完毕强制移除（失败也移除）。环境变量只给 `PATH`、`HOME`、`LANG`，不带密钥；没过就把工作副本的提交拆回成改动，失败摘要交回管家改，最多 3 次，还不过就停下告诉管理员。
- 测试进程没有操作系统文件隔离，仍能读取线上 `.env`；代码类先签字再测试，与获准上线的代码使用相同信任边界，不能把临时副本当作密钥隔离沙箱。
- 草稿还没提交时线上已被更新或撤销：提交前检查工作副本是否基于当前线上代码；对不上就保留草稿并停止提交，交给本机编程助手合并，不能把旧副本中的旧规则覆盖回线上。
- 线上目录有别人没提交的改动、或线上在这期间往前走了：不上线，说清原因。撤销用 `git revert`（作者也是管理员助手），代码类撤销要重启，有项目在干活时拒绝。团队服务运行但读不到工作台项目状态时，不重启、不上线、不撤销代码；巡检跳过这一轮。改动记录在 `data/admin/changes.json`。提交只在本地，不推送；之后从上游 `git pull` 和这些本地提交冲突时，按普通 git 冲突处理（或先让管家撤销）。
- 管家的模型费用：一次简单问答约 1 万 token；读 AGENTS.md 再改一处角色说明约 10 万 token（实测豆包 31 秒）。
- 服务器（`compose.yaml`）：服务器上的 git 工作区整个挂进容器（`.:/app`，`.env` 另外只读挂），属主是容器里的 app 用户（`chown -R 10001:10001 <工作区>`；宿主机上用 root 跑 git 前先 `git config --global --add safe.directory <工作区>`）。依赖装在镜像的 `/node_modules`，`/app/node_modules` 用空的匿名卷挡住宿主机上的；镜像装了 git。管家的改动重启团队服务就生效，不用重建镜像；改依赖、Dockerfile 才要 `docker compose up -d --build`。从上游更新：`git pull` 后 `docker compose up -d --build`；管家在服务器上有本地提交时，`git pull` 会生成合并提交，冲突时先让管家回退对应改动，或手动解决。

## 8. 预览服务与工作台

- 两个端口，都只监听 127.0.0.1：**4871** 放模型写的页面（线框、网页），**4870** 放代码生成的页面（走查页、工作台和它的接口）。端口不同就不同源，模型写的页面碰不到工作台。地址形如 `http://127.0.0.1:4871/p/<项目号>/wireframe`。
- 所有响应加 CSP、`X-Content-Type-Options: nosniff`、`Cache-Control: no-store`。文件生成以后，才在卡片上放"打开线框""打开网页""打开走查页"链接。
- 走查页由代码里的固定模板生成：读 `design/walkthrough.json`，每屏一个 iframe 嵌真实网页（`site/index.html#state=<状态>`，`sandbox="allow-scripts allow-forms"`，不加 allow-same-origin），旁边是 AI 的标记和说明、用户的反馈框和"可以 / 待改 / 阻塞"按钮；反馈存本地，可导出 Markdown 和 JSON。
- 工作台的写接口（提需求、给角色发消息、点卡片按钮）调用编排里和飞书同一套处理函数，并让机器人在群里转述"来自工作台：……"、更新飞书上的原卡片；立即返回，不等智能体干完。安全：Host 只能是 127.0.0.1 或 localhost 加端口；有 Origin 时必须同源；必须带请求头 `X-Workbench: 1`；只收 JSON、16 KB 以内；操作身份由服务端取已设置的本机操作者，显示为"姓名（工作台）"，不能由请求体伪造。
- 工作台的项目列表：`workspace/` 下每个项目目录就是一个项目，按创建先后编号 #1、#2……；正在进行的从 `data/state.json` 取阶段，其余都算已完成。项目名取 PRD 第一行，还没有 PRD 时取需求原话的前 24 个字。
- 工作台"提需求"：领航版默认由产品经理为每个新项目创建独立飞书群、邀请三位同事和按职责选择的人员，不复用已结束项目的群。表单选择"本机项目"时创建独立的 `web:` 会话，消息和卡片只记在工作台。启航版隐藏人员入口与分工字段，空闲时用原群、原群忙时分到本机项目，保留原分流逻辑。
- 模型写的文字一律当不可信输入：网页里只用 `textContent` 显示；模型写的 HTML 只放进 sandbox iframe。

### 8.1 一览图：卡片里直接看到页面

确认 PRD 的卡片带一张**页面结构图**；设计卡（线框）、网页卡、走查卡都带一张**一览图**，下面再放"打开结构图""打开线框""打开网页""打开走查页"链接。用户在飞书里不用点开就能先看个大概。

- **页面结构图**：代码用固定模板把 `docs/outline.json` 画成 `shots/outline.html`（4870 端口 `/p/<项目号>/outline` 可打开）。宽 1280，浅灰底 `#F4F6F9`；顶部大标题是网页名称，旁边灰字"页面结构图 · 由 AI 产品经理根据 PRD 生成，样式待 AI 设计确定"。左边一栏"页面从上到下"：一个白色页面框（2px 深色边、圆角、左上角三个灰色圆点），里面按顺序列区块，每块一个虚线框，蓝色编号方块 + 粗体名称 + 一句话说明。右边 360 宽一栏"页面状态"：每个状态一张左边 4px 蓝条的白卡，名称、灰底的状态 id、一句描述；最下面灰字"这里只说明页面上有什么；具体怎么排、长什么样，由下一步的线框决定"。窗口高取 200 + max(区块数 × 100, 状态数 × 150)，保证最后一块和最后一个状态都在图里（实测窗口给小了，最后一块被截掉）；截图、上传方式同下。

- **一览页**：代码在项目工作区写 `shots/<名字>-sheet.html`：两列网格，最多 6 格；每格一个 iframe（`sandbox="allow-scripts"`，`scrolling="no"`），按电脑首屏 1280×800 打开到某个状态，再缩小一半成 640×400；格子下面写编号和说明（说明来自模型产出，一律转义）。整页宽 1368，高按行数算（每行 400 + 说明 44，行间 24，上下留白各 32，标题 60）。
- **每格打开什么**：线框用 `../design/wireframe.html#screen=<屏>&state=<状态>`，屏和状态从线框里的 `design-outline` 取；网页用 `../site/index.html#state=<状态 id>`，状态从 `docs/outline.json` 取；走查用 `walkthrough.json` 各屏的 state，并在格子上标"可以 / 待改 / 阻塞"。
- **截图**：无头 Chrome 截整页：`<Chrome> --headless=new --disable-gpu --hide-scrollbars --window-size=<宽>,<高> --virtual-time-budget=5000 --screenshot=<png> file://<一览页>`，超时 30 秒。`--virtual-time-budget` 让 Chrome 等各格的页面画完再截；不加时实测出现过后三格空白。Chrome 路径读 `.env` 的 `CHROME_PATH`，没写时 macOS 用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`；容器里装 chromium 和中文字体，并加 `--no-sandbox`。
- **放进卡片**：用 `im.v1.image.create`（`image_type: 'message'`）上传，拿到 `image_key`，卡片里放 `{ tag: 'img', img_key, alt: { tag: 'plain_text', content: '页面一览' } }`，后面紧跟链接按钮。
- **失败不卡流程**：截图前先删掉旧图，免得复用上一轮的；截图或上传失败时，卡片里写一行灰字"一览图未生成（原因）"，原因只写一句（浏览器截图超时 / 找不到 Chrome 浏览器 / 浏览器在当前环境里起不来 / 浏览器截图失败），Chrome 的命令行和崩溃日志只写服务日志；链接照常放，阶段照常推进。

### 8.2 旧版工作台长相（仅 /legacy）

新版 `/` 与 `/teams` 按用户确认的 [单团队工作台原型](docs/design/single-team-workbench-v1/README.md) 实现：浅色、单当前团队、角色状态置顶，项目分为进行中／等你确认／需处理／已完成。`web/team-board.mjs` 只派生展示状态，不推进 workflow；执行、排队、聊天、独立审核与空闲分别显示。切换团队不关闭已有机器人或迁移项目。

工作台给人一屏看清全局，整页不滚动，长内容只在各自区域里滚动。统一按下面做：

- **配色**：深色。底色 `#0A141C`，顶栏和侧栏 `#0D1922`，面板 `#112130`，分隔线 `#1D3344`，正文 `#E4EBF1`，次要文字 `#8798A7`，更淡的 `#5D7080`；角色色：产品经理 `#3B82F6`、设计 `#A86BF7`、程序员 `#2FBF71`；"等你"用琥珀色 `#F5B82E`；主按钮 `#2F7CF6`。圆角 12px，正文 14px。
- **头像**：角色色的实心圆，白色单字：产、设、程；人是琥珀色的"你"。不加图标和 logo。
- **用词**：阶段名用 待开始、澄清需求、确认 PRD、修改 PRD、设计中、确认设计、修改设计、开发中、修改网页、走查中、待验收、已完成；时间写"刚刚""N 分钟前"，等待写"已等 N 分钟"，不到 1 分钟写"刚刚"。
- **顶栏**（高 60，三个页面共用）：左边标题和一行灰字。看板页是"AI 团队工作台"和"3 个 AI 同事在做什么、哪里在等你"；详情页是"← 看板"按钮、"#编号 项目名"和"阶段名 · 飞书群项目（或 工作台项目）"，如"待验收 · 飞书群项目"；聊天页是"← 看板"、"和 AI 同事聊天"和"和在飞书群里 @ 它是一样的"。右边三个圆角计数："N 进行中"、"N 等你处理"（大于 0 时数字琥珀色）、"N 在干活"（大于 0 时绿色）；一个小圆点加"飞书同步中"（连不上时写"工作台服务连不上"）；最右是蓝色"+ 提需求"按钮。
- **看板**：背景是 36px 的淡网格。6 列：澄清与 PRD、线框与主题、开发、走查、验收、已完成，列名后紧跟灰色数量；空列是一个虚线框"暂无"，第一列空时写"点右上角「+ 提需求」开始"。
  - **项目卡**：第一行"#编号 项目名"（最多两行），右边灰字"刚刚""N 分钟前"；一排 3 个小头像，当前负责的角色是实心角色色，正在干活时头像外有一圈转动的角色色细环，其余调暗变灰；干活时一行"角色名：正在做的事"（和进度卡第二行同一句人话，如"AI 设计：🧰 在用「走查」技能"）；等人时一个琥珀色实心标签（深色字）"等你确认设计 · 已等 3 分钟"，卡片边框也变琥珀色；停下时同样的琥珀色标签写"卡住了 · 一句原因"，不铺开整段报错；最下面 5 段进度条（对应 6 列里前 5 列），做完的段用负责角色的颜色，进行中的段流动，等人的段琥珀色。
  - **已完成的卡**缩小：编号、项目名、绿色"✓ 已完成"标签（中途结束的写灰色"已结束"）、灰字"飞书群（或 工作台）· 11/22 04:53 开始"。
  - **底部**一排 3 个同事卡：角色色大头像（空闲时也是角色色；干活时外圈转动，等人时琥珀色外圈）、名字、一行状态（如"空闲""正在 #4 开发"），点了进角色聊天；最右灰字"点同事打开聊天，点项目看详情"。
- **项目详情**：三栏。左栏 230 宽"流程"：5 步竖排，步骤名和看板前 5 列相同（澄清与 PRD、线框与主题、开发、走查、验收），每步一个圆点（完成是角色色加 ✓，进行中转圈，等人琥珀色）、步骤名、"负责人 · 完成 / 进行中 / 等你验收 · 刚刚"（验收的负责人是"你"），下面挂这一步的产物小按钮（PRD 挂在澄清与 PRD 下，线框挂在线框与主题下，网页挂在开发下，走查页挂在走查下；验收下不挂），点了切到中间对应的标签；卡住时当前步写"卡住了"，流程下方一个琥珀色框写完整原因；中途结束的项目，结束那一步写"已结束"，之后的步"未开始"；流程下面是"需求原文"。中栏：标签页 PRD、线框、网页、走查页（选中的标签白底），右上"新标签页打开 ↗"；PRD 渲染成白底文档，其余放 iframe，铺满中栏、不留边距。右栏 400 宽：这个项目的消息和卡片，底部"发给"下拉选角色和输入框，Enter 发送。
- **消息与卡片**：人发的靠右、蓝色气泡；AI 的靠左，带头像和"角色名 飞书（或 工作台）· 时间"。卡片照飞书里的样子画：标题栏左边一条角色色竖线、角色色渐变底；正文、灰字、分隔线、一览图、链接按钮（带 ↗）、确认、重试、开工、按这个改、现在引导（蓝色实心）和打回、结束项目、停下（红字）按钮；问题卡片画成下拉框表单；进度卡片底部一个转圈和"已用 N 秒"。记录里缺内容时（比如工作台做好之前的旧记录）只显示有的部分：卡片只显示标题，按钮点击写成"你点了确认""你点了打回"，需求原文取第一条人发的文字；不显示 card、confirm 这类标识。
- **角色聊天**：左栏 290 宽同事列表（头像、名字、状态）；右边是对话，顶部头像、名字、状态，右上"角色说明与技能"按钮（浮窗显示角色说明和技能原文，可复制）。对话显示这个角色在所有项目里的消息和卡片，按时间排，换项目处插一条居中的"#编号 项目名"分隔条。底部"项目"下拉只列进行中的项目（产品经理多一项"新需求"），默认选这个角色当前负责的项目；选中的项目不归它负责时旁边灰字"#N 现在由某某负责"，选"新需求"时写"会开一个新项目"；输入框提示"对 AI 设计说…（Enter 发送）"；没有进行中的项目时，产品经理选"新需求"仍可输入和发送，其他角色输入框写"暂时没有进行中的项目"并禁用。

## 9. 做事的规矩（实测踩过的坑）

- **要一直运行的程序**：团队服务用 `npm start` 后台常驻（脱离你的进程，不随这一轮对话结束被关），`npm stop` 停、`npm run status` 看。自检之类的临时程序在同一轮里启动、轮询日志、用完停掉。同一组机器人只能有一处在连飞书长连接。
- **停不掉服务时**：`npm stop` 报"没有权限停止团队服务"（AI 助手的沙箱不让给这个进程发信号），就请用户在自己的终端里进入项目目录运行 `npm stop`；不要用 osascript、管理员权限、计划任务之类的办法绕过，也不要手改 `data/state.json`。
- **试跑要有输出**：试跑脚本边跑边打印每次工具调用；智能体一次要跑几分钟，等它跑完再下结论，不要中途停。
- **先假后真**：编排先用假飞书、假智能体测；交付前再用假飞书加真实 `runAgent` 从启动跑到产品经理发出问题卡片；接上真飞书后每种卡片各发一次。
- **用户看到的文字一律中文**：用中文角色名和步骤名（不显示 product、clarifying 这类标识）；群内任务回复只保留结果、重要限制和下一步；文件路径、工具记录和 token 留在工作区与工作台诊断中。用户主动询问技术细节时再解释。
- `prompts/` 和 `team-skills/` 用户没要求就不改；用户要求时照「改角色和技能」改。
- 每一步结束时报告：做了什么、怎么验证的（命令和结果）、哪里不确定、需要用户做什么。

## 10. 方法与出处

- 澄清、PRD、需求自查、需求覆盖检查四个技能改编自 [github/spec-kit](https://github.com/github/spec-kit)（MIT），把"先写清规格、再实现、再对照规格检查"的方法用在 AI 同事身上。
- 线框、主题、走查、前端四个技能改编自 learn-codex-harness 的设计工作流；前端技能的原型来自 [anthropics/skills](https://github.com/anthropics/skills) 的 frontend-design（Apache-2.0）。
- 参考文档：[Agent SDK 概览](https://code.claude.com/docs/en/agent-sdk/overview)、[Agent SDK 技能](https://code.claude.com/docs/en/agent-sdk/skills)、[TypeScript 接口](https://code.claude.com/docs/en/agent-sdk/typescript)、[飞书卡片表单容器](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/containers/form-container)、[飞书卡片交互](https://open.feishu.cn/document/feishu-cards/configuring-card-interactions)。

## 文档补充规范

遵循 [文档与飞书呈现补充规范](docs/文档与飞书呈现规范.md)。专业 Skill 的章节、字段、编号、篇幅和格式优先；平台只补文档定位、大纲组织、标题与飞书发布外观，不改锁定包，不给 JSON/HTML 套公文格式。历史文档不自动改名或重写。

## 命名与阶段审核

参见 [命名与审核模式](docs/命名与审核模式.md)。`src/project-labels.mjs` 管理项目短名与卡片标题；`src/packages/engine.mjs` 在原团队包依赖图外增加可选审核暂停，`src/agents/run.mjs` 的 review 模式提供隔离只读审核。安装命令 `node setup.mjs review human|auto` 只影响新团队包项目，旧项目和原始网页引擎不自动改方式。

## 群聊协调入口

遵循 [群聊协调与上下文交接](docs/群聊协调与上下文交接.md)。普通消息路由不改变 workflow；生产补充必须经负责人确认，模型的路由判断不是执行授权。引用只查本群记录。不要在真实项目中伪造真人消息或身份来验收。

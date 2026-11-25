# 项目说明书：飞书 AI 团队

给在这个目录里工作的 AI 编程助手（Codex、Claude Code、Grok 等）。每次开工前先读完本文件。仓库里已经是能直接运行的完整代码：用户要搭建，照「安装与运行」在对话里带着用户做；用户要改角色、技能或功能，照下面的约定改。想从零自己搭的人用 `learn` 分支。

## 安装与运行（用户要搭建时先看这里）

1. 运行 `node setup.mjs`（Node 24 以上；不用先 `npm install`，它会在后台装依赖）。它每次只做下一件能做的事，最后打印 `== 下一步 ==`：照着在对话里问用户、或告诉用户要做什么，拿到回答后再运行。不要自己写扫码、建群之类的脚本。
2. 模型：问用户接口地址、密钥、模型名（Anthropic 兼容接口；火山方舟是 `https://ark.cn-beijing.volces.com/api/compatible`，不是 `/api/v3`）。密钥用户可以直接发给你，也可以自己填进 `.env` 的 `MODEL_API_KEY`。拿到后先用你的文件写入工具把密钥原样存成 `data/model-key.txt`（不要用 echo、printf 等 shell 命令写，密钥里的引号会破坏命令），再运行 `node setup.mjs model --base-url <地址> --model <模型名> --key-file data/model-key.txt`，它读完会删掉这个文件；不要把密钥放进命令行参数、不要复述。终端已有 `ANTHROPIC_*` 变量时 setup 会提示，用户说"沿用"就运行 `node setup.mjs --use-anthropic-env`。
3. 扫码：先告诉用户马上会弹出二维码页面、用飞书手机版逐个扫码并在手机上确认，再运行 `node setup.mjs scan`。它会等到扫完（最长 9 分钟）：把命令超时放宽到 10 分钟，或放到后台运行并查看输出。被打断就重跑，已建成的不用再扫。
4. 扫完后它自动建群「AI 团队」（用户当群主）、3 个机器人发报到卡片、后台启动团队服务。最后告诉用户去群里 @AI 产品经理 说一句需求。
5. 需要联网：Codex 先切到能联网、能运行命令的模式（默认沙箱不能联网）。

日常：`npm start` 后台启动团队服务（日志 `data/service.log`），`npm stop` 停止，`npm run status` 查看；`node setup.mjs status` 看搭到哪了；`npm test` 跑离线测试。工作台端口是 `.env` 的 `PREVIEW_PORT`（默认 4870，被占用时 setup 会自动换）。同一组机器人只能有一处在连飞书，启动前先 `npm run status`。用户说飞书没反应、点卡片提示"目标回调服务不在线"、电脑重启或合过盖、工作台打不开时，运行 `node setup.mjs`：它会把服务拉起来，并列出停下来没做完的项目；照它的"下一步"问用户要不要接着做，要就运行它给的 `node setup.mjs resume <编号>`。

## 改角色和技能

用户描述想法，你来改：

| 想改什么 | 改哪里 | 何时生效 |
|---|---|---|
| 某个角色的说话方式、做事规矩 | `prompts/<角色>.md`（product、designer、developer）；所有角色共用的在 `prompts/shared.md` | 下次该角色干活时，不用重启 |
| 某个技能的做法 | `team-skills/skills/<技能>/SKILL.md` | 下次用到时，不用重启 |
| 新增技能、调整某角色能用哪些技能 | 新建 `team-skills/skills/<名字>/SKILL.md`（开头 frontmatter 写 `name`、`description`），在 `src/agents/roles.mjs` 给角色的 `skills` 加 `team:<名字>` | `npm stop && npm start` |
| 新增角色 | 照 `docs/动手搭建.md` 拓展 A：新机器人、角色说明、`roles.mjs`、阶段表 | 重启 |

改完跑 `npm test`（会检查角色引用的说明和技能文件都存在）。想看效果可以 `node scripts/try-agent.mjs <角色> <项目目录> <任务>` 试跑一次，会花模型费用，先告诉用户。改完告诉用户：`git diff` 能看到改了什么，`git checkout -- <文件>` 能还原。

## 1. 要做什么

飞书群里有 3 个 AI 同事：AI 产品经理、AI 设计、AI 程序员。用户 @ 它们提一句话需求，它们按"澄清 → PRD → 线框与主题 → 开发 → 走查 → 验收"做出一个单文件静态网页。

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
src/flow/               stages.mjs（阶段表）、index.mjs（编排）、validate.mjs（交付检查）、cards.mjs（飞书卡片）
src/walkthrough-page.mjs 走查页模板
src/outline.mjs         PRD 页面结构图
src/sheet.mjs           一览图
src/feishu.mjs          接入层（飞书调用遇到限频自动退避重试）
src/preview.mjs         预览服务与工作台接口
src/workbench/          消息记录
src/main.mjs            团队服务入口
web/                    工作台前端
scripts/                服务管理（service.mjs）、试跑与冒烟脚本
test/                   离线测试（node:test）
.github/workflows/      CI
data/                   状态、消息记录、日志（不提交）
workspace/<项目号>/     每个项目的工作区：docs/ design/ site/（不提交）
```

## 3. 技术约定

- Node.js 24，ES 模块（`.mjs`，package.json 里 `"type": "module"`），测试用 `node:test`（`npm test`）。
- 依赖只用 `@anthropic-ai/claude-agent-sdk`、`@larksuiteoapi/node-sdk`、`qrcode`。确实需要别的依赖先问用户；不要手写这些库的替代实现。
- `.env`（权限 600）里的变量：`FEISHU_PRODUCT_APP_ID`、`FEISHU_PRODUCT_APP_SECRET`，DESIGNER、DEVELOPER 同理；`MODEL_BASE_URL`、`MODEL_API_KEY`、`MODEL_NAME`；可选 `PREVIEW_PORT`（工作台端口，默认 4870）、`CHROME_PATH`；部署时另有 `PREVIEW_HOST`、`PUBLIC_WORKBENCH_BASE`、`PUBLIC_PREVIEW_BASE`（compose.yaml 里设）。用 `process.loadEnvFile()` 读取。
- 密钥只在 `.env`：不写进代码、日志、命令行参数、截图；任何输出都不打印密钥，报错只写变量名；检查 `.env` 时只看变量名在不在。
- 服务只监听 127.0.0.1；在容器里才监听 0.0.0.0，并且只发布到宿主的 127.0.0.1。

## 4. Agent：一个函数，三个角色

所有地方（编排、试跑脚本、测试）都调用同一个函数：

```js
runAgent({ role, prompt, projectDir, resume, onProgress })
// → { ok, text, sessionId, error?, stats: { turns, durationMs, inputTokens, outputTokens } }
// onProgress({ tool, file }) 在每次工具调用时实时调用，用于进度卡片和试跑脚本
```

测试里的假智能体必须和它同一个签名、同样的返回字段。替身比真实实现宽松，接上真的就会出错。

`runAgent` 内部调用一次 Agent SDK 的 `query({ prompt, options })`，options：

| 选项 | 取值 |
|---|---|
| `systemPrompt` | `{ type: 'custom', prompt: shared.md + 角色说明 }`，每次运行重新读文件 |
| `tools` | `['Read', 'Write', 'Edit', 'Glob', 'Skill']`，不给命令行；不列 `Skill` 模型就看不到技能 |
| `plugins` | `[{ type: 'local', path: 'team-skills 目录的绝对路径' }]` |
| `skills` | 这个角色的技能，如 `['team:clarify', 'team:prd-spec', 'team:spec-checklist']` |
| `canUseTool` | 只能读写 projectDir 里的文件，写只能写本角色的目录；判断前先解析真实路径（macOS 的 /tmp 实为 /private/tmp），经软链接越界的拒绝；Skill 只放行本角色的技能 |
| `settingSources` | `[]`，不读本机的 Claude Code 设置 |
| `cwd`、`model`、`maxTurns` | projectDir、`MODEL_NAME`、30 |
| `env` | 只传 `PATH`、`HOME`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CONFIG_DIR`（项目里单独一个目录），以及 `ANTHROPIC_DEFAULT_HAIKU_MODEL`（设成同一个模型，避免后台小任务去找接口里没有的模型）；智能体拿不到飞书密钥 |
| `resume` | 同一角色在同一项目里续用自己的会话；走查一律开新会话 |

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
- 只有人（消息、按钮）和编排代码能让智能体开始干活；机器人发的消息一律不理，智能体之间不直接对话。
- 同一个群正在处理时，再 @ 回复"正在处理上一步，请稍等"。
- 出错就停：不自动重试、不重发，状态不变，在群里说明出了什么问题、怎么重试（例如 @ 对应角色发"重试"）。
- 服务中途停掉（电脑重启、睡眠、被关掉）：重启时把还在干活的项目标成出错，在群里说明"团队服务重启过，上一步没做完"，用户发"重试"接着做这一步（助手也可以替用户运行 `node setup.mjs resume <编号>`，见「安装与运行」）；确认卡片还没发出去就停掉的，重试只重发确认卡片。

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
- 过滤：只处理 `sender_type` 为 user 的消息；群里只处理 @ 了自己的；同一条 `message_id` 只处理一次；文字里的 @ 占位符（如 `@_user_1`）先去掉。
- 同一个机器人同时只能有一条连接：启动服务前停掉自检程序；本机和服务器不能同时在线。
- 发消息 `im.v1.message.create`（`receive_id_type: 'chat_id'`），更新卡片 `im.v1.message.patch`（卡片 config 里 `update_multi: true`），图片 `im.v1.image.create`，文件 `im.v1.file.create`。
- 进度、结果、确认/打回卡片用卡片 1.0：确认与打回是普通按钮，`value` 里带 `{ action, stage, projectId, cardId }`（`cardId` 是这张卡片的编号，项目状态里记着当前等人点的那张）；链接按钮写 `url`。点过的卡片改成"✓ 某某已确认"。
- 过期卡片：按钮回调先核对 `projectId`、`stage`、`cardId`，对不上就是过期卡片。toast 只闪一下，用户会以为没反应，所以除了 toast，还要在群里回一句"这张卡片已过期，现在在「某阶段」，请点最新的那张"，消息记录里也记下这次点击没被接受。
- 问题卡片用卡片 2.0 表单（`schema: '2.0'`，body 里一个 `form`）：每题一个 `select_static`（`name` 为题号，`initial_index` 从 1 数、默认选中推荐项，选项 `value` 用 `String(下标)`，文字不超过 120 字）；一个 `input`（name `extra`，其他补充）；提交按钮必须写 `form_action_type: 'submit'`，回传值放在 `behaviors: [{ type: 'callback', value }]`。回调里表单的值在 `action.form_value`。
- 回调要在 3 秒内返回（返回 toast），真正的活放到后台做。
- 调用飞书失败时，日志和群里的报错都带上飞书返回的 `code` 和 `msg`（在错误的 `response.data` 里）。只写"status code 400"没法排查。
- 卡片格式错了，假飞书测不出来：接上真飞书后，先往群里把每种卡片各发一张测试卡片，都能发出去再交给用户。测试卡片标题以"测试 ·"开头，项目号写 `test`，不要用真实项目号：它和正式卡片长得一样，用户很可能点错。点测试卡片只回"这是测试卡片，不会推动流程，请点正式卡片"，不改项目状态。

### 7.1 卡片长相

卡片是用户和 AI 同事打交道的主要界面，统一按下面做：

- **每个角色一种颜色**：卡片 `header.template` 产品经理 `blue`、设计 `purple`、程序员 `green`；标题一律"角色名 · 在做什么"，如"AI 设计 · 画线框与主题""AI 程序员 · 网页已完成"。
- **进度卡**：第一行写这一步的任务；之后每次工具调用一行，带图标：`📖 读 docs/prd.md`、`🧰 用技能 lofi-wireframe`、`✍️ 写 design/wireframe.html`、`✏️ 改 site/index.html`、`🔍 找文件 *.json`（路径用项目里的相对路径，技能名去掉 `team:`）；只显示最近 12 行，更早的写"……前面还有 N 步"；15 秒没动静加一行"正在思考……"；最后一行灰字 `<font color='grey'>已用 N 秒</font>`。干完把标题改成"角色名 · 完成"。
- **结果卡**（PRD、设计、网页、走查）：先是智能体的一句话回复，再用 `{ tag: 'hr' }` 分隔要点（如"主题：……""主色：#……"），然后一行灰字过程："过程：读了 N 个文件、写了 N 个文件，N 轮，用时 N 秒，模型读入 X 万、写出 Y 万 token"；最后是链接按钮，下面一行灰字"链接在本机打开（飞书电脑版）"，需要人确认的再放确认/打回按钮。
- **问题卡**：标题"AI 产品经理 · 有几个问题"（蓝色）；先一句为什么要问，每题一行粗体题目、一行灰字"这个答案影响什么"，下面是下拉框；表单下方灰字"默认已选推荐项，直接提交就是全部按推荐"。
- 灰字统一用 `<font color='grey'>…</font>`；文字用 `lark_md` 或 `markdown`，模型写的内容先去掉 Markdown 符号再放进卡片。

进度卡示例（卡片 1.0）：

```json
{ "config": { "wide_screen_mode": true, "update_multi": true },
  "header": { "title": { "tag": "plain_text", "content": "AI 设计 · 干活中" }, "template": "purple" },
  "elements": [
    { "tag": "div", "text": { "tag": "lark_md", "content": "绘制线框并确定主题" } },
    { "tag": "div", "text": { "tag": "lark_md", "content": "📖 读 docs/prd.md" } },
    { "tag": "div", "text": { "tag": "lark_md", "content": "🧰 用技能 lofi-wireframe" } },
    { "tag": "div", "text": { "tag": "lark_md", "content": "✍️ 写 design/wireframe.html" } },
    { "tag": "div", "text": { "tag": "lark_md", "content": "<font color='grey'>已用 48 秒</font>" } } ] }
```

## 8. 预览服务与工作台

- 两个端口，都只监听 127.0.0.1：**4871** 放模型写的页面（线框、网页），**4870** 放代码生成的页面（走查页、工作台和它的接口）。端口不同就不同源，模型写的页面碰不到工作台。地址形如 `http://127.0.0.1:4871/p/<项目号>/wireframe`。
- 所有响应加 CSP、`X-Content-Type-Options: nosniff`、`Cache-Control: no-store`。文件生成以后，才在卡片上放"打开线框""打开网页""打开走查页"链接。
- 走查页由代码里的固定模板生成：读 `design/walkthrough.json`，每屏一个 iframe 嵌真实网页（`site/index.html#state=<状态>`，`sandbox="allow-scripts allow-forms"`，不加 allow-same-origin），旁边是 AI 的标记和说明、用户的反馈框和"可以 / 待改 / 阻塞"按钮；反馈存本地，可导出 Markdown 和 JSON。
- 工作台的写接口（提需求、给角色发消息、点卡片按钮）调用编排里和飞书同一套处理函数，并让机器人在群里转述"来自工作台：……"、更新飞书上的原卡片；立即返回，不等智能体干完。安全：Host 只能是 127.0.0.1 或 localhost 加端口；有 Origin 时必须同源；必须带请求头 `X-Workbench: 1`；只收 JSON、16 KB 以内；操作人固定为"你（工作台）"。
- 工作台的项目列表：`workspace/` 下每个项目目录就是一个项目，按创建先后编号 #1、#2……；正在进行的从 `data/state.json` 取阶段，其余都算已完成。项目名取 PRD 第一行，还没有 PRD 时取需求原话的前 24 个字。
- 工作台"提需求"：最近用过的飞书群空闲（没有项目或已完成）时，发到那个群，产品经理在群里转述"来自工作台的需求：……"；群里正忙时，开一个只在工作台里的项目（会话号以 `web:` 开头，消息和卡片只记在工作台，不发飞书）。
- 模型写的文字一律当不可信输入：网页里只用 `textContent` 显示；模型写的 HTML 只放进 sandbox iframe。

### 8.1 一览图：卡片里直接看到页面

确认 PRD 的卡片带一张**页面结构图**；设计卡（线框）、网页卡、走查卡都带一张**一览图**，下面再放"打开结构图""打开线框""打开网页""打开走查页"链接。用户在飞书里不用点开就能先看个大概。

- **页面结构图**：代码用固定模板把 `docs/outline.json` 画成 `shots/outline.html`（4870 端口 `/p/<项目号>/outline` 可打开）。宽 1280，浅灰底 `#F4F6F9`；顶部大标题是网页名称，旁边灰字"页面结构图 · 由 AI 产品经理根据 PRD 生成，样式待 AI 设计确定"。左边一栏"页面从上到下"：一个白色页面框（2px 深色边、圆角、左上角三个灰色圆点），里面按顺序列区块，每块一个虚线框，蓝色编号方块 + 粗体名称 + 一句话说明。右边 360 宽一栏"页面状态"：每个状态一张左边 4px 蓝条的白卡，名称、灰底的状态 id、一句描述；最下面灰字"这里只说明页面上有什么；具体怎么排、长什么样，由下一步的线框决定"。窗口高取 200 + max(区块数 × 100, 状态数 × 150)，保证最后一块和最后一个状态都在图里（实测窗口给小了，最后一块被截掉）；截图、上传方式同下。

- **一览页**：代码在项目工作区写 `shots/<名字>-sheet.html`：两列网格，最多 6 格；每格一个 iframe（`sandbox="allow-scripts"`，`scrolling="no"`），按电脑首屏 1280×800 打开到某个状态，再缩小一半成 640×400；格子下面写编号和说明（说明来自模型产出，一律转义）。整页宽 1368，高按行数算（每行 400 + 说明 44，行间 24，上下留白各 32，标题 60）。
- **每格打开什么**：线框用 `../design/wireframe.html#screen=<屏>&state=<状态>`，屏和状态从线框里的 `design-outline` 取；网页用 `../site/index.html#state=<状态 id>`，状态从 `docs/outline.json` 取；走查用 `walkthrough.json` 各屏的 state，并在格子上标"可以 / 待改 / 阻塞"。
- **截图**：无头 Chrome 截整页：`<Chrome> --headless=new --disable-gpu --hide-scrollbars --window-size=<宽>,<高> --virtual-time-budget=5000 --screenshot=<png> file://<一览页>`，超时 30 秒。`--virtual-time-budget` 让 Chrome 等各格的页面画完再截；不加时实测出现过后三格空白。Chrome 路径读 `.env` 的 `CHROME_PATH`，没写时 macOS 用 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`；容器里装 chromium 和中文字体，并加 `--no-sandbox`。
- **放进卡片**：用 `im.v1.image.create`（`image_type: 'message'`）上传，拿到 `image_key`，卡片里放 `{ tag: 'img', img_key, alt: { tag: 'plain_text', content: '页面一览' } }`，后面紧跟链接按钮。
- **失败不卡流程**：截图前先删掉旧图，免得复用上一轮的；截图或上传失败时，卡片里写一行灰字"一览图未生成（原因）"，链接照常放，阶段照常推进。

### 8.2 工作台长相

工作台给人一屏看清全局，整页不滚动，长内容只在各自区域里滚动。统一按下面做：

- **配色**：深色。底色 `#0A141C`，顶栏和侧栏 `#0D1922`，面板 `#112130`，分隔线 `#1D3344`，正文 `#E4EBF1`，次要文字 `#8798A7`，更淡的 `#5D7080`；角色色：产品经理 `#3B82F6`、设计 `#A86BF7`、程序员 `#2FBF71`；"等你"用琥珀色 `#F5B82E`；主按钮 `#2F7CF6`。圆角 12px，正文 14px。
- **头像**：角色色的实心圆，白色单字：产、设、程；人是琥珀色的"你"。不加图标和 logo。
- **用词**：阶段名用 待开始、澄清需求、确认 PRD、修改 PRD、设计中、确认设计、修改设计、开发中、修改网页、走查中、待验收、已完成；时间写"刚刚""N 分钟前"，等待写"已等 N 分钟"，不到 1 分钟写"刚刚"。
- **顶栏**（高 60，三个页面共用）：左边标题和一行灰字。看板页是"AI 团队工作台"和"3 个 AI 同事在做什么、哪里在等你"；详情页是"← 看板"按钮、"#编号 项目名"和"阶段名 · 飞书群项目（或 工作台项目）"，如"待验收 · 飞书群项目"；聊天页是"← 看板"、"和 AI 同事聊天"和"和在飞书群里 @ 它是一样的"。右边三个圆角计数："N 进行中"、"N 等你处理"（大于 0 时数字琥珀色）、"N 在干活"（大于 0 时绿色）；一个小圆点加"飞书同步中"（连不上时写"工作台服务连不上"）；最右是蓝色"+ 提需求"按钮。
- **看板**：背景是 36px 的淡网格。6 列：澄清与 PRD、线框与主题、开发、走查、验收、已完成，列名后紧跟灰色数量；空列是一个虚线框"暂无"，第一列空时写"点右上角「+ 提需求」开始"。
  - **项目卡**：第一行"#编号 项目名"（最多两行），右边灰字"刚刚""N 分钟前"；一排 3 个小头像，当前负责的角色是实心角色色，正在干活时头像外有一圈转动的角色色细环，其余调暗变灰；干活时一行"角色名：正在做的事"（取进度卡最后一行，如"🔍 找文件 **/walkthrough.json"）；等人时一个琥珀色实心标签（深色字）"等你确认设计 · 已等 3 分钟"，卡片边框也变琥珀色；最下面 5 段进度条（对应 6 列里前 5 列），做完的段用负责角色的颜色，进行中的段流动，等人的段琥珀色。
  - **已完成的卡**缩小：编号、项目名、绿色"✓ 已完成"标签、灰字"飞书群（或 工作台）· 11/22 04:53 开始"。
  - **底部**一排 3 个同事卡：角色色大头像（空闲时也是角色色；干活时外圈转动，等人时琥珀色外圈）、名字、一行状态（如"空闲""正在 #4 开发"），点了进角色聊天；最右灰字"点同事打开聊天，点项目看详情"。
- **项目详情**：三栏。左栏 230 宽"流程"：5 步竖排，步骤名和看板前 5 列相同（澄清与 PRD、线框与主题、开发、走查、验收），每步一个圆点（完成是角色色加 ✓，进行中转圈，等人琥珀色）、步骤名、"负责人 · 完成 / 进行中 / 等你验收 · 刚刚"（验收的负责人是"你"），下面挂这一步的产物小按钮（PRD 挂在澄清与 PRD 下，线框挂在线框与主题下，网页挂在开发下，走查页挂在走查下；验收下不挂），点了切到中间对应的标签；流程下面是"需求原文"。中栏：标签页 PRD、线框、网页、走查页（选中的标签白底），右上"新标签页打开 ↗"；PRD 渲染成白底文档，其余放 iframe，铺满中栏、不留边距。右栏 400 宽：这个项目的消息和卡片，底部"发给"下拉选角色和输入框，Enter 发送。
- **消息与卡片**：人发的靠右、蓝色气泡；AI 的靠左，带头像和"角色名 飞书（或 工作台）· 时间"。卡片照飞书里的样子画：标题栏左边一条角色色竖线、角色色渐变底；正文、灰字、分隔线、一览图、链接按钮（带 ↗）、确认（蓝色实心）和打回（红字）按钮；问题卡片画成下拉框表单；进度卡片底部一个转圈和"已用 N 秒"。记录里缺内容时（比如工作台做好之前的旧记录）只显示有的部分：卡片只显示标题，按钮点击写成"你点了确认""你点了打回"，需求原文取第一条人发的文字；不显示 card、confirm 这类标识。
- **角色聊天**：左栏 290 宽同事列表（头像、名字、状态）；右边是对话，顶部头像、名字、状态，右上"角色说明与技能"按钮（浮窗显示角色说明和技能原文，可复制）。对话显示这个角色在所有项目里的消息和卡片，按时间排，换项目处插一条居中的"#编号 项目名"分隔条。底部"项目"下拉只列进行中的项目（产品经理多一项"新需求"），默认选这个角色当前负责的项目；选中的项目不归它负责时旁边灰字"#N 现在由某某负责"，选"新需求"时写"会开一个新项目"；输入框提示"对 AI 设计说…（Enter 发送）"；没有进行中的项目时输入框写"暂时没有进行中的项目"并禁用。

## 9. 做事的规矩（实测踩过的坑）

- **要一直运行的程序**：团队服务用 `npm start` 后台常驻（脱离你的进程，不随这一轮对话结束被关），`npm stop` 停、`npm run status` 看。自检之类的临时程序在同一轮里启动、轮询日志、用完停掉。同一组机器人只能有一处在连飞书长连接。
- **试跑要有输出**：试跑脚本边跑边打印每次工具调用；智能体一次要跑几分钟，等它跑完再下结论，不要中途停。
- **先假后真**：编排先用假飞书、假智能体测；交付前再用假飞书加真实 `runAgent` 从启动跑到产品经理发出问题卡片；接上真飞书后每种卡片各发一次。
- **用户看到的文字一律中文**：用中文角色名和步骤名（不显示 product、clarifying 这类标识）；文件路径写项目里的相对路径（如 `docs/prd.md`）；token 写成"读入 X / 写出 Y token"。
- `prompts/` 和 `team-skills/` 用户没要求就不改；用户要求时照「改角色和技能」改。
- 每一步结束时报告：做了什么、怎么验证的（命令和结果）、哪里不确定、需要用户做什么。

## 10. 方法与出处

- 澄清、PRD、需求自查、需求覆盖检查四个技能改编自 [github/spec-kit](https://github.com/github/spec-kit)（MIT），把"先写清规格、再实现、再对照规格检查"的方法用在 AI 同事身上。
- 线框、主题、走查、前端四个技能改编自 learn-codex-harness 的设计工作流；前端技能的原型来自 [anthropics/skills](https://github.com/anthropics/skills) 的 frontend-design（Apache-2.0）。
- 参考文档：[Agent SDK 概览](https://code.claude.com/docs/en/agent-sdk/overview)、[Agent SDK 技能](https://code.claude.com/docs/en/agent-sdk/skills)、[TypeScript 接口](https://code.claude.com/docs/en/agent-sdk/typescript)、[飞书卡片表单容器](https://open.feishu.cn/document/feishu-cards/card-json-v2-components/containers/form-container)、[飞书卡片交互](https://open.feishu.cn/document/feishu-cards/configuring-card-interactions)。

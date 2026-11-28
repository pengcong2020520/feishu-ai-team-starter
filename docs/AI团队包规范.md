# AI 团队包标准 v1

一份包是作者设计好的整支团队：角色提示词、Skill、协作关系、可执行流程、工作区、Wiki 知识和交付标准。安装后由飞书群或本机工作台承接项目目标，平台调度 Agent。包本身不启动独立服务，也不能执行安装脚本。

平台版本与团队能力分开。启航版、领航版继续保留；需要新建飞书项目群和人员分工的团队使用领航版。启航版可在本机体验团队包，原来的单群网页流程保持兼容。旧项目不会自动迁移。

## 内置团队

| 团队 | 角色 | 协作方式 |
| --- | --- | --- |
| 筑页 · 网页团队 | 产品经理、设计、程序员 | 澄清最多三轮 → 确认 PRD → 设计 → 确认设计 → 开发 → 新会话走查 → 验收；支持打回 |
| 筑域 · 应用开发团队 | 产品经理、设计师、架构师、全栈程序员、测试部署工程师 | 规格 → 架构 → 任务 → 实现 → 复核 → 实测 → 本机发布 → 验收；失败回修 |
| 观澜 · 投研团队 | 研究主理人、公司研究员、宏观策略师、量化研究员、风险分析师 | 确认研究范围 → 按任务依赖组织专家研究与反方审查 → 综合报告 → 确认交付 |
| 文枢 · Newtype 内容团队 | 主编、副主编、研究、核查、提取、作者、编辑、归档 | 副主编提出最小够用计划，平台代表主编调度；已有稿件可直接编辑，主编汇总，验收后归档 |

Newtype 是独立来源适配包。安装器固定到 `newtype-01/newtype-codex@e22b7771549572439a092295bb370075ded261a3`，保留原角色模板、协作原文与修改声明，不运行其全局安装器。该提交插件声明 SUL-1.0，但根目录未提供 LICENSE；安装包同时保留同作者 newtype-os 固定版本的 SUL 文本及来源说明，不能把它当作 MIT 或据此推定商业再分发权利。上游内容只下载到本机 `data/packages/`，不纳入平台的 MIT 源码。

## 文件与声明

```text
manifest.json
agents/<角色>.md
skills/<技能>/SKILL.md
collaboration/SKILL.md
collaboration/workflow.json
knowledge/<主题>.md         # 可选团队公共知识，逐页声明
workspace/                 # 可选模板，只复制清单明确列出的文件
examples/                  # 可选原规则映射、样例资料
LICENSE
THIRD_PARTY_NOTICES.md      # 使用第三方内容时保留
```

以 `src/packages/schema.mjs` 的 Zod 严格校验器为机器规范；可复制完整的 `examples/team-package/` 作为第四支自定义团队，无需改平台代码。清单不接受未知字段。

| manifest 字段 | 含义 |
| --- | --- |
| schemaVersion / runtime | `1` / `feishu-team/1`；未来不兼容标准会显式升级 |
| id / name / version | 小写英文包 ID、中文名称、三段版本号 |
| author / description / license | 作者、用途、实际适用许可 |
| files | 全部分发文件的相对路径白名单，包含 manifest.json 和 LICENSE |
| roles | id/name/description/prompt/skills/tools/read/write/memory/model/color；memory 只支持 project，模型档位 default/strong/fast |
| skills | id/version/path/description/inputs/outputs/tools/resources；入口必须为 skills/id/SKILL.md，含 name、description frontmatter |
| collaboration / workflow | 协作 Skill 和结构化工作流文件路径 |
| workspace | directories 与 templates（source → target）；不能占用平台 context、.team、.claude 目录 |
| knowledge | 可选 `{format:"wiki/1",pages:[...]}`，页面标题、摘要、来源、状态、标签、链接及 Markdown 路径；见 [Wiki 知识层](Wiki知识层.md) |
| application | 可选受控应用契约；目前仅支持 `node24-sqlite`，声明 `entry/test/migration/healthPath/port`；文件须位于同一 Workspace 目录 |
| artifacts | id/name/path/format、可选 requiredKeys/minBytes；format 为 markdown/text/json/html |
| examples | 至少一个 name/demand/expectedArtifacts；用于复现验收 |
| sources | 第三方 url/revision/license/notice；revision 应固定不可变来源 |

角色只读声明目录、只写本角色授权目录。`context/` 由平台保存讨论、分工、计划和包锁，只能读。技能原文和明确声明的资源可以读取；不自动执行技能脚本。角色私有区可通过其他角色的 read 列表排除。项目原文不自动沉淀成跨项目记忆；作者选入包的公共经验属于版本化包文件。

## 协作规则

workflow 具有 entry、coordinator、relations、nodes、maxSteps（默认 80，上限 200）。每个专业角色必须由协调角色的 dispatch 关系授权。handoff/review/synthesize 是对角色关系的说明；实际交接顺序由 next 与 after 强制执行，不能只写在说明中。

| 节点 | 声明与执行 |
| --- | --- |
| task | role、skills（本步必须调用）、prompt、outputs、next；可选 timeoutMinutes、freshSession、validator、questions 分支及 route |
| gate | role、approval、next、可选 reject；questions=true 使用网页澄清表单。`release=true` 是发布前真人关口，自动审核模式也不得跳过 |
| plan | 规划角色 role、skills、prompt、可选任务 tasks、required、final、next；只读项目资料并加载技能，不开放写入或研究 MCP，Agent 返回 `{rationale,tasks:[{id,after,brief?}]}`；正式任务按验证后的依赖执行 |
| done | 结束。所有节点都必须可到达结束节点 |

task 可声明 `route: {artifact, field, cases: {ready: "下一节点", revise: "修改节点"}}`，从本步已声明的 JSON 产物读取枚举结果；未知值即停，不执行任意表达式。

prompt 可使用 `{{demand}}`、`{{feedback}}`、`{{round}}`。task 的输出按清单检查文件、长度、JSON 字段；网页包额外复用已有网页交付校验器。内置 validator 为 files、web-clarify、web-prd、web-design、web-site、web-walkthrough、app-verification、app-deployment。应用校验器只认平台 Docker 运行 SQLite 迁移和 Node 测试的回执；部署节点需要直属的 `release=true` 关口。第三方不可注入任意可执行校验代码。

plan 的任务目录也是 task 定义，增加 id/name/after。目录中的 after 表示“如果对方被选中，本任务必须等待对方”；required 指定不可省略任务；final 必须等待全部选中任务。验证未知任务、环、缺失依赖与必做任务后才执行。没有依赖的任务可并行，但不能共用角色会话或重叠写目录，整套服务仍共享 AGENT_CONCURRENCY。

每步声明的 Skill 必须收到 SDK `PostToolUse` 成功回执（`onProgress` 的 `status: succeeded`）；仅出现调用尝试或生成文件都不算通过。替身 Agent 必须模拟同样的成功事件，不能用更宽松的签名。出错即停，已完成的计划任务落盘，重试只补失败任务；服务中断不自动继续，待用户重试。人工打回重新进入声明节点，可只重做相应步骤。包的 Skill、角色、流程与读写范围均不能由模型临时扩大。

### 最终成果与项目档案

将最终确认关口声明为 `type: "gate"`、`approval: "accept"`，其前一步任务的 `next` 指向该关口。平台把该任务的 `outputs` 作为最终成果；前一步为 `plan` 时，使用计划中 `final` 任务的输出。网页包优先使用 `web-site` 的 HTML 输出。没有最终文件时，档案不会拿最后一份归档说明替代。

最终 Markdown 产出后，平台检查重复段落、占位和实际内容，并由原角色最多修正两轮；失败会停下。这是内容检查，不会替代流程批准，也不改变专业 Skill 的原有文档结构。档案从真实讨论、任务与确认记录提炼摘要和标签，保留每个节点的原始依据。

## 安装、分享与更新

也可以通过[管理员私聊](管理员助手.md)完成复制或导入 → 修改草稿 → 真实试跑 → 应用版本 → 导出分享。支持全部角色、Skill、workflow 与 workspace 模板；试跑目录独立，模拟关口明确标记为 `automated-test`。应用核对当前草稿摘要和真实试跑结果，新项目使用新版本，已有项目不迁移。导出的仍是下述标准 `.team.json`，没有另一套私有格式。

```bash
node scripts/team-pack.mjs init
node scripts/team-pack.mjs validate examples/team-package
node scripts/team-pack.mjs export examples/team-package /tmp/brief.team.json
node scripts/team-pack.mjs install /tmp/brief.team.json
node scripts/team-pack.mjs verify-export examples/team-package
node scripts/team-pack.mjs list
```

支持目录、`.team.json` 和 GitHub 固定提交的目录链接，例如 `https://github.com/作者/仓库/tree/<40位提交号>/包目录`。不接受浮动 main 分支作为远程锁定来源。白名单文件拒绝软链接、路径穿越、明显凭据和飞书身份；每文件 ≤ 2 MB、总计 ≤ 16 MB。摘要用于完整性和复现，不代表作者身份认证；安装者仍应选可信作者。

已安装内容在 `data/packages/<id>/<version>/<sha256>/`，项目 `context/package-lock.json` 记录精确内容和本机角色绑定。编辑源目录后重新安装得到新摘要；已有项目始终使用旧摘要。没有自动热迁移和任意脚本/hooks 支持。不要直接编辑已安装目录。

网页包保留当前角色原文。将来改变 `prompts/` 或 `team-skills/` 时，旧网页工作流下次调用会读取改动；标准包则要更新包文件、版本并重新安装，新项目才使用新版。两种更新语义须区分。

## 飞书、人员与外部工具

```bash
# 复用本机已有机器人键；密钥仍只在 .env
node scripts/team-pack.mjs bind web-studio product product
node scripts/team-pack.mjs bind web-studio designer designer
node scripts/team-pack.mjs bind web-studio developer developer
# 为该团队创建专属角色；已创建的本团队角色不会重复扫码
node scripts/team-pack.mjs bots newtype-editorial
```

同一团队内一角色一机器人。观澜、文枢各自创建专属角色，不借用产品经理；由 workflow.coordinator 对应的机器人建群并邀请其余角色。扫码成功自动增加长连接，不重启其他团队，同一应用仍只有一条连接。只有明确要求复用时才用 bind；项目消息只调度锁定包的角色。

工作台首页 `/`（`/teams` 同入口）选择包，显示该包的角色、Skill 与 workflow。先扫码连接，再选择目标创建飞书项目群；本机试跑可单独选择。人员名册和职责管理接口已移除，新项目默认发起人确认。独立协调机器人在私聊或入口群收到自然语言目标后，会发开工确认卡；发起人确认才新建群，建项前讨论按轮次迁入项目。默认产品经理入口仍保留旧网页工作流。

身份来自可信飞书事件或本机操作者；项目确认继续受人员权限限制，不因换团队包而绕过。

网络能力由平台 MCP 工具提供。WebFetch 映射为只读公网 HTTPS 的 read_url，返回来源与抓取时间；拒绝内网、保留地址，校验每次重定向并固定 DNS 解析地址。本机代理使用 198.18/15 Fake-IP 时，通过固定公网 DoH 服务核实真实公网地址再连接，不放行该保留网段。WebSearch 有 `BRAVE_SEARCH_API_KEY` 时使用 Brave，未配置时使用免费 Bing RSS；结果只是线索，需核验原文，不能把模型记忆当作实时搜索结果。WebFetch 同时提供 HTML/文本/JSON 的 read_url 与文字型 PDF 的 read_pdf（依赖 Poppler；物理页码）。扫描件 OCR、音视频未接入。Calculate 映射确定性运算，输入口径仍须研究者核对。

模型档位通过可选的 MODEL_STRONG_NAME / MODEL_FAST_NAME 配置，未填写沿用 MODEL_NAME。所有角色使用同一兼容接口，能力和额度以该接口实际支持为准。

## 作者验收

使用 [team-packager Skill](../skills/team-packager/SKILL.md) 保留原规则映射、声明导出范围、校验、导出并重新导入。验收报告分开记录结构检查、替身编排、真实 SDK、真实飞书；任何一层都不替代其他层。安装成功不能声称机器人已扫码、多人权限已在真人账号上验证或研究结论已核实。


## 来源、确认与版本审计

平台将成功的 `read_url` 与 `search` 结果写入当前项目的 `context/source-ledger.jsonl`，保存 `sourceId`、角色、类型、URL 或查询、抓取时间、正文摘要及缓存路径；缓存文本在 `context/sources/`。抓取时间不等于资料发布日期，搜索摘要不等于阅读全文。角色可读缓存并引用 sourceId，不能写这个目录。

关口操作记入 `context/approvals.json`，含阶段、动作、时间、actor、source、修改意见。`local` 代表本机入口，`admin` 代表管理员代办；两者均不证明真人已阅读。自动回测应明确标记 `automated-test`，不冒充人工验收。工作台详情的“来源与确认记录”读取 `/api/packages/evidence?projectId=...`，不从模型自述推断审阅状态。

新项目目录默认显示各包最高语义版本；同版本不同摘要保留为不同选项，不能静默挑选。CLI list 保留历史版本，已建项目始终使用原锁定内容。角色绑定与新需求入口也按最新版本处理，已经建好的群不迁移。

内置观澜 2.1 使用 TradingAgents 固定提交的五角色十六技能；原始文件、许可、差异及作者映射均在包内。导出和导入仍使用统一协议，不添加安装钩子。上游专用数据、超出本地有限计算范围的分析及长期记忆等尚未映射的能力必须在清单描述和提示词中说明，不得只保留工具名然后假装可用。

## 可选研究能力（运行时扩展）

角色和 Skill 的 tools 可声明 `Calculate`。它映射到宿主 `mcp__research__calculate`，不开放 Bash、JavaScript eval 或 Python 任意执行。`WebFetch` 另外提供 `read_pdf`（需宿主已安装 Poppler 的 pdftotext）；`WebSearch` 未配置商业密钥时使用免费 Bing RSS。所有成功结果由宿主写入本项目来源账本；PDF 保留物理页码，计算保留输入、公式与来源。声明工具不等于实际调用，验收须检查真实账本。免费搜索有相关性和限流限制，不能把摘要当原文或保证市场数据覆盖。

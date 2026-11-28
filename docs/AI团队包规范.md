# AI 团队包标准 v1

一份包是作者设计好的整支团队：角色提示词、Skill、协作关系、可执行流程、工作区和交付标准。安装后由飞书群或本机工作台承接项目目标，平台调度 Agent。包本身不启动独立服务，也不能执行安装脚本。

平台版本与团队能力分开。启航版、领航版继续保留；需要新建飞书项目群和人员分工的团队使用领航版。启航版可在本机体验团队包，原来的单群网页流程保持兼容。旧项目不会自动迁移。

## 三支初始团队

| 团队 | 角色 | 协作方式 |
| --- | --- | --- |
| 筑页 · 网页团队 | 产品经理、设计、程序员 | 澄清最多三轮 → 确认 PRD → 设计 → 确认设计 → 开发 → 新会话走查 → 验收；支持打回 |
| 观澜 · 投研团队 | 研究主理人、信息雷达、收益与风险分析、投资判断、创投评审、研究建议 | 确认范围 → 收集来源 → 分析与反方评审并行 → 判断 → 尽调建议 → 汇总 → 验收 |
| 文枢 · Newtype 内容团队 | 主编、副主编、研究、核查、提取、作者、编辑、归档 | 副主编提出最小够用计划，平台代表主编调度；已有稿件可直接编辑，主编汇总，验收后归档 |

Newtype 是独立来源适配包。安装器固定到 `newtype-01/newtype-codex@e22b7771549572439a092295bb370075ded261a3`，保留原角色模板、协作原文与修改声明，不运行其全局安装器。该提交插件声明 SUL-1.0，但根目录未提供 LICENSE；安装包同时保留同作者 newtype-os 固定版本的 SUL 文本及来源说明，不能把它当作 MIT 或据此推定商业再分发权利。上游内容只下载到本机 `data/packages/`，不纳入平台的 MIT 源码。

## 文件与声明

```text
manifest.json
agents/<角色>.md
skills/<技能>/SKILL.md
collaboration/SKILL.md
collaboration/workflow.json
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
| artifacts | id/name/path/format、可选 requiredKeys/minBytes；format 为 markdown/text/json/html |
| examples | 至少一个 name/demand/expectedArtifacts；用于复现验收 |
| sources | 第三方 url/revision/license/notice；revision 应固定不可变来源 |

角色只读声明目录、只写本角色授权目录。`context/` 由平台保存讨论、分工、计划和包锁，只能读。技能原文和明确声明的资源可以读取；不自动执行技能脚本。角色私有区可通过其他角色的 read 列表排除。项目原文不自动沉淀成跨项目记忆；作者选入包的公共经验属于版本化包文件。

## 协作规则

workflow 具有 entry、coordinator、relations、nodes、maxSteps（默认 80，上限 200）。每个专业角色必须由协调角色的 dispatch 关系授权。handoff/review/synthesize 是对角色关系的说明；实际交接顺序由 next 与 after 强制执行，不能只写在说明中。

| 节点 | 声明与执行 |
| --- | --- |
| task | role、skills（本步必须调用）、prompt、outputs、next；可选 timeoutMinutes、freshSession、validator、questions 分支及 route |
| gate | role、approval、next、可选 reject；questions=true 使用网页澄清表单。普通讨论不等于确认 |
| plan | 规划角色 role、skills、prompt、可选任务 tasks、required、final、next；Agent 只能返回 `{rationale,tasks:[{id,after,brief?}]}` |
| done | 结束。所有节点都必须可到达结束节点 |

task 可声明 `route: {artifact, field, cases: {ready: "下一节点", revise: "修改节点"}}`，从本步已声明的 JSON 产物读取枚举结果；未知值即停，不执行任意表达式。

prompt 可使用 `{{demand}}`、`{{feedback}}`、`{{round}}`。task 的输出按清单检查文件、长度、JSON 字段；网页包额外复用已有网页交付校验器。内置 validator 为 files、web-clarify、web-prd、web-design、web-site、web-walkthrough。第三方可使用通用 files 与 JSON 必填字段契约，不可注入任意可执行校验代码。

plan 的任务目录也是 task 定义，增加 id/name/after。目录中的 after 表示“如果对方被选中，本任务必须等待对方”；required 指定不可省略任务；final 必须等待全部选中任务。验证未知任务、环、缺失依赖与必做任务后才执行。没有依赖的任务可并行，但不能共用角色会话或重叠写目录，整套服务仍共享 AGENT_CONCURRENCY。

出错即停，已完成的计划任务落盘，重试只补失败任务；服务中断不自动继续，待用户重试。人工打回重新进入声明节点，可只重做相应步骤。包的 Skill、角色、流程与读写范围均不能由模型临时扩大。

## 安装、分享与更新

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
# 无可复用机器人时，沿用项目的标准扫码注册流程
node scripts/team-pack.mjs bots newtype-editorial
```

同一团队内一角色一机器人；不同团队可以复用机器人，但同一应用只有一条长连接。补配机器人后重启服务。产品经理作为平台建群入口仍会在新群中，另外邀请所选团队的全部角色；项目消息只调度当前包的角色，不用机器人互发消息触发 Agent。

在 `/teams` 选择包和目标，选择本机或飞书项目群，指定成员、负责人及关口确认人。独立协调机器人在私聊或入口群收到自然语言目标后，会发开工确认卡；发起人确认才新建群，建项前讨论按轮次迁入项目。默认产品经理入口仍保留旧网页工作流。

身份来自可信飞书事件或本机操作者；项目确认继续受人员权限限制，不因换团队包而绕过。

网络能力由平台 MCP 工具提供。WebFetch 映射为只读公网 HTTPS 的 read_url，返回来源与抓取时间；拒绝内网、保留地址，校验每次重定向并固定 DNS 解析地址。本机代理使用 198.18/15 Fake-IP 时，通过固定公网 DoH 服务核实真实公网地址再连接，不放行该保留网段。WebSearch 映射为 Brave 搜索，需要本机 `.env` 中的 `BRAVE_SEARCH_API_KEY`。未配置时明确失败，可提供来源 URL 继续；不能把模型记忆当作实时搜索结果。当前网页提取仅支持 HTML、文本、JSON；图片可用 SDK Read，PDF、音视频和复杂文档应先提供提取文本。

模型档位通过可选的 MODEL_STRONG_NAME / MODEL_FAST_NAME 配置，未填写沿用 MODEL_NAME。所有角色使用同一兼容接口，能力和额度以该接口实际支持为准。

## 作者验收

使用 [team-packager Skill](../skills/team-packager/SKILL.md) 保留原规则映射、声明导出范围、校验、导出并重新导入。验收报告分开记录结构检查、替身编排、真实 SDK、真实飞书；任何一层都不替代其他层。安装成功不能声称机器人已扫码、多人权限已在真人账号上验证或研究结论已核实。

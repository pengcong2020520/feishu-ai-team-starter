# 飞书 AI 团队 · 起步包

用 [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) 搭一支飞书 AI 团队：AI 产品经理、AI 设计、AI 程序员 3 个同事在飞书群里协作，把一句话需求做成一个能用的网页；另有一个网页工作台，一屏看清所有项目。

仓库里是能直接运行的完整代码。你不用自己敲命令：让 AI 编程助手（Claude Code、Codex、Grok 等，桌面版或终端版都行）带着你装。

![施工图](docs/施工图.png)

## 怎么用

1. 克隆到一个新目录：

   ```
   git clone https://github.com/pengcong2020520/feishu-ai-team-starter.git my-feishu-team
   ```

2. 在这个目录里打开 AI 编程助手（Codex 请先切到能联网、能运行命令的模式），说：

   ```
   先读 AGENTS.md，然后帮我把飞书 AI 团队搭起来。
   ```

3. 助手会在对话里一步步问你、带你做。你只需要：
   - 回答模型的接口地址、密钥、模型名（Anthropic 兼容接口，比如火山方舟的 `https://ark.cn-beijing.volces.com/api/compatible`；终端里已经配好 `ANTHROPIC_*` 变量的，说"沿用"即可）；
   - 用飞书手机版扫 3 个二维码，在手机上确认创建 3 个机器人；
   - 最后在自动建好的飞书群「AI 团队」里 @AI 产品经理 说一句需求，按卡片提示点按钮。

准备：Node.js 24 以上；能创建飞书应用的账号（自建团队的管理员最省事）；一个 Anthropic 兼容的模型接口。

团队服务跑在你的电脑上：电脑睡眠时群里的 AI 同事收不到消息（点卡片会提示"目标回调服务不在线"）；电脑重启后要在项目目录运行 `npm start` 重新启动（或让助手帮你启动）。重启前没做完的那一步，群里会提示 @ 对应角色发"重试"。

## 想改点什么

直接对助手说，比如"让 AI 设计更偏好深色主题""给产品经理加一条：PRD 里必须写验收标准"。角色说明在 `prompts/`，技能在 `team-skills/`，助手照 [AGENTS.md](AGENTS.md)「改角色和技能」去改。

## 仓库里有什么

| 内容 | 是什么 |
|---|---|
| `setup.mjs`、`src/setup/` | 一条命令搭好：模型、扫码建 3 个机器人、自动建群、后台启动服务 |
| `src/`、`web/` | 团队服务（接入飞书、编排、3 个 Agent、预览与工作台）和工作台前端 |
| [prompts/](prompts/) | 4 份角色说明：共用约定、产品经理、设计、程序员 |
| [team-skills/](team-skills/) | 技能插件 `team`：8 个技能（澄清、PRD、需求自查、线框、主题、走查、需求覆盖检查、前端） |
| [AGENTS.md](AGENTS.md) | 项目说明书：怎么装、怎么改、整体结构、接口与文件格式、踩过的坑。Codex 自动读；[CLAUDE.md](CLAUDE.md) 让 Claude Code 也读同一份 |
| [docs/施工图.md](docs/施工图.md) | 每一层有哪些模块、放在哪个文件、负责什么、怎么相连 |
| [docs/实测复盘.md](docs/实测复盘.md) | 实测记录：每步用时、人做什么、做出来什么样、踩过的坑 |
| [docs/动手搭建.md](docs/动手搭建.md) | 从零自己搭的路线（配合 `learn` 分支） |

## 想从零自己搭

`learn` 分支只有说明书、角色和技能，没有代码。照 [docs/动手搭建.md](docs/动手搭建.md) 用 9 段提示词让 AI 编程助手一步步搭出来，适合想弄懂原理的人：

```
git clone -b learn https://github.com/pengcong2020520/feishu-ai-team-starter.git my-feishu-team
```

## 这是启蒙版

为了讲清楚原理，它只做单个静态网页、单机运行、状态存在一个文件里。跑通以后，可以加角色、让 Agent 看到页面、接模型网关和 MCP 工具、多项目并行、工作台上公网……起步提示词都在动手路线的最后。

## 出处与许可证

本仓库以 MIT 许可证发布。部分技能改编自 [github/spec-kit](https://github.com/github/spec-kit)（MIT）和 [anthropics/skills](https://github.com/anthropics/skills)（Apache-2.0），见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和各技能文件开头的说明。

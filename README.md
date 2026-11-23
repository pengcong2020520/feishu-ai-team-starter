# 飞书 AI 团队 · 起步包

用 [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview) 搭一支飞书 AI 团队：AI 产品经理、AI 设计、AI 程序员 3 个同事在飞书群里协作，把一句话需求做成一个能用的网页；另有一个网页工作台，一屏看清所有项目。

这个仓库不是现成的程序，而是一份"让你的 AI 编程助手（Codex 或 Claude Code）帮你搭出来"的起步包：

| 内容 | 是什么 |
|---|---|
| [docs/动手搭建.md](docs/动手搭建.md) | 动手路线：准备什么、9 步（第 0–8 步）各做什么、做完是什么样子，每步一段提示词；文末是 8 个拓展方向 |
| [docs/实测复盘.md](docs/实测复盘.md) | 照着做一遍的记录：每步用时、一个需求跑下来 AI 干多久、人做什么、做出来什么样、踩过的坑、背后怎么运转 |
| [docs/施工图.md](docs/施工图.md) | 施工图：每一层有哪些模块、放在哪个文件、负责什么、通过什么接口相连、在第几步建出来（图版 [施工图.png](docs/施工图.png)） |
| [AGENTS.md](AGENTS.md) | 项目说明书：要做什么、整体结构、接口与文件格式、飞书卡片写法、实测踩过的坑。Codex 自动读；[CLAUDE.md](CLAUDE.md) 让 Claude Code 也读同一份 |
| [prompts/](prompts/) | 4 份角色说明：共用约定、产品经理、设计、程序员 |
| [team-skills/](team-skills/) | 技能插件 `team`：8 个技能（澄清、PRD、需求自查、线框、主题、走查、需求覆盖检查、前端） |

![施工图](docs/施工图.png)

## 怎么用

```
mkdir my-feishu-team && cd my-feishu-team
git clone https://github.com/pengcong2020520/feishu-ai-team-starter.git .
```

然后在这个目录里打开 Codex 或 Claude Code，照 [docs/动手搭建.md](docs/动手搭建.md) 从提示词 0 开始，一段做完、验收过了再给下一段。

## 这是启蒙版

为了讲清楚原理，它只做单个静态网页、单机运行、状态存在一个文件里。跑通以后，可以加角色、让 Agent 看到页面、接模型网关和 MCP 工具、多项目并行、工作台上公网……起步提示词都在动手路线的最后。

## 出处与许可证

本仓库以 MIT 许可证发布。部分技能改编自 [github/spec-kit](https://github.com/github/spec-kit)（MIT）和 [anthropics/skills](https://github.com/anthropics/skills)（Apache-2.0），见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和各技能文件开头的说明。

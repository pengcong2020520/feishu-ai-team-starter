# 贡献指南

欢迎贡献团队包、角色与 Skill、平台代码、文档和使用案例。第一次参与，可以从修改一个技能或制作一支小团队开始。

## 制作和分享团队包

1. 复制 `examples/team-package/` 到 `team-packages/<你的包名>/`。
2. 修改 `manifest.json` 的 `id`、`name`、`version`、作者和描述；同步维护角色、技能、工作目录、成果与 `files` 清单。
3. 在 `agents/` 写角色职责，在 `skills/` 写任务方法，在 `collaboration/SKILL.md` 写协作关系，在 `collaboration/workflow.json` 写调度顺序。
4. 在 `examples` 中给出一条真实可执行的示例需求和预期成果。复用第三方内容时保留来源、版本和许可证。

以 `team-packages/my-team` 为例：

```bash
node scripts/team-pack.mjs validate team-packages/my-team
node scripts/team-pack.mjs install team-packages/my-team
```

在工作台选择这支团队，创建项目试跑；需要在飞书使用时，先点“扫码连接飞书”。调好后导出：

```bash
node scripts/team-pack.mjs verify-export team-packages/my-team
node scripts/team-pack.mjs export team-packages/my-team /tmp/my-team.team.json
```

`verify-export` 会在临时目录重新导入导出的包，检查文件与版本是否一致。它不调用模型。

你可以分享 `.team.json`，也可以把包放进自己的 GitHub 仓库，提供包含完整提交号的目录链接。要让项目读者发现你的团队，请[提交 Issue](https://github.com/pengcong2020520/feishu-ai-team-starter/issues/new)，说明用途、角色分工、安装地址和示例成果。

完整格式见[团队包标准](docs/AI团队包规范.md)。需要 Coding Agent 协助打包时，使用 [team-packager Skill](skills/team-packager/SKILL.md)。

## 改进角色与 Skill

团队包的角色和技能在包目录中维护。修改后更新版本号、重新安装，再创建项目使用新版；已有项目继续使用创建时的版本。

原始网页团队的默认角色在 `prompts/`，技能在 `team-skills/skills/`。标准团队包「筑页」的源文件在 `team-packages/web-studio/`，修改默认角色不会自动更新已经安装的团队包。

PR 中给一条示例需求，说明修改前后的输出差异，附必要的截图或文档片段即可。

## 开发平台

Fork 仓库，在自己的分支开发。项目使用 Node.js 24+、ES Modules 和 `node:test`。

```bash
npm ci
npm test
npm run smoke
```

运行真实团队时，按 [README](README.md#快速开始) 完成模型与飞书配置。源码入口：

| 想修改什么 | 从哪里看 |
| --- | --- |
| 团队包协议、安装、编排 | `src/packages/`；字段定义在 `schema.mjs`，调度在 `engine.mjs` |
| Agent SDK、工具和会话 | `src/agents/` |
| 飞书消息、卡片、文档 | `src/feishu.mjs`、`src/presentation.mjs`、`src/feishu-documents.mjs` |
| 网页工作台 | `web/`、`src/preview.mjs`、`src/packages/http.mjs` |
| 安装、扫码和常驻服务 | `setup.mjs`、`src/setup/`、`scripts/service.mjs` |
| 内置团队及上游适配 | `team-packages/`、`src/packages/newtype.mjs`、`scripts/adapt-tradingagents.mjs` |

模块之间的关系见[施工图](docs/施工图.md)。Coding Agent 开工前读取 [AGENTS.md](AGENTS.md)。

## 提交 Issue 或 PR

报告问题时，提供复现步骤、预期结果、实际结果和相关日志。提出新能力时，先说明用户要完成的任务，以及现有方式哪里不够用。

PR 说明改了什么、解决什么问题，以及你实际运行过的检查。界面改动附截图，团队包改动附示例成果，文档改动检查链接和命令。提交平台代码前运行 `npm test` 与 `npm run smoke`。

项目与文档可以直接通过 GitHub Issue 和 PR 讨论。提交内容保留对应的作者与许可证信息。

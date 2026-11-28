# 原作者到飞书团队包的映射

来源：https://github.com/TauricResearch/TradingAgents/tree/121265d18d467ac717f7af99cb0d669c15d2e73c，Apache-2.0。

|上游|本包|适配差异|
|---|---|---|
|主研究 Agent + equity/macro/quant/risk|chief + 同名四专家|中文交付，项目会话隔离|
|specs/skills 的 16 个方法|同名 16 个标准 Skill|保留原文方法，新增权限与交付说明|
|主理人并行派发专家|workflow 的声明任务目录与动态计划|同角色串行，专业方向并行，增加两次确认|
|Tauric 数据及 compute 工具|公开 HTTPS、可选 Brave 搜索、用户材料|未移植专用行情与计算引擎，不能声称等价|
|长期研究记忆及决策追踪|当前项目 inputs/context/专业目录|不跨项目自动读写，不跟踪交易|

原文均保留 upstream/。修改声明见 THIRD_PARTY_NOTICES.md。重建：node scripts/adapt-tradingagents.mjs <固定提交的上游 checkout> <空输出目录>，再执行 team-pack validate/export/verify-export。无需执行上游安装器。

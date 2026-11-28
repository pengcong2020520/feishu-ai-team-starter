# 原型生成记录

使用内置 imagegen；非运行界面截图。

## 整页原型

Use case: ui-mockup.
Create a polished high-fidelity desktop web application UI design image, landscape 1600x1000. This is an original Chinese Feishu AI team workbench prototype for user approval, visually inspired by the ACTUAL Multica interface: slim pale-gray sidebar, white/light-gray workspace, compact horizontal toolbar, fine neutral borders, calm readable sans-serif Chinese typography, subtle small rounded corners, compact kanban cards. Not a marketing landing page. Flat front-on app canvas filling the image. No browser chrome, no monitor, no perspective, NO mouse cursor, NO annotation arrows, NO connector arrows, NO arrow overlays, no watermark.
Focus: exactly ONE current AI team, called 筑页, with exactly THREE roles, AI 产品经理 / AI 设计 / AI 程序员. Different mature teams are alternatives through a discreet bottom-left 团队生态 entry, NEVER show multiple team cards or team names in the primary workspace.
Structure:
1. Left sidebar 220px wide: compact brand 飞书 AI 团队 at top with simple abstract square icon. Current team block 筑页 with subtitle 网页创作团队. Navigation 工作看板 selected in very subtle blue tint; 项目档案 below. Section 项目 with 读书清单 / 城市天气 / 习惯打卡 / 个人主页, each tiny monochrome folder icon. Bottom 团队生态 and 服务设置. Bottom tiny green dot 飞书已连接.
2. Main area top bar 68px: breadcrumb 筑页 / 工作看板 at left, right small 服务运行中 green dot and prominent blue ＋ 新项目 button.
3. Content inset 28px: page title 团队正在做什么, subtitle 2 位正在执行 · 1 项等你确认. Three role cards in ONE horizontal row, 160px high. Each shows modest colored letter/avatar icon, role name, small colored STATE chip, project, current workflow stage, one clear human activity line. Card 1 AI 产品经理, blue 执行中, 城市天气, 阶段：澄清与 PRD, 正在整理天气页需求. Card 2 AI 设计, amber 等你确认, 习惯打卡, 阶段：确认设计, 线框与主题已完成. Card 3 AI 程序员, blue 执行中, 读书清单, 阶段：开发, 正在实现书单筛选. No skill tag lists, no long role descriptions, no token counts.
4. Below, title 项目看板 with unobtrusive select 所有项目. Four equal-width kanban columns, occupying the main screen width and remaining height. Fine separation and pale gray columns:
进行中 2 (blue dot), 等你确认 1 (amber dot), 需处理 0 (red dot), 已完成 1 (green dot).
Each project appears ONCE across these columns. All sample numbers consistent.
Column 进行中: card with eyebrow 读书清单; main task 实现书单筛选; stage 开发; agent AI 程序员; small line 正在更新页面; bottom tiny 已用 4 分钟. Second card with eyebrow 城市天气; main task 整理天气页需求; stage 澄清与 PRD; agent AI 产品经理; line 正在梳理功能与状态; bottom 已用 1 分钟.
Column 等你确认: card with eyebrow 习惯打卡; main task 确认线框与主题; agent AI 设计; line 设计已完成，请查看方案; buttons 查看设计 (outlined neutral) and 确认设计 (small primary blue), separate from normal task text.
Column 需处理: discreet dashed empty rectangle text 暂无需要处理的项目, no fabricated problem.
Column 已完成: card with eyebrow 个人主页; main task 网页已交付; agent AI 程序员; subdued label 已完成; neutral 查看成果 action.
5. Very small unobtrusive bottom-right caption 设计稿 · 示例数据.
Visual quality: measured aligned grid, excellent Chinese legibility, 16px body text / 13px meta / 24px main title at 1600px, white cards slight shadow, restrained blue accent #4F6BED, amber only for waiting, blue-purple-green role avatar accents. No large graphics, no hero, no oversized decorative spaces, no charts, no large gradients, no cyberpunk. The viewer should instantly understand roles, project context, workflow stage, and next action. Preserve all specified wording and counts exactly.

## 组件拆解

Use case: ui-mockup.
Create a polished UI COMPONENT BREAKDOWN SHEET based on the supplied image (reference image: the Chinese Feishu AI team workbench prototype). This is the second deliverable after the full-page design, for reviewing component boundaries before implementation.
Match the supplied UI's visual language exactly: white/pale gray surfaces, thin gray borders, blue primary buttons, small radius, Chinese sans-serif typography, P blue / D purple / E green avatars, amber waiting state. Flat front-on canvas, landscape about 1800x1200. Crisp text. No pointer, no cursor arrows, no connector arrows, no decorative callout arrows.
Top title: 工作台 · 组件拆解. Subtitle: 一个当前团队，一套可复用组件.
Eight clearly separated numbered panels in an orderly 4-column by 2-row grid. Each panel has its ID and Chinese component title OUTSIDE the contained component. It should read like a useful professional design-system sheet, not another app screenshot. Each component is independently complete, close to the reference appearance, and legible. Do not repeat the entire page.
Top row:
01 导航与当前团队 — compact sidebar fragment: 飞书 AI 团队 brand, 筑页 / 网页创作团队, selected 工作看板, 项目档案, bottom 团队生态. Only ONE team shown.
02 页面工具栏 — compact header fragment 筑页 / 工作看板 and 服务运行中 green dot, ＋ 新项目 blue button. Under it show the filter selector 所有项目. Never invent extra tools.
03 角色状态卡 — same AI 程序员 card: E green avatar, 执行中 blue chip, 项目：读书清单, 阶段：开发, 正在实现书单筛选. Below the example, small separate status chips 执行中 / 排队中 / 等你确认 / 空闲 / 需处理 to define variants. Small footer 可重复用于每个角色.
04 看板列头 — stack four slim matching column headers: 进行中 2 blue, 等你确认 1 amber, 需处理 0 red, 已完成 1 green. Small footer 同一项目只出现一次.
Bottom row:
05 执行任务卡 — reference card: small project 读书清单, title 实现书单筛选, 阶段：开发, 负责：AI 程序员, 正在更新页面, 已用 4 分钟. Match all reference hierarchy. Use 负责 instead of 代理.
06 确认任务卡 — project 习惯打卡, title 确认线框与主题, 负责：AI 设计, 设计已完成，请查看方案, white outlined 查看设计 button and blue 确认设计 button. Footer 查看与执行分开.
07 完成与空状态 — completed reference card: 个人主页 / 网页已交付 / 负责：AI 程序员 / green 已完成 / outlined 查看成果. Under it a small dashed empty-state box 暂无需要处理的项目. These are alternatives, not extra active tasks.
08 基础样式 — realistic compact samples: blue primary 确认设计 button, outlined 查看设计 button, neutral text 取消; heading 24px, body 16px, metadata 13px; color swatches labeled 主操作 / 执行 / 待确认 / 需处理 / 完成. Small footer 状态同时使用颜色与文字.
Very small final footer: 设计稿 · 组件与示例状态，待确认后实现.
Do not introduce new product functionality or change the reference's fundamental layout. All Chinese clean and accurate.

## 术语校正

Edit this existing Chinese AI team workbench UI mockup. Change ONLY the label 代理： to 负责： everywhere it occurs in the kanban task cards. Keep every other Chinese word, every card, all layout, dimensions, icons, numbers, colors, and spacing exactly unchanged. Do not add arrows or a cursor. This is a tiny typography correction for terminology consistency, not a redesign.


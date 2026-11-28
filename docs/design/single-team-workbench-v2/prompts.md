# V2 绘图提示词

使用内置 imagegen；参考图为 V1 的 `workbench.png`。生成结果经目视检查后保存到本目录。全部为设计示例，不是真实项目截图。

## 1. 看板与头像浮窗

```text
Use case: ui-mockup. Create a precise high-fidelity Chinese desktop application design, approximately 1568×1004 landscape, edge-to-edge product UI, no browser chrome, no mockup device. Reference image 1 is the previously approved UI STYLE reference, not content to copy. Preserve its light cool-grey background, narrow 258px left navigation, compact 69px top bar, white surfaces, soft subtle borders, restrained cobalt-blue primary buttons, black Chinese sans-serif type, 12px radii. Avoid decorative graphics, annotation arrows, mouse cursors, hero text and dashboard statistics. Clear readable Chinese labels, realistic compact business interface. Every screen shows ONE selected team 文枢, subtitle 内容生产团队. Left sidebar: 飞书 AI 团队 brand, 文枢 team, 工作看板, 项目档案, section 项目 with 产品即分发、AI 产品观察、创作者工具; bottom 团队生态、服务设置 and green 飞书已连接. Eight roles with unique visually distinguishable small illustrated robot head avatars (different silhouette AND color): AI 主编 purple, AI 副主编 indigo, AI 研究员 teal, AI 事实核查 amber, AI 资料提取 cyan, AI 作者 blue, AI 编辑 coral, AI 资料管理员 olive. Tiny footer 设计稿 · 示例数据. No claims that this is live production data.
SCREEN 1: Workboard-first home, bottom avatar dock with anchored hover card.
Top bar 文枢 / 工作看板, green 服务运行中, blue + 新项目. Immediately beneath toolbar (no large role cards, no big hero), compact header 工作看板 with 所有项目 filter. Four tall equal-width kanban columns start at y=166, consume most of content height, bottom y=844. Headers 进行中 2, 等你确认 1, 需处理 0, 已完成 1. Cards white, discrete borders, concise labels:
进行中 first AI 产品观察, title 整理公开资料, subtitle AI 研究员 · 协作研究, activity 正在核对来源, secondary line 查看资料. Second 创作者工具, title 起草文章, subtitle AI 作者 · 内容创作, activity 正在整理正文.
等你确认 one 产品即分发, title 确认最终稿, subtitle AI 主编 · 验收内容, sentence 稿件已整理完成，请确认交付。, outlined 查看最终稿 and blue 确认交付, small text 提出修改.
需处理 understated dashed empty state 暂无需要处理的项目.
已完成 产品体验周报 with green 已完成, secondary 查看成果.
Pinned to bottom content region at y=870: short 100px high white horizontal avatar dock, smalllabel 团队成员 8, single row of EIGHT avatars with short Chinese role names under each; no bulky cards. Status dots and small counts on avatars. All eight should fit this desktop; slim bottom scrollbar/edge scroll affordance suggests horizontal scrolling on smaller widths. No multiple rows.
Show a nonmodal white CHAT-LIKE HOVER POPOVER, width340px, anchored immediately above the FIRST AI 主编 avatar at bottom left of board, with tiny downward tail. No backdrop. It must not obscure board headings or main confirmation card, only cover lower empty area of first column. Popover header AI 主编 + small amber 等你确认. Content 项目：产品即分发, 阶段：验收内容, sentence 最终稿已交付，等待确认。 Then two small text buttons 角色提示词 and Skill · 1; footer 查看全部任务. Keep popover mouse-reachable. Only this one hover state, not a modal.
The entire four-column board headers and cards must be visible above the avatar dock on first screen. Main improvement is freeing initial viewport for work, NOT introducing new workflow stages.
```

## 2. 项目对话

```text
Use case: ui-mockup. Create a precise high-fidelity Chinese desktop application design, approximately 1568×1004 landscape, edge-to-edge product UI, no browser chrome, no mockup device. Reference image 1 is the previously approved UI STYLE reference, not content to copy. Preserve its light cool-grey background, narrow 258px left navigation, compact 69px top bar, white surfaces, soft subtle borders, restrained cobalt-blue primary buttons, black Chinese sans-serif type, 12px radii. Avoid decorative graphics, annotation arrows, mouse cursors, hero text and dashboard statistics. Clear readable Chinese labels, realistic compact business interface. Every screen shows ONE selected team 文枢, subtitle 内容生产团队. Left sidebar: 飞书 AI 团队 brand, 文枢 team, 工作看板, 项目档案, section 项目 with 产品即分发、AI 产品观察、创作者工具; bottom 团队生态、服务设置 and green 飞书已连接. Eight roles with unique visually distinguishable small illustrated robot head avatars (different silhouette AND color): AI 主编 purple, AI 副主编 indigo, AI 研究员 teal, AI 事实核查 amber, AI 资料提取 cyan, AI 作者 blue, AI 编辑 coral, AI 资料管理员 olive. Tiny footer 设计稿 · 示例数据. No claims that this is live production data.
SCREEN 2: Project detail as a Codex-desktop-style CHAT workspace, with artifact timeline on right.
Keep same left navigation, highlight project 产品即分发. Top header breadcrumb 文枢 / 产品即分发, amber pill 等你确认, secondary 查看流程, 打开飞书群 ↗.
Content is two panels, chat takes about 72% and RIGHT SIDEBAR 28% width (330px). No large status summaries or role cards above the chat. Left/main header 项目对话; tiny secondary 自项目创建起的完整记录 and earlier-history control 查看更早记录.
The chat is chronological and conversational. All HUMAN messages RIGHT aligned pale blue bubbles and avatar at right. All AI messages LEFT aligned white bubbles with each role's unique colored illustrated robot avatar at left, name and timestamp ABOVE its message. Use realistic readable Chinese:
small centered 今天 14:10
RIGHT human label 你 · 14:10 message 这篇面向产品经理，重点解释产品如何带来传播。
LEFT purple chief AI 主编 · 14:11: 收到。保留核心观点，补充两个案例，最后给出可操作的建议。
LEFT teal researcher AI 研究员 · 14:18: 案例资料已补齐，相关来源已整理到研究记录。 inline outlined artifact chip 研究记录 ↗.
RIGHT 你 · 14:20: 标题再简洁一点，别写成行业报告。
LEFT blue writer AI 作者 · 14:27: 标题改为「让产品自己说话」，正文已按这个方向调整。 inline artifact chip 文章初稿.
LEFT purple chief AI 主编 · 14:32: 最终稿已整理完成，等你确认。 Below inside same conversation card: white document preview strip 让产品自己说话 / 最终稿, link 查看稿件; action row cobalt 确认交付 and outlined 提出修改. This is the only active approval action in the chat.
At bottom fixed composer full chat column, not overlapping history: recipient control 发给 AI 主编, multilineplaceholder 补充想法，或 @ 同事…, blue 发送. No avatar dock in this project conversation view.
Right sidebar header 交付物 with small chronological hint 最新在上 and subtle vertical timeline line. Compact separate nodes:
14:32 最终稿 / 让产品自己说话 / AI 主编 · 等你确认 / 预览 and 飞书文档 ↗;
14:29 编辑稿 / AI 编辑;
14:27 文章初稿 / AI 作者;
14:18 研究记录 / AI 研究员;
14:12 写作计划 / AI 副主编.
Each entry distinguishes document title, author and time. Sidebar is scrollable independently; intermediate files retained. Bottom smallline 点击文稿可在当前页预览. No raw JSON, logs, file paths, code fences or token statistics. Chat scroll and composer occupy the main big screen.
```

## 3. 角色详情

```text
Use case: ui-mockup. Create a precise high-fidelity Chinese desktop application design, approximately 1568×1004 landscape, edge-to-edge product UI, no browser chrome, no mockup device. Reference image 1 is the previously approved UI STYLE reference, not content to copy. Preserve its light cool-grey background, narrow 258px left navigation, compact 69px top bar, white surfaces, soft subtle borders, restrained cobalt-blue primary buttons, black Chinese sans-serif type, 12px radii. Avoid decorative graphics, annotation arrows, mouse cursors, hero text and dashboard statistics. Clear readable Chinese labels, realistic compact business interface. Every screen shows ONE selected team 文枢, subtitle 内容生产团队. Left sidebar: 飞书 AI 团队 brand, 文枢 team, 工作看板, 项目档案, section 项目 with 产品即分发、AI 产品观察、创作者工具; bottom 团队生态、服务设置 and green 飞书已连接. Eight roles with unique visually distinguishable small illustrated robot head avatars (different silhouette AND color): AI 主编 purple, AI 副主编 indigo, AI 研究员 teal, AI 事实核查 amber, AI 资料提取 cyan, AI 作者 blue, AI 编辑 coral, AI 资料管理员 olive. Tiny footer 设计稿 · 示例数据. No claims that this is live production data.
SCREEN 3: Dedicated AI role detail page, NOT blocking popup.
Left navigation same, breadcrumb 文枢 / AI 主编. Content header large purple avatar, AI 主编, description 协调写作目标、分派任务，汇总最终稿。 On same header right two outlined small buttons 角色提示词 and Skill · 1. Rightmost button Skill visibly selected/open.
Beneath header a compact current assignment strip 当前任务 | 产品即分发 | 验收内容 | 等你确认 with small 查看项目 button.
Main content 70% width contains heading 任务记录, search field 搜索任务或项目, small filters 全部 / 进行中 / 已完成. Show a chronological history of actual WORK ITEMS, not just project list:
expanded row 产品即分发 / 汇总最终稿 / 今天 14:32 / 等你确认. Under it result sentence 已整理正文、来源和修改意见，等待交付确认。 Then smallgroup 相关对话 with RIGHT human bubble 标题再简洁一点，别写成行业报告。 at14:20, LEFT chief bubble 最终稿已按这个方向整理完成。 at14:32. End of expanded task two outlinedbuttons 查看完整对话 and 最终稿.
next collapsed row 产品即分发 / 明确写作方向 / 今天 14:11 / 已完成 with chevron.
next collapsed row 产品体验周报 / 汇总交付 / 昨天 17:45 / 已完成 with chevron.
next collapsed row 创作者工具 / 协调任务 / 11月26日 10:18 / 已完成 with chevron.
Do not limit history to a single last project.
Right 350px inline side pane header Skill 目录 with close× (no page dimming). Searchbox 搜索 Skill. Exactly ONE chief skill row, name 主编协作, identifier chief-method, description 协调目标、选择路由和最终汇总. Below selected skill divider and readable content: 负责什么 / 明确写作目标，协调同事，汇总稿件。; 使用方法 / 读取项目讨论与已有材料，明确下一步并组织交付。; 相关任务 / 汇总最终稿 · 产品即分发 / 明确写作方向 · 产品即分发 / 汇总交付 · 产品体验周报. Use simple rows, not redundant boxed stats. Footer small 查看 Skill 原文.
The role prompt button is visible and distinct beside the name so an editor can be opened; its editing view is specified separately, don't embed a second fake modal in this frame. All content stays comfortably readable and compact, showing this role's responsibilities, current task, complete task history and skill directory.
```

## 4. 编辑与预览组件

```text
Use case: ui-mockup. Create a polished component design sheet 1568×1004 landscape for a Chinese AI team workbench, matching the referenced light cool-grey white and cobalt-blue UI exactly. Reference is an approved visual style, not a page to copy. This is a design sheet with TWO side-by-side large overlay components, NOT two overlapping windows, no device, no browser chrome, no pointer or annotation arrows. Crisp Chinese sans-serif text, gray borders, 12px radii, subtle shadow. 36px margins. Top title 编辑与预览, small subtitle 角色提示词可编辑 · 文稿在当前页面阅读. Bottom tiny 设计稿 · 示例数据.
LEFT component width700 height820:
Top header purple distinct small robot avatar, AI 主编, right title 角色提示词, close ×. Under line 文枢 · 当前角色说明. Two small view controls 阅读 / 编辑 with 编辑 selected blue. Large multiline text editor with visible caret, simple nicely spaced editable text (NOT code or JSON):
你是内容团队的主编。
职责
明确写作目标，协调各角色，并汇总最终稿。
协作方式
先阅读项目讨论和已有材料，再分派工作。
面对补充意见，先理解影响，再决定下一步。
表达要求
用简洁清楚的语言说明结果、限制和下一步。
不把工具日志、内部路径和调用信息发给用户。
Bottom editor mutedline 已修改，尚未保存. Fixed footer tiny meaningful hint 新项目使用此修改，已有项目继续原版本。 Buttons 取消 and primary 保存修改. Do not show version numbers or technical hash.
RIGHT component width740 height820:
Header 文稿预览, close×; smallsubheader 产品即分发 · 最终稿 · AI 主编. White reading surface with a very compact outline on left (150px) containing 内容目录, 产品如何带来传播, 从体验到分享, 给产品经理的建议. Wider prose area right with human readable nicely typeset rendered document, NO raw markdown marks:
article title 让产品自己说话
leadparagraph 当用户愿意向朋友解释一个产品，分发就已经开始了。
section heading 01 产品如何带来传播
paragraph 有价值的使用体验，会成为用户愿意分享的理由。产品需要把价值放在最容易被感知的位置。
section heading 02 从体验到分享
paragraph 让第一次成功更早发生，让分享自然地出现在用户获得价值之后。
section heading 03 给产品经理的建议
three small numbered lines:
1. 找到最值得被转述的体验。
2. 让用户容易表达自己的收获。
3. 把分享放在合适的时机。
Bottom footer timestamp 今天 14:32 · 本次交付 and secondary outlined 打开飞书文档 ↗. No workflow approval button in this document preview.
Make both overlay components look usable and consistent with role profile and project chat design, clean and readable.
```

## 看板状态修订

初稿头像数字没有明确口径，且状态色与项目卡不一致。仅保留对应执行/等待/空闲状态点，取消无依据的数字角标。

```text
Precise edit of this approved UI design. Preserve EVERY pixel-level layout, color, label, card, sidebar, header, popover, eight distinctive robot avatars and footer as closely as possible. CHANGE ONLY the small upper-right numeric badges on the eight avatars in bottom dock. Remove ALL small numbers 3/1/2/0 and their pill boxes from the avatar badges. Replace them with a single clean small status dot per avatar: AI 主编 AMBER dot (waiting confirmation), AI 研究员 BLUE dot (working), AI 作者 BLUE dot (working); AI 副主编, AI 事实核查, AI 资料提取, AI 编辑, AI 资料管理员 GRAY dots (idle). No green dots on the avatar dock. Keep team member count 8 unchanged; keep column counts unchanged; keep Skill · 1 in hover popover unchanged. No other changes. This makes the avatar states agree with the four board project cards.
```

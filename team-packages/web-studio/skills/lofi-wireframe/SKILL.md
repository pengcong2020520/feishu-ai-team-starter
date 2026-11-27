---
name: lofi-wireframe
description: PRD 已确认、要画覆盖完整流程和各个页面状态的低保真线框时使用。
---

# 低保真线框

改编自 learn-codex-harness 的 lofi-wireframe。

## 用户提示词原文（已实测）

根据当前项目已经写好的 PRD，梳理产品的完整核心交互流程，并生成一份低保真线框图，最终输出为一个单页 HTML 文件。

要求：
1. 只做低保真，不做正式 UI。使用黑白灰、基础框线和图片占位块，只表达信息层级、核心文案、按钮位置和页面状态；
2. 按照用户真实使用产品的先后顺序分组，把 PRD 中涉及的核心页面和关键状态全部平铺在同一页，让我可以从头到尾检查整个流程；
3. 每一屏都标清页面名称、它在流程里的位置、用户可以执行的操作，以及操作之后会进入哪个页面或状态；
4. 除了正常流程，还要补齐 PRD 中涉及的首次使用、权限申请、加载中、无数据、失败和异常恢复等状态；
5. 不要擅自增加 PRD 里没有的功能。PRD 中没有说明清楚的地方单独标成「待确认」，不要自行补全；
6. 所有内容放在一个 HTML 文件里，打开文件就能完整查看。

## 在飞书团队里的执行补充

- 输入 docs/prd.md，输出 design/wireframe.html：单文件、可离线打开、只用系统字体，不引用任何外部资源。
- 先把 PRD 的"页面与状态"映射成分组、屏和状态，再动手画；屏和状态的 id 与 PRD 一致。
- 每个状态写成一个 `<section data-screen="<屏 id>" data-state="<状态 id>" data-group="<分组 id>">`。
- 页面支持定位：地址带 `#screen=<屏 id>&state=<状态 id>` 时只显示对应的那个 section，首次加载和 hashchange 都要生效；没有定位时按流程顺序平铺全部 section（原文第 2 条）。section 默认就是显示的，不要在样式表里先藏起来；定位脚本照下面这段写（没有定位时清掉行内样式，否则行内的 `display:none` 会压过样式表，整页变成空白）：

```html
<script>
function applyHash() {
  var m = location.hash.match(/screen=([^&]+)&state=([^&]+)/);
  document.querySelectorAll('section[data-screen]').forEach(function (s) {
    s.style.display = !m || (s.dataset.screen === decodeURIComponent(m[1]) && s.dataset.state === decodeURIComponent(m[2])) ? '' : 'none';
  });
}
addEventListener('hashchange', applyHash);
applyHash();
</script>
```
- 内嵌大纲，系统按它在群里的卡片上列出分组和状态；卡片附一个链接，点开就是这个文件：

```html
<script type="application/json" id="design-outline">
{"groups":[{"id":"signup","title":"报名","order":1,"screens":[{"id":"page","title":"报名页","position":1,"states":["default","form-error","success"],"actions":[{"label":"立即报名","to":"#screen=page&state=success"}]}]}]}
</script>
```

- 每个 section 里用小号灰字标注页面名称、流程位置、可执行操作和操作后的去向（原文第 3 条），标注放在区块旁边，不遮挡内容。
- 画布宽 1280，每个状态按电脑首屏（1280×800）组织。关键状态控制在 6 个以内，优先放 PRD 用户故事涉及的状态，从头看到尾不会太长。
- 篇幅控制在 200 行以内：样式共用，各状态只写差异。
- PRD 已经确认，原则上不出现"待确认"；确有遗漏，按原文第 5 条单独标出。

最后的回复：一句话说明分了几组、几个状态，不超过 40 字。

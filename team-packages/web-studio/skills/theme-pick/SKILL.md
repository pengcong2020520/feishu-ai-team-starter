---
name: theme-pick
description: 线框画好后，要按目标用户和场景为页面选定视觉主题、写出主题令牌时使用。
---

# 选定主题

改编自 learn-codex-harness 的 theme-factory。预设来自 [anthropics/skills 的 theme-factory](https://github.com/anthropics/skills/tree/main/skills/theme-factory)，Apache-2.0 许可证。演示流程精简：不让用户三选一，由你按受众从下面 10 套预设里选一套，必要时微调，并写明理由。

## 10 套预设

| id | 名称 | 配色（用途） | 标题 / 正文字体气质 | 适合 |
|---|---|---|---|---|
| ocean-depths | 海洋深处 | #1a2332 深海蓝（底）、#2d8b8b 青（强调）、#a8dadc 浅海绿、#f1faee 米白（文字） | 无衬线 / 无衬线 | 商务、金融、专业可信 |
| sunset-boulevard | 日落大道 | #e76f51 焦橙（主色）、#f4a261 珊瑚、#e9c46a 暖沙、#264653 深青（文字） | 衬线 / 无衬线 | 活动推广、生活方式、创意 |
| forest-canopy | 森林冠层 | #2d4a2b 森林绿（主色）、#7d8471 鼠尾草、#a4ac86 橄榄、#faf9f6 象牙白 | 衬线 / 无衬线 | 环保、户外、健康 |
| modern-minimalist | 现代极简 | #36454f 炭灰（主色）、#708090 石板灰、#d3d3d3 浅灰、#ffffff 白 | 无衬线 / 无衬线 | 科技、建筑、设计作品 |
| golden-hour | 金色时刻 | #f4a900 芥末黄（主色）、#c1666b 陶土红、#d4b896 暖米、#4a403a 巧克力棕（文字） | 无衬线 / 无衬线 | 餐饮、秋季活动、温馨手作 |
| arctic-frost | 北极霜色 | #d4e4f7 冰蓝（底）、#4a6fa5 钢蓝（主色）、#c0c0c0 银、#fafafa 纯白 | 无衬线 / 无衬线 | 医疗、清洁科技 |
| desert-rose | 沙漠玫瑰 | #d4a5a5 灰玫瑰（主色）、#b87d6d 陶土、#e8d5c4 沙色（底）、#5d2e46 酒红（文字） | 无衬线 / 无衬线 | 时尚、美妆、婚礼 |
| tech-innovation | 科技创新 | #0066ff 电光蓝（主色）、#00ffff 霓虹青、#1e1e1e 深灰（底）、#ffffff 白 | 无衬线 / 无衬线 | 科技新品、AI、发布会 |
| botanical-garden | 植物花园 | #4a7c59 蕨绿（主色）、#f9a620 金盏黄、#b7472a 赤陶、#f5f3ed 奶油（底） | 衬线 / 无衬线 | 园艺、食物、自然品牌 |
| midnight-galaxy | 午夜星河 | #2b1e3e 深紫（底）、#4a4e8f 宇宙蓝、#a490c2 薰衣草、#e6e6fa 银白（文字） | 无衬线 / 无衬线 | 娱乐、游戏、夜生活 |

## 怎么选

1. 读 docs/prd.md 的目标用户与场景，选一套气质最贴近的预设。
2. 只用系统字体：衬线用 `"Songti SC","Noto Serif SC",serif`，无衬线用 `system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif`，以字重、字号和间距体现气质，不下载字体。
3. 补齐状态色（成功、警告、错误、禁用）和中性色，核对正文与背景的对比度不低于 4.5:1，不够就调深或调浅。
4. 不改线框的页面结构，主题只管颜色、字体、圆角、间距和阴影。

## 产出

写 design/theme.json：

```json
{
  "preset": "sunset-boulevard",
  "name": "日落大道",
  "reason": "一句话：为什么适合这个页面的用户",
  "tokens": {
    "colors": {"background":"#fffaf5","surface":"#ffffff","text":"#264653","muted":"#5b6b73","border":"#eadfd3","primary":"#e76f51","onPrimary":"#ffffff","accent":"#e9c46a","success":"#2a9d8f","warning":"#b7791f","error":"#c0392b","disabled":"#e5e1dc"},
    "typography": {"headingFamily":"\"Songti SC\",\"Noto Serif SC\",serif","bodyFamily":"system-ui,-apple-system,\"PingFang SC\",sans-serif","sizes":{"caption":13,"body":16,"h3":20,"h2":28,"h1":40},"weights":{"body":400,"heading":700},"lineHeights":{"body":1.6,"heading":1.25}},
    "radii": {"small":6,"medium":10,"large":16},
    "spacing": {"xs":4,"sm":8,"md":16,"lg":24,"xl":40},
    "shadows": {"none":"none","raised":"0 6px 20px rgb(38 70 83 / 12%)"}
  }
}
```

颜色及状态色、字号层级、圆角、间距、阴影缺一不可；数字单位为 px，行高为倍数。上面的数值只是示例，按选定的预设和页面实际生成。

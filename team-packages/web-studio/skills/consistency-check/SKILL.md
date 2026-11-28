---
name: consistency-check
description: 走查网页时使用：对照 PRD 的功能需求和成功标准，检查每一条在页面上是否实现，找出缺漏和前后不一致。
---

# 需求覆盖与一致性检查

改编自 [github/spec-kit](https://github.com/github/spec-kit) 的 analyze 命令（MIT 许可证，Copyright GitHub, Inc.）。只分析、不改文件；结论写进走查结果。

## 怎么做

1. 从 docs/prd.md 列出全部功能需求（FR-xxx）和成功标准（SC-xxx）。
2. 逐条找证据：在 site/index.html 的哪个元素、哪个函数实现，到达哪个状态时能看到。找不到证据就算"未覆盖"。
3. 找问题，按严重程度标注：
   - **严重**：功能需求未实现，或核心流程走不通；
   - **高**：需求之间互相矛盾，或成功标准无法检查；
   - **中**：PRD、线框、网页的叫法不一致，边界情况没处理；
   - **低**：文字措辞、小的重复。
4. 把结果写进 design/walkthrough.json 的 `coverage` 和 `findings`：

```json
{
  "coverage": {
    "total": 6,
    "covered": 5,
    "items": [
      {"id": "FR-001", "covered": true, "evidence": "页头 .tags 写明线上直播和每周三 20:00，default 状态可见"},
      {"id": "FR-004", "covered": false, "evidence": "提交后没有显示剩余名额"}
    ]
  },
  "findings": [
    {"severity": "高", "summary": "一句话问题", "where": "FR-004 / success", "fix": "一句话建议"}
  ]
}
```

`total` 是功能需求和成功标准的总条数，`covered` 是有证据的条数。最多列 8 条问题，按严重程度排序。有"严重"或"高"的问题，走查结论就是"需修改"。

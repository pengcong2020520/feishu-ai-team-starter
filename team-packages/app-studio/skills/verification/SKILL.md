---
name: verification
description: 核对应用测试场景与实际受控容器回执
---

对照规格列出需验证的 API、界面、数据和异常场景。平台负责运行 SQL 迁移与 `node --test`，覆盖 `qa/verification.json`；仅 `source=platform-docker` 的回执能决定通过或退回。测试失败时将具体输出交给程序员修复，修复后重跑。

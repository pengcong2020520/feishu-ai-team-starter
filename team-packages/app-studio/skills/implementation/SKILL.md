---
name: implementation
description: 实现 Node.js 24 前端、HTTP 后端、SQLite 迁移及自动测试
---

依照已确认规格和任务清单写 `app/`。用 Node 内置模块，不引入 npm 依赖。API 要有输入检查、清晰错误和持久化；服务从环境读取 `PORT`、`APP_DB_PATH`，提供 `/health`。迁移使用递增的三位编号 SQL 文件，已部署的迁移不修改。测试使用 `node:test`，至少覆盖成功、失败和持久化。

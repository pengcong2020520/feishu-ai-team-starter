# AI 全栈程序员

依据已确认的产品规格、设计和架构方案，编写完整的 Node.js 24 应用：`app/server.mjs`、`app/index.html`、`app/migrations/001.sql` 与 `app/test/app.test.mjs`。只使用 Node 内置 `node:http`、`node:sqlite`、`node:test` 等模块；当前运行器不安装 npm 依赖。

服务监听 `0.0.0.0` 的 `PORT`（默认 3000），数据库路径读取 `APP_DB_PATH`，`GET /health` 返回 2xx。数据库迁移放在 `app/migrations/` 中，文件名依次 `001.sql`、`002.sql`；不能修改已部署的旧迁移。测试需覆盖用户故事、HTTP API、数据写入、无效输入及重启后持久化。不能自报测试通过，平台会在独立容器里实际运行。

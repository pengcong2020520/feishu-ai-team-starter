import { createServer as httpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export function createApp(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode=WAL');
  const server = httpServer(async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    try {
      if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
      if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(await readFile(path.join(here, 'index.html'))); }
      if (req.method === 'GET' && req.url === '/api/registrations') return send(200, { items: db.prepare('SELECT name FROM registrations ORDER BY id').all() });
      if (req.method === 'POST' && req.url === '/api/registrations') {
        let body = ''; for await (const chunk of req) { body += chunk; if (body.length > 4096) return send(413, { error: '内容过长' }); }
        let value; try { value = JSON.parse(body); } catch { return send(400, { error: '请求格式错误' }); }
        const name = String(value?.name || '').trim();
        if (!name || name.length > 40) return send(400, { error: '姓名须为 1–40 字' });
        const count = db.prepare('SELECT count(*) AS n FROM registrations').get().n;
        if (count >= 10) return send(409, { error: '名额已满' });
        db.prepare('INSERT INTO registrations(name) VALUES (?)').run(name);
        return send(201, { ok: true });
      }
      send(404, { error: '页面不存在' });
    } catch { send(500, { error: '服务暂时不可用' }); }
  });
  server.on('close', () => db.close());
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp(process.env.APP_DB_PATH).listen(Number(process.env.PORT || 3000), '0.0.0.0');
}

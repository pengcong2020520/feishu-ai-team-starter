import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';

// 服务器首次扫码尚无工作台；只临时提供标准注册器生成的 QR 页面，不暴露项目目录。
export async function startQrServer(qrDir) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    const port = server.address().port;
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host) || req.headers['sec-fetch-site'] === 'cross-site') { res.writeHead(403).end(); return; }
    if (req.method !== 'GET') { res.writeHead(405).end(); return; }
    let file; try { file = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).slice(1) || 'index.html'; } catch { res.writeHead(400).end(); return; }
    if (!/^(?:index\.html|status\.js|[a-zA-Z0-9_-]+\.png)$/.test(file)) { res.writeHead(404).end(); return; }
    try { const body=await readFile(path.join(qrDir,file));res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'image/png');res.end(body); }
    catch { res.writeHead(404).end(); }
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;
  return {port,url:`http://127.0.0.1:${port}/`,close:()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();})};
}

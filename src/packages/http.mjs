import { listPackages } from './store.mjs';
import { readBindings } from './bindings.mjs';

// 与原工作台相同的本机身份和同源写入边界；绝不接受请求体提供的身份。
export async function packageHttp({ req, res, url, root, flow, recorder, send }) {
  if (!url.pathname.startsWith('/api/packages')) return false;
  const engine = flow?.packages;
  const reply = (code, value) => send(res, code, JSON.stringify(value), false, 'application/json; charset=utf-8');
  try {
    if (!engine) { reply(404, { error: '团队包服务未启用' }); return true; }
    if (req.method === 'GET') {
      if (url.pathname === '/api/packages') {
        const packages = await listPackages(root), bindings = await readBindings(root);
        reply(200, { packages: packages.map(p => ({ ...p, bindings: bindings[p.id]?.roles || {}, feishuReady: p.roles.every(r => bindings[p.id]?.roles?.[r.id]) })), projects: await engine.snapshot() }); return true;
      }
      if (url.pathname === '/api/packages/artifact') { reply(200, await engine.artifact(url.searchParams.get('projectId'), url.searchParams.get('artifactId'))); return true; }
      reply(404, { error: '未找到' }); return true;
    }
    if (req.method !== 'POST') { reply(405, { error: '方法不支持' }); return true; }
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { reply(403, { error: 'Origin 不允许' }); return true; }
    if (req.headers['x-workbench'] !== '1' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { reply(415, { error: '请求格式不正确' }); return true; }
    let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16384) { reply(413, { error: '请求过大' }); return true; } }
    const data = JSON.parse(body);
    const admin = data.via === 'admin';
    if (admin && (!process.env.ADMIN_WORKBENCH_TOKEN || req.headers['x-admin-token'] !== process.env.ADMIN_WORKBENCH_TOKEN)) { reply(403, { error: '管理员身份不匹配' }); return true; }
    const identity = admin ? { role: 'admin', openId: process.env.FEISHU_ADMIN_OPEN_ID } : await flow.projects?.localIdentity();
    const event = { identity, source: admin ? 'admin' : 'local', actor: admin ? 'AI 管理员助手（代你）' : '本机操作者' };
    if (url.pathname === '/api/packages/projects') {
      const options = { name: data.name, channel: data.channel || 'local', scope: data.scope, ownerId: data.ownerId, memberIds: data.memberIds, approvers: data.approvers };
      reply(200, await engine.create({ package: data.package, text: data.text, requestId: data.requestId, options, ...event })); return true;
    }
    if (typeof data.chatId !== 'string' || !await engine.get(data.chatId)) throw Error('项目不存在');
    if (url.pathname === '/api/packages/action') {
      if (data.feedback !== undefined && (typeof data.feedback !== 'string' || data.feedback.length > 4000)) throw Error('修改意见过长');
      reply(200, await engine.action({ chatId: data.chatId, value: data.value, formValue: data.formValue, feedback: data.feedback, ...event })); return true;
    }
    if (url.pathname === '/api/packages/message') {
      if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000 || typeof data.role !== 'string') throw Error('消息无效');
      const p = await engine.get(data.chatId); if (!p.roles.some(r => r.id === data.role)) throw Error('角色无效');
      await recorder?.add(data.chatId, { kind: 'user', role: data.role, text: data.text, actor: event.actor, source: '工作台', projectId: p.id });
      reply(200, await engine.message({ chatId: data.chatId, role: data.role, text: data.text, senderType: 'user', ...event })); return true;
    }
    reply(404, { error: '未找到' });
  } catch (error) { reply(400, { error: error.message }); }
  return true;
}

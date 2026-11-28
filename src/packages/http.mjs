import { listPackages, latestPackages, lockedPackage, roleSource } from './store.mjs';
import { readBindings } from './bindings.mjs';
import { saveRolePrompt } from './prompt-editor.mjs';

// 与原工作台相同的本机身份和同源写入边界；绝不接受请求体提供的身份。
export async function packageHttp({ req, res, url, root, flow, feishu, recorder, send }) {
  if (!url.pathname.startsWith('/api/packages')) return false;
  const engine = flow?.packages;
  const reply = (code, value) => send(res, code, JSON.stringify(value), false, 'application/json; charset=utf-8');
  try {
    if (!engine) { reply(404, { error: '团队包服务未启用' }); return true; }
    if (req.method === 'GET') {
      if (url.pathname === '/api/packages') {
        const packages = latestPackages(await listPackages(root)), bindings = await readBindings(root);
        reply(200, { packages: packages.map(p => ({ ...p, bindings: bindings[p.id]?.roles || {}, feishuReady: p.roles.every(r => feishu?.connectedRoles?.().includes(bindings[p.id]?.roles?.[r.id])) })), projects: await engine.snapshot(), connection: flow.connections?.status() }); return true;
      }
      if (url.pathname === '/api/packages/role') {
        const projectId = url.searchParams.get('projectId'), role = url.searchParams.get('role');
        const source = projectId ? await engine.roleSource(projectId, role) : roleSource(await lockedPackage(root, { id: url.searchParams.get('id'), version: url.searchParams.get('version'), hash: url.searchParams.get('hash') }), role);
        reply(200, source); return true;
      }
      if (url.pathname === '/api/packages/artifact') { reply(200, await engine.artifact(url.searchParams.get('projectId'), url.searchParams.get('artifactId'))); return true; }
      if (url.pathname === '/api/packages/evidence') { reply(200, await engine.evidence(url.searchParams.get('projectId'))); return true; }
      reply(404, { error: '未找到' }); return true;
    }
    if (req.method !== 'POST') { reply(405, { error: '方法不支持' }); return true; }
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) { reply(403, { error: 'Origin 不允许' }); return true; }
    if (req.headers['x-workbench'] !== '1' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) { reply(415, { error: '请求格式不正确' }); return true; }
    let body = ''; for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16384) { reply(413, { error: '请求过大' }); return true; } }
    const data = JSON.parse(body);
    const admin = data.via === 'admin';
    if (admin && (!process.env.ADMIN_WORKBENCH_TOKEN || req.headers['x-admin-token'] !== process.env.ADMIN_WORKBENCH_TOKEN)) { reply(403, { error: '管理员身份不匹配' }); return true; }
    if (url.pathname === '/api/packages/prompt') {
      reply(200, await saveRolePrompt(root, data)); return true;
    }
    const manager = flow.packageProjects || flow.projects;
    if (url.pathname === '/api/packages/connect') {
      if (!flow.connections) throw Error('扫码服务未启用');
      reply(200, await flow.connections.start(data.packageId)); return true;
    }
    const target = data.chatId ? await engine.get(data.chatId) : null;
    const identity = admin ? { role: 'admin', openId: process.env.FEISHU_ADMIN_OPEN_ID } : await manager?.localIdentity(target?.package.id || data.package?.id);
    const event = { identity, source: admin ? 'admin' : 'local', actor: admin ? 'AI 管理员助手（代你）' : '本机操作者' };
    if (url.pathname === '/api/packages/projects') {
      if (data.reviewMode !== undefined && !['human', 'auto'].includes(data.reviewMode)) throw Error('请选择人工确认或自动审核');
      const options = { name: data.name, channel: data.channel || 'feishu', reviewMode: data.reviewMode };
      if (options.channel === 'feishu') {
        const pack = await lockedPackage(root, data.package), bindings = await readBindings(root, pack.manifest.id);
        if (!pack.manifest.roles.every(r => feishu?.connectedRoles?.().includes(bindings.roles[r.id]))) throw Error('请先扫码连接本团队的全部飞书机器人');
      }
      reply(200, await engine.create({ package: data.package, text: data.text, requestId: data.requestId, options, ...event })); return true;
    }
    if (typeof data.chatId !== 'string' || !await engine.get(data.chatId)) throw Error('项目不存在');
    if (url.pathname === '/api/packages/name') { reply(200, await engine.renameProject({ chatId: data.chatId, name: data.name, ...event })); return true; }
    if (url.pathname === '/api/packages/documents') { reply(200, await engine.syncDocuments({ chatId: data.chatId, ...event })); return true; }
    if (url.pathname === '/api/packages/action') {
      if (data.feedback !== undefined && (typeof data.feedback !== 'string' || data.feedback.length > 4000)) throw Error('修改意见过长');
      reply(200, await (data.value?.action === 'package_start' ? flow.packageLobby : engine).action({ chatId: data.chatId, value: data.value, formValue: data.formValue, feedback: data.feedback, ...event })); return true;
    }
    if (url.pathname === '/api/packages/message') {
      if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000 || typeof data.role !== 'string') throw Error('消息无效');
      const p = await engine.get(data.chatId); if (!p.roles.some(r => r.id === data.role)) throw Error('角色无效');
      const auth = await manager?.authorize({ project: p, identity, source: event.source, action: 'discuss' });
      if (auth && !auth.ok) throw Error(auth.reason);
      let messageId;
      if (!p.chatId.startsWith('web:')) messageId = await feishu.sendText(p.chatId, `${event.actor}（工作台）：${data.text}`, p.botBindings[data.role], { record: false });
      await recorder?.add(data.chatId, { kind: 'user', role: data.role, text: data.text, actor: event.actor, source: '工作台', projectId: p.id, messageId, identity, authority: auth?.authority || 'member' });
      reply(200, await engine.message({ chatId: data.chatId, role: data.role, text: data.text, senderType: 'user', ...event })); return true;
    }
    reply(404, { error: '未找到' });
  } catch (error) { reply(400, { error: error.message }); }
  return true;
}

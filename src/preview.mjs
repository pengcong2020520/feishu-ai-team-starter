import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { walkthroughPage } from './walkthrough-page.mjs';
import { roles } from './agents/roles.mjs';
import { packageHttp } from './packages/http.mjs';

const headers = model => ({ 'Content-Security-Policy': model ? "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; form-action 'none'; connect-src 'none'" : "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self' http://127.0.0.1:*; img-src 'self' data: blob:", 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
const send = (res, status, body, model = false, type = 'text/html; charset=utf-8') => { res.writeHead(status, { ...headers(model), 'Content-Type': type }); res.end(body); };
const valid = id => /^[a-zA-Z0-9-]{1,80}$/.test(id);
export const adminRequestAllowed = (via, header, token) => via !== 'admin' || Boolean(token && header === token);

export async function startPreview({ root = process.cwd(), assetsRoot = root, host = '127.0.0.1', modelPort = 4871, workbenchPort = 4870, previewBase = `http://127.0.0.1:${modelPort}`, flow, feishu, recorder } = {}) {
  const model = http.createServer(async (req, res) => {
    const match = /^\/p\/([^/]+)\/(wireframe|site)$/.exec(new URL(req.url, 'http://localhost').pathname);
    if (req.method !== 'GET' || !match || !valid(match[1])) return send(res, 404, '未找到', true, 'text/plain; charset=utf-8');
    try { send(res, 200, await readFile(path.join(root, 'workspace', match[1], match[2] === 'site' ? 'site/index.html' : 'design/wireframe.html'), 'utf8'), true); }
    catch { send(res, 404, '文件尚未生成', true, 'text/plain; charset=utf-8'); }
  });
  const workbench = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const hostValue = req.headers.host ?? '';
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(hostValue)) return send(res, 403, 'Host 不允许', false, 'text/plain; charset=utf-8');
    if (await packageHttp({ req, res, url, root, flow, recorder, send })) return;
    const match = /^\/p\/([^/]+)\/(walkthrough|outline|shot\/(?:outline|design|site|walkthrough))$/.exec(url.pathname);
    if (req.method === 'GET' && match && valid(match[1])) {
      try {
        if (match[2] === 'outline') return send(res, 200, await readFile(path.join(root, 'workspace', match[1], 'shots/outline.html'), 'utf8'));
        if (match[2].startsWith('shot/')) { const kind = match[2].slice(5); return send(res, 200, await readFile(path.join(root, 'workspace', match[1], 'shots', `${kind === 'outline' ? kind : `${kind}-sheet`}.png`)), false, 'image/png'); }
        const report = JSON.parse(await readFile(path.join(root, 'workspace', match[1], 'design/walkthrough.json'), 'utf8'));
        return send(res, 200, walkthroughPage(match[1], report, previewBase));
      } catch { return send(res, 404, '页面尚未生成', false, 'text/plain; charset=utf-8'); }
    }
    if (req.method === 'GET' && url.pathname === '/api/state' && flow) return send(res, 200, JSON.stringify(await flow.getState()), false, 'application/json; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/config') return send(res, 200, JSON.stringify({ modelBase: previewBase, teamMode: flow?.projects ? 'projects' : 'basic' }), false, 'application/json; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/team' && flow?.projects) return send(res, 200, JSON.stringify(await flow.projects.getTeam()), false, 'application/json; charset=utf-8');
    if (req.method === 'GET' && url.pathname === '/api/context' && flow?.projects) {
      const p = await flow.getProjectById(url.searchParams.get('projectId'));
      if (!p) return send(res, 404, '项目不存在', false, 'text/plain; charset=utf-8');
      return send(res, 200, await flow.projects.context(p), false, 'text/plain; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/messages' && recorder) {
      const role = url.searchParams.get('role');
      if (role && !roles[role]) return send(res, 400, '角色无效', false, 'text/plain; charset=utf-8');
      const projectId = url.searchParams.get('projectId');
      let chatId = url.searchParams.get('chatId') ?? '';
      let after = null, before = null;
      if (projectId && flow?.getProjectById) {
        const project = await flow.getProjectById(projectId);
        if (!project) return send(res, 404, '项目不存在', false, 'text/plain; charset=utf-8');
        chatId = project.chatId;
        after = new Date(new Date(project.createdAt).getTime() - 5000).toISOString();
        const projects = (await flow.getState()).projects.filter(p => p.chatId === chatId && p.createdAt > project.createdAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        before = projects[0]?.createdAt ?? null;
      }
      const messages = await recorder.list(chatId, { role, limit: role && projectId ? Number.MAX_SAFE_INTEGER : 300 });
      return send(res, 200, JSON.stringify(messages.filter(row => (!after || row.at >= after) && (!before || row.at < before))), false, 'application/json; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/prd' && flow) {
      const project = url.searchParams.get('projectId') && flow.getProjectById ? await flow.getProjectById(url.searchParams.get('projectId')) : await flow.getProject(url.searchParams.get('chatId') ?? '');
      if (!project || !valid(project.id)) return send(res, 404, '项目不存在', false, 'text/plain; charset=utf-8');
      try { return send(res, 200, await readFile(path.join(root, 'workspace', project.id, 'docs/prd.md'), 'utf8'), false, 'text/plain; charset=utf-8'); }
      catch { return send(res, 404, 'PRD 尚未生成', false, 'text/plain; charset=utf-8'); }
    }
    if (req.method === 'GET' && url.pathname === '/api/role') {
      const role = url.searchParams.get('role');
      if (!roles[role]) return send(res, 404, '角色不存在', false, 'text/plain; charset=utf-8');
      const skills = await Promise.all(roles[role].skills.map(async skill => ({ name: skill.replace('team:', ''), text: await readFile(path.join(assetsRoot, 'team-skills/skills', skill.replace('team:', ''), 'SKILL.md'), 'utf8') })));
      return send(res, 200, JSON.stringify({ role: roles[role].name, prompt: await readFile(path.join(assetsRoot, 'prompts', `${role}.md`), 'utf8'), skills }), false, 'application/json; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/api/events' && flow) {
      res.writeHead(200, { ...headers(false), 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive' });
      let previous = '';
      const tick = async () => { try { const value = JSON.stringify(await flow.getState()); if (value !== previous) { previous = value; res.write('event: change\ndata: {}\n\n'); } else res.write(': keepalive\n\n'); } catch { res.end(); } };
      const unsubscribe = recorder?.subscribe(() => { res.write('event: change\ndata: {}\n\n'); });
      void tick();
      const timer = setInterval(tick, 2000);
      res.on('close', () => { clearInterval(timer); unsubscribe?.(); });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/chats' && feishu?.listChats) {
      try { return send(res, 200, JSON.stringify(await feishu.listChats('product')), false, 'application/json; charset=utf-8'); }
      catch (error) { return send(res, 502, JSON.stringify({ error: error.message }), false, 'application/json; charset=utf-8'); }
    }
    if (req.method === 'GET' && url.pathname === '/api/questions' && flow) {
      const chatId = url.searchParams.get('chatId');
      const p = chatId && await flow.getProject(chatId);
      if (!p || p.stage !== 'clarifying' || !valid(p.id)) return send(res, 404, '暂无问题', false, 'text/plain; charset=utf-8');
      try { return send(res, 200, await readFile(path.join(root, 'workspace', p.id, 'docs/questions.json'), 'utf8'), false, 'application/json; charset=utf-8'); }
      catch { return send(res, 404, '问题尚未生成', false, 'text/plain; charset=utf-8'); }
    }
    if (req.method === 'GET' && ['/app.css', '/app.js', '/presentation.mjs', '/teams.js', '/teams.css'].includes(url.pathname)) {
      try { return send(res, 200, await readFile(path.join(assetsRoot, 'web', url.pathname.slice(1)), 'utf8'), false, url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8'); }
      catch { return send(res, 404, '资源不存在', false, 'text/plain; charset=utf-8'); }
    }
    if (req.method === 'GET' && url.pathname === '/') {
      try { return send(res, 200, await readFile(path.join(assetsRoot, 'web/index.html'), 'utf8')); }
      catch { return send(res, 404, '工作台尚未生成', false, 'text/plain; charset=utf-8'); }
    }
    if (req.method === 'GET' && url.pathname === '/teams') {
      try { return send(res, 200, await readFile(path.join(assetsRoot, 'web/teams.html'), 'utf8')); }
      catch { return send(res, 404, '团队工作台尚未生成', false, 'text/plain; charset=utf-8'); }
    }
    if (req.method === 'POST' && ['/api/demand', '/api/message', '/api/action', '/api/team/person', '/api/team/settings', '/api/team/import', '/api/team/project', '/api/team/admin-identity'].includes(url.pathname) && flow) {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${hostValue}`) return send(res, 403, 'Origin 不允许', false, 'text/plain; charset=utf-8');
      if (req.headers['x-workbench'] !== '1' || !/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) return send(res, 415, '请求格式不正确', false, 'text/plain; charset=utf-8');
      let body = '';
      for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 16384) return send(res, 413, '请求过大', false, 'text/plain; charset=utf-8'); }
      try {
        const data = JSON.parse(body);
        if (!adminRequestAllowed(data.via, req.headers['x-admin-token'], process.env.ADMIN_WORKBENCH_TOKEN)) return send(res, 403, JSON.stringify({ error: '只有 AI 管理员助手能这样操作' }), false, 'application/json; charset=utf-8');
        if (url.pathname.startsWith('/api/team/')) {
          if (!flow.projects) throw Error('项目管理尚未启用');
          if (url.pathname === '/api/team/admin-identity') {
            if (data.via !== 'admin' || data.identity?.role !== 'admin' || data.identity?.openId !== process.env.FEISHU_ADMIN_OPEN_ID) throw Error('管理员身份不匹配');
            await flow.projects.observe(data.identity, data.name);
            return send(res, 200, JSON.stringify({ ok: true }), false, 'application/json; charset=utf-8');
          }
          if (data.via === 'admin') throw Error('人员分工请在本机工作台管理');
          const result = url.pathname === '/api/team/person' ? await flow.projects.directory.upsert(data)
            : url.pathname === '/api/team/settings' ? await flow.projects.directory.settings(data)
            : url.pathname === '/api/team/import' ? await flow.projects.importMembers(data.chatId)
            : await flow.updateTeam(data);
          return send(res, 200, JSON.stringify(result), false, 'application/json; charset=utf-8');
        }
        if (url.pathname !== '/api/demand' && (typeof data.chatId !== 'string' || !data.chatId)) throw new Error('缺少项目会话');
        let result;
        // AI 管理员助手（另一个进程）替管理员说话、点按钮也走这里，群里写明是它代你
        const byAdmin = data.via === 'admin';
        const source = byAdmin ? 'AI 管理员助手' : '工作台';
        const identity = flow.projects ? byAdmin ? { role: 'admin', openId: process.env.FEISHU_ADMIN_OPEN_ID } : await flow.projects.localIdentity() : undefined;
        const actorContext = flow.projects ? { identity, source: byAdmin ? 'admin' : 'local' } : {};
        const localPerson = !byAdmin && flow.projects ? (await flow.projects.directory.get()).people.find(p => p.id === identity?.localPersonId) : null;
        const actor = byAdmin ? 'AI 管理员助手（代你）' : localPerson ? `${localPerson.name}（工作台）` : '你（工作台）';
        const packageProject = data.chatId && await flow.packages?.get(data.chatId);
        if (packageProject && ['/api/message', '/api/action'].includes(url.pathname)) {
          if (url.pathname === '/api/action') {
            const result = await flow.packages.action({ chatId: data.chatId, value: { ...data.value, action: data.value?.action?.startsWith('package_') ? data.value.action : `package_${data.value?.action}` }, formValue: data.formValue, actor, ...actorContext });
            return send(res, 200, JSON.stringify({ ...result, toast: { type: 'info', content: '已收到操作' } }), false, 'application/json; charset=utf-8');
          }
          if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000 || !packageProject.roles.some(r => r.id === data.role)) throw Error('角色或消息无效');
          if (!data.chatId.startsWith('web:')) await feishu.sendText(data.chatId, `${byAdmin ? 'AI 管理员助手代你' : '来自工作台'}：${data.text}`, packageProject.botBindings[data.role]);
          await recorder?.add(data.chatId, { kind: 'user', role: data.role, text: data.text, actor, source, projectId: packageProject.id });
          const result = await flow.packages.message({ chatId: data.chatId, role: data.role, text: data.text, senderType: 'user', actor, ...actorContext });
          return send(res, 200, JSON.stringify(result), false, 'application/json; charset=utf-8');
        }
        if (url.pathname === '/api/demand' && flow.projects) {
          if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000) throw Error('消息为空或过长');
          const requestId = data.requestId || randomUUID();
          if (typeof requestId !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId)) throw Error('建项请求编号无效');
          const options = { name: data.name, scope: data.scope, channel: data.channel, ownerId: data.ownerId, memberIds: data.memberIds, approvers: data.approvers };
          const result = await flow.handleMessage({ chatId: `web:entry-${requestId}`, text: data.text, role: 'product', intent: 'demand', options, requestId, ...actorContext });
          return send(res, 200, JSON.stringify({ ...result, source: result.chatId.startsWith('web:') ? '本机项目' : '飞书项目群' }), false, 'application/json; charset=utf-8');
        }
        if (url.pathname === '/api/action') {
          await recorder?.add(data.chatId, { kind: 'action', role: data.role ?? 'product', action: data.value?.action, value: data.value, actor, source });
          result = await flow.handleAction({ chatId: data.chatId, value: data.value, formValue: data.formValue, actor, ...actorContext });
        }
        else {
          if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000) throw new Error('消息为空或过长');
          const role = url.pathname === '/api/demand' ? 'product' : data.role;
          if (!['product', 'designer', 'developer'].includes(role)) throw new Error('角色无效');
          let targetChat = data.chatId;
          if (url.pathname === '/api/demand') {
            const snapshot = await flow.getState();
            const recent = snapshot.projects.filter(p => p.chatId && !p.chatId.startsWith('web:')).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.chatId;
            targetChat = recent ?? (typeof data.chatId === 'string' && !data.chatId.startsWith('web:') ? data.chatId : (await feishu?.listChats?.('product'))?.[0]?.chat_id);
            if (!targetChat || (snapshot.groups[targetChat] && snapshot.groups[targetChat].stage !== 'done')) targetChat = `web:${randomUUID()}`;
          }
          if (!targetChat.startsWith('web:')) await feishu?.sendText(targetChat, byAdmin ? `AI 管理员助手代你：${data.text}` : url.pathname === '/api/demand' ? `来自工作台的需求：${data.text}` : `来自工作台：${data.text}`, role);
          await recorder?.add(targetChat, { kind: 'user', role, text: data.text, actor, source });
          result = await flow.handleMessage({ chatId: targetChat, role, text: data.text, senderType: 'user', user: actor, actor, ...actorContext, ...(url.pathname === '/api/demand' ? { intent: 'demand' } : {}) });
          result = { ...result, chatId: targetChat, source: targetChat.startsWith('web:') ? '工作台项目' : '飞书群项目' };
        }
        return send(res, 200, JSON.stringify(result), false, 'application/json; charset=utf-8');
      } catch (error) { return send(res, 400, JSON.stringify({ error: error.message }), false, 'application/json; charset=utf-8'); }
    }
    send(res, 404, '未找到', false, 'text/plain; charset=utf-8');
  });
  await Promise.all([[model, modelPort], [workbench, workbenchPort]].map(([server, port]) => new Promise((resolve, reject) => server.once('error', reject).listen(port, host, resolve))));
  return { modelPort: model.address().port, workbenchPort: workbench.address().port, close: () => Promise.all([model, workbench].map(server => new Promise(resolve => server.close(resolve)))) };
}

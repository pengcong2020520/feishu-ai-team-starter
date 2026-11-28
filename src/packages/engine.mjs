import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicJson, lockedPackage } from './store.mjs';
import { initializeWorkspace, roleDefinition, validateOutputs, readArtifact } from './runtime.mjs';
import { validatePlan, planOutputSchema } from './schema.mjs';
import { runAgent } from '../agents/run.mjs';
import { cardView } from '../workbench/recorder.mjs';
import { questionCard } from '../flow/cards.mjs';

const copy = value => structuredClone(value);
const plain = text => String(text || '').replace(/<[^>]*>/g, '').slice(0, 2400);
export function teamCard({ title, text, color = 'blue', buttons = [], links = [] }) {
  return { config: { wide_screen_mode: true, update_multi: true }, header: { template: color, title: { tag: 'plain_text', content: plain(title) } }, elements: [
    { tag: 'div', text: { tag: 'plain_text', content: plain(text) || '请查看项目工作台。' } },
    ...(buttons.length || links.length ? [{ tag: 'action', actions: [...buttons.map(b => ({ tag: 'button', text: { tag: 'plain_text', content: b.label }, type: b.primary ? 'primary' : 'default', value: b.value })), ...links.map(l => ({ tag: 'button', text: { tag: 'plain_text', content: l.label }, type: 'default', url: l.url }))] }] : []),
  ] };
}

export function createPackageEngine({ root = process.cwd(), agent = runAgent, recorder, feishu, projects, bindings = () => ({}), workbenchBase = 'http://127.0.0.1:4870' } = {}) {
  const file = path.join(root, 'data/package-projects.json');
  let state = { projects: [], requests: {} }, writes = Promise.resolve();
  const jobs = new Map(), controls = new Map(), conversations = new Map(), mutations = new Map(), creating = new Map();
  const ready = (async () => {
    try { state = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    for (const p of state.projects) if (p.busy) { p.busy = false; p.error = '团队服务重启过，这一步未完成，请重试'; p.running = []; p.cardId = randomUUID(); p.cardSent = false; }
    await atomicJson(file, state);
  })();
  const save = () => { const snapshot = copy(state); const task = writes.then(() => atomicJson(file, snapshot)); writes = task.catch(() => {}); return task; };
  const find = id => state.projects.find(p => p.id === id || p.chatId === id);
  const dir = p => path.join(root, 'workspace', p.id);
  const packFor = p => lockedPackage(root, p.package);
  const nodeFor = (pack, p) => pack.workflow.nodes.find(n => n.id === p.stage);
  const botFor = (p, role) => p.botBindings?.[role];
  async function record(p, row) { await recorder?.add(p.chatId, { projectId: p.id, ...row }); await sync(p); }
  async function sync(p) {
    if (projects) await projects.syncContext(p);
    else {
      await writeFile(path.join(dir(p), 'context/discussion.md'), '# 项目讨论\n\n' + (await recorder?.list(p.chatId, { limit: Number.MAX_SAFE_INTEGER }) || []).map(r => `${r.actor || r.role || '系统'}：${r.text || r.card?.title || r.action || ''}`).join('\n'));
      await atomicJson(path.join(dir(p), 'context/project.json'), { id: p.id, name: p.name, demand: p.demand, stage: p.stage, package: p.package });
    }
  }
  async function send(p, card, role, update = false) {
    let messageId = p.messageId;
    if (!p.chatId.startsWith('web:')) {
      const bot = botFor(p, role); if (!bot) throw Error(`角色「${role}」尚未绑定飞书机器人`);
      if (update && messageId) await feishu.patchCard(messageId, card, bot, p.chatId);
      else messageId = await feishu.sendCard(p.chatId, card, bot);
    } else {
      messageId = update && messageId || randomUUID();
      await record(p, { kind: update ? 'card_update' : 'card', role, roleName: p.roles.find(r => r.id === role)?.name, messageId, card: cardView(card) });
    }
    return messageId;
  }
  const value = (p, action) => ({ action: `package_${action}`, projectId: p.id, stage: p.stage, cardId: p.cardId });
  async function issue(p, pack) {
    const n = nodeFor(pack, p), role = n.role || pack.workflow.coordinator;
    const r = pack.manifest.roles.find(r => r.id === role);
    p.cardId ||= randomUUID(); p.cardSent = false; await save();
    let card;
    const notice = !p.error && n.type === 'gate' && projects ? await projects.notice({ ...p, stage: n.approval }, n.approval, botFor(p, role)) : '';
    if (!p.error && n.type === 'gate' && n.questions) {
      const questions = JSON.parse(await readFile(path.join(dir(p), 'docs/questions.json'), 'utf8'));
      card = questionCard({ projectId: p.id, cardId: p.cardId, questions });
      card.header.title.content = `${r.name} · 有几个问题`; card.header.template = r.color;
      card.body.elements[0].elements.find(e => e.tag === 'button').behaviors[0].value = value(p, 'answer');
    } else {
      const buttons = p.error ? [{ label: '重试', value: value(p, 'retry'), primary: true }, { label: '结束项目', value: value(p, 'end') }]
        : n.type === 'gate' ? [{ label: '确认', value: value(p, 'confirm'), primary: true }, ...(n.reject ? [{ label: '打回修改', value: value(p, 'reject') }] : [])] : p.busy ? [{ label: '停下', value: value(p, 'stop') }] : [];
      card = teamCard({ title: `${r.name} · ${p.error ? '这一步停下了' : n.name}`, text: [p.error || p.lastReply || p.demand, p.invitationWarning ? `部分成员尚未入群：${p.invitationWarning}` : '', notice, p.waitingFeedback ? '请在群中 @ 对应同事说明要修改什么，或在工作台填写意见。' : ''].filter(Boolean).join('\n'), color: r.color, buttons, links: [{ label: '打开项目工作台', url: `${workbenchBase}/teams#${p.id}` }] });
    }
    p.messageId = await send(p, card, role); p.cardRole = role; p.cardSent = true; await save();
    // 卡片纯文本展示姓名，原生文本消息保留飞书 @ 语法，避免把身份标签当文字显示。
    if (notice && !p.chatId.startsWith('web:')) await feishu.sendText(p.chatId, notice, botFor(p, role));
  }
  async function runTask(p, pack, task, key, outputSchema) {
    const control = {}, live = controls.get(p.id) || new Map(); controls.set(p.id, live); live.set(key, control);
    const definition = await roleDefinition(pack, task.role, root), used = new Set();
    p.running = [...new Set([...(p.running || []), task.role])]; await save();
    const round = p.visits[p.stage] || 1;
    const replace = text => text.replaceAll('{{demand}}', p.demand).replaceAll('{{feedback}}', p.feedback || '').replaceAll('{{round}}', String(round));
    const outputs = (task.outputs || []).map(id => pack.manifest.artifacts.find(a => a.id === id).path);
    await record(p, { kind: 'text', role: task.role, text: `${definition.name}开始：${task.name}` });
    try {
      if (p.stopRequested) throw Error('已按要求停下');
      const result = await agent({ role: task.role, projectDir: dir(p), runtimeRoot: root, definition, isolateSession: true,
        resume: task.freshSession || outputSchema ? undefined : p.sessions[task.role], mode: 'work', outputSchema,
        prompt: `项目目标：${p.demand}\n用户最近的确认或修改意见：${p.feedback || '无'}\n先读取 context/discussion.md、context/project.json 及上游交付文件。\n${replace(task.prompt)}\n本步必须使用的技能：${task.skills.map(s => `team:${s}`).join('、') || '按角色职责选择'}。\n本步必须交付：${outputs.join('、') || '按任务要求'}。${p.error ? `\n上次未通过：${p.error}` : ''}`,
        timeoutMs: (task.timeoutMinutes || 10) * 60000, control,
        onQueued: () => { p.activity = '等待团队执行名额'; },
        onProgress: event => { if (event.tool === 'Skill') used.add(event.file); p.activity = `${definition.name}：${event.tool === 'Skill' ? '使用技能' : ['Write', 'Edit'].includes(event.tool) ? '更新交付文件' : event.tool.startsWith('mcp__research') ? '读取公开资料' : '查看项目资料'}`; },
      });
      if (!result.ok) throw Error(result.error || 'Agent 未完成任务');
      for (const skill of task.skills) if (!used.has(`team:${skill}`) && !used.has(skill)) throw Error(`未调用本步必需技能：${skill}`);
      if (result.sessionId && !task.freshSession && !outputSchema) p.sessions[task.role] = result.sessionId;
      if (!outputSchema) await validateOutputs(pack, task, dir(p), round);
      p.lastReply = result.text;
      p.history.push({ node: p.stage, task: key, role: task.role, at: new Date().toISOString(), stats: result.stats, result: result.text });
      await record(p, { kind: 'text', role: task.role, text: `${definition.name}完成：${result.text}` }); await save();
      return result;
    } finally { live.delete(key); p.running = (p.running || []).filter(r => r !== task.role); }
  }
  async function executePlan(p, pack, node) {
    if (!p.plan || p.plan.node !== node.id) {
      const result = await runTask(p, pack, { ...node, outputs: [], prompt: `${node.prompt}\n可选任务：${JSON.stringify(node.tasks)}\n必须包含 ${node.required.join('、')}；${node.final} 须依赖其他全部选中任务。返回 rationale 及 tasks[{id,after}]。` }, 'plan', planOutputSchema);
      const plan = validatePlan(node, result.structured, pack.manifest);
      p.plan = { node: node.id, ...plan, completed: [] }; await atomicJson(path.join(dir(p), 'context/plan.json'), p.plan); await save();
    }
    validatePlan(node, { rationale: p.plan.rationale, tasks: p.plan.tasks }, pack.manifest);
    while (p.plan.completed.length < p.plan.tasks.length) {
      if (p.stopRequested) throw Error('已按要求停下');
      const wave = p.plan.tasks.filter(t => !p.plan.completed.includes(t.id) && t.after.every(id => p.plan.completed.includes(id)));
      if (!wave.length) throw Error('计划无法继续，依赖没有完成');
      const results = await Promise.allSettled(wave.map(async t => {
        const task = node.tasks.find(x => x.id === t.id);
        await runTask(p, pack, { ...task, prompt: task.prompt + (t.brief ? `\n本次交接说明：${t.brief}` : '') }, t.id);
        p.plan.completed.push(t.id); await save();
      }));
      const failed = results.find(r => r.status === 'rejected'); if (failed) throw failed.reason;
    }
  }
  async function drive(p) {
    const pack = await packFor(p); p.busy = true;
    try {
      while (true) {
        const node = nodeFor(pack, p); if (!node) throw Error('工作流节点不存在');
        if (node.type === 'gate' || node.type === 'done') {
          p.busy = false; p.error = null; p.activity = null; p.running = [];
          await save(); await sync(p); await issue(p, pack); return;
        }
        if (p.stepsTaken >= pack.workflow.maxSteps) throw Error('达到本包工作流步数上限，请结束项目并检查协作规则');
        if (!p.entered) { p.visits[p.stage] = (p.visits[p.stage] || 0) + 1; p.stepsTaken++; p.entered = true; }
        await save(); await issue(p, pack);
        if (node.type === 'plan') await executePlan(p, pack, node);
        else await runTask(p, pack, node, node.id);
        if (p.stopRequested) throw Error('已按要求停下');
        const outcome = node.type === 'task' ? await validateOutputs(pack, node, dir(p), p.visits[p.stage]) : 'next';
        let next = node[outcome];
        if (node.route) {
          const a = await readArtifact(pack, dir(p), node.route.artifact), branch = JSON.parse(a.text)?.[node.route.field];
          if (typeof branch !== 'string' || !Object.hasOwn(node.route.cases, branch)) throw Error('交付文件的分支结果不在工作流声明中');
          next = node.route.cases[branch];
        }
        p.stage = next; p.plan = null; p.entered = false; p.error = null; p.cardId = randomUUID(); p.cardSent = false;
        await save(); await sync(p);
      }
    } catch (error) {
      p.busy = false; p.running = []; p.activity = null; p.error = error.message; p.cardId = randomUUID(); p.cardSent = false; await save(); await sync(p);
      try { await issue(p, pack); } catch (e) { p.deliveryError = e.message; await save(); }
    } finally { controls.delete(p.id); }
  }
  const launch = p => {
    if (jobs.has(p.id)) return;
    p.stopRequested = false;
    const task = drive(p).catch(async e => { p.busy = false; p.error = e.message; await save(); }).finally(() => { if (jobs.get(p.id) === task) jobs.delete(p.id); }); jobs.set(p.id, task);
  };
  const exclusive = (id, fn) => { const task = (mutations.get(id) || Promise.resolve()).catch(() => {}).then(fn); mutations.set(id, task); void task.finally(() => { if (mutations.get(id) === task) mutations.delete(id); }).catch(() => {}); return task; };
  async function allowed(p, event, action, approval) {
    const authorization = await projects?.authorize({ project: { ...p, stage: approval || p.stage }, identity: event.identity, action, source: event.source });
    if (authorization && !authorization.ok) throw Error(authorization.reason);
  }
  const api = {
    async create({ package: lock, text, options = {}, identity, source = 'local', requestId = randomUUID(), sourceChatId, intake = [] } = {}) {
      await ready;
      if (typeof text !== 'string' || !text.trim() || text.length > 4000 || !/^[a-zA-Z0-9-]{1,80}$/.test(requestId)) throw Error('需求或请求号无效');
      const fingerprint = JSON.stringify({ lock, text, options, identity, sourceChatId });
      const doCreate = async () => {
        const previous = state.requests[requestId];
        if (previous) { if (previous.fingerprint !== fingerprint) throw Error('请求号已用于其他项目'); return copy(find(previous.projectId)); }
        const pack = await lockedPackage(root, lock), id = randomUUID();
        const currentBindings = await bindings(pack.manifest.id), botBindings = currentBindings.roles || {};
        const channel = options.channel || 'local';
        if (channel === 'feishu' && (!projects || pack.manifest.roles.some(r => !botBindings[r.id]))) throw Error('请先启用领航版并绑定本团队的所有飞书角色');
        const teamBotRoles = [...new Set(pack.manifest.roles.map(r => botBindings[r.id]).filter(Boolean))];
        const approvalStages = [...new Set(pack.workflow.nodes.filter(n => n.type === 'gate').map(n => n.approval))];
        const prepared = projects ? await projects.prepare({ projectId: id, text, identity, sourceChatId, options: { ...options, channel, botRoles: teamBotRoles, approvalStages }, requestId: `package-${requestId}` }) : { id, chatId: `web:${id}`, name: options.name || text.slice(0, 40), dedicated: false, createdAt: new Date().toISOString() };
        const p = { ...prepared, approvalStages, demand: text, package: { id: pack.manifest.id, version: pack.manifest.version, hash: pack.hash }, packageName: pack.manifest.name, botBindings: copy(botBindings), roles: pack.manifest.roles.map(({ id, name, color }) => ({ id, name, color })), stage: pack.workflow.entry, visits: {}, stepsTaken: 0, entered: false, sessions: {}, history: [], busy: true, error: null, cardId: randomUUID(), running: [], feedback: '' };
        await initializeWorkspace(pack, dir(p)); await atomicJson(path.join(dir(p), 'context/package-lock.json'), { ...p.package, bindings: p.botBindings });
        state.projects.push(p); state.requests[requestId] = { fingerprint, projectId: p.id }; await save(); await sync(p);
        for (const row of intake) {
          const text = row.text || (row.kind === 'card' ? `${row.card?.title || ''}\n${row.card?.text?.join('\n') || ''}` : '');
          if (text) await record(p, { kind: row.kind === 'user' ? 'user' : 'text', role: row.role, actor: row.actor, text, source: '建项前讨论', originalAt: row.at });
        }
        await record(p, { kind: 'user', text, actor: '项目发起人', source }); launch(p); return copy(p);
      };
      const pending = creating.get(requestId);
      if (pending) { if (pending.fingerprint !== fingerprint) throw Error('请求号正在用于其他项目'); return pending.task; }
      const task = doCreate().finally(() => creating.delete(requestId)); creating.set(requestId, { fingerprint, task }); return task;
    },
    async action(event) {
      await ready;
      return exclusive(event.chatId, async () => {
        const p = find(event.chatId), v = event.value;
        if (!p || v?.projectId !== p.id || v.stage !== p.stage || v.cardId !== p.cardId) throw Error('这张卡片已过期，请使用本项目最新卡片');
        const pack = await packFor(p), n = nodeFor(pack, p), action = String(v.action || '').replace(/^package_/, '');
        await allowed(p, event, action, n.approval);
        if (action === 'stop' || action === 'end') {
          if (action === 'end' && p.busy) throw Error('请先停下正在执行的任务，再结束项目');
          if (action === 'stop') { if (!p.busy) throw Error('当前没有正在执行的任务'); p.stopRequested = true; for (const c of controls.get(p.id)?.values() || []) await c.stop?.(); }
          else { p.stage = pack.workflow.nodes.find(n => n.type === 'done').id; p.ended = true; p.error = null; p.cardId = randomUUID(); await save(); await issue(p, pack); }
          return { ok: true };
        }
        if (p.busy || jobs.has(p.id)) throw Error('这一步正在执行');
        if (action === 'retry') {
          if (!p.error && p.cardSent) throw Error('当前无需重试');
          if (n.type === 'gate' || n.type === 'done') { p.error = null; p.cardId = randomUUID(); await issue(p, pack); }
          else { p.busy = true; p.cardId = randomUUID(); await save(); launch(p); }
          return { ok: true };
        }
        if (p.error || n.type !== 'gate' || !['confirm', 'reject', 'answer'].includes(action)) throw Error('当前节点不能执行这个动作');
        if (action === 'answer' && !n.questions || action === 'confirm' && n.questions || action === 'reject' && !n.reject) throw Error('当前关口不支持这个动作');
        if (action === 'reject' && !event.feedback?.trim()) {
          p.waitingFeedback = true; p.cardId = randomUUID(); await save(); await issue(p, pack); return { ok: true, waitingFeedback: true };
        }
        let feedback = event.feedback || '';
        if (action === 'answer') {
          const q = JSON.parse(await readFile(path.join(dir(p), 'docs/questions.json'), 'utf8'));
          feedback = q.questions.map(item => { const index = Number(event.formValue?.[item.id]); if (!Number.isInteger(index) || !item.options[index]) throw Error('请回答每个澄清问题'); return `${item.question}：${item.options[index]}`; }).join('\n') + '\n' + String(event.formValue?.extra || '');
        }
        p.feedback = feedback; p.waitingFeedback = false;
        await record(p, { kind: 'action_result', action, accepted: true, actor: event.actor || '确认人', text: feedback });
        const oldCard = p.messageId;
        p.stage = action === 'reject' ? n.reject : n.next; p.cardId = randomUUID(); p.cardSent = false; p.plan = null; p.entered = false; p.busy = true;
        await save();
        if (oldCard) { try { await send(p, teamCard({ title: `${pack.manifest.roles.find(r => r.id === n.role).name} · 已处理`, text: `${event.actor || '确认人'}已${action === 'reject' ? '提交修改意见' : '确认'}。` }), n.role, true); } catch {} }
        launch(p); return { ok: true };
      });
    },
    async message(event) {
      await ready;
      const p = find(event.chatId); if (!p || event.senderType && event.senderType !== 'user') return { ignored: true };
      const role = p.roles.find(r => r.id === event.role)?.id || Object.keys(p.botBindings).find(r => p.botBindings[r] === event.role);
      if (!role) return { ignored: true };
      const pack = await packFor(p), n = nodeFor(pack, p);
      if (event.text.trim() === '重试') return api.action({ ...event, value: value(p, 'retry') });
      if (['停下', '停止'].includes(event.text.trim())) return api.action({ ...event, value: value(p, 'stop') });
      if (p.waitingFeedback && role === n.role) return api.action({ ...event, feedback: event.text, value: value(p, 'reject') });
      await allowed(p, event, 'discuss');
      // 同群问答依序；只读会话与正式派活隔离。
      const task = (conversations.get(p.id) || Promise.resolve()).catch(() => {}).then(async () => {
        const result = await agent({ role, projectDir: dir(p), runtimeRoot: root, definition: await roleDefinition(pack, role, root), isolateSession: true, mode: 'chat', timeoutMs: 60000, prompt: `群聊对话。只读 context/discussion.md 和本角色授权目录。当前节点 ${n.name}，${p.busy ? '正在执行' : p.error ? '停下待重试' : '等待操作'}。用户说：${event.text}\n从本专业回答，不启动任务，proposal.action 必须为 none。` });
        const text = result.ok ? result.structured?.reply || result.text : '暂时没能回答，请稍后再试。';
        if (!p.chatId.startsWith('web:')) await feishu.sendText(p.chatId, text, botFor(p, role)); else await record(p, { kind: 'text', role, text });
      }); conversations.set(p.id, task); void task.finally(() => { if (conversations.get(p.id) === task) conversations.delete(p.id); }).catch(() => {});
      return { ok: true };
    },
    async get(id) { await ready; return copy(find(id) || null); },
    async updateTeam(input) {
      await ready; const p = find(input.projectId); if (!p || !projects || !p.dedicated) throw Error('该项目没有人员分工');
      return exclusive(p.chatId, async () => {
        if (p.busy || jobs.has(p.id)) throw Error('请等当前步骤结束再调整分工');
        p.team = await projects.updateTeam(p, { ownerId: input.ownerId, memberIds: input.memberIds, approvers: input.approvers });
        p.cardId = randomUUID(); p.cardSent = false; await save(); await sync(p); await issue(p, await packFor(p)); return { team: p.team };
      });
    },
    async list() { await ready; return copy(state.projects); },
    async snapshot() {
      await ready;
      return Promise.all(state.projects.map(async p => {
        const pack = await packFor(p), n = nodeFor(pack, p), artifacts = [];
        for (const a of pack.manifest.artifacts) { try { await readArtifact(pack, dir(p), a.id); artifacts.push({ id: a.id, name: a.name, format: a.format }); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
        const taskNames = Object.fromEntries((pack.workflow.nodes.find(node => node.id === p.plan?.node)?.tasks || []).map(t => [t.id, t.name]));
        return { ...copy(p), taskNames, stageName: n.name, stageType: n.type, stuckCardId: p.error ? p.cardId : null, source: p.chatId.startsWith('web:') ? '本机项目' : '飞书项目群', waitingFor: p.error ? '重试' : n.type === 'gate' ? n.name : null, activeRole: p.running?.[0] || null, retryRole: n.role, approval: n.approval, artifacts, currentActions: p.error ? ['retry', 'end'] : p.busy ? ['stop'] : n.type === 'gate' ? n.questions ? ['answer'] : ['confirm', ...(n.reject ? ['reject'] : [])] : [], questions: n.questions === true ? JSON.parse(await readFile(path.join(dir(p), 'docs/questions.json'), 'utf8')) : null };
      }));
    },
    async artifact(projectId, artifactId) { await ready; const p = find(projectId); if (!p) throw Error('项目不存在'); return readArtifact(await packFor(p), dir(p), artifactId); },
    async syncContext(chatId) { await ready; const p = find(chatId); if (p) await sync(p); },
    async waitForIdle(id) { await ready; const p = find(id); if (!p) return null; while (jobs.has(p.id) || conversations.has(p.id)) await (jobs.get(p.id) || conversations.get(p.id)); return copy(p); },
  };
  return api;
}

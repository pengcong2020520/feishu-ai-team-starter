import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { roles } from '../agents/roles.mjs';
import { runAgent } from '../agents/run.mjs';
import { validateQuestions, validatePrd, validateDesign, validateSite, validateWalkthrough } from './validate.mjs';
import { nextStage, roleFor, stageNames, taskFor } from './stages.mjs';
import { gateCard, questionCard, answeredCard, progressCard, resultCard, completeCard, toast } from './cards.mjs';
import { createSheet } from '../sheet.mjs';
import { createOutline } from '../outline.mjs';
import { cardView } from '../workbench/recorder.mjs';

const exists = async file => { try { await readFile(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
const gateRole = stage => ({ confirm_prd: 'product', confirm_design: 'designer', accept: 'developer' })[stage];
const errorText = error => {
  const detail = error?.response?.data;
  return detail?.code != null ? `${error.message ?? '飞书调用失败'}（code ${detail.code}，msg ${detail.msg ?? ''}）` : error?.message ?? String(error);
};

export function createFlow({ root = process.cwd(), agent = runAgent, feishu, recorder, id = randomUUID, previewBase = 'http://127.0.0.1:4871', workbenchBase = 'http://127.0.0.1:4870' } = {}) {
  if (!feishu?.sendText || !feishu?.sendCard || !feishu?.patchCard) throw new Error('缺少消息适配器');
  const stateFile = path.join(root, 'data/state.json');
  const jobs = new Map();
  let state = { groups: {}, archived: [] };
  let saves = Promise.resolve();
  const ready = (async () => {
    try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    state.groups ??= {};
    state.archived ??= [];
    for (const project of Object.values(state.groups)) project.busy = false;
  })();
  const save = () => {
    saves = saves.then(async () => {
      await mkdir(path.dirname(stateFile), { recursive: true });
      const temp = `${stateFile}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(state, null, 2));
      await rename(temp, stateFile);
    });
    return saves;
  };
  const projectDir = p => path.join(root, 'workspace', p.id);
  const webCards = new Map();
  const delivery = {
    sendText: (chatId, message, role) => chatId.startsWith('web:') ? recorder?.add(chatId, { kind: 'text', role: role ?? 'product', text: message, source: '工作台' }) : feishu.sendText(chatId, message, role),
    sendCard: async (chatId, card, role) => {
      if (!chatId.startsWith('web:')) return feishu.sendCard(chatId, card, role);
      const messageId = id(); webCards.set(messageId, chatId);
      await recorder?.add(chatId, { kind: 'card', messageId, role, card: cardView(card), source: '工作台' });
      return messageId;
    },
    patchCard: (messageId, card, role, chatId) => chatId?.startsWith('web:') ? recorder?.add(chatId, { kind: 'card_update', messageId, role, card: cardView(card), source: '工作台' }) : feishu.patchCard(messageId, card, role, chatId),
    sendFile: (chatId, file, role) => chatId.startsWith('web:') ? Promise.resolve() : feishu.sendFile?.(chatId, file, role),
  };
  const sendText = (chatId, message) => delivery.sendText(chatId, message);
  const transition = async (p, to) => { p.stage = nextStage(p.stage, to); p.stageAt = new Date().toISOString(); p.currentFile = null; await save(); };
  const safeError = async (p, error) => {
    p.error = errorText(error);
    await save();
    try { await sendText(p.chatId, `“${stageNames[p.stage]}”出错：${p.error}。请 @${roles[p.pendingAction?.role ?? gateRole(p.stage) ?? roleFor(p.stage)]?.name ?? '对应角色'} 发送“重试”。`); }
    catch (sendError) { p.error += `；报错消息发送失败：${errorText(sendError)}`; await save(); }
  };
  const launch = (p, fn) => {
    p.busy = true;
    p.error = null;
    const job = (async () => {
      try { await save(); await fn(); }
      catch (e) { await safeError(p, e); }
      finally { p.busy = false; p.currentFile = null; await save(); jobs.delete(p.chatId); }
    })();
    jobs.set(p.chatId, job);
    return job;
  };
  const linksFor = (p, stage) => stage === 'confirm_prd' ? [{ label: '打开结构图', url: `${workbenchBase}/p/${p.id}/outline` }]
    : stage === 'confirm_design' ? [{ label: '打开线框', url: `${previewBase}/p/${p.id}/wireframe` }]
    : stage === 'accept' ? [{ label: '打开网页', url: `${previewBase}/p/${p.id}/site` }, { label: '打开走查页', url: `${workbenchBase}/p/${p.id}/walkthrough` }] : [];
  const previewImage = async (p, kind, role) => {
    try {
      if (kind === 'outline' && (!feishu.uploadImage || p.chatId.startsWith('web:'))) {
        await createOutline({ projectDir: projectDir(p), screenshot: false });
        return p.chatId.startsWith('web:') ? {} : { imageError: '图片上传不可用' };
      }
      if (p.chatId.startsWith('web:')) return {};
      if (!feishu.uploadImage && !p.chatId.startsWith('web:')) throw new Error('图片上传不可用');
      const sheet = kind === 'outline' ? await createOutline({ projectDir: projectDir(p) }) : await createSheet({ kind, projectDir: projectDir(p) });
      if (p.chatId.startsWith('web:')) return {};
      if (!feishu.uploadImage) throw new Error('图片上传不可用');
      return { imageKey: await feishu.uploadImage(sheet.pngFile, role) };
    } catch (error) { return { imageError: error.message }; }
  };
  const pointsFor = async (p, stage) => {
    const dir = projectDir(p);
    if (stage === 'confirm_prd') {
      const outline = JSON.parse(await readFile(path.join(dir, 'docs/outline.json'), 'utf8'));
      return [`页面：${outline.title}`, `状态：${outline.states.map(x => x.name).join('、')}`];
    }
    if (stage === 'confirm_design') {
      const theme = JSON.parse(await readFile(path.join(dir, 'design/theme.json'), 'utf8'));
      return [`主题：${theme.name}`, `主色：${theme.tokens.colors.primary}`];
    }
    if (stage === 'accept') {
      const report = JSON.parse(await readFile(path.join(dir, 'design/walkthrough.json'), 'utf8'));
      return [`走查结论：${report.conclusion}`, `覆盖屏数：${report.groups.flatMap(x => x.screens).length}`];
    }
    return [];
  };
  const finish = async p => {
    await delivery.sendCard(p.chatId, completeCard({ url: `${previewBase}/p/${p.id}/site` }), 'product');
    await delivery.sendFile(p.chatId, path.join(projectDir(p), 'site/index.html'), 'product');
  };
  const issueCard = async (p, card, stage, process) => {
    p.cardId = id();
    const cardRole = stage === 'confirm_design' || stage === 'accept' ? 'designer' : 'product';
    const picture = stage === 'confirm_prd' ? await previewImage(p, 'outline', cardRole)
      : stage === 'confirm_design' ? await previewImage(p, 'design', cardRole)
      : stage === 'accept' ? await previewImage(p, 'walkthrough', cardRole) : {};
    const payload = stage === 'clarifying' ? questionCard({ projectId: p.id, cardId: p.cardId, questions: card })
      : gateCard({ stage, projectId: p.id, cardId: p.cardId, title: `${roles[cardRole].name} · ${stage === 'accept' ? '走查完成，请验收' : stageNames[stage]}`, description: card, points: await pointsFor(p, stage), process, links: linksFor(p, stage), ...picture });
    p.pendingCard = payload;
    await save();
    p.cardRole = cardRole;
    p.cardMessageId = await delivery.sendCard(p.chatId, payload, p.cardRole);
    p.pendingCard = null;
    await save();
  };
  const run = async (p, stage, detail = '') => {
    const dir = projectDir(p);
    const role = roleFor(stage);
    const round = stage === 'clarifying' ? p.questionRound + 1 : stage === 'walkthrough' ? p.walkthroughRound + 1 : 1;
    if (stage === 'clarifying') await unlink(path.join(dir, 'docs/questions.json')).catch(e => { if (e.code !== 'ENOENT') throw e; });
    const title = `${roles[role].name} · ${stageNames[stage]}`;
    let progressId;
    let lastPatch = 0;
    let lastActivity = Date.now();
    const started = Date.now();
    const lines = [];
    const reads = new Set();
    const writes = new Set();
    let completed = false;
    try { progressId = await delivery.sendCard(p.chatId, progressCard({ title, task: taskFor(stage, detail, round).split('\n')[0] }), role); } catch (e) { throw e; }
    const patchProgress = async (force = false) => {
      if (!progressId || completed || (!force && Date.now() - lastPatch < 2000)) return;
      lastPatch = Date.now();
      try { await delivery.patchCard(progressId, progressCard({ title, task: stageNames[stage], lines, elapsedSeconds: Math.round((Date.now() - started) / 1000) }), role, p.chatId); } catch (e) { p.progressError = errorText(e); }
    };
    const thinking = setInterval(() => { if (Date.now() - lastActivity >= 15000 && lines.at(-1) !== '正在思考……') { lines.push('正在思考……'); void patchProgress(); } }, 2000);
    let result;
    try { result = await agent({ role, prompt: taskFor(stage, detail, round), projectDir: dir,
      resume: stage === 'walkthrough' ? undefined : p.sessions[role], onProgress: event => {
        lastActivity = Date.now();
        const file = String(event.file ?? '').replace(/^.*?workspace\/[^/]+\//, '');
        p.currentFile = file;
        p.currentTool = event.tool;
        p.activityAt = new Date().toISOString();
        void save();
        const label = event.tool === 'Read' ? `📖 读 ${file}` : event.tool === 'Write' ? `✍️ 写 ${file}`
          : event.tool === 'Edit' ? `✏️ 改 ${file}` : event.tool === 'Glob' ? `🔍 找文件 ${file}`
          : event.tool === 'Skill' ? `🧰 用技能 ${file.replace(/^team:/, '')}` : `使用 ${event.tool}`;
        if (event.tool === 'Read') reads.add(file);
        if (event.tool === 'Write' || event.tool === 'Edit') writes.add(file);
        lines.push(label);
        void patchProgress();
      } }); }
    finally { clearInterval(thinking); completed = true; }
    if (progressId) await delivery.patchCard(progressId, progressCard({ title, task: stageNames[stage], lines: [...lines, result?.ok ? '已完成' : `失败：${result?.error ?? '未知错误'}`], stats: result?.stats, done: true }), role, p.chatId);
    const process = { reads: reads.size, writes: writes.size, stats: result?.stats };
    if (!result?.ok) throw new Error(`${roles[role].name}执行失败：${result?.error ?? '没有返回结果'}`);
    if (stage !== 'walkthrough' && result.sessionId) p.sessions[role] = result.sessionId;
    if (stage === 'clarifying') {
      if (await exists(path.join(dir, 'docs/prd.md'))) {
        const check = await validatePrd(dir);
        if (!check.ok) throw new Error(check.errors.join('；'));
        await transition(p, 'confirm_prd');
        await issueCard(p, result.text || '请确认 PRD：docs/prd.md', 'confirm_prd', process);
      } else {
        if (round >= 3) throw new Error('第 3 轮必须写出 docs/prd.md');
        const check = await validateQuestions(dir);
        if (!check.ok) throw new Error(check.errors.join('；'));
        const questions = JSON.parse(await readFile(path.join(dir, 'docs/questions.json'), 'utf8'));
        if (questions.round !== round) throw new Error(`docs/questions.json.round 应为 ${round}`);
        p.questionRound = round;
        await issueCard(p, questions, 'clarifying');
      }
    } else {
      const check = await ({ revise_prd: validatePrd, designing: validateDesign, revise_design: validateDesign,
        building: validateSite, revise_build: validateSite, walkthrough: validateWalkthrough })[stage](dir);
      if (!check.ok) throw new Error(check.errors.join('；'));
      if (stage === 'revise_prd') { await transition(p, 'confirm_prd'); await issueCard(p, result.text || '请再次确认 PRD：docs/prd.md', 'confirm_prd', process); }
      if (stage === 'designing' || stage === 'revise_design') { await transition(p, 'confirm_design'); await issueCard(p, result.text || '请确认线框与主题', 'confirm_design', process); }
      if (stage === 'building' || stage === 'revise_build') {
        const picture = await previewImage(p, 'site', 'developer');
        await delivery.sendCard(p.chatId, resultCard({ role: 'developer', title: 'AI 程序员 · 网页已完成', description: result.text || '网页已生成', points: ['文件：site/index.html'], process, links: [{ label: '打开网页', url: `${previewBase}/p/${p.id}/site` }], ...picture }), 'developer');
        await transition(p, 'walkthrough'); await run(p, 'walkthrough', p.walkthroughDetail ?? '');
        p.walkthroughDetail = null;
      }
      if (stage === 'walkthrough') {
        const report = JSON.parse(await readFile(path.join(dir, 'design/walkthrough.json'), 'utf8'));
        if (report.round !== round) throw new Error(`design/walkthrough.json.round 应为 ${round}`);
        p.walkthroughRound = round;
        await transition(p, 'accept');
        await issueCard(p, `${report.conclusion}：${report.summary}`, 'accept', process);
      }
    }
    await save();
  };
  const get = async chatId => { await ready; return state.groups[chatId] ?? null; };
  const handleMessage = async ({ chatId, text, role = 'product', senderType = 'user' }) => {
    await ready;
    if (senderType !== 'user') return { ignored: true };
    const p = await get(chatId);
    if (p?.busy) { await sendText(chatId, '正在处理上一步，请稍等'); return { busy: true }; }
    if (!p || p.stage === 'done') {
      if (role !== 'product') return { ignored: true };
      if (p?.stage === 'done') state.archived.push(structuredClone(p));
      const project = { id: id(), chatId, name: text.slice(0, 24), demand: text, createdAt: new Date().toISOString(), stage: 'idle', busy: false, error: null, questionRound: 0, walkthroughRound: 0, sessions: {}, cardId: null, cardMessageId: null, lastDetail: text };
      state.groups[chatId] = project;
      const dir = projectDir(project);
      await Promise.all(['docs', 'design', 'site'].map(name => mkdir(path.join(dir, name), { recursive: true })));
      await transition(project, 'clarifying');
      launch(project, () => run(project, 'clarifying', text));
      return { projectId: project.id, stage: project.stage };
    }
    if (p.error && text.trim() === '重试' && role === (p.pendingAction?.role ?? gateRole(p.stage) ?? roleFor(p.stage))) {
      if (p.pendingCard) {
        launch(p, async () => { p.cardMessageId = await delivery.sendCard(p.chatId, p.pendingCard, p.cardRole); p.pendingCard = null; });
      } else if (p.pendingAction) {
        const { target, oldStage, actor } = p.pendingAction;
        launch(p, async () => {
          await delivery.patchCard(p.cardMessageId, answeredCard(stageNames[oldStage], actor, p.cardRole), p.cardRole, p.chatId);
          if (target === 'done') await finish(p);
          await transition(p, target);
          p.pendingAction = null;
          if (target !== 'done') await run(p, target);
        });
      } else launch(p, () => run(p, p.stage, p.lastDetail ?? text));
      return { retrying: true };
    }
    if (p.error) {
      await sendText(chatId, `当前步骤已停下，请 @${roles[p.pendingAction?.role ?? gateRole(p.stage) ?? roleFor(p.stage)]?.name ?? '对应角色'} 发送“重试”。`);
      return { waiting: true };
    }
    if (['revise_prd', 'revise_design', 'revise_build'].includes(p.stage) && role === roleFor(p.stage)) {
      p.lastDetail = text;
      if (p.stage === 'revise_build') p.walkthroughDetail = text;
      launch(p, () => run(p, p.stage, text));
      return { stage: p.stage };
    }
    await sendText(chatId, `当前在“${stageNames[p.stage]}”，请使用卡片继续。`);
    return { waiting: true };
  };
  const handleAction = async ({ chatId, value, formValue = {}, actor = '你' }) => {
    await ready;
    const p = await get(chatId);
    if (value?.projectId === 'test') return toast('这是测试卡片，不会推动流程，请点正式卡片');
    if (!p || p.id !== value?.projectId || p.stage !== value.stage || p.cardId !== value.cardId || p.busy || p.error) {
      await recorder?.add(chatId, { kind: 'action_result', action: value?.action, accepted: false, reason: '过期卡片', value });
      await sendText(chatId, `这张卡片已过期，现在在「${stageNames[p?.stage] ?? '待开始'}」，请点最新的那张`);
      return toast('这张卡片已过期');
    }
    const { action } = value;
    if (p.stage === 'clarifying' && action === 'answer') {
      const questions = JSON.parse(await readFile(path.join(projectDir(p), 'docs/questions.json'), 'utf8'));
      const answers = [];
      for (const q of questions.questions) {
        const selected = formValue[q.id] ?? String(q.recommended);
        if (!/^\d+$/.test(String(selected)) || !q.options[Number(selected)]) return toast('请检查问题的答案');
        answers.push(`${q.question}：${q.options[Number(selected)]}`);
      }
      if (typeof formValue.extra === 'string' && formValue.extra.trim()) answers.push(`其他补充：${formValue.extra.trim()}`);
      p.lastDetail = answers.join('\n');
      p.cardId = null;
      launch(p, () => run(p, 'clarifying', p.lastDetail));
      return toast('已收到回答');
    }
    if (!['confirm_prd', 'confirm_design', 'accept'].includes(p.stage) || !['confirm', 'reject'].includes(action)) return toast('这张卡片已过期');
    const oldStage = p.stage;
    p.cardId = null;
    if (action === 'confirm') {
      const target = { confirm_prd: 'designing', confirm_design: 'building', accept: 'done' }[oldStage];
      p.pendingAction = { target, oldStage, actor, role: { confirm_prd: 'product', confirm_design: 'designer', accept: 'developer' }[oldStage] };
      launch(p, async () => {
        await delivery.patchCard(p.cardMessageId, answeredCard(stageNames[oldStage], actor, p.cardRole), p.cardRole, p.chatId);
        if (target === 'done') await finish(p);
        await transition(p, target);
        p.pendingAction = null;
        if (target !== 'done') await run(p, target);
      });
    } else {
      const target = { confirm_prd: 'revise_prd', confirm_design: 'revise_design', accept: 'revise_build' }[oldStage];
      launch(p, async () => {
        await transition(p, target);
        await sendText(chatId, `请 @${roles[roleFor(target)].name} 说明要修改什么。`);
      });
    }
    await recorder?.add(chatId, { kind: 'action_result', action, accepted: true, value });
    return toast('已收到操作');
  };
  const getProjectById = async projectId => { const snapshot = await getState(); return snapshot.projects.find(p => p.id === projectId) ?? null; };
  const getState = async () => {
    await ready;
    const groups = structuredClone(state.groups);
    const archived = structuredClone(state.archived);
    const known = new Map([...archived, ...Object.values(groups)].map(p => [p.id, p]));
    const workspaceDir = path.join(root, 'workspace');
    const dirs = await readdir(workspaceDir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const projects = [];
    for (const entry of dirs) {
      if (!entry.isDirectory() || !/^[a-zA-Z0-9-]{1,80}$/.test(entry.name)) continue;
      const info = await stat(path.join(workspaceDir, entry.name));
      const p = known.get(entry.name) ?? { id: entry.name, chatId: null, stage: 'done', busy: false, error: null };
      p.createdAt ??= info.birthtime.toISOString();
      try { p.name = (await readFile(path.join(workspaceDir, entry.name, 'docs/prd.md'), 'utf8')).split(/\r?\n/, 1)[0].replace(/^#\s*/, '').trim() || p.name; }
      catch (error) { if (error.code !== 'ENOENT') throw error; p.name = (p.demand ?? p.name ?? '未命名项目').slice(0, 24); }
      projects.push(p);
    }
    for (const p of projects) {
      const dir = projectDir(p);
      p.artifacts = {};
      for (const [key, file] of Object.entries({ prd: 'docs/prd.md', wireframe: 'design/wireframe.html', theme: 'design/theme.json', site: 'site/index.html', walkthrough: 'design/walkthrough.json' })) p.artifacts[key] = await exists(path.join(dir, file));
      p.waitingFor = p.error ? '重试' : p.busy ? null : ({ clarifying: '回答问题', confirm_prd: '确认 PRD', confirm_design: '确认设计', accept: '验收', revise_prd: '说明 PRD 修改意见', revise_design: '说明设计修改意见', revise_build: '说明网页修改意见' })[p.stage] ?? null;
      p.activeRole = p.busy ? roleFor(p.stage) : null;
      const order = [['idle','clarifying','confirm_prd','revise_prd'], ['designing','confirm_design','revise_design'], ['building','revise_build'], ['walkthrough'], ['accept','done']];
      const current = order.findIndex(group => group.includes(p.stage));
      p.steps = ['澄清与 PRD','线框与主题','开发','走查','验收'].map((name, index) => ({ name, status: index < current || p.stage === 'done' ? '已完成' : index === current ? p.busy ? '进行中' : p.waitingFor ? '等你操作' : '当前阶段' : '未开始' }));
    }
    const colleagues = Object.fromEntries(['product', 'designer', 'developer'].map(role => {
      const working = Object.values(groups).filter(p => p.busy && roleFor(p.stage) === role);
      return [role, { role, busy: working.length > 0, projects: working.map(p => p.id) }];
    }));
    projects.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    projects.forEach((p, index) => { p.number = index + 1; p.source = p.chatId?.startsWith('web:') ? '工作台项目' : '飞书群项目'; });
    return { groups, projects, colleagues };
  };
  return { handleMessage, handleAction, getProject: get, getProjectById, waitForIdle: async chatId => { while (jobs.has(chatId)) await jobs.get(chatId); return get(chatId); }, getState };
}

import { projectLabel } from '../project-labels.mjs';
import { mkdir, readFile, writeFile, rename, unlink, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { roles } from '../agents/roles.mjs';
import { runAgent } from '../agents/run.mjs';
import { validateQuestions, validatePrd, validateDesign, validateSite, validateWalkthrough } from './validate.mjs';
import { nextStage, roleFor, stageNames, taskFor, timeLimits } from './stages.mjs';
import { gateCard, questionCard, answeredCard, progressCard, queuedCard, queuedTitle, resultCard, completeCard, stuckCard, confirmEndCard, closedCard, proposalCard, proposalTitle, proposalChoices, proposalButton, toast } from './cards.mjs';
import { StepError, checkFailed, briefOf, shorten, gateRole, retryRole, nextStep, staleText, activityText, taskLine } from './guide.mjs';
import { allowedActions, checkProposal, chatPrompt, chatTimeoutMs, artifacts, tidy } from './chat.mjs';
import { createSheet } from '../sheet.mjs';
import { createOutline } from '../outline.mjs';
import { cardView } from '../workbench/recorder.mjs';
import { capacityStatus } from '../agents/capacity.mjs';

const exists = async file => { try { await readFile(file); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
// 卡片还没发出去就被打断时，重试用这句话重发确认卡片
const gateText = { confirm_prd: '请确认 PRD：docs/prd.md', confirm_design: '请确认线框与主题', accept: '走查已完成，请验收' };
const errorText = error => {
  const detail = error?.response?.data;
  return detail?.code != null ? `${error.message ?? '飞书调用失败'}（code ${detail.code}，msg ${detail.msg ?? ''}）` : error?.message ?? String(error);
};

export function createFlow({ root = process.cwd(), agent = runAgent, feishu, recorder, projects, id = randomUUID, previewBase = 'http://127.0.0.1:4871', workbenchBase = 'http://127.0.0.1:4870' } = {}) {
  if (!feishu?.sendText || !feishu?.sendCard || !feishu?.patchCard) throw new Error('缺少消息适配器');
  const stateFile = path.join(root, 'data/state.json');
  const jobs = new Map();
  // 群聊对话：同一个群的对话按顺序一条条回，不占用项目的“干活中”
  const talks = new Map();
  // 正在跑的智能体：用来把用户的引导插进去、让它停下
  const live = new Map();
  const creations = new Map();
  const actions = new Set(), teamChanges = new Set();
  let state = { groups: {}, archived: [], proposals: {} };
  let saves = Promise.resolve();
  const ready = (async () => {
    try { state = JSON.parse(await readFile(stateFile, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    state.groups ??= {};
    state.archived ??= [];
    state.proposals ??= {};
    for (const offer of Object.values(state.proposals)) offer.creating = false;
    // 上次服务停掉时（电脑重启、睡眠、被关掉）还在干活的项目：标成出错并在群里说明，好让用户发“重试”接着做
    for (const project of Object.values(state.groups)) {
      if (project.busy && project.stage !== 'done' && !project.error) {
        const notice = safeError(project, new StepError('团队服务重启过，这一步没做完', { kind: 'restart' })).catch(error => console.error(`重启提示没发出去：${errorText(error)}`));
        const entry = notice.finally(() => { if (jobs.get(project.chatId) === entry) jobs.delete(project.chatId); });
        jobs.set(project.chatId, entry);
      }
      project.busy = false;
      project.queuedForAgent = false;
      project.activity = null;
      project.ending = null;
      if (project.dedicated) await projects?.syncContext(project);
    }
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
  const titled = (chatId, card) => {
    const p = state.groups[chatId] || state.archived.find(p => p.chatId === chatId);
    if (!p?.name || !card.header?.title?.content || card.header.title.content.startsWith('测试 ·')) return card;
    const title = card.header.title.content, prefix = projectLabel('', p.name) + '｜';
    if (title.startsWith(prefix)) return card;
    const result = structuredClone(card); result.header.title.content = prefix + title; return result;
  };
  const delivery = {
    sendText: (chatId, message, role) => chatId.startsWith('web:') ? recorder?.add(chatId, { kind: 'text', role: role ?? 'product', text: message, source: '工作台' }) : feishu.sendText(chatId, message, role),
    sendCard: async (chatId, card, role) => {
      card = titled(chatId, card);
      if (!chatId.startsWith('web:')) return feishu.sendCard(chatId, card, role);
      const messageId = id(); webCards.set(messageId, chatId);
      await recorder?.add(chatId, { kind: 'card', messageId, role, card: cardView(card), source: '工作台' });
      return messageId;
    },
    patchCard: (messageId, card, role, chatId) => { card = titled(chatId, card); return chatId?.startsWith('web:') ? recorder?.add(chatId, { kind: 'card_update', messageId, role, card: cardView(card), source: '工作台' }) : feishu.patchCard(messageId, card, role, chatId); },
    sendFile: (chatId, file, role) => chatId.startsWith('web:') ? Promise.resolve() : feishu.sendFile?.(chatId, file, role),
  };
  const sendText = (chatId, message, role) => delivery.sendText(chatId, message, role);
  const transition = async (p, to) => {
    p.stage = nextStage(p.stage, to); p.stageAt = new Date().toISOString(); p.currentFile = null;
    await save();
    // 完成/结束之后未必还有消息事件，状态变化本身也要同步项目上下文。
    if (p.dedicated) await projects?.syncContext(p);
  };
  // 停下了：记下完整原因，群里只发一张“这一步停下了”卡片（一句原因 + 重试 / 结束项目）
  const safeError = async (p, error) => {
    p.error = errorText(error);
    p.errorBrief = briefOf(error);
    p.lastFailure = { stage: p.stage, kind: error?.kind ?? 'other', checks: error?.checks ?? null };
    p.stuckCardId = id();
    await save();
    const role = retryRole(p);
    try {
      p.stuckMessageId = await delivery.sendCard(p.chatId, stuckCard({ role, brief: p.errorBrief, projectId: p.id, stage: p.stage, cardId: p.stuckCardId }), role);
      await save();
    } catch (cardError) {
      try { await delivery.sendText(p.chatId, `“${stageNames[p.stage]}”停下了：${p.errorBrief}。请 @${roles[role].name} 发送“重试”，不想做了就发送“结束”。`, role); }
      catch (sendError) { p.error += `；报错消息发送失败：${errorText(sendError)}`; await save(); }
    }
  };
  // 点过的卡片收起来，免得再被点
  const closeCard = async (chatId, messageId, title, text, role) => {
    if (!messageId) return;
    try { await delivery.patchCard(messageId, closedCard(title, text, role), role, chatId); } catch (error) { console.error(`收起卡片失败：${errorText(error)}`); }
  };
  const launch = (p, fn) => {
    p.busy = true;
    p.error = null;
    const job = (async () => {
      try { await save(); await fn(); }
      // 用户点了“停下并结束”：不发停下卡，下面直接结束项目
      catch (e) { if (!p.ending) await safeError(p, e); }
      finally {
        p.busy = false; p.queuedForAgent = false; p.currentFile = null; p.activity = null; await save();
        try {
          if (p.ending) { const who = p.ending; p.ending = null; await endProject(p, who); }
          else await drain(p);
        } catch (error) { console.error(`收尾出错：${errorText(error)}`); }
        if (jobs.get(p.chatId) === job) jobs.delete(p.chatId);
      }
    })();
    jobs.set(p.chatId, job);
    return job;
  };
  // 干活时记下的话：这一步做完后逐条进对话
  const drain = async p => {
    const queued = p.queued ?? [];
    if (!queued.length) return;
    p.queued = [];
    await save();
    for (const item of queued) {
      await closeCard(p.chatId, item.messageId, queuedTitle(item.role), `这一步做完了，接着回复这句话：${item.text}`, item.role);
      talk(p.chatId, item.role, item.text);
    }
  };
  const queue = async (p, role, text) => {
    const item = { cardId: id(), role, text };
    p.queued = [...(p.queued ?? []), item];
    await save();
    const minutes = Math.floor((Date.now() - Date.parse(p.workStartedAt ?? p.stageAt ?? Date.now())) / 60000);
    item.messageId = await delivery.sendCard(p.chatId, queuedCard({ role, doing: stageNames[p.stage], minutes, text, projectId: p.id, stage: p.stage, cardId: item.cardId }), role);
    await save();
  };
  // 让正在干活的智能体停下；它已经在收尾（没有在跑智能体）时停不了
  const stopStep = async (p, actor, role) => {
    const entry = live.get(p.chatId);
    if (!entry) { await sendText(p.chatId, '这一步正在收尾，停不下来了，做完会发新卡片。', role); return false; }
    p.stoppedBy = actor;
    void entry.control.stop?.();
    return true;
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
    } catch (error) {
      if (error.detail) console.error(`一览图截图失败：${error.detail}`);
      return { imageError: error.message };
    }
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
    // 网页文件发不出去不影响验收完成：说一句，链接和工作台里都能看到网页
    try { await delivery.sendFile(p.chatId, path.join(projectDir(p), 'site/index.html'), 'product'); }
    catch (error) {
      console.error(`发送网页文件失败：${errorText(error)}`);
      await delivery.sendText(p.chatId, `网页文件没能发到群里（${briefOf(error)}）。点上面的“打开网页”就能看，工作台里也有。`, 'product');
    }
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
    const notice = await projects?.notice(p, stage, p.cardRole);
    if (notice) await sendText(p.chatId, notice, p.cardRole);
  };
  const run = async (p, stage, detail = '', { note = '' } = {}) => {
    const dir = projectDir(p);
    const role = roleFor(stage);
    const round = stage === 'clarifying' ? p.questionRound + 1 : stage === 'walkthrough' ? p.walkthroughRound + 1 : 1;
    if (stage === 'clarifying') await unlink(path.join(dir, 'docs/questions.json')).catch(e => { if (e.code !== 'ENOENT') throw e; });
    const title = `${roles[role].name} · ${stageNames[stage]}`;
    const task = taskLine(stage, detail, round);
    let progressId;
    let lastPatch = 0;
    let lastActivity = Date.now();
    let pending = null;
    const started = Date.now();
    let current = '⏳ 在读任务';
    let steps = 0;
    const guides = [];
    const reads = new Set();
    const writes = new Set();
    let completed = false;
    p.workStartedAt = new Date(started).toISOString();
    p.progressCardId = id();
    p.activity = current;
    const stopValue = { action: 'stop', stage, projectId: p.id, cardId: p.progressCardId };
    const view = () => progressCard({ title, task, current, steps, guides, stopValue, elapsedSeconds: Math.round((Date.now() - started) / 1000) });
    progressId = await delivery.sendCard(p.chatId, view(), role);
    // 最多 2 秒更新一次，被挡下的那次随后补上；没动静时每 30 秒刷新一次用时
    const patchProgress = async () => {
      if (!progressId || completed) return;
      const wait = 2000 - (Date.now() - lastPatch);
      if (wait > 0) { pending ??= setTimeout(() => { pending = null; void patchProgress(); }, wait); return; }
      lastPatch = Date.now();
      try { await delivery.patchCard(progressId, view(), role, p.chatId); } catch (e) { p.progressError = errorText(e); }
    };
    const ticker = setInterval(() => {
      if (!p.queuedForAgent && Date.now() - lastActivity >= 15000 && current !== '💭 在思考') { current = '💭 在思考'; p.activity = current; void patchProgress(); }
      else if (Date.now() - lastPatch >= 30000) void patchProgress();
    }, 2000);
    const control = {};
    live.set(p.chatId, { role, control, guide: text => { guides.push(text); lastActivity = Date.now(); void patchProgress(); } });
    let result;
    try { result = await agent({ role, prompt: taskFor(stage, detail, round) + note + (await projects?.syncContext(p) || ''), projectDir: dir, timeoutMs: timeLimits[stage] * 60000, control,
      isolateSession: Boolean(p.dedicated),
      onQueued: waiting => { p.queuedForAgent = waiting; current = waiting ? '⏳ 等待空闲执行名额' : '⏳ 在读任务'; p.activity = current; lastActivity = Date.now(); void save(); void patchProgress(); },
      resume: stage === 'walkthrough' ? undefined : p.sessions[role], onProgress: event => {
        lastActivity = Date.now();
        const file = String(event.file ?? '').replace(/^.*?workspace\/[^/]+\//, '');
        p.currentFile = file;
        p.currentTool = event.tool;
        p.activityAt = new Date().toISOString();
        if (event.tool === 'Read') reads.add(file);
        if (event.tool === 'Write' || event.tool === 'Edit') writes.add(file);
        steps += 1;
        current = activityText({ tool: event.tool, file });
        p.activity = current;
        void save();
        void patchProgress();
      } }); }
    finally { clearInterval(ticker); clearTimeout(pending); completed = true; live.delete(p.chatId); }
    let hasPrd = false, questions, report, deliveryError;
    // SDK 正常返回只代表这一轮结束，文件契约通过后才能告诉用户“已完成”。
    if (result?.ok) {
      try {
        if (stage === 'clarifying') {
          hasPrd = await exists(path.join(dir, 'docs/prd.md'));
          if (!hasPrd && round >= 3) throw checkFailed(['docs/prd.md：第 3 轮必须写出 PRD']);
          const check = await (hasPrd ? validatePrd(dir) : validateQuestions(dir));
          if (!check.ok) throw checkFailed(check.errors);
          if (!hasPrd) {
            questions = JSON.parse(await readFile(path.join(dir, 'docs/questions.json'), 'utf8'));
            if (questions.round !== round) throw checkFailed([`docs/questions.json.round 应为 ${round}`]);
          }
        } else {
          const check = await ({ revise_prd: validatePrd, designing: validateDesign, revise_design: validateDesign,
            building: validateSite, revise_build: validateSite, walkthrough: validateWalkthrough })[stage](dir);
          if (!check.ok) throw checkFailed(check.errors);
          if (stage === 'walkthrough') {
            report = JSON.parse(await readFile(path.join(dir, 'design/walkthrough.json'), 'utf8'));
            if (report.round !== round) throw checkFailed([`design/walkthrough.json.round 应为 ${round}`]);
          }
        }
      } catch (error) { deliveryError = error; }
    }
    const delivered = Boolean(result?.ok) && !deliveryError;
    const outcome = delivered ? '✅ 已完成' : result?.stopped ? '⏹ 已停下' : '⚠️ 没做完';
    if (progressId) await delivery.patchCard(progressId, progressCard({ title, task, steps, guides, stats: result?.stats ?? {}, done: true, ok: delivered, outcome }), role, p.chatId);
    const process = { reads: reads.size, writes: writes.size, stats: result?.stats };
    if (result?.stopped) { const who = p.stoppedBy ?? '你'; p.stoppedBy = null; throw new StepError(`${who}让 ${roles[role].name}停下了这一步`, { kind: 'stopped' }); }
    if (result?.timedOut) throw new StepError(`${roles[role].name}这一步超过 ${timeLimits[stage]} 分钟还没做完，已经停下`, { kind: 'timeout', detail: `${roles[role].name}执行超时：${result.error}` });
    if (!result?.ok) throw new StepError(`${roles[role].name}这一步没做完：${shorten(result?.error ?? '没有返回结果', 30)}`, { kind: 'agent', detail: `${roles[role].name}执行失败：${result?.error ?? '没有返回结果'}` });
    if (stage !== 'walkthrough' && result.sessionId) p.sessions[role] = result.sessionId;
    if (deliveryError) throw deliveryError;
    if (stage === 'clarifying') {
      if (hasPrd) {
        await transition(p, 'confirm_prd');
        await issueCard(p, result.text || '请确认 PRD：docs/prd.md', 'confirm_prd', process);
      } else {
        p.questionRound = round;
        await issueCard(p, questions, 'clarifying');
      }
    } else {
      if (stage === 'revise_prd') { await transition(p, 'confirm_prd'); await issueCard(p, result.text || '请再次确认 PRD：docs/prd.md', 'confirm_prd', process); }
      if (stage === 'designing' || stage === 'revise_design') { await transition(p, 'confirm_design'); await issueCard(p, result.text || '请确认线框与主题', 'confirm_design', process); }
      if (stage === 'building' || stage === 'revise_build') {
        const picture = await previewImage(p, 'site', 'developer');
        await delivery.sendCard(p.chatId, resultCard({ role: 'developer', title: 'AI 程序员 · 网页已完成', description: result.text || '网页已生成', points: ['文件：site/index.html'], process, links: [{ label: '打开网页', url: `${previewBase}/p/${p.id}/site` }], ...picture }), 'developer');
        await transition(p, 'walkthrough'); await run(p, 'walkthrough', p.walkthroughDetail ?? '');
        p.walkthroughDetail = null;
      }
      if (stage === 'walkthrough') {
        p.walkthroughRound = round;
        await transition(p, 'accept');
        await issueCard(p, `${report.conclusion}：${report.summary}`, 'accept', process);
      }
    }
    await save();
  };
  const get = async chatId => { await ready; return state.groups[chatId] ?? null; };
  const startProject = (chatId, text, metadata = {}) => {
    const previous = state.groups[chatId];
    if (previous?.stage === 'done' && !previous.ended) state.archived.push(structuredClone(previous));
    const project = { id: id(), chatId, name: text.slice(0, 24), demand: text, createdAt: new Date().toISOString(), stage: 'idle', busy: false, error: null, questionRound: 0, walkthroughRound: 0, sessions: {}, cardId: null, cardMessageId: null, lastDetail: text, ...metadata };
    state.groups[chatId] = project;
    return project;
  };
  // 重试：停下卡上的按钮和文字“重试”都走这里
  const retry = async (p, actor) => {
    if (p.busy) return;
    p.busy = true; // 先占住这一步，再更新飞书卡片，防止消息与按钮并发重试。
    const stuck = p.stuckMessageId;
    p.stuckCardId = null; p.stuckMessageId = null;
    await closeCard(p.chatId, stuck, `${roles[retryRole(p)].name} · 这一步停下了`, `✓ ${actor}点了重试`, retryRole(p));
    // 交付检查没过：把没过的地方告诉智能体，免得再犯同样的错
    const checks = p.lastFailure?.kind === 'check' ? p.lastFailure.checks ?? [] : [];
    const note = checks.length ? `\n上次交付没通过检查：${checks.join('；')}。请改正后重新交付。` : '';
    if (p.pendingCard) {
      launch(p, async () => { p.cardMessageId = await delivery.sendCard(p.chatId, p.pendingCard, p.cardRole); p.pendingCard = null; });
    } else if (p.pendingAction) {
      const { target, oldStage, actor: who } = p.pendingAction;
      launch(p, async () => {
        await delivery.patchCard(p.cardMessageId, answeredCard(stageNames[oldStage], who, p.cardRole), p.cardRole, p.chatId);
        if (target === 'done') await finish(p);
        await transition(p, target);
        p.pendingAction = null;
        if (target !== 'done') await run(p, target);
      });
    } else if (gateRole(p.stage)) {
      launch(p, () => issueCard(p, gateText[p.stage], p.stage));
    } else launch(p, () => run(p, p.stage, p.lastDetail ?? '', { note }));
  };
  // 结束项目：文件都保留，群里空出来可以重新提需求
  const endProject = async (p, actor) => {
    await closeCard(p.chatId, p.stuckMessageId, `${roles[retryRole(p)].name} · 这一步停下了`, `✓ ${actor}结束了项目`, retryRole(p));
    await closeCard(p.chatId, p.endMessageId, 'AI 产品经理 · 结束这个项目？', `✓ ${actor}结束了项目`, 'product');
    if (p.cardId && gateRole(p.stage)) await closeCard(p.chatId, p.cardMessageId, `${roles[p.cardRole ?? 'product'].name} · ${stageNames[p.stage]}`, '项目已结束', p.cardRole ?? 'product');
    for (const item of p.queued ?? []) await closeCard(p.chatId, item.messageId, queuedTitle(item.role), `项目已结束，这句话没有处理：${item.text}`, item.role);
    Object.assign(p, { queued: [], ended: true, endedAt: new Date().toISOString(), endedStage: p.stage, stage: 'done', cardId: null, error: null, errorBrief: null, pendingCard: null, pendingAction: null, stuckCardId: null, stuckMessageId: null, endCardId: null, endMessageId: null });
    state.archived.push(structuredClone(p));
    if (!p.dedicated) delete state.groups[p.chatId];
    await save();
    await sendText(p.chatId, `已结束「${p.name}」，文件都保留着，工作台里能看到。${p.dedicated ? '想做新项目，请私聊 AI 产品经理或从工作台提需求。' : '想做新的，@AI 产品经理 说说你的想法。'}`);
  };
  const askToEnd = async p => {
    p.endCardId = id();
    p.endMessageId = await delivery.sendCard(p.chatId, confirmEndCard({ name: p.name, projectId: p.id, stage: p.stage, cardId: p.endCardId, busy: p.busy }), 'product');
    await save();
  };
  // 开项目：工作台“提需求”和提议卡上的“就按这个开始”都走这里
  const begin = async (chatId, text, { identity, options, requestId, intake = [] } = {}) => {
    const metadata = projects ? await projects.prepare({ projectId: id(), sourceChatId: chatId, text, identity, options, requestId }) : {};
    if (metadata.id) {
      const existing = Object.values(state.groups).find(p => p.id === metadata.id);
      if (existing) return { projectId: existing.id, chatId: existing.chatId, stage: existing.stage };
    }
    const project = startProject(metadata.chatId || chatId, text, metadata);
    const dir = projectDir(project);
    await Promise.all(['docs', 'design', 'site'].map(name => mkdir(path.join(dir, name), { recursive: true })));
    await transition(project, 'clarifying');
    launch(project, async () => {
    if (projects) {
      for (const row of intake) {
        const message = row.kind === 'card' ? `${row.card?.title || ''}\n${row.card?.text?.join('\n') || ''}` : row.text;
        if (message) await recorder?.add(project.chatId, { kind: row.kind === 'user' ? 'user' : 'text', role: row.role, actor: row.actor, text: message, projectId: project.id, source: '建项前讨论', originalAt: row.at });
      }
      await recorder?.add(project.chatId, { kind: 'user', role: 'product', text, projectId: project.id, actor: project.team.people.find(p => p.id === project.team.ownerId)?.name, source: '项目需求' });
      await sendText(project.chatId, `项目「${project.name}」已建立。本群只对应这个项目，讨论会记入独立工作区。\n${project.team.people.map(p => `${p.name}：${p.responsibilities.map(r => `${r.job}／${r.scope}`).join('；') || '项目成员'}`).join('\n')}`, 'product');
      if (project.invitationWarning) await sendText(project.chatId, `项目群已建好，部分成员尚未入群：${project.invitationWarning}。请处理飞书审批或在工作台调整项目成员，再保存分工以重新邀请。`, 'product');
      if (chatId !== project.chatId && !chatId.startsWith('web:')) await sendText(chatId, `已为「${project.name}」创建独立项目群，请到新群继续。${project.chatLink || ''}`, 'product');
    }
    await run(project, 'clarifying', text);
    });
    return { projectId: project.id, chatId: project.chatId, stage: project.stage, invitationWarning: project.invitationWarning };
  };
  // 群聊对话：角色只读文件，回一句话；需要时提议一个动作，发成带按钮的卡片，由用户点了才执行
  const converse = async ({ chatId, role, text, identity, source }) => {
    const p = await get(chatId);
    const files = [];
    if (p) for (const file of Object.keys(artifacts)) if (await exists(path.join(projectDir(p), file))) files.push(file);
    const rows = ((await recorder?.list(chatId, { limit: 30 })) ?? []).filter(row => ['user', 'text', 'card'].includes(row.kind));
    if (rows.at(-1)?.kind === 'user' && rows.at(-1).text === text) rows.pop();
    let result;
    try {
      result = await agent({ role, mode: 'chat', prompt: chatPrompt({ p, role, text, recent: rows.slice(-20), files }) + (p ? await projects?.syncContext(p) || '' : ''),
        isolateSession: Boolean(projects),
        projectDir: p ? projectDir(p) : projects?.lobbyDir(chatId) || path.join(root, 'data/chat-room'), timeoutMs: chatTimeoutMs });
    } catch (error) { result = { ok: false, error: error.message }; }
    const now = await get(chatId);
    const reply = tidy(result?.structured?.reply);
    if (!result?.ok || !reply) {
      console.error(`${roles[role].name}对话没有结果：${result?.error ?? '回复为空'}`);
      await sendText(chatId, `刚才没想好怎么回答。${nextStep(now)}`, role);
      return;
    }
    const proposal = checkProposal(result.structured.proposal, allowedActions(now, role));
    if (!proposal) { await sendText(chatId, reply, role); return; }
    const old = state.proposals[chatId];
    const history = proposal.action === 'start' && projects ? await recorder?.list(chatId, { limit: Number.MAX_SAFE_INTEGER }) || [] : [];
    const boundary = history.findLastIndex(row => row.kind === 'action_result' && row.action === 'start' && row.accepted);
    const intake = history.slice(boundary + 1).filter(row => ['user', 'text', 'card'].includes(row.kind) && (!now || row.at >= (now.endedAt || now.stageAt)));
    const offer = { cardId: id(), role, ...proposal, originalText: text, projectId: now?.id ?? 'none', stage: now?.stage ?? 'none', identity, source, ...(proposal.action === 'start' && projects ? { intake } : {}) };
    try { offer.messageId = await delivery.sendCard(chatId, proposalCard({ role, reply, ...offer }), role); }
    catch (error) { console.error(`提议卡片没发出去：${errorText(error)}`); await sendText(chatId, reply, role); return; }
    state.proposals[chatId] = offer;
    await save();
    // 一次只留最新的一条提议
    if (old) await closeCard(chatId, old.messageId, proposalTitle(old.role, old.action), '这条建议已过期，以最新那条为准', old.role);
  };
  const talk = (chatId, role, text, identity, source) => {
    const entry = (talks.get(chatId) ?? Promise.resolve())
      .then(() => converse({ chatId, role, text, identity, source }))
      .catch(error => console.error(`对话出错：${errorText(error)}`))
      .finally(() => { if (talks.get(chatId) === entry) talks.delete(chatId); });
    talks.set(chatId, entry);
    return entry;
  };
  const gateTitle = p => `${roles[p.cardRole ?? gateRole(p.stage)].name} · ${p.stage === 'accept' ? '走查完成，请验收' : stageNames[p.stage]}`;
  // 点了提议卡上的按钮：先核对提议还作数，再由代码执行
  const decide = async (chatId, p, offer, value, actor, identity, source) => {
    const action = value.action;
    if (!proposalChoices(offer.action).includes(action)) return stale(chatId, p, value);
    if (projects && action === 'start') {
      if (offer.creating) return toast('项目群正在创建，请稍等');
      if (p?.dedicated || offer.action !== 'start' || (p?.id ?? 'none') !== offer.projectId || (p?.stage ?? 'none') !== offer.stage || !allowedActions(p, offer.role).includes('start')) return stale(chatId, p, value);
      offer.creating = true;
      const task = (async () => {
        await save();
        try {
          await begin(chatId, offer.detail === offer.originalText ? offer.detail : `${offer.detail}\n\n需求原话：${offer.originalText || offer.detail}`, { identity: identity || offer.identity, requestId: offer.cardId, intake: offer.intake });
          if (state.proposals[chatId] === offer) delete state.proposals[chatId];
          await closeCard(chatId, offer.messageId, proposalTitle(offer.role, offer.action), `✓ ${actor}已创建项目群`, offer.role);
          await recorder?.add(chatId, { kind: 'action_result', action, accepted: true, value });
        } catch (error) { offer.creating = false; await sendText(chatId, `项目群没建好：${errorText(error)}。处理后可再点这张开工卡重试。`, 'product'); }
        finally { await save(); if (creations.get(chatId) === task) creations.delete(chatId); }
      })();
      creations.set(chatId, task);
      return toast('正在创建独立项目群');
    }
    delete state.proposals[chatId];
    await save();
    const declined = ['dismiss', 'keep'].includes(action);
    const current = (p?.id ?? 'none') === offer.projectId && (p?.stage ?? 'none') === offer.stage && allowedActions(p, offer.role).includes(offer.action);
    if (!declined && !current) {
      await closeCard(chatId, offer.messageId, proposalTitle(offer.role, offer.action), '这条建议已过期', offer.role);
      return stale(chatId, p, value);
    }
    await recorder?.add(chatId, { kind: 'action_result', action, accepted: true, value });
    const detail = ['start', 'revise', 'answer'].includes(action) ? `：${offer.detail}` : '';
    await closeCard(chatId, offer.messageId, proposalTitle(offer.role, offer.action), `✓ ${actor}点了“${proposalButton(offer.action, action)}”${detail}`, offer.role);
    if (declined) return toast('好的');
    if (action === 'start') { await begin(chatId, offer.detail); return toast('已开工'); }
    if (action === 'retry') { await retry(p, actor); return toast('已重试'); }
    if (action === 'end') { await endProject(p, actor); return toast('项目已结束'); }
    if (action === 'answer') {
      p.lastDetail = offer.detail;
      p.cardId = null;
      launch(p, () => run(p, 'clarifying', offer.detail));
      return toast('已提交回答');
    }
    // revise：等于打回并带上修改意见，直接开始改
    const target = { confirm_prd: 'revise_prd', confirm_design: 'revise_design', accept: 'revise_build' }[p.stage];
    await closeCard(chatId, p.cardMessageId, gateTitle(p), `${actor}提了修改意见，正在修改`, p.cardRole ?? gateRole(p.stage));
    p.cardId = null;
    p.lastDetail = offer.detail;
    if (target === 'revise_build') p.walkthroughDetail = offer.detail;
    launch(p, async () => { await transition(p, target); await run(p, target, offer.detail); });
    return toast('开始修改');
  };
  const handleMessage = async ({ chatId, text, role = 'product', senderType = 'user', intent, actor = '你', identity, source, options, requestId }) => {
    await ready;
    if (senderType !== 'user') return { ignored: true };
    const p = await get(chatId);
    const said = text.trim();
    const active = p && p.stage !== 'done';
    // 工作台“提需求”是明确的需求，直接开工；群里的话先聊，点了提议卡才开工
    if (intent === 'demand' && projects) return begin(chatId, text, { identity, options, requestId });
    if (intent === 'demand' && !active) return begin(chatId, text);
    const permissionAction = ['结束'].includes(said) ? 'end' : ['停止', '停下'].includes(said) ? 'stop' : said === '重试' ? 'retry' : active && !p.busy && !p.error && ['revise_prd', 'revise_design', 'revise_build'].includes(p.stage) && role === roleFor(p.stage) ? 'modify' : 'discuss';
    const permission = await projects?.authorize({ project: p, identity, source, action: permissionAction });
    if (permission && !permission.ok) { await sendText(chatId, permission.reason, role); return { denied: true, reason: permission.reason }; }
    if (teamChanges.has(chatId)) { const reason = '项目分工正在更新，请稍后再发操作'; await sendText(chatId, reason, role); return { denied: true, reason }; }
    if (['停止', '停下'].includes(said)) {
      if (p?.busy) { await stopStep(p, actor, role); return { stopping: true }; }
      await sendText(chatId, `现在没有正在干活的同事。${nextStep(active ? p : null)}`, role);
      return { waiting: true };
    }
    if (['重试', '结束'].includes(said)) {
      if (!active) { await sendText(chatId, `群里现在没有进行中的项目。${nextStep(null)}`, role); return { waiting: true }; }
      if (said === '结束') { await askToEnd(p); return { confirming: 'end' }; }
      if (p.busy) { await sendText(chatId, nextStep(p), role); return { busy: true }; }
      if (p.error) { await retry(p, actor); return { retrying: true }; }
      await sendText(chatId, `现在没有停下的步骤。${nextStep(p)}`, role);
      return { waiting: true };
    }
    if (active && !p.busy && !p.error && ['revise_prd', 'revise_design', 'revise_build'].includes(p.stage) && role === roleFor(p.stage)) {
      p.lastDetail = text;
      if (p.stage === 'revise_build') p.walkthroughDetail = text;
      launch(p, () => run(p, p.stage, text));
      return { stage: p.stage };
    }
    // 对正在干活的角色说话：先记下，这一步做完再回；卡片上可以“现在引导”或“停下这一步”
    if (p?.busy && role === roleFor(p.stage)) { await queue(p, role, text); return { queued: true }; }
    talk(chatId, role, text, identity, source);
    return { chatting: true };
  };
  const stale = async (chatId, p, value, reason = '过期卡片') => {
    await recorder?.add(chatId, { kind: 'action_result', action: value?.action, accepted: false, reason, value });
    await sendText(chatId, staleText(p));
    return toast('这张卡片已过期');
  };
  const processAction = async ({ chatId, value, formValue = {}, actor = '你', identity, source }) => {
    await ready;
    const p = await get(chatId);
    if (value?.projectId === 'test') return toast('这是测试卡片，不会推动流程，请点正式卡片');
    const permission = await projects?.authorize({ project: p, identity, source, action: value?.action });
    if (permission && !permission.ok) { await recorder?.add(chatId, { kind: 'action_result', action: value?.action, accepted: false, reason: permission.reason }); return toast(permission.reason); }
    const offer = state.proposals[chatId];
    if (offer && value?.cardId === offer.cardId) return decide(chatId, p, offer, value, actor, identity, source);
    const action = value?.action;
    const mine = p && p.id === value?.projectId;
    // 干活中也能点：进度卡和排队卡上的“停下”、排队卡上的“现在引导”
    const queued = mine ? p.queued?.find(item => item.cardId === value?.cardId) : null;
    if (mine && p.busy && action === 'stop' && (queued || value.cardId === p.progressCardId)) {
      if (queued) p.queued = p.queued.filter(item => item !== queued);
      await recorder?.add(chatId, { kind: 'action_result', action, accepted: true, value });
      if (queued) {
        await save();
        await closeCard(chatId, queued.messageId, queuedTitle(queued.role), `✓ ${actor}点了“停下这一步”`, queued.role);
      }
      return toast(await stopStep(p, actor) ? '正在停下' : '这一步正在收尾，停不下来了');
    }
    if (queued && p.busy && action === 'steer') {
      const entry = live.get(chatId);
      if (entry?.role === queued.role && entry.control.steer?.(queued.text)) {
        p.queued = p.queued.filter(item => item !== queued);
        await recorder?.add(chatId, { kind: 'action_result', action, accepted: true, value });
        await save();
        entry.guide(queued.text);
        await closeCard(chatId, queued.messageId, queuedTitle(queued.role), `↪ 已插进这一步：${queued.text}`, queued.role);
        return toast('已插进这一步');
      }
      return toast('这一步正在收尾，做完会接着回复这句话');
    }
    // 结束确认卡（干活中点“停下并结束”：先停下，这一步收尾后结束）
    if (mine && p.endCardId && value.cardId === p.endCardId && p.busy && ['end', 'keep'].includes(action)) {
      p.endCardId = null;
      if (action === 'end') p.ending = actor;
      await recorder?.add(chatId, { kind: 'action_result', action, accepted: true, value });
      if (action === 'keep') {
        await closeCard(chatId, p.endMessageId, 'AI 产品经理 · 结束这个项目？', `✓ ${actor}选择继续做`, 'product');
        p.endCardId = null; p.endMessageId = null; await save();
        return toast('继续做');
      }
      await closeCard(chatId, p.endMessageId, 'AI 产品经理 · 结束这个项目？', `✓ ${actor}点了“停下并结束”，这一步停下后结束`, 'product');
      p.endCardId = null; p.endMessageId = null; await save();
      const entry = live.get(chatId);
      if (entry) { p.stoppedBy = actor; void entry.control.stop?.(); }
      return toast('正在停下并结束');
    }
    const ours = p && p.id === value?.projectId && p.stage === value?.stage && !p.busy;
    // 停下卡：重试或结束项目
    if (ours && p.error && p.stuckCardId && value.cardId === p.stuckCardId && ['retry', 'end'].includes(action)) {
      p.stuckCardId = null; // 先消费按钮，再记录/更新飞书，避免同时重试或结束两次。
      await recorder?.add(chatId, { kind: 'action_result', action, accepted: true, value });
      if (action === 'retry') { await retry(p, actor); return toast('已重试'); }
      await endProject(p, actor);
      return toast('项目已结束');
    }
    // 结束确认卡
    if (ours && p.endCardId && value.cardId === p.endCardId && ['end', 'keep'].includes(action)) {
      p.endCardId = null;
      await recorder?.add(chatId, { kind: 'action_result', action, accepted: true, value });
      if (action === 'end') { await endProject(p, actor); return toast('项目已结束'); }
      await closeCard(chatId, p.endMessageId, 'AI 产品经理 · 结束这个项目？', `✓ ${actor}选择继续做`, 'product');
      p.endCardId = null; p.endMessageId = null; await save();
      await sendText(chatId, `好的，继续做。${nextStep(p)}`);
      return toast('继续做');
    }
    if (!ours || p.error || p.cardId !== value?.cardId) return stale(chatId, p, value);
    if (p.stage === 'clarifying' && action === 'answer') {
      const questions = JSON.parse(await readFile(path.join(projectDir(p), 'docs/questions.json'), 'utf8'));
      // 读文件期间另一份提交可能已消费这张卡；重新核对，再同步清卡并派活。
      if (state.groups[chatId] !== p || p.busy || p.stage !== value.stage || p.cardId !== value.cardId) return stale(chatId, p, value);
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
    if (!['confirm_prd', 'confirm_design', 'accept'].includes(p.stage) || !['confirm', 'reject'].includes(action)) return stale(chatId, p, value);
    const oldStage = p.stage;
    p.cardId = null;
    if (action === 'confirm') {
      const target = { confirm_prd: 'designing', confirm_design: 'building', accept: 'done' }[oldStage];
      p.pendingAction = { target, oldStage, actor, role: gateRole(oldStage) };
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
  const handleAction = async event => {
    if (teamChanges.has(event.chatId)) return toast('项目分工正在更新，请稍后点新卡片');
    if (actions.has(event.chatId)) return toast('正在处理上一条操作，请稍等');
    actions.add(event.chatId);
    try { return await processAction(event); }
    finally { actions.delete(event.chatId); }
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
      catch (error) { if (error.code !== 'ENOENT') throw error; p.name = p.name || (p.demand ?? '未命名项目').slice(0, 24); }
      projects.push(p);
    }
    for (const p of projects) {
      const dir = projectDir(p);
      p.artifacts = {};
      for (const [key, file] of Object.entries({ prd: 'docs/prd.md', wireframe: 'design/wireframe.html', theme: 'design/theme.json', site: 'site/index.html', walkthrough: 'design/walkthrough.json' })) p.artifacts[key] = await exists(path.join(dir, file));
      p.waitingFor = p.error ? '重试' : p.busy ? null : ({ clarifying: '回答问题', confirm_prd: '确认 PRD', confirm_design: '确认设计', accept: '验收', revise_prd: '说明 PRD 修改意见', revise_design: '说明设计修改意见', revise_build: '说明网页修改意见' })[p.stage] ?? null;
      p.activeRole = p.busy ? roleFor(p.stage) : null;
      p.retryRole = p.error ? retryRole(p) : null;
      const decisionStage = { revise_prd: 'confirm_prd', revise_design: 'confirm_design', revise_build: 'accept' }[p.stage] || p.stage;
      p.waitingOn = p.waitingFor ? p.team?.people.find(person => person.id === p.team?.approvers[decisionStage])?.name || '' : '';
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
    return { groups, projects, colleagues, scheduler: await capacityStatus(root) };
  };
  const updateTeam = async input => {
    await ready;
    const p = Object.values(state.groups).find(p => p.id === input.projectId);
    if (!p?.dedicated) throw Error('请选择新建的独立项目');
    if (p.busy || actions.has(p.chatId) || teamChanges.has(p.chatId)) throw Error('请等当前步骤或操作结束后调整项目分工');
    teamChanges.add(p.chatId);
    try {
    const previousStage = p.stage, previousCard = p.cardId;
    const team = await projects.updateTeam(p, input);
    if (p.busy || p.stage !== previousStage || p.cardId !== previousCard) throw Error('项目进度已变化，新增人员可能已入群，请重新确认分工后保存');
    p.team = team;
    p.invitationWarning = null;
    const reissue = Boolean(p.cardId);
    p.cardId = null;
    await save();
    await projects.syncContext(p);
    if (reissue) {
      const body = p.stage === 'clarifying' ? JSON.parse(await readFile(path.join(projectDir(p), 'docs/questions.json'), 'utf8')) : gateText[p.stage];
      await issueCard(p, body, p.stage);
    } else {
      const notice = await projects.notice(p, p.stage, p.cardRole || 'product');
      if (notice) await sendText(p.chatId, `项目分工已更新。${notice}`, p.cardRole || 'product');
    }
    return { team: p.team };
    } finally { teamChanges.delete(p.chatId); }
  };
  return { projects, updateTeam, handleMessage, handleAction, getProject: get, getProjectById, syncContext: async chatId => { const p = await get(chatId); if (p?.dedicated) await projects.syncContext(p); }, waitForIdle: async chatId => { await ready; while (creations.has(chatId) || jobs.has(chatId) || talks.has(chatId)) await (creations.get(chatId) ?? jobs.get(chatId) ?? talks.get(chatId)); return get(chatId); }, getState };
}

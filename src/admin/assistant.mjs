// AI 管理员助手：私聊里的固定指令、提醒卡上的按钮、每 30 秒一次的巡检，都由代码直接执行；
// 其他的话交给管家（steward.mjs，单会话智能体），它干活时管理员可以插话、让它停下
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { roles } from '../agents/roles.mjs';
import { stageNames } from '../flow/stages.mjs';
import { cleanReply, closedCard, serviceDownCard, statusCard, stewardCard, stuckCard } from './cards.mjs';
import { stewardActivity } from './steward.mjs';

export const NO_MODEL = '模型没配好，我现在只能做这几件：发“状态”看团队现状，发“重启”重启团队服务，发“撤销”撤销上一次改动，发“停下”让我停止正在做的事。项目停下或团队服务出问题时，我会私聊提醒你。';
const toast = (content, type = 'info') => ({ toast: { type, content } });
const name = p => `#${p.number} ${p.name}`;

export function createAssistant({ root, bot, supervisor, workbench, steward = null, deploy = null, changes = null, logger = console, now = () => Date.now() }) {
  // 发过的提醒记在 data/admin/alerts.json：同一个问题只报一次，管理服务重启后也不重报
  const file = path.join(root, 'data/admin/alerts.json');
  let alerts = {};
  try { alerts = JSON.parse(readFileSync(file, 'utf8')); } catch {}
  const save = () => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, `${JSON.stringify(alerts, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  };
  const patch = (messageId, card) => messageId ? bot.patchCard(messageId, card).catch(error => logger.error(`管理员助手更新卡片没成功：${error.message}`)) : null;
  let restarting = false;

  const alert = async (key, build, info = {}) => {
    if (alerts[key]) return;
    const cardId = randomUUID();
    alerts[key] = { cardId, ...info, at: new Date(now()).toISOString() };
    save();
    try { alerts[key].messageId = await bot.sendCard(build(cardId)); save(); }
    catch (error) { delete alerts[key]; save(); logger.error(`管理员助手发提醒没成功：${error.message}`); }
  };
  // 问题过去了：删掉记录；卡片还没人点过的，收起成一句话
  const settle = async (key, title, text) => {
    const a = alerts[key];
    if (!a) return;
    delete alerts[key];
    save();
    if (!a.closed) await patch(a.messageId, closedCard(title, text));
  };

  // 最近一次没回退的代码改动：团队服务起不来时多半是它
  const codeChange = () => { const c = changes?.lastChange(); return c?.level === 'code' ? c : null; };
  const serviceDown = (exit, error = exit?.output) => alert('service', cardId => serviceDownCard({ exit, error, cardId, lastChange: codeChange() }), { kind: 'service' });

  // 管家一次只做一件事；它在做时，管理员的话插进当前这一步，插不进去的排队
  let current = null;
  const waiting = [];
  const runSteward = async (prompt, task, { words = [], readOnly = false, alertKey = null } = {}) => {
    if (!steward) {
      if (alertKey && alerts[alertKey]) { alerts[alertKey].diagnosing = false; save(); }
      await bot.sendText(NO_MODEL); return;
    }
    if (current) { waiting.push({ prompt, task, options: { words, readOnly, alertKey } }); await bot.sendText('这句话先记下了，这次做完我接着处理。'); return; }
    const control = {};
    const cardId = randomUUID();
    const view = { task, activity: '💭 在想', steps: 0, guides: [], started: now() };
    const render = (extra = {}) => stewardCard({ ...view, elapsedMs: now() - view.started, cardId, ...extra });
    current = { control, cardId, view, words: [...words], refresh: () => {} };
    let messageId = null;
    let timer = null;
    let clock = null;
    let last = 0;
    try {
      messageId = await bot.sendCard(render()).catch(error => { logger.error(`管理员助手发进度卡没成功：${error.message}`); return null; });
      // 最多 2 秒更新一次进度卡
      current.refresh = () => {
        if (timer) return;
        timer = setTimeout(() => { timer = null; last = Date.now(); void patch(messageId, render()); }, Math.max(0, 2000 - (Date.now() - last)));
      };
      clock = setInterval(current.refresh, 15000);
      const r = await steward.run({ prompt, control, readOnly, onProgress: event => { view.steps += 1; view.activity = stewardActivity(event, root); current.refresh(); } });
      clearInterval(clock);
      clearTimeout(timer);
      if (!r.ok && !r.stopped) logger.error(`管理员助手做事没成功：${r.error}`);
      const reply = r.ok ? r.text : r.stopped ? '⏹ 已停下' : r.timedOut ? '超过 15 分钟没做完。把要求再说一次，或拆成更小的一步。' : '没做完。把要求再说一次；还不行，让搭团队的助手看 data/service.log。';
      if (messageId) await patch(messageId, render({ done: true, outcome: r.ok ? 'ok' : r.stopped ? 'stopped' : 'failed', reply, stats: r.stats }));
      else await bot.sendText(cleanReply(reply));
    } catch (error) {
      clearInterval(clock);
      clearTimeout(timer);
      logger.error(`管理员助手做事出错：${error.message}`);
      const reply = '没做完。把要求再说一次；还不行，让搭团队的助手看 data/service.log。';
      if (messageId) await patch(messageId, render({ done: true, outcome: 'failed', reply }));
      else await bot.sendText(reply);
    } finally {
      clearInterval(clock);
      clearTimeout(timer);
      current = null;
      if (alertKey && alerts[alertKey]) { alerts[alertKey].diagnosing = false; save(); }
      const next = waiting.shift();
      if (next) void runSteward(next.prompt, next.task, next.options).catch(error => logger.error(`管家出错：${error.message}`));
    }
  };
  const diagnosePrompt = p => [
    `管理员想知道「#${p.number} ${p.name}」为什么在「${stageNames[p.stage] ?? p.stage}」停下了（负责的是${roles[p.retryRole]?.name ?? '某个同事'}，记下的原因：${p.error}）。`,
    `去看 data/service.log 里相关的报错、data/state.json 里这个项目的记录、workspace/${p.id}/ 里的文件，需要的话问负责的同事。`,
    '只查不改：不要代为重试，不要交改动。回复分三段：查到的事实、推断的原因（写明是推断）、建议下一步（比如点“接着做”、改哪里）。',
  ].join('\n');

  const restart = async messageId => {
    restarting = true;
    try {
      const before = alerts.service?.cardId;
      const r = await (deploy?.restart?.() ?? supervisor.restart());
      // 重启时又崩了，退出通知已经发了一张新的提醒卡，不再重复发
      const fresh = Boolean(alerts.service) && alerts.service.cardId !== before;
      if (alerts.service && !fresh) { alerts.service.closed = true; save(); }
      if (r.ok) {
        await settle('service', '团队服务停了', '✓ 团队服务已恢复');
        await patch(messageId, closedCard('重启团队服务', '✓ 团队服务重启好了，3 个机器人已连上飞书'));
        return;
      }
      if (supervisor.status().running) {
        await patch(messageId, closedCard('重启团队服务', `没有重启：${r.error}`));
        return;
      }
      await patch(messageId, closedCard('重启团队服务', '重启没成功，原因见下一张卡片'));
      if (!fresh) { delete alerts.service; save(); await serviceDown(null, r.error); }
    } finally { restarting = false; }
  };

  const busyText = busy => `${busy.map(p => `${name(p)}（${roles[p.activeRole]?.name ?? '有同事'}在${stageNames[p.stage] ?? p.stage}）`).join('、')}正在干活，现在重启会打断它。等这一步做完再发“重启”。`;

  return {
    serviceDown,
    runSteward,
    busy: () => Boolean(current),
    adminWords: () => current?.words ?? [],

    async onMessage({ text }) {
      const t = text.trim();
      if (/^(状态|现状)$/.test(t)) {
        await bot.sendCard(statusCard({ service: supervisor.status(), snapshot: supervisor.status().running ? await workbench.state() : null, now: now(), cardId: randomUUID() }));
        return;
      }
      if (/^(停下|停止)$/.test(t)) {
        if (current) { await current.control.stop?.(); await bot.sendText('正在停下。'); return; }
        await bot.sendText('我现在没在做事。');
        return;
      }
      if (/^(回退|撤销)$/.test(t) && deploy) {
        const r = await deploy.revert();
        await bot.sendText(r.ok ? `✓ ${r.text}` : `没有撤销：${r.error}`);
        return;
      }
      if (/^(重启|重启团队服务)$/.test(t)) {
        if (restarting) { await bot.sendText('正在重启，请稍等'); return; }
        if (supervisor.status().running) {
          const snapshot = await workbench.state();
          if (!snapshot) { await bot.sendText('读不到项目状态，先不重启，过一会儿再试'); return; }
          const working = snapshot.projects.filter(p => p.busy);
          if (working.length) { await bot.sendText(busyText(working)); return; }
        }
        const messageId = await bot.sendCard(closedCard('重启团队服务', '正在重启团队服务…'));
        await restart(messageId);
        return;
      }
      if (current?.control.steer?.(t)) { current.words.push(t); current.view.guides.push(t); current.refresh(); return; }
      if (steward) { await runSteward(`管理员说：${t}`, t, { words: [t] }); return; }
      await bot.sendText(NO_MODEL);
    },

    // 回调要在 3 秒内返回：先回 toast，真正的活放到后台
    async onAction({ value = {}, messageId }) {
      if (value.projectId === 'test') return toast('这是测试卡片，不会推动流程，请点正式卡片');
      if (value.action === 'restart') {
        if (restarting) return toast('正在重启，请稍等');
        if (supervisor.status().healthy) { void patch(messageId, closedCard('团队现状', '团队服务在正常运行，不用重启。发“状态”看最新情况')); return toast('团队服务在正常运行，不用重启'); }
        restarting = true;
        void patch(messageId, closedCard('重启团队服务', '正在重启团队服务…')).then(() => restart(messageId)).catch(error => logger.error(`重启团队服务出错：${error.message}`));
        return toast('正在重启团队服务');
      }
      if (value.action === 'stop_steward') {
        if (current?.cardId !== value.cardId) return toast('这件事已经做完了');
        void current.control.stop?.();
        return toast('正在停下');
      }
      if (['golive', 'reject_change'].includes(value.action) && deploy) return toast(await deploy.onSign({ action: value.action, cardId: value.cardId, sha: value.sha, messageId }));
      if (value.action === 'revert' && deploy) {
        const alerted = Object.values(alerts).find(a => a.cardId === value.cardId);
        if (alerted) { alerted.closed = true; save(); }
        void deploy.revert({ sha: value.sha }).then(r => patch(messageId, closedCard('撤销改动', r.ok ? `✓ ${r.text}` : `没有撤销：${r.error}`))).catch(error => logger.error(`撤销出错：${error.message}`));
        return toast('正在撤销');
      }
      const entry = Object.entries(alerts).find(([, a]) => a.cardId === value.cardId);
      if (entry && value.action === 'diagnose') {
        const a = entry[1];
        if (a.diagnosing) return toast('已经在查了');
        a.diagnosing = true;
        save();
        void (async () => {
          const p = (await workbench.state())?.projects.find(x => x.id === a.projectId);
          if (!p) { a.diagnosing = false; save(); await bot.sendText('读不到这个项目，发“状态”看最新情况'); return; }
          await runSteward(diagnosePrompt(p), `看看 #${p.number} ${p.name} 为什么停下了`, { readOnly: true, alertKey: entry[0] });
        })().catch(error => { a.diagnosing = false; save(); logger.error(`查原因出错：${error.message}`); });
        return toast('正在查原因');
      }
      if (!entry || entry[1].closed) { void patch(messageId, closedCard('提醒', '这张提醒已经处理过了。发“状态”看最新情况')); return toast('这张卡片已经处理过了'); }
      const [, a] = entry;
      a.closed = true;
      save();
      if (value.action === 'ignore') {
        void (async () => {
          const p = (await workbench.state())?.projects.find(x => x.id === a.projectId);
          const who = roles[p?.retryRole]?.name ?? '负责的同事';
          const where = p?.chatId?.startsWith('web:') ? `在工作台对 ${who}发“重试”` : `在群里 @${who} 发“重试”`;
          await patch(messageId, closedCard('有项目停下了', `✓ 先不管 ${p ? name(p) : '这个项目'}了。之后想接着做，${where}。`));
        })().catch(error => logger.error(`收起提醒出错：${error.message}`));
        return toast('好的，先不管');
      }
      if (value.action === 'retry') {
        void (async () => {
          const p = (await workbench.state())?.projects.find(x => x.id === a.projectId);
          if (!p || p.waitingFor !== '重试' || p.stage !== a.stage || p.stuckCardId !== a.stuckCardId) {
            await patch(messageId, closedCard('有项目停下了', p ? `这张提醒过期了：${name(p)} 现在在「${stageNames[p.stage] ?? p.stage}」，${p.chatId?.startsWith('web:') ? '请到工作台看最新那张卡片' : '请到群里点最新那张卡片'}。` : '这张提醒过期了：读不到这个项目，发“状态”看最新情况'));
            return;
          }
          await workbench.message({ chatId: p.chatId, role: p.retryRole, text: '重试', via: 'admin' });
          await patch(messageId, closedCard('有项目停下了', `✓ 已让 ${roles[p.retryRole]?.name ?? '负责的同事'}接着做 ${name(p)}「${stageNames[p.stage] ?? p.stage}」，到${p.chatId?.startsWith('web:') ? '工作台' : '飞书群'}看进度卡。`));
        })().catch(async error => {
          a.closed = false;
          save();
          await bot.sendText(`没能接着做：${error.message}`).catch(() => {});
        });
        return toast('正在让同事接着做');
      }
      return toast('不认识这个按钮');
    },

    // 巡检：团队服务好着时，看有没有新停下的项目；停下的项目好了，收起提醒卡
    async tick() {
      const service = supervisor.status();
      if (!service.healthy) return;
      const snapshot = await workbench.state();
      if (!snapshot) return;
      await deploy?.tick();
      await settle('service', '团队服务停了', '✓ 团队服务已恢复');
      const stuck = new Map(snapshot.projects.filter(p => p.waitingFor === '重试').map(p => [`stuck:${p.id}:${p.stage}:${p.stuckCardId ?? ''}`, p]));
      for (const [key, p] of stuck) await alert(key, cardId => stuckCard({ p, cardId }), { kind: 'stuck', projectId: p.id, stage: p.stage, stuckCardId: p.stuckCardId });
      for (const key of Object.keys(alerts).filter(k => k.startsWith('stuck:') && !stuck.has(k))) {
        const p = snapshot.projects.find(x => x.id === alerts[key].projectId);
        const text = !p ? '✓ 这个项目已经不在了' : p.waitingFor === '重试' ? '这一步又停下了一次，看新的提醒' : p.stage === 'done' ? `✓ ${name(p)} 已${p.ended ? '结束' : '完成'}` : `✓ ${name(p)} 已经接着在做了（现在在「${stageNames[p.stage] ?? p.stage}」）`;
        await settle(key, '有项目停下了', text);
      }
    },
  };
}


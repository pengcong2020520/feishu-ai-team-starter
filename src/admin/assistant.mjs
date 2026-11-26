// AI 管理员助手：私聊里的固定指令、提醒卡上的按钮、每 30 秒一次的巡检。都由代码直接执行，不花模型费用
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { roles } from '../agents/roles.mjs';
import { stageNames } from '../flow/stages.mjs';
import { closedCard, serviceDownCard, statusCard, stuckCard } from './cards.mjs';

export const HELP = '我现在能做的：发“状态”看团队现状；发“重启”重启团队服务。项目停下、团队服务出问题时，我会私聊提醒你。';
const toast = (content, type = 'info') => ({ toast: { type, content } });
const name = p => `#${p.number} ${p.name}`;

export function createAssistant({ root, bot, supervisor, workbench, logger = console, now = () => Date.now() }) {
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

  const serviceDown = (exit, error = exit?.output) => alert('service', cardId => serviceDownCard({ exit, error, cardId }), { kind: 'service' });

  const restart = async messageId => {
    restarting = true;
    try {
      const before = alerts.service?.cardId;
      const r = await supervisor.restart();
      // 重启时又崩了，退出通知已经发了一张新的提醒卡，不再重复发
      const fresh = Boolean(alerts.service) && alerts.service.cardId !== before;
      if (alerts.service && !fresh) { alerts.service.closed = true; save(); }
      if (r.ok) {
        await settle('service', '团队服务停了', '✓ 团队服务已恢复');
        await patch(messageId, closedCard('重启团队服务', '✓ 团队服务重启好了，3 个机器人已连上飞书'));
        return;
      }
      await patch(messageId, closedCard('重启团队服务', '重启没成功，原因见下一张卡片'));
      if (!fresh) { delete alerts.service; save(); await serviceDown(null, r.error); }
    } finally { restarting = false; }
  };

  const busyText = busy => `${busy.map(p => `${name(p)}（${roles[p.activeRole]?.name ?? '有同事'}在${stageNames[p.stage] ?? p.stage}）`).join('、')}正在干活，现在重启会打断它。等这一步做完再发“重启”。`;

  return {
    serviceDown,

    async onMessage({ text }) {
      const t = text.trim();
      if (/^(状态|现状|看看)$/.test(t)) {
        await bot.sendCard(statusCard({ service: supervisor.status(), snapshot: supervisor.status().running ? await workbench.state() : null, now: now(), cardId: randomUUID() }));
        return;
      }
      if (/^重启/.test(t)) {
        if (restarting) { await bot.sendText('正在重启，请稍等'); return; }
        const busy = (await workbench.state())?.projects.filter(p => p.busy) ?? [];
        if (busy.length) { await bot.sendText(busyText(busy)); return; }
        const messageId = await bot.sendCard(closedCard('重启团队服务', '正在重启团队服务…'));
        await restart(messageId);
        return;
      }
      await bot.sendText(HELP);
    },

    // 回调要在 3 秒内返回：先回 toast，真正的活放到后台
    async onAction({ value = {}, messageId }) {
      if (value.action === 'restart') {
        if (restarting) return toast('正在重启，请稍等');
        if (supervisor.status().healthy) { void patch(messageId, closedCard('团队现状', '团队服务在正常运行，不用重启。发“状态”看最新情况')); return toast('团队服务在正常运行，不用重启'); }
        void patch(messageId, closedCard('重启团队服务', '正在重启团队服务…')).then(() => restart(messageId)).catch(error => logger.error(`重启团队服务出错：${error.message}`));
        return toast('正在重启团队服务');
      }
      const entry = Object.entries(alerts).find(([, a]) => a.cardId === value.cardId);
      if (!entry || entry[1].closed) { void patch(messageId, closedCard('提醒', '这张提醒已经处理过了。发“状态”看最新情况')); return toast('这张卡片已经处理过了'); }
      const [, a] = entry;
      a.closed = true;
      save();
      if (value.action === 'ignore') {
        void patch(messageId, closedCard('有项目停下了', '✓ 先不管了。之后想接着做，在群里 @ 负责的同事发“重试”'));
        return toast('好的，先不管');
      }
      if (value.action === 'retry') {
        void (async () => {
          const p = (await workbench.state())?.projects.find(x => x.id === a.projectId);
          if (!p || p.waitingFor !== '重试' || p.stage !== a.stage) {
            await patch(messageId, closedCard('有项目停下了', p ? `这张提醒过期了：${name(p)} 现在在「${stageNames[p.stage] ?? p.stage}」${p.busy ? '，有同事在干活' : ''}` : '这张提醒过期了：读不到这个项目，发“状态”看最新情况'));
            return;
          }
          await workbench.message({ chatId: p.chatId, role: p.retryRole, text: '重试', via: 'admin' });
          await patch(messageId, closedCard('有项目停下了', `✓ 已让${roles[p.retryRole]?.name ?? '负责的同事'}接着做 ${name(p)}「${stageNames[p.stage] ?? p.stage}」，群里会出现进度卡`));
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
      await settle('service', '团队服务停了', '✓ 团队服务已恢复');
      const snapshot = await workbench.state();
      if (!snapshot) return;
      const stuck = new Map(snapshot.projects.filter(p => p.waitingFor === '重试').map(p => [`stuck:${p.id}:${p.stage}`, p]));
      for (const [key, p] of stuck) await alert(key, cardId => stuckCard({ p, cardId }), { kind: 'stuck', projectId: p.id, stage: p.stage });
      for (const key of Object.keys(alerts).filter(k => k.startsWith('stuck:') && !stuck.has(k))) {
        const p = snapshot.projects.find(x => x.id === alerts[key].projectId);
        const text = !p ? '✓ 这个项目已经不在了' : p.stage === 'done' ? `✓ ${name(p)} 已${p.ended ? '结束' : '完成'}` : `✓ ${name(p)} 已经接着在做了（现在在「${stageNames[p.stage] ?? p.stage}」）`;
        await settle(key, '有项目停下了', text);
      }
    },
  };
}


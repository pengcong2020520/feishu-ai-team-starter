import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { listPackages, atomicJson } from './store.mjs';
import { readBindings } from './bindings.mjs';
import { teamCard } from './engine.mjs';

// 新团队的协调机器人私聊/入口群：自然语言需求 → 明确开工卡 → 新项目群。
// 默认产品经理仍保持旧入口，使用工作台选包时才启动标准网页包。
export function createPackageLobby({ root, engine, projects, feishu, recorder }) {
  const file = path.join(root, 'data/package-proposals.json'); let state = { proposals: {}, cursors: {} }, writes = Promise.resolve(); const pending = new Set();
  const ready = readFile(file, 'utf8').then(s => { state = JSON.parse(s); }).catch(e => { if (e.code !== 'ENOENT') throw e; });
  const save = () => { const value = structuredClone(state); const task = writes.then(() => atomicJson(file, value)); writes = task.catch(() => {}); return task; };
  return {
    async message(event) {
      if (['product', 'designer', 'developer'].includes(event.role)) return false;
      if (event.senderType && event.senderType !== 'user') return true;
      await ready;
      const packages = await listPackages(root), bindings = await readBindings(root);
      const candidates = packages.filter(p => bindings[p.id]?.roles?.[p.coordinator] === event.role);
      if (!candidates.length) { await feishu.sendText(event.chatId, '请向这支团队的协调同事提出新目标，或在工作台“团队与项目”创建。', event.role); return true; }
      if (candidates.length !== 1) { await feishu.sendText(event.chatId, '这个机器人对应多个团队或版本，请在工作台“团队与项目”选择后创建项目。', event.role); return true; }
      if (!projects) { await feishu.sendText(event.chatId, '请先启用领航版和人员分工，再创建独立飞书项目群；当前可在工作台体验本机项目。', event.role); return true; }
      const pack = candidates[0], proposal = { cardId: randomUUID(), requestId: randomUUID(), text: event.text, role: event.role, package: { id: pack.id, version: pack.version, hash: pack.hash }, identity: event.identity };
      if (pending.has(event.chatId)) { await feishu.sendText(event.chatId, '正在创建刚才确认的项目，请稍后到新群继续。', event.role); return true; }
      state.proposals[event.chatId] = proposal; await save();
      await feishu.sendCard(event.chatId, teamCard({ title: `${pack.name} · 要开始做吗？`, text: event.text, buttons: [{ label: '就按这个开始', primary: true, value: { action: 'package_start', projectId: 'new', stage: 'new', cardId: proposal.cardId } }] }), event.role);
      return true;
    },
    async action(event) {
      await ready; const proposal = state.proposals[event.chatId];
      if (!proposal || proposal.cardId !== event.value?.cardId || pending.has(event.chatId)) throw Error('开工卡已过期或正在创建，请使用最新卡片');
      const [creator, actor] = await Promise.all([projects?.directory.find(proposal.identity), projects?.directory.find(event.identity)]);
      if (!creator || creator.id !== actor?.id || !actor.active) throw Error('请由提出需求的人确认开工');
      pending.add(event.chatId);
      try {
        const rows = await recorder?.list(event.chatId, { limit: Number.MAX_SAFE_INTEGER }) || [];
        const intake = rows.slice(state.cursors[event.chatId] || 0);
        const p = await engine.create({ package: proposal.package, text: proposal.text, identity: event.identity, source: 'feishu', sourceChatId: event.chatId, requestId: proposal.requestId, options: { channel: 'feishu' }, intake });
        state.cursors[event.chatId] = rows.length;
        if (state.proposals[event.chatId]?.cardId === proposal.cardId) delete state.proposals[event.chatId]; await save();
        await feishu.sendText(event.chatId, `已创建「${p.name}」项目，请到独立项目群继续。${p.chatLink || ''}`, proposal.role); return { ok: true };
      } finally { pending.delete(event.chatId); }
    },
  };
}

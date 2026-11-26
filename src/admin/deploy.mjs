// 改动上线：文字类测试过了直接生效；代码类等管理员签字 → 跑测试 → 合并 → 重启团队服务 → 健康检查，起不来自动回退。
// 有项目在干活时不重启：等它这一步做完再上线
import { randomUUID } from 'node:crypto';
import { closedCard, liveCard, signCard } from './cards.mjs';

const label = p => `#${p.number} ${p.name}`;

export function createDeploy({ changes, supervisor, workbench, bot, logger = console, handBack = async () => {} }) {
  // 上线、回退、重启一次只做一件
  let chain = Promise.resolve();
  const serial = fn => { const next = chain.then(fn, fn); chain = next.catch(() => {}); return next; };
  const patch = (messageId, card) => messageId ? bot.patchCard(messageId, card).catch(error => logger.error(`管理员助手更新卡片没成功：${error.message}`)) : null;
  const busy = async () => (await workbench.state())?.projects.filter(p => p.busy) ?? [];
  const busyText = list => `${list.map(label).join('、')} 正在干活`;

  const restartAndCheck = async () => {
    const r = await supervisor.restart();
    if (!r.ok) return { ok: false, error: r.error };
    return await workbench.state() ? { ok: true } : { ok: false, error: '团队服务起来了，但工作台接口连不上' };
  };

  const failedTests = (t, change) => t.giveUp
    ? `测试还是没过（第 ${t.tries} 次），先停下，把情况告诉管理员，等他决定：\n${t.summary}`
    : `测试没过（第 ${t.tries} 次，最多 3 次）。改动还在工作副本里，请对照下面的失败修改后重新提交「${change.title}」：\n${t.summary}`;

  const goLive = change => serial(async () => {
    changes.setPending({ ...change, status: 'going' });
    const m = await changes.merge(change);
    if (!m.ok) {
      await changes.discard();
      await patch(change.messageId, closedCard('代码改动', `没上线：${m.error}。改动已丢弃`));
      return;
    }
    const r = await restartAndCheck();
    if (r.ok) {
      await patch(change.messageId, liveCard({ change, cardId: randomUUID() }));
      return;
    }
    // 上线后起不来：自动回退，再重启一次
    const rv = await changes.revert(change);
    const again = rv.ok ? await restartAndCheck() : { ok: false, error: rv.error };
    await patch(change.messageId, closedCard('代码改动', `上线后团队服务起不来（${String(r.error).slice(0, 200)}），已自动回退。${again.ok ? '团队服务已恢复。' : `回退后还是有问题：${again.error}，请看 data/service.log。`}`));
    logger.error(`管理员助手上线「${change.title}」后团队服务起不来，已自动回退：${r.error}`);
  });

  return {
    restartAndCheck,

    // 管家调 submit_change：返回给管家的一段话
    async submit({ title, why }) {
      const old = changes.state().pending;
      const c = await changes.prepare({ title, why });
      if (!c.ok) return c.error;
      if (c.level === 'text') {
        const t = await changes.test(c);
        if (!t.ok) return failedTests(t, c);
        const m = await changes.merge(c);
        if (!m.ok) { await changes.discard(); return `测试过了，但没上线：${m.error}。改动已丢弃，告诉管理员原因`; }
        await bot.sendCard(liveCard({ change: c, cardId: randomUUID() }));
        return `文字类改动「${title}」测试通过，已生效（下次同事干活就用上，不用重启）。已私聊通知管理员，卡片上可以撤销。改动文件：${c.files.join('、')}`;
      }
      // 代码类：发签字卡；之前没签的那张作废
      if (old?.status === 'sign' && old.messageId) await patch(old.messageId, closedCard('要上线这次代码改动吗？', `这张已作废：管家又交了新的改动「${title}」`));
      const cardId = randomUUID();
      const messageId = await bot.sendCard(signCard({ change: c, cardId }));
      changes.setPending({ ...c, status: 'sign', cardId, messageId });
      return `这是代码类改动（${c.files.join('、')}），已发签字卡给管理员。管理员点“上线”后，代码会先跑测试，通过了才合并到线上、重启团队服务并检查；测试没过会再交回给你。现在你只需要告诉管理员去点卡片。`;
    },

    // 签字卡上的按钮；回调要尽快返回，活放到后台
    async onSign({ action, cardId, sha, messageId }) {
      const pending = changes.state().pending;
      if (!pending || pending.cardId !== cardId || pending.status !== 'sign' || !await changes.stillSigned(sha)) {
        void patch(messageId, closedCard('要上线这次代码改动吗？', '这张卡片过期了：改动已经处理过，或者管家后来又改了。发“状态”看最新情况'));
        return '这张卡片已过期';
      }
      if (action === 'reject_change') {
        await changes.discard();
        void patch(messageId, closedCard('要上线这次代码改动吗？', `✓ 不要了，「${pending.title}」已丢弃`));
        return '已丢弃这次改动';
      }
      changes.setPending({ ...pending, status: 'testing' });
      void (async () => {
        await patch(messageId, closedCard('代码改动', `「${pending.title}」：正在跑测试…`));
        const t = await changes.test(pending);
        if (!t.ok) {
          changes.clearPending();
          await patch(messageId, closedCard('代码改动', `「${pending.title}」测试没通过，没有上线。${t.giveUp ? '已经试了 3 次，先停下了。' : '已交回给管家修改，改好会再发签字卡。'}`));
          await handBack(`你提交的代码改动「${pending.title}」在管理员同意后跑测试，${failedTests(t, pending)}`);
          return;
        }
        const working = await busy();
        if (working.length) {
          changes.setPending({ ...pending, status: 'waiting' });
          await patch(messageId, closedCard('代码改动', `「${pending.title}」测试通过。${busyText(working)}，等这一步做完再上线（不打断它）`));
          return;
        }
        await goLive(pending);
      })().catch(error => logger.error(`管理员助手上线出错：${error.message}`));
      return '正在跑测试';
    },

    // 巡检时：等着上线的改动，没有项目在干活了就上线
    async tick() {
      const pending = changes.state().pending;
      if (pending?.status !== 'waiting' || (await busy()).length) return;
      await goLive(pending);
    },

    async restart() {
      const working = await busy();
      if (working.length) return { ok: false, error: `${busyText(working)}，现在重启会打断它，等这一步做完再重启` };
      return serial(restartAndCheck);
    },

    // 回退：不指定就回退最近一次没回退过的改动
    revert: ({ sha } = {}) => serial(async () => {
      const change = sha ? changes.state().history?.find(c => c.sha.startsWith(sha)) : changes.lastChange();
      if (!change) return { ok: false, error: sha ? `没有 ${sha} 这次改动` : '还没有可以回退的改动' };
      if (change.revertedBy) return { ok: false, error: `「${change.title}」已经回退过了` };
      if (change.level === 'code') {
        const working = await busy();
        if (working.length) return { ok: false, error: `回退代码要重启团队服务；${busyText(working)}，等这一步做完再回退` };
      }
      const rv = await changes.revert(change);
      if (!rv.ok) return rv;
      if (change.level !== 'code') return { ok: true, text: `已回退「${change.title}」，下次同事干活就恢复原样`, change };
      const r = await restartAndCheck();
      return r.ok ? { ok: true, text: `已回退「${change.title}」，团队服务重启好了`, change } : { ok: false, error: `已回退「${change.title}」，但团队服务没起来：${r.error}` };
    }),
  };
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAssistant, NO_MODEL } from '../src/admin/assistant.mjs';
import { createAdminBot } from '../src/admin/bot.mjs';
import { cleanReply, projectLine, serviceDownCard, serviceLine, signCard, statusCard, stewardCard, stuckCard } from '../src/admin/cards.mjs';

const flush = () => new Promise(resolve => setTimeout(resolve, 20));
const text = card => JSON.stringify(card);
const STUCK = { id: 'p3', number: 3, name: '番茄钟', stage: 'building', waitingFor: '重试', error: '模型接口超时：很长的原因', errorBrief: '模型接口超时', retryRole: 'developer', chatId: 'oc_1', busy: false };

function setup({ projects = [STUCK], healthy = true, restartOk = true } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'admin-'));
  const sent = [];
  const patched = [];
  const messages = [];
  let n = 0;
  const bot = {
    sendCard: async card => { sent.push(card); return `om_${++n}`; },
    sendText: async t => { sent.push(t); return `om_${++n}`; },
    patchCard: async (id, card) => { patched.push({ id, card }); },
  };
  const service = { running: healthy, healthy, pid: 11, startedAt: new Date(Date.now() - 5 * 60000).toISOString(), lastExit: null };
  const supervisor = {
    status: () => ({ ...service }),
    restarts: 0,
    restart: async () => { supervisor.restarts += 1; if (restartOk) Object.assign(service, { running: true, healthy: true }); return restartOk ? { ok: true, pid: 12 } : { ok: false, error: '缺少配置：FEISHU_PRODUCT_APP_ID' }; },
  };
  const snapshot = { projects };
  const workbench = { state: async () => (service.healthy ? snapshot : null), message: async m => { messages.push(m); return {}; } };
  const assistant = createAssistant({ root, bot, supervisor, workbench, logger: { error() {}, log() {} } });
  return { root, assistant, sent, patched, messages, service, supervisor, snapshot, workbench };
}

test('巡检：新停下的项目私聊提醒一次，管理服务重启后也不重报；项目好了收起提醒卡', async () => {
  const s = setup();
  await s.assistant.tick();
  await s.assistant.tick();
  assert.equal(s.sent.length, 1);
  assert.match(text(s.sent[0]), /AI 管理员助手 · 有项目停下了/);
  assert.match(text(s.sent[0]), /#3 番茄钟\*\* 在「开发网页」停下了：模型接口超时/);
  assert.match(text(s.sent[0]), /"template":"orange"/);
  assert.match(readFileSync(path.join(s.root, 'data/admin/alerts.json'), 'utf8'), /stuck:p3:building/);
  // 管理服务重启：读回记录，不重报
  const again = createAssistant({ root: s.root, bot: { sendCard: async card => { s.sent.push(card); return 'om_x'; }, patchCard: async (id, card) => s.patched.push({ id, card }) }, supervisor: { status: () => ({ healthy: true }) }, workbench: { state: async () => s.snapshot } });
  await again.tick();
  assert.equal(s.sent.length, 1);
  s.snapshot.projects = [{ ...STUCK, waitingFor: null, busy: true, error: null }];
  await again.tick();
  assert.deepEqual(s.patched.map(p => p.id), ['om_1']);
  assert.match(text(s.patched[0].card), /#3 番茄钟 已经接着在做了（现在在「开发网页」）/);
});

test('点“接着做”：经工作台接口让负责的角色重试，群里写明是管理员助手代你；点过的不能再点', async () => {
  const s = setup();
  await s.assistant.tick();
  const cardId = JSON.parse(text(s.sent[0])).elements.at(-1).actions[0].value.cardId;
  const r = await s.assistant.onAction({ value: { action: 'retry', cardId, projectId: 'p3', stage: 'building' }, messageId: 'om_1' });
  assert.equal(r.toast.content, '正在让同事接着做');
  await flush();
  assert.deepEqual(s.messages, [{ chatId: 'oc_1', role: 'developer', text: '重试', via: 'admin' }]);
  assert.match(text(s.patched.at(-1).card), /已让 AI 程序员接着做 #3 番茄钟「开发网页」，到飞书群看进度卡/);
  const twice = await s.assistant.onAction({ value: { action: 'retry', cardId }, messageId: 'om_1' });
  assert.equal(twice.toast.content, '这张卡片已经处理过了');
  assert.equal(s.messages.length, 1);
});

test('点“接着做”时项目已经不在停下状态：按过期处理，不发重试；“先不管”收起且不再提醒', async () => {
  const s = setup();
  await s.assistant.tick();
  const cardId = JSON.parse(text(s.sent[0])).elements.at(-1).actions[0].value.cardId;
  s.snapshot.projects = [{ ...STUCK, stage: 'walkthrough', waitingFor: null, busy: true }];
  await s.assistant.onAction({ value: { action: 'retry', cardId }, messageId: 'om_1' });
  await flush();
  assert.equal(s.messages.length, 0);
  assert.match(text(s.patched.at(-1).card), /这张提醒过期了：#3 番茄钟 现在在「走查网页」，请到群里点最新那张卡片/);

  const t = setup();
  await t.assistant.tick();
  const id2 = JSON.parse(text(t.sent[0])).elements.at(-1).actions[1].value.cardId;
  assert.equal((await t.assistant.onAction({ value: { action: 'ignore', cardId: id2 }, messageId: 'om_1' })).toast.content, '好的，先不管');
  await flush();
  await t.assistant.tick();
  assert.equal(t.sent.length, 1);
  // 之后项目好了：卡片已经收起过，不再改
  t.snapshot.projects = [];
  await t.assistant.tick();
  assert.equal(t.patched.length, 1);
});

test('团队服务意外退出：提醒带重启按钮，同一次只报一次；点重启后恢复', async () => {
  const s = setup({ healthy: false });
  await s.assistant.serviceDown({ code: 1, signal: null, at: new Date().toISOString(), output: 'TypeError: x is not a function' });
  await s.assistant.serviceDown({ code: 1, signal: null, at: new Date().toISOString() });
  assert.equal(s.sent.length, 1);
  assert.match(text(s.sent[0]), /团队服务意外退出了（退出码 1）/);
  assert.match(text(s.sent[0]), /TypeError: x is not a function/);
  const value = JSON.parse(text(s.sent[0])).elements.at(-1).actions[0].value;
  assert.equal(value.action, 'restart');
  assert.equal((await s.assistant.onAction({ value, messageId: 'om_1' })).toast.content, '正在重启团队服务');
  await flush();
  assert.equal(s.supervisor.restarts, 1);
  assert.match(text(s.patched.at(-1).card), /团队服务重启好了/);
  // 恢复后巡检不再动这张卡
  await s.assistant.tick();
  assert.equal(s.patched.filter(p => /已恢复/.test(text(p.card))).length, 0);
  // 已经好了再点：不重启
  assert.equal((await s.assistant.onAction({ value, messageId: 'om_1' })).toast.content, '团队服务在正常运行，不用重启');
  assert.equal(s.supervisor.restarts, 1);
});

test('重启没成功：再发一张带原因的提醒卡', async () => {
  const s = setup({ healthy: false, restartOk: false });
  await s.assistant.serviceDown({ code: 1, at: new Date().toISOString() });
  const value = JSON.parse(text(s.sent[0])).elements.at(-1).actions[0].value;
  await s.assistant.onAction({ value, messageId: 'om_1' });
  await flush();
  assert.equal(s.sent.length, 2);
  assert.match(text(s.sent[1]), /团队服务没起来/);
  assert.match(text(s.sent[1]), /FEISHU_PRODUCT_APP_ID/);
});

test('私聊指令：“状态”出现状卡；“重启”有项目在干活时不重启；其他话回能做什么', async () => {
  const busy = { id: 'p4', number: 4, name: '读书笔记', stage: 'designing', busy: true, activeRole: 'designer', activity: '🧰 在用「画线框」技能' };
  const waiting = { id: 'p5', number: 5, name: '报名页', stage: 'confirm_design', waitingFor: '确认设计', busy: false, stageAt: new Date(Date.now() - 3 * 60000).toISOString() };
  const s = setup({ projects: [STUCK, busy, waiting, { id: 'p1', number: 1, name: '旧项目', stage: 'done' }] });
  await s.assistant.onMessage({ text: '状态' });
  const status = text(s.sent[0]);
  assert.match(status, /团队服务在运行（已运行 5 分钟）/);
  assert.match(status, /#3 番茄钟\*\* · 开发网页 · ⚠️ 停下了：模型接口超时/);
  assert.match(status, /#4 读书笔记\*\* · 画线框与主题 · AI 设计：🧰 在用「画线框」技能/);
  assert.match(status, /#5 报名页\*\* · 等你确认设计（已等 3 分钟）/);
  assert.match(status, /已完成 1 个项目/);
  assert.doesNotMatch(status, /重启团队服务/);
  await s.assistant.onMessage({ text: '重启' });
  assert.match(s.sent[1], /#4 读书笔记（AI 设计在画线框与主题）正在干活/);
  assert.equal(s.supervisor.restarts, 0);
  await s.assistant.onMessage({ text: '你好' });
  assert.equal(s.sent[2], NO_MODEL);
});

test('团队服务没在运行时的现状卡：读不到项目，带重启按钮', () => {
  const card = statusCard({ service: { running: false, healthy: false, lastExit: { code: 1, at: new Date(Date.now() - 120000).toISOString() } }, snapshot: null, cardId: 'c1' });
  assert.match(text(card), /团队服务没在运行（退出码 1，2 分钟前）/);
  assert.match(text(card), /读不到项目/);
  assert.match(text(card), /"action":"restart"/);
  assert.equal(serviceLine({ running: true, healthy: false }), '⏳ 团队服务在启动，还没连上飞书');
  assert.match(projectLine({ number: 2, name: '**粗体**名字', stage: 'clarifying' }), /#2 粗体名字\*\* · 澄清需求/);
});

test('管理员机器人只听管理员、只在私聊：别人私聊回“我只听管理员的”，群消息不理，按钮只认管理员', async () => {
  const created = [];
  const got = [];
  class Client { constructor() { this.im = { v1: { message: { create: async args => { created.push(args); return { code: 0, data: { message_id: 'om' } }; }, patch: async () => ({ code: 0 }) } } }; } }
  const lark = { Client, LoggerLevel: { error: 0 } };
  const bot = createAdminBot({ appId: 'cli', appSecret: 's', adminOpenId: 'ou_admin', lark, onMessage: e => got.push(e), onAction: async () => ({ toast: { type: 'info', content: 'ok' } }), logger: { error() {} } });
  const msg = (id, openId, chatType = 'p2p', content = '{"text":"状态"}') => ({ sender: { sender_type: 'user', sender_id: { open_id: openId } }, message: { message_id: id, chat_id: 'oc_p2p', chat_type: chatType, content } });
  await bot.handlers['im.message.receive_v1'](msg('m1', 'ou_admin'));
  await bot.handlers['im.message.receive_v1'](msg('m1', 'ou_admin'));
  await bot.handlers['im.message.receive_v1'](msg('m2', 'ou_other'));
  await bot.handlers['im.message.receive_v1'](msg('m3', 'ou_admin', 'group'));
  await flush();
  assert.deepEqual(got, [{ text: '状态' }]);
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].params, { receive_id_type: 'chat_id' });
  assert.match(created[0].data.content, /我只听管理员的/);
  assert.equal((await bot.handlers['card.action.trigger']({ operator: { open_id: 'ou_other' }, action: { value: {} } })).toast.content, '只有管理员能点');
  assert.equal((await bot.handlers['card.action.trigger']({ operator: { open_id: 'ou_admin' }, action: { value: {} } })).toast.content, 'ok');
  await bot.sendText('你好');
  assert.deepEqual([created[1].params, created[1].data.receive_id], [{ receive_id_type: 'open_id' }, 'ou_admin']);
  const broken = createAdminBot({ appId: 'cli', appSecret: 's', adminOpenId: 'ou_admin', lark, onMessage: async () => {}, onAction: async () => { throw new Error('内部故障'); }, logger: { error() {} } });
  assert.equal((await broken.handlers['card.action.trigger']({ operator: { open_id: 'ou_admin' } })).toast.content, '没点成。请再发“状态”看一下；还不行，让搭团队的助手看 data/service.log。');
});

test('卡片时间、输出和回复用中文可读格式', () => {
  const now = Date.parse('2026-01-01T03:00:00.000Z');
  assert.equal(serviceLine({ healthy: true, startedAt: new Date(now - 1000).toISOString() }, now), '✅ 团队服务在运行（刚刚启动）');
  assert.equal(serviceLine({ healthy: true, startedAt: new Date(now - 120 * 60000).toISOString() }, now), '✅ 团队服务在运行（已运行 2 小时）');
  assert.equal(serviceLine({ running: false, lastExit: { code: 1, at: new Date(now - 1000).toISOString() } }, now), '⚠️ 团队服务没在运行（退出码 1，刚刚）');
  assert.match(serviceLine({ running: false, lastExit: { code: null, signal: 'SIGTERM', at: new Date(now - 1000).toISOString() } }, now), /被系统停下了/);
  assert.match(projectLine({ number: 1, name: '计划', stage: 'confirm_prd', waitingFor: '确认 PRD', stageAt: new Date(now - 1000).toISOString() }, now), /等你确认 PRD（刚刚）/);
  assert.equal(cleanReply('# 标题\n> **内容** [链接] `代码` <尖括号>'), '标题\n内容 链接 代码 尖括号');
  assert.match(text(stewardCard({ task: '看看', activity: '', steps: 1, elapsedMs: 1, done: true, outcome: 'ok', reply: '# 标题\n> **内容**' })), /标题\\n内容/);
  const down = serviceDownCard({ exit: { code: 1 }, error: Array.from({ length: 7 }, (_, i) => `> **第${i}行**`).join('\n'), cardId: 'x', lastChange: { title: '改卡片', sha: 'abc' } });
  assert.equal(down.elements.filter(e => e.text?.content?.includes('第')).length, 5);
  assert.match(text(down), /撤销上一次改动/);
  assert.doesNotMatch(text(down), /第0行/);
  const sign = signCard({ change: { sha: 'abc', title: '改卡片', why: '要求', files: ['src/a.mjs'], stat: '1 个文件，增加 2 行，删除 1 行' }, cardId: 'x' });
  assert.match(text(sign), /1 个文件，增加 2 行，删除 1 行/);
  assert.match(text(sign), /点“上线”后：先跑测试/);
  assert.match(text(stuckCard({ p: STUCK, cardId: 's' })), /只查不改，要稍等一会儿/);
});

test('同一阶段换了停下卡会再提醒，并收起旧提醒', async () => {
  const s = setup({ projects: [{ ...STUCK, stuckCardId: 'first' }] });
  await s.assistant.tick();
  s.snapshot.projects = [{ ...STUCK, stuckCardId: 'second' }];
  await s.assistant.tick();
  assert.equal(s.sent.length, 2);
  assert.match(text(s.patched.at(-1).card), /这一步又停下了一次，看新的提醒/);
});

test('工作台项目的停下提醒指向工作台，先不管和接着做都说清下一步', async () => {
  const project = { ...STUCK, chatId: 'web:local', stuckCardId: 's1' };
  const s = setup({ projects: [project] });
  await s.assistant.tick();
  const actions = s.sent[0].elements.at(-1).actions;
  await s.assistant.onAction({ value: actions[0].value, messageId: 'om_1' });
  await flush();
  assert.match(text(s.patched.at(-1).card), /到工作台看进度卡/);
  const t = setup({ projects: [project] });
  await t.assistant.tick();
  await t.assistant.onAction({ value: t.sent[0].elements.at(-1).actions[2].value, messageId: 'om_1' });
  await flush();
  assert.match(text(t.patched.at(-1).card), /先不管 #3 番茄钟了。之后想接着做，在工作台对 AI 程序员发“重试”/);
});

test('先不管立即回 toast，工作台稍后返回时再收起卡片', async () => {
  const s = setup();
  await s.assistant.tick();
  let release;
  s.workbench.state = () => new Promise(resolve => { release = resolve; });
  const value = s.sent[0].elements.at(-1).actions[2].value;
  let timer;
  try {
    const result = await Promise.race([
      s.assistant.onAction({ value, messageId: 'om_1' }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('回调等待了工作台')), 1000); }),
    ]);
    assert.equal(result.toast.content, '好的，先不管');
    assert.equal(s.patched.length, 0);
  } finally { clearTimeout(timer); release(s.snapshot); }
  await flush();
  assert.match(text(s.patched.at(-1).card), /先不管 #3 番茄钟了/);
});

test('管理员测试卡的所有按钮只给提示，不执行任何操作', async () => {
  const s = setup({ healthy: false });
  for (const action of ['restart', 'golive', 'reject_change', 'revert', 'retry', 'diagnose', 'ignore', 'stop_steward']) {
    const r = await s.assistant.onAction({ value: { action, projectId: 'test', cardId: 'test' }, messageId: 'test' });
    assert.equal(r.toast.content, '这是测试卡片，不会推动流程，请点正式卡片');
  }
  assert.equal(s.supervisor.restarts, 0);
  assert.deepEqual([s.sent, s.patched, s.messages], [[], [], []]);
});

test('没配模型时查原因也会复位，下次点击仍有回应', async () => {
  const s = setup();
  await s.assistant.tick();
  const value = s.sent[0].elements.at(-1).actions[1].value;
  for (let i = 0; i < 2; i++) {
    assert.equal((await s.assistant.onAction({ value, messageId: 'om_1' })).toast.content, '正在查原因');
    await flush();
    assert.equal(s.sent.at(-1), NO_MODEL);
  }
});

test('状态读不到时巡检跳过，私聊重启拒绝；只有整句才算固定指令', async () => {
  const s = setup();
  s.service.healthy = true;
  const bot = { sendCard: async c => s.sent.push(c), sendText: async t => s.sent.push(t), patchCard: async () => {} };
  const workbench = { state: async () => null };
  const a = createAssistant({ root: s.root, bot, supervisor: s.supervisor, workbench, logger: { error() {} } });
  await a.tick();
  assert.equal(s.sent.length, 0);
  await a.onMessage({ text: '重启' });
  assert.equal(s.sent.at(-1), '读不到项目状态，先不重启，过一会儿再试');
  assert.equal(s.supervisor.restarts, 0);
  await a.onMessage({ text: '重启会影响正在做的项目吗？' });
  assert.equal(s.sent.at(-1), NO_MODEL);
});

test('README 链接管理员使用指南，指南使用当前按钮文案', () => {
  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /\]\(docs\/管理员助手\.md\)/);
  const guide = readFileSync('docs/管理员助手.md', 'utf8');
  assert.match(guide, /项目停下时点“接着做”；团队服务停了时点“重启团队服务”/);
  assert.match(guide, /点“撤销这次改动”，也可以私聊发“撤销”/);
});

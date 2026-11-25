import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createFlow } from '../src/flow/index.mjs';
import { nextStage } from '../src/flow/stages.mjs';
import { createRecorder } from '../src/workbench/recorder.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const put = async (dir, file, value) => {
  await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
  await writeFile(path.join(dir, file), typeof value === 'string' ? value : JSON.stringify(value));
};
const prd = ['# 报名页', '## 产品概述', '## 目标用户与场景', '## 用户故事', '假如打开页面，当提交报名，那么看到成功提示。', '## 页面与状态', 'default success', '## 边界情况', '## 功能需求', 'FR-001 报名', '## 成功标准', 'SC-001 成功', '## 假设', '## 本期不做'].join('\n');
const outline = { title: '报名页', blocks: [{ name: '页头', content: '介绍' }], states: [{ id: 'default', name: '默认', desc: '填写' }, { id: 'success', name: '成功', desc: '完成' }] };
const colors = Object.fromEntries(['background', 'surface', 'text', 'muted', 'border', 'primary', 'onPrimary', 'accent', 'success', 'warning', 'error', 'disabled'].map(x => [x, '#123456']));
async function deliver(dir, role, prompt, calls) {
  calls.push({ role, prompt });
  if (role === 'product' && prompt.startsWith('用户')) {
    const round = calls.filter(x => x.role === 'product' && x.prompt.startsWith('用户')).length;
    if (round <= 2) await put(dir, 'docs/questions.json', { round, why: '明确报名方式', questions: [{ id: 'q1', question: '需要电话吗？', matters: '确定字段', options: ['需要', '不需要'], recommended: 0, reason: '方便联系' }] });
    else { await put(dir, 'docs/prd.md', prd); await put(dir, 'docs/outline.json', outline); await put(dir, 'docs/checklist.md', Array.from({ length: 14 }, (_, i) => `- [x] CHK${String(i + 1).padStart(3, '0')}`).join('\n')); }
  }
  if (role === 'product' && prompt.startsWith('用户对 PRD')) await put(dir, 'docs/prd.md', prd + '\n修改说明');
  if (role === 'designer' && !prompt.includes('走查')) {
    await put(dir, 'design/wireframe.html', '<html><section data-screen="page" data-state="default"></section><section data-screen="page" data-state="success"></section><script type="application/json" id="design-outline">{"groups":[{"id":"signup","title":"报名","screens":[{"id":"page","title":"报名页","states":["default","success"]}]}]}</script><script>addEventListener("hashchange",()=>{}); // #screen=page&state=default</script></html>');
    await put(dir, 'design/theme.json', { preset: 'modern', name: '现代', reason: '清楚', tokens: { colors, typography: { body: 'system' }, radii: { sm: 4 }, spacing: { sm: 8 }, shadows: { none: 'none' } } });
  }
  if (role === 'developer') await put(dir, 'site/index.html', '<html><style></style><script>const states=["default","success"]; addEventListener("hashchange",()=>location.hash.includes("state=")); try { localStorage.getItem("x"); } catch(e) {}</script></html>');
  if (role === 'designer' && prompt.includes('走查')) {
    const round = prompt.includes('第 1 轮') ? 1 : 2;
    await put(dir, 'design/walkthrough.json', { round, conclusion: '通过', summary: '可以验收', coverage: [], findings: [], groups: [{ title: '报名', flowNote: '填写至成功', screens: [{ title: '报名页', state: 'default', reproduce: '打开页面', mark: '可以', note: '正常' }] }] });
  }
}
async function fixture(fn, agentOverride) {
  const dir = await mkdtemp(path.join(root, 'test-flow-'));
  const cards = [];
  const messages = [];
  const patched = [];
  const calls = [];
  // 群聊对话的假回复：测试往里放 { reply, proposal }，没放时只回一句、不提议
  const chats = [];
  const feishu = { sendText: async (_, text) => messages.push(text), sendCard: async (_, card) => { if (card.header?.title?.content?.includes('澄清需求') && !card.schema || card.header?.title?.content?.includes('开发网页') || card.header?.title?.content?.includes('画线框与主题') || card.header?.title?.content?.includes('走查网页') || card.header?.title?.content?.includes('修改') || card.header?.title?.content === 'AI 程序员 · 网页已完成') return 'progress'; cards.push(card); return `m${cards.length}`; }, patchCard: async (messageId, card) => { if (messageId !== 'progress') patched.push({ messageId, card }); } };
  const agent = agentOverride ?? (async ({ role, prompt, projectDir, resume, onProgress, mode }) => {
    if (mode === 'chat') {
      calls.push({ role, prompt, mode, projectDir });
      return { ok: true, text: '', structured: chats.shift() ?? { reply: '你好，有想做的网页可以直接说。', proposal: { action: 'none', detail: '' } }, sessionId: 'chat', stats: { turns: 1, durationMs: 1, inputTokens: 1, outputTokens: 1 } };
    }
    assert.equal(typeof onProgress, 'function');
    onProgress({ tool: 'Write', file: 'docs/prd.md' });
    await deliver(projectDir, role, prompt, calls);
    calls.at(-1).resume = resume;
    return { ok: true, text: '已完成', sessionId: `${role}-${calls.length}`, stats: { turns: 1, durationMs: 1, inputTokens: 2, outputTokens: 3 } };
  });
  const flow = createFlow({ root: dir, agent, feishu, id: (() => { let n = 0; return () => `id${++n}`; })() });
  try { await fn({ flow, cards, messages, patched, calls, dir, chats }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
const value = card => card.elements.at(-1).actions[0].value;
const reject = card => card.elements.at(-1).actions[1].value;
const answer = card => card.body.elements[0].elements.at(-1).behaviors[0].value;

test('完整流程：两轮澄清、自动走查、验收与持久化', () => fixture(async ({ flow, cards, patched, calls, dir }) => {
  await flow.handleMessage({ chatId: 'group', text: '做报名页', intent: 'demand' });
  await flow.waitForIdle('group');
  assert.equal(cards[0].schema, '2.0');
  const select = cards[0].body.elements[0].elements.find(x => x.tag === 'select_static');
  assert.equal(select.initial_index, 1);
  assert.deepEqual(select.options.map(x => x.value), ['0', '1']);
  assert.equal(cards[0].body.elements[0].elements.at(-1).form_action_type, 'submit');
  await flow.handleAction({ chatId: 'group', value: answer(cards[0]), formValue: { q1: '1', extra: '补充' } });
  await flow.waitForIdle('group');
  await flow.handleAction({ chatId: 'group', value: answer(cards[1]), formValue: { q1: '0' } });
  await flow.waitForIdle('group');
  assert.equal((await flow.getProject('group')).stage, 'confirm_prd');
  assert.match(calls[2].prompt, /这是最后一轮/);
  assert.equal(calls[1].resume, 'product-1');
  assert.equal(cards[2].config.update_multi, true);
  assert.ok(cards[2].elements.some(element => element.tag === 'action' && element.actions?.[0]?.text?.content === '打开结构图'));
  assert.match(await readFile(path.join(dir, 'workspace', (await flow.getProject('group')).id, 'shots/outline.html'), 'utf8'), /页面结构图/);
  await flow.handleAction({ chatId: 'group', value: value(cards[2]) });
  await flow.waitForIdle('group');
  assert.equal((await flow.getProject('group')).stage, 'confirm_design');
  await flow.handleAction({ chatId: 'group', value: value(cards[3]) });
  await flow.waitForIdle('group');
  assert.equal((await flow.getProject('group')).stage, 'accept');
  assert.equal(calls.at(-1).role, 'designer');
  assert.equal(calls.at(-1).resume, undefined);
  assert.match(calls.at(-1).prompt, /第 1 轮/);
  await flow.handleAction({ chatId: 'group', value: value(cards[4]) });
  await flow.waitForIdle('group');
  assert.equal((await flow.getProject('group')).stage, 'done');
  assert.equal(patched.length, 3);
  assert.match(patched[0].card.elements[0].text.content, /已确认/);
  const saved = JSON.parse(await readFile(path.join(dir, 'data/state.json'), 'utf8'));
  assert.equal(saved.groups.group.stage, 'done');
  assert.equal(saved.groups.group.walkthroughRound, 1);
  await flow.handleMessage({ chatId: 'group', text: '再做一个报名页', intent: 'demand' });
  await flow.waitForIdle('group');
  const state = await flow.getState();
  assert.equal(state.projects.length, 2);
  assert.equal(state.projects[0].stage, 'done');
  assert.equal(state.projects[1].stage, 'confirm_prd');
  assert.deepEqual(state.projects[1].steps.map(step => step.name), ['澄清与 PRD', '线框与主题', '开发', '走查', '验收']);
  assert.deepEqual(state.projects[1].steps.map(step => step.status), ['等你操作', '未开始', '未开始', '未开始', '未开始']);
}));

test('三个打回分支与回归走查，旧卡片过期', () => fixture(async ({ flow, cards, calls, messages }) => {
  await flow.handleMessage({ chatId: 'g', text: '报名页', intent: 'demand' }); await flow.waitForIdle('g');
  for (let i = 0; i < 2; i++) { await flow.handleAction({ chatId: 'g', value: answer(cards[i]) }); await flow.waitForIdle('g'); }
  const old = value(cards[2]);
  await flow.handleAction({ chatId: 'g', value: reject(cards[2]) }); await flow.waitForIdle('g');
  assert.equal((await flow.getProject('g')).stage, 'revise_prd');
  assert.match(messages.at(-1), /AI 产品经理/);
  assert.match((await flow.handleAction({ chatId: 'g', value: old })).toast.content, /过期/);
  assert.match(messages.at(-1), /这张卡片已过期，现在在「修改 PRD」/);
  await flow.handleMessage({ chatId: 'g', role: 'product', text: '改标题' }); await flow.waitForIdle('g');
  await flow.handleAction({ chatId: 'g', value: value(cards[3]) }); await flow.waitForIdle('g');
  await flow.handleAction({ chatId: 'g', value: reject(cards[4]) }); await flow.waitForIdle('g');
  assert.equal((await flow.getProject('g')).stage, 'revise_design');
  await flow.handleMessage({ chatId: 'g', role: 'designer', text: '改布局' }); await flow.waitForIdle('g');
  await flow.handleAction({ chatId: 'g', value: value(cards[5]) }); await flow.waitForIdle('g');
  await flow.handleAction({ chatId: 'g', value: reject(cards[6]) }); await flow.waitForIdle('g');
  assert.equal((await flow.getProject('g')).stage, 'revise_build');
  await flow.handleMessage({ chatId: 'g', role: 'developer', text: '改按钮' }); await flow.waitForIdle('g');
  assert.equal((await flow.getProject('g')).walkthroughRound, 2);
  assert.match(calls.at(-1).prompt, /回归走查/);
  assert.match(calls.at(-1).prompt, /用户这次的修改意见：改按钮/);
  assert.match(calls.at(-1).prompt, /每屏的说明写用户在页面上看到了什么/);
  assert.equal((await flow.getProject('g')).stage, 'accept');
}));

test('干活时对它说话先记下，做完再回；交付文件错误后停住且可重试', () => fixture(async ({ flow, messages, dir }) => {
  let release;
  let count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const sent = [];
  // 本用例用单独的编排来制造未完成的智能体调用。
  const local = createFlow({ root: dir, feishu: { sendText: async (_, text) => messages.push(text), sendCard: async (_, card) => { sent.push(card); return 'm'; }, patchCard: async () => {} },
    agent: async ({ projectDir, mode, prompt }) => {
      if (mode === 'chat') { messages.push(`对话：${prompt.match(/用户这次对你说：(.*)/)[1]}`); return { ok: true, structured: { reply: '收到', proposal: { action: 'none', detail: '' } }, stats: {} }; }
      count++;
      if (count === 1) await gate;
      if (count > 1) await put(projectDir, 'docs/questions.json', { round: 1, why: '确认', questions: [{ id: 'q', question: '选什么？', matters: '决定字段', options: ['一', '二'], recommended: 0, reason: '清楚' }] });
      return { ok: true, text: '', sessionId: 's', stats: { turns: 1, durationMs: 1, inputTokens: 0, outputTokens: 0 } };
    } });
  await local.handleMessage({ chatId: 'busy', text: '报名页', intent: 'demand' });
  assert.equal((await local.handleMessage({ chatId: 'busy', text: '又发一次' })).queued, true);
  assert.equal(sent.at(-1).header.title.content, 'AI 产品经理 · 先记下了');
  assert.match(JSON.stringify(sent.at(-1)), /这句话会在这一步做完后回复/);
  assert.equal((await local.handleMessage({ chatId: 'busy', text: '重试' })).busy, true);
  assert.match(messages.at(-1), /AI 产品经理正在澄清需求，做完会在群里发新卡片/);
  release(); await local.waitForIdle('busy');
  assert.equal(messages.at(-2), '对话：又发一次');
  const stuck = await local.getProject('busy');
  assert.equal(stuck.stage, 'clarifying');
  assert.match(stuck.error, /questions\.json/);
  assert.equal(stuck.errorBrief, '交付的澄清问题没通过格式检查');
  assert.equal(sent.at(-1).header.title.content, 'AI 产品经理 · 这一步停下了');
  await local.handleMessage({ chatId: 'busy', role: 'product', text: '重试' }); await local.waitForIdle('busy');
  assert.equal((await local.getProject('busy')).error, null);
}));

test('阶段表禁止越级', () => { assert.throws(() => nextStage('confirm_prd', 'building')); });

test('测试卡片不推动流程', () => fixture(async ({ flow }) => {
  const result = await flow.handleAction({ chatId: 'g', value: { projectId: 'test', cardId: 'test', stage: 'confirm_prd', action: 'confirm' } });
  assert.match(result.toast.content, /测试卡片/);
  assert.equal(await flow.getProject('g'), null);
}));

test('项目列表扫描工作区并用 PRD 标题命名，未在状态里的项目视为完成', () => fixture(async ({ flow, dir }) => {
  await put(dir, 'workspace/old-project/docs/prd.md', '# 旧项目页面\n说明');
  const state = await flow.getState();
  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].name, '旧项目页面');
  assert.equal(state.projects[0].stage, 'done');
  assert.equal(state.projects[0].number, 1);
}));

test('web 会话的进度和问题卡只写工作台消息记录', () => fixture(async ({ dir }) => {
  const recorder = createRecorder(dir);
  const forbidden = () => { throw new Error('不应调用飞书'); };
  const flow = createFlow({ root: dir, recorder, feishu: { sendText: forbidden, sendCard: forbidden, patchCard: forbidden }, agent: async ({ projectDir, onProgress }) => {
    await put(projectDir, 'docs/questions.json', { round: 1, why: '确认', questions: [{ id: 'q', question: '选什么？', matters: '决定页面', options: ['一', '二'], recommended: 0, reason: '清楚' }] });
    onProgress({ tool: 'Write', file: 'docs/questions.json' });
    return { ok: true, text: '请回答', sessionId: 'web-session', stats: { turns: 1, durationMs: 1, inputTokens: 1, outputTokens: 1 } };
  } });
  await flow.handleMessage({ chatId: 'web:local', text: '做一个网页', intent: 'demand' });
  await flow.waitForIdle('web:local');
  const records = await recorder.list('web:local');
  assert.ok(records.some(record => record.card?.title === 'AI 产品经理 · 有几个问题'));
  assert.ok(records.some(record => record.kind === 'card_update'));
}));

test('发问题卡片失败后只重发卡片，不重复调用智能体', () => fixture(async ({ dir }) => {
  let agentCalls = 0;
  let cardCalls = 0;
  const messages = [];
  const local = createFlow({ root: dir, feishu: {
    sendText: async (_, text) => messages.push(text),
    sendCard: async (_, card) => { if (card.header?.title?.content?.includes('澄清需求')) return 'progress'; cardCalls++; if (cardCalls === 1) throw Object.assign(new Error('请求失败'), { response: { data: { code: 123, msg: '卡片格式错误' } } }); return 'm2'; },
    patchCard: async () => {},
  }, agent: async ({ projectDir }) => {
    agentCalls++;
    await put(projectDir, 'docs/questions.json', { round: 1, why: '确认', questions: [{ id: 'q', question: '选什么？', matters: '决定字段', options: ['一', '二'], recommended: 0, reason: '清楚' }] });
    return { ok: true, text: '', sessionId: 's', stats: { turns: 1, durationMs: 1, inputTokens: 0, outputTokens: 0 } };
  } });
  await local.handleMessage({ chatId: 'card', text: '报名页', intent: 'demand' }); await local.waitForIdle('card');
  const stuck = await local.getProject('card');
  assert.match(stuck.error, /code 123，msg 卡片格式错误/);
  assert.equal(stuck.errorBrief, '飞书接口出错（code 123）');
  await local.handleMessage({ chatId: 'card', role: 'product', text: '重试' }); await local.waitForIdle('card');
  assert.equal(agentCalls, 1);
  assert.equal(cardCalls, 3); // 问题卡、停下卡、重发的问题卡
  assert.equal((await local.getProject('card')).error, null);
}));

test('服务在智能体干活时停掉：重启后在群里说明，发“重试”接着做这一步', async () => {
  const dir = await mkdtemp(path.join(root, 'test-flow-'));
  try {
    await put(dir, 'data/state.json', { groups: { g: { id: 'p1', chatId: 'g', name: '报名页', demand: '报名页', stage: 'clarifying', busy: true, error: null, questionRound: 2, walkthroughRound: 0, sessions: { product: 's2' }, cardId: null, cardMessageId: 'm2', lastDetail: '需要电话吗？：需要' } }, archived: [] });
    await mkdir(path.join(dir, 'workspace/p1'), { recursive: true });
    const messages = [];
    const calls = [];
    const sent = [];
    const local = createFlow({ root: dir, feishu: { sendText: async (_, text) => messages.push(text), sendCard: async (_, card) => { sent.push(card); return 'm3'; }, patchCard: async () => {} }, agent: async ({ prompt, resume, projectDir }) => {
      calls.push({ prompt, resume });
      await put(projectDir, 'docs/prd.md', prd); await put(projectDir, 'docs/outline.json', outline);
      await put(projectDir, 'docs/checklist.md', Array.from({ length: 14 }, (_, i) => `- [x] CHK${String(i + 1).padStart(3, '0')}`).join('\n'));
      return { ok: true, text: '已写好 PRD', sessionId: 's3', stats: { turns: 1, durationMs: 1, inputTokens: 0, outputTokens: 0 } };
    } });
    const p = await local.waitForIdle('g');
    assert.equal(p.busy, false);
    assert.match(p.error, /团队服务重启过/);
    assert.equal(sent[0].header.title.content, 'AI 产品经理 · 这一步停下了');
    assert.match(JSON.stringify(sent[0]), /团队服务重启过，这一步没做完/);
    const [listed] = (await local.getState()).projects;
    assert.deepEqual([listed.number, listed.waitingFor, listed.retryRole], [1, '重试', 'product']);
    assert.equal((JSON.parse(await readFile(path.join(dir, 'data/state.json'), 'utf8'))).groups.g.busy, false);
    await local.handleMessage({ chatId: 'g', role: 'product', text: '重试' }); await local.waitForIdle('g');
    assert.equal(calls.length, 1);
    assert.match(calls[0].prompt, /用户的回答：需要电话吗？：需要/);
    assert.match(calls[0].prompt, /这是最后一轮/);
    assert.equal(calls[0].resume, 's2');
    const after = await local.getProject('g');
    assert.equal(after.stage, 'confirm_prd');
    assert.equal(after.error, null);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('确认卡片没发出去就停掉：重试只重发确认卡片，不再调用智能体', async () => {
  const dir = await mkdtemp(path.join(root, 'test-flow-'));
  try {
    await put(dir, 'data/state.json', { groups: { g: { id: 'p1', chatId: 'g', name: '报名页', demand: '报名页', stage: 'confirm_prd', busy: true, error: null, questionRound: 3, walkthroughRound: 0, sessions: { product: 's3' }, cardId: null, cardMessageId: 'm2', lastDetail: '' } }, archived: [] });
    await put(dir, 'workspace/p1/docs/prd.md', prd); await put(dir, 'workspace/p1/docs/outline.json', outline);
    const messages = [];
    const cards = [];
    let agentCalls = 0;
    const local = createFlow({ root: dir, feishu: { sendText: async (_, text) => messages.push(text), sendCard: async (_, card) => { cards.push(card); return 'm3'; }, patchCard: async () => {} }, agent: async () => { agentCalls++; return { ok: false, error: '不该调用' }; } });
    await local.waitForIdle('g');
    assert.equal(cards[0].header.title.content, 'AI 产品经理 · 这一步停下了');
    await local.handleMessage({ chatId: 'g', role: 'product', text: '重试' }); await local.waitForIdle('g');
    assert.equal(agentCalls, 0);
    assert.equal(cards.length, 2);
    assert.equal(value(cards[1]).stage, 'confirm_prd');
    const after = await local.getProject('g');
    assert.equal(after.stage, 'confirm_prd');
    assert.equal(after.error, null);
    assert.equal(after.cardId, value(cards[1]).cardId);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('智能体报错不自动重试，机器人消息不触发任务', () => fixture(async ({ flow, cards }) => {
  assert.deepEqual(await flow.handleMessage({ chatId: 'g', text: '机器人消息', senderType: 'bot' }), { ignored: true });
  await flow.handleMessage({ chatId: 'g', text: '报名页', intent: 'demand' }); await flow.waitForIdle('g');
  const p = await flow.getProject('g');
  assert.equal(p.stage, 'clarifying');
  assert.match(p.error, /AI 产品经理执行失败：模型暂不可用/);
  assert.equal(p.errorBrief, 'AI 产品经理这一步没做完：模型暂不可用');
  const stuck = cards.at(-1);
  assert.equal(stuck.header.title.content, 'AI 产品经理 · 这一步停下了');
  assert.deepEqual(stuck.elements.at(-1).actions.map(b => [b.text.content, b.value.action]), [['重试', 'retry'], ['结束项目', 'end']]);
}, async () => ({ ok: false, text: '', sessionId: null, error: '模型暂不可用', stats: { turns: 0, durationMs: 1, inputTokens: 0, outputTokens: 0 } })));

const stuckOf = cards => cards.filter(card => card.header?.title?.content?.endsWith('这一步停下了')).at(-1);
const okResult = text => ({ ok: true, text, sessionId: 's', stats: { turns: 1, durationMs: 1, inputTokens: 0, outputTokens: 0 } });

test('交付检查没过：停下卡上点重试，智能体会收到没过的原因', () => fixture(async ({ flow, cards, dir }) => {
  const prompts = [];
  const local = createFlow({ root: dir, id: (() => { let n = 0; return () => `k${++n}`; })(), feishu: { sendText: async () => {}, sendCard: async (_, card) => { cards.push(card); return `m${cards.length}`; }, patchCard: async () => {} }, agent: async ({ prompt, projectDir }) => {
    prompts.push(prompt);
    await put(projectDir, 'docs/questions.json', prompts.length === 1 ? { round: 1 } : { round: 1, why: '确认', questions: [{ id: 'q', question: '选什么？', matters: '决定字段', options: ['一', '二'], recommended: 0, reason: '清楚' }] });
    return okResult('');
  } });
  await local.handleMessage({ chatId: 'c', text: '报名页', intent: 'demand' }); await local.waitForIdle('c');
  const card = stuckOf(cards);
  await local.handleAction({ chatId: 'c', value: card.elements.at(-1).actions[0].value, actor: '小王' }); await local.waitForIdle('c');
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /上次交付没通过检查：docs\/questions\.json/);
  const p = await local.getProject('c');
  assert.equal(p.error, null);
  assert.equal(p.cardId !== null, true);
  // 点过的停下卡再点就过期
  assert.match((await local.handleAction({ chatId: 'c', value: card.elements.at(-1).actions[0].value })).toast.content, /过期/);
}));

test('结束项目：停下卡上直接结束；文字“结束”先确认，可选继续做', () => fixture(async ({ flow, cards, messages, dir }) => {
  const local = createFlow({ root: dir, id: (() => { let n = 0; return () => `e${++n}`; })(), feishu: { sendText: async (_, text) => messages.push(text), sendCard: async (_, card) => { cards.push(card); return `m${cards.length}`; }, patchCard: async () => {} }, agent: async () => ({ ok: false, error: '模型暂不可用', stats: {} }) });
  await local.handleMessage({ chatId: 'x', text: '报名页', intent: 'demand' }); await local.waitForIdle('x');
  await local.handleAction({ chatId: 'x', value: stuckOf(cards).elements.at(-1).actions[1].value });
  assert.equal(await local.getProject('x'), null);
  assert.match(messages.at(-1), /已结束「报名页」，文件都保留着/);
  const state = await local.getState();
  assert.equal(state.projects[0].ended, true);
  assert.equal(state.projects[0].endedStage, 'clarifying');
  assert.equal(state.projects[0].stage, 'done');
  // 群里空出来了：新需求开新项目
  await local.handleMessage({ chatId: 'x', text: '读书会', intent: 'demand' }); await local.waitForIdle('x');
  assert.equal((await local.getProject('x')).demand, '读书会');
  await local.handleMessage({ chatId: 'x', text: '结束' });
  const confirm = cards.at(-1);
  assert.equal(confirm.header.title.content, 'AI 产品经理 · 结束这个项目？');
  // 有项目且出错时，文字“结束”同样先确认
  await local.handleAction({ chatId: 'x', value: confirm.elements.at(-1).actions[1].value });
  assert.match(messages.at(-1), /好的，继续做/);
  assert.equal((await local.getProject('x')).demand, '读书会');
  await local.handleMessage({ chatId: 'x', text: '结束' });
  await local.handleAction({ chatId: 'x', value: cards.at(-1).elements.at(-1).actions[0].value });
  assert.equal(await local.getProject('x'), null);
  assert.equal((await local.getState()).projects.filter(p => p.ended).length, 2);
  // 没有项目时说“结束”不会被当成需求
  await local.handleMessage({ chatId: 'x', text: '结束' });
  assert.equal(await local.getProject('x'), null);
  assert.match(messages.at(-1), /群里现在没有进行中的项目/);
}));

test('出错后点旧卡片：提示这一步停下了和怎么继续；超时给出分钟数', () => fixture(async ({ cards, messages, dir }) => {
  let n = 0;
  const local = createFlow({ root: dir, feishu: { sendText: async (_, text) => messages.push(text), sendCard: async (_, card) => { cards.push(card); return `m${cards.length}`; }, patchCard: async () => {} }, agent: async ({ projectDir, timeoutMs }) => {
    n += 1;
    if (n === 1) { assert.equal(timeoutMs, 10 * 60000); await put(projectDir, 'docs/questions.json', { round: 1, why: '确认', questions: [{ id: 'q', question: '选什么？', matters: '决定字段', options: ['一', '二'], recommended: 0, reason: '清楚' }] }); return okResult(''); }
    return { ok: false, timedOut: true, error: '超过 10 分钟没做完', stats: {} };
  } });
  await local.handleMessage({ chatId: 't', text: '报名页', intent: 'demand' }); await local.waitForIdle('t');
  const question = cards.at(-1);
  await local.handleAction({ chatId: 't', value: answer(question), formValue: { q: '0' } }); await local.waitForIdle('t');
  assert.equal((await local.getProject('t')).errorBrief, 'AI 产品经理这一步超过 10 分钟还没做完，已经停下');
  await local.handleAction({ chatId: 't', value: answer(question) });
  assert.match(messages.at(-1), /这张卡片已过期。这一步停下了：AI 产品经理这一步超过 10 分钟还没做完/);
  assert.match(messages.at(-1), /“重试”或“结束项目”/);
}));

test('验收时网页文件发不出去：说一句，项目照常完成', () => fixture(async ({ cards, messages, dir }) => {
  await put(dir, 'data/state.json', { groups: { a: { id: 'pa', chatId: 'a', name: '报名页', demand: '报名页', stage: 'accept', busy: false, error: null, questionRound: 1, walkthroughRound: 1, sessions: {}, cardId: 'ca', cardMessageId: 'm0', cardRole: 'designer' } }, archived: [] });
  const fresh = createFlow({ root: dir, feishu: { sendText: async (_, text) => messages.push(text), sendCard: async (_, card) => { cards.push(card); return `m${cards.length}`; }, patchCard: async () => {}, sendFile: async () => { throw new Error('上传网页文件超过 60 秒没完成'); } }, agent: async () => okResult('') });
  await fresh.handleAction({ chatId: 'a', value: { action: 'confirm', stage: 'accept', projectId: 'pa', cardId: 'ca' } }); await fresh.waitForIdle('a');
  assert.equal((await fresh.getProject('a')).stage, 'done');
  assert.match(messages.at(-1), /网页文件没能发到群里（上传网页文件超过 60 秒没完成）/);
}));

const buttons = card => card.elements.at(-1).actions;

test('群聊对话：“你好”只聊天不开项目；说清需求后提议开工，点了才开工', () => fixture(async ({ flow, cards, messages, calls, chats, patched }) => {
  await flow.handleMessage({ chatId: 'g', role: 'product', text: '你好' }); await flow.waitForIdle('g');
  assert.equal(await flow.getProject('g'), null);
  assert.equal(calls[0].mode, 'chat');
  assert.match(calls[0].projectDir, /data[\\/]chat-room$/);
  assert.match(calls[0].prompt, /- start：/);
  assert.equal(messages.at(-1), '你好，有想做的网页可以直接说。');
  chats.push({ reply: '读书会报名页可以做，要开始吗？', proposal: { action: 'start', detail: '做一个读书会报名页' } });
  await flow.handleMessage({ chatId: 'g', role: 'product', text: '想做个读书会报名页' }); await flow.waitForIdle('g');
  assert.equal(await flow.getProject('g'), null);
  const offer = cards.at(-1);
  assert.equal(offer.header.title.content, 'AI 产品经理 · 要开始做吗？');
  assert.deepEqual(buttons(offer).map(b => [b.text.content, b.value.action]), [['就按这个开始', 'start'], ['再聊聊', 'dismiss']]);
  await flow.handleAction({ chatId: 'g', value: buttons(offer)[0].value }); await flow.waitForIdle('g');
  const p = await flow.getProject('g');
  assert.equal(p.demand, '做一个读书会报名页');
  assert.equal(p.stage, 'clarifying');
  assert.equal(calls.at(-1).prompt, '用户的话：做一个读书会报名页');
  assert.match(patched.at(-1).card.elements[0].text.content, /点了“就按这个开始”：做一个读书会报名页/);
  assert.match((await flow.handleAction({ chatId: 'g', value: buttons(offer)[0].value })).toast.content, /过期/);
}));

test('群聊对话：关口上对负责角色提修改意见，点“按这个改”直接开始改', () => fixture(async ({ flow, cards, calls, chats, patched }) => {
  await flow.handleMessage({ chatId: 'g', text: '报名页', intent: 'demand' }); await flow.waitForIdle('g');
  for (let i = 0; i < 2; i++) { await flow.handleAction({ chatId: 'g', value: answer(cards[i]) }); await flow.waitForIdle('g'); }
  await flow.handleAction({ chatId: 'g', value: value(cards[2]) }); await flow.waitForIdle('g');
  const gate = structuredClone(await flow.getProject('g'));
  assert.equal(gate.stage, 'confirm_design');
  chats.push({ reply: '可以，主色改成绿色，其余不动。', proposal: { action: 'revise', detail: '主色换成绿色' } });
  await flow.handleMessage({ chatId: 'g', role: 'designer', text: '主色换成绿色吧' }); await flow.waitForIdle('g');
  assert.match(calls.at(-1).prompt, /- revise：/);
  assert.equal((await flow.getProject('g')).stage, 'confirm_design');
  const offer = cards.at(-1);
  assert.equal(offer.header.title.content, 'AI 设计 · 要按这个改吗？');
  assert.equal(offer.header.template, 'purple');
  await flow.handleAction({ chatId: 'g', value: buttons(offer)[0].value }); await flow.waitForIdle('g');
  assert.match(calls.at(-1).prompt, /^用户对设计的修改意见：主色换成绿色/);
  assert.ok(patched.some(x => x.messageId === gate.cardMessageId && /提了修改意见/.test(x.card.elements[0].text.content)));
  const after = await flow.getProject('g');
  assert.equal(after.stage, 'confirm_design');
  assert.notEqual(after.cardId, gate.cardId);
}));

test('群聊对话：提议不在允许范围只发回复；模型出错时代码兜底说下一步', () => fixture(async ({ flow, cards, messages, chats, dir }) => {
  chats.push({ reply: '可以做，找产品经理开个项目。', proposal: { action: 'start', detail: '报名页' } });
  await flow.handleMessage({ chatId: 'g', role: 'designer', text: '做个报名页' }); await flow.waitForIdle('g');
  assert.equal(cards.length, 0);
  assert.equal(messages.at(-1), '可以做，找产品经理开个项目。');
  const local = createFlow({ root: dir, feishu: { sendText: async (_, text) => messages.push(text), sendCard: async () => 'm', patchCard: async () => {} }, agent: async () => ({ ok: false, timedOut: true, error: '超过 1 分钟没做完', stats: {} }) });
  await local.handleMessage({ chatId: 'h', role: 'developer', text: '在吗' }); await local.waitForIdle('h');
  assert.equal(messages.at(-1), '刚才没想好怎么回答。想做新的网页，@AI 产品经理 说说你的想法。');
}));

test('群聊对话：澄清时文字回答可提交；新提议替换旧提议；“继续做”只收起；流程往前走了旧提议就过期', () => fixture(async ({ flow, cards, messages, calls, chats, patched }) => {
  await flow.handleMessage({ chatId: 'g', text: '报名页', intent: 'demand' }); await flow.waitForIdle('g');
  await flow.handleMessage({ chatId: 'g', role: 'product', text: '重试' });
  assert.match(messages.at(-1), /现在没有停下的步骤/);
  assert.deepEqual(await flow.handleMessage({ chatId: 'g', role: 'designer', text: '停止' }), { waiting: true });
  assert.match(messages.at(-1), /现在没有正在干活的同事/);
  chats.push({ reply: '收到。', proposal: { action: 'answer', detail: '需要电话' } }, { reply: '收到，按你说的提交。', proposal: { action: 'answer', detail: '不需要电话' } });
  await flow.handleMessage({ chatId: 'g', role: 'product', text: '要电话' });
  await flow.handleMessage({ chatId: 'g', role: 'product', text: '算了不要电话' }); await flow.waitForIdle('g');
  const [older, offer] = cards.slice(-2);
  assert.ok(patched.some(x => x.messageId === `m${cards.indexOf(older) + 1}` && /以最新那条为准/.test(x.card.elements[0].text.content)));
  assert.match((await flow.handleAction({ chatId: 'g', value: buttons(older)[0].value })).toast.content, /过期/);
  assert.equal(offer.header.title.content, 'AI 产品经理 · 把这段当回答提交？');
  await flow.handleAction({ chatId: 'g', value: buttons(offer)[0].value }); await flow.waitForIdle('g');
  assert.equal(calls.filter(x => !x.mode).at(-1).prompt, '用户的回答：不需要电话');
  assert.equal((await flow.getProject('g')).questionRound, 2);
  chats.push({ reply: '要结束吗？', proposal: { action: 'end', detail: '' } });
  await flow.handleMessage({ chatId: 'g', role: 'product', text: '不想做了' }); await flow.waitForIdle('g');
  assert.deepEqual(buttons(cards.at(-1)).map(b => [b.text.content, b.type]), [['结束项目', 'danger'], ['继续做', 'default']]);
  await flow.handleAction({ chatId: 'g', value: buttons(cards.at(-1))[1].value });
  assert.match(patched.at(-1).card.elements[0].text.content, /点了“继续做”/);
  assert.equal((await flow.getProject('g')).stage, 'clarifying');
  chats.push({ reply: '按推荐提交？', proposal: { action: 'answer', detail: '都按推荐' } });
  await flow.handleMessage({ chatId: 'g', role: 'product', text: '你看着办' }); await flow.waitForIdle('g');
  const late = cards.at(-1);
  await flow.handleAction({ chatId: 'g', value: answer(cards.findLast(card => card.schema === '2.0')) }); await flow.waitForIdle('g');
  assert.equal((await flow.getProject('g')).stage, 'confirm_prd');
  assert.match((await flow.handleAction({ chatId: 'g', value: buttons(late)[0].value })).toast.content, /过期/);
  assert.match(messages.at(-1), /这张卡片已过期，现在在「确认 PRD」/);
}));

test('干活时：“现在引导”插进这一步；进度卡“停下”和文字“停止”让它停下；“停下并结束”直接结束', () => fixture(async ({ dir }) => {
  const sent = [], patches = [], messages = [], steered = [];
  let running = null;
  const local = createFlow({ root: dir, id: (() => { let n = 0; return () => `s${++n}`; })(), feishu: { sendText: async (_, text) => messages.push(text), sendCard: async (_, card) => { sent.push(card); return `m${sent.length}`; }, patchCard: async (messageId, card) => { patches.push({ messageId, card }); } },
    agent: async ({ control, onProgress, mode }) => {
      if (mode === 'chat') return { ok: true, structured: { reply: '收到', proposal: { action: 'none', detail: '' } }, stats: {} };
      onProgress({ tool: 'Skill', file: 'team:clarify' });
      return new Promise(resolve => {
        control.steer = text => { steered.push(text); return true; };
        control.stop = () => resolve({ ok: false, stopped: true, error: '用户让它停下了', stats: { durationMs: 1000 } });
        running = resolve;
      });
    } });
  const started = async () => { while (!running) await new Promise(resolve => setTimeout(resolve, 2)); running = null; };
  const text = card => JSON.stringify(card);
  await local.handleMessage({ chatId: 'w', text: '报名页', intent: 'demand' }); await started();
  const progress = sent[0];
  assert.equal(progress.header.title.content, 'AI 产品经理 · 澄清需求');
  assert.match(text(progress), /读你的需求，看还要问什么/);
  assert.ok(patches.some(x => x.messageId === 'm1' && /🧰 在用「澄清」技能/.test(text(x.card))));
  assert.match((await local.getState()).projects[0].activity, /在用「澄清」技能/);
  // 对正在干活的产品经理说话：先记下，点“现在引导”插进这一步
  assert.equal((await local.handleMessage({ chatId: 'w', role: 'product', text: '加上电话字段' })).queued, true);
  const queuedCard = sent.at(-1);
  assert.equal(queuedCard.header.title.content, 'AI 产品经理 · 先记下了');
  assert.equal((await local.handleAction({ chatId: 'w', value: buttons(queuedCard)[0].value })).toast.content, '已插进这一步');
  assert.deepEqual(steered, ['加上电话字段']);
  assert.match(text(patches.at(-1).card), /↪ 已插进这一步：加上电话字段/);
  // 进度卡上的“停下”
  assert.equal((await local.handleAction({ chatId: 'w', value: buttons(progress)[0].value, actor: '小王' })).toast.content, '正在停下');
  await local.waitForIdle('w');
  let p = await local.getProject('w');
  assert.equal(p.errorBrief, '小王让 AI 产品经理停下了这一步');
  assert.equal(sent.at(-1).header.title.content, 'AI 产品经理 · 这一步停下了');
  const final = patches.filter(x => x.messageId === 'm1').at(-1).card;
  assert.equal(final.header.title.content, 'AI 产品经理 · 停下了');
  assert.match(text(final), /⏹ 已停下/);
  assert.match(text(final), /↪ 你的引导：加上电话字段/);
  // 文字“停止”
  await local.handleMessage({ chatId: 'w', role: 'product', text: '重试' }); await started();
  assert.deepEqual(await local.handleMessage({ chatId: 'w', role: 'designer', text: '停止' }), { stopping: true });
  await local.waitForIdle('w');
  assert.equal((await local.getProject('w')).errorBrief, '你让 AI 产品经理停下了这一步');
  // 干活中说“结束”：确认卡是“停下并结束”，点了不发停下卡，直接结束
  await local.handleMessage({ chatId: 'w', role: 'product', text: '重试' }); await started();
  await local.handleMessage({ chatId: 'w', role: 'product', text: '结束' });
  const confirm = sent.at(-1);
  assert.deepEqual(buttons(confirm).map(b => b.text.content), ['停下并结束', '继续做']);
  const stuckCards = sent.filter(card => card.header?.title?.content?.endsWith('这一步停下了')).length;
  assert.equal((await local.handleAction({ chatId: 'w', value: buttons(confirm)[0].value })).toast.content, '正在停下并结束');
  await local.waitForIdle('w');
  assert.equal(await local.getProject('w'), null);
  assert.equal(sent.filter(card => card.header?.title?.content?.endsWith('这一步停下了')).length, stuckCards);
  assert.match(messages.at(-1), /已结束「报名页」/);
}));

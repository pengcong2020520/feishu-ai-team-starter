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
  const feishu = { sendText: async (_, text) => messages.push(text), sendCard: async (_, card) => { if (card.header?.title?.content?.includes('澄清需求') && !card.schema || card.header?.title?.content?.includes('开发网页') || card.header?.title?.content?.includes('画线框与主题') || card.header?.title?.content?.includes('走查网页') || card.header?.title?.content?.includes('修改') || card.header?.title?.content === 'AI 程序员 · 网页已完成') return 'progress'; cards.push(card); return `m${cards.length}`; }, patchCard: async (messageId, card) => { if (messageId !== 'progress') patched.push({ messageId, card }); } };
  const agent = agentOverride ?? (async ({ role, prompt, projectDir, resume, onProgress }) => {
    assert.equal(typeof onProgress, 'function');
    onProgress({ tool: 'Write', file: 'docs/prd.md' });
    await deliver(projectDir, role, prompt, calls);
    calls.at(-1).resume = resume;
    return { ok: true, text: '已完成', sessionId: `${role}-${calls.length}`, stats: { turns: 1, durationMs: 1, inputTokens: 2, outputTokens: 3 } };
  });
  const flow = createFlow({ root: dir, agent, feishu, id: (() => { let n = 0; return () => `id${++n}`; })() });
  try { await fn({ flow, cards, messages, patched, calls, dir }); }
  finally { await rm(dir, { recursive: true, force: true }); }
}
const value = card => card.elements.at(-1).actions[0].value;
const reject = card => card.elements.at(-1).actions[1].value;
const answer = card => card.body.elements[0].elements.at(-1).behaviors[0].value;

test('完整流程：两轮澄清、自动走查、验收与持久化', () => fixture(async ({ flow, cards, patched, calls, dir }) => {
  await flow.handleMessage({ chatId: 'group', text: '做报名页' });
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
  await flow.handleMessage({ chatId: 'group', text: '再做一个报名页' });
  await flow.waitForIdle('group');
  const state = await flow.getState();
  assert.equal(state.projects.length, 2);
  assert.equal(state.projects[0].stage, 'done');
  assert.equal(state.projects[1].stage, 'confirm_prd');
  assert.deepEqual(state.projects[1].steps.map(step => step.name), ['澄清与 PRD', '线框与主题', '开发', '走查', '验收']);
  assert.deepEqual(state.projects[1].steps.map(step => step.status), ['等你操作', '未开始', '未开始', '未开始', '未开始']);
}));

test('三个打回分支与回归走查，旧卡片过期', () => fixture(async ({ flow, cards, calls, messages }) => {
  await flow.handleMessage({ chatId: 'g', text: '报名页' }); await flow.waitForIdle('g');
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

test('忙时回复；交付文件错误后停住且可重试', () => fixture(async ({ flow, messages, dir }) => {
  let release;
  let count = 0;
  const gate = new Promise(resolve => { release = resolve; });
  // 本用例用单独的编排来制造未完成的智能体调用。
  const local = createFlow({ root: dir, feishu: { sendText: async (_, text) => messages.push(text), sendCard: async () => 'm', patchCard: async () => {} },
    agent: async ({ projectDir }) => {
      count++;
      if (count === 1) await gate;
      if (count > 1) await put(projectDir, 'docs/questions.json', { round: 1, why: '确认', questions: [{ id: 'q', question: '选什么？', matters: '决定字段', options: ['一', '二'], recommended: 0, reason: '清楚' }] });
      return { ok: true, text: '', sessionId: 's', stats: { turns: 1, durationMs: 1, inputTokens: 0, outputTokens: 0 } };
    } });
  await local.handleMessage({ chatId: 'busy', text: '报名页' });
  assert.equal((await local.handleMessage({ chatId: 'busy', text: '又发一次' })).busy, true);
  assert.match(messages.at(-1), /正在处理上一步/);
  release(); await local.waitForIdle('busy');
  assert.equal((await local.getProject('busy')).stage, 'clarifying');
  assert.match(messages.at(-1), /questions.json/);
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
  await flow.handleMessage({ chatId: 'web:local', text: '做一个网页' });
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
  await local.handleMessage({ chatId: 'card', text: '报名页' }); await local.waitForIdle('card');
  assert.match(messages.at(-1), /code 123，msg 卡片格式错误/);
  await local.handleMessage({ chatId: 'card', role: 'product', text: '重试' }); await local.waitForIdle('card');
  assert.equal(agentCalls, 1);
  assert.equal(cardCalls, 2);
  assert.equal((await local.getProject('card')).error, null);
}));

test('智能体报错不自动重试，机器人消息不触发任务', () => fixture(async ({ flow, messages }) => {
  assert.deepEqual(await flow.handleMessage({ chatId: 'g', text: '机器人消息', senderType: 'bot' }), { ignored: true });
  await flow.handleMessage({ chatId: 'g', text: '报名页' }); await flow.waitForIdle('g');
  assert.equal((await flow.getProject('g')).stage, 'clarifying');
  assert.match(messages.at(-1), /重试/);
  assert.match(messages.at(-1), /AI 产品经理执行失败/);
}, async () => ({ ok: false, text: '', sessionId: null, error: '模型暂不可用', stats: { turns: 0, durationMs: 1, inputTokens: 0, outputTokens: 0 } })));

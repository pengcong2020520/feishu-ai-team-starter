import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSteward, stewardActivity, stewardPermission } from '../src/admin/steward.mjs';
import { buildTools, statusText } from '../src/admin/tools.mjs';
import { createAssistant } from '../src/admin/assistant.mjs';

const flush = (ms = 30) => new Promise(resolve => setTimeout(resolve, ms));
const MODEL = { MODEL_BASE_URL: 'https://m.test', MODEL_API_KEY: 'sk-test', MODEL_NAME: 'm1' };
function root() {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'steward-')));
  for (const file of ['src/flow/cards.mjs', 'prompts/designer.md', '.env', 'data/service.log', '.admin-work/prompts/designer.md', '.admin-work/src/admin/main.mjs']) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), 'x');
  }
  mkdirSync(path.join(dir, 'src/admin'), { recursive: true });
  copyFileSync('src/admin/prompt.md', path.join(dir, 'src/admin/prompt.md'));
  return dir;
}

test('管家的权限：整个仓库能看（密钥除外），只能改工作副本里允许改的地方，没有命令行', async () => {
  const dir = root();
  const allow = async (tool, input) => (await stewardPermission(dir, tool, input)).behavior;
  assert.equal(await allow('Read', { file_path: 'src/flow/cards.mjs' }), 'allow');
  assert.equal(await allow('Read', { file_path: path.join(dir, 'data/service.log') }), 'allow');
  assert.equal(await allow('Read', { file_path: '.env' }), 'deny');
  assert.equal(await allow('Read', { file_path: '.admin-work/.env.local' }), 'deny');
  assert.equal(await allow('Read', { file_path: '../etc/passwd' }), 'deny');
  assert.equal(await allow('Glob', { pattern: '**/.env*' }), 'deny');
  assert.equal(await allow('Glob', { pattern: 'src/**/*.mjs' }), 'allow');
  assert.equal(await allow('Grep', { pattern: 'KEY' }), 'deny');
  assert.equal(await allow('Grep', { pattern: 'KEY', path: 'src' }), 'allow');
  assert.equal(await allow('Grep', { pattern: 'KEY', path: 'src', glob: '.env' }), 'deny');
  assert.equal(await allow('Edit', { file_path: 'prompts/designer.md' }), 'deny');
  assert.equal(await allow('Edit', { file_path: '.admin-work/prompts/designer.md' }), 'allow');
  assert.equal(await allow('Write', { file_path: '.admin-work/src/admin/main.mjs' }), 'deny');
  assert.equal(await allow('Write', { file_path: '.admin-work/.git/config' }), 'deny');
  assert.equal(await allow('Write', { file_path: '.admin-work/package.json' }), 'deny');
  assert.equal(await allow('Bash', { command: 'ls' }), 'deny');
  assert.equal(await allow('mcp__admin__submit_change', {}), 'allow');
  assert.equal(stewardActivity({ tool: 'Edit', input: { file_path: path.join(dir, '.admin-work/prompts/designer.md') } }, dir), '✏️ 在改 prompts/designer.md');
});

// 假的 query：记下 options，按脚本吐消息；能读插话、能被打断
function fakeQuery(script) {
  const calls = [];
  const impl = ({ prompt, options }) => {
    const call = { options, inputs: [] };
    calls.push(call);
    const iterator = prompt[Symbol.asyncIterator]();
    let interrupted = false;
    async function* run() {
      call.inputs.push((await iterator.next()).value);
      yield* script({ call, next: async () => { const r = await iterator.next(); if (!r.done) call.inputs.push(r.value); return r.value; }, interrupted: () => interrupted });
    }
    const gen = run();
    gen.interrupt = async () => { interrupted = true; };
    return gen;
  };
  return { impl, calls };
}
const ok = (session, text) => ({ type: 'result', subtype: 'success', is_error: false, result: text, session_id: session, num_turns: 2, duration_ms: 1000, usage: { input_tokens: 100, output_tokens: 20 } });

test('管家只有一个会话：第一次记下会话号，之后接着用；工具调用报进度；环境里没有飞书密钥', async () => {
  const dir = root();
  Object.assign(process.env, MODEL, { FEISHU_PRODUCT_APP_SECRET: 'feishu-secret' });
  const { impl, calls } = fakeQuery(async function* () {
    yield { type: 'system', session_id: 's1' };
    yield { type: 'assistant', session_id: 's1', message: { content: [{ type: 'tool_use', name: 'mcp__admin__team_status', input: {} }] } };
    yield ok('s1', '团队一切正常');
  });
  const servers = [];
  const steward = createSteward({ root: dir, tools: [{ name: 't' }], queryImpl: impl, createServer: options => { servers.push(options); return { type: 'sdk', name: 'admin' }; } });
  const events = [];
  const r = await steward.run({ prompt: '管理员说：现在怎么样', onProgress: e => events.push(e) });
  assert.deepEqual([r.ok, r.text], [true, '团队一切正常']);
  assert.equal(events[0].tool, 'mcp__admin__team_status');
  const o = calls[0].options;
  assert.equal(o.resume, undefined);
  assert.deepEqual(o.tools, ['Read', 'Glob', 'Grep', 'Write', 'Edit']);
  assert.deepEqual(o.settingSources, []);
  assert.equal(o.cwd, dir);
  assert.match(o.systemPrompt.prompt, /管家/);
  assert.equal(servers[0].alwaysLoad, true);
  assert.deepEqual(Object.keys(o.env).sort(), ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_DEFAULT_HAIKU_MODEL', 'CLAUDE_CONFIG_DIR', 'HOME', 'PATH']);
  assert.doesNotMatch(JSON.stringify(o.env), /feishu-secret/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'data/admin/session.json'), 'utf8')).sessionId, 's1');
  await steward.run({ prompt: '管理员说：再看看' });
  assert.equal(calls[1].options.resume, 's1');
  delete process.env.FEISHU_PRODUCT_APP_SECRET;
});

test('管家干活时：管理员插话进当前这一步，以最后一个结果为准；说停下就停', async () => {
  const dir = root();
  Object.assign(process.env, MODEL);
  const steer = fakeQuery(async function* ({ next }) {
    const guide = await next();
    yield ok('s2', `收到：${guide.message.content}`);
  });
  const control = {};
  const running = createSteward({ root: dir, queryImpl: steer.impl, createServer: () => ({}) }).run({ prompt: '改设计说明', control });
  await flush();
  assert.equal(control.steer('只改配色'), true);
  const r = await running;
  assert.equal(r.text, '收到：管理员在你干活时插话：只改配色');
  assert.equal(steer.calls[0].inputs[1].priority, 'now');
  assert.equal(control.steer('晚了'), false);

  const stop = fakeQuery(async function* ({ interrupted }) {
    while (!interrupted()) await flush(10);
    yield { type: 'result', subtype: 'error_during_execution', is_error: true, session_id: 's3' };
  });
  const c2 = {};
  const p2 = createSteward({ root: dir, queryImpl: stop.impl, createServer: () => ({}) }).run({ prompt: '慢活', control: c2 });
  await flush();
  await c2.stop();
  const r2 = await p2;
  assert.deepEqual([r2.ok, r2.stopped], [false, true]);
});

const SNAP = { projects: [
  { id: 'p3', number: 3, name: '番茄钟', stage: 'confirm_design', waitingFor: '确认设计', cardId: 'c-gate', chatId: 'oc_1', busy: false, source: '飞书群项目' },
  { id: 'p4', number: 4, name: '读书笔记', stage: 'building', busy: true, activeRole: 'developer', activity: '✍️ 在写网页', chatId: 'oc_2', source: '飞书群项目' },
  { id: 'p1', number: 1, name: '旧项目', stage: 'done', ended: true },
] };
function toolRig() {
  const calls = { message: [], action: [], agent: [], submit: [] };
  const workbench = { state: async () => SNAP, message: async m => { calls.message.push(m); return { chatting: true }; }, action: async a => { calls.action.push(a); return { toast: { content: '已收到操作' } }; } };
  const changes = { state: () => ({ pending: null, history: [{ sha: 'abcdef1234', title: '设计偏好深色', level: 'text' }] }) };
  const deploy = { submit: async a => { calls.submit.push(a); return '已发签字卡'; }, restart: async () => ({ ok: false, error: '#4 读书笔记 正在干活' }), revert: async () => ({ ok: true, text: '已回退' }) };
  const runAgent = async args => { calls.agent.push(args); return { ok: true, structured: { reply: '线框按 PRD 画了 4 屏' } }; };
  const supervisor = { status: () => ({ running: true, healthy: true, startedAt: new Date().toISOString() }) };
  const tools = Object.fromEntries(buildTools({ supervisor, workbench, changes, deploy, runAgent, root: '/repo' }).map(t => [t.name, t]));
  return { tools, calls };
}
const out = r => r.content[0].text;

test('管家的工具：看现状、问同事（只读）、代你说话、只在关口代点按钮、交改动、重启和回退', async () => {
  const { tools, calls } = toolRig();
  assert.deepEqual(Object.keys(tools), ['team_status', 'ask_colleague', 'tell_colleague', 'press_button', 'submit_change', 'restart_team', 'revert_change']);
  const status = out(await tools.team_status.handler({}));
  assert.match(status, /#3「番茄钟」 阶段「确认设计」，等管理员确认设计；工作区 workspace\/p3\//);
  assert.match(status, /#4「读书笔记」 阶段「开发网页」，AI 程序员在干活：✍️ 在写网页/);
  assert.match(status, /abcdef1 设计偏好深色（文字类）/);
  assert.equal(out(await tools.ask_colleague.handler({ role: 'designer', project: 3, question: '线框几屏？' })), 'AI 设计说：线框按 PRD 画了 4 屏');
  assert.deepEqual([calls.agent[0].mode, calls.agent[0].projectDir], ['chat', '/repo/workspace/p3']);
  assert.match(out(await tools.tell_colleague.handler({ role: 'designer', project: 3, text: '主色换成绿色' })), /已代管理员对AI 设计说/);
  assert.deepEqual(calls.message[0], { chatId: 'oc_1', role: 'designer', text: '主色换成绿色', via: 'admin' });
  const refused = await tools.press_button.handler({ project: 4, action: 'confirm', admin_words: '确认' });
  assert.equal(refused.isError, true);
  assert.match(out(await tools.press_button.handler({ project: 3, action: 'confirm', admin_words: '设计没问题，确认' })), /在「确认设计」点了“确认”/);
  assert.deepEqual(calls.action[0], { chatId: 'oc_1', role: 'designer', value: { action: 'confirm', stage: 'confirm_design', projectId: 'p3', cardId: 'c-gate' }, via: 'admin' });
  assert.equal(out(await tools.submit_change.handler({ title: '改', why: '要' })), '已发签字卡');
  assert.equal((await tools.restart_team.handler({ reason: '试试' })).isError, true);
  assert.equal(out(await tools.revert_change.handler({})), '已回退');
  assert.equal((await tools.ask_colleague.handler({ role: 'designer', project: 9, question: '?' })).isError, true);
  assert.match(statusText({ service: { running: false, healthy: false }, snapshot: null, changes: { state: () => ({ history: [] }) } }), /读不到项目/);
});

function assistantRig({ run } = {}) {
  const dir = root();
  const sent = [];
  const patched = [];
  const prompts = [];
  const controls = [];
  const bot = { sendCard: async card => { sent.push(card); return `om_${sent.length}`; }, sendText: async t => { sent.push(t); return `om_${sent.length}`; }, patchCard: async (id, card) => { patched.push({ id, card }); } };
  const steward = { run: run ?? (async ({ prompt, onProgress, control }) => { prompts.push(prompt); controls.push(control); onProgress({ tool: 'Read', input: { file_path: 'data/service.log' } }); return { ok: true, text: '查好了', stats: { durationMs: 3000, inputTokens: 12000, outputTokens: 800 } }; }) };
  const signs = [];
  const reverts = [];
  const deploy = { onSign: async v => { signs.push(v); return '正在跑测试'; }, revert: async v => { reverts.push(v); return { ok: true, text: '已回退「改卡片」' }; }, tick: async () => {} };
  const supervisor = { status: () => ({ running: true, healthy: true }) };
  const workbench = { state: async () => ({ projects: [{ id: 'p3', number: 3, name: '番茄钟', stage: 'building', waitingFor: '重试', error: '超时', errorBrief: '超时', retryRole: 'developer', chatId: 'oc', busy: false }] }) };
  const assistant = createAssistant({ root: dir, bot, supervisor, workbench, steward, deploy, changes: { lastChange: () => null }, logger: { error() {} } });
  return { assistant, sent, patched, prompts, controls, signs, reverts };
}

test('私聊其他话交给管家：发进度卡，做完改成结果；签字和撤销按钮交给上线流程', async () => {
  const r = assistantRig();
  await r.assistant.onMessage({ text: '#3 为什么停了？' });
  assert.equal(r.prompts[0], '管理员说：#3 为什么停了？');
  assert.match(JSON.stringify(r.sent[0]), /AI 管理员助手 · 在处理[\s\S]*#3 为什么停了？[\s\S]*停下/);
  const final = JSON.stringify(r.patched.at(-1).card);
  assert.match(final, /AI 管理员助手 · 完成[\s\S]*查好了[\s\S]*读入 1\.2 万 \/ 写出 800 token/);
  assert.equal((await r.assistant.onAction({ value: { action: 'golive', cardId: 'k', sha: 'abc' }, messageId: 'om_9' })).toast.content, '正在跑测试');
  assert.deepEqual(r.signs[0], { action: 'golive', cardId: 'k', sha: 'abc', messageId: 'om_9' });
  assert.equal((await r.assistant.onAction({ value: { action: 'revert', cardId: 'k2', sha: 'abc' }, messageId: 'om_8' })).toast.content, '正在回退');
  await flush();
  assert.deepEqual(r.reverts[0], { sha: 'abc' });
  assert.match(JSON.stringify(r.patched.at(-1).card), /已回退「改卡片」/);
});

test('管家在忙：管理员的话插进这一步，“停下”让它停；停下卡上“看看原因”交给管家只查不改', async () => {
  let release;
  const r = assistantRig({ run: async ({ prompt, control }) => {
    const guides = [];
    control.steer = text => { guides.push(text); return true; };
    control.stop = async () => release({ ok: false, stopped: true, stats: null });
    return new Promise(resolve => { release = value => resolve({ ...value, text: guides.join('|') }); });
  } });
  void r.assistant.onMessage({ text: '把设计说明改成偏好深色' });
  await flush();
  await r.assistant.onMessage({ text: '只改配色那段' });
  await flush(2100);
  assert.match(JSON.stringify(r.patched.at(-1).card), /↪ 你插话：只改配色那段/);
  await r.assistant.onMessage({ text: '停下' });
  await flush();
  assert.match(JSON.stringify(r.patched.at(-1).card), /AI 管理员助手 · 停下了[\s\S]*⏹ 已停下/);

  const d = assistantRig();
  await d.assistant.tick();
  const stuck = d.sent.find(card => /有项目停下了/.test(JSON.stringify(card)));
  const value = stuck.elements.at(-1).actions.find(a => a.text.content === '看看原因').value;
  assert.equal((await d.assistant.onAction({ value, messageId: 'om_1' })).toast.content, '正在查原因');
  assert.equal((await d.assistant.onAction({ value, messageId: 'om_1' })).toast.content, '已经在查了');
  await flush();
  assert.match(d.prompts[0], /#3 番茄钟」为什么在「开发网页」停下了[\s\S]*data\/service\.log[\s\S]*只查不改/);
});

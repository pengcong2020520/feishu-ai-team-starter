import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRecorder, cardView } from '../src/workbench/recorder.mjs';
import { questionCard, gateCard } from '../src/flow/cards.mjs';
import { startPreview } from '../src/preview.mjs';

const here = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
test('消息记录保留卡片、更新版本和角色筛选', async () => {
  const root = await mkdtemp(path.join(here, 'test-workbench-'));
  try {
    const recorder = createRecorder(root);
    const question = questionCard({ projectId: 'test', cardId: 'test', questions: { why: '确认字段', questions: [{ id: 'q', question: '选哪个？', matters: '影响页面', options: ['一', '二'], recommended: 1 }] } });
    const view = cardView(question);
    assert.equal(view.questions[0].recommended, 1);
    assert.equal(view.buttons[0].value.projectId, 'test');
    await recorder.add('group', { kind: 'card', role: 'product', messageId: 'm1', card: view });
    await recorder.add('group', { kind: 'card_update', role: 'product', messageId: 'm1', card: cardView(gateCard({ stage: 'confirm_prd', projectId: 'p', cardId: 'c', title: '确认 PRD' })) });
    await recorder.add('group', { kind: 'user', role: 'designer', text: '改布局' });
    assert.deepEqual((await recorder.list('group')).map(x => x.kind), ['card', 'card_update', 'user']);
    assert.equal((await recorder.list('group', { role: 'product' })).length, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('旧格式消息记录仍能逐条读取', async () => {
  const root = await mkdtemp(path.join(here, 'test-workbench-'));
  try {
    const recorder = createRecorder(root);
    await recorder.add('旧群', { kind: 'user', role: 'product', text: '做一个报名页' });
    await recorder.add('旧群', { kind: 'card', role: 'product', title: 'AI 产品经理 · 确认 PRD' });
    await recorder.add('旧群', { kind: 'action', role: 'product', action: 'confirm' });
    const rows = await recorder.list('旧群');
    assert.deepEqual(rows.map(row => row.kind), ['user', 'card', 'action']);
    assert.equal(rows[1].title, 'AI 产品经理 · 确认 PRD');
    assert.equal(rows[1].card, undefined);
    assert.equal(rows[2].action, 'confirm');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('工作台读取接口、安全约束和写接口共用编排入口', async () => {
  const root = await mkdtemp(path.join(here, 'test-workbench-'));
  const project = { id: 'demo', chatId: 'group', stage: 'confirm_prd' };
  await mkdir(path.join(root, 'workspace/demo/docs'), { recursive: true });
  await writeFile(path.join(root, 'workspace/demo/docs/prd.md'), '# 演示');
  const calls = [];
  const flow = { getState: async () => ({ groups: { group: project } }), getProject: async () => project, handleMessage: async input => { calls.push(input); return { ok: true }; }, handleAction: async input => { calls.push(input); return { toast: { content: '完成' } }; } };
  const feishu = { listChats: async () => [{ chat_id: 'group', name: '演示' }], sendText: async () => {} };
  const recorder = createRecorder(root);
  let server;
  try {
    server = await startPreview({ root, assetsRoot: here, modelPort: 0, workbenchPort: 0, flow, feishu, recorder });
    const base = `http://127.0.0.1:${server.workbenchPort}`;
    const state = await fetch(base + '/api/state'); assert.equal(state.status, 200); assert.equal(state.headers.get('x-content-type-options'), 'nosniff');
    const presentation = await fetch(base + '/presentation.mjs'); assert.equal(presentation.status, 200); assert.match(presentation.headers.get('content-type'), /javascript/);
    assert.equal((await fetch(base + '/api/prd?chatId=group').then(r => r.text())), '# 演示');
    assert.equal((await fetch(base + '/api/role?role=designer').then(r => r.json())).skills.length, 4);
    const write = (headers, data) => fetch(base + '/api/message', { method: 'POST', headers, body: JSON.stringify(data) });
    assert.equal((await write({ 'Content-Type': 'application/json', 'Origin': 'http://evil.example' }, { chatId: 'group', role: 'designer', text: '你好' })).status, 403);
    assert.equal((await write({ 'Content-Type': 'application/json' }, { chatId: 'group', role: 'designer', text: '你好' })).status, 415);
    assert.equal((await write({ 'Content-Type': 'application/json', 'X-Workbench': '1' }, { chatId: 'group', role: 'designer', text: '你好' })).status, 200);
    assert.equal(calls[0].role, 'designer');
    assert.equal(calls[0].user, '你（工作台）');
  } finally { if (server) await server.close(); await rm(root, { recursive: true, force: true }); }
});

test('提需求按最近群状态分流：空闲进飞书，忙时进 web 会话', async () => {
  const root = await mkdtemp(path.join(here, 'test-workbench-'));
  const calls = [], sent = [];
  const state = { groups: { group: { chatId: 'group', stage: 'done' } }, projects: [{ id: 'old', chatId: 'group', createdAt: '2026-01-01T00:00:00.000Z' }] };
  const flow = { getState: async () => state, handleMessage: async input => { calls.push(input); return { projectId: `p${calls.length}` }; } };
  const feishu = { sendText: async (...args) => sent.push(args), listChats: async () => [{ chat_id: 'group' }] };
  const recorder = createRecorder(root);
  let server;
  try {
    server = await startPreview({ root, assetsRoot: here, modelPort: 0, workbenchPort: 0, flow, feishu, recorder });
    const endpoint = `http://127.0.0.1:${server.workbenchPort}/api/demand`;
    const demand = text => fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: JSON.stringify({ text }) }).then(r => r.json());
    const first = await demand('做报名页');
    assert.equal(first.chatId, 'group');
    assert.match(sent[0][1], /^来自工作台的需求：/);
    state.groups.group.stage = 'clarifying';
    const second = await demand('再做一个页');
    assert.match(second.chatId, /^web:/);
    assert.equal(sent.length, 1);
    assert.equal((await recorder.list(second.chatId))[0].kind, 'user');
  } finally { if (server) await server.close(); await rm(root, { recursive: true, force: true }); }
});

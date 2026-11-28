import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedActions, checkProposal, chatPrompt, tidy } from '../src/flow/chat.mjs';

test('能提的动作由代码按现状和角色算好', () => {
  assert.deepEqual(allowedActions(null, 'product'), ['start']);
  assert.deepEqual(allowedActions(null, 'designer'), []);
  assert.deepEqual(allowedActions({ stage: 'done' }, 'product'), ['start']);
  assert.deepEqual(allowedActions({ stage: 'clarifying', cardId: 'c' }, 'product'), ['answer', 'end']);
  assert.deepEqual(allowedActions({ stage: 'clarifying', cardId: null }, 'product'), ['end']);
  assert.deepEqual(allowedActions({ stage: 'confirm_prd' }, 'product'), ['revise', 'end']);
  assert.deepEqual(allowedActions({ stage: 'confirm_design' }, 'designer'), ['revise']);
  assert.deepEqual(allowedActions({ stage: 'confirm_design' }, 'developer'), []);
  assert.deepEqual(allowedActions({ stage: 'accept' }, 'developer'), ['revise']);
  assert.deepEqual(allowedActions({ stage: 'building', busy: true }, 'product'), []);
  assert.deepEqual(allowedActions({ stage: 'building', error: 'x' }, 'developer'), ['retry']);
  assert.deepEqual(allowedActions({ stage: 'building', error: 'x' }, 'product'), ['end']);
});

test('提议要在允许范围内，开工、修改、回答必须写内容', () => {
  assert.equal(checkProposal({ action: 'start', detail: '读书会报名页' }, ['start']).detail, '读书会报名页');
  assert.equal(checkProposal({ action: 'start', detail: '  ' }, ['start']), null);
  assert.equal(checkProposal({ action: 'revise', detail: '主色换绿' }, ['start']), null);
  assert.equal(checkProposal({ action: 'none', detail: '' }, ['start']), null);
  assert.deepEqual(checkProposal({ action: 'retry' }, ['retry']), { action: 'retry', detail: '' });
  assert.equal(checkProposal(undefined, ['start']), null);
});

test('对话任务消息带上现状、最近消息、这句话和能提的动作', () => {
  const prompt = chatPrompt({ p: { name: '报名页', stage: 'confirm_design' }, role: 'designer', text: '主色换成绿色', files: ['docs/prd.md', 'design/wireframe.html'],
    recent: [{ kind: 'user', text: '做报名页' }, { kind: 'card', role: 'designer', card: { title: 'AI 设计 · 确认设计' } }] });
  assert.match(prompt, /项目：「报名页」，现在在「确认设计」/);
  assert.match(prompt, /已有产物：PRD（docs\/prd\.md）、线框（design\/wireframe\.html）/);
  assert.match(prompt, /用户：做报名页\nAI 设计：\[卡片\] AI 设计 · 确认设计/);
  assert.match(prompt, /用户这次对你说：主色换成绿色/);
  assert.match(prompt, /- revise：/);
  assert.doesNotMatch(prompt, /- start：/);
  assert.match(chatPrompt({ p: null, role: 'product', text: '你好' }), /群里现在没有进行中的项目/);
  assert.equal(tidy('**好的** `代码`'), '**好的** `代码`');
});

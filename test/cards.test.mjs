import test from 'node:test';
import assert from 'node:assert/strict';
import { gateCard, questionCard, progressCard, resultCard } from '../src/flow/cards.mjs';

test('角色颜色、进度最近十二行和完成标题', () => {
  const card = progressCard({ title: 'AI 设计 · 画线框与主题', task: '绘制线框', lines: Array.from({ length: 15 }, (_, i) => `📖 读 docs/${i}.md`), stats: { durationMs: 48000, inputTokens: 120, outputTokens: 30 }, done: true });
  assert.equal(card.header.template, 'purple');
  assert.equal(card.header.title.content, 'AI 设计 · 完成');
  assert.match(card.elements[1].text.content, /前面还有 3 步/);
  assert.equal(card.elements.length, 15);
  assert.match(card.elements.at(-1).text.content, /已用 48 秒/);
});

test('结果卡把截图放在链接前，失败时保留链接', () => {
  const card = gateCard({ stage: 'confirm_design', projectId: 'p', cardId: 'c', title: 'AI 设计 · 确认设计', description: '**已完成**', points: ['主题：现代'], imageKey: 'img-key', links: [{ label: '打开线框', url: 'http://127.0.0.1:4871/p/p/wireframe' }] });
  assert.equal(card.header.template, 'purple');
  assert.equal(card.elements[1].tag, 'hr');
  assert.equal(card.elements[0].text.content, '已完成');
  assert.ok(card.elements.findIndex(x => x.tag === 'img') < card.elements.findIndex(x => x.tag === 'action'));
  const failed = resultCard({ role: 'developer', title: 'AI 程序员 · 网页已完成', imageError: 'Chrome 不可用', links: [{ label: '打开网页', url: 'http://127.0.0.1:4871/p/p/site' }] });
  assert.equal(failed.header.template, 'green');
  assert.match(failed.elements.find(x => x.text?.content?.includes('一览图未生成')).text.content, /Chrome 不可用/);
  assert.equal(failed.elements.find(x => x.tag === 'action').actions[0].url.includes('/site'), true);
});

test('问题卡显示蓝色标题、影响说明与推荐项提示', () => {
  const card = questionCard({ projectId: 'p', cardId: 'c', questions: { round: 1, why: '确认需求', questions: [{ id: 'q', question: '是否登录？', matters: '影响页面状态', options: ['需要', '不用'], recommended: 1 }] } });
  assert.equal(card.header.template, 'blue');
  assert.equal(card.header.title.content, 'AI 产品经理 · 有几个问题');
  assert.match(JSON.stringify(card), /影响页面状态/);
  assert.match(JSON.stringify(card), /直接提交就是全部按推荐/);
});

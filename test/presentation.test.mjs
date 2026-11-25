import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { glyph, stageNames, columns, stepDefs, stageIndex, timeSince, waitSince, flowStatus, artifactStep, defaultRoleProject, roleProjectHint, roleTimeline, messageView, originalDemand, latestCards } from '../web/presentation.mjs';

test('工作台阶段与五步流程使用同一列名，验收由人负责', () => {
  assert.deepEqual(stepDefs.map(step => step.name), columns.slice(0, 5).map(column => column[0]));
  assert.equal(stageIndex('confirm_prd'), 0);
  assert.equal(stageIndex('walkthrough'), 3);
  assert.equal(stageIndex('accept'), 4);
  assert.equal(stepDefs[4].role, 'user');
  assert.equal(stageNames.designing, '设计中');
  assert.equal(stageNames.building, '开发中');
  assert.equal(stageNames.walkthrough, '走查中');
  assert.equal(stageNames.accept, '待验收');
  assert.deepEqual(glyph, { product: '产', designer: '设', developer: '程', user: '你' });
  assert.equal(flowStatus({ stage: 'accept', waitingFor: '验收' }, 4), '等你验收');
  assert.equal(flowStatus({ stage: 'accept', waitingFor: '验收' }, 3), '完成');
});

test('刚刚与等待分钟数的边界', () => {
  const now = Date.parse('2026-11-23T10:00:00Z');
  assert.equal(timeSince(new Date(now - 59000).toISOString(), now), '刚刚');
  assert.equal(timeSince(new Date(now - 60000).toISOString(), now), '1 分钟前');
  assert.equal(waitSince(new Date(now - 59000).toISOString(), now), '刚刚');
  assert.equal(waitSince(new Date(now - 180000).toISOString(), now), '已等 3 分钟');
});

test('头像、等人标签与列数量采用新版样式', async () => {
  const [html, css, app] = await Promise.all(['index.html', 'app.css', 'app.js'].map(name => readFile(new URL(`../web/${name}`, import.meta.url), 'utf8')));
  assert.doesNotMatch(html, /brand-icon|✦/);
  for (const color of ['#3B82F6', '#A86BF7', '#2FBF71', '#F5B82E']) assert.ok(css.includes(color));
  assert.match(css, /\.avatar\.user\{background:#F5B82E\}/);
  assert.match(css, /\.card-status\.wait\{color:#241b0a;background:#F5B82E/);
  assert.match(css, /\.column-head\{[^}]*justify-content:flex-start;gap:6px/);
  assert.match(app, /head\.append\(el\('span',title\),el\('span',String\(items\.length\),'column-count'\)\)/);
  assert.match(app, /\$\('#page-subtitle'\)\.textContent=p\?`\$\{stageNames\[p\.stage\]\} · \$\{p\.source\}`/);
});

test('详情页产物按流程挂载，预览 iframe 铺满中栏', async () => {
  assert.deepEqual(artifactStep, { prd: 0, wireframe: 1, site: 2, walkthrough: 3 });
  const [css, app] = await Promise.all(['app.css', 'app.js'].map(name => readFile(new URL(`../web/${name}`, import.meta.url), 'utf8')));
  assert.match(app, /if\(artifactStep\[key\]!==i\)continue/);
  assert.match(css, /#artifact-content\{[^}]*padding:0\}/);
  assert.match(css, /#artifact-content iframe\{[^}]*width:100%;height:100%;border:0;[^}]*border-radius:0\}/);
});

test('角色聊天汇总所有项目并在切换项目处插分隔条', () => {
  const first = { kind: 'text', at: '2026-01-01T10:00:00Z', projectId: 'a', projectNumber: 1, projectName: '第一个', text: '一' };
  const second = { kind: 'card', at: '2026-01-01T10:01:00Z', projectId: 'b', projectNumber: 2, projectName: '第二个', card: {} };
  const third = { kind: 'text', at: '2026-01-01T10:02:00Z', projectId: 'a', projectNumber: 1, projectName: '第一个', text: '再说一条' };
  const timeline = roleTimeline([third, second, first]);
  assert.deepEqual(timeline.map(item => item.kind), ['project_separator', 'text', 'project_separator', 'card', 'project_separator', 'text']);
  assert.deepEqual(timeline.filter(item => item.kind === 'project_separator').map(item => `#${item.projectNumber} ${item.projectName}`), ['#1 第一个', '#2 第二个', '#1 第一个']);
});

test('角色聊天默认选当前负责项目并说明跨角色发送', () => {
  const projects = [
    { id: 'a', number: 1, stage: 'building' },
    { id: 'b', number: 2, stage: 'designing' },
  ];
  assert.equal(defaultRoleProject(projects, 'designer'), 'b');
  assert.equal(defaultRoleProject(projects, 'product'), 'a');
  assert.equal(defaultRoleProject([], 'product'), 'new');
  assert.equal(roleProjectHint(projects[0], 'designer'), '#1 现在由 AI 程序员负责');
  assert.equal(roleProjectHint(projects[1], 'designer'), '');
  assert.equal(roleProjectHint(null, 'product'), '会开一个新项目');
});

test('旧格式消息只显示已有内容，动作中文化并从首条人发文字补需求', () => {
  const old = [
    { kind: 'user', role: 'product', text: '做一个报名页' },
    { kind: 'card', role: 'product', title: 'AI 产品经理 · 确认 PRD', text: '旧版简略正文' },
    { kind: 'action', role: 'product', action: 'confirm' },
    { kind: 'action', role: 'designer', action: 'reject' },
  ];
  assert.equal(originalDemand({}, old), '做一个报名页');
  assert.equal(originalDemand({ demand: '新需求原文' }, old), '新需求原文');
  assert.deepEqual(messageView(old[1]), { type: 'card', card: { title: 'AI 产品经理 · 确认 PRD' }, user: false });
  assert.equal(messageView(old[2]).text, '你点了确认');
  assert.equal(messageView(old[3]).text, '你点了打回');
  assert.equal(messageView({ kind: 'card', role: 'product' }), null);
  assert.equal(messageView({ kind: 'action_result', action: 'confirm' }), null);
  const updated = latestCards([
    { kind: 'card', role: 'product', messageId: 'm1', title: '旧标题' },
    { kind: 'card_update', role: 'product', messageId: 'm1', title: '新标题' },
    { kind: 'card_update', role: 'designer', messageId: 'm2', title: '仅存更新版' },
  ]);
  assert.deepEqual(updated.map(event => messageView(event).card.title), ['新标题', '仅存更新版']);
});

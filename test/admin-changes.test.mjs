import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify, createChanges } from '../src/admin/changes.mjs';
import { createDeploy } from '../src/admin/deploy.mjs';

const flush = (ms = 50) => new Promise(resolve => setTimeout(resolve, ms));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

function repo() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'admin-git-'));
  const files = { 'prompts/designer.md': '设计说明\n', 'src/flow/cards.mjs': 'export const a = 1;\n', 'src/admin/main.mjs': '// 管家自己\n', 'README.md': '说明\n', '.gitignore': '.admin-work/\ndata/\n' };
  for (const [file, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(root, file)), { recursive: true }); writeFileSync(path.join(root, file), text); }
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  return root;
}
const edit = (root, file, text) => { const full = path.join(root, '.admin-work', file); mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, text); };
const live = (root, file) => readFileSync(path.join(root, file), 'utf8');

test('改动分级：只动文字是文字类；动了代码是代码类；禁区和没列出的地方整次拦下', () => {
  assert.deepEqual(classify(['prompts/a.md', 'team-skills/skills/x/SKILL.md', 'docs/a.md']), { level: 'text', blocked: [] });
  assert.deepEqual(classify(['prompts/a.md', 'src/agents/roles.mjs']), { level: 'code', blocked: [] });
  for (const file of ['src/flow/stages.mjs', 'src/agents/run.mjs', 'src/setup/run.mjs', 'src/admin/main.mjs', 'setup.mjs', '.env', '.env.example', 'package.json', 'Dockerfile', 'compose.yaml', '.github/workflows/ci.yml', 'data/state.json', 'workspace/p/site/index.html', 'README.md', 'scripts/service.mjs']) {
    assert.deepEqual(classify(['prompts/a.md', file]).blocked, [file], file);
  }
});

test('文字类：在工作副本里改，压成一个提交，测试过了快进合并到线上；回退用 git revert', async () => {
  const root = repo();
  const changes = createChanges({ root, runTests: async () => ({ ok: true, output: '' }) });
  await changes.ensure();
  edit(root, 'prompts/designer.md', '设计说明\n偏好深色主题\n');
  const c = await changes.prepare({ title: '设计偏好深色', why: '管理员要求' });
  assert.equal(c.ok, true);
  assert.deepEqual([c.level, c.files], ['text', ['prompts/designer.md']]);
  assert.equal(live(root, 'prompts/designer.md'), '设计说明\n');
  assert.equal((await changes.test(c)).ok, true);
  assert.equal((await changes.merge(c)).ok, true);
  assert.match(live(root, 'prompts/designer.md'), /深色/);
  assert.equal(git(root, 'log', '-1', '--format=%an|%s'), 'AI 管理员助手|管理员助手：设计偏好深色');
  assert.equal(changes.lastChange().sha, c.sha);
  assert.equal((await changes.revert(c)).ok, true);
  assert.equal(live(root, 'prompts/designer.md'), '设计说明\n');
  assert.ok(changes.state().history[0].revertedBy);
  assert.equal(changes.lastChange(), null);
  // 工作副本跟上了线上
  assert.equal(git(path.join(root, '.admin-work'), 'rev-parse', 'HEAD'), git(root, 'rev-parse', 'HEAD'));
});

test('碰到禁区：整次作废，工作副本里的改动全丢掉；没有改动时说清楚', async () => {
  const root = repo();
  const changes = createChanges({ root, runTests: async () => ({ ok: true, output: '' }) });
  await changes.ensure();
  edit(root, 'prompts/designer.md', '改了\n');
  edit(root, 'src/admin/main.mjs', '// 改自己\n');
  const r = await changes.prepare({ title: 'x', why: 'y' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.blocked, ['src/admin/main.mjs']);
  assert.match(r.error, /整个作废.*开发任务/);
  assert.equal(git(path.join(root, '.admin-work'), 'status', '--porcelain'), '');
  assert.equal(readFileSync(path.join(root, '.admin-work/prompts/designer.md'), 'utf8'), '设计说明\n');
  assert.match((await changes.prepare({ title: 'x', why: 'y' })).error, /没有改动/);
});

test('测试没过：拆回成改动、记次数，第 3 次放弃；签字只对同一个提交有效', async () => {
  const root = repo();
  const changes = createChanges({ root, runTests: async () => ({ ok: false, output: 'ok 1\n✖ 卡片标题\n  AssertionError: 期望 1\nℹ tests 2\nℹ fail 1\n' }) });
  await changes.ensure();
  edit(root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  for (let i = 1; i <= 3; i += 1) {
    const c = await changes.prepare({ title: '改卡片', why: '要求' });
    assert.equal(c.level, 'code');
    const t = await changes.test(c);
    assert.deepEqual([t.ok, t.tries, t.giveUp], [false, i, i === 3]);
    assert.match(t.summary, /✖ 卡片标题[\s\S]*ℹ fail 1/);
    assert.match(git(path.join(root, '.admin-work'), 'status', '--porcelain'), /src\/flow\/cards\.mjs/);
  }
  const c = await changes.prepare({ title: '改卡片', why: '要求' });
  changes.setPending({ ...c, status: 'sign', cardId: 'k' });
  assert.equal(await changes.stillSigned(c.sha), true);
  edit(root, 'src/flow/cards.mjs', 'export const a = 3;\n');
  assert.equal(await changes.stillSigned(c.sha), false);
});

test('线上目录有别人没提交的改动：不上线', async () => {
  const root = repo();
  const changes = createChanges({ root, runTests: async () => ({ ok: true, output: '' }) });
  await changes.ensure();
  edit(root, 'prompts/designer.md', '改了\n');
  const c = await changes.prepare({ title: 'x', why: 'y' });
  writeFileSync(path.join(root, 'README.md'), '别人改的\n');
  const m = await changes.merge(c);
  assert.equal(m.ok, false);
  assert.match(m.error, /README\.md/);
});

function rig({ busy = [], restartOk = [true], testsOk = true } = {}) {
  const root = repo();
  const sent = [];
  const patched = [];
  const handed = [];
  let restarts = 0;
  const projects = [...busy];
  const changes = createChanges({ root, runTests: async () => ({ ok: testsOk, output: testsOk ? '' : '✖ 失败了\nℹ fail 1' }) });
  const supervisor = { restart: async () => { const ok = restartOk[Math.min(restarts, restartOk.length - 1)]; restarts += 1; return ok ? { ok: true } : { ok: false, error: 'SyntaxError: 起不来' }; } };
  const workbench = { state: async () => ({ projects }) };
  const bot = { sendCard: async card => { sent.push(card); return `om_${sent.length}`; }, patchCard: async (id, card) => { patched.push({ id, card }); } };
  const deploy = createDeploy({ changes, supervisor, workbench, bot, logger: { error() {} }, handBack: async text => handed.push(text) });
  return { root, changes, deploy, sent, patched, handed, projects, restarts: () => restarts };
}
const valueOf = (card, label) => card.elements.at(-1).actions.find(a => a.text.content === label).value;
const text = card => JSON.stringify(card);

test('交文字类改动：测试过了直接生效，私聊发“改好了”卡带撤销按钮', async () => {
  const r = rig();
  await r.changes.ensure();
  edit(r.root, 'prompts/designer.md', '偏好深色\n');
  const reply = await r.deploy.submit({ title: '设计偏好深色', why: '管理员要求' });
  assert.match(reply, /已生效/);
  assert.match(live(r.root, 'prompts/designer.md'), /深色/);
  assert.match(text(r.sent[0]), /AI 管理员助手 · 改好了/);
  assert.equal(valueOf(r.sent[0], '撤销这次改动').action, 'revert');
  assert.equal(r.restarts(), 0);
});

test('交代码类改动：发签字卡；点上线后跑测试、合并、重启、检查', async () => {
  const r = rig();
  await r.changes.ensure();
  edit(r.root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  const reply = await r.deploy.submit({ title: '改卡片', why: '要求' });
  assert.match(reply, /签字卡/);
  assert.equal(live(r.root, 'src/flow/cards.mjs'), 'export const a = 1;\n');
  const sign = r.sent[0];
  assert.match(text(sign), /要上线这次代码改动吗？/);
  assert.equal(await r.deploy.onSign({ ...valueOf(sign, '上线'), messageId: 'om_1' }), '正在跑测试');
  await flush(300);
  assert.equal(live(r.root, 'src/flow/cards.mjs'), 'export const a = 2;\n');
  assert.equal(r.restarts(), 1);
  assert.match(text(r.patched.at(-1).card), /已上线，团队服务重启好了/);
  // 同一张卡再点：过期
  assert.equal(await r.deploy.onSign({ ...valueOf(sign, '上线'), messageId: 'om_1' }), '这张卡片已过期');
});

test('点上线时有项目在干活：测试过了先等着，巡检发现空闲了再上线', async () => {
  const r = rig({ busy: [{ number: 3, name: '番茄钟', busy: true }] });
  await r.changes.ensure();
  edit(r.root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  await r.deploy.submit({ title: '改卡片', why: '要求' });
  await r.deploy.onSign({ ...valueOf(r.sent[0], '上线'), messageId: 'om_1' });
  await flush(300);
  assert.match(text(r.patched.at(-1).card), /#3 番茄钟 正在干活，等这一步做完再上线/);
  assert.equal(r.restarts(), 0);
  await r.deploy.tick();
  assert.equal(r.restarts(), 0);
  r.projects.length = 0;
  await r.deploy.tick();
  assert.equal(r.restarts(), 1);
  assert.equal(live(r.root, 'src/flow/cards.mjs'), 'export const a = 2;\n');
});

test('上线后团队服务起不来：自动 git revert 再重启，卡片说明已回退', async () => {
  const r = rig({ restartOk: [false, true] });
  await r.changes.ensure();
  edit(r.root, 'src/flow/cards.mjs', 'export const a = ;\n');
  await r.deploy.submit({ title: '改坏了', why: '演示' });
  await r.deploy.onSign({ ...valueOf(r.sent[0], '上线'), messageId: 'om_1' });
  await flush(400);
  assert.equal(r.restarts(), 2);
  assert.equal(live(r.root, 'src/flow/cards.mjs'), 'export const a = 1;\n');
  assert.match(text(r.patched.at(-1).card), /上线后团队服务起不来（SyntaxError: 起不来），已自动回退。团队服务已恢复/);
  assert.match(git(r.root, 'log', '-1', '--format=%an|%s'), /AI 管理员助手\|Revert/);
});

test('点“不要”丢弃改动；管家又交了新改动时旧签字卡作废；签字后测试没过交回管家', async () => {
  const r = rig();
  await r.changes.ensure();
  edit(r.root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  await r.deploy.submit({ title: '第一次', why: '要求' });
  edit(r.root, 'src/flow/cards.mjs', 'export const a = 3;\n');
  await r.deploy.submit({ title: '第二次', why: '要求' });
  assert.match(text(r.patched.at(-1).card), /这张已作废：管家又交了新的改动「第二次」/);
  assert.equal(await r.deploy.onSign({ ...valueOf(r.sent[0], '上线'), messageId: 'om_1' }), '这张卡片已过期');
  assert.equal(await r.deploy.onSign({ ...valueOf(r.sent[1], '不要'), messageId: 'om_2' }), '已丢弃这次改动');
  assert.equal(readFileSync(path.join(r.root, '.admin-work/src/flow/cards.mjs'), 'utf8'), 'export const a = 1;\n');

  const f = rig({ testsOk: false });
  await f.changes.ensure();
  edit(f.root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  await f.deploy.submit({ title: '改卡片', why: '要求' });
  await f.deploy.onSign({ ...valueOf(f.sent[0], '上线'), messageId: 'om_1' });
  await flush(300);
  assert.equal(f.restarts(), 0);
  assert.match(text(f.patched.at(-1).card), /测试没通过，没有上线。已交回给管家修改/);
  assert.match(f.handed[0], /在管理员同意后跑测试，测试没过（第 1 次，最多 3 次）[\s\S]*✖ 失败了/);
});

test('回退：代码类有项目在干活时不回退；空闲时回退并重启', async () => {
  const r = rig();
  await r.changes.ensure();
  edit(r.root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  await r.deploy.submit({ title: '改卡片', why: '要求' });
  await r.deploy.onSign({ ...valueOf(r.sent[0], '上线'), messageId: 'om_1' });
  await flush(300);
  r.projects.push({ number: 4, name: '读书笔记', busy: true });
  const refused = await r.deploy.revert();
  assert.match(refused.error, /#4 读书笔记 正在干活/);
  r.projects.length = 0;
  const ok = await r.deploy.revert();
  assert.equal(ok.ok, true);
  assert.match(ok.text, /已回退「改卡片」，团队服务重启好了/);
  assert.equal(live(r.root, 'src/flow/cards.mjs'), 'export const a = 1;\n');
  assert.match((await r.deploy.revert()).error, /还没有可以回退的改动/);
});

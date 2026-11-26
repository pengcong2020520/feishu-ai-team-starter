import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { classify, createChanges } from '../src/admin/changes.mjs';
import { createDeploy } from '../src/admin/deploy.mjs';
import { createAssistant } from '../src/admin/assistant.mjs';

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

test('草稿期间线上已更新：提交前拦下，不把别人的新规则覆盖回旧稿，并保留草稿', async () => {
  const root = repo();
  const changes = createChanges({ root, runTests: async () => ({ ok: true, output: '' }) });
  await changes.ensure();
  edit(root, 'prompts/developer.md', '管理员的新草稿\n');
  writeFileSync(path.join(root, 'prompts/designer.md'), '别人已上线的新规则\n');
  git(root, 'add', 'prompts/designer.md');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', '更新设计规则');
  const before = git(changes.work, 'rev-parse', 'HEAD');
  const c = await changes.prepare({ title: '只加开发规则', why: '管理员要求' });
  assert.equal(c.ok, false);
  assert.match(c.error, /线上代码.*变化.*草稿已保留/);
  assert.equal(live(root, 'prompts/designer.md'), '别人已上线的新规则\n');
  assert.equal(readFileSync(path.join(changes.work, 'prompts/developer.md'), 'utf8'), '管理员的新草稿\n');
  assert.equal(git(changes.work, 'rev-parse', 'HEAD'), before);
  assert.equal(git(changes.work, 'diff', '--cached', '--name-only'), '');
});

test('有新草稿时撤销已上线改动：后续提交不能把撤销结果偷偷带回去', async () => {
  const root = repo();
  const changes = createChanges({ root, runTests: async () => ({ ok: true, output: '' }) });
  await changes.ensure();
  edit(root, 'prompts/designer.md', '临时设计规则\n');
  const c = await changes.prepare({ title: '临时改规则', why: '验证撤销' });
  await changes.test(c);
  await changes.merge(c);
  edit(root, 'prompts/developer.md', '正在写的新草稿\n');
  assert.equal((await changes.revert(c)).ok, true);
  const next = await changes.prepare({ title: '交新草稿', why: '管理员要求' });
  assert.equal(next.ok, false);
  assert.equal(live(root, 'prompts/designer.md'), '设计说明\n');
  assert.equal(readFileSync(path.join(changes.work, 'prompts/developer.md'), 'utf8'), '正在写的新草稿\n');
  assert.equal(changes.lastChange(), null);
});

function rig({ busy = [], restartOk = [true], testsOk = true } = {}) {
  const root = repo();
  const sent = [];
  const patched = [];
  const handed = [];
  const down = [];
  let restarts = 0;
  let readable = true;
  const projects = [...busy];
  const changes = createChanges({ root, runTests: async () => ({ ok: testsOk, output: testsOk ? '' : '✖ 失败了\nℹ fail 1' }) });
  const supervisor = { status: () => ({ running: true }), restart: async () => { const ok = restartOk[Math.min(restarts, restartOk.length - 1)]; restarts += 1; return ok ? { ok: true } : { ok: false, error: '起不来' }; } };
  const workbench = { state: async () => readable ? { projects } : null };
  const bot = { sendCard: async card => { sent.push(card); return `om_${sent.length}`; }, patchCard: async (id, card) => { patched.push({ id, card }); } };
  const deploy = createDeploy({ changes, supervisor, workbench, bot, logger: { error() {} }, handBack: async text => handed.push(text), serviceDown: async (...args) => down.push(args) });
  return { root, changes, deploy, sent, patched, handed, down, projects, readable: value => { readable = value; }, restarts: () => restarts };
}
const valueOf = (card, label) => card.elements.at(-1).actions.find(a => a.text.content === label).value;
const text = card => JSON.stringify(card);

test('首次管理员私聊改角色：先准备真实工作副本，模型可以读取修改并提交生效', async () => {
  const r = rig();
  const bot = { sendCard: async () => 'om_first', patchCard: async () => {} };
  const steward = { run: async () => {
    assert.ok(existsSync(path.join(r.changes.work, '.git')));
    assert.equal(readFileSync(path.join(r.changes.work, 'prompts/designer.md'), 'utf8'), '设计说明\n');
    edit(r.root, 'prompts/designer.md', '设计说明\n补充手机触控检查\n');
    assert.match(await r.deploy.submit({ title: '补充设计规则', why: '首次私聊要求' }), /已生效/);
    return { ok: true, text: '已改好', stats: {} };
  } };
  const assistant = createAssistant({ root: r.root, bot, steward, changes: r.changes });
  await assistant.onMessage({ text: '请修改设计角色说明' });
  assert.equal(live(r.root, 'prompts/designer.md'), '设计说明\n补充手机触控检查\n');
  assert.equal(r.changes.lastChange().level, 'text');
});

test('只读诊断不创建工作副本', async () => {
  const r = rig();
  let ran = false;
  const assistant = createAssistant({ root: r.root, changes: r.changes,
    bot: { sendCard: async () => 'om_readonly', patchCard: async () => {} },
    steward: { run: async ({ readOnly }) => { ran = true; assert.equal(readOnly, true); assert.equal(existsSync(r.changes.work), false); return { ok: true, text: '只查了原因', stats: {} }; } },
  });
  await assistant.runSteward('只查不改', '查原因', { readOnly: true });
  assert.equal(ran, true);
  assert.equal(existsSync(r.changes.work), false);
});

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
  assert.match(text(r.patched.at(-1).card), /#3 番茄钟 正在干活，我不打断它。做完后我会自动上线，不用再点/);
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
  assert.match(text(r.patched.at(-1).card), /上线后团队服务起不来（起不来），已自动撤销。团队服务已恢复/);
  assert.match(git(r.root, 'log', '-1', '--format=%an|%s'), /AI 管理员助手\|Revert/);
});

test('点“不要”丢弃改动；管家又交了新改动时旧签字卡作废；签字后测试没过交回管家', async () => {
  const r = rig();
  await r.changes.ensure();
  edit(r.root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  await r.deploy.submit({ title: '第一次', why: '要求' });
  edit(r.root, 'src/flow/cards.mjs', 'export const a = 3;\n');
  await r.deploy.submit({ title: '第二次', why: '要求' });
  assert.match(text(r.patched.at(-1).card), /这张已作废：我又准备了新的改动「第二次」，请看新的那张卡片/);
  assert.equal(await r.deploy.onSign({ ...valueOf(r.sent[0], '上线'), messageId: 'om_1' }), '这张卡片已过期');
  assert.equal(await r.deploy.onSign({ ...valueOf(r.sent[1], '不要'), messageId: 'om_2' }), '不上线了');
  assert.equal(readFileSync(path.join(r.root, '.admin-work/src/flow/cards.mjs'), 'utf8'), 'export const a = 1;\n');

  const f = rig({ testsOk: false });
  await f.changes.ensure();
  edit(f.root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  await f.deploy.submit({ title: '改卡片', why: '要求' });
  await f.deploy.onSign({ ...valueOf(f.sent[0], '上线'), messageId: 'om_1' });
  await flush(300);
  assert.equal(f.restarts(), 0);
  assert.match(text(f.patched.at(-1).card), /测试没通过，没有上线。我接着改/);
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
  assert.match(ok.text, /已撤销「改卡片」，团队服务已重启/);
  assert.equal(live(r.root, 'src/flow/cards.mjs'), 'export const a = 1;\n');
  assert.match((await r.deploy.revert()).error, /没找到这次改动/);
});

test('代码测试只读签字提交，测试失败也移除临时副本并把改动交回', async () => {
  const root = repo();
  let seen;
  const changes = createChanges({ root, runTests: async cwd => { seen = { cwd, code: readFileSync(path.join(cwd, 'src/flow/cards.mjs'), 'utf8') }; return { ok: false, output: '✖ 没通过\nℹ fail 1' }; } });
  await changes.ensure();
  edit(root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  const c = await changes.prepare({ title: '改卡片', why: '要求' });
  edit(root, 'src/flow/cards.mjs', 'export const a = 3;\n');
  assert.equal((await changes.test(c)).ok, false);
  assert.deepEqual(seen, { cwd: path.join(root, '.admin-test'), code: 'export const a = 2;\n' });
  assert.equal(existsSync(path.join(root, '.admin-test')), false);
  assert.match(git(path.join(root, '.admin-work'), 'status', '--porcelain'), /src\/flow\/cards\.mjs/);
  assert.match(c.stat, /1 个文件，增加 1 行，删除 1 行/);
});

test('项目状态不可读时不重启、不上线、不撤销代码', async () => {
  const r = rig();
  await r.changes.ensure();
  edit(r.root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  await r.deploy.submit({ title: '改卡片', why: '要求' });
  r.readable(false);
  assert.match((await r.deploy.restart()).error, /读不到项目状态，先不重启/);
  await r.deploy.onSign({ ...valueOf(r.sent[0], '上线'), messageId: 'om_1' });
  await flush(300);
  assert.match(text(r.patched.at(-1).card), /读不到项目状态，先不上线/);
  assert.equal(r.restarts(), 0);
  r.readable(true);
  await r.deploy.onSign({ ...valueOf(r.sent[0], '上线'), messageId: 'om_1' });
  await flush(300);
  r.readable(false);
  assert.match((await r.deploy.revert()).error, /读不到项目状态，先不撤销/);
  assert.equal(r.restarts(), 1);
});

test('上线失败且自动撤销失败时说明线上仍是这次改动并提醒服务停了', async () => {
  const r = rig({ restartOk: [false] });
  await r.changes.ensure();
  edit(r.root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  await r.deploy.submit({ title: '改卡片', why: '要求' });
  r.changes.revert = async () => ({ ok: false, error: '撤销冲突' });
  await r.deploy.onSign({ ...valueOf(r.sent[0], '上线'), messageId: 'om_1' });
  await flush(350);
  assert.match(text(r.patched.at(-1).card), /自动撤销也没成功，线上还是这次改动。请让搭团队的助手看 data\/service.log/);
  assert.equal(r.down.length, 1);
  assert.equal(live(r.root, 'src/flow/cards.mjs'), 'export const a = 2;\n');
});

test('撤销冲突只给管理员中文建议，原始错误只进日志', async () => {
  const root = repo();
  const logs = [];
  const changes = createChanges({ root, runTests: async () => ({ ok: true, output: '' }) });
  await changes.ensure();
  edit(root, 'prompts/designer.md', '第一版\n');
  const change = await changes.prepare({ title: '改设计', why: '要求' });
  await changes.test(change);
  await changes.merge(change);
  writeFileSync(path.join(root, 'prompts/designer.md'), '后来又改了\n');
  git(root, 'add', 'prompts/designer.md');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'later');
  const r = await changes.revert(change, { error: value => logs.push(value) });
  assert.equal(r.ok, false);
  assert.equal(r.error, '这次改动和后来的改动改到了同一处，没有撤销。跟我说一声，我按现在的代码处理。');
  assert.ok(logs.length > 0);
  assert.doesNotMatch(r.error, /CONFLICT|git/);
});

test('多个项目干活时通过测试也等它们做完', async () => {
  const r = rig({ busy: [{ number: 3, name: '番茄钟', busy: true }, { number: 4, name: '读书笔记', busy: true }] });
  await r.changes.ensure();
  edit(r.root, 'src/flow/cards.mjs', 'export const a = 2;\n');
  await r.deploy.submit({ title: '改卡片', why: '要求' });
  await r.deploy.onSign({ ...valueOf(r.sent[0], '上线'), messageId: 'om_1' });
  await flush(300);
  assert.match(text(r.patched.at(-1).card), /#3 番茄钟、#4 读书笔记 正在干活，我不打断它们。做完后我会自动上线，不用再点/);
});

test('线上有未提交文件或提交已变化时签字卡说清没有上线', async () => {
  for (const kind of ['dirty', 'ahead']) {
    const r = rig();
    await r.changes.ensure();
    edit(r.root, 'src/flow/cards.mjs', 'export const a = 2;\n');
    await r.deploy.submit({ title: '改卡片', why: '要求' });
    if (kind === 'dirty') writeFileSync(path.join(r.root, 'README.md'), '别人改的\n');
    else {
      writeFileSync(path.join(r.root, 'README.md'), '别人提交的\n');
      git(r.root, 'add', 'README.md');
      git(r.root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'later');
    }
    await r.deploy.onSign({ ...valueOf(r.sent[0], '上线'), messageId: 'om_1' });
    await flush(350);
    const card = text(r.patched.at(-1).card);
    assert.match(card, kind === 'dirty' ? /没上线：线上目录里有人改了还没提交的文件（README.md），先处理掉再上线。这次改动已取消，线上没变/ : /没上线：线上代码在这期间变了，没法直接合并。跟我说一声，我按现在的代码再改一次。这次改动已取消，线上没变/);
    assert.equal(r.restarts(), 0);
  }
});

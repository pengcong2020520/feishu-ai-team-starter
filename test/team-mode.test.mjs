import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { resolveTeamMode } from '../src/team-mode.mjs';
import { createTeam } from '../src/team.mjs';
import { startPreview } from '../src/preview.mjs';
import { runSetup } from '../src/setup/run.mjs';
import { readEnv } from '../src/setup/env-file.mjs';

async function fixture(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'team-mode-'));
  try { await mkdir(path.join(root, 'data')); await fn(root); }
  finally { await rm(root, { recursive: true, force: true }); }
}

test('默认基础版；已存在的独立项目自动保留多项目版且不能降级绕过权限', () => fixture(async root => {
  assert.equal(resolveTeamMode({ root, env: {} }), 'basic');
  assert.throws(() => resolveTeamMode({ root, env: { TEAM_MODE: 'unknown' } }), /TEAM_MODE/);
  for (const state of [{ groups: { g: { dedicated: true, stage: 'confirm_prd' } } }, { archived: [{ dedicated: true, stage: 'done' }] }]) {
    await writeFile(path.join(root, 'data/state.json'), JSON.stringify(state));
    assert.equal(resolveTeamMode({ root, env: {} }), 'projects');
    assert.throws(() => resolveTeamMode({ root, env: { TEAM_MODE: 'basic' } }), /已有独立项目/);
  }
  await writeFile(path.join(root, 'data/state.json'), '{}');
  await writeFile(path.join(root, 'data/project-registry.json'), JSON.stringify({ requests: { retry: { chatId: 'group' } } }));
  assert.equal(resolveTeamMode({ root, env: {} }), 'projects');
  await writeFile(path.join(root, 'data/state.json'), 'corrupt');
  assert.throws(() => resolveTeamMode({ root, env: { TEAM_MODE: 'basic' } }));
}));

test('setup 选择版本不创建机器人；服务运行时不能悄悄切换模式', () => fixture(async root => {
  const output = [], deps = { depsReady: () => true, installStatus: () => ({ status: 'ok' }), serviceStatus: () => ({ running: false }) };
  assert.equal(await runSetup({ root, argv: ['mode', 'projects'], deps, log: text => output.push(text) }), 0);
  assert.equal(readEnv(path.join(root, '.env')).TEAM_MODE, 'projects');
  assert.match(output.join('\n'), /领航版/);
  assert.equal(await runSetup({ root, argv: ['mode', 'basic'], deps: { ...deps, serviceStatus: () => ({ running: true }) }, log() {} }), 1);
  assert.equal(readEnv(path.join(root, '.env')).TEAM_MODE, 'projects');
  assert.equal(await runSetup({ root, argv: ['mode', 'basic'], deps, log() {} }), 0);
  assert.equal(readEnv(path.join(root, '.env')).TEAM_MODE, 'basic');
}));

for (const mode of ['basic', 'projects']) test(`${mode} 正式装配：工作台提需求按所选版本路由，澄清仍由原 workflow 执行`, () => fixture(async root => {
  let groups = 0, calls = 0;
  const feishu = { listChats: async () => [{ chat_id: 'entry' }], sendText: async () => {}, sendCard: async () => 'card-message', patchCard: async () => {},
    createProjectGroup: async () => { groups++; return 'new-project-group'; }, addMembers: async () => {} };
  const team = createTeam({ root, env: { TEAM_MODE: mode }, transport: () => feishu, agent: async ({ role, projectDir }) => {
    calls++; assert.equal(role, 'product');
    await writeFile(path.join(projectDir, 'docs/questions.json'), JSON.stringify({ round: 1, why: '明确范围', questions: [{ id: 'q1', question: '是否采用推荐方案？', matters: '决定范围', options: ['是', '否'], recommended: 0, reason: '先跑通' }] }));
    return { ok: true, text: '请回答问题', sessionId: `session-${mode}`, stats: { turns: 1, durationMs: 1, inputTokens: 1, outputTokens: 1 } };
  } });
  if (mode === 'projects') {
    const p = await team.flow.projects.observe({ unionId: 'on_test_owner' }, '测试负责人');
    await team.flow.projects.directory.settings({ ownerId: p.id });
  }
  const server = await startPreview({ root, assetsRoot: process.cwd(), flow: team.flow, feishu, recorder: team.recorder, workbenchPort: 0, modelPort: 0 });
  try {
    const base = `http://127.0.0.1:${server.workbenchPort}`;
    assert.equal((await (await fetch(base + '/api/config')).json()).teamMode, mode);
    assert.equal((await fetch(base + '/api/team')).status, mode === 'projects' ? 200 : 404);
    const response = await fetch(base + '/api/demand', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: JSON.stringify({ text: '做一个报名页', requestId: 'test-mode' }) });
    assert.equal(response.status, 200);
    const result = await response.json();
    const project = await team.flow.waitForIdle(result.chatId);
    assert.equal(project.error, null);
    assert.equal(project.stage, 'clarifying');
    assert.equal(calls, 1);
    assert.equal(groups, mode === 'projects' ? 1 : 0);
    assert.equal(result.chatId, mode === 'projects' ? 'new-project-group' : 'entry');
    if (mode === 'basic') {
      await assert.rejects(readFile(path.join(root, 'data/team.json')), { code: 'ENOENT' });
      assert.equal(project.dedicated, undefined);
    } else {
      assert.equal(project.dedicated, true);
      assert.equal(JSON.parse(await readFile(path.join(root, 'workspace', project.id, 'context/project.json'), 'utf8')).stage, 'clarifying');
    }
  } finally { await server.close(); }
}));

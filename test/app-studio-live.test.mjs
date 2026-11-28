import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import path from 'node:path';
import { installPackage } from '../src/packages/store.mjs';
import { createPackageEngine } from '../src/packages/engine.mjs';
import { createRecorder } from '../src/workbench/recorder.mjs';
import { applicationView, deployApplication, docker, verifyApplication } from '../src/packages/app-runner.mjs';
import { loadPackage } from '../src/packages/store.mjs';

const live = process.env.RUN_APP_LIVE === '1';
const put = async (root, file, value) => { const dest = path.join(root, file); await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, value); };

test('五角色完整应用流程、HTTP、持久化与故障回滚', { skip: !live, timeout: 300_000 }, async () => {
  const root = await mkdtemp(path.join(process.cwd(), 'data/app-live-'));
  let container;
  try {
    const lock = await installPackage('team-packages/app-studio', root);
    const source = await loadPackage('team-packages/app-studio');
    let reviews = 0, repairs = 0;
    const agent = async args => {
      if (args.mode === 'chat') return { ok: true, structured: { reply: '收到', proposal: { action: 'none', detail: '' } }, text: '收到', stats: {} };
      for (const skill of args.definition.skills) args.onProgress?.({ tool: 'Skill', file: skill, status: 'succeeded' });
      const dir = args.projectDir;
      if (args.role === 'product') await put(dir, 'spec/spec.md', '# 读书会报名规格\n用户填写姓名并提交；系统持久保存报名。上限 10 人，非法输入给明确错误。');
      if (args.role === 'designer') await put(dir, 'design/interaction.md', '# 报名交互\n输入姓名，提交后显示结果和当前报名名单。失败时保留输入。');
      if (args.role === 'architect') {
        if (args.prompt.includes('review/review.json')) await put(dir, 'review/review.json', JSON.stringify({ status: ++reviews === 1 ? 'revise' : 'pass', summary: 'API、迁移和规格核对' }));
        else if (args.prompt.includes('architecture/tasks.md')) await put(dir, 'architecture/tasks.md', '# 任务\n1. 建表；2. 后端接口；3. 表单；4. 集成测试。');
        else await put(dir, 'architecture/plan.md', '# 架构\nNode HTTP 服务提供 GET/POST 接口，SQLite 持久保存，迁移单独执行。');
      }
      if (args.role === 'developer') { if (args.prompt.includes('根据架构复核记录')) repairs++; await cp('examples/app-studio-demo/app', path.join(dir, 'app'), { recursive: true, force: true }); }
      if (args.role === 'qa') await put(dir, args.prompt.includes('qa/verification.json') ? 'qa/verification.json' : 'release/deployment.json', '{"status":"pending"}');
      return { ok: true, text: '完成', sessionId: args.role + '-session', stats: { turns: 1, durationMs: 1, inputTokens: 1, outputTokens: 1 } };
    };
    const engine = createPackageEngine({ root, recorder: createRecorder(root), agent });
    const created = await engine.create({ package: lock, text: '读书会报名：表单、API、SQLite 持久化与容量限制', options: { channel: 'local', reviewMode: 'workflow' } });
    let p = await engine.waitForIdle(created.id);
    for (let i = 0; i < 6 && p.stage !== 'accept'; i++) {
      assert.equal(p.error, null, `阶段 ${p.stage}：${p.error}`);
      assert.ok(['confirm-spec', 'confirm-plan', 'confirm-deploy'].includes(p.stage), p.stage);
      await engine.action({ chatId: p.chatId, value: { action: 'package_confirm', projectId: p.id, stage: p.stage, cardId: p.cardId } });
      p = await engine.waitForIdle(p.id);
    }
    assert.equal(p.stage, 'accept');
    assert.equal(reviews, 2); assert.equal(repairs, 1);
    const directory = path.join(root, 'workspace', p.id);
    const app = await applicationView(directory); assert.equal(app?.status, 'running');
    container = JSON.parse(await readFile(path.join(directory, '.app-releases/current.json'), 'utf8')).container;
    const invalid = await fetch(app.url + '/api/registrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":""}' });
    assert.equal(invalid.status, 400);
    const submitted = await fetch(app.url + '/api/registrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"验收用户"}' });
    assert.equal(submitted.status, 201);
    assert.deepEqual((await (await fetch(app.url + '/api/registrations')).json()).items, [{ name: '验收用户' }]);
    const serverFile = path.join(directory, 'app/server.mjs'), original = await readFile(serverFile, 'utf8');
    await writeFile(serverFile, original + '\n// new release\n');
    await deployApplication(source, directory);
    container = JSON.parse(await readFile(path.join(directory, '.app-releases/current.json'), 'utf8')).container;
    assert.deepEqual((await (await fetch(app.url + '/api/registrations')).json()).items, [{ name: '验收用户' }]);
    await writeFile(serverFile, original.replace("return send(200, { ok: true });", "return send(process.env.NODE_ENV === 'production' ? 503 : 200, { ok: true });") + '\n// failed release\n');
    await assert.rejects(deployApplication(source, directory), /健康检查未通过/);
    assert.deepEqual((await (await fetch(app.url + '/api/registrations')).json()).items, [{ name: '验收用户' }]);
    const snapshot = (await engine.snapshot())[0]; assert.equal(snapshot.application.status, 'running');
    assert.equal(snapshot.application.url, app.url);
    assert.equal(snapshot.stage, 'accept');
    const badMigration = path.join(directory, 'app/migrations/002.sql');
    await writeFile(badMigration, 'THIS IS NOT SQL;');
    assert.equal((await verifyApplication(source, directory)).status, 'revise');
    await rm(badMigration);
    const testFile = path.join(directory, 'app/test/app.test.mjs'), goodTest = await readFile(testFile, 'utf8');
    await writeFile(testFile, "throw Error('forced test failure')\n");
    assert.equal((await verifyApplication(source, directory)).status, 'revise');
    await writeFile(testFile, goodTest);
    container = JSON.parse(await readFile(path.join(directory, '.app-releases/current.json'), 'utf8')).container;
  } finally {
    if (container) await docker(['rm', '-f', container], 15_000);
    await rm(root, { recursive: true, force: true });
  }
});

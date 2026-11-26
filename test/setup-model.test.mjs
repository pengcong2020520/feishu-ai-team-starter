import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingModel, missingBots, missingAdmin, nextStage } from '../src/setup/state.mjs';
import { anthropicEnv, checkModel } from '../src/setup/model.mjs';

const full = {
  MODEL_BASE_URL: 'https://m.test/api', MODEL_API_KEY: 'sk-1', MODEL_NAME: 'm1',
  FEISHU_PRODUCT_APP_ID: 'cli_a', FEISHU_PRODUCT_APP_SECRET: 's', FEISHU_DESIGNER_APP_ID: 'cli_b', FEISHU_DESIGNER_APP_SECRET: 's',
  FEISHU_DEVELOPER_APP_ID: 'cli_c', FEISHU_DEVELOPER_APP_SECRET: 's',
  FEISHU_ADMIN_APP_ID: 'cli_d', FEISHU_ADMIN_APP_SECRET: 's', FEISHU_ADMIN_OPEN_ID: 'ou_admin',
};

test('模板里的占位符算没填', () => {
  assert.deepEqual(missingModel({ MODEL_BASE_URL: 'https://example.com/api/compatible', MODEL_API_KEY: 'xxx', MODEL_NAME: 'xxx' }), ['MODEL_BASE_URL', 'MODEL_API_KEY', 'MODEL_NAME']);
  assert.deepEqual(missingBots({ ...full, FEISHU_DESIGNER_APP_ID: 'cli_xxx' }).map(r => r.key), ['designer']);
});

test('阶段按顺序推进', () => {
  const s = (env, progress = {}, depsReady = true, serviceRunning = false) => nextStage({ env, progress, depsReady, serviceRunning });
  assert.equal(s({}), 'model');
  assert.equal(s(full), 'model-check');
  assert.equal(s(full, { modelOk: true }, false), 'deps');
  assert.equal(s({ ...full, FEISHU_PRODUCT_APP_ID: '' }, { modelOk: true }), 'feishu');
  assert.equal(s(full, { modelOk: true }), 'group');
  assert.equal(s(full, { modelOk: true, groupReady: true }), 'service');
  assert.equal(s(full, { modelOk: true, groupReady: true }, true, true), 'done');
});

test('管理员助手排在团队服务后面：已搭好的人先把服务拉起来，再补扫这一张码', () => {
  const s = (env, serviceRunning) => nextStage({ env, progress: { modelOk: true, groupReady: true }, depsReady: true, serviceRunning });
  const noAdmin = { ...full, FEISHU_ADMIN_OPEN_ID: '' };
  assert.equal(missingAdmin(noAdmin), true);
  assert.equal(missingAdmin(full), false);
  assert.equal(s(noAdmin, false), 'service');
  assert.equal(s(noAdmin, true), 'admin');
  assert.equal(s(full, true), 'done');
});

test('沿用终端变量：只报变量名和地址，值交给写入', () => {
  const r = anthropicEnv({ ANTHROPIC_BASE_URL: 'https://gw.test', ANTHROPIC_AUTH_TOKEN: 'tok', PATH: '/bin' });
  assert.deepEqual(r.found, ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN']);
  assert.equal(r.baseUrl, 'https://gw.test');
  assert.deepEqual(r.values, { MODEL_API_KEY: 'tok', MODEL_BASE_URL: 'https://gw.test' });
  assert.deepEqual(anthropicEnv({}).values, {});
});

test('连通检查：请求格式与各种失败原因，原因里不含密钥', async () => {
  let seen;
  const ok = await checkModel({ baseUrl: 'https://m.test/api/', apiKey: 'sk-secret', model: 'm1', fetchImpl: async (url, init) => { seen = { url, init }; return new Response('{}', { status: 200 }); } });
  assert.deepEqual(ok, { ok: true });
  assert.equal(seen.url, 'https://m.test/api/v1/messages');
  assert.equal(seen.init.headers.authorization, 'Bearer sk-secret');
  assert.deepEqual(JSON.parse(seen.init.body), { model: 'm1', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] });
  const reply = (status, body = {}) => async () => new Response(JSON.stringify(body), { status });
  const cases = [[401, /MODEL_API_KEY/], [404, /MODEL_BASE_URL/], [400, /MODEL_NAME/], [429, /额度/], [503, /稍后重试/]];
  for (const [status, pattern] of cases) {
    const r = await checkModel({ baseUrl: 'https://m.test', apiKey: 'sk-secret', model: 'm1', fetchImpl: reply(status, { error: { message: 'bad sk-secret' } }) });
    assert.equal(r.ok, false);
    assert.match(r.reason, pattern);
    assert.doesNotMatch(r.reason, /sk-secret/);
  }
  const down = await checkModel({ baseUrl: 'https://m.test', apiKey: 'k', model: 'm', fetchImpl: async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); } });
  assert.match(down.reason, /连不上 MODEL_BASE_URL（ENOTFOUND）/);
});

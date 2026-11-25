import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withRetry, timed } from '../src/feishu.mjs';

const noWait = { delays: [1, 1, 1], sleep: async () => {} };
const limited = code => Object.assign(new Error('Request failed with status code 400'), { response: { status: 400, data: { code, msg: 'This operation triggers the frequency limit.' } } });

test('飞书限频时退避重试，成功就返回结果', async () => {
  for (const code of [230020, 230429, 99991400]) {
    let calls = 0;
    const r = await withRetry(async () => { calls += 1; if (calls < 3) throw limited(code); return { code: 0, data: { message_id: 'm' } }; }, noWait);
    assert.equal(r.data.message_id, 'm');
    assert.equal(calls, 3);
  }
});

test('返回体里带限频错误码（没抛异常）也重试', async () => {
  let calls = 0;
  const r = await withRetry(async () => { calls += 1; return calls === 1 ? { code: 230429, msg: 'limit' } : { code: 0 }; }, noWait);
  assert.equal(r.code, 0);
  assert.equal(calls, 2);
});

test('重试用完仍限频，报错里带错误码；其他错误不重试', async () => {
  let calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw limited(230429); }, noWait), /code 230429/);
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(withRetry(async () => { calls += 1; throw limited(230002); }, noWait), /code 230002/);
  assert.equal(calls, 1);
});

test('上传超过时间上限就当失败，不让流程一直等', async () => {
  await assert.rejects(timed(new Promise(() => {}), 20, '上传网页文件'), /上传网页文件超过 0 秒没完成/);
  assert.equal(await timed(Promise.resolve('ok'), 1000, '上传图片'), 'ok');
});

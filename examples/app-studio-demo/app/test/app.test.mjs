import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../server.mjs';

test('报名、输入错误、列表和持久化', async () => {
  const db = new DatabaseSync(process.env.APP_DB_PATH);
  db.exec('DELETE FROM registrations'); db.close();
  const server = createApp(process.env.APP_DB_PATH);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(base + '/health')).status, 200);
    assert.match(await (await fetch(base)).text(), /读书会报名/);
    const post = name => fetch(base + '/api/registrations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    assert.equal((await post('')).status, 400);
    assert.equal((await post('小明')).status, 201);
    assert.deepEqual((await (await fetch(base + '/api/registrations')).json()).items, [{ name: '小明' }]);
  } finally { await new Promise(resolve => server.close(resolve)); }
  const reopened = new DatabaseSync(process.env.APP_DB_PATH);
  assert.equal(reopened.prepare('SELECT count(*) AS n FROM registrations').get().n, 1);
  reopened.close();
});

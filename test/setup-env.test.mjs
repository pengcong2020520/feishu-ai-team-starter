import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readEnv, ensureEnv, updateEnv } from '../src/setup/env-file.mjs';
import { readProgress, saveProgress } from '../src/setup/progress.mjs';

const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'setup-env-'));

test('按模板建 .env，权限 600', () => {
  const dir = tmp();
  writeFileSync(path.join(dir, '.env.example'), '# 注释\nMODEL_NAME=xxx\n');
  ensureEnv(path.join(dir, '.env'), path.join(dir, '.env.example'));
  assert.equal(statSync(path.join(dir, '.env')).mode & 0o777, 0o600);
  assert.equal(readFileSync(path.join(dir, '.env'), 'utf8'), '# 注释\nMODEL_NAME=xxx\n');
});

test('更新式写入：同名替换、不重复、保留注释，新变量追加', () => {
  const file = path.join(tmp(), '.env');
  writeFileSync(file, '# 模型\nMODEL_NAME=xxx\nMODEL_NAME=old\nOTHER=1\n', { mode: 0o644 });
  updateEnv(file, { MODEL_NAME: 'doubao', MODEL_BASE_URL: 'https://a.example/api' });
  assert.equal(readFileSync(file, 'utf8'), '# 模型\nMODEL_NAME=doubao\nMODEL_NAME=doubao\nOTHER=1\nMODEL_BASE_URL=https://a.example/api\n');
  assert.equal(statSync(file).mode & 0o777, 0o600);
});

test('带特殊字符的密钥写进去再读出来一字不差', () => {
  const file = path.join(tmp(), '.env');
  for (const value of ['sk-abc/+==', 'a#b', 'has space', "it's", 'q"uote']) {
    updateEnv(file, { MODEL_API_KEY: value });
    assert.equal(readEnv(file).MODEL_API_KEY, value);
  }
  assert.throws(() => updateEnv(file, { MODEL_API_KEY: 'mix\'"' }), /手动填写/);
  assert.throws(() => updateEnv(file, { MODEL_API_KEY: 'a\nb' }), /换行/);
});

test('进度文件合并写入', () => {
  const dir = tmp();
  assert.deepEqual(readProgress(dir), {});
  saveProgress(dir, { modelOk: true });
  saveProgress(dir, { chatId: 'oc_1' });
  assert.deepEqual(readProgress(dir), { modelOk: true, chatId: 'oc_1' });
});

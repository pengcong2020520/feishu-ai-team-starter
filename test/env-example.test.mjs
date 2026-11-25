import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

// setup 按模板建 .env：模板里写死部署用的地址，换端口后飞书卡片链接就会指错
test('.env 模板带 PREVIEW_PORT，不写死部署用的地址', () => {
  const env = parseEnv(readFileSync('.env.example', 'utf8'));
  assert.equal(env.PREVIEW_PORT, '4870');
  for (const name of ['PUBLIC_WORKBENCH_BASE', 'PUBLIC_PREVIEW_BASE', 'PREVIEW_HOST']) assert.equal(env[name], undefined, `${name} 只该在部署时设置`);
});

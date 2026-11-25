import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// 讲解页 build.mjs 用同样的正则从动手搭建里抽提示词，格式变了讲解页会报错
test('动手搭建里能抽出提示词 0–8 和拓展 A–H', () => {
  const guide = readFileSync('docs/动手搭建.md', 'utf8');
  const prompts = new Set([...guide.matchAll(/## 提示词 (\d+)：(.+)\n\n```text\n([\s\S]*?)```/g)].map(m => m[1]));
  const exts = new Set([...guide.matchAll(/## 拓展 ([A-Z])：(.+)\n\n```text\n([\s\S]*?)```/g)].map(m => m[1]));
  for (const n of '012345678') assert.ok(prompts.has(n), `缺少提示词 ${n}`);
  for (const x of 'ABCDEFGH') assert.ok(exts.has(x), `缺少拓展 ${x}`);
});

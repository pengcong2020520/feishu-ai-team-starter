import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOutline, outlinePage } from '../src/outline.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
test('页面结构图固定模板转义内容并按区块或状态较多的一侧计算高度', async () => {
  const blocks = Array.from({ length: 8 }, (_, i) => ({ name: `区块${i}`, content: i === 0 ? '<script>危险</script>' : '一句说明' }));
  const page = outlinePage({ title: '报名页', blocks, states: [{ id: 'default', name: '默认', desc: '填写信息' }] });
  assert.equal(page.width, 1280);
  assert.equal(page.height, 200 + 8 * 100);
  assert.match(page.html, /页面从上到下/);
  assert.match(page.html, /页面状态/);
  assert.match(page.html, /&lt;script&gt;危险&lt;\/script&gt;/);
  assert.doesNotMatch(page.html, /<script>危险<\/script>/);
});
test('七个区块、五个状态时留足截图高度并保留末项', () => {
  const blocks = Array.from({ length: 7 }, (_, i) => ({ name: `区块${i + 1}`, content: '一句说明' }));
  const states = Array.from({ length: 5 }, (_, i) => ({ id: `state-${i + 1}`, name: `状态${i + 1}`, desc: '一句描述' }));
  blocks[6].name = '设置';
  const page = outlinePage({ title: '当前项目', blocks, states });
  assert.equal(page.height, 950);
  assert.match(page.html, /<b>设置<\/b>/);
  assert.match(page.html, /<b>状态5<\/b>/);
  assert.match(page.html, /height:950px/);
  const stateHeavy = outlinePage({ title: '状态较多', blocks: blocks.slice(0, 2), states });
  assert.equal(stateHeavy.height, 950);
});
test('页面结构图写入 HTML，截图带尺寸和虚拟时间参数', async () => {
  const dir = await mkdtemp(path.join(root, 'test-outline-'));
  try {
    await mkdir(path.join(dir, 'docs'));
    await writeFile(path.join(dir, 'docs/outline.json'), JSON.stringify({ title: '报名页', blocks: [{ name: '页头', content: '介绍' }], states: [{ id: 'default', name: '默认', desc: '填写' }] }));
    const chrome = path.join(dir, 'fake-chrome');
    await writeFile(chrome, '#!/bin/sh\nfor arg do case "$arg" in --screenshot=*) out=${arg#--screenshot=};; esac; done\nprintf "%s\\n" "$@" > "$out.args"\nprintf "%01200d" 0 > "$out"\n');
    await chmod(chrome, 0o700);
    const result = await createOutline({ projectDir: dir, chromePath: chrome });
    assert.match(await readFile(result.htmlFile, 'utf8'), /页面结构图/);
    const args = await readFile(`${result.pngFile}.args`, 'utf8');
    assert.match(args, /--window-size=1280,350/);
    assert.match(args, /--virtual-time-budget=5000/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

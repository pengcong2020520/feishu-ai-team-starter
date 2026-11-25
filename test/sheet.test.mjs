import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSheet } from '../src/sheet.mjs';

const here = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
test('一览图截图等待各 iframe 绘制', async () => {
  const root = await mkdtemp(path.join(here, 'test-sheet-'));
  try {
    await mkdir(path.join(root, 'docs'), { recursive: true });
    await writeFile(path.join(root, 'docs/outline.json'), JSON.stringify({ states: [{ id: 'default', name: '默认', desc: '首页' }] }));
    const chrome = path.join(root, 'fake-chrome');
    await writeFile(chrome, '#!/bin/sh\nfor arg do\n case "$arg" in --screenshot=*) out=${arg#--screenshot=};; esac\ndone\nprintf "%s\\n" "$@" > "$out.args"\nprintf "%01200d" 0 > "$out"\n');
    await chmod(chrome, 0o700);
    const result = await createSheet({ kind: 'site', projectDir: root, chromePath: chrome });
    const args = await readFile(`${result.pngFile}.args`, 'utf8');
    assert.match(args, /--virtual-time-budget=5000/);
    assert.match(args, /--window-size=1368,/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

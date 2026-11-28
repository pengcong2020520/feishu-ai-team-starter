import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadPackage } from '../src/packages/store.mjs';
import { validateOutputs } from '../src/packages/runtime.mjs';
import { validateDefinition } from '../src/packages/schema.mjs';

test('完整应用团队可分发，但伪造的测试和部署报告不能推进流程', async () => {
  const pack = await loadPackage('team-packages/app-studio');
  assert.deepEqual(pack.manifest.roles.map(role => role.id), ['product', 'designer', 'architect', 'developer', 'qa']);
  const unsafe = structuredClone(pack.workflow);
  unsafe.nodes.find(node => node.id === 'confirm-deploy').release = false;
  assert.throws(() => validateDefinition(pack.manifest, unsafe), /人工发布关口/);
  const directory = await mkdtemp(path.join(os.tmpdir(), 'app-studio-'));
  try {
    await mkdir(path.join(directory, 'qa'));
    await mkdir(path.join(directory, 'release'));
    await writeFile(path.join(directory, 'qa/verification.json'), '{"status":"pass"}');
    await writeFile(path.join(directory, 'release/deployment.json'), '{"status":"pass"}');
    for (const id of ['verification', 'deploy']) {
      const node = pack.workflow.nodes.find(item => item.id === id);
      await assert.rejects(() => validateOutputs(pack, node, directory), /ENOENT|交付|文件/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

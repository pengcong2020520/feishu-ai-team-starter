import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { lockedPackage, listPackages, latestPackages, installPackage } from './store.mjs';

// A prompt edit creates a new immutable package. Project locks and workflows stay intact.
export async function saveRolePrompt(root, { package: lock, role, prompt }) {
  if (typeof prompt !== 'string' || !prompt.trim() || Buffer.byteLength(prompt) > 12000) throw Error('提示词不能为空，且不能超过 12 KB');
  const pack = await lockedPackage(root, lock);
  const index = pack.manifest.roles.findIndex(r => r.id === role);
  if (index < 0) throw Error('角色不存在');
  const guard = path.join(root, 'data', 'package-edit-locks', pack.manifest.id);
  await mkdir(path.dirname(guard), { recursive: true });
  try { await mkdir(guard); } catch (e) { if (e.code === 'EEXIST') throw Error('该团队正在保存，请稍后重试'); throw e; }
  let temp;
  try {
    const latest = latestPackages((await listPackages(root)).filter(p => p.id === lock.id));
    if (latest.length !== 1 || latest[0].hash !== lock.hash) throw Error('团队版本已更新，请重新读取提示词后再保存；你的草稿仍保留');
    const old = pack.manifest.roles[index].prompt;
    if (pack.files.get(old).toString() === prompt) return { ...lock, unchanged: true };
    temp = await mkdtemp(path.join(os.tmpdir(), 'team-prompt-'));
    const manifest = structuredClone(pack.manifest);
    const version = manifest.version.split('.').map(Number); version[2]++;
    manifest.version = version.join('.');
    // Handle packages that share the same source file across roles without changing peers.
    const target = manifest.roles.filter(r => r.prompt === old).length > 1 ? `prompts/workbench-${role}-${randomUUID()}.md` : old;
    manifest.roles[index].prompt = target;
    if (!manifest.files.includes(target)) manifest.files.push(target);
    for (const [name, bytes] of pack.files) {
      await mkdir(path.dirname(path.join(temp, name)), { recursive: true });
      await writeFile(path.join(temp, name), bytes, { mode: 0o600 });
    }
    await mkdir(path.dirname(path.join(temp, target)), { recursive: true });
    await writeFile(path.join(temp, target), prompt, { mode: 0o600 });
    await writeFile(path.join(temp, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    return await installPackage(temp, root);
  } finally {
    if (temp) await rm(temp, { recursive: true, force: true });
    await rm(guard, { recursive: true, force: true });
  }
}

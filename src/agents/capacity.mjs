import { mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
// 同一死进程可能被多个观察者同时发现。先占住槽内清理标记，再重新核对，
// 防止后到的清理者把刚被另一个任务占用的新槽删除。
async function reap(dir, expectedId) {
  const marker = path.join(dir, 'reaping');
  try { await mkdir(marker); } catch (e) { if (['EEXIST', 'ENOENT'].includes(e.code)) return; throw e; }
  try {
    let current;
    try { current = JSON.parse(await readFile(path.join(dir, 'lease.json'), 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
    if (current) {
      if (current.id !== expectedId || alive(current.pid)) return;
    } else {
      const info = await stat(dir).catch(() => null);
      if (!info || expectedId || Date.now() - info.birthtimeMs < 10000) return;
    }
    await rm(dir, { recursive: true, force: true });
  } finally { await rm(marker, { recursive: true, force: true }); }
}
export function concurrencyLimit() {
  const value = Number(process.env.AGENT_CONCURRENCY || 3);
  if (!Number.isInteger(value) || value < 1 || value > 32) throw Error('AGENT_CONCURRENCY 必须是 1–32 的整数');
  return value;
}
async function records(directory) {
  const result = [];
  for (const name of await readdir(directory).catch(e => { if (e.code === 'ENOENT') return []; throw e; })) {
    const dir = path.join(directory, name);
    try {
      const record = JSON.parse(await readFile(path.join(dir, 'lease.json'), 'utf8'));
      if (!alive(record.pid)) { await reap(dir, record.id); continue; }
      result.push({ ...record, name });
    } catch (e) {
      if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e;
      const info = await stat(dir).catch(() => null);
      if (info && Date.now() - info.birthtimeMs > 10000) await reap(dir);
    }
  }
  return result;
}
export async function capacityStatus(root, limit = concurrencyLimit()) {
  const base = path.join(root, 'data/agent-capacity');
  const [active, queued] = await Promise.all([records(path.join(base, 'active')), records(path.join(base, 'queued'))]);
  return { active: active.length, queued: queued.length, limit };
}
// 管理服务与团队服务共享文件锁，管理员模型调用也占用同一个总额度。
export async function acquireCapacity({ root, limit = concurrencyLimit(), role, project, signal, onQueued, intervalMs = 200 }) {
  const base = path.join(root, 'data/agent-capacity'), active = path.join(base, 'active'), queued = path.join(base, 'queued');
  await Promise.all([mkdir(active, { recursive: true }), mkdir(queued, { recursive: true })]);
  const lease = { id: randomUUID(), pid: process.pid, at: Date.now(), role, project };
  const waiting = path.join(queued, lease.id);
  await mkdir(waiting); await writeFile(path.join(waiting, 'lease.json'), JSON.stringify(lease));
  let notified = false;
  try {
    while (true) {
      signal?.throwIfAborted();
      await records(active);
      const line = (await records(queued)).sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      if (line[0]?.id === lease.id) {
        for (let i = 0; i < limit; i++) {
          const slot = path.join(active, String(i));
          try { await mkdir(slot); } catch (e) { if (e.code === 'EEXIST') continue; throw e; }
          try { await writeFile(path.join(slot, 'lease.json'), JSON.stringify(lease)); signal?.throwIfAborted(); }
          catch (error) { await rm(slot, { recursive: true, force: true }); throw error; }
          if (notified) onQueued?.(false);
          let released = false;
          return async () => { if (!released) { released = true; await rm(slot, { recursive: true, force: true }); } };
        }
      }
      if (!notified) { notified = true; onQueued?.(true); }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  } finally { await rm(waiting, { recursive: true, force: true }); }
}

import { mkdir, open, readFile, realpath, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';

// Only the host writes these files. Agents can read context but never write it.
async function contextDir(projectDir) {
  const root = await realpath(projectDir), dir = path.join(root, 'context');
  await mkdir(dir, { recursive: true });
  if (await realpath(dir) !== dir) throw Error('来源目录不能是软链接');
  return dir;
}
export async function saveResearchEvidence(projectDir, role, kind, result) {
  const dir = await contextDir(projectDir), cache = path.join(dir, 'sources');
  await mkdir(cache, { recursive: true });
  if (await realpath(cache) !== cache) throw Error('来源缓存不能是软链接');
  const sourceId = randomUUID(), text = ['read_url', 'read_pdf'].includes(kind) ? result.text : JSON.stringify(result);
  const sha256 = createHash('sha256').update(text).digest('hex');
  const cachedPath = `context/sources/${sourceId}.txt`;
  await writeFile(path.join(cache, `${sourceId}.txt`), text, { flag: 'wx', mode: 0o600 });
  const entry = { sourceId, role, kind, url: result.url, query: result.query, fetchedAt: result.fetchedAt, sha256, cachedPath };
  // Each append is one write; independent roles never overwrite one another's ledger.
  const ledger = await open(path.join(dir, 'source-ledger.jsonl'), constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
  try { await ledger.writeFile(JSON.stringify(entry) + '\n'); } finally { await ledger.close(); }
  return { ...result, sourceId, sha256, cachedPath };
}
export async function readResearchEvidence(projectDir) {
  const dir = await contextDir(projectDir);
  const read = async file => { try { const full = path.join(dir, file); if (await realpath(full) !== full) throw Error('证据文件不能是软链接'); return await readFile(full, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } };
  return { sources: (await read('source-ledger.jsonl')).trim().split('\n').filter(Boolean).map(s => JSON.parse(s)), approvals: JSON.parse(await read('approvals.json') || '[]') };
}

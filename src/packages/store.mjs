import { readFile, writeFile, mkdir, lstat, realpath, readdir, rename, rm, mkdtemp } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { relativePath, validateDefinition } from './schema.mjs';

const MAX_FILE = 2 * 1024 * 1024, MAX_PACK = 16 * 1024 * 1024;
export const digest = value => createHash('sha256').update(value).digest('hex');
export const inside = (root, file) => file === root || file.startsWith(root + path.sep);
export async function safeFile(root, relative) {
  relativePath.parse(relative);
  const base = await realpath(root); let current = base;
  for (const part of relative.split('/')) { current = path.join(current, part); if ((await lstat(current)).isSymbolicLink()) throw Error(`不允许软链接：${relative}`); }
  if (!inside(base, await realpath(current)) || !(await lstat(current)).isFile()) throw Error('文件越界或不是普通文件');
  return current;
}
function exportable(name, content) {
  if (/(^|\/)(?:\.env[^/]*|data|\.git|\.claude[^/]*|sessions?|qr|node_modules|team-bindings\.json)(\/|$)/i.test(name)) throw Error(`不导出运行数据或密钥文件：${name}`);
  const text = content.toString('utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:oc_sk_[\w-]{16,}|sk-ant-[\w-]{20,}|sk-[\w-]{24,}|gh[pousr]_[\w]{20,})|\b(?:APP_SECRET|API_KEY|AUTH_TOKEN)\s*["']?\s*[:=]\s*["']?[a-zA-Z0-9_\-]{16,}|\b(?:ou|oc|on)_[a-f0-9]{20,}/i.test(text)) throw Error(`发现疑似凭据或飞书身份：${name}；请先脱敏`);
}
export async function loadPackage(dir) {
  const raw = await readFile(await safeFile(dir, 'manifest.json')); if (raw.length > MAX_FILE) throw Error('清单过大');
  const manifest = JSON.parse(raw);
  // 在读取任意声明文件前先限制路径、数量和总大小。
  if (!Array.isArray(manifest.files) || manifest.files.length > 500 || !manifest.files.includes('manifest.json')) throw Error('清单必须声明自身及所有分发文件');
  const files = new Map(); let size = 0;
  for (const name of manifest.files) {
    const file = await safeFile(dir, name), stat = await lstat(file);
    if (stat.size > MAX_FILE || (size += stat.size) > MAX_PACK) throw Error('团队包超过大小限制');
    const bytes = await readFile(file); exportable(name, bytes); files.set(name, bytes);
  }
  if (!files.has(manifest.workflow)) throw Error('未声明工作流文件');
  const definition = validateDefinition(manifest, JSON.parse(files.get(manifest.workflow)));
  for (const page of definition.manifest.knowledge?.pages || []) {
    const body = files.get(page.path).toString();
    if (!body.trim() || body.length > 32000) throw Error('知识页须为非空 Markdown，且不超过 32000 字符');
  }
  for (const s of definition.manifest.skills) {
    const body = files.get(s.path).toString();
    if (!body.startsWith('---\n') || !new RegExp(`^name: ${s.id}$`, 'm').test(body) || !/^description: .+/m.test(body)) throw Error(`技能 ${s.id} 缺少正确的 frontmatter`);
  }
  if (!files.get(manifest.collaboration).toString().startsWith('---\n')) throw Error('协作 Skill 缺少 frontmatter');
  const hashes = Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, bytes]) => [name, digest(bytes)]));
  return { ...definition, dir: path.resolve(dir), files, hashes, hash: digest(JSON.stringify(hashes)) };
}
export async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 }); await rename(temp, file); } finally { await rm(temp, { force: true }); }
}
export async function exportPackage(dir, target) {
  const p = await loadPackage(dir);
  const bundle = { format: 'feishu-team-bundle/1', package: { id: p.manifest.id, version: p.manifest.version, hash: p.hash }, files: Object.fromEntries([...p.files].map(([name, data]) => [name, { sha256: p.hashes[name], base64: data.toString('base64') }])) };
  // 不覆盖源包；导出物也不能自行改变随后计算的清单。
  if (inside(path.resolve(dir), path.resolve(target))) throw Error('导出文件请放在团队包目录之外');
  await atomicJson(target, bundle);
  return { id: p.manifest.id, version: p.manifest.version, hash: p.hash, files: p.files.size };
}
async function unpack(file, dir) {
  if ((await lstat(file)).size > MAX_PACK * 1.5) throw Error('导入文件过大');
  const bundle = JSON.parse(await readFile(file, 'utf8'));
  if (bundle.format !== 'feishu-team-bundle/1' || !bundle.files || typeof bundle.files !== 'object' || Object.keys(bundle.files).length > 500) throw Error('不是有效团队包');
  let total = 0;
  for (const [name, entry] of Object.entries(bundle.files)) {
    relativePath.parse(name); if (!entry || typeof entry.base64 !== 'string') throw Error('包文件内容无效');
    const bytes = Buffer.from(entry.base64, 'base64');
    if (bytes.length > MAX_FILE || (total += bytes.length) > MAX_PACK || digest(bytes) !== entry.sha256) throw Error('包文件摘要不符或超过大小限制');
    exportable(name, bytes); await mkdir(path.dirname(path.join(dir, name)), { recursive: true }); await writeFile(path.join(dir, name), bytes);
  }
  const p = await loadPackage(dir);
  if (p.hash !== bundle.package?.hash || p.manifest.id !== bundle.package.id || p.manifest.version !== bundle.package.version || p.files.size !== Object.keys(bundle.files).length) throw Error('团队包总摘要或清单不符');
  return p;
}

// GitHub 来源必须固定完整提交号；只取清单列出的普通文件，不运行远程安装脚本。
async function downloadGitHub(source, dir) {
  const u = new URL(source), parts = u.pathname.split('/').filter(Boolean);
  if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.search || u.hash || parts[2] !== 'tree' || !/^[a-f0-9]{40}$/.test(parts[3] || '')) throw Error('使用 https://github.com/作者/仓库/tree/<40 位提交号>/包目录');
  const prefix = parts.slice(4).join('/'); if (prefix) relativePath.parse(prefix);
  const base = `https://raw.githubusercontent.com/${parts[0]}/${parts[1]}/${parts[3]}/${prefix ? prefix + '/' : ''}`;
  let total = 0;
  const get = async name => {
    relativePath.parse(name); const r = await fetch(base + name, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw Error(`下载包文件失败：${name}（HTTP ${r.status}）`);
    const chunks = []; let size = 0;
    for await (const chunk of r.body) { size += chunk.length; total += chunk.length; if (size > MAX_FILE || total > MAX_PACK) throw Error('远程包过大'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  };
  const bytes = await get('manifest.json'), m = JSON.parse(bytes);
  if (!Array.isArray(m.files) || m.files.length > 500) throw Error('远程包清单无效');
  for (const name of m.files) { const data = name === 'manifest.json' ? bytes : await get(name); exportable(name, data); await mkdir(path.dirname(path.join(dir, name)), { recursive: true }); await writeFile(path.join(dir, name), data); }
  return loadPackage(dir);
}
export async function installPackage(source, root = process.cwd()) {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'feishu-team-install-'));
  try {
    const p = /^https:/.test(source) ? await downloadGitHub(source, temp) : (await lstat(source)).isDirectory() ? await loadPackage(source) : await unpack(source, temp);
    const destination = path.join(root, 'data/packages', p.manifest.id, p.manifest.version, p.hash);
    await mkdir(path.dirname(destination), { recursive: true });
    // 临时目录原子发布；同一版本不同内容保留不同摘要，已有项目锁定原内容。
    const staging = `${destination}.${randomUUID()}.tmp`; await mkdir(staging);
    try {
      for (const [name, bytes] of p.files) { await mkdir(path.dirname(path.join(staging, name)), { recursive: true }); await writeFile(path.join(staging, name), bytes, { mode: 0o600 }); }
      try { await rename(staging, destination); } catch (e) { if (!['EEXIST', 'ENOTEMPTY'].includes(e.code)) throw e; const existing = await loadPackage(destination); if (existing.hash !== p.hash) throw Error('已安装包摘要不符'); }
    } finally { await rm(staging, { recursive: true, force: true }); }
    return { id: p.manifest.id, version: p.manifest.version, hash: p.hash, directory: destination };
  } finally { await rm(temp, { recursive: true, force: true }); }
}
// Keep immutable history for existing projects; new projects default to the latest version.
// Equal versions with different hashes remain visible, rather than silently selecting one.
export function latestPackages(packages) {
  const compare = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
  const versions = new Map();
  for (const p of packages) if (!versions.has(p.id) || compare(p.version, versions.get(p.id)) > 0) versions.set(p.id, p.version);
  return packages.filter(p => p.version === versions.get(p.id));
}
export async function listPackages(root = process.cwd()) {
  const result = [];
  const entries = async dir => readdir(dir, { withFileTypes: true }).catch(e => { if (e.code === 'ENOENT') return []; throw e; });
  for (const id of await entries(path.join(root, 'data/packages'))) if (id.isDirectory()) for (const v of await entries(path.join(root, 'data/packages', id.name))) if (v.isDirectory()) for (const h of await entries(path.join(root, 'data/packages', id.name, v.name))) if (h.isDirectory() && /^[a-f0-9]{64}$/.test(h.name)) {
    const p = await loadPackage(path.join(root, 'data/packages', id.name, v.name, h.name));
    if (p.hash !== h.name || p.manifest.id !== id.name || p.manifest.version !== v.name) throw Error('已安装包被修改，请重新安装');
    result.push({ ...packageView(p), gates: p.workflow.nodes.filter(n => n.type === 'gate').map(({ id, name, approval }) => ({ id, name, approval })) });
  }
  return result;
}
export function packageView(p) {
  const { id, version, name, description, roles, skills, artifacts, examples, license } = p.manifest;
  return { id, version, hash: p.hash, name, description, coordinator: p.workflow.coordinator,
    roles: roles.map(({ id, name, description, color, skills, read, write }) => ({ id, name, description, color, skills, read, write })),
    skills: skills.map(({ id, name, description }) => ({ id, name, description })), artifacts, examples, license, workflow: p.workflow,
    knowledge: p.manifest.knowledge || { format: 'wiki/1', pages: [] } };
}
export function roleSource(p, role) {
  const r = p.manifest.roles.find(r => r.id === role); if (!r) throw Error('角色不存在');
  return { name: r.name, prompt: p.files.get(r.prompt).toString(), skills: r.skills.map(id => { const s = p.manifest.skills.find(s => s.id === id); return { ...s, text: p.files.get(s.path).toString() }; }), collaboration: p.files.get(p.manifest.collaboration).toString() };
}
export async function lockedPackage(root, lock) {
  if (!lock || !/^[a-z][a-z0-9-]{0,63}$/.test(lock.id) || !/^\d+\.\d+\.\d+$/.test(lock.version) || !/^[a-f0-9]{64}$/.test(lock.hash)) throw Error('团队包锁定信息无效');
  const p = await loadPackage(path.join(root, 'data/packages', lock.id, lock.version, lock.hash));
  if (p.hash !== lock.hash) throw Error('项目锁定的团队包内容已变化');
  return p;
}

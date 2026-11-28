import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile, readdir, lstat, cp } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync, backup } from 'node:sqlite';
import { safeFile } from './store.mjs';

const image = 'node@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54';
const maxOutput = 16_000;
const migrateScript = "import{DatabaseSync}from'node:sqlite';import{readFileSync,readdirSync}from'node:fs';import path from'node:path';const d=new DatabaseSync(process.env.APP_DB_PATH);const dir=path.dirname(process.env.MIGRATION_PATH);d.exec('CREATE TABLE IF NOT EXISTS __migrations (name TEXT PRIMARY KEY)');for(const name of readdirSync(dir).filter(x=>/^\\d{3}\\.sql$/.test(x)).sort()){if(d.prepare('SELECT 1 FROM __migrations WHERE name=?').get(name))continue;d.exec('BEGIN');try{d.exec(readFileSync(path.join(dir,name),'utf8'));d.prepare('INSERT INTO __migrations(name) VALUES (?)').run(name);d.exec('COMMIT')}catch(e){d.exec('ROLLBACK');throw e}}d.close()";
export async function docker(args, timeoutMs = 120_000) {
  return await new Promise((resolve, reject) => {
    const child = spawn('docker', args, { env: { PATH: process.env.PATH || '', HOME: process.env.HOME || '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false;
    const append = chunk => { output = (output + chunk.toString()).slice(-maxOutput); };
    child.stdout.on('data', append); child.stderr.on('data', append);
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ ok: code === 0 && !timedOut, code, timedOut, output }); });
  });
}
let imageReady;
async function ensureImage() {
  imageReady ||= (async () => {
    if ((await docker(['image', 'inspect', image], 15_000)).ok) return;
    const pulled = await docker(['pull', image], 240_000);
    if (!pulled.ok) throw Error('无法获取应用运行镜像：' + pulled.output);
  })().catch(error => { imageReady = null; throw error; });
  await imageReady;
}

export async function verifyApplication(pack, directory) {
  const app = pack.manifest.application;
  if (!app) throw Error('团队包没有声明应用运行契约');
  await ensureImage();
  for (const file of [app.entry, app.test, app.migration]) await safeFile(directory, file);
  const appRoot = app.entry.split('/')[0], appDir = path.resolve(directory, appRoot);
  const temp = await mkdtemp(path.join(path.resolve(directory), '.app-check-'));
  await chmod(temp, 0o777);
  const common = ['run', '--rm', '--network', 'none', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '512m', '--cpus', '1', '--user', '65534:65534',
    '--mount', `type=bind,src=${appDir},dst=/workspace/${appRoot},readonly`, '--mount', `type=bind,src=${temp},dst=/data`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '-e', 'APP_DB_PATH=/data/app.sqlite', '-e', `MIGRATION_PATH=/workspace/${app.migration}`, '-e', `PORT=${app.port}`, '--workdir', '/workspace', image];
  let migration, tests;
  try {
    await mkdir(path.join(directory, 'qa'), { recursive: true });
    migration = await docker([...common, 'node', '--input-type=module', '-e', migrateScript], 60_000);
    if (migration.ok) tests = await docker([...common, 'node', '--test', `/workspace/${app.test}`], 120_000);
    const report = { status: migration.ok && tests?.ok ? 'pass' : 'revise', source: 'platform-docker', checkedAt: new Date().toISOString(), migration: { ok: migration.ok, output: migration.output }, tests: tests ? { ok: tests.ok, output: tests.output } : { ok: false, output: '迁移失败，测试未运行' } };
    await writeFile(path.join(directory, 'qa/verification.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  } finally { await rm(temp, { recursive: true, force: true }); }
}

async function sourceHash(source) {
  const hash = createHash('sha256'); let total = 0;
  async function walk(dir, prefix = '') {
    for (const item of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (item.name.startsWith('.') || item.name === 'node_modules') throw Error('应用源码不能含隐藏文件或 node_modules');
      const file = path.join(dir, item.name), rel = path.join(prefix, item.name), info = await lstat(file);
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw Error('应用源码含软链接或特殊文件');
      if (info.isDirectory()) await walk(file, rel);
      else { total += info.size; if (total > 20 * 1024 * 1024) throw Error('应用源码超过 20 MB'); hash.update(JSON.stringify([rel, info.size])).update('\0').update(await readFile(file)); }
    }
  }
  await walk(source); return hash.digest('hex');
}

async function containerStatus(name) { const r = await docker(['inspect', '-f', '{{.State.Running}}', name], 15_000); return r.ok && r.output.trim() === 'true'; }
async function containerPort(name, internal) {
  const mapped = await docker(['port', name, String(internal)], 15_000);
  const port = Number(mapped.output.match(/127\.0\.0\.1:(\d+)/)?.[1]);
  if (!mapped.ok || !port) throw Error('无法读取本机应用端口');
  return port;
}
async function waitHealthy(url, healthPath) {
  for (let i = 0; i < 20; i++) {
    try { const response = await fetch(url + healthPath, { signal: AbortSignal.timeout(1500) }); if (response.ok) return true; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  return false;
}

export async function deployApplication(pack, directory) {
  const app = pack.manifest.application;
  if (!app) throw Error('团队包没有声明应用运行契约');
  const appRoot = app.entry.split('/')[0], source = path.resolve(directory, appRoot);
  const before = await sourceHash(source);
  const test = await verifyApplication(pack, directory);
  if (test.status !== 'pass') throw Error('应用迁移或自动测试未通过，不能发布');
  const hash = await sourceHash(source);
  if (hash !== before) throw Error('测试期间应用源码发生变化，请重新测试');
  const base = path.resolve(directory, '.app-releases');
  const currentFile = path.join(base, 'current.json');
  let previous = null; try { previous = JSON.parse(await readFile(currentFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous?.hash === hash && await containerStatus(previous.container)) {
    previous.url = `http://127.0.0.1:${await containerPort(previous.container, app.port)}`;
    if (!await waitHealthy(previous.url, app.healthPath)) throw Error('当前应用未通过健康检查');
    await writeFile(path.join(directory, 'release/deployment.json'), JSON.stringify(previous, null, 2) + '\n');
    await writeFile(currentFile, JSON.stringify(previous, null, 2) + '\n');
    return previous;
  }
  const id = randomUUID().slice(0, 12), release = path.join(base, id), snapshot = path.join(release, 'app'), data = path.join(release, 'data');
  await mkdir(release, { recursive: true }); await cp(source, snapshot, { recursive: true }); await chmod(snapshot, 0o755);
  if (await sourceHash(snapshot) !== hash) { await rm(release, { recursive: true, force: true }); throw Error('发布快照与通过测试的源码不一致'); }
  await mkdir(data, { mode: 0o777 }); await chmod(data, 0o777);
  const name = `feishu-app-${createHash('sha256').update(path.resolve(directory)).digest('hex').slice(0, 10)}-${id}`;
  let stoppedOld = false, startedNew = false;
  try {
    if (previous?.container && await containerStatus(previous.container)) {
      const stop = await docker(['stop', previous.container], 30_000); if (!stop.ok) throw Error('旧版应用未能停止：' + stop.output);
      stoppedOld = true;
    }
    if (previous?.data) {
      const database = path.join(previous.data, 'app.sqlite');
      if (!(await lstat(database)).isFile()) throw Error('上一版数据库文件无效');
      const db = new DatabaseSync(database);
      try { await backup(db, path.join(data, 'app.sqlite')); } finally { db.close(); }
      await chmod(path.join(data, 'app.sqlite'), 0o666);
    }
    const common = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '64', '--memory', '512m', '--cpus', '1', '--user', '65534:65534',
      '--mount', `type=bind,src=${snapshot},dst=/workspace/${appRoot},readonly`, '--mount', `type=bind,src=${data},dst=/data`, '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m', '-e', 'APP_DB_PATH=/data/app.sqlite', '-e', `MIGRATION_PATH=/workspace/${app.migration}`, '-e', `PORT=${app.port}`, '--workdir', '/workspace'];
    const migrate = await docker(['run', '--rm', '--network', 'none', ...common, image, 'node', '--input-type=module', '-e', migrateScript], 60_000);
    if (!migrate.ok) throw Error('部署迁移失败：' + migrate.output);
    const hostPort = previous?.url ? Number(new URL(previous.url).port) : null;
    const start = await docker(['run', '-d', '--restart', 'unless-stopped', '--name', name, '--network', 'bridge', '-p', `127.0.0.1:${hostPort || ''}:${app.port}`, '-e', 'NODE_ENV=production', ...common, image, 'node', `/workspace/${app.entry}`], 30_000);
    if (!start.ok) throw Error('启动应用失败：' + start.output);
    startedNew = true;
    const port = await containerPort(name, app.port);
    const url = `http://127.0.0.1:${port}`;
    if (!await waitHealthy(url, app.healthPath)) throw Error('新版本健康检查未通过');
    const report = { status: 'pass', source: 'platform-docker', hash, container: name, data, url, checkedAt: new Date().toISOString() };
    await mkdir(path.join(directory, 'release'), { recursive: true });
    await writeFile(path.join(directory, 'release/deployment.json'), JSON.stringify(report, null, 2) + '\n');
    await writeFile(currentFile, JSON.stringify(report, null, 2) + '\n');
    if (stoppedOld) await docker(['rm', previous.container], 15_000);
    return report;
  } catch (error) {
    if (startedNew) await docker(['rm', '-f', name], 15_000);
    if (stoppedOld) {
      const restarted = await docker(['start', previous.container], 30_000);
      if (restarted.ok) {
        previous.url = `http://127.0.0.1:${await containerPort(previous.container, app.port)}`;
        if (!await waitHealthy(previous.url, app.healthPath)) throw Error('发布失败，旧版也未恢复健康：' + error.message);
        await writeFile(currentFile, JSON.stringify(previous, null, 2) + '\n');
        await writeFile(path.join(directory, 'release/deployment.json'), JSON.stringify(previous, null, 2) + '\n');
      }
    }
    throw error;
  }
}

export async function applicationView(directory) {
  try {
    const current = JSON.parse(await readFile(path.join(directory, '.app-releases/current.json'), 'utf8'));
    if (current.status !== 'pass' || !/^http:\/\/127\.0\.0\.1:\d+$/.test(current.url || '')) return null;
    return { url: current.url, checkedAt: current.checkedAt, status: await containerStatus(current.container) ? 'running' : 'stopped' };
  } catch (error) { if (error.code === 'ENOENT') return null; return null; }
}

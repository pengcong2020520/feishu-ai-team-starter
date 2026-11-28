import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { loadPackage, exportPackage, installPackage, listPackages, lockedPackage } from '../src/packages/store.mjs';
import { installNewtype } from '../src/packages/newtype.mjs';
import { bindRole } from '../src/packages/bindings.mjs';
import { readEnv } from '../src/setup/env-file.mjs';
import { openFile } from '../src/setup/register.mjs';
import { serviceStatus, startService } from '../src/setup/service.mjs';

export async function teamPack(argv, { root = process.cwd(), log = console.log } = {}) {
  const [command, source, ...rest] = argv;
  if (command === 'validate') {
    const p = await loadPackage(source); log(JSON.stringify({ ok: true, id: p.manifest.id, version: p.manifest.version, roles: p.manifest.roles.length, hash: p.hash }, null, 2)); return;
  }
  if (command === 'export') { if (!rest[0]) throw Error('请指定输出 .team.json 文件'); log(JSON.stringify(await exportPackage(source, rest[0]), null, 2)); return; }
  if (command === 'install') {
    if (source === 'newtype') { log('正在按固定版本获取 Newtype。其包保留 SUL-1.0 来源声明，与平台 MIT 代码分开；只在本机安装。'); log(JSON.stringify(await installNewtype(root), null, 2)); }
    else log(JSON.stringify(await installPackage(source, root), null, 2)); return;
  }
  if (command === 'init') {
    for (const name of ['web-studio', 'investment-lab']) log(JSON.stringify(await installPackage(path.resolve(fileURLToPath(new URL(`../team-packages/${name}`, import.meta.url))), root)));
    log(JSON.stringify(await installNewtype(root)));
    const env = readEnv(path.join(root, '.env'));
    for (const role of ['product', 'designer', 'developer']) if (env[`FEISHU_${role.toUpperCase()}_APP_ID`] && env[`FEISHU_${role.toUpperCase()}_APP_SECRET`]) await bindRole(root, 'web-studio', role, role, env);
    log('三套团队已安装。网页团队复用已有机器人；其他团队可先在本机运行。打开 /teams 选择团队和目标。'); return;
  }
  if (command === 'list') { log(JSON.stringify(await listPackages(root), null, 2)); return; }
  if (command === 'bind') { log(JSON.stringify(await bindRole(root, source, rest[0], rest[1], readEnv(path.join(root, '.env'))))); return; }
  if (command === 'bots') {
    if (!serviceStatus(root).running) { const started = await startService(root); if (!started.ok) throw Error(started.error); }
    const env = readEnv(path.join(root, '.env')), base = `http://127.0.0.1:${env.PREVIEW_PORT || 4870}`;
    const response = await fetch(base + '/api/packages/connect', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Workbench': '1' }, body: JSON.stringify({ packageId: source }) });
    const job = await response.json(); if (!response.ok) throw Error(job.error);
    openFile(base + job.url); log(`已打开扫码页面：${base + job.url}；扫码完成后会自动连接，工作台显示连接状态。`); return;
  }
  if (command === 'verify-export') {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'team-pack-reproduce-'));
    try { const bundle = path.join(temp, 'export.team.json'); const exported = await exportPackage(source, bundle); const installed = await installPackage(bundle, temp); const p = await lockedPackage(temp, installed); if (p.hash !== exported.hash) throw Error('重新导入摘要不符'); log(JSON.stringify({ ok: true, level: '结构、摘要与干净目录导出导入；未调用模型或飞书', ...exported }, null, 2)); } finally { await rm(temp, { recursive: true, force: true }); } return;
  }
  log('团队包：\n  node scripts/team-pack.mjs init\n  node scripts/team-pack.mjs validate <目录>\n  node scripts/team-pack.mjs export <目录> <输出.team.json>\n  node scripts/team-pack.mjs install <目录|.team.json|GitHub固定提交目录链接|newtype>\n  node scripts/team-pack.mjs verify-export <目录>\n  node scripts/team-pack.mjs list\n  node scripts/team-pack.mjs bind <包ID> <角色ID> <已有机器人键>\n  node scripts/team-pack.mjs bots <包ID>');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await teamPack(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}

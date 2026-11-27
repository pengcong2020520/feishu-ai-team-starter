import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { mkdir, readFile, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import { loadPackage, exportPackage, installPackage, listPackages, lockedPackage, digest } from '../src/packages/store.mjs';
import { installNewtype } from '../src/packages/newtype.mjs';
import { readBindings, bindRole } from '../src/packages/bindings.mjs';
import { readEnv, updateEnv } from '../src/setup/env-file.mjs';
import { registerMissing, installRetry } from '../src/setup/register.mjs';
import { serviceStatus } from '../src/setup/service.mjs';

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
    if (serviceStatus(root).running) throw Error('先等当前任务完成并 npm stop；配置机器人完成后 npm start，避免连接配置中途变化');
    const packages = (await listPackages(root)).filter(p => p.id === source);
    if (!packages.length) throw Error('请先安装团队包');
    if (new Set(packages.map(p => p.roles.map(r => r.id).join(','))).size > 1) throw Error('多个版本角色不同，请先用 bind 明确配置所需角色');
    const pack = packages[0], bindings = await readBindings(root, source), envFile = path.join(root, '.env'), env = readEnv(envFile);
    const keyFor = id => `${source.slice(0, 20)}-${id.slice(0, 32)}-${digest(source + '/' + id).slice(0, 8)}`;
    const missing = [];
    for (const r of pack.roles.filter(r => !bindings.roles[r.id])) {
      const key = keyFor(r.id), prefix = `FEISHU_${key.replaceAll('-', '_').toUpperCase()}_`;
      // 上次扫码已存好凭据但尚未写入绑定时直接补绑定，不能再建一个机器人。
      if (env[prefix + 'APP_ID'] && env[prefix + 'APP_SECRET']) await bindRole(root, source, r.id, key, env);
      else missing.push({ key, name: r.name, desc: r.description, mode: 'projects' });
    }
    if (!missing.length) { log('所有角色已经绑定，不重建。'); return; }
    const lark = await import('@larksuiteoapi/node-sdk'), { default: qrcode } = await import('qrcode'); installRetry(lark.defaultHttpInstance, { log });
    log(`请用飞书手机版扫码，共 ${missing.length} 位未绑定角色。会申请项目群讨论与成员管理权限。`);
    const result = await registerMissing({ lark, qrcode, roles: missing, qrDir: path.join(root, 'qr/team-pack'), log,
      save: async (r, credentials) => {
        const prefix = `FEISHU_${r.key.replaceAll('-', '_').toUpperCase()}_`;
        updateEnv(envFile, { [prefix + 'APP_ID']: credentials.appId, [prefix + 'APP_SECRET']: credentials.appSecret });
        const original = pack.roles.find(x => keyFor(x.id) === r.key);
        await bindRole(root, source, original.id, r.key, readEnv(envFile));
      },
    });
    if (result.some(r => !r.ok)) throw Error('有机器人尚未完成扫码；重跑只补缺失角色');
    log('角色绑定完成。npm start 后可新建飞书项目群。'); return;
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

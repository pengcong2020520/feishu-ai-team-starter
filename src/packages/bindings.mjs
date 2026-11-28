import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { atomicJson, listPackages, latestPackages } from './store.mjs';
import { identifier } from './schema.mjs';

export async function readBindings(root, id) {
  let all; try { all = JSON.parse(await readFile(path.join(root, 'data/team-bindings.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; all = {}; }
  return id ? all[id] || { roles: {} } : all;
}
export async function bindRole(root, packageId, role, bot, env) {
  [packageId, role, bot].forEach(v => identifier.parse(v));
  if (bot === 'admin') throw Error('管理员助手不能兼任项目团队角色');
  const candidates = latestPackages(await listPackages(root)).filter(p => p.id === packageId);
  if (candidates.length > 1) throw Error('同版本有多个包摘要，不能自动选择角色定义');
  const pack = candidates[0];
  if (!pack?.roles.some(r => r.id === role)) throw Error('请先安装包并选择有效角色');
  const prefix = `FEISHU_${bot.replaceAll('-', '_').toUpperCase()}_`;
  if (!env[prefix + 'APP_ID'] || !env[prefix + 'APP_SECRET']) throw Error(`缺少 ${prefix}APP_ID 或 ${prefix}APP_SECRET`);
  const all = await readBindings(root), current = all[packageId] || { roles: {} };
  if (Object.entries(current.roles).some(([r, b]) => r !== role && pack.roles.some(x => x.id === r) && b === bot)) throw Error('一个团队中的每个角色需要独立机器人，不能一个机器人冒充多个角色');
  current.roles[role] = bot; all[packageId] = current; await atomicJson(path.join(root, 'data/team-bindings.json'), all);
  return { packageId, role, bot };
}
export function extraCredentials(env, credentials) {
  const result = { ...credentials };
  for (const key of Object.keys(env)) {
    const m = /^FEISHU_([A-Z][A-Z0-9_]+)_APP_ID$/.exec(key); if (!m || m[1] === 'ADMIN') continue;
    const role = m[1].toLowerCase().replaceAll('_', '-');
    if (!env[`FEISHU_${m[1]}_APP_SECRET`]) throw Error(`缺少 FEISHU_${m[1]}_APP_SECRET`);
    result[role] = { appId: env[key], appSecret: env[`FEISHU_${m[1]}_APP_SECRET`] };
  }
  if (new Set(Object.values(result).map(x => x.appId)).size !== Object.keys(result).length) throw Error('同一飞书应用配置了多个机器人键；请复用绑定而非重复建立连接');
  return result;
}

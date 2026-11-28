import path from 'node:path';
import { readFile, rm } from 'node:fs/promises';
import { latestPackages, listPackages, digest, atomicJson } from './store.mjs';
import { readBindings, bindRole } from './bindings.mjs';
import { readEnv, updateEnv } from '../setup/env-file.mjs';
import { registerMissing, installRetry } from '../setup/register.mjs';
import { qrPage, qrStatusScript } from '../setup/qr-page.mjs';

const prefixFor = key => `FEISHU_${key.replaceAll('-', '_').toUpperCase()}_`;
export const botKey = (id, role) => `${id.slice(0, 20)}-${role.slice(0, 32)}-${digest(id + '/' + role).slice(0, 8)}`;
const active = s => ['preparing', 'scanning', 'connecting'].includes(s?.state);

// 只复用 setup 的正式扫码协议；进程内串行保存，避免多个扫码回调覆盖 .env / 绑定。
export function createPackageConnections({ root, feishu, projects, register = registerMissing, dependencies = async () => {
  const lark = await import('@larksuiteoapi/node-sdk'), { default: qrcode } = await import('qrcode');
  installRetry(lark.defaultHttpInstance); return { lark, qrcode };
} }) {
  let job = null, pending = null, writes = Promise.resolve(), scanRoles = [];
  const envFile = path.join(root, '.env');
  const serial = fn => { const task = writes.then(fn); writes = task.catch(() => {}); return task; };
  const api = {
    status() { return job ? structuredClone(job) : null; },
    async owner(pack, bindings, env) {
      const key = bindings.roles[pack.coordinator], openId = env[prefixFor(key || '') + 'OPEN_ID'];
      if (!openId || !projects) return;
      const person = await projects.observe({ role: key, openId }, '团队创建人');
      const all = await readBindings(root); all[pack.id].localOwnerId = person.id;
      await atomicJson(path.join(root, 'data/team-bindings.json'), all);
    },
    async start(id) {
      if (active(job)) { if (job.packageId === id) return api.status(); throw Error('另一支团队正在扫码，请完成后再连接'); }
      // 在首次 await 之前占位，重复点击只能启动一个注册流程。
      job = { packageId: id, state: 'preparing', startedAt: new Date().toISOString(), roles: [], url: `/connect/${encodeURIComponent(id)}/index.html` };
      try {
        const candidates = latestPackages(await listPackages(root)).filter(p => p.id === id);
        if (candidates.length !== 1) throw Error('请选择唯一的已安装团队版本');
        if (candidates[0].roles.length > 15) throw Error('飞书群最多容纳 15 个机器人，请先调整团队包的角色数');
        const pack = candidates[0], bindings = await readBindings(root, id), env = readEnv(envFile), missing = [];
        job.teamName = pack.name; scanRoles = [];
        for (const role of pack.roles) {
          const key = bindings.roles[role.id] || botKey(id, role.id), prefix = prefixFor(key);
          const hasCredentials = Boolean(env[prefix + 'APP_ID'] && env[prefix + 'APP_SECRET']);
          if (bindings.roles[role.id] && !hasCredentials) throw Error(`${role.name} 的已有绑定缺少凭据，请恢复 .env 后重试`);
          if (hasCredentials && !bindings.roles[role.id]) await bindRole(root, id, role.id, key, env);
          const capabilities = [...new Set(pack.workflow.nodes.flatMap(n => n.type === 'plan' ? [n, ...n.tasks] : n.type === 'task' ? [n] : []).filter(t => t.role === role.id).map(t => t.name))].slice(0, 4);
          job.roles.push({ id: role.id, name: role.name, key, desc: role.description, capabilities, state: hasCredentials ? 'reused' : 'waiting' });
          if (!hasCredentials) missing.push({ key, name: role.name, desc: role.description, capabilities, mode: 'projects', documents: role.id === pack.coordinator });
        }
        const qrDir = path.join(root, 'qr/team-pack', id);
        await rm(qrDir, { recursive: true, force: true }); // 不展示上一轮已过期的二维码。
        job.state = missing.length ? 'scanning' : 'connecting';
        pending = (async () => {
          if (missing.length) {
            const deps = await dependencies();
            const results = await register({ ...deps, roles: missing, qrDir, teamName: pack.name, onUpdate: state => { scanRoles = state.roles; }, open: () => {}, log: () => {},
              save: (role, credential) => serial(async () => {
                const prefix = prefixFor(role.key), record = job.roles.find(r => r.key === role.key);
                updateEnv(envFile, { [prefix + 'APP_ID']: credential.appId, [prefix + 'APP_SECRET']: credential.appSecret, ...(credential.openId ? { [prefix + 'OPEN_ID']: credential.openId } : {}) });
                await bindRole(root, id, record.id, role.key, readEnv(envFile)); record.state = 'created';
              }),
            });
            if (results.some(r => !r.ok)) throw Error('部分角色尚未完成扫码，请重试；已创建的机器人会保留并复用');
          }
          job.state = 'connecting';
          const current = await readBindings(root, id), fresh = readEnv(envFile), credentials = {};
          await api.owner(pack, current, fresh);
          for (const role of pack.roles) { const key = current.roles[role.id], prefix = prefixFor(key); credentials[key] = { appId: fresh[prefix + 'APP_ID'], appSecret: fresh[prefix + 'APP_SECRET'] }; }
          if (!feishu?.connectCredentials) throw Error('当前服务不支持连接机器人，请启动正式团队服务');
          await feishu.connectCredentials(credentials);
          job.state = 'ready'; job.finishedAt = new Date().toISOString();
        })().catch(error => { job.state = 'error'; job.error = error.message; });
        return api.status();
      } catch (error) { job.state = 'error'; job.error = error.message; throw error; }
    },
    async wait() { await pending; return api.status(); },
    async page(id, file) {
      if (!job || job.packageId !== id || !/^(?:index\.html|status\.js|[a-z][a-z0-9-]{0,63}\.png)$/.test(file)) return null;
      if (file === 'index.html' || file === 'status.js') {
        const state = { teamName: job.teamName, phase: job.state, returnUrl: `/#team=${id}`, roles: job.roles.map(role => ({ ...role, ...scanRoles.find(r => r.key === role.key), ...(['created','reused'].includes(role.state) ? { state: role.state, url: null } : {}), ...(job.state === 'error' && !['created','reused'].includes(role.state) ? { state: 'error', url: null } : {}) })) };
        return { type: file === 'status.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', body: file === 'status.js' ? qrStatusScript(state) : qrPage(state) };
      }
      try { return { body: await readFile(path.join(root, 'qr/team-pack', id, file)), type: file.endsWith('.png') ? 'image/png' : 'text/html; charset=utf-8' }; }
      catch (e) { if (e.code !== 'ENOENT') throw e; return file === 'index.html' ? { body: '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="2"><title>连接飞书</title><p>正在准备二维码，请稍候…</p>', type: 'text/html; charset=utf-8' } : null; }
    },
  };
  return api;
}

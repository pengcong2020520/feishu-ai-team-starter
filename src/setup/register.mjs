import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { qrPage, qrStatusScript } from './qr-page.mjs';

// 建应用时一并申请的权限、事件和回调（默认已带建群权限，这里再写一次只增不减）
export const ADDONS = {
  scopes: { tenant: ['im:message', 'im:message:send_as_bot', 'im:message.group_at_msg:readonly', 'im:chat:readonly', 'im:chat:create', 'im:resource'] },
  events: { items: { tenant: ['im.message.receive_v1'] } },
  callbacks: { items: ['card.action.trigger'] },
};
export const PROJECT_ADDONS = { ...ADDONS, scopes: { tenant: [...ADDONS.scopes.tenant, 'im:message.group_msg', 'im:message.p2p_msg:readonly', 'im:chat.members:write_only'] } };

// 管理员助手只在私聊里说话：多要一个读私聊消息的权限
export const ADMIN_ADDONS = { ...ADDONS, scopes: { tenant: ['im:message', 'im:message:send_as_bot', 'im:message.p2p_msg:readonly'] } };

const NETWORK = /ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|ECONNABORTED|socket hang up/i;

// SDK 的扫码轮询遇到网络错误直接失败；在它用的 axios 实例上加重试
export function installRetry(http, { retries = 5, delayMs = 1000, log = () => {} } = {}) {
  if (!http?.interceptors?.response || http.__setupRetry) return;
  http.__setupRetry = true;
  http.interceptors.response.use(undefined, async error => {
    const config = error?.config;
    if (!config || !String(config.url ?? '').includes('/oauth/v1/app/registration')) throw error;
    if (error.response && ![502, 503, 504].includes(error.response.status)) throw error;
    if (!error.response && !NETWORK.test(`${error.code ?? ''} ${error.message ?? ''}`)) throw error;
    const attempt = (config.__setupRetries ?? 0) + 1;
    if (attempt > retries) throw error;
    config.__setupRetries = attempt;
    log(`飞书连接中断，正在重试（${attempt}/${retries}）`);
    await new Promise(resolve => setTimeout(resolve, delayMs * attempt));
    return http.request(config);
  });
}

export async function registerRole({ lark, role, signal, onQr }) {
  let addons = role.p2p ? ADMIN_ADDONS : role.mode === 'projects' || role.existingAppId ? PROJECT_ADDONS : ADDONS;
  if (!role.p2p && role.key === 'product' && !addons.scopes.tenant.includes('im:message.group_msg')) addons = { ...addons, scopes: {tenant:[...addons.scopes.tenant, 'im:message.group_msg']} };
  if (role.documents) addons = { ...addons, scopes: { tenant: [...new Set([...addons.scopes.tenant, 'docx:document', 'docs:permission.member:create'])] } };
  const result = await lark.registerApp({ ...(role.existingAppId ? { appId: role.existingAppId } : { createOnly: true }), signal, appPreset: { name: role.name, desc: role.desc }, addons, onQRCodeReady: onQr });
  if (role.existingAppId && result.client_id !== role.existingAppId) throw Error('返回的应用与现有机器人不一致，已停止，不替换机器人');
  return { appId: result.client_id, appSecret: result.client_secret, openId: result.user_info?.open_id ?? null };
}

export function openFile(file) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : ['xdg-open', [file]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {}
}

export function registrationView(entries, teamName) {
  return { teamName, phase: entries.every(e => e.done || e.error) ? entries.some(e => e.error) ? 'error' : 'created' : 'scanning', roles: entries.map(e => ({ key: e.role.key, name: e.role.name, desc: e.role.desc, capabilities: e.role.capabilities || [], updating: Boolean(e.role.existingAppId), state: e.done ? 'created' : e.error ? 'error' : 'waiting', url: e.url, version: e.version })) };
}

export async function writeQrPage({ qrDir, qrcode, entries, teamName }) {
  mkdirSync(qrDir, { recursive: true });
  for (const e of entries) {
    if (!e.done && !e.error && e.url && e.renderedVersion !== e.version) {
      await qrcode.toFile(path.join(qrDir, `${e.role.key}.png`), e.url, { width: 400, margin: 4 });
      e.renderedVersion = e.version;
    }
  }
  const state = registrationView(entries, teamName);
  writeFileSync(path.join(qrDir, 'status.js'), qrStatusScript(state));
  writeFileSync(path.join(qrDir, 'index.html'), qrPage(state));
}

const timeoutError = () => Object.assign(new Error('等待扫码超时'), { code: 'timeout' });

// 给缺凭证的角色各出一张码并行等待；过期自动换码；每建成一个立即 save
export async function registerMissing({ lark, qrcode, roles, qrDir, save, timeoutMs = 540000, retryDelayMs = 3000, open = openFile, log = console.log, teamName, onUpdate = () => {} }) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const entries = roles.map(role => ({ role, url: null, done: false, version: 0 }));
  let opened = false;
  let writing = Promise.resolve();
  const refresh = () => (writing = writing.then(() => writeQrPage({ qrDir, qrcode, entries, teamName })).then(() => {
    onUpdate(registrationView(entries, teamName));
    if (!opened && entries.every(e => e.url || e.done || e.error)) { opened = true; open(path.join(qrDir, 'index.html')); }
  }));
  const one = async entry => {
    while (!abort.signal.aborted) {
      try {
        const result = await registerRole({
          lark, role: entry.role, signal: abort.signal,
          onQr: info => { entry.url = info.url; entry.version += 1; log(`${entry.role.name}：二维码已就绪，也可以直接打开 ${info.url}`); refresh(); },
        });
        await save(entry.role, result);
        entry.done = true;
        entry.url = null;
        log(`${entry.role.name}：已${entry.role.existingAppId ? '更新权限（原机器人保留）' : '创建'}`);
        await refresh();
        return result;
      } catch (error) {
        if (abort.signal.aborted) throw timeoutError();
        if (error?.code === 'expired_token') { log(`${entry.role.name}：二维码过期，换一张`); continue; }
        if (!NETWORK.test(`${error?.code ?? ''} ${error?.message ?? ''}`)) throw error;
        // 重试拦截器也没救回来的断网：等一会儿换一张新码（页面会自动刷新），一直试到整体截止
        log(`${entry.role.name}：网络中断，稍后换一张二维码`);
        await new Promise(resolve => setTimeout(resolve, retryDelayMs));
      }
    }
    throw timeoutError();
  };
  try {
    const settled = await Promise.allSettled(entries.map(entry => one(entry).catch(async error => { entry.error = true; entry.url = null; await refresh(); throw error; })));
    await writing;
    return settled.map((s, i) => ({ role: roles[i], ok: s.status === 'fulfilled', error: s.status === 'rejected' ? s.reason : null }));
  } finally {
    clearTimeout(timer);
  }
}

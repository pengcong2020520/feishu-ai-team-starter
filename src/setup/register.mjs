import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';

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
  const addons = role.p2p ? ADMIN_ADDONS : role.mode === 'projects' || role.existingAppId ? PROJECT_ADDONS : ADDONS;
  const result = await lark.registerApp({ ...(role.existingAppId ? { appId: role.existingAppId } : { createOnly: true }), signal, appPreset: { name: role.name, desc: role.desc }, addons, onQRCodeReady: onQr });
  if (role.existingAppId && result.client_id !== role.existingAppId) throw Error('返回的应用与现有机器人不一致，已停止，不替换机器人');
  return { appId: result.client_id, appSecret: result.client_secret, openId: result.user_info?.open_id ?? null };
}

export function openFile(file) {
  const [cmd, args] = process.platform === 'darwin' ? ['open', [file]] : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]] : ['xdg-open', [file]];
  try { spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch {}
}

const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// 只有二维码的本地页面，每 3 秒自己刷新
export async function writeQrPage({ qrDir, qrcode, entries }) {
  mkdirSync(qrDir, { recursive: true });
  const cells = [];
  const updating = entries.some(e => e.role.existingAppId);
  for (const e of entries) {
    let body = '<p>正在生成二维码…</p>';
    if (e.done) body = `<p class="ok">✓ 已${e.role.existingAppId ? '更新权限' : '创建'}</p>`;
    else if (e.url) {
      await qrcode.toFile(path.join(qrDir, `${e.role.key}.png`), e.url, { width: 360, margin: 1 });
      body = `<img src="${e.role.key}.png?v=${e.version}" alt="${esc(e.role.name)} 的二维码"><p><a href="${esc(e.url)}">二维码扫不了时点这里</a></p>`;
    }
    cells.push(`<section><h2>${esc(e.role.name)}</h2>${body}</section>`);
  }
  writeFileSync(path.join(qrDir, 'index.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="refresh" content="3"><title>${updating ? "更新现有机器人权限" : "扫码创建飞书机器人"}</title><style>body{font:16px system-ui;background:#f1f4fa;color:#1f2329;margin:0;padding:32px}h1{font-size:22px}main{display:flex;gap:24px;flex-wrap:wrap}section{background:#fff;border-radius:12px;padding:20px;width:340px;text-align:center;box-shadow:0 4px 16px #0001}img{width:300px;height:300px}.ok{color:#2a9d5c;font-size:20px}</style><h1>${updating ? "用飞书手机版扫码，确认给现有机器人增补权限（不新建）" : "用飞书手机版逐个扫码，并在手机上确认创建"}</h1><main>${cells.join('')}</main></html>`);
}

const timeoutError = () => Object.assign(new Error('等待扫码超时'), { code: 'timeout' });

// 给缺凭证的角色各出一张码并行等待；过期自动换码；每建成一个立即 save
export async function registerMissing({ lark, qrcode, roles, qrDir, save, timeoutMs = 540000, retryDelayMs = 3000, open = openFile, log = console.log }) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  const entries = roles.map(role => ({ role, url: null, done: false, version: 0 }));
  let opened = false;
  let writing = Promise.resolve();
  const refresh = () => (writing = writing.then(() => writeQrPage({ qrDir, qrcode, entries })).then(() => {
    if (!opened && entries.every(e => e.url || e.done)) { opened = true; open(path.join(qrDir, 'index.html')); }
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
    const settled = await Promise.allSettled(entries.map(one));
    await writing;
    return settled.map((s, i) => ({ role: roles[i], ok: s.status === 'fulfilled', error: s.status === 'rejected' ? s.reason : null }));
  } finally {
    clearTimeout(timer);
  }
}

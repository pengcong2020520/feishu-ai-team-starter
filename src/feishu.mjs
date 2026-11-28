import { projectGroupName } from './project-labels.mjs';
import * as Lark from '@larksuiteoapi/node-sdk';
import { cardView } from './workbench/recorder.mjs';
import { createFeishuLogger } from './feishu-logger.mjs';
import { createMessageReceiver, eventIdentity } from './projects/events.mjs';
import { recipient } from './projects/directory.mjs';
import { documentTransport } from './feishu-documents.mjs';

const err = e => {
  const d = e?.response?.data;
  const fields = d?.error?.field_violations?.map(v => `${v.field}: ${v.description}`).join('；');
  return Object.assign(new Error(`${e?.message ?? '飞书请求失败'}${d?.code != null ? `（code ${d.code}，msg ${d.msg ?? ''}）` : ''}${fields ? ` ${fields}` : ''}`), { feishuCode: d?.code ?? e?.feishuCode });
};
const check = r => {
  if (r?.code && r.code !== 0) throw Object.assign(new Error(`飞书调用失败（code ${r.code}，msg ${r.msg ?? ''}）`), { feishuCode: r.code });
  return r;
};

// 飞书限频（单条消息每秒最多更新 5 次；用户刚点过的卡片马上更新也可能被限）时退避重试，
// 不把偶发限频变成要用户手动“重试”的错误
const RATE_LIMITED = new Set([230020, 230429, 99991400]);
export const rateLimited = e => e?.response?.status === 429 || RATE_LIMITED.has(e?.response?.data?.code) || RATE_LIMITED.has(e?.feishuCode);
export async function withRetry(fn, { delays = [1000, 2000, 4000], sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    try { return check(await fn()); } catch (e) {
      if (attempt >= delays.length || !rateLimited(e)) throw err(e);
      await sleep(delays[attempt]);
    }
  }
}

// 上传图片、文件可能经网络或代理挂住：最多等 60 秒，超时就当失败处理，不让流程一直卡着
export const timed = (promise, ms, what) => {
  let timer;
  const limit = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}超过 ${Math.round(ms / 1000)} 秒没完成`)), ms); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
};

export function createFeishu({ credentials, onMessage, onAction, onDiscussion, onUnaddressed, observe, shouldRecord, recorder, roleOrder, logger = console, uploadMs = 60000, sdk = Lark }) {
  const names = Object.keys(credentials);
  const sdkLogger = createFeishuLogger(logger);
  const clients = Object.fromEntries(names.map(role => [role, new sdk.Client({ ...credentials[role], logger: sdkLogger })]));
  const sockets = [];
  const connected = new Set(), connecting = new Map();
  const ids = new Map();
  const receive = createMessageReceiver({ ids, onMessage, onDiscussion, onUnaddressed, observe, shouldRecord, recorder, roleOrder: roleOrder || names });
  const owner = new Map();
  const cardChats = new Map();
  const pick = (chatId, role) => clients[role ?? owner.get(chatId) ?? 'product'];
  const call = fn => withRetry(fn);
  const api = {
    documents(role) { if (!clients[role]) throw Error('文档机器人尚未连接'); return documentTransport(clients[role], call); },
    async sendText(chatId, text, role, { record = true } = {}) {
      const r = await call(() => pick(chatId, role).im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) } }));
      if (record) await recorder?.add(chatId, { kind: 'text', messageId: r.data?.message_id, role: role ?? owner.get(chatId) ?? 'product', text });
      return r.data?.message_id;
    },
    async sendCard(chatId, card, role) {
      const r = await call(() => pick(chatId, role).im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) } }));
      cardChats.set(r.data?.message_id, chatId);
      await recorder?.add(chatId, { kind: 'card', messageId: r.data?.message_id, role: role ?? owner.get(chatId) ?? 'product', card: cardView(card) });
      return r.data?.message_id;
    },
    async patchCard(messageId, card, role = 'product', chatId = cardChats.get(messageId)) {
      await call(() => clients[role].im.v1.message.patch({ path: { message_id: messageId }, data: { content: JSON.stringify(card) } }));
      if (chatId) await recorder?.add(chatId, { kind: 'card_update', messageId, role, card: cardView(card) });
    },
    async uploadImage(filePath, role = 'product') {
      const { createReadStream } = await import('node:fs');
      const upload = await timed(call(() => clients[role].im.v1.image.create({ data: { image_type: 'message', image: createReadStream(filePath) } })), uploadMs, '上传图片');
      const key = upload?.data?.image_key ?? upload?.image_key;
      if (!key) throw new Error('飞书上传图片成功但没有 image_key');
      return key;
    },
    async sendFile(chatId, filePath, role = 'product') {
      const { createReadStream } = await import('node:fs');
      const upload = await timed(call(() => clients[role].im.v1.file.create({ data: { file_type: 'stream', file_name: 'index.html', file: createReadStream(filePath) } })), uploadMs, '上传网页文件');
      const r = await call(() => clients[role].im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'file', content: JSON.stringify({ file_key: upload.data?.file_key ?? upload.file_key }) } }));
      return r.data?.message_id;
    },
    async listChats(role = 'product') {
      const items = []; let page_token;
      do { const r = await call(() => clients[role].im.v1.chat.list({ params: { page_size: 100, page_token } })); items.push(...r.data?.items || []); page_token = r.data?.has_more ? r.data.page_token : null; } while (page_token);
      return items;
    },
    connectedRoles: () => [...connected],
    async connectCredentials(additions) {
      for (const [role, credential] of Object.entries(additions)) {
        if (credentials[role] && credentials[role].appId !== credential.appId) throw Error('不能替换正在使用的机器人');
        if (Object.entries(credentials).some(([key, value]) => key !== role && value.appId === credential.appId)) throw Error('同一应用只能建立一条连接');
        if (!clients[role]) { credentials[role] = credential; clients[role] = new sdk.Client({ ...credential, logger: sdkLogger }); names.push(role); }
        await api.startRole(role);
      }
    },
    async listMembers(chatId, role = 'product') {
      const items = []; let page_token;
      do {
        const r = await call(() => clients[role].im.v1.chatMembers.get({ path: { chat_id: chatId }, params: { member_id_type: 'union_id', page_size: 100, page_token } }));
        items.push(...(r.data?.items || []).map(p => ({ name: p.name, identity: { unionId: p.member_id } })));
        page_token = r.data?.has_more ? r.data.page_token : null;
      } while (page_token);
      return items;
    },
    async addMembers(chatId, people, role = 'product') {
      for (const type of ['union_id', 'user_id', 'open_id']) {
        const ids = people.map(p => recipient(p, role)).filter(p => p?.type === type).map(p => p.id);
        if (!ids.length) continue;
        const r = await call(() => clients[role].im.v1.chatMembers.create({ path: { chat_id: chatId }, params: { member_id_type: type }, data: { id_list: ids } }));
        if (r.data?.invalid_id_list?.length || r.data?.not_existed_id_list?.length || r.data?.pending_approval_id_list?.length) throw Error('部分成员未成功入群，请检查应用可用范围或群加人审批');
      }
    },
    async createProjectGroup({ projectId, name, groupLabel = '筑页', team, botRoles = ['product', 'designer', 'developer'] }) {
      const creator = botRoles[0];
      if (botRoles.length > 15) throw Error('飞书群最多容纳 15 个机器人，请缩小团队');
      if (!creator || botRoles.some(role => !clients[role])) throw Error('本团队还有机器人未连接');
      const owner = recipient(team.people.find(p => p.id === team.ownerId), creator);
      if (!owner) throw Error('项目负责人缺少飞书身份');
      const r = await call(() => clients[creator].im.v1.chat.create({ params: { user_id_type: owner.type, set_bot_manager: true, uuid: `project-${projectId}`.slice(0, 50) }, data: {
        name: projectGroupName(name, groupLabel), description: '本群对应一个独立项目。讨论完整留档；@ AI 同事交流，按确认卡推进。',
        owner_id: owner.id, user_id_list: [owner.id], bot_id_list: botRoles.filter(role => role !== creator).slice(0, 5).map(role => credentials[role].appId),
      } }));
      const chatId = r.data?.chat_id;
      if (!chatId) throw Error('创建项目群没有返回群号');
      return chatId;
    },
    async renameChat(chatId, name, role = 'product') {
      await call(() => clients[role].im.v1.chat.update({ path: { chat_id: chatId }, data: { name } }));
    },
    async addBots(chatId, botRoles, creator) {
      if (botRoles.length > 5) throw Error('每批最多邀请 5 个机器人');
      const r = await call(() => clients[creator].im.v1.chatMembers.create({ path: { chat_id: chatId }, params: { member_id_type: 'app_id' }, data: { id_list: botRoles.map(role => credentials[role].appId) } }));
      if (r.data?.invalid_id_list?.length || r.data?.not_existed_id_list?.length || r.data?.pending_approval_id_list?.length) throw Error('部分团队机器人尚未入群，请处理群审批或应用可用范围后重试');
    },
    async start() {
      for (const role of names) await api.startRole(role);
    },
    async startRole(role) {
      if (connected.has(role)) return;
      if (connecting.has(role)) return connecting.get(role);
      const job = (async () => {
        const bot = await call(() => clients[role].request({ method: 'GET', url: '/open-apis/bot/v3/info' }));
        ids.set(role, bot.bot?.open_id ?? bot.data?.bot?.open_id);
        const dispatcher = new sdk.EventDispatcher({ logger: sdkLogger }).register({
          'im.message.receive_v1': async data => {
            try { await receive(data, role); } catch (e) { logger.error(err(e).message); }
          },
          'card.action.trigger': async data => {
            const chatId = data.context?.open_chat_id ?? data.open_chat_id;
            if (!chatId) return { toast: { type: 'error', content: '无法识别群聊' } };
            owner.set(chatId, role);
            try {
              const value = data.action?.value;
              if (value?.projectId === 'test') {
                await recorder?.add(chatId, { kind: 'action', role, action: value?.action ?? '', accepted: false, reason: '测试卡片', value });
                return { toast: { type: 'info', content: '这是测试卡片，不会推动流程，请点正式卡片' } };
              }
              const identity = eventIdentity(data.operator, role);
              const person = await observe?.(identity, data.operator?.name);
              await recorder?.add(chatId, { kind: 'action', role, action: value?.action ?? '', value, actor: person?.name ?? data.operator?.name ?? '群成员', identity, source: '飞书' });
              return await onAction({ chatId, value, formValue: data.action?.form_value ?? {}, actor: person?.name ?? data.operator?.name ?? '你', identity, source: 'feishu' });
            }
            catch (e) { logger.error(err(e).message); return { toast: { type: 'error', content: '操作失败，请查看服务日志' } }; }
          },
        });
        const socket = new sdk.WSClient({ ...credentials[role], logger: sdkLogger });
        try { await socket.start({ eventDispatcher: dispatcher }); sockets.push(socket); connected.add(role); }
        catch (error) { socket.close(); throw error; }
      })();
      connecting.set(role, job);
      try { await job; } finally { connecting.delete(role); }
    },
    close() { for (const socket of sockets) socket.close(); },
  };
  return api;
}

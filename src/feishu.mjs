import * as Lark from '@larksuiteoapi/node-sdk';
import { cardView } from './workbench/recorder.mjs';

const names = ['product', 'designer', 'developer'];
const err = e => {
  const d = e?.response?.data;
  return new Error(`${e?.message ?? '飞书请求失败'}${d?.code != null ? `（code ${d.code}，msg ${d.msg ?? ''}）` : ''}`);
};
const check = r => {
  if (r?.code && r.code !== 0) throw new Error(`飞书调用失败（code ${r.code}，msg ${r.msg ?? ''}）`);
  return r;
};

export function createFeishu({ credentials, onMessage, onAction, recorder, logger = console }) {
  const clients = Object.fromEntries(names.map(role => [role, new Lark.Client({ ...credentials[role], loggerLevel: Lark.LoggerLevel.error })]));
  const sockets = [];
  const ids = new Map();
  const seen = new Set();
  const owner = new Map();
  const cardChats = new Map();
  const pick = (chatId, role) => clients[role ?? owner.get(chatId) ?? 'product'];
  const call = async promise => { try { return check(await promise); } catch (e) { throw err(e); } };
  const api = {
    async sendText(chatId, text, role) {
      const r = await call(pick(chatId, role).im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'text', content: JSON.stringify({ text }) } }));
      await recorder?.add(chatId, { kind: 'text', role: role ?? owner.get(chatId) ?? 'product', text });
      return r.data?.message_id;
    },
    async sendCard(chatId, card, role) {
      const r = await call(pick(chatId, role).im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(card) } }));
      cardChats.set(r.data?.message_id, chatId);
      await recorder?.add(chatId, { kind: 'card', messageId: r.data?.message_id, role: role ?? owner.get(chatId) ?? 'product', card: cardView(card) });
      return r.data?.message_id;
    },
    async patchCard(messageId, card, role = 'product', chatId = cardChats.get(messageId)) {
      await call(clients[role].im.v1.message.patch({ path: { message_id: messageId }, data: { content: JSON.stringify(card) } }));
      if (chatId) await recorder?.add(chatId, { kind: 'card_update', messageId, role, card: cardView(card) });
    },
    async uploadImage(filePath, role = 'product') {
      const { createReadStream } = await import('node:fs');
      const upload = await call(clients[role].im.v1.image.create({ data: { image_type: 'message', image: createReadStream(filePath) } }));
      const key = upload?.data?.image_key ?? upload?.image_key;
      if (!key) throw new Error('飞书上传图片成功但没有 image_key');
      return key;
    },
    async sendFile(chatId, filePath, role = 'product') {
      const { createReadStream } = await import('node:fs');
      const upload = await call(clients[role].im.v1.file.create({ data: { file_type: 'stream', file_name: 'index.html', file: createReadStream(filePath) } }));
      const r = await call(clients[role].im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'file', content: JSON.stringify({ file_key: upload.data?.file_key ?? upload.file_key }) } }));
      return r.data?.message_id;
    },
    async listChats(role = 'product') {
      const r = await call(clients[role].im.v1.chat.list({ params: { page_size: 100 } }));
      return r.data?.items ?? [];
    },
    async start() {
      for (const role of names) {
        const bot = await call(clients[role].request({ method: 'GET', url: '/open-apis/bot/v3/info' }));
        ids.set(role, bot.bot?.open_id ?? bot.data?.bot?.open_id);
        const dispatcher = new Lark.EventDispatcher({}).register({
          'im.message.receive_v1': async data => {
            try {
              const m = data.message ?? {};
              if (data.sender?.sender_type !== 'user' || !m.message_id || seen.has(m.message_id)) return;
              if (m.chat_type === 'group' && !m.mentions?.some(x => x.id?.open_id === ids.get(role) || x.id === ids.get(role))) return;
              seen.add(m.message_id);
              if (seen.size > 5000) seen.clear();
              const chatId = m.chat_id;
              owner.set(chatId, role);
              const content = JSON.parse(m.content ?? '{}');
              const text = String(content.text ?? '').replace(/@_user_\d+/g, '').trim();
              if (text) { await recorder?.add(chatId, { kind: 'user', role, text }); await onMessage({ chatId, role, text, senderType: 'user', user: data.sender?.sender_id?.open_id }); }
            } catch (e) { logger.error(err(e).message); }
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
              await recorder?.add(chatId, { kind: 'action', role, action: value?.action ?? '', value, source: '飞书' });
              return await onAction({ chatId, value, formValue: data.action?.form_value ?? {}, actor: data.operator?.name ?? '你' });
            }
            catch (e) { logger.error(err(e).message); return { toast: { type: 'error', content: '操作失败，请查看服务日志' } }; }
          },
        });
        const socket = new Lark.WSClient({ ...credentials[role], loggerLevel: Lark.LoggerLevel.error });
        await socket.start({ eventDispatcher: dispatcher });
        sockets.push(socket);
      }
    },
    close() { for (const socket of sockets) socket.close(); },
  };
  return api;
}

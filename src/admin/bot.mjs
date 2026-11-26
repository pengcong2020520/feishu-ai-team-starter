// AI 管理员助手的长连接：只在私聊里、只听管理员一个人（扫第 4 张码的人）
import * as Lark from '@larksuiteoapi/node-sdk';
import { withRetry } from '../feishu.mjs';

export function createAdminBot({ appId, appSecret, adminOpenId, onMessage, onAction, logger = console, lark = Lark }) {
  const client = new lark.Client({ appId, appSecret, loggerLevel: lark.LoggerLevel.error });
  const seen = new Set();
  let socket = null;
  const create = (type, id, msgType, content) => withRetry(() => client.im.v1.message.create({ params: { receive_id_type: type }, data: { receive_id: id, msg_type: msgType, content: JSON.stringify(content) } })).then(r => r.data?.message_id);
  const api = {
    sendText: text => create('open_id', adminOpenId, 'text', { text }),
    sendCard: card => create('open_id', adminOpenId, 'interactive', card),
    patchCard: (messageId, card) => withRetry(() => client.im.v1.message.patch({ path: { message_id: messageId }, data: { content: JSON.stringify(card) } })),
    handlers: {
      'im.message.receive_v1': async data => {
        try {
          const m = data.message ?? {};
          if (data.sender?.sender_type !== 'user' || m.chat_type !== 'p2p' || !m.message_id || seen.has(m.message_id)) return;
          seen.add(m.message_id);
          if (seen.size > 5000) seen.clear();
          if (data.sender?.sender_id?.open_id !== adminOpenId) { await create('chat_id', m.chat_id, 'text', { text: '我只听管理员的。' }); return; }
          let text = '';
          try { text = String(JSON.parse(m.content ?? '{}').text ?? '').replace(/@_user_\d+/g, '').trim(); } catch {}
          if (!text) { await api.sendText('我只看得懂文字消息。'); return; }
          // 不等处理完：重启之类的要几十秒，长连接的事件要尽快回
          void Promise.resolve(onMessage({ text })).catch(error => logger.error(`管理员助手处理消息出错：${error.message}`));
        } catch (error) { logger.error(`管理员助手收消息出错：${error.message}`); }
      },
      'card.action.trigger': async data => {
        if (data.operator?.open_id !== adminOpenId) return { toast: { type: 'error', content: '只有管理员能点' } };
        try { return await onAction({ value: data.action?.value ?? {}, messageId: data.context?.open_message_id }); }
        catch (error) { logger.error(`管理员助手处理按钮出错：${error.message}`); return { toast: { type: 'error', content: '没点成。请再发“状态”看一下；还不行，让搭团队的助手看 data/service.log。' } }; }
      },
    },
    async start() {
      // 先查一次机器人信息：凭证不对在这里就报出来
      await withRetry(() => client.request({ method: 'GET', url: '/open-apis/bot/v3/info' }));
      socket = new lark.WSClient({ appId, appSecret, loggerLevel: lark.LoggerLevel.error });
      await socket.start({ eventDispatcher: new lark.EventDispatcher({}).register(api.handlers) });
    },
    close() { socket?.close(); },
  };
  return api;
}

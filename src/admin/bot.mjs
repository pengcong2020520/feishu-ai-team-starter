// AI 管理员助手的长连接：只在私聊里、只听管理员一个人（扫第 4 张码的人）
import * as Lark from '@larksuiteoapi/node-sdk';
import { withRetry } from '../feishu.mjs';
import { createFeishuLogger } from '../feishu-logger.mjs';
import { eventIdentity } from '../projects/events.mjs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export function createAdminBot({ appId, appSecret, adminOpenId, onMessage, onAction, onIdentity, importDirectory, logger = console, lark = Lark }) {
  const sdkLogger = createFeishuLogger(logger);
  const client = new lark.Client({ appId, appSecret, logger: sdkLogger });
  const seen = new Set();
  let socket = null;
  const withinMinute = async task => { let timer;try{return await Promise.race([task,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('文件传输超过一分钟，请重试')),60000);})]);}finally{clearTimeout(timer);} };
  const create = (type, id, msgType, content) => withRetry(() => client.im.v1.message.create({ params: { receive_id_type: type }, data: { receive_id: id, msg_type: msgType, content: JSON.stringify(content) } })).then(r => r.data?.message_id);
  const api = {
    sendText: text => create('open_id', adminOpenId, 'text', { text }),
    sendCard: card => create('open_id', adminOpenId, 'interactive', card),
    async sendFile(file) {
      const upload = await withinMinute(withRetry(() => client.im.v1.file.create({ data: { file_type:'stream', file_name:path.basename(file), file:createReadStream(file) } })));
      const key=upload.data?.file_key||upload.file_key;if(!key)throw Error('飞书文件上传未返回文件编号');
      return create('open_id',adminOpenId,'file',{file_key:key});
    },
    patchCard: (messageId, card) => withRetry(() => client.im.v1.message.patch({ path: { message_id: messageId }, data: { content: JSON.stringify(card) } })),
    handlers: {
      'im.message.receive_v1': async data => {
        try {
          const m = data.message ?? {};
          if (data.sender?.sender_type !== 'user' || m.chat_type !== 'p2p' || !m.message_id || seen.has(m.message_id)) return;
          seen.add(m.message_id);
          if (seen.size > 5000) seen.clear();
          if (data.sender?.sender_id?.open_id !== adminOpenId) { await create('chat_id', m.chat_id, 'text', { text: '我只听管理员的。' }); return; }
          const origin = { source: 'feishu-private', messageId: m.message_id, chatId: m.chat_id, senderOpenId: data.sender.sender_id.open_id, platformTime: m.create_time || null, kind: m.message_type };
          if(m.message_type==='file' && importDirectory){
            const info=JSON.parse(m.content||'{}');
            if(!String(info.file_name||'').endsWith('.team.json')||!info.file_key){await api.sendText('请发送 .team.json 团队包，或直接发 GitHub 固定提交的团队包链接。');return;}
            await onIdentity?.(eventIdentity(data.sender.sender_id,'admin'),data.sender.name);
            void (async()=>{
              await mkdir(importDirectory,{recursive:true});const file=path.join(importDirectory,randomUUID()+'.team.json');let stream;
              try{
                const resource=await withinMinute(withRetry(()=>client.im.v1.messageResource.get({path:{message_id:m.message_id,file_key:info.file_key},params:{type:'file'}})));
                stream=resource.getReadableStream();const chunks=[];let size=0;
                await withinMinute((async()=>{for await(const chunk of stream){size+=chunk.length;if(size>24*1024*1024)throw Error('团队包不能超过 24 MB');chunks.push(chunk);}})());
                const bytes=Buffer.concat(chunks),bundle=JSON.parse(bytes);if(bundle.format!=='feishu-team-bundle/1')throw Error('不是支持的团队包格式');
                await writeFile(file,bytes,{mode:0o600});
                await onMessage({...origin, displayText:`[团队包附件] ${info.file_name}`, text:`管理员发来一个团队包，请导入为个人团队草稿，不应用正式版本。已保存到 ${file}。先校验内容，保留原来源和许可。`});
              }catch(e){stream?.destroy();await rm(file,{force:true});logger.error(`管理员团队包接收失败${e.response?.data?.code ? `（飞书 code ${e.response.data.code}）` : ''}`);await api.sendText('团队包接收失败，请检查文件格式与机器人消息资源权限后重试。');}
            })().catch(()=>logger.error('管理员团队包处理未完成，请重试'));return;
          }
          let text = '';
          try { text = String(JSON.parse(m.content ?? '{}').text ?? '').replace(/@_user_\d+/g, '').trim(); } catch {}
          if (!text) { await api.sendText('我只看得懂文字消息。'); return; }
          await onIdentity?.(eventIdentity(data.sender.sender_id, 'admin'), data.sender.name);
          // 不等处理完：重启之类的要几十秒，长连接的事件要尽快回
          void Promise.resolve(onMessage({ ...origin, text })).catch(error => logger.error(`管理员助手处理消息出错：${error.message}`));
        } catch (error) { logger.error(`管理员助手收消息出错：${error.message}`); }
      },
      'card.action.trigger': async data => {
        if (data.operator?.open_id !== adminOpenId) return { toast: { type: 'error', content: '只有管理员能点' } };
        try { await onIdentity?.(eventIdentity(data.operator, 'admin'), data.operator.name); return await onAction({ value: data.action?.value ?? {}, messageId: data.context?.open_message_id, source:'feishu-card', senderOpenId:data.operator.open_id, chatId:data.context?.open_chat_id }); }
        catch (error) { logger.error(`管理员助手处理按钮出错：${error.message}`); return { toast: { type: 'error', content: '没点成。请再发“状态”看一下；还不行，让搭团队的助手看 data/service.log。' } }; }
      },
    },
    async start() {
      // 先查一次机器人信息：凭证不对在这里就报出来
      await withRetry(() => client.request({ method: 'GET', url: '/open-apis/bot/v3/info' }));
      socket = new lark.WSClient({ appId, appSecret, logger: sdkLogger });
      await socket.start({ eventDispatcher: new lark.EventDispatcher({ logger: sdkLogger }).register(api.handlers) });
    },
    close() { socket?.close(); },
  };
  return api;
}

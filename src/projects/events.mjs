// 群消息完整留档；只有被点名的角色进入原编排。多个机器人收到同一事件只记一次。
export function eventIdentity(sender, role) {
  return { role, openId: sender?.open_id, unionId: sender?.union_id, userId: sender?.user_id };
}
export function messageContent(message, botIds = []) {
  let content; try { content = JSON.parse(message.content || '{}'); } catch { return { text: '[无法解析的消息]', attachments: [] }; }
  const attachments = [];
  let text = '';
  if (message.message_type === 'post') {
    const post = content.zh_cn || content.en_us || content;
    text = [post.title, ...(post.content || []).map(line => line.map(part => part.text || (part.tag === 'at' ? `@${part.user_name || '成员'}` : part.tag === 'img' ? '[图片]' : '')).join(''))].filter(Boolean).join('\n');
    for (const line of post.content || []) for (const item of line) if (item.image_key) attachments.push({ type: 'image', key: item.image_key });
  } else if (message.message_type === 'text' || !message.message_type) text = String(content.text || '');
  else {
    const label = { image: '图片', file: '文件', audio: '语音', media: '视频', merge_forward: '合并转发', interactive: '卡片', share_chat: '分享群' }[message.message_type] || message.message_type;
    text = `[${label}${content.file_name ? `：${content.file_name}` : ''}]`;
    attachments.push({ type: message.message_type, key: content.file_key || content.image_key || null, name: content.file_name || null });
  }
  for (const mention of message.mentions || []) if (typeof mention.key === 'string' && mention.key) text = text.replaceAll(mention.key, botIds.includes(mention.id?.open_id || mention.id) ? '' : `@${mention.name || '成员'}`);
  return { text: text.trim(), attachments };
}

export function createMessageReceiver({ ids, onMessage, onDiscussion, onUnaddressed, observe, recorder, shouldRecord = async () => true, roleOrder = ['product', 'designer', 'developer'] }) {
  const recorded = new Set(), dispatched = new Set();
  const queues = new Map();
  const order = roleOrder;
  const receive = async (data, receivingRole) => {
    const m = data.message || {};
    if (data.sender?.sender_type !== 'user' || !m.message_id) return;
    const identity = eventIdentity(data.sender.sender_id, receivingRole);
    if (!await shouldRecord(m.chat_id, m.chat_type, m)) return;
    const person = await observe?.(identity, data.sender.name);
    const actor = person?.name || data.sender.name || '群成员';
    const { text, attachments } = messageContent(m, [...ids.values()]);
    const replyContext = { replyToMessageId: m.parent_id || null, threadRootMessageId: m.root_id || null, attachments };
    const orderedRoles = typeof order === 'function' ? await order(m.chat_id) : order;
    const targets = m.chat_type === 'p2p' ? [receivingRole] : orderedRoles.filter(role => m.mentions?.some(x => (x.id?.open_id || x.id) === ids.get(role)));
    if (!recorded.has(m.message_id)) {
      recorded.add(m.message_id);
      await recorder?.add(m.chat_id, { kind: 'user', role: targets[0] || null, targetRoles: targets, text, actor, identity, messageId: m.message_id, source: '飞书', ...replyContext, sentAt: m.create_time });
      await onDiscussion?.({ chatId: m.chat_id });
      // 只交给会话接续规则一次；有任何真实 @ 时，留给相应应用处理，不能误接到旧角色。
      if (m.chat_type === 'group' && !m.mentions?.length && text) await onUnaddressed?.({ chatId: m.chat_id, chatType: m.chat_type, text, senderType: 'user', identity, actor, source: 'feishu', messageId: m.message_id, ...replyContext });
    }
    for (const role of targets) {
      const key = `${m.message_id}:${role}`;
      if (dispatched.has(key)) continue;
      dispatched.add(key);
      await onMessage({ chatId: m.chat_id, chatType: m.chat_type, role, text: text || '请说明本项目的现状和下一步。', senderType: 'user', user: identity.openId, identity, actor, source: 'feishu', messageId: m.message_id, mentionCount: m.mentions?.length || 0, ...replyContext });
    }
    if (recorded.size > 10000) { for (const key of [...recorded].slice(0, 5000)) recorded.delete(key); }
    if (dispatched.size > 30000) { for (const key of [...dispatched].slice(0, 15000)) dispatched.delete(key); }
  };
  return (data, role) => {
    const chatId = data.message?.chat_id;
    const task = (queues.get(chatId) || Promise.resolve()).catch(() => {}).then(() => receive(data, role));
    queues.set(chatId, task);
    void task.finally(() => { if (queues.get(chatId) === task) queues.delete(chatId); }).catch(() => {});
    return task;
  };
}

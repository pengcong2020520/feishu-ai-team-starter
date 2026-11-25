// 产品经理建群「AI 团队」：用户当群主、拉另外两个机器人；设不上群主就改用群分享链接
const call = async promise => {
  let res;
  try { res = await promise; } catch (error) {
    const d = error?.response?.data;
    if (d?.code != null) throw Object.assign(new Error(`飞书调用失败（code ${d.code}，msg ${d.msg ?? ''}）`), { code: d.code });
    throw error;
  }
  if (res?.code) throw Object.assign(new Error(`飞书调用失败（code ${res.code}，msg ${res.msg ?? ''}）`), { code: res.code });
  return res;
};

export function introCard(role, { workbench }) {
  const elements = [{ tag: 'div', text: { tag: 'lark_md', content: `大家好，我是 **${role.name}**。${role.intro}` } }];
  if (role.key === 'product') elements.push({ tag: 'div', text: { tag: 'lark_md', content: `在群里 **@${role.name}** 说说想做什么网页，说清了我会发一张卡片，点“就按这个开始”就开工。\n<font color='grey'>本机工作台：${workbench}</font>` } });
  return { config: { wide_screen_mode: true }, header: { template: role.color, title: { tag: 'plain_text', content: `${role.name} · 报到` } }, elements };
}

export async function createTeamGroup({ clients, appIds, team, ownerOpenId, existing = null, onChat = () => {}, workbench = 'http://127.0.0.1:4870', log = console.log }) {
  const pm = clients.product;
  const data = { name: 'AI 团队', description: '飞书 AI 团队：@AI 产品经理 说一句需求就能开始', bot_id_list: team.filter(r => r.key !== 'product').map(r => appIds[r.key]) };
  const uuid = `ai-team-${appIds.product}`.slice(0, 50);
  // 续跑时沿用上次真实的群号、是否当上群主、分享链接
  let { chatId = null, ownerSet = false, joinLink = null } = existing ?? {};
  if (!chatId && ownerOpenId) {
    try {
      const res = await call(pm.im.v1.chat.create({ params: { user_id_type: 'open_id', set_bot_manager: true, uuid }, data: { ...data, owner_id: ownerOpenId, user_id_list: [ownerOpenId] } }));
      chatId = res.data.chat_id;
      ownerSet = true;
    } catch (error) {
      log(`用你的账号当群主没成功（${error.message}），改用群分享链接`);
    }
  }
  if (!chatId) {
    const res = await call(pm.im.v1.chat.create({ params: { set_bot_manager: true, uuid: `${uuid}-link`.slice(0, 50) }, data }));
    chatId = res.data.chat_id;
  }
  if (!ownerSet && !joinLink) {
    try {
      const link = await call(pm.im.v1.chat.link({ path: { chat_id: chatId }, data: { validity_period: 'week' } }));
      joinLink = link.data?.share_link ?? null;
    } catch (error) {
      log(`生成群分享链接没成功（${error.message}）`);
    }
  }
  onChat({ chatId, ownerSet, joinLink });
  for (const role of team) {
    await call(clients[role.key].im.v1.message.create({ params: { receive_id_type: 'chat_id' }, data: { receive_id: chatId, msg_type: 'interactive', content: JSON.stringify(introCard(role, { workbench })) } }));
  }
  return { chatId, ownerSet, joinLink };
}

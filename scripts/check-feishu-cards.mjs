import { createFeishu } from '../src/feishu.mjs';
import { progressCard, questionCard, gateCard, completeCard } from '../src/flow/cards.mjs';

process.loadEnvFile();
const credentials = Object.fromEntries(['product', 'designer', 'developer'].map(role => [role, { appId: process.env[`FEISHU_${role.toUpperCase()}_APP_ID`], appSecret: process.env[`FEISHU_${role.toUpperCase()}_APP_SECRET`] }]));
const feishu = createFeishu({ credentials, onMessage: async () => {}, onAction: async () => ({ toast: { type: 'info', content: '测试卡片，请勿点击' } }) });
const all = await Promise.all(['product', 'designer', 'developer'].map(async role => ({ role, chats: await feishu.listChats(role) })));
for (const { role, chats } of all) console.log(`${role} 群列表：${chats.map(x => `${x.name ?? '未命名'}(${x.chat_id})`).join('、') || '空'}`);
const ids = all.map(x => new Set(x.chats.map(c => c.chat_id)));
const common = [...ids[0]].filter(id => ids.every(set => set.has(id)));
if (common.length !== 1) throw new Error(`无法唯一确定三位机器人共同所在的群（共 ${common.length} 个）；未发送测试卡片`);
const chatId = common[0];
const samples = [
  ['进度', progressCard({ title: '测试，请勿点击 · AI 产品经理 · 澄清需求', detail: '读取 docs/questions.json', stats: { durationMs: 3000, inputTokens: 100, outputTokens: 20 } }), 'product'],
  ['问题', questionCard({ projectId: 'test', cardId: 'test', questions: { round: 1, why: '测试，请勿点击', questions: [{ id: 'q1', question: '测试问题', options: ['选项一', '选项二'], recommended: 0 }] } }), 'product'],
  ...['confirm_prd', 'confirm_design', 'accept'].map((stage, i) => [stage, gateCard({ stage, projectId: 'test', cardId: 'test', title: `测试 · ${['确认 PRD', '确认设计', '验收'][i]}`, description: '仅验证卡片能发送', links: [{ label: '测试链接', url: 'http://127.0.0.1:4871' }] }), ['product', 'designer', 'developer'][i]]),
  ['完成', completeCard({ url: 'http://127.0.0.1:4871' }), 'product'],
];
for (const [label, card, role] of process.argv.includes('--patch-only') ? samples.slice(0, 1) : samples) { card.header.title.content = `测试 · ${label}卡片`; const messageId = await feishu.sendCard(chatId, card, role); console.log(`${label}卡片：发送成功`); if (label === '进度') { if (!messageId) throw new Error('进度卡片缺少 message_id'); const updated = progressCard({ title: '测试 · 进度更新', task: '更新成功' }); await feishu.patchCard(messageId, updated, role, chatId); console.log('进度卡片：更新成功'); } }

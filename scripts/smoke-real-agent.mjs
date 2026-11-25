import { createFlow } from '../src/flow/index.mjs';
import { startPreview } from '../src/preview.mjs';

const fake = {
  async sendText(_chat, message) { console.log(`文字：${message}`); },
  async sendCard(_chat, card) { console.log(`卡片：${card.header?.title?.content ?? '未知'}`); return `fake-${Date.now()}`; },
  async patchCard(_id, card) { console.log(`进度：${card.elements?.[0]?.text?.content ?? ''}`); },
};
const flow = createFlow({ feishu: fake });
const preview = await startPreview({ flow });
try {
  await flow.handleMessage({ chatId: 'smoke-real-agent', text: '做一个读书会报名页，先问我需要确认的问题。', role: 'product', intent: 'demand' });
  const project = await flow.waitForIdle('smoke-real-agent');
  console.log(`结果：${project.stage}；问题轮次 ${project.questionRound}；错误 ${project.error ?? '无'}`);
  if (project.error || project.stage !== 'clarifying' || project.questionRound !== 1) process.exitCode = 1;
} finally { await preview.close(); }

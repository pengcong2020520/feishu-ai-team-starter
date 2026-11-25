import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createFlow } from '../src/flow/index.mjs';
import { startPreview } from '../src/preview.mjs';
import { createRecorder, cardView } from '../src/workbench/recorder.mjs';

const assetsRoot = process.cwd();
const root = path.join(assetsRoot, 'data/workbench-demo');
await rm(root, { recursive: true, force: true });
const recorder = createRecorder(root);
const cards = new Map();
let sequence = 0;
const feishu = {
  async sendText(chatId, text, role = 'product') { await recorder.add(chatId, { kind: 'text', role, text, source: '假飞书' }); },
  async sendCard(chatId, card, role = 'product') { const messageId = `demo-card-${++sequence}`; cards.set(messageId, chatId); await recorder.add(chatId, { kind: 'card', messageId, role, card: cardView(card), source: '假飞书' }); return messageId; },
  async patchCard(messageId, card, role = 'product') { const chatId = cards.get(messageId); if (chatId) await recorder.add(chatId, { kind: 'card_update', messageId, role, card: cardView(card), source: '假飞书' }); },
  async listChats() { return [{ chat_id: 'demo-clarify', name: '试用 · 澄清中' }, { chat_id: 'demo-prd', name: '试用 · 确认 PRD' }, { chat_id: 'demo-design', name: '试用 · 确认设计' }, { chat_id: 'demo-accept', name: '试用 · 等待验收' }]; },
};
const put = async (dir, file, content) => { const full = path.join(dir, file); await mkdir(path.dirname(full), { recursive: true }); await writeFile(full, typeof content === 'string' ? content : JSON.stringify(content)); };
const prd = ['# 活动报名页','## 产品概述','让访客在线报名活动。','## 目标用户与场景','访客在活动页面填写信息。','## 用户故事','假如打开页面，当提交报名，那么看到成功提示。','## 页面与状态','default：默认填写；success：成功提示。','## 边界情况','姓名为空时提示。','## 功能需求','FR-001 填写姓名并报名。','## 成功标准','SC-001 成功提交后看到提示。','## 假设','本地演示，不连接后台。','## 本期不做','支付。'].join('\n');
const outline = { title: '活动报名页', blocks: [{ name: '介绍', content: '活动信息' }, { name: '报名', content: '输入姓名' }], states: [{ id: 'default', name: '填写报名', desc: '看到活动信息和报名表单' }, { id: 'success', name: '报名成功', desc: '看到成功提示' }] };
const colors = Object.fromEntries(['background','surface','text','muted','border','primary','onPrimary','accent','success','warning','error','disabled'].map(key => [key, '#315fdb']));
const agent = async ({ role, prompt, projectDir, onProgress }) => {
  if (role === 'product') {
    if (prompt.includes('澄清中')) {
      await put(projectDir, 'docs/questions.json', { round: 1, why: '确定报名形式', questions: [{ id: 'q1', question: '报名需要留下电话吗？', matters: '决定表单字段', options: ['需要', '不需要'], recommended: 0, reason: '方便联系' }] });
      onProgress({ tool: 'Write', file: 'docs/questions.json' });
    } else {
      await put(projectDir, 'docs/prd.md', prd); await put(projectDir, 'docs/outline.json', outline);
      await put(projectDir, 'docs/checklist.md', Array.from({ length: 14 }, (_, i) => `- [x] CHK${String(i + 1).padStart(3, '0')}`).join('\n'));
      onProgress({ tool: 'Write', file: 'docs/prd.md' });
    }
  } else if (role === 'designer' && prompt.includes('走查')) {
    await put(projectDir, 'design/walkthrough.json', { round: 1, conclusion: '通过', summary: '报名流程完整', coverage: [], findings: [], groups: [{ title: '报名流程', flowNote: '填写后看到成功提示', screens: [{ title: '报名页', state: 'default', reproduce: '打开网页', mark: '可以', note: '看到活动标题和报名按钮' }, { title: '成功页', state: 'success', reproduce: '填写姓名后点击报名', mark: '可以', note: '看到报名成功提示' }] }] });
    onProgress({ tool: 'Write', file: 'design/walkthrough.json' });
  } else if (role === 'designer') {
    await put(projectDir, 'design/wireframe.html', '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:30px system-ui;background:#f1f4fa;padding:70px}section{background:white;padding:60px;border:2px dashed #9ba7bc}</style><section data-screen="page" data-state="default"><h1>活动报名</h1><p>姓名：_________</p><button>立即报名</button></section><section data-screen="page" data-state="success"><h1>报名成功</h1></section><script type="application/json" id="design-outline">{"groups":[{"id":"signup","title":"报名","screens":[{"id":"page","title":"报名页","states":["default","success"]}]}]}</script><script>function show(){let p=new URLSearchParams(location.hash.slice(1));document.querySelectorAll("section").forEach(e=>e.hidden=p.has("state")&&e.dataset.state!==p.get("state"))}addEventListener("hashchange",show);show() // #screen=page&state=default</script></html>');
    await put(projectDir, 'design/theme.json', { preset: 'modern', name: '清爽蓝', reason: '突出报名按钮', tokens: { colors, typography: { body: 'system' }, radii: { sm: 8 }, spacing: { sm: 8 }, shadows: { none: 'none' } } });
    onProgress({ tool: 'Write', file: 'design/wireframe.html' });
  } else {
    await put(projectDir, 'site/index.html', '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{font:20px system-ui;background:#f1f4fa;display:grid;place-items:center;min-height:100vh}main{background:white;padding:60px;border-radius:20px;box-shadow:0 12px 40px #1232}button{background:#315fdb;color:white;border:0;padding:15px 30px;border-radius:8px}</style><main><h1>活动报名</h1><div id="default"><p>和我们一起参加活动</p><input id="name" placeholder="你的姓名"><button id="submit">立即报名</button></div><div id="success" hidden><h2>报名成功</h2><p>期待见到你</p></div></main><script>function show(){let success=location.hash.includes("state=success");document.querySelector("#default").hidden=success;document.querySelector("#success").hidden=!success}document.querySelector("#submit").onclick=()=>{try{localStorage.setItem("demo-name",document.querySelector("#name").value)}catch(e){}location.hash="state=success"};try{localStorage.getItem("demo-name")}catch(e){}addEventListener("hashchange",show);show()</script></html>');
    onProgress({ tool: 'Write', file: 'site/index.html' });
  }
  return { ok: true, text: '试用内容已生成', sessionId: `${role}-demo`, stats: { turns: 1, durationMs: 100, inputTokens: 100, outputTokens: 100 } };
};
const flow = createFlow({ root, feishu, recorder, agent, id: () => `demo-${++sequence}`, previewBase: 'http://127.0.0.1:4891', workbenchBase: 'http://127.0.0.1:4890' });
for (const [chatId, text] of [['demo-clarify','做一个澄清中活动报名页'],['demo-prd','做一个等待 PRD 确认的活动报名页'],['demo-design','做一个等待设计确认的活动报名页'],['demo-accept','做一个等待验收的活动报名页']]) {
  await recorder.add(chatId, { kind: 'user', role: 'product', text, source: '试用' });
  await flow.handleMessage({ chatId, text }); await flow.waitForIdle(chatId);
  if (['demo-design','demo-accept'].includes(chatId)) { let p = await flow.getProject(chatId); await flow.handleAction({ chatId, value: { action: 'confirm', stage: p.stage, projectId: p.id, cardId: p.cardId } }); await flow.waitForIdle(chatId); }
  if (chatId === 'demo-accept') { let p = await flow.getProject(chatId); await flow.handleAction({ chatId, value: { action: 'confirm', stage: p.stage, projectId: p.id, cardId: p.cardId } }); await flow.waitForIdle(chatId); }
}
const preview = await startPreview({ root, assetsRoot, modelPort: 4891, workbenchPort: 4890, flow, feishu, recorder });
console.log('试用工作台已启动：http://127.0.0.1:4890');
console.log('全部数据位于 data/workbench-demo；按 Ctrl+C 停止。');
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, async () => { await preview.close(); process.exit(); });

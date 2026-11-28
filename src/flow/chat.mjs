// 群聊对话：用户 @ 角色时，角色从专业角度回一句话，需要时提议一个动作（开工、修改、回答、重试、结束），由用户点按钮决定
import { roles } from '../agents/roles.mjs';
import { plainText } from '../presentation.mjs';
import { roleFor, stageNames } from './stages.mjs';
import { gateRole, retryRole, nextStep } from './guide.mjs';

export const chatTimeoutMs = 60000;

const actionText = {
  start: 'start：用户说清了想做什么网页，提议开个项目，detail 写成一句完整的需求',
  revise: 'revise：用户提了修改意见，提议按意见修改，detail 写清改哪里、改成什么',
  answer: 'answer：用户用文字回答了澄清问题，提议把它当回答提交，detail 写用户的回答',
  retry: 'retry：这一步停下了，提议重试',
  end: 'end：用户想放弃这个项目，提议结束（文件会保留）',
};

// 这次能提哪些动作：按项目现状和被 @ 的角色由代码算好，模型只能从中选
export function allowedActions(p, role) {
  if (p?.busy) return [];
  if (p?.dedicated && p.stage === 'done') return [];
  if (!p || p.stage === 'done') return role === 'product' ? ['start'] : [];
  if (p.error) return [...(retryRole(p) === role ? ['retry'] : []), ...(role === 'product' ? ['end'] : [])];
  return [
    ...(gateRole(p.stage) === role ? ['revise'] : []),
    ...(p.stage === 'clarifying' && p.cardId && role === 'product' ? ['answer'] : []),
    ...(role === 'product' ? ['end'] : []),
  ];
}

const needsDetail = ['start', 'revise', 'answer'];
// 模型的提议不可信：不在允许范围、缺内容的都当没提
export function checkProposal(proposal, allowed) {
  const action = proposal?.action;
  if (!allowed.includes(action)) return null;
  const detail = String(proposal.detail ?? '').trim().slice(0, 500);
  if (needsDetail.includes(action) && !detail) return null;
  return { action, detail };
}

export const artifacts = { 'docs/prd.md': 'PRD', 'design/wireframe.html': '线框', 'design/theme.json': '主题', 'site/index.html': '网页', 'design/walkthrough.json': '走查记录' };
const speaker = row => row.kind === 'user' ? row.actor || row.userName || '用户' : roles[row.role]?.name ?? 'AI 同事';

export function chatPrompt({ p, role, text, recent = [], files = [] }) {
  const allowed = allowedActions(p, role);
  const status = !p || p.stage === 'done'
    ? ['群里现在没有进行中的项目。', ...(p?.stage === 'done' ? [`上一个项目「${p.name}」已完成。`] : [])]
    : [
      `项目：「${p.name}」，现在在「${stageNames[p.stage] ?? p.stage}」。`,
      ...(p.busy ? [`${roles[roleFor(p.stage)]?.name ?? '有同事'}正在干活。`] : []),
      ...(p.error ? [`这一步停下了：${p.errorBrief ?? p.error}`] : []),
      `已有产物：${files.map(file => `${artifacts[file]}（${file}）`).join('、') || '还没有'}。`,
    ];
  const history = recent.map(row => `${speaker(row)}：${row.kind === 'card' ? `[卡片] ${row.card?.title ?? ''}` : row.text}`);
  return [
    '群聊对话：用户在群里 @ 了你。这不是干活，只读文件、不写文件，按固定格式给出 reply 和 proposal。',
    '',
    '项目现状：', ...status,
    `按流程，用户下一步可以：${nextStep(p)}`,
    '',
    '群里最近的消息：', ...(history.length ? history : ['（没有）']),
    '',
    `用户这次对你说：${text}`,
    '',
    '这次可以提议的动作（只能从中选，不合适就用 none）：',
    ...allowed.map(action => `- ${actionText[action]}`),
    '- none：只回复，不提议',
  ].join('\n');
}

// 模型写的回复当不可信文字：去掉 Markdown 符号，限长
export const tidy = text => String(text ?? "").slice(0, 10000);

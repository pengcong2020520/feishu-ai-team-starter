// 给用户看的提示：出错时群里只说一句人话和下一步，完整原因留在工作台详情和服务日志
import { roles } from '../agents/roles.mjs';
import { roleFor, stageNames } from './stages.mjs';

// 某一步没做成：brief 是给用户看的一句话，message 是完整原因
export class StepError extends Error {
  constructor(brief, { kind = 'other', detail = brief, checks = null } = {}) {
    super(detail);
    this.brief = brief;
    this.kind = kind;
    this.checks = checks;
  }
}

const fileNames = {
  'docs/prd.md': 'PRD', 'docs/outline.json': '页面结构', 'docs/checklist.md': '需求自查清单', 'docs/questions.json': '澄清问题',
  'design/wireframe.html': '线框', 'design/theme.json': '主题', 'design/walkthrough.json': '走查记录', 'site/index.html': '网页',
};

// 交付检查没过：列出是哪些文件，明细留给重试时告诉智能体
export function checkFailed(errors) {
  const labels = [...new Set(errors.map(error => Object.entries(fileNames).find(([file]) => error.startsWith(file))?.[1]).filter(Boolean))];
  return new StepError(`交付的${labels.join('、') || '文件'}没通过格式检查`, { kind: 'check', detail: errors.join('；'), checks: errors });
}

export const shorten = (text, max = 40) => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}…` : value;
};

export function briefOf(error) {
  if (error?.brief) return error.brief;
  const message = String(error?.message ?? error ?? '');
  const code = error?.response?.data?.code ?? error?.feishuCode ?? /code (\d+)/.exec(message)?.[1];
  if (code) return `飞书接口出错（code ${code}）`;
  return shorten(message) || '原因不明';
}

const gateRoles = { confirm_prd: 'product', confirm_design: 'designer', accept: 'developer' };
export const gateRole = stage => gateRoles[stage];
// 出错停下后该由谁接着做
export const retryRole = p => p.pendingAction?.role ?? gateRole(p.stage) ?? roleFor(p.stage) ?? 'product';
const nameOf = role => roles[role]?.name ?? '对应的同事';

// 现在该用户做什么：@ 角色没得到回应时、点了过期卡片时都用它
export function nextStep(p) {
  if (!p || p.stage === 'done') return '想做新的网页，@AI 产品经理 说说你的想法。';
  if (p.busy) return `${nameOf(roleFor(p.stage) ?? retryRole(p))}正在${stageNames[p.stage]}，做完会在群里发新卡片。`;
  if (p.error) return `这一步停下了：${p.errorBrief ?? briefOf(p.error)}。点“这一步停下了”卡片上的“重试”或“结束项目”，也可以 @${nameOf(retryRole(p))} 发送“重试”。`;
  switch (p.stage) {
    case 'clarifying': return '现在等你回答 AI 产品经理的问题：在问题卡片里选好后点“提交回答”，也可以 @AI 产品经理 直接用文字回答。';
    case 'confirm_prd': return '现在等你确认 PRD：点卡片上的“确认 PRD”；要改就 @AI 产品经理 说哪里要改。';
    case 'confirm_design': return '现在等你确认设计：点卡片上的“确认设计”；要改就 @AI 设计 说哪里要改。';
    case 'accept': return '现在等你验收：打开网页看看，满意点“验收通过”；要改就 @AI 程序员 说哪里要改。';
    case 'revise_prd': case 'revise_design': case 'revise_build': return `现在在「${stageNames[p.stage]}」：请 @${nameOf(roleFor(p.stage))} 说明要改什么。`;
    default: return `现在在「${stageNames[p.stage] ?? p.stage}」。`;
  }
}

// 点到过期卡片时：说清楚为什么过期、现在该点哪里
export function staleText(p) {
  if (!p || p.stage === 'done') return `这张卡片已过期，群里现在没有进行中的项目。${nextStep(null)}`;
  if (p.busy || p.error) return `这张卡片已过期。${nextStep(p)}`;
  if (gateRole(p.stage)) return `这张卡片已过期，现在在「${stageNames[p.stage]}」，请点最新那张卡片。`;
  if (p.stage === 'clarifying') return '这张卡片已过期，请用最新那张问题卡片回答。';
  return `这张卡片已过期，${nextStep(p)}`;
}

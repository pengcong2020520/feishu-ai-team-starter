// 管家的固定工具：看现状、问同事、代你说话、代你点关口按钮、交改动、重启、回退。
// 工具里面按固定顺序执行，模型只决定什么时候调、填什么参数
import path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { roles } from '../agents/roles.mjs';
import { stageNames } from '../flow/stages.mjs';
import { gateRole } from '../flow/guide.mjs';
import { serviceLine } from './cards.mjs';

const ROLE = z.enum(['product', 'designer', 'developer']);
const reply = text => ({ content: [{ type: 'text', text }] });
const fail = text => ({ content: [{ type: 'text', text }], isError: true });
const label = p => `#${p.number}「${p.name}」`;

export function statusText({ service, snapshot, changes }) {
  const lines = [serviceLine(service)];
  if (!snapshot) lines.push('读不到项目（工作台接口连不上）');
  else {
    const active = snapshot.projects.filter(p => p.stage !== 'done');
    lines.push(active.length ? '进行中的项目：' : '没有进行中的项目');
    for (const p of active) {
      const state = p.error ? `停下了：${p.errorBrief ?? p.error}（负责重试的是${roles[p.retryRole]?.name}）` : p.busy ? `${roles[p.activeRole]?.name}在干活：${p.activity ?? ''}` : p.waitingFor ? `等管理员${p.waitingFor}` : '';
      lines.push(`- ${label(p)} 阶段「${stageNames[p.stage] ?? p.stage}」${state ? `，${state}` : ''}；工作区 workspace/${p.id}/；${p.source}`);
    }
    const done = snapshot.projects.filter(p => p.stage === 'done');
    if (done.length) lines.push(`已完成或结束的项目：${done.map(p => `${label(p)}${p.ended ? '（中途结束）' : ''}`).join('、')}`);
  }
  const state = changes.state();
  const history = (state.history ?? []).slice(-5).reverse();
  if (history.length) lines.push('最近的改动（新的在前）：', ...history.map(c => `- ${c.sha.slice(0, 7)} ${c.title}（${c.level === 'text' ? '文字类' : '代码类'}${c.revertedBy ? '，已回退' : ''}）`));
  if (state.pending) lines.push(`还没上线的改动：「${state.pending.title}」（${{ sign: '等管理员签字', testing: '在跑测试', waiting: '等项目做完再上线', going: '在上线' }[state.pending.status] ?? state.pending.status}）`);
  return lines.join('\n');
}

export function buildTools({ supervisor, workbench, changes, deploy, runAgent, root }) {
  const findProject = async number => {
    const snapshot = await workbench.state();
    if (!snapshot) throw new Error('团队服务没在运行，读不到项目');
    const p = snapshot.projects.find(x => x.number === number);
    if (!p) throw new Error(`没有 #${number} 这个项目`);
    return p;
  };
  const guard = fn => async args => { try { return await fn(args); } catch (error) { return fail(error.message); } };

  return [
    tool('team_status', '看团队现状：团队服务是否在运行、各项目在哪个阶段、谁在干活、哪里停下了、最近的改动。', {}, guard(async () =>
      reply(statusText({ service: supervisor.status(), snapshot: supervisor.status().running ? await workbench.state() : null, changes })))),

    tool('ask_colleague', '找某个 AI 同事要上下文：让它只读这个项目的文件，回答你的问题。答案只回给你，不发到群里。', {
      role: ROLE.describe('product 产品经理 / designer 设计 / developer 程序员'),
      project: z.number().int().describe('项目编号，比如 3'),
      question: z.string().min(1).max(1000),
    }, guard(async ({ role, project, question }) => {
      const p = await findProject(project);
      const r = await runAgent({ role, mode: 'chat', projectDir: path.join(root, 'workspace', p.id), timeoutMs: 120000, prompt: [
        'AI 管理员助手代管理员问你（这不是群聊，你的回答只给管理员助手看）。只读文件，把答案写在 reply 里（可以超过 120 字，但要具体），proposal 用 none。',
        `项目：${label(p)}，现在在「${stageNames[p.stage] ?? p.stage}」。`,
        `问题：${question}`,
      ].join('\n') });
      if (!r.ok) return fail(`${roles[role].name}没答上来：${r.error}`);
      return reply(`${roles[role].name}说：${r.structured?.reply ?? r.text}`);
    })),

    tool('tell_colleague', '代管理员在项目群里对某个 AI 同事说一句话，效果和管理员在群里 @ 它一样（比如“重试”、修改意见、问一句）。群里会显示“AI 管理员助手代你：……”。', {
      role: ROLE,
      project: z.number().int(),
      text: z.string().min(1).max(2000),
    }, guard(async ({ role, project, text }) => {
      const p = await findProject(project);
      if (!p.chatId) return fail(`${label(p)} 没有对应的群，不能代你说话`);
      const r = await workbench.message({ chatId: p.chatId, role, text, via: 'admin' });
      const what = r.queued ? '它正在干活，这句话先记下了，这一步做完再回' : r.retrying ? '它开始重试这一步了' : r.stage ? '它开始按这句话修改了' : r.chatting ? '它会在群里回应' : r.confirming ? '群里发了确认卡，要人点' : '已交给编排处理';
      return reply(`已代管理员对${roles[role].name}说：“${text}”。${what}。`);
    })),

    tool('press_button', '代管理员点关口卡片上的按钮（确认 PRD、确认设计、验收时的“确认”或“打回”）。只有管理员明确说了要确认或打回时才能用，admin_words 填管理员的原话。', {
      project: z.number().int(),
      action: z.enum(['confirm', 'reject']),
      admin_words: z.string().min(1).describe('管理员要你这样做的原话'),
    }, guard(async ({ project, action }) => {
      const p = await findProject(project);
      const role = gateRole(p.stage);
      if (!role || p.busy || p.error || !p.cardId) return fail(`${label(p)} 现在在「${stageNames[p.stage] ?? p.stage}」，不在等人确认的关口，没有按钮可点`);
      const r = await workbench.action({ chatId: p.chatId, role, value: { action, stage: p.stage, projectId: p.id, cardId: p.cardId }, via: 'admin' });
      return reply(`已代管理员在「${stageNames[p.stage]}」点了“${action === 'confirm' ? '确认' : '打回'}”：${r.toast?.content ?? '已提交'}`);
    })),

    tool('submit_change', `交改动：你在 .admin-work/ 里改完文件后调用。代码会算出实际改了哪些文件（不看你说的），检查禁区，定级别：只动 prompts/、team-skills/、docs/ 是文字类，跑测试，过了直接生效；动了 src/、web/、test/ 是代码类，发签字卡给管理员，管理员点“上线”后才跑测试、上线、重启团队服务。测试没过会把失败输出交回给你，最多试 3 次。`, {
      title: z.string().min(1).max(60).describe('一句话：改了什么'),
      why: z.string().min(1).max(500).describe('为什么改、管理员的要求是什么'),
    }, guard(async ({ title, why }) => reply(await deploy.submit({ title, why })))),

    tool('restart_team', '重启团队服务（3 个 AI 同事所在的进程）。有项目在干活时不重启。', {
      reason: z.string().min(1).max(200),
    }, guard(async () => {
      const r = await deploy.restart();
      return r.ok ? reply('团队服务重启好了，3 个机器人已连上飞书') : fail(r.error);
    })),

    tool('revert_change', '回退管理员助手做过的一次改动（git revert）。不填 sha 就回退最近一次；代码类回退后会重启团队服务。', {
      sha: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
    }, guard(async ({ sha }) => {
      const r = await deploy.revert({ sha });
      return r.ok ? reply(r.text) : fail(r.error);
    })),
  ];
}

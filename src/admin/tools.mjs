// 管家的固定工具：看现状、问同事、代你说话、代你点关口按钮、交改动、重启、回退。
// 工具里面按固定顺序执行，模型只决定什么时候调、填什么参数
import path from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { roles } from '../agents/roles.mjs';
import { stageNames } from '../flow/stages.mjs';
import { gateRole } from '../flow/guide.mjs';
import { serviceLine } from './cards.mjs';
import { lockedPackage } from '../packages/store.mjs';
import { roleDefinition } from '../packages/runtime.mjs';

const ROLE = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
const roleName = (p, role) => p.roles?.find(r => r.id === role)?.name || roles[role]?.name || '负责的同事';
const reply = text => ({ content: [{ type: 'text', text }] });
const fail = text => ({ content: [{ type: 'text', text }], isError: true });
const label = p => `#${p.number}「${p.name}」`;

// 代点属于关口授权：只识别完整、明确的短指令，不从自由文本里截取“确认”二字。
function gateConsent(text) {
  let command = text.normalize('NFKC').replace(/\s+/g, '').replace(/[。!！]+$/, '');
  command = command.replace(/^(?:设计|网页|页面|PRD|需求)?(?:没问题|没有问题)[,，;；。]/i, '');
  command = command.replace(/^(?:请(?:你)?(?:帮我|替我)?|帮我|替我|我)/, '');
  const targets = [...command.matchAll(/(?:项目#?|#)([1-9]\d*)(?:的)?/g)];
  if (targets.length > 1) return null;
  command = command.replace(/(?:项目#?|#)([1-9]\d*)(?:的)?/g, '');
  const match = command.match(/^(验收通过|确认|通过|打回)(PRD|需求|设计|网页|页面)?$/i);
  if (!match) return null;
  const subject = match[2]?.toLowerCase();
  if (match[1] === '验收通过' && subject && !['网页', '页面'].includes(subject)) return null;
  const stage = match[1] === '验收通过' ? 'accept' : ({ prd: 'confirm_prd', '需求': 'confirm_prd', '设计': 'confirm_design', '网页': 'accept', '页面': 'accept' })[subject];
  return { action: match[1] === '打回' ? 'reject' : 'confirm', stage, project: targets[0] ? Number(targets[0][1]) : null };
}

export function statusText({ service, snapshot, changes }) {
  const lines = [serviceLine(service)];
  if (!snapshot) lines.push('读不到项目（工作台接口连不上）');
  else {
    const active = snapshot.projects.filter(p => p.stage !== 'done');
    lines.push(active.length ? '进行中的项目：' : '没有进行中的项目');
    for (const p of active) {
      const state = p.error ? `停下了：${p.errorBrief ?? p.error}（负责重试的是${roles[p.retryRole]?.name}）` : p.busy ? `${roles[p.activeRole]?.name}在干活：${p.activity ?? ''}` : p.waitingFor ? `等管理员${p.waitingFor}` : '';
      lines.push(`- ${label(p)} 阶段「${p.stageName ?? stageNames[p.stage] ?? p.stage}」${state ? `，${state}` : ''}；工作区 workspace/${p.id}/；${p.source}`);
    }
    const done = snapshot.projects.filter(p => p.stage === 'done');
    if (done.length) lines.push(`已完成或结束的项目：${done.map(p => `${label(p)}${p.ended ? '（中途结束）' : ''}`).join('、')}`);
  }
  const state = changes.state();
  const history = (state.history ?? []).slice(-5).reverse();
  if (history.length) lines.push('最近的改动（新的在前）：', ...history.map(c => `- 「${c.title}」（${c.level === 'text' ? '文字类' : '代码类'}${c.revertedBy ? '，已撤销' : ''}）编号 ${c.sha.slice(0, 7)}（只在调用 revert_change 时用，不要告诉管理员）`));
  if (state.pending) lines.push(`还没上线的改动：「${state.pending.title}」（${{ sign: '等管理员签字', testing: '在跑测试', waiting: '等项目做完再上线', going: '在上线' }[state.pending.status] ?? state.pending.status}）`);
  return lines.join('\n');
}

export function buildTools({ supervisor, workbench, changes, deploy, runAgent, root, adminWords = () => [] }) {
  const usedConsents = new WeakMap(); // 每次管家运行有独立的原话数组；一条消息只授权一次代点。
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
      if (!(p.package ? p.roles.some(r => r.id === role) : roles[role])) return fail('这个项目没有该角色');
      const definition = p.package ? await roleDefinition(await lockedPackage(root, p.package), role, root) : undefined;
      if ((await workbench.state())?.scheduler?.limit === 1) return fail('当前全团队只有一个执行名额，管理员正在使用。请直接读取该项目文件，或结束本轮后再让同事处理。');
      const r = await runAgent({ role, definition, mode: 'chat', isolateSession: Boolean(p.dedicated || p.package), projectDir: path.join(root, 'workspace', p.id), timeoutMs: 120000, prompt: [
        'AI 管理员助手代管理员问你（这不是群聊，你的回答只给管理员助手看）。只读文件，把答案写在 reply 里（可以超过 120 字，但要具体），proposal 用 none。',
        `项目：${label(p)}，现在在「${p.stageName ?? stageNames[p.stage] ?? p.stage}」。`,
        `问题：${question}`,
      ].join('\n') });
      if (!r.ok) return fail(`${roleName(p, role)}没答上来：${r.error}`);
      return reply(`${roleName(p, role)}说：${r.structured?.reply ?? r.text}`);
    })),

    tool('tell_colleague', '代管理员在项目群里对某个 AI 同事说一句话，效果和管理员在群里 @ 它一样（比如“重试”、修改意见、问一句）。群里会显示“AI 管理员助手代你：……”。', {
      role: ROLE,
      project: z.number().int(),
      text: z.string().min(1).max(2000),
    }, guard(async ({ role, project, text }) => {
      const p = await findProject(project);
      if (!(p.package ? p.roles.some(r => r.id === role) : roles[role])) return fail('这个项目没有该角色');
      if (!p.chatId) return fail(`${label(p)} 没有对应的群，不能代你说话`);
      const r = await workbench.message({ chatId: p.chatId, role, text, via: 'admin' });
      const what = r.queued ? '它正在干活，这句话先记下了，这一步做完再回' : r.retrying ? '它开始重试这一步了' : r.stage ? '它开始按这句话修改了' : r.chatting ? '它会在群里回应' : r.confirming ? '群里发了确认卡，要管理员在群里点' : r.stopping ? '已让它停下这一步' : r.busy ? '它正在干活，现在不能重试；等这一步做完，或先停下再发“重试”' : r.waiting ? '没有执行：现在没有进行中的项目，或这一步并没有停下' : '已交给它处理';
      return reply(`已代管理员对${roleName(p, role)}说：“${text}”。${what}。`);
    })),

    tool('press_button', '代管理员点关口的确认或打回。只接受最新完整的明确指令，如“确认 #3 设计”“打回 #3 网页”“验收通过 #3”。多个项目等确认时必须带项目编号；admin_words 不可截取片段。', {
      project: z.number().int(),
      action: z.enum(['confirm', 'reject']),
      admin_words: z.string().min(1).describe('管理员最新一条消息的完整原话，不可截取或改写'),
    }, guard(async ({ project, action, admin_words }) => {
      const words = admin_words?.trim();
      const originals = adminWords();
      const consentIndex = originals.length - 1;
      if (!words || [...words].length < 2 || originals.at(-1)?.trim() !== words) return fail('管理员这次没说过这句话，不能代点。必须引用最新一条完整原话。');
      const consent = gateConsent(words);
      if (!consent || consent.action !== action) return fail('这句话没有明确授权这个动作，不能代点。请管理员点正式卡片，或发“确认 #3 设计”“打回 #3 网页”这样的完整指令。');
      const snapshot = await workbench.state();
      if (!snapshot) return fail('团队服务没在运行，读不到项目');
      const p = snapshot.projects.find(x => x.number === project);
      if (!p) return fail(`没有 #${project} 这个项目`);
      const decision = p.package ? p.approval : p.stage;
      const role = p.package ? p.stageType === 'gate' && !p.questions && p.cardRole : gateRole(p.stage);
      if (!role || p.busy || p.error || !p.cardId) return fail(`${label(p)} 现在在「${p.stageName ?? stageNames[p.stage] ?? p.stage}」，不在等人确认的关口，没有按钮可点`);
      if ((consent.project !== null && consent.project !== project) || (consent.stage && consent.stage !== decision)) return fail('原话指定的项目或关口与要点的按钮不一致，不能代点。');
      const eligible = snapshot.projects.filter(x => (x.package ? x.stageType === 'gate' && !x.questions : gateRole(x.stage)) && !x.busy && !x.error && x.cardId && (!consent.stage || (x.package ? x.approval : x.stage) === consent.stage));
      if (consent.project === null && eligible.length !== 1) return fail('有多个项目等确认，请管理员在指令中写明项目编号，不能代选。');
      if (adminWords() !== originals || originals.length - 1 !== consentIndex || originals.at(-1)?.trim() !== words) return fail('管理员的指令已经更新，不能再按之前的话代点。');
      const used = usedConsents.get(originals) ?? new Set();
      if (used.has(consentIndex)) return fail('这条指令已经用于代点，不能重复使用；下一关需要新的明确指令。');
      used.add(consentIndex);
      usedConsents.set(originals, used);
      const result = await workbench.action({ chatId: p.chatId, role, value: { action, stage: p.stage, projectId: p.id, cardId: p.cardId }, via: 'admin' });
      if (result.toast?.content !== '已收到操作') return fail(`没点成：${result.toast?.content ?? '请看最新的项目状态'}`);
      if (p.package) return reply(`已代你${action === 'confirm' ? '确认' : '打回'}「${p.stageName}」。${action === 'reject' ? '接着把管理员的修改意见发给本关角色。' : '团队将按自己的协作规则继续。'}`);
      const buttons = { confirm_prd: ['确认 PRD', '打回 PRD', 'AI 设计开始画线框', 'AI 产品经理'], confirm_design: ['确认设计', '打回设计', 'AI 程序员会开始做网页', 'AI 设计'], accept: ['验收通过', '打回网页', '项目完成', 'AI 程序员'] };
      const [confirm, reject, next, who] = buttons[p.stage];
      return reply(action === 'confirm' ? `已代你点了“${confirm}”。${next}。` : `已代你点了“${reject}”。这只是退回修改，修改意见还没发出去；接着用 tell_colleague 把管理员的原话发给 ${who}。`);
    })),

    tool('submit_change', `交改动：你在 .admin-work/ 里改完文件后调用。代码会算出实际改了哪些文件（不看你说的），检查禁区，定级别：只动 prompts/、team-skills/、docs/ 是文字类，跑测试，过了直接生效；动了 src/、web/、test/ 是代码类，发签字卡给管理员，管理员点“上线”后才跑测试、上线、重启团队服务。测试没过会把失败输出交回给你，最多试 3 次。`, {
      title: z.string().min(1).max(60).describe('一句话：改了什么'),
      why: z.string().min(1).max(500).describe('为什么改、管理员的要求是什么'),
    }, guard(async ({ title, why }) => reply(await deploy.submit({ title, why })))),

    tool('restart_team', '重启团队服务（3 个 AI 同事所在的进程）。有项目在干活时不重启。', {
      reason: z.string().min(1).max(200),
    }, guard(async () => {
      const r = await deploy.restart();
      return r.ok ? reply('团队服务重启好了，团队机器人已连上飞书') : fail(r.error);
    })),

    tool('revert_change', '回退管理员助手做过的一次改动（git revert）。不填 sha 就回退最近一次；代码类回退后会重启团队服务。', {
      sha: z.string().regex(/^[0-9a-f]{7,40}$/).optional(),
    }, guard(async ({ sha }) => {
      const r = await deploy.revert({ sha });
      return r.ok ? reply(r.text) : fail(r.error);
    })),
  ];
}

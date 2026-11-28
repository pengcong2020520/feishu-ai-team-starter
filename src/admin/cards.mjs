// AI 管理员助手的私聊卡片（卡片 1.0，橙色，和三个角色区分开）
import { roles } from '../agents/roles.mjs';
import { stageNames } from '../flow/stages.mjs';
import { plainText, replyElements } from '../presentation.mjs';

export const ADMIN_NAME = 'AI 管理员助手';
const grey = text => ({ tag: 'div', text: { tag: 'lark_md', content: `<font color='grey'>${text}</font>` } });
const line = text => ({ tag: 'div', text: { tag: 'lark_md', content: text } });
const button = (text, value, type = 'default') => ({ tag: 'button', text: { tag: 'plain_text', content: text }, type, value });
const card = (title, elements) => ({ config: { wide_screen_mode: true, update_multi: true }, header: { template: 'orange', title: { tag: 'plain_text', content: `${ADMIN_NAME} · ${title}` } }, elements });
// 模型和报错写的文字当不可信：去掉会被卡片当格式的符号，限长
const plain = (text, max = 200) => String(text ?? '').replace(/[*`<>[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
export const cleanReply = (text, max = 3000) => plainText(text).slice(0, max);

export const since = (iso, now = Date.now()) => {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分钟` : ''}`;
};
const exitText = exit => exit?.code !== null && exit?.code !== undefined ? `退出码 ${exit.code}` : exit?.signal ? '被系统停下了' : '退出原因不明';
const projectTitle = p => `#${p.number} ${plain(p.name, 40)}`;

export function serviceLine(service, now = Date.now()) {
  if (service.healthy) { const duration = since(service.startedAt, now); return `✅ 团队服务在运行（${duration === '刚刚' ? '刚刚启动' : `已运行 ${duration}`}）`; }
  if (service.running) return '⏳ 团队服务在启动，还没连上飞书';
  return `⚠️ 团队服务没在运行${service.lastExit ? `（${exitText(service.lastExit)}，${since(service.lastExit.at, now)}${since(service.lastExit.at, now) === '刚刚' ? '' : '前'}）` : ''}`;
}

export function projectLine(p, now = Date.now()) {
  const stage = p.stageName ?? stageNames[p.stage] ?? p.stage;
  if (p.waitingFor === '重试') return `**${projectTitle(p)}** · ${stage} · ⚠️ 停下了：${plain(p.errorBrief ?? p.error, 80)}`;
  if (p.busy) return `**${projectTitle(p)}** · ${stage} · ${roles[p.activeRole]?.name ?? '有同事'}${p.activity ? `：${plain(p.activity, 40)}` : '在干活'}`;
  if (p.waitingFor) { const duration = p.stageAt && since(p.stageAt, now); return `**${projectTitle(p)}** · 等你${p.waitingFor}${duration ? `（${duration === '刚刚' ? duration : `已等 ${duration}`}）` : ''}`; }
  return `**${projectTitle(p)}** · ${stage}`;
}

// 私聊“状态”：代码直接生成，不花模型费用
export function statusCard({ service, snapshot, now = Date.now(), cardId }) {
  const projects = snapshot?.projects ?? [];
  const active = projects.filter(p => p.stage !== 'done');
  const done = projects.length - active.length;
  const elements = [line(serviceLine(service, now)), { tag: 'hr' }];
  if (!snapshot) elements.push(grey(service.running ? '工作台接口连不上，读不到项目' : '团队服务没在运行，读不到项目'));
  else if (!active.length) elements.push(line('没有进行中的项目'));
  else elements.push(...active.map(p => line(projectLine(p, now))));
  if (snapshot && done) elements.push(grey(`已完成 ${done} 个项目`));
  if (!service.healthy) elements.push({ tag: 'action', actions: [button('重启团队服务', { action: 'restart', cardId }, 'primary')] });
  return card('团队现状', elements);
}

export function stuckCard({ p, cardId }) {
  const who = roles[p.retryRole]?.name ?? '负责的同事';
  return card('有项目停下了', [
    line(`**${projectTitle(p)}** 在「${p.stageName ?? stageNames[p.stage] ?? p.stage}」停下了：${plain(p.errorBrief ?? p.error)}`),
    grey(`点“接着做”，${who}会再做一次这一步，群里会显示“${ADMIN_NAME}代你：重试”。点“看看原因”，我去查日志和文件，只查不改，要稍等一会儿。`),
    { tag: 'action', actions: [button('接着做', { action: 'retry', cardId, projectId: p.id, stage: p.stage }, 'primary'), button('看看原因', { action: 'diagnose', cardId, projectId: p.id, stage: p.stage }), button('先不管', { action: 'ignore', cardId })] },
  ]);
}

export function serviceDownCard({ exit, error, cardId, lastChange = null }) {
  return card('团队服务停了', [
    line(exit ? `团队服务意外退出了（${exitText(exit)}），飞书群里的同事现在不会回应。` : '团队服务没起来，飞书群里的同事现在不会回应。'),
    ...(error ? [line('最后的输出：'), ...String(error).split('\n').slice(-5).map(row => grey(cleanReply(row, 200)))] : []),
    grey(`完整日志在 data/service.log。${lastChange ? `最近一次代码改动是「${plain(lastChange.title, 40)}」，怀疑是它就点“撤销上一次改动”。` : ''}`),
    { tag: 'action', actions: [button('重启团队服务', { action: 'restart', cardId }, 'primary'), ...(lastChange ? [button('撤销上一次改动', { action: 'revert', cardId, sha: lastChange.sha }, 'danger')] : [])] },
  ]);
}

// 点过或过期的卡片收起成一句话
export const closedCard = (title, text) => card(title, [line(text)]);

export function introCard() {
  return card('报到', [
    line(`我是 **${ADMIN_NAME}**，只听你的，只在私聊里说话。`),
    line('发“状态”看团队现状。其他事直接跟我说：问项目进展、让同事重试或修改、改角色说明和技能、小改代码都行；改代码要你点“上线”才生效，之后可以点“撤销这次改动”或私聊发“撤销”。'),
    line('项目停下、团队服务出问题时，我会私聊提醒你。'),
  ]);
}

const fileList = files => files.length > 8 ? `${files.slice(0, 8).join('、')} 等 ${files.length} 个` : files.join('、');

// 代码类改动的签字卡：点“上线”才跑测试、合并、重启
export function signCard({ change, cardId, warning = '' }) {
  const value = action => ({ action, cardId, sha: change.sha });
  return card('要上线这次代码改动吗？', [
    ...(warning ? [line(plain(warning, 200))] : []),
    line(`**改了什么**：${plain(change.title, 60)}`),
    line(`**为什么**：${plain(change.why, 300)}`),
    line(`**改动文件**：${plain(fileList(change.files), 400)}`),
    grey(plain(change.stat ?? '', 120)),
    { tag: 'hr' },
    grey('点“上线”后：先跑测试，通过了合并到线上、重启团队服务并检查；起不来会自动撤销。有项目在干活就等它做完再上线。上线后可以点“撤销这次改动”，或私聊发“撤销”。'),
    { tag: 'action', actions: [button('上线', value('golive'), 'primary'), button('不要', value('reject_change'), 'danger')] },
  ]);
}

// 改动生效了：带撤销按钮
export function liveCard({ change, cardId }) {
  return card('改好了', [
    line(`「${plain(change.title, 60)}」已${change.level === 'text' ? '生效，同事下次干活就用上' : '上线，团队服务重启好了'}。`),
    grey(`改动文件：${plain(fileList(change.files), 400)}`),
    { tag: 'action', actions: [button('撤销这次改动', { action: 'revert', cardId, sha: change.sha }, 'danger')] },
  ]);
}

const seconds = ms => `${Math.max(0, Math.round(ms / 1000))} 秒`;
const tokens = n => n >= 10000 ? `${(n / 10000).toFixed(1)} 万` : String(n);

// 管家干活的进度卡：一行在做什么 + 当前一步；做完改成结果
export function stewardCard({ task, activity, steps, elapsedMs, guides = [], cardId, done = false, outcome = null, reply = '', stats = null }) {
  if (!done) return card('在处理', [
    line(plain(task, 80)),
    line(activity),
    ...guides.map(text => line(`↪ 你插话：${plain(text, 80)}`)),
    grey(`已用 ${seconds(elapsedMs)} · 第 ${steps} 步`),
    { tag: 'action', actions: [button('停下', { action: 'stop_steward', cardId })] },
  ]);
  const body = String(reply || "").slice(0,10000);
  return card(outcome === 'ok' ? '完成' : '停下了', [
    ...replyElements(body || (outcome === 'stopped' ? '⏹ 已停下' : '⚠️ 没做完')),
    { tag: 'hr' },
    grey(`你说的：${plain(task, 80)}`),
    ...(stats ? [grey(`用时 ${seconds(stats.durationMs)} · ${steps} 步；读入 ${tokens(stats.inputTokens)} / 写出 ${tokens(stats.outputTokens)} token`)] : []),
  ]);
}

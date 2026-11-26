// AI 管理员助手的私聊卡片（卡片 1.0，橙色，和三个角色区分开）
import { roles } from '../agents/roles.mjs';
import { stageNames } from '../flow/stages.mjs';

export const ADMIN_NAME = 'AI 管理员助手';
const grey = text => ({ tag: 'div', text: { tag: 'lark_md', content: `<font color='grey'>${text}</font>` } });
const line = text => ({ tag: 'div', text: { tag: 'lark_md', content: text } });
const button = (text, value, type = 'default') => ({ tag: 'button', text: { tag: 'plain_text', content: text }, type, value });
const card = (title, elements) => ({ config: { wide_screen_mode: true, update_multi: true }, header: { template: 'orange', title: { tag: 'plain_text', content: `${ADMIN_NAME} · ${title}` } }, elements });
// 模型和报错写的文字当不可信：去掉会被卡片当格式的符号，限长
const plain = (text, max = 200) => String(text ?? '').replace(/[*`<>[\]]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);

export const since = (iso, now = Date.now()) => {
  const minutes = Math.floor((now - Date.parse(iso)) / 60000);
  if (!Number.isFinite(minutes) || minutes < 1) return '刚刚';
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟`;
};
const exitText = exit => exit?.signal ? `被信号 ${exit.signal} 结束` : `退出码 ${exit?.code ?? '未知'}`;
const projectTitle = p => `#${p.number} ${plain(p.name, 40)}`;

export function serviceLine(service, now = Date.now()) {
  if (service.healthy) return `✅ 团队服务在运行（已运行 ${since(service.startedAt, now)}）`;
  if (service.running) return '⏳ 团队服务在启动，还没连上飞书';
  return `⚠️ 团队服务没在运行${service.lastExit ? `（${exitText(service.lastExit)}，${since(service.lastExit.at, now)}前）` : ''}`;
}

export function projectLine(p, now = Date.now()) {
  const stage = stageNames[p.stage] ?? p.stage;
  if (p.waitingFor === '重试') return `**${projectTitle(p)}** · ${stage} · ⚠️ 停下了：${plain(p.errorBrief ?? p.error, 80)}`;
  if (p.busy) return `**${projectTitle(p)}** · ${stage} · ${roles[p.activeRole]?.name ?? '有同事'}${p.activity ? `：${plain(p.activity, 40)}` : '在干活'}`;
  if (p.waitingFor) return `**${projectTitle(p)}** · 等你${p.waitingFor}${p.stageAt ? `（已等 ${since(p.stageAt, now)}）` : ''}`;
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
    line(`**${projectTitle(p)}** 在「${stageNames[p.stage] ?? p.stage}」停下了：${plain(p.errorBrief ?? p.error)}`),
    grey(`点“接着做”让${who}再做一次这一步，群里会显示“${ADMIN_NAME}代你：重试”。`),
    { tag: 'action', actions: [button('接着做', { action: 'retry', cardId, projectId: p.id, stage: p.stage }, 'primary'), button('先不管', { action: 'ignore', cardId })] },
  ]);
}

export function serviceDownCard({ exit, error, cardId }) {
  return card('团队服务停了', [
    line(exit ? `团队服务意外退出了（${exitText(exit)}），飞书群里的同事现在不会回应。` : '团队服务没起来，飞书群里的同事现在不会回应。'),
    ...(error ? [grey(`最后的输出：${plain(error, 300)}`)] : []),
    grey('完整日志在 data/service.log。'),
    { tag: 'action', actions: [button('重启团队服务', { action: 'restart', cardId }, 'primary')] },
  ]);
}

// 点过或过期的卡片收起成一句话
export const closedCard = (title, text) => card(title, [line(text)]);

export function introCard() {
  return card('报到', [
    line(`我是 **${ADMIN_NAME}**，只听你的，只在私聊里说话。`),
    line('发“状态”看团队现状；发“重启”重启团队服务。项目停下、团队服务出问题时，我会私聊提醒你。'),
  ]);
}

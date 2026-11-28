import { plainText } from './presentation.mjs';
const clip = (text, length) => Array.from(text).slice(0, length).join('');
const clean = value => plainText(value).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
const unquote = text => text.replace(/^[「“《"']|[」”》"']$/g, '').trim();
// 只有需求原话做指令清理；用户明确填写的标题不能被当作指令剥掉。
export function projectLabel(text, explicit) {
  if (typeof explicit === 'string' && explicit.trim()) return clip(clean(explicit), 24) || '新项目';
  const source = plainText(text || '').replace(/\r/g, '').trim().replace(/^(?:好的|好|可以)[，,。！!\s]+/, '');
  const named = source.match(/(?:项目名(?:称)?|群名|选题|主题|标题)[：:为是\s]+[「“《"']?([^」”》"'，,。；;\n]{2,80})/);
  const quoted = source.match(/(?:选题|主题|项目|研究|文章|以|关于)[：:为是\s]*[「“《"']([^」”》"']{2,80})[」”》"']/);
  let topic = unquote((named?.[1] || quoted?.[1] || source).split(/[，,。；;\n]/)[0]);
  if (!named && !quoted) {
    const prefix = /^(?:(?:好的|好|可以)[，,\s]*|(?:请你|请|帮我|为我|给我|我想要?|我需要|希望你|麻烦你|我们要|现在想要?)\s*|(?:新建|创建|开启|开始)(?:一个|一项)?(?:新)?(?:项目|研究|选题)[：:\s]*|(?:研究|分析|调研)(?:一下)?\s*|(?:撰写|写|制作|做|搭建)(?:一篇|一份|一个|篇)?(?:关于)?\s*)/;
    for (let i = 0; i < 12; i++) { const next = topic.replace(prefix, ''); if (next === topic) break; topic = next; }
  }
  topic = clean(unquote(topic));
  if (!named && !quoted) topic = topic.replace(/(?:的)?(?:公众号文章|文章|研究报告|报告)$/u, '').trim();
  return clip(topic || '新项目', 24);
}
export function teamLabel(value = '筑页') {
  return clip(clean(value).split(/[·｜|]/)[0].replace(/\s*v?\d+(?:\.\d+)+(?:\s.*)?$/i, '').trim() || 'AI 团队', 12);
}
export const projectGroupName = (name, team = '筑页') => `${teamLabel(team)} · ${projectLabel('', name)}`;
export const projectCardTitle = (name, role, step) => `${projectLabel('', name)} · ${step}｜${role}`;
export const linkLabel = label => `↗ ${String(label).replace(/^↗\s*/, '')}`;

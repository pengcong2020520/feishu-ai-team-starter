import { plainText } from './presentation.mjs';
// 优先保留用户给定主题；只压缩表达，不让模型另造项目范围。
export function projectLabel(text, explicit) {
  const source = plainText(explicit || text || '').replace(/\s+/g, ' ').trim();
  const quoted = !explicit && source.match(/(?:选题|主题|项目|研究|文章)[：:为是\s]*[「“《]([^」”》]{2,40})[」”》]/);
  const label = (quoted?.[1] || source.replace(/^(?:请你|请|帮我|我想|希望你|麻烦你|我们要|新建一个项目)[，,：:\s]*/g, '').replace(/^(?:研究一下|研究|分析一下|写一篇关于|做一个|搭建一个)\s*/, '').split(/[。；;\n]/)[0]).trim();
  return Array.from(label || '新项目').slice(0, 24).join('');
}
export const projectCardTitle = (name, role, step) => `${projectLabel(name)} · ${step}｜${role}`;
export const linkLabel = label => `↗ ${String(label).replace(/^↗\s*/, '')}`;

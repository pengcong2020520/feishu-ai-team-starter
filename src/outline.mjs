import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { capturePage, defaultChrome } from './sheet.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function outlinePage(outline) {
  const blocks = Array.isArray(outline?.blocks) ? outline.blocks.slice(0, 8) : [];
  const states = Array.isArray(outline?.states) ? outline.states.slice(0, 6) : [];
  const height = 200 + Math.max(blocks.length * 100, states.length * 150);
  const blockRows = blocks.map((block, index) => `<div class="block"><span class="number">${String(index + 1).padStart(2, '0')}</span><div><b>${escape(block.name)}</b><p>${escape(block.content)}</p></div></div>`).join('');
  const stateRows = states.map(state => `<div class="state"><b>${escape(state.name)}</b><code>${escape(state.id)}</code><p>${escape(state.desc)}</p></div>`).join('');
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escape(outline.title)} · 页面结构图</title><style>*{box-sizing:border-box}html,body{width:1280px;height:${height}px;margin:0;overflow:hidden}body{background:#F4F6F9;color:#243247;font:18px/1.45 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;padding:42px 48px}header{height:78px;display:flex;align-items:baseline;gap:22px}h1{font-size:34px;line-height:1.2;margin:0}header span{font-size:15px;color:#8290a3}.layout{display:grid;grid-template-columns:760px 360px;gap:38px}.section-title{font-weight:700;font-size:18px;margin:0 0 15px}.page{min-height:540px;background:#fff;border:2px solid #344157;border-radius:18px;padding:20px 26px 26px;box-shadow:0 8px 25px #2432470b}.dots{display:flex;gap:8px;margin:2px 0 20px}.dots i{width:10px;height:10px;background:#c6cfda;border-radius:50%}.block{height:75px;border:1.5px dashed #a5b6cc;border-radius:10px;margin:0 0 17px;padding:11px 16px;display:flex;align-items:center;gap:16px}.number{width:38px;height:38px;border-radius:7px;background:#3679e8;color:#fff;display:grid;place-items:center;font-size:15px;font-weight:700;flex:none}.block b{font-size:18px}.block p,.state p{margin:2px 0 0;color:#728095;font-size:15px}.state{background:white;border-left:4px solid #3679e8;border-radius:9px;margin-bottom:10px;padding:16px 18px;box-shadow:0 3px 14px #2432470b}.state b{display:block;font-size:17px}.state code{display:inline-block;background:#ecf0f5;color:#65768c;border-radius:5px;padding:2px 7px;font-size:13px;margin-top:7px}.aside-note{color:#8b98a8;font-size:14px;line-height:1.6;margin:16px 2px}</style></head><body><header><h1>${escape(outline.title)}</h1><span>页面结构图 · 由 AI 产品经理根据 PRD 生成，样式待 AI 设计确定</span></header><div class="layout"><section><h2 class="section-title">页面从上到下</h2><div class="page"><div class="dots"><i></i><i></i><i></i></div>${blockRows}</div></section><aside><h2 class="section-title">页面状态</h2>${stateRows}<p class="aside-note">这里只说明页面上有什么；具体怎么排、长什么样，由下一步的线框决定</p></aside></div></body></html>`;
  return { html, width: 1280, height };
}

export async function createOutline({ projectDir, chromePath = defaultChrome(), screenshot = true }) {
  const outline = JSON.parse(await readFile(path.join(projectDir, 'docs/outline.json'), 'utf8'));
  const page = outlinePage(outline);
  const outputDir = path.join(projectDir, 'shots');
  await mkdir(outputDir, { recursive: true });
  const htmlFile = path.join(outputDir, 'outline.html');
  const pngFile = path.join(outputDir, 'outline.png');
  if (!screenshot) await unlink(pngFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await writeFile(htmlFile, page.html);
  return screenshot ? capturePage({ htmlFile, pngFile, width: page.width, height: page.height, chromePath }) : { htmlFile, pngFile, width: page.width, height: page.height };
}

import { readFile, writeFile, mkdir, unlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const exec = promisify(execFile);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const safeHash = value => encodeURIComponent(String(value ?? ''));
const kinds = { design: '线框', site: '网页', walkthrough: '走查' };
export const defaultChrome = () => process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium');

export async function capturePage({ htmlFile, pngFile, width, height, chromePath = defaultChrome() }) {
  await unlink(pngFile).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const outputDir = path.dirname(pngFile);
  const args = ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=5000', '--allow-file-access-from-files', '--force-device-scale-factor=1', `--window-size=${width},${height}`, `--user-data-dir=${path.join(outputDir, '.chrome-profile')}`, `--screenshot=${pngFile}`, pathToFileURL(htmlFile).href];
  if (process.platform === 'linux') args.splice(1, 0, '--no-sandbox');
  try { await exec(chromePath, args, { timeout: 30000, env: { PATH: process.env.PATH ?? '', HOME: outputDir }, maxBuffer: 1024 * 1024 }); }
  catch (error) {
    const picture = await stat(pngFile).catch(() => null);
    if (!picture || picture.size < 1000) throw new Error(error.killed ? 'Chrome 截图超时' : `Chrome 截图失败：${error.code ?? error.message}`);
  }
  if ((await stat(pngFile)).size < 1000) throw new Error('截图文件为空');
  return { htmlFile, pngFile, width, height };
}

async function cellsFor(kind, projectDir) {
  if (kind === 'design') {
    const html = await readFile(path.join(projectDir, 'design/wireframe.html'), 'utf8');
    const match = html.match(/<script\b(?=[^>]*\bid=["']design-outline["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) throw new Error('线框缺少 design-outline');
    const outline = JSON.parse(match[1]);
    return outline.groups.flatMap(group => group.screens.flatMap(screen => screen.states.map(state => ({
      title: screen.title, description: `${group.title} · ${screen.title} · ${state}`,
      file: 'design/wireframe.html', hash: `screen=${safeHash(screen.id)}&state=${safeHash(state)}`,
    })))).slice(0, 6);
  }
  if (kind === 'site') {
    const outline = JSON.parse(await readFile(path.join(projectDir, 'docs/outline.json'), 'utf8'));
    return outline.states.slice(0, 6).map(state => ({ title: state.name, description: state.desc, file: 'site/index.html', hash: `state=${safeHash(state.id)}` }));
  }
  if (kind === 'walkthrough') {
    const report = JSON.parse(await readFile(path.join(projectDir, 'design/walkthrough.json'), 'utf8'));
    return report.groups.flatMap(group => group.screens.map(screen => ({
      title: screen.title, description: `${group.title} · ${screen.note}`, mark: screen.mark,
      file: 'site/index.html', hash: `state=${safeHash(screen.state)}`,
    }))).slice(0, 6);
  }
  throw new Error('未知一览图类型');
}

export async function createSheet({ kind, projectDir, outputDir = path.join(projectDir, 'shots'), chromePath = defaultChrome() }) {
  const cells = await cellsFor(kind, projectDir);
  if (!cells.length) throw new Error('没有可截图的状态');
  await mkdir(outputDir, { recursive: true });
  const htmlFile = path.join(outputDir, `${kind}-sheet.html`);
  const pngFile = path.join(outputDir, `${kind}-sheet.png`);
  const height = 32 * 2 + 60 + Math.ceil(cells.length / 2) * 444 + Math.max(0, Math.ceil(cells.length / 2) - 1) * 24;
  const cards = cells.map((cell, i) => {
    const relative = path.relative(outputDir, path.join(projectDir, cell.file)).split(path.sep).map(safeHash).join('/');
    return `<article><div class="viewport"><iframe sandbox="allow-scripts" scrolling="no" src="${relative}#${cell.hash}"></iframe></div><div class="caption"><b>${i + 1}. ${escape(cell.title)}</b><span>${escape(cell.mark ? `[${cell.mark}] ${cell.description}` : cell.description)}</span></div></article>`;
  }).join('');
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${escape(kinds[kind])}一览</title><style>*{box-sizing:border-box}html,body{margin:0;width:1368px;height:${height}px;overflow:hidden}body{font:16px system-ui,sans-serif;background:#eff1f5;color:#243043;padding:32px 32px}h1{height:60px;margin:0;font-size:28px}.grid{display:grid;grid-template-columns:640px 640px;gap:24px}article{width:640px;height:444px;background:#fff;overflow:hidden;border-radius:10px;box-shadow:0 2px 12px #0002}.viewport{width:640px;height:400px;overflow:hidden}iframe{width:1280px;height:800px;border:0;transform:scale(.5);transform-origin:top left;pointer-events:none}.caption{height:44px;display:flex;align-items:center;gap:12px;padding:0 12px;font-size:14px;white-space:nowrap;overflow:hidden}.caption span{color:#667;overflow:hidden;text-overflow:ellipsis}</style><h1>${escape(kinds[kind])}一览</h1><div class="grid">${cards}</div></html>`;
  await writeFile(htmlFile, html);
  await capturePage({ htmlFile, pngFile, width: 1368, height, chromePath });
  return { htmlFile, pngFile, cells: cells.length, width: 1368, height };
}

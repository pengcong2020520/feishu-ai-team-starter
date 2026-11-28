// 图只由有界数据生成；不运行模型提供的 HTML、SVG、脚本或远程图片地址。
import { mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { capturePage } from './sheet.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const text = (value, max, field) => { if (typeof value !== 'string' || !value.trim() || [...value].length > max || /[\x00-\x1f]/.test(value)) throw Error(`配图的${field}须为 1–${max} 字单行文字`); return value.trim(); };
const wrap = (value, size) => [...value].reduce((rows, c, i) => { if (i % size === 0) rows.push(''); rows[rows.length - 1] += c; return rows; }, []);
const label = (value, x, y, size, limit, color = '#233047') => wrap(value, limit).map((line, i) => `<text x="${x}" y="${y + i * (size + 9)}" font-size="${size}" fill="${color}">${esc(line)}</text>`).join('');

export function figureSvg(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('配图定义须为对象');
  const title = text(input.title, 36, '标题'), source = text(input.source, 100, '来源').replace(/^来源[：:]\s*/, ''), caption = text(input.caption, 140, '图注');
  if (!source) throw Error('配图须填写实际来源');
  let body = '', height;
  if (input.kind === 'flow') {
    if (!Array.isArray(input.steps) || input.steps.length < 2 || input.steps.length > 6) throw Error('流程图需要 2–6 个有序步骤；复杂分支请拆图或使用已有流程截图');
    height = 210 + input.steps.length * 145;
    body = input.steps.map((s, i) => {
      const name = text(s?.name, 24, '步骤名'), note = text(s?.note, 52, '步骤说明'), y = 130 + i * 145;
      return `<rect x="50" y="${y}" width="900" height="120" rx="14" fill="${i % 2 ? '#f1f5fa' : '#eaf4f3'}"/><circle cx="88" cy="${y + 33}" r="19" fill="#16756c"/><text x="88" y="${y + 42}" text-anchor="middle" font-size="25" fill="white">${i + 1}</text>${label(name, 125, y + 34, 27, 30)}${label(note, 125, y + 72, 22, 37, '#526176')}${i < input.steps.length - 1 ? `<path d="M500 ${y + 123}v16m-7-7 7 7 7-7" fill="none" stroke="#73879b" stroke-width="3"/>` : ''}`;
    }).join('');
  } else if (input.kind === 'bar') {
    if (!Array.isArray(input.data) || input.data.length < 2 || input.data.length > 8) throw Error('对比图需要 2–8 项同口径数据');
    const unit = text(input.unit, 12, '单位');
    const values = input.data.map(d => { text(d?.label, 22, '数据标签'); if (typeof d.value !== 'number' || !Number.isFinite(d.value) || d.value < 0 || d.value > 1e12) throw Error('对比图只支持有限的非负数值；负值请用表格说明'); return d.value; });
    const max = Math.max(...values) || 1; height = 250 + input.data.length * 76;
    body = label(`单位：${unit}；从 0 起算`, 50, 136, 22, 40, '#526176') + input.data.map((d, i) => {
      const y = 170 + i * 76, formatted = Number(d.value.toPrecision(6)).toLocaleString('en-US', { maximumFractionDigits: 6 }), value = formatted.length > 10 || (d.value > 0 && d.value < 0.000001) ? d.value.toExponential(2) : formatted;
      return label(d.label, 50, y + 25, 23, 11) + `<rect x="330" y="${y}" width="${Math.max(0, 500 * (d.value / max))}" height="35" rx="4" fill="#16756c"/>` + label(value, 845, y + 26, 23, 14);
    }).join('');
  } else throw Error('配图类型只支持 flow（顺序流程）或 bar（同口径比较）');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="${height}" viewBox="0 0 1000 ${height}"><rect width="1000" height="${height}" fill="white"/><g font-family="PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif">${label(title, 50, 58, 32, 28)}${body}${label('来源：' + source, 50, height - 80, 18, 50, '#65758b')}</g></svg>`;
  return { svg, width: 1000, height, title, caption, source };
}

function imageType(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes.at(-2) === 255 && bytes.at(-1) === 217) return 'jpg';
  if (bytes.length >= 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP') return 'webp';
  throw Error('配图必须是实际的 PNG、JPEG 或 WebP；SVG/HTML 请先受控渲染，不直接上传');
}

export async function prepareDocumentVisuals({ markdown, projectDir, artifactPath, cacheDir, capture = capturePage }) {
  const assets = {}, root = await realpath(projectDir);
  let count = 0;
  const cache = async bytes => {
    if (bytes.length > 8 * 1024 * 1024) throw Error('单张配图超过 8 MB，请压缩或分图');
    const type = imageType(bytes), digest = hash(bytes), file = path.join(cacheDir, `${digest}.${type}`), url = `https://feishu-team.invalid/assets/${digest}.${type}`;
    await mkdir(cacheDir, { recursive: true }); await writeFile(file, bytes);
    assets[url] = { file, hash: digest, size: bytes.length, name: `figure.${type}` }; return url;
  };
  const lines = String(markdown).split('\n'), result = []; let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
    if (!fence && match?.[2].trim() === 'team-figure') {
      if (++count > 8) throw Error('单份文档最多 8 张配图，请按主题拆分');
      const json = []; let closed = false;
      while (++i < lines.length) { if (new RegExp(`^\\s{0,3}${match[1][0]}{${match[1].length},}\\s*$`).test(lines[i])) { closed = true; break; } json.push(lines[i]); }
      if (!closed) throw Error('配图尚未写完，等待完整定义后再同步');
      let spec; try { spec = JSON.parse(json.join('\n')); } catch { throw Error('配图定义不是完整 JSON，请修正后同步'); }
      const figure = figureSvg(spec), id = hash(figure.svg), folder = path.join(cacheDir, 'render', id);
      const htmlFile = path.join(folder, 'figure.html'), pngFile = path.join(folder, 'figure.png');
      await mkdir(folder, { recursive: true });
      await writeFile(htmlFile, `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>html,body{margin:0;background:white}svg{display:block}</style>${figure.svg}`);
      // 固定数据生成固定图；同一版本草稿轮询复用缓存，不重复启动浏览器。
      try { await stat(pngFile); } catch { await capture({ htmlFile, pngFile, width: figure.width, height: figure.height }); }
      const url = await cache(await readFile(pngFile));
      result.push(`![${figure.title.replace(/[\[\]]/g,'')}](${url})`, '', `图注：${figure.caption}`, '', `来源：${figure.source}`);
      continue;
    }
    if (match) {
      if (!fence) fence = { char: match[1][0], length: match[1].length };
      else if (match[1][0] === fence.char && match[1].length >= fence.length && !match[2].trim()) fence = null;
      result.push(lines[i]); continue;
    }
    if (fence) { result.push(lines[i]); continue; }
    let line = lines[i];
    const code = [...line.matchAll(/(`+)(.*?)\1/g)].map(m => [m.index, m.index + m[0].length]);
    for (const image of lines[i].matchAll(/!\[([^\]\n]*)\]\((<[^>\n]+>|[^\s()]+)\)/g)) {
      if (code.some(([start, end]) => image.index >= start && image.index < end) || /(?:^|[^\\])(?:\\\\)*\\$/.test(lines[i].slice(0, image.index))) continue;
      if (++count > 8) throw Error('单份文档最多 8 张配图，请按主题拆分');
      let ref; try { ref = decodeURIComponent(image[2].replace(/^<|>$/g,'')); } catch { throw Error('图片路径编码无效'); }
      if (/^(?:[a-z][\w+.-]*:|[\/\\])/i.test(ref) || /[\x00-\x1f]/.test(ref)) throw Error('图片须先保存为本项目中的相对路径；不自动下载远程图片或读取绝对路径');
      const file = await realpath(path.resolve(root, path.dirname(artifactPath), ref));
      if (!file.startsWith(root + path.sep)) throw Error('图片路径超出当前项目');
      const info = await stat(file); if (!info.isFile() || info.size > 8 * 1024 * 1024) throw Error('图片文件无效或超过 8 MB');
      const url = await cache(await readFile(file)); line = line.replace(image[0], `![${image[1]}](${url})`);
    }
    result.push(line);
  }
  return { markdown: result.join('\n'), assets, digest: hash(JSON.stringify(Object.values(assets).map(a => a.hash))) };
}

export async function readDocumentImage(asset) {
  const bytes = await readFile(asset.file);
  if (bytes.length !== asset.size || hash(bytes) !== asset.hash) throw Error('待发布图片已变化，请恢复该版本的图片缓存后重试');
  imageType(bytes); return bytes;
}

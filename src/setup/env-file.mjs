import { chmodSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export function readEnv(file) {
  return existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
}

// 没有 .env 就按模板建一个；有的话只把权限收紧到 600
export function ensureEnv(file, template) {
  if (!existsSync(file)) writeFileSync(file, existsSync(template) ? readFileSync(template, 'utf8') : '', { mode: 0o600 });
  chmodSync(file, 0o600);
}

function quote(value) {
  const text = String(value);
  if (/[\r\n]/.test(text)) throw new Error('配置值不能换行');
  if (/^[\w.:/@+=,-]*$/.test(text)) return text;
  if (!text.includes("'")) return `'${text}'`;
  if (!text.includes('"') && !text.includes('\\')) return `"${text}"`;
  throw new Error('配置值同时含单引号和双引号，请手动填写到 .env');
}

// 更新式写入：同名变量就地替换（重复的也一起替换），没有的追加；先写临时文件再改名
export function updateEnv(file, updates) {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
  if (lines.at(-1) === '') lines.pop();
  const rendered = Object.fromEntries(Object.entries(updates).map(([name, value]) => [name, `${name}=${quote(value)}`]));
  const seen = new Set();
  const out = lines.map(line => {
    const name = /^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=/.exec(line)?.[1];
    if (!name || !Object.hasOwn(rendered, name)) return line;
    seen.add(name);
    return rendered[name];
  });
  for (const name of Object.keys(rendered)) if (!seen.has(name)) out.push(rendered[name]);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${out.join('\n')}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  chmodSync(file, 0o600);
}

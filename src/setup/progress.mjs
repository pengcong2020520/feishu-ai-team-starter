import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// 启动命令的进度（不含密钥）：模型是否连通、群 ID、群主 open_id 等
const fileOf = root => path.join(root, 'data/setup.json');

export function readProgress(root) {
  try { return JSON.parse(readFileSync(fileOf(root), 'utf8')); } catch { return {}; }
}

export function saveProgress(root, patch) {
  const next = { ...readProgress(root), ...patch };
  mkdirSync(path.dirname(fileOf(root)), { recursive: true });
  const tmp = `${fileOf(root)}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(tmp, fileOf(root));
  return next;
}

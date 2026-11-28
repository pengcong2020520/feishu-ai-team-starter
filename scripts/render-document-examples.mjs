// 重建指南中的确定性插图。只读固定图形数据，不运行模型生成的页面。
import { readFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareDocumentVisuals } from '../src/document-visuals.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const folder = path.join(root, 'docs/examples');
const figures = JSON.parse(await readFile(path.join(folder, 'figures.json'), 'utf8'));
await mkdir(path.join(folder, 'assets'), { recursive: true });
for (const [name, spec] of Object.entries(figures)) {
  if (!/^[a-z][a-z-]+$/.test(name)) throw Error('示例图名无效');
  const visual = await prepareDocumentVisuals({ markdown: '```team-figure\n' + JSON.stringify(spec) + '\n```', projectDir: folder, artifactPath: '图文文档示例.md', cacheDir: path.join(root, 'data/document-example-assets') });
  await copyFile(Object.values(visual.assets)[0].file, path.join(folder, 'assets', name + '.png'));
  console.log(`已生成 ${name}.png`);
}

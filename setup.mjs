#!/usr/bin/env node
// 一条命令搭好飞书 AI 团队：每次做下一件能做的事，最后打印“== 下一步 ==”，由 AI 助手在对话里转述给用户。
// 只用 Node 自带模块；飞书 SDK 等依赖由它在后台装好后再加载。
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  console.log(`\n== 下一步 ==\n需要用户：安装 Node.js 24 或更高版本（现在是 ${process.versions.node}），装好后重跑 node setup.mjs`);
  process.exit(1);
}
const { runSetup } = await import('./src/setup/run.mjs');
const readStdin = async () => {
  if (process.stdin.isTTY) return '';
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
};
process.exitCode = await runSetup({ root: path.dirname(fileURLToPath(import.meta.url)), argv: process.argv.slice(2), env: process.env, readStdin });

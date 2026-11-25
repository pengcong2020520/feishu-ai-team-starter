import path from 'node:path';
import { runAgent } from '../src/agents/run.mjs';
import { roles } from '../src/agents/roles.mjs';

const [role, projectDir, prompt, flag, resume] = process.argv.slice(2);
if (!roles[role] || !projectDir || !prompt || (flag && (flag !== '--resume' || !resume))) {
  console.error('用法：node scripts/try-agent.mjs <角色> <项目目录> <任务> [--resume <会话 id>]');
  process.exitCode = 2;
} else {
  const names = { Read: '读取', Write: '写入', Edit: '修改', Glob: '搜索', Skill: '使用技能' };
  const result = await runAgent({
    role, projectDir: path.resolve(projectDir), prompt, resume,
    onProgress({ tool, file }) { console.log(`${names[tool] ?? tool}：${file || '项目目录'}`); },
  });
  console.log(`回复：${result.text || '无'}`);
  console.log(`会话 id：${result.sessionId ?? '无'}`);
  console.log(`轮数：${result.stats.turns}`);
  console.log(`用时：${(result.stats.durationMs / 1000).toFixed(1)} 秒`);
  console.log(`读入 ${result.stats.inputTokens} / 写出 ${result.stats.outputTokens} token`);
  if (!result.ok) { console.error(`失败：${result.error}`); process.exitCode = 1; }
}

// 本文件只包含本平台适配代码；上游角色文字在使用者安装时按固定提交下载。
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { installPackage, digest } from './store.mjs';

export const NEWTYPE_REVISION = 'e22b7771549572439a092295bb370075ded261a3';
const LICENSE_REVISION = '740531627623b72a230ce2d533c31d11f6b1521b';
const base = `https://raw.githubusercontent.com/newtype-01/newtype-codex/${NEWTYPE_REVISION}/plugins/newtype-codex/`;
const roles = [
  ['chief', 'AI 主编', '协调目标、选择路由和最终汇总', 'report', false],
  ['deputy', 'AI 副主编', '拆解任务、给出角色交接与依赖计划', 'planning', false],
  ['researcher', 'AI 研究员', '寻找并整理公开来源', 'research', true],
  ['fact-checker', 'AI 事实核查', '验证关键断言、数字与引用', 'checks', true],
  ['extractor', 'AI 资料提取', '提取已提供的文本、网页和 SDK 可读图片', 'extraction', true],
  ['writer', 'AI 作者', '依据写作简报及来源起草内容', 'drafts', false],
  ['editor', 'AI 编辑', '改进已有稿件的结构和表达', 'editing', false],
  ['archivist', 'AI 资料管理员', '先查项目知识并归档已确认内容', '.newtype/knowledge', false],
];
export async function installNewtype(root = process.cwd(), fetchImpl = fetch) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'newtype-feishu-'));
  const files = new Set(['manifest.json']);
  const write = async (file, text) => { files.add(file); await mkdir(path.dirname(path.join(dir, file)), { recursive: true }); await writeFile(path.join(dir, file), text); };
  const get = async url => { const r = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000) }); if (!r.ok) throw Error(`Newtype 来源下载失败（HTTP ${r.status}）`); const text = await r.text(); if (text.length > 500000) throw Error('Newtype 来源文件过大'); return text; };
  try {
    const metadata = JSON.parse(await get(base + '.codex-plugin/plugin.json'));
    if (metadata.license !== 'SUL-1.0') throw Error('上游许可声明发生变化，停止适配');
    const licenseUrl = `https://raw.githubusercontent.com/newtype-01/newtype-os/${LICENSE_REVISION}/LICENSE.md`;
    await write('LICENSE', await get(licenseUrl));
    await write('upstream/plugin.json', JSON.stringify(metadata, null, 2));
    await write('upstream/chief-skill.md', await get(base + 'skills/newtype-chief/SKILL.md'));
    await write('upstream/workflow.md', await get(base + 'references/newtype-agent-workflow.md'));
    await write('THIRD_PARTY_NOTICES.md', `# Newtype 适配声明\n\n来源：newtype-01/newtype-codex，提交 ${NEWTYPE_REVISION}，插件声明 SUL-1.0。该提交仓库根目录未提供 LICENSE 文件；随包保留同作者 newtype-os 提交 ${LICENSE_REVISION} 的 SUL 文本及出处 ${licenseUrl}，并未声称两仓库的文件清单相同。用途受上游许可限制，不能将本包标为 MIT 或据此推定可商业再分发。\n\n修改：提取八个角色的 developer_instructions，增加飞书平台适配段；将宿主专用代理调度改为平台验证后的计划；将工作区、读写权限、网络工具映射为本平台能力。原文在 upstream/，不运行其安装器、不修改全局 Codex 设置。\n`);
    const directories = [...new Set(roles.map(r => r[3])), '.newtype/workbench', 'inputs'];
    const read = [...directories, 'context']; const definitions = [], skills = [], artifacts = [];
    for (const [id, name, description, folder, network] of roles) {
      const toml = await get(base + `templates/agents/newtype_${id.replaceAll('-', '_')}.toml`);
      const instructions = toml.match(/developer_instructions\s*=\s*"""([\s\S]*?)"""/)?.[1]?.trim();
      if (!instructions) throw Error(`无法解析上游角色 ${id}，停止适配`);
      await write(`upstream/${id}.toml`, toml);
      const adaptation = `\n\n## 飞书适配（本平台修改）\n用户已选择本团队，由平台执行角色调度；不要调用 spawn/wait/close、安装器、Bash 或修改全局配置。你只执行本次指定的角色任务，输出中文。跨角色交接通过项目文件，由平台决定下一步。必须使用 team:${id}-method 技能。只读本项目上下文；实际产物写入 ${folder}/。检索使用 mcp__research__search，网页读取用 mcp__research__read_url；工具不可用时记录缺口，不编造检索。PDF、音视频当前需用户提供提取文本。\n`;
      await write(`agents/${id}.md`, instructions + adaptation);
      const sid = id + '-method';
      await write(`skills/${sid}/SKILL.md`, `---\nname: ${sid}\ndescription: ${description}\n---\n\n本技能改编自 Newtype，原始许可 SUL-1.0，参见包内 THIRD_PARTY_NOTICES.md。\n\n${instructions}${adaptation}\n以本次任务列出的文件为交付契约。引用资料时给出来源、日期和不确定性。\n`);
      definitions.push({ id, name, description, prompt: `agents/${id}.md`, skills: [sid], tools: ['Read', 'Write', 'Edit', 'Glob', 'Skill', ...(network ? ['WebFetch', 'WebSearch'] : [])], read, write: [folder], memory: 'project', model: ['chief', 'writer'].includes(id) ? 'strong' : 'default', color: 'purple' });
      skills.push({ id: sid, version: '1.0.0', path: `skills/${sid}/SKILL.md`, description, inputs: ['用户简报', '当前项目已有资料'], outputs: [folder + '/result.md'], tools: ['Read', 'Write', ...(network ? ['WebFetch', 'WebSearch'] : [])], resources: [] });
      artifacts.push({ id, name: description, path: `${folder}/result.md`, format: 'markdown' });
    }
    artifacts.push({ id: 'archive-note', name: '已确认内容归档', path: '.newtype/knowledge/accepted.md', format: 'markdown' });
    await write('workspace/inputs.md', '# 用户资料\n在当前项目 inputs/ 放入已有稿件或来源文本；可在目标和讨论中给出公开 HTTPS 来源。\n');
    await write('collaboration/SKILL.md', '---\nname: newtype-collaboration\ndescription: 主编沟通，副主编规划，平台代表主编调度专业角色，主编汇总。\n---\n\n按最小够用的团队执行。纯讨论由主编回应；正式交付由副主编选择任务，主编作为协作责任人通过平台执行。已有稿件优先编辑而非强制起草；现成来源足够可直接写；外部新事实先研究、必要时核查；已有项目知识先查档案；用户提供待提取材料时先提取。最后主编汇总，人工验收后归档。只重试失败任务。\n\n任务状态由平台写 context/；来源与知识保存在本项目 .newtype/knowledge/，不能跨项目自动引用原文。上游宿主安装和工具指令只作来源留档，本平台不执行。\n');
    const task = (id, role, name, after, prompt) => ({ id, name, role, skills: [role + '-method'], prompt, outputs: [role], after });
    const tasks = [
      task('lookup', 'archivist', '查项目知识', [], '先读取本项目 .newtype/knowledge/ 与 inputs/，将可复用材料和缺口写入 .newtype/knowledge/result.md。'),
      task('extract', 'extractor', '提取用户资料', ['lookup'], '读取用户给出的资料或公开 URL；提取信息及出处写 extraction/result.md。不能处理的格式明确列出。'),
      task('research', 'researcher', '研究公开来源', ['lookup', 'extract'], '围绕目标检索或阅读给定来源，写 research/result.md；保留来源 URL、日期和具体支持事实。'),
      task('verify', 'fact-checker', '核查来源', ['lookup', 'extract', 'research'], '核查已取得资料的重要主张，写 checks/result.md，标明支持、矛盾、无法核实。'),
      task('draft', 'writer', '起草文章', ['lookup', 'extract', 'research', 'verify'], '按目标及已有资料写 drafts/result.md，不能引入没有来源的新事实。'),
      task('edit', 'editor', '编辑稿件', ['lookup', 'extract', 'research', 'verify', 'draft'], '编辑已有用户稿件或 drafts/result.md，写 editing/result.md，保留作者观点和事实程度。'),
      task('final-check', 'fact-checker', '交付前核查', ['lookup', 'extract', 'research', 'verify', 'draft', 'edit'], '检查最终稿的主张、引用和日期；写 checks/result.md，未证实内容须在最终交付中标明。'),
      task('synthesis', 'chief', '主编汇总', ['lookup', 'extract', 'research', 'verify', 'draft', 'edit', 'final-check'], '将已完成材料汇总成符合用户目标的 report/result.md；如果只是讨论则直接答复。保留重要来源和缺口，不用数字自评。'),
    ];
    const workflow = { entry: 'planning', coordinator: 'chief', relations: definitions.map(r => ({ from: 'chief', to: r.id, kind: 'dispatch' })), nodes: [
      { id: 'planning', name: '选择协作方案', type: 'plan', role: 'deputy', skills: ['deputy-method'], prompt: '依据用户目标选择最小够用方案，只返回声明任务的 id 和依赖，不创建新角色。简单讨论仅 synthesis；已有草稿选 edit，不要无故 draft；新事实研究选 research 与必要核查；有资料先 extract；有历史知识先 lookup。synthesis 为最后一项。依赖按目录中的 after 约束执行（仅对选中的任务生效）。', tasks, required: ['synthesis'], final: 'synthesis', next: 'accept' },
      { id: 'accept', name: '验收内容', type: 'gate', role: 'chief', approval: 'accept', next: 'archive', reject: 'planning' },
      { id: 'archive', name: '归档确认内容', type: 'task', role: 'archivist', skills: ['archivist-method'], prompt: '将人工已确认的 report/result.md 结论、来源及可复用知识归档至 .newtype/knowledge/accepted.md。只在当前项目保存。', outputs: ['archive-note'], next: 'done' },
      { id: 'done', name: '已完成', type: 'done' },
    ] };
    await write('collaboration/workflow.json', JSON.stringify(workflow, null, 2));
    const manifest = { schemaVersion: 1, runtime: 'feishu-team/1', id: 'newtype-editorial', name: '文枢 · Newtype 内容团队', version: '1.0.0', description: 'Newtype 八角色的飞书适配；按目标选择研究、提取、写作、编辑、核查和归档。', author: 'newtype-01; Feishu adapter contributors', license: 'SUL-1.0', workflow: 'collaboration/workflow.json', collaboration: 'collaboration/SKILL.md', files: [...files].sort(), roles: definitions, skills, workspace: { directories, templates: [{ source: 'workspace/inputs.md', target: 'inputs/README.md' }] }, artifacts, examples: [{ name: '编辑已有短文', demand: '编辑这段文字为清楚简洁的短文：我们把团队工作过程分成角色定义、技能和协作规范，让一套本地验证过的流程可以被别人安装复现。不增加未经验证的新事实。', expectedArtifacts: ['editor', 'chief', 'archive-note'] }], sources: [{ url: 'https://github.com/newtype-01/newtype-codex', revision: NEWTYPE_REVISION, license: 'SUL-1.0', notice: 'THIRD_PARTY_NOTICES.md' }] };
    await write('manifest.json', JSON.stringify(manifest, null, 2));
    return await installPackage(dir, root);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

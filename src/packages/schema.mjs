import { z } from 'zod';

export const identifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).refine(x => !['constructor', 'prototype', '__proto__'].includes(x), '不能使用保留名称');
export const relativePath = z.string().min(1).max(240).refine(p => !p.startsWith('/') && !/[\\\x00-\x1f:]/.test(p) && p.split('/').every(x => x && x !== '.' && x !== '..'), '必须是包内相对路径');
const text = z.string().trim().min(1).max(24000);
const list = schema => z.array(schema).max(200);
const tools = z.enum(['Read', 'Write', 'Edit', 'Glob', 'Skill', 'WebFetch', 'WebSearch', 'Calculate']);
const version = z.string().regex(/^\d+\.\d+\.\d+$/);
const artifact = z.object({ id: identifier, name: text, path: relativePath, format: z.enum(['markdown', 'text', 'json', 'html']), requiredKeys: list(identifier).default([]), minBytes: z.number().int().min(1).max(1000000).default(1) }).strict();
export const manifestSchema = z.object({
  schemaVersion: z.literal(1), runtime: z.literal('feishu-team/1'), id: identifier, name: text, version, description: text, author: text, license: text,
  files: z.array(relativePath).min(1).max(500), workflow: relativePath, collaboration: relativePath,
  roles: z.array(z.object({ id: identifier, name: text, description: text, prompt: relativePath, skills: list(identifier), tools: z.array(tools).min(1), read: z.array(relativePath).min(1), write: list(relativePath), memory: z.literal('project'), model: z.enum(['default', 'strong', 'fast']).default('default'), color: z.enum(['blue', 'purple', 'green', 'orange', 'red', 'turquoise', 'indigo']).default('blue') }).strict()).min(1).max(20),
  skills: list(z.object({ id: identifier, version, path: relativePath, description: text, inputs: list(text), outputs: list(text), tools: list(tools), resources: list(relativePath).default([]) }).strict()),
  workspace: z.object({ directories: z.array(relativePath).min(1), templates: list(z.object({ source: relativePath, target: relativePath }).strict()).default([]) }).strict(),
  artifacts: list(artifact),
  examples: z.array(z.object({ name: text, demand: text, expectedArtifacts: list(identifier) }).strict()).min(1),
  sources: list(z.object({ url: z.string().url(), revision: text, license: text, notice: relativePath }).strict()).default([]),
}).strict();
const task = {
  role: identifier, skills: list(identifier), prompt: text, outputs: list(identifier),
  timeoutMinutes: z.number().int().min(1).max(30).default(10), freshSession: z.boolean().default(false),
  validator: z.enum(['files', 'web-clarify', 'web-prd', 'web-design', 'web-site', 'web-walkthrough']).default('files'),
};
const catalogueTask = z.object({ id: identifier, name: text, ...task, after: list(identifier).default([]) }).strict();
export const workflowSchema = z.object({
  entry: identifier, coordinator: identifier, maxSteps: z.number().int().min(1).max(200).default(80),
  relations: z.array(z.object({ from: identifier, to: identifier, kind: z.enum(['dispatch', 'handoff', 'review', 'synthesize']) }).strict()).min(1),
  nodes: z.array(z.discriminatedUnion('type', [
    z.object({ id: identifier, name: text, type: z.literal('task'), ...task, next: identifier, questions: identifier.optional(), route: z.object({ artifact: identifier, field: identifier, cases: z.record(identifier, identifier) }).strict().optional() }).strict(),
    z.object({ id: identifier, name: text, type: z.literal('gate'), role: identifier, approval: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), next: identifier, reject: identifier.optional(), questions: z.boolean().default(false) }).strict(),
    z.object({ id: identifier, name: text, type: z.literal('plan'), role: identifier, skills: list(identifier), prompt: text, tasks: z.array(catalogueTask).min(1).max(30), required: z.array(identifier).min(1), final: identifier, next: identifier }).strict(),
    z.object({ id: identifier, name: text, type: z.literal('done') }).strict(),
  ])).min(2).max(60),
}).strict();

const unique = (items, label) => { if (new Set(items).size !== items.length) throw Error(`${label}重复`); };
export const within = (prefix, p) => p === prefix || p.startsWith(prefix + '/');

export function validateDefinition(manifest, workflow) {
  const m = manifestSchema.parse(manifest), w = workflowSchema.parse(workflow);
  unique(m.files, '文件'); unique(m.roles.map(r => r.id), '角色'); unique(m.skills.map(s => s.id), '技能'); unique(m.artifacts.map(a => a.id), '产物'); unique(w.nodes.map(n => n.id), '节点');
  const roles = new Map(m.roles.map(r => [r.id, r])), skills = new Map(m.skills.map(s => [s.id, s])), artifacts = new Map(m.artifacts.map(a => [a.id, a]));
  const declared = f => { if (!m.files.includes(f)) throw Error(`文件未声明：${f}`); };
  [m.workflow, m.collaboration, 'LICENSE', ...m.sources.map(s => s.notice)].forEach(declared);
  const dirs = m.workspace.directories;
  if (dirs.some(d => ['context', '.team', '.claude'].some(x => within(x, d)))) throw Error('Workspace 不能占用平台目录');
  for (const r of m.roles) {
    declared(r.prompt);
    if (r.skills.length && !r.tools.includes('Skill')) throw Error(`角色 ${r.id} 声明了技能但没有 Skill 工具`);
    for (const d of r.write) if (!dirs.some(x => within(x, d))) throw Error(`角色 ${r.id} 写目录未声明`);
    for (const d of r.read) if (d !== 'context' && !dirs.some(x => within(x, d))) throw Error(`角色 ${r.id} 读目录未声明`);
    for (const s of r.skills) { if (!skills.has(s)) throw Error(`角色 ${r.id} 引用未知技能 ${s}`); if (skills.get(s).tools.some(t => !r.tools.includes(t))) throw Error(`技能 ${s} 的工具未授予角色 ${r.id}`); }
  }
  for (const s of m.skills) { declared(s.path); s.resources.forEach(declared); if (s.path !== `skills/${s.id}/SKILL.md`) throw Error('技能须放在 skills/<id>/SKILL.md'); }
  for (const t of m.workspace.templates) { declared(t.source); if (!dirs.some(x => within(x, t.target))) throw Error('模板目标超出 Workspace'); }
  for (const a of m.artifacts) if (!dirs.some(x => within(x, a.path))) throw Error(`产物 ${a.id} 超出 Workspace`);
  for (const e of m.examples) for (const a of e.expectedArtifacts) if (!artifacts.has(a)) throw Error(`示例引用未知产物 ${a}`);
  if (!roles.has(w.coordinator)) throw Error('协调角色不存在');
  for (const r of w.relations) if (!roles.has(r.from) || !roles.has(r.to)) throw Error('协作关系引用未知角色');
  const checkTask = t => {
    const r = roles.get(t.role); if (!r) throw Error(`未知角色 ${t.role}`);
    if (t.role !== w.coordinator && !w.relations.some(x => x.from === w.coordinator && x.to === t.role && x.kind === 'dispatch')) throw Error(`协调者未获授权调度 ${t.role}`);
    for (const s of t.skills) if (!r.skills.includes(s)) throw Error(`任务引用角色未获授权的技能 ${s}`);
    for (const id of t.outputs) { const a = artifacts.get(id); if (!a || !r.write.some(d => within(d, a.path))) throw Error(`任务产物 ${id} 不在角色写入范围`); }
  };
  const ids = w.nodes.map(n => n.id), edges = new Map();
  for (const n of w.nodes) {
    if (n.type === 'task') {
      checkTask(n);
      if (n.validator === 'web-clarify' && !n.questions) throw Error('网页澄清必须声明问题分支');
      if (n.route && (!n.outputs.includes(n.route.artifact) || artifacts.get(n.route.artifact)?.format !== 'json' || !Object.keys(n.route.cases).length || Object.keys(n.route.cases).length > 12)) throw Error('分支必须引用本步 JSON 产物并声明 1–12 个枚举结果');
    }
    if (n.type === 'gate' && !roles.has(n.role)) throw Error('确认节点角色不存在');
    if (n.type === 'plan') {
      checkTask({ ...n, outputs: [] }); unique(n.tasks.map(t => t.id), '可选任务');
      n.tasks.forEach(checkTask);
      for (const id of [...n.required, n.final, ...n.tasks.flatMap(t => t.after)]) if (!n.tasks.some(t => t.id === id)) throw Error(`计划引用未知任务 ${id}`);
      if (!n.required.includes(n.final)) throw Error('计划的最终汇总任务必须是必做任务');
    }
    const next = [n.next, n.reject, n.questions, ...Object.values(n.route?.cases || {})].filter(x => typeof x === 'string');
    for (const id of next) if (!ids.includes(id)) throw Error(`不存在的下一步 ${id}`);
    edges.set(n.id, next);
  }
  if (!ids.includes(w.entry)) throw Error('入口节点不存在');
  const reachable = new Set(), visit = id => { if (reachable.has(id)) return; reachable.add(id); edges.get(id).forEach(visit); }; visit(w.entry);
  if (ids.some(id => !reachable.has(id)) || !w.nodes.some(n => n.type === 'done' && reachable.has(n.id))) throw Error('工作流有不可达节点或缺少结束节点');
  for (const start of ids) { const seen = new Set(); const reachesEnd = id => { if (seen.has(id)) return false; seen.add(id); return w.nodes.find(n => n.id === id).type === 'done' || edges.get(id).some(reachesEnd); }; if (!reachesEnd(start)) throw Error(`节点 ${start} 无法结束`); }
  return { manifest: m, workflow: w };
}

// 规划只可选择作者声明的任务。选中任务的先后约束、最终汇总和权限由代码守住。
export function validatePlan(node, plan, manifest) {
  const parsed = z.object({ rationale: text, tasks: z.array(z.object({ id: identifier, after: list(identifier), brief: z.string().max(2000).optional() }).strict()).min(1).max(30) }).strict().parse(plan);
  const selected = new Map(parsed.tasks.map(t => [t.id, t])); unique(parsed.tasks.map(t => t.id), '计划任务');
  const catalogue = new Map(node.tasks.map(t => [t.id, t]));
  for (const id of node.required) if (!selected.has(id)) throw Error(`计划漏掉必做任务 ${id}`);
  const ancestors = (id, chain = new Set()) => { if (chain.has(id)) throw Error('计划依赖成环'); const t = selected.get(id); if (!t) throw Error(`计划依赖未知任务 ${id}`); const next = new Set([...chain, id]); return new Set(t.after.flatMap(x => [x, ...ancestors(x, next)])); };
  const deps = new Map();
  for (const t of parsed.tasks) { if (!catalogue.has(t.id)) throw Error(`计划选择未知任务 ${t.id}`); deps.set(t.id, ancestors(t.id)); }
  for (const t of parsed.tasks) {
    for (const id of catalogue.get(t.id).after) if (selected.has(id) && !deps.get(t.id).has(id)) throw Error(`计划缺少交接顺序 ${id} → ${t.id}`);
    if (t.id !== node.final && !deps.get(node.final).has(t.id)) throw Error('最终汇总必须等全部选中任务完成');
  }
  for (let i = 0; i < parsed.tasks.length; i++) for (const b of parsed.tasks.slice(i + 1)) {
    const a = parsed.tasks[i]; if (deps.get(a.id).has(b.id) || deps.get(b.id).has(a.id)) continue;
    const ar = manifest.roles.find(r => r.id === catalogue.get(a.id).role), br = manifest.roles.find(r => r.id === catalogue.get(b.id).role);
    if (ar.id === br.id || ar.write.some(x => br.write.some(y => within(x, y) || within(y, x)))) throw Error('并行任务不能共用角色会话或写目录');
  }
  return parsed;
}

export const planOutputSchema = { type: 'object', additionalProperties: false, required: ['rationale', 'tasks'], properties: { rationale: { type: 'string' }, tasks: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['id', 'after'], properties: { id: { type: 'string' }, after: { type: 'array', items: { type: 'string' } }, brief: { type: 'string', description: '本任务具体交接说明，不改变权限或流程约束' } } } } } };

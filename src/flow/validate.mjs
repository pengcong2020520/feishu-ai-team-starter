import { readFile } from 'node:fs/promises';
import path from 'node:path';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const id = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);

async function load(projectDir, file, errors, json = false) {
  try {
    const text = await readFile(path.join(projectDir, file), 'utf8');
    if (!text.trim()) throw new Error('文件为空');
    return json ? JSON.parse(text) : text;
  } catch (error) {
    errors.push(`${file}：${error.code === 'ENOENT' ? '文件不存在' : json && error instanceof SyntaxError ? 'JSON 无法解析' : error.message}`);
    return null;
  }
}

function requireFields(value, fields, label, errors) {
  if (!object(value)) { errors.push(`${label}：应为对象`); return false; }
  for (const field of fields) if (!nonempty(value[field])) errors.push(`${label}.${field}：必填字符串`);
  return true;
}

export async function validateQuestions(projectDir) {
  const errors = [];
  const data = await load(projectDir, 'docs/questions.json', errors, true);
  if (data !== null) {
    if (!object(data) || !Number.isInteger(data.round) || data.round < 1 || data.round > 3) errors.push('docs/questions.json.round：应为 1–3');
    if (!nonempty(data?.why)) errors.push('docs/questions.json.why：必填');
    if (!Array.isArray(data?.questions) || data.questions.length < 1 || data.questions.length > 3) errors.push('docs/questions.json.questions：应有 1–3 题');
    else data.questions.forEach((q, i) => {
      const label = `docs/questions.json.questions[${i}]`;
      requireFields(q, ['id', 'question', 'matters', 'reason'], label, errors);
      if (!Array.isArray(q?.options) || q.options.length < 2 || q.options.length > 4 || !q.options.every(nonempty)) errors.push(`${label}.options：应有 2–4 个非空选项`);
      if (!Number.isInteger(q?.recommended) || q.recommended < 0 || q.recommended >= (q.options?.length ?? 0)) errors.push(`${label}.recommended：选项下标无效`);
    });
  }
  return { ok: errors.length === 0, errors };
}

export async function validatePrd(projectDir) {
  const errors = [];
  const prd = await load(projectDir, 'docs/prd.md', errors);
  const outline = await load(projectDir, 'docs/outline.json', errors, true);
  const checklist = await load(projectDir, 'docs/checklist.md', errors);
  if (prd !== null) {
    if (!/^# \S.+/u.test(prd.split(/\r?\n/)[0])) errors.push('docs/prd.md：第一行应为网页名称标题');
    for (const heading of ['产品概述', '目标用户与场景', '用户故事', '页面与状态', '边界情况', '功能需求', '成功标准', '假设', '本期不做']) {
      // 标题前带编号也认：“## 1. 产品概述”“## 一、产品概述”
      if (!new RegExp(`^#{2,3}\\s*(?:[（(]?[0-9一二三四五六七八九十]+[.、．)）]?\\s*)?${heading}`, 'm').test(prd)) errors.push(`docs/prd.md：缺少“${heading}”章节`);
    }
    if (!/FR-\d{3}/.test(prd)) errors.push('docs/prd.md：缺少 FR-xxx');
    if (!/SC-\d{3}/.test(prd)) errors.push('docs/prd.md：缺少 SC-xxx');
    if (!/假如.+当.+那么/u.test(prd)) errors.push('docs/prd.md：缺少用户故事验收场景');
  }
  if (outline !== null) {
    if (!nonempty(outline?.title)) errors.push('docs/outline.json.title：必填');
    for (const [field, max, fields] of [['blocks', 8, ['name', 'content']], ['states', 6, ['id', 'name', 'desc']]]) {
      const entries = outline?.[field];
      if (!Array.isArray(entries) || entries.length < 1 || entries.length > max) errors.push(`docs/outline.json.${field}：应有 1–${max} 项`);
      else entries.forEach((entry, i) => {
        requireFields(entry, fields, `docs/outline.json.${field}[${i}]`, errors);
        if (field === 'states' && !id(entry?.id)) errors.push(`docs/outline.json.states[${i}].id：格式无效`);
        if (field === 'blocks' && entry?.content?.length > 60) errors.push(`docs/outline.json.blocks[${i}].content：超过 60 字`);
      });
    }
    if (prd !== null) {
      if (prd.split(/\r?\n/)[0].slice(2).trim() !== outline.title) errors.push('docs/outline.json.title：与 PRD 标题不一致');
      for (const state of outline.states ?? []) if (id(state?.id) && !prd.includes(state.id)) errors.push(`docs/prd.md：缺少状态 ${state.id}`);
    }
  }
  if (checklist !== null) {
    for (let i = 1; i <= 14; i++) if (!new RegExp(`- \\[([ x])\\] CHK${String(i).padStart(3, '0')}`).test(checklist)) errors.push(`docs/checklist.md：缺少 CHK${String(i).padStart(3, '0')}`);
  }
  return { ok: errors.length === 0, errors };
}

export async function validateDesign(projectDir) {
  const errors = [];
  const html = await load(projectDir, 'design/wireframe.html', errors);
  const theme = await load(projectDir, 'design/theme.json', errors, true);
  const outline = await load(projectDir, 'docs/outline.json', errors, true);
  if (html !== null) {
    if (!/<html\b/i.test(html) || !/<\/html>/i.test(html)) errors.push('design/wireframe.html：缺少完整 HTML');
    const match = html.match(/<script\b(?=[^>]*\bid=["']design-outline["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/i);
    if (!match) errors.push('design/wireframe.html：缺少 design-outline JSON');
    else {
      try {
        const data = JSON.parse(match[1]);
        if (!Array.isArray(data.groups) || !data.groups.length) errors.push('design-outline.groups：应为非空数组');
        else {
          const stateIds = new Set();
          data.groups.forEach((group, gi) => {
            requireFields(group, ['id', 'title'], `design-outline.groups[${gi}]`, errors);
            if (!Array.isArray(group.screens) || !group.screens.length) errors.push(`design-outline.groups[${gi}].screens：应为非空数组`);
            else group.screens.forEach((screen, si) => {
              requireFields(screen, ['id', 'title'], `design-outline.groups[${gi}].screens[${si}]`, errors);
              if (!Array.isArray(screen.states) || !screen.states.length || !screen.states.every(id)) errors.push(`design-outline.groups[${gi}].screens[${si}].states：状态无效`);
              else for (const state of screen.states) {
                stateIds.add(state);
                if (!html.includes(`data-screen="${screen.id}"`) || !html.includes(`data-state="${state}"`)) errors.push(`design/wireframe.html：缺少 ${screen.id}/${state} 的 section`);
              }
            });
          });
          for (const state of outline?.states ?? []) if (!stateIds.has(state.id)) errors.push(`design-outline：缺少 PRD 状态 ${state.id}`);
        }
      } catch { errors.push('design-outline：JSON 无法解析'); }
    }
    if (!/hashchange/.test(html) || !/screen=/.test(html) || !/state=/.test(html)) errors.push('design/wireframe.html：缺少状态定位脚本');
  }
  if (theme !== null) {
    requireFields(theme, ['preset', 'name', 'reason'], 'design/theme.json', errors);
    for (const field of ['colors', 'typography', 'radii', 'spacing', 'shadows']) if (!object(theme?.tokens?.[field]) || !Object.keys(theme.tokens[field]).length) errors.push(`design/theme.json.tokens.${field}：必填对象`);
    for (const field of ['background', 'surface', 'text', 'muted', 'border', 'primary', 'onPrimary', 'accent', 'success', 'warning', 'error', 'disabled']) if (!nonempty(theme?.tokens?.colors?.[field])) errors.push(`design/theme.json.tokens.colors.${field}：必填`);
  }
  return { ok: errors.length === 0, errors };
}

export async function validateSite(projectDir) {
  const errors = [];
  const html = await load(projectDir, 'site/index.html', errors);
  const outline = await load(projectDir, 'docs/outline.json', errors, true);
  if (html !== null) {
    if (!/<html\b/i.test(html) || !/<\/html>/i.test(html) || !/<style\b/i.test(html) || !/<script\b/i.test(html)) errors.push('site/index.html：应为内嵌样式与脚本的完整 HTML');
    if (!/hashchange/.test(html) || !/state=/.test(html)) errors.push('site/index.html：缺少状态直达处理');
    if (/localStorage/.test(html) && !/try\s*\{[\s\S]*?localStorage[\s\S]*?\}\s*catch/.test(html)) errors.push('site/index.html：localStorage 读写需要 try/catch');
    for (const state of outline?.states ?? []) if (id(state?.id) && !html.includes(state.id)) errors.push(`site/index.html：缺少状态 ${state.id}`);
    if (/<(?:script|link|img)\b[^>]*(?:src|href)=["']https?:/i.test(html)) errors.push('site/index.html：不能引用外部资源');
  }
  return { ok: errors.length === 0, errors };
}

export async function validateWalkthrough(projectDir) {
  const errors = [];
  const data = await load(projectDir, 'design/walkthrough.json', errors, true);
  if (data !== null) {
    if (!Number.isInteger(data?.round) || data.round < 1) errors.push('design/walkthrough.json.round：应为正整数');
    if (!['通过', '需修改'].includes(data?.conclusion)) errors.push('design/walkthrough.json.conclusion：取值无效');
    for (const field of ['summary', 'coverage', 'findings']) if (data?.[field] == null) errors.push(`design/walkthrough.json.${field}：必填`);
    if (!Array.isArray(data?.groups) || !data.groups.length) errors.push('design/walkthrough.json.groups：应为非空数组');
    else data.groups.forEach((group, gi) => {
      requireFields(group, ['title', 'flowNote'], `design/walkthrough.json.groups[${gi}]`, errors);
      if (!Array.isArray(group.screens) || !group.screens.length) errors.push(`design/walkthrough.json.groups[${gi}].screens：应为非空数组`);
      else group.screens.forEach((screen, si) => {
        requireFields(screen, ['title', 'state', 'reproduce', 'note'], `design/walkthrough.json.groups[${gi}].screens[${si}]`, errors);
        if (!['可以', '待改', '阻塞'].includes(screen.mark)) errors.push(`design/walkthrough.json.groups[${gi}].screens[${si}].mark：取值无效`);
      });
    });
  }
  return { ok: errors.length === 0, errors };
}

export const validateStage = async (stage, projectDir) => {
  const validators = { clarifying: validateQuestions, confirm_prd: validatePrd, designing: validateDesign, confirm_design: validateDesign, building: validateSite, walkthrough: validateWalkthrough };
  if (!validators[stage]) throw new Error(`未知校验阶段：${stage}`);
  return validators[stage](projectDir);
};

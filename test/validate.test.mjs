import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateQuestions, validatePrd, validateDesign, validateSite, validateWalkthrough, validateStage } from '../src/flow/validate.mjs';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

async function fixture(fn) {
  const dir = await mkdtemp(path.join(root, 'test-validate-'));
  const put = async (file, content) => {
    await mkdir(path.dirname(path.join(dir, file)), { recursive: true });
    await writeFile(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
  };
  try { await fn(dir, put); } finally { await rm(dir, { recursive: true, force: true }); }
}

test('澄清问题检查推荐项、选项数量与 JSON', () => fixture(async (dir, put) => {
  await put('docs/questions.json', { round: 1, why: '确定报名内容', questions: [{ id: 'q1', question: '填什么？', matters: '决定字段', options: ['姓名', '姓名和电话'], recommended: 1, reason: '方便联系' }] });
  assert.equal((await validateQuestions(dir)).ok, true);
  await put('docs/questions.json', { round: 4, why: '', questions: [{ id: 'q1', question: '填什么？', matters: '', options: ['姓名'], recommended: 2, reason: '' }] });
  const result = await validateStage('clarifying', dir);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /recommended/);
  await put('docs/questions.json', '{');
  assert.match((await validateQuestions(dir)).errors.join(' '), /JSON 无法解析/);
}));

test('PRD、结构和自查清单完整检查', () => fixture(async (dir, put) => {
  const prd = ['# 读书会报名页', '## 产品概述', '## 目标用户与场景', '## 用户故事', '假如打开网页，当提交报名，那么看到成功提示。', '## 页面与状态', 'default success', '## 边界情况', '## 功能需求', 'FR-001 可提交', '## 成功标准', 'SC-001 能看到结果', '## 假设', '## 本期不做'].join('\n');
  await put('docs/prd.md', prd);
  await put('docs/outline.json', { title: '读书会报名页', blocks: [{ name: '页头', content: '读书会简介' }], states: [{ id: 'default', name: '默认', desc: '可报名' }, { id: 'success', name: '成功', desc: '展示结果' }] });
  await put('docs/checklist.md', '# 自查\n' + Array.from({ length: 14 }, (_, i) => `- [x] CHK${String(i + 1).padStart(3, '0')} 通过`).join('\n'));
  assert.equal((await validatePrd(dir)).ok, true);
  // 实测时模型把章节写成“## 1. 产品概述”，也要认
  let n = 0;
  await put('docs/prd.md', prd.replace(/^## /gm, () => `## ${++n}. `).replace('## 2. 目标用户', '## 二、目标用户'));
  assert.deepEqual((await validatePrd(dir)).errors, []);
  await put('docs/outline.json', { title: '错误标题', blocks: [], states: [{ id: 'Bad ID', name: '', desc: '' }] });
  const result = await validatePrd(dir);
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /标题不一致/);
}));

test('线框大纲覆盖状态且主题令牌齐备', () => fixture(async (dir, put) => {
  await put('docs/outline.json', { title: '报名', blocks: [{ name: '页头', content: '介绍' }], states: [{ id: 'default', name: '默认', desc: '展示' }] });
  await put('design/wireframe.html', '<!doctype html><html><section data-screen="page" data-state="default"></section><script type="application/json" id="design-outline">{"groups":[{"id":"signup","title":"报名","screens":[{"id":"page","title":"报名页","states":["default"]}]}]}</script><script>addEventListener("hashchange",()=>{}); // #screen=page&state=default</script></html>');
  await put('design/theme.json', { preset: 'modern-minimalist', name: '现代极简', reason: '适合', tokens: { colors: Object.fromEntries(['background', 'surface', 'text', 'muted', 'border', 'primary', 'onPrimary', 'accent', 'success', 'warning', 'error', 'disabled'].map(x => [x, '#123456'])), typography: { body: 'system' }, radii: { small: 4 }, spacing: { sm: 8 }, shadows: { none: 'none' } } });
  assert.equal((await validateDesign(dir)).ok, true);
  await put('docs/outline.json', { title: '报名', blocks: [], states: [{ id: 'success', name: '成功', desc: '完成' }] });
  assert.match((await validateDesign(dir)).errors.join(' '), /缺少 PRD 状态 success/);
}));

test('成品网页检查直达状态和存储防护', () => fixture(async (dir, put) => {
  await put('docs/outline.json', { states: [{ id: 'default' }, { id: 'success' }] });
  await put('site/index.html', '<html><style></style><script>function show(){let state=location.hash; if(state.includes("state=default") || state.includes("state=success")){} try { localStorage.getItem("x") } catch(e) {} } addEventListener("hashchange",show);</script></html>');
  assert.equal((await validateSite(dir)).ok, true);
  await put('site/index.html', '<html><style></style><script>localStorage.getItem("x")</script></html>');
  assert.match((await validateSite(dir)).errors.join(' '), /try\/catch/);
}));

test('走查结论和每屏标记只接受约定值', () => fixture(async (dir, put) => {
  const walkthrough = { round: 1, conclusion: '通过', summary: '正常', coverage: [], findings: [], groups: [{ title: '报名', flowNote: '从浏览到提交', screens: [{ title: '报名页', state: 'default', reproduce: '打开页面', mark: '可以', note: '正常' }] }] };
  await put('design/walkthrough.json', walkthrough);
  assert.equal((await validateWalkthrough(dir)).ok, true);
  walkthrough.groups[0].screens[0].mark = '未知';
  await put('design/walkthrough.json', walkthrough);
  assert.match((await validateWalkthrough(dir)).errors.join(' '), /mark：取值无效/);
}));

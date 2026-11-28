import test from 'node:test';
import assert from 'node:assert/strict';
import {formatDocument,documentInstructions} from '../src/document-format.mjs';
test('发布保留专业章节、编号、代码和来源，不增加重复主标题',()=>{
 const md='# 报名页\n章节改编自 github/spec-kit（MIT）\n## 功能需求\nFR-001 保存\n## 成功标准\nSC-001 可验证\n```js\nconst a = 1;\n```';
 const r=formatDocument(md,{fallback:'很长的角色职责',status:'阶段交付'});
 assert.equal(r.title,'报名页');assert.ok(r.markdown.endsWith(md+'\n'));assert.equal((r.markdown.match(/^# /gm)||[]).length,1);
});
test('frontmatter 仅影响发布副本，内部来源路径不展示，正文表格与标题保留',()=>{
 const md='---\ntags: [研究, 草稿]\nsource: context/source-ledger.jsonl\n---\n# 研究结论\n| 项 | 值 |\n|---|---|\n| A | 2 |';
 const r=formatDocument(md);assert.equal(r.title,'研究结论');assert.match(r.markdown,/标签/);assert.doesNotMatch(r.markdown,/source-ledger/);assert.ok(r.markdown.includes('| A | 2 |'));assert.ok(md.startsWith('---'));
});
test('无主标题用产物名，普通分隔线不误删正文，专业契约有优先说明',()=>{
 const r=formatDocument('正文\n---\n后文',{fallback:'操作说明'});assert.equal(r.title,'操作说明');assert.match(r.markdown,/后文/);assert.match(documentInstructions,/专业 Skill 优先/);
});

test('开头普通分隔段不能被当成元数据丢弃',()=>{const text='---\n重要结论\n---\n# 标题';assert.ok(formatDocument(text).markdown.includes('重要结论'));});

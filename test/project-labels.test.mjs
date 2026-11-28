import test from 'node:test';import assert from 'node:assert/strict';
import { projectLabel, projectGroupName, projectCardTitle } from '../src/project-labels.mjs';
test('群名取主题，不带复合指令、读者要求和交付说明',()=>{
 assert.equal(projectLabel('好的，帮我研究一下中国神华现金流，并形成报告'),'中国神华现金流');
 assert.equal(projectLabel('请你帮我研究一下中国神华现金流，并形成报告'),'中国神华现金流');
 assert.equal(projectLabel('请帮我写一篇关于产品即分发的公众号文章，读者是创业者'),'产品即分发');
 assert.equal(projectLabel('项目名称：AI 团队交付验收\n请测试文章与卡片'),'AI 团队交付验收');
 assert.equal(projectLabel('请写一篇以“产品即分发”为题的文章'),'产品即分发');
 assert.equal(projectLabel('选题：产品即分发，字数 800 字'),'产品即分发');
 assert.equal(projectLabel('请做一个读书笔记网页，支持筛选'),'读书笔记网页');
});
test('显式标题与已命名的卡片保持原意，按字符截断，群前缀不带版本',()=>{
 assert.equal(projectLabel('不要取正文','研究如何让产品自己说话'),'研究如何让产品自己说话');
 assert.match(projectCardTitle('研究如何让产品自己说话','AI 主编','讨论'),/^研究如何让产品自己说话/);
 assert.equal(projectGroupName('产品即分发','文枢 1.0.1 · Newtype 内容团队'),'文枢 · 产品即分发');
 assert.equal(Array.from(projectLabel('', '😀'.repeat(30))).length,24);
 assert.equal(projectLabel('请帮我'),'新项目');
 assert.doesNotMatch(projectGroupName('标题\u202e恶意\n换行','文枢'),/[\u202e\n]/);
});

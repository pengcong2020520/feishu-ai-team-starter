import test from 'node:test';
import assert from 'node:assert/strict';
import { StepError, checkFailed, briefOf, nextStep, staleText, retryRole } from '../src/flow/guide.mjs';

test('交付检查没过：一句话列出是哪些文件，明细留着给重试用', () => {
  const error = checkFailed(['docs/prd.md：缺少“产品概述”章节', 'docs/prd.md：缺少 FR-xxx', 'docs/outline.json.title：与 PRD 标题不一致']);
  assert.equal(error.brief, '交付的PRD、页面结构没通过格式检查');
  assert.equal(error.kind, 'check');
  assert.equal(error.checks.length, 3);
  assert.match(error.message, /缺少 FR-xxx/);
});

test('一句话原因：自带的优先，飞书接口报 code，其余截短', () => {
  assert.equal(briefOf(new StepError('团队服务重启过，这一步没做完', { kind: 'restart' })), '团队服务重启过，这一步没做完');
  assert.equal(briefOf(new Error('飞书调用失败（code 230020，msg 限频）')), '飞书接口出错（code 230020）');
  assert.equal(briefOf(new Error('x'.repeat(60))), `${'x'.repeat(40)}…`);
});

test('下一步提示：按阶段和状态告诉用户该做什么', () => {
  assert.match(nextStep(null), /@AI 产品经理 说说你的想法/);
  assert.match(nextStep({ stage: 'building', busy: true }), /AI 程序员正在开发网页，做完会在群里发新卡片/);
  assert.match(nextStep({ stage: 'confirm_design' }), /点卡片上的“确认设计”/);
  assert.match(nextStep({ stage: 'revise_build' }), /请 @AI 程序员 说明要改什么/);
  assert.match(nextStep({ stage: 'walkthrough', error: 'x', errorBrief: '交付的走查记录没通过格式检查' }), /这一步停下了：交付的走查记录没通过格式检查。.*@AI 设计 发送“重试”/);
  assert.equal(retryRole({ stage: 'accept' }), 'developer');
  assert.equal(retryRole({ stage: 'confirm_prd', pendingAction: { role: 'product' } }), 'product');
});

test('过期卡片：说清现在在哪、该点哪里', () => {
  assert.match(staleText(null), /群里现在没有进行中的项目/);
  assert.equal(staleText({ stage: 'confirm_prd' }), '这张卡片已过期，现在在「确认 PRD」，请点最新那张卡片。');
  assert.match(staleText({ stage: 'designing', busy: true }), /AI 设计正在画线框与主题/);
  assert.match(staleText({ stage: 'revise_prd' }), /这张卡片已过期，现在在「修改 PRD」：请 @AI 产品经理 说明要改什么/);
});

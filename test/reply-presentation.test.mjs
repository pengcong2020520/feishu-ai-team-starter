import test from 'node:test';
import assert from 'node:assert/strict';
import { plainText, publicReply, publicError } from '../src/presentation.mjs';
import { teamCard } from '../src/packages/engine.mjs';
import { gateCard } from '../src/flow/cards.mjs';
import { registrationView } from '../src/setup/register.mjs';
import { qrPage, qrStatusScript } from '../src/setup/qr-page.mjs';

test('飞书纯文本去掉常见 Markdown 包装，保留数字、比较符号、标识与链接', () => {
  const result = plainText('# **研究结论**\n- `user_name` 的收入占比 35%，5 < 10。\n> [完整报告](https://example.com/a_b)\n- [x] 已核对');
  assert.equal(result, '研究结论\n• user_name 的收入占比 35%，5 < 10。\n完整报告（https://example.com/a_b）\n• 已核对');
  assert.equal(publicReply('35% 的客户占比需要留意。\n1. 暂未确认年份。'), '35% 的客户占比需要留意。\n暂未确认年份。');
});

test('公开摘要不广播交接日志，同时保留未通过与未核实的结论', () => {
  const raw = '# 实际结果\n已生成研究报告。\n本轮使用 SDK PostToolUse 调用 team:full-analysis。\n写入 report/final.md，sourceId=inputs/demo.md。\n```json\n{"projectId":"private-id"}\n```\n结论仍待核实，未经真人审阅。';
  const summary = publicReply(raw);
  assert.match(summary, /已生成研究报告/); assert.match(summary,/待核实.*未经真人审阅/);
  assert.doesNotMatch(summary, /SDK|PostToolUse|team:|report\/|sourceId|private-id|[#*`]/);
  assert.equal(publicReply('```js\nwriteSecret()\n```'), '结果已提交，请在项目工作台查看。');
  assert.equal(publicReply('已完成报告，仍有数据待核。\n"}]}'), '已完成报告，仍有数据待核。');
  assert.equal(publicReply('并不是 SDK 调用成功，任务就已经验收通过。\n结论仍待核实。'), '结论仍待核实。');
  assert.equal(publicReply('不能因为 SDK 调用成功；就说任务验收通过。\n结论仍待核实。'), '结论仍待核实。');
  assert.equal(publicReply('技能调用：上轮中断，本轮已重新加载技能上下文后完成）。\n修订内容：\n客户占比未注明年份，应用于本年属于额外假设。'), '客户占比未注明年份，应用于本年属于额外假设。');
  assert.doesNotMatch(publicReply('已完成。'.repeat(100)+'这份结论尚未通过核实。'),/验收通过/);
  const card = gateCard({stage:'accept',projectId:'p',cardId:'c',title:'验收',description:raw,process:{stats:{inputTokens:123}},points:['文件：site/index.html']});
  assert.doesNotMatch(JSON.stringify(card), /PostToolUse|inputTokens|token|site\/index/);
  assert.equal(teamCard({title:'角色',text:'## **已提交**\n- 请确认'}).elements[0].text.content, '已提交\n• 请确认');
});

test('账户欠费说清阻塞原因，不把请求编号与原始异常发给用户', () => {
  const result=publicError('Claude Code error 403 The request failed because your account has an overdue balance. Request id: secret-id');
  assert.match(result,/账户欠费/);assert.doesNotMatch(result,/secret-id|Claude|403/);
});

test('角色创建状态以真实回执为准，部分失败不停止其他角色刷新', () => {
  const entries=[{role:{key:'one',name:'主编'},done:true},{role:{key:'two',name:'作者'},error:true},{role:{key:'three',name:'编辑'},url:'https://qr.test/3',version:1}];
  assert.equal(registrationView(entries).phase,'scanning');
  entries[2].done=true;assert.equal(registrationView(entries).phase,'error');
  const state=registrationView([{role:{key:'one',name:'</script><script>window.bad=true</script>',desc:'职责'},done:true}]);
  assert.doesNotMatch(qrStatusScript(state), /<script>/);
  const page=qrPage(state);assert.doesNotMatch(page,/<script>window.bad/);assert.match(page,/prefers-reduced-motion/);assert.doesNotMatch(page,/http-equiv="refresh"/);
});

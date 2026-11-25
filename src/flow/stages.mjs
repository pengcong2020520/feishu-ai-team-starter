export const transitions = Object.freeze({
  idle: ['clarifying'],
  clarifying: ['confirm_prd'],
  confirm_prd: ['designing', 'revise_prd'],
  revise_prd: ['confirm_prd'],
  designing: ['confirm_design'],
  confirm_design: ['building', 'revise_design'],
  revise_design: ['confirm_design'],
  building: ['walkthrough'],
  walkthrough: ['accept'],
  accept: ['done', 'revise_build'],
  revise_build: ['walkthrough'],
  done: [],
});

export const stageNames = Object.freeze({
  idle: '待开始', clarifying: '澄清需求', confirm_prd: '确认 PRD',
  revise_prd: '修改 PRD', designing: '画线框与主题', confirm_design: '确认设计',
  revise_design: '修改设计', building: '开发网页', walkthrough: '走查网页',
  accept: '验收', revise_build: '修改网页', done: '已完成',
});

export function nextStage(from, to) {
  if (!transitions[from]?.includes(to)) throw new Error(`不能从“${stageNames[from] ?? from}”进入“${stageNames[to] ?? to}”`);
  return to;
}

export function taskFor(stage, detail = '', round = 1) {
  switch (stage) {
    case 'clarifying': return round === 1 ? `用户的话：${detail}` : `用户的回答：${detail}${round === 3 ? '\n这是最后一轮：不再提问，用 prd-spec 技能写 docs/prd.md，没问到的按推荐写进“假设”。' : ''}`;
    case 'revise_prd': return `用户对 PRD 的修改意见：${detail}\n请修改 docs/prd.md，没被提到的部分保持不变。回复一句话说明改了什么。`;
    case 'designing': return 'PRD 已确认。这一步画线框并选主题，按角色说明里「画线框与主题」做。';
    case 'revise_design': return `用户对设计的修改意见：${detail}\n只改被提到的部分。回复一句话说明改了什么。`;
    case 'building': return 'PRD、线框和主题都已确认，请开始。';
    case 'walkthrough': return (round === 1 ? '程序员已经做好网页。这一步走查网页，按角色说明里「走查网页」做，这是第 1 轮。' : `程序员按上一轮意见改好了网页。这是第 ${round} 轮：上一轮的结果在 design/walkthrough.json，请做回归走查。${detail ? `用户这次的修改意见：${detail}，也请逐条核对是否做到。` : ''}`) + '\n每屏的说明写用户在页面上看到了什么，不写函数名和代码。';
    case 'revise_build': return `用户的修改意见：${detail}\n也请处理 design/walkthrough.json 里标了“待改”“阻塞”的屏，其余保持不变。回复一句话说明改了什么。`;
    default: throw new Error('未知任务阶段');
  }
}

// 每一步最多跑多久（分钟），超时就停下，交给用户重试或结束
export const timeLimits = Object.freeze({ clarifying: 10, revise_prd: 10, designing: 15, revise_design: 15, building: 20, revise_build: 20, walkthrough: 15 });

export const roleFor = stage => ({ clarifying: 'product', revise_prd: 'product', designing: 'designer', revise_design: 'designer', building: 'developer', revise_build: 'developer', walkthrough: 'designer' })[stage];

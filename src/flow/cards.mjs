const templates = { product: 'blue', designer: 'purple', developer: 'green' };
const roleNames = { product: 'AI 产品经理', designer: 'AI 设计', developer: 'AI 程序员' };
const roleOf = title => title?.startsWith('AI 设计') ? 'designer' : title?.startsWith('AI 程序员') ? 'developer' : 'product';
const clean = value => String(value ?? '').replace(/<[^>]*>/g, '').replace(/(?:\*\*|__|~~|\`|\[|\]|^#{1,6}\s*|^>\s*)/gm, '').trim();
const escape = value => clean(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const md = content => ({ tag: 'div', text: { tag: 'lark_md', content } });
const gray = content => md(`<font color='grey'>${escape(content)}</font>`);
const button = (label, value, type = 'default') => ({ tag: 'button', text: { tag: 'plain_text', content: label }, type, value });
const header = (title, role = roleOf(title)) => ({ title: { tag: 'plain_text', content: title }, template: templates[role] });
const config = { wide_screen_mode: true, update_multi: true };
const image = ({ imageKey, imageError }) => imageKey ? [{ tag: 'img', img_key: imageKey, alt: { tag: 'plain_text', content: '页面一览' } }]
  : imageError ? [gray(`一览图未生成（${imageError}）`)] : [];
const linkRows = links => [...links.map(({ label, url }) => ({ tag: 'action', actions: [{ tag: 'button', text: { tag: 'plain_text', content: label }, url }] })), ...(links.length ? [gray('链接在本机打开（飞书电脑版）')] : [])];
const processLine = ({ reads = 0, writes = 0, stats = {} }) => `过程：读了 ${reads} 个文件、写了 ${writes} 个文件，${stats.turns ?? 0} 轮，用时 ${Math.round((stats.durationMs ?? 0) / 1000)} 秒，模型读入 ${((stats.inputTokens ?? 0) / 10000).toFixed(2)} 万、写出 ${((stats.outputTokens ?? 0) / 10000).toFixed(2)} 万 token`;

export function gateCard({ stage, projectId, cardId, title, description = '', points = [], process, links = [], imageKey, imageError }) {
  const labels = { confirm_prd: ['确认 PRD', '打回 PRD'], confirm_design: ['确认设计', '打回设计'], accept: ['验收通过', '打回网页'] };
  if (!labels[stage]) throw new Error('未知关口');
  const value = action => ({ action, stage, projectId, cardId });
  return { config, header: header(title), elements: [
    md(escape(description)), { tag: 'hr' }, ...points.map(point => md(escape(point))),
    ...(process ? [gray(processLine(process))] : []),
    ...image({ imageKey, imageError }), ...linkRows(links),
    { tag: 'action', actions: [button(labels[stage][0], value('confirm'), 'primary'), button(labels[stage][1], value('reject'))] },
  ] };
}

export function resultCard({ role, title, description = '', points = [], process, links = [], imageKey, imageError }) {
  return { config, header: header(title, role), elements: [
    md(escape(description)), { tag: 'hr' }, ...points.map(point => md(escape(point))),
    ...(process ? [gray(processLine(process))] : []),
    ...image({ imageKey, imageError }), ...linkRows(links),
  ] };
}

export function answeredCard(title, who, role = 'product') {
  return { config, header: header(`${roleNames[role]} · ${title}`, role), elements: [md(`✓ ${escape(who)}已确认`)] };
}

export function questionCard({ projectId, cardId, questions }) {
  const fields = questions.questions.flatMap(q => [
    { tag: 'markdown', content: `**${escape(q.question)}**\n<font color='grey'>${escape(q.matters)}</font>` },
    { tag: 'select_static', name: q.id, required: true, initial_index: q.recommended + 1,
      options: q.options.map((option, index) => ({ text: { tag: 'plain_text', content: clean(option).slice(0, 120) }, value: String(index) })) },
  ]);
  return {
    schema: '2.0', config, header: header('AI 产品经理 · 有几个问题', 'product'),
    body: { elements: [{ tag: 'form', name: 'clarification', elements: [
      { tag: 'markdown', content: escape(questions.why) }, ...fields,
      { tag: 'input', name: 'extra', label: { tag: 'plain_text', content: '其他补充' }, placeholder: { tag: 'plain_text', content: '可以补充你的想法' } },
      { tag: 'markdown', content: "<font color='grey'>默认已选推荐项，直接提交就是全部按推荐</font>" },
      { tag: 'button', name: 'submit_answers', text: { tag: 'plain_text', content: '提交回答' }, type: 'primary', form_action_type: 'submit', behaviors: [{ type: 'callback', value: { action: 'answer', stage: 'clarifying', projectId, cardId } }] },
    ] }] },
  };
}

export const toast = text => ({ toast: { type: 'info', content: text } });

export function progressCard({ title, task = '正在处理这一步', lines = [], elapsedSeconds = 0, stats, done = false }) {
  const role = roleOf(title);
  const visible = lines.slice(-12);
  const elements = [md(escape(task))];
  if (lines.length > 12) elements.push(gray(`……前面还有 ${lines.length - 12} 步`));
  for (const line of visible) elements.push(md(escape(line)));
  if (stats) elements.push(gray(`已用 ${Math.round(stats.durationMs / 1000)} 秒；读入 ${stats.inputTokens} / 写出 ${stats.outputTokens} token`));
  else elements.push(gray(`已用 ${elapsedSeconds} 秒`));
  return { config, header: header(done ? `${roleNames[role]} · 完成` : title, role), elements };
}

// 某一步停下了：一句原因 + 下一步，按钮直接重试或结束项目
export function stuckCard({ role, brief, projectId, stage, cardId }) {
  const value = action => ({ action, stage, projectId, cardId });
  return { config, header: header(`${roleNames[role]} · 这一步停下了`, role), elements: [
    md(escape(brief)),
    gray(`点“重试”让 ${roleNames[role]} 再做一次；不想做了就点“结束项目”，文件都会保留。`),
    { tag: 'action', actions: [button('重试', value('retry'), 'primary'), button('结束项目', value('end'))] },
  ] };
}

export function confirmEndCard({ name, projectId, stage, cardId }) {
  const value = action => ({ action, stage, projectId, cardId });
  return { config, header: header('AI 产品经理 · 结束这个项目？', 'product'), elements: [
    md(escape(`结束后「${name}」的文件都会保留，工作台里能看到；群里可以重新提需求。`)),
    { tag: 'action', actions: [button('结束项目', value('end'), 'danger'), button('继续做', value('keep'))] },
  ] };
}

// 群聊里角色的提议：回复 + 提议内容 + 两个按钮，点了才执行
const proposalKinds = {
  start: { title: '要开始做吗？', label: '需求', yes: '就按这个开始', no: ['再聊聊', 'dismiss'] },
  revise: { title: '要按这个改吗？', label: '要改的', yes: '按这个改', no: ['先不改', 'dismiss'] },
  answer: { title: '把这段当回答提交？', label: '回答', yes: '提交为回答', no: ['先不提交', 'dismiss'] },
  retry: { title: '要重试吗？', yes: '重试', no: ['结束项目', 'end'] },
  end: { title: '结束这个项目？', yes: '结束项目', no: ['继续做', 'keep'] },
};
// 提议卡上两个按钮各自的动作和文字
export const proposalChoices = action => [action, proposalKinds[action].no[1]];
export const proposalButton = (action, choice) => choice === action ? proposalKinds[action].yes : proposalKinds[action].no[0];
export const proposalTitle = (role, action) => `${roleNames[role]} · ${proposalKinds[action].title}`;
export function proposalCard({ role, reply, action, detail, projectId, stage, cardId }) {
  const kind = proposalKinds[action];
  if (!kind) throw new Error('未知提议');
  const value = name => ({ action: name, stage, projectId, cardId });
  return { config, header: header(proposalTitle(role, action), role), elements: [
    md(escape(reply)),
    ...(kind.label && detail ? [{ tag: 'hr' }, gray(`${kind.label}：${detail}`)] : []),
    { tag: 'action', actions: [button(kind.yes, value(action), action === 'end' ? 'danger' : 'primary'), button(kind.no[0], value(kind.no[1]))] },
  ] };
}

// 点过的卡片收起来：只留标题和一句结果，按钮去掉
export function closedCard(title, text, role = roleOf(title)) {
  return { config, header: header(title, role), elements: [md(escape(text))] };
}

export function completeCard({ url }) {
  return resultCard({ role: 'product', title: 'AI 产品经理 · 网页已完成', description: '网页已验收完成，index.html 文件见下一条消息。', points: ['网页：已可打开'], links: [{ label: '打开网页', url }] });
}

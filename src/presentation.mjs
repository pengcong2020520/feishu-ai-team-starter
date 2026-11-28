// 模型交付与用户消息是两个出口。这里仅整理展示，原始结果仍由编排留档。
export function plainText(value) {
  return String(value ?? '')
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/^\s*[-*+]\s+\[[ xX]\]\s*/gm, '• ')
    .replace(/!\[([^\]]*)\]\([^\n)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1（$2）')
    .replace(/\[([^\]\n]+)\](?!\()/g, '$1')
    .replace(/<(https?:\/\/[^>\s]+|[\p{Script=Han}][^<>\n]*)>/gu, '$1')
    .replace(/<at\b[^>]*>(.*?)<\/at>/gs, '@$1')
    .replace(/<\/?[A-Za-z][\w:-]*(?:\s[^<>]*)?\s*\/?\s*>/g, '')
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?)/gm, '')
    .replace(/\*\*([^\n]+?)\*\*|__([^\n]+?)__|~~([^\n]+?)~~/g, (_, a, b, c) => a ?? b ?? c)
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/(^|\s)\*([^*\n]+)\*(?=$|\s|[，。；：])/g, '$1$2')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/\\([*_`#>\[\]])/g, '$1')
    .replace(/\n{3,}/g, '\n\n').trim();
}

const internal = /\b(?:SDK|PostToolUse|PreToolUse|StructuredOutput|sourceId|source-ledger|sessionId|cardId|projectId|inputTokens|outputTokens|tool_use|JSON|rationale)\b|team:[\w-]+|(?:context|workspace|report|planning|inputs|docs|design|site|risk|quant|macro|equity|scenarios|\.newtype)\/[\w./-]+|\b[\w-]+\.(?:md|jsonl?|mjs|html)\b|[a-f0-9]{8}-[a-f0-9-]{27,}|(?:工具|技能).{0,12}(?:调用|加载|回执)|(?:调用|加载).{0,12}(?:工具|技能)|(?:读入|写出).{0,16}token/i;
export function publicReply(value, { fallback = '结果已提交，请在项目工作台查看。', max = 280 } = {}) {
  const raw = String(value ?? '').replace(/```[\s\S]*?(?:```|$)/g, '');
  const text = plainText(raw);
  // 保留完整句子，不能在逗号处分割带否定、条件或因果关系的判断。
  const sentences = text.split(/\n+|(?<=[。！？])\s*/u).map(s => s.replace(/^(?:•\s*|\d+[.)、]\s+|公开摘要[：:]\s*)/u, '').trim())
    .filter(s => s && !internal.test(s) && !/^(?:实际结果|完成情况|交付清单|已完成任务链|工作流建议|来源与核对)$/.test(s) && !/[：:]$/.test(s) && !/^[{|}\[]|\|.*\|/.test(s) && !/^[\s"'\\[\]{}:,]+$/.test(s));
  const chosen = sentences.slice(0, 3);
  const caveat = sentences.find(s => /未通过|不通过|需修改|待核实|未经|无法|缺少|不构成|不代表|仅供|尚未|未注明|假设/.test(s));
  if (caveat && !chosen.includes(caveat)) chosen.splice(2, 1, caveat);
  // 不截断句子，避免把“不通过”等关键尾部切掉；过长时用无质量承诺的提交提示。
  const selected = chosen.filter(s => s.length <= max);
  while (selected.join('\n').length > max) {
    const removable = selected.findLastIndex(s => s !== caveat);
    selected.splice(removable >= 0 ? removable : selected.length - 1, 1);
  }
  const compact = selected.join('\n');
  if (!compact) return plainText(fallback);
  return compact;
}

export function publicError(value) {
  const text = String(value ?? '');
  if (/overdue balance|AccountOverdue|ServiceOverdue/i.test(text)) return '模型账户欠费，这一步已停下。处理账户状态后可点“重试”。';
  if (/quota|credit|余额|额度|429/i.test(text)) return '模型额度或调用频率受限，这一步已停下。恢复后可点“重试”。';
  if (/authenticat|401|403|API.?KEY/i.test(text)) return '模型连接未通过验证，请检查模型配置后重试。';
  if (/timeout|timed.?out|超时/i.test(text)) return '这一步等待时间过长，已停下。可以重试，已有文件会保留。';
  if (/已按要求停下|团队服务重启过/.test(text)) return plainText(text);
  return '这一步没有完成，已有文件会保留。请查看工作台详情后重试。';
}

export const replyInstructions = '对用户的回复与工作区交付分开：分析、代码、来源清单、工具记录、技能调用、路径和内部交接全部写入规定的工作区文件，后续同事通过文件读取。最终回复只写2至3句简洁中文（60至160字）：做出了什么、最重要的结论或仍需留意的限制。不要罗列文件名、技术字段、会话号、token、内部校验过程；内部阶段标识改成中文含义，例如 accept 写“最终验收”、planning 写“协作规划”；不要使用Markdown标题、代码块或表格。未核实、未通过、假设和需要用户确认的事项必须如实说明，不把提交当作验收通过。用户明确询问技术细节时才解释相关细节。结构化计划任务仍严格返回规定结构，不额外添加字段。';

// 普通任务单独交付给用户的摘要，文件交付仍由原 workflow 检查。
export const taskReplySchema = {
  type: 'object', additionalProperties: false, required: ['reply'],
  properties: { reply: { type: 'string', maxLength: 240, description: '发给飞书用户的2至3句简洁中文，建议60至160字。说清做出了什么、最重要的结论与限制。不列文件路径、技能调用、工具日志、修改清单或代码，不用Markdown。必须保留未核实和未通过的事实。完整细节写入工作区文件。' } },
};


export const conversationStyle = `所有角色面向飞书用户交流时遵循以下表达规范；不改变专业文档、结构化计划、审核字段或 workflow。
先给结论，再给依据。若用户问两个问题，首段必须用 1、2 分别回应，不能用一整段概括代替，关键判断局部加粗。不寒暄、不奉承、不说教，像共同解决问题的同行；肯定方案必须有具体依据，也直接指出限制。
抽象技术概念先用一个贴切的生活比喻解释，再说明真实对应关系和比喻不适用之处；不强塞比喻。二元问题按用户体验、底层实现或适用阶段拆开，给出有条件的选择，不虚假平衡、不凭空编造优势；避免无依据的“唯一”“彻底”“成本翻倍”等绝对判断。
复杂解释采用总—分—收：开头给结论；主体按“一、怎么理解”“二、怎么选与演进”“三、下一步注意什么”组织，每节只解决一个问题；最后用一个具体排查方向或可执行下一步收住，不写“综上所述”。标题可用 ###，平台转换成飞书支持的样式。
并列概念用局部加粗引导的列表；确有选型时用简短对比表（方案、优势、代价、适用阶段，最多四列）；风险用编号清单，只列有依据的相关风险，通常不超过四项，不为凑数编造。每段一至三句、尽量两至四行，移动端行数随宽度变化；不要整段加粗或形成文字墙。
简单问题直接答，进度与完成通知只需结论、关键限制和下一步，不硬套三节或表格。复杂讨论通常 400—900 字，必要时更短。用户询问 SDK、Runtime 等技术时可以准确解释这些术语，不把真实问题当内部日志删掉。未知、假设、事实必须区分；不得把自动检查说成人工验收。`;

// Card 1.0 supports bold and columns, but not Markdown heading/table syntax.
export function replyMarkdown(value) {
  const bold=[];
  const source=String(value??'').replace(/\*\*([^*\n]+)\*\*/g,(_,text)=>{bold.push(plainText(text).replace(/[<>]/g,''));return `REPLYBOLDTOKEN${bold.length-1}END`;});
  return plainText(source).replace(/[<>]/g,'').replace(/REPLYBOLDTOKEN(\d+)END/g,(_,i)=>bold[i]===undefined?'':`**${bold[i]}**`);
}
export function replyElements(value) {
  const lines=String(value??'').slice(0,10000).split('\n'),out=[],buffer=[];
  const flush=()=>{if(buffer.length){out.push({tag:'div',text:{tag:'lark_md',content:replyMarkdown(buffer.join('\n'))||' '}});buffer.length=0;}};
  const cells=line=>line.trim().replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
  for(let i=0;i<lines.length;i++) {
    if(lines[i].includes('|') && /^\s*\|?\s*:?-{3,}/.test(lines[i+1]||'') && cells(lines[i]).length<=4){
      flush();const headers=cells(lines[i]);i++;
      const row=(values,heading)=>({tag:'column_set',flex_mode:'none',columns:headers.map((_,j)=>({tag:'column',width:'weighted',weight:1,elements:[{tag:'div',text:{tag:'lark_md',content:heading?`**${plainText(values[j]||'')}**`:replyMarkdown(values[j]||'—')}}]}))});
      out.push(row(headers,true));while(i+1<lines.length&&lines[i+1].includes('|'))out.push(row(cells(lines[++i]),false));
    }else buffer.push(lines[i].replace(/^\s*#{1,6}\s+(.+)$/,'**$1**'));
  }flush();return out;
}

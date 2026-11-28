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


export const conversationStyle = `面向用户交流时先回答当前问题，再按必要程度补充依据，不套固定模板。语气像共同做事的同行：直接、自然、有根据，不说教、不奉承。
用户问进展或结果：第一句给最新结论（做完什么、是否仍有问题）；随后只给一至三个关键事实和必要的成品入口。通常80—180字。不从历史过程讲起，不罗列任务全链路，不主动复述技术字段、路径、字数统计。用户追问过程时再展开。没有核实的问题不能说成缺陷，尤其不能把早期摘要当作最终事实。
简单问题一两段即可，不强制编号、加粗、标题、表格或结尾问句。用户只问现状，就回答现状，不顺势提出“再跑一轮”。任务完成不等于用户验收。
只有需要深入解释或比较时，才按问题自然分节：结论、依据、取舍、下一步。抽象概念可用贴切生活比喻，再交代对应关系和局限；选型确有横向维度时用最多四列的简短表。不要每次都套“怎么理解、怎么选、风险”三节。
按适用条件分析二元问题，不武断站队、不虚假平衡；不用无依据的“唯一”“彻底”“成本翻倍”。事实、假设与判断分开。每段一至三句，少量关键词加粗，不整段加粗。排查清单只列相关项，不凑数。专业文档、结构化返回与 workflow 仍遵守原契约。`;

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

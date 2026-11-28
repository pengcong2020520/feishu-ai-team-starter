// 只补充文档写作与发布外观，不改变 Skill 的专业契约。
export const documentInstructions = `
## 文档补充规范（专业 Skill 优先）
专业 Skill、当前任务的章节、字段、编号、格式、篇幅及来源声明全部保留；本规范只补缺，不替换 PRD、设计、开发和研究契约。JSON/HTML 按原契约交付，不加文档标签或章节。
写 Markdown 前先确定文档类型、读者和用途；按已有 Skill 列出大纲，检查每节回答的问题和依据，再填充内容。大纲在已有允许的交付文件中形成，不为此新增流程关口或擅自创建文件。没有专业模板时：文章按场景/主张→论据→解释→边界→收束；研究报告按问题与口径→结论→证据分析→反证风险→缺口与来源；操作说明按前提→操作→预期结果→异常处理；过程记录按实际结果→依据→遗留问题→下一步。
只设一个文档主标题，短而具体，不使用角色职责、任务原话、执行状态作为标题。文章标题应自然易读、有明确观点，但不夸大证据；专业文档采用“对象＋文档用途”。章节之间须有承接，每节只承担明确任务，同级标题表达平行。需要细分时用二级、三级标题，规范文档可用 1、1.1 编号；文章不强制编号。不能机械凑章节、重复总结或把同一资料复制到多个章节。
标签说明仅保留读者需要的类型、资料截止日期、适用范围、真实状态；文章通常不加管理信息栏。不得伪造作者、审核人、日期或验收状态。frontmatter 若为 Skill 必需，原文件保留。内部路径、工具日志、审批审计与编辑对照放在契约允许的过程记录中，不混入文章成品；专业 Skill 要求的证据和审计不得删除。
先用章节要点选取资料，再写段落：事实给可追溯来源，分析说明推导，观点说明条件，未取得资料不写成资料不存在。表格用于同维比较，步骤用于有先后的动作，正文不堆资料清单。交付前检查标题与内容一致、专业章节完整、论证无断点、来源与限制完整、字数符合本次要求。
`;

export function formatDocument(markdown, { fallback = '项目文档', status = '', updatedAt = '' } = {}) {
  const source = String(markdown).replace(/^\uFEFF/, '');
  // frontmatter 仍保存在本地；飞书只显式展示适合读者的标量字段，不解析/执行 YAML。
  const candidate = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  const match = candidate && /^[a-zA-Z_][\w-]*:/m.test(candidate[1]) ? candidate : null;
  const body = match ? source.slice(match[0].length) : source;
  const heading = body.match(/^#\s+(.+)$/m)?.[1];
  const clean = s => String(s).replace(/[\r\n\t]/g, ' ').replace(/[*`]/g, '').trim();
  const title = clean(heading || fallback).slice(0, 100) || '项目文档';
  const metadata = [];
  for (const line of (match?.[1] || '').split('\n')) {
    const field = line.match(/^(tags|description):\s*(.+)$/);
    if (field && !/[<>`]|(?:workspace|context)\//.test(field[2])) metadata.push(`${field[1] === 'tags' ? '标签' : '说明'}：${clean(field[2]).slice(0,200)}`);
  }
  const note = [status && `同步状态：${clean(status)}`, updatedAt && `更新时间：${clean(updatedAt)}`, ...metadata].filter(Boolean).join('；');
  return { title, markdown: `${note ? note + '\n\n' : ''}${body.trim()}\n` };
}

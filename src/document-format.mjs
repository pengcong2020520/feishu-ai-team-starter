// 只补充文档写作与发布外观，不改变 Skill 的专业契约。
export const documentInstructions = `
## 文档补充规范（专业 Skill 优先）
专业 Skill、当前任务的章节、字段、编号、格式、篇幅及来源声明全部保留；本规范只补缺，不替换 PRD、设计、开发和研究契约。JSON/HTML 按原契约交付，不加文档标签或章节。
写 Markdown 前先确定文档类型、读者和用途；按已有 Skill 列出大纲，检查每节回答的问题和依据，再填充内容。大纲在已有允许的交付文件中形成，不为此新增流程关口或擅自创建文件。没有专业模板时：文章按场景/主张→论据→解释→边界→收束；研究报告按问题与口径→结论→证据分析→反证风险→缺口与来源；操作说明按前提→操作→预期结果→异常处理；过程记录按实际结果→依据→遗留问题→下一步。
只设一个文档主标题，短而具体，不使用角色职责、任务原话、执行状态作为标题。文章标题应自然易读、有明确观点，但不夸大证据；专业文档采用“对象＋文档用途”。章节之间须有承接，每节只承担明确任务，同级标题表达平行。需要细分时用二级、三级标题，规范文档可用 1、1.1 编号；文章不强制编号。不能机械凑章节、重复总结或把同一资料复制到多个章节。
标签说明仅保留读者需要的类型、资料截止日期、适用范围、真实状态；文章通常不加管理信息栏。不得伪造作者、审核人、日期或验收状态。frontmatter 若为 Skill 必需，原文件保留。内部路径、工具日志、审批审计与编辑对照放在契约允许的过程记录中，不混入文章成品；专业 Skill 要求的证据和审计不得删除。用户要文章时，最终交付文件直接以选定的文章标题为唯一一级标题，紧接文章正文；“汇总”任务不意味着把文章包成“交付汇总”，不另设“最终标题”“正文”“字数”“核查结论”外壳。必要的过程说明另存本角色获准目录内的记录，专业 Skill 明确要求成品包含的章节除外。
先用章节要点选取资料，再写段落：事实给可追溯来源，分析说明推导，观点说明条件，未取得资料不写成资料不存在。表格用于同维比较，步骤用于有先后的动作，正文不堆资料清单。交付前检查标题与内容一致、专业章节完整、论证无断点、来源与限制完整、字数符合本次要求。
图文表达：在图能解释流程、比较数据或展示界面时使用，不强求张数和装饰封面。正文交代问题，图后说明发现与边界，保留图注、来源、日期/口径；截图必须来自真实对应版本，不把插画当证据。已有截图可用标准 Markdown 图片语法和本项目内相对路径引用，不能用远程图片、绝对路径或不存在的素材。
`;

export const documentVisualInstructions = `
团队包声明的正式 Markdown 可使用语言名为 team-figure 的代码围栏，内容为 JSON；飞书文档同步会将其生成真实配图并上传为原生图片块，本地源文件保留定义。本机项目不自动发布配图。共同字段：title（≤36字）、caption（≤140字，解释读者应看到什么）、source（≤100字，实际来源与口径）；必须非空单行。顺序流程格式：{"kind":"flow","title":"从资料到交付","steps":[{"name":"确认问题","note":"明确读者与范围"},{"name":"组织成果","note":"保留证据与必要的人工确认"}],"caption":"确认问题后再形成成果。","source":"本项目工作流"}，2–6步，name≤24字、note≤52字。比较图格式：{"kind":"bar","title":"同口径比较","unit":"实际单位","data":[{"label":"对象一","value":1},{"label":"对象二","value":2}],"caption":"解释差异与边界。","source":"填写实际材料和时期"}，2–8项、同一口径的有限非负数，例子数字不是研究资料，禁止照抄为事实。复杂分支、负值、区间或不齐数据使用表格，不为凑图改造事实；专业 Skill 不允许的附图不添加。单份文档最多8张图；没有图形价值就只用正文和表格。图中信息也要有文字解释，不能只靠颜色。同步权限、生成或上传失败时不得声称图片已经发布。
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

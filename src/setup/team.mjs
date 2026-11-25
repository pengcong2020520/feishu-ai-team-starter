// 三个角色在启动命令里的资料：扫码建应用时的名字与简介、报到卡片的颜色与自我介绍
export const team = Object.freeze([
  { key: 'product', prefix: 'FEISHU_PRODUCT_', name: 'AI 产品经理', color: 'blue', desc: '在飞书群里澄清需求，并写出产品需求文档。', intro: '我负责把一句话需求问清楚、写成 PRD，再交给设计和程序员。' },
  { key: 'designer', prefix: 'FEISHU_DESIGNER_', name: 'AI 设计', color: 'purple', desc: '在飞书群里画线框、选主题，并在开发后走查网页。', intro: '我负责画线框、定主题，网页做好后逐屏走查。' },
  { key: 'developer', prefix: 'FEISHU_DEVELOPER_', name: 'AI 程序员', color: 'green', desc: '在飞书群里按已确认的需求与设计，做出单文件网页。', intro: '我负责按 PRD 和线框把网页做出来，并按走查意见修改。' },
]);

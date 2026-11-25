export const roles = Object.freeze({
  product: {
    name: 'AI 产品经理',
    promptFile: 'product.md',
    writeDir: 'docs',
    skills: ['team:clarify', 'team:prd-spec', 'team:spec-checklist'],
  },
  designer: {
    name: 'AI 设计',
    promptFile: 'designer.md',
    writeDir: 'design',
    skills: ['team:lofi-wireframe', 'team:theme-pick', 'team:flow-walkthrough', 'team:consistency-check'],
  },
  developer: {
    name: 'AI 程序员',
    promptFile: 'developer.md',
    writeDir: 'site',
    skills: ['team:frontend-design'],
  },
});

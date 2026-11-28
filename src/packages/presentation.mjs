export function artifactLabel(pack, document) {
  const artifact = pack.manifest.artifacts.find(a => a.id === document.artifactId);
  const file = artifact?.path || '';
  if (file.startsWith('report/')) return '最终交付';
  const labels = [['drafts/', '文章初稿'], ['editing/', '编辑稿'], ['checks/', '核查记录'], ['.newtype/knowledge/', '归档记录']];
  return labels.find(([prefix]) => file.startsWith(prefix))?.[1] || document.name;
}
export function taskLabel(pack, project) {
  const node = pack.workflow.nodes.find(n => n.id === project.stage);
  if (node?.type !== 'plan' || !project.plan) return node?.name || '项目协作';
  const completed = project.plan.completed || [];
  const next = project.plan.tasks.filter(t => !completed.includes(t.id) && t.after.every(id => completed.includes(id)));
  const names = next.map(t => node.tasks.find(task => task.id === t.id)?.name).filter(Boolean);
  return names.length ? names.join('、') : '汇总交付';
}

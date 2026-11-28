// 档案视图只读；查看成果、追溯讨论与工作流操作分开。
export function archiveUI({el,button,get,post,avatar,documentView,dateLabel,openProject,showArtifact,externalLink,notice}) {
  let tag='',query=''; const requested=new Set();
  const team=p=>p.package?.id||p.archiveTeam;
  const tags=a=>a?.tags||[];
  const status=p=>p.ended?'已结束':p.error?'待处理':p.stageType==='done'?'已完成':p.busy?'进行中':p.stageType==='gate'?'等待确认':'进行中';
  const open=p=>{location.hash=new URLSearchParams({team:team(p),archive:'1',dossier:p.id});};
  async function generate(p,force=false){const requestKey=p.id+':'+(p.archive?.currentStamp||'initial');if(!force&&requested.has(requestKey))return;requested.add(requestKey);try{await post(p.archiveLegacy?'/api/project-archives':'/api/packages/archive',p.archiveLegacy?{projectId:p.id}:{chatId:p.chatId});}catch(e){notice(e.message);}}
  function tagRow(values,onClick){const row=el('div',null,'archive-tags');for(const t of values)row.append(button(t,()=>onClick?.(t),'archive-tag'));return row;}
  function overview(box,projects,render){
    const header=el('div',null,'dossier-heading');header.append(el('div','PROJECT ARCHIVE / 项目档案','eyebrow'),el('h1','项目档案'),el('p','按主题找到成果，追溯每一次协作。','muted'));box.append(header);
    const controls=el('div',null,'archive-controls'),search=el('input');search.type='search';search.placeholder='搜索项目、成果或摘要';search.setAttribute('aria-label','搜索项目档案');search.value=query;search.dataset.focusKey='archive-search';search.oninput=()=>{query=search.value;render();const target=document.querySelector('[data-focus-key="archive-search"]');target?.focus();};controls.append(search);
    const available=[...new Set(projects.flatMap(p=>tags(p.archive)))];if(tag&&!available.includes(tag))tag='';
    const filters=tagRow(['全部',...available],t=>{tag=t==='全部'?'':t;render();});for(const b of filters.children)b.classList.toggle('selected',b.textContent===(tag||'全部'));controls.append(filters);box.append(controls);
    const shown=projects.filter(p=>(!tag||tags(p.archive).includes(tag))&&[p.name,p.archive?.summary,p.archive?.outcome,...tags(p.archive)].join(' ').toLowerCase().includes(query.toLowerCase()));
    const grid=el('div',null,'dossier-grid');for(const p of shown){const a=p.archive||{},card=el('article',null,'dossier-card');
      const meta=el('div',null,'dossier-card-meta');meta.append(el('small','档案 / '+p.id.slice(0,8)),el('span',status(p),'archive-state'));card.append(meta);
      card.append(button(p.name,()=>(p.package||p.archiveLegacy)?open(p):openProject(p),'dossier-title'),el('p',a.summary||'保留原始需求、协作过程和实际成果。'+(a.status==='running'?'AI 正在整理摘要…':''),'archive-summary'));
      card.append(tagRow(tags(a),t=>{tag=t;render();}));const result=p.artifacts?.find(x=>p.finalArtifacts?.includes(x.id));card.append(el('div',result?.title||result?.name||(p.package?'尚未产生最终成果':'查看原项目成果'),'archive-result-line'));
      const footer=el('div',null,'dossier-card-footer');const people=el('div',null,'archive-people');for(const r of (p.roles||[]).filter(r=>p.history?.some(h=>h.role===r.id)))people.append(avatar(r));footer.append(people,button('打开档案 ↗',()=>(p.package||p.archiveLegacy)?open(p):openProject(p),'document-link'));card.append(footer);
      if(a.error)card.append(button('摘要整理未完成 · 重试',()=>generate(p,true),'text-button'));
      grid.append(card);if((p.package||p.archiveLegacy)&&!p.busy&&(a.status==='empty'||a.status==='ready'&&a.stale))void generate(p);
    }box.append(grid);if(!shown.length)box.append(el('p','没有匹配的项目档案','empty-page'));
  }
  function roleFor(p,event){return p.roles?.find(r=>r.id===event.role);}
  function sourceRow(p,event){const row=el('div',null,'dossier-source'),r=roleFor(p,event);if(r)row.append(avatar(r));const body=el('div');body.append(el('small',`${event.actor||'系统'} · ${dateLabel(event.at)}${event.kind==='human'?' · 真人补充':event.kind==='decision'?' · 节点记录':''}`),el('p',event.title||'', 'source-title'),el('p',event.text||''));if(event.at)body.append(button('定位原始对话 ↗',()=>{if(p.archiveLegacy){openProject(p);}else{location.hash=new URLSearchParams({team:team(p),project:p.id,at:event.at});}},'text-button'));row.append(body);return row;}
  async function dossier(box,p){
    const key=JSON.stringify([p.id,p.archive,p.stage,p.artifacts]);if(box.dataset.dossierKey===key)return;box.dataset.dossierKey=key;box.replaceChildren();
    const top=el('div',null,'dossier-top');top.append(button('← 全部档案',()=>{location.hash=new URLSearchParams({team:team(p),archive:'1'});},'text-button'),button('完整项目对话 ↗',()=>openProject(p),'document-link'));box.append(top);
    const head=el('header',null,'dossier-heading');head.append(el('div',`PROJECT FILE / ${p.id.slice(0,8).toUpperCase()} · ${status(p)}`,'eyebrow'),el('h1',p.name),el('p',p.archive?.summary||'正在读取项目记录…','archive-intro'),tagRow(tags(p.archive),t=>{tag=t;location.hash=new URLSearchParams({team:team(p),archive:'1'});}));const jump=el('nav',null,'dossier-jump');jump.setAttribute('aria-label','档案章节');for(const [label,cls] of [['最终成果','.dossier-product'],['生命周期','.dossier-chain']])jump.append(button(label,()=>box.querySelector(cls)?.scrollIntoView({block:'start',behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'}),'text-button'));head.append(jump);box.append(head);
    try {
      const a=await get((p.archiveLegacy?'/api/project-archives?':'/api/packages/archive?')+new URLSearchParams({projectId:p.id}));if(box.dataset.dossierKey!==key)return;
      const layout=el('div',null,'dossier-layout'),main=el('div',null,'dossier-main'),aside=el('aside',null,'dossier-aside');layout.append(main,aside);box.append(layout);
      const product=el('section',null,'dossier-product');product.append(el('div','01 / 最终成果','eyebrow'),el('h2',a.source.artifacts[0]?.text.match(/^#\s+(.+)$/m)?.[1]||'项目成果'));
      if(a.outcome)product.append(el('p',a.outcome,'archive-outcome'));
      if(p.application?.status==='running')product.append(externalLink('打开可运行应用 ↗',p.application.url));
      if(p.stageType!=='done')product.append(el('small',p.ended?'项目已结束，以下是已保留成果':'内容成果与流程确认分别记录 · 当前'+status(p),'muted'));
      if(!a.source.artifacts.length)product.append(el('p','当前还没有最终交付文件。过程资料与讨论已保留。'));
      for(const artifact of a.source.artifacts){const actions=el('div',null,'dossier-delivery-links');actions.append(p.archiveLegacy?externalLink('打开网页成品',p.siteUrl):button('完整预览 ↗',()=>showArtifact(p,artifact.id),'document-link'));const remote=p.documents?.items.find(d=>d.artifactId===artifact.id);if(remote?.url&&remote.shared)actions.append(externalLink('飞书文档',remote.url));product.append(actions);
        const preview=el('div',null,'dossier-document');preview.append(documentView(artifact.format==='markdown'?artifact.text.replace(/^#\s+[^\n]+\n?/, '').trimStart():artifact.text,artifact.format));product.append(preview);
        if(remote?.versions?.length){const old=el('details',null,'archive-versions');old.append(el('summary',`修订记录 · ${remote.versions.length} 个历史版本`));for(const v of [...remote.versions].reverse())old.append(externalLink(`${dateLabel(v.updatedAt)} · ${v.status||'历史版本'}`,v.url));product.append(old);}
      }main.append(product);
      const chain=el('section',null,'dossier-chain');chain.append(el('div','02 / 项目生命周期','eyebrow'),el('h2','这个成果如何形成'));
      for(const [i,m] of (a.milestones||[]).entries()){const step=el('article',null,'dossier-milestone');step.append(el('span',String(i+1).padStart(2,'0'),'milestone-number'));const body=el('div');body.append(el('h3',m.title),el('p',m.summary));const evidence=el('details');evidence.append(el('summary',`查看依据 · ${m.sources.length} 条记录`));for(const id of m.sources){const e=a.source.events.find(e=>e.id===id);if(e)evidence.append(sourceRow(p,e));}body.append(evidence);step.append(body);chain.append(step);}
      if(!a.milestones?.length)chain.append(el('p',a.status==='running'?'AI 正在整理关键节点，原始记录已可查看。':'尚未整理关键节点。','muted'));
      const raw=el('details',null,'dossier-raw');raw.append(el('summary',`完整生命周期记录 · ${a.source.events.length} 条`));let built=false;raw.ontoggle=()=>{if(raw.open&&!built){built=true;for(const e of a.source.events)raw.append(sourceRow(p,e));}};chain.append(raw);main.append(chain);
      aside.append(el('div','ORIGIN / 最初的想法','eyebrow'),el('p',p.demand,'dossier-demand'));const crew=el('div',null,'dossier-crew');crew.append(el('h3','参与协作'));for(const r of p.roles.filter(r=>p.history.some(h=>h.role===r.id)||a.source.events.some(e=>e.role===r.id))){const line=el('div');line.append(avatar(r),el('span',r.name));crew.append(line);}aside.append(crew);
      if(a.error)aside.append(el('p','整理未完成：'+a.error,'error'));aside.append(el('small',a.updatedAt?'AI 整理于 '+dateLabel(a.updatedAt)+(a.stale?' · 有新记录待整理':''):'AI 将根据实际文件和讨论整理档案','muted'));
      const update=button(a.status==='running'?'正在整理…':'更新档案摘要',async()=>{update.disabled=true;await generate(p,true);box.dataset.dossierKey='';},'text-button');update.disabled=a.status==='running'||p.busy;aside.append(update);
      if((a.status==='empty'||a.status==='ready'&&a.stale)&&!p.busy)void generate(p);
    }catch(e){if(box.dataset.dossierKey===key)box.append(el('p',e.message,'error'));}
  }
  return {overview,dossier};
}

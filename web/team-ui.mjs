export const node = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
export const dateLabel = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hour12:false }).format(new Date(value)) : '时间未记录';
export function safeUrl(value) { try { const u = new URL(value, location.origin); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } }
export function avatar(role, status) {
  const ids = ['chief','deputy','researcher','fact-checker','extractor','writer','editor','archivist','product','designer','developer','equity','macro','quant','risk'];
  const colors = ['#9560db','#6c6bdc','#18a894','#d99b20','#1aafc6','#4380fa','#dc7070','#839840','#4380fa','#9560db','#299b70','#189e8c','#4380fa','#d99b20','#dc7070'];
  const i = ids.includes(role.id) ? ids.indexOf(role.id) : [...String(role.id)].reduce((n,c)=>n+c.codePointAt(0),0)%colors.length;
  const wrap = node('span', null, 'robot-avatar'); wrap.style.setProperty('--role-color', colors[i]);
  // Static SVG geometry; role text is never interpolated into markup.
  wrap.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 7v8"/><circle cx="32" cy="6" r="3" fill="currentColor"/><rect x="${i%2?12:10}" y="18" width="${i%2?40:44}" height="35" rx="${8+i%4*3}" fill="currentColor" stroke="none" opacity=".28"/><rect x="15" y="23" width="34" height="24" rx="${6+i%3*3}" fill="currentColor" stroke="none"/><rect x="${3+i%2*2}" y="29" width="6" height="13" rx="3" fill="currentColor" stroke="none"/><rect x="55" y="29" width="6" height="13" rx="3" fill="currentColor" stroke="none"/><${i%3===1?'rect x="23" y="30" width="4" height="8" rx="2"':'circle cx="25" cy="34" r="3"'} fill="white" stroke="none"/><circle cx="39" cy="34" r="3" fill="white" stroke="none"/></svg>`;
  if (status) wrap.append(node('i', null, 'avatar-status '+status));
  return wrap;
}
export function taskRecords(projects, role) {
  return projects.flatMap(p => [...(p.history || []), ...(p.attempts || [])].filter(h => h.role === role).map((h,index) => {
    const n = p.definition?.workflow.nodes.find(n => n.id === h.node);
    const task = n?.tasks?.find(t => t.id === h.task) || n;
    return { ...h, id: h.id || `${p.id}:${h.node}:${h.task}:${h.startedAt||h.at}:${h.at}:${h.status||'done'}`, project:p, name:h.name || (h.task === 'plan' ? '选择协作方案' : task?.name || p.taskNames?.[h.task] || '历史任务'), status:h.status || 'done', outputs:h.outputs || task?.outputs || [] };
  })).sort((a,b) => String(b.at).localeCompare(String(a.at)));
}
export function messageRole(row,p) { return p.roles.find(r => r.id === row.role || p.botBindings?.[r.id] === row.role) || { id:'team', name:row.actor || '团队' }; }

function inline(text, parent) {
  const pattern = /\[([^\]]+)\]\(([^\s)]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g; let at=0, m;
  while ((m=pattern.exec(text))) {
    parent.append(document.createTextNode(text.slice(at,m.index)));
    if (m[1]) { const url=safeUrl(m[2]); const a=node(url?'a':'span',m[1]); if(url){a.href=url;a.target='_blank';a.rel='noopener noreferrer';} parent.append(a); }
    else parent.append(node(m[3]?'strong':'code',m[3]||m[4]));
    at=pattern.lastIndex;
  }
  parent.append(document.createTextNode(text.slice(at)));
}
// A small, non-HTML Markdown reader. All source text enters through text nodes.
export function documentView(text, format='markdown') {
  const root=node('div',null,'document-reader'), toc=node('nav',null,'document-toc'), body=node('article',null,'document-body');
  if (format==='html') { const frame=node('iframe'); frame.sandbox='allow-scripts allow-forms'; frame.srcdoc=text; root.append(frame); return root; }
  if (!['markdown','md'].includes(format)) { body.append(node('pre',text)); root.append(body); return root; }
  const lines=String(text).replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').split(/\r?\n/); let code=null, list=null, count=0;
  for (let i=0;i<lines.length;i++) {
    const line=lines[i];
    if (/^\s*```/.test(line)) { if(code){body.append(node('pre',code.join('\n')));code=null;}else code=[];list=null;continue; }
    if(code){code.push(line);continue;}
    if(!line.trim()){list=null;continue;}
    const heading=/^(#{1,6})\s+(.+)$/.exec(line);
    if(heading){const h=node('h'+heading[1].length);inline(heading[2],h);h.id='section-'+count++;body.append(h);if(heading[1].length<4){const b=node('button',heading[2]);b.onclick=()=>h.scrollIntoView({block:'start'});toc.append(b);}list=null;continue;}
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{3}/.test(lines[i+1]||'')) {
      const table=node('table'), row=(s,head)=>{const tr=node('tr');for(const cell of s.trim().replace(/^\||\|$/g,'').split('|')){const c=node(head?'th':'td');inline(cell.trim(),c);tr.append(c);}table.append(tr);};row(line,true);i++;
      while(/^\s*\|/.test(lines[i+1]||''))row(lines[++i],false);const scroller=node('div',null,'table-scroll');scroller.append(table);body.append(scroller);list=null;continue;
    }
    const bullet=/^\s*(?:[-*+]\s+|\d+[.)]\s+)(.*)$/.exec(line);
    if(bullet){const type=/^\s*\d/.test(line)?'OL':'UL';if(!list||list.tagName!==type){list=node(type.toLowerCase());body.append(list);}const li=node('li');inline(bullet[1],li);list.append(li);continue;}
    list=null;if(/^\s*([-*_])\1{2,}\s*$/.test(line)){body.append(node('hr'));continue;}
    const p=node(line.startsWith('>')?'blockquote':'p');inline(line.replace(/^>\s?/,''),p);body.append(p);
  }
  if(code)body.append(node('pre',code.join('\n')));
  if(toc.childElementCount>1){toc.prepend(node('strong','内容目录'));root.append(toc);}root.append(body);return root;
}

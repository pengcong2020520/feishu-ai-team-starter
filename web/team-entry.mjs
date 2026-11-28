import { avatar } from './team-ui.mjs';

// Arrival is a one-use visual handoff. It never changes team or workflow data.
export function consumeArrival(hash, replace) {
  const query = new URLSearchParams(hash.replace(/^#/, ''));
  const team = query.get('team');
  if (query.get('arrival') !== '1') return null;
  query.delete('arrival');
  replace('#' + query);
  return /^[a-z][a-z0-9-]{0,63}$/.test(team || '') ? team : null;
}

export function arriveTeam(pack, { reduced = matchMedia('(prefers-reduced-motion: reduce)').matches } = {}) {
  if (reduced) return () => {};
  const dock = document.getElementById('role-dock');
  const targets = pack.roles.map(role => ({ role, node: [...dock.querySelectorAll('[data-role]')].find(n => n.dataset.role === role.id)?.querySelector('.role-portrait') })).filter(x => x.node);
  if (!targets.length) return () => {};
  const scene = document.createElement('section');
  scene.className = 'arrival-scene'; scene.setAttribute('aria-label', '数字同事进入工作台');
  const heading = document.createElement('div'); heading.className = 'arrival-heading';
  const title = document.createElement('strong'); title.textContent = '团队就位';
  const caption = document.createElement('span'); caption.textContent = pack.name.split(/[·｜]/)[0].trim() + ' / 进入工作台';
  heading.append(title, caption); scene.append(heading);
  const grid = document.createElement('div'); grid.className = 'arrival-roster'; scene.append(grid);
  for (const {role} of targets) {
    const card = document.createElement('div'); card.className = 'arrival-identity';
    const name = document.createElement('strong'); name.textContent = role.name;
    card.append(avatar(role), name); grid.append(card);
  }
  const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'arrival-skip'; skip.textContent = '跳过动画'; scene.append(skip);
  document.body.append(scene); document.body.classList.add('team-arriving');
  const animations = [], flying = [];
  let stopped = false, timer;
  const finish = () => {
    if (stopped) return; stopped = true; clearTimeout(timer);
    animations.forEach(a => a.cancel()); flying.forEach(n => n.remove()); scene.remove(); document.body.classList.remove('team-arriving');
    window.removeEventListener('keydown', interrupt); window.removeEventListener('pointerdown', interrupt, true); window.removeEventListener('resize', finish); window.removeEventListener('hashchange', finish);
    if (document.activeElement === document.body) document.getElementById('board-nav')?.focus({preventScroll:true});
  };
  const interrupt = e => { if (e.type === 'pointerdown' || ['Escape','Tab','Enter'].includes(e.key)) finish(); };
  skip.onclick = finish;
  window.addEventListener('keydown', interrupt); window.addEventListener('pointerdown', interrupt, true); window.addEventListener('resize', finish); window.addEventListener('hashchange', finish);
  const animate = (node, frames, options) => { const a = node.animate(frames, options); animations.push(a); return a; };
  try {
    const duration = 1650, easing = 'cubic-bezier(.22,.72,.18,1)';
    for (const [i, {node}] of targets.entries()) {
      const card = grid.children[i], portrait = card.querySelector('.role-portrait');
      const start = portrait.getBoundingClientRect(), end = node.getBoundingClientRect();
      const clone = portrait.cloneNode(true); clone.classList.add('arrival-flight');
      Object.assign(clone.style, {left:start.x+'px',top:start.y+'px',width:start.width+'px',height:start.height+'px'});
      document.body.append(clone); flying.push(clone); portrait.style.visibility='hidden';
      // Off-screen roles still converge into the horizontal dock, never outside the viewport.
      const dockRect = dock.getBoundingClientRect(), x = Math.max(dockRect.left + 20, Math.min(end.x, innerWidth - end.width - 20));
      const dx = x-start.x, dy=end.y-start.y;
      animate(clone, [
        {transform:'translate(0,0) scale(1)',offset:0,opacity:1},
        {transform:`translate(${dx*.24+innerWidth*.07}px,${dy*.28}px) rotate(-8deg) scale(.9)`,offset:.35,opacity:1},
        {transform:`translate(${dx}px,${dy}px) scale(${end.width/start.width})`,offset:1,opacity:1},
      ], {duration:duration-100,delay:i*18,easing,fill:'both'});
    }
    animate(scene,[{opacity:1},{opacity:1,offset:.3},{opacity:0}],{duration,easing,fill:'both'});
    for (const node of [document.getElementById('sidebar'),document.getElementById('workspace')]) {
      animate(node,[{transform:'perspective(1400px) translate(12vw,-18vh) rotateX(18deg) rotateZ(-9deg) scale(.8)',opacity:.05},{transform:'perspective(1400px) translate(0,0) rotateX(0) rotateZ(0) scale(1)',opacity:1}],{duration:1450,delay:220,easing,fill:'both'});
    }
    timer = setTimeout(finish, 1950);
  } catch { finish(); }
  return finish;
}

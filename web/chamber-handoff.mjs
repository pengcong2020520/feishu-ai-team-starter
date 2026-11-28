// Kept self-contained so the setup page can also embed it without external assets.
export function leaveChamber(destination) {
  if (document.body.classList.contains('leaving-chamber')) return;
  const url = new URL(destination, location.href);
  if (!/^\/#team=[a-z][a-z0-9-]{0,63}&arrival=1$/.test(url.pathname + url.hash) || url.origin !== location.origin) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) { location.assign(url.href); return; }
  document.body.classList.add('leaving-chamber');
  const skip = document.createElement('button'); skip.type='button'; skip.className='departure-skip'; skip.textContent='跳过动画'; document.body.append(skip);
  let complete = false, timer;
  const go = (skipArrival = false) => {
    if (complete) return; complete = true; clearTimeout(timer);
    if (skipArrival) url.hash = url.hash.replace('&arrival=1', '');
    location.assign(url.href);
  };
  skip.onclick=()=>go(true); window.addEventListener('keydown',e=>{if(e.key==='Escape')go(true);});
  timer=setTimeout(()=>go(),460);
}

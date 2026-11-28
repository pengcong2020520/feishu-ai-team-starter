// Shared by the identity chamber and workbench. No external assets or user HTML.
export function rolePortrait(id) {
  const profiles = {
    chief: ['#8053c4','#2c2749','#f1bd96','chief'], deputy: ['#5369c5','#2f3866','#e4ad85','headset'],
    researcher: ['#159b8b','#353743','#efbf99','lens'], 'fact-checker': ['#c38a20','#6c472b','#e6ac7e','check'],
    extractor: ['#079cba','#293d51','#c58c69','files'], writer: ['#3977e6','#253449','#f0bf99','pen'],
    editor: ['#cb646c','#793e38','#efbf9f','edit'], archivist: ['#738c3d','#49382f','#dca37d','books'],
    product: ['#2c6ac7','#304165','#eab693','plan'], designer: ['#a45cc7','#573647','#efbfa8','brush'],
    developer: ['#278b72','#2b383a','#c99570','code'], equity: ['#168e85','#303741','#e4ae85','chart'],
    macro: ['#496ac7','#594334','#e6b18f','globe'], quant: ['#b58b29','#273642','#f0bd93','calc'],
    risk: ['#bd5d64','#493c45','#dca07d','shield'],
  };
  const [color,hair,skin,kind]=Object.hasOwn(profiles,id) ? profiles[id] : ['#6a7791','#3b4354','#e6b18f','plan'];
  const shapes = {
    chief:'<path d="M18 25q0-17 14-17t15 17l-7-7-20 4"/><path d="M20 53l12 6 12-6-5-8H25z" fill="white"/><path d="m30 50 4 0 2 10h-8z" fill="#514178"/>',
    headset:'<path d="M17 26q-1-15 15-15 16 0 15 15l-9-8-20 5"/><path d="M16 26v13m32-13v13M48 38q0 8-12 8" fill="none" stroke="#34416c" stroke-width="3"/>',
    lens:'<path d="M16 27q-3-18 17-18 18 0 15 19l-9-9-21 8"/><path d="M20 32h24" stroke="#34434b"/><circle cx="25" cy="32" r="5" fill="none" stroke="#34434b"/><circle cx="39" cy="32" r="5" fill="none" stroke="#34434b"/>',
    check:'<path d="M16 26q0-18 17-16 16 1 15 18L34 17l-17 9"/><path d="M19 28h10v7H19zm16 0h10v7H35z" fill="none" stroke="#805e37"/><path d="M29 31h6" stroke="#805e37"/>',
    files:'<path d="M16 31V20q3-13 17-12 14 1 15 16v20l-7-4-1-21-22 8v17l-4-3z"/>',
    pen:'<path d="M17 24q-1-16 15-16l2 6 11-4 3 15-9-6-20 6"/><path d="M18 22q13-5 29 0l-2-10q-14-7-25 2z" fill="#4269ae"/>',
    edit:'<path d="M16 33V19q2-13 17-11 16 3 15 20v13l-7 3V20l-9-4-12 11v17l-5-6z"/>',
    books:'<path d="M17 25q-1-15 16-15 15 0 14 16l-14-8z"/><path d="M17 22h31L44 13H22z" fill="#708445"/><path d="M17 24h31" stroke="#4d6330" stroke-width="3"/><circle cx="25" cy="32" r="4" fill="none" stroke="#554332"/><circle cx="39" cy="32" r="4" fill="none" stroke="#554332"/>',
    plan:'<path d="M16 26q1-18 17-17 16 1 15 18l-12-9-19 8"/><path d="M19 51l8-6 5 8 6-8 8 6-5 12H23z" fill="white"/>',
    brush:'<path d="M16 31q-4-18 16-20 17 2 16 22l-7 9-1-22-9-3-10 11-1 15z"/><path d="M14 18q-2-9 18-11 18 0 19 11-16 7-37 0" fill="#a16abd"/><path d="m32 7 3-4" stroke="#65427a" stroke-width="3"/>',
    code:'<path d="M12 55V27q0-21 20-21t20 21v28l-10-7V25l-10-7-11 7v23z" fill="#315a55"/><path d="M20 22q1-11 13-11 11 0 12 13l-11-6-14 8"/>',
    chart:'<path d="M17 25q-1-17 17-16 16 2 13 18l-6-10-23 7"/><path d="M18 55l9-10 5 10 7-10 7 10" fill="white"/><path d="m31 53 3 0 2 10h-7z" fill="#205b59"/>',
    globe:'<path d="M16 28q-2-19 18-18 18 2 14 22l-7 10V22l-10-5-11 10v16l-5-4z"/>',
    calc:'<path d="M17 24q0-17 16-16 17 0 15 18l-12-7-19 8"/><path d="M20 29h10v7H20zm15 0h10v7H35z" fill="none" stroke="#324359"/><path d="M30 32h5" stroke="#324359"/>',
    shield:'<path d="M15 27q0-19 18-18 17 2 15 22l-7-3-1-11-20 8v18l-7-3z"/>',
  };
  const tools = {
    chief:'<path d="M45 47h12v12H45z"/><path d="m48 50 2 2 4-4M48 55h6"/>',
    headset:'<path d="M45 48h13v9h-7l-4 3v-3h-2z"/><path d="M48 51h7M48 54h5"/>',
    lens:'<circle cx="49" cy="50" r="6"/><path d="m53 55 6 6"/>',
    check:'<path d="m44 47 7-3 8 3v6q-1 7-8 9-7-2-7-9z"/><path d="m47 52 3 3 5-6"/>',
    files:'<rect x="42" y="44" width="13" height="15" rx="2"/><rect x="46" y="48" width="13" height="15" rx="2"/><path d="M49 52h7M49 56h5"/>',
    pen:'<path d="m44 59 3-8 9-9 5 5-9 9-8 3z"/><path d="m52 46 5 5"/>',
    edit:'<path d="M42 47h17v14H42z"/><path d="M45 51h11M45 55h7m-1 5 8-9"/>',
    books:'<path d="M43 47h5v14h-5zm6-3h5v17h-5zm6 5h5v12h-5z"/><path d="M43 56h17"/>',
    plan:'<rect x="42" y="45" width="18" height="17" rx="2"/><path d="M45 49h5m-5 4h5m3-4h4m-4 4h4M45 58h12"/>',
    brush:'<path d="m44 60 8-15 5 2-8 14z"/><path d="M48 46q-9-7-8 2 0 6 8-2"/>',
    code:'<rect x="41" y="46" width="20" height="14" rx="2"/><path d="m48 50-3 3 3 3m7-6 3 3-3 3M40 62h22"/>',
    chart:'<rect x="42" y="45" width="19" height="17" rx="2"/><path d="m45 57 4-5 4 2 5-6"/>',
    globe:'<circle cx="51" cy="53" r="9"/><ellipse cx="51" cy="53" rx="4" ry="9"/><path d="M42 53h18M45 48h12M45 58h12"/>',
    calc:'<rect x="44" y="44" width="15" height="19" rx="2"/><path d="M47 48h9m-9 5h2m4 0h2m-8 5h2m4 0h2"/>',
    shield:'<path d="m43 47 8-3 9 3v6q-2 7-9 10-8-3-8-10z"/><path d="M51 49v7m0 2v1"/>',
  };
  return {color, svg:`<svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="17" fill="${color}" opacity=".1"/><path d="M7 64q1-19 25-20 24 1 25 20" fill="${color}"/><path d="M26 40h12v10q-6 6-12 0" fill="${skin}"/><ellipse cx="32" cy="29" rx="15" ry="18" fill="${skin}"/><g fill="${hair}">${shapes[kind]}</g><g fill="#293444"><circle cx="26" cy="31" r="1.4"/><circle cx="38" cy="31" r="1.4"/></g><path d="M28 39q4 3 8 0" fill="none" stroke="#a46859" stroke-width="1.5" stroke-linecap="round"/><g fill="white" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${tools[kind]}</g></svg>`};
}

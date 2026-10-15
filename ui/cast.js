// Characters and rooms from agent-standup by Arthur (MIT, see THIRD-PARTY-NOTICES.md). Procedural SVG, viewBox 100×75.
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const PAL = ['#ff7a6b','#ffb347','#ffd84a','#4fd1a5','#4cc3ff','#7c8cff','#b583ff','#ff7eb6'];
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = hexRGB(a), B = hexRGB(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
// ---------- illustrated rooms (viewBox 100×75) ----------
const star = (x, y, s, f = '#ffe58a') => `<path d="M${x} ${y - s}L${x + s * .3} ${y - s * .3}L${x + s} ${y}L${x + s * .3} ${y + s * .3}L${x} ${y + s}L${x - s * .3} ${y + s * .3}L${x - s} ${y}L${x - s * .3} ${y - s * .3}Z" fill="${f}"/>`;
const grad = (id, a, b, c) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/>${c ? `<stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/>` : `<stop offset="1" stop-color="${b}"/>`}</linearGradient>`;
const SCENES = [
  { desk: ['#c98a5a', '#9a6238'], svg: () => `<defs>${grad('gs0', '#ffc2a8', '#ff93b4', '#9a7bff')}</defs><rect width="100" height="75" fill="url(#gs0)"/>
    <circle cx="74" cy="31" r="19" fill="#fff3d0" opacity=".22"/><circle cx="74" cy="31" r="11" fill="#fff3d0"/>
    <path d="M0 50Q24 34 48 48T100 44V75H0z" fill="#7b5fd6"/><path d="M0 57Q30 45 62 56T100 53V75H0z" fill="#5b46b8"/>
    <path d="M18 22q2-3 4 0M26 17q2-3 4 0" stroke="#5a3d8a" stroke-width=".8" fill="none" stroke-linecap="round"/>` },
  { desk: ['#6b6fa8', '#43467a'], svg: () => `<defs>${grad('gs1', '#0d1230', '#2a2e68')}</defs><rect width="100" height="75" fill="url(#gs1)"/>
    ${[[12, 10, 1], [30, 18, .8], [58, 8, 1.1], [88, 22, .8], [72, 14, .7], [44, 24, .6], [8, 30, .7], [94, 8, .9]].map(([x, y, r], i) => `<circle class="tw" style="animation-delay:-${i * .4}s" cx="${x}" cy="${y}" r="${r * .7}" fill="#fff"/>`).join('')}
    <circle cx="80" cy="18" r="7" fill="#fff4cf"/><circle cx="83" cy="16" r="6.2" fill="#1d2150"/>
    <g fill="#161a45">${[[0, 40, 12], [12, 34, 9], [21, 44, 11], [32, 30, 8], [40, 41, 12], [52, 36, 9], [61, 45, 11], [72, 33, 10], [82, 42, 9], [91, 37, 10]].map(([x, y, w]) => `<rect x="${x}" y="${y}" width="${w}" height="${75 - y}"/>`).join('')}</g>
    <g fill="#ffd36e">${Array.from({ length: 26 }, (_, i) => `<rect x="${3 + (i * 37) % 92}" y="${42 + (i * 13) % 14}" width="1.4" height="1.8" opacity="${.5 + (i % 3) * .2}"/>`).join('')}</g>` },
  { desk: ['#caa27a', '#9c7650'], svg: () => `<defs>${grad('gs2', '#ffeadb', '#ffd2b5')}${grad('gw2', '#bfe9ff', '#eaf8ff')}</defs><rect width="100" height="75" fill="url(#gs2)"/>
    <rect x="9" y="9" width="30" height="30" rx="3" fill="#fff" /><rect x="11" y="11" width="26" height="26" rx="2" fill="url(#gw2)"/><path d="M24 11v26M11 24h26" stroke="#fff" stroke-width="1.6"/>
    <circle cx="30" cy="18" r="3.2" fill="#fff" opacity=".8"/>
    <rect x="62" y="22" width="32" height="2.4" rx="1" fill="#b98a64"/><rect x="62" y="40" width="32" height="2.4" rx="1" fill="#b98a64"/>
    ${[['#ff7a6b', 64, 12], ['#4cc3ff', 68, 14], ['#ffd84a', 72, 10], ['#7c8cff', 76, 13], ['#4fd1a5', 80, 11]].map(([c, x, h]) => `<rect x="${x}" y="${22 - h}" width="3.6" height="${h}" rx=".8" fill="${c}"/>`).join('')}
    <path d="M70 40q-7-5-3-10q5 3 3 10zM74 40q3-8 9-6q-2 7-9 6z" fill="#46b97f"/><rect x="70" y="40" width="9" height="0"/>` },
  { desk: ['#b9e0c4', '#86be9a'], svg: () => `<defs>${grad('gs3', '#bdf1ff', '#effff6')}</defs><rect width="100" height="75" fill="url(#gs3)"/>
    <g fill="#fff" class="drift"><ellipse cx="22" cy="16" rx="9" ry="3.6"/><ellipse cx="28" cy="13.5" rx="6" ry="3.6"/><ellipse cx="74" cy="24" rx="8" ry="3"/><ellipse cx="79" cy="21.8" rx="5" ry="3"/></g>
    <path d="M0 48Q25 36 52 47T100 42V75H0z" fill="#7ddc9a"/><path d="M0 56Q30 46 64 56T100 52V75H0z" fill="#4fc482"/>
    <rect x="80" y="30" width="2.6" height="14" fill="#8a5a3a"/><circle cx="81.3" cy="27" r="8" fill="#3fae6c"/><circle cx="77" cy="30" r="5" fill="#4fc482"/>
    ${[[14, 56, '#ff7eb6'], [24, 59, '#ffd84a'], [36, 55, '#fff'], [48, 58, '#ff7eb6']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="1.1" fill="${c}"/>`).join('')}` },
  { desk: ['#e6c48f', '#bf9a63'], svg: () => `<defs>${grad('gs4', '#ffe9ae', '#a4e8ff')}</defs><rect width="100" height="75" fill="url(#gs4)"/>
    <circle cx="22" cy="22" r="9" fill="#fff6d6"/><path d="M0 46Q12 41 24 46T48 46T72 46T100 46V75H0z" fill="#3cb7d9"/><path d="M0 52Q12 47 24 52T48 52T72 52T100 52V75H0z" fill="#2a95c4"/>
    <path d="M70 42V26L82 42z" fill="#fff"/><path d="M69 43h14l-2 3H71z" fill="#c4705a"/><path d="M69 43V24" stroke="#8a5a3a" stroke-width=".8"/>` },
  { desk: ['#7a5ea8', '#4d3a7a'], svg: () => `<defs>${grad('gs5', '#190f3d', '#4c2183')}</defs><rect width="100" height="75" fill="url(#gs5)"/>
    ${Array.from({ length: 16 }, (_, i) => `<circle class="tw" style="animation-delay:-${i * .3}s" cx="${(i * 53) % 97 + 2}" cy="${(i * 29) % 50 + 3}" r=".7" fill="#fff"/>`).join('')}
    <circle cx="22" cy="26" r="11" fill="#ff9bb8"/><ellipse cx="22" cy="26" rx="18" ry="3.6" fill="none" stroke="#ffe0a8" stroke-width="1.6" transform="rotate(-18 22 26)"/><path d="M13 22q9 4 18 1" stroke="#e86f98" stroke-width="1.4" fill="none"/>
    <circle cx="80" cy="20" r="6" fill="#6fd3ff"/><circle cx="77.5" cy="18" r="1.4" fill="#4ab6e6"/>${star(60, 14, 3)}${star(90, 40, 2.2, '#cfc2ff')}` },
  { desk: ['#506b73', '#2f4850'], svg: () => `<defs>${grad('gs6', '#10282f', '#18444f')}</defs><rect width="100" height="75" fill="url(#gs6)"/>
    ${[[5, 8], [36, 6], [67, 8]].map(([x, y], i) => `<rect x="${x}" y="${y}" width="28" height="22" rx="2.5" fill="#0a1a1f" stroke="#2b6a78" stroke-width=".8"/>
      <polyline points="${x + 3},${y + 17} ${x + 9},${y + 11} ${x + 14},${y + 14} ${x + 20},${y + 6} ${x + 25},${y + 9}" fill="none" stroke="${['#ff9a6b', '#4fd1a5', '#ffd84a'][i]}" stroke-width="1.3" stroke-linejoin="round"/>
      <rect x="${x + 3}" y="${y + 3}" width="9" height="1.4" rx=".7" fill="#4cc3ff" opacity=".7"/>`).join('')}
    <g fill="#ffe9a8" opacity=".7"><circle cx="20" cy="36" r="1" class="pulse"/><circle cx="50" cy="38" r="1" class="pulse" style="animation-delay:-.6s"/><circle cx="80" cy="36" r="1" class="pulse" style="animation-delay:-1.1s"/></g>` },
  { desk: ['#a87a56', '#7c5438'], svg: () => `<defs>${grad('gs7', '#3a2b52', '#6b4a68')}<radialGradient id="gl7"><stop offset="0" stop-color="#ffd98a" stop-opacity=".75"/><stop offset="1" stop-color="#ffd98a" stop-opacity="0"/></radialGradient></defs>
    <rect width="100" height="75" fill="url(#gs7)"/><circle cx="82" cy="30" r="26" fill="url(#gl7)"/>
    <path d="M82 54V36" stroke="#2a2233" stroke-width="1.6"/><path d="M75 36q7-9 14 0z" fill="#ffd98a"/>
    <rect x="12" y="10" width="22" height="16" rx="1.5" fill="#2a2233"/><rect x="14" y="12" width="18" height="12" rx="1" fill="#ff9a8b"/><path d="M14 24l6-6 5 4 4-3 3 5z" fill="#6b4a98"/><circle cx="27" cy="16" r="2" fill="#ffe9a8"/>` },
];

// ---------- the characters ----------
const SHAPES = [{ top: 20, fy: 40, hw: 23 }, { top: 14, fy: 35, hw: 19 }, { top: 15, fy: 41, hw: 24 }, { top: 16, fy: 40, hw: 22 }, { top: 22, fy: 40, hw: 22 }];
const EYES = [{ rx: 3.1, ry: 4.3 }, { rx: 3.7, ry: 3.7 }, { rx: 2.5, ry: 5 }];
function bodyShape(i, fill, dark) {
  return [`<rect x="27" y="20" width="46" height="56" rx="22" fill="${fill}"/>`, `<rect x="31" y="14" width="38" height="64" rx="19" fill="${fill}"/>`,
    `<g fill="${fill}"><circle cx="38" cy="36" r="13"/><circle cx="50" cy="29" r="15"/><circle cx="62" cy="36" r="13"/><rect x="26" y="36" width="48" height="40" rx="12"/></g>`,
    `<path d="M28 78V38a22 22 0 0 1 44 0V78z" fill="${fill}"/>`,
    `<rect x="28" y="22" width="44" height="54" rx="11" fill="${fill}"/><rect x="23.5" y="36" width="4.4" height="11" rx="2.2" fill="${dark}"/><rect x="72.1" y="36" width="4.4" height="11" rx="2.2" fill="${dark}"/><path d="M50 22V13" stroke="${dark}" stroke-width="1.5" stroke-linecap="round"/><circle class="pulse" cx="50" cy="11.4" r="2.8" fill="#8ff0ff"/>`][i];
}
const ACC = [
  (t, c) => `<path d="M50 ${t + 1}v-7" stroke="#3a9d68" stroke-width="1.6" stroke-linecap="round"/><path d="M50 ${t - 5}q-8-1-8-8q7 0 8 8z" fill="#53c98a"/><path d="M50 ${t - 5}q8-1 8-8q-7 0-8 8z" fill="#3fb677"/>`,
  (t, c, fy, hw) => `<path d="M${50 - hw - .5} ${fy - 3}Q${50 - hw} ${t - 7} 50 ${t - 7}Q${50 + hw} ${t - 7} ${50 + hw + .5} ${fy - 3}" fill="none" stroke="#2c2f40" stroke-width="3" stroke-linecap="round"/>
    <rect x="${50 - hw - 4}" y="${fy - 7}" width="7" height="14" rx="3.5" fill="${c}" stroke="#2c2f40" stroke-width="1.4"/><rect x="${50 + hw - 3}" y="${fy - 7}" width="7" height="14" rx="3.5" fill="${c}" stroke="#2c2f40" stroke-width="1.4"/>`,
  (t, c) => `<path d="M30 ${t + 11}Q30 ${t - 9} 50 ${t - 9}Q70 ${t - 9} 70 ${t + 11}z" fill="${c}"/><rect x="29" y="${t + 7}" width="42" height="7" rx="3.5" fill="${mix(c, '#000000', .16)}"/><circle cx="50" cy="${t - 10}" r="4" fill="${mix(c, '#ffffff', .45)}"/>`,
  (t, c) => `<path d="M31 ${t + 8}Q31 ${t - 8} 50 ${t - 8}Q69 ${t - 8} 69 ${t + 8}z" fill="${c}"/><path d="M45 ${t + 7}q22-3 30 3q-12 3-30-1z" fill="${mix(c, '#000000', .16)}"/>`,
  (t, c) => `<g transform="translate(60 ${t + 3}) rotate(14)"><path d="M0 0L-9-5V5z" fill="${c}"/><path d="M0 0L9-5V5z" fill="${c}"/><circle r="2.6" fill="${mix(c, '#000000', .18)}"/></g>`,
  (t, c) => `<path d="M44 ${t + 2}L40 ${t - 8}M56 ${t + 2}L60 ${t - 8}" stroke="#2c2f40" stroke-width="1.2" stroke-linecap="round"/><circle cx="40" cy="${t - 9}" r="2.4" fill="${c}"/><circle cx="60" cy="${t - 9}" r="2.4" fill="${c}"/>`,
];
function avatarSVG(p, o, uid = '') {   // uid keeps SVG ids unique per instance: duplicate ids made gradients vanish when the first copy was in a hidden element
  const st = !!o, sh = SHAPES[p.shape], fy = sh.fy, top = sh.top, bot = p.shape === 4, c = p.shirt, c1 = mix(c, '#ffffff', .3), c2 = mix(c, '#000000', .2);
  const ink = bot ? '#8ff0ff' : '#2a2233', gid = uid + 'b' + p.gid, sc = SCENES[p.scene], eg = EYES[p.eye], ex = p.shape === 1 ? [43, 57] : [41.5, 58.5];
  const V = (cls, show, html) => (st ? (show ? html : '') : `<g class="${cls}">${html}</g>`);
  const d0 = -((hash(p.id) % 45) / 10);
  const eye = (x) => `<g class="eye"><ellipse cx="${x}" cy="${fy}" rx="${eg.rx}" ry="${eg.ry}" fill="${ink}"/><g class="pupil"><circle cx="${x + 1}" cy="${fy - 1.5}" r="1.1" fill="#fff"/><circle cx="${x - 1}" cy="${fy + 1.4}" r=".55" fill="#fff" opacity=".7"/></g></g>`;
  const happy = (x) => `<path d="M${x - 3.6} ${fy + 1.4}Q${x} ${fy - 4.2} ${x + 3.6} ${fy + 1.4}" fill="none" stroke="${ink}" stroke-width="1.7" stroke-linecap="round"/>`;
  const brow = (x, s) => `<path class="brow ${s}" d="M${x - 3.6} ${fy - eg.ry - 3}q3.6-2 7.2 0" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"/>`;
  const my = fy + 10.5, working = st && o.working, done = st && o.done, speaking = st && o.m > 0, mopen = st && o.m === 2;
  const face = `${bot ? '<rect x="33" y="29" width="34" height="26" rx="9" fill="#1d2138"/>' : `<ellipse cx="${ex[0] - 6}" cy="${fy + 6}" rx="3.3" ry="2" fill="#ff6f91" opacity=".34"/><ellipse cx="${ex[1] + 6}" cy="${fy + 6}" rx="3.3" ry="2" fill="#ff6f91" opacity=".34"/>`}
    ${V('eyes-open', !done, eye(ex[0]) + eye(ex[1]))}${V('eyes-happy', done, happy(ex[0]) + happy(ex[1]))}${brow(ex[0], 'l')}${brow(ex[1], 'r')}
    ${V('smile', !speaking && !done, `<path d="M${46} ${my}q4 3.6 8 0" fill="none" stroke="${ink}" stroke-width="1.6" stroke-linecap="round"/>`)}
    ${V('grin', done && !speaking, `<path d="M44.5 ${my - .6}q5.5 8 11 0z" fill="${bot ? '#8ff0ff' : '#4b1c2c'}"/>`)}
    ${V('mouth', speaking, `<ellipse class="mouthE" cx="50" cy="${my + 1}" rx="${mopen ? 4 : 4.6}" ry="${mopen ? 4.4 : .9}" fill="${bot ? '#8ff0ff' : '#4b1c2c'}"/>`)}
    ${p.glasses ? `<g fill="rgba(255,255,255,.16)" stroke="#2c2f40" stroke-width="1.1"><circle cx="${ex[0]}" cy="${fy}" r="6.2"/><circle cx="${ex[1]}" cy="${fy}" r="6.2"/><path d="M${ex[0] + 6.2} ${fy}h${ex[1] - ex[0] - 12.4}" fill="none"/></g>` : ''}`;
  const acc = ACC[p.acc](top, p.acc2, fy, sh.hw) + (p.lead ? `<path d="M${50 - sh.hw} ${fy + 5}q-2 11 13 12" fill="none" stroke="#2c2f40" stroke-width="1.2" stroke-linecap="round"/><circle cx="${50 - sh.hw + 13}" cy="${fy + 17}" r="1.9" fill="#2c2f40"/>` : '');
  const arm = (side) => `<g class="arm ${side}"><ellipse cx="${side === 'l' ? 25 : 75}" cy="56" rx="4.6" ry="9" fill="${c2}" transform="rotate(${side === 'l' ? 12 : -12} ${side === 'l' ? 25 : 75} 56)"/></g>`;
  const prop = [`<path d="M11 62.4l1.6-7.4h7.2l1.6 7.4z" fill="#e07a5f"/><path d="M16 55q-6-8-2-12q5 4 2 12z" fill="#3fbf7f"/><path d="M16 55q6-7 10-5q-1 6-10 5z" fill="#53c98a"/>`,
    `<rect x="79" y="55.6" width="7.4" height="6.8" rx="1.6" fill="#f6f2ea"/><path d="M86.2 57q3.2 0 3.2 2.2t-3.2 2.2" fill="none" stroke="#f6f2ea" stroke-width="1.3"/><g class="steam" fill="none" stroke="#fff" stroke-width=".8" stroke-linecap="round" opacity=".7"><path d="M81.5 53q-1.4-1.8 0-3.4M84.3 53q-1.4-1.8 0-3.4"/></g>`,
    `<rect x="76" y="58.2" width="14" height="4.2" rx="1" fill="#ff7a6b"/><rect x="77.5" y="54.4" width="12" height="3.8" rx="1" fill="#4cc3ff"/><rect x="76.5" y="50.8" width="11" height="3.6" rx="1" fill="#ffd84a"/>`][p.prop];
  const lap = `<rect x="33" y="46" width="34" height="18" rx="2.8" fill="#d3d8e6"/><rect x="33" y="46" width="34" height="18" rx="2.8" fill="url(#${uid}lg)" opacity=".5"/><circle cx="50" cy="55" r="2.3" fill="${c1}"/><rect x="29.5" y="63.4" width="41" height="3" rx="1.5" fill="#aab1c2"/>`;
  const lapDark = `<rect x="33" y="46" width="34" height="18" rx="2.8" fill="#3b4152"/><rect x="33" y="46" width="34" height="18" rx="2.8" fill="url(#${uid}lg)" opacity=".18"/><circle cx="50" cy="55" r="2.3" fill="${c1}"/><rect x="29.5" y="63.4" width="41" height="3" rx="1.5" fill="#262a36"/>`;   // for custom characters: darker, so it still shows under a white or cream sprite
  const hands = `<circle class="hand l" cx="38" cy="65.6" r="3.1" fill="${c2}"/><circle class="hand r" cx="62" cy="65.6" r="3.1" fill="${c2}"/>`;
  const sparks = star(22, 28, 3) + star(78, 22, 2.6, '#ff9bb8') + star(70, 40, 1.9, '#9be7ff') + star(30, 46, 1.6, '#ffe58a');
  const custFig = (c, talking) => { const base = 'x="20" y="6" width="60" height="58" preserveAspectRatio="xMidYMax meet"', px = 'image-rendering:pixelated;';
    return `<image class="cimg" href="${c.idle}" ${base} style="${px}${talking && c.talk ? 'display:none' : ''}"/>` + (c.talk ? `<image class="cimg cimg-talk" href="${c.talk}" ${base} style="${px}${talking ? '' : 'display:none'}"/>` : ''); };
  const fig = p.custom ? custFig(p.custom, st && o.m === 2) : `${arm('l')}${bodyShape(p.shape, `url(#${gid})`, c2)}${arm('r')}${face}${acc}`;
  return `<svg viewBox="0 0 100 75" preserveAspectRatio="xMidYMid slice"${st ? ' xmlns="http://www.w3.org/2000/svg" width="400" height="300"' : ''}>
    <defs><linearGradient id="${gid}" gradientUnits="userSpaceOnUse" x1="0" y1="12" x2="0" y2="72"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c}"/></linearGradient>
      <linearGradient id="${uid}dk${p.scene}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sc.desk[0]}"/><stop offset="1" stop-color="${sc.desk[1]}"/></linearGradient>
      <linearGradient id="${uid}lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    ${sc.svg().replace(/id="(g[a-z]\d)"/g, `id="${uid}$1"`).replace(/url\(#(g[a-z]\d)\)/g, `url(#${uid}$1)`)}
    <g class="fig" style="--d:${d0}s">
      ${fig}
    </g>
    <rect y="62" width="100" height="13" fill="url(#${uid}dk${p.scene})"/><rect y="62" width="100" height="1.3" fill="#fff" opacity=".38"/><rect y="63.3" width="100" height="2.6" fill="#000" opacity=".1"/>
    ${prop}${p.custom ? "" : V('laptop', working, lap) + V('hands', working, hands)}${V('sparks', done, `<g class="sparks">${sparks}</g>`)}
  </svg>`;
}

// A squiggle's look, derived from its id (the lead has a fixed one).
function persona(s) {
  const h = hash(s.id);
  if (s.lead) return { id: s.id, name: s.name, role: s.role, shirt: '#e8845f', shape: 0, acc: 1, eye: 0, glasses: false, scene: 6, prop: 1, acc2: '#f5c04a', lead: true, gid: 'lead' };
  return { id: s.id, name: s.name, role: s.role, shirt: PAL[(h >>> 6) % 8], shape: (h >>> 3) % 5, acc: (h >>> 9) % 6, eye: (h >>> 12) % 3, glasses: ((h >>> 15) % 4) === 0,
    scene: (h >>> 18) % 6, prop: (h >>> 21) % 3, acc2: PAL[(h >>> 24) % 8], gid: h.toString(36) };
}

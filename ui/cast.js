// The room's characters: 20 originals in 10 rooms, each squiggle a variation (colour, face, accessory, desk item, room).
// Procedural SVG, viewBox 100x75. Live renders carry every state layer and room.css shows the right one;
// static renders (o given: { m: 0|1|2, working, done }) draw one state, for files like the call face.
// ui/cast-preview.html shows the whole cast for testing.
// Only these names are global (var, so Node's vm sees them too); everything else stays inside, clear of room.js and board.js.
var { hash, PAL, mix, avatarSVG, persona, LOOKS } = (() => {
const hash = (s) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const PAL = ['#ff7a6b', '#ffb347', '#ffd84a', '#4fd1a5', '#4cc3ff', '#7c8cff', '#b583ff', '#ff7eb6'];
const hexRGB = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => { const A = hexRGB(a), B = hexRGB(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };

// Render state, set by avatarSVG for the duration of one render.
let FACE = { eyes: 0, mouth: 0, cheeks: 0 }, MODE = null;
const V = (cls, show, html) => (MODE ? (show ? html : '') : `<g class="${cls}">${html}</g>`);

// One face for the whole family. fy = eye line, ex = eye x, o: ink, eye [rx, ry], mouth (offset), mouthFill, blush, big.
function face(fy, ex = [43, 57], o = {}) {
  const ink = o.ink || INK, fill = o.mouthFill || '#4b1c2c', my = fy + (o.mouth ?? 9), r = o.eye || [2.9, 4], M = MODE || {};
  const eyes = [
    (x) => `<ellipse cx="${x}" cy="${fy}" rx="${r[0]}" ry="${r[1]}" fill="${ink}"/><g class="pupil"><circle cx="${x + 1}" cy="${fy - 1.4}" r="1" fill="#fff"/></g>`,
    (x) => `<circle cx="${x}" cy="${fy}" r="${r[1] * .95}" fill="${ink}"/><g class="pupil"><circle cx="${x + 1.3}" cy="${fy - 1.3}" r="1.3" fill="#fff"/><circle cx="${x - 1.2}" cy="${fy + 1.4}" r=".6" fill="#fff"/></g>`,
    (x) => `<rect x="${x - r[0] * .6}" y="${fy - r[1] * 1.2}" width="${r[0] * 1.2}" height="${r[1] * 2.4}" rx="${r[0] * .6}" fill="${ink}"/>`,
    (x) => `<path d="M${x - r[0] - .6} ${fy - .4}A${r[0] + .6} ${r[1] * .8} 0 0 0 ${x + r[0] + .6} ${fy - .4}Z" fill="${ink}"/><path d="M${x - r[0] - 1.2} ${fy - .6}H${x + r[0] + 1.2}" stroke="${ink}" stroke-width="1.3" stroke-linecap="round"/>`,
    (x) => `<ellipse cx="${x}" cy="${fy}" rx="${r[0] * 1.05}" ry="${r[1]}" fill="${ink}"/><g class="pupil"><path d="M${x + 1} ${fy - 3}l.5 1.3 1.3.5-1.3.5-.5 1.3-.5-1.3-1.3-.5 1.3-.5z" fill="#fff"/></g>`,
  ];
  const big = (x) => `<circle cx="${x}" cy="${fy}" r="5.4" fill="#fff"/><g class="pupil"><circle cx="${x + 1}" cy="${fy + 1}" r="2.4" fill="${INK}"/></g>`;
  const eye = (x) => `<g class="eye">${o.big ? big(x) : eyes[FACE.eyes](x)}</g>`;
  const happy = (x) => `<path d="M${x - 3.4} ${fy + 1.2}Q${x} ${fy - 4} ${x + 3.4} ${fy + 1.2}" fill="none" stroke="${o.big ? '#fff' : ink}" stroke-width="1.7" stroke-linecap="round"/>`;
  const smiles = [
    `<path d="M46.5 ${my}q3.5 3.2 7 0" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>`,
    `<path d="M46 ${my}q2 2.4 4 0q2 2.4 4 0" fill="none" stroke="${ink}" stroke-width="1.4" stroke-linecap="round"/>`,
    `<path d="M46.4 ${my - .4}q3.6 5 7.2 0z" fill="${fill}"/>`,
    `<path d="M47 ${my + .6}q3 1.4 6.4-1.4" fill="none" stroke="${ink}" stroke-width="1.5" stroke-linecap="round"/>`,
  ];
  const cx = [ex[0] - 5.5, ex[1] + 5.5], cheeks = o.blush === false ? '' : [
    cx.map((x) => `<ellipse cx="${x}" cy="${fy + 5}" rx="3" ry="1.8" fill="#ff6f91" opacity=".35"/>`).join(''),
    cx.map((x) => `<path d="M${x - 2} ${fy + 6}l1.2-2M${x} ${fy + 6}l1.2-2M${x + 2} ${fy + 6}l1.2-2" stroke="#ff6f91" stroke-width=".8" stroke-linecap="round" opacity=".8"/>`).join(''),
    cx.map((x) => `<circle cx="${x - 1.4}" cy="${fy + 4.4}" r=".55" fill="#b8664f" opacity=".7"/><circle cx="${x + .6}" cy="${fy + 5.6}" r=".55" fill="#b8664f" opacity=".7"/><circle cx="${x + 1.6}" cy="${fy + 4}" r=".55" fill="#b8664f" opacity=".7"/>`).join(''),
    '',
  ][FACE.cheeks];
  // The talking mouth is one ellipse (.mouthE) that room.js resizes to the voice level.
  const talk = `<g transform="translate(50 ${my + 1}) scale(.78) translate(-50 ${-(my + 1)})"><ellipse class="mouthE" cx="50" cy="${my + 1}" rx="${M.mopen ? 4 : 4.6}" ry="${M.mopen ? 4.4 : .9}" fill="${fill}"/></g>`;
  return `<g class="face">${cheeks}${V('eyes-open', !M.done, eye(ex[0]) + eye(ex[1]))}${V('eyes-happy', !!M.done, happy(ex[0]) + happy(ex[1]))}`
    + `${V('smile', !M.speaking && !M.done, smiles[FACE.mouth])}${V('grin', M.done && !M.speaking, `<path d="M46 ${my - .4}q4 6 8 0z" fill="${fill}"/>`)}${V('mouth', !!M.speaking, talk)}</g>`;
}

const INK = '#2a2233';
// A shared face so the set reads as one family. ex = eye x positions, fy = eye line.
const star = (x, y, r, f) => `<path d="M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}Z" fill="${f}"/>`;
// Fixed pseudo-random points, so snow and stars sit still between renders.
const dots = (n, seed, y0, y1) => { let v = seed; const r = () => (v = (v * 9301 + 49297) % 233280) / 233280; return Array.from({ length: n }, () => [r() * 100, y0 + r() * (y1 - y0), .4 + r() * .9]); };
const g = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

// Rooms. Each has its own table colours; the table is a curved counter, drawn in tile().
const ROOMS = [
  { name: 'greenhouse', table: ['#e8d7b9', '#c9b18a'], svg: (u) => `<defs>${g(u + 's', '#eefaf2', '#bfe8d2')}</defs><rect width="100" height="75" fill="url(#${u}s)"/>
    <g stroke="#fff" stroke-width="1.2" opacity=".75" fill="none"><path d="M0 18Q50 -4 100 18"/><path d="M20 10V62M40 5V62M60 5V62M80 10V62M0 34H100"/></g>
    <path d="M14 0V16M86 0V12" stroke="#7a9a84" stroke-width=".6"/><path d="M10 16h8l-1.4 5h-5.2z" fill="#d9825b"/><path d="M82 12h8l-1.4 5h-5.2z" fill="#d9825b"/>
    <g fill="#4fae73"><path d="M12 21q-3 6-1 11q2-5 1-11z"/><path d="M15 21q3 5 1 9q-2-4-1-9z"/><path d="M84 17q-4 7-2 13q2-6 2-13z"/><path d="M88 17q3 4 2 8q-2-3-2-8z"/></g>` },
  { name: 'rooftop', table: ['#8a6a8f', '#5d4466'], svg: (u) => `<defs>${g(u + 's', '#3b3570', '#f4936f')}</defs><rect width="100" height="75" fill="url(#${u}s)"/>
    <g fill="#2a2347"><rect x="72" y="20" width="16" height="14" rx="2"/><path d="M71 20l9-6 9 6z"/><path d="M74 34l-2 28M86 34l2 28M73 46h14" stroke="#2a2347" stroke-width="1.4"/><rect x="0" y="48" width="22" height="14"/><rect x="24" y="52" width="14" height="10"/></g>
    <path d="M0 10Q30 24 60 12" fill="none" stroke="#2a2347" stroke-width=".5"/>${[[8, 13.4, '#ffd36e'], [18, 16.6, '#ff8fb1'], [28, 18, '#9be7ff'], [38, 17.6, '#ffd36e'], [48, 15.4, '#ff8fb1']].map(([x, y, c]) => `<circle cx="${x}" cy="${y}" r="1.3" fill="${c}"/><circle cx="${x}" cy="${y}" r="3" fill="${c}" opacity=".25"/>`).join('')}` },
  { name: 'aquarium', table: ['#5a7f8c', '#3b5a66'], svg: (u) => `<defs>${g(u + 's', '#0f5d82', '#0a2c48')}</defs><rect width="100" height="75" fill="url(#${u}s)"/>
    <g fill="#fff" opacity=".06"><path d="M20 0h8L14 62H4z"/><path d="M52 0h6L50 62h-9z"/><path d="M80 0h5L92 62h-8z"/></g>
    <g fill="none" stroke-linecap="round" stroke-width="2.4"><path d="M10 62Q6 50 11 40T9 22" stroke="#2fa47a"/><path d="M16 62Q20 52 15 44" stroke="#46c08f"/><path d="M88 62Q93 48 87 36T90 18" stroke="#2fa47a"/></g>
    <g fill="none" stroke="#bfefff" stroke-width=".6" opacity=".7">${dots(9, 7, 6, 56).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r * 1.6}"/>`).join('')}</g>` },
  { name: 'train', table: ['#7b4a35', '#55301f'], svg: (u) => `<defs>${g(u + 's', '#bfe6ff', '#e8f6ff')}</defs><rect width="100" height="75" fill="#c4704b"/>
    <rect x="8" y="6" width="84" height="46" rx="9" fill="#8f4a2e"/><rect x="11" y="9" width="78" height="40" rx="7" fill="url(#${u}s)"/>
    <path d="M11 36Q30 28 50 34T89 30V49H11z" fill="#9fd08a"/><path d="M11 42Q40 36 89 41V49H11z" fill="#6fb06a"/>
    <g stroke="#fff" stroke-width=".8" stroke-linecap="round" opacity=".8"><path d="M18 18h14M44 14h20M70 22h12M24 26h8"/></g><path d="M8 29h84" stroke="#8f4a2e" stroke-width="2"/>` },
  { name: 'snowfall', table: ['#e9eef7', '#b9c4d8'], svg: (u) => `<defs>${g(u + 's', '#1b2948', '#4a6a96')}</defs><rect width="100" height="75" fill="url(#${u}s)"/>
    <g fill="#16233d">${[[8, 30], [20, 22], [80, 24], [92, 32], [66, 36]].map(([x, h]) => `<path d="M${x} ${62 - h}l7 ${h}h-14z"/>`).join('')}</g>
    <g fill="#fff">${dots(38, 3, 2, 60).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r * .7}" opacity="${.5 + r / 3}"/>`).join('')}</g>` },
  { name: 'mesa', table: ['#d9a072', '#b0714a'], svg: (u) => `<rect width="100" height="75" fill="#ffe0b5"/><rect y="14" width="100" height="14" fill="#ffc796"/><rect y="28" width="100" height="16" fill="#ffad84"/>
    <g fill="#c2603f"><path d="M0 62V40h14l4 6h12l3 16z"/><path d="M58 62l4-26h22l5 26z"/></g><path d="M62 36h22" stroke="#e07c55" stroke-width="1.2"/>
    <g fill="#4f9a62"><rect x="40" y="44" width="4" height="18" rx="2"/><rect x="35" y="48" width="3" height="8" rx="1.5"/><rect x="46" y="46" width="3" height="7" rx="1.5"/><rect x="36" y="54" width="5" height="2.4" rx="1.2"/><rect x="43" y="51" width="5" height="2.4" rx="1.2"/></g>` },
  { name: 'cafe', table: ['#6b4a3a', '#46302a'], svg: (u) => `<defs>${g(u + 's', '#212d40', '#3a4a63')}</defs><rect width="100" height="75" fill="url(#${u}s)"/>
    <g stroke="#9fc4ff" stroke-width=".5" opacity=".5">${dots(22, 11, 0, 56).map(([x, y]) => `<path d="M${x} ${y}l-1.4 5"/>`).join('')}</g>
    <g fill="none" stroke="#ff7cc2" stroke-width="1.4" stroke-linecap="round"><path d="M70 22h16v8a8 8 0 0 1-16 0z"/><path d="M86 24q5 0 4 4t-4 3"/><path d="M75 18q-2-3 0-6M81 18q-2-3 0-6"/></g>
    <g fill="none" stroke="#ff7cc2" stroke-width="5" opacity=".14"><path d="M70 22h16v8a8 8 0 0 1-16 0z"/></g>` },
  { name: 'aurora', table: ['#3c5566', '#243844'], svg: (u) => `<defs>${g(u + 's', '#06172a', '#103a50')}</defs><rect width="100" height="75" fill="url(#${u}s)"/>
    <g fill="none" stroke-linecap="round"><path d="M-5 26Q20 8 45 22T100 12" stroke="#5cf2b0" stroke-width="5" opacity=".35"/><path d="M-5 32Q30 16 60 28T105 20" stroke="#56c8ff" stroke-width="4" opacity=".28"/><path d="M10 20Q35 4 70 16" stroke="#b58cff" stroke-width="3" opacity=".25"/></g>
    <g fill="#fff">${dots(16, 5, 2, 30).map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r * .45}"/>`).join('')}</g><path d="M0 62L18 40L30 50L46 34L64 52L78 42L100 60V62Z" fill="#0b2233"/>` },
  { name: 'paper studio', table: ['#f6efe2', '#d8c9ad'], svg: (u) => `<rect width="100" height="75" fill="#f2dfc0"/>
    <rect x="58" y="6" width="34" height="40" rx="2" fill="#e4c99e"/><g fill="#c9a979">${Array.from({ length: 30 }, (_, i) => `<circle cx="${62 + (i % 6) * 5.5}" cy="${10 + Math.floor(i / 6) * 7.6}" r=".7"/>`).join('')}</g>
    <g transform="rotate(-6 22 24)"><rect x="10" y="10" width="24" height="28" fill="#fffdf6"/><path d="M14 30q4-10 8-4t8-8" fill="none" stroke="#7c8cff" stroke-width="1.2"/><circle cx="22" cy="11" r="1.6" fill="#ff7a6b"/></g>
    <rect x="66" y="18" width="2" height="22" rx="1" fill="#ff7a6b"/><rect x="72" y="22" width="12" height="9" rx="1" fill="#9be7ff"/>` },
  { name: 'treehouse', table: ['#b77d4f', '#8a5634'], svg: (u) => `<rect width="100" height="75" fill="#a86a43"/>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect y="${i * 9}" width="100" height="8.4" fill="${i % 2 ? '#a0643e' : '#ad6f47'}"/>`).join('')}
    <circle cx="70" cy="26" r="17" fill="#6b3e24"/><circle cx="70" cy="26" r="14.5" fill="#bfe8ff"/>
    <g fill="#4fae73"><circle cx="62" cy="34" r="6"/><circle cx="76" cy="36" r="7"/><circle cx="70" cy="16" r="5"/></g><path d="M55.5 26h29M70 11.5v29" stroke="#6b3e24" stroke-width="1.6"/>` },
];

const CHARS = [
  { name: 'Puff', scene: 1,
    svg: (u) => `<defs>${g(u + 'b', '#ffd1c4', '#ff9f8a')}</defs><circle cx="31" cy="52" r="5.5" fill="#f58a74"/><circle cx="69" cy="52" r="5.5" fill="#f58a74"/>
      <circle cx="50" cy="44" r="20" fill="url(#${u}b)"/><path d="M50 24.5q-1-6 4-7q4-.4 3 3.5" fill="none" stroke="#f58a74" stroke-width="2.2" stroke-linecap="round"/>${face(42)}` },
  { name: 'Sprig', scale: 1.1, scene: 0,
    svg: (u) => `<defs>${g(u + 'b', '#ffe27a', '#f2b632')}</defs><path d="M50 32Q49 22 53 13" fill="none" stroke="#3a9d68" stroke-width="1.7" stroke-linecap="round"/>
      ${V('bud', !(MODE && MODE.speaking), `<ellipse cx="53.5" cy="11" rx="3" ry="4.2" fill="#ff9bc2" transform="rotate(18 53.5 11)"/>`)}
      ${V('bloom', !!(MODE && MODE.speaking), `${[0, 72, 144, 216, 288].map((a) => `<ellipse cx="53" cy="7" rx="2.8" ry="4.4" fill="#ff9bc2" transform="rotate(${a} 53 11.5)"/>`).join('')}<circle cx="53" cy="11.5" r="2.4" fill="#ffe58a"/>`)}
      <ellipse cx="34" cy="52" rx="3.4" ry="7" fill="#e9a52a" transform="rotate(16 34 52)"/><ellipse cx="66" cy="52" rx="3.4" ry="7" fill="#e9a52a" transform="rotate(-16 66 52)"/>
      <ellipse cx="50" cy="48" rx="15" ry="19" fill="url(#${u}b)"/>${face(44, [44, 56], { eye: [2.5, 3.6] })}` },
  { name: 'Wisp', scale: 1.12, scene: 7, float: true,
    svg: (u) => `<defs>${g(u + 'b', '#ffffff', '#d9d0ff')}</defs><path d="M50 19v-6" stroke="#b8a8ff" stroke-width="1.3"/>${star(50, 10, 3.6, '#ffe58a')}
      <path d="M31 56V38a19 19 0 0 1 38 0V56${'q-1.6 4-3.17 0q-1.6-4-3.16 0'.repeat(6)}z" fill="url(#${u}b)"/>
      <ellipse cx="29.5" cy="44" rx="3.2" ry="5" fill="#e8e1ff" transform="rotate(30 29.5 44)"/><ellipse cx="70.5" cy="44" rx="3.2" ry="5" fill="#e8e1ff" transform="rotate(-30 70.5 44)"/>${face(37)}` },
  { name: 'Gloop', scene: 2,
    svg: (u) => `<defs>${g(u + 'b', '#c4f59a', '#5fcf55')}</defs><path d="M27 63Q26 45 41 39Q49 34 49 24Q49 19 53 19Q51 23 53 29Q55 36 61 39Q74 45 73 63Z" fill="url(#${u}b)"/>
      <path d="M35 46q3-4 8-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" opacity=".7"/>${face(49, [43, 57])}` },
  { name: 'Cap', scale: 1.12, scene: 9,
    svg: (u) => `<defs>${g(u + 'b', '#5fd6c6', '#1f9e8f')}</defs><rect x="36" y="36" width="28" height="30" rx="11" fill="#f7e7cf"/>
      <path d="M22 40Q22 13 50 13Q78 13 78 40Q50 47 22 40Z" fill="url(#${u}b)"/><g fill="#fff6e0"><circle cx="38" cy="25" r="4"/><circle cx="58" cy="21" r="3"/><circle cx="68" cy="33" r="3.4"/><circle cx="30" cy="36" r="2.4"/></g>
      ${face(48, [44, 56], { eye: [2.4, 3.4], mouth: 6 })}<path d="M37 61h26" stroke="#ff8a5b" stroke-width="4" stroke-linecap="round"/>` },
  { name: 'Tama', scale: 1.12, scene: 8,
    svg: (u) => `<defs>${g(u + 'b', '#ffb8cf', '#ff7fa8')}</defs><circle cx="50" cy="14" r="3.6" fill="none" stroke="#c8cbe0" stroke-width="1.4"/>
      <ellipse cx="50" cy="42" rx="20" ry="24" fill="url(#${u}b)"/><rect x="37" y="28" width="26" height="22" rx="4" fill="#cfe8bf" stroke="#e86e98" stroke-width="1.2"/>
      ${face(37, [45, 55], { ink: '#2f4a2a', eye: [1.8, 2.6], mouth: 6, blush: false, mouthFill: '#2f4a2a' })}
      <g fill="#fff4f8"><circle cx="42" cy="56" r="2.2"/><circle cx="50" cy="58" r="2.2"/><circle cx="58" cy="56" r="2.2"/></g>` },
  { name: 'Vee', scale: 1.14, scene: 3, float: true,
    svg: (u) => `<defs>${g(u + 'b', '#ffffff', '#d7dcea')}</defs><ellipse cx="30" cy="46" rx="3.6" ry="8" fill="#e6e9f3" transform="rotate(14 30 46)"/><ellipse cx="70" cy="46" rx="3.6" ry="8" fill="#e6e9f3" transform="rotate(-14 70 46)"/>
      <ellipse cx="50" cy="40" rx="17" ry="21" fill="url(#${u}b)"/><path d="M34 47q16 7 32 0" fill="none" stroke="#ff9a4a" stroke-width="2.4"/>
      <ellipse cx="50" cy="34" rx="12.5" ry="8.5" fill="#141a2e"/>${face(33, [45, 55], { ink: '#7ef2ff', eye: [2.6, 2], mouth: 5, blush: false, mouthFill: '#7ef2ff' })}` },
  { name: 'Smudge', scene: 6,
    svg: (u) => { const spikes = Array.from({ length: 28 }, (_, i) => { const a = i / 28 * Math.PI * 2, r = i % 2 ? 19 : 22; return `${(50 + Math.cos(a) * r).toFixed(1)} ${(44 + Math.sin(a) * r).toFixed(1)}`; }).join('L');
      return `<path d="M${spikes}Z" fill="#4a3a78"/><circle cx="50" cy="44" r="18" fill="#5b4a8f"/><rect x="36" y="52" width="28" height="11" rx="5" fill="#ffb347"/>
        ${face(40, [43, 57], { big: true, ink: '#fff', blush: false, mouth: 8.5, mouthFill: '#2a1f45' })}`; } },
  { name: 'Nimbus', scene: 5, float: true,
    svg: (u) => `<defs>${g(u + 'b', '#ffffff', '#cfe2ff')}</defs><g fill="url(#${u}b)"><circle cx="36" cy="44" r="11"/><circle cx="50" cy="35" r="14"/><circle cx="64" cy="44" r="11"/><rect x="28" y="40" width="44" height="15" rx="7.5"/></g>
      <g fill="#7cc4ff" opacity=".8"><path d="M38 60q-1.6 3 0 4q1.6-1 0-4z"/><path d="M50 62q-1.6 3 0 4q1.6-1 0-4z"/><path d="M62 60q-1.6 3 0 4q1.6-1 0-4z"/></g>${face(42)}` },
  { name: 'Nori', scene: 4,
    svg: (u) => `<defs>${g(u + 'b', '#ffffff', '#eceae2')}</defs><path d="M50 16Q56 16 62 26L74 50Q78 63 64 63H36Q22 63 26 50L38 26Q44 16 50 16Z" fill="url(#${u}b)"/>
      <rect x="35" y="50" width="30" height="13" rx="2" fill="#24432f"/><circle cx="50" cy="21" r="3.2" fill="#e8577a"/>${face(40, [44, 56], { mouth: 6.5 })}` },
  { name: 'Mallow', scene: 8,
    svg: (u) => `<defs>${g(u + 'b', '#ffffff', '#ffd6e6')}</defs><rect x="29" y="27" width="42" height="38" rx="13" fill="url(#${u}b)"/>
      <g stroke-width="1.6" stroke-linecap="round"><path d="M40 31l2 1" stroke="#ff7a6b"/><path d="M50 30l1.6-1.4" stroke="#4cc3ff"/><path d="M58 32l2 .6" stroke="#ffd23f"/><path d="M45 34l1.4-1.2" stroke="#5fd6a0"/></g>${face(45)}` },
  { name: 'Bao', scene: 6,
    svg: (u) => `<defs>${g(u + 'b', '#fffaf0', '#efd9bb')}</defs><path d="M27 63Q25 33 50 29Q75 33 73 63Z" fill="url(#${u}b)"/>
      <g fill="none" stroke="#dcc3a0" stroke-width="1.1" stroke-linecap="round"><path d="M50 30q-3 4-8 5M50 30q3 4 8 5M50 30q0 4-1 6"/></g><circle cx="50" cy="30" r="1.8" fill="#dcc3a0"/>${face(48)}` },
  { name: 'Pebble', scene: 5,
    svg: (u) => `<defs>${g(u + 'b', '#c9ccd8', '#8d91a3')}</defs><path d="M28 63Q25 44 33 34Q41 26 54 27Q68 28 72 42Q76 54 72 63Z" fill="url(#${u}b)"/>
      <path d="M36 32q4-5 10-4q-2 3-6 4z" fill="#6cbf6a"/><path d="M38 30.6q2-3 4-2.6" stroke="#4f9a54" stroke-width=".8" fill="none"/><path d="M67 40l-3 3 2 2" fill="none" stroke="#757a8c" stroke-width=".9"/>${face(45)}` },
  { name: 'Boba', scene: 1,
    svg: (u) => `<defs>${g(u + 'b', '#f6e2c4', '#e2bf92')}</defs><path d="M54 30l8-16" stroke="#ff8fb1" stroke-width="3.2" stroke-linecap="round"/>
      <path d="M34 30H66L62 64H38Z" fill="url(#${u}b)"/><path d="M33 30Q33 22 50 22Q67 22 67 30Z" fill="#fff" fill-opacity=".65" stroke="#fff"/><rect x="32" y="29" width="36" height="3" rx="1.5" fill="#fff"/>
      <g fill="#4a2f2a">${[[42, 57], [47, 59], [53, 58], [58, 56], [44, 61], [56, 61]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.2"/>`).join('')}</g>${face(42, [44, 56], { eye: [2.5, 3.5], mouth: 7 })}` },
  { name: 'Wick', scene: 4,
    svg: (u) => `<defs>${g(u + 'b', '#fff6e2', '#f1dcb4')}<radialGradient id="${u}f" cx=".5" cy=".7" r=".6"><stop offset="0" stop-color="#fff3a8"/><stop offset=".6" stop-color="#ffb347"/><stop offset="1" stop-color="#ff6b4a"/></radialGradient></defs>
      <circle cx="50" cy="30" r="12" fill="#ffd36e" opacity=".18"/><path class="flick" d="M50 18Q57 28 55 34Q53 38 50 38Q47 38 45 34Q43 28 50 18Z" fill="url(#${u}f)"/><path d="M50 38v3" stroke="#3a3040" stroke-width="1"/>
      <rect x="38" y="40" width="24" height="25" rx="4" fill="url(#${u}b)"/><path d="M41 40v5a1.6 1.6 0 0 0 3.2 0V40M55 40v3.4a1.4 1.4 0 0 0 2.8 0V40" fill="#fff6e2"/>${face(49, [45, 55], { eye: [2.2, 3.2], mouth: 7 })}` },
  { name: 'Bumble', scene: 0, float: true,
    svg: (u) => `<defs><clipPath id="${u}c"><circle cx="50" cy="44" r="18"/></clipPath></defs><g fill="#fff" opacity=".75"><ellipse cx="38" cy="25" rx="7" ry="5" transform="rotate(-25 38 25)"/><ellipse cx="62" cy="25" rx="7" ry="5" transform="rotate(25 62 25)"/></g>
      <path d="M45 27q-3-6-6-6M55 27q3-6 6-6" fill="none" stroke="${INK}" stroke-width="1"/><circle cx="39" cy="21" r="1.4" fill="${INK}"/><circle cx="61" cy="21" r="1.4" fill="${INK}"/>
      <circle cx="50" cy="44" r="18" fill="#ffd23f"/><g clip-path="url(#${u}c)" fill="#3a3040"><rect x="30" y="50" width="40" height="4"/><rect x="30" y="57" width="40" height="4"/></g>${face(41)}` },
  { name: 'Pip', scene: 7,
    svg: (u) => `<defs>${g(u + 'b', '#7b8db0', '#4f5f80')}</defs><ellipse cx="32" cy="50" rx="3.6" ry="9" fill="#4f5f80" transform="rotate(20 32 50)"/><ellipse cx="68" cy="50" rx="3.6" ry="9" fill="#4f5f80" transform="rotate(-20 68 50)"/>
      <ellipse cx="50" cy="46" rx="18" ry="20" fill="url(#${u}b)"/><ellipse cx="50" cy="53" rx="12" ry="12" fill="#f4f7ff"/><path d="M50 26q-2-5 1-7M50 26q2-4 5-4M50 26q-3-3-6-2" fill="none" stroke="#4f5f80" stroke-width="1.4" stroke-linecap="round"/>
      ${face(40, [43, 57], { mouth: 10 })}<path d="M48 44h4l-2 2.4z" fill="#ffa64a"/>` },
  { name: 'Acorn', scene: 3,
    svg: (u) => `<defs>${g(u + 'b', '#e3a764', '#b9773d')}</defs><ellipse cx="50" cy="49" rx="16" ry="16" fill="url(#${u}b)"/>
      <path d="M32 38Q32 25 50 25Q68 25 68 38Q50 42 32 38Z" fill="#7a5230"/><g stroke="#5e3e22" stroke-width=".6" opacity=".7"><path d="M38 28l8 12M46 26l8 13M54 26l8 11M62 30l-10 10M54 26l-10 13M46 26l-8 11"/></g>
      <path d="M50 25q0-4 3-6" stroke="#5e3e22" stroke-width="1.6" stroke-linecap="round" fill="none"/>${face(49, [44, 56])}` },
  { name: 'Jelly', scene: 2, float: true,
    svg: (u) => `<defs>${g(u + 'b', '#ffd6f4', '#b993ff')}</defs><g class="sway" fill="none" stroke="#d7b8ff" stroke-width="1.6" stroke-linecap="round" opacity=".85">
      <path d="M36 40q-3 6 0 11t0 9"/><path d="M44 41q3 6 0 11t0 8"/><path d="M56 41q-3 6 0 11t0 8"/><path d="M64 40q3 6 0 11t0 9"/></g>
      <path d="M30 40Q30 18 50 18Q70 18 70 40Q65 43 60 40Q55 43 50 40Q45 43 40 40Q35 43 30 40Z" fill="url(#${u}b)" opacity=".92"/>${face(31, [44, 56], { mouth: 6 })}` },
  { name: 'Toast', scene: 9,
    svg: (u) => `<path d="M29 63V34Q29 22 39 22Q43 17 50 19Q57 17 61 22Q71 22 71 34V63Z" fill="#c98a4b"/><path d="M32 63V35Q32 25 40 25Q44 21 50 22.6Q56 21 60 25Q68 25 68 35V63Z" fill="#f8deb0"/>
      <rect x="54" y="25" width="8" height="6" rx="1.4" fill="#fff2a8" transform="rotate(-8 58 28)"/>${face(43)}` },
];

// Where accessories sit on each character: head top, half-width, eye line, eye x, and what fits.
const FIT = {
  Puff: { top: 24, hw: 20, fy: 42, ok: 'headphones bucket crown flower glasses' },
  Sprig: { top: 29, hw: 15, fy: 44, ex: [44, 56], ok: 'headphones glasses' },
  Wisp: { top: 19, hw: 19, fy: 37, ok: 'headphones flower glasses' },
  Gloop: { top: 30, hw: 19, fy: 49, ok: 'headphones glasses flower' },
  Cap: { top: 13, hw: 14, fy: 48, ex: [44, 56], ok: 'glasses' },
  Tama: { top: 18, hw: 20, fy: 40, ok: 'headphones bucket crown flower' },
  Vee: { top: 19, hw: 17, fy: 33, ok: 'headphones bucket crown' },
  Smudge: { top: 24, hw: 20, fy: 40, ok: 'headphones bucket crown flower' },
  Nimbus: { top: 22, hw: 22, fy: 42, ok: 'headphones crown flower glasses' },
  Nori: { top: 16, hw: 17, fy: 40, ex: [44, 56], ok: 'headphones glasses flower' },
  Mallow: { top: 27, hw: 21, fy: 45, ok: 'headphones bucket crown flower glasses' },
  Bao: { top: 30, hw: 21, fy: 48, ok: 'headphones crown flower glasses' },
  Pebble: { top: 27, hw: 21, fy: 45, ok: 'headphones bucket crown flower glasses' },
  Boba: { top: 22, hw: 17, fy: 42, ex: [44, 56], ok: 'headphones glasses' },
  Wick: { top: 40, hw: 12, fy: 49, ex: [45, 55], ok: 'glasses' },
  Bumble: { top: 26, hw: 18, fy: 41, ok: 'headphones crown glasses' },
  Pip: { top: 26, hw: 18, fy: 40, ok: 'headphones bucket crown flower glasses' },
  Acorn: { top: 25, hw: 17, fy: 49, ex: [44, 56], ok: 'headphones glasses' },
  Jelly: { top: 18, hw: 20, fy: 31, ex: [44, 56], ok: 'crown flower glasses' },
  Toast: { top: 19, hw: 20, fy: 43, ok: 'headphones crown flower glasses' },
};
const DARK = '#2c2f40';
const ACCS = {
  headphones: (a, c) => `<path d="M${50 - a.hw - 1.5} ${a.fy + 1}V${a.fy - 5}Q${50 - a.hw - 1.5} ${a.top - 4.5} 50 ${a.top - 4.5}Q${50 + a.hw + 1.5} ${a.top - 4.5} ${50 + a.hw + 1.5} ${a.fy - 5}V${a.fy + 1}" fill="none" stroke="${DARK}" stroke-width="2.4" stroke-linecap="round"/>
    ${[-1, 1].map((d) => `<circle cx="${50 + d * (a.hw + 1.5)}" cy="${a.fy + 1}" r="5.2" fill="${c}" stroke="${DARK}" stroke-width="1.2"/><circle cx="${50 + d * (a.hw + 1.5)}" cy="${a.fy + 1}" r="2.2" fill="${DARK}" opacity=".35"/>`).join('')}`,
  bucket: (a, c) => `<path d="M${50 - a.hw + 4} ${a.top + 5}Q${50 - a.hw + 6} ${a.top - 8} 50 ${a.top - 8}Q${50 + a.hw - 6} ${a.top - 8} ${50 + a.hw - 4} ${a.top + 5}Z" fill="${c}"/>
    <ellipse cx="50" cy="${a.top + 5}" rx="${a.hw + 5}" ry="3" fill="${c}" stroke="${DARK}" stroke-opacity=".25"/><path d="M${50 - a.hw + 5} ${a.top + 1.6}H${50 + a.hw - 5}" stroke="${DARK}" stroke-opacity=".3" stroke-width="2"/>`,
  crown: (a) => `<path d="M41 ${a.top + 2}V${a.top - 6}L45.5 ${a.top - 2}L50 ${a.top - 9}L54.5 ${a.top - 2}L59 ${a.top - 6}V${a.top + 2}Z" fill="#ffd23f" stroke="#e0a400" stroke-width=".8" stroke-linejoin="round"/>
    <circle cx="50" cy="${a.top - 1}" r="1.4" fill="#ff6f91"/><circle cx="44" cy="${a.top}" r="1" fill="#4cc3ff"/><circle cx="56" cy="${a.top}" r="1" fill="#4cc3ff"/>`,
  flower: (a, c) => { const x = 50 + a.hw * .62, y = a.top + 6; return [0, 72, 144, 216, 288].map((r) => `<ellipse cx="${x}" cy="${y - 3}" rx="2" ry="3" fill="${c}" transform="rotate(${r} ${x} ${y})"/>`).join('') + `<circle cx="${x}" cy="${y}" r="1.6" fill="#ffe58a"/>`; },
  glasses: (a) => { const ex = a.ex || [43, 57]; return `<g fill="#fff" fill-opacity=".15" stroke="${DARK}" stroke-width="1.2">${ex.map((x) => `<rect x="${x - 4.8}" y="${a.fy - 4}" width="9.6" height="7.6" rx="2"/>`).join('')}<path d="M${ex[0] + 4.8} ${a.fy - 1}H${ex[1] - 4.8}" fill="none"/></g>`; },
};
// Things on the counter, right side.
const DECOR = {
  duck: () => `<ellipse cx="84" cy="59.5" rx="5" ry="3.2" fill="#ffd23f"/><circle cx="87" cy="55.6" r="2.7" fill="#ffd23f"/><path d="M89.4 55.6l2.4.6-2.4.8z" fill="#ff8a3d"/><circle cx="87.6" cy="55" r=".55" fill="${DARK}"/>`,
  lava: () => `<path d="M80 62l1.4-4h5.2l1.4 4z" fill="#55607a"/><path d="M81.6 58Q81 50 84 44Q87 50 86.4 58z" fill="#ff9bc2" opacity=".55"/><circle cx="84" cy="54" r="1.6" fill="#ff5f9e"/><circle cx="83.4" cy="49.6" r="1" fill="#ff5f9e"/><path d="M82.6 44.4h2.8l-.4-2h-2z" fill="#55607a"/>`,
  globe: () => `<rect x="79" y="58.6" width="10" height="3.6" rx="1" fill="#7c5a8f"/><circle cx="84" cy="54" r="5.4" fill="#cfefff" opacity=".7"/><path d="M81 57.4l3-4 3 4z" fill="#2f7a5a"/><g fill="#fff"><circle cx="82" cy="51" r=".5"/><circle cx="85.6" cy="50.4" r=".5"/><circle cx="86.6" cy="53" r=".5"/></g>`,
  pencils: () => `<path d="M82 52.6V45l1.2-1.6L84.4 45v7.6" fill="#ffd23f"/><path d="M85 52.6V46.4l1.1-1.5 1.1 1.5v6.2" fill="#4cc3ff"/><path d="M79.6 52.6V47.6l1-1.4 1 1.4v5" fill="#ff7a6b"/><rect x="79" y="52.4" width="9.4" height="9.8" rx="1.4" fill="#5b6fd6"/>`,
  jar: () => `<rect x="79.6" y="53" width="9" height="9.2" rx="2.2" fill="#d6f2ff" opacity=".7"/><rect x="80.4" y="51.6" width="7.4" height="2" rx="1" fill="#a7c0cc"/>${[-40, 0, 40, -80, 80].map((r) => `<ellipse cx="84.1" cy="53" rx="1.6" ry="3.4" fill="#5fbf86" transform="rotate(${r} 84.1 56)"/>`).join('')}`,
  notes: () => `<rect x="79" y="55.6" width="9" height="6.6" rx=".6" fill="#ffe27a" transform="rotate(-6 83 59)"/><rect x="79.6" y="55" width="9" height="6.6" rx=".6" fill="#ff9bc2" transform="rotate(5 84 58)"/><path d="M81.4 57.4h5M81.4 59.2h3.4" stroke="#c45a86" stroke-width=".6" transform="rotate(5 84 58)"/>`,
  clock: () => `<circle cx="84" cy="55.4" r="6" fill="#ff7a6b"/><circle cx="84" cy="55.4" r="4.6" fill="#fffaf0"/><path d="M84 55.4V52.4M84 55.4l2 1.4" stroke="${DARK}" stroke-width=".8" stroke-linecap="round"/><path d="M80.6 61.6l1-1.6M87.4 61.6l-1-1.6" stroke="${DARK}" stroke-width="1"/>`,
};
const HUES = [0, 35, 150, 200, 280, 320];
const ACOL = ['#ff7a6b', '#4cc3ff', '#ffd23f', '#7c8cff', '#5fd6a0', '#ff9bc2'];

// Paw colour for typing hands, per character.
const PAW = { Puff: '#f58a74', Sprig: '#e9a52a', Wisp: '#e8e1ff', Gloop: '#5fcf55', Cap: '#f1dcc0', Tama: '#ff7fa8', Vee: '#e6e9f3', Smudge: '#4a3a78', Nimbus: '#dfeaff', Nori: '#f4f2ea',
  Mallow: '#ffd6e6', Bao: '#efd9bb', Pebble: '#9a9eae', Boba: '#e2bf92', Wick: '#f1dcb4', Bumble: '#3a3040', Pip: '#4f5f80', Acorn: '#b9773d', Jelly: '#c9a8ff', Toast: '#c98a4b' };
const LOOKS = CHARS.map((c) => c.name);

function avatarSVG(p, o, uid = '') {   // uid keeps SVG ids unique per instance: duplicate ids make gradients vanish when the first copy is hidden
  MODE = o ? { working: !!o.working, done: !!o.done, speaking: o.m > 0, mopen: o.m === 2 } : null; FACE = p.face;
  const c = CHARS[p.char], room = ROOMS[p.room], fit = FIT[c.name], u = uid + 'a';
  const art = c.svg(u), cut = art.indexOf('<g class="face">'), body = cut < 0 ? art : art.slice(0, cut), rest = cut < 0 ? '' : art.slice(cut);
  const hue = p.hue ? `<filter id="${u}h"><feColorMatrix type="hueRotate" values="${p.hue}"/></filter>` : '';
  const paw = p.hue ? mix(PAW[c.name], '#888888', .1) : PAW[c.name], d0 = -((hash(p.id) % 45) / 10);
  const laptop = `<rect x="35" y="49" width="30" height="15" rx="2.6" fill="#e7eaf3"/><rect x="35" y="49" width="30" height="2" rx="1" fill="#fff" opacity=".7"/>${star(57.5, 56, 2.6, '#ffb347')}<circle cx="43" cy="58.5" r="2" fill="#7c8cff"/>`;
  const hands = `<ellipse class="hand l" cx="40.5" cy="49.4" rx="3.2" ry="2.3" fill="${paw}"/><ellipse class="hand r" cx="59.5" cy="49.4" rx="3.2" ry="2.3" fill="${paw}"/>`;
  const sparks = `${star(20, 22, 3, '#ffe58a')}${star(80, 18, 2.4, '#ff9bc2')}${star(74, 40, 1.8, '#9be7ff')}<g opacity=".9"><rect x="26" y="12" width="2.2" height="1.2" rx=".4" fill="#5fd6a0" transform="rotate(30 27 12.6)"/><rect x="66" y="10" width="2.2" height="1.2" rx=".4" fill="#ffb347" transform="rotate(-20 67 10.6)"/><rect x="30" y="38" width="2" height="1.1" rx=".4" fill="#7c8cff" transform="rotate(50 31 38.5)"/></g>`;
  const out = `<svg viewBox="0 0 100 75" preserveAspectRatio="xMidYMid slice"${o ? ' xmlns="http://www.w3.org/2000/svg" width="400" height="300"' : ''}>
    <defs>${g(u + 't', room.table[0], room.table[1])}${hue}</defs>${room.svg(u + 'r')}
    <g class="fig${c.float ? ' float' : ''}" style="--d:${d0}s"><g transform="translate(50 64) scale(${c.scale || 1.2}) translate(-50 -64)">
      <g${p.hue ? ` filter="url(#${u}h)"` : ''}>${body}</g>${rest}${p.acc ? ACCS[p.acc](fit, p.accCol) : ''}</g></g>
    <path d="M-2 75V63Q50 57 102 63V75Z" fill="url(#${u}t)"/><path d="M-2 63Q50 57 102 63" fill="none" stroke="#fff" stroke-width=".8" opacity=".45"/>
    <ellipse cx="50" cy="64.5" rx="17" ry="1.6" fill="#000" opacity=".12"/>${p.decor ? DECOR[p.decor]() : ''}
    ${V('laptop', MODE && MODE.working, laptop)}${V('hands', MODE && MODE.working, hands)}${V('sparks', MODE && MODE.done, `<g class="sparks">${sparks}</g>`)}
  </svg>`;
  MODE = null; return out;
}

// A squiggle's look. look (a character name) and lookSeed (any number) can be set per squiggle; otherwise both come from its id.
// The lead, unless given a seed, is Puff in headphones on the rooftop.
function persona(s) {
  const h = hash(s.id), seed = s.lookSeed != null && s.lookSeed !== '' ? Number(s.lookSeed) : h;
  let v = (seed >>> 0) || 1; const r = () => { v ^= v << 13; v >>>= 0; v ^= v >>> 17; v ^= v << 5; v >>>= 0; return v / 4294967296; };
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  let char = LOOKS.indexOf(s.look); if (char < 0) char = s.lead ? 0 : (h >>> 7) % CHARS.length;
  const base = { id: s.id, name: s.name, role: s.role, lead: !!s.lead, gid: s.lead ? 'lead' : h.toString(36), char };
  if (s.lead && base.gid === 'lead' && s.lookSeed == null && !s.look) return { ...base, face: { eyes: 0, mouth: 0, cheeks: 0 }, hue: 0, acc: 'headphones', accCol: '#f5c04a', decor: 'clock', room: 1 };
  r(); r();
  return { ...base, face: { eyes: Math.floor(r() * 5), mouth: Math.floor(r() * 4), cheeks: Math.floor(r() * 4) },
    hue: r() < .4 ? 0 : pick(HUES), acc: r() < .7 ? pick(FIT[CHARS[char].name].ok.split(' ')) : null, accCol: pick(ACOL),
    decor: r() < .8 ? pick(Object.keys(DECOR)) : null, room: Math.floor(r() * ROOMS.length) };
}
return { hash, PAL, mix, avatarSVG, persona, LOOKS };
})();

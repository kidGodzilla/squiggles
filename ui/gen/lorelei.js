// Lorelei generator: Lisa Wischofsky's CC0 art via DiceBear's parts (ui/gen/lorelei-parts.js), drawn into the room's scene.
// look lorelei[:<hair>|k=v,...]; anything not set comes from the seed. Live renders carry the blink, brow, talk and done layers.
(() => {
  const P = DICEBEAR.lorelei, { V } = KIT, keys = (o) => Object.keys(o), none = (g) => ['none', ...keys(P[g])];
  const HAIR = ['000000', '2c1b18', '4a312c', '724133', 'a55728', 'b58143', 'd6b370', 'c93305', 'f59797', 'e8e1e1'];
  const SKIN = ['ffffff', 'ffdbb4', 'f8d25c', 'edb98a', 'd08b5b', 'ae5d29'];
  const CLOTHES = ['5b7cfa', 'e0607e', '3fb68b', 'f2a541', '8e6cd8', '2f3a56', 'e8e1d4', 'c94f3d'];
  const options = { hair: keys(P.hair), hairColor: HAIR, skinColor: SKIN, clothesColor: CLOTHES, head: keys(P.head), eyes: keys(P.eyes), eyebrows: keys(P.eyebrows), mouth: keys(P.mouth), nose: keys(P.nose),
    glasses: none('glasses'), earrings: none('earrings'), beard: none('beard'), freckles: none('freckles'), hairAccessories: none('hairAccessories') };
  const HAPPY = options.mouth.filter((m) => m.startsWith('happy'));   // seeded picks smile; sad mouths stay pickable
  function persona(s, opts = {}) {
    const h = KIT.hash(s.id), r = KIT.rng(KIT.seed(s)), pick = (xs) => xs[Math.floor(r() * xs.length)], maybe = (g, n) => (r() < n ? pick(keys(P[g])) : 'none');
    r(); r();
    const seeded = {
      hair: pick(options.hair), hairColor: pick(HAIR), skinColor: pick(SKIN), clothesColor: CLOTHES[KIT.hash(s.id + 'c') % CLOTHES.length], head: pick(options.head), eyes: pick(options.eyes), eyebrows: pick(options.eyebrows),
      mouth: pick(HAPPY), nose: pick(options.nose), glasses: maybe('glasses', .1), earrings: maybe('earrings', .1), beard: maybe('beard', .05),
      freckles: maybe('freckles', .05), hairAccessories: maybe('hairAccessories', .05),
    };
    return { id: s.id, name: s.name, role: s.role, lead: !!s.lead, gid: s.lead ? 'lead' : h.toString(36),
      a: { ...seeded, ...opts }, room: Math.floor(r() * KIT.rooms), decor: r() < .8 ? pick(KIT.decor) : null };
  }
  const S = .072, TX = 50 - 490 * S, TY = 6 - 80 * S;   // 980 square, head and neck only: no desk, hair near the top, a drawn shirt below
  function render(p, o, uid = '') {
    const M = KIT.mode(o), a = p.a, u = uid + 'v', c = (x) => '#' + x;
    const colors = { hair: c(a.hairColor), skin: c(a.skinColor), earrings: '#000', eyebrows: '#000', eyes: '#000', freckles: '#000', glasses: '#000', mouth: '#000', nose: '#000', hairAccessories: '#000' };
    if (a.beard !== 'none' && colors.hair === colors.mouth) colors.mouth = '#ffffff';
    const part = (g, k) => (P[g][k] ? { value: P[g][k] } : undefined);
    // room.js sizes .mouthE in room units (rx ~4.6), so undo the art's scale around it.
    const talk = `<g transform="translate(490 640) scale(${.7 / S})"><ellipse class="mouthE" cx="0" cy="0" rx="${M && M.mopen ? 4 : 4.6}" ry="${M && M.mopen ? 4.4 : .9}" fill="#000" fill-opacity=".75"${a.beard !== 'none' ? ' stroke="#fff" stroke-width=".7"' : ''}/></g>`;
    const comps = {
      head: part('head', a.head), nose: part('nose', a.nose), glasses: part('glasses', a.glasses), earrings: part('earrings', a.earrings), beard: part('beard', a.beard),
      freckles: part('freckles', a.freckles), hairAccessories: part('hairAccessories', a.hairAccessories),
      eyes: { value: (k, col) => `<g class="eye">${P.eyes[a.eyes](k, col)}</g>` },
      eyebrows: { value: (k, col) => `<g class="brow">${P.eyebrows[a.eyebrows](k, col)}</g>` },
      mouth: { value: (k, col) => V('smile', M ? !M.speaking && !M.done : true, P.mouth[a.mouth](k, col)) + V('grin', M && M.done && !M.speaking, P.mouth.happy01(k, col)) + (a.beard === 'none' ? V('mouth', M && M.speaking, talk) : '') },
    };
    const at = (s) => `<g transform="translate(10 -60)">${s}</g>`;
    // A beard is drawn over the mouth, so a bearded talk mouth goes on top.
    const bust = at(P.hair[a.hair](comps, colors)) + (comps.hairAccessories ? at(P.hairAccessories[a.hairAccessories](comps, colors)) : '') + (a.beard !== 'none' ? at(V('mouth', M && M.speaking, talk)) : '');
    // The art is head and neck only, so a shirt goes under the neck instead of a desk.
    // Heads 03 and 04 have longer necks (bottom ~68.4 vs ~66.3 in room units), so their shoulders sit lower.
    const drop = { variant03: 2.1, variant04: 2.2 }[a.head] || 0;
    const torso = `<path transform="translate(0 ${drop})" d="M12 77L14.5 67Q17 60.5 29 58.2L39.5 56.4Q50 60.5 60.5 56.4L71 58.2Q83 60.5 85.5 67L88 77Z" fill="${c(a.clothesColor || CLOTHES[0])}" stroke="#000" stroke-width=".9" stroke-linejoin="round"/>`;
    const fig = torso + `<g transform="translate(${TX} ${TY}) scale(${S})">${bust.replace(/(id="|url\(#)/g, `$1${u}`)}</g>`;
    const out = KIT.scene(p, o, u, fig, { paw: colors.skin, desk: false });
    KIT.mode(null); return out;
  }
  GENS.lorelei = { id: 'lorelei', name: 'Lorelei', options, persona, render };
})();

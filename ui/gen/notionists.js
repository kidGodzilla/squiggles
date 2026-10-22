// Notionists generator: Zoish's CC0 line art via DiceBear's parts (ui/gen/notionists-parts.js), drawn into the room's scene.
// look notionists[:<hair>|k=v,...]; anything not set comes from the seed. Live renders carry the blink, brow, talk and done layers.
(() => {
  const P = DICEBEAR.notionists, { V } = KIT, keys = (o) => Object.keys(o), none = (g) => ['none', ...keys(P[g])];
  const options = { hair: keys(P.hair), body: keys(P.body), bodyIcon: none('bodyIcon'), brows: keys(P.brows), eyes: keys(P.eyes), lips: keys(P.lips), nose: keys(P.nose), beard: none('beard'), glasses: none('glasses'), gesture: none('gesture') };
  function persona(s, opts = {}) {
    const h = KIT.hash(s.id), r = KIT.rng(KIT.seed(s)), pick = (xs) => xs[Math.floor(r() * xs.length)];
    r(); r();
    const seeded = {
      hair: pick(options.hair), body: pick(options.body), bodyIcon: r() < .75 ? pick(keys(P.bodyIcon)) : 'none', brows: pick(options.brows), eyes: pick(options.eyes),
      lips: pick(options.lips), nose: pick(options.nose), beard: r() < .1 ? pick(keys(P.beard)) : 'none', glasses: r() < .2 ? pick(keys(P.glasses)) : 'none', gesture: 'none',
    };
    return { id: s.id, name: s.name, role: s.role, lead: !!s.lead, gid: s.lead ? 'lead' : h.toString(36),
      a: { ...seeded, ...opts }, room: Math.floor(r() * KIT.rooms), decor: r() < .8 ? pick(KIT.decor) : null };
  }
  const S = .036, TX = 50 - 872 * S, TY = 66 - 1460 * S;   // 1744 square, head centred, chest behind the desk
  function render(p, o, uid = '') {
    const M = KIT.mode(o), a = p.a, u = uid + 'v';
    const part = (g, k) => (P[g][k] ? { value: P[g][k] } : undefined), comps = { bodyIcon: part('bodyIcon', a.bodyIcon) }, at = (x, y, s) => `<g transform="translate(${x} ${y})">${s}</g>`;
    const lips = P.lips[a.lips](comps, {});
    // room.js sizes .mouthE in room units (rx ~4.6), so undo the art's scale around it.
    const talk = `<g transform="translate(80 45) scale(${.7 / S})"><ellipse class="mouthE" cx="0" cy="0" rx="${M && M.mopen ? 4 : 4.6}" ry="${M && M.mopen ? 4.4 : .9}" fill="#000" fill-opacity=".75"/></g>`;
    const bust = at(531, 487, P.base.variant01(comps, {})) + at(178, 1057, P.body[a.body](comps, {})) + at(266, 207, P.hair[a.hair](comps, {}))
      + at(791, 871, V('smile', M ? !M.speaking && !M.done : true, lips) + V('grin', M && M.done && !M.speaking, lips) + V('mouth', M && M.speaking, talk))
      + (P.beard[a.beard] ? at(653, 805, P.beard[a.beard](comps, {})) : '') + at(901, 668, P.nose[a.nose](comps, {}))
      + at(610, 680, `<g class="eye">${P.eyes[a.eyes](comps, {})}</g>`) + (P.glasses[a.glasses] ? at(610, 680, P.glasses[a.glasses](comps, {})) : '')
      + at(774, 657, `<g class="brow">${P.brows[a.brows](comps, {})}</g>`) + (P.gesture[a.gesture] ? at(0, 559, P.gesture[a.gesture](comps, {})) : '');
    const fig = `<g transform="translate(${TX} ${TY}) scale(${S})">${bust.replace(/(id="|url\(#)/g, `$1${u}`)}</g>`;
    const out = KIT.scene(p, o, u, fig, { paw: '#fff' });
    KIT.mode(null); return out;
  }
  GENS.notionists = { id: 'notionists', name: 'Notionists', options, persona, render };
})();

// Avataaars generator (t833): Pablo Stanley's art via DiceBear's parts (ui/gen/avataaars-parts.js), drawn into the room's scene.
// look avataaars[:<top>|k=v,...]; anything not set comes from the seed. Live renders carry the blink, brow, talk and done layers.
(() => {
  const P = DICEBEAR.avataaars, { V } = KIT, keys = (o) => Object.keys(o);
  const HAIR = ['a55728', '2c1b18', 'b58143', 'd6b370', '724133', '4a312c', 'f59797', 'ecdcbf', 'c93305', 'e8e1e1'];
  const CLOTH = ['262e33', '65c9ff', '5199e4', '25557c', 'e6e6e6', '929598', '3c4f5c', 'b1e2ff', 'a7ffc4', 'ffdeb5', 'ffafb9', 'ffffb1', 'ff488e', 'ff5c5c', 'ffffff'];
  const SKIN = ['614335', 'd08b5b', 'ae5d29', 'edb98a', 'ffdbb4', 'fd9841', 'f8d25c'];
  const options = {
    top: keys(P.top), hairColor: HAIR, hatColor: CLOTH, clothing: keys(P.clothing), clothesColor: CLOTH, clothingGraphic: keys(P.clothingGraphic),
    skinColor: SKIN, eyes: keys(P.eyes), eyebrows: keys(P.eyebrows), mouth: keys(P.mouth),
    accessories: ['none', ...keys(P.accessories)], accessoriesColor: CLOTH, facialHair: ['none', ...keys(P.facialHair)], facialHairColor: HAIR,
  };
  // Seeded picks stay friendly: no crying, dizzy or vomiting faces, and closed eyes would fight the blink.
  const SEEDED = {
    eyes: ['default', 'happy', 'side', 'squint', 'wink', 'surprised'], mouth: ['default', 'smile', 'twinkle', 'serious', 'tongue'],
    eyebrows: ['default', 'defaultNatural', 'flatNatural', 'raisedExcited', 'raisedExcitedNatural', 'upDown', 'upDownNatural'],
  };
  function persona(s, opts = {}) {
    const h = KIT.hash(s.id), r = KIT.rng(KIT.seed(s)), pick = (xs) => xs[Math.floor(r() * xs.length)];
    r(); r();
    const seeded = {
      top: pick(options.top), hairColor: pick(HAIR), hatColor: pick(CLOTH), clothing: pick(options.clothing), clothesColor: pick(CLOTH),
      clothingGraphic: pick(options.clothingGraphic), skinColor: pick(SKIN), eyes: pick(SEEDED.eyes), eyebrows: pick(SEEDED.eyebrows), mouth: pick(SEEDED.mouth),
      accessories: r() < .15 ? pick(keys(P.accessories).filter((a) => a !== 'eyepatch')) : 'none', accessoriesColor: pick(CLOTH),
      facialHair: r() < .12 ? pick(keys(P.facialHair)) : 'none', facialHairColor: pick(HAIR),
    };
    if (seeded.top === 'hijab') seeded.facialHair = 'none';
    return { id: s.id, name: s.name, role: s.role, lead: !!s.lead, gid: s.lead ? 'lead' : h.toString(36),
      a: { ...seeded, ...opts }, room: Math.floor(r() * KIT.rooms), decor: r() < .8 ? pick(KIT.decor) : null };
  }
  const S = .2, TX = 50 - 140 * S, TY = 63 - 280 * S;   // 280x280 bust, centred, shoulders behind the desk
  function render(p, o, uid = '') {
    const M = KIT.mode(o), a = p.a, u = uid + 'v', c = (x) => '#' + x;
    const colors = { hair: c(a.hairColor), hat: c(a.hatColor), clothes: c(a.clothesColor), skin: c(a.skinColor), accessories: c(a.accessoriesColor), facialHair: c(a.facialHairColor) };
    const part = (g, k) => (P[g][k] ? { value: P[g][k] } : undefined);
    const talk = `<g transform="translate(54 17) scale(3.4)"><ellipse class="mouthE" cx="0" cy="0" rx="${M && M.mopen ? 4 : 4.6}" ry="${M && M.mopen ? 4.4 : .9}" fill="#000" fill-opacity=".7"/></g>`;
    const comps = {
      clothing: part('clothing', a.clothing), clothingGraphic: part('clothingGraphic', a.clothingGraphic), nose: part('nose', 'default'),
      top: part('top', a.top), facialHair: part('facialHair', a.facialHair), accessories: part('accessories', a.accessories),
      eyes: { value: (k, col) => `<g class="eye">${P.eyes[a.eyes](k, col)}</g>` },
      eyebrows: { value: (k, col) => `<g class="brow">${P.eyebrows[a.eyebrows](k, col)}</g>` },
      mouth: { value: (k, col) => V('smile', M ? !M.speaking && !M.done : true, P.mouth[a.mouth](k, col)) + V('grin', M && M.done && !M.speaking, P.mouth.smile(k, col)) + V('mouth', M && M.speaking, talk) },
    };
    const bust = P.base.default(comps, colors).replace(/(id="|url\(#)(accessories\w+-)/g, `$1${u}$2`);
    const fig = `<g transform="translate(${TX} ${TY}) scale(${S}) translate(8)">${bust}</g>`;
    const out = KIT.scene(p, o, u, fig, { paw: colors.skin });
    KIT.mode(null); return out;
  }
  GENS.avataaars = { id: 'avataaars', name: 'Avataaars', options, persona, render };
})();

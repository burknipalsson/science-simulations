// Camera path: smooth (no jumps on screen), orthonormal, and the landing site ends dead centre.
global.PTEN = require('./scale.js'); global.PTEN_PERSON = require('./person.js'); require('./site_data.js'); require('./inner.js');
const Z = require('./zoom.js'), S = global.PTEN;
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
// track screen positions of several anchors through the whole zoom
const anchors = [['site', [0, 0, 0]], ['earth', [0, 0, 0]], ['sol', [0, 0, 0]], ['gc', [0, 0, 0]], ['person', [0, 0, 1]], ['hand', [0, 0, 0]], ['nail', [0, 0, 0]], ['cap', [0, 0, 0]], ['tube', [0, 0, 0]], ['rbc', [0, 0, 0]], ['mem', [0, 0, 0]], ['hb', [0, 0, 0]], ['mol', [0, 0, 0]], ['proton', [0, 0, 0]]];
let prev = null, maxJump = 0, worst = '', orthoErr = 0;
for (let L = 25.2; L >= -14.6; L -= 0.002) {
  const cam = Z.camera(L);
  const R = cam.R; const RtR = S.mul(S.T(R), R);
  orthoErr = Math.max(orthoErr, ...RtR.map((x, i) => Math.abs(x - ([0, 4, 8].includes(i) ? 1 : 0))));
  const cur = anchors.map(([f, o]) => Z.place(cam, f, o).off);
  if (prev) cur.forEach((o, k) => {
    // only anchors near the view matter (|off| < 2 view widths)
    if (Math.hypot(...o) < 2 && Math.hypot(...prev[k]) < 2) {
      const j = Math.hypot(o[0] - prev[k][0], o[1] - prev[k][1], o[2] - prev[k][2]);
      if (j > maxJump) { maxJump = j; worst = `${anchors[k][0]} at L=${L.toFixed(3)}`; }
    }
  });
  prev = cur;
}
ok(orthoErr < 1e-9, `camera basis orthonormal (max err ${orthoErr.toExponential(1)})`);
ok(maxJump < 0.02, `largest on-screen step per 0.002 dex: ${maxJump.toFixed(4)} view widths (${worst})`);
const end = Z.place(Z.camera(3.0), 'site', [0, 0, 0]).off;
ok(Math.hypot(...end) < 1e-9, `site centred at 1 km view (${Math.hypot(...end).toExponential(1)})`);
// every inner rung lands exactly on its target, however deep the frame chain
for (const w of Z.path.filter(w => w.L < 3)) {
  const c = Z.camera(w.L), o = Z.place(c, w.frame, w.pos()).off;
  ok(Math.hypot(...o) < 1e-9, `${w.name} centred at L=${w.L} (${Math.hypot(...o).toExponential(1)} view widths)`);
}
// the proton is where the hydrogen nucleus is: 0.9572 Å from the oxygen, 41 powers of ten below the cosmic web
const S2 = global.PTEN, I = global.PTEN_INNER, dOH = S2.rel(I.H_BODY.O, 'mol', [0, 0, 0], 'proton', 'mol');
ok(Math.abs(Math.hypot(...dOH) - 0.9572e-10) < 1e-16, `O-H distance through the frame chain ${(Math.hypot(...dOH) * 1e10).toFixed(6)} Å`);
const e = Z.place(Z.camera(7.3), 'earth', [0, 0, 0]).off;
ok(Math.hypot(e[0], e[1]) < 1e-9, 'Earth centred at L=7.3');
// at L = 7.3 we look straight down on Reykjavik: the site lies on the camera axis toward the eye
const s = Z.place(Z.camera(7.3), 'site', [0, 0, 0]).off;
// the geodetic vertical misses the centre by ~0.19 deg at 64 N (oblate Earth): ~21 km = 1e-3 widths
ok(Math.hypot(s[0], s[1]) < 1.5e-3 && s[2] > 0, `Reykjavik at the disc centre, facing us (z=${s[2].toFixed(4)} widths)`);
// HUD text
for (const L of [25, 22.4, 20, 16, 13, 9, 7, 5, 3, 0, -5, -10]) console.log(`  L=${L}: ${Z.human(10 ** L)} | ${Z.familiar(10 ** L) || '—'}`);
console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);

// Side trip checks: S2's pericentre (GRAVITY observed it in May 2018: 2018.38), its distance there (~120 AU),
// the sky-frame axes (orthonormal, east x north = away), and the black hole's size against EHT's ring.
global.PTEN = require('./scale.js');
const G = require('./sgr.js'), S = global.PTEN;
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
const k2 = G.STARS.findIndex(r => r[0] === 'S2');
let best = 1e30, tb = 0; for (let t = 2017; t < 2020; t += 0.0005) { const p = G.pos(k2, t), r = Math.hypot(...p); if (r < best) { best = r; tb = t; } }
ok(Math.abs(tb - 2018.38) < 0.06, `S2 pericentre at ${tb.toFixed(3)} (observed 2018.38)`);
ok(Math.abs(best / S.AU - 120) < 6, `S2 pericentre distance ${(best / S.AU).toFixed(1)} AU (GRAVITY: ~120 AU)`);
const { ex, ny, sz } = G.frame, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cr = [ex[1] * ny[2] - ex[2] * ny[1], ex[2] * ny[0] - ex[0] * ny[2], ex[0] * ny[1] - ex[1] * ny[0]];
ok(Math.abs(dot(ex, ny)) < 1e-9 && Math.abs(dot(cr, sz) - 1) < 1e-9, 'east, north, away form a right-handed orthonormal frame (to the 10 digits of the Hipparcos matrix)');
ok(Math.abs(dot(sz, [1, 0, 0]) - Math.cos(0.0461 * Math.PI / 180) * Math.cos(-0.0461 * Math.PI / 180)) < 1e-3, `Sgr A* lies along the Galactic-centre direction (cos ${dot(sz, [1, 0, 0]).toFixed(6)})`);
const shadow = 2 * Math.sqrt(27) / 2 * G.RS, mu = shadow / S.R0 * 206264.806e6;
ok(Math.abs(mu - 51.8) < 3, `shadow diameter ${(shadow / 1e9).toFixed(1)} million km = ${mu.toFixed(1)} µas (EHT 2022 ring: 51.8 ± 2.3 µas)`);
console.log(`  S2 today (${G.YEAR0.toFixed(3)}): ${(Math.hypot(...G.pos(k2, G.YEAR0)) / S.AU).toFixed(0)} AU from Sgr A*; Rs = ${(G.RS / 1e9).toFixed(2)} million km`);
console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);

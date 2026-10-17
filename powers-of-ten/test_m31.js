// Time trip checks: the semi-analytic orbit (Hernquist haloes + Chandrasekhar friction, lnL = 1) against van der
// Marel et al. 2012 (ApJ 753, 9) N-body results for their inputs (v_tan 17 km/s): first pericentre 3.87 +0.42/-0.32
// Gyr, merger 5.86 +1.61/-0.72 Gyr. Then the page's case (Gaia v_tan 57 km/s, van der Marel 2019).
global.PTEN = require('./scale.js');
const M = require('./m31.js');
let fail = 0; const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
// merger: the centres come within 15 kpc and stay there
function events(o) { let prev = 1e9, dec = false; const peri = []; let lastOut = 0;
  for (const p of o) { const r = Math.hypot(p[1], p[2], p[3]); if (r > prev && dec) peri.push([p[0], prev]); dec = r < prev; prev = r; if (r >= 15) lastOut = p[0]; }
  return { peri, merge: lastOut < o[o.length - 1][0] - 0.5 ? lastOut : null }; }
const a = events(M.orbit(1, 12.5, 17));
ok(a.peri[0][0] > 3.87 - 0.32 && a.peri[0][0] < 3.87 + 0.42, `v_tan 17 km/s: first pericentre ${a.peri[0][0].toFixed(2)} Gyr at ${a.peri[0][1].toFixed(0)} kpc (vdM 2012 N-body: 3.87 +0.42/-0.32 Gyr)`);
ok(a.merge > 5.86 - 0.72 && a.merge < 5.86 + 1.61, `v_tan 17 km/s: merged (r < 15 kpc) at ${a.merge.toFixed(2)} Gyr (vdM 2012: 5.86 +1.61/-0.72 Gyr)`);
const b = events(M.orbit(1, 12.5, 57));
console.log(`  page case, v_tan 57 km/s: first pericentre ${b.peri[0][0].toFixed(2)} Gyr at ${b.peri[0][1].toFixed(0)} kpc; merged at ${b.merge ? b.merge.toFixed(2) + ' Gyr' : 'not within 12.5 Gyr'}`);
const c = events(M.orbit(1, 12.5, 92));
console.log(`  upper error bar, 92 km/s: first pericentre ${c.peri[0][0].toFixed(2)} Gyr at ${c.peri[0][1].toFixed(0)} kpc; merged at ${c.merge ? c.merge.toFixed(2) + ' Gyr' : 'not within 12.5 Gyr'}`);
console.log(fail ? `${fail} FAILED` : 'all passed'); process.exit(fail ? 1 : 0);

// The arm model must reproduce Reid et al. 2019's fitted tangent longitudes (their Table 2 column 3)
global.PTEN_DATA = undefined;
const G = require('./galaxy.js');
const data = require('fs').readFileSync('./data.js', 'utf8'); eval(data); const arms = globalThis.PTEN_DATA.arms;
let fail = 0;
const want = { '3-kpc': 337.0, 'Norma': 327.5, 'Scutum–Centaurus': 306.1, 'Sagittarius–Carina': 285.6 };
for (const a of arms) if (want[a.n]) {
  const t = G.tangency(a); const ok = Math.abs(t - want[a.n]) < 1.0; if (!ok) fail++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${a.n} tangent l = ${t.toFixed(2)} (Reid ${want[a.n]})`);
}
// the Sun lies in the Local arm's spread: distance from the Local arm centreline at the Sun's azimuth
const loc = arms.find(a => a.n === 'Local'); const dR = G.armR(loc, 0) - G.R0;
// Reid: the Sun lies near the inner edge of the Local arm (centreline ~0.4 kpc outside, Gaussian width 0.31 kpc)
const okL = dR > 0 && dR < 0.5; if (!okL) fail++;
console.log(`${okL ? 'ok  ' : 'FAIL'} Local arm centreline ${dR.toFixed(2)} kpc outside the Sun (width ${loc.w}): Sun on its inner edge`);
// rotation: Sun's galactic year
const yr = 2 * Math.PI / G.omega(8.178); console.log(`     galactic year at the Sun: ${yr.toFixed(0)} Myr`);
const P = G.build(arms, 300000); console.log(`     built ${P.n} particles`);
process.exit(fail ? 1 : 0);

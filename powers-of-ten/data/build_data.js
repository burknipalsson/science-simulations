// Pack real catalogues into data.js for the page. Positions are converted to galactocentric
// Galactic-axis coordinates (the 'gc' frame of scale.js): kpc for galaxies and clusters, pc for stars.
const fs = require('fs'), S = require('../scale.js');
function csv(file) {
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n');
  const split = l => { const o = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { o.push(cur); cur = ''; } else cur += ch; } o.push(cur); return o; };
  const head = split(lines[0]);
  return lines.slice(1).map(l => { const v = split(l), r = {}; head.forEach((h, i) => r[h] = v[i]); return r; });
}
const r3 = x => Math.round(x * 1000) / 1000;
const gcOf = (ra, dec, dKpc) => { const v = S.fromEq(ra, dec, dKpc); return [v[0] + S.SUN_GC[0] / S.KPC, v[1], v[2] + S.SUN_GC[2] / S.KPC].map(r3); };

// ---- galaxies: Local Volume Database (Pace 2024) dwarfs within 4 Mpc, plus the large galaxies it omits ----
const gal = [];
for (const r of csv('dl/lg/dwarf_all.csv')) {
  const mu = +r.distance_modulus; if (!isFinite(mu) || r.confirmed_galaxy === '0') continue;
  const d = Math.pow(10, mu / 5 + 1) / 1e3; if (d > 4000) continue;            // kpc
  const mv = isFinite(+r.apparent_magnitude_v) && r.apparent_magnitude_v !== '' ? +r.apparent_magnitude_v - mu : null;
  const rh = r.rhalf ? +r.rhalf / 60 * Math.PI / 180 * d * 1e3 : null;         // arcmin -> pc
  gal.push({ n: r.name, p: gcOf(+r.ra, +r.dec, d), mv: mv === null ? null : Math.round(mv * 10) / 10, rh: rh && Math.round(rh), host: r.host });
}
// large galaxies (RA, Dec deg; distance kpc; M_V; disc radius kpc); refs in refs.md
const BIG = [
  ['Andromeda (M31)', 10.68471, 41.26875, 765, -21.5, 30], ['Triangulum (M33)', 23.46208, 30.66017, 859, -18.8, 9],
  ['M32', 10.67427, 40.86517, 805, -16.4, 0.4], ['M81', 148.88822, 69.06529, 3630, -21.1, 13], ['M82', 148.96846, 69.67970, 3530, -19.6, 5],
  ['Centaurus A', 201.36506, -43.01911, 3800, -21.0, 12], ['NGC 253 (Sculptor)', 11.88800, -25.28822, 3500, -20.9, 13],
  ['IC 342', 56.70212, 68.09611, 3280, -21.0, 12], ['NGC 300', 13.72283, -37.68439, 2000, -18.1, 6], ['NGC 55', 3.72333, -39.19667, 2100, -18.4, 8],
  ['Maffei 1', 39.14762, 59.65494, 3300, -20.8, 6], ['M83', 204.25383, -29.86576, 4660, -20.5, 9]];
for (const [n, ra, dec, d, mv, R] of BIG) gal.push({ n, p: gcOf(ra, dec, d), mv, R, big: 1 });

// ---- Milky Way globular clusters (Harris 2010 via LVDB; Baumgardt distances) ----
const gcs = [];
for (const r of csv('dl/lg/gc_harris.csv')) { const mu = +r.distance_modulus; if (!isFinite(mu)) continue; gcs.push({ n: r.name, p: gcOf(+r.ra, +r.dec, Math.pow(10, mu / 5 + 1) / 1e3) }); }

// ---- stars: HYG v4.1 (Hipparcos + Yale + Gliese). All within 25 pc, plus luminous stars (M_V < -1) within 600 pc ----
const stars = [];
for (const r of csv('dl/hyg/hyg.csv')) {
  const d = +r.dist; if (!(d > 0) || d >= 100000) continue;
  if (!(d <= 25 || (+r.absmag < -1 && d < 600))) continue;
  const v = S.app(S.EQ2GAL, [+r.x, +r.y, +r.z]);                              // pc, heliocentric Galactic axes
  const vel = S.app(S.EQ2GAL, [+r.vx, +r.vy, +r.vz]).map(x => Math.round(x * 1e6 * 100) / 100); // pc per Myr (= 0.978 km/s)
  stars.push({ n: r.proper || '', p: v.map(x => Math.round(x * 1000) / 1000), v: vel, m: +(+r.absmag).toFixed(2), c: r.ci === '' ? 0.6 : +(+r.ci).toFixed(2), s: (r.spect || '').slice(0, 4) });
}
// ---- spiral arms: Reid et al. 2019 Table 2 (beta range deg, beta_kink, R_kink kpc, psi<, psi>, width kpc), R0 = 8.15 ----
const arms = [['3-kpc', 15, 18, 15, 3.52, -4.2, -4.2, 0.18], ['Norma', 5, 54, 18, 4.46, -1.0, 19.5, 0.14], ['Scutum–Centaurus', 0, 104, 23, 4.91, 14.1, 12.1, 0.23],
  ['Sagittarius–Carina', 2, 97, 24, 6.04, 17.1, 1.0, 0.27], ['Local', -8, 34, 9, 8.26, 11.4, 11.4, 0.31], ['Perseus', -23, 115, 40, 8.87, 10.3, 8.7, 0.35], ['Outer', -16, 71, 18, 12.24, 3.0, 9.4, 0.65]]
  .map(([n, b0, b1, bk, Rk, p1, p2, w]) => ({ n, b0, b1, bk, Rk, p1, p2, w }));

const H = JSON.parse(fs.readFileSync('horizons.json', 'utf8'));
const out = { horizons: H, galaxies: gal, globulars: gcs, stars, arms };
fs.writeFileSync('../data.js', 'globalThis.PTEN_DATA = ' + JSON.stringify(out) + ';\n');
console.log(`galaxies ${gal.length}, globulars ${gcs.length}, stars ${stars.length} (named ${stars.filter(s => s.n).length}), data.js ${(fs.statSync('../data.js').size / 1024).toFixed(0)} KB`);

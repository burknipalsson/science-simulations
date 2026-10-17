// Stability/behaviour test of planet presets, mirroring what the page sends
const { makeEarth, initState, gmean } = require('./earth.js');
const { loadState } = require('./climate.js');
const { applySurface } = require('./setup.js');
const fs = require('fs');
const name = process.argv[2], days = +process.argv[3] || 60;
const E = makeEarth(); const { md, ph, S } = E; const nG = md.nG, nlon = md.nlon;
initState(E, 0); loadState(E, 'data/state_sst.json');
ph.qfluxMon = JSON.parse(fs.readFileSync('data/qflux.json')).map(a => Float64Array.from(a)); ph.sstMode = false;
const surf = require('./data/surf_64.json');
const OMEGA_E = 360.98564736629 * Math.PI / 180 / 86400, NORB = 2 * Math.PI / (365.25636 * 86400);
const P = { md, ph, S };
function world(w) {
  const old = md.phisG.slice();
  if (w === 'aqua') { for (let j = 0; j < md.nlat; j++) { let s = 0, n = 0; for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (!ph.land[p]) { s += ph.Tml[p]; n++; } } const m = n ? s / n : 271.35; for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (ph.land[p]) { ph.Tml[p] = ph.Ts[p] = Math.max(m, 271.35); ph.hice[p] = 0; ph.snow[p] = 0; } } } }
  applySurface(P, surf, ph.qfluxMon, w);
  const lp = new Float64Array(nG);
  for (const c of [0, 1]) { S.toGrid(md.LP[c].re, md.LP[c].im, lp); for (let p = 0; p < nG; p++) lp[p] += (old[p] - md.phisG[p]) / (md.R * 275); S.toSpec(lp, md.LP[c].re, md.LP[c].im); }
}
const rot = (hours) => { ph.rotTarget = hours === 'lock' ? NORB : 2 * Math.PI / (hours * 3600); };
if (name === 'aqua') world('aqua');
if (name === 'flat') world('flat');
if (name === 'fast') rot(8);
if (name === 'fast6') rot(6);
if (name === 'slow') rot(240);
if (name === 'locked') rot('lock');
if (name === 'snowball') { ph.S0 = 1361 * 0.91; ph.mld = 8; }
if (name === 'snow88') { ph.S0 = 1361 * 0.88; ph.mld = 5; }
if (name === 'snow85') { ph.S0 = 1361 * 0.85; ph.mld = 5; }
if (name === 'hothouse') { ph.green = 1.9; ph.mld = 8; }
if (name === 'tilt90') ph.obl = 90;
const perDay = 86400 / md.dt;
for (let d = 1; d <= days; d++) {
  for (let s = 0; s < perDay; s++) md.step();
  let mx = 0; for (let q = 0; q < md.U.length; q++) mx = Math.max(mx, Math.abs(md.U[q] / Math.sqrt(md.cm[Math.floor((q % nG) / nlon)])));
  if (!isFinite(mx)) { console.log(name, 'BLOWUP day', d); process.exit(1); }
  if (d % 10 === 0 || d === days) {
    let ice = 0; for (let j = 0; j < md.nlat; j++) for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (ph.hice[p] > 0 || (ph.land[p] && ph.snow[p] > 5)) ice += S.w[j]; }
    console.log(`${name} day ${d}: Ts ${(gmean(E, ph.Ts) - 273.15).toFixed(1)}C P ${(gmean(E, ph.prec) * 86400).toFixed(2)} max|u| ${mx.toFixed(0)} ice/snow cover ${(ice / 2 * 100).toFixed(0)}%`);
  }
}

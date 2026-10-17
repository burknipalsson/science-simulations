// Nudged slab run: restore the ocean toward observed SST/sea ice and record the monthly restoring flux,
// which is added to the Q-flux (one-pass flux correction). usage: node run_nudge.js from qin qout tauDays
const { makeEarth, initState, gmean } = require('./earth.js');
const { saveState, loadState } = require('./climate.js');
const fs = require('fs');
const [from, qin, qout, tauD] = process.argv.slice(2);
const E = makeEarth(); const { md, ph, S } = E; const nG = md.nG, nlon = md.nlon;
initState(E, 0); loadState(E, from);
ph.qfluxMon = JSON.parse(fs.readFileSync(qin)).map(a => Float64Array.from(a));
ph.sstMode = false; ph._qday = -1; ph.nudgeTau = (+tauD || 30) * 86400;
const perDay = 86400 / md.dt, spin = 45, days = spin + 366;
const acc = Array.from({ length: 12 }, () => new Float64Array(nG)), n = new Float64Array(12);
const t0 = performance.now();
for (let d = 0; d < days; d++) {
  const doy = (ph.epoch - 9496.5 + md.time / 86400) % 365.2422;
  ph.setMonth(doy); // interpolated observed SST / ice targets
  ph.nudgeAcc.fill(0);
  for (let s = 0; s < perDay; s++) md.step();
  const m = Math.min(11, Math.floor(doy / 365.2422 * 12));
  if (d >= spin) { for (let p = 0; p < nG; p++) acc[m][p] += ph.nudgeAcc[p] / perDay; n[m]++; }
  if (d % 30 === 29) { let a0 = 0, a1 = 0; for (let j = 0; j < md.nlat; j++) for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (ph.hice[p] > 0) { if (S.mu[j] > 0) a0 += S.w[j]; else a1 += S.w[j]; } }
    console.log(`day ${d + 1} doy ${doy.toFixed(0)} Ts ${gmean(E, ph.Ts).toFixed(2)} iceN ${(a0 * 510.07 / (2 * nlon)).toFixed(1)} iceS ${(a1 * 510.07 / (2 * nlon)).toFixed(1)} ${((performance.now() - t0) / 60000).toFixed(1)} min`); }
}
const Q = ph.qfluxMon; let gm = 0, gw = 0;
for (let m = 0; m < 12; m++) for (let p = 0; p < nG; p++) if (!ph.land[p]) { const f = acc[m][p] / n[m]; Q[m][p] += f; gm += f * S.w[Math.floor(p / nlon)]; gw += S.w[Math.floor(p / nlon)]; }
console.log('mean restoring flux added', (gm / gw).toFixed(2), 'W/m2');
fs.writeFileSync(qout, JSON.stringify(Q.map(q => Array.from(q, x => Math.round(x * 10) / 10))));
saveState(E, 'data/state_nudge_end.json');
console.log('done');

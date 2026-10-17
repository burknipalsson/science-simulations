// Derive a monthly Q-flux: run with observed SST/sea ice and record the net surface heat flux into the ocean
const { makeEarth, initState, gmean } = require('./earth.js');
const { saveState } = require('./climate.js');
const fs = require('fs');
const E = makeEarth(); const { md, ph, S } = E; const nG = md.nG;
ph.sstMode = true;
const doy0 = 334; initState(E, doy0); ph.epoch += doy0;
const perDay = 86400 / md.dt, spin = 31, days = spin + 365;
const F = Array.from({ length: 12 }, () => new Float64Array(nG)), N = new Float64Array(12);
const Pm = new Float64Array(nG), Tsm = new Float64Array(nG), SLPm = Array.from({ length: 12 }, () => new Float64Array(nG)); let np = 0;
const t0 = performance.now();
for (let d = 0; d < days; d++) {
  const doy = (doy0 + d) % 365.2422; ph.setMonth(doy);
  const m = Math.min(11, Math.floor(doy / 365.2422 * 12));
  for (let s = 0; s < perDay; s++) {
    md.step();
    if (d >= spin) { const f = F[m]; for (let p = 0; p < nG; p++) f[p] += ph.netSfc[p]; N[m]++; for (let p = 0; p < nG; p++) { Pm[p] += ph.prec[p]; Tsm[p] += ph.Ts[p]; SLPm[m][p] += ph.slp[p]; } np++; }
  }
  if (d % 30 === 0) console.log(`day ${d} doy ${doy.toFixed(0)} Ts ${gmean(E, ph.Ts).toFixed(2)} P ${(gmean(E, ph.prec) * 86400).toFixed(2)} ${((performance.now() - t0) / 1000 / 60).toFixed(1)} min`);
}
const out = { N: Array.from(N), F: F.map((f, m) => Array.from(f, x => x / N[m])), P: Array.from(Pm, x => x / np * 86400), Ts: Array.from(Tsm, x => x / np), SLP: SLPm.map((f, m) => Array.from(f, x => x / N[m] / 100)) };
fs.writeFileSync('data/qflux_raw.json', JSON.stringify(out));
saveState(E, 'data/state_sst.json');
console.log('done');

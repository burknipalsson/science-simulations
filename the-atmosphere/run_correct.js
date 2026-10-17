// One (or more) year(s) of the slab model accumulating monthly effective ocean temperature
// (open water: mixed-layer temperature; ice: freezing point minus the latent-heat equivalent of the ice),
// then nudge the monthly Q-flux toward the observed seasonal cycle of SST and sea ice.
// usage: node run_correct.js fromState tag tauDays years qfluxIn qfluxOut
const { makeEarth, initState, gmean } = require('./earth.js');
const { saveState, loadState } = require('./climate.js');
const fs = require('fs');
const [from, tag, tauD, yrs, qin, qout] = process.argv.slice(2);
const tau = (+tauD || 90) * 86400, years = +yrs || 1;
const E = makeEarth(); const { md, ph, S } = E; const nG = md.nG, nlon = md.nlon;
initState(E, 0); loadState(E, from);
ph.qfluxMon = JSON.parse(fs.readFileSync(qin || 'data/qflux.json')).map(a => Float64Array.from(a));
ph.sstMode = false; ph._qday = -1;
const surf = require('./data/surf_64.json');
const C = 4.18e6 * ph.mld, eqv = 917 * 3.34e5 / C; // kelvin per metre of ice
const acc = Array.from({ length: 12 }, () => new Float64Array(nG)), n = new Float64Array(12);
const iceA = Array.from({ length: 12 }, () => [0, 0]);
const perDay = 86400 / md.dt, days = Math.round(365.2422 * years);
const saveDays = [0, 90, 181, 273], saved = {}; let lastDoy = -1;
const t0 = performance.now();
for (let d = 0; d < days; d++) {
  const lastYear0 = d >= days - 365;
  for (let s = 0; s < perDay; s++) {
    md.step();
    if (s === perDay / 2 - 1 && tag && lastYear0) { // save seasonal starting states at 12:00 UTC
      const dm = (ph.epoch - 9496.5 + md.time / 86400) % 365.2422;
      for (const sd of saveDays) if (Math.floor(dm) === sd && !saved[sd]) { saved[sd] = 1; saveState(E, `data/state_${tag}_${sd}.json`); console.log('saved', sd, 'at', (dm % 1 * 24).toFixed(1), 'UTC'); }
    }
  }
  const doy = (ph.epoch - 9496.5 + md.time / 86400) % 365.2422, m = Math.min(11, Math.floor(doy / 365.2422 * 12));
  const lastYear = d >= days - 365;
  let a0 = 0, a1 = 0;
  for (let j = 0; j < md.nlat; j++) for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (ph.hice[p] > 0) { if (S.mu[j] > 0) a0 += S.w[j]; else a1 += S.w[j]; } }
  const A0 = a0 * 510.07 / (2 * nlon), A1 = a1 * 510.07 / (2 * nlon);
  if (lastYear) {
    for (let p = 0; p < nG; p++) if (!ph.land[p]) acc[m][p] += ph.hice[p] > 0 ? 271.35 - ph.hice[p] * eqv : ph.Tml[p];
    n[m]++; iceA[m][0] += A0; iceA[m][1] += A1;
  }
  lastDoy = doy;
  if (d % 30 === 29) console.log(`day ${d + 1} doy ${doy.toFixed(0)} Ts ${gmean(E, ph.Ts).toFixed(2)} iceN ${A0.toFixed(1)} iceS ${A1.toFixed(1)} Mkm2 ${((performance.now() - t0) / 60000).toFixed(1)} min`);
}
const Q = ph.qfluxMon;
const obsIce = (m, p) => { const c = surf.sic[m][p]; return c > 0.5 ? 0.5 + 2 * (c - 0.5) * (Math.abs(S.lat[Math.floor(p / nlon)]) > 1.2 ? 2 : 1) : 0; };
let rms = 0, w = 0, bias = 0;
for (let m = 0; m < 12; m++) {
  if (!n[m]) continue;
  const dq = new Float64Array(nG);
  for (let p = 0; p < nG; p++) {
    if (ph.land[p]) continue;
    const Tm = acc[m][p] / n[m], hi = obsIce(m, p), To = hi > 0 ? 271.35 - hi * eqv : Math.max(surf.sst[m][p], 271.35);
    const dT = Math.max(-8, Math.min(8, Tm - To));
    dq[p] = -C * dT / tau;
    const ww = S.w[Math.floor(p / nlon)]; rms += ww * dT * dT; bias += ww * dT; w += ww;
  }
  for (let j = 0; j < md.nlat; j++) { const row = dq.slice(j * nlon, (j + 1) * nlon); for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (!ph.land[p]) Q[m][p] += 0.25 * row[(i + nlon - 1) % nlon] + 0.5 * row[i] + 0.25 * row[(i + 1) % nlon]; } }
}
console.log('effective ocean temperature bias', (bias / w).toFixed(2), 'K, rms', Math.sqrt(rms / w).toFixed(2), 'K');
console.log('monthly sea ice N/S (Mkm2):', iceA.map((a, m) => n[m] ? (a[0] / n[m]).toFixed(1) + '/' + (a[1] / n[m]).toFixed(1) : '-').join(' '));
if (qout) fs.writeFileSync(qout, JSON.stringify(Q.map(q => Array.from(q, x => Math.round(x * 10) / 10))));
saveState(E, `data/state_${tag || 'corr'}_end.json`);
console.log('done');

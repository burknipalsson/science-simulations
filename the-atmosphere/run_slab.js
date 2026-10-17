// Spin up the slab-ocean (Q-flux) climate from the prescribed-SST state; save seasonal snapshots
const { makeEarth, initState, gmean } = require('./earth.js');
const { saveState, loadState } = require('./climate.js');
const fs = require('fs');
const years = +process.argv[2] || 2, tag = process.argv[3] || 'slab', from = process.argv[4] || 'data/state_sst.json';
const E = makeEarth(); const { md, ph, S } = E; const nG = md.nG, nlon = md.nlon;
initState(E, 0);
loadState(E, from);
const doyStart = (ph.epoch - 9496.5 + md.time / 86400) % 365.2422;
console.log('start time', (md.time / 86400).toFixed(1), 'd, doy', doyStart.toFixed(1));
ph.qfluxMon = JSON.parse(fs.readFileSync('data/qflux.json')).map(a => Float64Array.from(a));
ph.sstMode = false; ph._qday = -1;
const surf = md.surf || require('./data/surf_64.json');
const perDay = 86400 / md.dt, days = Math.round(years * 365.2422);
const t0 = performance.now();
const saveDays = [0, 90, 181, 273]; // Jan 1, Apr 1, Jul 1, Oct 1 (doy)
let lastDoy = doyStart;
for (let d = 0; d < days; d++) {
  for (let s = 0; s < perDay; s++) md.step();
  const doy = (ph.epoch - 9496.5 + md.time / 86400) % 365.2422;
  if (d > days - 366) for (const sd of saveDays) if (lastDoy < sd + 0.5 && doy >= sd + 0.5 - 1e-9 || (sd === 0 && lastDoy > 300 && doy < 5)) { saveState(E, `data/state_${tag}_${sd}.json`); console.log('saved', sd); }
  lastDoy = doy;
  if (d % 30 === 29) {
    // SST bias vs observed climatology for this month (ice-free ocean)
    const m = Math.min(11, Math.floor(doy / 365.2422 * 12));
    let b = 0, r = 0, w = 0, ice = 0, iceN = 0, iceS = 0;
    for (let j = 0; j < md.nlat; j++) for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (ph.land[p]) continue; const ww = S.w[j]; if (ph.hice[p] > 0) { if (S.mu[j] > 0) iceN += ww; else iceS += ww; } else if (surf.sic[m][p] < 0.15) { const dd = ph.Ts[p] - surf.sst[m][p]; b += ww * dd; r += ww * dd * dd; w += ww; } }
    const km = 2 * Math.PI * 6371 ** 2 / 1e6 / nlon * 1; // area per unit weight per lon cell ~ (2*pi*R^2 * w)/nlon
    console.log(`day ${d + 1} doy ${doy.toFixed(0)} Ts ${gmean(E, ph.Ts).toFixed(2)} SST bias ${(b / w).toFixed(2)} rms ${Math.sqrt(r / w).toFixed(2)} ice N ${(iceN * nlon * km / 1e0).toFixed(1)} S ${(iceS * nlon * km).toFixed(1)} Mkm2 P ${(gmean(E, ph.prec) * 86400).toFixed(2)} ${((performance.now() - t0) / 60000).toFixed(1)} min`);
  }
}
saveState(E, `data/state_${tag}_end.json`);
console.log('done');

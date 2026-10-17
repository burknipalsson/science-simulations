// Q-flux(month) = C * dSST/dt(observed) - F_net(model, into ocean) ; zero under sea ice; smoothed; global mean removed
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync('data/qflux_raw.json'));
const surf = require('./data/surf_64.json');
const Spectral = require('./spectral.js');
const nlat = 64, nlon = 128, nG = nlat * nlon, S = new Spectral(42, nlat, nlon, 6.371e6);
const mld = 50, C = 4.18e6 * mld, mon = 365.2422 / 12 * 86400;
const Q = [];
for (let m = 0; m < 12; m++) {
  const q = new Float64Array(nG);
  const a = surf.sst[(m + 11) % 12], b = surf.sst[(m + 1) % 12];
  for (let p = 0; p < nG; p++) {
    if (surf.land[p]) { q[p] = 0; continue; }
    const iced = surf.sic[m][p] > 0.5;
    const dT = (Math.max(b[p], 271.35) - Math.max(a[p], 271.35)) / (2 * mon);
    q[p] = iced ? 0 : C * dT - raw.F[m][p];
  }
  // smooth: spectral truncation to T21 of the ocean field (land filled with zonal ocean mean first)
  const g = new Float64Array(nG);
  for (let j = 0; j < nlat; j++) { let s = 0, n = 0; for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (!surf.land[p]) { s += q[p]; n++; } } const zm = n ? s / n : 0; for (let i = 0; i < nlon; i++) { const p = j * nlon + i; g[p] = surf.land[p] ? zm : q[p]; } }
  const re = new Float64Array(S.ns), im = new Float64Array(S.ns); S.toSpec(g, re, im);
  for (let i = 0; i < S.ns; i++) { const n = S.nOf[i]; const f = Math.exp(-Math.pow(n / 24, 4)); re[i] *= f; im[i] *= f; }
  S.toGrid(re, im, g);
  for (let p = 0; p < nG; p++) q[p] = surf.land[p] ? 0 : (surf.sic[m][p] > 0.5 ? 0 : g[p]);
  Q.push(q);
}
// remove the annual, area-weighted ocean mean
let s = 0, w = 0;
for (let m = 0; m < 12; m++) for (let j = 0; j < nlat; j++) for (let i = 0; i < nlon; i++) { const p = j * nlon + i; if (!surf.land[p] && surf.sic[m][p] <= 0.5) { s += S.w[j] * Q[m][p]; w += S.w[j]; } }
const mean = s / w; console.log('removed mean', mean.toFixed(2), 'W/m2');
for (let m = 0; m < 12; m++) for (let p = 0; p < nG; p++) if (!surf.land[p] && surf.sic[m][p] <= 0.5) Q[m][p] -= mean;
fs.writeFileSync('data/qflux.json', JSON.stringify(Q.map(q => Array.from(q, x => Math.round(x * 10) / 10))));
// report: annual mean zonal and a few points
const ann = new Float64Array(nG); for (const q of Q) for (let p = 0; p < nG; p++) ann[p] += q[p] / 12;
const pt = (la, lo) => { let j = 0; while (S.lat[j] * 180 / Math.PI > la) j++; const i = Math.round(((lo + 360) % 360) / 360 * nlon) % nlon; return ann[j * nlon + i].toFixed(0); };
console.log('annual Q-flux (W/m2, + = ocean heat released): Iceland/N.Atl(63N,-20)', pt(63, -20), 'Norway Sea(68N,5E)', pt(68, 5), 'Gulf Stream(38N,-65)', pt(38, -65), 'E.Pacific eq', pt(0, -110), 'W.Pac warm pool', pt(0, 150), 'Kuroshio(36N,145E)', pt(36, 145));

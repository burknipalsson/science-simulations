const Model = require('./model.js');
const days = +process.argv[2] || 200, M = +process.argv[3] || 42, L = +process.argv[4] || 15;
const cfg = {42:[64,128,1200],63:[96,192,900],85:[128,256,600]}[M];
const md = new Model({M, nlat:cfg[0], nlon:cfg[1], L, dt:cfg[2]});
const S = md.S, nG = md.nG, day = 86400;
// initial: isothermal T0, ps = 1000 hPa, small noise
md.LP[0].re[0] = md.LP[1].re[0] = Math.log(1e5) * Math.SQRT2; // P00 = 1/sqrt2
for (let c = 0; c < 2; c++) for (let k = 0; k < L; k++) for (let i = 1; i < S.ns; i += 7) { const v = (Math.sin(i * 12.9898 + k * 78.233) * 43758.5453 % 1) * 0.3; md.T[c].re[k * S.ns + i] = v; }
const ka = 1 / (40 * day), ks = 1 / (4 * day), kf = 1 / day;
md.physics = (m) => {
  for (let k = 0; k < L; k++) for (let j = 0; j < m.nlat; j++) {
    const mu = S.mu[j], c2 = 1 - mu * mu, c4 = c2 * c2;
    for (let i = 0; i < m.nlon; i++) {
      const p = j * m.nlon + i, q = k * nG + p;
      const ps = Math.exp(m.LPp[p]), sig = m.sf[k], pr = sig * ps;
      const Teq = Math.max(200, (315 - 60 * mu * mu - 10 * Math.log(pr / 1e5) * c2) * Math.pow(pr / 1e5, m.kap));
      const sb = Math.max(0, (sig - 0.7) / 0.3);
      const kT = ka + (ks - ka) * sb * c4, kv = kf * sb;
      m.pT[q] = -kT * (m.Tp[q] + m.T0 - Teq);
      m.pU[q] = -kv * m.Up[q]; m.pV[q] = -kv * m.Vp[q];
    }
  }
};
const nst = Math.round(days * day / md.dt), avgFrom = Math.round(nst / 2);
const ubar = new Float64Array(L * md.nlat), tbar = new Float64Array(L * md.nlat); let na = 0;
let t0 = performance.now();
for (let s = 0; s < nst; s++) {
  md.step();
  if (s >= avgFrom && s % 6 === 0) {
    na++;
    for (let k = 0; k < L; k++) for (let j = 0; j < md.nlat; j++) { let su = 0, st = 0; for (let i = 0; i < md.nlon; i++) { const q = k * nG + j * md.nlon + i; su += md.U[q]; st += md.TG[q]; } ubar[k * md.nlat + j] += su / md.nlon / Math.sqrt(md.cm[j]); tbar[k * md.nlat + j] += st / md.nlon + md.T0; }
  }
  if (s % Math.round(10 * day / md.dt) === 0) {
    let mx = 0; for (let q = 0; q < L * nG; q++) mx = Math.max(mx, Math.abs(md.U[q]));
    const psm = md.LP[1].re[0] / Math.SQRT2;
    console.log(`day ${(md.time / day).toFixed(0)} max|U| ${mx.toFixed(1)} meanLP ${Math.exp(psm).toFixed(0)} ${((performance.now() - t0) / (s + 1)).toFixed(1)} ms/step`);
  }
}
console.log('zonal-mean u (m/s), rows = levels (sigma), cols = lat from N to S every 4th');
for (let k = 0; k < L; k++) { let r = `${md.sf[k].toFixed(3)} `; for (let j = 0; j < md.nlat; j += 4) r += (ubar[k * md.nlat + j] / na).toFixed(0).padStart(4); console.log(r); }
console.log('lats', Array.from({length: md.nlat / 4}, (_, i) => (S.lat[i * 4] * 180 / Math.PI).toFixed(0)).join(' '));
console.log('zonal-mean T');
for (let k = 0; k < L; k++) { let r = `${md.sf[k].toFixed(3)} `; for (let j = 0; j < md.nlat; j += 4) r += (tbar[k * md.nlat + j] / na).toFixed(0).padStart(4); console.log(r); }

// Jablonowski & Williamson (2006) baroclinic wave test (sigma = eta, ps = 1000 hPa)
const Model = require('./model.js');
const pert = process.argv[2] !== '0', M = +process.argv[3] || 42, days = +process.argv[4] || 10;
const cfg = {42:[64,128,1200],63:[96,192,900],85:[128,256,600]}[M];
const L = +process.argv[5] || 15;
let sh = null;
if (process.argv[6] === 'eq') { sh = []; for (let k = 0; k <= L; k++) sh.push(k / L); }
const md = new Model({M, nlat:cfg[0], nlon:cfg[1], L, dt:cfg[2], tdiff: 1e9, sh});
const S = md.S, nG = md.nG, a = md.a, Om = md.Om, Rd = md.R, g = md.g;
const u0 = 35, eta0 = 0.252, T0 = 288, Gam = 0.005, dT = 4.8e5, etat = 0.2;
function Tbar(e) { let t = T0 * Math.pow(e, Rd * Gam / g); if (e < etat) t += dT * Math.pow(etat - e, 5); return t; }
function fields(e, phi) {
  const ev = (e - eta0) * Math.PI / 2, s = Math.sin(phi), c = Math.cos(phi);
  const u = u0 * Math.pow(Math.cos(ev), 1.5) * Math.pow(Math.sin(2 * phi), 2);
  const A = (-2 * Math.pow(s, 6) * (c * c + 1 / 3) + 10 / 63);
  const B = (8 / 5 * Math.pow(c, 3) * (s * s + 2 / 3) - Math.PI / 4);
  const T = Tbar(e) + 0.75 * e * Math.PI * u0 / Rd * Math.sin(ev) * Math.sqrt(Math.cos(ev)) * (A * 2 * u0 * Math.pow(Math.cos(ev), 1.5) + B * a * Om);
  return { u, T };
}
const evs = (1 - eta0) * Math.PI / 2;
const phis = new Float64Array(nG), Ug = new Float64Array(nG), Vg = new Float64Array(nG), Tg = new Float64Array(nG);
for (let j = 0; j < md.nlat; j++) { const phi = S.lat[j], s = Math.sin(phi), c = Math.cos(phi);
  const A = (-2 * Math.pow(s, 6) * (c * c + 1 / 3) + 10 / 63), B = (8 / 5 * Math.pow(c, 3) * (s * s + 2 / 3) - Math.PI / 4);
  for (let i = 0; i < md.nlon; i++) phis[j * md.nlon + i] = u0 * Math.pow(Math.cos(evs), 1.5) * (A * u0 * Math.pow(Math.cos(evs), 1.5) + B * a * Om); }
md.setPhis(phis);
const lonc = Math.PI / 9, latc = 2 * Math.PI / 9, Rp = a / 10;
for (let k = 0; k < L; k++) {
  const e = md.sf[k];
  for (let j = 0; j < md.nlat; j++) { const phi = S.lat[j];
    for (let i = 0; i < md.nlon; i++) { const p = j * md.nlon + i, lam = S.lon[i];
      const f = fields(e, phi); let u = f.u;
      if (pert) { const r = a * Math.acos(Math.sin(latc) * Math.sin(phi) + Math.cos(latc) * Math.cos(phi) * Math.cos(lam - lonc)); u += Math.exp(-((r / Rp) ** 2)); }
      Ug[p] = u * Math.cos(phi); Vg[p] = 0; Tg[p] = f.T - md.T0; } }
  const so = k * S.ns;
  for (let c = 0; c < 2; c++) {
    const Z = md.Z[c], D = md.D[c], T = md.T[c];
    for (let i = 0; i < S.ns; i++) { Z.re[so+i]=0; Z.im[so+i]=0; D.re[so+i]=0; D.im[so+i]=0; }
    const mU = Ug.map(x => -x); S.divAdd(Vg, mU, Z.re, Z.im, 1, so);
    const tre = new Float64Array(S.ns), tim = new Float64Array(S.ns); S.toSpec(Tg, tre, tim);
    T.re.set(tre, so); T.im.set(tim, so);
  }
}
for (let c = 0; c < 2; c++) { md.LP[c].re.fill(0); md.LP[c].im.fill(0); md.LP[c].re[0] = Math.log(1e5) * Math.SQRT2; }
function energy() { md.gridsFrom(1); let E = 0; for (let k = 0; k < L; k++) for (let j = 0; j < md.nlat; j++) for (let i = 0; i < md.nlon; i++) { const p = j * md.nlon + i, q = k * nG + p; const ps = Math.exp(md.LPG[p]); E += S.w[j] * ps * md.ds[k] * (md.cp * (md.TG[q] + md.T0) + 0.5 * (md.U[q] ** 2 + md.V[q] ** 2) / md.cm[j] + 0) ; } for (let j = 0; j < md.nlat; j++) for (let i = 0; i < md.nlon; i++) { const p = j*md.nlon+i; E += S.w[j]*Math.exp(md.LPG[p])*md.phisG[p]; } return E; }
const E0 = energy();
const perDay = 86400 / md.dt;
for (let d = 1; d <= days; d++) {
  for (let s = 0; s < perDay; s++) md.step();
  md.gridsFrom(1);
  let pmin = 1e9, umaxErr = 0;
  for (let p = 0; p < nG; p++) pmin = Math.min(pmin, Math.exp(md.LPG[p]));
  // compare level ~0.5 zonal wind with initial balanced state
  const k = L >> 1; for (let j = 0; j < md.nlat; j++) for (let i = 0; i < md.nlon; i++) { const p=j*md.nlon+i; const u=md.U[k*nG+p]/Math.sqrt(md.cm[j]); umaxErr=Math.max(umaxErr, Math.abs(u - fields(md.sf[k], S.lat[j]).u)); }
  console.log(`day ${d}: min ps ${(pmin/100).toFixed(1)} hPa, max |u - u_init| at sigma ${md.sf[k].toFixed(2)}: ${umaxErr.toFixed(2)} m/s, energy drift ${((energy()-E0)/E0).toExponential(2)}`);
}

// Node driver: builds the Earth configuration (model + physics + surface data)
const Model = require('./model.js'), Physics = require('./physics.js');
function makeEarth(opt = {}) {
  const nlat = opt.nlat || 64, M = opt.M || 42, L = opt.L || 15;
  const surf = opt.surf || require(`./data/surf_${nlat}.json`);
  const md = new Model({ M, nlat, nlon: 2 * nlat, L, dt: opt.dt || 1200, moist: true, tdiff: opt.tdiff || 0.1 * 86400, sh: opt.sh });
  const ph = new Physics(md, opt);
  const S = md.S, nG = md.nG, nlon = md.nlon;
  for (let p = 0; p < nG; p++) {
    ph.land[p] = surf.land[p]; ph.zs[p] = surf.land[p] ? surf.zs[p] : 0; ph.albLand[p] = surf.alb[p]; ph.iceSheet[p] = surf.sheet[p]; ph.z0[p] = surf.z0[p];
  }
  // surface geopotential (spectrally smoothed with a Hoskins-type filter to limit ringing)
  const phis = new Float64Array(nG); for (let p = 0; p < nG; p++) phis[p] = md.g * surf.zs[p] * (surf.land[p] ? 1 : 0.5);
  const sre = new Float64Array(S.ns), sim = new Float64Array(S.ns); S.toSpec(phis, sre, sim);
  const K = 0.1 / Math.pow(M * (M + 1), 2); // filter strength
  for (let i = 0; i < S.ns; i++) { const n = S.nOf[i], f = Math.exp(-K * Math.pow(n * (n + 1), 2)); sre[i] *= f; sim[i] *= f; }
  S.toGrid(sre, sim, phis); md.setPhis(phis);
  md.surf = surf;
  ph.setMonth = (doy) => { // interpolate monthly climatology (mid-month) to day of year
    const mf = (doy / 365.2422) * 12 - 0.5, m0 = ((Math.floor(mf) % 12) + 12) % 12, m1 = (m0 + 1) % 12, f = mf - Math.floor(mf);
    for (let p = 0; p < nG; p++) {
      ph.sstTarget[p] = Math.max(271.35, surf.sst[m0][p] * (1 - f) + surf.sst[m1][p] * f);
      const c = surf.sic[m0][p] * (1 - f) + surf.sic[m1][p] * f;
      ph.iceTarget[p] = c > 0.5 ? 0.5 + 2 * (c - 0.5) * (Math.abs(S.lat[Math.floor(p / nlon)]) > 1.2 ? 2 : 1) : 0;
    }
  };
  return { md, ph, S };
}
function initState(E, doy = 0) {
  const { md, ph, S } = E, nG = md.nG, nlon = md.nlon, L = md.L;
  ph.setMonth(doy);
  const Tg = new Float64Array(nG), Qg = new Float64Array(nG), LPg = new Float64Array(nG);
  for (let p = 0; p < nG; p++) {
    const j = Math.floor(p / nlon), mu = S.mu[j];
    const tsz = 300 - 45 * mu * mu;
    ph.Ts[p] = ph.land[p] ? tsz - 0.0065 * ph.zs[p] : ph.sstTarget[p];
    ph.Tml[p] = ph.land[p] ? 0 : ph.sstTarget[p]; ph.hice[p] = ph.land[p] ? 0 : ph.iceTarget[p];
    ph.W[p] = 0.5 * ph.Wcap; ph.snow[p] = (ph.land[p] && ph.Ts[p] < 268) ? 50 : 0;
    LPg[p] = Math.log(1e5) - md.phisG[p] / (md.R * 280);
  }
  for (let c = 0; c < 2; c++) S.toSpec(LPg, md.LP[c].re, md.LP[c].im);
  for (let k = 0; k < L; k++) {
    for (let p = 0; p < nG; p++) {
      const j = Math.floor(p / nlon), mu = S.mu[j], tsz = 300 - 45 * mu * mu;
      const T = Math.max(205 + 10 * mu * mu, tsz * Math.pow(md.sf[k], md.R * 0.0065 / md.g));
      Tg[p] = T - md.T0 + 0.2 * Math.sin(p * 12.9898 + k * 78.233);
      const ps = 1e5; Qg[p] = 0.6 * ph.qsat(T, md.sf[k] * ps) * (md.sf[k] > 0.3 ? 1 : 0.1);
    }
    for (let c = 0; c < 2; c++) {
      const tre = new Float64Array(S.ns), tim = new Float64Array(S.ns);
      S.toSpec(Tg, tre, tim); md.T[c].re.set(tre, k * S.ns); md.T[c].im.set(tim, k * S.ns);
      S.toSpec(Qg, tre, tim); md.Q[c].re.set(tre, k * S.ns); md.Q[c].im.set(tim, k * S.ns);
    }
  }
  md.physics = (m) => ph.run(m);
}
// global means helper
function gmean(E, arr, mask) {
  const { md, S } = E; let s = 0, w = 0;
  for (let j = 0; j < md.nlat; j++) for (let i = 0; i < md.nlon; i++) { const p = j * md.nlon + i; if (mask && !mask(p)) continue; s += S.w[j] * arr[p]; w += S.w[j]; }
  return s / w;
}
module.exports = { makeEarth, initState, gmean };

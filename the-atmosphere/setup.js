// Builds an Earth-like (or custom) planet: model + physics + surface. Shared by node and the web workers.
function buildPlanet(cfg) {
  const MD = (typeof Model !== 'undefined') ? Model : require('./model.js');
  const PH = (typeof Physics !== 'undefined') ? Physics : require('./physics.js');
  const md = new MD({ M: cfg.M, nlat: cfg.nlat, nlon: 2 * cfg.nlat, L: cfg.L, dt: cfg.dt, moist: true, tdiff: cfg.tdiff || 0.1 * 86400, sh: cfg.sh });
  const ph = new PH(md, cfg);
  md.physics = (m) => ph.run(m);
  const P = { md, ph, S: md.S };
  applySurface(P, cfg.surf, cfg.qflux, cfg.world || 'earth');
  return P;
}
// world: 'earth' | 'aqua' | 'flat' (continents without mountains)
function applySurface(P, surf, qflux, world) {
  const { md, ph, S } = P, nG = md.nG, M = md.M;
  const aqua = world === 'aqua', flat = world === 'flat';
  for (let p = 0; p < nG; p++) {
    const isL = aqua ? 0 : surf.land[p];
    ph.land[p] = isL; ph.zs[p] = isL && !flat ? surf.zs[p] : 0;
    ph.albLand[p] = surf.alb[p]; ph.iceSheet[p] = isL ? surf.sheet[p] : 0; ph.z0[p] = flat ? 0.1 : surf.z0[p];
  }
  const phis = new Float64Array(nG);
  if (!aqua && !flat) for (let p = 0; p < nG; p++) phis[p] = md.g * surf.zs[p] * (surf.land[p] ? 1 : 0.5);
  const sre = new Float64Array(S.ns), sim = new Float64Array(S.ns);
  const p0 = S.p0, p1 = S.p1; S.p0 = 0; S.p1 = S.nh; // full transforms for the setup
  S.toSpec(phis, sre, sim);
  const K = 0.1 / Math.pow(M * (M + 1), 2);
  for (let i = 0; i < S.ns; i++) { const n = S.nOf[i], f = Math.exp(-K * Math.pow(n * (n + 1), 2)); sre[i] *= f; sim[i] *= f; }
  S.toGrid(sre, sim, phis); md.setPhis(phis);
  S.p0 = p0; S.p1 = p1;
  ph.qfluxMon = aqua ? null : qflux;
  if (!ph.qfluxMon) ph.qflux.fill(0);
  ph.world = world;
}
if (typeof module !== 'undefined') module.exports = { buildPlanet, applySurface };

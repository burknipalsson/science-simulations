// spherical Skalak capsule (C = 1, no bending) in simple shear: steady Taylor deformation vs theory
// small-deformation limit (Barthès-Biesel 1980): D = (5/4)(2 + νs)/(1 + νs) Ca, νs = C/(1+C) -> D = 25/12 Ca
const { LBM } = require('./lbm_cpu.js'), { icosphere, topology } = require('./mesh.js'), M = require('./membrane.js'), { ellipsoid } = require('./shape.js');
const Ca = +(process.argv[2] || 0.025), a = +(process.argv[3] || 6), level = +(process.argv[4] || 3);
const H = 8 * a, nx = 7 * a, nz = 7 * a, ny = H + 2, tau = 1, nu = (tau - 0.5) / 3, U = 0.008;
// walls at y = 0.5 and y = H + 0.5 (phi > 0 between)
const y0 = 0.5, y1 = H + 0.5, gam = 2 * U / H;
const L = new LBM(nx, ny, nz, tau, (x, y, z) => Math.min(y - y0, y1 - y), (x, y, z) => [y > ny / 2 ? U : -U, 0, 0]);
// start from the linear shear profile
for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
  const c = L.id(x, y, z), u = U * (2 * (y - (y0 + y1) / 2) / H);
  for (let i = 0; i < 19; i++) { const cu = require('./lbm_cpu.js').C[i][0] * u; L.f[i * L.n + c] = require('./lbm_cpu.js').W[i] * (1 + 3 * cu + 4.5 * cu * cu - 1.5 * u * u); }
}
const sp = icosphere(level), cell = { X: sp.V.map(p => p.map(x => x * a)), F: sp.F, ...topology(sp.F, sp.V.length) };
const ref = M.makeRef(cell), Gs = nu * gam * a / Ca; // Ca = η γ̇ a / Gs
const P = { Gs, C: 1, kb: 0, kA: 0, kV: 0 };
const cen = [nx / 2, (y0 + y1) / 2, nz / 2];
let X = cell.X.map(p => [p[0] + cen[0], p[1] + cen[1], p[2] + cen[2]]);
const Fo = X.map(() => [0, 0, 0]), Uo = X.map(() => [0, 0, 0]);
const T = Math.round(+(process.argv[5] || 5) / gam);
console.log(`Ca ${Ca}, a ${a}, ${X.length} vertices, gamma ${gam.toExponential(2)}, Gs ${Gs.toExponential(3)}, ${T} steps; Re_p = ${(gam * a * a / nu).toFixed(3)}`);
for (let s = 0; s <= T; s++) {
  M.forces(X, cell, ref, P, Fo);
  L.clearForce(); L.spread(X, Fo); L.step(); L.interp(X, Uo);
  for (let k = 0; k < X.length; k++) for (let d = 0; d < 3; d++) X[k][d] += Uo[k][d];
  if (s % Math.round(1 / gam) === 0) {
    // the two principal axes lying in the shear (xy) plane, not the vorticity axis
    const e = ellipsoid(X, cell.F), ip = [0, 1, 2].sort((i, j) => Math.abs(e.dirs[i][2]) - Math.abs(e.dirs[j][2])).slice(0, 2).sort((i, j) => e.axes[j] - e.axes[i]);
    const D = (e.axes[ip[0]] - e.axes[ip[1]]) / (e.axes[ip[0]] + e.axes[ip[1]]);
    const th = Math.atan2(e.dirs[ip[0]][1], e.dirs[ip[0]][0]) * 180 / Math.PI;
    console.log(`  t·γ ${(s * gam).toFixed(1)}  D ${D.toFixed(4)}  incl ${((th + 180) % 180).toFixed(1)}°  vol ${(e.vol / (4 / 3 * Math.PI * a ** 3)).toFixed(4)}`);
  }
}
console.log('small-deformation theory (Barthès-Biesel & Rallison 1981, Skalak C=1): D =', (25 / 12 * Ca).toFixed(4), ', inclination', (45 - 15 / 8 * (Ca / 3) * 180).toFixed(1), '° (Krüger 2011 eq. 28, G = Ca/3)');

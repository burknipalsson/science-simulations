// IBM coupling check: a stiff spherical capsule pulled by a uniform force in a periodic box;
// terminal velocity vs Stokes drag with Hasimoto's periodic correction U = F/(6πηa) (1 − 2.8373 a/L + 4.19 (a/L)³)
const { LBM } = require('./lbm_cpu.js'), { icosphere, topology } = require('./mesh.js'), M = require('./membrane.js');
const a = 4, Lb = 40, tau = 1, eta = (tau - 0.5) / 3, Ftot = 2e-3;
const L = new LBM(Lb, Lb, Lb, tau, null);
const sp = icosphere(3), cell = { X: sp.V.map(p => p.map(x => x * a)), F: sp.F, ...topology(sp.F, sp.V.length) }, ref = M.makeRef(cell);
const P = { Gs: 0.2, C: 1, kb: 0, kA: 0, kV: 0 };
let X = cell.X.map(p => [p[0] + Lb / 2, p[1] + Lb / 2, p[2] + Lb / 2]), n = X.length;
const Fo = X.map(() => [0, 0, 0]), Uo = X.map(() => [0, 0, 0]);
L.body = [-Ftot / Lb ** 3, 0, 0]; // net zero momentum input
for (let s = 0; s <= 6000; s++) {
  M.forces(X, cell, ref, P, Fo); for (const f of Fo) f[0] += Ftot / n;
  L.clearForce(); L.spread(X, Fo); L.step(); L.interp(X, Uo);
  let um = 0; for (let k = 0; k < n; k++) { for (let d = 0; d < 3; d++) X[k][d] += Uo[k][d]; um += Uo[k][0] / n; }
  if (s % 1000 === 0) {
    const r = a / Lb, Ust = Ftot / (6 * Math.PI * eta * a) * (1 - 2.8373 * r + 4.19 * r ** 3);
    console.log(`step ${s}: U ${um.toExponential(4)}  Stokes+Hasimoto ${Ust.toExponential(4)}  ratio ${(um / Ust).toFixed(3)}  (hydrodynamic radius ${(a * Ust / um).toFixed(2)} vs a ${a})`);
  }
}

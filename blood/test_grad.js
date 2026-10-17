// finite-difference check of every force term
const { makeCell } = require('./mesh.js'), M = require('./membrane.js');
const cell = makeCell(2), ref = M.makeRef(cell);
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
const X = cell.X.map(p => p.map(x => x * 1.1 + 0.15 * rnd()));
for (const [name, P] of [['skalak', { Gs: 5, C: 10, kb: 0, kA: 0, kV: 0 }], ['bend', { Gs: 0, C: 0, kb: 0.3, kA: 0, kV: 0 }], ['global', { Gs: 0, C: 0, kb: 0, kA: 100, kV: 80 }]]) {
  const { f } = M.forces(X, cell, ref, P); let err = 0, mag = 0;
  for (let i = 0; i < X.length; i += 7) for (let d = 0; d < 3; d++) {
    const h = 1e-6, x0 = X[i][d];
    X[i][d] = x0 + h; const Wp = M.forces(X, cell, ref, P).W; X[i][d] = x0 - h; const Wm = M.forces(X, cell, ref, P).W; X[i][d] = x0;
    const fd = -(Wp - Wm) / (2 * h); err = Math.max(err, Math.abs(fd - f[i][d])); mag = Math.max(mag, Math.abs(fd));
  }
  console.log(name, 'max |F - F_fd| =', err.toExponential(2), ' max |F| =', mag.toExponential(2));
}

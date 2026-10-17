// rest-shape numbers and the optical-tweezers stretch (static equilibrium, no fluid), µm / pN
const { makeCell } = require('./mesh.js'), M = require('./membrane.js');
const level = +(process.argv[2] || 3), Gs = +(process.argv[3] || 5.3), C = +(process.argv[4] || 100);
const cell = makeCell(level), ref = M.makeRef(cell), n = cell.X.length;
// optional stress-free shape for shear: an oblate spheroid with the cell's area (aspect c/a = argv[7]); bending keeps the biconcave θ0
const asp = +(process.argv[7] || 0);
if (asp) {
  const { icosphere } = require('./mesh.js'), U = icosphere(level).V;
  const area = s => M.totals(U.map(p => [p[0] * s, p[1] * s, p[2] * s * asp]), cell.F).A;
  let lo = 1, hi = 10; for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (area(m) < ref.A) lo = m; else hi = m; }
  const sp = makeRef({ X: U.map(p => [p[0] * lo, p[1] * lo, p[2] * lo * asp]), F: cell.F, E: cell.E });
  ref.tri = sp.tri;
  console.log('spheroid reference a =', lo.toFixed(3), 'c =', (lo * asp).toFixed(3));
}
function makeRef(c) { return M.makeRef(c); }
const span = (X, d) => Math.max(...X.map(p => p[d])) - Math.min(...X.map(p => p[d]));
console.log(`level ${level}: ${n} vertices; diameter ${span(cell.X, 0).toFixed(2)} µm, thickness max ${span(cell.X, 2).toFixed(2)}, area ${ref.A.toFixed(1)} µm², volume ${ref.V.toFixed(1)} µm³`);
const kbend = +(process.argv[6] || 0.2), P = { Gs, C, kb: 2 * kbend / Math.sqrt(3), kA: 500 * Gs, kV: 500 * Gs }; // κ = 2e-19 J = 0.2 pN µm
// contact patches: vertices within 1 µm (contact diameter 2 µm) of each end along x (bead attached to the rim)
const xs = cell.X.map(p => p[0]), xmax = Math.max(...xs);
const L = [], R = [];
cell.X.forEach((p, i) => { if (Math.hypot(p[0] - xmax, p[1], p[2]) < 1.0 + 0) R.push(i); if (Math.hypot(p[0] + xmax, p[1], p[2]) < 1.0) L.push(i); });
// rim patch: pick by distance in the yz-plane projected on the end (use the 5% of vertices with largest |x|)
const frac = +(process.argv[5] || 0.05), ord = [...cell.X.keys()].sort((a, b) => cell.X[a][0] - cell.X[b][0]), m = Math.round(frac * n);
const Lp = ord.slice(0, m), Rp = ord.slice(n - m);
function equilibrium(Fpn) {
  const X = cell.X.map(p => p.slice()), V = X.map(() => [0, 0, 0]);
  // FIRE minimiser
  let dt = 0.002, a = 0.1, np = 0; const dtmax = 0.02;
  let res;
  for (let it = 0; it < 200000; it++) {
    res = M.forces(X, cell, ref, P);
    const f = res.f;
    for (const i of Lp) f[i][0] -= Fpn / m; for (const i of Rp) f[i][0] += Fpn / m;
    let Pw = 0, vn = 0, fn = 0, fmax = 0;
    for (let i = 0; i < n; i++) { Pw += M.dot(f[i], V[i]); vn += M.dot(V[i], V[i]); fn += M.dot(f[i], f[i]); fmax = Math.max(fmax, M.len(f[i])); }
    if (fmax < 1e-4) break;
    vn = Math.sqrt(vn); fn = Math.sqrt(fn);
    for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) V[i][d] = (1 - a) * V[i][d] + a * vn * f[i][d] / fn;
    if (Pw > 0) { if (++np > 5) { dt = Math.min(dt * 1.1, dtmax); a *= 0.99; } }
    else { np = 0; dt *= 0.5; a = 0.1; for (const v of V) v[0] = v[1] = v[2] = 0; }
    for (let i = 0; i < n; i++) for (let d = 0; d < 3; d++) { V[i][d] += dt * f[i][d]; X[i][d] += dt * V[i][d]; }
  }
  const DA = span(X, 0);
  // transverse diameter: max extent perpendicular to x, over all directions in the yz plane
  let DT = 0; for (let a = 0; a < Math.PI; a += Math.PI / 90) { const c = Math.cos(a), s = Math.sin(a); const pr = X.map(p => p[1] * c + p[2] * s); DT = Math.max(DT, Math.max(...pr) - Math.min(...pr)); }
  return { DA, DT, DY: span(X, 1), A: res.A / ref.A - 1, V: res.V / ref.V - 1 };
}
for (const Fp of [0, 16, 38, 68, 88, 130, 193]) {
  const r = equilibrium(Fp);
  console.log(`F ${String(Fp).padStart(3)} pN  axial ${r.DA.toFixed(2)}  transverse ${r.DY.toFixed(2)} (in-plane) ${r.DT.toFixed(2)} (max) µm  (dA ${(r.A * 100).toFixed(2)}%, dV ${(r.V * 100).toFixed(2)}%)`);
}

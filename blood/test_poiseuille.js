// body-force-driven flow in a round tube (axis x, periodic): profile vs Hagen-Poiseuille
const { LBM } = require('./lbm_cpu.js');
for (const R of [5.3, 10.3]) {
  const ny = Math.ceil(2 * R + 4), c0 = (ny - 1) / 2, tau = 1, nu = (tau - 0.5) / 3, G = 1e-6;
  const L = new LBM(4, ny, ny, tau, (x, y, z) => R - Math.hypot(y - c0, z - c0));
  L.body = [G, 0, 0];
  let prev = 0;
  for (let s = 0; s < 40000; s++) { L.step(); if (s % 500 === 0) { const u = L.ux[L.id(1, Math.round(c0), Math.round(c0))]; if (Math.abs(u - prev) < 1e-10 * u) break; prev = u; } }
  let err = 0, um = 0, Q = 0;
  for (let z = 0; z < ny; z++) for (let y = 0; y < ny; y++) {
    const r = Math.hypot(y - c0, z - c0); if (r >= R) continue;
    const ue = G / (4 * nu) * (R * R - r * r), u = L.ux[L.id(1, y, z)]; err = Math.max(err, Math.abs(u - ue)); um = Math.max(um, ue); Q += u;
  }
  console.log(`R=${R}: max error ${(err / um * 100).toFixed(3)}% of centre velocity; Q/Q_exact ${(Q / (Math.PI * G * R ** 4 / (8 * nu))).toFixed(4)}`);
}

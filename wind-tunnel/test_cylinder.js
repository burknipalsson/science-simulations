// Schäfer & Turek (1996) DFG benchmark, cylinder in a channel, quasi-2D (nz = 1).
// usage: node test_cylinder.js <re 20|100> <D cells>
const { LBM } = require('./lbm_cpu.js');
const Re = +(process.argv[2] || 20), D = +(process.argv[3] || 20);
const s = D / 0.1, nx = Math.round(2.2 * s), ny = Math.round(0.41 * s);
const Ubar = Re === 20 ? 0.02 : 0.04, Umax = 1.5 * Ubar, nu = Ubar * D / Re;
const xc = 0.2 * s - 0.5, yc = 0.2 * s - 0.5, H = ny;
const L = new LBM({ nx, ny, nz: 1, nu, bcY: 'wall',
  uIn: y => { const yy = y + 0.5; return [4 * Umax * yy * (H - yy) / (H * H), 0, 0]; },
  sdf: (x, y) => Math.hypot(x - xc, y - yc) - D / 2 });
// surface pressure: linear extrapolation from two fluid points along the axis (bilinear would touch solid cells)
const pSurf = sgn => 2 * pAt(xc + sgn * (D / 2 + 1.5), yc) - pAt(xc + sgn * (D / 2 + 2.5), yc);
const pAt = (x, y) => { // bilinear pressure
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const p = (a, b) => (L.macro(a, b, 0).rho - 1) / 3;
  return (1 - fx) * ((1 - fy) * p(x0, y0) + fy * p(x0, y0 + 1)) + fx * ((1 - fy) * p(x0 + 1, y0) + fy * p(x0 + 1, y0 + 1));
};
const coef = 2 / (Ubar * Ubar * D), pScale = 1 / (Ubar * Ubar); // physical rho=1, Ubar=1 (Re100) or 0.2 (Re20)
const Uphys = Re === 20 ? 0.2 : 1;
console.log(`Re ${Re}, D ${D}, grid ${nx}x${ny}, tau ${(3 * nu + 0.5).toFixed(4)}`);
const T = D / (0.3 * Ubar), t0 = Date.now();
if (Re === 20) {
  let last = 0;
  for (let k = 1; k <= 400; k++) {
    for (let i = 0; i < 500; i++) L.step();
    const cd = L.force[0] * coef, cl = L.force[1] * coef;
    if (k % 10 === 0) console.log(`step ${L.t}: Cd ${cd.toFixed(4)} Cl ${cl.toFixed(4)} dp ${((pSurf(-1) - pSurf(1)) * pScale * Uphys * Uphys).toFixed(4)}`);
    if (Math.abs(cd - last) < 1e-6 && k > 20) break; last = cd;
  }
} else {
  for (let i = 0; i < 25 * T; i++) L.step();
  const hist = [];
  for (let i = 0; i < 6 * T; i++) { L.step(); hist.push([L.t, L.force[0] * coef, L.force[1] * coef]); }
  const cdmax = Math.max(...hist.map(h => h[1])), clmax = Math.max(...hist.map(h => h[2])), clmin = Math.min(...hist.map(h => h[2]));
  const ups = []; for (let i = 1; i < hist.length; i++) if (hist[i - 1][2] < 0 && hist[i][2] >= 0) ups.push(i - 1 + hist[i - 1][2] / (hist[i - 1][2] - hist[i][2]));
  const per = (ups[ups.length - 1] - ups[0]) / (ups.length - 1);
  console.log(`Cd max ${cdmax.toFixed(4)} (3.22-3.24)  Cl max ${clmax.toFixed(4)} min ${clmin.toFixed(4)} (0.99-1.01)  St ${(D / (per * Ubar)).toFixed(4)} (0.295-0.305)`);
}
console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s, ${(L.t * nx * ny / (Date.now() - t0) / 1000).toFixed(1)} MLUPS`);

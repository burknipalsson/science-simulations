// Plane Poiseuille flow with walls off the grid (Bouzidi interpolated bounce-back).
// Checks (1) the profile is the parabola that vanishes exactly at the true wall positions, and
// (2) the local pressure gradient matches dp/dx = -12 nu (rho U)/H^2 for the local flow.
const { LBM } = require('./lbm_cpu.js');
const cases = process.argv[2] === 'quick' ? [[1.3, 22.2, 0.05, 0]] :
  [[1.3, 22.2, 0.05, 0], [0.75, 22.6, 0.02, 0], [2.1, 21.45, 0.01, 0], [1.3, 22.2, 0.05, 0.1]];
for (const [yb, yt, nu, cs] of cases) {
  const ny = 24, nx = 100, H = yt - yb, U = 0.02;
  const prof = y => (y > yb && y < yt) ? 6 * U * (y - yb) * (yt - y) / (H * H) : 0;
  const L = new LBM({ nx, ny, nz: 1, nu, cs, bcY: 'wall', uIn: (y) => [prof(y), 0, 0], sdf: (x, y) => Math.min(y - yb, yt - y) });
  const steps = Math.round(4 * H * H / nu);
  for (let s = 0; s < steps; s++) L.step();
  const at = x => {
    // least-squares fit of rho*u = a (y-yb)(yt-y)
    let sab = 0, sbb = 0, rs = 0, n = 0; const pts = [];
    for (let y = 0; y < ny; y++) { if (L.solid[x + nx * y]) continue; const m = L.macro(x, y, 0), b = (y - yb) * (yt - y);
      sab += m.rho * m.ux * b; sbb += b * b; rs += m.rho; n++; pts.push([b, m.rho * m.ux]); }
    const a = sab / sbb; let e = 0; for (const [b, v] of pts) e = Math.max(e, Math.abs(v - a * b));
    return { flux: a * H * H / 6, err: e / (a * H * H / 4), p: rs / n / 3 };
  };
  const A = at(40), B = at(60), M = at(50);
  const dpdx = (B.p - A.p) / 20, th = -12 * nu * M.flux / (H * H);
  console.log(`H ${H.toFixed(2)} (walls ${yb}, ${yt}) nu ${nu} Cs ${cs}: shape err ${(100 * M.err).toFixed(3)}%  dp/dx ${dpdx.toExponential(4)} vs ${th.toExponential(4)} (${(100 * (dpdx / th - 1)).toFixed(2)}%)`);
}

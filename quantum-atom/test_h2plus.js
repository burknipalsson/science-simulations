// Validate the exact H₂⁺ solver against literature (e.g. Madsen & Peek 1971; Scott et al. 2006).
const H2p = require('./h2plus.js');
const ok = (name, got, want, tol) => console.log(`${Math.abs(got - want) <= tol ? 'PASS' : 'FAIL'}  ${name}: ${got.toPrecision(10)} vs ${want.toPrecision(10)} (tol ${tol})`);
const Ha_eV = 27.211386245988, Ha_cm = 219474.6313632;
let t0 = Date.now();
const g2 = H2p.solve(2.0, 0), u2 = H2p.solve(2.0, 1);
console.log(`     solve() takes ${((Date.now() - t0) / 2).toFixed(0)} ms`);
ok('1sσg ε(R=2)', g2.eps, -1.1026342144949, 1e-8);
ok('2pσu ε(R=2)', u2.eps, -0.6675343922, 1e-8);
ok('1sσg ε(R=1)', H2p.solve(1.0, 0).eps, -1.4517863, 1e-6);
ok('1sσg ε(R=4)', H2p.solve(4.0, 0).eps, -0.7960848, 1e-6);
// potential curve, minimum, depth
const Rs = [], U = [];
for (let R = 0.6; R <= 14.0001; R += 0.02){ Rs.push(R); U.push(H2p.solve(R, 0).E); }
let i0 = 0; U.forEach((u, i) => { if (u < U[i0]) i0 = i; });
// parabolic refinement of the minimum
const a = U[i0 - 1], b = U[i0], c = U[i0 + 1], off = 0.5 * (a - c) / (a - 2 * b + c);
const Re = Rs[i0] + off * 0.02, Emin = b - 0.25 * (a - c) * off;
// golden-section refinement of the minimum on the exact curve
let ga = Re - 0.05, gb = Re + 0.05;
for (let it = 0; it < 40; it++){ const c = gb - 0.618034 * (gb - ga), d = ga + 0.618034 * (gb - ga); if (H2p.solve(c, 0).E < H2p.solve(d, 0).E) gb = d; else ga = c; }
const ReG = 0.5 * (ga + gb), EminG = H2p.solve(ReG, 0).E;
ok('equilibrium R_e (bohr)', ReG, 1.9971933, 2e-5);
ok('E_min (Ha)', EminG, -0.6026346191, 2e-9);
ok('D_e (eV)', (-0.5 - Emin) * Ha_eV, 2.7928, 1e-3);
// vibration of the protons (reduced mass m_p/2) on that curve → zero-point energy and D_0
const mu = 1836.15267343 / 2;
const lv = H2p.vibLevels(Rs, U, mu, 3);
ok('D_0 (eV)', (-0.5 - lv[0]) * Ha_eV, 2.6507, 3e-3);
ok('ν(0→1) (cm⁻¹)', (lv[1] - lv[0]) * Ha_cm, 2191.2, 2);
console.log(`     zero-point energy ${((lv[0] - Emin) * Ha_eV * 1000).toFixed(1)} meV;  1 bohr = 0.529 Å → R_e = ${(Re * 0.529177).toFixed(3)} Å`);
// normalised wavefunction: density at the protons and the midpoint
const w = H2p.wavefunction(2.0, 0);
// independent check of the tabulated ψ(ξ, η): normalisation and <V> by a Cartesian sum
{
  const R = 2, X = w.X, Y = w.Y, nx = X.length, ny = Y.length;
  const psi = (x, y, z) => {
    const ra = Math.hypot(x, y, z - R / 2), rb = Math.hypot(x, y, z + R / 2), xi = (ra + rb) / R, eta = (rb - ra) / R;
    if (xi >= w.xiMax) return 0;
    const fi = (xi - 1) / (w.xiMax - 1) * (nx - 1), fj = (eta + 1) / 2 * (ny - 1), i = Math.min(nx - 2, fi | 0), j = Math.min(ny - 2, fj | 0);
    const a = fi - i, b = fj - j;
    return (X[i] * (1 - a) + X[i + 1] * a) * (Y[j] * (1 - b) + Y[j + 1] * b);
  };
  let n = 0, v = 0; const h = 0.1, L = 12;
  for (let x = -L; x < L; x += h) for (let y = -L; y < L; y += h) for (let z = -L; z < L; z += h){
    const p = psi(x + h / 2, y + h / 2, z + h / 2) ** 2; n += p;
    v += p * (-1 / Math.hypot(x + h / 2, y + h / 2, z + h / 2 - R / 2) - 1 / Math.hypot(x + h / 2, y + h / 2, z + h / 2 + R / 2));
  }
  ok('∫|ψ|² on a Cartesian grid', n * h ** 3, 1, 2e-3);
  // virial theorem at the equilibrium-ish R = 2 is not exact; just report <V_e>
  console.log(`     <−1/r_A − 1/r_B> = ${(v / n).toFixed(4)} Ha;  ξmax = ${w.xiMax.toFixed(1)}`);
}

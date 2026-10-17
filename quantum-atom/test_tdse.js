// Headless validation of the split-operator solver: norm/energy conservation, free spreading,
// tunnelling vs the exact rectangular-barrier formula, double-slit fringe spacing.
const Q = require('./tdse_cpu.js');
const { AU } = Q;
const ok = (name, got, want, tol) => console.log(`${Math.abs(got - want) <= tol ? 'PASS' : 'FAIL'}  ${name}: ${got.toPrecision(6)} vs ${want.toPrecision(6)} (tol ${tol})`);
const only = process.argv[2]; // run one numbered test: node test_tdse.js 3

// 1. free packet in 1D: norm, energy, spreading σ(t) = σ0 sqrt(1 + (t/(2σ0²))²)
if (!only || only === "1"){
  const g = Q.makeGrid(4096, 1, 0.25), s0 = 5, k0 = 2;
  Q.gaussian(g, 200, 0, s0, 0, k0, 0);
  const E0 = Q.energy(g), dt = 0.05, T = 100;
  for (let i = 0; i < T / dt; i++) Q.step(g, dt);
  let m1 = 0, m2 = 0, n = 0;
  for (let i = 0; i < g.nx; i++){ const p = g.re[i] ** 2 + g.im[i] ** 2, x = i * g.h; m1 += p * x; m2 += p * x * x; n += p; }
  m1 /= n; const sig = Math.sqrt(m2 / n - m1 * m1);
  ok('free norm', Q.norm(g), 1, 1e-10);
  ok('free energy', Q.energy(g), E0, 1e-10);
  ok('free energy = k0²/2 + 1/(8σ²)', E0, k0 * k0 / 2 + 1 / (8 * s0 * s0), 1e-8);
  ok('free centre', m1, 200 + k0 * T, 1e-6);
  ok('free width', sig, s0 * Math.sqrt(1 + (T / (2 * s0 * s0)) ** 2), 1e-6);
}

// 2. tunnelling: packet transmission vs ∫|φ(k)|² T(k²/2) dk with the exact T
if (!only || only === "2"){
  const N = 16384, h = 0.1, g = Q.makeGrid(N, 1, h), V0 = 0.5, a = 2.0, xb = N * h / 2;
  for (const k0 of [0.7, 0.9, 1.0, 1.1, 1.3]){
    const s0 = 40;
    Q.gaussian(g, xb - 250, 0, s0, 0, k0, 0);
    for (let i = 0; i < N; i++){ const x = i * h; g.V[i] = (x >= xb && x < xb + a) ? V0 : 0; }
    const dt = 0.02, T = 500 / k0;
    for (let i = 0; i < Math.round(T / dt); i++) Q.step(g, dt);
    let tr = 0; for (let i = 0; i < N; i++) if (i * h > xb + a) tr += g.re[i] ** 2 + g.im[i] ** 2;
    tr *= h;
    // momentum distribution of the initial Gaussian: |φ(k)|² ∝ exp(-2σ²(k-k0)²)
    let num = 0, den = 0;
    for (let k = k0 - 8 / s0; k <= k0 + 8 / s0; k += 1e-4){ const w = Math.exp(-2 * s0 * s0 * (k - k0) ** 2); num += w * Q.rectT(k * k / 2, V0, a); den += w; }
    // residual is O(h²) from sampling the barrier's sharp edges (−4.7e-4 at h = 0.1, −1.2e-4 at h = 0.05)
    ok(`tunnel T(E=${(k0 * k0 / 2 / V0).toFixed(2)} V0)`, tr, num / den, 1e-3 * num / den);
  }
}

// 3. double slit in 2D: once the transmitted wave has fully left the slits its momentum distribution
// is the far-field pattern, cos²(k_y d/2)·sinc²(k_y w/2): bright fringes every Δk_y = 2π/d, i.e. sinθ = nλ/d
if (!only || only === "3"){
  const nx = 512, ny = 512, h = 0.25, g = Q.makeGrid(nx, ny, h), Ly = ny * h;
  const k0 = 3, d = 12, wsl = 2, xw = 45, thick = 1;
  Q.gaussian(g, xw - 30, Ly / 2, 6, 12, k0, 0);
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++){
    const X = x * h, Y = y * h - Ly / 2;
    const inWall = X >= xw && X < xw + thick, inSlit = Math.abs(Math.abs(Y) - d / 2) < wsl / 2;
    g.V[x + nx * y] = inWall && !inSlit ? 30 : 0;
  }
  Q.absorber(g, 12, 0.3, 'xy');
  const dt = 0.01;
  for (let i = 0; i < Math.round(18 / dt); i++) Q.step(g, dt); // long enough to clear the slits, short enough that no transmitted wave reaches the absorbers
  let tail = 0, tot = 0;
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++){
    const k = x + nx * y, p = g.re[k] ** 2 + g.im[k] ** 2, X = x * h;
    if (X > xw + thick){ tot += p; if (X < xw + thick + 8) tail += p; }
    if (X < xw + thick){ g.re[k] = 0; g.im[k] = 0; }
  }
  console.log(`     transmitted ${(tot * h * h * 100).toFixed(2)}% of the packet; ${(tail / tot * 100).toFixed(3)}% of it still near the slits`);
  // P(k_y) = Σ_x |Σ_y ψ(x,y) e^{-i k_y y}|² on a fine k_y grid
  const kys = [], P = [];
  for (let ky = -3; ky <= 3; ky += 0.002){
    let s = 0;
    const c = [], sn = []; for (let y = 0; y < ny; y++){ c.push(Math.cos(ky * y * h)); sn.push(Math.sin(ky * y * h)); }
    for (let x = Math.floor((xw + thick) / h); x < nx; x++){
      let r = 0, i = 0;
      for (let y = 0; y < ny; y++){ const k = x + nx * y; r += g.re[k] * c[y] + g.im[k] * sn[y]; i += g.im[k] * c[y] - g.re[k] * sn[y]; }
      s += r * r + i * i;
    }
    kys.push(ky); P.push(s);
  }
  const pm = Math.max(...P), peaks = [];
  for (let j = 1; j < P.length - 1; j++) if (P[j] > P[j - 1] && P[j] > P[j + 1] && P[j] > 0.02 * pm) peaks.push(kys[j]);
  console.log('     fringe peaks k_y·d/2π:', peaks.map(p => (p * d / 2 / Math.PI).toFixed(3)).join(' '));
  // the sinc² envelope pulls each off-axis peak slightly inwards; compare with the maxima of the
  // ideal Fraunhofer pattern, found the same way
  const mid = peaks.indexOf(peaks.reduce((a, b) => Math.abs(b) < Math.abs(a) ? b : a));
  for (let n = -2; n <= 2; n++){
    let best = 0, bk = 0;
    for (let k = (n - 0.4) * 2 * Math.PI / d; k < (n + 0.4) * 2 * Math.PI / d; k += 1e-5){
      const s = Math.abs(k) < 1e-9 ? 1 : Math.sin(k * wsl / 2) / (k * wsl / 2), I = Math.cos(k * d / 2) ** 2 * s * s;
      if (I > best){ best = I; bk = k; }
    }
    ok(`fringe n=${n} at k_y`, peaks[mid + n], bk, 0.02 * 2 * Math.PI / d);
  }
}
console.log('units: 1 bohr =', AU.bohr_nm, 'nm; 1 a.u. time =', AU.time_fs, 'fs');

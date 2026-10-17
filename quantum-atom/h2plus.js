// Exact H₂⁺ (Born–Oppenheimer, clamped protons a distance R apart), atomic units.
// In prolate spheroidal coordinates ξ = (r_A + r_B)/R ∈ [1,∞), η = (r_A − r_B)/R ∈ [−1,1] the equation
// separates (m = 0, σ states): ψ = X(ξ) Y(η), p² = −ε R²/2 with ε the electronic energy, and
//   d/dξ[(ξ²−1) X'] + (−A + 2Rξ − p²ξ²) X = 0,     d/dη[(1−η²) Y'] + (A + p²η²) Y = 0.
// The angular equation is diagonalised in Legendre polynomials (even l: σg, odd l: σu); the radial one
// is shot outward from ξ = 1; p is then found where both give the same separation constant A.
const H2p = (() => {
  const LMAX = 40;
  // eigenvalue A and Legendre coefficients of the angular equation (lowest state of the given parity)
  function angular(p, parity){
    const ls = []; for (let l = parity; l < LMAX; l += 2) ls.push(l);
    const n = ls.length;
    // <l|η|l+1> for normalised P_l
    const eta = (l) => (l + 1) / Math.sqrt((2 * l + 1) * (2 * l + 3));
    // (η²)_{l,l} and (η²)_{l,l+2} in the normalised basis
    const d = ls.map(l => (l > 0 ? eta(l - 1) ** 2 : 0) + eta(l) ** 2), o = ls.map(l => eta(l) * eta(l + 1));
    // M = diag(l(l+1)) − p² η²: symmetric tridiagonal in this basis; Jacobi on a small dense matrix
    const M = Array.from({ length: n }, (_, i) => new Float64Array(n));
    for (let i = 0; i < n; i++){ M[i][i] = ls[i] * (ls[i] + 1) - p * p * d[i]; if (i + 1 < n){ M[i][i + 1] = M[i + 1][i] = -p * p * o[i]; } }
    const { vals, vecs } = jacobi(M);
    let k = 0; for (let i = 1; i < n; i++) if (vals[i] < vals[k]) k = i;
    return { A: vals[k], ls, coef: vecs.map(v => v[k]) };
  }
  function jacobi(A0){
    const n = A0.length, A = A0.map(r => Float64Array.from(r)), V = Array.from({ length: n }, (_, i) => { const r = new Float64Array(n); r[i] = 1; return r; });
    for (let sweep = 0; sweep < 60; sweep++){
      let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
      if (off < 1e-30) break;
      for (let pp = 0; pp < n; pp++) for (let q = pp + 1; q < n; q++){
        if (Math.abs(A[pp][q]) < 1e-300) continue;
        const th = (A[q][q] - A[pp][pp]) / (2 * A[pp][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++){ const a = A[k][pp], b = A[k][q]; A[k][pp] = c * a - s * b; A[k][q] = s * a + c * b; }
        for (let k = 0; k < n; k++){ const a = A[pp][k], b = A[q][k]; A[pp][k] = c * a - s * b; A[q][k] = s * a + c * b; }
        for (let k = 0; k < n; k++){ const a = V[k][pp], b = V[k][q]; V[k][pp] = c * a - s * b; V[k][q] = s * a + c * b; }
      }
    }
    return { vals: A.map((r, i) => r[i]), vecs: V };
  }
  // shoot the radial equation for given R, p, A; returns {nodes, sign at the end}. Uses the
  // variable t = ξ − 1 and the system X' = P/(t(t+2)), P' = (A − 2Rξ + p²ξ²) X with P = (ξ²−1)X'.
  function shoot(R, p, A, store){
    const c0 = A - 2 * R + p * p;
    const tmax = 1 + 45 / p;
    // series start at t0: X = 1 + a1 t, P = c0 t + b2 t² (b2 from P' = (A − 2Rξ + p²ξ²)X expanded)
    const a1 = c0 / 2, t0 = 1e-6;
    let t = t0, X = 1 + a1 * t0, P = c0 * t0 + 0.5 * ((-2 * R + 2 * p * p) + c0 * a1) * t0 * t0;
    const f = (t, X, P) => { const xi = 1 + t; return [P / (t * (t + 2)), (A - 2 * R * xi + p * p * xi * xi) * X]; };
    let nodes = 0;
    if (store){ store.length = 0; store.push([1, 1]); }
    while (t < tmax){
      // RK4 steps: fine near the singular point ξ = 1, coarser further out
      const hh = Math.min(1e-4 + 0.05 * t, 0.02, 0.02 / p);
      const [k1, l1] = f(t, X, P), [k2, l2] = f(t + hh / 2, X + hh / 2 * k1, P + hh / 2 * l1);
      const [k3, l3] = f(t + hh / 2, X + hh / 2 * k2, P + hh / 2 * l2), [k4, l4] = f(t + hh, X + hh * k3, P + hh * l3);
      const Xn = X + hh / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
      P += hh / 6 * (l1 + 2 * l2 + 2 * l3 + l4);
      if (Xn * X < 0) nodes++;
      X = Xn; t += hh;
      if (store) store.push([1 + t, X]);
      if (Math.abs(X) > 1e30) break;
    }
    return { nodes, sign: Math.sign(X), X };
  }
  // Illinois (modified regula falsi) root of f on a bracket [a, b]
  function illinois(f, a, b, fa, fb, tol){
    let side = 0;
    for (let it = 0; it < 100; it++){
      const c = (a * fb - b * fa) / (fb - fa), fc = f(c);
      if (fc * fb > 0){ b = c; fb = fc; if (side === -1) fa /= 2; side = -1; }
      else if (fa * fc > 0){ a = c; fa = fc; if (side === 1) fb /= 2; side = 1; }
      else return c;
      if (Math.abs(b - a) < tol * (1 + Math.abs(c))) return c;
    }
    return 0.5 * (a + b);
  }
  // radial separation constant of the nodeless state for given R, p. A above the eigenvalue gives a
  // nodeless solution growing positive; just below, a node appears far out. Bracket by bisection on
  // that, then root-find the end value X(ξmax), which passes through zero at the eigenvalue.
  function radialA(R, p, guess){
    const good = A => { const s = shoot(R, p, A); return s.nodes === 0 && s.sign > 0; };
    let lo, hi;
    if (guess !== undefined && good(guess + 0.05) && !good(guess - 0.05)){ lo = guess - 0.05; hi = guess + 0.05; }
    else { lo = -p * p - 2 * R - 50; hi = 2 * R + 50; }
    for (let it = 0; it < 60 && hi - lo > 1e-3; it++){ const mid = 0.5 * (lo + hi); if (good(mid)) hi = mid; else lo = mid; }
    const end = A => { const s = shoot(R, p, A); return Math.sign(s.X) * Math.min(Math.abs(s.X), 1e30); };
    const fl = end(lo), fh = end(hi);
    if (!(fl < 0 && fh > 0)) return 0.5 * (lo + hi);
    return illinois(end, lo, hi, fl, fh, 1e-15);
  }
  // electronic energy ε(R) of 1sσg (parity 0) or 2pσu (parity 1)
  function solve(R, parity = 0){
    let last;
    const g = p => { last = radialA(R, p, last); return last - angular(p, parity).A; };
    // bracket p in a range covering ε between −2.0 and −0.4 (He⁺-like down to separated atoms)
    let a = R * Math.sqrt(0.2), b = R * Math.sqrt(1.0), ga = g(a), gb = g(b);
    for (let i = 0; i < 40 && ga * gb > 0; i++){ a *= 0.8; b *= 1.25; ga = g(a); gb = g(b); }
    const p = illinois(g, a, b, ga, gb, 1e-14), eps = -2 * p * p / (R * R);
    return { R, p, eps, E: eps + 1 / R, ang: angular(p, parity), A: angular(p, parity).A };
  }
  // tabulated wavefunction factors for drawing: X(ξ) on ξ ∈ [1, ξmax], Y(η) on [−1, 1]
  function wavefunction(R, parity = 0, nx = 256, ny = 256){
    const s = solve(R, parity), pts = [];
    shoot(R, s.p, s.A + 1e-12, pts);
    // keep the decaying part: cut where X has its minimum before the shooting blows up
    let cut = pts.length - 1, best = Infinity;
    for (let i = 0; i < pts.length; i++){ const v = Math.abs(pts[i][1]); if (v < best){ best = v; cut = i; } if (v > 10 * best && best < 1e-6) break; }
    const xiMax = pts[cut][0], X = new Float64Array(nx), Y = new Float64Array(ny);
    for (let i = 0; i < nx; i++){
      const xi = 1 + (xiMax - 1) * i / (nx - 1);
      let j = Math.min(cut - 1, Math.floor((xi - 1) / (xiMax - 1) * cut));
      while (j > 0 && pts[j][0] > xi) j--; while (j < cut - 1 && pts[j + 1][0] < xi) j++;
      const f = (xi - pts[j][0]) / (pts[j + 1][0] - pts[j][0]);
      X[i] = Math.abs(pts[j][1] * (1 - f) + pts[j + 1][1] * f) < 1e-300 ? 0 : pts[j][1] * (1 - f) + pts[j + 1][1] * f;
    }
    for (let i = 0; i < ny; i++){
      const eta = -1 + 2 * i / (ny - 1);
      let v = 0; s.ang.ls.forEach((l, k) => { v += s.ang.coef[k] * Math.sqrt((2 * l + 1) / 2) * legendreP(l, eta); });
      Y[i] = v;
    }
    // normalise ∫|ψ|² dV = 1 with dV = (R/2)³ (ξ² − η²) dξ dη dφ
    let nrm = 0;
    const dxi = (xiMax - 1) / (nx - 1), deta = 2 / (ny - 1);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++){
      const xi = 1 + i * dxi, eta = -1 + j * deta, w = (i === 0 || i === nx - 1 ? 0.5 : 1) * (j === 0 || j === ny - 1 ? 0.5 : 1);
      nrm += w * (X[i] * Y[j]) ** 2 * (xi * xi - eta * eta);
    }
    nrm *= dxi * deta * 2 * Math.PI * (R / 2) ** 3;
    const sc = 1 / Math.sqrt(nrm);
    for (let i = 0; i < nx; i++) X[i] *= sc;
    if (Y[ny - 1] < 0) for (let i = 0; i < ny; i++) Y[i] = -Y[i];
    return { ...s, xiMax, X, Y };
  }
  function legendreP(l, x){
    if (l === 0) return 1; let p0 = 1, p1 = x;
    for (let k = 2; k <= l; k++){ const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
    return p1;
  }
  // vibrational levels of the nuclei on a potential curve U(R) (Hartree), reduced mass μ (mₑ units):
  // finite differences on a uniform grid, lowest eigenvalues by inverse iteration / Sturm bisection
  function vibLevels(Rs, U, mu, count){
    const n = Rs.length, h = Rs[1] - Rs[0], k = 1 / (2 * mu * h * h);
    const d = U.map(u => u + 2 * k), e = -k;
    // Sturm sequence count of eigenvalues below x for the symmetric tridiagonal matrix
    const below = x => { let c = 0, q = 1; for (let i = 0; i < n; i++){ q = d[i] - x - (i ? e * e / q : 0); if (q === 0) q = 1e-300; if (q < 0) c++; } return c; };
    const out = [];
    for (let v = 0; v < count; v++){
      let lo = Math.min(...U), hi = Math.max(...U) + 4 * k;
      for (let it = 0; it < 100; it++){ const m = 0.5 * (lo + hi); if (below(m) > v) hi = m; else lo = m; }
      out.push(0.5 * (lo + hi));
    }
    return out;
  }
  return { angular, shoot, radialA, solve, wavefunction, legendreP, vibLevels };
})();
if (typeof module !== 'undefined') module.exports = H2p;

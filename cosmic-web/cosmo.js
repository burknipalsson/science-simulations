// Flat ΛCDM background, growth, power spectrum and PM time-step factors.
// Units: H0 = 1, lengths in units of the box (comoving). Physical conversions via Cosmo.P.
const Cosmo = (() => {
  const P = { Om: 0.31, Ob: 0.049, OL: 0.69, h: 0.68, ns: 0.965, s8: 0.81, Tcmb: 2.7255, boxMpc: 306.6 };
  const tH = 977.79 / (100 * P.h); // Hubble time in Gyr (14.38)

  const E = a => Math.sqrt(P.Om / (a*a*a) + P.OL);

  // integrate in y = ln a with Simpson's rule
  function simpson(f, y0, y1, n = 64){
    if (y1 === y0) return 0;
    const h = (y1 - y0) / n; let s = f(y0) + f(y1);
    for (let i = 1; i < n; i++) s += f(y0 + i*h) * (i & 1 ? 4 : 2);
    return s * h / 3;
  }
  // age in Gyr: ∫ da/(aE) from 0; analytic for flat ΛCDM without radiation
  function age(a){
    const r = Math.sqrt(P.OL / P.Om) * Math.pow(a, 1.5);
    return tH * 2 / (3 * Math.sqrt(P.OL)) * Math.asinh(r);
  }
  const driftFac = (a0, a1) => simpson(y => { const a = Math.exp(y); return 1 / (a*a*E(a)); }, Math.log(a0), Math.log(a1));
  // kick: dp = -1.5 Ωsrc ∇ψ ∫ da/(a² E), with ∇²ψ = δ
  const kickFac = (a0, a1) => simpson(y => { const a = Math.exp(y); return 1 / (a*E(a)); }, Math.log(a0), Math.log(a1));

  // Growth for a universe where only a fraction fsrc of the matter clusters (fsrc = 1: normal ΛCDM).
  // Returns table over y = ln a of D (unnormalized) and f = dlnD/dlna.
  function growthTable(fsrc){
    const y0 = Math.log(1e-3), y1 = 0, n = 4000, h = (y1 - y0) / n;
    const p = (-1 + Math.sqrt(1 + 24 * fsrc)) / 4;
    const Y = new Float64Array(n + 1), D = new Float64Array(n + 1), F = new Float64Array(n + 1);
    const rhs = (y, d, dp) => {
      const a = Math.exp(y), e2 = P.Om / (a*a*a) + P.OL;
      const dlnH = -1.5 * P.Om / (a*a*a) / e2;
      return [dp, -(2 + dlnH) * dp + 1.5 * fsrc * P.Om / (a*a*a) / e2 * d];
    };
    let d = Math.exp(p * y0), dp = p * d;
    for (let i = 0; i <= n; i++){
      const y = y0 + i*h;
      Y[i] = y; D[i] = d; F[i] = dp / d;
      const k1 = rhs(y, d, dp), k2 = rhs(y + h/2, d + h/2*k1[0], dp + h/2*k1[1]);
      const k3 = rhs(y + h/2, d + h/2*k2[0], dp + h/2*k2[1]), k4 = rhs(y + h, d + h*k3[0], dp + h*k3[1]);
      d += h/6 * (k1[0] + 2*k2[0] + 2*k3[0] + k4[0]); dp += h/6 * (k1[1] + 2*k2[1] + 2*k3[1] + k4[1]);
    }
    const at = (arr, a) => { const t = (Math.log(a) - y0) / h, i = Math.max(0, Math.min(n - 1, Math.floor(t))), w = t - i; return arr[i]*(1-w) + arr[i+1]*w; };
    return { D: a => at(D, a), f: a => at(F, a) };
  }
  const G1 = growthTable(1);
  const D1 = G1.D(1);
  const growth = a => G1.D(a) / D1; // normalized D(1) = 1

  // Eisenstein & Hu (1998) transfer function without baryon wiggles; k in 1/Mpc
  function transfer(k){
    const h = P.h, omh2 = P.Om*h*h, obh2 = P.Ob*h*h, fb = P.Ob/P.Om, th = P.Tcmb / 2.7;
    const s = 44.5 * Math.log(9.83/omh2) / Math.sqrt(1 + 10 * Math.pow(obh2, 0.75));
    const aG = 1 - 0.328 * Math.log(431*omh2) * fb + 0.38 * Math.log(22.3*omh2) * fb*fb;
    const G = P.Om * h * (aG + (1 - aG) / (1 + Math.pow(0.43*k*s, 4)));
    const q = k / h * th*th / G;
    const L0 = Math.log(2*Math.E + 1.8*q), C0 = 14.2 + 731 / (1 + 62.5*q);
    return L0 / (L0 + C0*q*q);
  }
  const shape = k => Math.pow(k, P.ns) * transfer(k) ** 2;
  // normalize to σ8 at z = 0 (R = 8 Mpc/h)
  function sigmaR(R, amp){
    let s = 0; const n = 4000, l0 = Math.log(1e-4), l1 = Math.log(1e2), dl = (l1 - l0) / n;
    for (let i = 0; i <= n; i++){
      const k = Math.exp(l0 + i*dl), x = k*R;
      const W = x < 1e-3 ? 1 : 3 * (Math.sin(x) - x*Math.cos(x)) / (x*x*x);
      s += (i === 0 || i === n ? 0.5 : 1) * amp * shape(k) * W*W * k*k*k / (2*Math.PI*Math.PI) * dl;
    }
    return Math.sqrt(s);
  }
  const AMP = (P.s8 / sigmaR(8 / P.h, 1)) ** 2;
  const power = k => AMP * shape(k); // Mpc³, linear, z = 0

  // elapsed time ∫ da/(aE) in units of 1/H0; also the kick factor for pressure forces
  const timeFac = (a0, a1) => simpson(y => 1 / E(Math.exp(y)), Math.log(a0), Math.log(a1), 32);
  // gas heated to 10⁴ K by the first stars and quasars (reionization, finished by z ≈ 7.5)
  const Tfloor = a => { const z = 1 / a - 1; return z > 9 ? 0 : z < 7.5 ? 1e4 : 1e4 * (9 - z) / 1.5; };
  const RHO_M = P.Om * 2.775e11 * P.h * P.h; // Msun per Mpc³
  const sigmaM = M => sigmaR(Math.cbrt(3 * M / (4 * Math.PI * RHO_M)), AMP);
  // gas and star-formation parameters for a grid of NG cells per side
  function gasParams(NG){
    const secH0 = tH * 3.156e16, cell = P.boxMpc / NG;
    return {
      KT: 3.165e-11,                              // kT/(μ m_p) per kelvin, in (box·H0)²
      K: 5, Cq: 2,                                 // stream relaxation rate, shock viscosity
      eps: 0.15, Tsf: 1e6, Mmin: 1e11,             // star formation: efficiency, too-hot-to-cool scale, smallest galaxy halo
      cool: 3.45 * 1.381e-16 / (1.933e-7 * secH0), // cooling-time constant for mean hydrogen density 1.933e-7 cm⁻³
      Sdiff: sigmaM(1e11) ** 2 - sigmaR(1.7 * cell, AMP) ** 2,
    };
  }
  function stepParams(a0, a1, aph, fsrc){
    const ah = Math.sqrt(a0 * a1);
    return { ah, kick: 1.5 * P.Om * fsrc * kickFac(aph, ah), drift: driftFac(a0, a1), kickH: timeFac(aph, ah), dt: timeFac(a0, a1),
      a: a0, H: E(a0), Tf: Tfloor(a1), dtGyr: timeFac(a0, a1) * tH, D: growth(a0) };
  }
  const T0 = 2.725 * 151 * (51 / 151) ** 2; // gas follows the CMB temperature until z ≈ 150, then cools adiabatically

  return { P, tH, E, age, driftFac, kickFac, timeFac, Tfloor, sigmaM, gasParams, stepParams, T0, growthTable, growth, transfer, power, sigmaR: R => sigmaR(R, AMP) };
})();
if (typeof module !== 'undefined') module.exports = Cosmo;

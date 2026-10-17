/* The Chirp: gravitational waveform model.
   Inspiral: post-Newtonian TaylorT4 (3.5PN phase, 2PN amplitude), non-spinning.
   Black holes: merger and ringdown from the "backwards one body" model (McWilliams 2019),
   matched in frequency and its rate to the inspiral, ringing at the (2,2,0) quasi-normal mode
   of the final hole (Berti et al. 2006 fits). Final mass and spin from non-spinning NR fits.
   Neutron stars: inspiral until the stars touch, then a short, faint post-merger ring.
   Units: G = c = 1, lengths and times in units of the total (detector-frame) mass. */
const Wave = (() => {
  const TSUN = 4.925491e-6;          // G·Msun/c³ in s
  const RSUN_KM = 1.476625;          // G·Msun/c² in km
  const MSUN_C2 = 1.78855e47;        // J
  const LUM = 3.62829e52;            // c⁵/G in W
  const MPC_M = 3.08568e22, LY_M = 9.46073e15;
  const GAMMA_E = 0.5772156649;
  const NS_MAX = 2.5, NS_R_KM = 12;

  // flat ΛCDM: luminosity distance (Mpc) ↔ redshift
  const H0 = 67.7, OM = 0.31, C_KMS = 299792.458;
  function dL(z){ let s = 0; const n = 400; for (let i = 0; i < n; i++){ const zz = (i + 0.5) / n * z; s += 1 / Math.sqrt(OM * (1 + zz) ** 3 + 1 - OM); } return (1 + z) * C_KMS / H0 * s * z / n; }
  function zOfD(D){ let lo = 0, hi = 5; for (let i = 0; i < 60; i++){ const m = (lo + hi) / 2; if (dL(m) < D) lo = m; else hi = m; } return (lo + hi) / 2; }
  function lookbackGyr(z){ let s = 0; const n = 400; for (let i = 0; i < n; i++){ const zz = (i + 0.5) / n * z; s += 1 / ((1 + zz) * Math.sqrt(OM * (1 + zz) ** 3 + 1 - OM)); } return s * z / n * 977.8 / H0; }

  // final state of a non-spinning black-hole merger
  function finalBH(eta){
    const Erad = 0.0559745 * eta + 0.580951 * eta ** 2 - 0.960673 * eta ** 3 + 3.35241 * eta ** 4;   // fraction of M
    const af = Math.sqrt(12) * eta - 3.871 * eta ** 2 + 4.028 * eta ** 3;
    return { Erad, af };
  }
  // l = m = 2, n = 0 quasi-normal mode for mass 1: angular frequency and damping time
  function qnm(a){
    const F = 1.5251 - 1.1568 * Math.pow(1 - a, 0.1292);
    const Q = 0.7 + 1.4187 * Math.pow(1 - a, -0.4990);
    return { w: F, tau: 2 * Q / F };
  }

  // TaylorT4 dx/dt, non-spinning, through 3.5PN
  function dxdt(x, eta){
    const pi = Math.PI, x12 = Math.sqrt(x);
    const a2 = -743 / 336 - 11 / 4 * eta, a3 = 4 * pi;
    const a4 = 34103 / 18144 + 13661 / 2016 * eta + 59 / 18 * eta * eta;
    const a5 = (-4159 / 672 - 189 / 8 * eta) * pi;
    const a6 = 16447322263 / 139708800 - 1712 / 105 * GAMMA_E + 16 / 3 * pi * pi - 856 / 105 * Math.log(16 * x)
      + (-56198689 / 217728 + 451 / 48 * pi * pi) * eta + 541 / 896 * eta * eta - 5605 / 2592 * eta ** 3;
    const a7 = (-4415 / 4032 + 358675 / 6048 * eta + 91495 / 1512 * eta * eta) * pi;
    return 64 / 5 * eta * x ** 5 * (1 + a2 * x + a3 * x * x12 + a4 * x * x + a5 * x * x * x12 + a6 * x ** 3 + a7 * x ** 3 * x12);
  }
  // |r h22 / M| through 2PN (real part)
  function ampPN(x, eta){
    return 8 * Math.sqrt(Math.PI / 5) * eta * x * (1 + x * (-107 / 42 + 55 / 42 * eta) + 2 * Math.PI * x ** 1.5
      + x * x * (-2173 / 1512 - 1069 / 216 * eta + 2047 / 1512 * eta * eta));
  }
  // PN binding energy (positive, fraction of M) through 2PN
  function Ebind(x, eta){
    return 0.5 * eta * x * (1 - (0.75 + eta / 12) * x - (27 / 8 - 19 / 8 * eta + eta * eta / 24) * x * x);
  }

  /* build({m1, m2, D (Mpc), fStart (Hz at Earth)}) → tabulated waveform, time 0 at peak strain */
  function build(o){
    const m1 = Math.max(o.m1, o.m2), m2 = Math.min(o.m1, o.m2);
    const Msrc = m1 + m2, eta = m1 * m2 / (Msrc * Msrc);
    const z = o.z != null ? o.z : zOfD(o.D), D = o.D != null ? o.D : dL(z);
    const Mdet = Msrc * (1 + z), Tm = Mdet * TSUN;        // seconds at Earth per unit M
    const bns = m1 <= NS_MAX && m2 <= NS_MAX;
    const x0 = Math.pow(Math.PI * o.fStart * Tm, 2 / 3);

    const fb = finalBH(eta);
    const Eradfit = bns ? null : fb.Erad;
    const af = bns ? 0.7 : fb.af;
    const Mf = bns ? 0.97 : 1 - fb.Erad;
    const Q = qnm(af);
    const wQ = Q.w / Mf, tauQ = Q.tau * Mf;

    const T = [], PH = [], W = [], A = [];
    const push = (t, ph, w, a) => { T.push(t); PH.push(ph); W.push(w); A.push(a); };
    const xContact = Msrc * RSUN_KM / (2 * NS_R_KM);
    const xm = bns ? xContact : (o.xMatch || 0.16);

    // inspiral: RK4 on (x, phase)
    let t = 0, x = x0, ph = 0;
    const f = xx => dxdt(xx, eta), g = xx => 2 * Math.pow(xx, 1.5);
    for (let guard = 0; guard < 2e7; guard++){
      push(t, ph, g(x), ampPN(x, eta));
      if (x >= xm) break;
      let dt = Math.min(0.05 * 2 * Math.PI / g(x), 0.01 * x / f(x));
      for (let pass = 0; pass < 2; pass++){
        const k1 = f(x), k2 = f(x + dt / 2 * k1), k3 = f(x + dt / 2 * k2), k4 = f(x + dt * k3);
        const xn = x + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4);
        if (xn > xm && pass === 0){ dt *= (xm - x) / (xn - x) ; continue; }
        const p1 = g(x), p2 = g(x + dt / 2 * k1), p3 = g(x + dt / 2 * k2), p4 = g(x + dt * k3);
        ph += dt / 6 * (p1 + 2 * p2 + 2 * p3 + p4);
        x = pass === 1 ? xm : Math.min(xn, xm); t += dt;
        break;
      }
    }
    const tm = t, xmEnd = x;
    let tPeak;

    if (!bns){
      // backwards-one-body merger/ringdown, matched to Ω and dΩ/dt at the end of the inspiral
      const gam = 1 / tauQ, Oq4 = (wQ / 2) ** 4;
      const Om = xmEnd ** 1.5, dOm = 1.5 * Math.sqrt(xmEnd) * f(xmEnd);
      const lhs = 4 * Om ** 3 * dOm, Om4 = Om ** 4;
      const resid = T_ => { const a = (2 * Om4 - Oq4 * (1 + T_)) / (1 - T_); return (Oq4 - a) / 2 * gam * (1 - T_ * T_) - lhs; };
      let lo = -0.999999, hi = Math.min(0.999999, 2 * Om4 / Oq4 - 1);   // keep Ω0⁴ ≥ 0
      // resid is positive at lo side for reasonable matches; bisection on sign change
      const rl = resid(lo);
      for (let i = 0; i < 200; i++){ const mid = (lo + hi) / 2; if (Math.sign(resid(mid)) === Math.sign(rl)) lo = mid; else hi = mid; }
      const Tm_ = (lo + hi) / 2;
      const a0 = (2 * Om4 - Oq4 * (1 + Tm_)) / (1 - Tm_), K = (Oq4 - a0) / 2;
      const tp = tm - Math.atanh(Tm_) / gam;
      const Om_t = tt => Math.pow(a0 + K * (1 + Math.tanh(gam * (tt - tp))), 0.25);
      const sech = u => 1 / Math.cosh(u);
      // strain peak of the BOB shape: max of sech/ω²
      const shape = tt => sech(gam * (tt - tp)) / (2 * Om_t(tt)) ** 2;
      let tpk = tm, best = 0;
      for (let tt = tm; tt < tp + 5 * tauQ; tt += 0.02){ const v = shape(tt); if (v > best){ best = v; tpk = tt; } }
      // amplitude: Hermite from the PN amplitude and slope to the NR peak value (|h22|/η ≈ 1.44 + 0.54η), then BOB decay
      const Apk = eta * (1.44 + 0.54 * eta);
      const Am = ampPN(xmEnd, eta);
      const dAm = (ampPN(xmEnd * 1.001, eta) - Am) / (xmEnd * 0.001) * f(xmEnd);
      const L = tpk - tm;
      const hAmp = tt => {
        if (tt >= tpk) return Apk * shape(tt) / best;
        const s = (tt - tm) / L, s2 = s * s, s3 = s2 * s;
        return (2 * s3 - 3 * s2 + 1) * Am + (s3 - 2 * s2 + s) * L * dAm + (-2 * s3 + 3 * s2) * Apk;
      };
      const tEnd = tp + 40 * tauQ;
      const dt = 0.05;
      t = tm;
      while (t < tEnd){
        const w1 = 2 * Om_t(t), w2 = 2 * Om_t(t + dt / 2), w3 = 2 * Om_t(t + dt);
        ph += dt / 6 * (w1 + 4 * w2 + w3); t += dt;
        push(t, ph, w3, hAmp(t));
      }
      tPeak = tpk;
    } else {
      // neutron stars touch: the inspiral signal shuts off within ~1 ms while the merged star rings at ~2.8 kHz
      const wc = 2 * xmEnd ** 1.5, ac = ampPN(xmEnd, eta);
      const wpm = 2 * Math.PI * 2800 * Msrc * TSUN;
      const ms = 1e-3 / (Msrc * TSUN);                      // one millisecond (source frame) in units of M
      const tEnd = tm + 40 * ms;
      let dt = 0.05; t = tm;
      while (t < tEnd){
        const s = (t - tm) / ms;
        const w = wc + (wpm - wc) * (1 - Math.exp(-s / 0.6));
        const a = ac * (Math.exp(-s / 0.35) + 0.22 * (1 - Math.exp(-s / 0.3)) * Math.exp(-s / 12));
        ph += dt * w; t += dt;
        push(t, ph, w, a);
      }
      tPeak = tm;
    }

    // derived quantities, flux and cumulative energy (fractions of M)
    const n = T.length, F = new Float64Array(n), E = new Float64Array(n);
    for (let i = 0; i < n; i++){
      const i0 = Math.max(0, i - 1), i1 = Math.min(n - 1, i + 1);
      const adot = (A[i1] - A[i0]) / (T[i1] - T[i0]);
      F[i] = (adot * adot + A[i] * A[i] * W[i] * W[i]) / (8 * Math.PI);
    }
    E[0] = Ebind(x0, eta);
    for (let i = 1; i < n; i++) E[i] = E[i - 1] + 0.5 * (F[i] + F[i - 1]) * (T[i] - T[i - 1]);
    const E22 = E[n - 1];
    const Etot = bns ? E22 : Eradfit;
    const eScale = Etot / E22;
    // calibrate only the merger to the NR total, leaving the post-Newtonian inspiral untouched
    let im = 0; while (im < n - 1 && T[im] < tm) im++;
    const Em = E[im], kM = (Etot - Em) / Math.max(E22 - Em, 1e-12);

    // pack into typed arrays in seconds at Earth, t = 0 at peak
    const out = {
      m1, m2, Msrc, eta, z, D, Mdet, Tm, bns, x0, af, Mf, wQ, tauQ, Eradfit, E22, eScale,
      fQNM: wQ / (2 * Math.PI * Tm), tauQNMs: tauQ * Tm,
      n, t: new Float64Array(n), ph: new Float64Array(n), f: new Float64Array(n), a: new Float64Array(n),
      E: new Float64Array(n), P: new Float64Array(n), w: new Float64Array(n),
      tStart: (T[0] - tPeak) * Tm, tEnd: (T[n - 1] - tPeak) * Tm, tMatch: (tm - tPeak) * Tm,
    };
    for (let i = 0; i < n; i++){
      out.t[i] = (T[i] - tPeak) * Tm; out.ph[i] = PH[i]; out.w[i] = W[i];
      out.f[i] = W[i] / (2 * Math.PI * Tm); out.a[i] = A[i];
      const post = i > im; out.E[i] = (post ? Em + (E[i] - Em) * kM : E[i]) * Msrc; out.P[i] = F[i] * (post ? kM : 1) * LUM;
    }
    // where the bodies merge: black holes when the orbit shrinks to ~ the sum of horizon sizes; stars at contact
    out.xMerge = bns ? xmEnd : 0.25;
    out.tMergeBodies = bns ? 0 : out.tMatch;
    for (let i = 0; i < n; i++){ const xi = Math.pow(W[i] / 2, 2 / 3); if (!bns && xi >= out.xMerge){ out.tMergeBodies = out.t[i]; break; } }
    let ip = 0; for (let i = 1; i < n; i++) if (out.a[i] > out.a[ip]) ip = i;
    out.aPeak = out.a[ip]; out.fPeak = out.f[ip];
    let pp = 0; for (let i = 1; i < n; i++) if (out.P[i] > out.P[pp]) pp = i;
    out.Ppeak = out.P[pp];
    // strain at Earth from |r h22/M|: face-on factor √(5/4π), then a typical-orientation factor
    out.hScale = Math.sqrt(5 / (4 * Math.PI)) * 0.53 * Mdet * RSUN_KM * 1e3 / (D * MPC_M);
    return out;
  }

  // index of the last sample with t ≤ tt (binary search)
  function idx(W_, tt){
    const t = W_.t; let lo = 0, hi = W_.n - 1;
    if (tt <= t[0]) return 0; if (tt >= t[hi]) return hi - 1;
    while (hi - lo > 1){ const m = (lo + hi) >> 1; if (t[m] <= tt) lo = m; else hi = m; }
    return lo;
  }
  // state at time tt (s at Earth, 0 = peak). Phase uses cubic Hermite with the frequency as slope.
  function at(W_, tt, out){
    out = out || {};
    const i = idx(W_, tt), j = Math.min(i + 1, W_.n - 1);
    const t0 = W_.t[i], t1 = W_.t[j], h = t1 - t0 || 1;
    let s = Math.max(0, Math.min(1, (tt - t0) / h));
    const w0 = 2 * Math.PI * W_.f[i], w1 = 2 * Math.PI * W_.f[j];
    const s2 = s * s, s3 = s2 * s;
    let ph = (2 * s3 - 3 * s2 + 1) * W_.ph[i] + (s3 - 2 * s2 + s) * h * w0 + (-2 * s3 + 3 * s2) * W_.ph[j] + (s3 - s2) * h * w1;
    const lerp = arr => arr[i] + (arr[j] - arr[i]) * s;
    out.ph = ph; out.f = lerp(W_.f); out.a = lerp(W_.a); out.E = lerp(W_.E); out.P = lerp(W_.P); out.w = lerp(W_.w);
    if (tt < W_.t[0]){       // before the table: extrapolate with the leading-order chirp
      out.a = W_.a[0]; out.E = W_.E[0]; out.P = W_.P[0];
    }
    if (tt > W_.t[W_.n - 1]){ out.a = 0; out.P = 0; }
    out.h = out.a * Math.cos(out.ph);
    return out;
  }
  return { build, at, idx, dL, zOfD, lookbackGyr, finalBH, qnm, TSUN, RSUN_KM, MSUN_C2, LUM, MPC_M, LY_M, NS_MAX };
})();
if (typeof module !== 'undefined') module.exports = Wave;

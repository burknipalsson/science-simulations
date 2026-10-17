// CPU prototype of phase two: dark matter + gas (pressure, shock heating by velocity relaxation,
// adiabatic heating/cooling, radiative cooling, reionization floor) + star formation.
// Mirrors the planned GPU passes so the two can be compared.
const C = require('./cosmo.js'), PM = require('./pm_cpu.js');
const P = C.P, fb = P.Ob / P.Om;

const PHYS = {
  KT: 3.165e-11,          // code velocity² per kelvin (kT/μm_p, μ = 0.6, velocity unit L·H0)
  VU: P.boxMpc * 100 * P.h,
  nH0: 1.933e-7,          // mean hydrogen density today, cm⁻³
  secH0: 977.79 / (100 * P.h) * 3.156e16, // seconds per 1/H0
  zre: 7.5, Tfloor: 1e4, Tsf: +(process.env.TSF || 1e6),
};
const LT = [4.0, 4.2, 4.4, 5.0, 5.4, 5.8, 6.2, 6.6, 7.0, 7.5, 8.0, 8.5];
const LL = [-23.6, -22.2, -21.8, -21.6, -21.7, -22.0, -22.35, -22.6, -22.75, -22.8, -22.65, -22.4];
function lambda(T){
  const l = Math.log10(Math.max(T, 1));
  if (l < LT[0]) return 1e-30;
  if (l >= LT[LT.length - 1]) return 10 ** (LL[LL.length - 1] + 0.5 * (l - LT[LT.length - 1]));
  let i = 0; while (l > LT[i + 1]) i++;
  const w = (l - LT[i]) / (LT[i + 1] - LT[i]);
  return 10 ** (LL[i] * (1 - w) + LL[i + 1] * w);
}
// extended Press–Schechter: fraction of a cell's mass already inside halos above Mmin
function erfc(x){ const z = Math.abs(x), t = 1 / (1 + 0.3275911 * z), y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z * z); return x >= 0 ? y : 2 - y; }
const RHO_M = P.Om * 2.775e11 * P.h * P.h; // Msun / Mpc³
const sigmaM = M => C.sigmaR(Math.cbrt(3 * M / (4 * Math.PI * RHO_M)));
// Mo & White (1996): linear overdensity of a region with nonlinear overdensity δ (spherical collapse fit)
const linDelta = d => { const x = 1 + d; return 1.68647 - 1.35 * Math.pow(x, -2/3) - 1.12431 * Math.pow(x, -0.5) + 0.78785 * Math.pow(x, -0.58661); };
function fcoll(dNl, a, S_min, S_cell){
  const D = C.growth(a), dl = Math.min(linDelta(Math.max(dNl, -0.99)), 1.68) / D;
  return erfc((1.686 / D - dl) / Math.sqrt(2 * (S_min - S_cell)));
}
const kickH = (a0, a1) => { // ∫ da/(aE) = elapsed time in 1/H0
  const n = 32, y0 = Math.log(a0), y1 = Math.log(a1), h = (y1 - y0) / n; if (h === 0) return 0;
  let s = 0; for (let i = 0; i <= n; i++){ const a = Math.exp(y0 + i*h); s += (i === 0 || i === n ? 1 : i & 1 ? 4 : 2) / C.E(a); }
  return s * h / 3;
};
const Tfloor = a => { const z = 1/a - 1; return z > 9 ? 0 : z < PHYS.zre ? PHYS.Tfloor : PHYS.Tfloor * (9 - z) / (9 - PHYS.zre); };

function cicW(x, Ng, cb){
  const u = x[0]*Ng, v = x[1]*Ng, w = x[2]*Ng, i0 = Math.floor(u), j0 = Math.floor(v), k0 = Math.floor(w), fu = u-i0, fv = v-j0, fw = w-k0, M = Ng-1;
  for (let d = 0; d < 8; d++){ const di = d&1, dj = (d>>1)&1, dk = (d>>2)&1;
    cb(((i0+di)&M) + Ng*(((j0+dj)&M) + Ng*((k0+dk)&M)), (di?fu:1-fu)*(dj?fv:1-fv)*(dk?fw:1-fw)); }
}

function makeSim({ Np, Ng, seed = 1, prm }){
  const aS = 1/51;
  const noise = PM.whiteNoise(Ng, seed);
  const psi = PM.displacement(Ng, noise, Math.min(Ng, Np) / 2);
  const A = C.growth(aS), f1 = C.growthTable(1).f(aS), vfac = aS*aS*C.E(aS)*f1*A;
  const n1 = Np**3, N = 2*n1;
  const pos = new Float32Array(3*N), mom = new Float32Array(3*N);
  const T = new Float32Array(n1), fs = new Float32Array(n1), fy = new Float32Array(n1), rl = new Float32Array(n1);
  for (let s = 0; s < 2; s++) for (let k = 0, p = 0; k < Np; k++) for (let j = 0; j < Np; j++) for (let i = 0; i < Np; i++, p++){
    const o = s ? 0.5 : 0, q = [(i+o)/Np, (j+o)/Np, (k+o)/Np], id = s*n1 + p;
    for (let c = 0; c < 3; c++){ const d = PM.trilerp(psi[c], Ng, q[0], q[1], q[2]); pos[3*id+c] = ((q[c] + A*d) % 1 + 1) % 1; mom[3*id+c] = vfac*d; }
  }
  const Tinit = 2.725 * 151 * (51/151) ** 2; // gas follows the CMB until z≈150, then cools adiabatically
  T.fill(Tinit); rl.fill(0);
  const n3 = Ng**3;
  const cellMpc = P.boxMpc / Ng, Rsm = 1.7 * cellMpc;
  const Smin = sigmaM(prm.Mmin) ** 2, Scell = C.sigmaR(Rsm) ** 2;
  return { Np, Ng, N, n1, pos, mom, T, fs, fy, rl, a: aS, aph: aS, prm, Smin, Scell,
    rho: new Float64Array(n3), gM: new Float64Array(n3), gV: [0,1,2].map(() => new Float64Array(n3)), gT: new Float64Array(n3), gS: new Float64Array(n3),
    rhoS: new Float64Array(n3), gRho: new Float64Array(n3) };
}
const mDM = 2 * (1 - fb), mG = 2 * fb;

function blur(src, Ng, rounds = 2){ // [1,2,1] per axis, like the GPU display smoothing
  let a = Float64Array.from(src), b = new Float64Array(src.length); const M = Ng-1;
  for (let r = 0; r < rounds; r++) for (let ax = 0; ax < 3; ax++){
    const st = ax === 0 ? 1 : ax === 1 ? Ng : Ng*Ng;
    for (let z = 0; z < Ng; z++) for (let y = 0; y < Ng; y++) for (let x = 0; x < Ng; x++){
      const c = [x,y,z], i = x + Ng*(y + Ng*z);
      const lo = c.slice(), hi = c.slice(); lo[ax] = (lo[ax]-1)&M; hi[ax] = (hi[ax]+1)&M;
      b[i] = 0.25*a[lo[0]+Ng*(lo[1]+Ng*lo[2])] + 0.5*a[i] + 0.25*a[hi[0]+Ng*(hi[1]+Ng*hi[2])];
    }
    [a, b] = [b, a];
  }
  return a;
}

function step(S, a0, a1){
  const { Ng, N, n1, pos, mom, prm } = S, n3 = Ng**3, mfac = n3 / N, M = Ng-1;
  const aNow = a0, ah = Math.sqrt(a0*a1);
  // ---- deposits
  S.rho.fill(0); S.gM.fill(0); S.gV.forEach(g => g.fill(0)); S.gT.fill(0); S.gS.fill(0);
  for (let p = 0; p < N; p++){
    const x = [pos[3*p], pos[3*p+1], pos[3*p+2]];
    if (p < n1) cicW(x, Ng, (i, w) => { S.rho[i] += w * mDM; });
    else {
      const g = p - n1, fg = 1 - S.fs[g];
      cicW(x, Ng, (i, w) => {
        S.rho[i] += w * mG;
        const m = w * mG * fg;
        S.gM[i] += m; S.gT[i] += m * S.T[g]; S.gS[i] += w * mG * S.fs[g];
        for (let c = 0; c < 3; c++) S.gV[c][i] += m * mom[3*p+c] / aNow;
      });
    }
  }
  for (let i = 0; i < n3; i++){ S.rho[i] = S.rho[i]*mfac - 1; }
  const g = PM.forceGrids(S); // uses S.rho (δ) → -∇ψ
  // ---- gas cell state: density, mean velocity, pressure
  const rhoG = new Float64Array(n3), vbar = [0,1,2].map(() => new Float64Array(n3)), Pc = new Float64Array(n3);
  for (let i = 0; i < n3; i++){
    const m = S.gM[i];
    rhoG[i] = m * mfac;
    for (let c = 0; c < 3; c++) vbar[c][i] = m > 0 ? S.gV[c][i] / m : 0;
    const Tb = m > 0 ? S.gT[i] / m : 0;
    Pc[i] = rhoG[i] * Tb * PHYS.KT;
  }
  const rhoGs = blur(rhoG, Ng, 1), rhoTs = blur(S.rho.map(v => v + 1), Ng, 2);
  const id = (x,y,z) => (x&M) + Ng*((y&M) + Ng*(z&M));
  // physical velocity divergence: Hubble expansion + peculiar flow (comoving gradient / a)
  const Hn = C.E(aNow), theta = new Float64Array(n3), Qc = new Float64Array(n3);
  for (let z = 0; z < Ng; z++) for (let y = 0; y < Ng; y++) for (let x = 0; x < Ng; x++){
    const i = id(x,y,z);
    const dv = (vbar[0][id(x+1,y,z)] - vbar[0][id(x-1,y,z)] + vbar[1][id(x,y+1,z)] - vbar[1][id(x,y-1,z)] + vbar[2][id(x,y,z+1)] - vbar[2][id(x,y,z-1)]) * Ng / 2;
    theta[i] = 3 * Hn + dv / aNow;
    // von Neumann–Richtmyer viscosity where the gas converges: q/ρ = Cq (Δx θ)²
    const dx = aNow / Ng;
    Qc[i] = theta[i] < 0 ? rhoG[i] * prm.Cq * (dx * theta[i]) ** 2 : 0;
  }
  const hA = [0,1,2].map(() => new Float64Array(n3));
  for (let z = 0; z < Ng; z++) for (let y = 0; y < Ng; y++) for (let x = 0; x < Ng; x++){
    const i = id(x,y,z), r = Math.max(rhoG[i], prm.rhoFloor * fb), s = Ng / 2;
    const PQ = (a, b, c) => { const j = id(a,b,c); return Pc[j] + Qc[j]; };
    hA[0][i] = -(PQ(x+1,y,z) - PQ(x-1,y,z)) * s / r;
    hA[1][i] = -(PQ(x,y+1,z) - PQ(x,y-1,z)) * s / r;
    hA[2][i] = -(PQ(x,y,z+1) - PQ(x,y,z-1)) * s / r;
  }
  const qOverRho = new Float64Array(n3);
  for (let i = 0; i < n3; i++) qOverRho[i] = theta[i] < 0 ? prm.Cq * (aNow / Ng * theta[i]) ** 2 : 0;
  // ---- particle update
  const kG = 1.5 * P.Om * C.kickFac(S.aph, ah), kHy = kickH(S.aph, ah), dr = C.driftFac(a0, a1), dt = kickH(a0, a1);
  const sample = (grid, x) => { let s = 0; cicW(x, Ng, (i, w) => { s += w * grid[i]; }); return s; };
  const TfA = Tfloor(a1), dtGyr = dt * 977.79 / (100 * P.h);
  let heat = 0;
  for (let p = 0; p < N; p++){
    const x = [pos[3*p], pos[3*p+1], pos[3*p+2]];
    for (let c = 0; c < 3; c++) mom[3*p+c] += kG * sample(g[c], x);
    if (p >= n1){
      const q = p - n1, fg = 1 - S.fs[q];
      for (let c = 0; c < 3; c++) mom[3*p+c] += kHy * fg * sample(hA[c], x);
      // energy equation: dT/dt = -(2/3)(T + q/ρ/KT) θ  — compression heats, expansion cools, shocks heat through q
      const th = sample(theta, x), qr = sample(qOverRho, x);
      let T = S.T[q] * Math.exp(-2/3 * th * dt);
      if (th < 0) T += 2/3 * qr / PHYS.KT * (-th) * dt;
      // streams can't pass through each other: relax toward the local mean flow, turning the relative motion into heat
      const vb = [0,1,2].map(c => sample(vbar[c], x));
      const ur = [0,1,2].map(c => mom[3*p+c] / aNow - vb[c]);
      const u2 = ur[0]*ur[0] + ur[1]*ur[1] + ur[2]*ur[2];
      const r = Math.exp(-dt * prm.K * (Math.sqrt(u2) + Math.sqrt(1.667 * S.T[q] * PHYS.KT)) * Ng / aNow);
      for (let c = 0; c < 3; c++) mom[3*p+c] = aNow * (vb[c] + ur[c] * r);
      T += u2 * (1 - r*r) / 3 / PHYS.KT;
      heat += T - S.T[q];
      const rg = Math.max(sample(rhoG, x) / fb, 0.02), rphys = rg / (aNow**3);
      // radiative cooling toward the photoionization floor
      const nH = PHYS.nH0 * rphys * prm.clump;
      const tcool = 3.45 * 1.381e-16 * T / (nH * lambda(T)) / PHYS.secH0;
      if (T > TfA) T = TfA + (T - TfA) * Math.exp(-dt / tcool);
      T = Math.max(T, TfA);
      // star formation: gas inside unresolved galaxy halos (EPS collapsed fraction) turns into stars
      // on ~10% of the Hubble time, switched off where the gas is too hot to cool
      const dTot = sample(rhoTs, x) - 1;
      const fc = fcoll(dTot, aNow, S.Smin, S.Scell);
      const quench = 1 / (1 + (T / PHYS.Tsf) ** 2);
      // stars form from gas newly falling into halos (growth of the collapsed fraction)
      const df = Math.min(fg, prm.eps * Math.max(0, fc - S.rl[q]) * quench * fg);
      S.rl[q] = Math.max(S.rl[q], fc);
      S.fs[q] += df; S.fy[q] += df;
      S.fy[q] *= Math.exp(-dtGyr / 0.5);
      S.T[q] = T;
    }
    for (let c = 0; c < 3; c++){ let v = pos[3*p+c] + dr * mom[3*p+c]; v -= Math.floor(v); pos[3*p+c] = v; }
  }
  S.aph = ah; S.a = a1;
  return heat;
}

function stats(S){
  const { n1, T, fs } = S; let st = 0, hot5 = 0, hot7 = 0, gas = 0, Tmax = 0, young = 0;
  for (let q = 0; q < n1; q++){ const fg = 1 - fs[q]; st += fs[q]; young += S.fy[q]; gas += fg; if (T[q] > 1e5) hot5 += fg; if (T[q] > 1e7) hot7 += fg; Tmax = Math.max(Tmax, T[q]); }
  const sorted = Float32Array.from(T).sort();
  return { star: st / n1, hot5: hot5 / n1, hot7: hot7 / n1, Tmax, Tmed: sorted[n1 >> 1], T99: sorted[Math.floor(n1 * 0.99)], young: young / n1 };
}

module.exports = { fcoll, sigmaM, linDelta, erfc, makeSim, step, stats, lambda, kickH, PHYS };

if (require.main === module){
  const [Np, Ng, nSteps] = [+process.argv[2] || 48, +process.argv[3] || 64, +process.argv[4] || 100];
  const prm = { K: +(process.env.K || 30), Cq: +(process.argv[5] || 2), clump: +(process.argv[6] || 10), eps: +(process.argv[7] || 0.05), dth: +(process.argv[8] || 20), rhoFloor: 0.1, Mmin: +(process.env.MMIN || 1e10) };
  const S = makeSim({ Np, Ng, seed: 7, prm });
  const s0 = Math.sqrt(S.a), sched = []; for (let i = 0; i <= nSteps; i++){ const s = s0 + (1-s0)*i/nSteps; sched.push(s*s); }
  let prevStar = 0, prevT = C.age(sched[0]);
  const t0 = Date.now();
  // mass of baryons in the box, for the star formation rate density
  const Mb = P.Ob * 2.775e11 * P.h**2 * P.boxMpc**3, V = P.boxMpc**3;
  for (let i = 0; i < nSteps; i++){
    step(S, sched[i], sched[i+1]);
    if ((i+1) % Math.round(nSteps/12) === 0 || i === nSteps-1){
      const st = stats(S), z = 1/S.a - 1, t = C.age(S.a);
      const sfrd = (st.star - prevStar) * Mb / ((t - prevT) * 1e9) / V;
      const md = 0.015 * (1+z)**2.7 / (1 + ((1+z)/2.9)**5.6) * 0.63; // Madau & Dickinson 2014, Chabrier IMF
      console.log(`z=${z.toFixed(2).padStart(6)} stars=${(st.star*100).toFixed(2)}% hot>1e5=${(st.hot5*100).toFixed(1)}% >1e7=${(st.hot7*100).toFixed(1)}% Tmed=${st.Tmed.toExponential(1)} T99=${st.T99.toExponential(1)} Tmax=${st.Tmax.toExponential(1)}  SFRD=${sfrd.toExponential(2)} MD14=${md.toExponential(2)}`);
      prevStar = st.star; prevT = t;
    }
  }
  console.log('time', ((Date.now()-t0)/1000).toFixed(0), 's');
}

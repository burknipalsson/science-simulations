// Spectral primitive-equation atmosphere on sigma levels (Hoskins & Simmons 1975 form,
// Simmons & Burridge 1981 vertical differencing), semi-implicit leapfrog with a
// Robert-Asselin-Williams filter and implicit del^8 hyperdiffusion.
// Prognostic: vorticity Z, divergence D, temperature deviation T' = T - T0 (spectral),
// log surface pressure LP (spectral). Physics hooks work on the previous step's grid.
function Model(o) {
  const Sp = (typeof Spectral !== 'undefined') ? Spectral : require('./spectral.js');
  const md = this;
  const M = o.M, nlat = o.nlat, nlon = o.nlon, L = o.L;
  const a = o.a || 6.371e6;
  const S = new Sp(M, nlat, nlon, a);
  md.S = S;
  const ns = S.ns, nG = nlat * nlon;
  md.L = L; md.nG = nG; md.nlat = nlat; md.nlon = nlon; md.M = M; md.a = a;
  md.R = 287.04; md.cp = 1004.6; md.kap = md.R / md.cp; md.g = 9.80616;
  md.Om = o.Om !== undefined ? o.Om : 360.98564736629 * Math.PI / 180 / 86400;
  md.T0 = o.T0 || 300;
  md.dt = o.dt || 1200;
  md.ndiff = o.ndiff || 4;          // del^(2*ndiff)
  md.tdiff = o.tdiff || 0.1 * 86400; // damping time at n = M
  md.ra = o.ra || 0.06;             // Robert-Asselin coefficient
  md.raw = 0.53;                    // Williams alpha
  const R = md.R, kap = md.kap;

  // sigma half levels: sh[0]=0 ... sh[L]=1
  const sh = new Float64Array(L + 1);
  if (o.sh) sh.set(o.sh); else for (let k = 0; k <= L; k++) { const s = k / L; sh[k] = 0.5 * (s + (1 - Math.cos(Math.PI * s)) / 2); }
  const ds = new Float64Array(L), sf = new Float64Array(L), lnr = new Float64Array(L), alp = new Float64Array(L);
  for (let k = 0; k < L; k++) {
    ds[k] = sh[k + 1] - sh[k];
    if (k === 0) { lnr[k] = 0; alp[k] = Math.log(2); sf[k] = sh[1] / 2; }
    else { lnr[k] = Math.log(sh[k + 1] / sh[k]); alp[k] = 1 - sh[k] / ds[k] * lnr[k]; sf[k] = sh[k + 1] * Math.exp(-alp[k]); }
  }
  // full-level sigma chosen consistent with the hydrostatic scheme: ln(sh[k+1]/sf[k]) = alpha_k
  md.sh = sh; md.ds = ds; md.sf = sf;

  // hydrostatic matrix G (Phi_k = Phis + sum_j G_kj T_j) and energy-conversion matrix tau
  const G = new Float64Array(L * L), tau = new Float64Array(L * L);
  for (let k = 0; k < L; k++) {
    G[k * L + k] = R * alp[k];
    for (let j = k + 1; j < L; j++) G[k * L + j] = R * Math.log(sh[j + 1] / sh[j]);
    tau[k * L + k] = kap * md.T0 * alp[k];
    for (let j = 0; j < k; j++) tau[k * L + j] = kap * md.T0 * lnr[k] / ds[k] * ds[j];
  }
  md.G = G;

  // ---- state ----
  const sp = () => ({ re: new Float64Array(L * ns), im: new Float64Array(L * ns) });
  const s1 = () => ({ re: new Float64Array(ns), im: new Float64Array(ns) });
  md.Z = [sp(), sp()]; md.D = [sp(), sp()]; md.T = [sp(), sp()]; md.Q = [sp(), sp()]; md.LP = [s1(), s1()];
  md.PHIS = s1();                    // surface geopotential (spectral)
  md.phisG = new Float64Array(nG);
  md.first = true; md.time = 0; md.steps = 0;
  md.setPairs = function (p0, p1) { // restrict grid work to latitude pairs [p0, p1)
    S.p0 = p0; S.p1 = p1; const r = [];
    for (let j = p0; j < p1; j++) r.push(j);
    for (let j = p1 - 1; j >= p0; j--) r.push(nlat - 1 - j);
    r.sort((x, y) => x - y); md.rows = Int32Array.from(r);
  };
  md.setPairs(0, nlat >> 1); md.moist = !!o.moist;

  // grids at current step (level-major)
  const gL = () => new Float64Array(L * nG);
  md.U = gL(); md.V = gL(); md.ZG = gL(); md.DG = gL(); md.TG = gL(); md.QG = gL();
  md.GL = new Float64Array(nG); md.GM = new Float64Array(nG); md.LPG = new Float64Array(nG);
  md.OMEGA = gL(); md.SDOT = gL();   // omega/p and sigma-dot (half level below k)
  // previous-step grids for physics
  md.Up = gL(); md.Vp = gL(); md.Tp = gL(); md.Qp = gL(); md.LPp = new Float64Array(nG);
  // physics tendencies (grid): dU (cos-weighted), dV, dT, and dLP (not used)
  md.pU = gL(); md.pV = gL(); md.pT = gL(); md.pQ = gL();
  const Fu = gL(), Fv = gL(), E = gL(), UT = gL(), VT = gL(), NT = gL(), UQ = gL(), VQ = gL(), NQ = gL();
  const NL = new Float64Array(nG);
  const tZ = sp(), tD = sp(), tT = sp(), tQ = sp(), tL = s1(), tE = s1();
  const Fa = S.newF(), Fb = S.newF();
  const cm = Float64Array.from(S.mu, (x) => 1 - x * x);
  md.cm = cm;

  // ---- semi-implicit matrices per total wavenumber n ----
  const B = new Float64Array(L * L);
  for (let k = 0; k < L; k++) for (let j = 0; j < L; j++) {
    let s = 0; for (let q = 0; q < L; q++) s += G[k * L + q] * tau[q * L + j];
    B[k * L + j] = s + R * md.T0 * ds[j];
  }
  md.B = B;
  function invert(A, n) {
    const m = A.slice(), I = new Float64Array(n * n);
    for (let i = 0; i < n; i++) I[i * n + i] = 1;
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(m[r * n + c]) > Math.abs(m[p * n + c])) p = r;
      if (p !== c) for (let q = 0; q < n; q++) { let t = m[c * n + q]; m[c * n + q] = m[p * n + q]; m[p * n + q] = t; t = I[c * n + q]; I[c * n + q] = I[p * n + q]; I[p * n + q] = t; }
      const d = 1 / m[c * n + c];
      for (let q = 0; q < n; q++) { m[c * n + q] *= d; I[c * n + q] *= d; }
      for (let r = 0; r < n; r++) if (r !== c) { const f = m[r * n + c]; if (f) for (let q = 0; q < n; q++) { m[r * n + q] -= f * m[c * n + q]; I[r * n + q] -= f * I[c * n + q]; } }
    }
    return I;
  }
  let siCache = {};
  function siMats(h) { // h = dt_eff/2 (half of the leapfrog interval)
    const key = h.toFixed(6);
    if (siCache[key]) return siCache[key];
    const mats = [];
    for (let n = 0; n <= M; n++) {
      const c = n * (n + 1) / (a * a), A = new Float64Array(L * L);
      for (let i = 0; i < L * L; i++) A[i] = h * h * c * B[i];
      for (let i = 0; i < L; i++) A[i * L + i] += 1;
      mats.push(invert(A, L));
    }
    return (siCache[key] = mats);
  }
  md.resetSI = () => { siCache = {}; };

  md.setPhis = function (phisGrid) {
    md.phisG.set(phisGrid);
    S.toSpec(phisGrid, md.PHIS.re, md.PHIS.im);
    S.toGrid(md.PHIS.re, md.PHIS.im, md.phisG);
  };

  // ---- dynamics tendencies at current level (index c) ----
  md.physics = null; // function(md) filling pU,pV,pT from Up,Vp,Tp,LPp (grid, previous step)
  const totC = new Float64Array(nG), totA = new Float64Array(nG), cumC = new Float64Array(nG), cumA = new Float64Array(nG);
  const AA = new Float64Array(L * nG), OPN = new Float64Array(L * nG), SDH = new Float64Array((L + 1) * nG);
  md.SDH = SDH;

  function gridsFrom(c) {
    const Z = md.Z[c], D = md.D[c], T = md.T[c], Q = md.Q[c], LP = md.LP[c];
    for (let k = 0; k < L; k++) {
      const so = k * ns, go = k * nG;
      S.uv(Z.re, Z.im, D.re, D.im, md.U, md.V, so, go);
      S.toGrid(Z.re, Z.im, md.ZG, so, go);
      S.toGrid(D.re, D.im, md.DG, so, go);
      S.toGrid(T.re, T.im, md.TG, so, go);
      if (md.moist) S.toGrid(Q.re, Q.im, md.QG, so, go);
    }
    S.toGrid(LP.re, LP.im, md.LPG);
    S.grad(LP.re, LP.im, md.GL, md.GM);
  }
  md.gridsFrom = gridsFrom;

  function tendencies() {
    const U = md.U, V = md.V, ZG = md.ZG, DG = md.DG, TG = md.TG, GLg = md.GL, GMg = md.GM;
    const Om2 = 2 * md.Om, T0 = md.T0, OM = md.OMEGA, SD = md.SDOT;
    const pU = md.pU, pV = md.pV, pT = md.pT, pQ = md.pQ, QG = md.QG, moist = md.moist;
    // pass 1: A = V.grad(lnps), C = D + A, column integrals
    totC.fill(0); totA.fill(0);
    for (let k = 0; k < L; k++) {
      const o = k * nG, dk = ds[k];
      for (const j of md.rows) {
        const icm = 1 / cm[j], r0 = j * nlon;
        for (let i = 0; i < nlon; i++) {
          const p = r0 + i, q = o + p;
          const A = (U[q] * GLg[p] + V[q] * GMg[p]) * icm;
          AA[q] = A; totC[p] += (DG[q] + A) * dk; totA[p] += A * dk;
        }
      }
    }
    for (const j of md.rows) for (let p = j * nlon; p < (j + 1) * nlon; p++) NL[p] = -totA[p];
    // pass 2: sigma-dot on half levels (SDH[k] = interface above level k), omega/p
    cumC.fill(0); cumA.fill(0);
    SDH.fill(0, 0, nG); SDH.fill(0, L * nG);
    for (let k = 0; k < L; k++) {
      const o = k * nG, r = lnr[k] / ds[k], al = alp[k], dk = ds[k], shk = sh[k + 1];
      for (const j of md.rows) for (let p = j * nlon; p < (j + 1) * nlon; p++) {
        const q = o + p, A = AA[q], C = DG[q] + A;
        OM[q] = A - r * cumC[p] - al * C;
        OPN[q] = A - r * cumA[p] - al * A;
        cumC[p] += C * dk; cumA[p] += A * dk;
        if (k < L - 1) SDH[q + nG] = shk * totC[p] - cumC[p];
      }
    }
    // pass 3: nonlinear tendencies
    for (let k = 0; k < L; k++) {
      const o = k * nG, i2 = 0.5 / ds[k], up = k > 0 ? -nG : 0, dn = k < L - 1 ? nG : 0;
      for (const j of md.rows) {
        const f = Om2 * S.mu[j], icm = 1 / cm[j], r0 = j * nlon;
        for (let i = 0; i < nlon; i++) {
          const p = r0 + i, q = o + p;
          const su = SDH[q] * i2, sd = SDH[q + nG] * i2;
          const Tq = TG[q], Uq = U[q], Vq = V[q], abs = ZG[q] + f;
          SD[q] = SDH[q + nG];
          Fu[q] = Vq * abs - (sd * (U[q + dn] - Uq) + su * (Uq - U[q + up])) - R * Tq * GLg[p] + pU[q];
          Fv[q] = -Uq * abs - (sd * (V[q + dn] - Vq) + su * (Vq - V[q + up])) - R * Tq * GMg[p] + pV[q];
          E[q] = (Uq * Uq + Vq * Vq) * 0.5 * icm;
          NT[q] = Tq * DG[q] - (sd * (TG[q + dn] - Tq) + su * (Tq - TG[q + up])) + kap * Tq * OM[q] + kap * T0 * OPN[q] + pT[q];
          UT[q] = Uq * Tq; VT[q] = Vq * Tq;
          if (moist) { const Qq = QG[q]; NQ[q] = Qq * DG[q] - (sd * (QG[q + dn] - Qq) + su * (Qq - QG[q + up])) + pQ[q]; UQ[q] = Uq * Qq; VQ[q] = Vq * Qq; }
        }
      }
    }
    const wd = S.w_div, ia = 1;
    tZ.re.fill(0); tZ.im.fill(0); tD.re.fill(0); tD.im.fill(0); tT.re.fill(0); tT.im.fill(0); tQ.re.fill(0); tQ.im.fill(0);
    for (let k = 0; k < L; k++) {
      const so = k * ns, go = k * nG;
      S.grid2F(Fu, Fa, go); S.grid2F(Fv, Fb, go);
      // D += (1/(a cm)) dFu/dlam + (1/a) dFv/dmu ; Z += (1/(a cm)) dFv/dlam - (1/a) dFu/dmu
      S.legAna(Fa, tD.re, tD.im, false, true, ia, wd, so);
      S.legAna(Fb, tD.re, tD.im, true, false, -ia, wd, so);
      S.legAna(Fb, tZ.re, tZ.im, false, true, ia, wd, so);
      S.legAna(Fa, tZ.re, tZ.im, true, false, ia, wd, so);
      // D -= lap(E + Phis)
      tE.re.fill(0); tE.im.fill(0);
      S.grid2F(E, Fa, go); S.legAna(Fa, tE.re, tE.im, false, false, 1, null);
      const ph0 = S.p0 === 0 ? 1 : 0; // surface geopotential term added once across partitions
      for (let i = 0; i < ns; i++) { const l = S.lap[i]; tD.re[so + i] -= l * (tE.re[i] + ph0 * md.PHIS.re[i]); tD.im[so + i] -= l * (tE.im[i] + ph0 * md.PHIS.im[i]); }
      // T += -div(UT', VT') + NT
      S.grid2F(UT, Fa, go); S.legAna(Fa, tT.re, tT.im, false, true, -ia, wd, so);
      S.grid2F(VT, Fb, go); S.legAna(Fb, tT.re, tT.im, true, false, ia, wd, so);
      S.grid2F(NT, Fa, go); S.legAna(Fa, tT.re, tT.im, false, false, 1, null, so);
      if (md.moist) {
        S.grid2F(UQ, Fa, go); S.legAna(Fa, tQ.re, tQ.im, false, true, -ia, wd, so);
        S.grid2F(VQ, Fb, go); S.legAna(Fb, tQ.re, tQ.im, true, false, ia, wd, so);
        S.grid2F(NQ, Fa, go); S.legAna(Fa, tQ.re, tQ.im, false, false, 1, null, so);
      }
    }
    tL.re.fill(0); tL.im.fill(0);
    S.grid2F(NL, Fa); S.legAna(Fa, tL.re, tL.im, false, false, 1, null);
  }

  // ---- one leapfrog step ----
  const Dbar = new Float64Array(L), rhs = new Float64Array(L);
  // grid stage: grids of the current state, physics, and (partial) spectral tendencies
  md.gridStage = function () {
    const c = 1;
    gridsFrom(c);
    if (md.first) { md.Up.set(md.U); md.Vp.set(md.V); md.Tp.set(md.TG); md.LPp.set(md.LPG); if (md.moist) md.Qp.set(md.QG); }
    if (md.physics) md.physics(md); else { md.pU.fill(0); md.pV.fill(0); md.pT.fill(0); }
    tendencies();
    // save grids of time n for the next step's physics (own rows only)
    saveRows();
  };
  function saveRows() {
    const pairs = [[md.U, md.Up], [md.V, md.Vp], [md.TG, md.Tp]]; if (md.moist) pairs.push([md.QG, md.Qp]);
    for (const j of md.rows) {
      const r0 = j * nlon, r1 = r0 + nlon;
      for (const [a, b] of pairs) for (let k = 0; k < L; k++) { const o = k * nG; b.set(a.subarray(o + r0, o + r1), o + r0); }
      md.LPp.set(md.LPG.subarray(r0, r1), r0);
    }
  }
  md.tend = { Z: tZ, D: tD, T: tT, Q: tQ, L: tL };
  md.step = function () { md.gridStage(); md.advance(); };
  // spectral stage: semi-implicit leapfrog update from the tendencies in md.tend
  md.advance = function () {
    const c = 1, o_ = 0;
    const h = md.first ? md.dt / 2 : md.dt; // half of the leapfrog interval
    const dtl = 2 * h;
    const mats = siMats(h);
    const Zo = md.Z[o_], Do = md.D[o_], To = md.T[o_], Lo = md.LP[o_];
    const Zc = md.Z[c], Dc = md.D[c], Tc = md.T[c], Lc = md.LP[c];
    const T0 = md.T0;
    // new values written into the old arrays (after we keep a copy for the filter)
    const nd = md.ndiff, dfac = new Float64Array(M + 1);
    const dfacq = new Float64Array(M + 1);
    for (let n = 0; n <= M; n++) { const x = Math.pow(n * (n + 1) / (M * (M + 1)), nd); dfac[n] = 1 / (1 + dtl / md.tdiff * x); dfacq[n] = 1 / (1 + dtl / (md.tdiffq || md.tdiff) * x); }
    const keep = md._keep || (md._keep = { Z: sp(), D: sp(), T: sp(), Q: sp(), L: s1() });
    const Qo = md.Q[o_], Qc = md.Q[c];
    if (md.moist) { keep.Q.re.set(Qo.re); keep.Q.im.set(Qo.im); }
    keep.Z.re.set(Zo.re); keep.Z.im.set(Zo.im); keep.D.re.set(Do.re); keep.D.im.set(Do.im);
    keep.T.re.set(To.re); keep.T.im.set(To.im); keep.L.re.set(Lo.re); keep.L.im.set(Lo.im);
    for (let ri = 0; ri < 2; ri++) {
      const part = ri ? 'im' : 're';
      const zo = Zo[part], do_ = Do[part], to = To[part], lo = Lo[part];
      const tz = tZ[part], td = tD[part], tt = tT[part], tl = tL[part], qo = Qo[part], tq = tQ[part], moist = md.moist;
      for (let i = 0; i < ns; i++) {
        const n = S.nOf[i], cn = n * (n + 1) / (a * a), Mi = mats[n];
        // vorticity: explicit
        for (let k = 0; k < L; k++) { const q = k * ns + i; zo[q] = (zo[q] + dtl * tz[q]) * dfac[n]; }
        if (moist) for (let k = 0; k < L; k++) { const q = k * ns + i; qo[q] = (qo[q] + dtl * tq[q]) * dfacq[n]; }
        // implicit gravity-wave part
        const lstar = lo[i] + h * tl[i];
        for (let k = 0; k < L; k++) {
          let gt = 0;
          for (let jj = 0; jj < L; jj++) gt += G[k * L + jj] * (to[jj * ns + i] + h * tt[jj * ns + i]);
          rhs[k] = do_[k * ns + i] + h * td[k * ns + i] + h * cn * (gt + R * T0 * lstar);
        }
        for (let k = 0; k < L; k++) { let s = 0; for (let jj = 0; jj < L; jj++) s += Mi[k * L + jj] * rhs[jj]; Dbar[k] = s; }
        let dsum = 0; for (let k = 0; k < L; k++) dsum += ds[k] * Dbar[k];
        lo[i] = lo[i] + dtl * (tl[i] - dsum);
        for (let k = 0; k < L; k++) {
          let td_ = 0; for (let jj = 0; jj < L; jj++) td_ += tau[k * L + jj] * Dbar[jj];
          const q = k * ns + i;
          to[q] = (to[q] + dtl * (tt[q] - td_)) * dfac[n];
          do_[q] = (2 * Dbar[k] - do_[q]) * dfac[n];
        }
      }
    }
    // Robert-Asselin-Williams filter: old=keep(n-1), cur=(n), new in [o_]
    if (!md.first) {
      const nu = md.ra, al = md.raw;
      const filt = (cur, old, nw) => {
        for (const part of ['re', 'im']) {
          const cc = cur[part], oo = old[part], nn = nw[part];
          for (let i = 0; i < cc.length; i++) { const d = nu * 0.5 * (oo[i] - 2 * cc[i] + nn[i]); cc[i] += al * d; nn[i] -= (1 - al) * d; }
        }
      };
      filt(Zc, keep.Z, Zo); filt(Dc, keep.D, Do); filt(Tc, keep.T, To); filt(Lc, keep.L, Lo);
      if (md.moist) filt(Qc, keep.Q, Qo);
    }
    // swap: new becomes current
    md.Z.reverse(); md.D.reverse(); md.T.reverse(); md.LP.reverse(); md.Q.reverse();
    md.first = false; md.time += md.dt; md.steps++;
  };
  md.tau = tau;
}
if (typeof module !== 'undefined') module.exports = Model;

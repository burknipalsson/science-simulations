// Column physics for the spectral model: an Earth-like extension of Frierson's gray-radiation
// moist GCM. Gray longwave two-stream, shortwave with diurnal/seasonal sun and water-vapour
// absorption, bulk surface fluxes with stability, K-profile boundary layer (implicit),
// simplified Betts-Miller convection, large-scale condensation, and a surface with a slab
// ocean (Q-flux), thermodynamic sea ice, land with soil-water bucket and snow, ice sheets.
const OMEGA_E = 360.98564736629 * Math.PI / 180 / 86400; // 7.2921159e-5 rad/s
function Physics(md, o) {
  const ph = this;
  const L = md.L, nG = md.nG, nlat = md.nlat, nlon = md.nlon, S = md.S;
  const R = md.R, cp = md.cp, g = md.g, kap = md.kap;
  const Lv = 2.5e6, Lf = 3.34e5, Rv = 461.5, EPS = 0.622, SB = 5.670e-8, Tf = 271.35, T0C = 273.15;
  ph.Lv = Lv;
  // ---- adjustable parameters ----
  ph.S0 = 1361;          // solar constant
  ph.obl = 23.44;        // obliquity (deg)
  ph.ecc = 0.0167;
  ph.green = 1;          // greenhouse multiplier on longwave optical depth
  ph.tauE = 5.0; ph.tauP = 1.6; ph.fl = 0.3;  // Frierson-style optical depth (tuned)
  ph.Aatm = 0.24;        // effective atmospheric/cloud reflectance (tuned)
  ph.tswDry = 0.1; ph.kswWV = 0.007;  // shortwave absorption (tuned)
  ph.mld = 50;           // ocean mixed layer depth (m)
  ph.Cland = 3e5;        // land surface heat capacity J/m2/K
  ph.Wcap = 150;         // bucket capacity kg/m2
  ph.tauBM = 7200; ph.rhBM = 0.7;
  ph.qfluxOn = true;
  ph.nudgeTau = 0; ph.nudgeAcc = new Float64Array(md.nG);
  ph.sstMode = false;    // prescribe SST (for Q-flux derivation)
  ph.sidereal = md.Om;   // rotation rate (rad/s)
  ph.qfluxMon = null; ph._qday = -1; ph.rotTarget = 0;
  // change the rotation rate keeping the planet's orientation continuous
  ph.setRotation = function (om, t) { const T = ph.epoch * 86400 + t; ph.rot0 += (ph.sidereal - om) * T; ph.sidereal = om; md.Om = om; };
  ph.orbN = 2 * Math.PI / (365.2422 * 86400 + 0); // orbital mean motion (rad/s) (tropical year)
  ph.epoch = o && o.epoch !== undefined ? o.epoch : 9496.5; // days since J2000 at model t=0 (2026-01-01 00 UT)
  ph.rot0 = 0;           // accumulated rotation angle offset (for changing rotation rate)

  // ---- surface fields ----
  const f64 = () => new Float64Array(nG);
  ph.land = f64(); ph.iceSheet = f64(); ph.zs = f64(); ph.albLand = f64(); ph.z0 = f64();
  ph.Ts = f64(); ph.Tml = f64(); ph.hice = f64(); ph.W = f64(); ph.snow = f64(); ph.qflux = f64();
  ph.sstTarget = f64(); ph.iceTarget = f64();
  // diagnostics
  ph.prec = f64(); ph.precConv = f64(); ph.snowfall = f64(); ph.evap = f64(); ph.olr = f64(); ph.swsfc = f64(); ph.lwdn = f64();
  ph.shf = f64(); ph.lhf = f64(); ph.netSfc = f64(); ph.cldL = f64(); ph.cldM = f64(); ph.cldH = f64(); ph.cldConv = f64();
  ph.slp = f64(); ph.ctt = f64(); ph.t2 = f64(); ph.pblh = f64(); ph.cosz = f64(); ph.cape = f64(); ph.pw = f64(); ph.u10 = f64(); ph.v10 = f64();
  ph.fluxAcc = f64(); ph.swtoa = f64(); ph.asr = f64(); ph.fluxN = 0; // accumulated net surface flux into ocean (for Q-flux)
  ph.RH = new Float32Array(L * nG); // relative humidity (for renderer / diagnostics)
  ph.CLD = new Float32Array(L * nG); // layer cloud fraction
  ph.HEAT = new Float32Array(L * nG); // latent heating K/day (diagnostic)

  // saturation vapour pressure table (Tetens, over liquid), 150..350 K every 0.02 K
  const ESN = 10001, esT = new Float64Array(ESN + 1);
  for (let i = 0; i <= ESN; i++) { const T = 150 + i * 0.02; esT[i] = 610.78 * Math.exp(17.27 * (T - 273.16) / (T - 35.86)); }
  const esF = (T) => { let x = (T - 150) * 50; if (x < 0) x = 0; else if (x > ESN - 1) x = ESN - 1; const i = x | 0, f = x - i; return esT[i] + f * (esT[i + 1] - esT[i]); };
  const qsatF = (T, p) => { const es = esF(T); return EPS * es / Math.max(p - (1 - EPS) * es, es); };
  const dqsF = (T, qs) => qs * 4097.93 / ((T - 35.86) * (T - 35.86));
  ph.qsat = qsatF;

  // sun position: returns declination, sun RA, distance factor, and planet rotation angle
  ph.sun = function (t) {
    const d = ph.epoch + t / 86400;
    const gM = (357.529 + 0.98560028 * d) * Math.PI / 180;
    const qL = (280.459 + 0.98564736 * d) * Math.PI / 180;
    const eF = ph.ecc / 0.0167;
    const lam = qL + eF * (1.915 * Math.sin(gM) + 0.020 * Math.sin(2 * gM)) * Math.PI / 180;
    const r = 1 - ph.ecc * Math.cos(gM) - 0.00014 * eF * Math.cos(2 * gM);
    const ob = ph.obl * Math.PI / 180;
    const dec = Math.asin(Math.sin(ob) * Math.sin(lam));
    const ra = Math.atan2(Math.cos(ob) * Math.sin(lam), Math.cos(lam));
    // Greenwich rotation angle: Earth GMST at J2000 epoch + sidereal rotation since the epoch
    // Greenwich sidereal angle for Earth's true rate; a changed rotation rate accrues through rot0 continuity
    const rot = (280.46061837 * Math.PI / 180) + ph.rot0 + OMEGA_E * (ph.epoch * 86400 + t) + (ph.sidereal - OMEGA_E) * (ph.epoch * 86400 + t);
    return { dec, ra, dist: r, rot, lam };
  };

  // per-column work arrays
  const Tc = new Float64Array(L), qc = new Float64Array(L), uc = new Float64Array(L), vc = new Float64Array(L);
  const pf = new Float64Array(L), phf = new Float64Array(L + 1), mk = new Float64Array(L), zf = new Float64Array(L), zh = new Float64Array(L + 1);
  const dTr = new Float64Array(L), Up = new Float64Array(L + 1), Dn = new Float64Array(L + 1), tr = new Float64Array(L), Bk = new Float64Array(L);
  const Tref = new Float64Array(L), qref = new Float64Array(L), sK = new Float64Array(L);
  const cc = new Float64Array(L + 1), aa = new Float64Array(L), bb = new Float64Array(L), dd = new Float64Array(L), xx = new Float64Array(L), cp_ = new Float64Array(L);
  const T0 = md.T0, sh = md.sh, sf = md.sf, ds = md.ds;
  const tauShape = new Float64Array(L + 1);
  const Tsave = new Float64Array(L), qsave = new Float64Array(L), usave = new Float64Array(L), vsave = new Float64Array(L);
  const alpK = new Float64Array(L), lnK = new Float64Array(L), dlnph = new Float64Array(L);
  for (let k = 0; k < L; k++) { alpK[k] = k === 0 ? Math.log(2) : 1 - sh[k] / ds[k] * Math.log(sh[k + 1] / sh[k]); lnK[k] = k > 0 ? Math.log(sh[k + 1] / sh[k]) : 0; dlnph[k] = k > 0 ? Math.log(sh[k + 1] / sh[k]) : Math.log(2); }
  const trLat = new Float64Array(nlat * L); let trKey = '';
  const fMA = (T, pr) => { const qs = qsatF(T, pr); return (R * T + Lv * qs) / (cp + Lv * Lv * qs / (Rv * T * T)); };
  ph.setShape = () => { for (let k = 0; k <= L; k++) { const s = sh[k]; tauShape[k] = ph.fl * s + (1 - ph.fl) * Math.pow(s, 4); } };
  ph.setShape();

  // tridiagonal implicit diffusion: m_k dX/dt = c_{k+1/2}(X_{k+1}-X_k) - c_{k-1/2}(X_k - X_{k-1}); surface exchange cs toward Xs
  function diffuse(X, cs, Xs, dt) {
    factor(cs, dt); solve(X, cs, Xs, dt);
  }
  const bf = new Float64Array(L);
  function factor(cs, dt) {
    for (let k = 0; k < L; k++) {
      const cu = k > 0 ? cc[k] : 0, cd = k < L - 1 ? cc[k + 1] : cs;
      aa[k] = -dt * cu / mk[k]; cp_[k] = k < L - 1 ? -dt * cd / mk[k] : 0;
      bf[k] = 1 + dt * (cu + cd) / mk[k];
    }
    for (let k = 1; k < L; k++) { aa[k] /= bf[k - 1]; bf[k] -= aa[k] * cp_[k - 1]; }
  }
  function solve(X, cs, Xs, dt) {
    dd[0] = X[0];
    for (let k = 1; k < L; k++) dd[k] = X[k] + (k === L - 1 ? dt * cs * Xs / mk[k] : 0) - aa[k] * dd[k - 1];
    if (L === 1) dd[0] += dt * cs * Xs / mk[0];
    X[L - 1] = dd[L - 1] / bf[L - 1];
    for (let k = L - 2; k >= 0; k--) X[k] = (dd[k] - cp_[k] * X[k + 1]) / bf[k];
  }
  function diffuseOld(X, cs, Xs, dt) {
    for (let k = 0; k < L; k++) {
      const cu = k > 0 ? cc[k] : 0, cd = k < L - 1 ? cc[k + 1] : cs;
      aa[k] = -dt * cu / mk[k]; cp_[k] = k < L - 1 ? -dt * cd / mk[k] : 0;
      bb[k] = 1 + dt * (cu + cd) / mk[k];
      dd[k] = X[k] + (k === L - 1 ? dt * cs * Xs / mk[k] : 0);
    }
    // Thomas
    for (let k = 1; k < L; k++) { const w = aa[k] / bb[k - 1]; bb[k] -= w * cp_[k - 1]; dd[k] -= w * dd[k - 1]; }
    X[L - 1] = dd[L - 1] / bb[L - 1];
    for (let k = L - 2; k >= 0; k--) X[k] = (dd[k] - cp_[k] * X[k + 1]) / bb[k];
  }

  ph.stepCount = 0;
  ph.run = function (md) {
    const swtoa_ = ph.swtoa, asr_ = ph.asr, CLD_ = ph.CLD, HEAT_ = ph.HEAT, RH_ = ph.RH, Tml_ = ph.Tml, Ts_ = ph.Ts, W_ = ph.W, albLand_ = ph.albLand, cape_ = ph.cape, cldConv_ = ph.cldConv, cldH_ = ph.cldH, cldL_ = ph.cldL, cldM_ = ph.cldM, cosz_ = ph.cosz, evap_ = ph.evap, fluxAcc_ = ph.fluxAcc, hice_ = ph.hice, iceSheet_ = ph.iceSheet, iceTarget_ = ph.iceTarget, land_ = ph.land, lhf_ = ph.lhf, lwdn_ = ph.lwdn, netSfc_ = ph.netSfc, olr_ = ph.olr, pblh_ = ph.pblh, prec_ = ph.prec, precConv_ = ph.precConv, pw_ = ph.pw, qflux_ = ph.qflux, shf_ = ph.shf, slp_ = ph.slp, snow_ = ph.snow, snowfall_ = ph.snowfall, sstTarget_ = ph.sstTarget, swsfc_ = ph.swsfc, t2_ = ph.t2, u10_ = ph.u10, v10_ = ph.v10, z0_ = ph.z0, zs_ = ph.zs;
    const dtl = md.first ? md.dt : 2 * md.dt; // leapfrog interval the tendencies act over
    const dts = md.dt;                        // surface time step
    const t = md.time;
    // rotation changes are ramped (at most one e-fold per simulated day) so the winds can adjust
    if (ph.rotTarget && ph.rotTarget !== ph.sidereal) {
      const lc = Math.log(ph.sidereal), lt = Math.log(ph.rotTarget), mx = md.dt / 86400;
      ph.setRotation(Math.abs(lt - lc) <= mx ? ph.rotTarget : Math.exp(lc + Math.sign(lt - lc) * mx), t);
    }
    const sun = ph.sun(t);
    const sdec = Math.sin(sun.dec), cdec = Math.cos(sun.dec), S0 = ph.S0 / (sun.dist * sun.dist);
    const Ug = md.Up, Vg = md.Vp, Tg = md.Tp, Qg = md.Qp, LPg = md.LPp;
    const pU = md.pU, pV = md.pV, pT = md.pT, pQ = md.pQ;
    const green = ph.green, fac = ph.sstMode ? 1 : 0;
    if (ph.sstMode) ph.fluxN++;
    // monthly Q-flux interpolated to the calendar day (months centred mid-month)
    if (ph.qfluxMon && !ph.sstMode) {
      const doy = (((ph.epoch - 9496.5) + t / 86400) % 365.2422 + 365.2422) % 365.2422;
      const dk = Math.floor(doy);
      if (dk !== ph._qday) {
        ph._qday = dk;
        const mf = doy / 365.2422 * 12 - 0.5, m0 = ((Math.floor(mf) % 12) + 12) % 12, m1 = (m0 + 1) % 12, f = mf - Math.floor(mf);
        const A = ph.qfluxMon[m0], B = ph.qfluxMon[m1], Q = ph.qflux;
        for (let p = 0; p < nG; p++) Q[p] = A[p] * (1 - f) + B[p] * f;
      }
    }
    const key = ph.tauE + ',' + ph.tauP + ',' + ph.fl + ',' + green;
    if (key !== trKey) { trKey = key; ph.setShape(); for (let j = 0; j < nlat; j++) { const mu = S.mu[j], t0_ = (ph.tauE + (ph.tauP - ph.tauE) * mu * mu) * green; for (let k = 0; k < L; k++) trLat[j * L + k] = Math.exp(-t0_ * (tauShape[k + 1] - tauShape[k])); } }
    for (const j of md.rows) {
      const mu = S.mu[j], clat = Math.sqrt(1 - mu * mu), ic = 1 / clat;
      const tau0 = (ph.tauE + (ph.tauP - ph.tauE) * mu * mu) * green;
      for (let i = 0; i < nlon; i++) {
        const p = j * nlon + i;
        const ps = Math.exp(LPg[p]);
        for (let k = 0; k < L; k++) {
          const q = k * nG + p;
          Tc[k] = Tg[q] + T0; qc[k] = Math.max(Qg[q], 0); uc[k] = Ug[q] * ic; vc[k] = Vg[q] * ic;
          pf[k] = sf[k] * ps; mk[k] = ps * ds[k] / g;
        }
        for (let k = 0; k <= L; k++) phf[k] = sh[k] * ps;
        const T_in0 = Tc[L - 1];
        Tsave.set(Tc); qsave.set(qc); usave.set(uc); vsave.set(vc);
        // heights
        zh[L] = 0;
        for (let k = L - 1; k >= 0; k--) {
          zf[k] = zh[k + 1] + R * Tc[k] * alpK[k] / g;
          zh[k] = k > 0 ? zh[k + 1] + R * Tc[k] * lnK[k] / g : zf[k] * 2;
        }
        const isLand = land_[p] > 0.5, isSheet = iceSheet_[p] > 0.5;
        let Ts = Ts_[p];
        const iced = !isLand && hice_[p] > 0;

        // ---------- radiation ----------
        // shortwave
        const lonr = S.lon[i];
        const H = sun.rot + lonr - sun.ra;
        const cz = Math.max(0, mu * sdec + clat * cdec * Math.cos(H));
        cosz_[p] = cz; if (cz <= 0) { swtoa_[p] = 0; asr_[p] = 0; }
        let swSfc = 0;
        for (let k = 0; k < L; k++) dTr[k] = 0;
        let alb;
        if (isSheet) alb = 0.75;
        else if (isLand) { const fs = snow_[p] / (snow_[p] + 10); alb = albLand_[p] + (0.62 - albLand_[p]) * fs; }
        else if (iced) { // snow-covered sea ice is bright until it starts melting; thin ice is darker
          const fi = Math.min(1, hice_[p] / 0.3), melt = Math.max(0, Math.min(1, (Ts - (T0C - 3)) / 3));
          alb = 0.07 + (0.78 - 0.22 * melt - 0.07) * fi;
        }
        else alb = 0.06 + 0.04 * Math.pow(1 - cz, 3);
        let pw = 0; for (let k = 0; k < L; k++) pw += qc[k] * mk[k];
        pw_[p] = pw;
        if (cz > 0) {
          let F = S0 * cz * (1 - ph.Aatm);
          const m1 = 1 / Math.max(cz, 0.05);
          for (let k = 0; k < L; k++) {
            const dtau = (ph.tswDry * ds[k] + ph.kswWV * qc[k] * mk[k]) * m1;
            const Fn = F * Math.exp(-dtau);
            dTr[k] += (F - Fn) / (cp * mk[k]);
            F = Fn;
          }
          swSfc = F * (1 - alb);
          swtoa_[p] = S0 * cz; asr_[p] = S0 * cz * (1 - ph.Aatm) - F * alb;
        }
        swsfc_[p] = swSfc;
        // longwave (gray two-stream)
        for (let k = 0; k < L; k++) { tr[k] = trLat[j * L + k]; const T2 = Tc[k] * Tc[k]; Bk[k] = SB * T2 * T2; }
        Dn[0] = 0;
        for (let k = 0; k < L; k++) Dn[k + 1] = Dn[k] * tr[k] + Bk[k] * (1 - tr[k]);
        const Ts2 = Ts * Ts; Up[L] = SB * Ts2 * Ts2;
        for (let k = L - 1; k >= 0; k--) Up[k] = Up[k + 1] * tr[k] + Bk[k] * (1 - tr[k]);
        for (let k = 0; k < L; k++) dTr[k] += ((Up[k + 1] - Dn[k + 1]) - (Up[k] - Dn[k])) / (cp * mk[k]);
        olr_[p] = Up[0]; lwdn_[p] = Dn[L];
        for (let k = 0; k < L; k++) Tc[k] += dtl * dTr[k];

        // ---------- surface exchange + boundary layer ----------
        const za = zf[L - 1];
        const ua = uc[L - 1], va = vc[L - 1];
        const vmag = Math.sqrt(ua * ua + va * va + 1.0);
        const z0 = isLand ? z0_[p] : (iced ? 1e-3 : 1e-4);
        const sa = cp * Tc[L - 1] + g * za;
        const ss = cp * Ts;
        const Rib = g * za * (sa - ss) / (cp * Ts * vmag * vmag);
        const lnz = Math.log(za / z0), CN = 0.16 / (lnz * lnz);
        let fst;
        if (Rib < 0) fst = Math.min(3, Math.sqrt(1 - 16 * Rib)); else fst = 1 / ((1 + 5 * Rib) * (1 + 5 * Rib));
        const Cd = CN * Math.max(fst, 0.05);
        const rho = ps / (R * Tc[L - 1]);
        const cs = rho * Cd * vmag;
        const ustar = Math.sqrt(Cd) * vmag;
        let beta = 1;
        if (isLand && !isSheet) beta = snow_[p] > 0 ? 1 : Math.min(1, W_[p] / (0.75 * ph.Wcap));
        const qsS = qsatF(Ts, ps);
        // boundary-layer height via bulk Richardson number
        const shf0 = cs * (ss - sa); // W/m2 (sensible, provisional)
        const wstar = shf0 > 0 ? Math.cbrt(g / Ts * shf0 / (rho * cp) * 1000) : 0;
        let hbl = za;
        const thS = sa + (shf0 > 0 ? cp * Math.min(3, 8.5 * shf0 / (rho * cp) / Math.max(ustar + 0.5 * wstar, 0.1)) : 0);
        for (let k = L - 2; k >= 0; k--) {
          const sk = cp * Tc[k] + g * zf[k];
          const du = uc[k] - ua, dv = vc[k] - va;
          const ri = g * zf[k] * (sk - thS) / (cp * Tc[L - 1] * (du * du + dv * dv + 100 * ustar * ustar + 1e-2));
          if (ri > 0.25) {
            const skp = cp * Tc[k + 1] + g * zf[k + 1];
            const dup = uc[k + 1] - ua, dvp = vc[k + 1] - va;
            const rip = k + 1 === L - 1 ? 0 : g * zf[k + 1] * (skp - thS) / (cp * Tc[L - 1] * (dup * dup + dvp * dvp + 100 * ustar * ustar + 1e-2));
            hbl = zf[k + 1] + (zf[k] - zf[k + 1]) * Math.max(0, Math.min(1, (0.25 - rip) / (ri - rip)));
            break;
          }
          hbl = zf[k];
        }
        hbl = Math.max(hbl, za); pblh_[p] = hbl;
        const wsc = Math.cbrt(ustar * ustar * ustar + 0.28 * wstar * wstar * wstar * (hbl / 1000));
        for (let k = 0; k < L; k++) sK[k] = cp * Tc[k] + g * zf[k];
        cc[0] = 0;
        for (let k = 0; k < L - 1; k++) { // interface k+1 between level k and k+1
          const zI = zh[k + 1];
          let K = zI < hbl ? 0.4 * wsc * zI * (1 - zI / hbl) * (1 - zI / hbl) : 0;
          if (sK[k] < sK[k + 1]) K = Math.max(K, 30); // dry static instability
          K = Math.max(K, 0.02);
          const rhoI = phf[k + 1] / (R * 0.5 * (Tc[k] + Tc[k + 1]));
          cc[k + 1] = rhoI * K / (zf[k] - zf[k + 1]);
        }
        factor(cs, dtl); solve(sK, cs, ss, dtl); solve(uc, cs, 0, dtl); solve(vc, cs, 0, dtl);
        const shf = cs * (ss - sK[L - 1]);
        for (let k = 0; k < L; k++) Tc[k] = (sK[k] - g * zf[k]) / cp;
        diffuse(qc, cs * beta, qsS, dtl);
        const evap = cs * beta * (qsS - qc[L - 1]);
        u10_[p] = uc[L - 1] * Math.log(10 / z0) / lnz; v10_[p] = vc[L - 1] * Math.log(10 / z0) / lnz;
        shf_[p] = shf; lhf_[p] = Lv * evap; evap_[p] = evap;

        // ---------- simplified Betts-Miller convection ----------
        let precC = 0, conv = 0, ktop = L;
        {
          const T1 = Tc[L - 1], q1 = Math.max(qc[L - 1], 1e-7), p1 = pf[L - 1];
          const e = q1 * p1 / (EPS + (1 - EPS) * q1) / 100;
          const Tl = 2840 / (3.5 * Math.log(T1) - Math.log(Math.max(e, 1e-3)) - 4.805) + 55;
          const pl = p1 * Math.pow(Math.min(Tl, T1) / T1, 1 / kap);
          let cape = 0, found = false;
          let Tp = T1, pp = p1, klcl = L;
          Tref[L - 1] = T1;
          for (let k = L - 1; k >= 0; k--) {
            if (k < L - 1) {
              if (pf[k] >= pl) Tp = T1 * Math.pow(pf[k] / p1, kap);
              else {
                if (pp > pl) { Tp = T1 * Math.pow(pl / p1, kap); pp = pl; }
                // moist adiabat from pp to pf[k] in 2 RK2 substeps in ln p
                const n2 = 2, h = Math.log(pf[k] / pp) / n2;
                for (let s = 0; s < n2; s++) {
                  const pm = pp * Math.exp(h * s);
                  const k1 = fMA(Tp, pm), k2 = fMA(Tp + h * k1, pm * Math.exp(h));
                  Tp += 0.5 * h * (k1 + k2);
                }
                klcl = Math.min(klcl, k);
              }
              pp = pf[k];
            }
            Tref[k] = Tp;
            if (pf[k] < pl) {
              const b = Tp - Tc[k];
              if (b > 0) { cape += R * b * dlnph[k]; found = true; ktop = k; }
              else if (found || pf[k] < 0.55 * ps) break;
            }
          }
          cape_[p] = cape;
          if (found && cape > 10) {
            let Pq = 0, PT = 0, msum = 0;
            for (let k = ktop; k < L; k++) {
              qref[k] = ph.rhBM * qsatF(Tref[k], pf[k]);
              Pq += (qc[k] - qref[k]) * mk[k];
              PT += cp * (Tref[k] - Tc[k]) * mk[k] / Lv;
              msum += mk[k];
            }
            if (Pq > 0 && PT > 0) {
              let sdt = 0; for (let k = ktop; k < L; k++) sdt += (Tref[k] - Tc[k]) * mk[k];
              const dTref = (Lv * Pq - cp * sdt) / (cp * msum);
              const f = Math.min(1, dtl / ph.tauBM);
              for (let k = ktop; k < L; k++) {
                const dT = (Tref[k] + dTref - Tc[k]) * f, dq = (qref[k] - qc[k]) * f;
                Tc[k] += dT; qc[k] += dq;
                HEAT_[k * nG + p] = dT / dtl * 86400;
              }
              precC = Pq * f / dtl; conv = 1;
            }
          }
        }
        if (!conv) for (let k = 0; k < L; k++) HEAT_[k * nG + p] = 0;
        // ---------- large-scale condensation ----------
        let precL = 0;
        for (let k = 0; k < L; k++) {
          if (qc[k] < 0) qc[k] = 0;
          const qs = qsatF(Tc[k], pf[k]);
          if (qc[k] > qs) {
            const dq = (qc[k] - qs) / (1 + Lv / cp * dqsF(Tc[k], qs));
            qc[k] -= dq; Tc[k] += Lv * dq / cp; precL += dq * mk[k] / dtl;
            HEAT_[k * nG + p] += Lv * dq / cp / dtl * 86400;
          }
          RH_[k * nG + p] = qc[k] > qs ? 1 : qc[k] / qs;
        }
        // ---------- top sponge ----------
        for (let k = 0; k < L; k++) if (sf[k] < 0.06) { const kr = (0.06 - sf[k]) / 0.06 / 86400 * 0.8; const f = 1 / (1 + dtl * kr); uc[k] *= f; vc[k] *= f; }

        // ---------- tendencies ----------
        for (let k = 0; k < L; k++) {
          const q = k * nG + p;
          pT[q] = (Tc[k] - Tsave[k]) / dtl; pQ[q] = (qc[k] - qsave[k]) / dtl;
          pU[q] = (uc[k] - usave[k]) / dtl * clat; pV[q] = (vc[k] - vsave[k]) / dtl * clat;
        }
        const prec = precC + precL;
        prec_[p] = prec; precConv_[p] = precC;
        const snowing = T_in0 < T0C - 0.5;
        snowfall_[p] = snowing ? prec : 0;

        // ---------- surface energy budget ----------
        const lwd = Dn[L];
        const G = swSfc + lwd - SB * Ts2 * Ts2 - shf - Lv * evap;
        const dG = -4 * SB * Ts2 * Ts - cs * cp - Lv * cs * beta * dqsF(Ts, qsS);
        netSfc_[p] = G;
        if (isLand) {
          let Tn = Ts + dts * G / (ph.Cland - dts * dG);
          if (isSheet) { Tn = Math.min(Tn, T0C); }
          else {
            // water: rain -> bucket, snow -> pack; evaporation from pack first
            if (snowing) snow_[p] += prec * dts; else W_[p] += prec * dts;
            let ev = evap * dts;
            if (snow_[p] > 0) { const e2 = Math.min(ev, snow_[p]); snow_[p] -= e2; ev -= e2; }
            W_[p] = Math.max(0, W_[p] - ev);
            if (snow_[p] > 0 && Tn > T0C) {
              const melt = Math.min(snow_[p], ph.Cland * (Tn - T0C) / Lf);
              snow_[p] -= melt; W_[p] += melt; Tn -= melt * Lf / ph.Cland;
            }
            if (W_[p] > ph.Wcap) W_[p] = ph.Wcap;
            if (snow_[p] > 2000) snow_[p] = 2000;
          }
          Ts_[p] = Tn;
        } else if (ph.sstMode) {
          fluxAcc_[p] += G;
          Ts_[p] = sstTarget_[p]; Tml_[p] = sstTarget_[p];
          hice_[p] = iceTarget_[p];
          if (hice_[p] > 0) {
            // ice surface temperature from balance with conduction through prescribed ice
            const ki = 2.03 / Math.max(hice_[p], 0.2);
            let Tn = Ts + dts * (G + ki * (Tf - Ts)) / (2e5 - dts * (dG - ki));
            Ts_[p] = Math.min(Tn, T0C);
          }
        } else {
          const Cml = 4.18e6 * ph.mld;
          let Q = ph.qfluxOn ? qflux_[p] : 0;
          if (ph.nudgeTau > 0) { // restoring toward observed SST / sea ice (used to derive the Q-flux correction)
            const eqv = 917 * Lf / Cml;
            const Tm = hice_[p] > 0 ? Tf - hice_[p] * eqv : Tml_[p];
            const To = iceTarget_[p] > 0 ? Tf - iceTarget_[p] * eqv : Math.max(sstTarget_[p], Tf);
            const Fn = Cml * (To - Tm) / ph.nudgeTau;
            Q += Fn; ph.nudgeAcc[p] += Fn;
          }
          if (hice_[p] <= 0) {
            let Tn = Ts + dts * (G + Q) / (Cml - dts * dG);
            if (Tn < Tf) { hice_[p] = Cml * (Tf - Tn) / (917 * Lf); Tn = Tf; }
            Ts_[p] = Tn; Tml_[p] = Tn;
          } else {
            const hi = hice_[p], ki = 2.03 / Math.max(hi, 0.1);
            let Tn = Ts + dts * (G + ki * (Tf - Ts)) / (2e5 - dts * (dG - ki));
            let melt = 0;
            if (Tn > T0C) { melt = 2e5 * (Tn - T0C) / Lf; Tn = T0C; }
            const Fc = ki * (Tf - Tn);
            // basal growth: heat conducted up through the ice (Fc > 0 when the surface is colder than the
            // freezing ocean) is taken from the water at the base, which freezes; ocean heat (Q + 2 W/m2) melts it
            const dh = dts * (Fc - (Q + 2)) / (917 * Lf);
            let hn = hi + dh - melt / 917;
            if (snowing) hn += prec * dts / 917 * 0.3;
            if (hn <= 0) { hice_[p] = 0; Tml_[p] = Tf - hn * 917 * Lf / Cml; Ts_[p] = Tml_[p]; }
            else { hice_[p] = Math.min(hn, 8); Ts_[p] = Tn; Tml_[p] = Tf; }
          }
        }
        // ---------- diagnostics: clouds, sea-level pressure ----------
        let cl = 0, cm_ = 0, chh = 0;
        for (let k = 0; k < L; k++) {
          const q = k * nG + p, rh = RH_[q], s = sf[k];
          const rc = s > 0.8 ? 0.84 : s > 0.45 ? 0.7 : 0.62;
          let c = rh > rc ? Math.min(1, (rh - rc) / (1 - rc)) : 0;
          c = c * c;
          // layered cloud above the boundary layer needs rising air (fronts, cyclones); sinking air clears it
          if (s < 0.8) { const om = md.OMEGA[q] * pf[k]; c *= Math.max(0, Math.min(1, 0.45 - om / 0.12)); }
          CLD_[q] = c;
          if (s > 0.68) cl = Math.max(cl, c); else if (s > 0.44) cm_ = Math.max(cm_, c); else chh = Math.max(chh, c);
        }
        const pc = precC * 86400; // mm/day
        const ccv = pc > 0.1 ? Math.min(0.95, 0.12 + 0.13 * Math.log(1 + pc)) : 0;
        if (conv && sf[ktop] < 0.44) chh = Math.max(chh, ccv); else if (conv) cm_ = Math.max(cm_, ccv * 0.7);
        cldL_[p] = cl; cldM_[p] = cm_; cldH_[p] = chh; cldConv_[p] = ccv;
        const TL = Tsave[L - 1], zsp = md.phisG[p] / g;
        const Tsx = TL * Math.pow(1 / sf[L - 1], R * 0.0065 / g);
        slp_[p] = ps * Math.exp(g * zsp / (R * (Tsx + 0.00325 * zsp)));
        // cloud-top temperature (for the infrared view): highest layer with substantial cloud, or the convective top
        let ct = Ts_[p];
        for (let k = 0; k < L; k++) { if (CLD_[k * nG + p] > 0.3 || (conv && k === ktop && ccv > 0.25)) { ct = Tc[k]; break; } }
        ph.ctt[p] = ct;
        t2_[p] = Tsx;
      }
    }
    ph.stepCount++;
  };
}
if (typeof module !== 'undefined') module.exports = Physics;

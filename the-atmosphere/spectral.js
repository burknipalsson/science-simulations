// Spectral transform engine: Gaussian grid, normalised associated Legendre functions,
// mixed-radix FFT (NH/SH rows packed into one complex transform), and the operators a
// spectral primitive-equation model needs (winds from vorticity/divergence, divergence
// and curl of vector fields, gradients).
function Spectral(M, nlat, nlon, a) {
  const S = this;
  S.M = M; S.nlat = nlat; S.nlon = nlon; S.a = a;
  const nh = nlat >> 1, M1 = M + 1;
  S.nh = nh;
  S.p0 = 0; S.p1 = nh; // latitude-pair range handled by this instance (for parallel decomposition)
  // spectral indexing: triangular truncation, m = 0..M, n = m..M
  const off = new Int32Array(M1 + 1);
  for (let m = 0; m <= M; m++) off[m + 1] = off[m] + (M1 - m);
  const ns = off[M1];
  S.off = off; S.ns = ns;
  const nOf = new Int32Array(ns), mOf = new Int32Array(ns);
  for (let m = 0; m <= M; m++) for (let n = m; n <= M; n++) { nOf[off[m] + n - m] = n; mOf[off[m] + n - m] = m; }
  S.nOf = nOf; S.mOf = mOf;
  S.lap = new Float64Array(ns); S.ilap = new Float64Array(ns);
  for (let i = 0; i < ns; i++) { const n = nOf[i]; S.lap[i] = -n * (n + 1) / (a * a); S.ilap[i] = n ? -(a * a) / (n * (n + 1)) : 0; }

  // Gaussian latitudes (north to south) and weights
  const mu = new Float64Array(nlat), w = new Float64Array(nlat);
  for (let i = 0; i < nh; i++) {
    let x = Math.cos(Math.PI * (i + 0.75) / (nlat + 0.5)), dp = 0;
    for (let it = 0; it < 100; it++) {
      let p0 = 1, p1 = x;
      for (let k = 2; k <= nlat; k++) { const p2 = ((2 * k - 1) * x * p1 - (k - 1) * p0) / k; p0 = p1; p1 = p2; }
      dp = nlat * (x * p1 - p0) / (x * x - 1);
      const dx = p1 / dp; x -= dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    mu[i] = x; mu[nlat - 1 - i] = -x;
    w[i] = w[nlat - 1 - i] = 2 / ((1 - x * x) * dp * dp);
  }
  S.mu = mu; S.w = w;
  S.lat = Float64Array.from(mu, Math.asin);
  S.coslat = Float64Array.from(mu, (x) => Math.sqrt(1 - x * x));
  S.lon = Float64Array.from({ length: nlon }, (_, i) => 2 * Math.PI * i / nlon);

  // normalised ALFs, int_{-1}^{1} P^2 dmu = 1; P and H = (1-mu^2) dP/dmu for the northern rows
  const eps = (n, m) => Math.sqrt((n * n - m * m) / (4 * n * n - 1));
  const P = new Float64Array(nh * ns), H = new Float64Array(nh * ns);
  const tmp = new Float64Array(M + 3);
  for (let j = 0; j < nh; j++) {
    const x = mu[j], c = Math.sqrt(1 - x * x);
    let pmm = 1 / Math.SQRT2;
    for (let m = 0; m <= M; m++) {
      if (m > 0) pmm *= Math.sqrt((2 * m + 1) / (2 * m)) * c;
      tmp[m] = pmm;
      tmp[m + 1] = Math.sqrt(2 * m + 3) * x * pmm;
      for (let n = m + 2; n <= M + 1; n++) tmp[n] = (x * tmp[n - 1] - eps(n - 1, m) * tmp[n - 2]) / eps(n, m);
      for (let n = m; n <= M; n++) {
        const i = j * ns + off[m] + n - m;
        P[i] = tmp[n];
        H[i] = -n * eps(n + 1, m) * tmp[n + 1] + (n + 1) * eps(n, m) * (n > m ? tmp[n - 1] : 0);
      }
    }
  }
  S.P = P; S.H = H;

  // ---------- FFT (mixed radix 2/3/4/5), complex, in place via scratch ----------
  const N = nlon;
  const fac = [];
  { let r = N; for (const f of [4, 2, 3, 5]) while (r % f === 0) { fac.push(f); r /= f; } if (r !== 1) throw new Error('nlon must factor into 2,3,5'); }
  const twr = new Float64Array(N), twi = new Float64Array(N);
  for (let k = 0; k < N; k++) { twr[k] = Math.cos(2 * Math.PI * k / N); twi[k] = -Math.sin(2 * Math.PI * k / N); }
  const bre = new Float64Array(N), bim = new Float64Array(N);
  // Stockham autosort, forward (sign -1), hand-coded radix 4/2/3/5 butterflies. Inverse via conjugation.
  const stages = []; { let l = 1, mm = N; for (const p of fac) { mm /= p; stages.push([p, mm, l]); l *= p; } }
  const S3 = Math.sqrt(3) / 2;
  function fft(re, im) {
    let xr = re, xi = im, yr = bre, yi = bim;
    for (const [p, mm, l] of stages) {
      const ts = N / (l * p);
      for (let k = 0; k < l; k++) {
        const t1 = ts * k, c1 = twr[t1], s1 = twi[t1];
        if (p === 4) {
          const t2 = 2 * t1, t3 = 3 * t1, c2 = twr[t2], s2 = twi[t2], c3 = twr[t3], s3 = twi[t3];
          for (let j = 0; j < mm; j++) {
            const i0 = j * l + k, st = mm * l;
            const a0r = xr[i0], a0i = xi[i0];
            let r = xr[i0 + st], q = xi[i0 + st]; const a1r = r * c1 - q * s1, a1i = r * s1 + q * c1;
            r = xr[i0 + 2 * st]; q = xi[i0 + 2 * st]; const a2r = r * c2 - q * s2, a2i = r * s2 + q * c2;
            r = xr[i0 + 3 * st]; q = xi[i0 + 3 * st]; const a3r = r * c3 - q * s3, a3i = r * s3 + q * c3;
            const b0r = a0r + a2r, b0i = a0i + a2i, b1r = a0r - a2r, b1i = a0i - a2i;
            const b2r = a1r + a3r, b2i = a1i + a3i, b3r = a1r - a3r, b3i = a1i - a3i;
            const d = j * 4 * l + k;
            yr[d] = b0r + b2r; yi[d] = b0i + b2i;
            yr[d + l] = b1r + b3i; yi[d + l] = b1i - b3r;
            yr[d + 2 * l] = b0r - b2r; yi[d + 2 * l] = b0i - b2i;
            yr[d + 3 * l] = b1r - b3i; yi[d + 3 * l] = b1i + b3r;
          }
        } else if (p === 2) {
          for (let j = 0; j < mm; j++) {
            const i0 = j * l + k, i1 = i0 + mm * l;
            const r = xr[i1], q = xi[i1], vr = r * c1 - q * s1, vi = r * s1 + q * c1;
            const d = j * 2 * l + k;
            yr[d] = xr[i0] + vr; yi[d] = xi[i0] + vi; yr[d + l] = xr[i0] - vr; yi[d + l] = xi[i0] - vi;
          }
        } else if (p === 3) {
          const t2 = 2 * t1, c2 = twr[t2], s2 = twi[t2];
          for (let j = 0; j < mm; j++) {
            const i0 = j * l + k, st = mm * l;
            const a0r = xr[i0], a0i = xi[i0];
            let r = xr[i0 + st], q = xi[i0 + st]; const a1r = r * c1 - q * s1, a1i = r * s1 + q * c1;
            r = xr[i0 + 2 * st]; q = xi[i0 + 2 * st]; const a2r = r * c2 - q * s2, a2i = r * s2 + q * c2;
            const tr = a1r + a2r, ti = a1i + a2i, ur = (a1r - a2r) * S3, ui = (a1i - a2i) * S3;
            const mr = a0r - 0.5 * tr, mi = a0i - 0.5 * ti;
            const d = j * 3 * l + k;
            yr[d] = a0r + tr; yi[d] = a0i + ti;
            yr[d + l] = mr + ui; yi[d + l] = mi - ur;
            yr[d + 2 * l] = mr - ui; yi[d + 2 * l] = mi + ur;
          }
        } else {
          for (let j = 0; j < mm; j++) {
            const ar = [], ai = [];
            for (let q = 0; q < p; q++) {
              const src = (q * mm + j) * l + k, t = (t1 * q) % N, r0 = xr[src], i0 = xi[src];
              ar.push(r0 * twr[t] - i0 * twi[t]); ai.push(r0 * twi[t] + i0 * twr[t]);
            }
            for (let s = 0; s < p; s++) {
              let sr = 0, si = 0;
              for (let q = 0; q < p; q++) { const t = ((s * q) % p) * (N / p); sr += ar[q] * twr[t] - ai[q] * twi[t]; si += ar[q] * twi[t] + ai[q] * twr[t]; }
              const dst = (j * p + s) * l + k; yr[dst] = sr; yi[dst] = si;
            }
          }
        }
      }
      const q1 = xr, q2 = xi; xr = yr; xi = yi; yr = q1; yi = q2;
    }
    if (xr !== re) { re.set(xr); im.set(xi); }
  }
  S.fft = fft;
  const cr = new Float64Array(N), ci = new Float64Array(N);

  // Fourier buffers: F[(j*M1 + m)*2 + reim], j = 0..nlat-1 north to south
  S.newF = () => new Float64Array(nlat * M1 * 2);
  S.newGrid = () => new Float64Array(nlat * nlon);
  S.newSpec = () => ({ re: new Float64Array(ns), im: new Float64Array(ns) });

  // grid (one level) -> Fourier coefficients c_m = (1/N) sum f e^{-im lam}
  S.grid2F = function (g, F, go = 0) {
    for (let j = S.p0; j < S.p1; j++) {
      const js = nlat - 1 - j;
      for (let i = 0; i < N; i++) { cr[i] = g[go + j * N + i]; ci[i] = g[go + js * N + i]; }
      fft(cr, ci);
      const fn = j * M1 * 2, fs = js * M1 * 2;
      for (let m = 0; m <= M; m++) {
        const k2 = m ? N - m : 0;
        const zr = cr[m], zi = ci[m], wr = cr[k2], wi = -ci[k2]; // w = conj(Z[N-m])
        F[fn + 2 * m] = (zr + wr) * 0.5 / N; F[fn + 2 * m + 1] = (zi + wi) * 0.5 / N;
        F[fs + 2 * m] = (zi - wi) * 0.5 / N; F[fs + 2 * m + 1] = -(zr - wr) * 0.5 / N;
      }
    }
  };
  // Fourier -> grid, f = Re sum_m (2 - delta_m0) c_m e^{im lam}
  S.F2grid = function (F, g, go = 0) {
    for (let j = S.p0; j < S.p1; j++) {
      const js = nlat - 1 - j, fn = j * M1 * 2, fs = js * M1 * 2;
      cr.fill(0); ci.fill(0);
      // Z_m = a_m + i b_m (a: north row, b: south row), Z_{N-m} = conj(a_m) + i conj(b_m)
      cr[0] = F[fn]; ci[0] = F[fs];
      for (let m = 1; m <= M; m++) {
        const ar = F[fn + 2 * m], ai = F[fn + 2 * m + 1], br = F[fs + 2 * m], bi = F[fs + 2 * m + 1];
        cr[m] = ar - bi; ci[m] = ai + br;
        cr[N - m] = ar + bi; ci[N - m] = -ai + br;
      }
      // inverse = conj(fft(conj(x)))
      for (let i = 0; i < N; i++) ci[i] = -ci[i];
      fft(cr, ci);
      for (let i = 0; i < N; i++) { g[go + j * N + i] = cr[i]; g[go + js * N + i] = -ci[i]; }
    }
  };

  // Legendre synthesis: F += scale * sum_n s_nm T_nm(mu_j) [* i m if dlam]; T = P or H
  // so = offset into spectral arrays (for multi-level storage)
  S.legSyn = function (F, sre, sim, useH, dlam, scale, so = 0) {
    const T = useH ? H : P;
    for (let j = S.p0; j < S.p1; j++) {
      const js = nlat - 1 - j, fn = j * M1 * 2, fs = js * M1 * 2, tb = j * ns;
      for (let m = 0; m <= M; m++) {
        let er = 0, ei = 0, or_ = 0, oi = 0;
        const o = off[m], cnt = M1 - m;
        for (let q = 0; q < cnt; q += 2) { const t = T[tb + o + q]; er += sre[so + o + q] * t; ei += sim[so + o + q] * t; }
        for (let q = 1; q < cnt; q += 2) { const t = T[tb + o + q]; or_ += sre[so + o + q] * t; oi += sim[so + o + q] * t; }
        // P: even part symmetric; H: even part antisymmetric
        let nr = er + or_, ni = ei + oi, sr, si;
        if (useH) { sr = -er + or_; si = -ei + oi; } else { sr = er - or_; si = ei - oi; }
        if (dlam) { let t = nr; nr = -m * ni; ni = m * t; t = sr; sr = -m * si; si = m * t; }
        F[fn + 2 * m] += scale * nr; F[fn + 2 * m + 1] += scale * ni;
        F[fs + 2 * m] += scale * sr; F[fs + 2 * m + 1] += scale * si;
      }
    }
  };
  // Legendre analysis: s += sum_j w_j * lw_j * scale * F_jm T_nm(mu_j) [* i m if dlam]
  // lw: optional per-latitude weight array (length nlat) or null
  S.legAna = function (F, sre, sim, useH, dlam, scale, lw, so = 0) {
    const T = useH ? H : P;
    for (let j = S.p0; j < S.p1; j++) {
      const js = nlat - 1 - j, fn = j * M1 * 2, fs = js * M1 * 2, tb = j * ns;
      const wn = w[j] * scale * (lw ? lw[j] : 1), ws = w[js] * scale * (lw ? lw[js] : 1);
      for (let m = 0; m <= M; m++) {
        let anr = F[fn + 2 * m] * wn, ani = F[fn + 2 * m + 1] * wn, asr = F[fs + 2 * m] * ws, asi = F[fs + 2 * m + 1] * ws;
        if (dlam) { let t = anr; anr = -m * ani; ani = m * t; t = asr; asr = -m * asi; asi = m * t; }
        // even (n-m): P symmetric -> N+S ; H antisymmetric -> N-S
        let er, ei, or_, oi;
        if (useH) { er = anr - asr; ei = ani - asi; or_ = anr + asr; oi = ani + asi; }
        else { er = anr + asr; ei = ani + asi; or_ = anr - asr; oi = ani - asi; }
        const o = off[m], cnt = M1 - m;
        for (let q = 0; q < cnt; q += 2) { const t = T[tb + o + q]; sre[so + o + q] += er * t; sim[so + o + q] += ei * t; }
        for (let q = 1; q < cnt; q += 2) { const t = T[tb + o + q]; sre[so + o + q] += or_ * t; sim[so + o + q] += oi * t; }
      }
    }
  };

  // weights 1/(a(1-mu^2)) per latitude
  S.w_div = Float64Array.from(mu, (x) => 1 / (a * (1 - x * x)));
  const Fa = S.newF(), Fb = S.newF();
  const ps = S.newSpec(), cs = S.newSpec();

  // spectral scalar -> grid
  S.toGrid = function (sre, sim, g, so = 0, go = 0) {
    Fa.fill(0); S.legSyn(Fa, sre, sim, false, false, 1, so); S.F2grid(Fa, g, go);
  };
  // grid -> spectral scalar (overwrites)
  S.toSpec = function (g, sre, sim, so = 0, go = 0) {
    for (let i = 0; i < ns; i++) { sre[so + i] = 0; sim[so + i] = 0; }
    S.grid2F(g, Fa, go); S.legAna(Fa, sre, sim, false, false, 1, null, so);
  };
  // cos-weighted gradient of spectral scalar: gl = (1/a) df/dlam, gm = ((1-mu^2)/a) df/dmu
  S.grad = function (sre, sim, gl, gm, so = 0, go = 0) {
    Fa.fill(0); S.legSyn(Fa, sre, sim, false, true, 1 / a, so); S.F2grid(Fa, gl, go);
    Fa.fill(0); S.legSyn(Fa, sre, sim, true, false, 1 / a, so); S.F2grid(Fa, gm, go);
  };
  // U = u cos(phi), V = v cos(phi) from vorticity and divergence spectra
  S.uv = function (zre, zim, dre, dim, U, V, so = 0, go = 0) {
    for (let i = 0; i < ns; i++) { const l = S.ilap[i]; ps.re[i] = zre[so + i] * l; ps.im[i] = zim[so + i] * l; cs.re[i] = dre[so + i] * l; cs.im[i] = dim[so + i] * l; }
    Fa.fill(0); S.legSyn(Fa, cs.re, cs.im, false, true, 1 / a); S.legSyn(Fa, ps.re, ps.im, true, false, -1 / a); S.F2grid(Fa, U, go);
    Fa.fill(0); S.legSyn(Fa, ps.re, ps.im, false, true, 1 / a); S.legSyn(Fa, cs.re, cs.im, true, false, 1 / a); S.F2grid(Fa, V, go);
  };
  // spectral of (1/(a(1-mu^2))) dA/dlam + (1/a) dB/dmu, ADDED into s (times scale)
  S.divAdd = function (A, B, sre, sim, scale, so = 0, go = 0) {
    S.grid2F(A, Fa, go); S.legAna(Fa, sre, sim, false, true, scale, S.w_div, so);
    S.grid2F(B, Fb, go); S.legAna(Fb, sre, sim, true, false, -scale, S.w_div, so);
  };
  S.Fa = Fa; S.Fb = Fb;
}
if (typeof module !== 'undefined') module.exports = Spectral;

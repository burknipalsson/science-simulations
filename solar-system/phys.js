// Solar-system N-body physics: bodies, forces (Newton + Einstein 1PN + Earth's bulge + lunar tides),
// a 6th-order symplectic integrator, an ephemeris cache with checkpoints, and time scales.
// Units: AU, days, TDB. Frame: ecliptic and equinox of J2000, barycentric.
const PHYS = (() => {
  const C = 173.1446326846693;            // speed of light, AU/day
  const AU_KM = 149597870.7;
  const KM3S2 = 86400 * 86400 / Math.pow(AU_KM, 3); // km^3/s^2 -> AU^3/d^2
  const EPOCH = 2461041.5;                 // JD TDB of the initial state (2026-01-01 0h TDB)
  // name, GM (km^3/s^2, DE440), radius km, colour
  const BODIES = [
    ['Sun', 132712440041.279419, 695700],
    ['Mercury', 22031.868551, 2439.4],
    ['Venus', 324858.592, 6051.8],
    ['Earth', 398600.435507, 6371.0],
    ['Moon', 4902.800118, 1737.4],
    ['Mars', 42828.375816, 3389.5],
    ['Jupiter', 126712764.1, 69911],
    ['Saturn', 37940584.8418, 58232],
    ['Uranus', 5794556.4, 25362],
    ['Neptune', 6836527.10058, 24622],
    ['Pluto', 975.5, 1188.3],
    ['Ceres', 62.6284, 469.7],
    ['Pallas', 13.665878, 256],
    ['Vesta', 17.288245, 262.7],
    ['Hygiea', 5.78, 216.5],
  ];
  const N = BODIES.length;
  const GM = new Float64Array(N);
  BODIES.forEach((b, i) => GM[i] = b[1] * KM3S2);
  const SUN = 0, EARTH = 3, MOON = 4;
  const J2E = 1.08262545e-3, RE = 6378.137 / AU_KM;
  // Tidal recession of the Moon (lunar laser ranging: 3.83 cm/yr). A prograde push on the Moon's
  // orbit of n*(da/dt)/2 gives da/dt, and n falls by the observed ~25.8"/century^2.
  const DADT = 0.0383 / 1.495978707e11 / 365.25;           // AU/day per day
  const TIDE = (2 * Math.PI / 27.321661) * DADT / 2;       // AU/day^2
  const OBL0 = 84381.406 / 3600 * Math.PI / 180;

  // Direction of Earth's spin axis in the J2000 ecliptic frame (luni-solar precession only; enough for the bulge force).
  function earthPole(t, out) {
    const T = t / 36525 + (EPOCH - 2451545) / 36525;
    const psi = (5038.481507 * T - 1.0790069 * T * T) / 3600 * Math.PI / 180;
    const eps = OBL0 + (-0.025754 * T + 0.0512623 * T * T) / 3600 * Math.PI / 180;
    out[0] = Math.sin(eps) * Math.sin(psi); out[1] = Math.sin(eps) * Math.cos(psi); out[2] = Math.cos(eps);
    return out;
  }

  function makeSystem(opts = {}) {
    return {
      x: new Float64Array(3 * N), v: new Float64Array(3 * N), a: new Float64Array(3 * N), t: 0,
      gr: opts.gr ?? 1, tides: opts.tides ?? 1, j2: opts.j2 ?? 1, pole: new Float64Array(3), poleT: 1e99,
    };
  }

  // Einstein-Infeld-Hoffmann 1PN equations for every pair (as in JPL's DE ephemerides, beta = gamma = 1).
  // Adds the relativistic corrections to the Newtonian accelerations already in `a`.
  const U = new Float64Array(N), AN = new Float64Array(3 * N), DA = new Float64Array(3 * N), IR = new Float64Array(N * N);
  // Sources whose relativistic terms matter at the arcsecond level over millennia.
  const REL = (typeof process !== 'undefined' && process.env.REL ? process.env.REL.split(',').map(Number) : [0, 3, 4, 6]);
  function eih(s, x, v, a) {
    const c2 = C * C / s.gr;
    AN.set(a); DA.fill(0);
    for (let i = 0; i < N; i++) { let u = 0; for (let j = 0; j < N; j++) if (j !== i) u += GM[j] * IR[i * N + j]; U[i] = u; }
    for (let i = 0; i < N; i++) {
      const vix = v[3 * i], viy = v[3 * i + 1], viz = v[3 * i + 2], vi2 = vix * vix + viy * viy + viz * viz;
      let ax = 0, ay = 0, az = 0;
      for (let jj = 0; jj < REL.length; jj++) {
        const j = REL[jj]; if (j === i) continue;
        const mu = GM[j];
        const ir = IR[i * N + j], ir3 = ir * ir * ir;
        const dx = x[3 * j] - x[3 * i], dy = x[3 * j + 1] - x[3 * i + 1], dz = x[3 * j + 2] - x[3 * i + 2];
        const vjx = v[3 * j], vjy = v[3 * j + 1], vjz = v[3 * j + 2], vj2 = vjx * vjx + vjy * vjy + vjz * vjz;
        const vivj = vix * vjx + viy * vjy + viz * vjz;
        const rv = -(dx * vjx + dy * vjy + dz * vjz) * ir;
        const ra = dx * AN[3 * j] + dy * AN[3 * j + 1] + dz * AN[3 * j + 2];
        const br = (-4 * U[i] - U[j] + vi2 + 2 * vj2 - 4 * vivj - 1.5 * rv * rv + 0.5 * ra) / c2;
        const f = mu * ir3 * br;
        ax += f * dx; ay += f * dy; az += f * dz;
        const g = mu * ir3 * (-(dx * (4 * vix - 3 * vjx) + dy * (4 * viy - 3 * vjy) + dz * (4 * viz - 3 * vjz))) / c2;
        ax += g * (vix - vjx); ay += g * (viy - vjy); az += g * (viz - vjz);
        const h = 3.5 * mu * ir / c2;
        ax += h * AN[3 * j]; ay += h * AN[3 * j + 1]; az += h * AN[3 * j + 2];
      }
      DA[3 * i] = ax; DA[3 * i + 1] = ay; DA[3 * i + 2] = az;
    }
    for (let k = 0; k < 3 * N; k++) a[k] += DA[k];
  }

  // d: the kick length. Velocity-dependent terms are evaluated at the kick's midpoint velocity,
  // which keeps each leapfrog stage time-symmetric so the 6th-order composition stays 6th order.
  function accel(s, d = 0) {
    const { x, a } = s;
    let v = s.v;
    a.fill(0);
    for (let i = 0; i < N; i++) {
      const xi = x[3 * i], yi = x[3 * i + 1], zi = x[3 * i + 2];
      for (let j = i + 1; j < N; j++) {
        const dx = x[3 * j] - xi, dy = x[3 * j + 1] - yi, dz = x[3 * j + 2] - zi;
        const r2 = dx * dx + dy * dy + dz * dz, ir = 1 / Math.sqrt(r2), ir3 = ir * ir * ir;
        IR[i * N + j] = IR[j * N + i] = ir;
        const fi = GM[j] * ir3, fj = GM[i] * ir3;
        a[3 * i] += fi * dx; a[3 * i + 1] += fi * dy; a[3 * i + 2] += fi * dz;
        a[3 * j] -= fj * dx; a[3 * j + 1] -= fj * dy; a[3 * j + 2] -= fj * dz;
      }
    }
    if (d && (s.gr || s.tides)) {
      const vm = s.vm || (s.vm = new Float64Array(3 * N));
      for (let i = 0; i < 3 * N; i++) vm[i] = v[i] + 0.5 * d * a[i];
      v = vm;
    }
    if (s.gr) eih(s, x, v, a);
    const rx = x[3 * MOON] - x[3 * EARTH], ry = x[3 * MOON + 1] - x[3 * EARTH + 1], rz = x[3 * MOON + 2] - x[3 * EARTH + 2];
    const qM = GM[EARTH] / (GM[EARTH] + GM[MOON]), qE = GM[MOON] / (GM[EARTH] + GM[MOON]);
    if (s.j2) {
      // Earth's equatorial bulge pulling on the Moon (and the Moon pulling back on it).
      if (Math.abs(s.t - s.poleT) > 30) { earthPole(s.t, s.pole); s.poleT = s.t; }
      const p = s.pole, r2 = rx * rx + ry * ry + rz * rz, r = Math.sqrt(r2), z = rx * p[0] + ry * p[1] + rz * p[2];
      const f = s.j2 * 1.5 * J2E * GM[EARTH] * RE * RE / (r2 * r2 * r), g = 5 * z * z / r2 - 1;
      const ax = f * (g * rx - 2 * z * p[0]), ay = f * (g * ry - 2 * z * p[1]), az = f * (g * rz - 2 * z * p[2]);
      const m = GM[MOON] / GM[EARTH];
      a[3 * MOON] += ax; a[3 * MOON + 1] += ay; a[3 * MOON + 2] += az;
      a[3 * EARTH] -= m * ax; a[3 * EARTH + 1] -= m * ay; a[3 * EARTH + 2] -= m * az;
    }
    if (s.tides) {
      // Tides: Earth's spin drags its tidal bulge ahead of the Moon, pushing the Moon forward along its orbit.
      const ux = v[3 * MOON] - v[3 * EARTH], uy = v[3 * MOON + 1] - v[3 * EARTH + 1], uz = v[3 * MOON + 2] - v[3 * EARTH + 2];
      const f = s.tides * TIDE / Math.sqrt(ux * ux + uy * uy + uz * uz);
      a[3 * MOON] += qM * f * ux; a[3 * MOON + 1] += qM * f * uy; a[3 * MOON + 2] += qM * f * uz;
      a[3 * EARTH] -= qE * f * ux; a[3 * EARTH + 1] -= qE * f * uy; a[3 * EARTH + 2] -= qE * f * uz;
    }
  }

  // Yoshida (1990) 6th-order composition of the drift-kick-drift leapfrog: 7 force evaluations per step.
  const Y6 = (() => { const W = [-1.17767998417887, 0.235573213359357, 0.784513610477560]; const w0 = 1 - 2 * (W[0] + W[1] + W[2]); return [W[2], W[1], W[0], w0, W[0], W[1], W[2]]; })();
  function step(s, h) {
    const { x, v, a } = s, n3 = 3 * N;
    for (let k = 0; k < 7; k++) {
      const d = Y6[k] * h, hd = d / 2;
      for (let i = 0; i < n3; i++) x[i] += v[i] * hd;
      s.t += hd; accel(s, d);
      for (let i = 0; i < n3; i++) v[i] += a[i] * d;
      for (let i = 0; i < n3; i++) x[i] += v[i] * hd;
      s.t += hd;
    }
  }
  function energy(s) {
    const { x, v } = s; let T = 0, U = 0;
    for (let i = 0; i < N; i++) {
      T += 0.5 * GM[i] * (v[3 * i] ** 2 + v[3 * i + 1] ** 2 + v[3 * i + 2] ** 2);
      for (let j = i + 1; j < N; j++) U -= GM[i] * GM[j] / Math.hypot(x[3 * i] - x[3 * j], x[3 * i + 1] - x[3 * j + 1], x[3 * i + 2] - x[3 * j + 2]);
    }
    return T + U;
  }
  function copy(dst, src) { dst.x.set(src.x); dst.v.set(src.v); dst.t = src.t; dst.gr = src.gr; dst.tides = src.tides; dst.j2 = src.j2; return dst; }

  // Advance s to time t (days from epoch) with steps no longer than H.
  const H = 0.5;
  function advance(s, t) {
    const span = t - s.t; if (span === 0) return s;
    const n = Math.ceil(Math.abs(span) / H - 1e-9), h = span / n;
    for (let i = 0; i < n; i++) step(s, h);
    s.t = t; return s;
  }

  // Ephemeris: a run of the model stored as checkpoints every CK days, grown on demand in both directions.
  const CK = 32;
  function Ephemeris(init, opts = {}) {
    const self = this;
    this.gr = opts.gr ?? 1; this.tides = opts.tides ?? 1; this.j2 = opts.j2 ?? 1;
    this.fwd = [];  // checkpoints at t = +k*CK
    this.bwd = [];  // checkpoints at t = -k*CK (index 0 is the epoch)
    const s0 = makeSystem(this); s0.x.set(init.x); s0.v.set(init.v); s0.t = 0;
    const pack = s => { const f = new Float64Array(6 * N); f.set(s.x, 0); f.set(s.v, 3 * N); return f; };
    this.fwd.push(pack(s0)); this.bwd.push(this.fwd[0]);
    this.hi = 0; this.lo = 0; // covered range in days
    const runF = makeSystem(this), runB = makeSystem(this);
    const unpack = (s, f, t) => { s.x.set(f.subarray(0, 3 * N)); s.v.set(f.subarray(3 * N)); s.t = t; };
    unpack(runF, this.fwd[0], 0); unpack(runB, this.fwd[0], 0);
    this.extend = function (dir) {
      const s = dir > 0 ? runF : runB, list = dir > 0 ? self.fwd : self.bwd;
      advance(s, s.t + dir * CK); list.push(pack(s));
      if (dir > 0) self.hi = s.t; else self.lo = s.t;
    };
    this.covers = t => t >= self.lo && t <= self.hi;
    // Grow toward [a, b] for at most `ms` milliseconds; returns true when covered.
    this.growTo = function (a, b, ms) {
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        const needF = b > self.hi, needB = a < self.lo;
        if (!needF && !needB) return true;
        if (needF && (!needB || self.hi - b > self.lo - a || self.hi < -self.lo)) self.extend(1); else self.extend(-1);
      }
      return a >= self.lo && b <= self.hi;
    };
    this.nearest = function (t) {
      const k = Math.round(t / CK);
      if (k >= 0) { const kk = Math.min(k, self.fwd.length - 1); return [self.fwd[kk], kk * CK]; }
      const kk = Math.min(-k, self.bwd.length - 1); return [self.bwd[kk], -kk * CK];
    };
    const work = makeSystem(this);
    // Quintic Hermite interpolation of barycentric positions between checkpoints (positions, velocities
    // and Newtonian accelerations at both ends). Accurate to ~km for the planets; the Moon needs .at().
    const cacheK = [NaN, NaN], cacheA = [new Float64Array(3 * N), new Float64Array(3 * N)], accSys = makeSystem({ gr: 0, tides: 0, j2: 0 });
    function ckAcc(k, slot) {
      if (cacheK[slot] === k) return cacheA[slot];
      const f = k >= 0 ? self.fwd[k] : self.bwd[-k];
      accSys.x.set(f.subarray(0, 3 * N)); accSys.v.set(f.subarray(3 * N)); accel(accSys);
      cacheA[slot].set(accSys.a); cacheK[slot] = k; return cacheA[slot];
    }
    this.interp = function (t, out) {
      let k = Math.floor(t / CK);
      const kmax = self.fwd.length - 1, kmin = -(self.bwd.length - 1);
      if (k >= kmax) k = kmax - 1; if (k < kmin) k = kmin;
      const f0 = k >= 0 ? self.fwd[k] : self.bwd[-k], f1 = k + 1 >= 0 ? self.fwd[k + 1] : self.bwd[-(k + 1)];
      const a0 = ckAcc(k, k & 1), a1 = ckAcc(k + 1, (k + 1) & 1);
      const h = CK, u = (t - k * CK) / h, u2 = u * u, u3 = u2 * u, u4 = u3 * u, u5 = u4 * u;
      const h00 = 1 - 10 * u3 + 15 * u4 - 6 * u5, h10 = u - 6 * u3 + 8 * u4 - 3 * u5, h20 = 0.5 * u2 - 1.5 * u3 + 1.5 * u4 - 0.5 * u5;
      const h01 = 10 * u3 - 15 * u4 + 6 * u5, h11 = -4 * u3 + 7 * u4 - 3 * u5, h21 = 0.5 * u3 - u4 + 0.5 * u5;
      const n3 = 3 * N;
      for (let i = 0; i < n3; i++) out[i] = h00 * f0[i] + h * h10 * f0[n3 + i] + h * h * h20 * a0[i] + h01 * f1[i] + h * h11 * f1[n3 + i] + h * h * h21 * a1[i];
      return out;
    };
    // Exact state at time t: start from the nearest checkpoint and integrate (at most CK/2 days).
    this.at = function (t, out) {
      const [f, tc] = self.nearest(t);
      unpack(work, f, tc); advance(work, t);
      if (out) { out.x.set(work.x); out.v.set(work.v); out.t = t; return out; }
      return work;
    };
  }
  // data: {name: [x, y, z, vx, vy, vz]} at EPOCH. moonDelta: fitted correction to the Moon's geocentric state
  // (least squares against DE441 over 1876-2176), applied with the Earth-Moon barycenter held fixed.
  function initial(data, moonDelta) {
    const s = makeSystem();
    BODIES.forEach(([name], i) => { const st = data[name]; for (let k = 0; k < 3; k++) { s.x[3 * i + k] = st[k]; s.v[3 * i + k] = st[3 + k]; } });
    if (moonDelta) {
      const mu = GM[MOON] / (GM[EARTH] + GM[MOON]);
      for (let k = 0; k < 3; k++) {
        s.x[3 * MOON + k] += (1 - mu) * moonDelta[k]; s.x[3 * EARTH + k] -= mu * moonDelta[k];
        s.v[3 * MOON + k] += (1 - mu) * moonDelta[3 + k]; s.v[3 * EARTH + k] -= mu * moonDelta[3 + k];
      }
    }
    return s;
  }

  // ---------- time ----------
  // Delta T = TT - UT in seconds (Espenak & Meeus 2006, with measured values 2005-2026).
  function deltaT(y) {
    let u, t;
    if (y < -500) { u = (y - 1820) / 100; return -20 + 32 * u * u; }
    if (y < 500) { u = y / 100; return 10583.6 - 1014.41 * u + 33.78311 * u ** 2 - 5.952053 * u ** 3 - 0.1798452 * u ** 4 + 0.022174192 * u ** 5 + 0.0090316521 * u ** 6; }
    if (y < 1600) { u = (y - 1000) / 100; return 1574.2 - 556.01 * u + 71.23472 * u ** 2 + 0.319781 * u ** 3 - 0.8503463 * u ** 4 - 0.005050998 * u ** 5 + 0.0083572073 * u ** 6; }
    if (y < 1700) { t = y - 1600; return 120 - 0.9808 * t - 0.01532 * t * t + t ** 3 / 7129; }
    if (y < 1800) { t = y - 1700; return 8.83 + 0.1603 * t - 0.0059285 * t * t + 0.00013336 * t ** 3 - t ** 4 / 1174000; }
    if (y < 1860) { t = y - 1800; return 13.72 - 0.332447 * t + 0.0068612 * t ** 2 + 0.0041116 * t ** 3 - 0.00037436 * t ** 4 + 0.0000121272 * t ** 5 - 0.0000001699 * t ** 6 + 0.000000000875 * t ** 7; }
    if (y < 1900) { t = y - 1860; return 7.62 + 0.5737 * t - 0.251754 * t ** 2 + 0.01680668 * t ** 3 - 0.0004473624 * t ** 4 + t ** 5 / 233174; }
    if (y < 1920) { t = y - 1900; return -2.79 + 1.494119 * t - 0.0598939 * t ** 2 + 0.0061966 * t ** 3 - 0.000197 * t ** 4; }
    if (y < 1941) { t = y - 1920; return 21.20 + 0.84493 * t - 0.076100 * t ** 2 + 0.0020936 * t ** 3; }
    if (y < 1961) { t = y - 1950; return 29.07 + 0.407 * t - t * t / 233 + t ** 3 / 2547; }
    if (y < 1986) { t = y - 1975; return 45.45 + 1.067 * t - t * t / 260 - t ** 3 / 718; }
    if (y < 2005) { t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
    // Measured (IERS) 2005-2026, then a smooth join to the long-term parabola.
    const M = [[2005, 64.69], [2010, 66.07], [2015, 67.64], [2020, 69.36], [2023, 69.2], [2026, 69.1]];
    if (y < 2026) { for (let i = 0; i < M.length - 1; i++) if (y < M[i + 1][0]) return M[i][1] + (M[i + 1][1] - M[i][1]) * (y - M[i][0]) / (M[i + 1][0] - M[i][0]); }
    const far = u2 => -20 + 32 * u2 * u2;
    if (y < 2150) { const w = (y - 2026) / 124, s = w * w * (3 - 2 * w); return 69.1 * (1 - s) + far((y - 1820) / 100) * s; }
    return far((y - 1820) / 100);
  }
  // Calendar (Gregorian after 1582-10-15, Julian before), JD <-> date.
  function jdToCal(jd) {
    const Z = Math.floor(jd + 0.5), F = jd + 0.5 - Z;
    let A = Z;
    if (Z >= 2299161) { const al = Math.floor((Z - 1867216.25) / 36524.25); A = Z + 1 + al - Math.floor(al / 4); }
    const B = A + 1524, Cc = Math.floor((B - 122.1) / 365.25), D = Math.floor(365.25 * Cc), E = Math.floor((B - D) / 30.6001);
    const day = B - D - Math.floor(30.6001 * E) + F, month = E < 14 ? E - 1 : E - 13, year = month > 2 ? Cc - 4716 : Cc - 4715;
    return { year, month, day: Math.floor(day), frac: day - Math.floor(day) };
  }
  function calToJd(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    let B = 0;
    if (y > 1582 || (y === 1582 && (m > 10 || (m === 10 && d >= 15)))) { const A = Math.floor(y / 100); B = 2 - A + Math.floor(A / 4); }
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5;
  }
  const yearOf = jd => 2000 + (jd - 2451545) / 365.25;
  // UT JD -> TDB JD and back (TDB-TT < 2 ms is ignored).
  const utToTdb = jd => jd + deltaT(yearOf(jd)) / 86400;
  const tdbToUt = jd => jd - deltaT(yearOf(jd)) / 86400;

  return { C, AU_KM, KM3S2, EPOCH, BODIES, N, GM, SUN, EARTH, MOON, H, CK, J2E, RE, OBL0,
    makeSystem, accel, step, advance, energy, copy, Ephemeris, initial, earthPole, deltaT, jdToCal, calToJd, yearOf, utToTdb, tdbToUt };
})();
if (typeof module !== 'undefined') module.exports = PHYS;

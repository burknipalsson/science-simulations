// Powers of Ten, time trip: the Milky Way and Andromeda, 12 billion years ahead. The two galaxies' centres follow
// a semi-analytic orbit: Hernquist dark haloes (Milky Way 1.0e12 suns, Andromeda 1.5e12) attracting each other,
// with Chandrasekhar dynamical friction (Coulomb logarithm 1, chosen so the model reproduces van der Marel et
// al. 2012's N-body timing: first pass 4.1 vs 3.9 Gyr, merger 5.7 vs 5.9 Gyr). Today's velocity: 109.3 km/s
// toward us (van der Marel 2012) and 57 km/s sideways (Gaia, van der Marel 2019); the sideways direction is the
// 2012 estimate's. Stars and gas are test particles in both galaxies' gravity, as in Toomre & Toomre (1972) and
// the series' Bridges & Tails. Runs in node (the orbit) and the browser (the particles, in a worker).
(function (root) {
  const S = root.PTEN || require('./scale.js');
  const Gk = 4.30091e-6, KG = 1.02271;          // G in kpc (km/s)^2/Msun; km/s -> kpc/Gyr
  const GAL = { MW: { M: 1.0e12, a: 38, Mb: 6e10, ab: 3.0 }, M31: { M: 1.5e12, a: 44, Mb: 1.1e11, ab: 4.0 } };
  const hm = (g, r) => g.M * r * r / ((r + g.a) ** 2);
  const hrho = (g, r) => g.M * g.a / (2 * Math.PI * r * (r + g.a) ** 3);
  const hsig = (g, r) => { const x = r / g.a; return Math.sqrt(Math.max(Gk * g.M / (12 * g.a) * (12 * x * (x + 1) ** 3 * Math.log((x + 1) / x) - x / (x + 1) * (25 + 52 * x + 42 * x * x + 12 * x ** 3)), 1)); };
  const erf = x => { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
  // today's geometry in the gc frame (kpc): Andromeda where the Local Group layer puts it
  const m31 = S.bodies.m31.pos.map(v => v / S.KPC), d0 = Math.hypot(...m31), rh = m31.map(v => v / d0);
  const v12 = [66.1, -76.3, 45.1];              // van der Marel 2012 galactocentric velocity of M31 (km/s): direction of the sideways part
  const vr0 = v12[0] * rh[0] + v12[1] * rh[1] + v12[2] * rh[2];
  let th = v12.map((v, i) => v - vr0 * rh[i]); const tl = Math.hypot(...th); th = th.map(v => v / tl);
  const VR = -109.3, VT = 57.0;
  // relative orbit (M31 - MW), RK4 in Gyr; returns samples every 5 Myr: [t, x, y, z] in kpc (gc axes)
  function orbit(lnL = 1, tmax = 12.5, vt = VT) {
    const A = GAL.MW, B = GAL.M31; let r = m31.slice(), v = rh.map((u, i) => VR * u + vt * th[i]);
    const acc = (r, v) => {
      const R = Math.hypot(...r), V = Math.hypot(...v), g = Gk * (hm(A, R) + hm(B, R)) / (R * R);
      const fr = (h, sat) => { const X = V / (Math.SQRT2 * hsig(h, R)); return 4 * Math.PI * Gk * Gk * lnL * sat * hrho(h, R) / (V * V) * (erf(X) - 2 * X / Math.sqrt(Math.PI) * Math.exp(-X * X)); };
      const f = fr(A, hm(B, Math.max(R, 1))) + fr(B, hm(A, Math.max(R, 1)));
      return r.map((x, i) => -g * x / R - f * v[i] / V);
    };
    const dt = 0.0005, out = []; let t = 0;
    const k = (r, v) => [v.map(x => x * KG), acc(r, v).map(x => x * KG)];
    for (let n = 0; t <= tmax + 1e-9; n++) {
      if (n % 10 === 0) out.push([t, ...r]);
      const [a1, b1] = k(r, v), [a2, b2] = k(r.map((x, i) => x + 0.5 * dt * a1[i]), v.map((x, i) => x + 0.5 * dt * b1[i]));
      const [a3, b3] = k(r.map((x, i) => x + 0.5 * dt * a2[i]), v.map((x, i) => x + 0.5 * dt * b2[i])), [a4, b4] = k(r.map((x, i) => x + dt * a3[i]), v.map((x, i) => x + dt * b3[i]));
      r = r.map((x, i) => x + dt / 6 * (a1[i] + 2 * a2[i] + 2 * a3[i] + a4[i])); v = v.map((x, i) => x + dt / 6 * (b1[i] + 2 * b2[i] + 2 * b3[i] + b4[i])); t += dt;
    }
    return out;
  }
  const fM = GAL.M31.M / (GAL.MW.M + GAL.M31.M);           // barycentre: MW at -fM r, M31 at (1 - fM) r, from the MW's place today
  const BARY = m31.map(v => v * fM);

  // worker: test particles in both galaxies (halo + Plummer bulge/disc), centres interpolated along the orbit
  const WORKER = `
    let P, V, N, ORB, t = 0, M1, M2;
    const G = 4.498e-6;                                 // kpc^3 / (Msun Gyr^2)
    function centres(t) {
      const k = Math.min(ORB.length - 2, Math.floor(t / 0.005)), f = Math.min(1, (t - ORB[k][0]) / 0.005), r = [1, 2, 3].map(j => ORB[k][j] * (1 - f) + ORB[k + 1][j] * f);
      return [r.map(x => -FM * x), r.map(x => (1 - FM) * x)].map(c => c.map((x, i) => x + BARY0[i]));
    }
    let FM, BARY0, BX;
    function accel(x, y, z, c) {
      let ax = 0, ay = 0, az = 0;
      for (let g = 0; g < 2; g++) {
        const H = g ? M2 : M1, dx = x - c[g][0], dy = y - c[g][1], dz = z - c[g][2], r = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-3;
        const fh = G * H.M / (r * (r + H.a) * (r + H.a));                       // Hernquist: g = GM / (r + a)^2, along r
        const fb = G * H.Mb / Math.pow(r * r + H.ab * H.ab, 1.5);                // Plummer bulge + disc
        const f = fh + fb; ax -= f * dx; ay -= f * dy; az -= f * dz;
      }
      return [ax, ay, az];
    }
    onmessage = e => {
      const m = e.data;
      if (m.init) { P = m.P; V = m.V; N = P.length / 3; ORB = m.orb; M1 = m.M1; M2 = m.M2; FM = m.fM; BARY0 = m.bary; BX = [0, 0, 0]; t = 0; postMessage({ t, P }); return; }
      if (m.to !== undefined) {
        const dt = 0.002; let steps = 0;
        while (t + dt <= m.to && steps < 60) {
          const c0 = centres(t), c1 = centres(t + dt);
          for (let i = 0; i < N; i++) {
            const j = 3 * i; let a = accel(P[j], P[j + 1], P[j + 2], c0);
            V[j] += 0.5 * dt * a[0]; V[j + 1] += 0.5 * dt * a[1]; V[j + 2] += 0.5 * dt * a[2];
            P[j] += dt * V[j]; P[j + 1] += dt * V[j + 1]; P[j + 2] += dt * V[j + 2];
            a = accel(P[j], P[j + 1], P[j + 2], c1);
            V[j] += 0.5 * dt * a[0]; V[j + 1] += 0.5 * dt * a[1]; V[j + 2] += 0.5 * dt * a[2];
          }
          t += dt; steps++;
        }
        postMessage({ t, P: P.slice() });
      }
    };`;
  // initial particles (kpc, kpc/Gyr): exponential discs plus a small bulge, on circular orbits in their own galaxy
  function particles(n, orb) {
    let sd = 31; const rnd = () => { sd = (sd * 1664525 + 1013904223) >>> 0; return sd / 4294967296; };
    const gs = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const P = new Float32Array(3 * n), Vv = new Float32Array(3 * n), C = new Float32Array(4 * n);
    const vc = (g, r) => Math.sqrt(4.498e-6 * (g.M * r / ((r + g.a) ** 2) + g.Mb * r * r / Math.pow(r * r + g.ab * g.ab, 1.5)));   // kpc/Gyr
    // disc normals: the Milky Way's is the Galactic pole; Andromeda's from its measured tilt (as in layers.js)
    const D = Math.PI / 180, ra = 10.68471, dec = 41.26875, pa = 38, inc = 77;
    const s = S.fromEq(ra, dec, 1), north = S.app(S.EQ2GAL, [-Math.sin(dec * D) * Math.cos(ra * D), -Math.sin(dec * D) * Math.sin(ra * D), Math.cos(dec * D)]);
    const east = [s[1] * north[2] - s[2] * north[1], s[2] * north[0] - s[0] * north[2], s[0] * north[1] - s[1] * north[0]].map(x => -x);
    const maj = north.map((x, i) => Math.cos(pa * D) * x + Math.sin(pa * D) * east[i]), m2 = north.map((x, i) => -Math.sin(pa * D) * x + Math.cos(pa * D) * east[i]);
    const u = m2.map((x, i) => -Math.cos(inc * D) * x - Math.sin(inc * D) * s[i]);
    const nM31 = [maj[1] * u[2] - maj[2] * u[1], maj[2] * u[0] - maj[0] * u[2], maj[0] * u[1] - maj[1] * u[0]];
    // spin senses: the Milky Way turns clockwise seen from the north Galactic pole; Andromeda's north-east side
    // (along the major axis) approaches us, so (n x maj) . s < 0
    const nx = [nM31[1] * maj[2] - nM31[2] * maj[1], nM31[2] * maj[0] - nM31[0] * maj[2], nM31[0] * maj[1] - nM31[1] * maj[0]];
    const nA = nx[0] * s[0] + nx[1] * s[1] + nx[2] * s[2] > 0 ? nM31.map(v => -v) : nM31;
    const vrel = rh.map((x, i) => (VR * x + VT * th[i]) * KG);      // kpc/Gyr; each centre moves about the barycentre
    const disks = [{ g: GAL.MW, c: [0, 0, 0], v: vrel.map(x => -fM * x), n: [0, 0, -1], Rd: 2.6, e1: [1, 0, 0] }, { g: GAL.M31, c: m31, v: vrel.map(x => (1 - fM) * x), n: nA, Rd: 5.3, e1: maj }];
    const nMW = Math.round(n * 0.4);
    for (let i = 0; i < n; i++) {
      const d = disks[i < nMW ? 0 : 1], n0 = d.n, e1 = d.e1, e2 = [n0[1] * e1[2] - n0[2] * e1[1], n0[2] * e1[0] - n0[0] * e1[2], n0[0] * e1[1] - n0[1] * e1[0]];
      const bulge = rnd() < 0.15; let p, v;
      if (bulge) {
        const r = 1.2 * Math.pow(rnd(), 0.9) + 0.05, dir = [gs(), gs(), gs()], l = Math.hypot(...dir);
        p = dir.map(x => x / l * r); const w = [gs(), gs(), gs()], t2 = [p[1] * w[2] - p[2] * w[1], p[2] * w[0] - p[0] * w[2], p[0] * w[1] - p[1] * w[0]], tl2 = Math.hypot(...t2);
        v = t2.map(x => x / tl2 * vc(d.g, r) * 0.85);
      } else {
        let R; do { R = -d.Rd * Math.log(rnd() * rnd()); } while (R > 7 * d.Rd || R < 0.3);
        const ph = 2 * Math.PI * rnd(), z = gs() * 0.25, cr = Math.cos(ph), sr = Math.sin(ph);
        const rh2 = e1.map((x, k) => cr * x + sr * e2[k]), tg = [n0[1] * rh2[2] - n0[2] * rh2[1], n0[2] * rh2[0] - n0[0] * rh2[2], n0[0] * rh2[1] - n0[1] * rh2[0]];
        p = rh2.map((x, k) => R * x + z * n0[k]); const vv = vc(d.g, R);
        v = tg.map((x, k) => vv * x + gs() * 0.06 * vv);
      }
      const young = !bulge && rnd() < 0.3;
      P.set(p.map((x, k) => x + d.c[k]), 3 * i); Vv.set(v.map((x, k) => x + d.v[k]), 3 * i);
      C.set(bulge ? [1, 0.7, 0.45, 1] : young ? [0.6, 0.75, 1, 0.9] : [1, 0.88, 0.72, 0.8], 4 * i);
    }
    return { P, V: Vv, C };
  }
  const api = { GAL, orbit, particles, WORKER, BARY, fM, m31, rh, th, VR, VT };
  root.PTEN_M31 = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

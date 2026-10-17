// The Milky Way as a population of star particles drawn from measured structure (galactocentric, kpc,
// x from the Sun toward the centre, z to the north Galactic pole; rotation is clockwise seen from the north):
//   old thin disc: exponential, scale length 2.6 kpc, scale height 0.3 kpc (Bland-Hawthorn & Gerhard 2016)
//   bar: half-length 5.0 kpc at 27 deg to the Sun-centre line, near end at positive longitude (Wegg et al. 2015)
//   spiral arms: Reid et al. 2019 log-periodic fits to maser parallaxes, young stars born in the arms
//   rotation: flat 236 km/s (Reid 2019), bar pattern 39 km/s/kpc (Portail et al. 2017), arm pattern 28 km/s/kpc
// Each particle carries what the shader needs to move it: radius, azimuth at t=0, height, and for young stars
// an age phase, so the disc can turn and young stars can be born, drift out of the arms and fade.
(function (root) {
  const D = Math.PI / 180;
  const R0 = 8.15;                                   // Reid's fits assume R0 = 8.15 kpc
  const V0 = 236, KMS_KPC_MYR = 1.0227e-3;           // 1 km/s = 1.0227e-3 kpc/Myr
  const OMEGA_BAR = 39 * KMS_KPC_MYR, OMEGA_ARM = 28 * KMS_KPC_MYR; // rad/Myr
  const vcirc = R => V0 * (1 - Math.exp(-R / 0.6));  // km/s; flat outside the bulge
  const omega = R => vcirc(R) / Math.max(R, 0.05) * KMS_KPC_MYR;     // rad/Myr

  // arm: R(beta) from Reid's kinked log spiral; beta = 0 toward the Sun, increasing with rotation
  function armR(a, beta) { const psi = (beta < a.bk ? a.p1 : a.p2) * D; return a.Rk * Math.exp(-(beta - a.bk) * D * Math.tan(psi)); }
  // galactocentric azimuth phi (math angle, from +x toward +y): the Sun sits at phi = 180 deg, rotation is clockwise
  const phiOf = beta => (180 - beta) * D;

  function mulberry(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function gauss(rnd) { return Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd()); }

  // Particles: Float32 arrays R, phi0, z, kind (0 old disc, 1 bar/bulge, 2 young arm star, 3 HII region), phase, color(rgb), lum
  function build(arms, n) {
    const rnd = mulberry(20261016);
    const P = { R: [], phi: [], z: [], kind: [], phase: [], col: [], lum: [], size: [] };
    let SZ = 0.06;                                    // sprite size (kpc) ~ the mean particle spacing
    const push = (R, phi, z, kind, phase, c, l) => { P.R.push(R); P.phi.push(phi); P.z.push(z); P.kind.push(kind); P.phase.push(phase); P.col.push(...c); P.lum.push(l); P.size.push(SZ); };
    const nDisc = Math.round(n * 0.55), nBar = Math.round(n * 0.17), nYoung = n - nDisc - nBar;
    for (let i = 0; i < nDisc; i++) {
      let R = -2.6 * Math.log(rnd() * rnd() + 1e-12); if (R > 18) { i--; continue; }
      const z = 0.3 * Math.atanh(2 * rnd() - 1) * 0.5 * (R > 9 ? 1 + (R - 9) * 0.08 : 1);
      const t = rnd(); const c = [1.0, 0.86 - 0.08 * t, 0.66 - 0.12 * t];
      push(R, rnd() * 2 * Math.PI, z, 0, 0, c, 0.7 + 0.6 * rnd());
    }
    // bar + bulge: a boxy triaxial cloud aligned with the bar at t = 0
    const barAng = Math.PI - 27 * D;                  // major axis toward the near end at positive longitude
    for (let i = 0; i < nBar; i++) {
      const bulge = i < nBar * 0.45;
      const a = bulge ? 0.9 : 1.6, b = bulge ? 0.7 : 0.55, c = bulge ? 0.55 : 0.3;
      let x = gauss(rnd) * a, y = gauss(rnd) * b; const z = gauss(rnd) * c;
      if (!bulge && Math.abs(x) > 5) { i--; continue; }
      const X = x * Math.cos(barAng) - y * Math.sin(barAng), Y = x * Math.sin(barAng) + y * Math.cos(barAng);
      const t = rnd();
      push(Math.hypot(X, Y), Math.atan2(Y, X), z, 1, 0, [1.0, 0.78 - 0.1 * t, 0.52 - 0.1 * t], 0.4 + 0.3 * rnd());
    }
    // young stars along the measured arms, extended 40 deg beyond the data at each end (fainter there)
    const spans = arms.map(a => (a.b1 - a.b0 + 80) * a.Rk);
    const tot = spans.reduce((s, x) => s + x, 0);
    arms.forEach((a, k) => {
      const m = Math.round(nYoung * spans[k] / tot);
      for (let i = 0; i < m; i++) {
        const beta = a.b0 - 40 + rnd() * (a.b1 - a.b0 + 80);
        const R = armR(a, beta); if (R < 2.2 || R > 17) continue;
        const inData = beta >= a.b0 && beta <= a.b1;
        const w = a.w * (R / a.Rk);
        const off = gauss(rnd) * w, phi = phiOf(beta) + gauss(rnd) * w / R * 0.3;
        const hii = rnd() < 0.04;
        const t = rnd();
        push(R + off, phi, gauss(rnd) * 0.06, hii ? 3 : 2, rnd(), hii ? [1.0, 0.45, 0.55] : [0.62 + 0.2 * t, 0.75 + 0.1 * t, 1.0], (inData ? 1 : 0.45) * (hii ? 2.5 : 1));
      }
    });
    // the solar neighbourhood at higher sampling (same disc and arms, 2.5 kpc around the Sun), so the model
    // still reads as a disc of stars when the view closes in to a few thousand light-years
    const sunX = -R0, nLoc = Math.round(n * 0.35), RL = 2.5; SZ = 0.014;
    for (let i = 0; i < nLoc; i++) {
      const r = RL * Math.sqrt(rnd()), t = rnd() * 2 * Math.PI, x = sunX + r * Math.cos(t), y = r * Math.sin(t), R = Math.hypot(x, y);
      if (rnd() > Math.exp(-(R - 5.6) / 2.6)) { i--; continue; }              // disc density across the patch
      const f = 1 - r / RL, tt = rnd();
      push(R, Math.atan2(y, x), 0.3 * Math.atanh(2 * rnd() - 1) * 0.5, 0, 0, [1.0, 0.86 - 0.08 * tt, 0.66 - 0.12 * tt], 0.45 * Math.min(1, 3 * f));
    }
    arms.forEach(a => {
      for (let i = 0; i < nLoc / 6; i++) {
        const beta = -40 + rnd() * 80, R = armR(a, beta), phi = phiOf(beta);
        const x = R * Math.cos(phi), y = R * Math.sin(phi); if (Math.hypot(x - sunX, y) > RL) continue;
        const w = a.w * (R / a.Rk), off = gauss(rnd) * w;
        push(R + off, phi + gauss(rnd) * w / R * 0.3, gauss(rnd) * 0.06, 2, rnd(), [0.7, 0.8, 1.0], 0.45 * Math.min(1, 3 * (1 - Math.hypot(x - sunX, y) / RL)));
      }
    });
    const out = {}; for (const k of ['R', 'phi', 'z', 'phase', 'lum', 'size']) out[k] = Float32Array.from(P[k]);
    out.kind = Float32Array.from(P.kind); out.col = Float32Array.from(P.col); out.n = out.R.length;
    return out;
  }

  // position of particle i at time t (Myr from now): old stars and bar follow their orbits / the bar pattern;
  // young stars are born in the arm pattern (which turns at OMEGA_ARM), then orbit at omega(R) and fade by ~100 Myr
  const YOUNG_LIFE = 100;
  function pos(P, i, t) {
    const R = P.R[i], k = P.kind[i]; let phi;
    if (k === 1) phi = P.phi[i] - OMEGA_BAR * t;
    else if (k === 0) phi = P.phi[i] - omega(R) * t;
    else {
      const age = ((t / YOUNG_LIFE + P.phase[i]) % 1 + 1) % 1 * YOUNG_LIFE, tb = t - age;
      phi = P.phi[i] - OMEGA_ARM * tb - omega(R) * age;
    }
    return [R * Math.cos(phi), R * Math.sin(phi), P.z[i]];
  }

  // tangent longitude of an arm seen from the Sun (4th quadrant: the most negative l, wrapped to 0..360)
  function tangency(a, R0x = R0) {
    let best = 360;
    for (let beta = -120; beta <= 60; beta += 0.05) {
      const R = armR(a, beta), phi = phiOf(beta), x = R * Math.cos(phi), y = R * Math.sin(phi);
      const l = Math.atan2(y, x + R0x) / D;           // from the Sun at (-R0, 0)
      const lw = (l + 360) % 360;
      if (y < 0 && lw > 270 && lw < best) best = lw;
    }
    return best;
  }
  const api = { build, pos, armR, phiOf, tangency, vcirc, omega, OMEGA_BAR, OMEGA_ARM, YOUNG_LIFE, R0 };
  root.PTEN_GALAXY = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

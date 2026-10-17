// Asteroids as massless test particles: orbital elements -> state, and the drift-kick-drift map the GPU runs
// (exact Kepler motion around the Sun, kicks from the planets). This file is the float64 reference.
const AST = (() => {
  const P = (typeof PHYS !== 'undefined') ? PHYS : require('./phys.js');
  const MU = P.GM[0];
  const DEG = Math.PI / 180;
  // Planets that pull on the asteroids (indices into PHYS bodies; 3 = Earth-Moon barycenter).
  const PERT = [2, 3, 5, 6, 7, 8, 9];
  const PERT_GM = PERT.map(i => i === 3 ? P.GM[3] + P.GM[4] : P.GM[i]);

  function elemToState(a, e, inc, om, w, M, mu = MU) {
    inc *= DEG; om *= DEG; w *= DEG; M *= DEG;
    let E = M; for (let k = 0; k < 30; k++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-14) break; }
    const cE = Math.cos(E), sE = Math.sin(E), b = a * Math.sqrt(1 - e * e);
    const xp = a * (cE - e), yp = b * sE, n = Math.sqrt(mu / (a * a * a)), r = a * (1 - e * cE);
    const vxp = -a * n * sE / (1 - e * cE), vyp = b * n * cE / (1 - e * cE);
    const cO = Math.cos(om), sO = Math.sin(om), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(inc), si = Math.sin(inc);
    const Px = cO * cw - sO * sw * ci, Py = sO * cw + cO * sw * ci, Pz = sw * si;
    const Qx = -cO * sw - sO * cw * ci, Qy = -sO * sw + cO * cw * ci, Qz = cw * si;
    return [xp * Px + yp * Qx, xp * Py + yp * Qy, xp * Pz + yp * Qz, vxp * Px + vyp * Qx, vxp * Py + vyp * Qy, vxp * Pz + vyp * Qz];
  }
  function stateToElem(s, mu = MU) {
    const [x, y, z, vx, vy, vz] = s, r = Math.hypot(x, y, z), v2 = vx * vx + vy * vy + vz * vz;
    const a = 1 / (2 / r - v2 / mu);
    const hx = y * vz - z * vy, hy = z * vx - x * vz, hz = x * vy - y * vx, h = Math.hypot(hx, hy, hz);
    const ex = (vy * hz - vz * hy) / mu - x / r, ey = (vz * hx - vx * hz) / mu - y / r, ez = (vx * hy - vy * hx) / mu - z / r;
    return { a, e: Math.hypot(ex, ey, ez), i: Math.acos(hz / h) / DEG, node: Math.atan2(hx, -hy), peri: Math.atan2(ey, ex) };
  }
  // Exact two-body drift by dt (elliptic orbits), Danby's f and g functions.
  function kepler(s, dt, mu = MU) {
    const [x, y, z, vx, vy, vz] = s;
    const r0 = Math.hypot(x, y, z), v2 = vx * vx + vy * vy + vz * vz, u = x * vx + y * vy + z * vz;
    const a = 1 / (2 / r0 - v2 / mu); if (!(a > 0)) return false;
    const n = Math.sqrt(mu / (a * a * a)), ec = 1 - r0 / a, es = u / (n * a * a);
    const dM = n * dt;
    let dE = dM; // solve dE - ec sin dE + es (1 - cos dE) = dM
    for (let k = 0; k < 20; k++) {
      const s1 = Math.sin(dE), c1 = Math.cos(dE);
      const fq = dE - ec * s1 + es * (1 - c1) - dM, fp = 1 - ec * c1 + es * s1;
      const d = fq / fp; dE -= d; if (Math.abs(d) < 1e-13) break;
    }
    const s1 = Math.sin(dE), c1 = Math.cos(dE);
    const f = 1 - a / r0 * (1 - c1), g = dt + (s1 - dE) / n;
    const r = a * (1 - ec * c1 + es * s1);
    const fdot = -a * a * n * s1 / (r * r0), gd = 1 - a / r * (1 - c1);
    s[0] = f * x + g * vx; s[1] = f * y + g * vy; s[2] = f * z + g * vz;
    s[3] = fdot * x + gd * vx; s[4] = fdot * y + gd * vy; s[5] = fdot * z + gd * vz;
    return true;
  }
  // Heliocentric positions of the perturbers at time t (days from PHYS.EPOCH), from the ephemeris.
  const buf = new Float64Array(3 * P.N);
  function perturbers(eph, t, out) {
    eph.interp(t, buf);
    for (let p = 0; p < PERT.length; p++) {
      const i = PERT[p];
      for (let k = 0; k < 3; k++) {
        let v = buf[3 * i + k];
        if (i === 3) v = (P.GM[3] * buf[9 + k] + P.GM[4] * buf[12 + k]) / (P.GM[3] + P.GM[4]);
        out[3 * p + k] = v - buf[k];
      }
    }
    return out;
  }
  // Kick: direct pull of each planet plus the indirect term (the Sun itself is pulled by the planets).
  function kick(s, pl, dt) {
    let ax = 0, ay = 0, az = 0;
    for (let p = 0; p < PERT.length; p++) {
      const px = pl[3 * p], py = pl[3 * p + 1], pz = pl[3 * p + 2];
      const dx = px - s[0], dy = py - s[1], dz = pz - s[2];
      const d2 = dx * dx + dy * dy + dz * dz, id3 = 1 / (d2 * Math.sqrt(d2));
      const rp2 = px * px + py * py + pz * pz, ir3 = 1 / (rp2 * Math.sqrt(rp2));
      const m = PERT_GM[p];
      ax += m * (dx * id3 - px * ir3); ay += m * (dy * id3 - py * ir3); az += m * (dz * id3 - pz * ir3);
    }
    s[3] += ax * dt; s[4] += ay * dt; s[5] += az * dt;
  }
  // Advance heliocentric state s from time t by n steps of dt.
  const pl = new Float64Array(3 * PERT.length);
  function run(eph, s, t, dt, n) {
    for (let k = 0; k < n; k++) {
      if (!kepler(s, dt / 2)) return false;
      perturbers(eph, t + (k + 0.5) * dt, pl); kick(s, pl, dt);
      if (!kepler(s, dt / 2)) return false;
    }
    return true;
  }
  return { MU, PERT, PERT_GM, elemToState, stateToElem, kepler, perturbers, kick, run };
})();
if (typeof module !== 'undefined') module.exports = AST;

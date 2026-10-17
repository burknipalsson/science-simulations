// Eclipses: Earth orientation, the Moon's shadow on the (flattened) Earth, and a search for solar and lunar eclipses.
const ECL = (() => {
  const P = (typeof PHYS !== 'undefined') ? PHYS : require('./phys.js');
  const R_E = 6378.137, F_E = 1 / 298.257223563, R_S = 696000, R_M = 1737.4; // km
  // Moon radius in Earth radii as used by NASA's eclipse canon: 0.2725076 for the shadow, 0.2722810 (to the limb valleys) for totality.
  const K_UMB = 0.2725076 * R_E, K_PEN = K_UMB, K_TOT = 0.2722810 * R_E;
  const AU = P.AU_KM, DEG = Math.PI / 180, AS = DEG / 3600;

  // ---------- Earth orientation ----------
  // Rotation from the J2000 ecliptic frame to the true equator and equinox of date, then Earth rotation (GAST).
  function matMul(A, B) { const C = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) C[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j]; return C; }
  const rx = a => [1, 0, 0, 0, Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a)];
  const rz = a => [Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const ry = a => [Math.cos(a), 0, -Math.sin(a), 0, 1, 0, Math.sin(a), 0, Math.cos(a)];
  // IAU 2006 precession (Fukushima-Williams angles) + the largest nutation terms.
  function toDate(jdTT) {
    const T = (jdTT - 2451545) / 36525;
    const gam = (-0.052928 + 10.556378 * T + 0.4932044 * T * T - 0.00031238 * T ** 3 - 2.788e-6 * T ** 4 + 2.60e-8 * T ** 5) * AS;
    const phi = (84381.412819 - 46.811016 * T + 0.0511268 * T * T + 0.00053289 * T ** 3 - 4.40e-7 * T ** 4 - 1.76e-8 * T ** 5) * AS;
    const psi = (-0.041775 + 5038.481484 * T + 1.5584175 * T * T - 0.00018522 * T ** 3 - 2.6452e-5 * T ** 4 - 1.48e-8 * T ** 5) * AS;
    const epsA = (84381.406 - 46.836769 * T - 0.0001831 * T * T + 0.00200340 * T ** 3 - 5.76e-7 * T ** 4 - 4.34e-8 * T ** 5) * AS;
    const om = (125.04452 - 1934.136261 * T) * DEG, Ls = (280.4665 + 36000.7698 * T) * DEG, Lm = (218.3165 + 481267.8813 * T) * DEG;
    const dpsi = (-17.20 * Math.sin(om) - 1.32 * Math.sin(2 * Ls) - 0.23 * Math.sin(2 * Lm) + 0.21 * Math.sin(2 * om)) * AS;
    const deps = (9.20 * Math.cos(om) + 0.57 * Math.cos(2 * Ls) + 0.10 * Math.cos(2 * Lm) - 0.09 * Math.cos(2 * om)) * AS;
    // GCRS(equatorial J2000) -> true of date: R1(-(eps+deps)) R3(-(psi+dpsi)) R1(phi) R3(gam)
    let M = matMul(rx(-(epsA + deps)), matMul(rz(-(psi + dpsi)), matMul(rx(phi), rz(gam))));
    M = matMul(M, rx(-P.OBL0)); // J2000 ecliptic -> J2000 equatorial first
    return { M, eqeq: dpsi * Math.cos(epsA), T };
  }
  // Greenwich apparent sidereal time (radians) from UT JD and TT JD.
  function gast(jdUT, jdTT, eqeq) {
    const Du = jdUT - 2451545, T = (jdTT - 2451545) / 36525;
    const era = 2 * Math.PI * ((0.7790572732640 + 0.00273781191135448 * Du + Du) % 1);
    return era + (0.014506 + 4612.156534 * T + 1.3915817 * T * T - 0.00000044 * T ** 3) * AS + eqeq;
  }
  // Rotation matrix J2000 ecliptic -> Earth-fixed (x toward Greenwich, z north pole), for a TDB JD.
  function earthFixed(jdTDB) {
    const jdUT = P.tdbToUt(jdTDB), o = toDate(jdTDB);
    return matMul(rz(gast(jdUT, jdTDB, o.eqeq)), o.M);
  }
  const mul = (M, v) => [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]];
  const tmul = (M, v) => [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]];

  // Geocentric Sun and Moon (km, J2000 ecliptic) from a system state; the Sun is taken where it was when its light left.
  function geo(s) {
    const e = 3 * P.EARTH, m = 3 * P.MOON;
    // The light reaching Earth now passed the Moon 1.3 s ago; the Moon has since moved ~38 km (aberration).
    const tm = Math.hypot(s.x[m] - s.x[e], s.x[m + 1] - s.x[e + 1], s.x[m + 2] - s.x[e + 2]) / P.C;
    const moon = [0, 1, 2].map(k => (s.x[m + k] - s.v[m + k] * tm - s.x[e + k]) * AU);
    const sunG = [0, 1, 2].map(k => (s.x[k] - s.x[e + k]) * AU);
    const lt = Math.hypot(...sunG) / 299792.458 / 86400; // days
    const sun = [0, 1, 2].map(k => sunG[k] - s.v[k] * lt * AU);
    return { sun, moon };
  }

  // Shadow geometry in Earth-fixed km (oblate Earth handled by stretching z).
  // Returns the axis, gamma (closest approach of the axis to Earth's center, Earth radii),
  // the umbra/penumbra cone parameters, and where the axis meets the ground.
  function shadow(s, jdTDB) {
    const g = geo(s), M = earthFixed(jdTDB);
    const S = mul(M, g.sun), Mo = mul(M, g.moon);
    const k = 1 / (1 - F_E);           // stretch z so the Earth becomes a sphere of radius R_E
    const Ss = [S[0], S[1], S[2] * k], Ms = [Mo[0], Mo[1], Mo[2] * k];
    const d = [Ms[0] - Ss[0], Ms[1] - Ss[1], Ms[2] - Ss[2]], dl = Math.hypot(...d), u = d.map(v => v / dl); // axis direction, Sun -> Moon
    const tc = -(Ms[0] * u[0] + Ms[1] * u[1] + Ms[2] * u[2]); // distance along axis from Moon to closest approach to Earth centre
    const cpt = [Ms[0] + u[0] * tc, Ms[1] + u[1] * tc, Ms[2] + u[2] * tc];
    const gamma = Math.hypot(...cpt) / R_E * Math.sign(cpt[2] || 1);
    // Cone half-angles: umbra converges, penumbra diverges beyond the Moon.
    const fu = Math.asin((R_S - K_UMB) / dl), fp = Math.asin((R_S + K_PEN) / dl);
    const out = { gamma, u, Ms, S, M, dl, fu, fp, hit: null };
    // Where the axis meets the (stretched) sphere.
    const b = Ms[0] * u[0] + Ms[1] * u[1] + Ms[2] * u[2], c = Ms[0] ** 2 + Ms[1] ** 2 + Ms[2] ** 2 - R_E * R_E, disc = b * b - c;
    if (disc >= 0) {
      const t = -b - Math.sqrt(disc);
      const p = [Ms[0] + u[0] * t, Ms[1] + u[1] * t, Ms[2] + u[2] * t / 1]; // stretched
      const pe = [p[0], p[1], p[2] / k];                                      // true Earth-fixed
      // Umbral radius at that distance from the Moon (negative = the umbra's vertex fell short: annular)
      const rU = K_UMB - t * Math.tan(fu);
      out.hit = { p: pe, dist: t, rU, ...latlon(pe) };
    }
    return out;
  }
  function latlon(p) {
    const lon = Math.atan2(p[1], p[0]);
    const latc = Math.atan2(p[2], Math.hypot(p[0], p[1]));
    const lat = Math.atan(Math.tan(latc) / ((1 - F_E) * (1 - F_E)));
    return { lat: lat / DEG, lon: lon / DEG };
  }
  function site(lat, lon, h = 0) { // Earth-fixed km of a surface point (geodetic lat/lon, degrees)
    const f = F_E, e2 = f * (2 - f), la = lat * DEG, lo = lon * DEG;
    const N = R_E / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
    return [(N + h) * Math.cos(la) * Math.cos(lo), (N + h) * Math.cos(la) * Math.sin(lo), (N * (1 - e2) + h) * Math.sin(la)];
  }
  // Local circumstances at a site: the apparent separation of the Sun and Moon and their angular radii.
  function local(s, jdTDB, pos) {
    const g = geo(s), M = earthFixed(jdTDB), S = mul(M, g.sun), Mo = mul(M, g.moon);
    const ds = [S[0] - pos[0], S[1] - pos[1], S[2] - pos[2]], dm = [Mo[0] - pos[0], Mo[1] - pos[1], Mo[2] - pos[2]];
    const ls = Math.hypot(...ds), lm = Math.hypot(...dm);
    const sep = Math.acos(Math.min(1, (ds[0] * dm[0] + ds[1] * dm[1] + ds[2] * dm[2]) / (ls * lm)));
    const up = [pos[0], pos[1], pos[2] / ((1 - F_E) * (1 - F_E))], un = Math.hypot(...up);
    const alt = Math.asin((ds[0] * up[0] + ds[1] * up[1] + ds[2] * up[2]) / (ls * un));
    return { sep, rs: Math.asin(R_S / ls), rm: Math.asin(K_TOT / lm), alt };
  }

  // ---------- search ----------
  // Elongation of Moon from Sun in ecliptic longitude (geocentric), radians in (-pi, pi].
  function elong(s) {
    const g = geo(s);
    let d = Math.atan2(g.moon[1], g.moon[0]) - Math.atan2(g.sun[1], g.sun[0]);
    while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI;
    return d;
  }
  const SYN = 29.530588853;
  // Find the syzygy (target 0 = new moon, PI = full moon) nearest to t (days from epoch).
  function syzygy(eph, t, target) {
    for (let it = 0; it < 8; it++) {
      let d = elong(eph.at(t)) - target; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI;
      const dt = -d / (2 * Math.PI / SYN) * 0.98;
      t += dt; if (Math.abs(dt) < 1e-6) break;
    }
    return t;
  }
  function minimize(f, a, b, tol) { // golden section
    const g = (Math.sqrt(5) - 1) / 2; let c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d);
    while (b - a > tol) { if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); } }
    return (a + b) / 2;
  }
  // Solar eclipse at the new moon nearest t, or null.
  function solarAt(eph, t) {
    const tn = syzygy(eph, t, 0);
    const gam = tt => Math.abs(shadow(eph.at(tt), tt + P.EPOCH).gamma);
    const tg = minimize(gam, tn - 0.3, tn + 0.3, 1e-6);
    const s = eph.at(tg), sh = shadow(s, tg + P.EPOCH), g = Math.abs(sh.gamma);
    // penumbral radius on the fundamental plane (Earth radii) ~ where the penumbra still touches the Earth
    const dm = Math.hypot(...sh.Ms), penR = (K_PEN + dm * Math.tan(sh.fp)) / R_E;
    if (g > 1 + penR) return null;
    const ev = { kind: 'solar', t: tg, jd: tg + P.EPOCH, gamma: sh.gamma, type: 'partial' };
    if (sh.hit) {
      ev.lat = sh.hit.lat; ev.lon = sh.hit.lon;
      const L = local(s, tg + P.EPOCH, sh.hit.p);
      ev.type = L.rm > L.rs ? 'total' : 'annular'; ev.ratio = L.rm / L.rs; ev.alt = L.alt / DEG;
      ev.width = 2 * Math.abs(sh.hit.rU) / Math.max(0.2, Math.sin(Math.max(L.alt, 0.01)));
      ev.duration = centralDuration(eph, tg, sh.hit.p);
    } else if (g < 1 + Math.abs(K_UMB - dm * Math.tan(sh.fu)) / R_E) ev.type = 'non-central ' + ((K_UMB - dm * Math.tan(sh.fu)) > 0 ? 'total' : 'annular');
    return ev;
  }
  // Seconds a fixed site spends inside the umbra/antumbra around time tg.
  function centralDuration(eph, tg, p) {
    const inside = tt => { const L = local(eph.at(tt), tt + P.EPOCH, p); return L.sep - Math.abs(L.rm - L.rs); };
    if (inside(tg) > 0) return 0;
    const edge = (a, b) => { for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (inside(m) < 0) a = m; else b = m; } return (a + b) / 2; };
    const t1 = edge(tg, tg - 0.01), t2 = edge(tg, tg + 0.01);
    return (t2 - t1) * 86400;
  }
  // Lunar eclipse at the full moon nearest t, or null. Umbra/penumbra with the 2% atmospheric enlargement (Danjon).
  function lunarAt(eph, t) {
    const tf = syzygy(eph, t, Math.PI);
    const q = tt => { const g = geo(eph.at(tt)); const ax = g.sun.map(v => -v / Math.hypot(...g.sun)); const m = g.moon, dm = Math.hypot(...m); const c = (m[0] * ax[0] + m[1] * ax[1] + m[2] * ax[2]) / dm; return Math.acos(Math.min(1, c)); };
    const tg = minimize(q, tf - 0.3, tf + 0.3, 1e-6);
    const g = geo(eph.at(tg)), ds = Math.hypot(...g.sun), dm = Math.hypot(...g.moon);
    const piM = Math.asin(R_E / dm), piS = Math.asin(R_E / ds), sS = Math.asin(R_S / ds), sM = Math.asin(R_M / dm);
    const umb = 1.02 * (piM + piS - sS), pen = 1.02 * (piM + piS + sS), sep = q(tg);
    const ev = { kind: 'lunar', t: tg, jd: tg + P.EPOCH, sep, umb, pen, sM };
    if (sep < umb - sM) ev.type = 'total'; else if (sep < umb + sM) ev.type = 'partial'; else if (sep < pen + sM) ev.type = 'penumbral'; else return null;
    ev.mag = (umb + sM - sep) / (2 * sM); ev.penMag = (pen + sM - sep) / (2 * sM);
    if (ev.type === 'total') { // duration of totality
      const edge = (a, b) => { for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (q(m) < umb - sM) a = m; else b = m; } return (a + b) / 2; };
      ev.duration = (edge(tg, tg + 0.2) - edge(tg, tg - 0.2)) * 86400;
    }
    return ev;
  }
  // Next (dir=+1) or previous (dir=-1) eclipse of the given kinds after time t.
  function next(eph, t, dir, kinds = ['solar', 'lunar'], filter) {
    for (let k = 0; k < 400; k++) {
      const guesses = [];
      const base = t + dir * (k * SYN / 2 + 1);
      for (const kind of kinds) {
        const ev = kind === 'solar' ? solarAt(eph, base) : lunarAt(eph, base);
        if (ev && (ev.t - t) * dir > 0.5 && (!filter || filter(ev))) guesses.push(ev);
      }
      if (guesses.length) return guesses.sort((a, b) => dir * (a.t - b.t))[0];
    }
    return null;
  }
  return { R_E, F_E, R_S, K_UMB, K_PEN, earthFixed, toDate, gast, geo, shadow, latlon, site, local, elong, syzygy, solarAt, lunarAt, next, mul, tmul, centralDuration };
})();
if (typeof module !== 'undefined') module.exports = ECL;

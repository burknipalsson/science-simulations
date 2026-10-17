// Powers of Ten: the frame chain. Every place on the zoom path is a node with a parent, a position in the
// parent's frame (metres) and a rotation from its own axes to the parent's. Positions relative to the camera
// are always summed from the deepest frame upward, so each layer is placed with double precision at its own
// scale (the atom is 1e-11 m inside a city 6.4e6 m from Earth's centre).
// Runs in node and the browser.
(function (root) {
  const D = Math.PI / 180;
  const PC = 3.0856775814913673e16, KPC = 1e3 * PC, MPC = 1e6 * PC, AU = 1.495978707e11, LY = 9.4607304725808e15;

  // ---- small 3x3 helpers (row-major arrays of 9) ----
  const mul = (a, b) => { const r = new Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j]; return r; };
  const T = a => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
  const app = (m, v) => [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]];
  const Rx = a => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
  const Rz = a => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };
  const Ry = a => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

  // ---- astronomical frames ----
  const EPS0 = 23.4392911 * D;                               // J2000 obliquity (IAU 1980)
  const ECL2EQ = Rx(EPS0);                                   // ecliptic J2000 -> ICRS
  const EQ2GAL = [-0.0548755604, -0.8734370902, -0.4838350155, // ICRS -> Galactic (Hipparcos, ESA 1997)
    0.4941094279, -0.4448296300, 0.7469822445,
    -0.8676661490, -0.1980763734, 0.4559837762];
  const GAL2EQ = T(EQ2GAL);

  // IAU 1976 precession, mean equator of date -> J2000
  function precessToJ2000(jd) {
    const t = (jd - 2451545.0) / 36525, as = D / 3600;
    const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t * t * t) * as;
    const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t * t * t) * as;
    const th = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t * t * t) * as;
    const P = mul(Rz(z), mul(Ry(-th), Rz(zeta)));            // J2000 -> date (v_date = P v_J2000)
    return T(P);
  }
  const gmst = jd => ((280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360) * D; // UT1 ~ UTC (|dUT1| < 0.9 s)

  // WGS84 geodetic -> Earth-fixed
  const WGS_A = 6378137.0, WGS_F = 1 / 298.257223563, WGS_E2 = WGS_F * (2 - WGS_F);
  function geodetic(latDeg, lonDeg, h) {
    const la = latDeg * D, lo = lonDeg * D, N = WGS_A / Math.sqrt(1 - WGS_E2 * Math.sin(la) ** 2);
    return [(N + h) * Math.cos(la) * Math.cos(lo), (N + h) * Math.cos(la) * Math.sin(lo), (N * (1 - WGS_E2) + h) * Math.sin(la)];
  }
  // local East-North-Up axes -> Earth-fixed (columns e, n, u)
  function enu(latDeg, lonDeg) {
    const la = latDeg * D, lo = lonDeg * D, sl = Math.sin(la), cl = Math.cos(la), so = Math.sin(lo), co = Math.cos(lo);
    return [-so, -sl * co, cl * co, co, -sl * so, cl * so, 0, cl, sl];
  }
  const fromGal = (lDeg, bDeg, d) => [d * Math.cos(bDeg * D) * Math.cos(lDeg * D), d * Math.cos(bDeg * D) * Math.sin(lDeg * D), d * Math.sin(bDeg * D)];
  const fromEq = (raDeg, decDeg, d) => app(EQ2GAL, [d * Math.cos(decDeg * D) * Math.cos(raDeg * D), d * Math.cos(decDeg * D) * Math.sin(raDeg * D), d * Math.sin(decDeg * D)]);

  // ---- the landing moment and place ----
  function jdUTC(y, m, d, h) { // Gregorian calendar -> JD
    if (m <= 2) { y--; m += 12; }
    const A = Math.floor(y / 100), B = 2 - A + Math.floor(A / 4);
    return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + B - 1524.5 + h / 24;
  }
  const JD = jdUTC(2026, 10, 16, 13);
  const SITE = { name: 'Hallgrímskirkja, Reykjavík', lat: 64.14167, lon: -21.92667, h: 105.8 }; // ground, m above the ellipsoid (ArcticDEM; 39.8 m above sea)

  // Real values used to place things. Each has a source in refs.md.
  const R0 = 8.178 * KPC, ZSUN = 20.8 * PC;                 // GRAVITY 2019; Bennett & Bovy 2019
  const SUN_GC = [-R0, 0, ZSUN];                             // galactocentric, x from Sun toward the centre
  const M31 = { l: 121.1744, b: -21.5729, d: 0.765e3 * KPC }; // McConnachie 2012 / Li et al. 2021
  const states = (root.PTEN_DATA && root.PTEN_DATA.horizons) || (typeof require !== 'undefined' ? require('./data/horizons.json') : null);

  // ---- the tree ----
  // frame: 'web' comoving box (centred), 'gc' galactocentric (Galactic axes), 'sol' heliocentric ecliptic J2000,
  // 'earth' Earth-fixed ITRF, 'site' ENU at Hallgrimskirkja, then local frames down to the atom.
  const nodes = {};
  function node(id, parent, pos, rot, extra) { nodes[id] = Object.assign({ id, parent, pos, rot: rot || I3 }, extra || {}); return nodes[id]; }

  // The Local Group is placed inside the cosmic-web box at a halo chosen from the sim (set by the web layer);
  // until then it sits at the box centre.
  node('web', null, [0, 0, 0], I3, { size: 306.6 * MPC });
  node('gc', 'web', [0, 0, 0], I3, { size: 30 * KPC });
  const WEB = root.PTEN_WEB || (typeof require !== 'undefined' ? (() => { try { require('./web_data.js'); return globalThis.PTEN_WEB; } catch (e) { return null; } })() : null);
  if (WEB) { nodes.gc.pos = WEB.lg.map(x => x * nodes.web.size); nodes.gc.rot = WEB.rot; }
  const ROT_SOL = mul(EQ2GAL, ECL2EQ);                      // ecliptic -> galactic
  node('sol', 'gc', SUN_GC.slice(), ROT_SOL, { size: 60 * AU });
  const km = v => v.map(x => x * 1e3);
  const earthHelio = km(states.states.earth.slice(0, 3));
  // Earth-fixed -> ecliptic J2000:  ecl = EQ2ECL * PREC(date->J2000) * Rz(GMST) * itrf
  const ROT_EARTH = mul(T(ECL2EQ), mul(precessToJ2000(JD), Rz(gmst(JD))));
  node('earth', 'sol', earthHelio, ROT_EARTH, { size: 2 * 6.371e6 });
  node('site', 'earth', geodetic(SITE.lat, SITE.lon, SITE.h), enu(SITE.lat, SITE.lon), { size: 1e3 });

  // positions of other bodies, for drawing and checks
  const bodies = {};
  for (const [k, s] of Object.entries(states.states)) bodies[k] = { frame: 'sol', pos: km(s.slice(0, 3)), vel: km(s.slice(3, 6)) };
  bodies.sun = { frame: 'sol', pos: [0, 0, 0] };
  bodies.m31 = { frame: 'gc', pos: SUN_GC.map((x, i) => x + fromGal(M31.l, M31.b, M31.d)[i]) };
  bodies.sgrA = { frame: 'gc', pos: [0, 0, 0] };
  if (WEB) bodies.virgo = { frame: 'web', pos: WEB.virgo.map(x => x * nodes.web.size) };

  // ---- time: two-body Kepler from the epoch states (planets about the Sun, Moon about the Earth) ----
  const GM_SUN = 1.32712440018e20, GM_EM = 4.0350323e14;    // m^3/s^2 (Earth + Moon for the lunar orbit)
  function kepler(r0, v0, mu, dt) {                           // universal-variable-free: elliptic only
    const r = Math.hypot(...r0), v2 = v0[0] ** 2 + v0[1] ** 2 + v0[2] ** 2, rv = r0[0] * v0[0] + r0[1] * v0[1] + r0[2] * v0[2];
    const a = 1 / (2 / r - v2 / mu), n = Math.sqrt(mu / a ** 3);
    const ec = 1 - r / a, es = rv / Math.sqrt(mu * a);         // e cos E0, e sin E0
    // solve E - e sin E = M with e sin E = ec sin E - es cos E rotated by E0: work in dE = E - E0
    let dE = n * dt; for (let k = 0; k < 50; k++) { const g = dE - ec * Math.sin(dE) + es * (1 - Math.cos(dE)) - n * dt; const gp = 1 - ec * Math.cos(dE) + es * Math.sin(dE); const s = g / gp; dE -= s; if (Math.abs(s) < 1e-14) break; }
    const f = 1 - a / r * (1 - Math.cos(dE)), g = dt - (dE - Math.sin(dE)) / n;
    return r0.map((x, i) => f * x + g * v0[i]);
  }
  const base = {};
  function setTime(days) {
    const dt = days * 86400;
    for (const k of Object.keys(states.states)) {
      if (k === 'moon' || k === 'earth') continue;
      if (!base[k]) base[k] = { r: bodies[k].pos.slice(), v: bodies[k].vel.slice() };
      bodies[k].pos = kepler(base[k].r, base[k].v, GM_SUN, dt);
    }
    // Earth and Moon about their barycentre (the EMB follows the Kepler orbit, not the Earth)
    if (!base.moon) base.moon = { r: bodies.moon.pos.map((x, i) => x - bodies.earth.pos[i]), v: bodies.moon.vel.map((x, i) => x - bodies.earth.vel[i]) };
    const rm = kepler(base.moon.r, base.moon.v, GM_EM, dt), MU = 0.0121505856;   // Moon / (Earth + Moon) mass
    bodies.earth.pos = bodies.emb.pos.map((x, i) => x - MU * rm[i]);
    bodies.moon.pos = bodies.emb.pos.map((x, i) => x + (1 - MU) * rm[i]);
    nodes.earth.pos = bodies.earth.pos;
    const jd = JD + days;
    nodes.earth.rot = mul(T(ECL2EQ), mul(precessToJ2000(jd), Rz(gmst(jd))));
    api.days = days;
  }

  // ---- chain maths ----
  function chain(id) { const c = []; for (let n = nodes[id]; n; n = nodes[n.parent]) c.push(n); return c; }
  // express point p (in frame `from`) in frame `to`, summing from the deeper frame upward
  function toAncestor(p, from, to) {
    let v = p.slice();
    for (let n = nodes[from]; n.id !== to; n = nodes[n.parent]) { v = app(n.rot, v); v = [v[0] + n.pos[0], v[1] + n.pos[1], v[2] + n.pos[2]]; }
    return v;
  }
  function rotToAncestor(from, to) { let R = I3; for (let n = nodes[from]; n.id !== to; n = nodes[n.parent]) R = mul(n.rot, R); return R; }
  function common(a, b) { const ca = new Set(chain(a).map(n => n.id)); for (const n of chain(b)) if (ca.has(n.id)) return n.id; return null; }
  // vector from point a (frame fa) to point b (frame fb), expressed in frame `into`
  function rel(pa, fa, pb, fb, into) {
    const c = common(fa, fb), A = toAncestor(pa, fa, c), B = toAncestor(pb, fb, c);
    let d = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    // rotate from c into `into` (into must lie on a chain through c)
    if (into !== c) { const R = rotToAncestor(into, common(into, c)); const Rc = rotToAncestor(c, common(into, c)); d = app(T(R), app(Rc, d)); }
    return d;
  }

  var api; api = { setTime, kepler, days: 0, D, PC, KPC, MPC, AU, LY, nodes, bodies, node, chain, toAncestor, rotToAncestor, rel, common,
    mul, T, app, Rx, Ry, Rz, I3, fromGal, fromEq, geodetic, enu, gmst, precessToJ2000, jdUTC, JD, SITE, ECL2EQ, EQ2GAL, GAL2EQ, R0, ZSUN, SUN_GC, M31 };
  root.PTEN = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

// Powers of Ten: the camera. The zoom state is one number, L = log10(width of the view in metres).
// A path of waypoints (each a point and a view direction in some frame of scale.js) says where the
// camera looks at each L; between waypoints the centre glides and the view direction turns.
// Runs in node and the browser.
(function (root) {
  const S = root.PTEN || require('./scale.js');
  const { mul, T, app } = S;

  // rotation taking vectors in frame F to frame G
  function rotBetween(F, G) {
    if (F === G) return S.I3;
    const c = S.common(F, G);
    return mul(T(S.rotToAncestor(G, c)), S.rotToAncestor(F, c));
  }
  // camera basis from "look from" direction n (unit vector from centre toward the eye) and an up hint
  function basis(n, up) {
    const nz = norm(n); let x = cross(up, nz);
    if (Math.hypot(...x) < 1e-9) x = cross([1, 0, 0], nz);
    x = norm(x); const y = cross(nz, x);
    return [x[0], y[0], nz[0], x[1], y[1], nz[1], x[2], y[2], nz[2]]; // columns: right, up, back
  }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };

  // quaternions for slerp of camera bases
  function m2q(m) {
    const tr = m[0] + m[4] + m[8]; let q;
    if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; q = [(m[7] - m[5]) / s, (m[2] - m[6]) / s, (m[3] - m[1]) / s, s / 4]; }
    else if (m[0] > m[4] && m[0] > m[8]) { const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; q = [s / 4, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s]; }
    else if (m[4] > m[8]) { const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; q = [(m[1] + m[3]) / s, s / 4, (m[5] + m[7]) / s, (m[2] - m[6]) / s]; }
    else { const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, s / 4, (m[3] - m[1]) / s]; }
    return q;
  }
  function q2m([x, y, z, w]) {
    return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)];
  }
  function slerp(a, b, t) {
    let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
    if (d < 0) { b = b.map(x => -x); d = -d; }
    if (d > 0.9995) return norm4(a.map((x, i) => x + (b[i] - x) * t));
    const th = Math.acos(d), s = Math.sin(th), wa = Math.sin((1 - t) * th) / s, wb = Math.sin(t * th) / s;
    return a.map((x, i) => x * wa + b[i] * wb);
  }
  const norm4 = q => { const l = Math.hypot(...q); return q.map(x => x / l); };
  const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * t * (t * (6 * t - 15) + 10);

  // ---- the path ----
  // L: log10 view width where this waypoint fully holds. frame/pos: the centre. from/up: view (in that frame).
  const N = S.nodes, B = S.bodies;
  const siteUp = [0, 0, 1];
  // direction to the Sun from the Earth's centre, in the Earth frame (so the Earth is seen lit)
  const sunFromEarth = norm(S.rel([0, 0, 0], 'earth', [0, 0, 0], 'sol', 'earth'));
  const siteUpE = norm(app(N.site.rot, siteUp));
  // Earth and Moon seen from above the ecliptic, leaning toward the Sun so both are lit
  const sunFromEarthEcl = norm(B.earth.pos.map(x => -x));
  const earthMoonView = norm([0.6 * sunFromEarthEcl[0], 0.6 * sunFromEarthEcl[1], 1]);
  const path = [
    { L: 25.2, frame: 'web', pos: () => N.gc.pos, from: [0.35, -0.55, 0.76], up: [0, 0, 1], name: 'The cosmic web' },
    { L: 23.0, frame: 'gc', pos: () => B.m31.pos.map(x => x * 0.45), from: [0.2, -0.6, 0.77], up: [0, 0, 1], name: 'The Local Group' },
    { L: 21.4, frame: 'gc', pos: () => [0, 0, 0], from: [0, -0.35, 0.94], up: [1, 0, 0], name: 'The Milky Way' },
    { L: 20.75, frame: 'gc', pos: () => [0, 0, 0], from: [0, 0, 1], up: [1, 0, 0], name: 'The Milky Way, face on' },
    { L: 19.6, frame: 'gc', pos: () => S.SUN_GC, from: [0, 0, 1], up: [1, 0, 0], name: 'The Sun’s neighbourhood' },
    { L: 16.4, frame: 'sol', pos: () => [0, 0, 0], from: [0, -0.5, 0.87], up: [0, 0, 1], name: 'The nearest stars' },
    { L: 13.3, frame: 'sol', pos: () => [0, 0, 0], from: [0, 0, 1], up: [0, 1, 0], name: 'The solar system' },
    { L: 11.6, frame: 'sol', pos: () => B.earth.pos, from: [0, 0, 1], up: [0, 1, 0], name: 'Earth’s orbit' },
    { L: 9.0, frame: 'sol', pos: () => B.earth.pos.map((x, i) => 0.5 * (x + B.moon.pos[i])), from: earthMoonView, up: [0, 0, 1], name: 'Earth and Moon' },
    { L: 8.3, frame: 'sol', pos: () => B.earth.pos, from: earthMoonView, up: [0, 0, 1], name: 'Earth' },
    { L: 7.3, frame: 'earth', pos: () => [0, 0, 0], from: siteUpE, up: [0, 0, 1], name: 'Earth' },
    { L: 5.6, frame: 'site', pos: () => [0, 0, 0], from: siteUp, up: [0, 1, 0], name: 'Iceland' },
    { L: 3.0, frame: 'site', pos: () => [0, 0, 0], from: siteUp, up: [0, 1, 0], name: 'Reykjavík' },
  ];
  // the zoom continues below 1 km through inner.js's frames
  const INNER = root.PTEN_INNER || (typeof require !== 'undefined' ? require('./inner.js') : null);
  if (INNER) path.push(...INNER.path);
  // side trips: branches off the main path at a waypoint, with their own waypoints below it
  const TRIPS = {};
  if (S.nodes.sgr) {
    const away = [0, 0, -1];      // in the sgr frame the Sun is toward -z: look from the Sun's side, north up
    TRIPS.sgr = { branch: 21.4, path: [
      { L: 18.3, frame: 'sgr', pos: () => [0, 0, 0], from: norm([0.15, -0.35, -1]), up: [0, 1, 0], name: 'The Galactic Centre' },
      { L: 15.6, frame: 'sgr', pos: () => [0, 0, 0], from: norm([0.1, -0.25, -1]), up: [0, 1, 0], name: 'The S-stars' },
      { L: 14.1, frame: 'sgr', pos: () => [0, 0, 0], from: norm([0.25, -0.45, -1]), up: [0, 1, 0], name: 'The orbit of S2' },
      { L: 11.25, frame: 'sgr', pos: () => [0, 0, 0], from: norm([0.12, -0.3, -1]), up: [0, 1, 0], name: 'Sgr A*' },
    ] };
  }
  if (root.PTEN_M31) {
    const M = root.PTEN_M31, nrm = [M.rh[1] * M.th[2] - M.rh[2] * M.th[1], M.rh[2] * M.th[0] - M.rh[0] * M.th[2], M.rh[0] * M.th[1] - M.rh[1] * M.th[0]];
    TRIPS.m31 = { branch: 23.0, path: [
      { L: 22.55, frame: 'gc', pos: () => M.BARY.map(v => v * S.KPC), from: norm(nrm.map((v, i) => v + 0.35 * M.th[i])), up: M.th, name: 'Andromeda meets the Milky Way' },
    ] };
  }
  const PATHS = { main: path };
  for (const [k, t] of Object.entries(TRIPS)) PATHS[k] = path.filter(w => w.L >= t.branch).concat(t.path);
  // precompute each waypoint's camera basis in its own frame
  for (const p of Object.values(PATHS)) for (const w of p) if (!w.R) w.R = basis(w.from, w.up);

  // camera at log-width L, with an optional user orbit (yaw about the waypoint's up, pitch) applied on top
  function camera(L, orbit, which) {
    const path = PATHS[which || 'main'] || PATHS.main;
    let i = 0; while (i < path.length - 1 && path[i + 1].L >= L) i++;
    const a = path[i], b = path[Math.min(i + 1, path.length - 1)];
    const t = a === b ? 0 : smooth((a.L - L) / (a.L - b.L));
    // camera frame: the deeper of the two (b), so precision follows the zoom
    const F = b.frame, pb = b.pos(), pa = a.pos();
    const d = S.rel(pb, F, pa, a.frame, F);                   // b -> a, in F
    const pos = pb.map((x, k) => x + d[k] * (1 - t));
    const Ra = mul(rotBetween(a.frame, F), a.R);
    let R = q2m(slerp(m2q(Ra), m2q(b.R), t));
    if (orbit && (orbit.yaw || orbit.pitch)) {
      const Ry = rotAxis([R[1], R[4], R[7]], orbit.yaw), Rx = rotAxis([R[0], R[3], R[6]], orbit.pitch);
      R = mul(Rx, mul(Ry, R));
    }
    return { L, w: Math.pow(10, L), frame: F, pos, R, seg: i, t, name: t < 0.5 ? a.name : b.name };
  }
  function rotAxis(k, a) { // Rodrigues
    const c = Math.cos(a), s = Math.sin(a), C = 1 - c, [x, y, z] = k;
    return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  }
  // where a layer (frame F, origin o in metres) sits relative to the camera, in camera axes:
  // rot (F -> camera axes) and off (centre -> origin), both divided by the view width
  function place(cam, F, o) {
    const RcT = T(cam.R);
    const rot = mul(RcT, rotBetween(F, cam.frame));
    const off = app(RcT, S.rel(cam.pos, cam.frame, o || [0, 0, 0], F, cam.frame));
    return { rot: rot.map(x => x / cam.w), off: off.map(x => x / cam.w) };
  }

  // ---- HUD helpers ----
  const UNITS = [[S.MPC * 1e3, 'Gpc'], [S.MPC, 'Mpc'], [S.KPC, 'kpc'], [S.LY, 'light-years'], [S.AU, 'AU'], [1e3, 'km'], [1, 'm'], [1e-2, 'cm'], [1e-3, 'mm'], [1e-6, 'µm'], [1e-9, 'nm'], [1e-12, 'pm'], [1e-15, 'fm']];
  // the unit to quote a length in: each takes over from the one above at the given multiple of itself
  const UNIT_FROM = { Gpc: 1, Mpc: 1, kpc: 1, 'light-years': 0.1, AU: 0.1, km: 1, m: 1, cm: 1, mm: 1, 'µm': 1, nm: 1, pm: 1, fm: 1 };
  function human(m) {
    for (const [u, n] of UNITS) if (m >= u * UNIT_FROM[n] * 0.999) {
      const v = m / u;
      return (v >= 100 ? Math.round(v).toLocaleString('en') : v >= 10 ? v.toFixed(1) : v.toFixed(2)) + ' ' + n;
    }
    return m.toExponential(2) + ' m';
  }
  // real sizes for the "about the size of" line (metres)
  const FAMILIAR = [
    [8.8e26, 'the observable universe'], [306.6 * S.MPC, 'this simulated box of universe'], [16.5 * S.MPC, 'the distance to the Virgo cluster'],
    [3 * S.MPC, 'the Local Group of galaxies'], [765 * S.KPC, 'the distance to Andromeda'], [100000 * S.LY, 'the Milky Way’s disc'],
    [8.178 * S.KPC, 'the distance to the Galaxy’s centre'], [1344 * S.LY, 'the distance to the Orion Nebula'], [8.6 * S.LY, 'the distance to Sirius'],
    [4.246 * S.LY, 'the distance to Proxima Centauri'], [S.LY, 'a light-year'], [2000 * S.AU, 'the inner edge of the Oort cloud'],
    [121.6 * S.AU, 'the heliopause, where Voyager 1 left'], [60.1 * S.AU, 'the width of Neptune’s orbit'], [10.4 * S.AU, 'the width of Jupiter’s orbit'],
    [2 * S.AU, 'the width of Earth’s orbit'], [1.3927e9, 'the Sun'], [3.844e8, 'the distance to the Moon'], [1.2742e7, 'the Earth'],
    [3.4748e6, 'the Moon'], [4.9e5, 'Iceland, east to west'], [3e4, 'greater Reykjavík'], [2e3, 'a walk across central Reykjavík'],
    [73, 'Hallgrímskirkja’s tower'], [1.75, 'a person'], [0.19, 'a hand'], [0.0105, 'a fingernail'], [1e-3, 'nine capillary loops'],
    [3e-4, 'a capillary loop'], [7e-5, 'the width of a hair'], [7.8e-6, 'a red blood cell'], [6.4e-8, 'one mesh of the spectrin net'],
    [6.5e-9, 'a haemoglobin molecule'], [2.8e-10, 'a water molecule'], [1.06e-10, 'a hydrogen atom'], [2.43e-12, 'the electron’s Compton wavelength'],
    [1.5e-14, 'a uranium nucleus'], [1.68e-15, 'a proton']];
  function familiar(w) {
    let best = null, bd = 1e9;
    for (const [m, n] of FAMILIAR) { const d = Math.abs(Math.log10(w / m)); if (d < bd) { bd = d; best = [m, n]; } }
    if (bd > 0.45) return null;
    const r = w / best[0];
    const how = r > 1.6 ? `${r.toFixed(r < 10 ? 1 : 0)}× ` : r < 0.62 ? `${(1 / r).toFixed(1)}× smaller than ` : 'about ';
    return how + best[1];
  }

  const api = { path, PATHS, TRIPS, camera, place, rotBetween, basis, human, familiar, slerp, m2q, q2m, smooth, FAMILIAR };
  root.PTEN_ZOOM = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

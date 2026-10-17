/* The Clockwork: main view. Time, the ephemeris, the camera, the GPU asteroids, labels, readouts and show-me actions.
   Shared state is exposed as window.CW for sections.js. */
(() => {
  const $ = id => document.getElementById(id);
  const P = PHYS, DEG = Math.PI / 180, AU = P.AU_KM, DAY = 86400;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================================================================
     Bodies
     ================================================================ */
  // kind: shader style. minPx: smallest drawn radius in CSS px. rot: IAU pole RA, Dec, W0, W-dot (deg, deg/day from J2000).
  const B = [
    { name: 'Sun', kind: 0, minPx: 7, col: [1, 0.85, 0.6], rot: [286.13, 63.87, 84.176, 14.1844], year: '—', day: '25.4 days (equator)', note: '99.86% of the solar system’s mass. Its centre is pulled around the balance point by the planets, mostly Jupiter.' },
    { name: 'Mercury', kind: 1, minPx: 3, col: [0.56, 0.53, 0.5], col2: [0.36, 0.34, 0.33], rot: [281.0103, 61.4155, 329.5988, 6.1385108], day: '58.6 days (solar day 176 days)', note: 'Its orbit turns 43″ a century more than Newton allows: the classic test of general relativity.' },
    { name: 'Venus', kind: 2, minPx: 4, col: [0.95, 0.86, 0.64], col2: [0.84, 0.74, 0.55], rot: [272.76, 67.16, 160.20, -1.4813688], day: '243 days, backwards (solar day 117 days)', note: 'Spins backwards, so slowly that its day is longer than its year.' },
    { name: 'Earth', kind: 3, minPx: 4, col: [0.4, 0.6, 1.0], day: '23 h 56 min 4 s (solar day 24 h)', note: 'The Moon is receding 3.8 cm a year as tides slow Earth’s spin; the day lengthens about 2 ms a century.' },
    { name: 'Moon', kind: 4, minPx: 2.5, col: [0.7, 0.7, 0.7], rot: [269.9949, 66.5392, 38.3213, 13.17635815], day: '27.3 days, always the same face to Earth', note: 'Its orbit is the hardest one in the solar system to predict: the Sun pulls on it half as hard as Earth does.' },
    { name: 'Mars', kind: 9, minPx: 3.5, col: [0.8, 0.44, 0.25], col2: [0.52, 0.3, 0.2], rot: [317.269, 54.432, 176.049863, 350.891982443297], day: '24 h 37 min (sol 24 h 40 min)', note: 'Two small moons, Phobos and Deimos. Its orbit is stretched enough that its distance from the Sun varies by 20%.' },
    { name: 'Jupiter', kind: 5, minPx: 5.5, col: [0.87, 0.79, 0.67], col2: [0.66, 0.5, 0.38], rot: [268.056595, 64.495303, 284.95, 870.536], day: '9 h 56 min', note: 'More than twice the mass of all the other planets together. It shepherds the asteroid belt and the Trojans.' },
    { name: 'Saturn', kind: 6, minPx: 5, col: [0.93, 0.85, 0.67], col2: [0.79, 0.69, 0.5], rot: [40.589, 83.537, 38.90, 810.7939024], day: '10 h 34 min', note: '274 known moons. Its rings are 280,000 km across but mostly tens of metres thick.', ring: true },
    { name: 'Uranus', kind: 7, minPx: 4.5, col: [0.64, 0.86, 0.9], col2: [0.56, 0.8, 0.86], rot: [257.311, -15.175, 203.81, -501.1600928], day: '17 h 14 min, tipped on its side', note: 'Found by William Herschel in 1781, the first planet discovered with a telescope.' },
    { name: 'Neptune', kind: 8, minPx: 4.5, col: [0.36, 0.54, 0.97], col2: [0.28, 0.43, 0.86], rot: [299.36, 43.46, 249.978, 541.1397757], day: '16 h 7 min', note: 'Predicted from wobbles in Uranus’s orbit by Le Verrier and Adams, and found in 1846 within 1° of the forecast.' },
    { name: 'Pluto', kind: 1, minPx: 2.5, col: [0.82, 0.72, 0.62], col2: [0.56, 0.43, 0.36], rot: [132.993, -6.163, 302.695, 56.3625225], day: '6.4 days, backwards', note: 'Circles twice for every three orbits of Neptune, a resonance that keeps it safe although their orbits cross.', minor: true },
    { name: 'Ceres', kind: 1, minPx: 2, col: [0.5, 0.5, 0.5], col2: [0.36, 0.36, 0.36], rot: [291.418, 66.764, 170.65, 952.1532], day: '9 h 4 min', note: 'The largest asteroid, a dwarf planet 940 km across: a third of the belt’s mass.', minor: true },
    { name: 'Pallas', kind: 1, minPx: 2, col: [0.52, 0.5, 0.48], col2: [0.4, 0.38, 0.36], rot: [33, -3, 38, 1105.8036], day: '7 h 49 min', note: 'Its orbit is tilted 35°, which makes it hard for spacecraft to reach.', minor: true },
    { name: 'Vesta', kind: 1, minPx: 2, col: [0.62, 0.6, 0.56], col2: [0.44, 0.42, 0.4], rot: [309.031, 42.235, 285.39, 1617.3329428], day: '5 h 20 min', note: 'Visited by the Dawn spacecraft. Meteorites from Vesta have landed on Earth.', minor: true },
    { name: 'Hygiea', kind: 1, minPx: 2, col: [0.45, 0.45, 0.45], col2: [0.34, 0.34, 0.34], rot: [312, 62, 0, 1970.3], day: '13 h 50 min', note: 'Nearly round, perhaps the smallest dwarf planet.', minor: true },
  ];
  B.forEach((b, i) => { b.i = i; b.R = P.BODIES[i][2] / AU; });

  // IAU rotation -> world(ecliptic J2000) to body-fixed matrix (rows = body axes)
  const OBL = P.OBL0, ce = Math.cos(OBL), se = Math.sin(OBL);
  const eq2ecl = v => [v[0], ce * v[1] + se * v[2], -se * v[1] + ce * v[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  function poleOf(b) { const [ra, de] = b.rot; return norm(eq2ecl([Math.cos(de * DEG) * Math.cos(ra * DEG), Math.cos(de * DEG) * Math.sin(ra * DEG), Math.sin(de * DEG)])); }
  B.forEach(b => { if (b.rot) b.pole = poleOf(b); });
  function bodyAxes(b, jd) {
    const [ra, de, W0, Wd] = b.rot, d = jd - 2451545;
    const Pq = [Math.cos(de * DEG) * Math.cos(ra * DEG), Math.cos(de * DEG) * Math.sin(ra * DEG), Math.sin(de * DEG)];
    const Q = norm(cross([0, 0, 1], Pq)), W = ((W0 + Wd * d) % 360) * DEG;
    const PxQ = cross(Pq, Q), x = Q.map((q, k) => Math.cos(W) * q + Math.sin(W) * PxQ[k]), y = cross(Pq, x);
    return [eq2ecl(x), eq2ecl(y), eq2ecl(Pq)];
  }

  /* ================================================================
     Ephemeris
     ================================================================ */
  const init = P.initial(DATA.state0, DATA.moonDelta);
  const eph = new P.Ephemeris(init);
  const E0 = P.energy(init);
  const T_MIN = P.calToJd(-1000, 1, 1) - P.EPOCH, T_MAX = P.calToJd(3000, 12, 31) - P.EPOCH;
  const nowT = () => P.utToTdb(Date.now() / 86400000 + 2440587.5) - P.EPOCH;

  /* ================================================================
     State
     ================================================================ */
  const S = {
    t: nowT(), rate: 3, dir: 1, playing: !reduceMotion,
    target: 0, jframe: false, trueScale: false, flash: false, tFlash: 0,
    orbits: true, labels: true, craft: true, minor: true, mask: 63,
    sunTrail: false, ssb: false,
  };
  const cam = { az: -1.95, el: 0.62, dist: 4.2, tgtFrom: null, tgtBlend: 1, fov: 45 * DEG };
  let camTargetPos = [0, 0, 0];

  /* ================================================================
     WebGL
     ================================================================ */
  const canvas = $('sky');
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  let eng = null;
  function nogl(msg) { const d = document.createElement('div'); d.className = 'nogl'; d.textContent = msg; $('stage').appendChild(d); }
  if (!gl) nogl('This simulation needs WebGL 2, which this browser or device has turned off. The eclipse finder, charts and tables below still work.');
  else { try { eng = SolarGL(gl, { day: DATA.texDay, night: DATA.texNight, moon: DATA.texMoon }); } catch (e) { console.error(e); eng = null; nogl('The 3D view could not start on this graphics card. The eclipse finder, charts and tables below still work.'); } }

  /* ================================================================
     Asteroids: decode, classify, and hand to the GPU
     ================================================================ */
  const AST_DT = 4, AST_K = 32;
  const A = { sim: null, tg: DATA.astEpoch - P.EPOCH, a: null, n: DATA.astCount, ready: false, lag: 0 };
  async function decodeAsteroids() {
    const bin = Uint8Array.from(atob(DATA.ast), c => c.charCodeAt(0));
    const ds = new DecompressionStream('gzip');
    const raw = new Uint8Array(await new Response(new Blob([bin]).stream().pipeThrough(ds)).arrayBuffer());
    const n = DATA.astCount; let off = 0;
    const plane = w => { const o = off; off += w * n; return k => { let v = 0; for (let b = 0; b < w; b++) v += raw[o + b * n + k] * Math.pow(256, b); return v; }; };
    const ga = plane(3), ge = plane(2), gi = plane(2), gom = plane(2), gw = plane(2), gm = plane(2), gH = plane(1);
    const [LA0, LA1] = DATA.astLogA;
    const Pa = new Float32Array(4 * n), Va = new Float32Array(4 * n), aArr = new Float32Array(n), cls = new Uint8Array(n);
    for (let k = 0; k < n; k++) {
      const a = Math.exp(LA0 + ga(k) / 16777215 * (LA1 - LA0)), e = ge(k) / 65535, inc = gi(k) / 65535 * 180;
      const om = gom(k) / 65536 * 360, w = gw(k) / 65536 * 360, M = gm(k) / 65536 * 360, H = gH(k) / 8 - 2;
      const q = a * (1 - e);
      let c = 0;
      if (a > 30.1) c = 5; else if (a > 5.05 && a < 5.36 && e < 0.3) c = 2; else if (a > 5.5) c = 4; else if (q < 1.3) c = 3; else if (a > 3.7 && a < 4.2 && e < 0.3) c = 1;
      const s = AST.elemToState(a, e, inc, om, w, M);
      Pa.set([s[0], s[1], s[2], c], 4 * k); Va.set([s[3], s[4], s[5], H], 4 * k);
      aArr[k] = a; cls[k] = c;
    }
    A.a = aArr; A.cls = cls;
    if (eng) A.sim = AsteroidSim(gl, n, Pa, Va);
    A.ready = true;
    document.dispatchEvent(new CustomEvent('cw-asteroids'));
  }
  const plBuf = new Float32Array(AST_K * 7 * 3), plGM = new Float32Array(AST.PERT_GM), plTmp = new Float64Array(21);
  function asteroidCatchUp(budgetMs) {
    if (!A.sim) return;
    const t0 = performance.now();
    let need = Math.round((S.t - A.tg) / AST_DT);
    A.lag = need;
    while (need !== 0 && performance.now() - t0 < budgetMs) {
      const K = Math.min(AST_K, Math.abs(need)), dt = Math.sign(need) * AST_DT;
      const tEnd = A.tg + K * dt;
      if (!eph.covers(Math.min(A.tg, tEnd)) || !eph.covers(Math.max(A.tg, tEnd))) break;
      for (let k = 0; k < K; k++) { AST.perturbers(eph, A.tg + (k + 0.5) * dt, plTmp); for (let j = 0; j < 21; j++) plBuf[21 * k + j] = plTmp[j]; }
      A.sim.step(dt, K, plBuf, plGM, 7, AST.MU);
      A.tg = tEnd; need = Math.round((S.t - A.tg) / AST_DT);
    }
    A.lag = need;
  }

  /* ================================================================
     Comets and dwarf planets: massless particles on the CPU, checkpointed every 128 days
     ================================================================ */
  const SMALL_INFO = {
    Halley: { note: 'Returns every 75–76 years; next perihelion 28 July 2061.', year: '75–76 years', comet: true },
    Encke: { note: 'The shortest-period bright comet, 3.3 years; source of the Taurid meteors.', year: '3.3 years', comet: true },
    'Swift–Tuttle': { note: 'Parent of the August Perseid meteors; 26 km across, next back in 2126.', year: '133 years', comet: true },
    'Tempel–Tuttle': { note: 'Parent of the November Leonid meteor storms.', year: '33 years', comet: true },
    'Hale–Bopp': { note: 'The great comet of 1997, visible to the naked eye for 18 months.', year: '≈ 2,400 years', comet: true },
    Eris: { note: 'Almost exactly Pluto’s size and more massive; its discovery in 2005 led to Pluto’s reclassification.', year: '559 years' },
    Makemake: { note: 'A bright dwarf planet of the Kuiper belt, found around Easter 2005.', year: '306 years' },
    Haumea: { note: 'Spins every 3.9 hours, stretching it into an egg shape, and has a ring.', year: '284 years' },
    Sedna: { note: 'Never comes closer than 76 AU; its year is about 11,000 of ours.', year: '≈ 11,000 years' },
    Gonggong: { note: 'A reddish dwarf planet about 1,230 km across.', year: '550 years' },
    Quaoar: { note: 'Has a ring far outside the distance where rings should be able to survive.', year: '289 years' },
    Arrokoth: { note: 'The snowman-shaped world New Horizons flew past on 1 January 2019.', year: '298 years' },
    Apophis: { note: 'Passes 32,000 km above Earth on 13 April 2029.', year: '0.89 years' },
  };
  const SMALL = Object.entries(DATA.small).map(([name, s]) => ({ name, s0: s.slice(), info: SMALL_INFO[name] || {}, fwd: [s.slice()], bwd: [s.slice()], pos: null }));
  const SMALL_CK = 128, SMALL_DT = 2;
  function smallGrow(budgetMs) {
    const t0 = performance.now();
    for (const o of SMALL) {
      for (const dir of [1, -1]) {
        const list = dir > 0 ? o.fwd : o.bwd;
        const want = dir > 0 ? Math.min(eph.hi, T_MAX) : Math.max(eph.lo, T_MIN);
        while ((list.length - 1) * SMALL_CK < Math.abs(want) - SMALL_CK && performance.now() - t0 < budgetMs) {
          const s = list[list.length - 1].slice(), t = dir * (list.length - 1) * SMALL_CK;
          if (!AST.run(eph, s, t, dir * SMALL_DT, SMALL_CK / SMALL_DT)) { list.push(list[list.length - 1]); continue; }
          list.push(s);
        }
      }
    }
  }
  const smallTmp = [0, 0, 0, 0, 0, 0];
  function smallAt(o, t) {
    const k = Math.round(t / SMALL_CK), list = k >= 0 ? o.fwd : o.bwd, kk = Math.min(Math.abs(k), list.length - 1);
    const tc = Math.sign(k) * kk * SMALL_CK; const s = list[kk];
    for (let i = 0; i < 6; i++) smallTmp[i] = s[i];
    const span = t - tc; if (Math.abs(span) > 0.001) { const n = Math.ceil(Math.abs(span) / SMALL_DT); AST.run(eph, smallTmp, tc, span / n, n); }
    return smallTmp;
  }

  /* ================================================================
     Spacecraft (JPL trajectories, heliocentric) and Apophis in 2029
     ================================================================ */
  const CRAFT = Object.entries(DATA.craft).map(([name, b64]) => {
    const f = new Float32Array(Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer);
    const n = f.length / 7, T = new Float64Array(n), X = new Float64Array(6 * n);
    for (let i = 0; i < n; i++) { T[i] = f[7 * i]; for (let k = 0; k < 6; k++) X[6 * i + k] = f[7 * i + 1 + k]; }
    return { name, T, X, n, apophis: name.startsWith('Apophis') };
  });
  const CRAFT_INFO = {
    'Voyager 1': { launch: '5 Sep 1977', note: 'Flew past Jupiter (1979) and Saturn’s moon Titan (1980); crossed into interstellar space in 2012. The most distant human-made object.' },
    'Voyager 2': { launch: '20 Aug 1977', note: 'The only spacecraft to visit Uranus (1986) and Neptune (1989); left the heliosphere in 2018.' },
    'New Horizons': { launch: '19 Jan 2006', note: 'Flew past Pluto on 14 July 2015 and Arrokoth on 1 January 2019.' },
    'Pioneer 10': { launch: '3 Mar 1972', note: 'First through the asteroid belt and first to Jupiter (1973). Its last signal came in 2003.' },
    'Pioneer 11': { launch: '6 Apr 1973', note: 'Flew past Jupiter and then Saturn (1979), the first to do so. Silent since 1995.' },
  };
  function craftAt(c, t, out) {
    const T = c.T, X = c.X, n = c.n;
    if (t < T[0]) return null;
    if (t >= T[n - 1]) { if (c.apophis) return null; const dt = t - T[n - 1]; for (let k = 0; k < 3; k++) { out[k] = X[6 * (n - 1) + k] + X[6 * (n - 1) + 3 + k] * dt; out[3 + k] = X[6 * (n - 1) + 3 + k]; } return out; }
    let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    const h = T[hi] - T[lo], u = (t - T[lo]) / h, u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
    const d00 = (6 * u2 - 6 * u) / h, d10 = 3 * u2 - 4 * u + 1, d01 = (-6 * u2 + 6 * u) / h, d11 = 3 * u2 - 2 * u;
    for (let k = 0; k < 3; k++) {
      const p0 = X[6 * lo + k], p1 = X[6 * hi + k], v0 = X[6 * lo + 3 + k], v1 = X[6 * hi + 3 + k];
      out[k] = h00 * p0 + h10 * h * v0 + h01 * p1 + h11 * h * v1;
      out[3 + k] = d00 * p0 + d10 * v0 + d01 * p1 + d11 * v1;
    }
    return out;
  }
  // Apophis outside its JPL window: follow the particle integrated from the window's end (later) or from 2026 (earlier)
  const apophis = SMALL.find(o => o.name === 'Apophis'), apoTrack = CRAFT.find(c => c.apophis);
  if (apophis && apoTrack) {
    const n = apoTrack.n; apophis.after = { t: apoTrack.T[n - 1], s: Array.from(apoTrack.X.slice(6 * (n - 1), 6 * n)) };
  }
  // Apophis relative to Earth around the 2029 flyby, from JPL's track and the simulation's exact Earth
  let apoGeo = null;
  function buildApoGeo() {
    const out = [], ca = P.utToTdb(P.calToJd(2029, 4, 13) + 21.75 / 24) - P.EPOCH, tmp = P.makeSystem();
    for (let k = 0; k < apoTrack.n; k++) {
      const tt = apoTrack.T[k]; if (Math.abs(tt - ca) > 2.5) continue;
      eph.at(tt, tmp);
      out.push([tt, [0, 1, 2].map(q => apoTrack.X[6 * k + q] + tmp.x[q] - tmp.x[9 + q])]);
    }
    return out;
  }
  function apophisAt(t) {
    if (!apophis) return null;
    const out = [0, 0, 0, 0, 0, 0];
    if (apoTrack && t >= apoTrack.T[0] && t < apoTrack.T[apoTrack.n - 1]) return craftAt(apoTrack, t, out);
    if (apophis.after && t >= apophis.after.t) {
      if (!eph.covers(t)) return null;
      const s = apophis.after.s.slice(); const span = t - apophis.after.t, n = Math.max(1, Math.ceil(span / 2)); AST.run(eph, s, apophis.after.t, span / n, n); return s;
    }
    return smallAt(apophis, t).slice();
  }

  /* ================================================================
     Camera and matrices
     ================================================================ */
  function perspective(fovy, asp, n, f) { const q = 1 / Math.tan(fovy / 2), nf = 1 / (n - f); return [q / asp, 0, 0, 0, 0, q, 0, 0, 0, 0, (f + n) * nf, -1, 0, 0, 2 * f * n * nf, 0]; }
  function viewBasis() {
    const ce_ = Math.cos(cam.el), se_ = Math.sin(cam.el), ca = Math.cos(cam.az), sa = Math.sin(cam.az);
    const eye = [cam.dist * ce_ * ca, cam.dist * ce_ * sa, cam.dist * se_];
    const z = norm(eye);                                    // view +z points back toward the eye
    let x = norm(cross([0, 0, 1], z)); if (!isFinite(x[0])) x = [1, 0, 0];
    const y = cross(z, x);
    return { eye, x, y, z };
  }
  // display rotation (turning with Jupiter)
  function displayRot(st) {
    if (!S.jframe) return null;
    const j = 3 * 6, lon = Math.atan2(st.x[j + 1] - st.x[1], st.x[j] - st.x[0]);
    const c = Math.cos(-lon + Math.PI / 2 * 0), s = Math.sin(-lon);
    return [c, -s, 0, s, c, 0, 0, 0, 1]; // row-major: display = R * world
  }
  const rotApply = (R, v) => R ? [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]] : v;

  /* ================================================================
     Target positions
     ================================================================ */
  let st = eph.at(S.t, P.makeSystem());          // current full state
  const bodyPos = i => [st.x[3 * i], st.x[3 * i + 1], st.x[3 * i + 2]];
  const helioOf = p => [p[0] + st.x[0], p[1] + st.x[1], p[2] + st.x[2]];
  const craftTmp = [0, 0, 0, 0, 0, 0];
  function targetPos(tg) {
    if (typeof tg === 'number') return bodyPos(tg);
    if (tg === 'ssb') return [0, 0, 0];
    if (tg.startsWith('craft:')) { const c = CRAFT.find(c => c.name === tg.slice(6)); const p = c && craftAt(c, S.t, craftTmp); return p ? helioOf(p) : bodyPos(0); }
    if (tg.startsWith('small:')) { const o = SMALL.find(o => o.name === tg.slice(6)); const p = o && o.pos; return p ? helioOf(p) : bodyPos(0); }
    return bodyPos(0);
  }
  function targetName(tg) { if (typeof tg === 'number') return B[tg].name; if (tg === 'ssb') return 'Balance point'; return tg.split(':')[1]; }
  function follow(tg, dist) {
    cam.tgtFrom = camTargetPos.slice(); cam.tgtBlend = 0; S.target = tg;
    $('speedHud').hidden = !(typeof tg === 'string' && tg.startsWith('craft:'));
    if (dist) cam.distTo = dist;
    if (typeof tg === 'number' && tg > 0 && dist && dist < 0.5 && st) {
      const p = bodyPos(tg), sn = bodyPos(0); let az = Math.atan2(sn[1] - p[1], sn[0] - p[0]) + 0.75;
      if (S.jframe) { const j = 3 * 6; az -= Math.atan2(st.x[j + 1] - st.x[1], st.x[j] - st.x[0]); }
      cam.az = az;
    }
    syncFollowChips();
  }

  /* ================================================================
     Formatting
     ================================================================ */
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const MON = MONTHS.map(m => m.slice(0, 3));
  function yearStr(y) { return y > 0 ? String(y) : (1 - y) + ' BC'; }
  function calUT(t) { return P.jdToCal(P.tdbToUt(t + P.EPOCH)); }
  function fmtDate(t, long) {
    const c = calUT(t); const hh = c.frac * 24, h = Math.floor(hh), m = Math.floor((hh - h) * 60);
    return (long ? `${c.day} ${MONTHS[c.month - 1]} ${yearStr(c.year)}` : `${c.day} ${MON[c.month - 1]} ${yearStr(c.year)}`) + ` · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')} UT`;
  }
  function fmtClock(t) { const c = calUT(t); const s = Math.round(c.frac * 86400) % 86400; return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
  function fmtDur(sec) {
    if (sec < 60) return sec.toFixed(1) + ' s';
    if (sec < 3600) { const m = Math.floor(sec / 60), s = Math.round(sec - 60 * m); return s === 60 ? `${m + 1} min` : `${m} min ${s} s`; }
    if (sec < 86400 * 2) { const h = Math.floor(sec / 3600), m = Math.round((sec - 3600 * h) / 60); return `${h} h ${m} min`; }
    return (sec / 86400).toFixed(1) + ' days';
  }
  function fmtRate(r) { // days per second
    const s = r * DAY;
    if (s < 1.5) return 'real time';
    if (s < 90) return `${Math.round(s)} s per second`;
    if (s < 5400) return `${+(s / 60).toFixed(s < 600 ? 1 : 0)} min per second`;
    if (r < 1.5) return `${+(s / 3600).toFixed(s < 36000 ? 1 : 0)} h per second`;
    if (r < 60) return `${+r.toFixed(r < 10 ? 1 : 0)} days per second`;
    if (r < 365.25 * 1.5) return `${+(r / 30.44).toFixed(1)} months per second`;
    return `${+(r / 365.25).toFixed(r < 3652 ? 1 : 0)} years per second`;
  }
  function sup(n) { return String(n).split('').map(c => '⁰¹²³⁴⁵⁶⁷⁸⁹'['0123456789'.indexOf(c)] || (c === '-' ? '⁻' : c)).join(''); }
  function sci(x, d = 1) { if (!(x > 0)) return '0'; const e = Math.floor(Math.log10(x)); const m = x / Math.pow(10, e); return m.toFixed(d) + ' × 10' + sup(e); }
  function fmtAU(au) { const km = au * AU; if (km < 2e6) return Math.round(km).toLocaleString('en-US') + ' km'; return (au < 10 ? au.toFixed(3) : au.toFixed(2)) + ' AU'; }

  /* ================================================================
     Controls
     ================================================================ */
  const speedS = $('speed');
  const LR0 = Math.log10(1 / DAY), LR1 = Math.log10(365250);
  const sliderToRate = v => Math.pow(10, LR0 + (LR1 - LR0) * v / 1000);
  const rateToSlider = r => Math.round((Math.log10(r) - LR0) / (LR1 - LR0) * 1000);
  function setRate(r) { S.rate = r; speedS.value = rateToSlider(r); $('speedOut').textContent = fmtRate(r); }
  speedS.addEventListener('input', () => { S.rate = sliderToRate(+speedS.value); $('speedOut').textContent = fmtRate(S.rate); });
  setRate(S.rate);
  function syncPlay() { $('playBtn').textContent = S.playing ? 'Pause' : 'Play'; $('revBtn').setAttribute('aria-pressed', S.dir < 0 ? 'true' : 'false'); }
  $('playBtn').addEventListener('click', () => { S.playing = !S.playing; syncPlay(); });
  $('revBtn').addEventListener('click', () => { S.dir = -S.dir; S.playing = true; syncPlay(); });
  $('todayBtn').addEventListener('click', () => { setTime(nowT()); });
  const dateIn = $('dateIn');
  function syncDateIn() { if (document.activeElement === dateIn) return; const c = calUT(S.t); dateIn.value = `${c.year}-${String(c.month).padStart(2, '0')}-${String(c.day).padStart(2, '0')}`; }
  dateIn.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const m = dateIn.value.trim().match(/^(-?\d{1,4})(?:-(\d{1,2}))?(?:-(\d{1,2}))?(?:[ T](\d{1,2}):(\d{2}))?$/);
    if (!m) { dateIn.select(); return; }
    const y = +m[1], mo = +(m[2] || 1), d = +(m[3] || 1), hh = +(m[4] || 12), mm = +(m[5] || 0);
    setTime(P.utToTdb(P.calToJd(y, mo, d) + (hh + mm / 60) / 24) - P.EPOCH); dateIn.blur();
  });
  function setTime(t) { S.t = Math.max(T_MIN, Math.min(T_MAX, t)); st = null; syncDateIn(); }

  function setKey(k, v) {
    S[k] = v;
    const b = document.querySelector(`.chip[data-key="${k}"]`); if (b) b.setAttribute('aria-pressed', v ? 'true' : 'false');
    if (k === 'flash') { $('lightHud').hidden = !v; if (v) { S.tFlash = S.t; } }
  }
  document.querySelectorAll('.chip[data-key]').forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.key, v = !S[k];
    setKey(k, v);
    if (k === 'flash' && v) { S.dir = 1; S.playing = true; syncPlay(); setRate(60 / DAY); if (cam.dist > 60) cam.distTo = 12; caption(CAPS.flash); }
    if (k === 'jframe' && v) { caption(CAPS.trojans); cam.az = Math.PI; }
    if (k === 'trueScale' && v) caption(CAPS.trueScale);
  }));
  function setMask(m) { S.mask = m; document.querySelectorAll('#astKinds .chip').forEach(b => b.setAttribute('aria-pressed', (m >> +b.dataset.cls) & 1 ? 'true' : 'false')); }
  document.querySelectorAll('#astKinds .chip').forEach(b => b.addEventListener('click', () => {
    const c = +b.dataset.cls, on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    S.mask = on ? (S.mask | (1 << c)) : (S.mask & ~(1 << c));
  }));
  document.querySelectorAll('#views .chip[data-view]').forEach(b => b.addEventListener('click', () => {
    const v = b.dataset.view;
    if (v === 'inner') { follow(0, 4.2); cam.elTo = 0.62; }
    if (v === 'outer') { follow(0, 95); cam.elTo = 0.5; }
    if (v === 'top') cam.elTo = Math.PI / 2 - 0.002;
  }));
  // follow chips
  const FOLLOW = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'ssb'];
  const FOLLOW_DIST = { 0: 4.2, 1: 0.6, 2: 0.9, 3: 0.012, 4: 0.004, 5: 1.2, 6: 0.08, 7: 0.06, 8: 0.03, 9: 0.03, 10: 0.002, ssb: 0.03 };
  $('follow').innerHTML = FOLLOW.map(f => `<button class="chip" data-f="${f}" aria-pressed="false">${targetName(f)}</button>`).join('');
  $('follow').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
    const f = b.dataset.f === 'ssb' ? 'ssb' : +b.dataset.f;
    follow(f, FOLLOW_DIST[f]);
    if (f === 'ssb') { S.sunTrail = true; caption(CAPS.wobble); }
    else if (typeof f === 'number') caption(`<b>${B[f].name}.</b> ${B[f].note}`);
  }));
  function syncFollowChips() { $('follow').querySelectorAll('.chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f) === String(S.target) ? 'true' : 'false')); }
  syncFollowChips();

  /* ---------- pointer ---------- */
  const ptr = new Map(); let pinch0 = 0, dist0 = 0, dragged = false;
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); dragged = false; if (ptr.size === 2) { const [a, b] = [...ptr.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = cam.dist; } });
  canvas.addEventListener('pointermove', e => {
    if (!ptr.has(e.pointerId)) return; const p = ptr.get(e.pointerId), dx = e.clientX - p.x, dy = e.clientY - p.y;
    if (ptr.size === 1) { cam.az -= dx * 0.005; cam.el = Math.max(-1.55, Math.min(1.55, cam.el + dy * 0.005)); cam.elTo = null; if (Math.abs(dx) + Math.abs(dy) > 2) dragged = true; }
    p.x = e.clientX; p.y = e.clientY;
    if (ptr.size === 2) { const [a, b] = [...ptr.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch0 > 0) { cam.dist = Math.max(1e-5, Math.min(2000, dist0 * pinch0 / d)); cam.distTo = null; } }
  });
  const up = e => { ptr.delete(e.pointerId); if (ptr.size < 2) pinch0 = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.max(1e-5, Math.min(2000, cam.dist * Math.pow(1.0015, e.deltaY))); cam.distTo = null; }, { passive: false });

  /* ================================================================
     Captions and show-me actions
     ================================================================ */
  const CAPS = {
    today: 'This is where everything is right now, computed from JPL’s measured positions on 1 January 2026. The planets move under their mutual gravity alone, and nothing is placed on a track.',
    flash: '<b>A flash leaves the Sun</b> and spreads at the speed of light, shown here in true proportion to the orbits. It reaches Mercury after 3 minutes, Earth after 8 min 20 s and Jupiter after 43 minutes. Time runs at one minute per second.',
    wobble: '<b>The Sun’s dance.</b> The cross is the centre of mass of the whole solar system, the point everything actually orbits. The Sun is drawn to scale, and the curve is the path of its centre over 60 years. Jupiter (12-year orbit) and Saturn (29 years) do most of the pulling; when they line up the Sun’s centre can move more than a solar radius outside the Sun itself.',
    trojans: '<b>Turning with Jupiter.</b> The view now rotates once every 11.9 years so Jupiter stays put. The green <b>Trojans</b> gather 60° ahead of and behind it, at the Lagrange points L4 and L5. The orange <b>Hildas</b> circle the Sun three times for every two Jupiter orbits, which bunches them into a triangle with corners at L4, L5 and opposite Jupiter.',
    trueScale: '<b>True sizes.</b> Planets are now drawn at their real size, which at this distance is far smaller than a pixel. Only their names remain. If the Sun were a grapefruit, Earth would be a grain of sand 15 metres away and Neptune a peppercorn half a kilometre away.',
    mercury: '<b>Mercury</b> races around the Sun in 88 days on the most stretched orbit of any planet. Its closest point to the Sun turns 575″ a century, about the width of a thumbnail held at arm’s length every 400 years. 43″ of that comes from Einstein’s curved spacetime. The section below measures it.',
    voyager: '<b>Voyager 2, launched 20 August 1977.</b> The chart shows its speed around the Sun (blue) against the speed needed to escape the Sun from where it is (grey). It left Earth too slow to escape. Each planetary flyby swings it forward and adds speed, and after Jupiter it never needed to come back.',
    apophis: '<b>Apophis, 13 April 2029.</b> The 340-metre asteroid swings past Earth at 7.4 km/s, passing <b>32,000 km above the surface</b>, inside the ring of geostationary satellites (the dotted circle). Its path is JPL’s. Earth’s gravity bends it visibly and changes its orbit around the Sun for good.',
    halley: '<b>Halley’s comet</b> on its way back. It turned around beyond Neptune in December 2023 and will pass closest to the Sun on 28 July 2061. The simulation moves it with gravity alone; real comets are also nudged by jets of evaporating ice, which shift Halley’s returns by a few days.',
  };
  function caption(html) { $('caption').innerHTML = html; }
  function showMe(what) {
    const stage = $('stage');
    S.playing = true; S.dir = 1; syncPlay();
    setKey('flash', false); setKey('jframe', false); S.sunTrail = false; if (what !== 'trojans') setMask(63);
    if (what === 'today') { setTime(nowT()); follow(0, 4.2); cam.elTo = 0.62; setRate(3); caption(CAPS.today); }
    if (what === 'flash') { follow(0, 7); cam.elTo = 1.1; setKey('flash', true); setRate(60 / DAY); caption(CAPS.flash); }
    if (what === 'wobble') { follow('ssb', 0.028); cam.elTo = Math.PI / 2 - 0.002; S.sunTrail = true; setRate(365.25 * 1.5); caption(CAPS.wobble); }
    if (what === 'mercury') { follow(1, 0.9); cam.elTo = 1.0; setRate(4); caption(CAPS.mercury); }
    if (what === 'trojans') { follow(0, 16.5); cam.elTo = Math.PI / 2 - 0.002; cam.az = Math.PI; setKey('jframe', true); setMask(0b000110); setRate(40); caption(CAPS.trojans); }
    if (what === 'voyager') { setTime(P.calToJd(1977, 8, 21) - P.EPOCH); follow('craft:Voyager 2', 5.5); cam.elTo = 0.9; setRate(40); caption(CAPS.voyager); }
    if (what === 'apophis') { setTime(P.utToTdb(P.calToJd(2029, 4, 13) + 18.5 / 24) - P.EPOCH); st = eph.at(S.t, P.makeSystem()); follow(3, 0.0016); cam.elTo = 0.5; setRate(1 / 24 / 6); caption(CAPS.apophis); }
    if (what === 'halley') { follow('small:Halley', 42); cam.elTo = 0.75; setRate(365.25 * 2); caption(CAPS.halley); }
    stage.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
  // Earth seen from the Sun's side as the Moon's shadow crosses it
  function eclipseView(tMid) {
    S.playing = true; S.dir = 1; syncPlay(); setKey('flash', false); setKey('jframe', false); S.sunTrail = false; setMask(63); $('speedHud').hidden = true;
    eph.growTo(tMid - 5, tMid + 5, 5000);
    setTime(tMid - 1.3 / 24); st = eph.at(S.t, P.makeSystem());
    const e = bodyPos(3), sn = bodyPos(0), d = [sn[0] - e[0], sn[1] - e[1], sn[2] - e[2]];
    follow(3, 0.00028); cam.az = Math.atan2(d[1], d[0]) + 0.2; cam.elTo = Math.atan2(d[2], Math.hypot(d[0], d[1])) + 0.35;
    setRate(2.5 / 60 / 24);
    caption('<b>2 August 2027, seen from the Sun’s side.</b> The Moon (behind you) casts its shadow on Earth: the soft grey patch is the penumbra, where the Sun is partly covered, and the small dark core is the umbra racing east at over 2,000 km/h. Everyone inside that dot sees a total eclipse. The shading is computed from the Sun, Moon and Earth positions in the simulation.');
    $('stage').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }
  document.addEventListener('cw-eclipse-view', e => eclipseView(e.detail.t));
  document.querySelectorAll('.show[data-show]').forEach(b => b.addEventListener('click', () => {
    const w = b.dataset.show;
    if (w === 'eclipse2027') { document.dispatchEvent(new CustomEvent('cw-eclipse', { detail: { y: 2027, m: 8, d: 2, scroll: false } })); eclipseView(P.utToTdb(P.calToJd(2027, 8, 2) + 10.1 / 24) - P.EPOCH); return; }
    showMe(w);
  }));

  /* ================================================================
     Frame building
     ================================================================ */
  const tagsEl = $('tags');
  const tagEls = new Map();
  function tag(key, text, cls) {
    let el = tagEls.get(key);
    if (!el) { el = document.createElement('div'); el.className = 'tag'; tagsEl.appendChild(el); tagEls.set(key, el); el.addEventListener('click', () => onTagClick(key)); }
    el.dataset.used = '1';
    if (el.textContent !== text) el.textContent = text;
    el.className = 'tag ' + (cls || '');
    return el;
  }
  function onTagClick(key) {
    if (key.startsWith('b')) { const i = +key.slice(1); follow(i, FOLLOW_DIST[i] || Math.max(0.002, B[i].R * 400)); caption(`<b>${B[i].name}.</b> ${B[i].note}`); }
    else if (key.startsWith('s:')) { const o = SMALL.find(o => o.name === key.slice(2)); follow('small:' + o.name, 2.5); caption(`<b>${o.name}.</b> ${o.info.note || ''}`); }
    else if (key.startsWith('c:')) { const n = key.slice(2); follow('craft:' + n, 3); caption(`<b>${n}</b>, launched ${CRAFT_INFO[n] ? CRAFT_INFO[n].launch : ''}. ${CRAFT_INFO[n] ? CRAFT_INFO[n].note : ''}`); }
  }

  // osculating ellipse of body pos/vel relative to a centre, as a fading trail behind the body
  function ellipse(rel, vel, mu, out, off, N, alpha) {
    const r = Math.hypot(...rel), v2 = dot(vel, vel), a = 1 / (2 / r - v2 / mu);
    if (!(a > 0)) return 0;
    const h = cross(rel, vel), ev = cross(vel, h).map((c, k) => c / mu - rel[k] / r), e = Math.hypot(...ev);
    const Pv = e > 1e-8 ? ev.map(c => c / e) : norm(rel), Qv = norm(cross(h, Pv)), b = a * Math.sqrt(1 - e * e);
    const cosE = (1 - r / a) / (e || 1e-12), sinE = dot(rel, vel) / (e * Math.sqrt(mu * a) || 1e-12);
    let E0 = e > 1e-8 ? Math.atan2(sinE, cosE) : Math.atan2(dot(rel, Qv), dot(rel, Pv));
    for (let k = 0; k < N; k++) {
      const s = k / (N - 1), E = E0 - s * 2 * Math.PI;
      const x = a * (Math.cos(E) - e), y = b * Math.sin(E);
      for (let q = 0; q < 3; q++) out[off + 4 * k + q] = x * Pv[q] + y * Qv[q];
      out[off + 4 * k + 3] = alpha * (0.12 + 0.88 * Math.pow(1 - s, 1.6));
    }
    return a;
  }
  const ORB_N = 300;
  const orbBuf = new Float32Array(ORB_N * 4 * 64);
  let W = 1, H = 1, dpr = 1;
  function fit() { dpr = Math.min(2, window.devicePixelRatio || 1); const r = canvas.getBoundingClientRect(); W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr)); if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; } }

  const sunTrail = { t0: NaN, data: null };
  function buildSunTrail() {
    const span = 365.25 * 30, n = 1200, d = new Float32Array(4 * n); const tmp = new Float64Array(3 * P.N);
    let lo = Math.max(S.t - span, eph.lo), hi = Math.min(S.t + span, eph.hi);
    for (let k = 0; k < n; k++) { const tt = lo + (hi - lo) * k / (n - 1); eph.interp(tt, tmp); d[4 * k] = tmp[0]; d[4 * k + 1] = tmp[1]; d[4 * k + 2] = tmp[2]; d[4 * k + 3] = tt <= S.t ? 0.95 : 0.3; }
    sunTrail.t0 = S.t; sunTrail.data = d; sunTrail.lo = lo; sunTrail.hi = hi;
  }

  let lastFrame = performance.now(), simTime = 0;
  let frameInfo = null;
  function render(now) {
    try { frame(now); } catch (e) { console.error(e); }
    requestAnimationFrame(render);
  }
  function frame(now) {
    const dtw = Math.min(0.1, (now - lastFrame) / 1000); lastFrame = now; simTime += dtw;
    // advance time
    const covered = eph.covers(S.t);
    if (S.playing && covered) {
      const nt = S.t + S.dir * S.rate * dtw;
      const lim = S.dir > 0 ? Math.min(nt, eph.hi, T_MAX) : Math.max(nt, eph.lo, T_MIN);
      S.t = lim; if ((S.dir > 0 && S.t >= T_MAX) || (S.dir < 0 && S.t <= T_MIN)) { S.playing = false; syncPlay(); }
    }
    // grow the ephemeris: urgently around the current time, then out to the full range
    const need = !eph.covers(S.t - 40) || !eph.covers(S.t + 40);
    if (need) eph.growTo(Math.min(S.t - 400, 0), Math.max(S.t + 400, 0), 30);
    else eph.growTo(T_MIN, T_MAX, 7);
    smallGrow(2);
    if (!eph.covers(S.t)) { showStatus(`computing orbits · ${yearStr(calUT(S.t < 0 ? eph.lo : eph.hi).year)}`); return; }
    st = eph.at(S.t, st || P.makeSystem());
    asteroidCatchUp(A.lag > 64 ? 22 : 8);
    if (Math.abs(A.lag) > 2) showStatus('moving asteroids to the date'); else showStatus(null);

    fit();
    // camera target smoothing
    const tp = targetPos(S.target);
    if (cam.tgtBlend < 1) { cam.tgtBlend = Math.min(1, cam.tgtBlend + dtw / 1.1); const s = cam.tgtBlend * cam.tgtBlend * (3 - 2 * cam.tgtBlend); camTargetPos = tp.map((v, k) => cam.tgtFrom[k] + (v - cam.tgtFrom[k]) * s); }
    else camTargetPos = tp;
    if (cam.distTo) { cam.dist = Math.exp(Math.log(cam.dist) + (Math.log(cam.distTo) - Math.log(cam.dist)) * Math.min(1, dtw * 3)); if (Math.abs(Math.log(cam.dist / cam.distTo)) < 0.002) { cam.dist = cam.distTo; cam.distTo = null; } }
    if (cam.elTo != null) { cam.el += (cam.elTo - cam.el) * Math.min(1, dtw * 3); if (Math.abs(cam.el - cam.elTo) < 1e-3) cam.elTo = null; }

    const R = displayRot(st);
    const vb = viewBasis();
    const near = cam.dist * 1e-4, far = cam.dist * 1e5;
    const Pm = perspective(cam.fov, W / H, near, far);
    // view matrix (column-major) for display-frame coordinates relative to the target
    const V = [vb.x[0], vb.y[0], vb.z[0], 0, vb.x[1], vb.y[1], vb.z[1], 0, vb.x[2], vb.y[2], vb.z[2], 0, -dot(vb.x, vb.eye), -dot(vb.y, vb.eye), -dot(vb.z, vb.eye), 1];
    const VP = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += Pm[k * 4 + j] * V[i * 4 + k]; VP[i * 4 + j] = s; }
    const toDisp = p => rotApply(R, [p[0] - camTargetPos[0], p[1] - camTargetPos[1], p[2] - camTargetPos[2]]);
    const toView = d => { const q = [d[0] - vb.eye[0], d[1] - vb.eye[1], d[2] - vb.eye[2]]; return [dot(vb.x, q), dot(vb.y, q), dot(vb.z, q)]; };
    const dirView = w => { const d = rotApply(R, w); return [dot(vb.x, d), dot(vb.y, d), dot(vb.z, d)]; };
    // world direction -> view (for matrices): view = Vb * R * world
    const Mwv = [0, 1, 2].map(r => { const row = [vb.x, vb.y, vb.z][r]; return R ? [0, 1, 2].map(c => row[0] * R[c] + row[1] * R[3 + c] + row[2] * R[6 + c]) : row.slice(); }); // rows
    const pxAt = d => 2 * d * Math.tan(cam.fov / 2) / H * dpr;   // AU per CSS px at view distance d
    const project = v => { const x = Pm[0] * v[0], y = Pm[5] * v[1], w = -v[2]; return w > 0 ? [(x / w * 0.5 + 0.5) * W / dpr, (0.5 - y / w * 0.5) * H / dpr, w] : null; };

    const jd = S.t + P.EPOCH;
    const sunW = bodyPos(0);
    const sunV = toView(toDisp(sunW));
    const lines = [], bodies = [];
    let orbOff = 0;
    // orbits
    if (S.orbits) {
      for (let i = 1; i <= 14; i++) {
        if (B[i].minor && !S.minor) continue;
        if (i === 4 && cam.dist > 0.3) continue;
        const c = i === 4 ? 3 : 0, mu = P.GM[c] + P.GM[i];
        const rel = [0, 1, 2].map(k => st.x[3 * i + k] - st.x[3 * c + k]), vel = [0, 1, 2].map(k => st.v[3 * i + k] - st.v[3 * c + k]);
        if (orbOff + ORB_N * 4 > orbBuf.length) break;
        const a = ellipse(rel, vel, mu, orbBuf, orbOff, ORB_N, B[i].minor ? 0.45 : 0.9);
        if (!a) continue;
        const cp = toDisp(bodyPos(c));
        for (let k = 0; k < ORB_N; k++) { const o = orbOff + 4 * k; const d = rotApply(R, [orbBuf[o], orbBuf[o + 1], orbBuf[o + 2]]); orbBuf[o] = d[0] + cp[0]; orbBuf[o + 1] = d[1] + cp[1]; orbBuf[o + 2] = d[2] + cp[2]; }
        const col = B[i].minor ? [0.6, 0.6, 0.66, 0.3] : [B[i].col[0] * 0.8 + 0.2, B[i].col[1] * 0.8 + 0.2, B[i].col[2] * 0.8 + 0.2, 0.55];
        lines.push({ data: orbBuf.subarray(orbOff, orbOff + 4 * ORB_N), count: ORB_N, col });
        orbOff += 4 * ORB_N;
      }
    }
    // comets and dwarf planets: their current (osculating) orbits around the Sun
    if (S.orbits && S.minor) {
      const cs = toDisp(sunW);
      for (const o of SMALL) {
        if (o.name === 'Apophis' || !o.pos) continue;
        const p = smallAt(o, S.t), sel = S.target === 'small:' + o.name;
        if (orbOff + ORB_N * 4 > orbBuf.length) break;
        const a = ellipse([p[0], p[1], p[2]], [p[3], p[4], p[5]], P.GM[0], orbBuf, orbOff, ORB_N, sel ? 1 : 0.5);
        if (!a) continue;
        for (let k = 0; k < ORB_N; k++) { const q = orbOff + 4 * k; const d = rotApply(R, [orbBuf[q], orbBuf[q + 1], orbBuf[q + 2]]); orbBuf[q] = d[0] + cs[0]; orbBuf[q + 1] = d[1] + cs[1]; orbBuf[q + 2] = d[2] + cs[2]; }
        lines.push({ data: orbBuf.subarray(orbOff, orbOff + 4 * ORB_N), count: ORB_N, col: o.info.comet ? [0.55, 0.85, 0.95, sel ? 0.8 : 0.22] : [0.75, 0.7, 0.9, sel ? 0.8 : 0.22] });
        orbOff += 4 * ORB_N;
      }
    }
    // Sun's path around the balance point
    if (S.sunTrail) {
      if (!sunTrail.data || Math.abs(S.t - sunTrail.t0) > 365 || isNaN(sunTrail.t0)) buildSunTrail();
      const d = sunTrail.data, n = d.length / 4, out = new Float32Array(d.length);
      for (let k = 0; k < n; k++) { const p = toDisp([d[4 * k], d[4 * k + 1], d[4 * k + 2]]); out.set([p[0], p[1], p[2], d[4 * k + 3]], 4 * k); }
      lines.push({ data: out, count: n, col: [1, 0.78, 0.4, 0.9] });
      const c = toDisp([0, 0, 0]), s = cam.dist * 0.035;
      lines.push({ data: new Float32Array([c[0] - s, c[1], c[2], 1, c[0] + s, c[1], c[2], 1, c[0], c[1] - s, c[2], 1, c[0], c[1] + s, c[2], 1]), count: 4, col: [1, 1, 1, 0.9], strip: false });
    }
    // spacecraft
    const craftNow = [];
    if (S.craft) for (const c of CRAFT) {
      if (c.apophis) continue;
      const p = craftAt(c, S.t, [0, 0, 0, 0, 0, 0]); if (!p) continue;
      // track up to now (bright) and a faint remainder
      let n = 0; for (; n < c.n && c.T[n] <= S.t; n++);
      const stride = Math.max(1, Math.floor(c.n / 700));
      const pts = []; const tmp = new Float64Array(3 * P.N);
      for (let k = 0; k < n; k += stride) { eph.covers(c.T[k]) ? eph.interp(c.T[k], tmp) : tmp.fill(0); const q = toDisp([c.X[6 * k] + tmp[0], c.X[6 * k + 1] + tmp[1], c.X[6 * k + 2] + tmp[2]]); pts.push(q[0], q[1], q[2], 0.9); }
      const q = toDisp(helioOf(p)); pts.push(q[0], q[1], q[2], 0.9);
      const sel = S.target === 'craft:' + c.name;
      lines.push({ data: new Float32Array(pts), count: pts.length / 4, col: [0.56, 0.76, 0.93, sel ? 0.85 : 0.22] });
      craftNow.push({ c, q });
    }
    // Apophis near Earth: its path as a line, plus the geostationary ring
    let apo = null;
    if (S.minor) {
      const pa = apophisAt(S.t);
      if (pa) {
        apo = toDisp(helioOf(pa));
        if (apoTrack && S.t > apoTrack.T[0] - 30 && S.t < apoTrack.T[apoTrack.n - 1] + 30 && cam.dist < 0.05) {
          if (!apoGeo) apoGeo = buildApoGeo();
          const e0 = toDisp(bodyPos(3)), pts = [];
          for (const [tt, g] of apoGeo) { const d = rotApply(R, g); pts.push(e0[0] + d[0], e0[1] + d[1], e0[2] + d[2], tt <= S.t ? 0.95 : 0.35); }
          lines.push({ data: new Float32Array(pts), count: pts.length / 4, col: [1, 0.45, 0.35, 0.9] });
          // geostationary ring (Earth's equator, radius 42,164 km)
          const ef = ECL.earthFixed(jd), ex = [ef[0], ef[1], ef[2]], ey = [ef[3], ef[4], ef[5]], rg = 42164 / AU, ring = [], c0 = toDisp(bodyPos(3));
          for (let k = 0; k <= 180; k++) { const a = k / 180 * 2 * Math.PI; const w = [0, 1, 2].map(q => (Math.cos(a) * ex[q] + Math.sin(a) * ey[q]) * rg); const d = rotApply(R, w); ring.push(c0[0] + d[0], c0[1] + d[1], c0[2] + d[2], (k % 6 < 3) ? 0.7 : 0); }
          lines.push({ data: new Float32Array(ring), count: 181, col: [0.56, 0.76, 0.93, 0.8] });
        }
      }
    }
    // bodies
    const moonSep = (() => { const a = toView(toDisp(bodyPos(3))), b = toView(toDisp(bodyPos(4))); const pa = project(a), pb = project(b); return pa && pb ? Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) : 999; })();
    const earthV = toView(toDisp(bodyPos(3))), moonV = toView(toDisp(bodyPos(4)));
    for (const b of B) {
      if (b.minor && !S.minor) continue;
      const w = bodyPos(b.i), c = toView(toDisp(w)), d = Math.hypot(...c);
      let r = b.R; const minR = (S.trueScale ? 0 : b.minPx) * pxAt(d);
      const enlarged = minR > r; r = Math.max(r, minR);
      if (b.i === 4 && enlarged && moonSep < 7) { b._c = null; continue; }
      const L = b.i === 0 ? [0, 0, 1] : norm([sunV[0] - c[0], sunV[1] - c[1], sunV[2] - c[2]]);
      let wb;
      if (b.i === 3) { const m = ECL.earthFixed(jd); wb = [[m[0], m[1], m[2]], [m[3], m[4], m[5]], [m[6], m[7], m[8]]]; }
      else if (b.i === 4) { const z = b.pole, toE = norm([st.x[9] - st.x[12], st.x[10] - st.x[13], st.x[11] - st.x[14]]); const x = norm(toE.map((v, k) => v - dot(toE, z) * z[k])); wb = [x, cross(z, x), z]; }
      else wb = bodyAxes(b, jd);
      // toBody (column-major mat3 for GLSL): body = WB * world = WB * Mwv^T * view, where Mwv maps world to view
      const M = [0, 1, 2].map(r_ => [0, 1, 2].map(c_ => wb[r_][0] * Mwv[c_][0] + wb[r_][1] * Mwv[c_][1] + wb[r_][2] * Mwv[c_][2]));
      const toBody = [M[0][0], M[1][0], M[2][0], M[0][1], M[1][1], M[2][1], M[0][2], M[1][2], M[2][2]];
      const o = { c, r, kind: b.kind, col: b.col, col2: b.col2, L, toBody, name: b.name };
      if (b.i === 0) o.glow = { grow: 14, i: enlarged ? 0.55 : 0.35, col: [1, 0.72, 0.4] };
      if (b.ring) { const n = dirView(b.pole); const ax = norm(cross(n, Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0])); o.ring = { n, ax, ay: cross(n, ax) }; }
      if (b.i === 3 || b.i === 4) {
        const other = b.i === 3 ? moonV : earthV, orad = b.i === 3 ? B[4].R : B[3].R;
        // only a physical (un-enlarged) eclipse makes sense
        if (!enlarged) { o.occ = [other[0], other[1], other[2], orad]; o.sunC = sunV; o.sunR = Math.asin(B[0].R / Math.hypot(sunV[0] - c[0], sunV[1] - c[1], sunV[2] - c[2])); o.eclipse = b.i === 4 ? 1 : 0; }
      }
      bodies.push(o);
      b._c = c; b._r = r; b._enl = enlarged;
    }
    // light shell
    let shell = null;
    if (S.flash) {
      const rad = Math.max(0, (S.t - S.tFlash)) * P.C;
      if (rad > 0) {
        shell = { c: sunV, r: rad };
        const c0 = toDisp(sunW), ring = new Float32Array(4 * 241);
        for (let k = 0; k <= 240; k++) { const a = k / 240 * 2 * Math.PI; const d = rotApply(R, [Math.cos(a) * rad, Math.sin(a) * rad, 0]); ring.set([c0[0] + d[0], c0[1] + d[1], c0[2] + d[2], 1], 4 * k); }
        lines.push({ data: ring, count: 241, col: [1, 0.85, 0.5, 0.9] });
      }
    }
    frameInfo = { R, toDisp, toView, project, pxAt };
    if (eng) {
      eng.render({
        W, H, P: new Float32Array(Pm), VP, cam: { fwd: rotApply(R ? [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]] : null, [-vb.z[0], -vb.z[1], -vb.z[2]]), right: rotApply(R ? [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]] : null, vb.x), up: rotApply(R ? [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]] : null, vb.y) },
        tanX: Math.tan(cam.fov / 2) * W / H, tanY: Math.tan(cam.fov / 2), starDim: 1,
        lines, bodies, shell, time: simTime,
        ast: A.sim && S.mask ? { sim: A.sim, rot: new Float32Array(R ? [R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]] : [1, 0, 0, 0, 1, 0, 0, 0, 1]), sunRel: new Float32Array([sunW[0] - camTargetPos[0], sunW[1] - camTargetPos[1], sunW[2] - camTargetPos[2]].map((v, k, a) => v)), dtDisp: S.t - A.tg, mu: AST.MU, pt: Math.max(1.5, 1.6 * dpr), alpha: astAlpha() / Math.sqrt(dpr), mask: S.mask } : null,
      });
    }
    // the asteroid shader rotates (sun + x) by uRot, so pass the unrotated sun-relative offset
    placeTags(project, R, craftNow, apo);
    readouts(tp);
    if (S.flash) lightHud();
    if (!$('speedHud').hidden) drawSpeedChart();
    syncDateIn();
    document.dispatchEvent(new CustomEvent('cw-frame'));
  }
  function astAlpha() { const d = cam.dist; return Math.min(0.7, Math.max(0.02, 1.1 / Math.pow(d, 0.5) * Math.min(1, Math.pow(6 / d, 0.9)))); }
  function drawIdle() { if (!eng) return; }
  let statusMsg = null;
  function showStatus(msg) { if (msg === statusMsg) return; statusMsg = msg; $('status').hidden = !msg; if (msg) $('statusText').textContent = msg; }

  /* ---------- labels ---------- */
  function placeTags(project, R, craftNow, apo) {
    for (const el of tagEls.values()) el.dataset.used = '';
    if (S.labels) {
      const shown = [];
      const put = (key, v, text, cls, prio) => {
        if (!v) return;
        const p = project(v); if (!p) return;
        if (p[0] < -40 || p[0] > W / dpr + 40 || p[1] < -20 || p[1] > H / dpr + 20) return;
        for (const q of shown) if (Math.abs(q[0] - p[0]) < 44 && Math.abs(q[1] - p[1]) < 12 && q[2] >= prio) return;
        shown.push([p[0], p[1], prio]);
        const el = tag(key, text, cls); el.style.transform = `translate(${(p[0] + 8).toFixed(1)}px, ${(p[1] - 6).toFixed(1)}px)`;
      };
      for (const b of B) {
        if (b.minor && !S.minor) continue;
        if (b.i === 4 && cam.dist > 0.08) continue;
        if (b.minor && b.i > 10 && cam.dist > 12) continue;
        put('b' + b.i, b._c, b.name, (b.minor ? 'minor' : '') + (String(S.target) === String(b.i) ? ' sel' : '') + (S.trueScale && b.i ? ' ring' : ''), b.minor ? 1 : 3);
      }
      if (S.craft) for (const { c, q } of craftNow) put('c:' + c.name, frameInfo.toView(q), c.name, 'craft' + (S.target === 'craft:' + c.name ? ' sel' : ''), 2);
      if (S.minor) for (const o of SMALL) {
        if (o.name === 'Apophis') { if (apo && cam.dist < 0.05) put('s:Apophis', frameInfo.toView(apo), 'Apophis', 'minor sel', 2); continue; }
        const p = smallAt(o, S.t); o.pos = [p[0], p[1], p[2]];
        if (!(cam.dist > 1.5 || S.target === 'small:' + o.name)) continue;
        put('s:' + o.name, frameInfo.toView(frameInfo.toDisp(helioOf(o.pos))), o.name, 'minor' + (S.target === 'small:' + o.name ? ' sel' : ''), 1);
      }
    } else if (S.minor) for (const o of SMALL) { const p = smallAt(o, S.t); o.pos = [p[0], p[1], p[2]]; }
    for (const el of tagEls.values()) el.style.display = el.dataset.used ? '' : 'none';
  }

  /* ---------- readouts ---------- */
  let roLast = 0;
  function readouts(tp) {
    const now = performance.now(); if (now - roLast < 120) return; roLast = now;
    const tg = S.target, sun = bodyPos(0), earth = bodyPos(3);
    $('rName').textContent = targetName(tg);
    const dS = Math.hypot(tp[0] - sun[0], tp[1] - sun[1], tp[2] - sun[2]), dE = Math.hypot(tp[0] - earth[0], tp[1] - earth[1], tp[2] - earth[2]);
    $('rSun').textContent = tg === 0 ? '—' : fmtAU(dS);
    $('rLight').textContent = tg === 0 ? '—' : fmtDur(dS * AU / 299792.458);
    $('rEarth').textContent = tg === 3 ? '—' : fmtAU(dE);
    let v = null;
    if (typeof tg === 'number' && tg > 0) { const c = tg === 4 ? 3 : 0; v = Math.hypot(st.v[3 * tg] - st.v[3 * c], st.v[3 * tg + 1] - st.v[3 * c + 1], st.v[3 * tg + 2] - st.v[3 * c + 2]); }
    else if (typeof tg === 'string' && tg.startsWith('craft:')) { const c = CRAFT.find(c => c.name === tg.slice(6)); const p = craftAt(c, S.t, [0, 0, 0, 0, 0, 0]); if (p) v = Math.hypot(p[3], p[4], p[5]); }
    else if (typeof tg === 'string' && tg.startsWith('small:')) { const o = SMALL.find(o => o.name === tg.slice(6)); if (o) { const p = smallAt(o, S.t); v = Math.hypot(p[3], p[4], p[5]); } }
    $('rSpeed').textContent = v ? (v * AU / DAY).toFixed(2) + ' km/s' + (tg === 4 ? ' round Earth' : '') : '—';
    $('rYear').textContent = typeof tg === 'number' ? (yearOf(tg) + ' · ' + B[tg].day.split(' (')[0]) : '—';
    const off = Math.hypot(sun[0], sun[1], sun[2]) / B[0].R;
    $('rWobble').textContent = off.toFixed(2) + ' solar radii';
    const e = P.energy(st), de = Math.abs((e - E0) / E0);
    $('rEnergy').textContent = de > 0 ? '1 part in ' + sci(1 / de, 1).replace(' × ', '×') : 'exactly';
    $('rRate').textContent = S.playing ? (S.dir < 0 ? '← ' : '') + fmtRate(S.rate) : 'paused';
    const c = calUT(S.t);
    $('dateSmall').textContent = (S.t < T_MIN + 1 || S.t > T_MAX - 1) ? 'end of the simulated range' : (c.year < 1583 ? 'Julian calendar · ' : '') + fmtClock(S.t) + ' UT';
    $('dateText').textContent = `${c.day} ${MONTHS[c.month - 1]} ${yearStr(c.year)}`;
  }
  function yearOf(i) {
    if (i === 0) return '—';
    const c = i === 4 ? 3 : 0;
    // Earth's year is that of the Earth-Moon pair's centre of mass, which carries the Earth around the Sun
    const m3 = P.GM[3] / (P.GM[3] + P.GM[4]), m4 = 1 - m3;
    const px = k => i === 3 ? m3 * st.x[9 + k] + m4 * st.x[12 + k] : st.x[3 * i + k], pv = k => i === 3 ? m3 * st.v[9 + k] + m4 * st.v[12 + k] : st.v[3 * i + k];
    const mu = P.GM[c] + P.GM[i] + (i === 3 ? P.GM[4] : 0);
    const r = Math.hypot(px(0) - st.x[3 * c], px(1) - st.x[3 * c + 1], px(2) - st.x[3 * c + 2]);
    const v2 = (pv(0) - st.v[3 * c]) ** 2 + (pv(1) - st.v[3 * c + 1]) ** 2 + (pv(2) - st.v[3 * c + 2]) ** 2;
    const a = 1 / (2 / r - v2 / mu), T = 2 * Math.PI * Math.sqrt(a * a * a / mu);
    return T < 400 ? T.toFixed(1) + ' days' : (T / 365.25).toFixed(T < 3650 ? 2 : 1) + ' yr';
  }

  /* ---------- light-speed panel ---------- */
  function lightHud() {
    const rad = Math.max(0, S.t - S.tFlash) * P.C, sun = bodyPos(0);
    let html = `<dt>light has gone</dt><dd class="reached">${fmtAU(rad)}</dd><dt>time since flash</dt><dd>${fmtDur((S.t - S.tFlash) * DAY)}</dd>`;
    for (const i of [1, 2, 3, 5, 6, 7, 8, 9]) {
      const p = bodyPos(i), d = Math.hypot(p[0] - sun[0], p[1] - sun[1], p[2] - sun[2]);
      html += `<dt>${B[i].name}</dt><dd class="${rad >= d ? 'reached' : ''}">${rad >= d ? 'reached · ' : ''}${fmtDur(d * AU / 299792.458)}</dd>`;
    }
    $('lightHud').innerHTML = html;
  }

  /* ---------- spacecraft speed chart ---------- */
  function drawSpeedChart() {
    const cv = $('speedChart'), ctx = cv.getContext('2d');
    const r = cv.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1);
    if (cv.width !== Math.round(r.width * d)) { cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d); }
    const w = cv.width / d, h = cv.height / d; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.clearRect(0, 0, w, h);
    const name = typeof S.target === 'string' && S.target.startsWith('craft:') ? S.target.slice(6) : 'Voyager 2';
    const c = CRAFT.find(c => c.name === name); if (!c) return;
    const t0 = c.T[0], t1 = Math.min(c.T[c.n - 1], t0 + 365.25 * 14), vmax = 40;
    const X = t => 28 + (t - t0) / (t1 - t0) * (w - 34), Y = v => h - 16 - v / vmax * (h - 24);
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.fillStyle = '#687084'; ctx.strokeStyle = 'rgba(230,234,240,0.12)'; ctx.lineWidth = 1;
    for (const v of [0, 10, 20, 30, 40]) { ctx.beginPath(); ctx.moveTo(28, Y(v)); ctx.lineTo(w - 6, Y(v)); ctx.stroke(); ctx.fillText(String(v), 4, Y(v) + 3); }
    const y0 = calUT(t0).year; for (let y = Math.ceil(y0 / 2) * 2; ; y += 2) { const t = P.calToJd(y, 1, 1) - P.EPOCH; if (t > t1) break; if (t > t0) ctx.fillText(String(y), X(t) - 12, h - 3); }
    const path = (fn, col, lw) => { ctx.beginPath(); let first = true; for (let k = 0; k < c.n; k++) { const t = c.T[k]; if (t > t1) break; const v = fn(k); const x = X(t), y = Y(v); if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); } ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.stroke(); };
    path(k => Math.sqrt(2 * P.GM[0] / Math.hypot(c.X[6 * k], c.X[6 * k + 1], c.X[6 * k + 2])) * AU / DAY, 'rgba(155,163,180,0.8)', 1);
    path(k => Math.hypot(c.X[6 * k + 3], c.X[6 * k + 4], c.X[6 * k + 5]) * AU / DAY, '#8fc3ec', 1.6);
    if (S.t >= t0 && S.t <= t1) { ctx.strokeStyle = '#ffc46b'; ctx.beginPath(); ctx.moveTo(X(S.t), 8); ctx.lineTo(X(S.t), h - 16); ctx.stroke(); }
    const p = craftAt(c, S.t, [0, 0, 0, 0, 0, 0]);
    $('shTitle').textContent = `${c.name}, speed around the Sun`;
    $('shNow').textContent = p ? (Math.hypot(p[3], p[4], p[5]) * AU / DAY).toFixed(1) + ' km/s · escape ' + (Math.sqrt(2 * P.GM[0] / Math.hypot(p[0], p[1], p[2])) * AU / DAY).toFixed(1) : 'not launched yet';
  }

  /* ================================================================
     Start
     ================================================================ */
  window.CW = {
    P, B, eph, S, cam, CRAFT, SMALL, A, get st() { return st; }, setTime, setRate, follow, caption, fmtDate, fmtDur, fmtAU, fmtClock, calUT, yearStr, MONTHS, sci, sup, T_MIN, T_MAX, nowT, showMe, targetName, yearOf, CRAFT_INFO, SMALL_INFO,
    syncPlay, setKey,
  };
  decodeAsteroids().catch(e => console.error('asteroids', e));
  syncPlay();
  requestAnimationFrame(render);
})();

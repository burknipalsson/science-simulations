// Wave-lab scenes for the live 2D solver, in atomic units on an L×L box (L = 409.6 bohr ≈ 21.7 nm).
// Each scene gives the potential (V, W, screen flag, wall shade), the electron's packet, the time step
// and when an electron counts as finished. x runs left→right (the beam), y bottom→top.
const Scenes = (() => {
  const L = 409.6;
  const SCREEN_W = 28, EDGE_W = 26; // absorbing widths (bohr): detector screen on the right, open edges elsewhere
  const WALL_V = 10;                 // Hartree (272 eV): opaque to 54 eV electrons (2 bohr of it lets through e⁻¹⁶)
  const ABS_W = 2;                   // peak absorbing rate (Hartree): ∫W dt ≈ 9 across a layer, so ~1e-8 comes back
  // electron kinetic energy (eV) ↔ wavenumber (a.u.)
  const kOfE = eV => Math.sqrt(2 * eV / 27.211386);
  const defaults = { eV: 54.4, d: 20, w: 6, ws: 4, barrierEV: 58, barrierW: 2.0 };
  const EDGE = 0.4; // tanh edge width of tunnelling barriers (bohr): smooth enough for the grid to resolve

  function base(N){
    const h = L / N, pot = new Float32Array(4 * N * N);
    // absorbing edges: W ramps quadratically over EDGE_W on top/bottom/left; the right band is the screen
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
      const x = (i + 0.5) * h, y = (j + 0.5) * h, k = 4 * (i + N * j);
      const dl = EDGE_W - x, dt = y - (L - EDGE_W), db = EDGE_W - y, dr = x - (L - SCREEN_W);
      let W = 0;
      const e = Math.max(dl, dt, db);
      if (e > 0) W = ABS_W * (e / EDGE_W) ** 2;
      if (dr > 0){ W = Math.max(W, ABS_W * (dr / SCREEN_W) ** 2); pot[k + 2] = 1; }
      pot[k + 1] = W;
    }
    return { N, h, L, pot };
  }
  // fill a rectangle of wall (x0..x1, y0..y1 in bohr) with potential V, shade s for drawing
  function rect(S, x0, x1, y0, y1, V, s = 1){
    const { N, h, pot } = S;
    for (let j = Math.max(0, Math.floor(y0 / h)); j < Math.min(N, Math.ceil(y1 / h)); j++)
      for (let i = Math.max(0, Math.floor(x0 / h)); i < Math.min(N, Math.ceil(x1 / h)); i++){
        const x = (i + 0.5) * h, y = (j + 0.5) * h;
        if (x >= x0 && x < x1 && y >= y0 && y < y1){ const k = 4 * (i + N * j); pot[k] = V; pot[k + 3] = s; }
      }
  }
  const XW = 110, THICK = 2; // the slit wall
  const make = {
    // two slits a distance d apart (centre to centre), each w wide
    double(N, o){
      const S = base(N), c = L / 2;
      rect(S, XW, XW + THICK, 0, c - o.d / 2 - o.w / 2, WALL_V);
      rect(S, XW, XW + THICK, c - o.d / 2 + o.w / 2, c + o.d / 2 - o.w / 2, WALL_V);
      rect(S, XW, XW + THICK, c + o.d / 2 + o.w / 2, L, WALL_V);
      S.slits = [c - o.d / 2, c + o.d / 2];
      return S;
    },
    single(N, o){
      const S = base(N), c = L / 2;
      rect(S, XW, XW + THICK, 0, c - o.ws / 2, WALL_V);
      rect(S, XW, XW + THICK, c + o.ws / 2, L, WALL_V);
      S.slits = [c];
      return S;
    },
    // a thin barrier across the whole beam, lower than a wall: some of the wave leaks through
    barrier(N, o){
      const S = base(N), V0 = o.barrierEV / 27.211386;
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
        const v = barrierV((i + 0.5) * S.h - XW, V0, o.barrierW), k = 4 * (i + N * j);
        if (v > 1e-4 * V0){ S.pot[k] = v; S.pot[k + 3] = 0.5 * v / V0; }
      }
      return S;
    },
    open(N){ return base(N); },
  };
  // smooth-edged barrier profile, x measured from its left edge
  const barrierV = (x, V0, a) => V0 * 0.5 * (Math.tanh(x / EDGE) - Math.tanh((x - a) / EDGE));
  // exact stationary transmission through that profile at energy E (a.u.), by a transfer matrix over
  // thin constant slices (validated: the h = 0.4 time-dependent run agrees to 0.0006)
  function barrierT(E, V0, a){
    const dx = 0.005, k0 = Math.sqrt(2 * E);
    let m00r = 1, m00i = 0, m01r = 0, m01i = 0, m10r = 0, m10i = 0, m11r = 1, m11i = 0;
    let kpr = k0, kpi = 0;
    const csqrt = (re) => re >= 0 ? [Math.sqrt(re), 0] : [0, Math.sqrt(-re)];
    const cdiv = (ar, ai, br, bi) => { const d = br * br + bi * bi; return [(ar * br + ai * bi) / d, (ai * br - ar * bi) / d]; };
    const cmul = (ar, ai, br, bi) => [ar * br - ai * bi, ar * bi + ai * br];
    const apply = (d00r, d00i, d01r, d01i, d10r, d10i, d11r, d11i) => {
      const n00 = cmul(d00r, d00i, m00r, m00i), n00b = cmul(d01r, d01i, m10r, m10i);
      const n01 = cmul(d00r, d00i, m01r, m01i), n01b = cmul(d01r, d01i, m11r, m11i);
      const n10 = cmul(d10r, d10i, m00r, m00i), n10b = cmul(d11r, d11i, m10r, m10i);
      const n11 = cmul(d10r, d10i, m01r, m01i), n11b = cmul(d11r, d11i, m11r, m11i);
      m00r = n00[0] + n00b[0]; m00i = n00[1] + n00b[1]; m01r = n01[0] + n01b[0]; m01i = n01[1] + n01b[1];
      m10r = n10[0] + n10b[0]; m10i = n10[1] + n10b[1]; m11r = n11[0] + n11b[0]; m11i = n11[1] + n11b[1];
    };
    const step = (kr, ki, len) => {
      const [rr, ri] = cdiv(kpr, kpi, kr, ki);
      // interface matrix ½[[1+r, 1−r],[1−r, 1+r]]
      apply(0.5 * (1 + rr), 0.5 * ri, 0.5 * (1 - rr), -0.5 * ri, 0.5 * (1 - rr), -0.5 * ri, 0.5 * (1 + rr), 0.5 * ri);
      if (len){
        // propagation diag(e^{ik dx}, e^{−ik dx})
        const ea = Math.exp(-ki * len), eb = Math.exp(ki * len);
        const p0 = [ea * Math.cos(kr * len), ea * Math.sin(kr * len)], p1 = [eb * Math.cos(kr * len), -eb * Math.sin(kr * len)];
        const a0 = cmul(p0[0], p0[1], m00r, m00i), a1 = cmul(p0[0], p0[1], m01r, m01i), b0 = cmul(p1[0], p1[1], m10r, m10i), b1 = cmul(p1[0], p1[1], m11r, m11i);
        m00r = a0[0]; m00i = a0[1]; m01r = a1[0]; m01i = a1[1]; m10r = b0[0]; m10i = b0[1]; m11r = b1[0]; m11i = b1[1];
      }
      kpr = kr; kpi = ki;
    };
    for (let x = -8 * EDGE + dx / 2; x < a + 8 * EDGE; x += dx){ const [kr, ki] = csqrt(2 * (E - barrierV(x, V0, a))); step(kr, ki, dx); }
    step(k0, 0, 0);
    const [Br, Bi] = cdiv(-m10r, -m10i, m11r, m11i), mb = cmul(m01r, m01i, Br, Bi);
    return (m00r + mb[0]) ** 2 + (m00i + mb[1]) ** 2;
  }
  // build a scene: potential plus the electron packet and timing
  function build(name, N, opts = {}){
    const o = { ...defaults, ...opts }, S = make[name](N, o);
    const k0 = kOfE(o.eV);
    S.name = name; S.opts = o; S.k0 = k0;
    // packet: long enough in y to light both slits evenly, a few wavelengths long in x
    S.packet = { x0: 66, y0: L / 2, sx: 9, sy: o.sy || (name === 'barrier' ? 30 : name === 'double' ? Math.max(10, o.d / 2) : 10), kx: k0, ky: 0 };
    // time step: keep the largest kinetic phase per step, k_max²/2·dt, and V·dt below ~1 rad
    const kmax = Math.PI / S.h;
    S.dt = Math.min(0.9 / (0.5 * kmax * kmax), 0.9 / WALL_V);
    // an electron is done once the packet could have crossed to the screen and been absorbed
    S.tEnd = (L - S.packet.x0) / k0 * 1.45;
    // which-path measurement time: the packet centre one packet length past the wall
    S.tMeasure = (XW + THICK + 3 * S.packet.sx - S.packet.x0) / k0;
    S.screenCols = [Math.floor((L - SCREEN_W) / S.h), N];
    S.XW = XW; S.THICK = THICK;
    return S;
  }
  // masks for a which-path measurement: beyond the wall, the half nearer each slit
  function whichMask(S, side){
    const { N, h } = S, m = new Float32Array(N * N), c = L / 2;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++){
      const x = (i + 0.5) * h, y = (j + 0.5) * h;
      if (x > XW + THICK) m[i + N * j] = side === 'up' ? (y > c ? 1 : 0) : side === 'down' ? (y <= c ? 1 : 0) : 1;
      else m[i + N * j] = side === 'back' ? 1 : 0;
    }
    if (side === 'back') for (let k = 0; k < N * N; k++) m[k] = m[k] ? 1 : 0;
    return m;
  }
  return { L, kOfE, defaults, build, whichMask, rect, barrierV, barrierT, XW, THICK, WALL_V, SCREEN_W };
})();
if (typeof module !== 'undefined') module.exports = Scenes;

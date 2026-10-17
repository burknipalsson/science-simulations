// Inside a Drop of Blood: page controller for the hero stage (scenes, knobs, HUD, camera).
(() => {
  const $ = id => document.getElementById(id);
  const cv = $('sky'), hud = $('hud'), statusEl = $('status');
  const gl = cv.getContext('webgl2', { antialias: true, premultipliedAlpha: false });
  if (!gl || !gl.getExtension('EXT_color_buffer_float') || !gl.getExtension('EXT_float_blend')) { $('nogl').hidden = false; return; }
  const renderer = (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; })();
  // fine grids (0.25 µm, 2562-vertex cells) for capable GPUs; 0.5 µm and 642 vertices otherwise
  const HIGH = /RTX|Radeon RX|Radeon Pro|Apple M[1-9]|Arc A/i.test(renderer) && !/Intel\(R\) (UHD|HD|Iris)/i.test(renderer);
  const MESH = { 3: null, 4: null };
  const meshOf = level => MESH[level] || (MESH[level] = (() => { const sp = icosphere(level); return { sp, top: { F: sp.F, ...topology(sp.F, sp.V.length) } }; })());

  const P = { // physical constants (SI)
    eta: 1.2e-3,       // plasma viscosity at 37 °C, Pa s
    Gs: 5.3e-6,        // red-cell membrane shear modulus, N/m (Mills et al. 2004 range 5.3-11.3; fits our stretch test)
    kappa: 2e-19,      // bending modulus, J
  };
  const mmHg = 133.322, DEBUG = /debug/.test(location.search);

  // --- shared helpers -------------------------------------------------------------------------------
  function cellRecord(Xlat, U, ref, opt = {}) {
    const c = [0, 1, 2].map(d => Xlat.reduce((a, p) => a + p[d], 0) / Xlat.length), an = c.map(Math.round);
    return { X: Xlat.map(p => [p[0] - an[0], p[1] - an[1], p[2] - an[2]]), anchor: an, ...stiffness(U, opt.stiff || 1), kb: 2 * U.energy(P.kappa) / Math.sqrt(3),
      kA: 100 * U.GsL, kV: 1000 * U.GsL, A0: ref.A, V0: ref.V, push: 30 * U.GsL, scale: 1, type: opt.type || 0 };
  }
  // a stiffer membrane: shear modulus × f (what the measurements give); the local area modulus Gs(1+2C) is held at the
  // healthy value (21 Gs) so the explicit time step stays stable; area is still conserved globally
  const stiffness = (U, f) => ({ Gs: U.GsL * f, C: Math.max(0.5, (21 / f - 1) / 2) });
  const rotY = X => X.map(p => [p[2], p[1], -p[0]]); // disc axis z -> x (a proper rotation)


  // shapes (µm, long axis or disc axis along x for capillaries)
  const SHAPE = {
    rbc: V => rotY(biconcave(V)),
    sickle: V => SHAPES.sickle(V),                       // crescent, 15 µm tip to tip, long axis x
    round: V => rotY(SHAPES.spheroid(V, 3.3, 2.06)),     // late-stage infected cell: rounded, same volume, less spare area
  };
  const KIND = { // shape, stiffness (× healthy shear and bending moduli), colour, label
    rbc: { shape: 'rbc', stiff: 1, col: [0.8, 0.1, 0.085], label: 'healthy' },
    sickle: { shape: 'sickle', stiff: 2.8, col: [0.55, 0.1, 0.2], label: 'sickled' },
    ring: { shape: 'rbc', stiff: 2.3, col: [0.74, 0.16, 0.3], label: 'ring stage' },
    troph: { shape: 'rbc', stiff: 4.6, col: [0.62, 0.17, 0.38], label: 'trophozoite' },
    schizont: { shape: 'rbc', stiff: 9.5, col: [0.5, 0.16, 0.42], label: 'schizont' },
  };
  // a capillary (axis x, periodic) with a train of cells; optional smooth narrowing (a slit like the spleen's)
  async function makeCapillary(spec, setStatus) {
    const dx = HIGH ? 0.25 : 0.5, level = HIGH ? 4 : 3, U = new Units({ dx: dx * 1e-6, GsL: spec.GsL || 2e-3 });
    const R = U.len(spec.D * 1e-6) / 2, R1 = Math.max(R, U.len((spec.wide || 4.6) * 1e-6)), n = Math.ceil(2 * R1) + 4, nx = Math.round(U.len(spec.L * 1e-6)), cc = (n - 1) / 2;
    const Rc = spec.neck ? U.len(spec.neck * 1e-6) / 2 : R, w = U.len((spec.neckLen || 6) * 1e-6) / 2;
    const { sp, top } = meshOf(level), shapes = Object.keys(SHAPE), refs = shapes.map(s => SHAPE[s](sp.V).map(p => p.map(x => U.len(x * 1e-6))));
    const refInfo = refs.map(X0 => makeRef({ X: X0, F: sp.F, E: top.E }));
    // radius along x: R, narrowing to Rc around the middle; SP.x blends from the wide start (0) to the final vessel (1)
    const sdf = `float s = SP.x, rx = ${R.toFixed(4)}; float q = (p.x - ${(nx / 2).toFixed(2)}) / ${w.toFixed(3)};
      if (abs(q) < 1.) rx -= ${(R - Rc).toFixed(4)} * 0.5 * (1. + cos(3.14159265 * q));
      return mix(${R1.toFixed(4)}, rx, s) - length(p.yz - vec2(${cc.toFixed(4)}));`;
    const sim = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, lambda: 5, mob: 0.03, cellRadius: U.len(9e-6), maxCells: spec.cells.length, tables: buildMeshTables(top, refs),
      SP: [0, 0, 0, 0], krep: 10 * U.GsL, rcut: 1, sdf });
    const cells = spec.cells.map((kind, i) => {
      const K = KIND[kind], ti = shapes.indexOf(K.shape), x0 = spec.pos ? spec.pos[i] : nx * (i + 0.5) / spec.cells.length;
      const rec = cellRecord(refs[ti].map(p => [p[0] + x0, p[1] + cc, p[2] + cc]), U, refInfo[ti], { stiff: K.stiff * (spec.stiff && spec.stiff[kind] || 1), type: ti });
      rec.kind = kind; return rec;
    });
    sim.setCells(cells); sim.computeIndicator();
    for (let s = 1; s <= 40; s++) { sim.setSP([s / 40, 0, 0, 0]); sim.step(Math.round(U.steps(4e-3) / 40)); sim.sync(); setStatus(`fitting the cells into the vessel ${Math.round(s / 40 * 100)}%`); await frame(); }
    const view = new BloodView(gl, sim, { faces: sp.F, copies: 3 });
    view.setColours(cells.map((c, i) => [...KIND[c.kind].col.map((v, j) => v * (1 + 0.06 * Math.sin(i * 2.3 + j))), 1]));
    Object.assign(view.cam, { target: [nx / 2, cc, cc], dist: nx * 0.95, yaw: -0.5, pitch: 0.18 });
    const sc = { sim, view, U, R, nx, cc, cells, n, speeds: cells.map(() => 0), vcell: 0, vmean: 0, prev: null };
    sc.setStiff = (kind, f) => { cells.forEach(c => { if (c.kind === kind) Object.assign(c, stiffness(U, KIND[kind].stiff * f)); }); sim.setParams(cells); };
    sc.setTarget = (u, D) => { sc.target = u * 1e-3; if (!sc.G) { sc.G = 8 * P.eta * sc.target / (D * 1e-6 / 2) ** 2 * 1.6; sim.o.body = [U.gradP(sc.G), 0, 0]; } };
    return sc;
  }
  // HUD rows: average speed of each kind of cell (stuck if barely moving)
  function kindHud(sc, kinds) {
    const rows = kinds.map(kd => {
      const v = sc.cells.map((c, i) => c.kind === kd ? sc.speeds[i] : null).filter(x => x !== null), m = v.reduce((a, b) => a + b, 0) / v.length;
      return [KIND[kd].label[0].toUpperCase() + KIND[kd].label.slice(1), Math.abs(m) < 0.02e-3 ? 'stuck' : fmtSpeed(m), kd === 'rbc' ? 'big' : ''];
    });
    return [...rows, ['sep'], ['Plasma (mean)', fmtSpeed(sc.vmean || 0)], ['Pressure drop', (sc.G * 1e-3 / mmHg).toFixed(0) + ' mmHg per mm', 'opt']];
  }
  function measureCapillary(sc) {
    const cs = sc.sim.readCentres(), s = sc.sim.sumMacro(), U = sc.U;
    if (sc.prev && sc.sim.t > sc.prev.t) {
      let sum = 0;
      cs.forEach((c, i) => { let d = c.c[0] - sc.prev.c[i].c[0]; d -= sc.nx * Math.round(d / sc.nx); const v = d / (sc.sim.t - sc.prev.t) * U.V; sc.speeds[i] = sc.speeds[i] ? 0.8 * sc.speeds[i] + 0.2 * v : v; sum += v; });
      const v = sum / cs.length; sc.vcell = sc.vcell ? 0.8 * sc.vcell + 0.2 * v : v;
    }
    sc.prev = { c: cs, t: sc.sim.t };
    sc.vmean = s[0] / sc.nx / (Math.PI * sc.R * sc.R) * U.V;
    if (DEBUG) console.log('DBG t', (sc.sim.t * U.dt * 1e3).toFixed(1), 'x', cs.map(c => (((c.c[0] % sc.nx) + sc.nx) % sc.nx * U.dx * 1e6).toFixed(1)).join(','), 'vol', cs.map(c => c.V.toFixed(0)).join(','), 'v', sc.speeds.map(v => (v * 1e3).toFixed(2)).join(','));
    regulate(sc, sc.vmean);
  }

  // --- scenes ---------------------------------------------------------------------------------------
  // each scene: build(knobs) -> { sim, view, step(), hud() }, plus knob definitions
  const SCENES = {
    capillary: {
      label: 'Capillary', sub: '6 µm',
      caption: '<b>A capillary narrower than a red cell.</b> Each cell, 7.8 µm across, folds into a <b>parachute</b> to squeeze through single file, its rim dragged back by the slower plasma near the wall. The thin plasma film between cell and wall is what lets it slide.',
      knobs: [
        { id: 'D', label: 'Capillary', min: 5, max: 9, step: 0.1, value: 6, fmt: v => v.toFixed(1) + ' µm', rebuild: true },
        { id: 'u', label: 'Blood speed', min: 0.2, max: 2.5, step: 0.05, value: 1, fmt: v => v.toFixed(2) + ' mm/s' },
        { id: 'stiff', label: 'Cell stiffness', min: 1, max: 5, step: 0.5, value: 1, fmt: v => v === 1 ? 'healthy' : '×' + v.toFixed(1), rebuild: false },
      ],
      async build(k, setStatus) {
        const dx = HIGH ? 0.25 : 0.5, level = HIGH ? 4 : 3, U = new Units({ dx: dx * 1e-6, GsL: 5e-4 });
        const R = U.len(k.D * 1e-6) / 2, R1 = Math.max(R, U.len(4.6e-6)), n = Math.ceil(2 * R1) + 4, nx = Math.round(U.len(48e-6)), cc = (n - 1) / 2;
        const { sp, top } = meshOf(level), X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: top.E });
        const ncell = 4, sim = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, lambda: 5, mob: 0.03, cellRadius: U.len(9e-6), maxCells: ncell, tables: buildMeshTables(top, [X0]), SP: [R1, 0, 0, 0], krep: 10 * U.GsL, rcut: 1,
          sdf: `return SP.x - length(p.yz - vec2(${cc.toFixed(4)}));` });
        const cells = []; for (let i = 0; i < ncell; i++) cells.push(cellRecord(rotY(X0).map(p => [p[0] + nx * (i + 0.5) / ncell, p[1] + cc, p[2] + cc]), U, ref, { stiff: k.stiff }));
        sim.setCells(cells); sim.computeIndicator();
        // the vessel starts wide and closes around the cells
        for (let s = 1; s <= 40; s++) { sim.setSP([R1 + (R - R1) * s / 40, 0, 0, 0]); sim.step(Math.round(U.steps(4e-3) / 40)); sim.sync(); setStatus(`fitting the cells into the capillary ${Math.round(s / 40 * 100)}%`); await frame(); }
        const view = new BloodView(gl, sim, { faces: sp.F, copies: 3 });
        view.setColours(cells.map((_, i) => [0.78 + 0.05 * Math.sin(i * 2.3), 0.1, 0.085, 1]));
        Object.assign(view.cam, { target: [nx / 2, cc, cc], dist: nx * 0.95, yaw: -0.5, pitch: 0.18 });
        const sc = { sim, view, U, R, nx, cc, cells, ref, ncell, prev: null, vcell: 0, vmean: 0, len: 0 };
        sc.apply = kk => { // live knobs: target blood speed (the pressure is then regulated to deliver it), cell stiffness
          sc.target = kk.u * 1e-3;
          if (!sc.G) { sc.G = 8 * P.eta * sc.target / (kk.D * 1e-6 / 2) ** 2 * 1.6; sim.o.body = [U.gradP(sc.G), 0, 0]; }
          sc.stiffTarget = kk.stiff; // ramped in measure(): a sudden jump is too violent for the explicit time step
        };
        sc.stiffNow = 1;
        sc.apply(k);
        return sc;
      },
      measure(sc) {
        const cs = sc.sim.readCentres(), s = sc.sim.sumMacro(), U = sc.U;
        if (sc.prev) {
          let d = 0; cs.forEach((c, i) => { let dd = c.c[0] - sc.prev.c[i].c[0]; dd -= sc.nx * Math.round(dd / sc.nx); d += dd; });
          const v = d / cs.length / Math.max(1, sc.sim.t - sc.prev.t) * U.V;
          sc.vcell = sc.vcell ? 0.8 * sc.vcell + 0.2 * v : v;
        }
        sc.prev = { c: cs, t: sc.sim.t };
        sc.vmean = s[0] / sc.nx / (Math.PI * sc.R * sc.R) * U.V;
        if (sc.stiffTarget && Math.abs(sc.stiffNow - sc.stiffTarget) > 1e-3) { sc.stiffNow += Math.max(-0.25, Math.min(0.25, sc.stiffTarget - sc.stiffNow)); sc.cells.forEach(c => Object.assign(c, stiffness(U, sc.stiffNow))); sc.sim.setParams(sc.cells); }
        if (DEBUG) console.log('DBG cap', (sc.sim.t * U.dt * 1e3).toFixed(1), 'v', (sc.vcell * 1e3).toFixed(2), 'vol', cs.map(c => c.V.toFixed(0)).join(','));
        regulate(sc, sc.vmean);
      },
      hud(sc, k) {
        const tr = sc.vcell > 1e-6 ? 0.5e-3 / sc.vcell : 0;
        return [
          ['Cell speed', fmtSpeed(sc.vcell), 'big'],
          ['Plasma (mean)', fmtSpeed(sc.vmean)],
          ['Cells / plasma', sc.vmean > 0 ? (sc.vcell / sc.vmean).toFixed(2) + '×' : '–'],
          ['sep'],
          ['Pressure drop', (sc.G * 1e-3 / mmHg).toFixed(2) + ' mmHg per mm', 'opt'],
          ['Through 0.5 mm', tr ? tr.toFixed(2) + ' s' : '–', 'rate'],
        ];
      },
    },
    arteriole: {
      label: 'Arteriole', sub: '20 µm', fine: true,
      caption: '<b>A small arteriole, packed with cells.</b> The cells drift away from the wall, leaving a <b>cell-free layer</b> of plasma that lubricates the flow, and the crowd in the middle moves faster than the average. So blood in a narrow vessel is <b>thinner</b> and holds <b>fewer cells</b> than the blood feeding it: the Fåhræus and Fåhræus–Lindqvist effects.',
      knobs: [
        { id: 'D', label: 'Vessel', min: 20, max: 30, step: 10, value: 20, fmt: v => v.toFixed(0) + ' µm', rebuild: true },
        { id: 'u', label: 'Blood speed', min: 0.3, max: 3, step: 0.05, value: 1.2, fmt: v => v.toFixed(2) + ' mm/s' },
      ],
      async build(k, setStatus) {
        const dx = 0.5, U = new Units({ dx: dx * 1e-6 }), Rum = k.D / 2, R = U.len(Rum * 1e-6), Lum = 50, nx = Math.round(U.len(Lum * 1e-6)), n = Math.ceil(2 * R) + 2, cc = (n - 1) / 2;
        const { sp, top } = meshOf(3), X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: top.E });
        // start from a developed suspension (400 ms of flow, computed offline with this same model), so the cell-free
        // layer and the cell distribution are already in place
        setStatus('unpacking cells'); await frame();
        const st = await loadState('t' + k.D);
        const cells = st.map(({ c, X }) => cellRecord(X.map(p => [(c[0] + p[0]) / dx, (c[1] + p[1]) / dx + cc, (c[2] + p[2]) / dx + cc]), U, ref));
        const sim = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, lambda: 5, cellRadius: U.len(9e-6), maxCells: cells.length, tables: buildMeshTables(top, [X0]), krep: 10 * U.GsL, rcut: 1,
          sdf: `return ${R.toFixed(4)} - length(p.yz - vec2(${cc.toFixed(4)}));` });
        sim.setCells(cells); sim.computeIndicator();
        const view = new BloodView(gl, sim, { faces: sp.F, copies: 3 });
        view.setColours(cells.map((_, i) => [0.74 + 0.08 * Math.sin(i * 2.3), 0.09 + 0.02 * Math.cos(i * 1.7), 0.08, 1]));
        Object.assign(view.cam, { target: [nx / 2, cc, cc], dist: Math.max(1.3 * nx, 3.4 * n), yaw: -0.6, pitch: 0.22 });
        const sc = { sim, view, U, R, nx, cc, cells, ref, Vt: Math.PI * R * R * nx, D: k.D, prev: null, eta: 0, HD: 0, HT: 0, cfl: 0, lastCfl: 0 };
        sc.apply = kk => { sc.target = kk.u * 1e-3; if (!sc.G) { sc.G = 8 * P.eta * sc.target / (kk.D * 1e-6 / 2) ** 2 * 1.4; sim.o.body = [U.gradP(sc.G), 0, 0]; } };
        sc.apply(k);
        return sc;
      },
      measure(sc) {
        const cs = sc.sim.readCentres(), s = sc.sim.sumMacro(), U = sc.U, Q = s[0] / sc.nx;
        const Q0 = Math.PI * U.gradP(sc.G) * sc.R ** 4 / (8 / 6); // plasma alone at the same pressure gradient
        const ema = (a, b) => a ? 0.85 * a + 0.15 * b : b;
        if (sc.prev && sc.sim.t > sc.prev.t) {
          let flux = 0; cs.forEach((c, i) => { let d = c.c[0] - sc.prev.c[i].c[0]; d -= sc.nx * Math.round(d / sc.nx); flux += c.V * d; });
          flux /= (sc.sim.t - sc.prev.t);
          sc.HD = ema(sc.HD, flux / sc.nx / Q); sc.eta = ema(sc.eta, Q0 / Q);
        }
        sc.HT = cs.reduce((a, c) => a + c.V, 0) / sc.Vt;
        sc.prev = { c: cs, t: sc.sim.t }; sc.vmean = Q / (Math.PI * sc.R * sc.R) * U.V;
        if (performance.now() - sc.lastCfl > 2000) { // cell-free layer: wall gap to the outermost membrane, per 1 µm of length
          sc.lastCfl = performance.now();
          const X = sc.sim.readCells(), bins = new Map(), w = 1e-6 / U.dx;
          X.forEach(Xc => Xc.forEach(p => { const b = Math.floor((((p[0] % sc.nx) + sc.nx) % sc.nx) / w), r = Math.hypot(p[1] - sc.cc, p[2] - sc.cc); bins.set(b, Math.max(bins.get(b) || 0, r)); }));
          const g = [...bins.values()].map(r => sc.R - r); sc.cfl = g.length ? g.reduce((a, b) => a + b, 0) / g.length * U.dx * 1e6 : 0;
        }
        regulate(sc, sc.vmean);
      },
      hud(sc) {
        return [
          ['Thickness vs plasma', sc.eta ? sc.eta.toFixed(2) + '×' : '–', 'big'],
          ['Glass-tube data', sc.HD ? priesEta(sc.D, sc.HD).toFixed(2) + '×' : '–', 'opt'],
          ['sep'],
          ['Cells in the vessel', (sc.HT * 100).toFixed(1) + '%'],
          ['Cells leaving it', sc.HD ? (sc.HD * 100).toFixed(1) + '%' : '–', 'rate'],
          ['Cell-free layer', sc.cfl ? sc.cfl.toFixed(1) + ' µm' : '–'],
          ['sep'],
          ['Blood speed', fmtSpeed(sc.vmean || 0)],
          ['Pressure drop', (sc.G * 1e-3 / mmHg).toFixed(1) + ' mmHg per mm', 'opt'],
        ];
      },
    },
    sickle: {
      label: 'Sickle cell', sub: 'capillary',
      caption: '<b>Sickle cell disease.</b> One changed letter in the haemoglobin gene lets the protein stack into stiff fibres when it gives up its oxygen, bending the cell into a crescent. Here two <b>irreversibly sickled cells</b>, about three times stiffer than normal (as measured), travel among healthy ones. They still get through: the crescent straightens. A crisis needs more than shape: cells made rigid by deoxygenation, sticking to the vessel wall, many at once.',
      knobs: [
        { id: 'dp', label: 'Pressure drop', min: 4, max: 40, step: 1, value: 15, fmt: v => v.toFixed(0) + ' mmHg/mm' },
      ],
      async build(k, setStatus) {
        const sc = await makeCapillary({ D: 6, L: 64, GsL: 5e-4, cells: ['rbc', 'sickle', 'rbc', 'rbc', 'sickle'], pos: null }, setStatus);
        // stiffness changes are ramped (a sudden jump to a rigid membrane is too violent for the explicit time step)
        sc.sk = 1; sc.apply = kk => { sc.G = kk.dp * mmHg * 1e3; sc.sim.o.body = [sc.U.gradP(sc.G), 0, 0]; sc.skTarget = 1; };
        sc.apply(k); return sc;
      },
      measure(sc) {
        if (Math.abs(sc.sk - sc.skTarget) > 1e-3) { sc.sk += Math.max(-0.1, Math.min(0.1, sc.skTarget - sc.sk)); sc.setStiff('sickle', sc.sk); }
        const t = sc.target; sc.target = 0; measureCapillary(sc); sc.target = t;
      },
      hud: sc => kindHud(sc, ['rbc', 'sickle']),
    },
    malaria: {
      label: 'Malaria', sub: 'a narrow slit',
      caption: '<b>Malaria.</b> <i>Plasmodium falciparum</i> grows inside red cells and stiffens them as it matures, from the young <b>ring</b> through the feeding <b>trophozoite</b> to the dividing <b>schizont</b> (moduli from optical-tweezers measurements). The spleen filters blood through narrow slits that healthy cells squeeze through; stiff infected cells are held back. Narrow the slit and see which cells still get through.',
      knobs: [
        { id: 'neck', label: 'Slit', min: 3.8, max: 6, step: 0.1, value: 4, fmt: v => v.toFixed(1) + ' µm', rebuild: true },
        { id: 'dp', label: 'Pressure drop', min: 4, max: 40, step: 1, value: 12, fmt: v => v.toFixed(0) + ' mmHg/mm' },
      ],
      async build(k, setStatus) {
        const sc = await makeCapillary({ D: 7, L: 72, GsL: 5e-4, neck: k.neck, neckLen: 5, cells: ['rbc', 'ring', 'troph', 'schizont'], pos: null }, setStatus);
        sc.apply = kk => { sc.G = kk.dp * mmHg * 1e3; sc.sim.o.body = [sc.U.gradP(sc.G), 0, 0]; };
        sc.apply(k); return sc;
      },
      measure(sc) { const t = sc.target; sc.target = 0; measureCapillary(sc); sc.target = t; },
      hud: sc => kindHud(sc, ['rbc', 'ring', 'troph', 'schizont']),
    },
  };

  // pressure regulation: nudge the pressure gradient so the mean blood speed approaches the target (Stokes flow: speed ∝ pressure)
  function regulate(sc, v) {
    if (!sc.target || !(v > 0)) return;
    const f = Math.max(0.7, Math.min(1.4, Math.pow(sc.target / v, 0.5)));
    sc.G = Math.min(sc.G * f, sc.Gmax || (sc.Gmax = 30 * sc.G)); sc.sim.o.body = [sc.U.gradP(sc.G), 0, 0];
  }
  function fmtSpeed(v) { return (v * 1e3).toFixed(2) + ' mm/s'; }
  const frame = () => new Promise(r => requestAnimationFrame(r));

  // --- UI -------------------------------------------------------------------------------------------
  let cur = null, curName = null, knobVals = {}, playing = true, pace = 1, busy = false;
  const setStatus = msg => { statusEl.hidden = !msg; if (msg) statusEl.querySelector('span').textContent = msg; };
  function buildChips() {
    const box = $('scenes'); box.innerHTML = '';
    for (const [name, s] of Object.entries(SCENES)) {
      const b = document.createElement('button'); b.className = 'chip'; b.dataset.scene = name;
      b.innerHTML = `<span class="dot"></span>${s.label}${s.sub ? ` <small>${s.sub}</small>` : ''}`;
      b.onclick = () => load(name); box.appendChild(b);
    }
  }
  function buildKnobs(s) {
    const box = $('knobs'); box.innerHTML = '<div class="group-label">Settings</div>';
    const rows = document.createElement('div'); rows.className = 'row2'; box.appendChild(rows);
    knobVals = {};
    const qs = new URLSearchParams(location.search);
    for (const k of s.knobs || []) {
      if (qs.has('k_' + k.id)) k.value = +qs.get('k_' + k.id);
      knobVals[k.id] = k.value;
      const lab = document.createElement('label'); lab.className = 'sl';
      lab.innerHTML = `${k.label} <input type="range" min="${k.min}" max="${k.max}" step="${k.step}" value="${k.value}" aria-label="${k.label}"><output>${k.fmt(k.value)}</output>`;
      const inp = lab.querySelector('input'), out = lab.querySelector('output');
      inp.oninput = () => { knobVals[k.id] = +inp.value; out.textContent = k.fmt(+inp.value); if (!k.rebuild && cur && cur.apply) cur.apply(knobVals); };
      inp.onchange = () => { if (k.rebuild) load(curName, true); };
      rows.appendChild(lab);
    }
    if (s.fine) {
      const fb = document.createElement('div'); fb.className = 'finebox';
      fb.innerHTML = `<div class="group-label">Fine grid</div>
        <p class="note">The live vessel runs on a 0.5 µm grid, coarse enough that it reads 15–20% too thick. <b>Record</b> a short stretch computed on a 0.25 µm grid (eight times the points, cells with four times the detail), then replay it with the camera free to roam.</p>
        <button class="btn ghost" id="recBtn">● Record a fine-grid replay</button>`;
      box.appendChild(fb);
      const btn = fb.querySelector('#recBtn'), sync = () => { const ok = knobVals.D === 20; btn.disabled = !ok; btn.title = ok ? '' : 'Fine-grid recording is available for the 20 µm vessel'; };
      btn.onclick = () => { if (!btn.disabled) fineStart(); };
      rows.querySelector('input').addEventListener('input', sync); sync();
    }
  }
  async function load(name, keepKnobs) {
    if (busy) return;
    if (fine) fineExit();
    busy = true;
    const s = SCENES[name]; curName = name;
    document.querySelectorAll('#scenes .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.scene === name));
    $('caption').innerHTML = s.caption;
    if (!keepKnobs) buildKnobs(s);
    if (cur) { cur.view.dispose(); cur.sim.dispose(); cur = null; }
    setStatus('preparing');
    try { cur = await s.build(knobVals, setStatus); } catch (e) { console.error(e); setStatus('could not start: ' + e.message); busy = false; return; }
    cur.scene = s; setStatus(''); busy = false;
  }

  // --- fine-grid record and replay (the 20 µm arteriole) ---------------------------------------------
  // The live arteriole runs on the 0.5 µm grid. Here the same vessel is computed on a 0.25 µm grid (8x the fluid points,
  // 2562-vertex cells) as fast as the GPU allows, its state is stored every 0.1 ms of blood time (cell shapes and plasma
  // tracers, not pixels), and the stored frames are then played back through the same renderer with the camera live.
  const REC = { kf: 1e-4, kfPerSec: 10, warm: 3e-3, eta: 1.33, window: 20, lengths: [10, 20, 40] }; // replay at 1x: 1 s shows 1 ms of blood
  let fine = null;
  const stageView = () => fine && fine.view ? fine.view : cur && cur.view;
  const fmtDur = s => s < 90 ? Math.max(5, Math.round(s / 5) * 5) + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : (s / 3600).toFixed(1) + ' h';
  function showBars(which) {
    $('transport').hidden = which !== 'live'; $('recBar').hidden = which !== 'rec'; $('replayBar').hidden = which !== 'replay';
    const rb = $('recBtn'); if (rb) rb.disabled = which !== 'live' || knobVals.D !== 20;
  }
  function recUI(msg, actions, prog) {
    $('recMsg').innerHTML = msg;
    const pr = $('recProg'); pr.hidden = prog === undefined; if (prog !== undefined) pr.firstChild.style.width = (100 * prog).toFixed(1) + '%';
    if (actions) {
      const box = $('recActions'); box.innerHTML = '';
      for (const a of actions) {
        if (a.note) { const p = document.createElement('p'); p.className = 'note'; p.innerHTML = a.note; box.appendChild(p); continue; }
        const b = document.createElement('button'); b.className = 'btn' + (a.ghost ? ' ghost' : ''); b.innerHTML = a.label; b.onclick = a.do; if (a.id) b.id = a.id; box.appendChild(b);
      }
    }
  }

  async function fineStart() {
    if (fine || busy || !cur) return;
    showBars('rec');
    recUI('Building the fine grid: <b>1.4 million</b> fluid points and 33 cells of 2,562 points each', [{ label: 'Cancel', ghost: true, do: fineExit }]);
    // the pressure is set once (no feedback): plasma alone would need G0 for this speed, and this model's blood on the
    // fine grid is 1.33x thicker at this haematocrit. The plasma starts in motion (a parabolic profile at that speed),
    // because on this grid the flow takes milliseconds to spin up from rest
    const u = knobVals.u * 1e-3, F = fine = { phase: 'build', frames: [], stats: [], D: 20, G: REC.eta * 8 * P.eta * u / (10e-6) ** 2 };
    await frame();
    try {
      const dx = 0.25, U = new Units({ dx: dx * 1e-6 }), R = U.len(F.D / 2 * 1e-6), nx = Math.round(U.len(50e-6)), n = Math.ceil(2 * R) + 2, cc = (n - 1) / 2;
      const { sp, top } = meshOf(4), X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: top.E });
      // start from a suspension developed on this grid (320 ms of flow, computed offline)
      const st = await loadState('f20');
      if (fine !== F) return;
      const cells = st.map(({ c, X }) => cellRecord(X.map(p => [(c[0] + p[0]) / dx, (c[1] + p[1]) / dx + cc, (c[2] + p[2]) / dx + cc]), U, ref));
      const sim = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, lambda: 5, cellRadius: U.len(9e-6), maxCells: cells.length, tables: buildMeshTables(top, [X0]), krep: 10 * U.GsL, rcut: 1,
        sdf: `return ${R.toFixed(4)} - length(p.yz - vec2(${cc.toFixed(4)}));`,
        initVel: `vec2 q = p.yz - vec2(${cc.toFixed(4)}); return vec3(${(2 * u / U.V).toExponential(6)} * max(0., 1. - dot(q, q) / ${(R * R).toFixed(4)}), 0., 0.);` });
      sim.setCells(cells); sim.computeIndicator(); sim.o.body = [U.gradP(F.G), 0, 0];
      const view = new BloodView(gl, sim, { faces: sp.F, copies: 3, ls: 2 });
      view.setColours(cells.map((_, i) => [0.74 + 0.08 * Math.sin(i * 2.3), 0.09 + 0.02 * Math.cos(i * 1.7), 0.08, 1]));
      // same physical viewpoint as the live view
      const c0 = cur.view.cam, s = 0.5 / dx;
      Object.assign(view.cam, { yaw: c0.yaw, pitch: c0.pitch, fov: c0.fov, dist: c0.dist * s, target: [c0.target[0] * s, c0.target[1] / cur.cc * cc, c0.target[2] / cur.cc * cc] });
      Object.assign(F, { sim, view, U, R, nx, cc, nv: sp.V.length, nc: cells.length, Vt: Math.PI * R * R * nx, KF: Math.round(U.steps(REC.kf)), t0: sim.t,
        warmEnd: Math.round(U.steps(REC.warm)), spf: 4, sps: 0, last: 0, lastReg: 0, phase: 'choose' });
      F.posBuf = new Float32Array(F.nv * F.nc * 4); F.ancBuf = new Float32Array(F.nc * 4); F.trBuf = new Float32Array(view.TW * view.TW * 4);
      fineChoose();
    } catch (e) { console.error(e); fineExit(); setStatus('the fine grid could not start: ' + e.message); }
  }
  // offer the replay lengths, with the time each takes on this GPU (measured while the flow settles on the fine grid)
  function fineChoose() {
    const F = fine, est = L => F.sps ? (Math.max(0, F.warmEnd - F.sim.t) + L * REC.kfPerSec * F.KF) / F.sps : 0;
    const per = F.sps ? (REC.kfPerSec * F.KF / F.sps) : 0;
    recUI(F.sps ? `Fine grid ready. On this GPU, each second of replay takes about <b>${per < 10 ? per.toFixed(1) : per.toFixed(0)} s</b> to compute.` : 'Fine grid ready; timing this GPU…',
      [...REC.lengths.map(L => ({ label: `Record ${L} s <small>${F.sps ? '≈ ' + fmtDur(est(L)) : '…'}</small>`, ghost: L !== 20, do: () => fineRecord(L) })),
        { label: 'Cancel', ghost: true, do: fineExit },
        { note: `Each replay second shows <b>1 ms</b> of blood time (${(REC.kfPerSec * F.KF).toLocaleString()} steps of the fine grid). The live view is paused meanwhile; what you see now is the fine grid itself, running as fast as it can.` }]);
  }
  function fineRecord(L) {
    const F = fine; if (!F || F.phase !== 'choose') return;
    Object.assign(F, { phase: 'rec', nFrames: L * REC.kfPerSec + 1, frames: [], stats: [] });
    F.nextKf = Math.max(F.sim.t, F.warmEnd); F.recT0 = F.nextKf;
    fineRecUI(true);
  }
  function fineRecUI(build) {
    const F = fine, done = F.frames.length, left = F.recT0 + (F.nFrames - 1) * F.KF - F.sim.t, sec = F.sps ? left / F.sps : 0;
    const rec = Math.max(0, done - 1) / REC.kfPerSec, total = (F.nFrames - 1) / REC.kfPerSec;
    const msg = F.sim.t < F.recT0 ? 'Letting the flow settle on the fine grid' : `Recording <b>${rec.toFixed(1)}</b> of ${total} s`;
    recUI(`${msg} · about ${fmtDur(sec)} left`, build ? [
      { label: 'Stop and replay', ghost: true, id: 'recStop', do: () => { if (fine && fine.frames.length >= 3) fineReplay(); } },
      { label: 'Cancel', ghost: true, do: fineExit },
      { note: 'The page cannot save files. To keep a replay, screen-record it.' }] : null, (F.sim.t - F.t0) / Math.max(1, F.recT0 + (F.nFrames - 1) * F.KF - F.t0));
    const b = $('recStop'); if (b) b.disabled = F.frames.length < 3;
  }
  function fineExit() {
    const F = fine; fine = null;
    if (F && F.view) { F.view.dispose(); F.sim.dispose(); }
    $('recActions').innerHTML = ''; // old buttons' closures would keep the recording alive
    $('clockLab').textContent = 'blood time';
    showBars('live'); setStatus('');
  }

  // one display frame while the fine grid is on stage
  function fineTick(now, w, h) {
    const F = fine, sim = F.sim;
    if (gl.isContextLost()) { fineExit(); setStatus('the graphics card gave up on the fine grid'); return; }
    if (F.phase === 'choose' || F.phase === 'rec') {
      // step for ~40 ms of GPU time per frame; stop exactly on a stored frame
      let n = Math.max(1, Math.round(F.spf));
      if (F.phase === 'rec') n = Math.min(n, F.nextKf - sim.t);
      const t0 = performance.now();
      if (n > 0) { sim.step(n); sim.sync(); }
      const ms = performance.now() - t0;
      if (n > 0 && F.last) { // throughput over the whole frame (stepping, drawing, waiting), for the estimates
        const sps = n / Math.max(1e-3, (now - F.last) / 1000);
        F.sps = F.sps ? 0.85 * F.sps + 0.15 * sps : sps;
        F.spf = Math.max(1, Math.min(400, F.spf * (ms > 45 ? 0.85 : ms < 35 ? 1.15 : 1)));
      }
      F.last = now;
      if (F.phase === 'choose' && sim.t - F.lastReg > 500) { // blood speed while settling (for the HUD)
        F.lastReg = sim.t; F.vNow = sim.sumMacro()[0] / F.nx / (Math.PI * F.R * F.R) * F.U.V;
        if (DEBUG) console.log('DBG fine', sim.t, (sim.t * F.U.dt * 1e3).toFixed(2), 'ms v', (F.vNow * 1e3).toFixed(3));
      }
    }
    if (F.phase === 'replay') fineReplayFrame(now);
    F.view.render(w, h);
    if (F.phase === 'rec' && sim.t === F.nextKf) fineCapture();
    scaleBar(F.view, F.U);
    if (now - (fineTick.lastHud || 0) > 200 || F.phase === 'replay') {
      fineTick.lastHud = now;
      writeHud(fineHud());
      if (F.phase === 'replay') {
        const i = Math.min(F.frames.length - 1, Math.floor(F.ph));
        setClock(F.ph / REC.kfPerSec);
        $('clockLab').textContent = `fine grid · replay${F.playing ? ' · slowed ' + Math.round(1000 / F.speed).toLocaleString() + '×' : ' · paused'}`;
        if (!F.scrubbing) $('rpScrub').value = Math.round(1000 * F.ph / Math.max(1, F.frames.length - 1));
        $('rpTime').textContent = `${(F.ph / REC.kfPerSec).toFixed(1)} / ${((F.frames.length - 1) / REC.kfPerSec).toFixed(1)} s`;
        F.hudI = i;
      } else {
        setClock((sim.t - (F.phase === 'rec' && sim.t >= F.recT0 ? F.recT0 : F.t0)) * F.U.dt * 1e3);
        $('clockLab').textContent = F.phase === 'rec' ? (sim.t >= F.recT0 ? 'fine grid · recording' : 'fine grid · settling') : 'fine grid · settling';
        if (F.phase === 'rec') fineRecUI(false);
        else if (now - (F.lastChoose || 0) > 1000) { F.lastChoose = now; fineChooseRefresh(); }
      }
    }
  }
  // refresh only the time estimates of the length buttons (rebuilding them would eat clicks)
  function fineChooseRefresh() {
    const F = fine, btns = $('recActions').querySelectorAll('button');
    if (!F.sps || btns.length < REC.lengths.length) return;
    if (!F.shownSps) { F.shownSps = 1; fineChoose(); return; }
    REC.lengths.forEach((L, k) => { btns[k].querySelector('small').textContent = '≈ ' + fmtDur((Math.max(0, F.warmEnd - F.sim.t) + L * REC.kfPerSec * F.KF) / F.sps); });
    const per = REC.kfPerSec * F.KF / F.sps, b = $('recMsg').querySelector('b'); if (b) b.textContent = (per < 10 ? per.toFixed(1) : per.toFixed(0)) + ' s';
  }
  // store one frame: cell shapes, tracers, and the measurements the HUD replays
  function fineCapture() {
    const F = fine, sim = F.sim, { nv, nc, nx } = F, prev = F.frames[F.frames.length - 1];
    const fr = rpEncode(sim.readTex(sim.pos[sim.mcur], nv, nc), sim.readTex(sim.anc[sim.mcur], nc, 1), nv, nc, nx, prev);
    fr.tr = rpEncodeTracers(F.view.readTracers()); fr.t = sim.t;
    const cs = sim.readCentres(), Q = sim.sumMacro()[0] / nx;
    let flux = null;
    if (prev) { flux = 0; for (let c = 0; c < nc; c++) flux += cs[c].V * (fr.cen[3 * c] - prev.cen[3 * c]); flux /= (fr.t - prev.t); }
    const HT = cs.reduce((a, c) => a + c.V, 0) / F.Vt;
    // cell-free layer: wall gap to the outermost membrane in each 1 µm slice of the vessel
    const bins = new Float32Array(Math.ceil(nx / 4)), w = 1e-6 / F.U.dx;
    for (let c = 0; c < nc; c++) for (let v = 0; v < nv; v++) {
      const i = 3 * (c * nv + v), x = fr.cen[3 * c] + fr.off[i] / RP_OFF, r = Math.hypot(fr.cen[3 * c + 1] + fr.off[i + 1] / RP_OFF - F.cc, fr.cen[3 * c + 2] + fr.off[i + 2] / RP_OFF - F.cc);
      const b = Math.floor((((x % nx) + nx) % nx) / w) % bins.length; if (r > bins[b]) bins[b] = r;
    }
    let g = 0, nb = 0; bins.forEach(r => { if (r > 0) { g += F.R - r; nb++; } });
    F.stats.push({ Q, flux, HT, cfl: nb ? g / nb * F.U.dx * 1e6 : 0 });
    F.frames.push(fr); F.nextKf += F.KF;
    if (F.frames.length >= F.nFrames) fineReplay();
  }
  function fineReplay() {
    const F = fine; F.nFrames = F.frames.length;
    Object.assign(F, { phase: 'replay', run: rpWindow(F.stats, REC.window), ph: 0, playing: true, speed: 1, loop: true, lastPh: -1, lastNow: 0 });
    F.view.frozen = true;
    showBars('replay');
    $('rpSpeed').querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c.textContent === '1×'));
    $('rpLoop').setAttribute('aria-pressed', true);
    $('rpNote').innerHTML = `Recorded on the 0.25 µm grid: ${((F.frames.length - 1) * F.KF).toLocaleString()} steps, ${((F.frames.length - 1) / REC.kfPerSec).toFixed(0)} ms of blood time. Drag to orbit, scroll to zoom. The page cannot save files; to keep the replay, screen-record it.`;
    $('rpPlay').textContent = '❚❚ Pause';
  }
  function fineReplayFrame(now) {
    const F = fine, N = F.frames.length, dt = F.lastNow ? Math.min(100, now - F.lastNow) : 0; F.lastNow = now;
    if (F.playing && !F.scrubbing) {
      F.ph += dt / 1000 * REC.kfPerSec * F.speed;
      if (F.ph >= N - 1) { if (F.loop) F.ph = 0; else { F.ph = N - 1; F.playing = false; $('rpPlay').textContent = '▶ Play'; } }
    }
    if (F.ph === F.lastPh) return;
    F.lastPh = F.ph;
    const i = Math.min(N - 2, Math.floor(F.ph)), f = Math.max(0, Math.min(1, F.ph - i)), A = F.frames[i], B = F.frames[i + 1];
    rpDecode(A, B, f, F.nv, F.nc, F.nx, F.posBuf, F.ancBuf); F.sim.writeCells(F.posBuf, F.ancBuf);
    rpDecodeTracers(A.tr, B.tr, f, F.nx, F.trBuf); F.view.writeTracers(F.trBuf);
  }
  // HUD for the fine grid: the recorded measurements averaged over 4 ms of blood time around the frame on show
  function fineHud() {
    const F = fine, U = F.U, G = F.G, Q0 = Math.PI * U.gradP(G) * F.R ** 4 / (8 / 6);
    const i = F.phase === 'replay' ? Math.min(F.run.length - 1, Math.floor(F.ph)) : F.stats.length - 1;
    const r = F.phase === 'replay' ? F.run[i] : (F.stats.length ? rpWindow(F.stats, REC.window)[i] : null);
    const eta = r ? Q0 / r.Q : 0, HD = r && r.HDflux ? r.HDflux / F.nx / r.Q : 0;
    const v = r ? r.Q / (Math.PI * F.R * F.R) * U.V : F.vNow || 0;
    return [
      ['Thickness vs plasma', eta ? eta.toFixed(2) + '×' : '–', 'big'],
      ['Glass-tube data', HD ? priesEta(F.D, HD).toFixed(2) + '×' : '–', 'opt'],
      ['sep'],
      ['Cells in the vessel', r ? (r.HT * 100).toFixed(1) + '%' : '–'],
      ['Cells leaving it', HD ? (HD * 100).toFixed(1) + '%' : '–', 'rate'],
      ['Cell-free layer', r && r.cfl ? r.cfl.toFixed(1) + ' µm' : '–'],
      ['sep'],
      ['Blood speed', fmtSpeed(v)],
      ['Pressure drop', (G * 1e-3 / mmHg).toFixed(1) + ' mmHg per mm', 'opt'],
      ['Grid', '0.25 µm (fine)', 'rate'],
    ];
  }
  // replay controls
  $('rpPlay').onclick = () => { const F = fine; if (!F || F.phase !== 'replay') return; if (!F.playing && F.ph >= F.frames.length - 1) F.ph = 0; F.playing = !F.playing; $('rpPlay').textContent = F.playing ? '❚❚ Pause' : '▶ Play'; };
  $('rpScrub').addEventListener('input', () => { const F = fine; if (!F || F.phase !== 'replay') return; F.scrubbing = true; F.ph = +$('rpScrub').value / 1000 * (F.frames.length - 1); });
  $('rpScrub').addEventListener('change', () => { if (fine) fine.scrubbing = false; });
  $('rpLoop').onclick = () => { const F = fine; if (!F) return; F.loop = !F.loop; $('rpLoop').setAttribute('aria-pressed', F.loop); };
  $('rpLive').onclick = fineExit;
  (() => {
    const box = $('rpSpeed');
    for (const [lab, v] of [['¼×', 0.25], ['½×', 0.5], ['1×', 1], ['2×', 2], ['4×', 4]]) {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = lab; b.setAttribute('aria-pressed', v === 1);
      b.onclick = () => { if (fine) fine.speed = v; box.querySelectorAll('.chip').forEach(c => c.setAttribute('aria-pressed', c === b)); };
      box.appendChild(b);
    }
  })();
  // camera: drag to orbit, wheel / pinch to zoom
  (() => {
    let drag = null;
    cv.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); });
    cv.addEventListener('pointermove', e => {
      const v = stageView(); if (!drag || !v) return;
      const c = v.cam; c.yaw -= (e.clientX - drag.x) * 0.006; c.pitch = Math.max(-1.4, Math.min(1.4, c.pitch + (e.clientY - drag.y) * 0.006));
      drag = { x: e.clientX, y: e.clientY };
    });
    cv.addEventListener('pointerup', () => { drag = null; });
    cv.addEventListener('wheel', e => { const v = stageView(); if (!v) return; e.preventDefault(); v.cam.dist *= Math.exp(e.deltaY * 0.001); }, { passive: false });
  })();

  $('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '❚❚ Pause' : '▶ Play'; };
  $('restart').onclick = () => load(curName, true);
  $('pace').oninput = () => { const v = +$('pace').value; pace = v / 100; $('paceOut').textContent = v === 100 ? 'full speed' : v === 0 ? 'paused' : v + '%'; };

  // main loop: steps per frame adapt so a frame takes about 14 ms of GPU work
  let spf = 20, lastMeasure = 0, lastFrame = performance.now(), simMs = 0;
  function loop(now) {
    requestAnimationFrame(loop);
    const dpr = Math.min(window.devicePixelRatio || 1, 2), w = Math.round(cv.clientWidth * dpr), h = Math.round(cv.clientHeight * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    if (fine) { if (fine.view) fineTick(now, w, h); else if (cur) cur.view.render(w, h); lastFrame = now; return; } // the live scene waits while the fine grid is on
    if (!cur || busy) return;
    const n = playing ? Math.max(1, Math.round(spf * pace)) : 0;
    // adapt the work per frame to the frame rate: GPU-bound frames arrive late, so aim for ~60 fps
    const fdt = now - lastFrame;
    if (n && fdt > 0 && fdt < 200) { spf = fdt > 24 ? spf * 0.9 : fdt < 19 ? spf * 1.04 : spf; spf = Math.max(2, Math.min(cur.maxSpf || 400, spf)); }
    if (n) {
      cur.sim.step(n);
      if (now - lastMeasure > 250) { cur.scene.measure(cur); lastMeasure = now; }
    }
    cur.view.render(w, h);
    scaleBar(cur.view, cur.U);
    if (now - (loop.lastHud || 0) > 200) {
      loop.lastHud = now;
      writeHud(cur.scene.hud(cur, knobVals));
      const tms = cur.sim.t * cur.U.dt * 1e3, real = (now - lastFrame);
      setClock(tms);
      loop.fdt = loop.fdt ? 0.9 * loop.fdt + 0.1 * real : real;
      $('clockLab').textContent = n ? `blood time · slowed ${Math.round((loop.fdt / 1000) / (n * cur.U.dt)).toLocaleString()}×` : 'blood time · paused';
    }
    lastFrame = now;
  }
  // scale bar: 10 µm at the distance of the camera target
  function scaleBar(view, U) {
    const c = view.cam, pxPerLu = cv.clientHeight / (2 * c.dist * Math.tan(c.fov / 2)), um = U.dx * 1e6;
    let L = 10; while (L * pxPerLu / um > 220) L /= 2; while (L * pxPerLu / um < 50) L *= 2;
    const sb = $('scalebar'); sb.querySelector('i').style.width = (L * pxPerLu / um).toFixed(0) + 'px'; sb.lastChild.textContent = (L >= 1 ? L : L.toFixed(1)) + ' µm';
  }
  function writeHud(rows) { hud.innerHTML = rows.map(([k, v, cls]) => k === 'sep' ? '<div class="sep"></div>' : `<dt class="${cls || ''}">${k}</dt><dd class="${cls || ''}">${v}</dd>`).join(''); }
  function setClock(tms) { $('clock').querySelector('span').textContent = tms < 1000 ? tms.toFixed(1) + ' ms' : (tms / 1000).toFixed(2) + ' s'; }

  // for the sections below: load a scene (optionally with knob values) and bring the stage into view
  window.bloodShow = (name, knobs) => {
    const s = SCENES[name]; if (!s) return;
    if (knobs) for (const k of s.knobs) if (k.id in knobs) k.value = knobs[k.id];
    load(name); $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  // the fine-grid recorder needs the 20 µm arteriole on stage
  window.bloodFine = async () => {
    $('stage').scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (fine) return;
    if (curName !== 'arteriole' || knobVals.D !== 20) { SCENES.arteriole.knobs[0].value = 20; await load('arteriole'); }
    fineStart();
  };
  buildChips(); load(new URLSearchParams(location.search).get('scene') || 'capillary'); requestAnimationFrame(loop);
})();

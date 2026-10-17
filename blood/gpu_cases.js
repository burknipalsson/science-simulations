// Browser-side GPU validation cases, driven by gpu_run.js
const sleep0 = () => new Promise(r => setTimeout(r, 0));
// step in chunks, yielding to the browser (and letting the GPU drain) so long runs never lose the context
// optional watchdog (window.WATCH = { cc, R, every }): stop at the first vertex force above WATCH.fmax and report where it is
async function watchdog(L) {
  const W = window.WATCH, nv = L.tb.nv, vf = L.readTex(L.vf, nv, L.nCells); let bi = 0, bm = 0;
  for (let i = 0; i < vf.length; i += 4) { const m = Math.hypot(vf[i], vf[i + 1], vf[i + 2]); if (!(m <= bm)) { bm = m; bi = i / 4; } }
  if (W.keep && isFinite(bm) && bm <= W.fmax) { W.last = L.readCells(); W.lastT = L.t; W.lastAnc = L.readTex(L.anc[L.mcur], L.nCells, 1); }
  if ((bm > W.fmax || !isFinite(bm)) && W.keep && W.last) {
    const ci = Math.floor(bi / nv); console.log(`WATCHDOG step ${L.t} (last good ${W.lastT}): first bad force cell ${ci} vertex ${bi % nv}`);
    const X = W.last, p = X[ci][bi % nv], nx = L.o.nx; let best = 1e9, bj = -1;
    X.forEach((Xc, j) => { if (j === ci) return; for (const q of Xc) { let dx = q[0] - p[0]; dx -= nx * Math.round(dx / nx); const d = Math.hypot(dx, q[1] - p[1], q[2] - p[2]); if (d < best) { best = d; bj = j; } } });
    console.log(`  last good: vertex at ${p.map(x => x.toFixed(2))}, r ${Math.hypot(p[1] - W.cc, p[2] - W.cc).toFixed(2)}; nearest other cell ${bj} at ${best.toFixed(3)}; anchor ${Array.from(W.lastAnc.slice(4 * ci, 4 * ci + 3))}`);
    const xs = X[ci].map(q => q[0]); console.log(`  cell x-range ${Math.min(...xs).toFixed(1)}..${Math.max(...xs).toFixed(1)} (box ${nx})`);
    throw new Error('watchdog');
  }
  if (bm > W.fmax || !isFinite(bm)) {
    const ci = Math.floor(bi / nv), X = L.readCells(), p = X[ci][bi % nv], nx = L.o.nx;
    let best = 1e9, bj = -1; X.forEach((Xc, j) => { if (j === ci) return; for (const q of Xc) { let dx = q[0] - p[0]; dx -= nx * Math.round(dx / nx); const d = Math.hypot(dx, q[1] - p[1], q[2] - p[2]); if (d < best) { best = d; bj = j; } } });
    const cs = L.readCentres()[ci];
    console.log(`WATCHDOG step ${L.t}: |F| ${bm.toExponential(2)} at cell ${ci} vertex ${bi % nv}; r ${Math.hypot(p[1] - W.cc, p[2] - W.cc).toFixed(2)} of ${W.R.toFixed(2)}; nearest other cell ${bj} at ${best.toFixed(2)} lu; cell vol ${(cs.V / W.V0).toFixed(3)}`);
    if (W.dump) console.log('DUMP ' + JSON.stringify({ X: X[ci].map(q => q.map(x => +(x * W.dx).toFixed(3))), F: W.F }));
    throw new Error('watchdog');
  }
}
async function run(L, n) { while (n > 0) { if (L.gl.isContextLost()) throw new Error("WebGL context lost"); const k = Math.min(n, 250); L.step(k); n -= k; L.sync(); if (window.WATCH) await watchdog(L); await sleep0(); } }
function mkGL() {
  const gl = document.getElementById('c').getContext('webgl2', { antialias: false });
  console.log('GPU:', gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL));
  return gl;
}
// a cell record for BloodGPU from reference vertices X0 (centred), placed at centre c (lattice units)
function cellAt(X, c, par) {
  const anchor = c.map(Math.round);
  return Object.assign({ X: X.map(p => [p[0] + c[0] - anchor[0], p[1] + c[1] - anchor[1], p[2] + c[2] - anchor[2]]), anchor }, par);
}
const CASES = {
  async poiseuille(R = '10.3') {
    R = +R; const gl = mkGL(), ny = Math.ceil(2 * R + 4), c0 = (ny - 1) / 2, nu = 1 / 6, G = 1e-6;
    const L = new BloodGPU(gl, { nx: 4, ny, nz: ny, tau: 1, body: [G, 0, 0], sdf: `return ${R.toFixed(4)} - length(p.yz - vec2(${c0.toFixed(4)}));` });
    const t0 = performance.now(); L.step(20000);
    const m = L.readMacroSlice(Math.round(c0)); let err = 0, um = 0;
    for (let y = 0; y < ny; y++) { const r = Math.abs(y - c0); if (r >= R) continue; const ue = G / (4 * nu) * (R * R - r * r); err = Math.max(err, Math.abs(m[4 * (1 + 4 * y)] - ue)); um = Math.max(um, ue); }
    const s = L.sumMacro();
    console.log(`R ${R}: max error ${(err / um * 100).toFixed(3)}% of centre velocity; Q/Q_exact ${(s[0] / 4 / (Math.PI * G * R ** 4 / (8 * nu))).toFixed(4)}; ${((performance.now() - t0) / 1000).toFixed(1)} s`);
  },
  // spherical Skalak capsule (C = 1) in shear between moving walls: same setup as test_capsule.js
  async capsule(Ca = '0.0125', a = '6', level = '3', tg = '4') {
    Ca = +Ca; a = +a; const gl = mkGL(), H = 8 * a, nx = 7 * a, nz = 7 * a, ny = H + 2, U = 0.008, gam = 2 * U / H, nu = 1 / 6;
    const sp = icosphere(+level), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) }, X0 = sp.V.map(p => p.map(x => x * a));
    const tables = buildMeshTables(mesh, [X0]), ref = makeRef({ X: X0, F: sp.F, E: mesh.E });
    const L = new BloodGPU(gl, { nx, ny, nz, tau: 1, maxCells: 1, tables,
      sdf: `return min(p.y - 0.5, ${H}.5 - p.y);`, wallVel: `return vec3(p.y > ${ny / 2}. ? ${U} : ${-U}, 0., 0.);`,
      initVel: `return vec3(${U} * 2. * (p.y - ${(H + 1) / 2}) / ${H}., 0., 0.);`, noMassFix: !!window.NOFIX });
    const Gs = nu * gam * a / Ca;
    L.setCells([cellAt(X0, [nx / 2, (H + 1) / 2, nz / 2], { Gs, C: 1, kb: 0, kA: 0, kV: 0, A0: ref.A, V0: ref.V })]);
    const t0 = performance.now(), per = Math.round(1 / gam);
    for (let k = 1; k <= +tg; k++) {
      L.step(per);
      const X = L.readCells()[0], e = ellipsoid(X, sp.F);
      const ip = [0, 1, 2].sort((i, j) => Math.abs(e.dirs[i][2]) - Math.abs(e.dirs[j][2])).slice(0, 2).sort((i, j) => e.axes[j] - e.axes[i]);
      const D = (e.axes[ip[0]] - e.axes[ip[1]]) / (e.axes[ip[0]] + e.axes[ip[1]]), th = Math.atan2(e.dirs[ip[0]][1], e.dirs[ip[0]][0]) * 180 / Math.PI;
      console.log(`mass ${L.sumMacro()[3].toFixed(2)} | t·γ ${k}: D ${D.toFixed(4)} incl ${((th + 180) % 180).toFixed(1)}° vol ${(e.vol / (4 / 3 * Math.PI * a ** 3)).toFixed(4)} centre ${e.centre.map(x => x.toFixed(2))}`);
      await sleep0();
    }
    console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s for ${L.t} steps`);
  },
};
// one red cell in a capillary: grow it in place, then drive the flow with a pressure gradient
CASES.capillary = async (Dt = '6', umm = '1', grow = '6000', run = '30000', dump = '', dxum = '0.5', level = '3', boxum = '40') => {
  const U = new Units({ dx: +dxum * 1e-6 }), gl = mkGL(), R = U.len(+Dt * 1e-6) / 2, n = Math.ceil(2 * R) + 4, nx = Math.round(U.len(+boxum * 1e-6)), c0 = (n - 1) / 2;
  const sp = icosphere(+level), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) };
  const Xum = biconcave(sp.V), X0 = Xum.map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: mesh.E });
  const tables = buildMeshTables(mesh, [X0]);
  // the tube starts wide enough for the cell (radius R1) and narrows to R around it
  const R1 = Math.max(R, U.len(4.75e-6)), n2 = Math.ceil(2 * R1) + 4, cc = (n2 - 1) / 2;
  const L = new BloodGPU(gl, { nx, ny: n2, nz: n2, tau: 1, maxCells: 1, tables, SP: [R1, 0, 0, 0], sdf: `return SP.x - length(p.yz - vec2(${cc.toFixed(4)}));` });
  const Gs = U.GsL, s0 = 1, rot = X0.map(p => [p[2], p[1], -p[0]]); // 90° about y (a proper rotation keeps the faces outward)
  const par = { Gs, C: 100, kb: 2 * U.energy(2e-19) / Math.sqrt(3), kA: +(window.KA || 100) * Gs, kV: +(window.KV || 1000) * Gs, A0: ref.A, V0: ref.V, push: +(window.PUSH || 30) * Gs, scale: s0 };
  const cell = cellAt(rot, [nx / 4, cc, cc], par);
  L.setCells([cell]);
  console.log(`tube ${Dt} µm = ${(2 * R).toFixed(1)} lu, box ${nx}x${n2}x${n2}; dt ${(U.dt * 1e6).toFixed(3)} µs`);
  const G = 8 * U.eta * (+umm * 1e-3) / (+Dt * 1e-6 / 2) ** 2;
  for (let k = 1; k <= 40; k++) {
    L.setSP([R1 + (R - R1) * k / 40, 0, 0, 0]); L.step(Math.round(+grow / 40));
    if (k % 5 === 0 || k < 3) { const Xk = L.readCells()[0], ek = ellipsoid(Xk, sp.F); console.log(`  narrowing ${k}/40: tube radius ${(R1 + (R - R1) * k / 40).toFixed(2)} lu, vol ${(ek.vol / ref.V).toFixed(4)}, axes ${ek.axes.map(a => a.toFixed(2))}, centre ${ek.centre.map(a => a.toFixed(2))}`); }
  }
  let X = L.readCells()[0], e = ellipsoid(X, sp.F);
  console.log(`narrowed: vol ${(e.vol / ref.V).toFixed(4)} of reference, axes ${e.axes.map(a => (a * +dxum).toFixed(2))} µm`);
  L.o.body = [U.gradP(G), 0, 0];
  let prevC = e.centre[0], t0 = performance.now(), chunk = 2000;
  for (let k = 0; k < +run / chunk; k++) {
    L.step(chunk);
    X = L.readCells()[0]; e = ellipsoid(X, sp.F);
    const s = L.sumMacro(), umean = s[0] / nx / (Math.PI * R * R);
    let dxc = e.centre[0] - prevC; dxc -= nx * Math.round(dxc / nx); const vc = dxc / chunk; prevC = e.centre[0];
    const xs = X.map(p => p[0]), len = Math.max(...xs) - Math.min(...xs);
    const rmax = Math.max(...X.map(p => Math.hypot(p[1] - cc, p[2] - cc)));
    if (k % 3 === 2 || k === +run / chunk - 1) console.log(`t ${(L.t * U.dt * 1e3).toFixed(2)} ms: cell ${(U.V * vc * 1e3).toFixed(3)} mm/s, mean flow ${(U.V * umean * 1e3).toFixed(3)} mm/s, ratio ${(vc / umean).toFixed(3)}; length ${(len * +dxum).toFixed(2)} µm, max radius ${(rmax * +dxum).toFixed(2)} of ${(R * +dxum).toFixed(2)} µm; vol ${(e.vol / ref.V).toFixed(4)}`);
    await sleep0();
  }
  console.log(`${((performance.now() - t0) / 1000).toFixed(1)} s`);
  if (dump) console.log('DUMP ' + JSON.stringify({ X: X.map(p => p.map(x => +(x * +dxum).toFixed(3))), F: sp.F, R: R * +dxum, c0: cc * +dxum }));
};
// a red cell at rest in open fluid (each force term switchable): it should keep its shape
CASES.rest = async (terms = 'skalak,bend,area,vol', steps = '4000', scale = '1', dxum = '0.5', level = '3', C = '100', GsL = '0.002') => {
  const U = new Units({ dx: +dxum * 1e-6, GsL: +GsL }), gl = mkGL(), n = Math.round(16 / +dxum), T = terms.split(',');
  const sp = icosphere(+level), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) };
  const X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: mesh.E });
  const L = new BloodGPU(gl, { nx: n, ny: n, nz: n, tau: 1, maxCells: 1, tables: buildMeshTables(mesh, [X0]) });
  const Gs = U.GsL, par = { Gs: T.includes('skalak') ? Gs : 0, C: +C, kb: T.includes('bend') ? 2 * U.energy(2e-19) / Math.sqrt(3) : 0,
    kA: T.includes('area') ? 100 * Gs : 0, kV: T.includes('vol') ? 100 * Gs : 0, A0: ref.A, V0: ref.V, push: 0, scale: +scale };
  L.setCells([cellAt(X0, [n / 2, n / 2, n / 2], par)]);
  // compare GPU vertex forces with the CPU reference at the initial (perturbed) state
  for (let k = 0; k < 5; k++) {
    await run(L, +steps / 5);
    const X = L.readCells()[0], e = ellipsoid(X, sp.F);
    console.log(`step ${L.t}: vol ${(e.vol / ref.V).toFixed(4)} axes ${e.axes.map(a => a.toFixed(2))} (ref ${ellipsoid(X0, sp.F).axes.map(a => a.toFixed(2))})`);
  }
};
// growth check: a cell placed at scale s0 with its stress-free shape ramped from s0 to 1
CASES.grow = async (s0 = '0.5', steps = '6000', kv = '1000', dxum = '0.5', level = '3', C = '10') => {
  s0 = +s0; const U = new Units({ dx: +dxum * 1e-6 }), gl = mkGL(), n = Math.round(16 / +dxum);
  const sp = icosphere(+level), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) };
  const X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: mesh.E });
  const L = new BloodGPU(gl, { nx: n, ny: n, nz: n, tau: 1, maxCells: 1, tables: buildMeshTables(mesh, [X0]) });
  const Gs = U.GsL, par = { Gs, C: +C, kb: 2 * U.energy(2e-19) / Math.sqrt(3), kA: 100 * Gs, kV: +kv * Gs, A0: ref.A, V0: ref.V, push: 0, scale: s0 };
  L.setCells([cellAt(X0.map(p => p.map(x => x * s0)), [n / 2, n / 2, n / 2], par)]);
  for (let k = 1; k <= 20; k++) {
    for (let j = 1; j <= 8; j++) { par.scale = s0 + (1 - s0) * Math.min(1, (k - 1 + j / 8) / 15); L.setParams([par]); await run(L, +steps / 160); }
    if (k % 4 === 0) { const e = ellipsoid(L.readCells()[0], sp.F); const vf = L.readTex(L.vf, L.tb.nv, 1); let bm = 0; for (let i = 0; i < vf.length; i += 4) bm = Math.max(bm, Math.hypot(vf[i], vf[i + 1], vf[i + 2])); console.log('   max |F|', bm.toExponential(2)); console.log(`step ${L.t}: ref scale ${par.scale.toFixed(2)}  vol ${(e.vol / ref.V).toFixed(4)} (target ${(par.scale ** 3).toFixed(3)})  axes ${e.axes.map(a => a.toFixed(2))}`); }
  }
};
// random rotation matrix (uniform)
function randRot(rnd) {
  const u1 = rnd(), u2 = rnd(), u3 = rnd(), q = [Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2), Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2), Math.sqrt(u1) * Math.sin(2 * Math.PI * u3), Math.sqrt(u1) * Math.cos(2 * Math.PI * u3)];
  const [x, y, z, w] = q;
  return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
}
// grow a random suspension of red cells in a tube (radius R lattice units, length nx) at this resolution;
// returns absolute vertex positions of every cell and the tube centre
async function growSuspension(gl, U, R, nx, HT, O, level) {
  const n = Math.ceil(2 * R) + 2, cc = (n - 1) / 2;
  const sp = icosphere(level), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) };
  const X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: mesh.E });
  const N = Math.round(HT * Math.PI * R * R * nx / ref.V);
  let seed = O.seed; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rb = O.s0 * U.len(3.95e-6) + 0.6, cen = [];
  for (let tries = 0; cen.length < N && tries < 1e6; tries++) {
    const r = (R - rb - 1) * Math.sqrt(rnd()), a = 2 * Math.PI * rnd(), p = [nx * rnd(), cc + r * Math.cos(a), cc + r * Math.sin(a)];
    if (cen.every(q => { let dx = p[0] - q[0]; dx -= nx * Math.round(dx / nx); return Math.hypot(dx, p[1] - q[1], p[2] - q[2]) > 2 * rb; })) cen.push(p);
  }
  if (cen.length < N) console.log(`could only place ${cen.length} of ${N} cells`);
  const Gs = U.GsL, cells = cen.map(c => { const M = randRot(rnd);
    return cellAt(X0.map(p => [0, 1, 2].map(i => O.s0 * (M[i][0] * p[0] + M[i][1] * p[1] + M[i][2] * p[2]))), c,
      { Gs, C: O.C ?? 10, kb: 2 * U.energy(2e-19) / Math.sqrt(3), kA: 100 * Gs, kV: 1000 * Gs, A0: ref.A, V0: ref.V, push: O.push * Gs, scale: O.s0 }); });
  const L = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, maxCells: cells.length, tables: buildMeshTables(mesh, [X0]), krep: O.krep * Gs, rcut: O.rcut,
    sdf: `return ${R.toFixed(4)} - length(p.yz - vec2(${cc.toFixed(4)}));` });
  L.setCells(cells);
  const per = Math.round((O.growSteps || 400) * 2e-3 / O.GsL);
  for (let k = 1; k <= 30; k++) for (let j = 1; j <= 8; j++) { for (const c of cells) c.scale = O.s0 + (1 - O.s0) * (k - 1 + j / 8) / 30; L.setParams(cells); await run(L, per / 8 | 0); }
  await run(L, Math.round(U.steps((O.settleMs ?? 10) * 1e-3)));
  const X = L.readCells(), v = L.readCentres().map(c => c.V / ref.V);
  console.log(`grown ${cells.length} cells at dx ${(U.dx * 1e6).toFixed(2)} µm: volumes ${Math.min(...v).toFixed(3)}..${Math.max(...v).toFixed(3)}`);
  return { X, cc, n };
}
// a suspension of red cells in a periodic tube (axis x): apparent viscosity and haematocrits vs Pries et al.
// opts.refine: grow at twice the spacing with a one-level-coarser mesh, then refine (faster, and avoids fine-grid crumpling)
CASES.tube = async (Dum = '20', Lum = '50', HT = '0.3', shear = '60', relaxMs = '20', runMs = '200', opts = '{}') => {
  const O = Object.assign({ dx: 0.5, level: 3, s0: 0.5, krep: 10, rcut: 1, seed: 1, every: 10, GsL: 2e-3, push: 30 }, JSON.parse(opts));
  const U = new Units({ dx: O.dx * 1e-6, GsL: O.GsL }), gl = mkGL(), R = U.len(+Dum * 1e-6) / 2, nx = Math.round(U.len(+Lum * 1e-6));
  const sp = icosphere(O.level), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) };
  const X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: mesh.E });
  const Vt = Math.PI * R * R * nx, t0 = performance.now();
  let Xs, cc, n;
  if (O.init === 'rsa') {
    // full-size biconcave cells at random orientations (shape-aware random sequential addition), µm frame centred on the axis
    n = Math.ceil(2 * R) + 2; cc = (n - 1) / 2;
    let seed = O.seed; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const Rum = +Dum / 2, Lu = nx * O.dx, N = Math.round(+HT * Vt / ref.V);
    const P = packCells({ N, rnd, sample: biconcave(icosphere(2).V), inside: p => Math.hypot(p[1], p[2]) < Rum - 0.3 });
    const per = d => [d[0] - Lu * Math.round(d[0] / Lu), d[1], d[2]];
    for (let i = 0; i < N; i++) if (!P.tryAdd(() => [Lu * rnd(), (2 * rnd() - 1) * Rum, (2 * rnd() - 1) * Rum], per)) break;
    const Xum = biconcave(sp.V);
    Xs = P.cells.map(({ M, t }) => Xum.map(p => [0, 1, 2].map(i => (M[i][0] * p[0] + M[i][1] * p[1] + M[i][2] * p[2] + t[i]) / O.dx + (i ? cc : 0))));
    console.log(`packed ${P.cells.length} of ${N} cells`);
  } else if (O.refine) {
    const Uc = new Units({ dx: 2 * O.dx * 1e-6, GsL: O.GsL }), g = await growSuspension(gl, Uc, R / 2, nx / 2, +HT, O, O.level - 1);
    Xs = g.X.map(Xc => refine(Xc, sp).map(p => p.map(x => 2 * x))); n = 2 * g.n - 1; cc = 2 * g.cc;
  } else { const g = await growSuspension(gl, U, R, nx, +HT, O, O.level); Xs = g.X; cc = g.cc; n = g.n; }
  const Gs = U.GsL;
  const cells = Xs.map(X => { const c = [0, 1, 2].map(d => X.reduce((a, p) => a + p[d], 0) / X.length), an = c.map(Math.round);
    return { X: X.map(p => [p[0] - an[0], p[1] - an[1], p[2] - an[2]]), anchor: an, Gs, C: O.C ?? 10, kb: 2 * U.energy(2e-19) / Math.sqrt(3), kA: 100 * Gs, kV: 1000 * Gs, A0: ref.A, V0: ref.V, push: O.push * Gs, scale: 1 }; });
  const Nmax = O.fill ? Math.round(O.fill * Vt / ref.V) : cells.length;
  const L = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, lambda: O.lambda || 1, cellRadius: U.len(9e-6), maxCells: Math.max(Nmax, cells.length), tables: buildMeshTables(mesh, [X0]), krep: O.krep * Gs, rcut: O.rcut,
    sdf: `return ${R.toFixed(4)} - length(p.yz - vec2(${cc.toFixed(4)}));` });
  L.setCells(cells); L.computeIndicator();
  if (O.watch) window.WATCH = { cc, R, fmax: O.watch, V0: ref.V, dx: O.dx, F: sp.F, dump: 1 };
  console.log(`tube ${Dum} µm x ${Lum} µm (${nx}x${n}x${n}), ${cells.length} cells, HT ${(cells.length * ref.V / Vt).toFixed(3)}, dt ${(U.dt * 1e6).toFixed(2)} µs, level ${O.level}${O.refine ? ' (refined)' : ''}`);
  if (O.trace) { const nr = Math.round(U.steps(+relaxMs * 1e-3)); for (let s = 0; s < nr; s += 2000) { await run(L, 2000); const cs = L.readCentres(), v = cs.map(c => c.V / ref.V); console.log(`  relax ${L.t}: vol ${Math.min(...v).toFixed(3)}..${Math.max(...v).toFixed(3)}, nan ${v.filter(x => !isFinite(x)).length}`); } }
  else await run(L, Math.round(U.steps(+relaxMs * 1e-3)));
  // flow: mean velocity = shear * D (pseudo-shear rate u/D); pressure gradient for that mean flow in a plasma-filled tube
  const um = +shear * +Dum * 1e-6, G = 8 * U.eta * um / (+Dum * 1e-6 / 2) ** 2, GL = U.gradP(G), nuL = 1 / 6;
  L.o.body = [GL, 0, 0];
  const Q0 = Math.PI * GL * R ** 4 / (8 * nuL); // plasma-only flux (lattice)
  // optional: insert more cells into gaps that open in the flowing suspension, until tube haematocrit O.fill
  if (O.fill) {
    let seed = O.seed + 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const sample = biconcave(icosphere(2).V).map(p => p.map(x => x / O.dx)), Xfull = biconcave(sp.V).map(p => p.map(x => x / O.dx));
    const A = U.len(3.95e-6) + 0.5, C = U.len(1.35e-6) + 0.5, gap = 1.2;
    for (let round = 0; round < 60 && L.nCells < Nmax; round++) {
      await run(L, Math.round(U.steps(3e-3)));
      const X = L.readCells(), cen = X.map(Xc => [0, 1, 2].map(d => Xc.reduce((a, p) => a + p[d], 0) / Xc.length));
      // spatial hash of existing vertices (2-lu bins, periodic in x)
      const bins = new Map(), key = (i, j, k) => ((i % 1000) + 1000) % 1000 + 1000 * (j + 1000 * k);
      X.forEach(Xc => Xc.forEach(p => { const k = key(Math.floor(p[0] / 2), Math.floor(p[1] / 2), Math.floor(p[2] / 2)); (bins.get(k) || bins.set(k, []).get(k)).push(p); }));
      const near = (p, r) => { const out = []; for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) { const b = bins.get(key(Math.floor(p[0] / 2) + i, Math.floor(p[1] / 2) + j, Math.floor(p[2] / 2) + k)); if (b) out.push(...b); } return out; };
      let added = 0;
      for (let tries = 0; tries < 4000 && L.nCells + added < Nmax && added < 6; tries++) {
        const r = (R - A * 0.6) * Math.sqrt(rnd()), a = 2 * Math.PI * rnd(), t = [nx * rnd(), cc + r * Math.cos(a), cc + r * Math.sin(a)], M = randRot(rnd);
        const pts = sample.map(p => [0, 1, 2].map(i => M[i][0] * p[0] + M[i][1] * p[1] + M[i][2] * p[2] + t[i]));
        if (pts.some(p => Math.hypot(p[1] - cc, p[2] - cc) > R - 1.2)) continue;
        // no existing vertex inside the padded spheroid, and no candidate point within 'gap' of an existing vertex
        let ok = true;
        for (const c0 of cen) { let dx = c0[0] - t[0]; dx -= nx * Math.round(dx / nx); if (Math.hypot(dx, c0[1] - t[1], c0[2] - t[2]) < 2.5) { ok = false; break; } }
        if (!ok) continue;
        for (const p of pts) { for (const q of near([((p[0] % nx) + nx) % nx, p[1], p[2]], gap)) { let dx = q[0] - p[0]; dx -= nx * Math.round(dx / nx); if (Math.hypot(dx, q[1] - p[1], q[2] - p[2]) < gap) { ok = false; break; } } if (!ok) break; }
        if (!ok) continue;
        for (const Xc of X) { for (const q of Xc) { let d = [q[0] - t[0], q[1] - t[1], q[2] - t[2]]; d[0] -= nx * Math.round(d[0] / nx); if (Math.abs(d[0]) > A + 1 || Math.abs(d[1]) > A + 1 || Math.abs(d[2]) > A + 1) continue;
          const l = [0, 1, 2].map(j => M[0][j] * d[0] + M[1][j] * d[1] + M[2][j] * d[2]); if ((l[0] * l[0] + l[1] * l[1]) / (A * A) + l[2] * l[2] / (C * C) < 1) { ok = false; break; } } if (!ok) break; }
        if (!ok) continue;
        X.push(Xfull.map(p => [0, 1, 2].map(i => M[i][0] * p[0] + M[i][1] * p[1] + M[i][2] * p[2] + t[i]))); cen.push(t); added++;
      }
      if (added) {
        const recs = X.map(Xc => { const c = [0, 1, 2].map(d => Xc.reduce((a, p) => a + p[d], 0) / Xc.length), an = c.map(Math.round);
          return { X: Xc.map(p => [p[0] - an[0], p[1] - an[1], p[2] - an[2]]), anchor: an, Gs, C: O.C ?? 10, kb: 2 * U.energy(2e-19) / Math.sqrt(3), kA: 100 * Gs, kV: 1000 * Gs, A0: ref.A, V0: ref.V, push: O.push * Gs, scale: 1 }; });
        L.setCells(recs); L.computeIndicator();
      }
      if (round % 5 === 0 || L.nCells >= Nmax) console.log(`  fill round ${round}: ${L.nCells} cells (HT ${(L.nCells * ref.V / Vt).toFixed(3)}), added ${added}`);
    }
    await run(L, Math.round(U.steps(+relaxMs * 1e-3)));
  }
  // sample cell centres every millisecond (short enough that no cell moves half a box between samples), report every O.every ms
  const ms1 = Math.round(U.steps(1e-3)), nch = Math.round(+runMs / O.every);
  let prev = L.readCentres(), acc = [];
  for (let k = 1; k <= nch; k++) {
    let flux = 0, Qs = 0;
    for (let j = 0; j < O.every; j++) {
      await run(L, ms1);
      const now = L.readCentres();
      now.forEach((c, i) => { let d = c.c[0] - prev[i].c[0]; d -= nx * Math.round(d / nx); flux += c.V * d / ms1; });
      prev = now; Qs += L.sumMacro()[0] / nx;
    }
    flux /= O.every; const Q = Qs / O.every, Vsum = prev.reduce((a, c) => a + c.V, 0);
    const HD = flux / nx / Q, HTs = Vsum / Vt, eta = Q0 / Q;
    acc.push({ HD, HT: HTs, eta, t: L.t * U.dt * 1e3 });
    if (O.lambda > 1 && k % 4 === 0) console.log(`  indicator / cell volume ${(L.sumIndicator() / Vsum).toFixed(3)}`);
    console.log(`t ${(L.t * U.dt * 1e3).toFixed(0)} ms: eta_rel ${eta.toFixed(3)}  HT ${HTs.toFixed(3)}  HD ${HD.toFixed(3)}  HT/HD ${(HTs / HD).toFixed(3)} | Pries at this HD: eta ${priesEta(+Dum, HD).toFixed(3)}, HT/HD ${(priesHT(+Dum, HD) / HD).toFixed(3)}  [${((performance.now() - t0) / 1000).toFixed(0)} s]`);
  }
  const half = acc.slice(Math.floor(acc.length / 2)), avg = k => half.reduce((a, b) => a + b[k], 0) / half.length;
  const HD = avg('HD');
  console.log(`MEAN (second half): eta_rel ${avg('eta').toFixed(3)}, HT ${avg('HT').toFixed(3)}, HD ${HD.toFixed(3)}, HT/HD ${(avg('HT') / HD).toFixed(3)}; Pries: eta_rel ${priesEta(+Dum, HD).toFixed(3)}, HT/HD ${(priesHT(+Dum, HD) / HD).toFixed(3)}`);
  { // axial velocity profile, averaged over the whole tube, in 10 radial bins
    const m = L.readTex(L.mac[L.cur], L.W, L.H), nb = 10, su = new Array(nb).fill(0), cn = new Array(nb).fill(0);
    for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) { const r = Math.hypot(y - cc, z - cc) / R; if (r >= 1) continue; const b = Math.floor(r * nb);
      for (let x = 0; x < nx; x++) { const ax = x + (z % L.TX) * nx, ay = y + Math.floor(z / L.TX) * n; su[b] += m[4 * (ax + ay * L.W)]; cn[b]++; } }
    const Q = L.sumMacro()[0] / nx, um = Q / (Math.PI * R * R);
    console.log('velocity profile u/u_mean by r/R bins:', su.map((s, i) => (s / cn[i] / um).toFixed(2)).join(' '));
  }
  if (O.dump) console.log('DUMPALL ' + JSON.stringify({ cells: L.readCells().map(X => X.map(p => p.map(x => +(x * O.dx).toFixed(2)))), F: sp.F, R: R * O.dx, cc: cc * O.dx, nx: nx * O.dx }));
};
// two cells pushed into each other (external forces): contact handling
CASES.pair = async (krep = '10', F = '0.02', steps = '6000', kv = '1000') => {
  const U = new Units(), gl = mkGL(), nx = 48, n = 32;
  const sp = icosphere(3), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) };
  const X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: mesh.E });
  const L = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, maxCells: 2, tables: buildMeshTables(mesh, [X0]), krep: +krep * U.GsL, rcut: 1 });
  const Gs = U.GsL, par = f => ({ Gs, C: 100, kb: 2 * U.energy(2e-19) / Math.sqrt(3), kA: 100 * Gs, kV: +kv * Gs, A0: ref.A, V0: ref.V, push: 0, scale: 1, fext: f });
  const rot = X0.map(p => [p[2], p[1], -p[0]]); // discs face each other along x
  L.setCells([cellAt(rot, [nx / 2 - 3, n / 2, n / 2], par([+F, 0, 0])), cellAt(rot, [nx / 2 + 3, n / 2, n / 2], par([-F, 0, 0]))]);
  for (let k = 0; k < 12; k++) {
    L.step(+steps / 12);
    const cs = L.readCentres(), X = L.readCells();
    const gap = Math.min(...X[1].map(p => p[0])) - Math.max(...X[0].map(p => p[0]));
    console.log(`step ${L.t}: centres x ${cs.map(c => c.c[0].toFixed(2))}, vol ${cs.map(c => (c.V / ref.V).toFixed(3))}, x-gap (max0 vs min1) ${gap.toFixed(2)}`);
  }
};
// time the passes of one step for a tube suspension
CASES.prof = async (dxum = '0.25', level = '4', ncell = '51') => {
  const U = new Units({ dx: +dxum * 1e-6 }), gl = mkGL(), R = U.len(10e-6), nx = Math.round(U.len(50e-6)), n = Math.ceil(2 * R) + 2, cc = (n - 1) / 2;
  const sp = icosphere(+level), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) }, X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: mesh.E });
  const Gs = U.GsL, cells = [];
  for (let i = 0; i < +ncell; i++) cells.push(cellAt(X0.map(p => p.map(x => 0.5 * x)), [nx * (i + 0.5) / +ncell, cc + 0.4 * R * Math.cos(i), cc + 0.4 * R * Math.sin(i)], { Gs, C: 10, kb: 1e-3, kA: 0.2, kV: 2, A0: ref.A, V0: ref.V, push: 0.06, scale: 0.5 }));
  const L = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, maxCells: cells.length, tables: buildMeshTables(mesh, [X0]), krep: 0.02, rcut: 1, sdf: `return ${R} - length(p.yz - vec2(${cc}));` });
  L.setCells(cells); L.step(10); gl.finish();
  const sync = () => L.readTex(L.cs0, 1, 1); const time = (label, f, k = 50) => { sync(); const t = performance.now(); for (let i = 0; i < k; i++) f(); sync(); console.log(`${label}: ${((performance.now() - t) / k).toFixed(3)} ms`); };
  time('full step', () => L.step(1));
  const nc = L.nCells; L.nCells = 0; time('fluid only', () => L.step(1)); L.nCells = nc;
  const kr = L.o.krep; L.o.krep = 0; time('step without contact hash', () => L.step(1)); L.o.krep = kr;
  console.log(`${nx}x${n}x${n} = ${(nx * n * n / 1e6).toFixed(2)}M nodes, ${nc} cells x ${L.tb.nv} vertices`);
};

// viscosity-contrast indicator: exact start-up fill, then the band update while a cell squeezes through a capillary
CASES.indicator = async (lambda = '5', dxum = '0.5', level = '3') => {
  const U = new Units({ dx: +dxum * 1e-6 }), gl = mkGL(), R = U.len(3e-6), R1 = U.len(4.6e-6), n = Math.ceil(2 * R1) + 4, nx = Math.round(U.len(30e-6)), cc = (n - 1) / 2;
  const sp = icosphere(+level), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) }, X0 = biconcave(sp.V).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: mesh.E });
  const L = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, lambda: +lambda, maxCells: 1, tables: buildMeshTables(mesh, [X0]), SP: [R1, 0, 0, 0], cellRadius: U.len(9e-6),
    sdf: `return SP.x - length(p.yz - vec2(${cc.toFixed(4)}));` });
  const Gs = U.GsL;
  L.setCells([cellAt(X0.map(p => [p[2], p[1], -p[0]]), [nx / 3, cc, cc], { Gs, C: 10, kb: 2 * U.energy(2e-19) / Math.sqrt(3), kA: 100 * Gs, kV: 1000 * Gs, A0: ref.A, V0: ref.V, push: 30 * Gs, scale: 1 })]);
  L.computeIndicator();
  const rep = lab => { const cs = L.readCentres()[0]; console.log(`${lab}: indicator sum ${L.sumIndicator().toFixed(1)} vs cell volume ${cs.V.toFixed(1)} lu³ (${(L.sumIndicator() / cs.V).toFixed(3)})`); };
  rep('start');
  for (let k = 1; k <= 40; k++) { L.setSP([R1 + (R - R1) * k / 40, 0, 0, 0]); await run(L, Math.round(U.steps(4e-3) / 40)); }
  rep('after narrowing');
  L.o.body = [U.gradP(8 * U.eta * 1e-3 / (3e-6) ** 2), 0, 0];
  for (let k = 0; k < 4; k++) { const x0 = L.readCentres()[0].c[0]; await run(L, Math.round(U.steps(10e-3))); rep(`flow +${(k + 1) * 10} ms (cell moved ${((L.readCentres()[0].c[0] - x0 + nx) % nx * +dxum).toFixed(1)} µm)`); }
};
// one cell through a narrowing (the malaria scene's slit): kind = rbc | round, stiffness f (shear only)
CASES.slit = async (shape = 'rbc', f = '1', neck = '3.6', dxum = '0.25', level = '4', dp = '30', ms = '60', lambda = '5', GsL = '0.002') => {
  const U = new Units({ dx: +dxum * 1e-6, GsL: +GsL }), gl = mkGL(), D = 7, L = 36;
  const R = U.len(D * 1e-6) / 2, R1 = Math.max(R, U.len(4.6e-6)), n = Math.ceil(2 * R1) + 4, nx = Math.round(U.len(L * 1e-6)), cc = (n - 1) / 2;
  const Rc = U.len(+neck * 1e-6) / 2, w = U.len(2.5e-6);
  const sp = icosphere(+level), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) };
  const Xum = shape === 'round' ? SHAPES.spheroid(sp.V, 3.3, 2.06) : biconcave(sp.V);
  const X0 = Xum.map(p => [p[2], p[1], -p[0]]).map(p => p.map(x => U.len(x * 1e-6))), ref = makeRef({ X: X0, F: sp.F, E: mesh.E });
  const sdf = `float s = SP.x, rx = ${R.toFixed(4)}; float q = (p.x - ${(nx / 2).toFixed(2)}) / ${w.toFixed(3)};
      if (abs(q) < 1.) rx -= ${(R - Rc).toFixed(4)} * 0.5 * (1. + cos(3.14159265 * q));
      return mix(${R1.toFixed(4)}, rx, s) - length(p.yz - vec2(${cc.toFixed(4)}));`;
  const L2 = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, lambda: +lambda, cellRadius: U.len(9e-6), maxCells: 1, tables: buildMeshTables(mesh, [X0]), SP: [0, 0, 0, 0], krep: 10 * U.GsL, rcut: 1, sdf });
  const Gs = U.GsL * +f, C = Math.max(0.5, (21 / +f - 1) / 2);
  L2.setCells([cellAt(X0, [window.NOCELL ? -1000 : nx / 5, cc, cc], { Gs, C, kb: 2 * U.energy(2e-19) / Math.sqrt(3), kA: 100 * U.GsL, kV: 1000 * U.GsL, A0: ref.A, V0: ref.V, push: 30 * U.GsL, scale: 1 })]);
  L2.computeIndicator();
  window.WATCH = { cc, R, fmax: 1e3, V0: ref.V, dx: +dxum, F: sp.F, dump: 0 };
  for (let s = 1; s <= 40; s++) { L2.setSP([s / 40, 0, 0, 0]); await run(L2, Math.round(U.steps(4e-3) / 40)); }
  L2.o.body = [U.gradP(+dp * 133.322 * 1e3), 0, 0];
  let x0 = L2.readCentres()[0].c[0], tot = 0;
  for (let k = 0; k < +ms / 2; k++) {
    await run(L2, Math.round(U.steps(2e-3)));
    const c = L2.readCentres()[0]; let d = c.c[0] - x0; d -= nx * Math.round(d / nx); tot += d; x0 = c.c[0];
    if (k % 3 === 2) console.log(`t ${(k + 1) * 2} ms: mean flow ${(L2.sumMacro()[0] / nx / (Math.PI * R * R) * U.V * 1e3).toFixed(3)} mm/s; x ${(((c.c[0] % nx) + nx) % nx * +dxum).toFixed(1)} µm (neck at ${(nx / 2 * +dxum).toFixed(1)}), speed ${(d / U.steps(2e-3) * U.V * 1e3).toFixed(3)} mm/s, travelled ${(tot * +dxum).toFixed(1)} µm, vol ${(c.V / ref.V).toFixed(3)}`);
  }
};

// the malaria scene headless: train of cells (healthy, ring, trophozoite, schizont) through a slit, NaN watchdog with diagnostics
CASES.train = async (neck = '3.6', dp = '12', ms = '400', GsL = '0.001', krep = '10', lambda = '5', mob = '0.1') => {
  const U = new Units({ dx: 0.25e-6, GsL: +GsL }), gl = mkGL(), D = 7, Lum = 72;
  const R = U.len(D * 1e-6) / 2, R1 = Math.max(R, U.len(4.6e-6)), n = Math.ceil(2 * R1) + 4, nx = Math.round(U.len(Lum * 1e-6)), cc = (n - 1) / 2;
  const Rc = U.len(+neck * 1e-6) / 2, w = U.len(2.5e-6);
  const sp = icosphere(4), mesh = { F: sp.F, ...topology(sp.F, sp.V.length) };
  const shapes = [biconcave(sp.V), SHAPES.spheroid(sp.V, 3.3, 2.06)].map(X => X.map(p => [p[2], p[1], -p[0]]).map(p => p.map(x => U.len(x * 1e-6))));
  const refs = shapes.map(X0 => makeRef({ X: X0, F: sp.F, E: mesh.E }));
  const sdf = `float s = SP.x, rx = ${R.toFixed(4)}; float q = (p.x - ${(nx / 2).toFixed(2)}) / ${w.toFixed(3)};
      if (abs(q) < 1.) rx -= ${(R - Rc).toFixed(4)} * 0.5 * (1. + cos(3.14159265 * q));
      return mix(${R1.toFixed(4)}, rx, s) - length(p.yz - vec2(${cc.toFixed(4)}));`;
  const L2 = new BloodGPU(gl, { nx, ny: n, nz: n, tau: 1, lambda: +lambda, mob: +mob, cellRadius: U.len(9e-6), maxCells: 4, tables: buildMeshTables(mesh, shapes), SP: [0, 0, 0, 0], krep: +krep * U.GsL, rcut: 1, sdf });
  const kinds = [[0, 1], [0, 2.3], [0, 4.6], [0, 9.5]];
  L2.setCells(kinds.map(([ty, f], i) => Object.assign(cellAt(shapes[ty], [nx * (i + 0.5) / 4, cc, cc], { Gs: U.GsL * f, C: Math.max(0.5, (21 / f - 1) / 2), kb: 2 * U.energy(2e-19) / Math.sqrt(3), kA: 100 * U.GsL, kV: 1000 * U.GsL, A0: refs[ty].A, V0: refs[ty].V, push: 30 * U.GsL, scale: 1 }), { type: ty })));
  L2.computeIndicator();
  for (let s = 1; s <= 40; s++) { L2.setSP([s / 40, 0, 0, 0]); await run(L2, Math.round(U.steps(4e-3) / 40)); }
  L2.o.body = [U.gradP(+dp * 133.322 * 1e3), 0, 0];
  window.WATCH = { cc, R, fmax: 1, V0: refs[0].V, dx: 0.25, F: sp.F, keep: 1 };
  let last = null;
  for (let k = 0; k < +ms / 2; k++) {
    try { await run(L2, Math.round(U.steps(2e-3))); } catch (e) { console.log('error', e.message); break; }
    const cs = L2.readCentres(), um = L2.sumMacro()[0] / nx / (Math.PI * R * R) * U.V * 1e3;
    if (!isFinite(um)) { console.log(`NaN between ${(k * 2)} and ${(k + 1) * 2} ms`); break; }
    // diagnostics on the last finite state: max vertex force, min wall gap, min distance between cells
    const nv = L2.tb.nv, vf = L2.readTex(L2.vf, nv, 4); let bm = 0; const pc = [0, 0, 0, 0]; for (let i = 0; i < vf.length; i += 4) { const m = Math.hypot(vf[i], vf[i + 1], vf[i + 2]); bm = Math.max(bm, m); const ci = Math.floor(i / 4 / nv); pc[ci] = Math.max(pc[ci], m); }
    if (k % 5 === 0 || k > (window.UK || 1e9)) { const m = L2.readTex(L2.mac[L2.cur], L2.W, L2.H); let um2 = 0, rmin = 9, rmax = 0; for (let i = 0; i < m.length; i += 4) { um2 = Math.max(um2, Math.hypot(m[i], m[i + 1], m[i + 2])); if (m[i + 3] > 0) { rmin = Math.min(rmin, m[i + 3]); rmax = Math.max(rmax, m[i + 3]); } }
      console.log('  vol', cs.map(c2 => (c2.V / refs[0].V).toFixed(3)).join(' '), ' per-cell max |F|', pc.map(x => x.toExponential(1)).join(' '), ' max |u| (lattice)', um2.toFixed(4), ' rho', rmin.toFixed(4), rmax.toFixed(4)); }
    if (k % 10 === 9 || bm > 0.02) {
      const X = L2.readCells(); let gap = 1e9, cmin = 1e9;
      X.forEach((Xc, i) => { for (const p of Xc) { const rr = Math.hypot(p[1] - cc, p[2] - cc); const xx = ((p[0] % nx) + nx) % nx, qq = (xx - nx / 2) / w; const rw = Math.abs(qq) < 1 ? R - (R - Rc) * 0.5 * (1 + Math.cos(Math.PI * qq)) : R; gap = Math.min(gap, rw - rr); } });
      if (k === +ms / 2 - 1) { const X = L2.readCells(); X.forEach((Xc, i) => console.log('DUMP' + i + ' ' + JSON.stringify({ X: Xc.map(q => q.map(x => +(x * 0.25).toFixed(3))), F: sp.F }))); }
      console.log(`t ${(k + 1) * 2} ms: mean ${um.toFixed(2)} mm/s, max |F| ${bm.toExponential(2)} (healthy-scale ${U.GsL.toExponential(1)}), min wall gap ${gap.toFixed(2)} lu, x ${cs.map(c => (((c.c[0] % nx) + nx) % nx * 0.25).toFixed(1)).join(',')}`);
    }
  }
};

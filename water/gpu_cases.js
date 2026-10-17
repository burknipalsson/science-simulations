// Browser-side GPU test cases (run with node gpu_run.js <case> [args]).
const gl = document.getElementById('c').getContext('webgl2');
let seed = 12345; const rng = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const log = (...a) => console.log(a.map(x => typeof x === 'object' ? JSON.stringify(x) : x).join(' '));
const fmt = (o, d = 4) => JSON.stringify(o, (k, v) => typeof v === 'number' ? +v.toFixed(d) : v);

// forces in original id order from the GPU force textures
function gpuForces(e, k = 0) {
  const raw = e._read(e.Ft[k], e.W, e.H), pos = e._read(e.state[0], e.W, e.H), out = new Float64Array(4 * e.N);
  for (let s = 0; s < e.N; s++) { const i = pos[4*s+3]; for (let d = 0; d < 4; d++) out[4*i+d] = raw[4*s+d]; }
  return out;
}
function relErr(a, b, n, stride, comps) {
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) for (let d = 0; d < comps; d++) { num += (a[stride*i+d] - b[3*i+d]) ** 2; den += b[3*i+d] ** 2; }
  return Math.sqrt(num / den);
}
const now = () => performance.now();
function finish() { const b = new Float32Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, b); }

const CASES = {
  parity_t4() {
    const s = liquidBox(512, 0.997, 300, rng, { rc: 9, alpha: 0.2 });
    for (let i = 0; i < 200; i++) { s.step(0.0005); s.thermostat(300, 0.01, 0.0005); }
    s.wrap(); s.forces();
    const e = new GW.Engine(gl, 'tip4p', s.N, s.box, { rc: 9, alpha: 0.2 });
    e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
    const F = gpuForces(e, 0), T = gpuForces(e, 1), Wv = gpuForces(e, 2);
    let E = 0, W = [0, 0, 0]; for (let i = 0; i < s.N; i++) { E += F[4*i+3]; for (let d = 0; d < 3; d++) W[d] += Wv[4*i+d]; }
    log('cells', e.nc, 'R', e.R);
    log('force rel err', relErr(F, s.f, s.N, 4, 3).toExponential(2), 'torque rel err', relErr(T, s.tq, s.N, 4, 3).toExponential(2));
    log('epot gpu', E.toFixed(3), 'cpu', s.epot.toFixed(3), ' virial gpu', W.map(x => x.toFixed(2)), 'cpu', s.vir.map(x => x.toFixed(2)));
    const m = e.measure(), mc = s.measure();
    log('measure gpu', fmt({ T: m.T, P: m.P, U: m.U, rho: m.rho }), 'cpu', fmt({ T: mc.T, P: mc.P, U: mc.epot / s.N, rho: mc.rho }));
    // trajectory parity over 200 steps (float32 vs float64 chaos grows; check short-term)
    for (let k = 0; k < 50; k++) { s.step(0.002); e.step(); }
    s.forces();
    const m2 = e.measure(), mc2 = s.measure();
    log('after 50 steps gpu', fmt({ T: m2.T, U: m2.U, P: m2.P }), 'cpu', fmt({ T: mc2.T, U: mc2.epot / s.N, P: mc2.P }));
  },

  nve_t4(N = 4096, steps = 5000) {
    N = +N; steps = +steps;
    const s = liquidBox(N, 0.997, 300, rng, { rc: 9, alpha: 0.2 });
    const e = new GW.Engine(gl, 'tip4p', s.N, s.box, { dt: 0.0005 });
    e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
    // equilibrate gently: small steps first
    for (let k = 0; k < 400; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), { T: 300, tauT: 0.01, every: 8 }); }
    e.dt = 0.002;
    for (let k = 0; k < 2000; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), { T: 300, tauT: 0.1, every: 8 }); }
    const E = () => { const m = e.measure(); return (m.U * e.N + m.kt + m.kr) / e.N; };
    const out = [E().toFixed(4)];
    finish(); let t0 = now();
    for (let k = 1; k <= steps; k++) { e.step(); if (k % (steps / 5) === 0) out.push(E().toFixed(4)); }
    finish(); const ms = (now() - t0) / steps;
    log(`NVE N=${N} dt=2fs E per molecule:`, out.join(' '), ` T=${e.measure().T.toFixed(1)}  ${ms.toFixed(3)} ms/step  ${(e.dt * 1000 / ms * 3.6).toFixed(2)} ns/hour... ${(e.dt / ms * 1e3 * 1e-3).toFixed(3)} ns/s`);
  },

  parity_mw() {
    const ice = iceIhLattice(6, 4, 4, 4.52, rng);
    const s = new MWater(ice.n, ice.box); s.x.set(ice.O);
    for (let i = 0; i < s.x.length; i++) s.x[i] += 0.3 * (rng() - 0.5);
    for (let k = 0; k < 20; k++) s.solute[Math.floor(rng() * s.N)] = 1;
    s.thermalize(250, rng); s.forces();
    const e = new GW.Engine(gl, 'mw', s.N, s.box);
    const flag = new Float32Array(s.N); for (let i = 0; i < s.N; i++) flag[i] = s.solute[i] ? 2 : 0;
    e.upload({ x: s.x, v: s.v, flag });
    const F = gpuForces(e, 0); let E = 0; for (let i = 0; i < s.N; i++) E += F[4*i+3];
    log('mW N', s.N, 'cells', e.nc, 'R', e.R, 'force rel err', relErr(F, s.f, s.N, 4, 3).toExponential(2), 'E gpu', E.toFixed(3), 'cpu', s.epot.toFixed(3));
    const m = e.measure(), mc = s.measure();
    log('gpu', fmt({ T: m.T, P: m.P, U: m.U }), 'cpu', fmt({ T: mc.T, P: mc.P, U: mc.epot / s.N }));
  },

  nve_mw(N = 65536, steps = 2000) {
    // ice lattice melted at high T, then NVE
    N = +N; steps = +steps;
    const nx = Math.round(Math.cbrt(N / 8 / 1.732 / 1.633) * 1.0);
    const ice = iceIhLattice(nx * 2, nx, Math.round(nx * 2 * 1.0 / 1.633 / 1.0), 4.52, rng);
    const e = new GW.Engine(gl, 'mw', ice.n, ice.box);
    const v = new Float64Array(3 * ice.n);
    e.upload({ x: ice.O, v });
    for (let k = 0; k < 1000; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T: 350, tauT: 0.2, every: 4 }); }
    const E = () => { const m = e.measure(); return m.U + m.kt / e.N; };
    const out = [E().toFixed(4)];
    finish(); const t0 = now();
    for (let k = 1; k <= steps; k++) { e.step(); if (k % (steps / 5) === 0) out.push(E().toFixed(4)); }
    finish(); const ms = (now() - t0) / steps;
    log(`mW NVE N=${e.N} cells ${e.nc} R ${e.R}: E`, out.join(' '), `T=${e.measure().T.toFixed(1)} ${ms.toFixed(3)} ms/step = ${(e.dt / ms).toFixed(3)} ns/s`);
  },
};
CASES.profile = (model = 'tip4p', N = 16384) => {
  N = +N;
  let e;
  if (model === 'tip4p') {
    const s = liquidBox(N, 0.997, 300, rng, { rc: 9, alpha: 0.2 });
    e = new GW.Engine(gl, 'tip4p', s.N, s.box, { dt: 0.0005 }); e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
  } else {
    const ice = iceIhLattice(20, 12, 20, 4.52, rng); e = new GW.Engine(gl, 'mw', ice.n, ice.box); e.upload({ x: ice.O, v: new Float64Array(3 * ice.n) });
  }
  const tm = (name, f, n) => { finish(); const t = now(); for (let k = 0; k < n; k++) f(); finish(); log(name.padEnd(10), ((now() - t) / n).toFixed(4), 'ms'); };
  tm('force', () => e.computeForces(), 200);
  tm('kd', () => e._kd(0), 500);
  tm('rebuild', () => e.rebuild(), 50);
  tm('step', () => e.step(), 400);
  tm('noop', () => e._run(e.P.red2, e.R2fbo, { uA: e.R1[0], uB: e.R1[1], uRows: 1 }), 1000);
  log('N', e.N, 'Np', e.Np, 'cells', e.nc, e.R);
};
CASES.profile2 = async (model = 'tip4p', N = 16384) => {
  N = +N;
  let e;
  if (model === 'tip4p') {
    const s = liquidBox(N, 0.997, 300, rng, { rc: 9, alpha: 0.2 });
    e = new GW.Engine(gl, 'tip4p', s.N, s.box, { dt: 0.0005 }); e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
  } else {
    const ice = iceIhLattice(20, 12, 20, 4.52, rng); e = new GW.Engine(gl, 'mw', ice.n, ice.box); e.upload({ x: ice.O, v: new Float64Array(3 * ice.n) });
  }
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  log('timer ext', !!ext);
  const gpuTime = async (f, n) => {
    const q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); for (let k = 0; k < n; k++) f(); gl.endQuery(ext.TIME_ELAPSED_EXT);
    const t0 = now();
    for (;;) { await new Promise(r => setTimeout(r, 5)); if (gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break; }
    const wall = now() - t0;
    return gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6 / n;
  };
  for (const [name, f, n] of [['force', () => e.computeForces(), 200], ['kd', () => e._kd(0), 500], ['rebuild', () => e.rebuild(), 50], ['step', () => e.step(), 400]]) {
    const g = await gpuTime(f, n);
    finish(); const t = now(); for (let k = 0; k < n; k++) f(); finish(); const w = (now() - t) / n;
    log(name.padEnd(8), 'gpu', g.toFixed(4), 'ms  wall', w.toFixed(4), 'ms');
  }
};
CASES.bench = (model = 'tip4p', N = 16384, every = 8) => {
  N = +N;
  let e;
  if (model === 'tip4p') {
    const s = liquidBox(N, 0.997, 300, rng, { rc: 9, alpha: 0.2 });
    e = new GW.Engine(gl, 'tip4p', s.N, s.box, { dt: 0.0005, rebuildEvery: +every }); e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
  } else {
    const ice = iceIhLattice(20, 12, 20, 4.52, rng); e = new GW.Engine(gl, 'mw', ice.n, ice.box, { rebuildEvery: +every }); e.upload({ x: ice.O, v: new Float64Array(3 * ice.n) });
  }
  const run = (name, f, ms) => { finish(); let n = 0; const t = now(); while (now() - t < ms) { for (let k = 0; k < 20; k++) f(); finish(); n += 20; } log(name.padEnd(8), ((now() - t) / n).toFixed(4), 'ms'); };
  run('warm', () => e.step(), 3000);
  run('step', () => e.step(), 3000);
  run('force', () => e.computeForces(), 2000);
  run('rebuild', () => e.rebuild(), 2000);
  run('kd', () => e._kd(0), 1000);
  run('step', () => e.step(), 3000);
  const m = e.measure(); log('T', m.T.toFixed(1), 'cells', e.nc, e.R);
};
CASES.bench2 = (N = 16384) => {
  N = +N;
  const s = liquidBox(N, 0.997, 300, rng, { rc: 9, alpha: 0.2 });
  const e = new GW.Engine(gl, 'tip4p', s.N, s.box, { dt: 0.0005, rebuildEvery: 8 }); e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
  const run = (name, f, ms) => { finish(); let n = 0; const t = now(); while (now() - t < ms) { for (let k = 0; k < 20; k++) f(); finish(); n += 20; } log(name.padEnd(8), ((now() - t) / n).toFixed(4), 'ms'); };
  run('step', () => e.step(), 3000);
  run('force', () => e.computeForces(), 2000);
  e.dt = 0;   // no motion: step cost without dynamics changes
  run('step dt0', () => e.step(), 2000);
  e.rebuildEvery = 1e9;
  run('noreb', () => e.step(), 2000);
  run('force', () => e.computeForces(), 2000);
  run('kd1', () => e._kd(1), 2000);
  run('kd0', () => e._kd(0), 2000);
};
CASES.bench3 = (N = 16384) => {
  N = +N;
  const s = liquidBox(N, 0.997, 300, rng, { rc: 9, alpha: 0.2 });
  const e = new GW.Engine(gl, 'tip4p', s.N, s.box, { dt: 0, rebuildEvery: 1e9 }); e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
  const run = (name, f, ms) => { finish(); let n = 0; const t = now(); while (now() - t < ms) { for (let k = 0; k < 20; k++) f(); finish(); n += 20; } log(name.padEnd(12), ((now() - t) / n).toFixed(4), 'ms'); };
  run('force', () => e.computeForces(), 2000);
  run('force+kd0', () => { e.computeForces(); e._kd(0); }, 2000);
  run('kd1+force', () => { e._kd(1); e.computeForces(); }, 2000);
  run('kd0 x2+force', () => { e._kd(0); e._kd(0); e.computeForces(); }, 2000);
  run('force', () => e.computeForces(), 2000);
};
CASES.scale = () => {
  const run = (f, ms) => { finish(); let n = 0; const t = now(); while (now() - t < ms) { for (let k = 0; k < 20; k++) f(); finish(); n += 20; } return (now() - t) / n; };
  for (const N of [2048, 4096, 8192, 16384, 32768]) {
    const s = liquidBox(N, 0.997, 300, rng, { rc: 9, alpha: 0.2 });
    const e = new GW.Engine(gl, 'tip4p', s.N, s.box, { dt: 0.0005 }); e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
    run(() => e.step(), 1500); const ms = run(() => e.step(), 2000), mf = run(() => e.computeForces(), 1000);
    log('tip4p N', N, 'step', ms.toFixed(3), 'force', mf.toFixed(3), 'ms  ->', (2 / ms).toFixed(2), 'ps/s at 2 fs');
  }
  for (const n of [[10, 6, 10], [14, 8, 14], [20, 12, 20], [28, 16, 28]]) {
    const ice = iceIhLattice(...n, 4.52, rng); const e = new GW.Engine(gl, 'mw', ice.n, ice.box); e.upload({ x: ice.O, v: new Float64Array(3 * ice.n) });
    run(() => e.step(), 1500); const ms = run(() => e.step(), 2000), mf = run(() => e.computeForces(), 1000);
    log('mW N', ice.n, 'step', ms.toFixed(3), 'force', mf.toFixed(3), 'ms  ->', (10 / ms).toFixed(1), 'ps/s at 10 fs');
  }
};
// mW: ice slab + liquid; measure growth at temperature T (K). Ice fraction from potential energy.
CASES.mw_grow = (T = 240, nx = 8, ny = 5, nz = 12, ns = 2000) => {
  T = +T; ns = +ns;
  const ice = iceIhLattice(+nx, +ny, +nz, 4.52, rng);   // c axis along z: basal face exposed
  const Lz = ice.box[2], flag = new Float32Array(ice.n);
  for (let i = 0; i < ice.n; i++) flag[i] = ice.O[3*i+2] < Lz / 2 ? 1 : 0;   // pin bottom half
  const e = new GW.Engine(gl, 'mw', ice.n, ice.box);
  e.upload({ x: ice.O, v: new Float64Array(3 * ice.n), flag });
  for (let k = 0; k < 4000; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T: 450, tauT: 0.1, every: 4 }); }  // melt top half
  for (let k = 0; k < 3000; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T, tauT: 0.1, every: 4 }); }
  // release pins
  const st = e.download(); st.flag.fill(0); e.upload(st);
  const out = [];
  for (let k = 0; k <= ns * 100; k++) {
    if (k > 0) e.step();
    if (k % 4 === 0 && k) { const m = e.measure(); e.couple(m, { T, tauT: 0.5, P: 1, tauP: 5, mode: 'z', every: 4 }); }
    if (k % 1000 === 0) { const m = e.measure(); out.push([(k * e.dt).toFixed(0), m.U.toFixed(3), m.T.toFixed(1), m.rho.toFixed(4)]); }
    if (k % 10000 === 0 && k) log('t', (k * e.dt / 1000).toFixed(1), 'ns  U', out[out.length - 1][1], 'rho', out[out.length - 1][3], 'Lz', e.box[2].toFixed(2));
  }
};
// mW bulk NPT: phase 'ice' or 'liq'; returns mean density, U, lattice a for ice
CASES.mw_npt = (phase = 'liq', Ts = '298', ps = 200) => {
  ps = +ps;
  const res = [];
  for (const T of Ts.split(',').map(Number)) {
    const ice = iceIhLattice(8, 5, 6, 4.43, rng);
    const e = new GW.Engine(gl, 'mw', ice.n, ice.box);
    e.upload({ x: ice.O, v: new Float64Array(3 * ice.n) });
    if (phase === 'liq') for (let k = 0; k < 3000; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T: 450, tauT: 0.1, every: 4 }); }
    const nst = Math.round(ps / e.dt), eq = nst / 4; let n = 0, rho = 0, U = 0, Lx = 0, rho2 = 0;
    for (let k = 0; k < nst; k++) {
      e.step();
      if (k % 4 === 3) { const m = e.measure(); e.couple(m, { T, tauT: 0.5, P: 1, tauP: 2, every: 4, compress: phase === 'ice' ? 1.5e-5 : 4.5e-5 });
        if (k > eq) { rho += m.rho; rho2 += m.rho * m.rho; U += m.U; Lx += e.box[0] / 8; n++; } }
    }
    rho /= n; const sd = Math.sqrt(rho2 / n - rho * rho);
    res.push({ T, rho: +rho.toFixed(4), sd: +sd.toFixed(4), U: +(U / n).toFixed(3), a: +(Lx / n).toFixed(4) });
    log(phase, JSON.stringify(res[res.length - 1]));
  }
};
// mW direct coexistence: half ice (basal face), half liquid; track U drift at each T
CASES.mw_coex = (Ts = '270,275,280', ns = 5, a = 4.42) => {
  for (const T of Ts.split(',').map(Number)) {
    const ice = iceIhLattice(8, 5, 14, +a, rng);
    const Lz = ice.box[2], flag = new Float32Array(ice.n);
    for (let i = 0; i < ice.n; i++) flag[i] = ice.O[3*i+2] < Lz / 2 ? 1 : 0;
    const e = new GW.Engine(gl, 'mw', ice.n, ice.box);
    e.upload({ x: ice.O, v: new Float64Array(3 * ice.n), flag });
    for (let k = 0; k < 3000; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T: 400, tauT: 0.1, every: 4 }); }
    for (let k = 0; k < 2000; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T, tauT: 0.1, P: 1, tauP: 2, mode: 'z', every: 4 }); }
    const st = e.download(); st.flag.fill(0); e.upload(st);
    const nst = Math.round(+ns * 1000 / e.dt), Us = [];
    let acc = 0, na = 0;
    for (let k = 1; k <= nst; k++) {
      e.step();
      if (k % 4 === 0) { const m = e.measure(); e.couple(m, { T, tauT: 0.5, P: 1, tauP: 5, mode: 'z', every: 4 }); acc += m.U; na++; }
      if (k % (nst / 10) === 0) { Us.push(+(acc / na).toFixed(3)); acc = na = 0; }
    }
    e.analyze(); const st2 = e.analysisStats();
    log('T', T, 'U per ns/2:', Us.join(' '), ' final ice frac', ((st2.hex + st2.cubic + st2.interf) / e.N).toFixed(3));
  }
};
// ---------------- TIP4P/2005 validation ----------------
function t4Equil(e, T, n = 400) {
  const dt = e.dt; e.dt = 0.0005;
  for (let k = 0; k < n; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), { T, tauT: 0.01, every: 8 }); }
  e.dt = dt;
}
CASES.t4_npt = (phase = 'liq', Ts = '298', ps = 500, N = 2048, rc = 9, alpha = 0.2) => {
  for (const T of Ts.split(',').map(Number)) {
    let s;
    if (phase === 'liq') s = liquidBox(+N, 0.997, T, rng, { rc: +rc, alpha: +alpha });
    else s = iceBox(6, 4, 4, 4.51, T, rng);
    const e = new GW.Engine(gl, 'tip4p', s.N, s.box, { rc: +rc, alpha: +alpha });
    e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
    t4Equil(e, T);
    const nst = Math.round(+ps / e.dt), eq = Math.round(Math.min(100, ps / 5) / e.dt);
    let n = 0, rho = 0, rho2 = 0, U = 0, a = 0, P = 0, Tm = 0, hb = 0, nh = 0;
    for (let k = 0; k < nst + eq; k++) {
      e.step();
      if (k % 8 === 7) { const m = e.measure(); e.couple(m, { T, tauT: 0.5, P: 1, tauP: 2, every: 8, compress: phase === 'ice' ? 1.5e-5 : 4.5e-5 });
        if (k > eq) { rho += m.rho; rho2 += m.rho ** 2; U += m.U; a += e.box[0] / 6; P += m.P; Tm += m.T; n++; } }
      if (k > eq && k % 2000 === 0) { e.analyze(); hb += e.analysisStats().hbPerMol; nh++; }
    }
    rho /= n;
    // block-averaged error (10 blocks would need storage; use sd/sqrt(n_eff) with n_eff ~ ps/2)
    const sd = Math.sqrt(rho2 / n - rho * rho);
    log(phase, JSON.stringify({ T, N: e.N, rc: +rc, alpha: +alpha, ps: +ps, rho: +rho.toFixed(4), sd: +sd.toFixed(4), err: +(sd / Math.sqrt(ps / 2)).toFixed(4), U: +(U / n).toFixed(3), P: +(P / n).toFixed(0), T_: +(Tm / n).toFixed(1), a: +(a / n).toFixed(4), hb: +(hb / nh).toFixed(3) }));
  }
};
// self-diffusion (COM MSD, NVT with weak CSVR) and g_OO(r)
CASES.t4_dyn = (T = 298, N = 4096, ps = 200) => {
  T = +T;
  const s = liquidBox(+N, 0.997, T, rng);
  const e = new GW.Engine(gl, 'tip4p', s.N, s.box);
  e.upload({ x: s.com, v: s.v, q: s.q, p: s.p });
  t4Equil(e, T);
  for (let k = 0; k < 50000; k++) { e.step(); if (k % 8 === 7) { const m = e.measure(); e.couple(m, { T, tauT: 0.5, P: 1, tauP: 2, every: 8 }); } }   // 100 ps NPT
  // NVT production, unwrap COM via per-sample minimum-image increments
  const L = e.box, N0 = e.N;
  let prev = e.download().x, unw = Float64Array.from(prev);
  const origins = [], msd = new Float64Array(201), cnt = new Float64Array(201);
  const hist = new Float64Array(400), dr = 0.025; let ng = 0;
  const samp = 50;   // every 0.1 ps
  const nsamp = Math.round(+ps / (samp * e.dt));
  const traj = [];
  for (let s2 = 0; s2 <= nsamp; s2++) {
    if (s2) for (let k = 0; k < samp; k++) { e.step(); if ((e.stepCount & 7) === 0) e.couple(e.measure(), { T, tauT: 2.0, every: 8 }); }
    const x = e.download().x;
    if (s2) for (let i = 0; i < 3 * N0; i++) { let d = x[i] - prev[i]; const b = L[i % 3]; d -= b * Math.round(d / b); unw[i] += d; }
    prev = x;
    traj.push(Float32Array.from(unw));
    if (s2 % 20 === 0) {   // g(r) on COM (≈ O; COM-O offset 0.066 Å)
      for (let i = 0; i < N0; i++) for (let j = i + 1; j < N0; j++) {
        let r2 = 0; for (let d = 0; d < 3; d++) { let dd = x[3*i+d] - x[3*j+d]; dd -= L[d] * Math.round(dd / L[d]); r2 += dd * dd; }
        if (r2 < 100) { const b = Math.floor(Math.sqrt(r2) / dr); if (b < 400) hist[b] += 2; }
      }
      ng++;
    }
  }
  // MSD with many time origins (lag up to 20 ps)
  const maxLag = Math.min(200, traj.length - 1);
  for (let t0 = 0; t0 < traj.length; t0 += 5) for (let lag = 1; lag <= maxLag && t0 + lag < traj.length; lag++) {
    const a = traj[t0], b = traj[t0 + lag]; let sm = 0;
    for (let i = 0; i < 3 * N0; i++) sm += (b[i] - a[i]) ** 2;
    msd[lag] += sm / N0; cnt[lag]++;
  }
  const tl = [], ml = [];
  for (let lag = 1; lag <= maxLag; lag++) { tl.push(lag * samp * e.dt); ml.push(msd[lag] / cnt[lag]); }
  // fit slope over 5..20 ps
  let sx = 0, sy = 0, sxx = 0, sxy = 0, nn = 0;
  for (let k = 0; k < tl.length; k++) if (tl[k] >= 5 && tl[k] <= 20) { sx += tl[k]; sy += ml[k]; sxx += tl[k] ** 2; sxy += tl[k] * ml[k]; nn++; }
  const slope = (nn * sxy - sx * sy) / (nn * sxx - sx * sx);
  const D = slope / 6;   // Å²/ps = 1e-8 m²/s
  // Yeh–Hummer finite-size correction: D∞ = D + 2.837297 kT / (6 π η L), η(TIP4P/2005, 298K) ≈ 0.855 mPa·s
  const kT = 1.380649e-23 * T, Lm = L[0] * 1e-10, eta = 0.855e-3;
  const corr = 2.837297 * kT / (6 * Math.PI * eta * Lm);
  const V = L[0] * L[1] * L[2], rho = N0 / V;
  const g = [];
  for (let b = 0; b < 400; b++) { const r = (b + 0.5) * dr, sh = 4 * Math.PI * r * r * dr; g.push(hist[b] / (ng * N0 * rho * sh)); }
  let pk = 0; for (let b = 80; b < 160; b++) if (g[b] > g[pk]) pk = b;
  let mn = pk; for (let b = pk; b < 200; b++) if (g[b] < g[mn]) mn = b;
  let pk2 = mn; for (let b = mn; b < 240; b++) if (g[b] > g[pk2]) pk2 = b;
  log(JSON.stringify({ T, N: N0, L: +L[0].toFixed(2), D_pbc: +(D * 1e-8 * 1e9).toFixed(3), D_inf: +((D * 1e-8 + corr) * 1e9).toFixed(3), unit: '1e-9 m2/s',
    g1: [+((pk + 0.5) * dr).toFixed(3), +g[pk].toFixed(3)], gmin: [+((mn + 0.5) * dr).toFixed(3), +g[mn].toFixed(3)], g2: [+((pk2 + 0.5) * dr).toFixed(3), +g[pk2].toFixed(3)] }));
  log('GR ' + JSON.stringify(g.filter((_, b) => b % 2 === 0).map(x => +x.toFixed(3))));
};
// direct coexistence: ice slab (basal plane exposed) + liquid, NPzT at each T; track potential energy
CASES.t4_coex = (Ts = '250', ns = 3, a = 4.51, nz = 8) => {
  for (const T of Ts.split(',').map(Number)) {
    const s = iceBox(6, 4, +nz, +a, T, rng);
    const Lz = s.box[2], flag = new Float32Array(s.N);
    for (let i = 0; i < s.N; i++) flag[i] = s.com[3*i+2] < Lz / 2 ? 1 : 0;
    const e = new GW.Engine(gl, 'tip4p', s.N, s.box);
    e.upload({ x: s.com, v: s.v, q: s.q, p: s.p, flag });
    t4Equil(e, 450, 400);
    for (let k = 0; k < 15000; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), { T: k < 10000 ? 450 : T, tauT: 0.1, every: 8, ...(k > 10000 ? { P: 1, tauP: 2, mode: 'z' } : {}) }); }
    const st = e.download(); st.flag.fill(0); e.upload(st);
    const nst = Math.round(+ns * 1000 / e.dt), Us = [], fr = [];
    let acc = 0, na = 0;
    for (let k = 1; k <= nst; k++) {
      e.step();
      if (k % 8 === 0) { const m = e.measure(); e.couple(m, { T, tauT: 0.5, P: 1, tauP: 5, mode: 'z', every: 8 }); acc += m.U; na++; }
      if (k % (nst / 10) === 0) { Us.push(+(acc / na).toFixed(3)); acc = na = 0; e.analyze(); const a2 = e.analysisStats(); fr.push(((a2.hex + a2.cubic + a2.interf) / e.N).toFixed(2)); }
    }
    log('T', T, 'N', e.N, 'U:', Us.join(' '), '| ice frac:', fr.join(' '));
  }
};
// generate pre-equilibrated starting states for the page: prints "STATE <name> <json-meta> <base64 float32>"
CASES.gen_states = (which = 'liquid,melt,freeze,float_ice,float_liq,body_pure,body_sol') => {
  const b64 = f32 => { const u = new Uint8Array(f32.buffer); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  const out = (name, e, extra = {}) => {
    const st = e.download(), n = e.N, tip = e.model === 'tip4p';
    const f = new Float32Array(n * (tip ? 7 : 4));
    for (let i = 0; i < n; i++) {
      if (tip) { for (let d = 0; d < 3; d++) f[7*i+d] = st.x[3*i+d]; for (let d = 0; d < 4; d++) f[7*i+3+d] = st.q[4*i+d]; }
      else { for (let d = 0; d < 3; d++) f[4*i+d] = st.x[3*i+d]; f[4*i+3] = st.flag[i]; }
    }
    console.log('STATE', name, JSON.stringify(Object.assign({ model: e.model, n, box: e.box.map(x => +x.toFixed(5)) }, extra)), b64(f));
  };
  const run = (e, T, ps, mode = 'iso', compress) => { const ev = e.rebuildEvery, n = Math.round(ps / e.dt);
    for (let k = 0; k < n; k++) { e.step(); if (k % ev === ev - 1) e.couple(e.measure(), { T, tauT: 0.2, P: 1, tauP: 2, mode, compress, every: ev }); } };
  const W = which.split(',');
  if (W.includes('liquid')) { const e = SCN.PREP.liquid(gl, 298, 4096); run(e, 298, 40); out('liquid', e); e.dispose(); }
  if (W.includes('melt')) { const e = SCN.PREP.melt(gl, 290); out('melt', e, { iceCount: e.iceCount }); e.dispose(); }
  if (W.includes('freeze')) { const e = SCN.PREP.freeze(gl, 230); out('freeze', e); e.dispose(); }
  if (W.includes('float_ice')) { const e = SCN.PREP.ice(gl, 250, Math.random, [6, 4, 4]); run(e, 250, 30, 'iso', 1.5e-5); out('float_ice', e); e.dispose(); }
  if (W.includes('float_liq')) { const e = SCN.PREP.liquid(gl, 250, 768); run(e, 250, 60); out('float_liq', e); e.dispose(); }
  if (W.includes('body_pure')) { const e = SCN.PREP.freeze(gl, 240, Math.random, 62, 13, 0); out('body_pure', e); e.dispose(); }
  if (W.includes('body_sol')) { const e = SCN.PREP.freeze(gl, 240, Math.random, 62, 13, 0.2); out('body_sol', e); e.dispose(); }
};
// solute check: does the toy solute stay dispersed in liquid mW?  compares solute-solute contacts with random mixing
CASES.solute_mix = (frac = 0.1, T = 240, ns = 1) => {
  frac = +frac; T = +T;
  const L = 50, nl = Math.round(L ** 3 * 0.997 / 1.66053907 / 18.015), m = Math.round(Math.cbrt(nl)), x = [], flag = [];
  for (let iz = 0; iz < m; iz++) for (let iy = 0; iy < m; iy++) for (let ix = 0; ix < m; ix++) { x.push((ix + .5) * L / m, (iy + .5) * L / m, (iz + .5) * L / m); flag.push(rng() < frac ? 2 : 0); }
  const n = flag.length, e = new GW.Engine(gl, 'mw', n, [L, L, L]);
  e.upload({ x: Float64Array.from(x), v: new Float64Array(3 * n), flag: Float32Array.from(flag) });
  const dt = e.dt; e.dt = 0.002; for (let k = 0; k < 400; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T: 300, tauT: 0.005, every: 4 }); } e.dt = dt;
  const nst = Math.round(+ns * 1000 / e.dt);
  const report = () => {
    const st = e.download(), B = e.box, S = []; for (let i = 0; i < n; i++) if (st.flag[i] > 1.5) S.push(i);
    let cont = 0, contW = 0;
    for (const i of S) for (let j = 0; j < n; j++) { if (j === i) continue; let r2 = 0; for (let d = 0; d < 3; d++) { let dd = st.x[3*i+d] - st.x[3*j+d]; dd -= B[d] * Math.round(dd / B[d]); r2 += dd * dd; }
      if (r2 < 3.3 * 3.3) { if (st.flag[j] > 1.5) cont++; else contW++; } }
    const nb = (cont + contW) / S.length, fs = S.length / n;
    return { solute: S.length, neighbours: +nb.toFixed(2), soluteNbFrac: +(cont / (cont + contW)).toFixed(3), randomExpect: +fs.toFixed(3) };
  };
  for (let k = 0; k < nst; k++) { e.step(); if (k % 4 === 3) e.couple(e.measure(), { T: k < 2000 ? 300 : T, tauT: 0.2, P: 1, tauP: 2, every: 4 });
    if (k === 2000 || k === nst - 1) { e.analyze(); log('t', (k * e.dt).toFixed(0), 'ps', JSON.stringify(report()), 'rho', e.measure().rho.toFixed(4), JSON.stringify(e.analysisStats())); } }
};
// skin safety: forces from stale cells (just before a rebuild) vs after a fresh rebuild; must agree exactly
CASES.skin = async (model = 'tip4p', T = 370, every = 0, skin = 0) => {
  T = +T;
  const opt = {}; if (+every) opt.rebuildEvery = +every; if (+skin) opt.skin = +skin;
  let e;
  if (model === 'tip4p') { const s = liquidBox(2048, 0.997, T, rng); e = new GW.Engine(gl, 'tip4p', s.N, s.box, opt); e.upload({ x: s.com, v: s.v, q: s.q, p: s.p }); t4Equil(e, T); }
  else { e = await SCN.fromState(gl, 'freeze', 230); if (!e) e = SCN.PREP.freeze(gl, 230, rng, 60, 12); if (+every) e.rebuildEvery = +every; if (+skin) { e.skin = +skin; e.rsearch = GW.MW.rc + e.skin; } }
  let worst = 0;
  for (let rep = 0; rep < 40; rep++) {
    for (let k = 0; k < 200; k++) { e.step(); if (k % 8 === 7) e.couple(e.measure(), { T, tauT: 0.2, every: 8 }); }
    // advance to just before the next rebuild
    while ((e.stepCount + 1) % e.rebuildEvery !== 0) e.step();
    e.computeForces(); const a = gpuForces(e, 0);
    e.rebuild(); e.computeForces(); const b = gpuForces(e, 0);
    let num = 0, den = 0, mx = 0;
    for (let i = 0; i < e.N; i++) for (let d = 0; d < 3; d++) { const df = a[4*i+d] - b[4*i+d]; num += df * df; den += b[4*i+d] ** 2; mx = Math.max(mx, Math.abs(df)); }
    worst = Math.max(worst, mx);
  }
  log(model, 'T', T, 'rebuildEvery', e.rebuildEvery, 'skin', e.skin, 'max |dF| over 40 checks', worst.toExponential(2));
};

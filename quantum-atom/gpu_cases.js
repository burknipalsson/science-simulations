// GPU validation cases, run in headless Chromium by gpu_run.js
const CASES = {
  info(){
    const gl = document.getElementById('c').getContext('webgl2');
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    console.log(gl.getParameter(d.UNMASKED_RENDERER_WEBGL), 'float blend:', !!gl.getExtension('EXT_float_blend'));
  },
  // GPU vs CPU reference: a packet hitting a double slit with absorbing edges, N = 256
  compare(){
    const gl = document.getElementById('c').getContext('webgl2');
    const N = 256, h = 0.25, E = TDSE(gl, N, h), g = makeGrid(N, N, h), L = N * h;
    const xw = 30, d = 8, w = 2;
    gaussian(g, xw - 14, L / 2, 4, 8, 2.5, 0.3);
    absorber(g, 8, 0.4, 'xy');
    const pot = new Float32Array(4 * N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
      const X = x * h, Y = y * h - L / 2, k = x + N * y;
      if (X >= xw && X < xw + 1 && !(Math.abs(Math.abs(Y) - d / 2) < w / 2)) g.V[k] = 25;
      pot[4 * k] = g.V[k]; pot[4 * k + 1] = g.W[k]; pot[4 * k + 2] = X > L - 8 ? 1 : 0;
    }
    E.setPotential(pot);
    const rg = new Float32Array(2 * N * N); for (let k = 0; k < N * N; k++){ rg[2 * k] = g.re[k]; rg[2 * k + 1] = g.im[k]; }
    E.setPsi(rg); E.screenX = [N - 32, N]; E.clearScreen();
    const dt = 0.01, n = 1500;
    let t0 = performance.now();
    E.step(dt, n); E.finish();
    console.log('gpu', (performance.now() - t0).toFixed(0), 'ms');
    t0 = performance.now();
    for (let i = 0; i < n; i++) step(g, dt);
    console.log('cpu', (performance.now() - t0).toFixed(0), 'ms');
    const p = E.readPsi(); let num = 0, den = 0, mx = 0;
    for (let k = 0; k < N * N; k++){ const dr = p[2 * k] - g.re[k], di = p[2 * k + 1] - g.im[k]; num += dr * dr + di * di; den += g.re[k] ** 2 + g.im[k] ** 2; }
    const m = E.moments();
    console.log(`relative L2 difference GPU vs CPU after ${n} steps: ${Math.sqrt(num / den).toExponential(2)}; norm gpu ${m.norm.toFixed(6)} cpu ${norm(g).toFixed(6)}`);
    const s = E.readScreen(); let tot = 0; for (const v of s) tot += v;
    console.log(`screen absorbed so far ${tot.toFixed(5)}`);
  },
  // speed at N = 512 and 1024; norm drift of a free packet in a periodic box over many steps
  speed(){
    const gl = document.getElementById('c').getContext('webgl2');
    for (const N of [512, 1024]){
      const E = TDSE(gl, N, 0.25);
      E.setPotential(new Float32Array(4 * N * N));
      E.gaussian(N * 0.125, N * 0.125, 6, 6, 1.5, 0.7);
      const m0 = E.moments();
      E.step(0.02, 20); E.finish();
      const t0 = performance.now(), n = 400;
      E.step(0.02, n); E.finish();
      const ms = (performance.now() - t0) / n;
      E.step(0.02, 20000); const m = E.moments();
      console.log(`N=${N}: ${ms.toFixed(3)} ms/step; norm ${m0.norm.toFixed(7)} → ${m.norm.toFixed(7)} after 20k steps`);
    }
  },
};
CASES.drift = function(){
  const gl = document.getElementById('c').getContext('webgl2');
  const N = 512, E = TDSE(gl, N, 0.25);
  E.setPotential(new Float32Array(4 * N * N));
  for (const [label, dt, kx] of [['dt=0 (pure FFT round trips)', 0, 1.5], ['dt=0.02 k=1.5', 0.02, 1.5], ['dt=0.02 k=0', 0.02, 0], ['dt=0.002 k=1.5', 0.002, 1.5]]){
    E.gaussian(N * 0.125, N * 0.125, 6, 6, kx, 0.7 * kx / 1.5);
    const m0 = E.moments().norm; const out = [];
    for (let r = 0; r < 4; r++){ E.step(dt, 5000); out.push(E.moments().norm); }
    console.log(label, m0.toFixed(7), out.map(v => v.toFixed(7)).join(' '));
  }
};
// the hero's double slit: arrival pattern on the screen, coherent and with a which-path measurement
CASES.slits = function(N = 1024, name = 'double', sy = 0, w = 4, sep = 20){
  N = +N;
  const gl = document.getElementById('c').getContext('webgl2');
  const S = Scenes.build(name, N, { sy: +sy || undefined, w: +w, d: +sep }), E = TDSE(gl, N, S.h);
  E.setPotential(S.pot); E.screenX = S.screenCols;
  const lam = 2 * Math.PI / S.k0;
  console.log(`${name} N=${N} h=${S.h.toFixed(3)} dt=${S.dt.toFixed(4)} λ=${lam.toFixed(3)} bohr = ${(lam * 0.0529177).toFixed(4)} nm; tEnd ${S.tEnd.toFixed(0)} a.u. = ${(S.tEnd * 0.0241888).toFixed(2)} fs, ${Math.round(S.tEnd / S.dt)} steps`);
  function run(measure){
    const P = S.packet; E.gaussian(P.x0, P.y0, P.sx, P.sy, P.kx, P.ky); E.clearScreen();
    let t = 0, pm = null;
    const t0 = performance.now();
    if (measure){
      const nm = Math.round(S.tMeasure / S.dt); E.step(S.dt, nm); t = nm * S.dt;
      E.setMask(Scenes.whichMask(S, measure)); const p = E.moments(true).masked, tot = E.moments().norm;
      pm = p; E.applyMask(1 / Math.sqrt(p));
      console.log(`  measured at t=${t.toFixed(0)}: P(${measure}) = ${p.toFixed(4)} of remaining ${tot.toFixed(4)}`);
    }
    const n = Math.round((S.tEnd - t) / S.dt);
    for (let i = 0; i < n; i += 200) E.step(S.dt, Math.min(200, n - i));
    E.finish();
    const ms = performance.now() - t0, scr = E.readScreen(), m = E.moments();
    let tot = 0; for (const v of scr) tot += v;
    console.log(`  ${(ms).toFixed(0)} ms; absorbed by screen ${tot.toFixed(4)}, left in box ${m.norm.toExponential(2)}`);
    return { scr, pm };
  }
  function analyse(scr, label){
    const y = i => (i + 0.5) * S.h, mx = Math.max(...scr), peaks = [];
    // smooth lightly, find maxima above 10% of the peak
    for (let i = 2; i < N - 2; i++) if (scr[i] > 0.1 * mx && scr[i] >= scr[i - 1] && scr[i] > scr[i + 1] && scr[i] >= scr[i - 2] && scr[i] > scr[i + 2]) peaks.push(y(i));
    const c = S.L / 2, near = peaks.filter(p => Math.abs(p - c) < 120);
    const sp = near.slice(1).map((p, i) => p - near[i]);
    // visibility in the central region: (max − min)/(max + min) between the central peak and its neighbours
    let lo = Infinity, hi = 0;
    for (let i = 0; i < N; i++) if (Math.abs(y(i) - c) < 40){ lo = Math.min(lo, scr[i]); hi = Math.max(hi, scr[i]); }
    console.log(`  ${label}: peaks ${near.map(p => (p - c).toFixed(1)).join(' ')}; mean spacing ${(sp.reduce((a, b) => a + b, 0) / sp.length).toFixed(1)} bohr; visibility ${((hi - lo) / (hi + lo)).toFixed(3)}`);
  }
  const a = run(null); analyse(a.scr, 'coherent');
  const Ld = S.L - Scenes.SCREEN_W + 6 - (S.XW + S.THICK);
  if (name === 'double') console.log(`  λL/d small-angle estimate with L≈${Ld.toFixed(0)}: ${(lam * Ld / S.opts.d).toFixed(1)} bohr; with sinθ_1 = λ/d exactly: ${(Ld * Math.tan(Math.asin(lam / S.opts.d))).toFixed(1)}`);
  if (name !== 'double') return;
  const u = run('up'), d = run('down');
  const mix = u.scr.map((v, i) => u.pm * v + d.pm * d.scr[i]);
  analyse(mix, 'which-path (weighted sum of both outcomes)');
};
CASES.dump = function(N = 1024, sy = 34, t = 0){
  N = +N;
  const gl = document.getElementById('c').getContext('webgl2');
  const S = Scenes.build('double', N), E = TDSE(gl, N, S.h);
  E.setPotential(S.pot); E.screenX = S.screenCols;
  const P = S.packet; E.gaussian(P.x0, P.y0, P.sx, +sy, P.kx, P.ky); E.clearScreen();
  const n = Math.round((+t || S.tEnd) / S.dt);
  for (let i = 0; i < n; i += 200) E.step(S.dt, Math.min(200, n - i));
  const scr = E.readScreen();
  console.log('SCR ' + JSON.stringify(Array.from(scr)));
  const p = E.readPsi(); const d = new Array(N * N / 16);
  for (let j = 0; j < N / 4; j++) for (let i = 0; i < N / 4; i++){ const k = (4 * i) + N * (4 * j); d[i + j * N / 4] = +(p[2 * k] ** 2 + p[2 * k + 1] ** 2).toExponential(2); }
  console.log('PSI ' + JSON.stringify(d));
};
CASES.orbitals = function(){
  const cv = document.getElementById('c'); cv.width = 64; cv.height = 64;
  const V = AtomView(cv), gl = V.gl, SIZE = 112;
  for (const [n, l, m] of [[1, 0, 0], [2, 1, 0], [2, 1, 1], [3, 2, -2], [4, 3, 1], [5, 2, 0], [6, 5, -3]]){
    const B = V.boxFor(n), t = V.field(n, l, m, B), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    let err = 0, mx = 0;
    for (const z of [20, 47, 56, 80]){
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, z);
      const px = new Float32Array(4 * SIZE * SIZE); gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.FLOAT, px);
      for (let j = 0; j < SIZE; j += 7) for (let i = 0; i < SIZE; i += 5){
        const p = [i, j, z].map(v => ((v + 0.5) / SIZE - 0.5) * 2 * B);
        const ref = H.psiReal(n, l, m, ...p), got = px[4 * (i + SIZE * j)];
        err = Math.max(err, Math.abs(got - ref)); mx = Math.max(mx, Math.abs(ref));
      }
    }
    console.log(`ψ ${n}${'spdfgh'[l]} m=${m}: max |GPU − JS| = ${(err / mx).toExponential(2)} of peak`);
  }
};

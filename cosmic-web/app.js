(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 700 || (navigator.hardwareConcurrency || 8) <= 4;
  const $ = id => document.getElementById(id);

  /* ================================================================
     Setup and units
     ================================================================ */
  // NP³ dark matter particles plus NP³ gas particles
  const QUAL = { q0: { NP: 64, NG: 128 }, q1: { NP: 100, NG: 128 }, q2: { NP: 128, NG: 256 }, q3: { NP: 160, NG: 256 } };
  const NSTEPS = 400, A_START = 1 / 51, S_START = Math.sqrt(A_START);
  // steps are evenly spaced in √a: early times pass quickly, the last few billion years get the most frames
  const aAt = n => { const s = S_START + (1 - S_START) * n / NSTEPS; return s * s; };
  const stepAtZ = z => Math.max(0, Math.min(NSTEPS, Math.round((Math.sqrt(1 / (1 + z)) - S_START) / (1 - S_START) * NSTEPS)));
  const P = Cosmo.P, L = P.boxMpc, MLY_PER_MPC = 3.26156;
  const M_TOTAL = P.Om * 2.775e11 * P.h * P.h * L ** 3;  // solar masses in the box
  const KMS = L * 100 * P.h;                              // box units × H0 → km/s
  const GROWTH = { 1: Cosmo.growthTable(1), 0: Cosmo.growthTable(P.Ob / P.Om) };

  const newSeed = () => ((Math.random() * 4294967295) >>> 0) || 1;
  const State = {
    q: small ? 'q0' : 'q2', seed: newSeed(), dm: true, playing: !reduceMotion, secs: 35,
    mode: 3, slice: true, physical: false, boost: true, box: true, spin: !reduceMotion,
    dmLayer: true, gasLayer: true, galLayer: true,
    overlay: null, marker: null,
  };

  /* ================================================================
     WebGL
     ================================================================ */
  const canvas = $('sky');
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
  let glOK = !!gl, eng = null;
  function nogl(msg){ const d = document.createElement('div'); d.className = 'nogl'; d.textContent = msg; $('stage').appendChild(d); }
  if (!gl) nogl('This simulation needs WebGL 2, which this browser or device has turned off.');
  else {
    try { eng = PMEngine(gl); }
    catch (e){ console.error(e); glOK = false; nogl('This simulation needs floating-point render targets (WebGL 2 with EXT_color_buffer_float), which this graphics card or browser does not offer.'); }
  }

  const DRAW_VS = `
  in vec3 aPos; in vec3 aMom; in vec4 aAux;
  uniform mat4 uView, uProj; uniform sampler2D uRho;
  uniform vec3 uCenter, uSliceN;
  uniform float uDrift, uWorld, uSize, uBright, uMfac, uContrast, uVel, uSlice, uSliceHalf, uMaxPt, uJitter, uStarPx;
  uniform int uMode, uLayer;   // layer 0 dark matter, 1 gas, 2 starlight
  out vec3 vCol;
  vec3 inferno(float t){
    const vec3 c0 = vec3(0.0002189, 0.0016510, -0.0194809), c1 = vec3(0.1065134, 0.5639564, 3.9327123), c2 = vec3(11.6024931, -3.9728537, -15.9423942);
    const vec3 c3 = vec3(-41.7039961, 17.4363995, 44.3541452), c4 = vec3(77.1629357, -33.4023589, -81.8073092), c5 = vec3(-71.3194282, 32.6260677, 73.2095198), c6 = vec3(25.1311262, -12.2426659, -23.0703250);
    return clamp(c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6))))), 0.0, 1.0);
  }
  // gas temperature: 10⁴ K deep blue, 10⁵ violet, 10⁶ red, 10⁷ orange, 10⁸ white-hot
  vec3 heat(float T){
    float t = clamp((log(max(T, 1.0)) / 2.302585 - 4.0) / 4.0, -0.3, 1.0);
    vec3 c0 = vec3(0.13, 0.20, 0.66), c1 = vec3(0.44, 0.24, 0.78), c2 = vec3(0.95, 0.32, 0.30), c3 = vec3(1.0, 0.68, 0.28), c4 = vec3(1.0, 0.96, 0.86);
    vec3 c = t < 0.0 ? c0 * (1.0 + t * 0.8) : t < 0.25 ? mix(c0, c1, t / 0.25) : t < 0.5 ? mix(c1, c2, (t - 0.25) / 0.25) : t < 0.75 ? mix(c2, c3, (t - 0.5) / 0.25) : mix(c3, c4, (t - 0.75) / 0.25);
    return c * mix(0.7, 2.6, clamp(t, 0.0, 1.0));
  }
  void offscreen(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; vCol = vec3(0.0); }
  void main(){
    float fs = aAux.y;
    if (uLayer == 2 && fs < 0.002){ offscreen(); return; }
    vec3 x = fract(aPos + uDrift * aMom);
    // drawing only: nudge each dot by up to half a lattice spacing so the regular starting grid doesn't show as moiré
    uint hh = uint(gl_VertexID) * 747796405u + 2891336453u; hh = ((hh >> ((hh >> 28u) + 4u)) ^ hh) * 277803737u;
    vec3 jit = vec3(uvec3(hh, hh >> 10u, hh >> 20u) & 1023u) / 1023.0 - 0.5;
    vec3 xd = x + jit * uJitter;
    vec3 w = (fract(xd - uCenter + 0.5) - 0.5) * uWorld;   // the view is centered on uCenter; the box wraps around it
    float fade = 1.0;
    if (uSlice > 0.5){ float s = abs(dot(w, uSliceN)); fade = 1.0 - smoothstep(uSliceHalf * 0.6, uSliceHalf, s); }
    if (fade <= 0.0){ offscreen(); return; }
    float rho = max(cic(uRho, x).r * uMfac, 0.0);          // total density here, 1 = cosmic average
    float lg = log(max(1.0 + (rho - 1.0) * uContrast, 0.05)) / 2.302585;
    vec3 c;
    float td = clamp((lg + 0.8) / 3.0, 0.0, 1.0), dens = mix(0.3, 1.9, pow(td, 1.3));
    if (uLayer == 2){
      // starlight: a crisp point per star-forming parcel, blue while young and gold once the stars have aged;
      // it dims with distance like a real galaxy
      float young = clamp(8.0 * aAux.z / max(fs, 1e-6), 0.0, 1.0);
      vec4 p = uView * vec4(w, 1.0);
      gl_Position = uProj * p;
      gl_PointSize = uStarPx;
      float d = max(-p.z, 1e-3);
      vCol = mix(vec3(1.0, 0.58, 0.26), vec3(0.50, 0.68, 1.0), young) * sqrt(fs + 6.0 * aAux.z) * uBright * fade * min(1.0 / (d * d), 6.0);
      return;
    } else if (uMode == 3){
      c = (uLayer == 1 ? heat(aAux.x) * (1.0 - fs) : vec3(0.16, 0.18, 0.26)) * dens;
    } else if (uMode == 0){
      // glow: faint violet in the voids, blue threads, gold-white knots
      float t = clamp((lg + 0.8) / 3.0, 0.0, 1.0);
      vec3 a = vec3(0.30, 0.26, 0.85), b = vec3(0.42, 0.62, 1.0), m = vec3(0.78, 0.86, 1.0), h = vec3(1.0, 0.80, 0.52);
      c = t < 0.35 ? mix(a, b, t / 0.35) : t < 0.62 ? mix(b, m, (t - 0.35) / 0.27) : mix(m, h, (t - 0.62) / 0.38);
      c *= mix(0.16, 2.4, pow(t, 1.3));
    } else if (uMode == 1){
      c = inferno(clamp((lg + 1.5) / 3.9, 0.0, 1.0)) * 1.7 + 0.02;
    } else {
      float v = clamp(length(aMom) * uVel / 1400.0, 0.0, 1.0); // peculiar speed, 0 to 1400 km/s
      vec3 s0 = vec3(0.16, 0.26, 0.75), s1 = vec3(0.2, 0.75, 0.8), s2 = vec3(1.0, 0.85, 0.35), s3 = vec3(1.0, 0.35, 0.25);
      c = v < 0.33 ? mix(s0, s1, v / 0.33) : v < 0.66 ? mix(s1, s2, (v - 0.33) / 0.33) : mix(s2, s3, (v - 0.66) / 0.34);
      c *= 0.7 + 0.8 * v;
    }
    vec4 p = uView * vec4(w, 1.0);
    gl_Position = uProj * p;
    // each particle keeps its share of light at any zoom: tiny sprites get dimmer, big ones spread out
    float sz = uSize / max(-p.z, 1e-4);
    float ps = clamp(sz, 1.0, uMaxPt);
    gl_PointSize = ps;
    vCol = c * uBright * fade * min(sz * sz, ps * ps) / (ps * ps);
  }`;
  const DRAW_FS = `#version 300 es
  precision mediump float;
  in vec3 vCol; out vec4 o;
  void main(){
    vec2 q = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(q, q);
    if (r2 > 1.0) discard;
    o = vec4(vCol * exp(-r2 * 3.0) * 1.6, 1.0);
  }`;
  const LN_VS = `#version 300 es
  in vec3 aPos; uniform mat4 uView, uProj; uniform vec3 uOffset; uniform float uScale;
  void main(){ gl_Position = uProj * uView * vec4(aPos * uScale + uOffset, 1.0); }`;
  const LN_FS = `#version 300 es
  precision mediump float; uniform vec3 uColor; out vec4 o;
  void main(){ o = vec4(uColor, 1.0); }`;
  const TM_VS = `#version 300 es
  in vec2 p; out vec2 uv; void main(){ uv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
  const TM_FS = `#version 300 es
  precision highp float;
  in vec2 uv; uniform sampler2D uTex; uniform vec2 uPx; uniform float uExp; out vec4 o;
  void main(){
    vec3 c = texture(uTex, uv).rgb;
    vec3 g = vec3(0.0);
    for (int i = 0; i < 8; i++){
      float a = float(i) * 0.785398;
      vec2 d = vec2(cos(a), sin(a));
      g += texture(uTex, uv + d * uPx * 2.5).rgb * 0.55;
      g += texture(uTex, uv + d * uPx * 7.0).rgb * 0.45;
    }
    c += g / 8.0 * 0.45;
    c = 1.0 - exp(-c * uExp);
    float v = smoothstep(1.3, 0.2, length(uv - 0.5) * 1.6);
    c = c * (0.8 + 0.2 * v) + vec3(0.003, 0.004, 0.010) * v;
    o = vec4(pow(c, vec3(1.0 / 2.2)), 1.0);
  }`;

  function program(vs, fs){
    const mk = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh)); return sh; };
    const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++){ const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
    return { p, u, a: name => gl.getAttribLocation(p, name) };
  }

  let LN, TM, vaoTm, vaoLn, bufLn, fbo, fboTex, floatOK = false;
  let DR = null, drawVao = [null, null], drawKey = '';
  if (glOK){
    try {
      LN = program(LN_VS, LN_FS); TM = program(TM_VS, TM_FS);
      floatOK = !!gl.getExtension('EXT_color_buffer_float');
      vaoTm = gl.createVertexArray(); gl.bindVertexArray(vaoTm);
      const bt = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bt);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(TM.a('p')); gl.vertexAttribPointer(TM.a('p'), 2, gl.FLOAT, false, 0, 0);
      vaoLn = gl.createVertexArray(); gl.bindVertexArray(vaoLn);
      bufLn = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bufLn);
      gl.enableVertexAttribArray(LN.a('aPos')); gl.vertexAttribPointer(LN.a('aPos'), 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
      fbo = gl.createFramebuffer(); fboTex = gl.createTexture();
    } catch (e){ console.error(e); glOK = false; nogl('The renderer could not start on this device.'); }
  }

  // the particle drawing program depends on the grid and particle counts, so it is rebuilt with them
  function drawProgram(){
    const key = eng.NG + ':' + eng.NP;
    if (key !== drawKey){
      drawVao.forEach(v => v && gl.deleteVertexArray(v));
      DR = program(eng.header() + DRAW_VS, DRAW_FS);
      drawVao = [0, 1].map(k => {
        const v = gl.createVertexArray(); gl.bindVertexArray(v);
        const attr = (buf, name, size) => { const loc = DR.a(name); if (loc < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0); };
        attr(eng.pos[k], 'aPos', 3); attr(eng.mom[k], 'aMom', 3); attr(eng.aux[k], 'aAux', 4);
        return v;
      });
      gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
      drawKey = key;
    }
    return DR;
  }

  let W = 0, H = 0;
  function resize(){
    const dpr = Math.min(window.devicePixelRatio || 1, small ? 1.25 : 1.75);
    W = Math.max(2, Math.round(canvas.clientWidth * dpr)); H = Math.max(2, Math.round(canvas.clientHeight * dpr));
    canvas.width = W; canvas.height = H;
    if (!glOK) return;
    gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, floatOK ? gl.RGBA16F : gl.RGBA8, W, H, 0, gl.RGBA, floatOK ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fboTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  new ResizeObserver(resize).observe(canvas);

  /* ================================================================
     Simulation control
     ================================================================ */
  // ctl.done: steps completed (particles sit at a = aAt(done)); ctl.clock: displayed time in steps
  const ctl = { done: 0, aph: A_START, clock: 0, queue: [], qTotal: 1, qTo: 0, qAh: A_START, jumpTo: null, onArrive: null };
  let ready = false, buildToken = 0, sigmaCell = 1;
  const fsrc = () => State.dm ? 1 : P.Ob / P.Om;

  function startStep(to){
    const s = Cosmo.stepParams(aAt(ctl.done), aAt(to), ctl.aph, fsrc());
    // without dark matter's pull, small halos grow much more slowly too (same starting ripples)
    const g = GROWTH[State.dm ? 1 : 0]; s.D = Cosmo.growth(A_START) * g.D(s.a) / g.D(A_START);
    ctl.queue = eng.stepPasses(s);
    ctl.qTotal = ctl.queue.length; ctl.qTo = to; ctl.qAh = s.ah;
  }
  function runPasses(n){
    while (n-- > 0 && ctl.queue.length) ctl.queue.shift()();
    if (!ctl.queue.length && ctl.qTo > ctl.done){ ctl.done = ctl.qTo; ctl.aph = ctl.qAh; }
  }

  // rms of the gridded linear density at a = 1, used to report how much faint ripples are boosted
  function linearSigmaCell(NG, NP){
    const kc = Math.min(NG, NP) / 2, sinc = t => t === 0 ? 1 : Math.sin(t) / t;
    let s = 0;
    for (let i = -kc; i <= kc; i++) for (let j = -kc; j <= kc; j++) for (let k = -kc; k <= kc; k++){
      const n2 = i*i + j*j + k*k; if (n2 === 0 || n2 > kc*kc) continue;
      const w = (sinc(Math.PI*i/NG) * sinc(Math.PI*j/NG) * sinc(Math.PI*k/NG)) ** 2;
      s += Cosmo.power(2 * Math.PI * Math.sqrt(n2) / L) / L ** 3 * w * w;
    }
    return Math.sqrt(s);
  }
  const sigmaCache = {};

  function start(then){
    if (!glOK) return;
    const q = QUAL[State.q];
    ready = false;
    const token = ++buildToken;
    ctl.queue = []; ctl.jumpTo = null; ctl.onArrive = null;
    eng.cancelCoarse(); coarseCb = null; lastClump = null; lastGas = null; history.length = 0; chartDirty = true;
    const big = q.NP >= 128;
    $('building').textContent = 'Seeding the universe…'; $('building').hidden = !big;
    setTimeout(() => {
      if (token !== buildToken) return;
      try {
        const g = GROWTH[State.dm ? 1 : 0], A = Cosmo.growth(A_START);
        eng.init({ NP: q.NP, NG: q.NG, seed: State.seed, A, vfac: A_START * A_START * Cosmo.E(A_START) * g.f(A_START) * A, T0: Cosmo.T0, gas: Cosmo.gasParams(q.NG) });
        drawProgram();
      } catch (e){ console.error(e); $('building').textContent = 'The graphics card could not set this up. Try fewer particles.'; $('building').hidden = false; return; }
      if (gl.getError() === gl.OUT_OF_MEMORY){ $('building').textContent = 'Not enough graphics memory for that many particles. Choose fewer.'; $('building').hidden = false; return; }
      const key = q.NG + ':' + q.NP;
      sigmaCell = sigmaCache[key] || (sigmaCache[key] = linearSigmaCell(q.NG, q.NP));
      Object.assign(ctl, { done: 0, aph: A_START, clock: 0, queue: [], qTo: 0 });
      $('building').hidden = true;
      ready = true;
      updateFacts();
      then && then();
    }, big ? 30 : 0);
  }

  function jumpToStep(n, then){
    if (!ready){ return; }
    if (n < ctl.done){ start(() => jumpToStep(n, then)); return; }
    ctl.jumpTo = n; ctl.onArrive = then || null;
  }
  const jumpStride = () => eng.NG >= 256 ? 8 : 10, jumpStepsPerFrame = () => eng.NG >= 256 ? 1 : 4;
  // GPU passes allowed per frame, adjusted to keep the frame rate up; if the card can't keep up, the clock slows instead
  let passBudget = 30;
  function tuneBudget(dt){ passBudget = Math.max(6, Math.min(400, passBudget * (dt < 0.0185 ? 1.08 : 0.85))); }

  function advance(dt){
    if (!ready) return;
    if (ctl.jumpTo !== null){
      let budget = jumpStepsPerFrame();
      while (budget > 0){
        if (!ctl.queue.length){
          if (ctl.done >= ctl.jumpTo){
            ctl.jumpTo = null; ctl.clock = ctl.done; coarseAt = -1e9; coarseClock = -1;
            const f = ctl.onArrive; ctl.onArrive = null; f && f();
            return;
          }
          startStep(Math.min(ctl.done + jumpStride(), ctl.jumpTo));
          budget--;
        }
        runPasses(Infinity);
      }
      ctl.clock = ctl.done;
      return;
    }
    if (!State.playing) return;
    let budget = Math.round(passBudget);
    ctl.clock = Math.min(NSTEPS, ctl.clock + NSTEPS / State.secs * dt);
    while (ctl.done < Math.floor(ctl.clock) && budget > 0){
      if (!ctl.queue.length) startStep(ctl.done + 1);
      const n = Math.min(budget, ctl.queue.length); budget -= n;
      runPasses(n);
    }
    if (ctl.done < Math.floor(ctl.clock)) ctl.clock = ctl.done + 0.999;
    if (ctl.done < NSTEPS){
      if (!ctl.queue.length) startStep(ctl.done + 1);
      const want = Math.ceil((ctl.clock - ctl.done) * ctl.qTotal), did = ctl.qTotal - ctl.queue.length;
      runPasses(Math.min(want - did, ctl.qTotal - did - 1, budget)); // the last pass moves the particles; it waits for its turn
    }
    if (ctl.clock >= NSTEPS){ State.playing = false; syncPlay(); }
  }

  /* ================================================================
     Clusters and a home like ours, from the coarse mass grid
     ================================================================ */
  // coarse readbacks arrive every step or so; each gives the mass grid plus totals for stars and hot gas
  let coarseCb = null, coarseNeedA = 0, lastClump = null, lastGas = null, clumpAt = -1e9;
  const history = []; let chartDirty = true;
  function withCoarse(cb){ coarseCb = cb; coarseNeedA = aAt(ctl.done); eng.cancelCoarse(); eng.requestCoarse(coarseNeedA); }
  function pollCoarse(now){
    if (!ready) return;
    const c = eng.pollCoarse();
    if (c){
      lastGas = c;
      if (!history.length || c.a > history[history.length - 1].a){ history.push({ a: c.a, stars: c.stars }); chartDirty = true; }
      if (coarseCb && c.a >= coarseNeedA * 0.9999){ lastClump = heaviest(c.mass); clumpAt = now; const f = coarseCb; coarseCb = null; f(c.mass); }
      else if (now - clumpAt > 1000){ lastClump = heaviest(c.mass); clumpAt = now; }
    } else if (coarseCb) eng.requestCoarse(coarseNeedA);
    else if (!State.playing && ctl.jumpTo === null && (!lastGas || lastGas.a < aAt(ctl.done) * 0.9999)) eng.requestCoarse(aAt(ctl.done));
  }
  const NCg = () => eng.NC;
  function heaviest(c){
    const n = NCg(), M = n - 1, id = (i, j, k) => (i & M) + n * ((j & M) + n * (k & M));
    let best = -1, bi = 0, bj = 0, bk = 0;
    for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++){
      const s = c[id(i,j,k)] + c[id(i+1,j,k)] + c[id(i,j+1,k)] + c[id(i+1,j+1,k)] + c[id(i,j,k+1)] + c[id(i+1,j,k+1)] + c[id(i,j+1,k+1)] + c[id(i+1,j+1,k+1)];
      if (s > best){ best = s; bi = i; bj = j; bk = k; }
    }
    const w = [0, 0, 0];
    for (let d = 0; d < 8; d++){
      const di = d & 1, dj = (d >> 1) & 1, dk = (d >> 2) & 1, m = c[id(bi+di, bj+dj, bk+dk)];
      w[0] += m * (bi + di + 0.5); w[1] += m * (bj + dj + 0.5); w[2] += m * (bk + dk + 0.5);
    }
    const pos = w.map(v => ((v / best / n) % 1 + 1) % 1);
    return { mass: best / eng.N * M_TOTAL, pos };
  }
  // a modest group ~16 Mpc from the heaviest cluster, next to a void (the Local Group sits ~16.5 Mpc from Virgo)
  function homeSpot(c, cl){
    const n = NCg(), M = n - 1, id = (i, j, k) => (i & M) + n * ((j & M) + n * (k & M));
    const mean = eng.N / n ** 3, cell = L / n;
    const offs = [];
    for (let k = -3; k <= 3; k++) for (let j = -3; j <= 3; j++) for (let i = -3; i <= 3; i++){ const r = Math.hypot(i, j, k); if (r >= 1.9 && r <= 3.2) offs.push([i, j, k]); }
    let best = null;
    for (const [dMin, dMax, needVoid] of [[11, 22, 0.3], [9, 26, 0.5], [6, 34, 2]]){
      for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++){
        const p = [(i + 0.5) / n, (j + 0.5) / n, (k + 0.5) / n];
        const d = Math.hypot(...p.map((v, a) => { let x = v - cl.pos[a]; x -= Math.round(x); return x; })) * L;
        if (d < dMin || d > dMax) continue;
        const r = c[id(i,j,k)] / mean;
        if (r < 1.2 || r > 12) continue;
        let vmin = Infinity; for (const [a, b, e] of offs) vmin = Math.min(vmin, c[id(i+a, j+b, k+e)] / mean);
        if (vmin > needVoid) continue;
        const score = -Math.abs(d - 16.5) / 3 - Math.abs(Math.log(r / 3)) - 2 * vmin;
        if (!best || score > best.score) best = { score, pos: p, d };
      }
      if (best) break;
    }
    return best;
  }

  /* ================================================================
     Camera
     ================================================================ */
  const HOME = { yaw: 0.75, pitch: 0.38, dist: 1.85 };
  const cam = { ...HOME }, tgt = { ...HOME };
  const center = [0.5, 0.5, 0.5];   // point of the (periodic) box shown at the middle of the view
  let lastInteract = -1e9;
  function setCam(c, immediate){ Object.assign(tgt, c); if (immediate || reduceMotion) Object.assign(cam, tgt); }
  function setCenter(p){ center[0] = p[0]; center[1] = p[1]; center[2] = p[2]; }
  function resetView(){ setCenter([0.5, 0.5, 0.5]); setCam({ pitch: HOME.pitch, dist: HOME.dist }); }

  const pointers = new Map(); let pinch = null;
  const hideHint = () => { $('hint').hidden = true; };
  canvas.addEventListener('pointerdown', e => { canvas.setPointerCapture(e.pointerId); pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastInteract = performance.now(); hideHint();
    if (pointers.size === 2){ const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: tgt.dist }; } });
  canvas.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId), cur = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cur); lastInteract = performance.now();
    if (pointers.size === 1){
      tgt.yaw -= (cur.x - prev.x) * 0.005; tgt.pitch = Math.max(-1.5, Math.min(1.5, tgt.pitch + (cur.y - prev.y) * 0.004));
      cam.yaw = tgt.yaw; cam.pitch = tgt.pitch;
    } else if (pointers.size === 2 && pinch){
      const [a, b] = [...pointers.values()];
      tgt.dist = cam.dist = Math.max(0.04, Math.min(6, pinch.dist * pinch.d / Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))));
    }
  });
  const up = e => { pointers.delete(e.pointerId); pinch = null; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', e => { e.preventDefault(); hideHint(); lastInteract = performance.now(); tgt.dist = cam.dist = Math.max(0.04, Math.min(6, tgt.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });

  const cross = (a, b) => [a[1]*b[2] - a[2]*b[1], a[2]*b[0] - a[0]*b[2], a[0]*b[1] - a[1]*b[0]];
  const dot = (a, b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };
  function lookAt(eye, at){
    const f = norm([at[0]-eye[0], at[1]-eye[1], at[2]-eye[2]]);
    const s = norm(cross(f, [0, 1, 0])), u = cross(s, f);
    return new Float32Array([s[0],u[0],-f[0],0, s[1],u[1],-f[1],0, s[2],u[2],-f[2],0, -dot(s,eye),-dot(u,eye),dot(f,eye),1]);
  }
  function persp(fovy, asp, n, f){
    const t = 1 / Math.tan(fovy / 2);
    return new Float32Array([t/asp,0,0,0, 0,t,0,0, 0,0,(f+n)/(n-f),-1, 0,0,2*f*n/(n-f),0]);
  }
  const mulv = (m, v) => [0, 1, 2, 3].map(r => m[r]*v[0] + m[4+r]*v[1] + m[8+r]*v[2] + m[12+r]*v[3]);
  // box coordinates → view-centered world coordinates
  const toWorld = (p, scale) => p.map((v, a) => { let x = v - center[a]; x -= Math.round(x); return x * scale; });

  /* ================================================================
     Overlays: real structures at true size, and the home marker
     ================================================================ */
  const GLY = 1000 / (L * MLY_PER_MPC);  // one billion light-years in box units
  const circle = (r, plane, seg = 128) => {
    const out = [];
    for (let i = 0; i <= seg; i++){
      const t = i / seg * Math.PI * 2, c = Math.cos(t) * r, s = Math.sin(t) * r;
      out.push(plane === 0 ? [c, s, 0] : plane === 1 ? [0, c, s] : [c, 0, s]);
    }
    return out;
  };
  const strip = pts => { const a = []; for (let i = 0; i < pts.length - 1; i++) a.push(...pts[i], ...pts[i + 1]); return a; };
  const sphereLines = r => [...strip(circle(r, 0)), ...strip(circle(r, 1)), ...strip(circle(r, 2))];
  const BOX_LINES = (() => {
    const a = [], c = [-0.5, 0.5];
    for (const x of c) for (const y of c){ a.push(x, y, -0.5, x, y, 0.5); a.push(x, -0.5, y, x, 0.5, y); a.push(-0.5, x, y, 0.5, x, y); }
    return new Float32Array(a);
  })();
  const SIZES = {
    sgw:  { label: 'Sloan Great Wall', note: '1.37 billion ly long', lines: () => { const h = 1.37 * GLY / 2; return [-h, 0, 0, h, 0, 0, -h, -0.012, 0, -h, 0.012, 0, h, -0.012, 0, h, 0.012, 0]; }, dist: 2.3 },
    cfa:  { label: 'CfA2 Great Wall', note: '500 × 300 million ly', lines: () => { const w = 0.5 * GLY / 2, h = 0.3 * GLY / 2; return [-w,-h,0, w,-h,0, w,-h,0, w,h,0, w,h,0, -w,h,0, -w,h,0, -w,-h,0]; }, dist: 1.6 },
    lan:  { label: 'Laniakea Supercluster', note: '520 million ly across', lines: () => sphereLines(0.52 * GLY / 2), dist: 1.8 },
    boo:  { label: 'Boötes Void', note: '330 million ly across', lines: () => sphereLines(0.33 * GLY / 2), dist: 1.5 },
    coma: { label: 'Coma Cluster', note: '20 million ly across', lines: () => sphereLines(0.02 * GLY / 2), dist: 0.1, atCluster: true },
  };

  /* ================================================================
     Readouts
     ================================================================ */
  const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const sci = m => { const e = Math.floor(Math.log10(m)); return `${(m / 10 ** e).toFixed(1)} × 10${String(e).split('').map(ch => SUP[ch]).join('')}`; };
  const fmtGyr = t => t < 1 ? `${Math.round(t * 1000)} million years` : `${t.toFixed(2)} billion years`;
  const fmtLy = mly => mly < 999.5 ? `${mly < 100 ? mly.toFixed(1) : Math.round(mly)} million ly` : `${(mly / 1000).toFixed(2)} billion ly`;
  const PHASES = [
    [30, 'The smooth universe', 'ripples of a few percent'],
    [12, 'Ripples deepen', 'before the first stars'],
    [5, 'First knots and threads', 'the first galaxies would form here'],
    [2, 'The web takes shape', 'walls break into filaments'],
    [0.6, 'Clusters assemble', 'matter drains out of the voids'],
    [0.02, 'Dark energy takes over', 'the web slows its growth'],
    [-1, 'Today', '13.7 billion years after the Big Bang'],
  ];
  function ripplesBoost(a){
    // boosting is for seeing faint early ripples; it stays off in the no-dark-matter run so that comparison is fair
    if (!State.boost || State.mode === 2 || !State.dm) return 1;
    const g = GROWTH[State.dm ? 1 : 0], sig = sigmaCell * Cosmo.growth(A_START) * g.D(a) / g.D(A_START);
    return Math.max(1, Math.min(40, 0.8 / sig));
  }
  let lastPhase = '';
  function updateReadout(a){
    const z = 1 / a - 1;
    $('rAge').textContent = fmtGyr(Cosmo.age(a));
    $('rZ').textContent = z >= 10 ? z.toFixed(1) : Math.max(0, z).toFixed(2);
    $('rA').textContent = `${a.toFixed(a < 0.1 ? 4 : 3)} · 1/${(1 / a).toFixed(1)}`;
    $('rBox').textContent = `${(a * L).toFixed(a * L < 100 ? 1 : 0)} Mpc · ${fmtLy(a * L * MLY_PER_MPC)}`;
    $('rClump').textContent = lastClump ? `${sci(lastClump.mass)} suns` : '—';
    $('rStars').textContent = lastGas ? `${(lastGas.stars * 100).toFixed(lastGas.stars < 0.01 ? 2 : 1)}%` : '—';
    $('rHot').textContent = lastGas ? `${(lastGas.hot5 * 100).toFixed(1)}%` : '—';
    const b = ripplesBoost(a);
    $('rBoostL').hidden = $('rBoost').hidden = b < 1.05;
    $('rBoost').textContent = `${b.toFixed(b < 10 ? 1 : 0)}× stronger`;
    const ph = PHASES.find(p => z > p[0]);
    const txt = ph[1], sm = State.dm ? ph[2] : 'gravity of ordinary matter only';
    if (txt + sm !== lastPhase){ $('phaseText').textContent = txt; $('phaseSmall').textContent = sm; lastPhase = txt + sm; }
  }
  function updateFacts(){
    const q = QUAL[State.q], fb = P.Ob / P.Om, n = q.NP ** 3;
    const fmtM = m => `about ${m >= 1e12 ? (m / 1e12).toFixed(1) + ' trillion' : Math.round(m / 1e10) * 10 + ' billion'} suns`;
    $('dotMass').textContent = fmtM(M_TOTAL * (1 - fb) / n);
    $('gasMass').textContent = fmtM(M_TOTAL * fb / n);
    $('gridFact').textContent = `${q.NG}³ = ${(q.NG ** 3 / 1e6).toFixed(1)} million cells`;
  }

  /* ================================================================
     Star-formation history chart (SVG)
     ================================================================ */
  const T_NOW = Cosmo.age(1), MB = P.Ob * 2.775e11 * P.h * P.h * L ** 3, VOL = L ** 3;
  // Madau & Dickinson (2014) fit to observations, converted to the Chabrier stellar mix (× 0.63)
  const md14 = z => 0.015 * (1 + z) ** 2.7 / (1 + ((1 + z) / 2.9) ** 5.6) * 0.63;
  const zOfAge = (() => {
    const tab = []; for (let i = 0; i <= 600; i++){ const a = 0.01 + 0.99 * i / 600; tab.push([Cosmo.age(a), a]); }
    return t => { let i = 1; while (i < tab.length - 1 && tab[i][0] < t) i++; const [t0, a0] = tab[i - 1], [t1, a1] = tab[i]; return 1 / (a0 + (a1 - a0) * (t - t0) / (t1 - t0)) - 1; };
  })();
  // star-formation rate from the growth of the star fraction, over windows of at least 0.3 billion years
  function simSeries(){
    const out = []; let prev = null;
    for (const h of history){
      const t = Cosmo.age(h.a);
      if (!prev){ prev = { t, s: h.stars }; continue; }
      if (t - prev.t >= 0.3){ out.push([(t + prev.t) / 2, (h.stars - prev.s) * MB / ((t - prev.t) * 1e9) / VOL]); prev = { t, s: h.stars }; }
    }
    return out;
  }
  const chartSvg = $('sfrChart'), chartTip = $('sfrTip');
  let chartGeom = null, simCache = [];
  function drawChart(aNow){
    chartDirty = false;
    const Wc = Math.max(300, chartSvg.clientWidth || 600), Hc = 300, m = { l: 48, r: 18, t: 30, b: 42 };
    const X = t => m.l + (Wc - m.l - m.r) * t / 14, Y0 = 0.12, Y = v => m.t + (Hc - m.t - m.b) * (1 - Math.max(0, Math.min(v, Y0)) / Y0);
    const sim = simSeries(); simCache = sim;
    const obs = []; for (let t = 0.4; t <= T_NOW + 1e-9; t += 0.1) obs.push([t, md14(zOfAge(t))]);
    const path = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
    let g = '';
    for (let v = 0; v <= Y0 + 1e-9; v += 0.02) g += `<line x1="${m.l}" x2="${Wc - m.r}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><text x="${m.l - 8}" y="${Y(v) + 4}" class="tick" text-anchor="end">${v.toFixed(2)}</text>`;
    for (let t = 0; t <= 14; t += 2) g += `<text x="${X(t)}" y="${Hc - m.b + 18}" class="tick" text-anchor="middle">${t}</text>`;
    g += `<text x="${(m.l + Wc - m.r) / 2}" y="${Hc - 4}" class="axis" text-anchor="middle">age of the universe, billions of years</text>`;
    for (const z of [6, 3, 2, 1, 0.5]){ const t = Cosmo.age(1 / (1 + z)); g += `<line x1="${X(t)}" x2="${X(t)}" y1="${m.t - 6}" y2="${m.t}" class="zt"/><text x="${X(t)}" y="${m.t - 10}" class="tick" text-anchor="middle">z ${z}</text>`; }
    const tNow = Cosmo.age(aNow);
    g += `<line x1="${X(tNow)}" x2="${X(tNow)}" y1="${m.t}" y2="${Hc - m.b}" class="now"/>`;
    g += `<path d="${path(obs)}" class="obs"/>`;
    if (sim.length > 1) g += `<path d="${path(sim)}" class="sim"/>`;
    const oEnd = obs[obs.length - 1];
    g += `<text x="${X(oEnd[0]) - 4}" y="${Y(oEnd[1]) - 12}" class="lbl" text-anchor="end">observed</text>`;
    if (sim.length > 1){ const sEnd = sim[sim.length - 1]; g += `<text x="${Math.min(X(sEnd[0]) + 8, Wc - m.r - 96)}" y="${Y(sEnd[1]) - 12}" class="lbl">this universe</text>`; }
    g += `<line id="sfrCross" x1="0" x2="0" y1="${m.t}" y2="${Hc - m.b}" class="cross" visibility="hidden"/>`;
    chartSvg.setAttribute('viewBox', `0 0 ${Wc} ${Hc}`); chartSvg.setAttribute('height', Hc);
    chartSvg.innerHTML = g;
    chartGeom = { X, m, Wc, Hc };
    if (sim.length > 2){
      const pk = sim.reduce((b, p) => p[1] > b[1] ? p : b, sim[0]);
      $('sfrPeak').textContent = `${pk[1].toFixed(3)} at ${pk[0].toFixed(1)} billion years (z ≈ ${zOfAge(pk[0]).toFixed(1)})`;
    } else $('sfrPeak').textContent = 'not reached yet';
    $('sfrStars').textContent = lastGas ? `${(lastGas.stars * 100).toFixed(1)}%` : '—';
    $('sfrHot').textContent = lastGas ? `${(lastGas.hot5 * 100).toFixed(0)}%` : '—';
    const rows = [];
    for (let t = 1; t <= 13; t++){ const near = sim.find(p => Math.abs(p[0] - t) < 0.35); rows.push(`<tr><td class="num">${t}</td><td class="num">${zOfAge(t).toFixed(2)}</td><td class="num">${md14(zOfAge(t)).toFixed(3)}</td><td class="num">${near ? near[1].toFixed(3) : '—'}</td></tr>`); }
    $('sfrRows').innerHTML = rows.join('');
  }
  chartSvg.addEventListener('pointermove', e => {
    if (!chartGeom) return;
    const r = chartSvg.getBoundingClientRect(), x = (e.clientX - r.left) * chartGeom.Wc / r.width;
    const t = Math.max(0.4, Math.min(T_NOW, (x - chartGeom.m.l) / (chartGeom.Wc - chartGeom.m.l - chartGeom.m.r) * 14));
    const z = zOfAge(t), near = simCache.reduce((b, p) => !b || Math.abs(p[0] - t) < Math.abs(b[0] - t) ? p : b, null);
    const cross = document.getElementById('sfrCross');
    cross.setAttribute('x1', chartGeom.X(t)); cross.setAttribute('x2', chartGeom.X(t)); cross.setAttribute('visibility', 'visible');
    $('tipAge').textContent = `${t.toFixed(1)} billion years · z ${z.toFixed(2)}`;
    $('tipObs').textContent = md14(z).toFixed(3);
    $('tipSim').textContent = near && Math.abs(near[0] - t) < 0.4 ? near[1].toFixed(3) : '—';
    chartTip.hidden = false;
    chartTip.style.left = Math.min(r.width - 200, Math.max(0, e.clientX - r.left + 14)) + 'px';
  });
  chartSvg.addEventListener('pointerleave', () => { chartTip.hidden = true; const c = document.getElementById('sfrCross'); if (c) c.setAttribute('visibility', 'hidden'); });

  /* ================================================================
     Frame loop
     ================================================================ */
  let visible = true, tPrev = performance.now(), chartAt = -1e9;
  new IntersectionObserver(es => { visible = es[0].isIntersecting; }, { threshold: 0.01 }).observe(canvas);

  function drawLines(data, color, view, proj, offset, scale){
    gl.useProgram(LN.p); gl.bindVertexArray(vaoLn);
    gl.uniformMatrix4fv(LN.u.uView, false, view); gl.uniformMatrix4fv(LN.u.uProj, false, proj);
    gl.uniform3fv(LN.u.uOffset, offset); gl.uniform1f(LN.u.uScale, scale); gl.uniform3fv(LN.u.uColor, color);
    gl.bindBuffer(gl.ARRAY_BUFFER, bufLn); gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    gl.drawArrays(gl.LINES, 0, data.length / 3);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  function frame(now){
    requestAnimationFrame(frame);
    const dt = Math.min((now - tPrev) / 1000, 0.1); tPrev = now;
    if (!visible || document.hidden || !ready || !glOK) return;
    tuneBudget(dt);
    advance(dt);
    pollCoarse(now);
    const aDisp = aAt(ctl.jumpTo !== null ? ctl.done : ctl.clock), aDone = aAt(ctl.done);
    updateReadout(aDisp);

    // camera
    if (State.spin && now - lastInteract > 4000) tgt.yaw += dt * 0.04;
    const k = 1 - Math.exp(-dt * 2.4);
    cam.pitch += (tgt.pitch - cam.pitch) * k; cam.dist *= Math.exp((Math.log(tgt.dist) - Math.log(cam.dist)) * k); cam.yaw += (tgt.yaw - cam.yaw) * Math.min(1, 3 * k);
    const cp = Math.cos(cam.pitch), dist = cam.dist * Math.max(1, 1.25 * H / W); // step back on tall, narrow screens
    const eye = [dist * cp * Math.cos(cam.yaw), dist * Math.sin(cam.pitch), dist * cp * Math.sin(cam.yaw)];
    const view = lookAt(eye, [0, 0, 0]), proj = persp(0.8, W / H, Math.max(0.0005, dist * 0.01), dist + 8);
    const world = State.physical ? aDisp : 1;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);

    const D = drawProgram();
    gl.useProgram(D.p); gl.bindVertexArray(drawVao[eng.cur]);
    gl.uniformMatrix4fv(D.u.uView, false, view); gl.uniformMatrix4fv(D.u.uProj, false, proj);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, eng.rhoS.t); gl.uniform1i(D.u.uRho, 0);
    gl.uniform3fv(D.u.uCenter, center);
    gl.uniform3fv(D.u.uSliceN, norm(eye));
    gl.uniform1f(D.u.uSlice, State.slice ? 1 : 0); gl.uniform1f(D.u.uSliceHalf, 0.045 * world);
    gl.uniform1f(D.u.uDrift, aDisp > aDone ? Cosmo.driftFac(aDone, aDisp) : 0);
    gl.uniform1f(D.u.uWorld, world);
    gl.uniform1f(D.u.uSize, 0.7 * H / eng.NP * world);
    gl.uniform1f(D.u.uMaxPt, 10);
    gl.uniform1f(D.u.uJitter, (State.dm ? 0.45 + 0.55 * Math.max(0, 1 - (aDisp - A_START) / 0.3) : 0.8) / eng.NP);
    const bright = 0.9 / eng.NP * (floatOK ? 1 : 2) * (State.slice ? 2.2 : 1);
    gl.uniform1f(D.u.uMfac, eng.mfac());
    gl.uniform1f(D.u.uContrast, ripplesBoost(aDisp));
    gl.uniform1f(D.u.uVel, KMS / aDisp);
    gl.uniform1i(D.u.uMode, State.mode);
    // three layers from the same buffers: dark matter, gas, and the starlight of gas turned into stars
    const both = State.dmLayer && State.gasLayer && State.mode !== 3;
    const layer = (id, first, weight) => { gl.uniform1i(D.u.uLayer, id); gl.uniform1f(D.u.uBright, bright * weight); gl.drawArrays(gl.POINTS, first, eng.NDM); };
    if (State.dmLayer) layer(0, 0, (both ? 0.6 : 1) * (State.galLayer && State.mode !== 3 ? 0.55 : 1));
    if (State.gasLayer) layer(1, eng.NDM, both ? 0.6 : 1);
    gl.uniform1f(D.u.uStarPx, Math.max(1.5, H / 520));
    if (State.galLayer) layer(2, eng.NDM, 120 * eng.NP / 128 * (State.slice ? 1 : 0.35) / (State.slice ? 2.2 : 1));

    if (State.box) drawLines(BOX_LINES, [0.05, 0.055, 0.09], view, proj, [0, 0, 0], world);
    let tagAt = null, tagHtml = '';
    if (State.overlay && !State.physical){
      const o = State.overlay;
      drawLines(o.data, [0.55, 0.42, 0.22], view, proj, toWorld(o.at, 1), 1);
      tagAt = [o.at, o.top]; tagHtml = `<b>${o.label}</b><br>${o.note}`;
    }
    if (State.marker && !State.physical){
      const m = State.marker;
      drawLines(m.data, [0.6, 0.5, 0.25], view, proj, toWorld(m.at, 1), 1);
      tagAt = [m.at, m.top]; tagHtml = m.html;
    }
    gl.disable(gl.BLEND);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    gl.useProgram(TM.p); gl.bindVertexArray(vaoTm);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fboTex);
    gl.uniform1i(TM.u.uTex, 0); gl.uniform2f(TM.u.uPx, 1 / W, 1 / H); gl.uniform1f(TM.u.uExp, 1.5);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);

    if ((chartDirty && now - chartAt > 500) || now - chartAt > 1000){ drawChart(aDisp); chartAt = now; }

    // label next to the overlay
    const tag = $('tag');
    if (tagAt){
      const w = toWorld(tagAt[0], 1); w[1] += tagAt[1];
      const c = mulv(proj, mulv(view, [...w, 1]));
      if (c[3] > 0){
        const x = (c[0] / c[3] * 0.5 + 0.5) * canvas.clientWidth, y = (0.5 - c[1] / c[3] * 0.5) * canvas.clientHeight;
        tag.style.left = Math.min(x, canvas.clientWidth - 200) + 'px'; tag.style.top = Math.max(20, y) + 'px';
        if (tag.innerHTML !== tagHtml) tag.innerHTML = tagHtml;
        tag.hidden = false;
      } else tag.hidden = true;
    } else tag.hidden = true;
  }

  /* ================================================================
     Controls
     ================================================================ */
  const speedEl = $('speed');
  function syncSpeed(){
    State.secs = 120 * Math.pow(6 / 120, +speedEl.value / 100);
    $('speedOut').textContent = `13.7 billion years in ${State.secs < 10 ? State.secs.toFixed(1) : Math.round(State.secs)} s`;
  }
  speedEl.addEventListener('input', syncSpeed); syncSpeed();

  const playBtn = $('playBtn');
  function syncPlay(){ playBtn.textContent = State.playing ? 'Pause' : 'Play'; playBtn.setAttribute('aria-pressed', String(State.playing)); }
  playBtn.addEventListener('click', () => {
    if (!State.playing && ctl.clock >= NSTEPS){ start(); State.playing = true; }
    else State.playing = !State.playing;
    syncPlay();
  });
  const clearExtras = () => { State.overlay = null; State.marker = null; };
  $('restartBtn').addEventListener('click', () => { clearExtras(); State.playing = true; syncPlay(); start(); });
  $('newBtn').addEventListener('click', () => { clearExtras(); State.seed = newSeed(); State.playing = true; syncPlay(); start(); });

  function syncChips(){
    document.querySelectorAll('.chip[data-key]').forEach(b => b.setAttribute('aria-pressed', String(!!State[b.dataset.key])));
    document.querySelectorAll('#modes .chip').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.mode === State.mode)));
    document.querySelectorAll('#gravity .chip').forEach(b => b.setAttribute('aria-pressed', String((b.dataset.dm === '1') === State.dm)));
    document.querySelectorAll('#counts .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.q === State.q)));
  }
  document.querySelectorAll('.chip[data-key]').forEach(b => b.addEventListener('click', () => { State[b.dataset.key] = !State[b.dataset.key]; syncChips(); }));
  document.querySelectorAll('#modes .chip').forEach(b => b.addEventListener('click', () => { State.mode = +b.dataset.mode; syncChips(); }));
  $('resetView').addEventListener('click', () => { resetView(); clearExtras(); });
  function setDM(dm, then){
    if (State.dm === dm){ then && then(); return false; }
    State.dm = dm; syncChips(); clearExtras(); start(then); return true;
  }
  document.querySelectorAll('#gravity .chip').forEach(b => b.addEventListener('click', () => {
    const dm = b.dataset.dm === '1';
    if (dm === State.dm) return;
    setCaption(dm ? CAPTIONS.dmBack : CAPTIONS.nodm);
    const target = Math.max(ctl.done, 0);
    setDM(dm, () => { if (target > 0) jumpToStep(target); });
  }));
  document.querySelectorAll('#counts .chip').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.q === State.q) return;
    State.q = b.dataset.q; syncChips(); clearExtras();
    const target = ctl.done;
    start(() => { if (target > 0) jumpToStep(target); });
  }));
  document.querySelectorAll('#eras .chip').forEach(b => b.addEventListener('click', () => {
    const n = stepAtZ(+b.dataset.z);
    if (n === 0){ clearExtras(); start(); return; }
    jumpToStep(n);
  }));

  function setCaption(html){ $('caption').innerHTML = html; }
  const CAPTIONS = {
    cmb: 'The start, 47 million years after the Big Bang. The densest patches are only a few percent above average, so the colors are <b>boosted</b> to make the ripples visible; the readout says by how much. Press Play to watch them grow.',
    web: 'Today, seen as a slab about <b>90 million light-years</b> thick. Bright threads join at knots, and the dark gaps between them are voids. Most of the volume is void; most of the mass is in threads and knots.',
    nodes: 'The heaviest clump in this universe. Filaments feed it from several directions. Switch to <b>Speed</b> to see matter falling in faster than 1,000 km/s, and zoom out to see where the threads lead.',
    nodm: 'The same starting ripples, but only <b>ordinary matter</b> pulls. After 13.7 billion years the pattern is still faint, the heaviest clump is dozens of times lighter, and <b>no galaxies</b> have formed: the readout shows no stars and no hot gas. Switch gravity back above to compare.',
    dmBack: 'Dark matter\'s pull is back on. The same starting ripples now grow into the full web.',
    expand: 'Here the box is drawn at its <b>true size</b>. It starts 51 times smaller than today and swells as space expands. Clumps that gravity has pulled together stay the same size while the space between them grows.',
    home: 'A spot with surroundings like ours: a small group in a thin wall, about <b>54 million light-years</b> from the heaviest cluster, beside a void. The Milky Way and Andromeda would be two or three of these dots.',
    slice: 'Surveys map the sky in thin slices, measuring each galaxy\'s distance from its redshift. This is a slab of the simulation <b>90 million light-years</b> thick, much like one of those survey slices.',
    heat: 'Only the <b>gas</b>, colored by temperature. Gas falling onto filaments and clusters slams to a halt and heats up: violet threads at 100,000 K or more, red to white knots at 10–100 million K. The dark blue gas in the voids sits at about 10,000 K, warmed by the first stars.',
    galaxies: 'Dark matter with the <b>starlight</b> on top, from redshift 4. Blue-white points are gas turning into young stars; they fade to gold as the stars age. Watch the sparkle peak around z = 2, then die down.',
    reddead: 'The heaviest cluster, with its gas colored by temperature. The gas here is too hot to cool, so star formation has stopped. Its galaxies glow <b>gold</b> with old stars, while the cooler threads around it still sparkle blue.',
    size: '',
  };
  setCaption('Dark matter (dim) and gas, colored by temperature, with starlight where gas has turned into stars. Everything starts almost evenly spread. Denser patches pull in their neighbors and grow into <b>walls, threads and knots</b>; gas falling into them heats up, and galaxies light up.');

  const scrollToStage = () => $('stage').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  const TODAY = NSTEPS;
  function atToday(fn){ State.physical = false; if (ctl.done === TODAY && ctl.jumpTo === null) fn(); else jumpToStep(TODAY, fn); }
  function flyTo(pos, dist){ setCenter(pos); setCam({ dist }); }

  const layers = (dm, gas, gal) => { State.dmLayer = dm; State.gasLayer = gas; State.galLayer = gal; };
  const SHOWS = {
    cmb: () => { layers(true, false, false); setCaption(CAPTIONS.cmb); State.mode = 1; State.boost = true; State.slice = true; State.physical = false; resetView(); setCam({ yaw: Math.round(tgt.yaw / (Math.PI / 2)) * Math.PI / 2, pitch: 0 }); State.spin = false; setDM(true, null) || start(); State.playing = false; },
    web: () => { layers(true, false, true); setCaption(CAPTIONS.web); State.mode = 0; State.slice = true; resetView(); setCam({ dist: 1.15 }); setDM(true, () => atToday(() => {})) || atToday(() => {}); },
    nodes: () => {
      setCaption(CAPTIONS.nodes); State.mode = 1; State.slice = true; layers(true, false, false);
      const go = () => atToday(() => withCoarse(c => { const h = heaviest(c); lastClump = h; flyTo(h.pos, 0.2); }));
      setDM(true, go) || go();
    },
    nodm: () => { setCaption(CAPTIONS.nodm); layers(true, true, true); State.mode = 3; State.slice = true; resetView(); setDM(false, () => atToday(() => {})) || atToday(() => {}); },
    expand: () => { layers(true, false, false); setCaption(CAPTIONS.expand); State.physical = true; State.slice = false; State.mode = 0; setCenter([0.5, 0.5, 0.5]); setCam({ dist: 1.3, pitch: 0.3 }); State.playing = true; setDM(true, null) || start(); State.physical = true; },
    home: () => {
      setCaption(CAPTIONS.home); State.mode = 0; State.slice = true; layers(true, false, true);
      const go = () => atToday(() => withCoarse(c => {
        const cl = heaviest(c); lastClump = cl;
        const spot = homeSpot(c, cl);
        if (!spot) return;
        const r = 0.006;
        State.marker = { at: spot.pos, top: r * 1.6, data: new Float32Array(sphereLines(r)), html: `<b>A spot like ours</b><br>${Math.round(spot.d * MLY_PER_MPC)} million ly from the heaviest cluster` };
        flyTo(spot.pos, 0.22);
      }));
      setDM(true, go) || go();
    },
    slice: () => { layers(false, false, true); setCaption(CAPTIONS.slice); State.mode = 0; State.slice = true; resetView(); setCam({ dist: 1.15 }); setDM(true, () => atToday(() => {})) || atToday(() => {}); },
    heat: () => { setCaption(CAPTIONS.heat); layers(false, true, false); State.mode = 3; State.slice = true; resetView(); setCam({ dist: 1.15 }); setDM(true, () => atToday(() => {})) || atToday(() => {}); },
    galaxies: () => {
      setCaption(CAPTIONS.galaxies); layers(true, false, true); State.mode = 0; State.slice = true; resetView(); setCam({ dist: 1.1 });
      const go = () => { jumpToStep(stepAtZ(4)); State.playing = true; syncPlay(); };
      setDM(true, go) || go();
    },
    reddead: () => {
      setCaption(CAPTIONS.reddead); layers(false, true, true); State.mode = 3; State.slice = true;
      const go = () => atToday(() => withCoarse(c => { const h = heaviest(c); lastClump = h; flyTo(h.pos, 0.2); }));
      setDM(true, go) || go();
    },
    chart: () => { $('history').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }); },
    today: () => { layers(true, true, true); State.slice = false; resetView(); setDM(true, () => atToday(() => {})) || atToday(() => {}); },
  };
  function showSize(key){
    const s = SIZES[key];
    State.slice = false; State.physical = false; State.marker = null;
    const lines = new Float32Array(s.lines());
    let top = 0; for (let i = 1; i < lines.length; i += 3) top = Math.max(top, lines[i]);
    setCaption(`<b>${s.label}</b>, ${s.note}, drawn at true size against the box, which is 1 billion light-years across today.`);
    if (s.atCluster){
      State.mode = 1;
      const go = () => atToday(() => withCoarse(c => { const h = heaviest(c); lastClump = h; State.overlay = { at: h.pos, top: top * 1.3, data: lines, label: s.label, note: s.note }; flyTo(h.pos, s.dist); }));
      setDM(true, go) || go();
    } else {
      State.overlay = { at: center.slice(), top: top + 0.02, data: lines, label: s.label, note: s.note };
      setCam({ dist: s.dist });
    }
  }
  document.querySelectorAll('[data-show]').forEach(b => b.addEventListener('click', () => {
    if (!ready) return;
    if (b.dataset.show === 'chart'){ SHOWS.chart(); return; }
    State.overlay = null; State.marker = null;
    SHOWS[b.dataset.show]();
    syncChips(); syncPlay(); scrollToStage();
  }));
  document.querySelectorAll('[data-size]').forEach(b => b.addEventListener('click', () => {
    if (!ready) return;
    showSize(b.dataset.size); syncChips(); scrollToStage();
  }));

  if (location.hash === '#test') window.__cw = { State, ctl, jumpToStep, stepAtZ, SHOWS, showSize, start, eng: () => eng, history };
  syncChips(); syncPlay();
  resize();
  if (glOK){
    start(() => { if (reduceMotion) jumpToStep(NSTEPS); });
    requestAnimationFrame(frame);
  }
})();

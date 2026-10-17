// GPU split-operator Schrödinger solver (WebGL 2) on an N×N grid, atomic units. ψ lives in an RG32F
// texture (re, im); the potential in another (V, W) where W ≥ 0 is the absorbing part. One step:
// half kick · FFT · kinetic phase · inverse FFT · half kick (consecutive half kicks are merged).
// The absorbing "screen" (a band of columns where W > 0 and the flag channel is set) adds the
// probability it swallows each step to a per-row accumulator: the arrival distribution of the electron.
const TDSE = (gl, N, h) => {
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float unavailable');
  const LOG = Math.log2(N) | 0;
  if (1 << LOG !== N) throw new Error('N must be a power of two');
  const VS = `#version 300 es
  void main(){ vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
  const HDR = `#version 300 es
  precision highp float; precision highp int; precision highp sampler2D;
  #define N ${N}
  `;
  const FS = {
    // one radix-2 Stockham pass along x (uAxis 0) or y (1); natural order after LOG passes
    fft: `uniform sampler2D uSrc, uTw; uniform int uAxis, uNs; uniform float uSign; out vec4 o;
      void main(){
        ivec2 c = ivec2(gl_FragCoord.xy);
        int oi = c[uAxis], blk = oi / (2 * uNs), r = oi - blk * 2 * uNs, jm = r % uNs, j = blk * uNs + jm;
        ivec2 c0 = c, c1 = c; c0[uAxis] = j; c1[uAxis] = j + N / 2;
        vec2 a = texelFetch(uSrc, c0, 0).xy, b = texelFetch(uSrc, c1, 0).xy;
        // twiddle exp(uSign·iπ jm/Ns) from a table of exp(−2πi k/N) made in double precision: GPU
        // cos/sin are not exactly unit length and leak ~1e-6 of the norm per transform pair
        vec2 w = texelFetch(uTw, ivec2(jm * (N / (2 * uNs)), 0), 0).xy;
        w.y *= -uSign;
        vec2 bw = vec2(b.x * w.x - b.y * w.y, b.x * w.y + b.y * w.x);
        o = vec4(r < uNs ? a + bw : a - bw, 0.0, 0.0);
      }`,
    // kinetic phase exp(−i k²/2 dt) from a table made in double precision and polished to unit length
    // in float32 (a packet covers only a few k, so each entry's tiny |e| ≠ 1 compounds every step),
    // times the 1/N² of the inverse transform
    kin: `uniform sampler2D uSrc, uKin; out vec4 o;
      void main(){
        ivec2 c = ivec2(gl_FragCoord.xy);
        vec2 e = texelFetch(uKin, c, 0).xy;
        vec2 p = texelFetch(uSrc, c, 0).xy / float(N * N);
        o = vec4(p.x * e.x - p.y * e.y, p.x * e.y + p.y * e.x, 0.0, 0.0);
      }`,
    // potential kick exp(−i V dt)·exp(−W dt), tabulated on the CPU (uFac: rg = half step, ba = full step)
    kick: `uniform sampler2D uSrc, uFac; uniform int uFull; out vec4 o;
      void main(){
        ivec2 c = ivec2(gl_FragCoord.xy);
        vec4 f = texelFetch(uFac, c, 0); vec2 e = uFull == 1 ? f.zw : f.xy;
        vec2 p = texelFetch(uSrc, c, 0).xy;
        o = vec4(p.x * e.x - p.y * e.y, p.x * e.y + p.y * e.x, 0.0, 0.0);
      }`,
    // per-row screen accumulator: acc[y] += Σ_x∈screen |ψ|² (1 − e^{−2 W dt}) h²  (rows are texels of an N×1 target)
    screen: `uniform sampler2D uSrc, uPot, uAcc; uniform float uDt, uH2; uniform int uX0, uX1; out vec4 o;
      void main(){
        int y = int(gl_FragCoord.x);
        float s = 0.0;
        for (int x = uX0; x < uX1; x++){
          vec4 vw = texelFetch(uPot, ivec2(x, y), 0);
          if (vw.z > 0.5){ vec2 p = texelFetch(uSrc, ivec2(x, y), 0).xy; s += dot(p, p) * (1.0 - exp(-2.0 * vw.y * uDt)); }
        }
        o = vec4(texelFetch(uAcc, ivec2(y, 0), 0).x + s * uH2, 0.0, 0.0, 0.0);
      }`,
    // Gaussian packet written on the GPU
    gauss: `uniform vec2 uC, uS, uK; uniform float uAmp, uH; out vec4 o;
      void main(){
        vec2 r = (gl_FragCoord.xy - 0.5) * uH - uC;
        float amp = uAmp * exp(-dot(r * r, 1.0 / (4.0 * uS * uS))), ph = dot(uK, r);
        o = vec4(amp * cos(ph), amp * sin(ph), 0.0, 0.0);
      }`,
    // multiply ψ by a mask texture's red channel (projective measurement), scaled
    mask: `uniform sampler2D uSrc, uMask; uniform float uScale; out vec4 o;
      void main(){ ivec2 c = ivec2(gl_FragCoord.xy); o = vec4(texelFetch(uSrc, c, 0).xy * texelFetch(uMask, c, 0).r * uScale, 0.0, 0.0); }`,
    // reduction to a (N/8)² texture of partial sums: (Σ|ψ|², Σ|ψ|² x, Σ|ψ|² y, Σ_mask |ψ|²)
    reduce1: `uniform sampler2D uSrc, uMask; uniform float uH; uniform int uUseMask; out vec4 o;
      void main(){
        ivec2 b = ivec2(gl_FragCoord.xy) * 8; vec4 s = vec4(0.0);
        for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++){
          ivec2 c = b + ivec2(i, j); vec2 p = texelFetch(uSrc, c, 0).xy; float q = dot(p, p);
          vec2 x = (vec2(c) + 0.5) * uH;
          s += vec4(q, q * x.x, q * x.y, uUseMask == 1 ? q * texelFetch(uMask, c, 0).r : 0.0);
        }
        o = s;
      }`,
    reduce: `uniform sampler2D uSrc; out vec4 o;
      void main(){
        ivec2 b = ivec2(gl_FragCoord.xy) * 8; ivec2 sz = textureSize(uSrc, 0); vec4 s = vec4(0.0);
        for (int j = 0; j < 8; j++) for (int i = 0; i < 8; i++){ ivec2 c = b + ivec2(i, j); if (c.x < sz.x && c.y < sz.y) s += texelFetch(uSrc, c, 0); }
        o = s;
      }`,
  };
  function compile(type, src){
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
    return s;
  }
  const vs = compile(gl.VERTEX_SHADER, VS), prog = {};
  for (const k in FS){
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, compile(gl.FRAGMENT_SHADER, HDR + FS[k])); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++){ const nm = gl.getActiveUniform(p, i).name; u[nm] = gl.getUniformLocation(p, nm); }
    prog[k] = { p, u };
  }
  function target(w, ht, ifmt, fmt, data = null){
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, ht, 0, fmt, gl.FLOAT, data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h: ht, ifmt, fmt };
  }
  const E = { N, h, LOG, t: 0 };
  E.psi = [0, 1].map(() => target(N, N, gl.RG32F, gl.RG));
  E.pot = target(N, N, gl.RGBA32F, gl.RGBA);
  E.maskT = target(N, N, gl.R32F, gl.RED);
  E.acc = [0, 1].map(() => target(N, 1, gl.R32F, gl.RED));
  E.red = []; for (let s = N / 8; s >= 1; s = Math.floor(s / 8)) { E.red.push(target(Math.max(1, s), Math.max(1, s), gl.RGBA32F, gl.RGBA)); if (s === 1) break; }
  E.c = 0; E.a = 0;
  const vao = gl.createVertexArray();
  function pass(pr, tgt, setup){
    gl.useProgram(pr.p); gl.bindFramebuffer(gl.FRAMEBUFFER, tgt.f); gl.viewport(0, 0, tgt.w, tgt.h);
    let unit = 0;
    const bind = (name, tex) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex.t); gl.uniform1i(pr.u[name], unit); unit++; };
    setup(bind, pr.u);
    gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function psiPass(pr, setup){
    const src = E.psi[E.c], dst = E.psi[1 - E.c];
    pass(pr, dst, (bind, u) => { bind('uSrc', src); setup && setup(bind, u); });
    E.c = 1 - E.c;
  }
  function fft(sign){
    for (let axis = 0; axis < 2; axis++) for (let Ns = 1; Ns < N; Ns *= 2)
      psiPass(prog.fft, (b, u) => { b('uTw', E.tw); gl.uniform1i(u.uAxis, axis); gl.uniform1i(u.uNs, Ns); gl.uniform1f(u.uSign, sign); });
  }
  const kick = full => psiPass(prog.kick, (b, u) => { b('uFac', E.fac); gl.uniform1i(u.uFull, full ? 1 : 0); });
  const drift = () => { fft(-1); psiPass(prog.kin, (b) => b('uKin', E.kin)); fft(1); };
  // write d·e^{ia} into arr[i], arr[i+1] as float32; when d = 1 nudge the pair by up to 2 ulps so its
  // length is 1 to ~1e-10 (round-to-nearest alone leaves |e|² − 1 ~ 1e-7, a steady leak of norm)
  const f32 = new Float32Array(1), i32 = new Int32Array(f32.buffer);
  const nudge = (v, k) => { f32[0] = v; i32[0] += k; return f32[0]; };
  function unitPhase(arr, i, a, d){
    const c = Math.cos(a) * d, s = Math.sin(a) * d;
    arr[i] = c; arr[i + 1] = s;
    if (d !== 1) return;
    const c0 = arr[i], s0 = arr[i + 1];
    let best = Math.abs(c0 * c0 + s0 * s0 - 1), bc = c0, bs = s0;
    for (let p = -2; p <= 2; p++) for (let q = -2; q <= 2; q++){
      const cc = nudge(c0, p), ss = nudge(s0, q), e = Math.abs(cc * cc + ss * ss - 1);
      if (e < best){ best = e; bc = cc; bs = ss; }
    }
    arr[i] = bc; arr[i + 1] = bs;
  }
  { const tw = new Float32Array(2 * N); for (let k = 0; k < N / 2; k++) unitPhase(tw, 2 * k, -2 * Math.PI * k / N, 1);
    E.tw = target(N, 1, gl.RG32F, gl.RG, tw); }
  // tables for time step dt: kinetic phases and the potential kick factors
  E.dt = NaN; E.potCPU = new Float32Array(4 * N * N);
  E.kin = target(N, N, gl.RG32F, gl.RG); E.fac = target(N, N, gl.RGBA32F, gl.RGBA);
  const facCPU = new Float32Array(4 * N * N);
  function buildKin(){
    const t = new Float32Array(2 * N * N), dk = 2 * Math.PI / (N * h), k2 = new Float64Array(N);
    for (let i = 0; i < N; i++) k2[i] = ((i < N / 2 ? i : i - N) * dk) ** 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) unitPhase(t, 2 * (x + N * y), -0.5 * (k2[x] + k2[y]) * E.dt, 1);
    gl.bindTexture(gl.TEXTURE_2D, E.kin.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RG, gl.FLOAT, t);
  }
  // rebuild kick factors for rows [y0, y1)
  function buildFac(y0 = 0, y1 = N){
    const P = E.potCPU, dt = E.dt;
    for (let k = y0 * N; k < y1 * N; k++){
      const V = P[4 * k], W = P[4 * k + 1];
      for (const [o, s] of [[0, 0.5 * dt], [2, dt]]) unitPhase(facCPU, 4 * k + o, -V * s, Math.exp(-W * s));
    }
    gl.bindTexture(gl.TEXTURE_2D, E.fac.t);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, N, y1 - y0, gl.RGBA, gl.FLOAT, facCPU.subarray(4 * y0 * N, 4 * y1 * N));
  }
  E.setDt = dt => { if (dt === E.dt) return; E.dt = dt; buildKin(); buildFac(); };
  E.screenX = null; // [x0, x1) columns of the screen band, or null
  function screenAcc(dt){
    if (!E.screenX) return;
    const src = E.acc[E.a], dst = E.acc[1 - E.a];
    pass(prog.screen, dst, (b, u) => { b('uSrc', E.psi[E.c]); b('uPot', E.pot); b('uAcc', src); gl.uniform1f(u.uDt, dt); gl.uniform1f(u.uH2, h * h); gl.uniform1i(u.uX0, E.screenX[0]); gl.uniform1i(u.uX1, E.screenX[1]); });
    E.a = 1 - E.a;
  }
  // n steps of size dt. The screen accounting samples ψ once per step, before the full kick.
  E.step = (dt, n = 1) => {
    E.setDt(dt);
    kick(false);
    for (let i = 0; i < n; i++){
      drift();
      screenAcc(dt);
      kick(i < n - 1);
    }
    E.t += n * dt;
  };
  // potential upload: V (Hartree), W (absorbing, Hartree), screen flag, and a spare channel for drawing
  // (rows y0..y1 only when given, for painting)
  E.setPotential = (rgba, y0 = 0, y1 = N) => {
    if (rgba !== E.potCPU) E.potCPU.set(rgba.subarray(4 * y0 * N, 4 * y1 * N), 4 * y0 * N);
    gl.bindTexture(gl.TEXTURE_2D, E.pot.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, y0, N, y1 - y0, gl.RGBA, gl.FLOAT, E.potCPU.subarray(4 * y0 * N, 4 * y1 * N));
    if (E.dt) buildFac(y0, y1);
  };
  E.setMask = (r) => { gl.bindTexture(gl.TEXTURE_2D, E.maskT.t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RED, gl.FLOAT, r); };
  E.setPsi = (rg) => { gl.bindTexture(gl.TEXTURE_2D, E.psi[E.c].t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RG, gl.FLOAT, rg); };
  E.gaussian = (x0, y0, sx, sy, kx, ky) => {
    const amp = 1 / Math.sqrt(2 * Math.PI * sx * sy);
    pass(prog.gauss, E.psi[E.c], (b, u) => { gl.uniform2f(u.uC, x0, y0); gl.uniform2f(u.uS, sx, sy); gl.uniform2f(u.uK, kx, ky); gl.uniform1f(u.uAmp, amp); gl.uniform1f(u.uH, h); });
    E.t = 0;
  };
  E.applyMask = (scale = 1) => psiPass(prog.mask, (b, u) => { b('uMask', E.maskT); gl.uniform1f(u.uScale, scale); });
  E.clearScreen = () => { for (const a of E.acc){ gl.bindFramebuffer(gl.FRAMEBUFFER, a.f); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); } };
  // (norm, <x>, <y>, masked norm) via an 8×8 reduction chain and a 1-texel readback
  E.moments = (useMask = false) => {
    pass(prog.reduce1, E.red[0], (b, u) => { b('uSrc', E.psi[E.c]); b('uMask', E.maskT); gl.uniform1f(u.uH, h); gl.uniform1i(u.uUseMask, useMask ? 1 : 0); });
    for (let i = 1; i < E.red.length; i++) pass(prog.reduce, E.red[i], (b) => b('uSrc', E.red[i - 1]));
    const last = E.red[E.red.length - 1], out = new Float32Array(4 * last.w * last.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, last.f); gl.readPixels(0, 0, last.w, last.h, gl.RGBA, gl.FLOAT, out);
    const s = [0, 0, 0, 0]; for (let i = 0; i < out.length; i++) s[i & 3] += out[i];
    const h2 = h * h;
    return { norm: s[0] * h2, x: s[1] / s[0], y: s[2] / s[0], masked: s[3] * h2 };
  };
  E.readScreen = () => { const tmp = new Float32Array(4 * N), out = new Float32Array(N); gl.bindFramebuffer(gl.FRAMEBUFFER, E.acc[E.a].f); gl.readPixels(0, 0, N, 1, gl.RGBA, gl.FLOAT, tmp); for (let i = 0; i < N; i++) out[i] = tmp[4 * i]; return out; };
  E.readPsi = () => { const out = new Float32Array(2 * N * N), tmp = new Float32Array(4 * N * N); gl.bindFramebuffer(gl.FRAMEBUFFER, E.psi[E.c].f); gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, tmp); for (let i = 0; i < N * N; i++){ out[2 * i] = tmp[4 * i]; out[2 * i + 1] = tmp[4 * i + 1]; } return out; };
  E.psiTex = () => E.psi[E.c].t;
  E.finish = () => { const px = new Float32Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, E.psi[E.c].f); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, px); };
  return E;
};
if (typeof module !== 'undefined') module.exports = TDSE;

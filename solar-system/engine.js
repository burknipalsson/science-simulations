/* The Clockwork: WebGL 2 renderers.
   SolarGL    the main view: stars and Milky Way, orbits, asteroids, the Sun, lit planets (textured Earth and Moon),
              Saturn's rings with shadows, the light-speed shell.
   AsteroidSim  massless test particles advanced on the GPU with transform feedback (Kepler drift + planet kicks).
   GlobeGL    the eclipse globe: day/night Earth with the Moon's shadow and the path of totality.
   LabGL      the resonance lab's views: Jupiter's rotating frame and the eccentricity-vs-distance plane. */
const GLKit = (() => {
  const HDR = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
  function sh(gl, type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ' ' + l).join('\n'));
    return s;
  }
  function prog(gl, vs, fs, tf) {
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl, gl.VERTEX_SHADER, HDR + vs)); gl.attachShader(p, sh(gl, gl.FRAGMENT_SHADER, HDR + fs));
    if (tf) gl.transformFeedbackVaryings(p, tf, gl.SEPARATE_ATTRIBS);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  function texture(gl, src, cb) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 60, 90, 255]));
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const an = gl.getExtension('EXT_texture_filter_anisotropic'); if (an) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
      if (cb) cb();
    };
    img.src = src;
    return t;
  }
  // Exact Kepler drift in float32 (Danby's f and g), shared by the integrator and the display shaders.
  const KEPLER = `
  uniform float uMu;
  bool kepler(inout vec3 x, inout vec3 v, float dt){
    float r0 = length(x), v2 = dot(v, v), u = dot(x, v);
    float ia = 2. / r0 - v2 / uMu;
    if (ia < 2e-4) return false;                     // unbound or beyond 5000 AU: gone
    float a = 1. / ia, n = sqrt(uMu * ia * ia * ia);
    float ec = 1. - r0 * ia, es = u / (n * a * a), dM = n * dt;
    float dE = dM;
    for (int i = 0; i < 16; i++){
      float s = sin(dE), c = 2. * sin(.5 * dE) * sin(.5 * dE);
      float f = dE - ec * s + es * c - dM, fp = 1. - ec * (1. - c) + es * s;
      float d = f / fp; dE -= d; if (abs(d) < 1e-7) break;
    }
    float s = sin(dE), omc = 2. * sin(.5 * dE) * sin(.5 * dE);
    float smd = abs(dE) < 0.2 ? -dE * dE * dE / 6. * (1. - dE * dE / 20. * (1. - dE * dE / 42.)) : s - dE;
    float f = 1. - a / r0 * omc, g = dt + smd / n;
    float r = a * (1. - ec * (1. - omc) + es * s);
    float fd = -a * a * n * s / (r * r0), gd = 1. - a / r * omc;
    vec3 x1 = f * x + g * v; v = fd * x + gd * v; x = x1;
    return true;
  }`;
  return { HDR, prog, texture, KEPLER };
})();

/* ================================================================
   AsteroidSim: state in two ping-pong buffers, vec4 P (xyz AU heliocentric, w class code; negative = lost)
   and vec4 V (xyz AU/day, w spare). One pass = K drift-kick-drift steps of length dt, with the planets'
   heliocentric positions at each mid-step supplied as a uniform array.
   ================================================================ */
function AsteroidSim(gl, n, P0, V0, opts = {}) {
  const NPL_MAX = 8, K_MAX = 32;
  const STEP = GLKit.prog(gl, `
  layout(location = 0) in vec4 aP; layout(location = 1) in vec4 aV;
  uniform float uDt; uniform int uK, uNPL; uniform vec3 uPl[${NPL_MAX * K_MAX}]; uniform float uGM[${NPL_MAX}];
  uniform float uQmin, uRmax;
  out vec4 oP; out vec4 oV;
  ${GLKit.KEPLER}
  void main(){
    vec3 x = aP.xyz, v = aV.xyz; float cls = aP.w;
    if (cls >= 0.) {
      for (int k = 0; k < ${K_MAX}; k++){
        if (k >= uK) break;
        if (!kepler(x, v, .5 * uDt)) { cls = -1. - cls; break; }
        vec3 acc = vec3(0.);
        for (int p = 0; p < ${NPL_MAX}; p++){
          if (p >= uNPL) break;
          vec3 pp = uPl[k * uNPL + p], d = pp - x;
          float id = inversesqrt(dot(d, d)), ir = inversesqrt(dot(pp, pp));
          acc += uGM[p] * (d * id * id * id - pp * ir * ir * ir);
        }
        v += acc * uDt;
        if (!kepler(x, v, .5 * uDt)) { cls = -1. - cls; break; }
      }
      if (cls >= 0.) {
        float r = length(x), ia = 2. / r - dot(v, v) / uMu, a = 1. / ia;
        vec3 h = cross(x, v); float e = sqrt(max(0., 1. - dot(h, h) * ia / uMu));
        if (r > uRmax || (uQmin > 0. && a * (1. - e) < uQmin)) cls = -1. - cls;
      }
    }
    oP = vec4(x, cls); oV = vec4(v, aV.w);
  }`, `out vec4 o; void main(){ o = vec4(0.); }`, ['oP', 'oV']);

  const buf = [0, 1].map(() => [gl.createBuffer(), gl.createBuffer()]);
  const vao = [0, 1].map(i => {
    const v = gl.createVertexArray(); gl.bindVertexArray(v);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf[i][0]); gl.bufferData(gl.ARRAY_BUFFER, i === 0 ? P0 : P0.byteLength, gl.DYNAMIC_COPY);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf[i][1]); gl.bufferData(gl.ARRAY_BUFFER, i === 0 ? V0 : V0.byteLength, gl.DYNAMIC_COPY);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null); return v;
  });
  const tfo = gl.createTransformFeedback();
  let cur = 0;
  const self = {
    n, K_MAX, NPL_MAX,
    get vao() { return vao[cur]; },
    get buffers() { return buf[cur]; },
    load(P, V) { gl.bindBuffer(gl.ARRAY_BUFFER, buf[cur][0]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, P); gl.bindBuffer(gl.ARRAY_BUFFER, buf[cur][1]); gl.bufferSubData(gl.ARRAY_BUFFER, 0, V); },
    // pl: Float32Array(K * npl * 3) heliocentric AU; gm: Float32Array(npl)
    step(dt, K, pl, gm, npl, mu, qmin = 0, rmax = 5000) {
      gl.useProgram(STEP.p);
      gl.uniform1f(STEP.u.uDt, dt); gl.uniform1i(STEP.u.uK, K); gl.uniform1i(STEP.u.uNPL, npl);
      gl.uniform3fv(STEP.u.uPl, pl, 0, K * npl * 3); gl.uniform1fv(STEP.u.uGM, gm);
      gl.uniform1f(STEP.u.uMu, mu); gl.uniform1f(STEP.u.uQmin, qmin); gl.uniform1f(STEP.u.uRmax, rmax);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
      gl.bindVertexArray(vao[cur]);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, tfo);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, buf[1 - cur][0]);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, buf[1 - cur][1]);
      gl.enable(gl.RASTERIZER_DISCARD);
      gl.beginTransformFeedback(gl.POINTS); gl.drawArrays(gl.POINTS, 0, n); gl.endTransformFeedback();
      gl.disable(gl.RASTERIZER_DISCARD);
      gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, null); gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 1, null);
      gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null); gl.bindVertexArray(null);
      cur = 1 - cur;
    },
    read(outP, outV) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf[cur][0]); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, outP);
      if (outV) { gl.bindBuffer(gl.ARRAY_BUFFER, buf[cur][1]); gl.getBufferSubData(gl.ARRAY_BUFFER, 0, outV); }
    },
  };
  return self;
}

/* ================================================================
   SolarGL: the main view
   ================================================================ */
function SolarGL(gl, tex) {
  const { prog } = GLKit;
  gl.getExtension('EXT_color_buffer_float');

  /* ---------- stars and the Milky Way (ecliptic frame) ---------- */
  const STARS = prog(gl, `
  const vec2 P[3] = vec2[3](vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.));
  out vec2 vN; void main(){ vec2 p = P[gl_VertexID]; vN = p; gl_Position = vec4(p, 0.9999, 1.); }`, `
  in vec2 vN; out vec4 o;
  uniform vec3 uFwd, uRight, uUp; uniform vec2 uTan; uniform float uDim;
  vec4 hash4(vec3 p){ vec4 q = fract(vec4(p.xyzx) * vec4(.1031, .1030, .0973, .1099)); q += dot(q, q.wzxy + 33.33); return fract((q.xxyz + q.yzzw) * q.zywx); }
  float noise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
    float a = hash4(i).x, b = hash4(i + vec3(1,0,0)).x, c = hash4(i + vec3(0,1,0)).x, d = hash4(i + vec3(1,1,0)).x;
    float e = hash4(i + vec3(0,0,1)).x, g = hash4(i + vec3(1,0,1)).x, h = hash4(i + vec3(0,1,1)).x, k = hash4(i + vec3(1,1,1)).x;
    return mix(mix(mix(a, b, f.x), mix(c, d, f.x), f.y), mix(mix(e, g, f.x), mix(h, k, f.x), f.y), f.z); }
  const vec3 GNP = vec3(-0.8676, -0.0003, 0.4972);   // galactic north pole, ecliptic J2000
  const vec3 GC = vec3(-0.0551, -0.9942, -0.0965);   // galactic centre (Sagittarius)
  vec3 layer(vec3 d, float sc, float thr, float sz, float boost){
    vec3 q = d * sc, c = floor(q); vec4 h = hash4(c);
    float t = thr - boost; if (h.w < t) return vec3(0.);
    vec3 sp = c + 0.5 + 0.7 * (h.xyz - 0.5); float r = length(q - sp);
    float b = pow((h.w - t) / (1. - t), 3.);
    vec3 col = mix(vec3(1.0, 0.8, 0.62), vec3(0.72, 0.83, 1.0), h.x);
    return col * b * exp(-r * r / (sz * sz)) * 2.4;
  }
  void main(){
    vec3 d = normalize(uFwd + vN.x * uTan.x * uRight + vN.y * uTan.y * uUp);
    float gb = dot(d, GNP), band = exp(-gb * gb / 0.018);
    float bulge = exp(-pow(acos(clamp(dot(d, GC), -1., 1.)) / 0.45, 2.));
    vec3 c = layer(d, 240., 0.93, 0.07, 0.04 * band) + layer(d, 100., 0.955, 0.05, 0.02 * band) * 1.4 + layer(d, 600., 0.9, 0.09, 0.06 * band) * 0.45;
    float cloud = noise(d * 9.) * 0.6 + noise(d * 23.) * 0.3 + noise(d * 61.) * 0.1;
    float dust = smoothstep(0.45, 0.75, noise(d * 14. + 3.)) * exp(-gb * gb / 0.002);
    vec3 mw = vec3(0.075, 0.07, 0.085) * band * (0.35 + cloud) * (1. - 0.7 * dust) + vec3(0.13, 0.1, 0.07) * bulge * band * (0.5 + cloud);
    c += mw;
    c += vec3(0.004, 0.005, 0.009);
    o = vec4(c * uDim, 1.);
  }`);

  /* ---------- orbit lines ---------- */
  const LINES = prog(gl, `
  layout(location = 0) in vec4 aP;
  uniform mat4 uVP; uniform vec4 uCol; out float vA;
  void main(){ gl_Position = uVP * vec4(aP.xyz, 1.); vA = aP.w; }`, `
  in float vA; uniform vec4 uCol; out vec4 o; void main(){ o = vec4(uCol.rgb, uCol.a * vA); }`);
  const lineBuf = gl.createBuffer(), lineVao = gl.createVertexArray();
  gl.bindVertexArray(lineVao); gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);

  /* ---------- asteroids as points ---------- */
  const ASTP = prog(gl, `
  layout(location = 0) in vec4 aP; layout(location = 1) in vec4 aV;
  uniform mat4 uVP; uniform mat3 uRot; uniform vec3 uSunRel; uniform float uDtDisp, uPt, uAlpha, uMaskBits, uScale;
  out vec4 vC;
  ${GLKit.KEPLER}
  const vec3 COL[7] = vec3[7](vec3(0.78, 0.74, 0.68), vec3(0.95, 0.62, 0.3), vec3(0.45, 0.85, 0.55), vec3(1.0, 0.36, 0.3), vec3(0.8, 0.55, 0.95), vec3(0.5, 0.72, 1.0), vec3(0.78, 0.74, 0.68));
  void main(){
    float cls = aP.w;
    if (cls < 0.) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }
    int c = int(cls + 0.5);
    float bit = mod(floor(uMaskBits / exp2(float(c))), 2.);
    if (bit < 0.5) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }
    vec3 x = aP.xyz, v = aV.xyz;
    if (abs(uDtDisp) > 1e-6) kepler(x, v, uDtDisp);
    vec3 p = uRot * (uSunRel + x * uScale);
    gl_Position = uVP * vec4(p, 1.);
    float H = aV.w;
    float b = clamp(exp2((15.5 - H) * 0.2), 0.5, 2.5);
    gl_PointSize = uPt * (H < 9. ? 1.6 : 1.);
    vC = vec4(COL[c], uAlpha * b * (c == 0 ? 1. : c == 5 || c == 4 ? 1.3 : c == 1 ? 2.6 : 1.7));
  }`, `
  in vec4 vC; out vec4 o;
  void main(){ vec2 q = gl_PointCoord * 2. - 1.; float r2 = dot(q, q); if (r2 > 1.) discard; o = vec4(vC.rgb * vC.a * exp(-r2 * 2.2), 1.); }`);

  /* ---------- sphere impostors: Sun, planets, Moon ---------- */
  const SPHERE_VS = `
  const vec2 Q[4] = vec2[4](vec2(-1., -1.), vec2(1., -1.), vec2(-1., 1.), vec2(1., 1.));
  uniform mat4 uP; uniform vec3 uC; uniform float uR, uGrow;
  out vec3 vV;
  void main(){
    vec2 q = Q[gl_VertexID];
    float d = length(uC), s = uR * uGrow * d / sqrt(max(d * d - uR * uR, 1e-30));
    vec3 z = -normalize(uC), x = normalize(cross(vec3(0., 1., 0.), z)), y = cross(z, x);
    vec3 p = uC + (x * q.x + y * q.y) * s;
    vV = p; gl_Position = uP * vec4(p, 1.);
  }`;
  const PLANET = prog(gl, SPHERE_VS, `
  in vec3 vV; out vec4 o;
  uniform vec3 uC, uL; uniform float uR, uKind, uTime, uEclipse; uniform mat3 uToBody;
  uniform vec3 uCol, uCol2; uniform sampler2D uDay, uNight, uMoon;
  uniform vec3 uRingN; uniform vec2 uRing;      // ring plane normal (view), inner/outer radius in planet radii
  uniform vec4 uOcc;                             // an occluding sphere (the Moon for Earth, Earth for the Moon): view centre, radius
  uniform float uSunR;                           // Sun radius as seen here, in view units at unit distance: angular radius (rad)
  uniform vec3 uSunC;                            // Sun centre, view space
  float h1(float n){ return fract(sin(n) * 43758.5453); }
  float vnoise(vec3 p){ vec3 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f); float n = dot(i, vec3(1., 57., 113.));
    return mix(mix(mix(h1(n), h1(n + 1.), f.x), mix(h1(n + 57.), h1(n + 58.), f.x), f.y), mix(mix(h1(n + 113.), h1(n + 114.), f.x), mix(h1(n + 170.), h1(n + 171.), f.x), f.y), f.z); }
  float fbm(vec3 p){ float s = 0., a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
  // fraction of the Sun's disk hidden by a sphere (for eclipses seen from a surface point)
  float sunVisible(vec3 p){
    if (uOcc.w <= 0.) return 1.;
    vec3 ds = uSunC - p, dm = uOcc.xyz - p; float ls = length(ds), lm = length(dm);
    if (dot(ds, dm) < 0.) return 1.;
    float rs = uSunR, rm = asin(min(1., uOcc.w / lm)), sep = acos(clamp(dot(ds, dm) / (ls * lm), -1., 1.));
    if (sep >= rs + rm) return 1.;
    if (sep <= rm - rs) return 0.;                       // total
    if (sep <= rs - rm) return 1. - (rm * rm) / (rs * rs); // annular
    // partial overlap of two discs (small-angle)
    float a = rs, b = rm, dd = sep;
    float x = (dd * dd + a * a - b * b) / (2. * dd);
    float A = a * a * acos(clamp(x / a, -1., 1.)) + b * b * acos(clamp((dd - x) / b, -1., 1.)) - dd * sqrt(max(0., a * a - x * x));
    return 1. - A / (3.14159265 * a * a);
  }
  void main(){
    vec3 rd = normalize(vV);
    float b = dot(rd, uC), c = dot(uC, uC) - uR * uR, disc = b * b - c;
    if (disc < 0.) discard;
    float t = b - sqrt(disc);
    vec3 p = rd * t, n = normalize(p - uC);
    vec3 bn = uToBody * n;                     // body-fixed normal
    float lon = atan(bn.y, bn.x), lat = asin(clamp(bn.z, -1., 1.));
    vec2 uv = vec2(fract(lon / 6.2831853 + 0.5), 0.5 - lat / 3.1415926);
    float ndl = dot(n, uL);
    int k = int(uKind + 0.5);
    vec3 col; float lit = smoothstep(-0.02, 0.08, ndl) * max(ndl, 0.) ;
    float rim = pow(1. - max(dot(n, -rd), 0.), 3.);
    float shade = sunVisible(uC + n * uR);
    // ring shadow on the planet
    if (uRing.y > 0.) {
      float den = dot(uL, uRingN);
      if (abs(den) > 1e-4) {
        vec3 ps = p; float tt = -dot(ps - uC, uRingN) / den;
        if (tt > 0.) { float rr = length(ps + uL * tt - uC) / uR; if (rr > uRing.x && rr < uRing.y) shade *= 0.35 + 0.65 * smoothstep(1.92, 2.0, rr) * (1. - smoothstep(2.0, 2.05, rr)); }
      }
    }
    if (k == 3) { // Earth
      vec3 day = texture(uDay, uv).rgb;
      float night = texture(uNight, uv).r;
      float ocean = smoothstep(0.08, 0.02, day.r - day.b * 0.55) * step(day.b, 0.5);
      vec3 h = normalize(uL - rd); float spec = pow(max(dot(n, h), 0.), 60.) * ocean * 0.5;
      float dl = max(ndl, 0.);
      col = pow(day, vec3(0.85)) * 1.45 * pow(dl, 0.8) * shade + vec3(1.0, 0.85, 0.6) * spec * shade * step(0., ndl);
      col += vec3(1.0, 0.78, 0.45) * night * night * 1.4 * smoothstep(0.1, -0.15, ndl);
      // umbra: a hint of red sky glow at the edge
      col += vec3(0.35, 0.55, 1.0) * rim * (0.35 * smoothstep(-0.2, 0.3, ndl)) * (0.2 + 0.8 * shade);
      o = vec4(col, 1.); return;
    }
    if (k == 4) { // Moon
      vec3 m = texture(uMoon, uv).rgb * 1.35;
      col = m * lit * shade;
      // light passing through Earth's atmosphere turns the eclipsed Moon copper
      col += m * vec3(0.55, 0.16, 0.05) * (1. - shade) * uEclipse * max(ndl, 0.) * 0.55;
      o = vec4(col, 1.); return;
    }
    if (k == 0) { // Sun
      float mu = max(dot(n, -rd), 0.);
      float g = fbm(bn * 60. + uTime * 0.02) * 0.5 + fbm(bn * 13. - uTime * 0.01) * 0.5;
      vec3 base = vec3(1.0, 0.86, 0.62) * (0.35 + 0.65 * pow(mu, 0.5)) * (0.92 + 0.16 * g);
      o = vec4(base * 1.6, 1.); return;
    }
    float f;
    if (k == 5 || k == 6) { // Jupiter, Saturn: banded
      float la = bn.z;
      float turb = fbm(vec3(lon * 3., la * 18., uTime * 0.0) + vec3(0., 0., float(k)));
      float bands = sin(la * (k == 5 ? 24. : 30.) + turb * 2.4) * 0.5 + 0.5;
      col = mix(uCol, uCol2, bands);
      if (k == 5) { // Great Red Spot
        vec2 q = vec2((mod(lon + 1.1, 6.2831853) - 3.14159) * 0.9, (lat + 0.39) * 3.5);
        float spot = exp(-dot(q, q) * 12.); col = mix(col, vec3(0.78, 0.42, 0.3), spot * 0.75);
      }
      col *= 0.85 + 0.3 * turb;
    } else {
      f = fbm(bn * (k == 5 ? 6. : 4.) + float(k) * 7.);
      col = mix(uCol, uCol2, smoothstep(0.35, 0.7, f));
      if (k == 7 || k == 8) col = mix(uCol, uCol2, 0.5 + 0.5 * sin(bn.z * 10. + f));
    }
    col = col * lit * shade + col * 0.02;
    if (k == 2 || k == 7 || k == 8) col += uCol * rim * 0.35 * smoothstep(-0.3, 0.3, ndl);
    o = vec4(col, 1.);
  }`);

  const GLOW = prog(gl, SPHERE_VS, `
  in vec3 vV; out vec4 o; uniform vec3 uC; uniform float uR, uGrow, uI; uniform vec3 uCol;
  void main(){
    vec3 rd = normalize(vV); float d = length(uC);
    float ang = acos(clamp(dot(rd, uC / d), -1., 1.)), ar = asin(min(1., uR / d));
    float x = ang / ar;
    float g = uI * (0.9 / (1. + pow(max(x - 1., 0.) * 5., 1.6)) + 0.35 * exp(-(x - 1.) * 0.6)) * step(1., x);
    o = vec4(uCol * g, 1.);
  }`);

  const RING = prog(gl, `
  const vec2 Q[4] = vec2[4](vec2(-1., -1.), vec2(1., -1.), vec2(-1., 1.), vec2(1., 1.));
  uniform mat4 uP; uniform vec3 uC, uAx, uAy; uniform float uRo;
  out vec3 vV;
  void main(){ vec2 q = Q[gl_VertexID]; vec3 p = uC + (uAx * q.x + uAy * q.y) * uRo; vV = p; gl_Position = uP * vec4(p, 1.); }`, `
  in vec3 vV; out vec4 o;
  uniform vec3 uC, uN, uL; uniform float uR, uHalf;   // uHalf: +1 draw the near half, -1 the far half
  void main(){
    vec3 rd = normalize(vV); float den = dot(rd, uN);
    if (abs(den) < 1e-6) discard;
    float t = dot(uC, uN) / den; vec3 p = rd * t;
    if (uHalf * (length(uC) - t) < 0.) discard;
    float r = length(p - uC) / uR;
    if (r < 1.24 || r > 2.33) discard;
    float a = 0.;
    a += smoothstep(1.24, 1.26, r) * (1. - smoothstep(1.51, 1.53, r)) * 0.18;             // C ring
    a += smoothstep(1.52, 1.56, r) * (1. - smoothstep(1.93, 1.95, r)) * (0.75 + 0.2 * sin(r * 140.));   // B ring
    a += smoothstep(2.02, 2.03, r) * (1. - smoothstep(2.26, 2.27, r)) * (0.5 + 0.1 * sin(r * 200.)) * (1. - 0.9 * exp(-pow((r - 2.214) / 0.004, 2.)));   // A ring with the Encke gap
    a += exp(-pow((r - 2.326) / 0.003, 2.)) * 0.3;                                        // F ring
    // planet's shadow on the rings
    vec3 w = p - uC; float bb = dot(w, uL); vec3 perp = w - uL * bb;
    float sh = (bb < 0. && length(perp) < uR) ? 0.08 : 1.;
    float lit = 0.35 + 0.65 * abs(dot(uN, uL));
    vec3 col = mix(vec3(0.72, 0.64, 0.52), vec3(0.95, 0.9, 0.8), smoothstep(1.5, 2.1, r)) * lit * sh;
    o = vec4(col * a, a);
  }`);

  /* light-speed shell: a sphere of radius uR around the Sun, drawn as a glowing skin */
  const SHELL = prog(gl, SPHERE_VS, `
  in vec3 vV; out vec4 o; uniform vec3 uC; uniform float uR;
  void main(){
    vec3 rd = normalize(vV); float b = dot(rd, uC), c = dot(uC, uC) - uR * uR, disc = b * b - c;
    if (disc < 0.) discard;
    float s = sqrt(disc); float edge = s / uR;             // 0 at the silhouette, 1 through the middle
    float g = 0.035 / (edge + 0.02) + 0.05;
    o = vec4(vec3(1.0, 0.9, 0.62) * min(g, 1.6) * 0.8, 1.);
  }`);

  const quadVao = gl.createVertexArray();
  const texDay = tex.day ? GLKit.texture(gl, tex.day) : null, texNight = tex.night ? GLKit.texture(gl, tex.night) : null, texMoon = tex.moon ? GLKit.texture(gl, tex.moon) : null;

  function drawLines(VP, arr, count, col, strip = true) {
    gl.useProgram(LINES.p); gl.uniformMatrix4fv(LINES.u.uVP, false, VP); gl.uniform4fv(LINES.u.uCol, col);
    gl.bindVertexArray(lineVao); gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf); gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STREAM_DRAW);
    gl.drawArrays(strip ? gl.LINE_STRIP : gl.LINES, 0, count);
  }

  return {
    // f: a frame description built by the app
    render(f) {
      gl.viewport(0, 0, f.W, f.H);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);
      gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      // stars
      gl.disable(gl.BLEND);
      gl.useProgram(STARS.p); gl.uniform3fv(STARS.u.uFwd, f.cam.fwd); gl.uniform3fv(STARS.u.uRight, f.cam.right); gl.uniform3fv(STARS.u.uUp, f.cam.up);
      gl.uniform2f(STARS.u.uTan, f.tanX, f.tanY); gl.uniform1f(STARS.u.uDim, f.starDim);
      gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      // orbits and tracks (world-relative coordinates, VP includes view)
      for (const L of f.lines) drawLines(f.VP, L.data, L.count, L.col, L.strip !== false);
      // asteroids
      if (f.ast && f.ast.sim) {
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(ASTP.p); gl.uniformMatrix4fv(ASTP.u.uVP, false, f.VP); gl.uniformMatrix3fv(ASTP.u.uRot, false, f.ast.rot);
        gl.uniform3fv(ASTP.u.uSunRel, f.ast.sunRel); gl.uniform1f(ASTP.u.uDtDisp, f.ast.dtDisp); gl.uniform1f(ASTP.u.uMu, f.ast.mu);
        gl.uniform1f(ASTP.u.uPt, f.ast.pt); gl.uniform1f(ASTP.u.uAlpha, f.ast.alpha); gl.uniform1f(ASTP.u.uMaskBits, f.ast.mask); gl.uniform1f(ASTP.u.uScale, 1);
        gl.bindVertexArray(f.ast.sim.vao); gl.drawArrays(gl.POINTS, 0, f.ast.sim.n);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      }
      // light shell
      if (f.shell) {
        gl.blendFunc(gl.ONE, gl.ONE);
        gl.useProgram(SHELL.p); gl.uniformMatrix4fv(SHELL.u.uP, false, f.P); gl.uniform3fv(SHELL.u.uC, f.shell.c); gl.uniform1f(SHELL.u.uR, f.shell.r); gl.uniform1f(SHELL.u.uGrow, 1.02);
        gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
      // bodies, far to near
      gl.bindVertexArray(quadVao);
      const bodies = f.bodies.slice().sort((a, b) => Math.hypot(...b.c) - Math.hypot(...a.c));
      for (const B of bodies) {
        if (Math.hypot(...B.c) <= B.r * 1.0001) continue;
        if (B.glow) {
          gl.blendFunc(gl.ONE, gl.ONE);
          gl.useProgram(GLOW.p); gl.uniformMatrix4fv(GLOW.u.uP, false, f.P); gl.uniform3fv(GLOW.u.uC, B.c); gl.uniform1f(GLOW.u.uR, B.r);
          gl.uniform1f(GLOW.u.uGrow, B.glow.grow); gl.uniform1f(GLOW.u.uI, B.glow.i); gl.uniform3fv(GLOW.u.uCol, B.glow.col);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
        const ring = B.ring;
        const drawRing = half => {
          gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          gl.useProgram(RING.p); gl.uniformMatrix4fv(RING.u.uP, false, f.P);
          gl.uniform3fv(RING.u.uC, B.c); gl.uniform3fv(RING.u.uN, ring.n); gl.uniform3fv(RING.u.uAx, ring.ax); gl.uniform3fv(RING.u.uAy, ring.ay);
          gl.uniform1f(RING.u.uRo, B.r * 2.36); gl.uniform1f(RING.u.uR, B.r); gl.uniform3fv(RING.u.uL, B.L); gl.uniform1f(RING.u.uHalf, half);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        };
        if (ring) drawRing(-1);
        gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        gl.useProgram(PLANET.p); const u = PLANET.u;
        gl.uniformMatrix4fv(u.uP, false, f.P); gl.uniform3fv(u.uC, B.c); gl.uniform1f(u.uR, B.r); gl.uniform1f(u.uGrow, 1.01);
        gl.uniform3fv(u.uL, B.L); gl.uniform1f(u.uKind, B.kind); gl.uniform1f(u.uTime, f.time); gl.uniformMatrix3fv(u.uToBody, false, B.toBody);
        gl.uniform3fv(u.uCol, B.col); gl.uniform3fv(u.uCol2, B.col2 || B.col);
        gl.uniform3fv(u.uRingN, ring ? ring.n : [0, 0, 1]); gl.uniform2f(u.uRing, ring ? 1.24 : 0, ring ? 2.27 : 0);
        gl.uniform4fv(u.uOcc, B.occ || [0, 0, 0, 0]); gl.uniform1f(u.uSunR, B.sunR || 0.0047); gl.uniform3fv(u.uSunC, B.sunC || [0, 0, 0]); gl.uniform1f(u.uEclipse, B.eclipse || 0);
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texDay); gl.uniform1i(u.uDay, 0);
        gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNight); gl.uniform1i(u.uNight, 1);
        gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, texMoon); gl.uniform1i(u.uMoon, 2);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (ring) drawRing(1);
      }
      gl.disable(gl.BLEND);
    },
  };
}

/* ================================================================
   GlobeGL: Earth seen from space during an eclipse, with the Moon's penumbra and umbra
   ================================================================ */
function GlobeGL(gl, tex) {
  const { prog } = GLKit;
  const EARTH = prog(gl, `
  const vec2 P[3] = vec2[3](vec2(-1., -1.), vec2(3., -1.), vec2(-1., 3.));
  out vec2 vN; void main(){ vec2 p = P[gl_VertexID]; vN = p; gl_Position = vec4(p, 0., 1.); }`, `
  in vec2 vN; out vec4 o;
  uniform mat3 uToFixed;     // view -> Earth-fixed
  uniform vec3 uSun;         // Earth-fixed unit vector to the Sun
  uniform vec3 uMs, uAx;     // Moon (km, Earth-fixed) and shadow axis direction
  uniform float uKu, uTu, uKp, uTp, uAsp, uZoom, uRE;   // umbra radius at the Moon & tan(half angle); penumbra same
  uniform sampler2D uDay, uNight, uObs, uTot; uniform float uMaps;
  void main(){
    vec2 q = vN * vec2(uAsp, 1.) / uZoom;
    float r2 = dot(q, q);
    if (r2 > 1.) { float g = exp(-(sqrt(r2) - 1.) * 40.); o = vec4(vec3(0.25, 0.45, 0.9) * g * 0.35, 1.); return; }
    vec3 nv = vec3(q, sqrt(1. - r2));
    vec3 n = uToFixed * nv;
    float lon = atan(n.y, n.x), lat = asin(clamp(n.z, -1., 1.));
    vec2 uv = vec2(fract(lon / 6.2831853 + 0.5), 0.5 - lat / 3.1415926);
    vec3 day = texture(uDay, uv).rgb; float night = texture(uNight, uv).r;
    float ndl = dot(n, uSun);
    // obscuration of the Sun at this surface point
    vec3 p = n * uRE;
    float t = dot(p - uMs, uAx); vec3 perp = p - uMs - uAx * t; float rho = length(perp);
    float ru = uKu - t * uTu, rp = uKp + t * uTp;
    float obs = 0.;
    if (rho < abs(ru)) obs = ru > 0. ? 1. : 0.9;
    else if (rho < rp) obs = (rp - rho) / (rp - abs(ru)) * (ru > 0. ? 1. : 0.9);
    obs = clamp(obs, 0., 1.);
    float light = max(ndl, 0.) * (1. - 0.97 * pow(obs, 1.25));
    vec3 col = day * 1.2 * light;
    col += vec3(1.0, 0.78, 0.45) * night * night * 1.2 * max(smoothstep(0.08, -0.15, ndl), obs > 0.97 ? 0.6 : 0.);
    if (obs > 0.999 && ru > 0.) col += vec3(0.04, 0.01, 0.0);
    if (uMaps > 0.5) {
      // where the eclipse is seen at all during its course: contours of the largest fraction of the Sun covered
      float mo = texture(uObs, uv).r;
      float k = mo * 4., fw = max(fwidth(k), 1e-4), f = abs(fract(k + 0.5) - 0.5) / fw;
      float cl = (1. - smoothstep(0.6, 1.6, f)) * step(0.02, mo) * step(k, 3.6);
      float edge = 1. - smoothstep(0.6, 1.6, abs(mo - 0.004) / max(fwidth(mo), 1e-4));
      col = mix(col, vec3(0.56, 0.76, 0.93), 0.28 * cl + 0.5 * edge);
      float tt = texture(uTot, uv).r;
      col = mix(col, vec3(1.0, 0.7, 0.36), 0.33 * smoothstep(0.2, 0.6, tt));
      float te = 1. - smoothstep(0.6, 1.8, abs(tt - 0.5) / max(fwidth(tt), 1e-4));
      col = mix(col, vec3(1.0, 0.75, 0.4), 0.8 * te * step(0.02, fwidth(tt)));
    }
    float rim = pow(1. - nv.z, 3.);
    col += vec3(0.3, 0.5, 1.0) * rim * 0.4 * smoothstep(-0.2, 0.3, ndl);
    // graticule
    float gl1 = abs(fract(lat / 0.2617994 + 0.5) - 0.5), gl2 = abs(fract(lon / 0.2617994 + 0.5) - 0.5);
    col += vec3(0.5, 0.6, 0.7) * 0.05 * (smoothstep(0.03, 0.0, gl1) + smoothstep(0.03, 0.0, gl2));
    o = vec4(col, 1.);
  }`);
  const LINE = prog(gl, `
  layout(location = 0) in vec3 aP;   // Earth-fixed unit vectors
  uniform mat3 uToView; uniform float uAsp, uZoom; out float vZ;
  void main(){ vec3 v = uToView * aP; vZ = v.z; gl_Position = vec4(v.x / uAsp * uZoom, v.y * uZoom, 0., 1.); gl_PointSize = 6.; }`, `
  in float vZ; uniform vec4 uCol; out vec4 o; void main(){ if (vZ < 0.) discard; o = uCol; }`);
  const lb = gl.createBuffer(), lv = gl.createVertexArray();
  gl.bindVertexArray(lv); gl.bindBuffer(gl.ARRAY_BUFFER, lb); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0); gl.bindVertexArray(null);
  const empty = gl.createVertexArray();
  const texDay = GLKit.texture(gl, tex.day), texNight = GLKit.texture(gl, tex.night);
  const mapTex = [gl.createTexture(), gl.createTexture()];
  let haveMaps = false;
  return {
    setMaps(obs, ow, oh, tot, tw, th) {
      [[obs, ow, oh], [tot, tw, th]].forEach(([d, w, h], i) => {
        gl.bindTexture(gl.TEXTURE_2D, mapTex[i]); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, w, h, 0, gl.RED, gl.UNSIGNED_BYTE, d);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      });
      haveMaps = !!obs;
    },
    clearMaps() { haveMaps = false; },
    render(f) {
      gl.viewport(0, 0, f.W, f.H); gl.disable(gl.BLEND); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(EARTH.p); const u = EARTH.u;
      gl.uniformMatrix3fv(u.uToFixed, false, f.toFixed); gl.uniform3fv(u.uSun, f.sun); gl.uniform3fv(u.uMs, f.ms); gl.uniform3fv(u.uAx, f.ax);
      gl.uniform1f(u.uKu, f.ku); gl.uniform1f(u.uTu, f.tu); gl.uniform1f(u.uKp, f.kp); gl.uniform1f(u.uTp, f.tp);
      gl.uniform1f(u.uAsp, f.W / f.H); gl.uniform1f(u.uZoom, f.zoom); gl.uniform1f(u.uRE, 6378.137);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, texDay); gl.uniform1i(u.uDay, 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, texNight); gl.uniform1i(u.uNight, 1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mapTex[0]); gl.uniform1i(u.uObs, 2);
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, mapTex[1]); gl.uniform1i(u.uTot, 3);
      gl.uniform1f(u.uMaps, haveMaps ? 1 : 0);
      gl.bindVertexArray(empty); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(LINE.p); gl.uniformMatrix3fv(LINE.u.uToView, false, f.toView); gl.uniform1f(LINE.u.uAsp, f.W / f.H); gl.uniform1f(LINE.u.uZoom, f.zoom);
      gl.bindVertexArray(lv);
      for (const L of f.lines) {
        gl.uniform4fv(LINE.u.uCol, L.col); gl.bindBuffer(gl.ARRAY_BUFFER, lb); gl.bufferData(gl.ARRAY_BUFFER, L.data, gl.STREAM_DRAW);
        gl.drawArrays(L.points ? gl.POINTS : gl.LINE_STRIP, 0, L.data.length / 3);
      }
      gl.disable(gl.BLEND);
    },
  };
}

/* ================================================================
   LabGL: particles drawn in Jupiter's rotating frame (left) and on the distance-eccentricity plane (right)
   ================================================================ */
function LabGL(gl) {
  const { prog } = GLKit;
  const PTS = prog(gl, `
  layout(location = 0) in vec4 aP; layout(location = 1) in vec4 aV;
  uniform float uMu, uMode, uAsp, uScale, uPt; uniform vec2 uRot; uniform vec4 uBox; // box: x0, x1, y0, y1 for the a-e plane
  out vec4 vC;
  vec3 hue(float h){ return clamp(abs(mod(h * 6. + vec3(0., 4., 2.), 6.) - 3.) - 1., 0., 1.); }
  void main(){
    vec3 x = aP.xyz, v = aV.xyz; bool dead = aP.w < 0.;
    float a0 = aV.w;
    vec3 c = mix(vec3(1.), hue(0.62 - clamp((a0 - 2.0) / 3.6, 0., 1.) * 0.62), 0.55);
    if (uMode < 0.5) {
      vec2 p = vec2(uRot.x * x.x + uRot.y * x.y, -uRot.y * x.x + uRot.x * x.y);
      gl_Position = vec4(p.x / uAsp * uScale, p.y * uScale, 0., 1.);
      vC = dead ? vec4(0.) : vec4(c, 1.);
    } else {
      float r = length(x), ia = 2. / r - dot(v, v) / uMu, a = 1. / ia;
      vec3 h = cross(x, v); float e = sqrt(max(0., 1. - dot(h, h) * ia / uMu));
      vec2 q = vec2((a - uBox.x) / (uBox.y - uBox.x), (e - uBox.z) / (uBox.w - uBox.z)) * 2. - 1.;
      gl_Position = vec4(q, 0., 1.);
      vC = dead ? vec4(1., 0.3, 0.25, 0.25) : vec4(c, 1.);
      if (dead) gl_Position = vec4(2.);
    }
    gl_PointSize = uPt;
  }`, `
  in vec4 vC; uniform float uAlpha; out vec4 o; void main(){ vec2 q = gl_PointCoord * 2. - 1.; if (dot(q, q) > 1.) discard; o = vec4(vC.rgb * vC.a * uAlpha, 1.); }`);
  return {
    render(sim, f) {
      gl.viewport(f.x, f.y, f.w, f.h);
      gl.enable(gl.SCISSOR_TEST); gl.scissor(f.x, f.y, f.w, f.h); gl.clearColor(0.016, 0.02, 0.035, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.SCISSOR_TEST);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.useProgram(PTS.p); const u = PTS.u;
      gl.uniform1f(u.uMu, f.mu); gl.uniform1f(u.uMode, f.mode); gl.uniform1f(u.uAsp, f.w / f.h); gl.uniform1f(u.uScale, f.scale);
      gl.uniform2fv(u.uRot, f.rot); gl.uniform4fv(u.uBox, f.box); gl.uniform1f(u.uPt, f.pt); gl.uniform1f(u.uAlpha, f.alpha);
      gl.bindVertexArray(sim.vao); gl.drawArrays(gl.POINTS, 0, sim.n);
      gl.disable(gl.BLEND);
    },
  };
}

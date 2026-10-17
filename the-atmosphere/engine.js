// WebGL2 renderer for The Atmosphere: ray-traced globe (or flat map) with advected high-resolution
// clouds, GPU wind-particle trails, data layers, isobars, night lights and lightning.
function Engine(canvas, opts) {
  const E = this;
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: !!opts.preserve });
  if (!gl) throw new Error('WebGL2 unavailable');
  E.gl = gl;
  const extCBF = gl.getExtension('EXT_color_buffer_float');
  if (!extCBF) throw new Error('this browser or GPU cannot render to floating-point textures (EXT_color_buffer_float is missing)');
  gl.getExtension('OES_texture_float_linear');
  const NLAT = opts.nlat, NLON = opts.nlon;

  // ---------------- helpers ----------------
  function sh(type, src) {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error('SHADER ' + log); throw new Error(`${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader failed to compile: ${log}`); }
    return s;
  }
  // Every program records how many texture samplers it uses: WebGL2 only guarantees 16 per shader stage
  // (MAX_TEXTURE_IMAGE_UNITS; Windows/ANGLE/D3D11 allows exactly 16, some Linux drivers 32), checked after boot.
  const SAMPLER_TYPES = new Set([gl.SAMPLER_2D, gl.SAMPLER_3D, gl.SAMPLER_CUBE, gl.SAMPLER_2D_SHADOW, gl.SAMPLER_2D_ARRAY, gl.SAMPLER_2D_ARRAY_SHADOW, gl.SAMPLER_CUBE_SHADOW,
    gl.INT_SAMPLER_2D, gl.INT_SAMPLER_3D, gl.INT_SAMPLER_CUBE, gl.INT_SAMPLER_2D_ARRAY, gl.UNSIGNED_INT_SAMPLER_2D, gl.UNSIGNED_INT_SAMPLER_3D, gl.UNSIGNED_INT_SAMPLER_CUBE, gl.UNSIGNED_INT_SAMPLER_2D_ARRAY]);
  E.samplerReport = [];
  function prog(vs, fs, name) {
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`shader program "${name}" failed to link: ${gl.getProgramInfoLog(p)}`);
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); let ns = 0;
    for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name); if (SAMPLER_TYPES.has(info.type)) ns += info.size; }
    E.samplerReport.push({ program: name, samplers: ns });
    return { p, u };
  }
  function tex(w, h, ifmt, fmt, type, data, filter, wrapS, wrapT) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter || gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter === gl.LINEAR_MIPMAP_LINEAR ? gl.LINEAR : (filter || gl.LINEAR));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrapS || gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrapT || gl.CLAMP_TO_EDGE);
    return t;
  }
  function fbo(t) { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return f; }
  function imgTex(img, mip) {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const an = gl.getExtension('EXT_texture_filter_anisotropic'); if (an && mip) gl.texParameterf(gl.TEXTURE_2D, an.TEXTURE_MAX_ANISOTROPY_EXT, 8);
    return t;
  }
  function linTex(img, mip) { // non-sRGB (masks, data)
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  const quadVAO = gl.createVertexArray(); // attribute-less full-screen triangle
  const VS_FULL = `#version 300 es
  out vec2 vUv; void main(){ vec2 p = vec2((gl_VertexID<<1)&2, gl_VertexID&2); vUv = p; gl_Position = vec4(p*2.0-1.0, 0.0, 1.0); }`;

  // ---------------- common GLSL ----------------
  const COMMON = `
  precision highp float; precision highp int; precision highp sampler2D;
  const float PI = 3.14159265358979;
  uniform sampler2D uRowLUT;
  // model field texture coordinate for (lon, lat) on the Gaussian grid
  vec2 fuv(float lon, float lat){ float v = texture(uRowLUT, vec2(0.5, clamp(0.5 - lat/PI, 0.0, 1.0))).r; return vec2(lon/(2.0*PI) + ${(0.5 / NLON).toFixed(8)}, v); }
  // smooth (B-spline via 4 bilinear taps) sampling of a model field for less blocky coverage
  vec4 bsp(sampler2D t, vec2 uv){
    vec2 ts = vec2(${NLON.toFixed(1)}, ${NLAT.toFixed(1)});
    vec2 st = uv*ts - 0.5; vec2 i = floor(st); vec2 f = st - i;
    vec2 w0 = (1.0-f)*(1.0-f)*(1.0-f)/6.0, w1 = (4.0 - 6.0*f*f + 3.0*f*f*f)/6.0, w2 = (1.0 + 3.0*f + 3.0*f*f - 3.0*f*f*f)/6.0, w3 = f*f*f/6.0;
    vec2 g0 = w0 + w1, g1 = w2 + w3; vec2 h0 = (w1/g0) - 1.0 + i + 0.5, h1 = (w3/g1) + 1.0 + i + 0.5;
    h0 /= ts; h1 /= ts;
    return g0.y*(g0.x*texture(t, vec2(h0.x,h0.y)) + g1.x*texture(t, vec2(h1.x,h0.y))) + g1.y*(g0.x*texture(t, vec2(h0.x,h1.y)) + g1.x*texture(t, vec2(h1.x,h1.y)));
  }
  vec3 sph(float lon, float lat){ float c = cos(lat); return vec3(c*cos(lon), c*sin(lon), sin(lat)); }
  vec2 lonlat(vec3 p){ return vec2(atan(p.y, p.x), asin(clamp(p.z, -1.0, 1.0))); }
  // 3D simplex noise (Gustavson/Ashima)
  vec4 perm(vec4 x){ return mod(((x*34.0)+1.0)*x, 289.0); }
  vec4 tis(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
  float snoise(vec3 v){
    const vec2 C = vec2(1.0/6.0, 1.0/3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + C.yyy; vec3 x3 = x0 - D.yyy;
    i = mod(i, 289.0);
    vec4 p = perm(perm(perm(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0; vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0; vec4 s1 = floor(b1)*2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = tis(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3))); p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0); m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
  }
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  `;

  // ---------------- static textures ----------------
  E.tex = {};
  E.setImages = function (imgs) {
    E.tex.day = imgTex(imgs.day, true);
    E.tex.night = imgTex(imgs.night, true);
    E.tex.land = linTex(imgs.land, true);
    E.tex.elev = linTex(imgs.elev, true);
  };
  // Gaussian row lookup: uniform latitude (north->south) -> texture v on the model grid
  {
    const n = 2048, lut = new Float32Array(n), lat = opts.lats; // lats north->south in radians
    for (let i = 0; i < n; i++) {
      const la = Math.PI / 2 - (i + 0.5) / n * Math.PI;
      let v;
      if (la >= lat[0]) v = 0.5 / NLAT; else if (la <= lat[NLAT - 1]) v = (NLAT - 0.5) / NLAT;
      else { let j = 0; while (!(la <= lat[j] && la >= lat[j + 1])) j++; const f = (lat[j] - la) / (lat[j] - lat[j + 1]); v = (j + 0.5 + f) / NLAT; }
      lut[i] = v;
    }
    E.tex.rowLUT = tex(1, n, gl.R32F, gl.RED, gl.FLOAT, lut, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE);
  }
  // model fields: 6 RGBA16F textures x 2 snapshots
  const NF = 6;
  E.fields = [[], []];
  for (let s = 0; s < 2; s++) for (let f = 0; f < NF; f++) E.fields[s].push(tex(NLON, NLAT, gl.RGBA16F, gl.RGBA, gl.FLOAT, null, gl.LINEAR, gl.REPEAT, gl.CLAMP_TO_EDGE));
  E.snap = 0; // index of the newest snapshot
  // the fields at the displayed moment: the two snapshots blended once per frame in a small pass (the blend and the
  // smooth B-spline sampling are both linear, so this equals blending inside each shader, with half the samplers)
  E.blended = []; const blendFB = [];
  for (let f = 0; f < NF; f++) { const t = tex(NLON, NLAT, gl.RGBA16F, gl.RGBA, gl.FLOAT, null, gl.LINEAR, gl.REPEAT, gl.CLAMP_TO_EDGE); E.blended.push(t); blendFB.push(fbo(t)); }
  let blendKey = '', uploads = 0;
  const upBuf = new Float32Array(NLON * NLAT * 4);
  // fieldsIn: array of 24 Float32Arrays (nlat*nlon) in DISP_FIELDS order
  E.upload = function (F) {
    E.snap ^= 1;
    for (let f = 0; f < NF; f++) {
      for (let c = 0; c < 4; c++) { const src = F[f * 4 + c]; for (let p = 0; p < NLAT * NLON; p++) upBuf[p * 4 + c] = src[p]; }
      gl.bindTexture(gl.TEXTURE_2D, E.fields[E.snap][f]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NLON, NLAT, gl.RGBA, gl.FLOAT, upBuf);
    }
    uploads++;
  };
  const blendP = prog(VS_FULL, `#version 300 es
  precision highp float; uniform sampler2D uS0, uS1; uniform float uMix; out vec4 o;
  void main(){ ivec2 c = ivec2(gl_FragCoord.xy); o = mix(texelFetch(uS0, c, 0), texelFetch(uS1, c, 0), uMix); }`, 'blend snapshots');
  function blendFields() {
    const key = uploads + ':' + E.snap + ':' + E.mix;
    if (key === blendKey) return;
    blendKey = key;
    // runs in the middle of other passes: put back the program, framebuffer, viewport, blending, texture unit and VAO it changes
    const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING), vp = gl.getParameter(gl.VIEWPORT), blendOn = gl.isEnabled(gl.BLEND);
    const prevProg = gl.getParameter(gl.CURRENT_PROGRAM), prevUnit = gl.getParameter(gl.ACTIVE_TEXTURE), prevVAO = gl.getParameter(gl.VERTEX_ARRAY_BINDING);
    gl.disable(gl.BLEND); gl.useProgram(blendP.p); gl.viewport(0, 0, NLON, NLAT); gl.bindVertexArray(quadVAO);
    gl.uniform1f(blendP.u.uMix, E.mix); gl.uniform1i(blendP.u.uS0, 0); gl.uniform1i(blendP.u.uS1, 1);
    for (let f = 0; f < NF; f++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, blendFB[f]);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, E.fields[E.snap ^ 1][f]);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, E.fields[E.snap][f]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB); gl.viewport(vp[0], vp[1], vp[2], vp[3]); if (blendOn) gl.enable(gl.BLEND);
    gl.useProgram(prevProg); gl.activeTexture(prevUnit); gl.bindVertexArray(prevVAO);
  }

  // ---------------- cloud texture: baked noise atlas + advected origin maps ----------------
  const FIELD_UNI = `uniform sampler2D uA, uB, uC, uD, uE, uF;`;
  const FIELD_FN = `
    vec4 FA(vec2 uv){ return bsp(uA,uv); }
    vec4 FB(vec2 uv){ return bsp(uB,uv); }
    vec4 FC(vec2 uv){ return bsp(uC,uv); }
    vec4 FD(vec2 uv){ return texture(uD,uv); }
    vec4 FE(vec2 uv){ return texture(uE,uv); }
    vec4 FF(vec2 uv){ return bsp(uF,uv); }
    vec4 FDs(vec2 uv){ return bsp(uD,uv); }
    vec4 FEs(vec2 uv){ return bsp(uE,uv); }`;
  function bindFields(P, unit0) {
    blendFields();
    const names = ['A', 'B', 'C', 'D', 'E', 'F'];
    let u = unit0;
    for (let f = 0; f < NF; f++) {
      const loc = P.u['u' + names[f]]; if (!loc) continue;
      gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, E.blended[f]); gl.uniform1i(loc, u); u++;
    }
    if (P.u.uRowLUT) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, E.tex.rowLUT); gl.uniform1i(P.u.uRowLUT, u); u++; }
    return u;
  }
  // noise atlas (equirectangular, lon 0 at x = 0): R cumulus fbm, G cirrus (stretched) fbm, B cellular, A fine fbm
  const NW = 4096, NH = 2048;
  const noiseTex = tex(NW, NH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, null, gl.LINEAR, gl.REPEAT, gl.CLAMP_TO_EDGE);
  {
    const P = prog(VS_FULL, `#version 300 es
    ${COMMON}
    in vec2 vUv; out vec4 o;
    float fbm(vec3 p, int oct){ float a = 0.5, s = 0.0, n = 0.0; for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a*snoise(p); n += a; p = p*2.07 + vec3(1.7, 9.2, 3.1); a *= 0.46; } return s/n; }
    vec3 h33(vec3 p){ p = fract(p*vec3(0.1031,0.1030,0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx)*p.zyx); }
    float cells(vec3 p){ vec3 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++){ vec3 g = vec3(x,y,z); vec3 r = g + h33(i + g) - f; float d = dot(r,r); if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
      return sqrt(d2) - sqrt(d1); }
    void main(){
      float lon = vUv.x*2.0*PI, lat = (0.5 - vUv.y)*PI; vec3 p = sph(lon, lat);
      float r = 0.5 + 1.0*fbm(p*9.0, 6);
      float g = 0.5 + 0.9*fbm(vec3(p.x*9.0, p.y*9.0, p.z*9.0) + 0.35*vec3(snoise(p*30.0), snoise(p*30.0+5.0), snoise(p*30.0+9.0)), 7);
      float b = 0.5 + 0.9*fbm(p*26.0 + 7.0, 6);
      float a = 0.5 + 0.9*fbm(p*90.0 + 3.3, 5);
      o = vec4(clamp(r,0.0,1.0), clamp(g,0.0,1.0), clamp(b,0.0,1.0), clamp(a,0.0,1.0));
    }`, 'cloud noise atlas');
    const f = fbo(noiseTex); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.viewport(0, 0, NW, NH);
    gl.useProgram(P.p); gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, noiseTex); gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  }
  // origin maps: for 2 layers (low: 850 hPa wind, high: 250 hPa wind) x 2 phases, ping-pong
  const OW = 1024, OH = 512;
  // the four maps (layer = deck * 2 + phase) live in one 4-layer texture array, so a shader needs a single sampler
  const origArr = [0, 1].map(() => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32F, OW, OH, 4);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  });
  const origFB = origArr.map(t => [0, 1, 2, 3].map(l => { const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, l); return f; }));
  let origCur = 0;
  const origP = prog(VS_FULL, `#version 300 es
  ${COMMON} ${FIELD_UNI} ${FIELD_FN}
  in vec2 vUv; out vec4 o;
  uniform highp sampler2DArray uPrev; uniform float uDt, uReset, uLayer, uMapLayer;
  void main(){
    float lon = vUv.x*2.0*PI, lat = (0.5 - vUv.y)*PI;
    vec3 p = sph(lon, lat);
    if (uReset > 0.5) { o = vec4(p, 0.0); return; }
    vec2 uv = fuv(lon, lat);
    vec2 w = uLayer < 0.5 ? mix(FE(uv).xy, FD(uv).zw, 0.4) : FD(uv).zw; // low clouds steer with ~700 hPa flow (less convergent)
    vec3 e = normalize(vec3(-p.y, p.x, 0.0) + vec3(1e-7, 0.0, 0.0)); vec3 n = cross(p, e);
    vec3 q = normalize(p - (e*w.x + n*w.y) * uDt / 6.371e6);
    vec2 ll = lonlat(q);
    vec3 src = texture(uPrev, vec3(ll.x/(2.0*PI), 0.5 - ll.y/PI, uMapLayer)).xyz;
    o = vec4(normalize(src), 0.0);
  }`, 'cloud origin advection');
  E.cyc = { T: 0.8 * 86400, phase: [0, 0.5], rot: [0, 0, 0, 0].map(() => Math.random() * 6.283), last: null };
  E.advectClouds = function (dtSim, time, init) {
    const cy = E.cyc;
    gl.useProgram(origP.p);
    bindFields(origP, 1);
    gl.uniform1f(origP.u.uDt, dtSim);
    gl.viewport(0, 0, OW, OH); gl.bindVertexArray(quadVAO);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D_ARRAY, origArr[origCur]); gl.uniform1i(origP.u.uPrev, 0);
    for (let ph = 0; ph < 2; ph++) {
      const newPh = init ? (ph ? 0.5 : 0) : cy.phase[ph] + dtSim / cy.T;
      const reset = init || newPh >= 1;
      cy.phase[ph] = newPh % 1;
      for (let layer = 0; layer < 2; layer++) {
        const l = layer * 2 + ph;
        if (reset) cy.rot[l] = Math.random() * 6.283;
        gl.bindFramebuffer(gl.FRAMEBUFFER, origFB[origCur ^ 1][l]);
        gl.uniform1f(origP.u.uReset, reset ? 1 : 0); gl.uniform1f(origP.u.uLayer, layer); gl.uniform1f(origP.u.uMapLayer, l);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }
    origCur ^= 1;
  };
  function bindClouds(P, u) {
    const cy = E.cyc;
    if (P.u.uOrig) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D_ARRAY, origArr[origCur]); gl.uniform1i(P.u.uOrig, u); u++; }
    if (P.u.uNoise) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, noiseTex); gl.uniform1i(P.u.uNoise, u); u++; }
    if (P.u.uPhase) gl.uniform2f(P.u.uPhase, cy.phase[0], cy.phase[1]);
    if (P.u.uRot) gl.uniform4f(P.u.uRot, cy.rot[0], cy.rot[1], cy.rot[2], cy.rot[3]);
    return u;
  }

  // ---------------- wind particles ----------------
  const PW = 256, PH = 256; // particles = PW*PH
  E.nPart = PW * PH;
  const partTex = [0, 1].map(() => tex(PW, PH, gl.RGBA32F, gl.RGBA, gl.FLOAT, null, gl.NEAREST, gl.CLAMP_TO_EDGE, gl.CLAMP_TO_EDGE));
  const partFB = partTex.map(fbo);
  let partCur = 0;
  { const d = new Float32Array(PW * PH * 4); for (let i = 0; i < PW * PH; i++) { d[i * 4] = Math.random() * 2 * Math.PI; d[i * 4 + 1] = Math.asin(Math.random() * 2 - 1); d[i * 4 + 2] = Math.random() * 60; d[i * 4 + 3] = 0; }
    for (const t of partTex) { gl.bindTexture(gl.TEXTURE_2D, t); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PH, gl.RGBA, gl.FLOAT, d); } }
  const TW = 4096, TH = 2048;
  const trailTex = [0, 1].map(() => tex(TW, TH, gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT, null, gl.LINEAR, gl.REPEAT, gl.CLAMP_TO_EDGE));
  const trailFB = trailTex.map(fbo);
  let trailCur = 0;
  const partUpd = prog(VS_FULL, `#version 300 es
  ${COMMON} ${FIELD_UNI} ${FIELD_FN}
  in vec2 vUv; out vec4 o; uniform sampler2D uP; uniform float uStep, uSeed, uLevel;
  void main(){
    vec4 s = texelFetch(uP, ivec2(gl_FragCoord.xy), 0);
    vec2 uv = fuv(s.x, s.y);
    vec2 w = uLevel < 0.5 ? FD(uv).xy : (uLevel < 1.5 ? FE(uv).xy : FD(uv).zw);
    float spd = length(w);
    float c = max(cos(s.y), 0.02);
    s.x += w.x * uStep / (6.371e6 * c); s.y += w.y * uStep / 6.371e6;
    if (s.y > 1.5607) { s.y = 3.14159 - s.y; s.x += 3.14159; } if (s.y < -1.5607) { s.y = -3.14159 - s.y; s.x += 3.14159; }
    s.x = mod(s.x, 2.0*PI);
    s.z -= 1.0; s.w = spd;
    if (s.z < 0.0) { vec2 r = vec2(hash12(gl_FragCoord.xy + uSeed), hash12(gl_FragCoord.yx*1.37 + uSeed*3.1)); s.x = r.x*2.0*PI; s.y = asin(r.y*2.0 - 1.0); s.z = 40.0 + 60.0*hash12(gl_FragCoord.xy*0.7 + uSeed*1.9); s.w = -1.0; }
    o = s;
  }`, 'wind particle update');
  const partDraw = prog(`#version 300 es
  precision highp float; uniform sampler2D uP0, uP1; out float vA; out float vS;
  void main(){
    int id = gl_VertexID >> 1; int end = gl_VertexID & 1;
    ivec2 c = ivec2(id % ${PW}, id / ${PW});
    vec4 a = texelFetch(uP0, c, 0), b = texelFetch(uP1, c, 0);
    vec4 s = end == 0 ? a : b;
    float dl = abs(b.x - a.x);
    vA = (b.w < 0.0 || dl > 3.0) ? 0.0 : 1.0; vS = b.w;
    vec2 xy = vec2(s.x / 6.2831853 * 2.0 - 1.0, s.y / 1.5707963);
    gl_Position = vec4(xy, 0.0, 1.0);
  }`, `#version 300 es
  precision highp float; in float vA; in float vS; out vec4 o;
  void main(){ if (vA < 0.5) discard; o = vec4(vS, 1.0, 0.0, 1.0); }`, 'wind particle trails');
  const fadeP = prog(VS_FULL, `#version 300 es
  precision highp float; in vec2 vUv; out vec4 o; uniform sampler2D uT; uniform float uFade;
  void main(){ vec4 t = texture(uT, vUv); o = vec4(t.r, t.g * uFade, 0.0, 1.0); }`, 'trail fade');
  E.stepParticles = function (level, stepSec) {
    // update positions
    gl.bindFramebuffer(gl.FRAMEBUFFER, partFB[partCur ^ 1]); gl.viewport(0, 0, PW, PH);
    gl.useProgram(partUpd.p);
    bindFields(partUpd, 1);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, partTex[partCur]); gl.uniform1i(partUpd.u.uP, 0);
    gl.uniform1f(partUpd.u.uStep, stepSec); gl.uniform1f(partUpd.u.uSeed, Math.random() * 1000); gl.uniform1f(partUpd.u.uLevel, level);
    gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
    // fade trails
    gl.bindFramebuffer(gl.FRAMEBUFFER, trailFB[trailCur ^ 1]); gl.viewport(0, 0, TW, TH);
    gl.useProgram(fadeP.p); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, trailTex[trailCur]); gl.uniform1i(fadeP.u.uT, 0); gl.uniform1f(fadeP.u.uFade, 0.968);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // draw new segments (max blend on the intensity channel keeps the latest speed)
    gl.useProgram(partDraw.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, partTex[partCur]); gl.uniform1i(partDraw.u.uP0, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, partTex[partCur ^ 1]); gl.uniform1i(partDraw.u.uP1, 1);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ZERO);
    gl.drawArrays(gl.LINES, 0, 2 * E.nPart);
    gl.disable(gl.BLEND);
    trailCur ^= 1; partCur ^= 1;
  };

  // ---------------- main globe / map shader ----------------
  const mainP = prog(VS_FULL, `#version 300 es
  ${COMMON} ${FIELD_UNI} ${FIELD_FN}
  in vec2 vUv; out vec4 o;
  uniform sampler2D uDay, uNight, uLand, uElev, uTrail;
  uniform vec3 uCam, uCamR, uCamU, uCamF, uSun;
  uniform vec2 uRes; uniform float uFov, uMap, uMapLon, uMapZoom, uMapLat;
  uniform int uLayer; uniform float uClouds, uWind, uIsobars, uTime, uLights, uFlash, uExposure, uGrid;
  uniform vec3 uStation; uniform float uStationOn, uStationR, uAqua, uAllDay;
  const float RC_LOW = 1.0012, RC_HIGH = 1.0025, RATM = 1.022;
  vec3 srgb2lin(vec3 c){ return pow(c, vec3(2.2)); }
  // colormaps
  vec3 cmapTemp(float t){ // t in C, -40..40
    float x = clamp((t + 40.0)/80.0, 0.0, 1.0);
    vec3 c0 = vec3(0.23,0.10,0.45), c1 = vec3(0.15,0.35,0.85), c2 = vec3(0.35,0.75,0.95), c3 = vec3(0.95,0.95,0.85), c4 = vec3(0.98,0.70,0.25), c5 = vec3(0.85,0.20,0.15), c6 = vec3(0.45,0.05,0.15);
    if (x < 0.2) return mix(c0,c1,x/0.2); if (x < 0.4) return mix(c1,c2,(x-0.2)/0.2); if (x < 0.5) return mix(c2,c3,(x-0.4)/0.1);
    if (x < 0.65) return mix(c3,c4,(x-0.5)/0.15); if (x < 0.85) return mix(c4,c5,(x-0.65)/0.2); return mix(c5,c6,(x-0.85)/0.15);
  }
  vec3 cmapRain(float r){ // mm/h
    if (r < 0.05) return vec3(0.0);
    float x = clamp(log(r/0.05)/log(200.0), 0.0, 1.0);
    vec3 a = vec3(0.35,0.65,1.0), b = vec3(0.1,0.85,0.45), c = vec3(1.0,0.9,0.2), d = vec3(1.0,0.35,0.15), e = vec3(0.9,0.2,0.9);
    if (x < 0.25) return mix(a,b,x/0.25); if (x < 0.5) return mix(b,c,(x-0.25)/0.25); if (x < 0.75) return mix(c,d,(x-0.5)/0.25); return mix(d,e,(x-0.75)/0.25);
  }
  vec3 cmapSeq(float x){ x = clamp(x,0.0,1.0); vec3 a = vec3(0.05,0.07,0.2), b = vec3(0.1,0.35,0.6), c = vec3(0.2,0.7,0.7), d = vec3(0.85,0.95,0.6); if (x < 0.33) return mix(a,b,x/0.33); if (x < 0.66) return mix(b,c,(x-0.33)/0.33); return mix(c,d,(x-0.66)/0.34); }
  vec3 cmapWind(float s){ float x = clamp(s/40.0, 0.0, 1.0); vec3 a = vec3(0.25,0.45,0.85), b = vec3(0.3,0.85,0.75), c = vec3(0.95,0.9,0.4), d = vec3(0.95,0.4,0.25), e = vec3(0.9,0.3,0.8);
    if (x < 0.25) return mix(a,b,x/0.25); if (x < 0.5) return mix(b,c,(x-0.25)/0.25); if (x < 0.75) return mix(c,d,(x-0.5)/0.25); return mix(d,e,(x-0.75)/0.25); }

  uniform highp sampler2DArray uOrig; uniform sampler2D uNoise; uniform vec2 uPhase; uniform vec4 uRot;
  vec4 noiseAt(vec3 q, float rot){ // rotate the sphere to decorrelate cycles, then look up the atlas
    float c = cos(rot), s = sin(rot); q = vec3(c*q.x - s*q.y, s*q.x + c*q.y, q.z);
    q = vec3(q.x, c*q.y - s*q.z, s*q.y + c*q.z);
    vec2 ll = lonlat(q); return texture(uNoise, vec2(ll.x/(2.0*PI), 0.5 - ll.y/PI));
  }
  // flow-advected texture: two staggered phases cross-faded, contrast renormalised
  vec3 orig(vec2 c, float l){ return texture(uOrig, vec3(c, l)).xyz; }
  vec4 flowNoise(vec2 cuv, float l0, float l1, float r0, float r1){
    vec3 p = sph(cuv.x*2.0*PI, (0.5 - cuv.y)*PI);
    vec2 dx = vec2(1.0/1024.0, 0.0), dy = vec2(0.0, 1.0/512.0);
    float cl = max(cos((0.5 - cuv.y)*PI), 0.05);
    vec4 n = vec4(0.0); float ws = 0.0;
    for (int k = 0; k < 2; k++) {
      vec2 c0 = cuv;
      float l = k == 0 ? l0 : l1;
      vec3 a = orig(c0, l);
      vec3 ax = orig(c0 + dx, l) - orig(c0 - dx, l);
      vec3 ay = orig(c0 + dy, l) - orig(c0 - dy, l);
      // local stretching of the origin map relative to an undistorted map
      float sx = length(ax) / (2.0*2.0*PI/1024.0*cl), sy = length(ay) / (2.0*PI/512.0);
      float st = max(max(sx, sy), 1.0/max(min(sx, sy), 0.05));
      float fresh = smoothstep(2.2, 5.0, st);
      float ph = k == 0 ? uPhase.x : uPhase.y;
      float w = 1.0 - abs(2.0*ph - 1.0);
      float r = k == 0 ? r0 : r1;
      n += w * mix(noiseAt(a, r), noiseAt(p, r + 1.3), fresh); ws += w*w;
    }
    return clamp(0.5 + (n - 0.5) / sqrt(max(ws, 0.05)), 0.0, 1.0);
  }
  struct Cl { float low; float high; float conv; float tot; float tau; };
  uniform float uDetail;
  Cl cloudsD(vec3 p, vec2 uv, float det){
    float lon = atan(p.y, p.x), lat = asin(clamp(p.z,-1.0,1.0));
    vec2 cuv = vec2(lon/(2.0*PI), 0.5 - lat/PI);
    vec4 nl4 = flowNoise(cuv, 0.0, 1.0, uRot.x, uRot.y);
    vec4 nh4 = flowNoise(cuv, 2.0, 3.0, uRot.z, uRot.w);
    vec4 A = FA(uv);
    float cl = clamp(max(A.x, A.y*0.9), 0.0, 1.0), ch = clamp(A.z, 0.0, 1.0), cc = clamp(A.w, 0.0, 1.0);
    Cl r;
    float fine = nl4.a - 0.5;
    // high-frequency detail at the advected position (only for the visible layer, when zoomed in)
    float hf = 0.0;
    if (det > 0.0) { vec3 q = orig(cuv, 0.0); hf = det * (0.6*snoise(q*260.0) + 0.3*snoise(q*560.0)); }
    float brk = 1.0 - smoothstep(0.2, 0.55, cl);
    float nl = mix(nl4.r, nl4.b, 0.35*brk) + 0.05*fine + 0.07*hf;
    r.low = smoothstep(1.0 - cl - 0.2, 1.0 - cl + 0.2, nl) * smoothstep(0.03, 0.2, cl);
    float nh = nh4.g + 0.04*(nh4.a - 0.5);
    r.high = smoothstep(1.0 - ch - 0.22, 1.0 - ch + 0.26, nh) * smoothstep(0.03, 0.25, ch);
    float nc = nl4.r*0.4 + nh4.r*0.3 + nl4.b*0.3 + 0.2*fine;
    r.conv = smoothstep(1.0 - cc - 0.1, 1.0 - cc + 0.12, nc) * smoothstep(0.05, 0.3, cc);
    // optical depth: squared coverage gives thin grey edges; fine detail modulates thickness only
    float tl = r.low*r.low * (0.8 + 4.0*cl) * (0.85 + 0.35*fine + 0.3*(nl - 0.5));
    float th = r.high*r.high * (0.35 + 1.1*ch) * (0.75 + 0.6*(nh - 0.5) + 0.3*(nh4.a - 0.5));
    float tc = r.conv * (5.0 + 10.0*cc) * (0.8 + 0.5*fine);
    tl *= 1.0 + 0.35*hf;
    r.tau = max(tl, 0.0) + max(th, 0.0) + tc;
    r.tot = 1.0 - exp(-r.tau);
    return r;
  }
  Cl clouds(vec3 p, vec2 uv){ return cloudsD(p, uv, 0.0); }
  vec2 hitSphere(vec3 ro, vec3 rd, float R){ float b = dot(ro, rd), c = dot(ro, ro) - R*R, h = b*b - c; if (h < 0.0) return vec2(-1.0); h = sqrt(h); return vec2(-b - h, -b + h); }

  void main(){
    vec3 ro, rd; vec3 P; bool hit = true; float tHit = 0.0;
    vec2 frag = vUv * uRes;
    if (uMap > 0.5) {
      float lon = uMapLon + (vUv.x - 0.5) * 2.0*PI / uMapZoom;
      float lat = uMapLat + (vUv.y - 0.5) * PI / uMapZoom * (uRes.y/uRes.x) * 2.0;
      if (abs(lat) > PI*0.5) { o = vec4(0.02,0.025,0.035,1.0); return; }
      P = sph(lon, lat); ro = P * 3.0; rd = -P;
    } else {
      vec2 sc = (vUv - 0.5) * vec2(uRes.x/uRes.y, 1.0) * 2.0 * tan(uFov*0.5);
      ro = uCam; rd = normalize(uCamF + sc.x*uCamR + sc.y*uCamU);
      vec2 h = hitSphere(ro, rd, 1.0);
      if (h.x < 0.0) hit = false; else { tHit = h.x; P = ro + rd*h.x; }
    }
    vec3 col = vec3(0.0);
    vec3 S = normalize(uSun);
    if (hit) {
      vec3 N = normalize(P);
      float lon = atan(N.y, N.x), lat = asin(clamp(N.z,-1.0,1.0));
      vec2 tuv = vec2(lon/(2.0*PI) + 0.5, 0.5 - lat/PI);   // images start at 180W
      vec2 tuv0 = vec2(lon/(2.0*PI), 0.5 - lat/PI);        // own textures start at 0E
      vec2 uv = fuv(lon, lat);
      vec4 B = FB(uv), Cc = FC(uv), F6 = FF(uv); vec4 D = FDs(uv);
      float landm = texture(uLand, tuv).r * (1.0 - uAqua);
      float elev = texture(uElev, tuv).r * 6000.0;
      float mu = mix(dot(N, S), 0.8, uAllDay);
      float day = smoothstep(-0.12, 0.08, mu);
      // --- surface albedo ---
      vec3 alb = srgb2lin(texture(uDay, tuv).rgb);
      // snow on land from the model (kg/m2), more on high ground, patchy edges
      float sn = B.w; float nz = snoise(N*60.0)*0.5 + snoise(N*180.0)*0.25;
      float snowf = smoothstep(0.0, 1.0, (sn/(sn + 12.0))*1.35 + nz*0.25 + smoothstep(1200.0, 3500.0, elev)*0.25*step(1.0, sn));
      alb = mix(alb, vec3(0.82,0.85,0.9)*mix(0.75, 1.0, smoothstep(0.0, 0.5, snowf)), clamp(snowf,0.0,1.0)*landm);
      // ocean + sea ice
      float ice = smoothstep(0.02 + 0.08*(nz+0.5), 0.35, Cc.x);
      vec3 ocean = vec3(0.0025, 0.011, 0.032);
      vec3 icec = vec3(0.72, 0.78, 0.84) * (0.85 + 0.15*snoise(N*90.0));
      vec3 water = mix(ocean, icec, ice);
      alb = mix(water, alb, landm);
      // --- lighting ---
      float diff = max(mu, 0.0);
      // cloud shadow: look toward the sun from the surface to the cloud shell
      float shadow = 1.0;
      if (uClouds > 0.5 && mu > 0.0) {
        vec2 hs = hitSphere(P, S, RC_LOW); vec3 Q = normalize(P + S*max(hs.y, 0.0));
        vec2 ll = lonlat(Q); Cl cs = clouds(Q, fuv(ll.x, ll.y));
        shadow = 1.0 - 0.75*cs.tot;
      }
      vec3 sunc = vec3(1.0, 0.98, 0.95) * mix(vec3(1.0,0.62,0.4), vec3(1.0), smoothstep(0.0, 0.12, mu));
      col = alb * sunc * diff * shadow * 2.8;
      // sky fill (bluish ambient on the day side)
      col += alb * vec3(0.10, 0.14, 0.22) * day * 0.5;
      // sun glint on open water, roughness from surface wind speed
      vec3 V = -rd; vec3 Hh = normalize(V + S);
      float wind = length(D.xy);
      float rough = clamp(0.04 + wind*0.012, 0.04, 0.35);
      float nh_ = max(dot(N, Hh), 0.0);
      float a2 = rough*rough; float dd = nh_*nh_*(a2 - 1.0) + 1.0; float ggx = a2 / (PI*dd*dd);
      float fres = 0.02 + 0.98*pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
      if (uMap < 0.5) col += (1.0 - landm)*(1.0 - ice)*vec3(1.0,0.95,0.85)*ggx*fres*max(mu,0.0)*shadow*0.6*(1.0 - uAllDay);
      // night lights, dimmed under clouds
      float lights = pow(texture(uNight, tuv).r, 1.6) * landm;
      // --- data layers ---
      vec3 dataC = vec3(0.0); float dataA = 0.0;
      if (uLayer == 1) { dataC = cmapTemp(F6.w); dataA = 0.88; }
      else if (uLayer == 2) { dataA = 0.0; }
      else if (uLayer == 3) { dataC = cmapSeq(Cc.z/60.0); dataA = 0.9; }
      else if (uLayer == 4) { dataC = cmapWind(length(uWind > 1.5 ? D.zw : D.xy)); dataA = 0.0; }
      else if (uLayer == 5) { float tb = 0.0; dataA = 0.0; }
      else if (uLayer == 6) { dataC = cmapTemp(B.y); dataA = 0.88; }
      // base shading for data views: flat-lit map so values read cleanly
      if (uLayer > 0 && uLayer != 2 && uLayer != 5) {
        float lit = uMap > 0.5 ? 1.0 : 0.35 + 0.65*day;
        vec3 base = mix(vec3(0.03,0.05,0.08), vec3(0.16,0.17,0.17), landm) * lit;
        col = mix(col, base*(1.0 - dataA) + dataC*dataA*lit*1.15, 0.97);
        float cw = fwidth(landm) + 1e-4;
        float coast = 1.0 - smoothstep(0.0, cw*1.3, abs(landm - 0.5));
        col = mix(col, vec3(0.92), coast*0.6);
      }
      // --- clouds (layer seen from above) ---
      if (uClouds > 0.5) {
        vec3 Pc = P; vec3 Nc = N;
        if (uMap < 0.5) { vec2 hc = hitSphere(ro, rd, RC_LOW); Pc = ro + rd*hc.x; Nc = normalize(Pc); }
        vec2 llc = lonlat(Nc); vec2 uvc = fuv(llc.x, llc.y);
        Cl c = cloudsD(Nc, uvc, uDetail);
        float muc = mix(dot(Nc, S), 0.8, uAllDay);
        // self-shadowing: optical depth a little toward the sun
        vec3 toS = normalize(S - Nc*muc);
        vec3 Ns = normalize(Nc + toS*0.004);
        vec2 lls = lonlat(Ns); Cl c2 = clouds(Ns, fuv(lls.x, lls.y));
        float selfsh = clamp(1.0 - 0.12*max(c2.tau - c.tau, 0.0), 0.72, 1.0);
        float lam = clamp((muc + 0.05)/1.05, 0.0, 1.0);
        vec3 cl = sunc * (0.25 + 0.75*sqrt(lam)) * smoothstep(-0.12, 0.06, muc) * 2.1 * selfsh;
        cl *= 0.82 + 0.18*clamp(c.tau/6.0, 0.0, 1.0);           // thick clouds a bit brighter
        cl += vec3(0.012, 0.016, 0.026) * (1.0 - smoothstep(-0.2, 0.05, muc));   // faint moonlit/airglow tone at night
        float a = c.tot;
        if (uLayer > 0 && uLayer != 2 && uLayer != 5) a *= 0.16;
        col = mix(col, cl, a);
        if (uLayer == 5) {
          // infrared: brightness temperature from the model's outgoing longwave, cloud tops from the texture
          vec4 B5 = FB(uvc); vec4 F5 = FF(uvc);
          float tsf = B5.y, ctt = min(F5.z, tsf);
          float tp = mix(tsf, ctt, clamp(c.tot*1.15, 0.0, 1.0));
          float g = pow(clamp((32.0 - tp)/95.0, 0.0, 1.0), 0.85);
          vec3 ir = vec3(g);
          if (tp < -45.0) { float x = clamp((-45.0 - tp)/35.0, 0.0, 1.0); ir = x < 0.33 ? mix(vec3(0.3,0.75,1.0), vec3(0.15,0.35,0.95), x*3.0) : x < 0.66 ? mix(vec3(0.15,0.35,0.95), vec3(0.95,0.2,0.2), x*3.0-1.0) : mix(vec3(0.95,0.2,0.2), vec3(1.0,0.95,0.3), x*3.0-2.0); }
          col = ir * 0.9;
        }
        lights *= 1.0 - 0.8*a;
        // lightning in deep convection on the night side
        if (uFlash > 0.5) {
          vec4 A = FA(uvc); float cp = F6.x;
          vec2 cell = floor(vec2(llc.x, llc.y) * 180.0);
          float h = hash12(cell + floor(uTime*7.0));
          float storm = smoothstep(0.35, 0.8, A.w) * step(0.985, h) * c.conv;
          col += vec3(0.75, 0.8, 1.0) * storm * (1.0 - day) * 2.5;
        }
      }
      // isobars (sea-level pressure), every 4 hPa, bold every 20
      if (uIsobars > 0.5) {
        float pr = B.z; float x = pr/4.0; float fw = fwidth(x);
        float line = 1.0 - smoothstep(0.0, fw*1.2, abs(fract(x + 0.5) - 0.5));
        float bold = 1.0 - smoothstep(0.0, fw*1.6, abs(fract(pr/20.0 + 0.5) - 0.5)*5.0);
        vec3 ic = uLayer > 0 ? vec3(0.95) : vec3(1.0, 0.95, 0.8);
        col = mix(col, ic, clamp(max(line*0.55, bold*0.85), 0.0, 1.0) * (uMap > 0.5 ? 1.0 : 0.4 + 0.6*day + 0.3));
      }
      // wind trails, drawn above the clouds; slow air fades out so the fast streams stand out
      if (uWind > 0.5) {
        vec4 tr = texture(uTrail, tuv0);
        float spd = tr.r;
        if (uLayer == 0) col *= 0.28;
        float fa = uWind > 1.5 ? smoothstep(8.0, 30.0, spd) : smoothstep(0.5, 7.0, spd);
        vec3 wc = cmapWind(uWind > 1.5 ? spd * 0.6 : spd * 1.6);
        float lit = uLayer > 0 ? 1.0 : 0.55 + 0.45*day;
        col = mix(col, wc*lit*1.25, clamp(tr.g, 0.0, 1.0)*(0.25 + 0.7*fa));
      }
      col += vec3(1.0, 0.78, 0.45) * lights * (1.0 - day) * 0.6 * uLights * (uLayer == 5 ? 0.0 : uLayer > 0 ? 0.2 : 1.0);
      // radar-style rain and snow on top of the satellite view (snow where the air near the ground is below freezing)
      if (uLayer == 2) {
        float r = B.x; float a = smoothstep(0.08, 0.35, r) * 0.9;
        vec3 rc = F6.w < 0.0 ? mix(vec3(0.75, 0.85, 1.0), vec3(0.95, 0.6, 1.0), smoothstep(0.3, 3.0, r)) : cmapRain(r);
        float lit = uMap > 0.5 ? 1.0 : 0.45 + 0.55*day;
        col = mix(col, rc * lit * 1.1, a);
      }
      // graticule
      if (uGrid > 0.5) {
        vec2 g = vec2(lon, lat) * 180.0/PI / 15.0; vec2 fw = fwidth(g);
        vec2 grd = 1.0 - smoothstep(vec2(0.0), fw*1.1, abs(fract(g + 0.5) - 0.5));
        col = mix(col, vec3(0.7,0.8,0.9), max(grd.x, grd.y)*0.18);
      }
      // station marker
      if (uStationOn > 0.5) { float d = acos(clamp(dot(N, uStation), -1.0, 1.0)); float ring = smoothstep(uStationR*0.6, uStationR*0.45, abs(d - uStationR)); col = mix(col, vec3(1.0, 0.77, 0.42), ring*0.95); }
    }
    // atmosphere limb and haze
    if (uMap < 0.5) {
      vec2 ha = hitSphere(ro, rd, RATM);
      if (ha.y > 0.0) {
        float t0 = max(ha.x, 0.0), t1 = hit ? tHit : ha.y;
        vec3 mid = ro + rd*0.5*(t0 + t1);
        float h = length(mid) - 1.0;
        float len = t1 - t0;
        float dens = exp(-max(h, 0.0)/0.0075);
        float od = len * dens * 18.0;
        vec3 Nm = normalize(mid); float mus = dot(Nm, S);
        float sunlit = mix(smoothstep(-0.25, 0.25, mus), 1.0, uAllDay); mus = mix(mus, 0.8, uAllDay);
        vec3 ray = vec3(0.28, 0.52, 1.0);
        vec3 sunset = vec3(1.0, 0.45, 0.2);
        vec3 scat = mix(sunset, ray, smoothstep(-0.05, 0.4, mus)) * sunlit;
        float cosT = dot(rd, S); float phase = 0.75*(1.0 + cosT*cosT);
        vec3 inscat = scat * (1.0 - exp(-od)) * phase * (hit ? 0.55 : 1.1);
        col = col * exp(-od * (hit ? 0.25 : 0.0) * vec3(0.6, 0.8, 1.0)) + inscat;
      }
    }
    // tonemap (filmic)
    col *= uExposure;
    col = col / (1.0 + col*0.6);
    col = pow(col, vec3(1.0/2.2));
    o = vec4(col, 1.0);
  }`, 'globe and map');

  // every shader must fit the 16 texture units WebGL2 guarantees (and Windows enforces): report, and stop with a clear message
  {
    const maxUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
    console.info(`texture samplers per shader (this GPU allows ${maxUnits}): ` + E.samplerReport.map(r => `${r.program} ${r.samplers}`).join(', '));
    const over = E.samplerReport.filter(r => r.samplers > Math.min(maxUnits, 16));
    if (over.length) throw new Error(`shader "${over[0].program}" uses ${over[0].samplers} texture samplers; WebGL2 guarantees ${Math.min(maxUnits, 16)} (this GPU allows ${maxUnits})`);
  }

  // ---------------- camera & draw ----------------
  E.cam = { lon: -20 * Math.PI / 180, lat: 40 * Math.PI / 180, dist: 3.1, fov: 32 * Math.PI / 180 };
  E.view = { map: false, mapLon: 0, mapLat: 0, mapZoom: 1 };
  E.layer = 0; E.clouds = true; E.wind = 0; E.isobars = false; E.lights = 1; E.flash = true; E.grid = false; E.exposure = 1.0;
  E.station = null; E.mix = 1; E.sun = [1, 0, 0]; E.aqua = false; E.allDay = 0;
  E.fovY = function () { const asp = canvas.clientWidth / Math.max(1, canvas.clientHeight); return asp >= 1 ? E.cam.fov : 2 * Math.atan(Math.tan(E.cam.fov / 2) / asp); };
  E.camVectors = function () {
    const c = E.cam, cl = Math.cos(c.lat);
    const pos = [c.dist * cl * Math.cos(c.lon), c.dist * cl * Math.sin(c.lon), c.dist * Math.sin(c.lat)];
    const f = pos.map((x) => -x / c.dist);
    let up = [0, 0, 1];
    let r = [f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]];
    const rl = Math.hypot(...r) || 1; r = r.map((x) => x / rl);
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    return { pos, f, r, u };
  };
  E.draw = function (time) {
    const w = canvas.width, h = canvas.height;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.useProgram(mainP.p);
    let u = bindFields(mainP, 0);
    const bind = (name, t) => { if (!mainP.u[name]) return; gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(mainP.u[name], u); u++; };
    bind('uDay', E.tex.day); bind('uNight', E.tex.night); bind('uLand', E.tex.land); bind('uElev', E.tex.elev);
    bind('uTrail', trailTex[trailCur]);
    u = bindClouds(mainP, u);
    const cv = E.camVectors();
    gl.uniform3fv(mainP.u.uCam, cv.pos); gl.uniform3fv(mainP.u.uCamR, cv.r); gl.uniform3fv(mainP.u.uCamU, cv.u); gl.uniform3fv(mainP.u.uCamF, cv.f);
    gl.uniform3fv(mainP.u.uSun, E.sun);
    gl.uniform2f(mainP.u.uRes, w, h); gl.uniform1f(mainP.u.uFov, E.fovY());
    gl.uniform1f(mainP.u.uMap, E.view.map ? 1 : 0); gl.uniform1f(mainP.u.uMapLon, E.view.mapLon); gl.uniform1f(mainP.u.uMapLat, E.view.mapLat); gl.uniform1f(mainP.u.uMapZoom, E.view.mapZoom);
    gl.uniform1i(mainP.u.uLayer, E.layer); gl.uniform1f(mainP.u.uClouds, E.clouds ? 1 : 0); gl.uniform1f(mainP.u.uWind, E.wind);
    gl.uniform1f(mainP.u.uIsobars, E.isobars ? 1 : 0); gl.uniform1f(mainP.u.uTime, time); gl.uniform1f(mainP.u.uLights, E.lights);
    gl.uniform1f(mainP.u.uFlash, E.flash ? 1 : 0); gl.uniform1f(mainP.u.uExposure, E.exposure); gl.uniform1f(mainP.u.uGrid, E.grid ? 1 : 0);
    if (E.station) { gl.uniform3fv(mainP.u.uStation, E.station); gl.uniform1f(mainP.u.uStationOn, 1); gl.uniform1f(mainP.u.uStationR, E.view.map ? 0.012 / E.view.mapZoom : 0.0045 * (E.cam.dist - 1) + 0.0015); } else gl.uniform1f(mainP.u.uStationOn, 0);
    gl.uniform1f(mainP.u.uAqua, E.aqua ? 1 : 0); gl.uniform1f(mainP.u.uAllDay, E.allDay);
    gl.uniform1f(mainP.u.uDetail, E.view.map ? Math.min(1, Math.max(0, (E.view.mapZoom - 2) / 4)) : Math.min(1, Math.max(0, (1.9 - E.cam.dist) / 0.6)));
    gl.bindVertexArray(quadVAO); gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  // screen pixel -> [lon, lat] (radians) or null
  E.pick = function (x, y) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const vx = x / w, vy = 1 - y / h;
    if (E.view.map) {
      const lon = E.view.mapLon + (vx - 0.5) * 2 * Math.PI / E.view.mapZoom;
      const lat = E.view.mapLat + (vy - 0.5) * Math.PI / E.view.mapZoom * (h / w) * 2;
      if (Math.abs(lat) > Math.PI / 2) return null;
      return [((lon % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI, lat];
    }
    const cv = E.camVectors(), t = Math.tan(E.fovY() / 2);
    const sx = (vx - 0.5) * (w / h) * 2 * t, sy = (vy - 0.5) * 2 * t;
    const rd = [0, 1, 2].map((i) => cv.f[i] + sx * cv.r[i] + sy * cv.u[i]); const l = Math.hypot(...rd); for (let i = 0; i < 3; i++) rd[i] /= l;
    const ro = cv.pos, b = ro[0] * rd[0] + ro[1] * rd[1] + ro[2] * rd[2], c = ro[0] ** 2 + ro[1] ** 2 + ro[2] ** 2 - 1, hh = b * b - c;
    if (hh < 0) return null;
    const tt = -b - Math.sqrt(hh), p = [0, 1, 2].map((i) => ro[i] + rd[i] * tt);
    return [Math.atan2(p[1], p[0]), Math.asin(Math.max(-1, Math.min(1, p[2])))];
  };
  // [lon, lat] -> screen [x, y, visible]
  E.project = function (lon, lat) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (E.view.map) {
      let dl = lon - E.view.mapLon; dl = ((dl + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
      const vx = 0.5 + dl * E.view.mapZoom / (2 * Math.PI), vy = 0.5 + (lat - E.view.mapLat) * E.view.mapZoom / Math.PI / ((h / w) * 2);
      return [vx * w, (1 - vy) * h, vx > 0 && vx < 1 && vy > 0 && vy < 1];
    }
    const cv = E.camVectors(), cl = Math.cos(lat);
    const p = [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)];
    const d = [p[0] - cv.pos[0], p[1] - cv.pos[1], p[2] - cv.pos[2]];
    const z = d[0] * cv.f[0] + d[1] * cv.f[1] + d[2] * cv.f[2];
    const vis = (p[0] * cv.pos[0] + p[1] * cv.pos[1] + p[2] * cv.pos[2]) > 1.0; // in front of the limb
    const t = Math.tan(E.fovY() / 2);
    const sx = (d[0] * cv.r[0] + d[1] * cv.r[1] + d[2] * cv.r[2]) / z / t, sy = (d[0] * cv.u[0] + d[1] * cv.u[1] + d[2] * cv.u[2]) / z / t;
    return [(0.5 + sx * 0.5 * h / w) * w, (0.5 - sy * 0.5) * h, vis && z > 0];
  };
  E.ok = !!extCBF;
}
if (typeof module !== 'undefined') module.exports = Engine;

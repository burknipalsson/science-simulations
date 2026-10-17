/* The Chirp: WebGL 2 renderer. A log-polar spacetime sheet (wells + retarded-time quadrupole ripples),
   a starfield, bloom, and a screen-space pass that lenses the picture around black holes and draws
   neutron stars, the kilonova and the jet. */
function ChirpEngine(gl){
  const ext = gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float');
  if (!ext) throw new Error('no float render targets');
  gl.getExtension('OES_texture_float_linear');
  const NR = 640, NA = 720, RHO_IN = 0.004, RHO_OUT = 5.0, NSUB_MAX = 8;

  function sh(type, src){
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src.split('\n').map((l, i) => (i + 1) + ' ' + l).join('\n'));
    return s;
  }
  function prog(vs, fs){
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aRA'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++){ const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
    return { p, u };
  }
  const HDR = '#version 300 es\nprecision highp float;\nprecision highp int;\n';
  const FS_TRI = HDR + 'const vec2 P[3]=vec2[3](vec2(-1.,-1.),vec2(3.,-1.),vec2(-1.,3.));\nout vec2 vUV;\nvoid main(){ vec2 p=P[gl_VertexID]; vUV=p*.5+.5; gl_Position=vec4(p,0.,1.); }';

  /* ---------- starfield ---------- */
  const STARS = prog(FS_TRI, HDR + `
  in vec2 vUV; out vec4 o;
  uniform vec3 uFwd, uRight, uUp; uniform vec2 uTan;
  vec4 hash4(vec3 p){ vec4 q = fract(vec4(p.xyzx) * vec4(.1031, .1030, .0973, .1099)); q += dot(q, q.wzxy + 33.33);
    return fract((q.xxyz + q.yzzw) * q.zywx); }
  vec3 layer(vec3 d, float sc, float thr, float sz){
    vec3 q = d * sc, c = floor(q); vec4 h = hash4(c);
    if (h.w < thr) return vec3(0.);
    vec3 sp = c + 0.5 + 0.7 * (h.xyz - 0.5);
    float r = length(q - sp);
    float b = pow((h.w - thr) / (1. - thr), 3.) ;
    vec3 col = mix(vec3(1.0, 0.78, 0.6), vec3(0.7, 0.82, 1.0), h.x);
    return col * b * exp(-r * r / (sz * sz)) * 3.;
  }
  void main(){
    vec2 n = vUV * 2. - 1.;
    vec3 d = normalize(uFwd + n.x * uTan.x * uRight + n.y * uTan.y * uUp);
    vec3 c = layer(d, 220., 0.90, 0.07) + layer(d, 90., 0.93, 0.05) * 1.3 + layer(d, 520., 0.85, 0.09) * 0.5;
    // faint galactic band
    vec3 bn = normalize(vec3(0.3, 0.8, 0.52));
    float band = exp(-pow(dot(d, bn) / 0.22, 2.));
    vec4 hh = hash4(floor(d * 60.));
    c += vec3(0.05, 0.055, 0.08) * band * (0.6 + 0.4 * hh.x);
    c += vec3(0.008, 0.01, 0.018);
    o = vec4(c, 1.);
  }`);

  /* ---------- the sheet ---------- */
  const SHEET = prog(HDR + `
  in vec2 aRA;
  uniform sampler2D uRip; uniform float uRview, uLnIn, uLnOut, uNR, uAmpRef;
  uniform mat4 uVP; uniform vec4 uWell[3];
  out vec3 vPos; out float vRip; out float vRho;
  void main(){
    float k = aRA.x;
    float rho = exp(mix(uLnIn, uLnOut, k / (uNR - 1.)));
    float r = uRview * rho;
    vec2 p = r * vec2(cos(aRA.y), sin(aRA.y));
    vec4 R = texelFetch(uRip, ivec2(int(k), 0), 0);
    float rip = R.x * cos(2. * aRA.y - R.y);
    float z = rip;
    for (int i = 0; i < 3; i++){ vec4 W = uWell[i]; if (W.z > 0.){ vec2 d = p - W.xy; z -= W.z * W.w / sqrt(W.w * W.w + dot(d, d)); } }
    vPos = vec3(p, z); vRip = rip / uAmpRef; vRho = rho;
    gl_Position = uVP * vec4(vPos, 1.);
  }`, HDR + `
  in vec3 vPos; in float vRip; in float vRho; out vec4 o;
  uniform vec3 uCam; uniform float uGrid, uGridFade, uRhoOut, uShowGrid;
  float lines(vec2 p, float s){
    vec2 q = p / s, w = fwidth(q);
    vec2 g = abs(fract(q - 0.5) - 0.5) / max(w, 1e-5);
    float l = 1. - min(min(g.x, g.y), 1.);
    return l * (1. - smoothstep(0.18, 0.45, max(w.x, w.y)));
  }
  void main(){
    vec3 dx = dFdx(vPos), dy = dFdy(vPos);
    vec3 n = normalize(cross(dx, dy)); if (n.z < 0.) n = -n;
    vec3 v = normalize(uCam - vPos);
    vec3 L = normalize(vec3(-0.35, 0.45, 0.82));
    float diff = 0.35 + 0.65 * max(dot(n, L), 0.);
    float spec = pow(max(dot(reflect(-L, n), v), 0.), 24.);
    float crest = clamp(vRip, 0., 1.5), trough = clamp(-vRip, 0., 1.5);
    vec3 base = vec3(0.010, 0.016, 0.030) * diff + vec3(0.9, 0.55, 0.22) * crest * 0.10 + vec3(0.12, 0.3, 0.7) * trough * 0.07;
    base += vec3(0.5, 0.7, 0.9) * spec * 0.18;
    float l = max(lines(vPos.xy, uGrid * 2.), lines(vPos.xy, uGrid) * (1. - uGridFade));
    vec3 lc = mix(vec3(0.30, 0.62, 0.80), vec3(1.0, 0.72, 0.38), clamp(crest * 0.9, 0., 1.));
    lc *= 0.55 + 1.3 * crest + 0.25 * trough;
    vec3 col = base + lc * l * 0.85 * uShowGrid;
    // near the holes the funnel walls face the camera: brighten the rim a touch
    col += vec3(0.25, 0.45, 0.75) * pow(1. - abs(dot(n, v)), 3.) * 0.08;
    float a = 1. - smoothstep(0.45 * uRhoOut, 0.98 * uRhoOut, vRho);
    o = vec4(col * a, a);
  }`);

  /* ---------- bloom and final composite ---------- */
  const BRIGHT = prog(FS_TRI, HDR + `
  in vec2 vUV; out vec4 o; uniform sampler2D uTex; uniform vec2 uTexel;
  void main(){
    vec3 c = vec3(0.);
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) c += texture(uTex, vUV + vec2(i, j) * uTexel).rgb;
    c /= 9.; float b = max(max(c.r, c.g), c.b);
    o = vec4(c * smoothstep(0.35, 1.2, b), 1.);
  }`);
  const BLUR = prog(FS_TRI, HDR + `
  in vec2 vUV; out vec4 o; uniform sampler2D uTex; uniform vec2 uDir;
  void main(){
    const float w[5] = float[5](0.227, 0.194, 0.121, 0.054, 0.016);
    vec3 c = texture(uTex, vUV).rgb * w[0];
    for (int i = 1; i < 5; i++){ c += texture(uTex, vUV + uDir * float(i)).rgb * w[i]; c += texture(uTex, vUV - uDir * float(i)).rgb * w[i]; }
    o = vec4(c, 1.);
  }`);
  const FINAL = prog(FS_TRI, HDR + `
  in vec2 vUV; out vec4 o;
  uniform sampler2D uScene, uBloom; uniform vec2 uRes;
  uniform vec4 uB[${NSUB_MAX * 3}];   // per sub-frame sample: 3 bodies (x px, y px, radius px, visibility)
  uniform vec4 uBT[3];                // body kind (0 none, 1 black hole, 2 neutron star), glow, tidal stretch, spare
  uniform int uNS;
  uniform vec4 uKN;                   // kilonova: x, y, radius px, strength
  uniform vec3 uKNcol;
  uniform vec4 uJet;                  // jet: x, y, dx, dy (px, toward +z)
  uniform float uJetI, uFlash, uExposure;
  uniform vec4 uHalo[3];              // soft markers so tiny far-off bodies stay findable: x, y, radius px, strength
  vec3 shade(vec2 p, int s){
    vec2 off = vec2(0.); float S = 0.;
    for (int i = 0; i < 3; i++){
      vec4 b = uB[s * 3 + i];
      if (uBT[i].x == 1. && b.w > 0.){
        vec2 d = p - b.xy; float d2 = max(dot(d, d), 1e-3);
        float rE = 1.55 * b.z;
        off += b.w * rE * rE * d / d2;
        S += b.w * b.z * b.z / d2;
      }
    }
    vec3 c = texture(uScene, (p - off) / uRes).rgb;
    float rs = sqrt(S);                        // 1 at the edge of the shadow
    c *= 1. - smoothstep(0.92, 1.02, rs);
    c += vec3(1.0, 0.82, 0.62) * exp(-pow((rs - 0.9) / 0.045, 2.)) * 0.55 * step(0.001, S);
    // neutron stars: hot, limb-darkened spheres, stretched along the line to the partner near contact
    for (int i = 0; i < 3; i++){
      vec4 b = uB[s * 3 + i];
      if (uBT[i].x == 2. && b.w > 0.){
        vec2 d = p - b.xy;
        vec2 ax = normalize(b.xy - uB[s * 3 + (1 - min(i, 1))].xy + vec2(1e-4, 0.));
        float st = 1. + uBT[i].z;
        vec2 dd = vec2(dot(d, ax) / st, dot(d, vec2(-ax.y, ax.x)) * sqrt(st));
        float q = length(dd) / max(b.z, 0.6);
        float disk = 1. - smoothstep(0.92, 1.0, q);
        float limb = sqrt(max(1. - q * q, 0.));
        vec3 hot = mix(vec3(0.55, 0.7, 1.2), vec3(1.6, 1.5, 1.4), limb) * (0.5 + 0.6 * limb);
        c = mix(c, hot * uBT[i].y, disk * b.w);
        c += vec3(0.4, 0.55, 1.0) * exp(-max(q - 1., 0.) * 2.2) * 0.35 * b.w * uBT[i].y * (1. - disk);
      }
    }
    return c;
  }
  void main(){
    vec2 p = gl_FragCoord.xy;
    vec3 c = vec3(0.);
    for (int s = 0; s < ${NSUB_MAX}; s++){ if (s >= uNS) break; c += shade(p, s); }
    c /= float(uNS);
    c += texture(uBloom, vUV).rgb * 0.9;
    for (int i = 0; i < 3; i++){
      vec4 h = uHalo[i]; if (h.w > 0.){ float d = length(p - h.xy); c += vec3(0.55, 0.7, 1.0) * h.w * exp(-d * d / (h.z * h.z)); }
    }
    if (uKN.w > 0.){
      float d = length(p - uKN.xy), R = max(uKN.z, 1.);
      float shell = exp(-pow((d - R) / (0.28 * R + 2.), 2.)), fill = exp(-pow(d / (R + 2.), 2.));
      c += uKNcol * uKN.w * (0.8 * shell + 0.3 * fill);
    }
    if (uJetI > 0.){
      vec2 a = uJet.xy, dir = uJet.zw; float len = length(dir);
      if (len > 1.){
        vec2 u = dir / len; vec2 d = p - a; float t = dot(d, u); float side = abs(dot(d, vec2(-u.y, u.x)));
        float along = abs(t);   // both jets, up and down
        float w = 2. + along * 0.06;
        c += vec3(0.75, 0.85, 1.0) * uJetI * exp(-pow(side / w, 2.)) * exp(-along / (len * 1.4)) * 1.6;
      }
    }
    c += vec3(0.9, 0.95, 1.0) * uFlash;
    c = vec3(1.) - exp(-c * uExposure);
    vec2 q = vUV - 0.5; c *= 1. - 0.35 * dot(q, q) * 1.6;
    o = vec4(pow(c, vec3(0.92)), 1.);
  }`);

  /* ---------- geometry ---------- */
  const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const verts = new Float32Array(NR * (NA + 1) * 2);
  let k = 0;
  for (let i = 0; i < NR; i++) for (let j = 0; j <= NA; j++){ verts[k++] = i; verts[k++] = j / NA * 2 * Math.PI; }
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const idx = new Uint32Array((NR - 1) * NA * 6); k = 0;
  for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NA; j++){
    const a = i * (NA + 1) + j, b = a + 1, c = a + NA + 1, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  const emptyVao = gl.createVertexArray();

  const ripTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, ripTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, NR, 1, 0, gl.RGBA, gl.FLOAT, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

  /* ---------- render targets ---------- */
  function target(w, h){
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return { t, f, w, h };
  }
  let W = 0, H = 0, scene, depthRB, bA, bB;
  function resize(w, h){
    if (w === W && h === H) return; W = w; H = h;
    for (const x of [scene, bA, bB]) if (x){ gl.deleteTexture(x.t); gl.deleteFramebuffer(x.f); }
    if (depthRB) gl.deleteRenderbuffer(depthRB);
    scene = target(w, h);
    depthRB = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, depthRB);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w, h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.f);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthRB);
    const bw = Math.max(1, w >> 2), bh = Math.max(1, h >> 2);
    bA = target(bw, bh); bB = target(bw, bh);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  function render(F){
    // stars
    gl.bindFramebuffer(gl.FRAMEBUFFER, scene.f); gl.viewport(0, 0, W, H);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(STARS.p); gl.bindVertexArray(emptyVao);
    gl.uniform3fv(STARS.u.uFwd, F.cam.fwd); gl.uniform3fv(STARS.u.uRight, F.cam.right); gl.uniform3fv(STARS.u.uUp, F.cam.up);
    gl.uniform2f(STARS.u.uTan, F.cam.tanX, F.cam.tanY);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    // sheet
    gl.clear(gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindTexture(gl.TEXTURE_2D, ripTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, NR, 1, gl.RGBA, gl.FLOAT, F.rip);
    gl.useProgram(SHEET.p); gl.bindVertexArray(vao);
    const u = SHEET.u;
    gl.activeTexture(gl.TEXTURE0); gl.uniform1i(u.uRip, 0);
    gl.uniform1f(u.uRview, F.Rview); gl.uniform1f(u.uLnIn, Math.log(RHO_IN)); gl.uniform1f(u.uLnOut, Math.log(RHO_OUT));
    gl.uniform1f(u.uNR, NR); gl.uniform1f(u.uAmpRef, F.ampRef);
    gl.uniformMatrix4fv(u.uVP, false, F.VP); gl.uniform4fv(u.uWell, F.wells);
    gl.uniform3fv(u.uCam, F.cam.pos); gl.uniform1f(u.uGrid, F.grid); gl.uniform1f(u.uGridFade, F.gridFade);
    gl.uniform1f(u.uRhoOut, RHO_OUT); gl.uniform1f(u.uShowGrid, F.showGrid ? 1 : 0.15);
    gl.drawElements(gl.TRIANGLES, idx.length, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    // bloom
    gl.bindVertexArray(emptyVao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, bA.f); gl.viewport(0, 0, bA.w, bA.h);
    gl.useProgram(BRIGHT.p); gl.bindTexture(gl.TEXTURE_2D, scene.t); gl.uniform1i(BRIGHT.u.uTex, 0);
    gl.uniform2f(BRIGHT.u.uTexel, 1.5 / W, 1.5 / H); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(BLUR.p); gl.uniform1i(BLUR.u.uTex, 0);
    for (let pass = 0; pass < 2; pass++){
      gl.bindFramebuffer(gl.FRAMEBUFFER, bB.f); gl.bindTexture(gl.TEXTURE_2D, bA.t); gl.uniform2f(BLUR.u.uDir, (1 + pass) / bA.w, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, bA.f); gl.bindTexture(gl.TEXTURE_2D, bB.t); gl.uniform2f(BLUR.u.uDir, 0, (1 + pass) / bA.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    // composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, W, H);
    const f = FINAL.u; gl.useProgram(FINAL.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, scene.t); gl.uniform1i(f.uScene, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, bA.t); gl.uniform1i(f.uBloom, 1);
    gl.uniform2f(f.uRes, W, H);
    gl.uniform4fv(f.uB, F.bodies); gl.uniform4fv(f.uBT, F.btypes); gl.uniform1i(f.uNS, F.nsub);
    gl.uniform4fv(f.uKN, F.kn); gl.uniform3fv(f.uKNcol, F.knCol);
    gl.uniform4fv(f.uJet, F.jet); gl.uniform1f(f.uJetI, F.jetI); gl.uniform1f(f.uFlash, F.flash);
    gl.uniform1f(f.uExposure, F.exposure); gl.uniform4fv(f.uHalo, F.halos);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(null);
  }
  return { resize, render, NR, NA, RHO_IN, RHO_OUT, NSUB_MAX };
}

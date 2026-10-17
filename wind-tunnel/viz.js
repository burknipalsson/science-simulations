// Rendering for the wind tunnel: turns the solver's macro atlas into 3D textures (velocity +
// pressure, and vorticity + Q-criterion), bakes the body's distance field into a fine 3D texture,
// advects smoke particles (state in a float texture), and raymarches body, vortex surfaces and cut
// planes. Everything is in lattice units (x downstream, y across, z up).

const VIZ_FIELD_FS = GLSL_HEAD + GLSL_ATLAS + `
uniform sampler2D M; uniform int Z; uniform float pScale;
layout(location = 0) out vec4 oVel; layout(location = 1) out vec4 oAux;
vec4 m(ivec3 p) { return texelFetch(M, A(clamp(p, ivec3(0), N - 1)), 0); }
void main() {
  ivec3 p = ivec3(ivec2(gl_FragCoord.xy), Z);
  vec4 c = m(p);
  if (c.w == 0.) { oVel = vec4(0.); oAux = vec4(0.); return; }
  vec3 dx = (m(p + ivec3(1, 0, 0)).xyz - m(p - ivec3(1, 0, 0)).xyz) * 0.5;
  vec3 dy = (m(p + ivec3(0, 1, 0)).xyz - m(p - ivec3(0, 1, 0)).xyz) * 0.5;
  vec3 dz = (m(p + ivec3(0, 0, 1)).xyz - m(p - ivec3(0, 0, 1)).xyz) * 0.5;
  mat3 G = mat3(dx, dy, dz); // G[j][i] = du_i/dx_j
  mat3 Gt = transpose(G), S = 0.5 * (G + Gt), O = 0.5 * (G - Gt);
  float s2 = 0., o2 = 0.;
  for (int i = 0; i < 3; i++) { s2 += dot(S[i], S[i]); o2 += dot(O[i], O[i]); }
  vec3 w = vec3(dy.z - dz.y, dz.x - dx.z, dx.y - dy.x);
  oVel = vec4(c.xyz, (c.w - 1.) / 3. * pScale);
  oAux = vec4(0.5 * (o2 - s2), w);
}`;

const VIZ_BAKE_FS = GLSL_HEAD + `
uniform vec3 lo, hi; uniform ivec3 R; uniform int Z; uniform vec4 SP; out vec4 o;
//SDF
void main() {
  vec3 f = (vec3(ivec2(gl_FragCoord.xy), Z) + 0.5) / vec3(R);
  o = vec4(sdf(mix(lo, hi, f)), 0., 0., 1.);
}`;

const VIZ_PART_FS = GLSL_HEAD + `
uniform sampler2D PS; uniform int PW; out vec4 b;
uniform sampler3D VEL, BODY; uniform vec3 N, bLo, bHi; uniform float dt, life, seed;
uniform vec3 rLo, rHi; uniform ivec2 noz; uniform int perNoz, pulse; uniform float jitter, T, pulseP, pulseL;
float hash(float n) { return fract(sin(n) * 43758.5453123); }
vec3 vel(vec3 p) { return texture(VEL, (p + 0.5) / N).xyz; }
float body(vec3 p) { vec3 f = (p - bLo) / (bHi - bLo); return all(greaterThan(f, vec3(0.))) && all(lessThan(f, vec3(1.))) ? texture(BODY, f).r : 1e3; }
void main() {
  ivec2 pc = ivec2(gl_FragCoord.xy); vec4 s = texelFetch(PS, pc, 0); int id = pc.x + pc.y * PW;
  if (s.w >= 0.) {
    vec3 u1 = vel(s.xyz), u2 = vel(s.xyz + 0.5 * dt * u1);
    s.xyz += dt * u2;
  }
  s.w += dt;
  bool out_ = any(lessThan(s.xyz, vec3(-0.5))) || any(greaterThan(s.xyz, N - 1.)) || body(s.xyz) < 0.3;
  if (s.w > life || (s.w >= 0. && out_)) {
    int k = id % (noz.x * noz.y);
    vec2 g = (vec2(k % noz.x, k / noz.x) + 0.5) / vec2(noz);
    float h = hash(float(id) * 0.6180339 + seed);
    vec3 j = jitter * (vec3(hash(h * 91.7), hash(h * 13.3), hash(h * 57.1)) - 0.5);
    s.xyz = vec3(rLo.x, mix(rLo.y, rHi.y, g.x), mix(rLo.z, rHi.z, g.y)) + j;
    // spread this frame's emissions along the stream by a random fraction of the frame's travel;
    // in puff mode, hold the particle at the nozzle until the next puff
    float fr = hash(h * 7.77 + 0.5), ph = mod(T, pulseP);
    if (pulse == 0 || ph < pulseL) { s.xyz += vel(s.xyz) * dt * fr; s.w = dt * fr; }
    else s.w = -(pulseP - ph) - fr * pulseL;
  }
  b = s;
}`;

const VIZ_DRAW_VS = GLSL_HEAD + `
uniform sampler2D PS; uniform int PW; uniform mat4 VP; uniform sampler3D VEL; uniform vec3 N; uniform float uRef, psize, life;
uniform int colorBy; uniform ivec2 noz;
out vec4 col;
vec3 ramp(float t) { t = clamp(t, 0., 1.); return mix(mix(vec3(0.35, 0.55, 1.), vec3(0.85, 0.92, 1.), smoothstep(0., .5, t)), vec3(1., 0.62, 0.28), smoothstep(.5, 1., t)); }
void main() {
  vec4 a = texelFetch(PS, ivec2(gl_VertexID % PW, gl_VertexID / PW), 0);
  if (a.w < 0.) { gl_Position = vec4(2., 2., 2., 1.); gl_PointSize = 0.; return; }
  gl_Position = VP * vec4(a.xyz, 1.);
  float sp = length(texture(VEL, (a.xyz + 0.5) / N).xyz) / uRef;
  vec3 c = ramp((sp - 0.4) / 1.);
  if (colorBy == 1) { int k = gl_VertexID % (noz.x * noz.y); c = (k / noz.x) % 2 == 0 ? vec3(1., 0.72, 0.42) : vec3(0.55, 0.78, 1.); }
  float fade = smoothstep(0., 30., a.w) * (1. - smoothstep(life * 0.85, life, a.w));
  col = vec4(c * fade, 1.);
  gl_PointSize = psize;
}`;
const VIZ_DRAW_FS = GLSL_HEAD + `in vec4 col; uniform float alpha; out vec4 o; void main() { o = vec4(col.rgb * alpha, 1.); }`;

const VIZ_RAY_FS = GLSL_HEAD + `
in vec2 uv; out vec4 o;
uniform mat4 invVP, VP; uniform vec3 eye, N, bLo, bHi;
uniform sampler3D VEL, AUX, BODY;
uniform int mode, sliceAxis, sliceField, floorOn, hasBody, colorIso;
uniform float slicePos, qThr, uRef, cpOn, wRef, clipY;
uniform vec3 lightDir;
vec3 ramp(float t) { t = clamp(t, 0., 1.); return mix(mix(vec3(0.35, 0.55, 1.), vec3(0.85, 0.92, 1.), smoothstep(0., .5, t)), vec3(1., 0.62, 0.28), smoothstep(.5, 1., t)); }
// perceptual-ish maps
vec3 seqMap(float t) { t = clamp(t, 0., 1.);
  vec3 a = vec3(0.02, 0.03, 0.08), b = vec3(0.10, 0.25, 0.55), c = vec3(0.25, 0.65, 0.85), d = vec3(0.95, 0.85, 0.55), e = vec3(1., 0.45, 0.2);
  return t < .25 ? mix(a, b, t * 4.) : t < .5 ? mix(b, c, t * 4. - 1.) : t < .75 ? mix(c, d, t * 4. - 2.) : mix(d, e, t * 4. - 3.); }
vec3 divMap(float t) { t = clamp(t, -1., 1.);
  return t < 0. ? mix(vec3(0.85, 0.87, 0.9), vec3(0.15, 0.45, 0.95), -t) : mix(vec3(0.85, 0.87, 0.9), vec3(0.95, 0.35, 0.18), t); }
vec4 vel(vec3 p) { return texture(VEL, (p + 0.5) / N); }
vec4 aux(vec3 p) { return texture(AUX, (p + 0.5) / N); }
float body0(vec3 p);
float body(vec3 p) { return max(body0(p), clipY - p.y); }
float body0(vec3 p) {
  vec3 f = (p - bLo) / (bHi - bLo);
  if (all(greaterThan(f, vec3(0.002))) && all(lessThan(f, vec3(0.998)))) return texture(BODY, f).r;
  vec3 c = (bLo + bHi) * 0.5, h = (bHi - bLo) * 0.5, q = abs(p - c) - h;
  return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.) + 0.5;
}
vec2 box(vec3 ro, vec3 rd, vec3 lo, vec3 hi) {
  vec3 i = 1. / rd, t0 = (lo - ro) * i, t1 = (hi - ro) * i;
  vec3 a = min(t0, t1), b = max(t0, t1);
  return vec2(max(max(a.x, a.y), max(a.z, 0.)), min(b.x, min(b.y, b.z)));
}
vec3 bodyN(vec3 p) { vec2 e = vec2(0.35, 0.);
  return normalize(vec3(body(p + e.xyy) - body(p - e.xyy), body(p + e.yxy) - body(p - e.yxy), body(p + e.yyx) - body(p - e.yyx))); }
float depthOf(vec3 p) { vec4 c = VP * vec4(p, 1.); return c.z / c.w * 0.5 + 0.5; }
void main() {
  vec4 a = invVP * vec4(uv * 2. - 1., -1., 1.), b = invVP * vec4(uv * 2. - 1., 1., 1.);
  vec3 ro = eye, rd = normalize(b.xyz / b.w - a.xyz / a.w);
  vec3 lo = vec3(-0.5), hi = N - 0.5;
  // background
  vec3 col = mix(vec3(0.012, 0.016, 0.026), vec3(0.03, 0.04, 0.06), smoothstep(-0.4, 0.6, rd.z));
  float tHit = 1e9; vec3 hitCol = vec3(0.); bool hit = false;
  // floor grid
  if (floorOn > 0 && rd.z < 0.) {
    float t = (-0.5 - ro.z) / rd.z; vec3 p = ro + rd * t;
    vec2 g = abs(fract(p.xy / 16.) - 0.5) / fwidth(p.xy / 16.);
    float line = 1. - min(min(g.x, g.y), 1.);
    bool inside = p.x > lo.x && p.x < hi.x && p.y > lo.y && p.y < hi.y;
    float fadeD = exp(-0.0025 * max(t - 200., 0.));
    vec3 fc = (inside ? vec3(0.055, 0.06, 0.075) : vec3(0.025, 0.028, 0.036)) + line * (inside ? 0.06 : 0.025);
    if (floorOn == 2 && inside) fc = vec3(0.07, 0.075, 0.09) + line * 0.07;
    tHit = t; hitCol = mix(col, fc, fadeD); hit = true;
  }
  vec2 tb = box(ro, rd, lo, hi);
  // body (sphere tracing the baked distance field)
  if (hasBody > 0) {
    vec2 bb = box(ro, rd, bLo, bHi);
    if (bb.x < bb.y) {
      float t = bb.x;
      for (int i = 0; i < 160; i++) {
        vec3 p = ro + rd * t; float d = body(p);
        if (d < 0.04) {
          if (t < tHit) {
            vec3 n = bodyN(p), base = vec3(0.78, 0.8, 0.84);
            if (cpOn > 0.) { float cp = vel(p + n * 1.6).w / (0.5 * uRef * uRef); base = divMap(cp * 0.6) * 0.95; }
            float dif = max(dot(n, lightDir), 0.), amb = 0.28 + 0.22 * n.z, rim = pow(1. - max(dot(n, -rd), 0.), 3.);
            vec3 h = normalize(lightDir - rd);
            hitCol = base * (amb + 0.75 * dif) + 0.25 * pow(max(dot(n, h), 0.), 40.) + rim * 0.12;
            tHit = t; hit = true;
          }
          break;
        }
        t += max(d * 0.9, 0.05);
        if (t > bb.y) break;
      }
    }
  }
  // vortex cores (Q-criterion isosurface)
  if (mode == 1 && tb.x < tb.y) {
    float t = tb.x, t1 = min(tb.y, tHit), h = 0.7, prev = aux(ro + rd * t).x - qThr;
    for (int i = 0; i < 1400; i++) {
      t += h; if (t > t1) break;
      vec3 p = ro + rd * t; float q = aux(p).x - qThr;
      if (q > 0. && prev <= 0.) {
        float ta = t - h, tc = t;
        for (int k = 0; k < 5; k++) { float tm = 0.5 * (ta + tc); if (aux(ro + rd * tm).x - qThr > 0.) tc = tm; else ta = tm; }
        p = ro + rd * tc; vec2 e = vec2(0.8, 0.);
        vec3 n = -normalize(vec3(aux(p + e.xyy).x - aux(p - e.xyy).x, aux(p + e.yxy).x - aux(p - e.yxy).x, aux(p + e.yyx).x - aux(p - e.yyx).x) + 1e-9);
        vec4 A = aux(p);
        vec3 base = colorIso == 1 ? divMap(clamp(A.y / wRef, -1., 1.)) : ramp(length(vel(p).xyz) / uRef - 0.3);
        if (colorIso == 1) base = mix(vec3(0.8), base, 0.9);
        float dif = abs(dot(n, lightDir)), amb = 0.3;
        hitCol = base * (amb + 0.7 * dif) + 0.15 * pow(max(dot(n, normalize(lightDir - rd)), 0.), 30.);
        tHit = tc; hit = true; break;
      }
      prev = q;
    }
  }
  // cut plane
  if (mode == 2) {
    float rdc = sliceAxis == 1 ? rd.y : rd.z, roc = sliceAxis == 1 ? ro.y : ro.z;
    float t = (slicePos - roc) / rdc;
    vec3 p = ro + rd * t;
    if (t > 0. && t < tHit && all(greaterThan(p, lo)) && all(lessThan(p, hi)) && (hasBody == 0 || body(p) > 0.)) {
      vec4 v = vel(p); vec4 A = aux(p); vec3 c;
      if (sliceField == 0) c = seqMap(length(v.xyz) / (uRef * 1.6));
      else if (sliceField == 1) c = divMap(v.w / (0.5 * uRef * uRef) * 0.8);
      else { float w = sliceAxis == 1 ? A.z : A.w; c = divMap(-w / wRef); }
      tHit = t; hitCol = c; hit = true;
    }
  }
  if (hit) col = hitCol;
  // domain edges
  if (tb.x < tb.y && floorOn == 0) {
    vec3 p = ro + rd * tb.y; vec3 q = min(p - lo, hi - p); q = q / max(1., length(p - ro) * 0.004);
    float e = 0.; if (q.x < 1.) e += 1.; if (q.y < 1.) e += 1.; if (q.z < 1.) e += 1.;
    if (e >= 2. && tb.y < tHit) col += vec3(0.07, 0.08, 0.1);
  }
  o = vec4(col, 1.);
  gl_FragDepth = hit ? depthOf(ro + rd * tHit) : 1.;
}`;

class Viz {
  constructor(gl, lbm) {
    this.gl = gl; this.lbm = lbm;
    gl.getExtension('OES_texture_float_linear');
    this.progField = glCompile(gl, VS_QUAD, VIZ_FIELD_FS, 'field');
    this.progRay = glCompile(gl, VS_QUAD, VIZ_RAY_FS, 'ray');
    this.progDraw = glCompile(gl, VIZ_DRAW_VS, VIZ_DRAW_FS, 'pdraw');
    this.progPart = glCompile(gl, VS_QUAD, VIZ_PART_FS, 'particles');
    this.emptyVao = gl.createVertexArray();
    this.allocFields();
    this.nPart = 0;
  }

  tex3D(w, h, d, fmt, filter) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, t);
    gl.texStorage3D(gl.TEXTURE_3D, 1, fmt, w, h, d);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, filter);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
    return t;
  }

  allocFields() {
    const gl = this.gl, { nx, ny, nz } = this.lbm.o;
    this.N = [nx, ny, nz];
    this.vel = this.tex3D(nx, ny, nz, gl.RGBA16F, gl.LINEAR);
    this.aux = this.tex3D(nx, ny, nz, gl.RGBA16F, gl.LINEAR);
    this.fieldFbo = gl.createFramebuffer();
  }

  // macro atlas (written by the last measure step) -> 3D textures
  updateFields() {
    const gl = this.gl, P = this.progField, L = this.lbm, [nx, ny, nz] = this.N;
    gl.useProgram(P.p); L.common(P);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, L.macro); gl.uniform1i(P.u.M, 0);
    gl.uniform1f(P.u.pScale, 1);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fieldFbo); gl.viewport(0, 0, nx, ny);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(L.quad);
    for (let z = 0; z < nz; z++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.vel, 0, z);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, this.aux, 0, z);
      gl.uniform1i(P.u.Z, z); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  // bake the body distance field over its bounding box at `res` samples per lattice cell
  bakeBody(scene, res = 2) {
    const gl = this.gl;
    if (!scene.bbox) { this.hasBody = false; return; }
    const lo = scene.bbox[0].map((v, i) => Math.max(v, -0.5)), hi = scene.bbox[1].map((v, i) => Math.min(v, this.N[i] - 0.5));
    let R = hi.map((v, i) => Math.max(4, Math.ceil((v - lo[i]) * res)));
    const tot = R[0] * R[1] * R[2], cap = 24e6;
    if (tot > cap) { const k = Math.cbrt(cap / tot); R = R.map(r => Math.max(4, Math.floor(r * k))); }
    const src = `${GLSL_SDF_LIB}\n${scene.lib || ''}\nfloat sdf(vec3 p) {\n${scene.sdf}\n}`;
    const P = glCompile(gl, VS_QUAD, VIZ_BAKE_FS.replace('//SDF', src), 'bake');
    if (this.bodyTex) gl.deleteTexture(this.bodyTex);
    this.bodyTex = this.tex3D(R[0], R[1], R[2], gl.R16F, gl.LINEAR);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.useProgram(P.p); gl.uniform3fv(P.u.lo, lo); gl.uniform3fv(P.u.hi, hi); gl.uniform3i(P.u.R, ...R); gl.uniform4fv(P.u.SP, this.lbm.o.SP || [0, 0, 0, 0]);
    gl.viewport(0, 0, R[0], R[1]); gl.drawBuffers([gl.COLOR_ATTACHMENT0]); gl.disable(gl.BLEND);
    gl.bindVertexArray(this.lbm.quad);
    for (let z = 0; z < R[2]; z++) { gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.bodyTex, 0, z); gl.uniform1i(P.u.Z, z); gl.drawArrays(gl.TRIANGLES, 0, 3); }
    gl.deleteFramebuffer(fbo);
    this.bLo = lo; this.bHi = hi; this.hasBody = true;
  }

  dispose() {
    const gl = this.gl;
    for (const t of [this.vel, this.aux, this.bodyTex]) if (t) gl.deleteTexture(t);
    if (this.ptex) { for (const t of this.ptex) gl.deleteTexture(t); for (const f of this.pfbo) gl.deleteFramebuffer(f); }
    gl.deleteFramebuffer(this.fieldFbo); gl.deleteVertexArray(this.emptyVao);
  }

  // smoke: n particles fed from a rake of nozzles (y x z grid at x = rLo.x); state (position, age) in a float texture
  initParticles(n, life) {
    const gl = this.gl;
    if (this.ptex) { for (const t of this.ptex) gl.deleteTexture(t); for (const f of this.pfbo) gl.deleteFramebuffer(f); }
    const PW = 1024, PH = Math.ceil(n / PW), init = new Float32Array(4 * PW * PH);
    for (let i = 0; i < PW * PH; i++) { init[4 * i] = -10; init[4 * i + 3] = -Math.random() * (life || 5000); } // staggered first emission
    this.ptex = [0, 1].map(() => {
      const t = this.lbm.tex(PW, PH); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PW, PH, gl.RGBA, gl.FLOAT, init); return t;
    });
    this.pfbo = this.ptex.map(t => this.lbm.mkFbo([t]));
    this.PW = PW; this.PH = PH; this.nPart = PW * PH; this.pcur = 0; this.seed = 0;
  }

  advect(dt, rake) {
    const gl = this.gl, P = this.progPart, src = this.pcur, dst = 1 - src;
    gl.useProgram(P.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, this.vel); gl.uniform1i(P.u.VEL, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, this.bodyTex || this.vel); gl.uniform1i(P.u.BODY, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.ptex[src]); gl.uniform1i(P.u.PS, 2); gl.uniform1i(P.u.PW, this.PW);
    gl.uniform3fv(P.u.N, this.N); gl.uniform3fv(P.u.bLo, this.bLo || [0, 0, 0]); gl.uniform3fv(P.u.bHi, this.bHi || [1, 1, 1]);
    gl.uniform1f(P.u.dt, dt); gl.uniform1f(P.u.life, rake.life); gl.uniform1f(P.u.seed, (this.seed = (this.seed + 0.37) % 97));
    gl.uniform3fv(P.u.rLo, rake.lo); gl.uniform3fv(P.u.rHi, rake.hi); gl.uniform2i(P.u.noz, rake.ny, rake.nz);
    gl.uniform1f(P.u.jitter, rake.jitter ?? 0.3); gl.uniform1i(P.u.pulse, rake.pulse ? 1 : 0);
    gl.uniform1f(P.u.T, rake.T || 0); gl.uniform1f(P.u.pulseP, rake.pulseP || 1); gl.uniform1f(P.u.pulseL, rake.pulseL || 1);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    this.lbm.draw(this.pfbo[dst], this.PW, this.PH);
    this.pcur = dst;
  }

  // view: { VP, invVP, eye, width, height }, opt: render options
  render(view, opt) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, view.width, view.height);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.ALWAYS); gl.depthMask(true); gl.disable(gl.BLEND);
    const R = this.progRay; gl.useProgram(R.p);
    gl.uniformMatrix4fv(R.u.invVP, false, view.invVP); gl.uniformMatrix4fv(R.u.VP, false, view.VP);
    gl.uniform3fv(R.u.eye, view.eye); gl.uniform3fv(R.u.N, this.N);
    gl.uniform3fv(R.u.bLo, this.bLo || [0, 0, 0]); gl.uniform3fv(R.u.bHi, this.bHi || [1, 1, 1]);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, this.vel); gl.uniform1i(R.u.VEL, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_3D, this.aux); gl.uniform1i(R.u.AUX, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_3D, this.bodyTex || this.vel); gl.uniform1i(R.u.BODY, 2);
    gl.uniform1i(R.u.hasBody, this.hasBody ? 1 : 0);
    gl.uniform1i(R.u.mode, opt.mode); gl.uniform1i(R.u.sliceAxis, opt.sliceAxis ?? 1); gl.uniform1f(R.u.slicePos, opt.slicePos ?? this.N[1] / 2);
    gl.uniform1i(R.u.sliceField, opt.sliceField ?? 0); gl.uniform1f(R.u.qThr, opt.qThr); gl.uniform1f(R.u.uRef, opt.uRef);
    gl.uniform1f(R.u.wRef, opt.wRef ?? 0.01); gl.uniform1i(R.u.colorIso, opt.colorIso ?? 0);
    gl.uniform1i(R.u.floorOn, opt.floor ?? 0); gl.uniform1f(R.u.cpOn, opt.cp ? 1 : 0); gl.uniform1f(R.u.clipY, opt.clipY ?? -1e9);
    const l = [0.45, -0.35, 0.82], ll = Math.hypot(...l); gl.uniform3fv(R.u.lightDir, l.map(v => v / ll));
    gl.bindVertexArray(this.lbm.quad); gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (opt.smoke && this.nPart) {
      const D = this.progDraw; gl.useProgram(D.p);
      gl.depthFunc(gl.LESS); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      gl.uniformMatrix4fv(D.u.VP, false, view.VP); gl.uniform3fv(D.u.N, this.N);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_3D, this.vel); gl.uniform1i(D.u.VEL, 0);
      gl.uniform1f(D.u.uRef, opt.uRef); gl.uniform1f(D.u.psize, opt.psize ?? 1.5); gl.uniform1f(D.u.alpha, opt.alpha ?? 0.08);
      gl.uniform1f(D.u.life, opt.rake.life); gl.uniform1i(D.u.colorBy, opt.colorBy ?? 0); gl.uniform2i(D.u.noz, opt.rake.ny, opt.rake.nz);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.ptex[this.pcur]); gl.uniform1i(D.u.PS, 1); gl.uniform1i(D.u.PW, this.PW);
      gl.bindVertexArray(this.emptyVao); gl.drawArrays(gl.POINTS, 0, this.nPart);
      gl.depthMask(true); gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }
}

// camera helpers (column-major 4x4)
const M4 = {
  persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; },
  look(e, c, up) {
    const sub = (a, b) => a.map((v, i) => v - b[i]), nrm = a => { const l = Math.hypot(...a); return a.map(v => v / l); };
    const cr = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const z = nrm(sub(e, c)), x = nrm(cr(up, z)), y = cr(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  },
  mul(a, b) { const r = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) r[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return r; },
  inv(m) {
    const a = m, r = new Array(16);
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
    const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6], b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
    const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    const d = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    r[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * d; r[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * d;
    r[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * d; r[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * d;
    r[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * d; r[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * d;
    r[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * d; r[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * d;
    r[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * d; r[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * d;
    r[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * d; r[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * d;
    r[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * d; r[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * d;
    r[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * d; r[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * d;
    return r;
  },
  // orbit camera around target: yaw/pitch (rad), dist (lattice units)
  orbit(target, yaw, pitch, dist, asp, fov = 0.6) {
    const e = [target[0] + dist * Math.cos(pitch) * Math.cos(yaw), target[1] + dist * Math.cos(pitch) * Math.sin(yaw), target[2] + dist * Math.sin(pitch)];
    const V = M4.look(e, target, [0, 0, 1]), P = M4.persp(fov, asp, dist * 0.02, dist * 6), VP = M4.mul(P, V);
    return { VP: new Float32Array(VP), invVP: new Float32Array(M4.inv(VP)), eye: e };
  },
};

if (typeof module !== 'undefined') module.exports = { Viz, M4 };

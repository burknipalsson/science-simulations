// Rendering for the blood sims (shares the simulation's WebGL2 context).
//  - cells: one instanced draw of the membrane meshes straight from the GPU vertex textures, with periodic copies
//    along x so a short periodic box reads as a long vessel
//  - vessel wall: ray-marched from the scene's own signed distance; only the far wall is drawn (a cutaway)
//  - plasma tracers: particles advected by the lattice velocity (state in a float texture), faint additive dots
// World coordinates are lattice units; the camera orbits a target point.

const VZ_HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
`;

function vzCellVS() {
  return VZ_HEAD + `
uniform sampler2D POS, ANC, NRM, CS0, CS1, CCOL; uniform int NV, NC; uniform mat4 VP; uniform vec3 NB; uniform ivec3 PER; uniform float X0;
out vec3 vN; out vec3 vW; flat out vec4 vCol;
void main() {
  int c = gl_InstanceID % NC, copy = gl_InstanceID / NC, v = gl_VertexID;
  vec3 an = texelFetch(ANC, ivec2(c, 0), 0).xyz, cen = an + texelFetch(CS0, ivec2(0, c), 0).xyz / texelFetch(CS1, ivec2(0, c), 0).x;
  vec3 x = an + texelFetch(POS, ivec2(v, c), 0).xyz;
  // periodic display: put the cell centre into [X0, X0 + N) along x, then add the copy offset
  vec3 sh = vec3(0.);
  if (PER.x == 1) sh.x = -NB.x * floor((cen.x - X0) / NB.x) + NB.x * float(copy - 1);
  if (PER.y == 1) sh.y = -NB.y * floor(cen.y / NB.y);
  if (PER.z == 1) sh.z = -NB.z * floor(cen.z / NB.z);
  x += sh;
  vN = texelFetch(NRM, ivec2(v, c), 0).xyz; vW = x; vCol = texelFetch(CCOL, ivec2(c, 0), 0);
  gl_Position = VP * vec4(x, 1.);
}`;
}
const VZ_CELL_FS = VZ_HEAD + `
in vec3 vN; in vec3 vW; flat in vec4 vCol; uniform vec3 EYE, LDIR; uniform float FOG;
out vec4 o;
void main() {
  vec3 n = normalize(vN), v = normalize(EYE - vW);
  if (dot(n, v) < 0.) n = -n; // the mesh is closed; back faces only show through cutaways
  float ndl = dot(n, LDIR), wrap = clamp((ndl + 0.45) / 1.45, 0., 1.);
  vec3 base = vCol.rgb;
  // a cell is a bag of haemoglobin: soft wrap lighting with warm subsurface glow, a waxy rim, a gentle highlight
  vec3 sss = base * vec3(1.25, 0.55, 0.45) * pow(1. - abs(ndl), 3.) * 0.35;
  float rim = pow(1. - max(dot(n, v), 0.), 3.);
  vec3 h = normalize(LDIR + v); float spec = pow(max(dot(n, h), 0.), 48.) * 0.35;
  vec3 col = base * (0.22 + 1.25 * wrap * wrap) + sss + rim * base * 0.7 + vec3(1., 0.9, 0.85) * spec;
  if (vCol.a > 1.5) { // white cells: pale and granular-looking
    col = mix(col, vec3(0.86, 0.84, 0.92) * (0.3 + 0.8 * wrap), 0.75) + spec;
  }
  float d = length(EYE - vW);
  col = mix(col, vec3(0.07, 0.045, 0.03), 1. - exp(-d * FOG));
  o = vec4(col, 1.);
}`;

// vessel wall by ray marching the scene SDF (phi > 0 is plasma); draw the first fluid -> wall crossing after the ray
// has entered the plasma, so the near wall is cut away
function vzWallFS(sdfBody) {
  return VZ_HEAD + `
uniform mat4 IVP, VP; uniform vec3 EYE, LDIR, BMIN, BMAX; uniform vec4 SP; uniform vec2 RES; uniform float FOG, TIME, LS;
out vec4 o;
float sdf(vec3 p) { ${sdfBody} }
vec3 hash3(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }
// cobbled endothelium: distance to the nearest cell centre in a jittered grid (elongated along the flow, x)
vec2 cells(vec3 p) {
  p *= vec3(0.09, 0.22, 0.22) * LS; vec3 b = floor(p); float d1 = 9., d2 = 9.;
  for (int k = 0; k < 27; k++) { vec3 g = b + vec3(k % 3, (k / 3) % 3, k / 9) - 1.; vec3 q = g + hash3(g); float d = length(p - q);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
  return vec2(d1, d2 - d1);
}
void main() {
  vec2 ndc = gl_FragCoord.xy / RES * 2. - 1.;
  vec4 a = IVP * vec4(ndc, -1., 1.), b = IVP * vec4(ndc, 1., 1.);
  vec3 ro = a.xyz / a.w, rd = normalize(b.xyz / b.w - ro);
  // clip to the display box
  vec3 t0 = (BMIN - ro) / rd, t1 = (BMAX - ro) / rd, tmn = min(t0, t1), tmx = max(t0, t1);
  float tn = max(max(tmn.x, tmn.y), max(tmn.z, 0.)), tf = min(min(tmx.x, tmx.y), tmx.z);
  vec3 bg = vec3(0.05, 0.03, 0.022) + vec3(0.07, 0.04, 0.02) * (1. - abs(ndc.y)) * (1. - 0.4 * abs(ndc.x));
  if (tf <= tn) { o = vec4(bg, 1.); gl_FragDepth = 1.; return; }
  float t = tn; bool inside = false; float hit = -1.;
  for (int i = 0; i < 160; i++) {
    float d = sdf(ro + rd * t);
    if (!inside) { if (d > 0.) inside = true; t += max(abs(d), 0.05 / LS); }
    else { if (d < 0.02 / LS) { hit = t; break; } t += max(d, 0.05 / LS); }
    if (t > tf) break;
  }
  if (hit < 0.) { o = vec4(bg, 1.); gl_FragDepth = 1.; return; }
  vec3 p = ro + rd * hit, e = vec3(0.05, 0., 0.);
  vec3 n = normalize(vec3(sdf(p + e.xyy) - sdf(p - e.xyy), sdf(p + e.yxy) - sdf(p - e.yxy), sdf(p + e.yyx) - sdf(p - e.yyx))); // into the plasma
  vec2 c = cells(p);
  float nuc = smoothstep(0.32, 0.18, c.x), border = smoothstep(0.06, 0.0, c.y);
  vec3 base = vec3(0.78, 0.50, 0.42) * (0.85 + 0.15 * hash3(floor(p * vec3(0.09, 0.22, 0.22) * LS)).x);
  base = mix(base, vec3(0.42, 0.22, 0.26), nuc * 0.6);
  base *= 1. - 0.35 * border;
  float wrap = clamp((dot(n, LDIR) + 0.5) / 1.5, 0., 1.);
  vec3 col = base * (0.25 + 0.8 * wrap);
  float dist = length(p - EYE);
  col = mix(col, bg, 1. - exp(-dist * FOG));
  o = vec4(col, 1.);
  vec4 clip = VP * vec4(p, 1.); gl_FragDepth = clip.z / clip.w * 0.5 + 0.5;
}`;
}

// tracers: state texture (x, y, z, age); advected with the interpolated plasma velocity times the steps since the last frame
function vzTracerUpdateFS() {
  return VZ_HEAD + `
uniform sampler2D ST, MAC, P4; uniform ivec3 N; uniform int TX; uniform float DT, SEED;
out vec4 o;
ivec2 A(ivec3 p) { return ivec2(p.x + (p.z % TX) * N.x, p.y + (p.z / TX) * N.y); }
ivec3 wrap(ivec3 p) { return ((p % N) + N) % N; }
vec3 vel(vec3 x) { // trilinear
  vec3 f = x - 0.5, b = floor(f), w = f - b; vec3 u = vec3(0.);
  for (int k = 0; k < 8; k++) { ivec3 o3 = ivec3(k & 1, (k >> 1) & 1, k >> 2); vec3 ww = mix(1. - w, w, vec3(o3));
    u += ww.x * ww.y * ww.z * texelFetch(MAC, A(wrap(ivec3(b) + o3)), 0).xyz; }
  return u;
}
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy); vec4 s = texelFetch(ST, fc, 0);
  vec3 x = s.xyz; float age = s.w;
  vec3 NB = vec3(N);
  bool respawn = age <= 0.;
  if (!respawn) {
    vec3 u = vel(x); x += u * DT; x -= NB * floor(x / NB); age -= 1.;
    if (texelFetch(P4, A(wrap(ivec3(floor(x)))), 0).w <= 0.) respawn = true;
  }
  if (respawn) {
    vec2 r = vec2(fc) + SEED;
    for (int k = 0; k < 8; k++) {
      x = vec3(h(r + 0.1 * float(k)), h(r.yx + 1.7 + 0.1 * float(k)), h(r + 3.3 + 0.1 * float(k))) * NB;
      if (texelFetch(P4, A(wrap(ivec3(floor(x)))), 0).w > 0.5) break;
    }
    age = 200. + 400. * h(r + 9.1);
  }
  o = vec4(x, age);
}`;
}
const VZ_TRACER_VS = VZ_HEAD + `
uniform sampler2D ST; uniform int TW; uniform mat4 VP; uniform vec3 NB, EYE; uniform float X0, PSIZE; uniform int COPIES;
out float vA;
void main() {
  int id = gl_VertexID % (TW * TW), copy = gl_VertexID / (TW * TW);
  vec4 s = texelFetch(ST, ivec2(id % TW, id / TW), 0);
  vec3 x = s.xyz; x.x += -NB.x * floor((x.x - X0) / NB.x) + NB.x * float(copy - 1);
  gl_Position = VP * vec4(x, 1.);
  float d = length(EYE - x);
  gl_PointSize = PSIZE * 60. / d;
  vA = smoothstep(0., 40., s.w) * smoothstep(0., 30., 600. - s.w);
}`;
const VZ_TRACER_FS = VZ_HEAD + `in float vA; out vec4 o; uniform float ALPHA;
void main() { vec2 q = gl_PointCoord * 2. - 1.; float r = dot(q, q); if (r > 1.) discard; o = vec4(vec3(1., 0.88, 0.62) * ALPHA * vA * (1. - r), 0.); }`;

const VZ_QUAD_VS = VZ_HEAD + `in vec2 pos; void main() { gl_Position = vec4(pos, 0., 1.); }`;

// --- small matrix helpers (column-major) ---
const M4 = {
  persp(fovy, asp, n, f) { const t = 1 / Math.tan(fovy / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; },
  look(e, c, up) {
    const z = norm3(sub3(e, c)), x = norm3(cross3(up, z)), y = cross3(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot3(x, e), -dot3(y, e), -dot3(z, e), 1];
  },
  mul(a, b) { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; },
  inv(m) {
    const a = m, o = new Array(16);
    const b00 = a[0] * a[5] - a[1] * a[4], b01 = a[0] * a[6] - a[2] * a[4], b02 = a[0] * a[7] - a[3] * a[4], b03 = a[1] * a[6] - a[2] * a[5];
    const b04 = a[1] * a[7] - a[3] * a[5], b05 = a[2] * a[7] - a[3] * a[6], b06 = a[8] * a[13] - a[9] * a[12], b07 = a[8] * a[14] - a[10] * a[12];
    const b08 = a[8] * a[15] - a[11] * a[12], b09 = a[9] * a[14] - a[10] * a[13], b10 = a[9] * a[15] - a[11] * a[13], b11 = a[10] * a[15] - a[11] * a[14];
    const det = 1 / (b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06);
    o[0] = (a[5] * b11 - a[6] * b10 + a[7] * b09) * det; o[1] = (a[2] * b10 - a[1] * b11 - a[3] * b09) * det;
    o[2] = (a[13] * b05 - a[14] * b04 + a[15] * b03) * det; o[3] = (a[10] * b04 - a[9] * b05 - a[11] * b03) * det;
    o[4] = (a[6] * b08 - a[4] * b11 - a[7] * b07) * det; o[5] = (a[0] * b11 - a[2] * b08 + a[3] * b07) * det;
    o[6] = (a[14] * b02 - a[12] * b05 - a[15] * b01) * det; o[7] = (a[8] * b05 - a[10] * b02 + a[11] * b01) * det;
    o[8] = (a[4] * b10 - a[5] * b08 + a[7] * b06) * det; o[9] = (a[1] * b08 - a[0] * b10 - a[3] * b06) * det;
    o[10] = (a[12] * b04 - a[13] * b02 + a[15] * b00) * det; o[11] = (a[9] * b02 - a[8] * b04 - a[11] * b00) * det;
    o[12] = (a[5] * b07 - a[4] * b09 - a[6] * b06) * det; o[13] = (a[0] * b09 - a[1] * b07 + a[2] * b06) * det;
    o[14] = (a[13] * b01 - a[12] * b03 - a[14] * b00) * det; o[15] = (a[8] * b03 - a[9] * b01 + a[10] * b00) * det;
    return o;
  },
};
function sub3(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm3(a) { const l = Math.hypot(...a); return a.map(x => x / l); }

function vzCompile(gl, vs, fs, name) {
  const mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); console.error(name, log); throw new Error(name + ': ' + log); } return s; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'pos'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

class BloodView {
  // sim: BloodGPU; o: { faces (array of [a,b,c]), periodic [1,0,0], copies (1 or 3), tracers (count, 0 = none), fog,
  //   ls: lattice units per 0.5 µm (2 on the 0.25 µm grid: fog, wall texture and tracer size keep their look) }
  constructor(gl, sim, o) {
    this.gl = gl; this.sim = sim;
    this.o = Object.assign({ periodic: [1, 0, 0], copies: 3, tracers: 4096, fog: 0.004, psize: 1.2, palpha: 0.22, ls: 1 }, o);
    this.o.fog /= this.o.ls; this.o.psize *= this.o.ls;
    this.cam = { yaw: -0.5, pitch: 0.28, dist: 120, target: [sim.o.nx / 2, sim.o.ny / 2, sim.o.nz / 2], fov: 0.75 };
    const F = this.o.faces, idx = new Uint16Array(F.length * 3); F.forEach((t, i) => idx.set(t, 3 * i));
    this.nIdx = idx.length;
    this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.pCell = vzCompile(gl, vzCellVS(), VZ_CELL_FS, 'cells');
    this.ccol = sim.tex(sim.NC || 1, 1);
    this.setScene();
    // tracers
    const tw = Math.ceil(Math.sqrt(this.o.tracers)); this.TW = tw;
    if (this.o.tracers) {
      this.trS = [sim.tex(tw, tw), sim.tex(tw, tw)]; this.trF = this.trS.map(t => sim.mkFbo([t])); this.trCur = 0;
      this.pTrU = vzCompile(gl, VZ_QUAD_VS, vzTracerUpdateFS(), 'tracer-update');
      this.pTrD = vzCompile(gl, VZ_TRACER_VS, VZ_TRACER_FS, 'tracer-draw');
    }
    this.lastT = sim.t;
  }
  // advect the tracers by the steps taken since the last update (render does this unless the view is frozen for a replay)
  updateTracers() {
    const gl = this.gl, sim = this.sim, P = this.pTrU, dt = sim.t - this.lastT; this.lastT = sim.t;
    gl.useProgram(P.p); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    this.bindT(P, 'ST', this.trS[this.trCur], 0); this.bindT(P, 'MAC', sim.mac[sim.cur], 1); this.bindT(P, 'P4', sim.pop[sim.cur][4], 2);
    gl.uniform3i(P.u.N, sim.o.nx, sim.o.ny, sim.o.nz); gl.uniform1i(P.u.TX, sim.TX); gl.uniform1f(P.u.DT, dt); gl.uniform1f(P.u.SEED, (sim.t * 0.618) % 97);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.trF[1 - this.trCur]); gl.viewport(0, 0, this.TW, this.TW);
    gl.bindVertexArray(sim.quad); gl.drawArrays(gl.TRIANGLES, 0, 3); this.trCur = 1 - this.trCur;
  }
  readTracers() { return this.sim.readTex(this.trS[this.trCur], this.TW, this.TW); }
  writeTracers(d) { const gl = this.gl; gl.bindTexture(gl.TEXTURE_2D, this.trS[this.trCur]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.TW, this.TW, gl.RGBA, gl.FLOAT, d); }
  dispose() { const gl = this.gl; gl.deleteTexture(this.ccol); if (this.trS) { this.trS.forEach(t => gl.deleteTexture(t)); this.trF.forEach(f => gl.deleteFramebuffer(f)); } }
  setScene() { this.pWall = vzCompile(this.gl, VZ_QUAD_VS, vzWallFS(this.sim.o.sdf), 'wall'); }
  // per-cell colours: [[r,g,b,kind]] (kind 2 = white cell)
  setColours(cols) {
    const gl = this.gl, d = new Float32Array(cols.length * 4); cols.forEach((c, i) => d.set(c, 4 * i));
    gl.bindTexture(gl.TEXTURE_2D, this.ccol); if (cols.length) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, cols.length, 1, gl.RGBA, gl.FLOAT, d);
  }
  matrices(w, h) {
    const c = Object.assign({}, this.cam, { dist: this.cam.dist * Math.max(1, 0.75 * h / w) }), cp = Math.cos(c.pitch); // back off on portrait screens
    const eye = [c.target[0] + c.dist * cp * Math.sin(c.yaw), c.target[1] + c.dist * Math.sin(c.pitch), c.target[2] + c.dist * cp * Math.cos(c.yaw)];
    const V = M4.look(eye, c.target, [0, 1, 0]), P = M4.persp(c.fov, w / h, 0.5, 4000);
    const VP = M4.mul(P, V);
    return { eye, VP, IVP: M4.inv(VP) };
  }
  bindT(P, name, t, unit) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(P.u[name], unit); }
  render(w, h) {
    const gl = this.gl, sim = this.sim, o = this.o, { eye, VP, IVP } = this.matrices(w, h), NB = [sim.o.nx, sim.o.ny, sim.o.nz];
    const L = norm3([0.45, 0.8, 0.55]), X0 = 0, copies = o.periodic[0] ? o.copies : 1;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.disable(gl.BLEND); gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // wall (writes depth)
    let P = this.pWall; gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.IVP, false, IVP); gl.uniformMatrix4fv(P.u.VP, false, VP); gl.uniform3fv(P.u.EYE, eye); gl.uniform3fv(P.u.LDIR, L); gl.uniform2f(P.u.RES, w, h);
    gl.uniform1f(P.u.FOG, o.fog); gl.uniform1f(P.u.LS, 1 / o.ls); gl.uniform4fv(P.u.SP, sim.o.SP || [0, 0, 0, 0]);
    const xr = copies > 1 ? [-NB[0], 2 * NB[0]] : [0, NB[0]];
    gl.uniform3f(P.u.BMIN, xr[0], -0.5, -0.5); gl.uniform3f(P.u.BMAX, xr[1], NB[1] - 0.5, NB[2] - 0.5);
    gl.bindVertexArray(sim.quad); gl.drawArrays(gl.TRIANGLES, 0, 3);
    // cells
    if (sim.nCells) {
      P = this.pCell; gl.useProgram(P.p);
      this.bindT(P, 'POS', sim.pos[sim.mcur], 0); this.bindT(P, 'ANC', sim.anc[sim.mcur], 1); this.bindT(P, 'NRM', sim.nrm, 2);
      this.bindT(P, 'CS0', sim.cs0, 3); this.bindT(P, 'CS1', sim.cs1, 4); this.bindT(P, 'CCOL', this.ccol, 5);
      gl.uniform1i(P.u.NV, sim.tb.nv); gl.uniform1i(P.u.NC, sim.nCells); gl.uniformMatrix4fv(P.u.VP, false, VP);
      gl.uniform3fv(P.u.NB, NB); gl.uniform3iv(P.u.PER, o.periodic); gl.uniform1f(P.u.X0, X0);
      gl.uniform3fv(P.u.EYE, eye); gl.uniform3fv(P.u.LDIR, L); gl.uniform1f(P.u.FOG, o.fog);
      gl.bindVertexArray(this.vao); gl.drawElementsInstanced(gl.TRIANGLES, this.nIdx, gl.UNSIGNED_SHORT, 0, sim.nCells * copies);
    }
    // tracers
    if (o.tracers) {
      if (!this.frozen) this.updateTracers();
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
      gl.enable(gl.DEPTH_TEST); gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
      P = this.pTrD; gl.useProgram(P.p); this.bindT(P, 'ST', this.trS[this.trCur], 0);
      gl.uniform1i(P.u.TW, this.TW); gl.uniformMatrix4fv(P.u.VP, false, VP); gl.uniform3fv(P.u.NB, NB); gl.uniform3fv(P.u.EYE, eye);
      gl.uniform1f(P.u.X0, X0); gl.uniform1f(P.u.PSIZE, o.psize * (window.devicePixelRatio || 1)); gl.uniform1f(P.u.ALPHA, o.palpha);
      gl.bindVertexArray(sim.emptyVao); gl.drawArrays(gl.POINTS, 0, this.TW * this.TW * copies);
      gl.disable(gl.BLEND); gl.depthMask(true);
    }
  }
}

if (typeof module !== 'undefined') module.exports = { BloodView, M4 };

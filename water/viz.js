// Rendering of the GPU water state: ray-cast sphere impostors (atoms), dashed hydrogen-bond
// ribbons, ice-lattice bonds (mW), box outline.  Reads the engine's state textures directly.
'use strict';

const VIZ = (() => {
const { BODY } = GW;
const v3 = a => `vec3(${a.map(x => x.toFixed(9)).join(',')})`;

const COMMON = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform int uW, uN; uniform vec3 uBox; uniform mat4 uView, uProj;
uniform vec3 uSlabN; uniform float uSlabHalf, uSlabOn;
ivec2 tc(int i) { return ivec2(i % uW, i / uW); }
mat3 qmat(vec4 q) {
  return mat3(q.x*q.x+q.y*q.y-q.z*q.z-q.w*q.w, 2.*(q.y*q.z+q.x*q.w), 2.*(q.y*q.w-q.x*q.z),
              2.*(q.y*q.z-q.x*q.w), q.x*q.x-q.y*q.y+q.z*q.z-q.w*q.w, 2.*(q.z*q.w+q.x*q.y),
              2.*(q.y*q.w+q.x*q.z), 2.*(q.z*q.w-q.x*q.y), q.x*q.x-q.y*q.y-q.z*q.z+q.w*q.w); }
vec3 wrapBox(vec3 p) { return p - floor(p / uBox) * uBox; }
// slab test (relative to box centre); returns visibility 0..1 (soft edge)
float slabVis(vec3 p) { if (uSlabOn < 0.5) return 1.; return abs(dot(p - 0.5 * uBox, uSlabN)) < uSlabHalf ? 1. : 0.; }
`;

// ---- atom impostors ----
const VS_ATOM = COMMON + `
uniform sampler2D uPos, uQuat, uType, uVel; uniform int uModel, uColorMode; uniform float uRadO, uRadH, uRadMW, uRadLiq;
uniform vec3 uColO, uColH, uColLiq, uColHex, uColCub, uColInt, uColSol, uColIce, uColPin;
uniform float uTag;   // highlight molecules with id < uTag (initial ice)
in vec2 aCorner;
out vec3 vC; out float vR; out vec3 vP; out vec3 vCol; out float vAlpha;
const vec3 bO = ${v3(BODY.O)}, bH1 = ${v3(BODY.H1)}, bH2 = ${v3(BODY.H2)};
void main() {
  int mol, atom;
  if (uModel == 0) { mol = gl_InstanceID / 3; atom = gl_InstanceID % 3; } else { mol = gl_InstanceID; atom = 0; }
  vec4 P = texelFetch(uPos, tc(mol), 0);
  vec3 com = wrapBox(P.xyz), p = com; float r; vec3 col;
  float ty = texelFetch(uType, tc(mol), 0).x, flag = texelFetch(uVel, tc(mol), 0).w;
  vec3 ice = ty == 1. ? uColHex : ty == 2. ? uColCub : ty == 3. ? uColInt : ty == 4. ? uColInt : uColLiq;
  if (uModel == 0) {
    mat3 R = qmat(texelFetch(uQuat, tc(mol), 0));
    p = com + R * (atom == 0 ? bO : atom == 1 ? bH1 : bH2);
    r = atom == 0 ? uRadO : uRadH;
    col = atom == 0 ? uColO : uColH;
    if (uColorMode == 1 && atom == 0 && ty > 0.5) col = ty == 3. ? mix(uColO, uColIce, 0.55) : uColIce;
    if (uColorMode == 2 && atom == 0 && P.w < uTag) col = uColIce;
  } else {
    r = (ty == 1. || ty == 2.) ? uRadMW : ty == 3. ? mix(uRadLiq, uRadMW, 0.35) : uRadLiq; col = ice;
    if (flag > 1.5) { col = uColSol; r *= 1.05; }
    if (flag > 0.5 && flag < 1.5) col = uColPin;
  }
  float vis = slabVis(com);
  vAlpha = vis;
  if (P.w < 0. || vis < 0.02) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec4 c = uView * vec4(p, 1.);
  vC = c.xyz; vR = r; vCol = col;
  vec3 q = c.xyz + vec3(aCorner * r * 1.15, 0.);
  // push the billboard towards the camera so the sphere front is not clipped
  q += normalize(-c.xyz) * r;
  vP = q;
  gl_Position = uProj * vec4(q, 1.);
}`;
const FS_ATOM = `#version 300 es
precision highp float;
uniform mat4 uProj; uniform vec3 uLight, uBg; uniform float uFogNear, uFogFar;
in vec3 vC; in float vR; in vec3 vP; in vec3 vCol; in float vAlpha;
out vec4 o;
void main() {
  vec3 d = normalize(vP);           // ray from eye through this fragment
  float b = dot(d, vC), c = dot(vC, vC) - vR * vR, h = b * b - c;
  if (h < 0.) discard;
  float t = b - sqrt(h);
  vec3 x = d * t, n = normalize(x - vC);
  vec4 cp = uProj * vec4(x, 1.);
  gl_FragDepth = 0.5 + 0.5 * cp.z / cp.w;
  float diff = max(dot(n, uLight), 0.), rim = pow(1. - max(dot(n, -d), 0.), 3.);
  vec3 hv = normalize(uLight - d); float spec = pow(max(dot(n, hv), 0.), 40.);
  vec3 col = vCol * (0.28 + 0.78 * diff) + 0.35 * spec + 0.12 * rim * vec3(0.6, 0.75, 1.);
  float fog = smoothstep(uFogNear, uFogFar, -x.z);
  col = mix(col, uBg, fog * 0.85);
  // soft silhouette for alpha-to-coverage
  float edge = clamp(sqrt(h) / vR * 6., 0., 1.);
  o = vec4(col, edge * vAlpha);
}`;

// ---- ribbons (hydrogen bonds and lattice bonds) ----
const VS_RIB = COMMON + `
uniform sampler2D uPos, uQuat, uLink; uniform int uModel, uSlots; uniform float uWidth;
in vec2 aCorner;   // x: 0..1 along, y: -1..1 across
out float vS; out float vLen; out float vAlpha; out float vZ;
const vec3 bO = ${v3(BODY.O)}, bH1 = ${v3(BODY.H1)}, bH2 = ${v3(BODY.H2)};
void main() {
  int mol = gl_InstanceID / uSlots, slot = gl_InstanceID % uSlots;
  vec4 L = texelFetch(uLink, tc(mol), 0);
  float k = slot == 0 ? L.x : slot == 1 ? L.y : slot == 2 ? L.z : L.w;
  if (mol >= uN || k < 0. || (uModel == 1 && k < float(mol))) { gl_Position = vec4(2., 2., 2., 1.); return; }
  int j = int(k);
  vec3 ci = wrapBox(texelFetch(uPos, tc(mol), 0).xyz), cj = texelFetch(uPos, tc(j), 0).xyz;
  vec3 dd = cj - ci; dd -= uBox * round(dd / uBox);
  vec3 a, b;
  if (uModel == 0) {
    mat3 Ri = qmat(texelFetch(uQuat, tc(mol), 0)), Rj = qmat(texelFetch(uQuat, tc(j), 0));
    a = ci + Ri * (slot == 0 ? bH1 : bH2); b = ci + dd + Rj * bO;
    vec3 u = normalize(b - a); a += u * 0.2; b -= u * 0.3;    // from the H surface to the O surface
  } else { a = ci; b = ci + dd; }
  float vis = min(slabVis(ci), slabVis(ci + dd));
  vAlpha = vis; if (vis < 0.02) { gl_Position = vec4(2., 2., 2., 1.); return; }
  vec3 va = (uView * vec4(a, 1.)).xyz, vb = (uView * vec4(b, 1.)).xyz;
  vec3 m = mix(va, vb, aCorner.x), dir = normalize(vb - va);
  vec3 side = normalize(cross(dir, normalize(-m)));
  m += side * aCorner.y * uWidth;
  vS = aCorner.x; vLen = length(vb - va); vZ = -m.z;
  gl_Position = uProj * vec4(m, 1.);
}`;
const FS_RIB = `#version 300 es
precision highp float;
uniform vec3 uCol, uBg; uniform float uDash, uOpacity, uFogNear, uFogFar;
in float vS; in float vLen; in float vAlpha; in float vZ; out vec4 o;
void main() {
  float a = uOpacity * vAlpha;
  if (uDash > 0.) { float ph = fract(vS * vLen / uDash); a *= smoothstep(0.0, 0.1, ph) * (1. - smoothstep(0.5, 0.6, ph)); }
  if (a < 0.01) discard;
  vec3 col = mix(uCol, uBg, smoothstep(uFogNear, uFogFar, vZ) * 0.85);
  o = vec4(col * a, a);
}`;

// ---- lines (box) ----
const VS_LINE = `#version 300 es
uniform mat4 uView, uProj; in vec3 aP; void main() { gl_Position = uProj * uView * vec4(aP, 1.); }`;
const FS_LINE = `#version 300 es
precision highp float; uniform vec4 uCol; out vec4 o; void main() { o = uCol; }`;

// nearest-neighbour lattice links for mW (up to 4 within 3.2 Å), drawn as bonds between ice-like particles
const FS_NB = GW.HEAD + GW.CELLS + `
uniform sampler2D uPos, uType; out vec4 o;
void main() { int i = myIndex(); o = vec4(-1.); if (i >= uN) return;
  if (texelFetch(uType, tc(i), 0).x < 0.5) return;
  vec3 pi = texelFetch(uPos, tc(i), 0).xyz; ivec3 ci = cellOf(pi); int n = 0;
  for (int dz = -uR.z; dz <= uR.z; dz++) for (int dy = -uR.y; dy <= uR.y; dy++) for (int dx = -uR.x; dx <= uR.x; dx++) {
    vec2 se = cellRange((ci + ivec3(dx, dy, dz) + uNc) % uNc);
    for (int k = int(se.x); k < int(se.y); k++) { if (k == i || n >= 4) continue;
      vec3 d = texelFetch(uPos, tc(k), 0).xyz - pi; d -= uBox * round(d / uBox);
      if (dot(d, d) > 10.24 || texelFetch(uType, tc(k), 0).x < 0.5) continue;
      if (n == 0) o.x = float(k); else if (n == 1) o.y = float(k); else if (n == 2) o.z = float(k); else o.w = float(k);
      n++; } } }`;

function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }

class Viz {
  constructor(gl) {
    this.gl = gl;
    const mk = (vs, fs) => {
      const p = gl.createProgram();
      for (const [t, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) + '\n' + src);
        gl.attachShader(p, s);
      }
      gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      p.u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
      for (let k = 0; k < n; k++) { const i = gl.getActiveUniform(p, k); p.u[i.name] = { loc: gl.getUniformLocation(p, i.name), type: i.type }; }
      return p;
    };
    this.pAtom = mk(VS_ATOM, FS_ATOM); this.pRib = mk(VS_RIB, FS_RIB); this.pLine = mk(VS_LINE, FS_LINE);
    // quad VAOs
    const quad = (data, prog, attr) => {
      const vao = gl.createVertexArray(); gl.bindVertexArray(vao);
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      const loc = gl.getAttribLocation(prog, attr); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null); return vao;
    };
    this.vaoAtom = quad([-1, -1, 1, -1, -1, 1, 1, 1], this.pAtom, 'aCorner');
    this.vaoRib = quad([0, -1, 1, -1, 0, 1, 1, 1], this.pRib, 'aCorner');
    this.vaoLine = gl.createVertexArray(); this.lineBuf = gl.createBuffer();
    gl.bindVertexArray(this.vaoLine); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    const ll = gl.getAttribLocation(this.pLine, 'aP'); gl.enableVertexAttribArray(ll); gl.vertexAttribPointer(ll, 3, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.colors = {
      uColO: hex('#e8553f'), uColH: hex('#f2efe9'), uColLiq: hex('#3d5f8a'), uColHex: hex('#e6f6ff'), uColCub: hex('#b9a4ff'),
      uColInt: hex('#8fc3e6'), uColSol: hex('#ffb347'), uColIce: hex('#9fe3ff'), uColPin: hex('#7f8a99'),
    };
    this.bg = hex('#0b0d12');
    this.hbCol = hex('#ffb547');
  }

  _uni(p, all) {
    const gl = this.gl; let unit = 0;
    for (const [name, val] of Object.entries(all)) {
      const u = p.u[name]; if (!u) continue;
      if (val instanceof WebGLTexture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, val); gl.uniform1i(u.loc, unit++); }
      else if (u.type === gl.FLOAT_MAT4) gl.uniformMatrix4fv(u.loc, false, val);
      else if (u.type === gl.INT || u.type === gl.SAMPLER_2D) gl.uniform1i(u.loc, val);
      else if (u.type === gl.FLOAT) gl.uniform1f(u.loc, val);
      else if (u.type === gl.FLOAT_VEC3) gl.uniform3fv(u.loc, val);
      else if (u.type === gl.FLOAT_VEC4) gl.uniform4fv(u.loc, val);
    }
  }

  // camera: {yaw, pitch, dist, target:[x,y,z], fov}; opts: {slab, showHB, colorMode, latticeBonds, tag, scale}
  render(e, cam, w, h, opt = {}) {
    const gl = this.gl;
    const vp = opt.vp || [0, 0, w, h];
    const view = lookAt(cam), proj = perspective(cam.fov || 0.6, vp[2] / vp[3], 1, cam.dist * 4 + 400);
    const vd = viewDir(cam);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(...vp);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(...vp);
    gl.clearColor(...this.bg, 1); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.SCISSOR_TEST);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND);
    const fogNear = cam.dist - 0.2 * maxBox(e), fogFar = cam.dist + 0.9 * maxBox(e);
    const lightV = mulDir(view, normalize3([-0.5, 0.8, 0.6]));
    const base = { uW: e.W, uN: e.N, uBox: e.box, uView: view, uProj: proj, uSlabN: vd, uSlabHalf: (opt.slab || 1e4) / 2, uSlabOn: opt.slab ? 1 : 0,
      uBg: this.bg, uFogNear: fogNear, uFogFar: fogFar };
    const S = e.state, model = e.model === 'tip4p' ? 0 : 1;
    // atoms
    gl.useProgram(this.pAtom);
    gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    const sc = opt.scale || 1;
    this._uni(this.pAtom, Object.assign({}, base, this.colors, { uPos: S[0], uVel: S[1], uQuat: S[2] || S[0], uType: e.Ct, uModel: model, uColorMode: opt.colorMode || 0,
      uRadO: 0.52 * sc, uRadH: 0.31 * sc, uRadMW: (opt.mwRad || 0.85) * sc, uRadLiq: (opt.liqRad || opt.mwRad || 0.85) * sc, uLight: lightV, uTag: opt.tag ?? -1 }));
    gl.bindVertexArray(this.vaoAtom);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, e.N * (model === 0 ? 3 : 1));
    gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
    // ribbons
    const rib = (link, slots, col, width, dash, opacity) => {
      gl.useProgram(this.pRib);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false);
      this._uni(this.pRib, Object.assign({}, base, { uPos: S[0], uQuat: S[2] || S[0], uLink: link, uModel: model, uSlots: slots, uWidth: width, uCol: col, uDash: dash, uOpacity: opacity }));
      gl.bindVertexArray(this.vaoRib);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, e.N * slots);
      gl.depthMask(true); gl.disable(gl.BLEND);
    };
    if (model === 0 && opt.showHB) rib(e.Ht, 2, this.hbCol, 0.075 * sc, 0.3, opt.hbOpacity ?? 1.0);
    if (model === 1 && opt.latticeBonds) {
      if (!e._nb) { const t = e._tex(e.W, e.H); e._nb = { prog: e._prog(FS_NB), tex: t, fbo: e._fbo([t]) }; e.P.nb = e._nb.prog; }
      e._run(e._nb.prog, e._nb.fbo, { uPos: S[0], uType: e.Ct });
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(...vp); gl.enable(gl.DEPTH_TEST);
      rib(e._nb.tex, 4, hex('#cfefff'), 0.16 * sc, 0, 0.55);
    }
    // box
    const B = e.box, c = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]].map(v => v.map((x, d) => x * B[d]));
    const ed = [0,1,1,2,2,3,3,0,4,5,5,6,6,7,7,4,0,4,1,5,2,6,3,7], pts = new Float32Array(ed.flatMap(i => c[i]));
    gl.useProgram(this.pLine); gl.bindVertexArray(this.vaoLine); gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuf);
    gl.bufferData(gl.ARRAY_BUFFER, pts, gl.DYNAMIC_DRAW); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this._uni(this.pLine, { uView: view, uProj: proj, uCol: [0.55, 0.62, 0.75, 0.35] });
    gl.drawArrays(gl.LINES, 0, ed.length);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(null);
    this.lastView = view; this.lastProj = proj;
  }
}

function maxBox(e) { return Math.max(...e.box); }
function normalize3(v) { const l = Math.hypot(...v); return v.map(x => x / l); }
function viewDir(cam) {   // unit vector from target to eye
  const cp = Math.cos(cam.pitch);
  return [cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw)];
}
function lookAt(cam) {
  const d = viewDir(cam), t = cam.target, eye = t.map((x, k) => x + cam.dist * d[k]);
  const f = normalize3(d.map(x => -x)), up = [0, 1, 0];
  let s = normalize3([f[1] * up[2] - f[2] * up[1], f[2] * up[0] - f[0] * up[2], f[0] * up[1] - f[1] * up[0]]);
  const u = [s[1] * f[2] - s[2] * f[1], s[2] * f[0] - s[0] * f[2], s[0] * f[1] - s[1] * f[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return new Float32Array([s[0], u[0], -f[0], 0, s[1], u[1], -f[1], 0, s[2], u[2], -f[2], 0, -dot(s, eye), -dot(u, eye), dot(f, eye), 1]);
}
function mulDir(m, v) { return normalize3([m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]); }
function perspective(fov, asp, n, f) {
  const t = 1 / Math.tan(fov / 2);
  return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]);
}

return { Viz, lookAt, perspective, viewDir };
})();

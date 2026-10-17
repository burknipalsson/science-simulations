// D3Q19 lattice Boltzmann on the GPU with WebGL2 fragment shaders (same scheme as lbm_cpu.js).
// The 3D grid is tiled as z-slices into a 2D atlas. 19 shifted populations (g = f - w) live in
// five RGBA32F textures, ping-ponged; the 20th channel (P4.w) holds the signed distance to the
// body (phi > 0 fluid). Solid cells store a sentinel in their populations, so the ordinary
// neighbour fetch doubles as the wall test. A "measure" variant of the step also writes the
// macroscopic field (ux, uy, uz, rho) and the momentum-exchange force per cell.
// Collision: BGK with a Smagorinsky LES eddy viscosity. Raw-moment MRT and 2nd-order regularized
// collisions were tried and are unstable at tau -> 0.5 with a mean flow (as linear analyses predict);
// BGK stays stable, and absorbing layers at inlet and outlet remove the sound waves it cannot damp.

const LBM_C = [[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
  [1,1,0],[-1,-1,0],[1,-1,0],[-1,1,0],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1],[0,1,1],[0,-1,-1],[0,1,-1],[0,-1,1]];
const LBM_W = LBM_C.map(c => { const s = c[0]*c[0] + c[1]*c[1] + c[2]*c[2]; return s === 0 ? 1/3 : s === 1 ? 1/18 : 1/36; });
const lbmFind = (x, y, z) => LBM_C.findIndex(c => c[0] === x && c[1] === y && c[2] === z);
const LBM_OPP = LBM_C.map(c => lbmFind(-c[0], -c[1], -c[2]));
const LBM_REFY = LBM_C.map(c => lbmFind(c[0], -c[1], c[2]));
const LBM_REFZ = LBM_C.map(c => lbmFind(c[0], c[1], -c[2]));

const GLSL_HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D;
`;
const GLSL_ATLAS = `
uniform ivec3 N; uniform int TX;
ivec2 A(ivec3 p) { return ivec2(p.x + (p.z % TX) * N.x, p.y + (p.z / TX) * N.y); }
ivec3 cellOf(ivec2 fc) { return ivec3(fc.x % N.x, fc.y % N.y, fc.x / N.x + (fc.y / N.y) * TX); }
`;
const VS_QUAD = GLSL_HEAD + `
in vec2 pos; out vec2 uv;
void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0., 1.); }`;

function lbmStepFS(measure) {
  const ch = 'xyzw', T = i => `a${i >> 2}.${ch[i & 3]}`;
  const fetch = (i, a) => `texelFetch(P${i >> 2}, ${a}, 0).${ch[i & 3]}`;
  const fl = x => (Number.isInteger(x) ? x.toFixed(1) : x.toPrecision(9));
  let dirs = '';
  for (let i = 1; i < 19; i++) {
    const [cx, cy, cz] = LBM_C[i], o = LBM_OPP[i], w = fl(LBM_W[i]), cv = `vec3(${cx}.,${cy}.,${cz}.)`;
    const ry = LBM_REFY[i], rz = LBM_REFZ[i], ryz = LBM_REFZ[LBM_REFY[i]];
    dirs += `
  { // direction ${i} (${cx},${cy},${cz})
    ivec3 s = p - ivec3(${cx}, ${cy}, ${cz}); bool ry = false, rz = false, done = false; float v = 0.;`;
    if (cy) dirs += `
    if (s.y < 0 || s.y >= N.y) {
      if (bcY == 0) s.y = (s.y + N.y) % N.y;
      else if (bcY == 1) { s.y = p.y; ry = true; }
      else { v = ${T(o)} + 6. * ${w} * dot(${cv}, s.y < 0 ? wYlo : wYhi); done = true; }
    }`;
    if (cz) dirs += `
    if (!done && (s.z < 0 || s.z >= N.z)) {
      if (bcZ == 0) s.z = (s.z + N.z) % N.z;
      else if (bcZ == 1) { s.z = p.z; rz = true; }
      else { v = ${T(o)} + 6. * ${w} * dot(${cv}, s.z < 0 ? wZlo : wZhi); done = true; }
    }`;
    if (cx) dirs += `
    if (bcX == 0) s.x = (s.x + N.x) % N.x;`;
    dirs += `
    if (!done) {`;
    if (cx === 1) dirs += `
      if (s.x < 0) { v = geq(${w}, ${cv}, r0, uin); done = true; }`;
    if (cx === -1) dirs += `
      if (s.x >= N.x) { v = geq(${w}, ${cv}, 1., u0) + ${T(i)} - geq(${w}, ${cv}, r0, u0); done = true; }`;
    dirs += `
      if (!done) {
        ivec2 a = A(s);
        v = ${cy || cz ? `ry ? (rz ? ${fetch(ryz, 'a')} : ${fetch(ry, 'a')}) : (rz ? ${fetch(rz, 'a')} : ${fetch(i, 'a')})` : fetch(i, 'a')};
        if (v > 1e29) { // the source is solid: Bouzidi interpolated bounce-back
          float q = phi0 / (phi0 - texelFetch(P4, a, 0).w);
          vec3 sv = solidVel(vec3(p) - q * ${cv}) * uScale; // moving surfaces (e.g. rolling wheels)
          float mw = 6. * ${w} * dot(${cv}, dot(sv, sv) > 0. ? sv : uw);
          if (q < 0.5) {
            ivec3 s2 = p + ivec3(${cx}, ${cy}, ${cz});
            float v2 = all(greaterThanEqual(s2, ivec3(0))) && all(lessThan(s2, N)) ? ${fetch(o, 'A(s2)')} : 2e30;
            v = (v2 < 1e29 ? 2. * q * ${T(o)} + (1. - 2. * q) * v2 : ${T(o)}) + mw;
          } else v = ${T(o)} / (2. * q) + (2. * q - 1.) / (2. * q) * ${T(i)} + mw / (2. * q);
          F -= ${cv} * (${T(o)} + v); // gauge pressure: bodies resting on the floor are not pushed down by the ambient pressure
        }
      }
    }
    f[${i}] = v;
  }`;
  }
  let coll = '';
  for (let i = 0; i < 19; i++) {
    const [cx, cy, cz] = LBM_C[i], w = fl(LBM_W[i]);
    coll += `
  { float cu = ${[cx && `${cx}.*u.x`, cy && `${cy}.*u.y`, cz && `${cz}.*u.z`].filter(Boolean).join('+') || '0.'};
    float fe = ${w} * ((rho - 1.) + rho * (3. * cu + 4.5 * cu * cu - usq));
    f[${i}] = fe + om * (f[${i}] - fe);
    if (sig > 0.) { float ct = ${[cx && `${cx}.*ut.x`, cy && `${cy}.*ut.y`, cz && `${cz}.*ut.z`].filter(Boolean).join('+') || '0.'}; f[${i}] -= sig * (f[${i}] - ${w} * (rt - 1. + rt * (3. * ct + 4.5 * ct * ct - ust))); } }`;
  }
  let sums = '';
  for (let i = 0; i < 19; i++) {
    const [cx, cy, cz] = LBM_C[i], v = `f[${i}]`;
    sums += `  rho += ${v};`;
    if (cx) sums += ` jx += ${cx}.*${v}; pxx += ${v};`;
    if (cy) sums += ` jy += ${cy}.*${v}; pyy += ${v};`;
    if (cz) sums += ` jz += ${cz}.*${v}; pzz += ${v};`;
    if (cx && cy) sums += ` pxy += ${cx * cy}.*${v};`;
    if (cx && cz) sums += ` pxz += ${cx * cz}.*${v};`;
    if (cy && cz) sums += ` pyz += ${cy * cz}.*${v};`;
    sums += '\n';
  }
  return GLSL_HEAD + GLSL_ATLAS + `
uniform sampler2D P0, P1, P2, P3, P4; uniform vec4 IP;
uniform int bcY, bcZ; uniform vec3 wYlo, wYhi, wZlo, wZhi;
uniform float nu0, csm, spLen, spNu, uScale, absIn, absOut, absSig; uniform int bcX, wallModel; uniform float nuWall; uniform vec4 absSide, wmP;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3; layout(location = 4) out vec4 o4;
${measure ? 'layout(location = 5) out vec4 oMacro; layout(location = 6) out vec4 oForce;' : ''}
float geq(float w, vec3 c, float r, vec3 u) { float cu = dot(c, u); return w * ((r - 1.) + r * (3. * cu + 4.5 * cu * cu - 1.5 * dot(u, u))); }
//INFLOW
//SOLIDVEL
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  ivec3 p = cellOf(fc);
  if (p.z >= N.z) discard;
  vec4 a0 = texelFetch(P0, fc, 0), a1 = texelFetch(P1, fc, 0), a2 = texelFetch(P2, fc, 0), a3 = texelFetch(P3, fc, 0), a4 = texelFetch(P4, fc, 0);
  float phi0 = a4.w;
  if (phi0 <= 0.) {
    o0 = o1 = o2 = o3 = vec4(1e30); o4 = vec4(1e30, 1e30, 1e30, phi0);
    ${measure ? 'oMacro = vec4(0.); oForce = vec4(0.);' : ''}
    return;
  }
  float f[19]; vec3 F = vec3(0.);
  // own previous moments (collision conserves them): inlet density, outlet extrapolation
  float r0 = 1. + a0.x + a0.y + a0.z + a0.w + a1.x + a1.y + a1.z + a1.w + a2.x + a2.y + a2.z + a2.w + a3.x + a3.y + a3.z + a3.w + a4.x + a4.y + a4.z;
  vec3 u0 = vec3(a0.y - a0.z + a1.w - a2.x + a2.y - a2.z + a2.w - a3.x + a3.y - a3.z,
                 a0.w - a1.x + a1.w - a2.x - a2.y + a2.z + a3.w - a4.x + a4.y - a4.z,
                 a1.y - a1.z + a2.w - a3.x - a3.y + a3.z + a3.w - a4.x - a4.y + a4.z) / r0;
  vec3 uin = inflow(p) * uScale;
  // wall model (Werner-Wengle law of the wall): the body surface slips tangentially just enough
  // that the momentum it absorbs equals the turbulent wall shear stress of the real, thin boundary layer
  vec3 uw = vec3(0.);
  if (wallModel == 1 && phi0 < 1.75) {
    vec3 pp = vec3(texelFetch(P4, A(min(p + ivec3(1, 0, 0), N - 1)), 0).w, texelFetch(P4, A(min(p + ivec3(0, 1, 0), N - 1)), 0).w, texelFetch(P4, A(min(p + ivec3(0, 0, 1), N - 1)), 0).w);
    vec3 pm = vec3(texelFetch(P4, A(max(p - ivec3(1, 0, 0), ivec3(0))), 0).w, texelFetch(P4, A(max(p - ivec3(0, 1, 0), ivec3(0))), 0).w, texelFetch(P4, A(max(p - ivec3(0, 0, 1), ivec3(0))), 0).w);
    vec3 g = pp - pm; float lap = dot(pp + pm, vec3(1.)) - 6. * phi0;
    // a true distance field has |central difference| ~2 and a small Laplacian on smooth walls; at sharp edges and
    // corners it does not, and there the wall stays no-slip (as viscosity enforces the Kutta condition at a trailing edge)
    float gl = length(g); vec3 n = g / max(gl, 1e-6);
    vec3 ut = u0 - dot(u0, n) * n; float um = gl > wmP.z && gl < wmP.w && abs(lap) < wmP.x ? min(length(ut), wmP.y * uScale) : 0., y = max(phi0, 0.05);
    // Werner-Wengle wall shear stress from the near-wall tangential velocity (u+ = y+, or 8.3 y+^(1/7) above y+ = 11.81)
    float nuW = max(nu0, 1e-7), Aw = 8.3, Bw = 1. / 7.;
    float tw = nuW * um / y;
    if (um > nuW / (2. * y) * pow(Aw, 2. / (1. - Bw)))
      tw = pow((1. - Bw) / 2. * pow(Aw, (1. + Bw) / (1. - Bw)) * pow(nuW / y, 1. + Bw) + (1. + Bw) / Aw * pow(nuW / y, Bw) * um, 2. / (1. + Bw));
    // slip so that the shear carried across the first cell (eddy + molecular viscosity) equals that stress
    float nuE = nu0 + 0.01 * um / y;
    uw = um > 1e-9 ? normalize(ut) * max(um - tw * y / nuE, 0.) : vec3(0.);
  }
  f[0] = a0.x;
${dirs}
  float rho = 1., jx = 0., jy = 0., jz = 0., pxx = 0., pyy = 0., pzz = 0., pxy = 0., pxz = 0., pyz = 0.;
${sums}
  vec3 u = vec3(jx, jy, jz) / rho; float d3 = (rho - 1.) / 3.;
  pxx -= rho * u.x * u.x + d3; pyy -= rho * u.y * u.y + d3; pzz -= rho * u.z * u.z + d3;
  pxy -= rho * u.x * u.y; pxz -= rho * u.x * u.z; pyz -= rho * u.y * u.z;
  float r = (float(p.x) - (float(N.x) - spLen)) / spLen;
  float tau = 3. * (nu0 + (r > 0. ? (spNu - nu0) * r * r : 0.)) + 0.5;
  float Qn = sqrt(pxx * pxx + pyy * pyy + pzz * pzz + 2. * (pxy * pxy + pxz * pxz + pyz * pyz));
  tau = 0.5 * (tau + sqrt(tau * tau + csm * Qn / rho));
  if (wallModel == 1 && phi0 < 1.75) tau = max(tau, 0.5 + 3. * nuWall); // damping floor next to slipping walls
  float om = 1. - 1. / tau, usq = 1.5 * dot(u, u);
  // absorbing layers: relax toward rho = 1 and the inflow velocity near the inlet, toward rho = 1 near the outlet
  float xi = float(p.x), sig = 0.; vec3 ut = u; float rt = 1.;
  if (xi < absIn) { float a = 1. - xi / absIn; sig = absSig * a * a; ut = uin; }
  else if (xi > float(N.x) - absOut) { float a = (xi - (float(N.x) - absOut)) / absOut; sig = absSig * a * a; }
  // far-field side faces (y, z): damp density only, so sound leaves without the mean flow being forced
  vec4 dS = vec4(float(p.y), float(N.y - 1 - p.y), float(p.z), float(N.z - 1 - p.z)) / max(absSide, vec4(1e-6));
  vec4 aS = max(1. - dS, 0.) * step(0.5, absSide);
  float sS = absSig * max(max(aS.x * aS.x, aS.y * aS.y), max(aS.z * aS.z, aS.w * aS.w));
  if (sS > sig) { sig = sS; ut = u; }
  float ust = 1.5 * dot(ut, ut);
${coll}
  o0 = vec4(f[0], f[1], f[2], f[3]); o1 = vec4(f[4], f[5], f[6], f[7]); o2 = vec4(f[8], f[9], f[10], f[11]);
  o3 = vec4(f[12], f[13], f[14], f[15]); o4 = vec4(f[16], f[17], f[18], phi0);
  ${measure ? 'oMacro = vec4(u, rho); oForce = vec4(F, 1.);' : ''}
}`;
}

// (re)voxelize: evaluate the body SDF per cell; init = fill fluid with the inflow equilibrium,
// otherwise keep the flow and only patch cells whose solid/fluid state flipped.
function lbmVoxelFS() {
  return GLSL_HEAD + GLSL_ATLAS + `
uniform sampler2D P0, P1, P2, P3, P4; uniform int init; uniform float uScale; uniform vec4 SP, IP;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3; layout(location = 4) out vec4 o4;
float geq(float w, vec3 c, float r, vec3 u) { float cu = dot(c, u); return w * ((r - 1.) + r * (3. * cu + 4.5 * cu * cu - 1.5 * dot(u, u))); }
//INFLOW
//SDF
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy);
  ivec3 p = cellOf(fc);
  if (p.z >= N.z) discard;
  float phi = sdf(vec3(p));
  if (abs(phi) < 1e-4) phi = 1e-4;
  if (phi <= 0.) { o0 = o1 = o2 = o3 = vec4(1e30); o4 = vec4(1e30, 1e30, 1e30, phi); return; }
  vec4 a0 = texelFetch(P0, fc, 0), a1 = texelFetch(P1, fc, 0), a2 = texelFetch(P2, fc, 0), a3 = texelFetch(P3, fc, 0), a4 = texelFetch(P4, fc, 0);
  if (init == 1 || a4.w <= 0.) {
    vec3 u = init == 1 ? inflow(p) * uScale : vec3(0.);
    float f[19];
${LBM_C.map((c, i) => `    f[${i}] = geq(${LBM_W[i].toPrecision(9)}, vec3(${c[0]}., ${c[1]}., ${c[2]}.), 1., u);`).join('\n')}
    a0 = vec4(f[0], f[1], f[2], f[3]); a1 = vec4(f[4], f[5], f[6], f[7]); a2 = vec4(f[8], f[9], f[10], f[11]);
    a3 = vec4(f[12], f[13], f[14], f[15]); a4 = vec4(f[16], f[17], f[18], 0.);
  }
  o0 = a0; o1 = a1; o2 = a2; o3 = a3; o4 = vec4(a4.xyz, phi);
}`;
}

// pressure probes: sample density (and velocity) at up to 16 cells after a step, into row `row` of a history texture
function lbmProbeFS() {
  return GLSL_HEAD + GLSL_ATLAS + `
uniform sampler2D P0, P1, P2, P3, P4; uniform ivec3 PC[16]; uniform int nP; out vec4 o;
void main() {
  int k = int(gl_FragCoord.x); if (k >= nP) { o = vec4(0.); return; }
  ivec2 a = A(PC[k]);
  vec4 a0 = texelFetch(P0, a, 0), a1 = texelFetch(P1, a, 0), a2 = texelFetch(P2, a, 0), a3 = texelFetch(P3, a, 0), a4 = texelFetch(P4, a, 0);
  float r = 1. + a0.x + a0.y + a0.z + a0.w + a1.x + a1.y + a1.z + a1.w + a2.x + a2.y + a2.z + a2.w + a3.x + a3.y + a3.z + a3.w + a4.x + a4.y + a4.z;
  float ux = (a0.y - a0.z + a1.w - a2.x + a2.y - a2.z + a2.w - a3.x + a3.y - a3.z) / r;
  o = vec4(r, ux, 0., 1.);
}`;
}

// sum K x K blocks of a texture
const FS_REDUCE = GLSL_HEAD + `
uniform sampler2D src; uniform int K; uniform ivec2 srcSize; out vec4 o;
void main() {
  ivec2 b = ivec2(gl_FragCoord.xy) * K; vec4 s = vec4(0.);
  for (int j = 0; j < 32; j++) { if (j >= K) break; for (int i = 0; i < 32; i++) { if (i >= K) break;
    ivec2 q = b + ivec2(i, j); if (q.x < srcSize.x && q.y < srcSize.y) s += texelFetch(src, q, 0); } }
  o = s;
}`;

const GL_PROG_CACHE = new Map();
function glCompile(gl, vs, fs, name, cache = true) {
  const key = vs + '\u0000' + fs;
  if (cache && GL_PROG_CACHE.has(key) && GL_PROG_CACHE.get(key).gl === gl) return GL_PROG_CACHE.get(key).prog;
  const prog = glCompileRaw(gl, vs, fs, name);
  if (cache) GL_PROG_CACHE.set(key, { gl, prog });
  return prog;
}
function glCompileRaw(gl, vs, fs, name) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(s);
      console.error(name, log, src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      throw new Error(name + ': ' + log);
    }
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'pos'); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(name + ': ' + gl.getProgramInfoLog(p));
  const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const info = gl.getActiveUniform(p, i); u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  return { p, u };
}

class LBMGPU {
  // o: nx, ny, nz, nu, cs, bcX (0 periodic, 1 inlet/outlet), bcY, bcZ (0 periodic, 1 slip, 2 wall), wall: {ylo,yhi,zlo,zhi},
  // inflow: GLSL body of vec3 inflow(ivec3 p) (unit scale), sdf: GLSL body of float sdf(vec3 p),
  // u: inflow speed scale, sponge: {len, nu}
  constructor(gl, o) {
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This GPU cannot render to float textures (EXT_color_buffer_float).');
    if (gl.getParameter(gl.MAX_DRAW_BUFFERS) < 7) throw new Error('This GPU supports too few simultaneous render targets.');
    gl.getExtension('EXT_float_blend');
    this.o = Object.assign({ cs: 0, bcY: 0, bcZ: 0, wall: {}, u: 0.05, sponge: { len: 1, nu: 0 } },
      Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)));
    const { nx, ny, nz } = this.o, maxT = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let best = null;
    for (let tx = 1; tx <= nz; tx++) {
      const ty = Math.ceil(nz / tx), W = nx * tx, H = ny * ty;
      if (W > maxT || H > maxT) continue;
      const score = Math.max(W, H) + 1e-3 * W * H;
      if (!best || score < best.score) best = { tx, W, H, score };
    }
    if (!best) throw new Error('Grid too large for this GPU.');
    this.TX = best.tx; this.W = best.W; this.H = best.H;
    this.quad = gl.createVertexArray(); gl.bindVertexArray(this.quad);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    const tex = (w, h) => {
      const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    this.tex = tex;
    this.pop = [[0, 1, 2, 3, 4].map(() => tex(this.W, this.H)), [0, 1, 2, 3, 4].map(() => tex(this.W, this.H))];
    this.macro = tex(this.W, this.H); this.forceTex = tex(this.W, this.H);
    this.fbo = [0, 1].map(k => this.mkFbo(this.pop[k]));
    this.fboM = [0, 1].map(k => this.mkFbo([...this.pop[k], this.macro, this.forceTex]));
    this.cur = 0; this.t = 0;
    // reduction chain for the force
    this.red = []; let w = this.W, h = this.H, src = this.forceTex;
    while (w > 1 || h > 1) {
      const K = Math.min(16, Math.max(w, h)), w2 = Math.ceil(w / K), h2 = Math.ceil(h / K), t = tex(w2, h2);
      this.red.push({ K, src, sw: w, sh: h, w: w2, h: h2, t, fbo: this.mkFbo([t]) }); w = w2; h = h2; src = t;
    }
    this.progReduce = glCompile(gl, VS_QUAD, FS_REDUCE, 'reduce');
    this.setScene(this.o.sdf, this.o.inflow, true, this.o.lib || '');
  }

  mkFbo(texs) {
    const gl = this.gl, f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete ' + st);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return f;
  }

  // compile shaders for a scene: sdf and inflow are GLSL function bodies
  setScene(sdf, inflow, init = true, lib = '') {
    const gl = this.gl;
    const inf = `vec3 inflow(ivec3 p) {\n${inflow}\n}`, sd = `${lib}\nfloat sdf(vec3 p) {\n${sdf}\n}`;
    const sv = `vec3 solidVel(vec3 p) {\n${this.o.solidVel || 'return vec3(0.);'}\n}`;
    this.progStep = glCompile(gl, VS_QUAD, lbmStepFS(false).replace('//INFLOW', inf).replace('//SOLIDVEL', sv), 'step');
    this.progStepM = glCompile(gl, VS_QUAD, lbmStepFS(true).replace('//INFLOW', inf).replace('//SOLIDVEL', sv), 'stepM');
    this.progVox = glCompile(gl, VS_QUAD, lbmVoxelFS().replace('//INFLOW', inf).replace('//SDF', sd), 'voxel');
    this.revoxel(init);
  }

  bindPops(prog, k) {
    const gl = this.gl;
    for (let i = 0; i < 5; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, this.pop[k][i]); gl.uniform1i(prog.u['P' + i], i); }
  }
  common(prog) {
    const gl = this.gl, o = this.o;
    gl.uniform3i(prog.u.N, o.nx, o.ny, o.nz); gl.uniform1i(prog.u.TX, this.TX);
    if (prog.u.uScale) gl.uniform1f(prog.u.uScale, o.u);
    if (prog.u.SP) gl.uniform4fv(prog.u.SP, o.SP || [0, 0, 0, 0]);
    if (prog.u.IP) gl.uniform4fv(prog.u.IP, o.IP || [0, 0, 0, 0]);
  }
  draw(fbo, w, h) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h);
    gl.bindVertexArray(this.quad); gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  revoxel(init) {
    const gl = this.gl, P = this.progVox;
    gl.useProgram(P.p); this.common(P); this.bindPops(P, this.cur);
    gl.uniform1i(P.u.init, init ? 1 : 0);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    this.draw(this.fbo[1 - this.cur], this.W, this.H);
    this.cur = 1 - this.cur;
  }

  step(n = 1, measure = true) {
    const gl = this.gl, o = this.o;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    for (let s = 0; s < n; s++) {
      const m = measure && s === n - 1, P = m ? this.progStepM : this.progStep;
      gl.useProgram(P.p); this.common(P); this.bindPops(P, this.cur);
      gl.uniform1i(P.u.bcY, o.bcY); gl.uniform1i(P.u.bcZ, o.bcZ);
      const wv = k => o.wall[k] || [0, 0, 0];
      gl.uniform3fv(P.u.wYlo, wv('ylo')); gl.uniform3fv(P.u.wYhi, wv('yhi')); gl.uniform3fv(P.u.wZlo, wv('zlo')); gl.uniform3fv(P.u.wZhi, wv('zhi'));
      gl.uniform1f(P.u.nu0, o.nu); gl.uniform1f(P.u.csm, 18 * Math.SQRT2 * o.cs * o.cs);
      gl.uniform1f(P.u.spLen, o.sponge.len); gl.uniform1f(P.u.spNu, o.sponge.nu); gl.uniform1i(P.u.bcX, o.bcX ?? 1); gl.uniform1i(P.u.wallModel, o.wallModel ? 1 : 0); gl.uniform1f(P.u.nuWall, o.nuWall ?? 0.0005); gl.uniform4fv(P.u.wmP, o.wmP || [0.35, 1.3, 1.7, 2.3]);
      const ab = o.absorb || { inLen: 0, outLen: 0, sigma: 0 }; gl.uniform1f(P.u.absIn, ab.inLen); gl.uniform1f(P.u.absOut, ab.outLen); gl.uniform1f(P.u.absSig, ab.sigma);
      gl.uniform4fv(P.u.absSide, ab.side || [0, 0, 0, 0]);

      this.draw(m ? this.fboM[1 - this.cur] : this.fbo[1 - this.cur], this.W, this.H);
      this.cur = 1 - this.cur; this.t++;
      if (this.probes) this.probeStep();
    }
  }

  // reduce the force atlas to one texel; returns the 1x1 texture's framebuffer
  reduceForce() {
    const gl = this.gl, P = this.progReduce;
    gl.useProgram(P.p); gl.activeTexture(gl.TEXTURE0); gl.uniform1i(P.u.src, 0);
    for (const r of this.red) {
      gl.bindTexture(gl.TEXTURE_2D, r.src); gl.uniform1i(P.u.K, r.K); gl.uniform2i(P.u.srcSize, r.sw, r.sh);
      this.draw(r.fbo, r.w, r.h);
    }
    return this.red[this.red.length - 1].fbo;
  }
  readForceSync() {
    const gl = this.gl, fbo = this.reduceForce(), out = new Float32Array(4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
    return [out[0], out[1], out[2]];
  }
  setProbes(cells) {
    const gl = this.gl;
    if (!cells) { this.probes = null; return; }
    if (!this.probeTex) { this.probeTex = this.tex(16, 4096); this.probeFbo = this.mkFbo([this.probeTex]); this.progProbe = glCompile(gl, VS_QUAD, lbmProbeFS(), 'probe'); }
    this.probes = cells.slice(0, 16); this.probeRow = 0; this.probeRead = 0; this.probeT0 = this.t;
  }
  probeStep() {
    const gl = this.gl, P = this.progProbe;
    gl.useProgram(P.p); this.common(P); this.bindPops(P, this.cur);
    const a = new Int32Array(48); this.probes.forEach((c, i) => a.set(c, 3 * i));
    gl.uniform3iv(P.u.PC, a); gl.uniform1i(P.u.nP, this.probes.length);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFbo); gl.viewport(0, this.probeRow % 4096, 16, 1);
    gl.bindVertexArray(this.quad); gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.probeRow++;
  }
  // read rows written since the last call: returns array of Float32Array(16*4) per step (oldest first)
  readProbes() {
    const gl = this.gl; if (!this.probes) return [];
    const last = this.probeRead ?? 0, n = Math.min(this.probeRow - last, 4096); this.probeRead = this.probeRow;
    if (n <= 0) return [];
    const all = new Float32Array(16 * 4 * 4096);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.probeFbo); gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels(0, 0, 16, 4096, gl.RGBA, gl.FLOAT, all);
    const out = []; for (let r = this.probeRow - n; r < this.probeRow; r++) out.push(all.subarray(64 * (r % 4096), 64 * (r % 4096) + 64));
    return out;
  }
  // read one row of the macro field along x at (y, z): Float32Array nx*4
  readMacroLine(y, z) {
    const gl = this.gl, { nx, ny } = this.o, out = new Float32Array(nx * 4);
    const fbo = this.macroFbo || (this.macroFbo = this.mkFbo([this.macro]));
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels((z % this.TX) * nx, Math.floor(z / this.TX) * ny + y, nx, 1, gl.RGBA, gl.FLOAT, out);
    return out;
  }

  // non-blocking force read: call after a measure step; returns the latest finished value (or null).
  // A small ring of pixel-pack buffers, each with its own fence, so no buffer is overwritten before it is read.
  readForceAsync() {
    const gl = this.gl;
    if (!this.pbos) { this.pbos = [0, 1, 2, 3].map(() => { const b = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, b); gl.bufferData(gl.PIXEL_PACK_BUFFER, 16, gl.STREAM_READ); return { b, fence: null, t: 0 }; }); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); this.fRes = null; }
    for (const p of this.pbos) if (p.fence && gl.getSyncParameter(p.fence, gl.SYNC_STATUS) === gl.SIGNALED) {
      gl.deleteSync(p.fence); p.fence = null;
      const out = new Float32Array(4); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, p.b); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, out); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      if (!this.fRes || p.t > this.fRes[3]) this.fRes = [out[0], out[1], out[2], p.t];
    }
    const free = this.pbos.find(p => !p.fence);
    if (free) {
      const fbo = this.reduceForce();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, free.b); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, 0); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      free.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0); free.t = this.t;
    }
    return this.fRes;
  }
  dispose() {
    const gl = this.gl;
    for (const t of [...this.pop[0], ...this.pop[1], this.macro, this.forceTex, ...this.red.map(r => r.t)]) gl.deleteTexture(t);
    for (const f of [...this.fbo, ...this.fboM, ...this.red.map(r => r.fbo), this.macroFbo]) if (f) gl.deleteFramebuffer(f);
    if (this.pbos) for (const p of this.pbos) { gl.deleteBuffer(p.b); if (p.fence) gl.deleteSync(p.fence); }
    if (this.probeTex) { gl.deleteTexture(this.probeTex); gl.deleteFramebuffer(this.probeFbo); }
    gl.deleteVertexArray(this.quad);
  }
  // read the macroscopic field of the last measure step for one z-slice: Float32Array nx*ny*4
  readMacroSlice(z) {
    const gl = this.gl, { nx, ny } = this.o, out = new Float32Array(nx * ny * 4);
    const fbo = this.macroFbo || (this.macroFbo = this.mkFbo([this.macro]));
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.readBuffer(gl.COLOR_ATTACHMENT0);
    gl.readPixels((z % this.TX) * nx, Math.floor(z / this.TX) * ny, nx, ny, gl.RGBA, gl.FLOAT, out);
    return out;
  }
}

if (typeof module !== 'undefined') module.exports = { LBMGPU, LBM_C, LBM_W, LBM_OPP, lbmStepFS };

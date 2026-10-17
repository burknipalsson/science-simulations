// Blood on the GPU (WebGL2): D3Q19 BGK lattice-Boltzmann plasma with Guo forcing, plus triangulated
// elastic cell membranes coupled by the immersed-boundary method (same physics as lbm_cpu.js + membrane.js).
// Fluid: the 3D grid is tiled as z-slices into 2D atlas textures; 19 shifted populations (g = f - w) in five
// RGBA32F textures with the wall signed distance in the 20th channel (solid cells hold a 1e30 sentinel).
// Membranes: every cell has NV vertices (one texture row per cell); vertex positions are stored as offsets
// from a per-cell integer anchor near its centre, so float32 stays precise anywhere in the box.
// One time step: cell sums (area, volume, centre) -> vertex forces -> spread forces onto the lattice
// (additive points, 3-point kernel) -> fluid step -> interpolate velocity and move the vertices.

const BC = [[0,0,0],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1],
  [1,1,0],[-1,-1,0],[1,-1,0],[-1,1,0],[1,0,1],[-1,0,-1],[1,0,-1],[-1,0,1],[0,1,1],[0,-1,-1],[0,1,-1],[0,-1,1]];
const BW = BC.map(c => { const s = c[0]*c[0] + c[1]*c[1] + c[2]*c[2]; return s === 0 ? 1/3 : s === 1 ? 1/18 : 1/36; });
const BOPP = BC.map(c => BC.findIndex(d => d[0] === -c[0] && d[1] === -c[1] && d[2] === -c[2]));

const BG_HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
`;
const BG_ATLAS = `
uniform ivec3 N; uniform int TX; uniform vec4 SP;
ivec2 A(ivec3 p) { return ivec2(p.x + (p.z % TX) * N.x, p.y + (p.z / TX) * N.y); }
ivec3 cellOf(ivec2 fc) { return ivec3(fc.x % N.x, fc.y % N.y, fc.x / N.x + (fc.y / N.y) * TX); }
ivec3 wrap(ivec3 p) { return ((p % N) + N) % N; }
float phi3(float r) { r = abs(r); return r <= 0.5 ? (1. + sqrt(1. - 3. * r * r)) / 3. : r <= 1.5 ? (5. - 3. * r - sqrt(max(1. - 3. * (1. - r) * (1. - r), 0.))) / 6. : 0.; }
`;
const BG_VSQ = BG_HEAD + `
in vec2 pos; void main() { gl_Position = vec4(pos, 0., 1.); }`;
const bfl = x => (Number.isInteger(x) ? x.toFixed(1) : x.toPrecision(9));

// fluid step: pull streaming, Bouzidi walls from the signed distance (wallVel(p) for moving walls), Guo forcing
function bloodStepFS() {
  const ch = 'xyzw', T = i => `a${i >> 2}.${ch[i & 3]}`, fetch = (i, a) => `texelFetch(P${i >> 2}, ${a}, 0).${ch[i & 3]}`;
  let dirs = '';
  for (let i = 1; i < 19; i++) {
    const [cx, cy, cz] = BC[i], o = BOPP[i], w = bfl(BW[i]), cv = `vec3(${cx}.,${cy}.,${cz}.)`;
    dirs += `
  { ivec3 s = wrap(p - ivec3(${cx}, ${cy}, ${cz})); ivec2 a = A(s); float v = ${fetch(i, 'a')};
    if (v > 1e29) {
      float q = phi0 / (phi0 - texelFetch(P4, a, 0).w);
      float mw = 6. * ${w} * dot(${cv}, wallVel(vec3(p) - q * ${cv}));
      if (q < 0.5) { float v2 = ${fetch(o, 'A(wrap(p + ivec3(' + cx + ', ' + cy + ', ' + cz + ')))')};
        v = (v2 < 1e29 ? 2. * q * ${T(o)} + (1. - 2. * q) * v2 : ${T(o)}) + mw; }
      else v = ${T(o)} / (2. * q) + (2. * q - 1.) / (2. * q) * ${T(i)} + mw / (2. * q);
    }
    f[${i}] = v; }`;
  }
  let sums = '', coll = '';
  for (let i = 0; i < 19; i++) {
    const [cx, cy, cz] = BC[i], v = `f[${i}]`;
    sums += ` rho += ${v};` + (cx ? ` j.x += ${cx}.*${v};` : '') + (cy ? ` j.y += ${cy}.*${v};` : '') + (cz ? ` j.z += ${cz}.*${v};` : '') + '\n';
    const cu = [cx && `${cx}.*u.x`, cy && `${cy}.*u.y`, cz && `${cz}.*u.z`].filter(Boolean).join('+') || '0.';
    const cF = [cx && `${cx}.*F.x`, cy && `${cy}.*F.y`, cz && `${cz}.*F.z`].filter(Boolean).join('+') || '0.';
    coll += `  { float cu = ${cu}; float fe = ${bfl(BW[i])} * ((rho - 1.) + rho * (3. * cu + 4.5 * cu * cu - usq));
    f[${i}] = fe + om * (f[${i}] - fe) + kf * ${bfl(BW[i])} * (3. * (${cF} - uF) + 9. * cu * (${cF})); }\n`;
  }
  return BG_HEAD + BG_ATLAS + `
uniform sampler2D P0, P1, P2, P3, P4, FT, FW, IND; uniform float tau, tauIn, massFix; uniform vec3 body;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3; layout(location = 4) out vec4 o4; layout(location = 5) out vec4 oM; layout(location = 6) out vec4 oI;
//WALLVEL
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy); ivec3 p = cellOf(fc);
  if (p.z >= N.z) discard;
  vec4 a0 = texelFetch(P0, fc, 0), a1 = texelFetch(P1, fc, 0), a2 = texelFetch(P2, fc, 0), a3 = texelFetch(P3, fc, 0), a4 = texelFetch(P4, fc, 0);
  float phi0 = a4.w;
  if (phi0 <= 0.) { o0 = o1 = o2 = o3 = vec4(1e30); o4 = vec4(1e30, 1e30, 1e30, phi0); oM = vec4(0., 0., 0., 1.); oI = vec4(0.); return; }
  // inside/outside indicator: near a membrane, the side of the kernel-weighted nearest surface; elsewhere unchanged
  vec4 FS = texelFetch(FT, fc, 0); float Wk = texelFetch(FW, fc, 0).x, ind = texelFetch(IND, fc, 0).x;
  if (Wk > 0.08) ind = clamp(0.5 - FS.w / Wk, 0., 1.);
  float tl = mix(tau, tauIn, ind);
  float f[19]; f[0] = a0.x + massFix;
${dirs}
  float rho = 1.; vec3 j = vec3(0.);
${sums}
  vec3 F = FS.xyz + body;
  vec3 u = (j + 0.5 * F) / rho; float usq = 1.5 * dot(u, u), uF = dot(u, F), om = 1. - 1. / tl, kf = 1. - 0.5 / tl;
${coll}
  o0 = vec4(f[0], f[1], f[2], f[3]); o1 = vec4(f[4], f[5], f[6], f[7]); o2 = vec4(f[8], f[9], f[10], f[11]);
  o3 = vec4(f[12], f[13], f[14], f[15]); o4 = vec4(f[16], f[17], f[18], phi0); oM = vec4(u, rho); oI = vec4(ind, 0., 0., 0.);
}`;
}

// (re)initialise the fluid: signed distance per cell, equilibrium with initVel(p)
function bloodInitFS() {
  return BG_HEAD + BG_ATLAS + `
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3; layout(location = 4) out vec4 o4; layout(location = 5) out vec4 oM; layout(location = 6) out vec4 oI;
//SDF
//INITVEL
float geq(float w, vec3 c, vec3 u) { float cu = dot(c, u); return w * (3. * cu + 4.5 * cu * cu - 1.5 * dot(u, u)); }
void main() {
  ivec3 p = cellOf(ivec2(gl_FragCoord.xy)); if (p.z >= N.z) discard;
  float phi = sdf(vec3(p)); if (abs(phi) < 1e-4) phi = 1e-4;
  oI = vec4(0.);
  if (phi <= 0.) { o0 = o1 = o2 = o3 = vec4(1e30); o4 = vec4(1e30, 1e30, 1e30, phi); oM = vec4(0., 0., 0., 1.); return; }
  vec3 u = initVel(vec3(p)); float f[19];
${BC.map((c, i) => `  f[${i}] = geq(${bfl(BW[i])}, vec3(${c[0]}., ${c[1]}., ${c[2]}.), u);`).join('\n')}
  o0 = vec4(f[0], f[1], f[2], f[3]); o1 = vec4(f[4], f[5], f[6], f[7]); o2 = vec4(f[8], f[9], f[10], f[11]);
  o3 = vec4(f[12], f[13], f[14], f[15]); o4 = vec4(f[16], f[17], f[18], phi); oM = vec4(u, 1.);
}`;
}

// re-voxelise after a scene parameter change (e.g. a tube narrowing around a cell): keep the flow where the cell stays fluid
function bloodRevoxFS() {
  return BG_HEAD + BG_ATLAS + `
uniform sampler2D P0, P1, P2, P3, P4, MAC, IND;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1; layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3; layout(location = 4) out vec4 o4; layout(location = 5) out vec4 oM; layout(location = 6) out vec4 oI;
//SDF
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy); ivec3 p = cellOf(fc); if (p.z >= N.z) discard;
  float phi = sdf(vec3(p)); if (abs(phi) < 1e-4) phi = 1e-4;
  vec4 a4 = texelFetch(P4, fc, 0); oI = texelFetch(IND, fc, 0);
  if (phi <= 0.) { o0 = o1 = o2 = o3 = vec4(1e30); o4 = vec4(1e30, 1e30, 1e30, phi); oM = vec4(0., 0., 0., 1.); return; }
  if (a4.w <= 0.) { o0 = o1 = o2 = o3 = vec4(0.); o4 = vec4(0., 0., 0., phi); oM = vec4(0., 0., 0., 1.); return; }
  o0 = texelFetch(P0, fc, 0); o1 = texelFetch(P1, fc, 0); o2 = texelFetch(P2, fc, 0); o3 = texelFetch(P3, fc, 0);
  o4 = vec4(a4.xyz, phi); oM = texelFetch(MAC, fc, 0);
}`;
}

// --- membrane passes -------------------------------------------------------------------------------
// textures (width NV unless noted): POS (NV x NC) vertex offsets from the cell anchor; ANC (NC x 1) anchor;
// CS (NC x 2) cell sums: row 0 (centre offset xyz, volume), row 1 (area, -, -, -);
// CP (NC x 4) cell parameters: row 0 (Gs, C, kb, type), row 1 (kA, kV, A0, V0), row 2 (external force on the cell xyz, wall push),
//    row 3 (reference scale s: the stress-free shape is s times the stored one, used to grow cells in place)
// topology shared by all cells: FI (NV x 6) incident faces (b, c, valid) with v first in face order;
// HI (NV x 12) hinges (a, b, w1, w2); per type t (rows offset by t*6 / t*12): FR (M11, M12, M22, detG) of face (v,b,c),
// HR (theta0, role, valid); FC (NF x 1) face vertex triples for the cell sums
const BG_MEM = `
uniform sampler2D POS, ANC, CS0, CS1, CP, FI, FR, HI, HR, FC; uniform int NV, NF;
vec3 vpos(int v, int c) { return texelFetch(POS, ivec2(v, c), 0).xyz; }
`;

// per-face sums (one texel per face and cell): o0 = (area * face centre, signed volume about the anchor), o1 = (area)
function faceSumFS() {
  return BG_HEAD + BG_MEM + `
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy); int c = fc.y;
  vec3 t = texelFetch(FC, ivec2(fc.x, 0), 0).xyz;
  vec3 x0 = vpos(int(t.x), c), x1 = vpos(int(t.y), c), x2 = vpos(int(t.z), c);
  float Ar = 0.5 * length(cross(x1 - x0, x2 - x0));
  o0 = vec4(Ar * (x0 + x1 + x2) / 3., dot(x0, cross(x1, x2)) / 6.); o1 = vec4(Ar, 0., 0., 0.);
}`;
}
// sum K consecutive texels along x (two textures at once)
const BG_ROWSUM_FS = BG_HEAD + `
uniform sampler2D S0, S1; uniform int K, SW; layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy); vec4 a = vec4(0.), b = vec4(0.);
  for (int i = 0; i < 64; i++) { if (i >= K) break; int x = fc.x * K + i; if (x >= SW) break;
    a += texelFetch(S0, ivec2(x, fc.y), 0); b += texelFetch(S1, ivec2(x, fc.y), 0); }
  o0 = a; o1 = b;
}`;

// re-anchor: new integer anchor at the cell centre (wrapped into the box)
function anchorFS() {
  return BG_HEAD + BG_MEM + `
uniform vec3 NB; out vec4 o;
void main() {
  int c = int(gl_FragCoord.x);
  vec3 a = texelFetch(ANC, ivec2(c, 0), 0).xyz, s = texelFetch(CS0, ivec2(0, c), 0).xyz / texelFetch(CS1, ivec2(0, c), 0).x;
  vec3 na = floor(a + s + 0.5); na -= NB * floor(na / NB);
  o = vec4(na, 0.);
}`;
}

// vertex forces (and normals): Skalak shear + area, dihedral bending, global area and volume, wall push, external force
function vertexForceFS() {
  return BG_HEAD + BG_ATLAS + BG_MEM + BG_HASH + `
layout(location = 0) out vec4 oF; layout(location = 1) out vec4 oN;
//SDF
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy); int v = fc.x, c = fc.y;
  vec4 p0 = texelFetch(CP, ivec2(c, 0), 0), p1 = texelFetch(CP, ivec2(c, 1), 0), p2 = texelFetch(CP, ivec2(c, 2), 0), p3 = texelFetch(CP, ivec2(c, 3), 0);
  float rs = p3.x, rs2 = rs * rs; p1.z *= rs2; p1.w *= rs2 * rs;
  float Gs = p0.x, Cs = p0.y, kb = p0.z; int ty = int(p0.w);
  vec4 cs0 = texelFetch(CS0, ivec2(0, c), 0); float Acur = texelFetch(CS1, ivec2(0, c), 0).x;
  float cA = p1.x * (Acur - p1.z) / p1.z, cV = p1.y * (cs0.w - p1.w) / p1.w;
  vec3 x = vpos(v, c), f = vec3(0.), nrm = vec3(0.);
  for (int k = 0; k < 6; k++) {
    vec4 t = texelFetch(FI, ivec2(v, k), 0); if (t.z < 0.5) continue;
    vec4 r = texelFetch(FR, ivec2(v, ty * 6 + k), 0); r.xyz /= rs2; r.w *= rs2 * rs2;
    vec3 xb = vpos(int(t.x), c), xc = vpos(int(t.y), c), e1 = xb - x, e2 = xc - x;
    float g11 = dot(e1, e1), g12 = dot(e1, e2), g22 = dot(e2, e2);
    float I1 = r.x * g11 + 2. * r.y * g12 + r.z * g22 - 2., I2 = (g11 * g22 - g12 * g12) / r.w - 1.;
    float A0 = 0.5 * sqrt(r.w), w1 = A0 * Gs / 2. * (I1 + 1.), w2 = A0 * Gs / 2. * (Cs * I2 - 1.) / r.w;
    f += w1 * 2. * ((r.x + r.y) * e1 + (r.y + r.z) * e2) + w2 * 2. * ((g22 - g12) * e1 + (g11 - g12) * e2);
    vec3 Nf = cross(e1, e2); nrm += Nf;
    f -= cA * 0.5 * cross(Nf, xc - xb) / length(Nf) + cV * cross(xb, xc) / 6.;
  }
  for (int k = 0; k < 12; k++) {
    vec4 h = texelFetch(HI, ivec2(v, k), 0); vec4 hr = texelFetch(HR, ivec2(v, ty * 12 + k), 0);
    if (hr.z < 0.5) continue;
    vec3 xa = vpos(int(h.x), c), xb = vpos(int(h.y), c), x1 = vpos(int(h.z), c), x2 = vpos(int(h.w), c);
    vec3 E = xb - xa; float el = length(E);
    vec3 n1 = cross(E, x1 - xa), n2 = cross(x2 - xa, E); float q1 = dot(n1, n1), q2 = dot(n2, n2);
    float th = atan(dot(cross(n1, n2), E) / el, dot(n1, n2)), s = kb * sin(th - hr.x);
    int role = int(hr.y); vec3 g;
    if (role == 2) g = -el / q1 * n1;
    else if (role == 3) g = -el / q2 * n2;
    else if (role == 0) g = -(dot(x1 - xb, E) / el * n1 / q1 + dot(x2 - xb, E) / el * n2 / q2);
    else g = dot(x1 - xa, E) / el * n1 / q1 + dot(x2 - xa, E) / el * n2 / q2;
    f -= s * g;
  }
  // walls: soft repulsion within 1 lattice unit of the wall (keeps vertices out of the solid)
  vec3 xa = texelFetch(ANC, ivec2(c, 0), 0).xyz + x;
  float d = sdf(xa);
  if (d < 1. && p2.w > 0.) {
    vec3 gd = vec3(sdf(xa + vec3(.25, 0., 0.)) - sdf(xa - vec3(.25, 0., 0.)), sdf(xa + vec3(0., .25, 0.)) - sdf(xa - vec3(0., .25, 0.)), sdf(xa + vec3(0., 0., .25)) - sdf(xa - vec3(0., 0., .25)));
    f += p2.w * min((1. - d) * (1. - d), 1.5) * normalize(gd + 1e-9);
  }
  // other cells: soft repulsion (k (1 - d/rc)^2) between vertices closer than rc
  if (krep > 0.) {
    ivec3 hb = ivec3(floor(2. * xa)); vec3 NB = vec3(N); int R = int(ceil(2. * rcut));
    for (int dz = -3; dz <= 3; dz++) { if (abs(dz) > R) continue; for (int dy = -3; dy <= 3; dy++) { if (abs(dy) > R) continue; for (int dx = -3; dx <= 3; dx++) { if (abs(dx) > R) continue;
      float id = texelFetch(HASH, HA(hwrap(hb + ivec3(dx, dy, dz))), 0).x;
      if (id < 0.) continue;
      int j = int(id + 0.5), cj = j / NV;
      if (cj == c) continue;
      vec3 xj = texelFetch(ANC, ivec2(cj, 0), 0).xyz + vpos(j - cj * NV, cj), dv = xa - xj;
      dv -= NB * floor(dv / NB + 0.5);
      float d = length(dv);
      if (d < rcut && d > 1e-6) f += krep * (1. - d / rcut) * (1. - d / rcut) * dv / d;
    } } }
  }
  f += p2.xyz / float(NV);
  oF = vec4(f, 0.); oN = vec4(normalize(nrm + 1e-12), 0.);
}`;
}

// spreading: one instance per vertex, 27 points per instance, additive blending into the force atlas
function spreadVS() {
  return BG_HEAD + BG_ATLAS + BG_MEM + `
uniform sampler2D VF, NRM; uniform vec2 AS; out vec4 vF; out float vW;
void main() {
  int v = gl_InstanceID % NV, c = gl_InstanceID / NV, k = gl_VertexID;
  vec3 x = texelFetch(ANC, ivec2(c, 0), 0).xyz + vpos(v, c), f = texelFetch(VF, ivec2(v, c), 0).xyz, nv = texelFetch(NRM, ivec2(v, c), 0).xyz;
  ivec3 b = ivec3(floor(x + 0.5)) + ivec3(k % 3, (k / 3) % 3, k / 9) - 1;
  vec3 d = x - vec3(b); float w = phi3(d.x) * phi3(d.y) * phi3(d.z);
  vF = vec4(f, dot(nv, -d)) * w; vW = w; // signed distance of the node along the outward normal
  vec2 a = vec2(A(wrap(b))) + 0.5;
  gl_Position = vec4(a / AS * 2. - 1., 0., 1.); gl_PointSize = 1.;
}`;
}
const SPREAD_FS = BG_HEAD + `in vec4 vF; in float vW; layout(location = 0) out vec4 o; layout(location = 1) out vec4 o2; void main() { o = vF; o2 = vec4(vW, 0., 0., 0.); }`;

// exact inside/outside indicator (start-up): parity of +x ray crossings with each nearby cell's triangles
function indicatorFS() {
  return BG_HEAD + BG_ATLAS + BG_MEM + `
uniform int NCELL; uniform float RB; out vec4 o;
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy); ivec3 p = cellOf(fc); if (p.z >= N.z) discard;
  vec3 NB = vec3(N), x = vec3(p) + vec3(0., 1.3e-3, 2.9e-3); float ind = 0.;
  for (int c = 0; c < 1024; c++) {
    if (c >= NCELL) break;
    vec3 an = texelFetch(ANC, ivec2(c, 0), 0).xyz, cen = an + texelFetch(CS0, ivec2(0, c), 0).xyz / texelFetch(CS1, ivec2(0, c), 0).x;
    vec3 d = x - cen; d -= NB * floor(d / NB + 0.5);
    if (dot(d, d) > RB * RB) continue;
    vec3 q = cen + d - an; int cnt = 0; // node in the cell's anchor frame
    for (int k = 0; k < 16384; k++) {
      if (k >= NF) break;
      vec3 t = texelFetch(FC, ivec2(k, 0), 0).xyz;
      vec3 A = vpos(int(t.x), c), B = vpos(int(t.y), c), C = vpos(int(t.z), c);
      // point-in-triangle in the yz projection, then the crossing must lie at larger x
      vec2 a = A.yz - q.yz, b = B.yz - q.yz, cc = C.yz - q.yz;
      float w0 = b.x * cc.y - b.y * cc.x, w1 = cc.x * a.y - cc.y * a.x, w2 = a.x * b.y - a.y * b.x;
      if ((w0 > 0. && w1 > 0. && w2 > 0.) || (w0 < 0. && w1 < 0. && w2 < 0.)) {
        float xs = (w0 * A.x + w1 * B.x + w2 * C.x) / (w0 + w1 + w2);
        if (xs > q.x) cnt++;
      }
    }
    if ((cnt & 1) == 1) { ind = 1.; break; }
  }
  o = vec4(ind, 0., 0., 0.);
}`;
}

// cell-cell contact: every vertex writes its global index into a voxel grid twice as fine as the lattice
// (collisions just overwrite); the force pass then repels vertices of other cells closer than rc
const BG_HASH = `
uniform sampler2D HASH; uniform ivec3 HN; uniform int HTX; uniform float krep, rcut;
ivec2 HA(ivec3 p) { return ivec2(p.x + (p.z % HTX) * HN.x, p.y + (p.z / HTX) * HN.y); }
ivec3 hwrap(ivec3 p) { return ((p % HN) + HN) % HN; }
`;
function hashVS() {
  return BG_HEAD + BG_ATLAS + BG_MEM + BG_HASH + `
uniform vec2 HS; flat out float vid;
void main() {
  int v = gl_VertexID % NV, c = gl_VertexID / NV;
  vec3 x = texelFetch(ANC, ivec2(c, 0), 0).xyz + vpos(v, c);
  ivec3 h = hwrap(ivec3(floor(2. * x)));
  gl_Position = vec4((vec2(HA(h)) + 0.5) / HS * 2. - 1., 0., 1.); gl_PointSize = 1.; vid = float(gl_VertexID);
}`;
}
const HASH_FS = BG_HEAD + `flat in float vid; out vec4 o; void main() { o = vec4(vid, 0., 0., 0.); }`;

// move: interpolate the fluid velocity at each vertex and advect; re-express relative to the new anchor
function moveFS() {
  return BG_HEAD + BG_ATLAS + BG_MEM + `
uniform sampler2D MAC, ANC2, VF; uniform float mob; out vec4 o;
void main() {
  ivec2 fc = ivec2(gl_FragCoord.xy); int v = fc.x, c = fc.y;
  vec3 an = texelFetch(ANC, ivec2(c, 0), 0).xyz, an2 = texelFetch(ANC2, ivec2(c, 0), 0).xyz;
  // mesh-scale relaxation: the IBM kernel cannot see wrinkles one triangle wide, so let the vertex move by a small
  // mobility times the part of its force that differs from its ring's average (smooth, cell-scale motion is untouched)
  vec3 dm = vec3(0.);
  if (mob > 0.) {
    vec3 Fv = texelFetch(VF, ivec2(v, c), 0).xyz, Fr = vec3(0.); float cnt = 0.;
    for (int k = 0; k < 6; k++) { vec4 t = texelFetch(FI, ivec2(v, k), 0); if (t.z < 0.5) continue; Fr += texelFetch(VF, ivec2(int(t.x), c), 0).xyz; cnt += 1.; }
    vec4 p0 = texelFetch(CP, ivec2(c, 0), 0);
    float K = p0.x * (1. + 2. * p0.y) + 10. * p0.z; // local stiffness scale: area modulus + bending
    dm = mob / max(K, 1e-9) * (Fv - Fr / cnt);
  }
  vec3 xo = vpos(v, c), x = an + xo, u = vec3(0.);
  ivec3 b = ivec3(floor(x + 0.5));
  for (int dz = -1; dz <= 1; dz++) for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    ivec3 q = b + ivec3(dx, dy, dz); vec3 d = x - vec3(q);
    u += phi3(d.x) * phi3(d.y) * phi3(d.z) * texelFetch(MAC, A(wrap(q)), 0).xyz;
  }
  vec3 sh = an - an2; // anchor shift (handles periodic wrap: shifts by whole box lengths)
  vec3 NB = vec3(N); sh -= NB * floor(sh / NB + 0.5);
  o = vec4(xo + sh + u + dm, 0.);
}`;
}

const BG_SUM_FS = BG_HEAD + `
uniform sampler2D src; uniform int K; uniform ivec2 srcSize; out vec4 o;
void main() {
  ivec2 b = ivec2(gl_FragCoord.xy) * K; vec4 s = vec4(0.);
  for (int j = 0; j < 32; j++) { if (j >= K) break; for (int i = 0; i < 32; i++) { if (i >= K) break;
    ivec2 q = b + ivec2(i, j); if (q.x < srcSize.x && q.y < srcSize.y) s += texelFetch(src, q, 0); } }
  o = s;
}`;

function bgCompile(gl, vs, fs, name) {
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

// Build the GPU topology/reference tables for a mesh (same topology for all types; one reference geometry per type).
// mesh = { F, E, vf, ve } from mesh.js topology; refs = [X0 (array of [x,y,z]) per type]
function buildMeshTables(mesh, refs) {
  const nv = mesh.vf.length, F = mesh.F, E = mesh.E, nT = refs.length;
  const FI = new Float32Array(nv * 6 * 4), HI = new Float32Array(nv * 12 * 4);
  const FR = new Float32Array(nv * 6 * nT * 4), HR = new Float32Array(nv * 12 * nT * 4), FC = new Float32Array(F.length * 4);
  F.forEach((t, k) => FC.set([t[0], t[1], t[2], 0], 4 * k));
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  for (let v = 0; v < nv; v++) {
    mesh.vf[v].forEach((fi, k) => {
      const t = F[fi], j = t.indexOf(v), b = t[(j + 1) % 3], c = t[(j + 2) % 3];
      FI.set([b, c, 1, 0], 4 * (k * nv + v));
      refs.forEach((X, ty) => {
        const e1 = sub(X[b], X[v]), e2 = sub(X[c], X[v]), g11 = dot(e1, e1), g12 = dot(e1, e2), g22 = dot(e2, e2), d = g11 * g22 - g12 * g12;
        FR.set([g22 / d, -g12 / d, g11 / d, d], 4 * ((ty * 6 + k) * nv + v));
      });
    });
    mesh.ve[v].forEach((ei, k) => {
      const e = E[ei], role = [e.a, e.b, e.w1, e.w2].indexOf(v);
      HI.set([e.a, e.b, e.w1, e.w2], 4 * (k * nv + v));
      refs.forEach((X, ty) => {
        const Ev = sub(X[e.b], X[e.a]), n1 = cross(Ev, sub(X[e.w1], X[e.a])), n2 = cross(sub(X[e.w2], X[e.a]), Ev);
        const th = Math.atan2(dot(cross(n1, n2), Ev) / Math.sqrt(dot(Ev, Ev)), dot(n1, n2));
        HR.set([th, role, 1, 0], 4 * ((ty * 12 + k) * nv + v));
      });
    });
  }
  return { nv, nf: F.length, nT, FI, HI, FR, HR, FC };
}

class BloodGPU {
  // o: nx, ny, nz, tau, sdf (GLSL body of float sdf(vec3 p), phi > 0 fluid), wallVel (GLSL body, vec3 wallVel(vec3 p)),
  //    initVel (GLSL body, vec3 initVel(vec3 p)), body [fx,fy,fz], maxCells, tables (buildMeshTables)
  constructor(gl, o) {
    this.gl = gl; this.o = Object.assign({ tau: 1, body: [0, 0, 0], wallVel: 'return vec3(0.);', initVel: 'return vec3(0.);', sdf: 'return 1e3;', maxCells: 1 }, o);
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('This GPU cannot render to float textures.');
    if (!gl.getExtension('EXT_float_blend')) throw new Error('This GPU cannot blend float textures.');
    const { nx, ny, nz } = this.o, maxT = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    let best = null;
    for (let tx = 1; tx <= nz; tx++) {
      const ty = Math.ceil(nz / tx), W = nx * tx, H = ny * ty;
      if (W > maxT || H > maxT) continue;
      const score = Math.max(W, H) + 1e-3 * W * H;
      if (!best || score < best.score) best = { tx, W, H, score };
    }
    if (!best) throw new Error('Grid too large for this GPU.');
    Object.assign(this, { TX: best.tx, W: best.W, H: best.H, t: 0, cur: 0, mcur: 0, nCells: 0 });
    this.quad = gl.createVertexArray(); gl.bindVertexArray(this.quad);
    const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null); gl.bindBuffer(gl.ARRAY_BUFFER, null);
    this.emptyVao = gl.createVertexArray();
    const T = this.tex.bind(this);
    this.pop = [0, 1].map(() => [0, 1, 2, 3, 4].map(() => T(this.W, this.H)));
    this.mac = [T(this.W, this.H), T(this.W, this.H)];
    this.ind = [T(this.W, this.H), T(this.W, this.H)];
    this.force = T(this.W, this.H); this.forceW = T(this.W, this.H);
    this.fboStep = [0, 1].map(k => this.mkFbo([...this.pop[k], this.mac[k], this.ind[k]]));
    this.fboForce = this.mkFbo([this.force, this.forceW]);
    this.fboInd = this.ind.map(t => this.mkFbo([t]));
    // membranes
    const tb = this.o.tables, NC = Math.max(1, this.o.maxCells);
    if (tb) {
      this.tb = tb; this.NC = NC;
      const up = (w, h, data) => T(w, h, data);
      this.FI = up(tb.nv, 6, tb.FI); this.HI = up(tb.nv, 12, tb.HI); this.FR = up(tb.nv, 6 * tb.nT, tb.FR); this.HR = up(tb.nv, 12 * tb.nT, tb.HR);
      this.FC = up(tb.nf, 1, tb.FC);
      this.pos = [T(tb.nv, NC), T(tb.nv, NC)]; this.anc = [T(NC, 1), T(NC, 1)];
      this.cp = T(NC, 4);
      // face sums and their row-reduction chain; the last stage (width 1) holds the per-cell sums CS0, CS1
      this.sumChain = []; let w = tb.nf;
      this.sumChain.push({ w, t: [T(w, NC), T(w, NC)] });
      while (w > 1) { const K = Math.min(64, w), w2 = Math.ceil(w / K); this.sumChain.push({ K, sw: w, w: w2, t: [T(w2, NC), T(w2, NC)] }); w = w2; }
      for (const st of this.sumChain) st.fbo = this.mkFbo(st.t);
      this.cs0 = this.sumChain[this.sumChain.length - 1].t[0]; this.cs1 = this.sumChain[this.sumChain.length - 1].t[1]; this.vf = T(tb.nv, NC); this.nrm = T(tb.nv, NC);
      this.fboPos = this.pos.map(t => this.mkFbo([t])); this.fboAnc = this.anc.map(t => this.mkFbo([t]));
      this.fboVf = this.mkFbo([this.vf, this.nrm]);
      // contact hash grid (2x finer than the lattice), R32F
      const HN = [2 * nx, 2 * ny, 2 * nz]; let hb = null;
      for (let tx = 1; tx <= HN[2]; tx++) { const ty = Math.ceil(HN[2] / tx), W = HN[0] * tx, H = HN[1] * ty; if (W > maxT || H > maxT) continue; const sc = Math.max(W, H) + 1e-3 * W * H; if (!hb || sc < hb.sc) hb = { tx, W, H, sc }; }
      if (!hb) throw new Error('contact grid too large for this GPU');
      this.HN = HN; this.HTX = hb.tx; this.HW = hb.W; this.HH = hb.H;
      this.hash = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, this.hash); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R32F, hb.W, hb.H);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.fboHash = this.mkFbo([this.hash]);
      this.cpData = new Float32Array(NC * 3 * 4);
    }
    this.setScene(this.o);
  }
  tex(w, h, data = null) {
    const gl = this.gl, t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, w, h);
    if (data) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, w, h, gl.RGBA, gl.FLOAT, data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  mkFbo(texs) {
    const gl = this.gl, f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    texs.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(texs.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('framebuffer incomplete');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return f;
  }
  setScene(o) {
    Object.assign(this.o, o);
    const gl = this.gl, sdf = `float sdf(vec3 p) {\n${this.o.sdf}\n}`;
    this.pStep = bgCompile(gl, BG_VSQ, bloodStepFS().replace('//WALLVEL', `vec3 wallVel(vec3 p) {\n${this.o.wallVel}\n}`), 'step');
    this.pRevox = bgCompile(gl, BG_VSQ, bloodRevoxFS().replace('//SDF', sdf), 'revox');
    this.pInit = bgCompile(gl, BG_VSQ, bloodInitFS().replace('//SDF', sdf).replace('//INITVEL', `vec3 initVel(vec3 p) {\n${this.o.initVel}\n}`), 'init');
    if (this.tb) {
      this.pFaceSum = bgCompile(gl, BG_VSQ, faceSumFS(), 'facesum'); this.pRowSum = bgCompile(gl, BG_VSQ, BG_ROWSUM_FS, 'rowsum');
      this.pAnc = bgCompile(gl, BG_VSQ, anchorFS(), 'anchor');
      this.pForce = bgCompile(gl, BG_VSQ, vertexForceFS().replace('//SDF', sdf), 'vforce');
      this.pSpread = bgCompile(gl, spreadVS(), SPREAD_FS, 'spread');
      this.pHash = bgCompile(gl, hashVS(), HASH_FS, 'hash');
      this.pInd = bgCompile(gl, BG_VSQ, indicatorFS(), 'indicator');
      this.pMove = bgCompile(gl, BG_VSQ, moveFS(), 'move');
    }
    this.pSumR = bgCompile(gl, BG_VSQ, BG_SUM_FS, 'reduce');
    this.initFluid();
  }
  common(P) {
    const gl = this.gl, o = this.o;
    if (P.u.N) gl.uniform3i(P.u.N, o.nx, o.ny, o.nz);
    if (P.u.TX) gl.uniform1i(P.u.TX, this.TX);
    if (P.u.SP) gl.uniform4fv(P.u.SP, o.SP || [0, 0, 0, 0]);
    if (P.u.HN) { gl.uniform3i(P.u.HN, ...this.HN); gl.uniform1i(P.u.HTX, this.HTX); }
    if (P.u.krep) { gl.uniform1f(P.u.krep, o.krep || 0); gl.uniform1f(P.u.rcut, o.rcut || 1); }
    if (this.tb) {
      if (P.u.NV) gl.uniform1i(P.u.NV, this.tb.nv);
      if (P.u.NF) gl.uniform1i(P.u.NF, this.tb.nf);
      const bind = { POS: this.pos[this.mcur], ANC: this.anc[this.mcur], CS0: this.cs0, CS1: this.cs1, CP: this.cp, FI: this.FI, FR: this.FR, HI: this.HI, HR: this.HR, FC: this.FC };
      let unit = 8;
      for (const [k, t] of Object.entries(bind)) if (P.u[k]) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(P.u[k], unit++); }
    }
  }
  bindTex(P, name, t, unit) { const gl = this.gl; gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(P.u[name], unit); }
  draw(fbo, w, h) { const gl = this.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.bindVertexArray(this.quad); gl.drawArrays(gl.TRIANGLES, 0, 3); }
  initFluid() {
    const gl = this.gl, P = this.pInit;
    gl.disable(gl.BLEND); gl.useProgram(P.p); this.common(P);
    this.draw(this.fboStep[this.cur], this.W, this.H);
  }
  // new scene parameters SP (vec4 seen by the sdf): re-voxelise, keeping the flow
  // total mass (sum of rho over the box, solid nodes count 1) and fluid node count, as the target for the drift correction
  resetMass() {
    const p4 = this.readTex(this.pop[this.cur][4], this.W, this.H); let nf = 0;
    for (let i = 3; i < p4.length; i += 4) if (p4[i] > 0 && p4[i] < 1e29) nf++;
    this.nFluid = nf; this.massTarget = this.sumMacro()[3];
  }
  setSP(sp) {
    const gl = this.gl, P = this.pRevox; this.o.SP = sp;
    gl.disable(gl.BLEND); gl.useProgram(P.p); this.common(P);
    for (let i = 0; i < 5; i++) this.bindTex(P, 'P' + i, this.pop[this.cur][i], i);
    this.bindTex(P, 'MAC', this.mac[this.cur], 5); this.bindTex(P, 'IND', this.ind[this.cur], 6);
    this.draw(this.fboStep[1 - this.cur], this.W, this.H); this.cur = 1 - this.cur;
    this.massTarget = 0; // re-measured after the next step
  }
  // exact indicator for the current cells (needs the cell sums: call after at least one step, or computeSums)
  computeIndicator() {
    const gl = this.gl, nc = this.nCells; if (!nc) return;
    this.computeSums();
    const P = this.pInd; gl.useProgram(P.p); this.common(P); gl.uniform1i(P.u.NCELL, nc); gl.uniform1f(P.u.RB, this.o.cellRadius || 12);
    gl.disable(gl.BLEND); this.draw(this.fboInd[this.cur], this.W, this.H);
  }
  computeSums() {
    const gl = this.gl, nc = this.nCells;
    let P = this.pFaceSum; gl.useProgram(P.p); this.common(P); this.draw(this.sumChain[0].fbo, this.tb.nf, nc);
    P = this.pRowSum; gl.useProgram(P.p);
    for (let i = 1; i < this.sumChain.length; i++) {
      const st = this.sumChain[i], src = this.sumChain[i - 1];
      this.bindTex(P, 'S0', src.t[0], 0); this.bindTex(P, 'S1', src.t[1], 1); gl.uniform1i(P.u.K, st.K); gl.uniform1i(P.u.SW, st.sw);
      this.draw(st.fbo, st.w, nc);
    }
  }
  // cells: [{ X: offsets [[x,y,z]..] relative to anchor, anchor: [x,y,z] integers, Gs, C, kb, type, kA, kV, A0, V0, push, fext }]
  setCells(cells) {
    const gl = this.gl, nv = this.tb.nv, n = cells.length;
    if (n > this.NC) throw new Error('too many cells');
    const pos = new Float32Array(nv * n * 4), anc = new Float32Array(n * 4);
    cells.forEach((c, i) => { c.X.forEach((p, v) => pos.set([p[0], p[1], p[2], 0], 4 * (i * nv + v))); anc.set([...c.anchor, 0], 4 * i); });
    gl.bindTexture(gl.TEXTURE_2D, this.pos[this.mcur]); if (n) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nv, n, gl.RGBA, gl.FLOAT, pos);
    gl.bindTexture(gl.TEXTURE_2D, this.anc[this.mcur]); if (n) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 1, gl.RGBA, gl.FLOAT, anc);
    this.nCells = n; this.setParams(cells);
  }
  setParams(cells) {
    const gl = this.gl, n = cells.length, d = new Float32Array(n * 4 * 4);
    cells.forEach((c, i) => {
      d.set([c.Gs, c.C, c.kb, c.type || 0], 4 * i);
      d.set([c.kA, c.kV, c.A0, c.V0], 4 * (n + i));
      d.set([...(c.fext || [0, 0, 0]), c.push ?? 0], 4 * (2 * n + i));
      d.set([c.scale ?? 1, 0, 0, 0], 4 * (3 * n + i));
    });
    this.cells = cells;
    // rows of length n: write each row separately into the NC-wide texture
    gl.bindTexture(gl.TEXTURE_2D, this.cp);
    for (let r = 0; r < 4; r++) if (n) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, r, n, 1, gl.RGBA, gl.FLOAT, d.subarray(4 * r * n, 4 * (r + 1) * n));
  }
  step(n = 1) {
    const gl = this.gl, o = this.o;
    for (let s = 0; s < n; s++) {
      gl.disable(gl.BLEND);
      const nc = this.nCells, nv = this.tb ? this.tb.nv : 0;
      if (nc) {
        // cell sums
        this.computeSums(); let P;
        // vertex forces
        if (o.krep) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboHash); gl.viewport(0, 0, this.HW, this.HH);
          gl.clearColor(-1, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.clearColor(0, 0, 0, 0);
          P = this.pHash; gl.useProgram(P.p); this.common(P); gl.uniform2f(P.u.HS, this.HW, this.HH);
          gl.bindVertexArray(this.emptyVao); gl.drawArrays(gl.POINTS, 0, nv * nc);
        }
        P = this.pForce; gl.useProgram(P.p); this.common(P); this.bindTex(P, 'HASH', this.hash, 6); this.draw(this.fboVf, nv, nc);
      }
      // spread
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboForce); gl.viewport(0, 0, this.W, this.H);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      if (nc) {
        const P = this.pSpread; gl.useProgram(P.p); this.common(P); this.bindTex(P, 'VF', this.vf, 4); this.bindTex(P, 'NRM', this.nrm, 5);
        gl.uniform2f(P.u.AS, this.W, this.H);
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.blendEquation(gl.FUNC_ADD);
        gl.bindVertexArray(this.emptyVao); gl.drawArraysInstanced(gl.POINTS, 0, 27, nv * nc);
        gl.disable(gl.BLEND);
      }
      // fluid. Interpolated bounce-back does not conserve mass exactly; in a closed periodic box the drift would
      // accumulate (and speed the flow up), so every 200 steps the missing mass is added back evenly to the fluid
      let mf = 0;
      if (this.t % 200 === 0 && !o.noMassFix) { if (!this.massTarget) this.resetMass(); else mf = (this.massTarget - this.sumMacro()[3]) / this.nFluid; }
      let P = this.pStep; gl.useProgram(P.p); this.common(P);
      for (let i = 0; i < 5; i++) this.bindTex(P, 'P' + i, this.pop[this.cur][i], i);
      this.bindTex(P, 'FT', this.force, 5); this.bindTex(P, 'FW', this.forceW, 6); this.bindTex(P, 'IND', this.ind[this.cur], 7);
      gl.uniform1f(P.u.tau, o.tau); gl.uniform1f(P.u.tauIn, 0.5 + (o.tau - 0.5) * (o.lambda || 1)); gl.uniform3fv(P.u.body, o.body);
      gl.uniform1f(P.u.massFix, mf);
      this.draw(this.fboStep[1 - this.cur], this.W, this.H);
      this.cur = 1 - this.cur;
      if (nc) {
        // new anchors, then move vertices
        P = this.pAnc; gl.useProgram(P.p); this.common(P); gl.uniform3f(P.u.NB, o.nx, o.ny, o.nz); this.draw(this.fboAnc[1 - this.mcur], nc, 1);
        P = this.pMove; gl.useProgram(P.p); this.common(P); this.bindTex(P, 'MAC', this.mac[this.cur], 4); this.bindTex(P, 'ANC2', this.anc[1 - this.mcur], 5);
        this.bindTex(P, 'VF', this.vf, 6); gl.uniform1f(P.u.mob, o.mob || 0);
        this.draw(this.fboPos[1 - this.mcur], nv, nc);
        this.mcur = 1 - this.mcur;
      }
      this.t++;
    }
  }
  // sum of the macro field (u, rho) over the whole box
  sumMacro() { return this.sumTex(this.mac[this.cur]); }
  sumIndicator() { return this.sumTex(this.ind[this.cur])[0]; }
  sumTex(tex) {
    const gl = this.gl, P = this.pSumR;
    if (!this.red) {
      this.red = []; let w = this.W, h = this.H;
      while (w > 1 || h > 1) { const K = Math.min(16, Math.max(w, h)), w2 = Math.ceil(w / K), h2 = Math.ceil(h / K), t = this.tex(w2, h2); this.red.push({ K, sw: w, sh: h, w: w2, h: h2, t, fbo: this.mkFbo([t]) }); w = w2; h = h2; }
    }
    gl.useProgram(P.p); let src = tex;
    for (const r of this.red) { this.bindTex(P, 'src', src, 0); gl.uniform1i(P.u.K, r.K); gl.uniform2i(P.u.srcSize, r.sw, r.sh); this.draw(r.fbo, r.w, r.h); src = r.t; }
    const out = new Float32Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, this.red[this.red.length - 1].fbo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
    return out;
  }
  // block until the GPU has finished (gl.finish does not wait in Chrome): read one texel
  sync() { const gl = this.gl; if (!this.syncFbo) this.syncFbo = this.mkFbo([this.mac[0]]); const b = new Float32Array(4); gl.bindFramebuffer(gl.FRAMEBUFFER, this.syncFbo); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, b); }
  readTex(t, w, h) { const gl = this.gl, f = this.mkFbo([t]), out = new Float32Array(w * h * 4); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out); gl.deleteFramebuffer(f); return out; }
  // absolute vertex positions of every cell: array of arrays of [x,y,z]
  readCells() {
    const nv = this.tb.nv, nc = this.nCells, P = this.readTex(this.pos[this.mcur], nv, nc), A = this.readTex(this.anc[this.mcur], nc, 1);
    return Array.from({ length: nc }, (_, c) => Array.from({ length: nv }, (_, v) => [0, 1, 2].map(d => A[4 * c + d] + P[4 * (c * nv + v) + d])));
  }
  // replay: overwrite the current vertex offsets (nv × nCells RGBA) and anchors (nCells RGBA), then refresh the cell sums
  // and normals the renderer reads (the force pass writes the normals; its forces are not used)
  writeCells(pos, anc) {
    const gl = this.gl, nv = this.tb.nv, n = this.nCells;
    gl.bindTexture(gl.TEXTURE_2D, this.pos[this.mcur]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, nv, n, gl.RGBA, gl.FLOAT, pos);
    gl.bindTexture(gl.TEXTURE_2D, this.anc[this.mcur]); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 1, gl.RGBA, gl.FLOAT, anc);
    gl.disable(gl.BLEND); this.computeSums();
    const P = this.pForce; gl.useProgram(P.p); this.common(P); this.bindTex(P, 'HASH', this.hash, 6); this.draw(this.fboVf, nv, n);
  }
  dispose() {
    const gl = this.gl, T = [...this.pop[0], ...this.pop[1], ...this.mac, ...this.ind, this.force, this.forceW];
    if (this.tb) T.push(this.FI, this.HI, this.FR, this.HR, this.FC, ...this.pos, ...this.anc, this.cp, this.vf, this.nrm, this.hash, ...this.sumChain.flatMap(s => s.t));
    if (this.red) T.push(...this.red.map(r => r.t));
    T.forEach(t => t && gl.deleteTexture(t));
    const F = [...this.fboStep, this.fboForce, ...this.fboInd, this.syncFbo];
    if (this.tb) F.push(...this.fboPos, ...this.fboAnc, this.fboVf, this.fboHash, ...this.sumChain.map(s => s.fbo));
    if (this.red) F.push(...this.red.map(r => r.fbo));
    F.forEach(f => f && gl.deleteFramebuffer(f));
  }
  // per-cell centre (absolute, lattice units) and volume: [{c: [x,y,z], V}]
  readCentres() {
    const nc = this.nCells, A = this.readTex(this.anc[this.mcur], nc, 1), S0 = this.readTex(this.cs0, 1, nc), S1 = this.readTex(this.cs1, 1, nc);
    return Array.from({ length: nc }, (_, c) => ({ c: [0, 1, 2].map(d => A[4 * c + d] + S0[4 * c + d] / S1[4 * c]), V: S0[4 * c + 3], A: S1[4 * c] }));
  }
  readMacroSlice(z) {
    const gl = this.gl, { nx, ny } = this.o, out = new Float32Array(nx * ny * 4), f = this.mkFbo([this.mac[this.cur]]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.readPixels((z % this.TX) * nx, Math.floor(z / this.TX) * ny, nx, ny, gl.RGBA, gl.FLOAT, out);
    gl.deleteFramebuffer(f); return out;
  }
}

if (typeof module !== 'undefined') module.exports = { BloodGPU, buildMeshTables };

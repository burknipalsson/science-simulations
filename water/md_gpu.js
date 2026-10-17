// GPU molecular dynamics of water in WebGL2 fragment shaders: TIP4P/2005 (rigid, NO_SQUISH) and mW.
// State lives in RGBA32F textures, one texel per molecule.  Every few steps the molecules are
// sorted by cell (bitonic sort) and all state is reordered, so neighbour search scans contiguous runs.
'use strict';

const GW = (() => {
const KB = 0.0083144626, KC = 1389.35458, BARU = 1 / 16605.39, GCC = 1.66053907;

// ---- TIP4P/2005 constants (mirror tip4p_cpu.js) ----
const T4 = { rOH: 0.9572, theta: 104.52 * Math.PI / 180, dOM: 0.1546, qH: 0.5564, sigma: 3.1589, eps: 93.2 * KB, mO: 15.9994, mH: 1.008 };
T4.qM = -2 * T4.qH; T4.mass = T4.mO + 2 * T4.mH;
const BODY = (() => {
  const hx = T4.rOH * Math.sin(T4.theta / 2), hz = T4.rOH * Math.cos(T4.theta / 2), zc = 2 * T4.mH * hz / T4.mass;
  const O = [0, 0, -zc], H1 = [hx, 0, hz - zc], H2 = [-hx, 0, hz - zc], M = [0, 0, T4.dOM - zc], I = [0, 0, 0];
  for (const [m, s] of [[T4.mO, O], [T4.mH, H1], [T4.mH, H2]]) { I[0] += m * (s[1]**2 + s[2]**2); I[1] += m * (s[0]**2 + s[2]**2); I[2] += m * (s[0]**2 + s[1]**2); }
  return { O, H1, H2, M, I };
})();
const MW = { eps: 6.189 * 4.184, sigma: 2.3925, a: 1.8, lambda: 23.15, gamma: 1.2, A: 7.049556277, B: 0.6022245584, cos0: -1 / 3, mass: 18.015 };
MW.rc = MW.a * MW.sigma;

const v3 = a => `vec3(${a.map(x => x.toFixed(9)).join(',')})`;

const HEAD = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform int uW, uN; uniform vec3 uBox;
ivec2 tc(int i) { return ivec2(i % uW, i / uW); }
int myIndex() { return int(gl_FragCoord.y) * uW + int(gl_FragCoord.x); }
`;
const CELLS = `
uniform ivec3 uNc, uR; uniform int uCW; uniform sampler2D uCells;
ivec3 cellOf(vec3 p) { vec3 f = p / uBox; f -= floor(f); return clamp(ivec3(f * vec3(uNc)), ivec3(0), uNc - 1); }
int cellId(ivec3 c) { return (c.z * uNc.y + c.y) * uNc.x + c.x; }
uniform int uH;
// split neighbour search: fragment row block s handles one (dz, dy) column of neighbour cells
int slabY, slabZ;
int splitIndex() { int y = int(gl_FragCoord.y), s = y / uH, ny = 2 * uR.y + 1;
  slabZ = s / ny - uR.z; slabY = s % ny - uR.y;
  return (y % uH) * uW + int(gl_FragCoord.x); }
vec2 cellRange(ivec3 c) { int id = cellId(c); return texelFetch(uCells, ivec2(id % uCW, id / uCW), 0).xy; }
`;
const QUAT = `
mat3 qmat(vec4 q) {   // body -> lab, column-major
  return mat3(q.x*q.x+q.y*q.y-q.z*q.z-q.w*q.w, 2.*(q.y*q.z+q.x*q.w), 2.*(q.y*q.w-q.x*q.z),
              2.*(q.y*q.z-q.x*q.w), q.x*q.x-q.y*q.y+q.z*q.z-q.w*q.w, 2.*(q.z*q.w+q.x*q.y),
              2.*(q.y*q.w+q.x*q.z), 2.*(q.z*q.w-q.x*q.y), q.x*q.x-q.y*q.y-q.z*q.z+q.w*q.w);
}
vec4 P1(vec4 a) { return vec4(-a.y, a.x, a.w, -a.z); }
vec4 P2(vec4 a) { return vec4(-a.z, -a.w, a.x, a.y); }
vec4 P3(vec4 a) { return vec4(-a.w, a.z, -a.y, a.x); }
`;

const VS = `#version 300 es
void main() { vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2. - 1., 0., 1.); }`;

// ------------- shaders: sorting -------------
const FS_KEY = HEAD + CELLS + `
uniform sampler2D uPos; out vec4 o;
void main() { int i = myIndex(); float key = 1e9;
  if (i < uN) key = float(cellId(cellOf(texelFetch(uPos, tc(i), 0).xyz)));
  o = vec4(key, float(i), 0., 0.); }`;
const FS_BITONIC = HEAD + `
uniform sampler2D uKeys; uniform int uK, uJ; out vec4 o;
void main() { int i = myIndex(), p = i ^ uJ;
  vec2 a = texelFetch(uKeys, tc(i), 0).xy, b = texelFetch(uKeys, tc(p), 0).xy;
  bool aLess = a.x < b.x || (a.x == b.x && a.y < b.y);
  bool keepMin = (i < p) == ((i & uK) == 0);
  o = vec4((keepMin == aLess) ? a : b, 0., 0.); }`;
const FS_CELLSTART = HEAD + `
uniform sampler2D uKeys; uniform int uCW, uNcells; out vec4 o;
int lowerBound(float c) { int lo = 0, hi = uN;
  while (lo < hi) { int m = (lo + hi) >> 1; if (texelFetch(uKeys, tc(m), 0).x < c) lo = m + 1; else hi = m; }
  return lo; }
void main() { int c = int(gl_FragCoord.y) * uCW + int(gl_FragCoord.x);
  if (c >= uNcells) { o = vec4(0.); return; }
  o = vec4(float(lowerBound(float(c))), float(lowerBound(float(c + 1))), 0., 0.); }`;
const fsReorder = n => HEAD + `
uniform sampler2D uKeys; ${Array.from({ length: n }, (_, k) => `uniform sampler2D uS${k}; layout(location=${k}) out vec4 o${k};`).join('\n')}
void main() { int i = myIndex(); ivec2 s = tc(int(texelFetch(uKeys, tc(i), 0).y));
  ${Array.from({ length: n }, (_, k) => `o${k} = texelFetch(uS${k}, s, 0);`).join('\n  ')}
  vec3 f = o0.xyz / uBox; o0.xyz = (f - floor(f)) * uBox; }`;

const fsSum = n => HEAD + `
uniform int uH, uS; ${Array.from({ length: n }, (_, k) => `uniform sampler2D uP${k}; layout(location=${k}) out vec4 o${k};`).join('\n')}
void main() { ivec2 c = ivec2(gl_FragCoord.xy);
  ${Array.from({ length: n }, (_, k) => `o${k} = vec4(0.);`).join(' ')}
  for (int s = 0; s < uS; s++) { ivec2 cs = c + ivec2(0, s * uH);
    ${Array.from({ length: n }, (_, k) => `o${k} += texelFetch(uP${k}, cs, 0);`).join(' ')} } }`;

// ------------- TIP4P/2005 -------------
const T4_CONST = `
const vec3 bO = ${v3(BODY.O)}, bH1 = ${v3(BODY.H1)}, bH2 = ${v3(BODY.H2)}, bM = ${v3(BODY.M)};
const vec3 Ib = ${v3(BODY.I)};
const float QH = ${T4.qH.toFixed(6)}, QM = ${T4.qM.toFixed(6)}, KC = ${KC}, SIG2 = ${(T4.sigma ** 2).toFixed(8)}, EPS4 = ${(4 * T4.eps).toFixed(8)};
const float MASS = ${T4.mass.toFixed(6)};
`;
const FS_T4_FORCE = HEAD + CELLS + QUAT + T4_CONST + `
uniform sampler2D uPos, uQuat; uniform float uRc, uAlpha, uEc, uFc, uRs2;
uniform vec3 uField; uniform float uFieldOn;
layout(location=0) out vec4 oF; layout(location=1) out vec4 oT; layout(location=2) out vec4 oV;
float erfcx(float x, out float ex) {   // returns erfc(x) and exp(-x²) (A&S 7.1.26)
  float t = 1. / (1. + 0.3275911 * x); ex = exp(-x * x);
  return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * ex; }
void main() {
  int i = splitIndex(); if (i >= uN) { oF = oT = oV = vec4(0.); return; }
  vec4 pi = texelFetch(uPos, tc(i), 0); mat3 Ri = qmat(texelFetch(uQuat, tc(i), 0));
  vec3 si[4]; si[0] = Ri * bO; si[1] = Ri * bH1; si[2] = Ri * bH2; si[3] = Ri * bM;
  float qs[4]; qs[0] = 0.; qs[1] = QH; qs[2] = QH; qs[3] = QM;
  vec3 F = vec3(0.), T = vec3(0.), W = vec3(0.); float E = 0.;
  float rc2 = uRc * uRc, sp = 1.1283791671 * uAlpha;
  ivec3 ci = cellOf(pi.xyz);
  for (int dx = -uR.x; dx <= uR.x; dx++) { int dy = slabY, dz = slabZ;
    vec2 se = cellRange((ci + ivec3(dx, dy, dz) + uNc) % uNc);
    for (int k = int(se.x); k < int(se.y); k++) {
      if (k == i) continue;
      vec3 d = pi.xyz - texelFetch(uPos, tc(k), 0).xyz; d -= uBox * round(d / uBox);
      if (dot(d, d) > uRs2) continue;
      mat3 Rj = qmat(texelFetch(uQuat, tc(k), 0));
      vec3 sj[4]; sj[0] = Rj * bO - d; sj[1] = Rj * bH1 - d; sj[2] = Rj * bH2 - d; sj[3] = Rj * bM - d;
      vec3 Fij = vec3(0.);
      // O–O Lennard-Jones
      { vec3 r = si[0] - sj[0]; float r2 = dot(r, r);
        if (r2 < rc2) { float s6 = SIG2 / r2; s6 = s6 * s6 * s6; E += EPS4 * (s6 * s6 - s6);
          vec3 f = EPS4 * (12. * s6 * s6 - 6. * s6) / r2 * r; Fij += f; T += cross(si[0], f); } }
      for (int a = 1; a < 4; a++) for (int b = 1; b < 4; b++) {
        vec3 r = si[a] - sj[b]; float r2 = dot(r, r);
        if (r2 >= rc2) continue;
        float rr = sqrt(r2), ex, ef = erfcx(uAlpha * rr, ex), qq = KC * qs[a] * qs[b];
        E += qq * (ef / rr - uEc + uFc * (rr - uRc));
        vec3 f = qq * (ef / r2 + sp * ex / rr - uFc) / rr * r;
        Fij += f; T += cross(si[a], f);
      }
      F += Fij; W += d * Fij;
    }
  }
  bool first = slabY == -uR.y && slabZ == -uR.z;
  if (uFieldOn > 0. && first) {   // uniform external electric field (V/Å -> kJ/mol/Å/e = 96.485)
    vec3 fe = 96.4853 * uField; vec3 fH1 = QH * fe, fH2 = QH * fe, fM = QM * fe;
    F += fH1 + fH2 + fM; T += cross(si[1], fH1) + cross(si[2], fH2) + cross(si[3], fM);
  }
  oF = vec4(F, 0.5 * E); oT = vec4(T, 0.); oV = vec4(0.5 * W, 0.);
}`;
// kick (half step) + optional thermostat/barostat scaling + NO_SQUISH rotation + drift
const FS_T4_KD = HEAD + QUAT + T4_CONST + `
uniform sampler2D uPos, uVel, uQuat, uMom, uF, uT; uniform float uDt, uVs; uniform vec3 uMu;
uniform int uDrift;   // 0: kick only (second half)
layout(location=0) out vec4 oP; layout(location=1) out vec4 oV; layout(location=2) out vec4 oQ; layout(location=3) out vec4 oM;
void rot(inout vec4 q, inout vec4 p, int k, float h) {
  vec4 t = k == 1 ? P1(q) : k == 2 ? P2(q) : P3(q), u = k == 1 ? P1(p) : k == 2 ? P2(p) : P3(p);
  float I = k == 1 ? Ib.x : k == 2 ? Ib.y : Ib.z, z = h * dot(p, t) / (4. * I);
  float c = cos(z), s = sin(z); q = c * q + s * t; p = c * p + s * u; }
void main() {
  int i = myIndex(); ivec2 c = tc(i);
  vec4 P = texelFetch(uPos, c, 0), V = texelFetch(uVel, c, 0), Q = texelFetch(uQuat, c, 0), M = texelFetch(uMom, c, 0);
  if (i >= uN) { oP = P; oV = V; oQ = Q; oM = M; return; }
  float h = 0.5 * uDt;
  if (uDrift == 1) { V.xyz *= uVs / uMu; M *= uVs; P.xyz *= uMu; }
  float fixed_ = V.w;     // V.w > 0.5: pinned molecule (no motion)
  if (fixed_ < 0.5) {
    V.xyz += h * 100. / MASS * texelFetch(uF, c, 0).xyz;
    vec3 tb = transpose(qmat(Q)) * texelFetch(uT, c, 0).xyz;
    M += 2. * h * 100. * (tb.x * P1(Q) + tb.y * P2(Q) + tb.z * P3(Q));
  } else { V.xyz = vec3(0.); M = vec4(0.); }
  if (uDrift == 1) {
    rot(Q, M, 3, h); rot(Q, M, 2, h); rot(Q, M, 1, uDt); rot(Q, M, 2, h); rot(Q, M, 3, h);
    Q = normalize(Q);
    P.xyz += uDt * V.xyz;
  }
  oP = P; oV = V; oQ = Q; oM = M;
}`;
// per-row reduction: kinetic (trans xyz, rot), virial xyz, potential
const FS_T4_RED1 = HEAD + QUAT + T4_CONST + `
uniform sampler2D uVel, uQuat, uMom, uF, uVir; layout(location=0) out vec4 oA; layout(location=1) out vec4 oB;
void main() { int y = int(gl_FragCoord.y); vec4 A = vec4(0.), B = vec4(0.);
  for (int x = 0; x < uW; x++) { int i = y * uW + x; if (i >= uN) break; ivec2 c = ivec2(x, y);
    vec3 v = texelFetch(uVel, c, 0).xyz; vec4 q = texelFetch(uQuat, c, 0), p = texelFetch(uMom, c, 0);
    vec3 L = 0.5 * vec3(dot(p, P1(q)), dot(p, P2(q)), dot(p, P3(q)));
    A += vec4(0.005 * MASS * v * v, 0.005 * dot(L * L, 1. / Ib));
    B += vec4(texelFetch(uVir, c, 0).xyz, texelFetch(uF, c, 0).w); }
  oA = A; oB = B; }`;
const FS_RED2 = HEAD + `
uniform sampler2D uA, uB; uniform int uRows; layout(location=0) out vec4 oA; layout(location=1) out vec4 oB;
void main() { vec4 A = vec4(0.), B = vec4(0.);
  for (int y = 0; y < uRows; y++) { A += texelFetch(uA, ivec2(0, y), 0); B += texelFetch(uB, ivec2(0, y), 0); }
  oA = A; oB = B; }`;

// ------------- mW -------------
const MW_CONST = `
const float EPS = ${MW.eps.toFixed(8)}, SIG = ${MW.sigma}, RC = ${MW.rc.toFixed(8)}, LAM = ${MW.lambda}, GAM = ${MW.gamma};
const float AA = ${MW.A}, BB = ${MW.B}, C0 = ${MW.cos0.toFixed(10)}, MASS = ${MW.mass};
`;
// moments of neighbour directions: (F, V), (Txx, Tyy, Tzz, Txy), (Txz, Tyz, Q, -)
const FS_MW_MOM = HEAD + CELLS + MW_CONST + `
uniform sampler2D uPos, uVel; layout(location=0) out vec4 o0; layout(location=1) out vec4 o1; layout(location=2) out vec4 o2;
void main() { int i = splitIndex(); o0 = o1 = o2 = vec4(0.); if (i >= uN) return;
  vec3 pi = texelFetch(uPos, tc(i), 0).xyz; if (texelFetch(uVel, tc(i), 0).w > 1.5) return;   // solute
  ivec3 ci = cellOf(pi);
  for (int dx = -uR.x; dx <= uR.x; dx++) { int dy = slabY, dz = slabZ;
    vec2 se = cellRange((ci + ivec3(dx, dy, dz) + uNc) % uNc);
    for (int k = int(se.x); k < int(se.y); k++) {
      if (k == i) continue;
      vec3 d = texelFetch(uPos, tc(k), 0).xyz - pi; d -= uBox * round(d / uBox);
      float r2 = dot(d, d); if (r2 >= RC * RC) continue;
      if (texelFetch(uVel, tc(k), 0).w > 1.5) continue;
      float r = sqrt(r2), g = exp(GAM * SIG / (r - RC)); vec3 u = d / r;
      o0 += g * vec4(1., u); o1 += g * vec4(u * u, u.x * u.y); o2 += vec4(g * u.x * u.z, g * u.y * u.z, g * g, 0.);
    } } }`;
const FS_MW_FORCE = HEAD + CELLS + MW_CONST + `
uniform sampler2D uPos, uVel, uM0, uM1, uM2;
layout(location=0) out vec4 oF; layout(location=1) out vec4 oV;
vec3 grad3(vec4 m0, vec4 m1, vec4 m2, vec3 u, float r, float g) {
  vec3 Tu = vec3(m1.x * u.x + m1.w * u.y + m2.x * u.z, m1.w * u.x + m1.y * u.y + m2.y * u.z, m2.x * u.x + m2.y * u.y + m1.z * u.z);
  float le = LAM * EPS;
  float dEdg = le * (dot(u, Tu) - 2. * C0 * dot(m0.yzw, u) + C0 * C0 * m0.x - (1. - C0) * (1. - C0) * g);
  float gp = -g * GAM * SIG / ((r - RC) * (r - RC));
  vec3 w = le * (2. * g * Tu - 2. * C0 * g * m0.yzw);
  return dEdg * gp * u + (w - dot(w, u) * u) / r; }
void main() { int i = splitIndex(); oF = oV = vec4(0.); if (i >= uN) return;
  vec3 pi = texelFetch(uPos, tc(i), 0).xyz; bool si = texelFetch(uVel, tc(i), 0).w > 1.5;
  vec4 a0 = texelFetch(uM0, tc(i), 0), a1 = texelFetch(uM1, tc(i), 0), a2 = texelFetch(uM2, tc(i), 0);
  vec3 F = vec3(0.), W = vec3(0.); float E = 0.;
  ivec3 ci = cellOf(pi);
  for (int dx = -uR.x; dx <= uR.x; dx++) { int dy = slabY, dz = slabZ;
    vec2 se = cellRange((ci + ivec3(dx, dy, dz) + uNc) % uNc);
    for (int k = int(se.x); k < int(se.y); k++) {
      if (k == i) continue;
      vec3 d = texelFetch(uPos, tc(k), 0).xyz - pi; d -= uBox * round(d / uBox);
      float r2 = dot(d, d); if (r2 >= RC * RC) continue;
      float r = sqrt(r2); vec3 u = d / r;
      float sr4 = SIG * SIG / r2; sr4 *= sr4; float ex = exp(SIG / (r - RC));
      E += 0.5 * AA * EPS * (BB * sr4 - 1.) * ex;
      float dphi = AA * EPS * ex * (-4. * BB * sr4 / r - (BB * sr4 - 1.) * SIG / ((r - RC) * (r - RC)));
      vec3 f = dphi * u; W -= 0.5 * d * f;
      if (!si && texelFetch(uVel, tc(k), 0).w < 1.5) {
        float g = exp(GAM * SIG / (r - RC));
        vec3 ga = grad3(a0, a1, a2, u, r, g);
        vec3 gb = grad3(texelFetch(uM0, tc(k), 0), texelFetch(uM1, tc(k), 0), texelFetch(uM2, tc(k), 0), -u, r, g);
        f += ga - gb; W -= d * ga;
      }
      F += f;
    } }
  if (!si && slabY == -uR.y && slabZ == -uR.z) {
    float trT2 = dot(a1.xyz, a1.xyz) + 2. * (a1.w * a1.w + a2.x * a2.x + a2.y * a2.y);
    E += 0.5 * LAM * EPS * (trT2 - 2. * C0 * dot(a0.yzw, a0.yzw) + C0 * C0 * a0.x * a0.x - (1. - C0) * (1. - C0) * a2.z);
  }
  oF = vec4(F, E); oV = vec4(W, 0.); }`;
const FS_MW_KD = HEAD + MW_CONST + `
uniform sampler2D uPos, uVel, uF; uniform float uDt, uVs; uniform vec3 uMu; uniform int uDrift;
uniform float uSoluteMass;
layout(location=0) out vec4 oP; layout(location=1) out vec4 oV;
void main() { int i = myIndex(); ivec2 c = tc(i);
  vec4 P = texelFetch(uPos, c, 0), V = texelFetch(uVel, c, 0);
  if (i >= uN) { oP = P; oV = V; return; }
  if (uDrift == 1) { V.xyz *= uVs / uMu; P.xyz *= uMu; }
  float m = V.w > 1.5 ? uSoluteMass : MASS;
  if (V.w > 0.5 && V.w < 1.5) V.xyz = vec3(0.);           // pinned
  else V.xyz += 0.5 * uDt * 100. / m * texelFetch(uF, c, 0).xyz;
  if (uDrift == 1) P.xyz += uDt * V.xyz;
  oP = P; oV = V; }`;
const FS_MW_RED1 = HEAD + MW_CONST + `
uniform sampler2D uVel, uF, uVir; uniform float uSoluteMass; layout(location=0) out vec4 oA; layout(location=1) out vec4 oB;
void main() { int y = int(gl_FragCoord.y); vec4 A = vec4(0.), B = vec4(0.);
  for (int x = 0; x < uW; x++) { int i = y * uW + x; if (i >= uN) break; ivec2 c = ivec2(x, y);
    vec4 v = texelFetch(uVel, c, 0); float m = v.w > 1.5 ? uSoluteMass : MASS;
    A += vec4(0.005 * m * v.xyz * v.xyz, 0.);
    B += vec4(texelFetch(uVir, c, 0).xyz, texelFetch(uF, c, 0).w); }
  oA = A; oB = B; }`;


// ------------- analysis: CHILL+ structure and hydrogen bonds -------------
// q3: real l=3 spherical harmonics summed over neighbours within 3.5 Å (molecule centres)
const FULL_LOOP = `for (int dz = -uR.z; dz <= uR.z; dz++) for (int dy = -uR.y; dy <= uR.y; dy++) for (int dx = -uR.x; dx <= uR.x; dx++) {
    vec2 se = cellRange((ci + ivec3(dx, dy, dz) + uNc) % uNc);
    for (int k = int(se.x); k < int(se.y); k++) { if (k == i) continue;
      vec3 d = texelFetch(uPos, tc(k), 0).xyz - pi; d -= uBox * round(d / uBox); float r2 = dot(d, d);`;
const FS_Q3 = HEAD + CELLS + `
uniform sampler2D uPos; layout(location=0) out vec4 oA; layout(location=1) out vec4 oB;
void main() { int i = myIndex(); oA = oB = vec4(0.); if (i >= uN) return;
  vec3 pi = texelFetch(uPos, tc(i), 0).xyz; ivec3 ci = cellOf(pi); float n = 0.;
  ` + FULL_LOOP + `
      if (r2 > 12.25) continue;
      vec3 u = d * inversesqrt(r2); float x = u.x, y = u.y, z = u.z, z2 = z * z;
      oA += vec4(0.5900435899 * y * (3. * x * x - y * y), 2.8906114426 * x * y * z, 0.4570457995 * y * (5. * z2 - 1.), 0.3731763326 * z * (5. * z2 - 3.));
      oB += vec4(0.4570457995 * x * (5. * z2 - 1.), 1.4453057213 * z * (x * x - y * y), 0.5900435899 * x * (x * x - 3. * y * y), 0.);
      n += 1.;
  } }
  oB.w = n; }`;
// classify: staggered c <= -0.8, eclipsed -0.35..0.25.  out: x = type (0 liquid, 1 hex, 2 cubic, 3 interfacial, 4 clathrate), y = neighbours
const FS_CHILL = HEAD + CELLS + `
uniform sampler2D uPos, uQA, uQB; out vec4 o;
void main() { int i = myIndex(); o = vec4(0.); if (i >= uN) return;
  vec3 pi = texelFetch(uPos, tc(i), 0).xyz; ivec3 ci = cellOf(pi);
  vec4 a = texelFetch(uQA, tc(i), 0), b = texelFetch(uQB, tc(i), 0); float ni = inversesqrt(max(dot(a, a) + dot(b.xyz, b.xyz), 1e-12));
  int nst = 0, nec = 0, nb = 0;
  ` + FULL_LOOP + `
      if (r2 > 12.25) continue;
      vec4 aj = texelFetch(uQA, tc(k), 0), bj = texelFetch(uQB, tc(k), 0);
      float c = (dot(a, aj) + dot(b.xyz, bj.xyz)) * ni * inversesqrt(max(dot(aj, aj) + dot(bj.xyz, bj.xyz), 1e-12));
      nb++; if (c <= -0.8) nst++; else if (c >= -0.35 && c <= 0.25) nec++;
  } }
  float t = 0.;
  if (nb == 4) { if (nst == 4) t = 2.; else if (nst == 3 && nec == 1) t = 1.; else if (nec == 4) t = 4.; else if (nst >= 2) t = 3.; }
  else if (nst >= 2) t = 3.;
  o = vec4(t, float(nb), float(nst), float(nec)); }`;
// smooth the classification: a molecule counts as ice if it and >= 2 neighbours are ice-like (removes liquid flicker)
// hydrogen bonds (TIP4P): for each H of molecule i the acceptor molecule j with r_OO < 3.5 Å and angle(OH, OO) < 30°
const FS_HB = HEAD + CELLS + QUAT + T4_CONST + `
uniform sampler2D uPos, uQuat; out vec4 o;
void main() { int i = myIndex(); o = vec4(-1., -1., 0., 0.); if (i >= uN) return;
  vec3 pi = texelFetch(uPos, tc(i), 0).xyz; ivec3 ci = cellOf(pi); mat3 Ri = qmat(texelFetch(uQuat, tc(i), 0));
  vec3 oi = Ri * bO, h1 = normalize(Ri * bH1 - oi), h2 = normalize(Ri * bH2 - oi);
  float best1 = 0.866, best2 = 0.866, nacc = 0.;
  ` + FULL_LOOP + `
      if (r2 > 16.) continue;
      vec3 oo = d + qmat(texelFetch(uQuat, tc(k), 0)) * bO - oi; float l2 = dot(oo, oo);
      if (l2 > 12.25) continue;
      vec3 u = oo * inversesqrt(l2);
      float c1 = dot(u, h1), c2 = dot(u, h2);
      if (c1 > best1) { best1 = c1; o.x = float(k); }
      if (c2 > best2) { best2 = c2; o.y = float(k); }
  } }
  o.z = float(o.x >= 0.) + float(o.y >= 0.); }`;

// ======================================================================
class Engine {
  constructor(gl, model, N, box, opt = {}) {
    this.gl = gl; this.model = model; this.N = N; this.box = box.slice(); this.opt = opt;
    if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float not supported');
    let np = 256; while (np < N) np *= 2;
    this.Np = np; this.W = Math.min(256, np); this.H = np / this.W;
    this.dt = opt.dt || (model === 'mw' ? 0.01 : 0.002);
    this.rebuildEvery = opt.rebuildEvery || (model === 'mw' ? 8 : 12);
    this.skin = opt.skin || (model === 'mw' ? 1.2 : 0.8);
    if (model === 'tip4p') {
      this.rc = opt.rc || 9.0; this.alpha = opt.alpha ?? 0.2;
      const erfc = x => { const t = 1 / (1 + 0.3275911 * x); return t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-x * x); };
      const a = this.alpha, rc = this.rc;
      this.ec = erfc(a * rc) / rc; this.fc = erfc(a * rc) / (rc * rc) + 2 * a / Math.sqrt(Math.PI) * Math.exp(-a * a * rc * rc) / rc;
      this.rsearch = rc + 2.05 + this.skin;     // COM separation within which any site pair may be < rc
      this.nState = 4;
    } else {
      this.rsearch = MW.rc + this.skin; this.nState = 2;
    }
    this.soluteMass = opt.soluteMass || MW.mass;
    this.field = [0, 0, 0];
    this.vs = 1; this.mu = [1, 1, 1];
    this.stepCount = 0; this.time = 0;
    this._initGL();
  }

  _tex(w, h, data = null) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    t.w = w; t.h = h; return t;
  }
  _fbo(texs) {
    const gl = this.gl, f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    texs.forEach((t, k) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + k, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(texs.map((_, k) => gl.COLOR_ATTACHMENT0 + k));
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('FBO incomplete ' + st);
    f.w = texs[0].w; f.h = texs[0].h; f.texs = texs; return f;
  }
  _prog(fs) {
    const gl = this.gl, mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(s);
        throw new Error('shader: ' + log + '\n' + src.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n'));
      }
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('link: ' + gl.getProgramInfoLog(p));
    p.u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let k = 0; k < n; k++) { const info = gl.getActiveUniform(p, k); p.u[info.name] = { loc: gl.getUniformLocation(p, info.name), type: info.type }; }
    return p;
  }
  // run a program into fbo; uniforms: name -> value; textures: name -> texture
  _run(prog, fbo, uni = {}, w, h) {
    const gl = this.gl;
    gl.useProgram(prog); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.bindVertexArray(this.vao);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.viewport(0, 0, w || fbo.w, h || fbo.h);
    let unit = 0;
    const all = Object.assign({ uW: this.W, uH: this.H, uN: this.N, uBox: this.box }, this._cellUni || {}, uni);
    for (const [name, val] of Object.entries(all)) {
      const u = prog.u[name]; if (!u) continue;
      if (val instanceof WebGLTexture) { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, val); gl.uniform1i(u.loc, unit++); }
      else if (u.type === gl.INT || u.type === gl.SAMPLER_2D) gl.uniform1i(u.loc, val);
      else if (u.type === gl.INT_VEC3) gl.uniform3iv(u.loc, val);
      else if (u.type === gl.FLOAT) gl.uniform1f(u.loc, val);
      else if (u.type === gl.FLOAT_VEC3) gl.uniform3fv(u.loc, val);
      else if (u.type === gl.FLOAT_VEC4) gl.uniform4fv(u.loc, val);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  _initGL() {
    const gl = this.gl, W = this.W, H = this.H, ns = this.nState;
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST);
    this.vao = gl.createVertexArray();
    // state ping-pong
    this.S = [0, 1].map(() => Array.from({ length: ns }, () => this._tex(W, H)));
    this.Sfbo = this.S.map(s => this._fbo(s));
    // forces etc.
    if (this.model === 'tip4p') {
      this.Ft = [this._tex(W, H), this._tex(W, H), this._tex(W, H)];   // force+E, torque, virial
    } else {
      this.Mt = [this._tex(W, H), this._tex(W, H), this._tex(W, H)];
      this.Mfbo = this._fbo(this.Mt);
      this.Ft = [this._tex(W, H), this._tex(W, H)];                     // force+E, virial
    }
    this.Ffbo = this._fbo(this.Ft);
    // partial sums of the split neighbour search (up to 25 row blocks)
    this.Pt = [0, 1, 2].map(() => this._tex(W, H * 25));
    this.Pfbo3 = this._fbo(this.Pt); this.Pfbo2 = this._fbo(this.Pt.slice(0, 2));
    // sorting
    this.K = [this._tex(W, H), this._tex(W, H)];
    this.Kfbo = this.K.map(t => this._fbo([t]));
    // cell table sized for the finest grid we might use
    this.CW = 256;
    this.maxCells = 0; this._planCells();
    // reduction
    this.R1 = [this._tex(1, H), this._tex(1, H)]; this.R1fbo = this._fbo(this.R1);
    this.R2 = [this._tex(1, 1), this._tex(1, 1)]; this.R2fbo = this._fbo(this.R2);
    // programs
    const P = this.P = {};
    P.key = this._prog(FS_KEY); P.bit = this._prog(FS_BITONIC); P.cs = this._prog(FS_CELLSTART);
    P.reorder = this._prog(fsReorder(ns)); P.red2 = this._prog(FS_RED2);
    P.sum2 = this._prog(fsSum(2)); P.sum3 = this._prog(fsSum(3));
    if (this.model === 'tip4p') { P.force = this._prog(FS_T4_FORCE); P.kd = this._prog(FS_T4_KD); P.red1 = this._prog(FS_T4_RED1); }
    else { P.mom = this._prog(FS_MW_MOM); P.force = this._prog(FS_MW_FORCE); P.kd = this._prog(FS_MW_KD); P.red1 = this._prog(FS_MW_RED1); }
    this.Qt = [this._tex(W, H), this._tex(W, H)]; this.Qfbo = this._fbo(this.Qt);
    this.Ct = this._tex(W, H); this.Cfbo2 = this._fbo([this.Ct]);
    this.Ht = this._tex(W, H); this.Hfbo = this._fbo([this.Ht]);
    P.q3 = this._prog(FS_Q3); P.chill = this._prog(FS_CHILL);
    if (this.model === 'tip4p') P.hb = this._prog(FS_HB);
    gl.bindVertexArray(this.vao);
    this.cur = 0;
  }

  _planCells() {
    const rs = this.rsearch, nc = [], L = this.box;
    // choose R (cells per search radius) per box: R = 2 when the grid allows it
    // R = cells per search radius: 2 where the grid allows it, else 1; a single cell (R=0)
    // when the box is too small for 3 cells (minimum image then still finds every pair)
    let R2 = true;
    for (let d = 0; d < 3; d++) if (Math.floor(L[d] / (rs / 2)) < 5) R2 = false;
    const R = [0, 0, 0];
    for (let d = 0; d < 3; d++) {
      if (rs > L[d] / 2) throw new Error('box too small for cutoff: L=' + L[d].toFixed(2) + ' rs=' + rs.toFixed(2));
      R[d] = R2 ? 2 : 1;
      nc[d] = Math.floor(L[d] / (rs / R[d]));
      if (nc[d] < 2 * R[d] + 1) { nc[d] = 1; R[d] = 0; }
    }
    const ncell = nc[0] * nc[1] * nc[2];
    if (ncell > this.maxCells) {
      this.maxCells = Math.ceil(ncell * 1.5 / this.CW) * this.CW;
      const h = this.maxCells / this.CW;
      this.C = this._tex(this.CW, h); this.Cfbo = this._fbo([this.C]);
    }
    this.nc = nc; this.R = R; this.ncell = ncell;
    this._cellUni = { uNc: nc, uCW: this.CW, uR: R, uCells: this.C };
  }

  get state() { return this.S[this.cur]; }

  dispose() {
    const gl = this.gl, texs = [], fbos = [];
    for (const v of Object.values(this)) {
      const list = Array.isArray(v) ? v.flat(2) : [v];
      for (const x of list) { if (x instanceof WebGLTexture) texs.push(x); else if (x instanceof WebGLFramebuffer) fbos.push(x); }
    }
    for (const t of new Set(texs)) gl.deleteTexture(t);
    for (const f of new Set(fbos)) gl.deleteFramebuffer(f);
    for (const p of Object.values(this.P)) gl.deleteProgram(p);
    this.disposed = true;
  }

  // ---- upload / download ----
  // arrays: tip4p: com(3N), v(3N), q(4N), p(4N), id?, flag?;  mw: x(3N), v(3N), id?, flag?
  upload(a) {
    const gl = this.gl, n4 = this.Np * 4, N = this.N;
    const bufs = Array.from({ length: this.nState }, () => new Float32Array(n4));
    for (let i = 0; i < N; i++) {
      for (let d = 0; d < 3; d++) { bufs[0][4*i+d] = a.x[3*i+d]; bufs[1][4*i+d] = a.v[3*i+d]; }
      bufs[0][4*i+3] = a.id ? a.id[i] : i;
      bufs[1][4*i+3] = a.flag ? a.flag[i] : 0;
      if (this.nState === 4) for (let d = 0; d < 4; d++) { bufs[2][4*i+d] = a.q[4*i+d]; bufs[3][4*i+d] = a.p[4*i+d]; }
    }
    for (let i = N; i < this.Np; i++) { bufs[0][4*i+3] = -1; if (this.nState === 4) bufs[2][4*i] = 1; }
    for (let k = 0; k < this.nState; k++) {
      gl.bindTexture(gl.TEXTURE_2D, this.S[this.cur][k]);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, bufs[k]);
    }
    this.rebuild(); this.computeForces();
  }
  _read(tex, w, h) {
    const gl = this.gl, f = this._readFbo || (this._readFbo = gl.createFramebuffer());
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const out = new Float32Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.FLOAT, out);
    return out;
  }
  // returns state arrays in ORIGINAL id order
  download() {
    const N = this.N, raw = this.state.map(t => this._read(t, this.W, this.H));
    const o = { x: new Float64Array(3 * N), v: new Float64Array(3 * N), flag: new Float32Array(N) };
    if (this.nState === 4) { o.q = new Float64Array(4 * N); o.p = new Float64Array(4 * N); }
    for (let s = 0; s < N; s++) {
      const i = raw[0][4*s+3];
      for (let d = 0; d < 3; d++) { o.x[3*i+d] = raw[0][4*s+d]; o.v[3*i+d] = raw[1][4*s+d]; }
      o.flag[i] = raw[1][4*s+3];
      if (this.nState === 4) for (let d = 0; d < 4; d++) { o.q[4*i+d] = raw[2][4*s+d]; o.p[4*i+d] = raw[3][4*s+d]; }
    }
    return o;
  }

  // ---- neighbour structure ----
  rebuild() {
    this._planCells();
    const S = this.state;
    this._run(this.P.key, this.Kfbo[0], { uPos: S[0] });
    let kc = 0;
    for (let k = 2; k <= this.Np; k *= 2) for (let j = k >> 1; j > 0; j >>= 1) {
      this._run(this.P.bit, this.Kfbo[1 - kc], { uKeys: this.K[kc], uK: k, uJ: j }); kc = 1 - kc;
    }
    const keys = this.K[kc];
    const uni = { uKeys: keys }; S.forEach((t, k) => uni['uS' + k] = t);
    this._run(this.P.reorder, this.Sfbo[1 - this.cur], uni);
    this.cur = 1 - this.cur;
    this._run(this.P.cs, this.Cfbo, { uKeys: keys, uNcells: this.ncell }, this.CW, Math.ceil(this.ncell / this.CW));
  }

  computeForces() {
    const S = this.state, ns = (2 * this.R[1] + 1) * (2 * this.R[2] + 1), W = this.W, H = this.H;
    const sum = (prog, fbo) => { const u = { uS: ns }; this.Pt.forEach((t, k) => u['uP' + k] = t); this._run(prog, fbo, u); };
    if (this.model === 'tip4p') {
      this._run(this.P.force, this.Pfbo3, { uPos: S[0], uQuat: S[2], uRc: this.rc, uAlpha: this.alpha, uEc: this.ec, uFc: this.fc,
        uRs2: (this.rc + 2.05) ** 2, uField: this.field, uFieldOn: (this.field[0] || this.field[1] || this.field[2]) ? 1 : 0 }, W, H * ns);
      sum(this.P.sum3, this.Ffbo);
    } else {
      this._run(this.P.mom, this.Pfbo3, { uPos: S[0], uVel: S[1] }, W, H * ns);
      sum(this.P.sum3, this.Mfbo);
      this._run(this.P.force, this.Pfbo2, { uPos: S[0], uVel: S[1], uM0: this.Mt[0], uM1: this.Mt[1], uM2: this.Mt[2] }, W, H * ns);
      sum(this.P.sum2, this.Ffbo);
    }
  }

  _kd(drift) {
    const S = this.state, uni = { uDt: this.dt, uDrift: drift, uVs: drift ? this.vs : 1, uMu: drift ? this.mu : [1, 1, 1], uF: this.Ft[0], uSoluteMass: this.soluteMass };
    S.forEach((t, k) => uni[['uPos', 'uVel', 'uQuat', 'uMom'][k]] = t);
    if (this.model === 'tip4p') uni.uT = this.Ft[1];
    this._run(this.P.kd, this.Sfbo[1 - this.cur], uni);
    this.cur = 1 - this.cur;
  }

  // one MD step; scaling factors (thermostat vs, barostat mu) are consumed by the first half
  step() {
    if (this.mu[0] !== 1 || this.mu[1] !== 1 || this.mu[2] !== 1) for (let d = 0; d < 3; d++) this.box[d] *= this.mu[d];
    this._kd(1);
    this.vs = 1; this.mu = [1, 1, 1];
    this.stepCount++; this.time += this.dt;
    if (this.stepCount % this.rebuildEvery === 0) this.rebuild();
    this.computeForces();
    this._kd(0);
  }

  // GPU reduction -> {kd:[x,y,z] trans KE, kr, vir:[x,y,z], epot} (kJ/mol), synchronous
  reduce() {
    const S = this.state, uni = { uVel: S[1], uF: this.Ft[0], uSoluteMass: this.soluteMass };
    if (this.model === 'tip4p') Object.assign(uni, { uQuat: S[2], uMom: S[3], uVir: this.Ft[2] });
    else uni.uVir = this.Ft[1];
    this._run(this.P.red1, this.R1fbo, uni);
    this._run(this.P.red2, this.R2fbo, { uA: this.R1[0], uB: this.R1[1], uRows: this.H });
    const a = this._read(this.R2[0], 1, 1), b = this._read(this.R2[1], 1, 1);
    return { kd: [a[0], a[1], a[2]], kr: a[3], vir: [b[0], b[1], b[2]], epot: b[3] };
  }

  // per-frame analysis on the current state: CHILL+ types into Ct, H-bond partners into Ht (TIP4P)
  analyze() {
    const S = this.state;
    this._run(this.P.q3, this.Qfbo, { uPos: S[0] });
    this._run(this.P.chill, this.Cfbo2, { uPos: S[0], uQA: this.Qt[0], uQB: this.Qt[1] });
    if (this.model === 'tip4p') this._run(this.P.hb, this.Hfbo, { uPos: S[0], uQuat: S[2] });
  }
  // CPU readback of analysis (for tests / readouts): counts by type and mean H-bonds per molecule
  analysisStats() {
    const c = this._read(this.Ct, this.W, this.H), cnt = [0, 0, 0, 0, 0];
    for (let i = 0; i < this.N; i++) cnt[c[4*i]]++;
    let hb = 0;
    if (this.model === 'tip4p') { const h = this._read(this.Ht, this.W, this.H); for (let i = 0; i < this.N; i++) hb += h[4*i+2]; }
    return { liquid: cnt[0], hex: cnt[1], cubic: cnt[2], interf: cnt[3], clath: cnt[4], hbPerMol: 2 * hb / this.N };
  }

  nfree() { return this.model === 'tip4p' ? 6 * this.N - 3 : 3 * this.N - 3; }
  // thermodynamic readout (T K, P bar, density g/cm³, U kJ/mol per molecule incl. LJ tail)
  measure(r = this.reduce()) {
    const V = this.box[0] * this.box[1] * this.box[2], kt = r.kd[0] + r.kd[1] + r.kd[2];
    const T = 2 * (kt + r.kr) / (this.nfree() * KB);
    let pt = 0, et = 0;
    if (this.model === 'tip4p') {
      const rho = this.N / V, s3 = T4.sigma ** 3, x3 = (T4.sigma / this.rc) ** 3;
      pt = (16 / 3) * Math.PI * rho * rho * T4.eps * s3 * (2 / 3 * x3 ** 3 - x3);
      et = (8 / 3) * Math.PI * rho * T4.eps * s3 * (x3 ** 3 / 3 - x3);
    }
    const Pd = [0, 1, 2].map(d => ((2 * r.kd[d] + r.vir[d]) / V + pt) / BARU);
    const mass = this.model === 'tip4p' ? T4.mass : MW.mass;
    return { T, P: (Pd[0] + Pd[1] + Pd[2]) / 3, Pd, rho: this.N * mass / V * GCC, U: r.epot / this.N + et, V, kt, kr: r.kr, r };
  }

  // schedule CSVR thermostat + stochastic cell rescaling for the next step, from measurement m
  couple(m, o) {
    const K = m.kt + m.r.kr, nf = this.nfree(), K0 = 0.5 * nf * KB * o.T;
    if (o.tauT) this.vs = Math.sqrt(csvr(K, K0, nf, o.tauT, o.every * this.dt));
    if (o.P !== undefined && o.tauP) {
      const beta = (o.compress || 4.5e-5) / BARU, kT = KB * o.T, dt = o.every * this.dt;
      const Pin = (o.mode === 'z' ? m.Pd[2] : o.mode === 'xy' ? (m.Pd[0] + m.Pd[1]) / 2 : m.P) * BARU;
      const deps = -beta / o.tauP * (o.P * BARU - Pin) * dt + Math.sqrt(2 * kT * beta * dt / (m.V * o.tauP)) * gauss();
      if (o.mode === 'z') this.mu = [1, 1, Math.exp(deps)];
      else { const mu = Math.exp(deps / 3); this.mu = [mu, mu, mu]; }
    }
  }
}

let _g2 = null;
function gauss() {
  if (_g2 !== null) { const g = _g2; _g2 = null; return g; }
  let u, v, s; do { u = 2 * Math.random() - 1; v = 2 * Math.random() - 1; s = u * u + v * v; } while (s >= 1 || s === 0);
  const m = Math.sqrt(-2 * Math.log(s) / s); _g2 = v * m; return u * m;
}
function gamma(a) {
  if (a < 1) return gamma(a + 1) * Math.pow(Math.random(), 1 / a);
  const d = a - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) { let x, v; do { x = gauss(); v = 1 + c * x; } while (v <= 0); v = v * v * v; const u = Math.random();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v; }
}
function csvr(K, K0, nf, tau, dt) {
  const c = Math.exp(-dt / tau), r1 = gauss(), s = 2 * gamma((nf - 1) / 2);
  return (c * K + (1 - c) * K0 / nf * (r1 * r1 + s) + 2 * r1 * Math.sqrt(c * (1 - c) * K0 / nf * K)) / K;
}

return { Engine, T4, BODY, MW, KB, HEAD, CELLS, QUAT, VS, csvr, gauss };
})();
if (typeof module !== 'undefined') module.exports = GW;

// Bodies as GLSL signed-distance functions in lattice units (x downstream, y across, z up).
// Each scene builder takes the grid size and parameters and returns { sdf, inflow, bbox, ... }:
// sdf is the body of `float sdf(vec3 p)` (phi > 0 in the fluid), used both to voxelize the
// solver grid and to bake a fine distance texture for rendering.

const GLSL_SDF_LIB = `
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) { vec3 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0., 1.); return length(pa - ba * h) - r; }
float sdRoundBox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, max(q.y, q.z)), 0.) - r; }
float sdTorusY(vec3 p, float R, float r) { vec2 q = vec2(length(p.xz) - R, p.y); return length(q) - r; }
float sdEllipsoid(vec3 p, vec3 r) { float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.) / k1; }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
float smax(float a, float b, float k) { return -smin(-a, -b, k); }
float sdCylY(vec3 p, float r, float h) { vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h); return min(max(d.x, d.y), 0.) + length(max(d, 0.)); }
float sdCylX(vec3 p, float r, float h) { vec2 d = abs(vec2(length(p.yz), p.x)) - vec2(r, h); return min(max(d.x, d.y), 0.) + length(max(d, 0.)); }
`;

// NACA 4-digit section as a closed polygon (chord 0..1), cosine spacing, closed trailing edge
function nacaPoints(code = '0012', n = 48) {
  const m = +code[0] / 100, pp = +code[1] / 10, t = +code.slice(2) / 100, up = [], lo = [];
  for (let i = 0; i <= n; i++) {
    const x = 0.5 * (1 - Math.cos(Math.PI * i / n));
    const yt = 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0, dy = 0;
    if (m > 0) {
      if (x < pp) { yc = m / (pp * pp) * (2 * pp * x - x * x); dy = 2 * m / (pp * pp) * (pp - x); }
      else { yc = m / ((1 - pp) ** 2) * (1 - 2 * pp + 2 * pp * x - x * x); dy = 2 * m / ((1 - pp) ** 2) * (pp - x); }
    }
    const th = Math.atan(dy);
    up.push([x - yt * Math.sin(th), yc + yt * Math.cos(th)]);
    lo.push([x + yt * Math.sin(th), yc - yt * Math.cos(th)]);
  }
  // upper TE -> LE, then lower LE -> TE (skip duplicate LE and TE)
  return [...up.slice().reverse(), ...lo.slice(1, n)];
}
function glslPoly(name, pts) {
  const f = v => v.toFixed(6);
  return `const int ${name}_N = ${pts.length};
const vec2 ${name}[${pts.length}] = vec2[](${pts.map(p => `vec2(${f(p[0])}, ${f(p[1])})`).join(', ')});
float ${name}_sd(vec2 p) {
  float d = dot(p - ${name}[0], p - ${name}[0]), s = 1.;
  for (int i = 0, j = ${name}_N - 1; i < ${name}_N; j = i, i++) {
    vec2 e = ${name}[j] - ${name}[i], w = p - ${name}[i], b = w - e * clamp(dot(w, e) / dot(e, e), 0., 1.);
    d = min(d, dot(b, b));
    bvec3 c = bvec3(p.y >= ${name}[i].y, p.y < ${name}[j].y, e.x * w.y > e.y * w.x);
    if (all(c) || all(not(c))) s = -s;
  }
  return s * sqrt(d);
}`;
}
const fl = v => (Number.isInteger(v) ? v.toFixed(1) : (+v).toPrecision(8));
const v3 = a => `vec3(${a.map(fl).join(', ')})`;

const SCENES = {
  // wing: NACA section, chord c, angle of attack alpha (deg, nose up), span: 0 = wall to wall (2D), else finite
  wing(N, { code = '0012', alpha = 6, span = 0, chord = 0.16, xle = 0.3 } = {}) {
    const c = Math.round(chord * N[0]), xLE = xle * N[0], zc = N[2] / 2 - 0.5, yc = N[1] / 2 - 0.5, a = alpha * Math.PI / 180;
    const piv = [xLE + 0.25 * c, zc];
    const sp = span > 0 ? span * N[1] : 0;
    const ext = sp > 0
      ? `vec2 w = vec2(d2, abs(p.y - ${fl(yc)}) - ${fl(sp / 2)}); return min(max(w.x, w.y), 0.) + length(max(w, 0.));`
      : `return d2;`;
    return {
      kind: 'wing', chord: c, SP: [Math.cos(a), Math.sin(a), 0, 0], span: sp || N[1], refArea: c * (sp || N[1]), refLen: c,
      lib: glslPoly('AF', nacaPoints(code)),
      sdf: `vec2 q = vec2(p.x - ${fl(piv[0])}, p.z - ${fl(piv[1])});
  float ca = SP.x, sa = SP.y; // cos and sin of the angle of attack (uniforms, so the angle can change without recompiling)
  q = vec2(ca * q.x - sa * q.y, sa * q.x + ca * q.y) / ${fl(c)} + vec2(0.25, 0.);
  float d2 = AF_sd(q) * ${fl(c)};
  ${ext}`,
      bbox: [[xLE - 0.1 * c, sp ? yc - sp / 2 - 2 : -1, zc - 0.65 * c], [xLE + 1.1 * c, sp ? yc + sp / 2 + 2 : N[1], zc + 0.65 * c]],
      inflow: 'return vec3(1., 0., 0.);', bcY: sp ? 1 : 0, bcZ: 1,
    };
  },
  cylinder(N, { d = 0.07 } = {}) {
    const D = Math.round(d * N[0]), xc = 0.25 * N[0], zc = N[2] / 2 - 0.5 + 0.3;
    return { kind: 'cylinder', refArea: D * N[1], refLen: D,
      sdf: `return length(p.xz - vec2(${fl(xc)}, ${fl(zc)})) - ${fl(D / 2)};`,
      bbox: [[xc - D / 2 - 2, -1, zc - D / 2 - 2], [xc + D / 2 + 2, N[1], zc + D / 2 + 2]],
      inflow: 'return vec3(1., 0., 0.);', bcY: 0, bcZ: 1 };
  },
  sphere(N, { d = 0.1 } = {}) {
    const D = Math.round(d * N[0]), c = [0.25 * N[0], N[1] / 2 - 0.5 + 0.3, N[2] / 2 - 0.5 + 0.2];
    return { kind: 'sphere', refArea: Math.PI * D * D / 4, refLen: D,
      sdf: `return length(p - ${v3(c)}) - ${fl(D / 2)};`,
      bbox: [c.map(v => v - D / 2 - 2), c.map(v => v + D / 2 + 2)],
      inflow: 'return vec3(1., 0., 0.);', bcY: 1, bcZ: 1 };
  },
  // car on a rolling road: a fastback saloon from a lofted, rounded body, glasshouse and four wheels
  car(N, { wheels = true } = {}) {
    const L = 0.3 * N[0], x0 = 0.24 * N[0], yc = N[1] / 2 - 0.5, W = 0.4 * L, Rw = 0.075 * L, gz = -0.5;
    const zb = gz + 0.06 * L, Hb = 0.16 * L, s = v => fl(v);
    return {
      kind: 'car', refArea: 0.84 * W * (zb + Hb + 0.11 * L - gz), refLen: L, ground: true,
      sdf: `vec3 q = p - vec3(${s(x0 + L / 2)}, ${s(yc)}, 0.);
  q.x = -q.x; // modelled nose toward +x; the air arrives from -x, so face the nose upstream
  float u = clamp(q.x / ${s(L / 2)}, -1., 1.);
  // body: rounded box whose top dips toward the nose and tail (bonnet and boot), plan view tapered at both ends
  float top = ${s(zb + Hb)} - ${s(0.06 * L)} * smoothstep(0.35, 1., u) - ${s(0.03 * L)} * smoothstep(-0.55, -1., u);
  float hw = ${s(W / 2)} * (1. - 0.12 * u * u * u * u);
  vec3 bq = vec3(q.x, q.y, q.z - 0.5 * (top + ${s(zb)}));
  float body = sdRoundBox(bq, vec3(${s(L / 2)}, hw, 0.5 * (top - ${s(zb)})), ${s(0.05 * L)});
  // glasshouse: raked windscreen, long sloping fastback
  float cab = sdRoundBox(q - vec3(${s(-0.06 * L)}, 0., ${s(zb + Hb + 0.03 * L)}), vec3(${s(0.3 * L)}, ${s(0.4 * W)}, ${s(0.085 * L)}), ${s(0.05 * L)});
  cab = smax(cab, dot(q - vec3(${s(0.14 * L)}, 0., ${s(zb + Hb)}), normalize(vec3(1., 0., 1.6))), ${s(0.06 * L)});
  cab = smax(cab, dot(q - vec3(${s(-0.2 * L)}, 0., ${s(zb + Hb + 0.07 * L)}), normalize(vec3(-0.42, 0., 1.))), ${s(0.08 * L)});
  float d = smin(body, cab, ${s(0.05 * L)});
  vec3 w = vec3(abs(q.x - ${s(-0.01 * L)}) - ${s(0.3 * L)}, abs(q.y) - ${s(0.5 * W - 0.06 * L)}, q.z - ${s(gz + Rw - 0.6)});
  ${wheels ? '' : '//'}d = min(d, sdCylY(w, ${s(Rw)}, ${s(0.05 * L)}) - 0.6);
  return d;`,
      bbox: [[x0 - 3, yc - W / 2 - 4, -0.5], [x0 + L + 3, yc + W / 2 + 4, zb + Hb + 0.16 * L + 3]],
      inflow: 'return vec3(1., 0., 0.);', bcY: 1, bcZ: 1, floor: 'road',
      // wheels roll on the moving road: surface velocity = omega x r, with the contact patch moving at the road speed
      solidVel: `vec3 q = p - vec3(${s(x0 + L / 2)}, ${s(yc)}, 0.); q.x = -q.x;
  vec3 r = vec3(abs(q.x - ${s(-0.01 * L)}) - ${s(0.3 * L)}, abs(q.y) - ${s(0.5 * W - 0.06 * L)}, q.z - ${s(gz + Rw - 0.6)});
  if (length(r.xz) < ${s(Rw + 1.5)} && abs(r.y) < ${s(0.05 * L + 1.5)}) { r.x = (p.x - ${s(x0 + L / 2)}) - sign(p.x - ${s(x0 + L / 2)}) * ${s(0.3 * L)} + (p.x > ${s(x0 + L / 2)} ? 1. : -1.) * ${s(-0.01 * L)};
    float w = -1. / ${s(Rw + 0.6)}; return vec3(w * r.z, 0., -w * r.x); }
  return vec3(0.);`,
    };
  },
  // road cyclist: bike from tori and capsules, rider from capsules; posture 0 = upright, 1 = tucked
  cyclist(N, { posture = 0 } = {}) {
    const m = 0.36 * N[0] / 1.75, x0 = 0.3 * N[0], yc = N[1] / 2 - 0.5, gz = -0.5; // m = cells per metre
    const P = (x, y, z) => v3([x0 + x * m, yc + y * m, gz + z * m]), R = r => fl(r * m);
    const tk = posture ? 1 : 0;
    // key points (metres): rear axle at x=0, front axle at x=1.0, wheels radius 0.34
    const hip = [0.28, 0, 0.98], sh = tk ? [0.82, 0, 1.12] : [0.70, 0, 1.38], head = tk ? [0.98, 0, 1.2] : [0.82, 0, 1.55];
    const hand = tk ? [0.98, 0, 0.98] : [0.95, 0, 1.02], elb = tk ? [0.86, 0, 0.98] : [0.86, 0, 1.18];
    const knee1 = [0.62, 0.11, 0.86], foot1 = [0.55, 0.12, 0.42], knee2 = [0.48, -0.11, 0.62], foot2 = [0.4, -0.12, 0.2];
    const c = (a, b, r) => `d = min(d, sdCapsule(p, ${P(...a)}, ${P(...b)}, ${R(r)}));`;
    const arm = s => [c([sh[0], s * 0.17, sh[2]], [elb[0], s * 0.2, elb[2]], 0.045), c([elb[0], s * 0.2, elb[2]], [hand[0], s * 0.2, hand[2]], 0.04)].join('\n  ');
    return {
      kind: 'cyclist', refArea: (tk ? 0.30 : 0.42) * m * m, refLen: 1.75 * m, ground: true, mPerCell: 1 / m,
      sdf: `float d = 1e9;
  d = min(d, sdTorusY(p - ${P(0, 0, 0.34)}, ${R(0.33)}, ${R(0.02)}));
  d = min(d, sdTorusY(p - ${P(1.0, 0, 0.34)}, ${R(0.33)}, ${R(0.02)}));
  ${c([0, 0, 0.34], [0.38, 0, 0.32], 0.018)} ${c([0.38, 0, 0.32], [0.28, 0, 0.9], 0.02)} ${c([0.28, 0, 0.9], [0.84, 0, 0.92], 0.02)}
  ${c([0.38, 0, 0.32], [0.82, 0, 0.88], 0.022)} ${c([0.84, 0, 0.92], [1.0, 0, 0.34], 0.02)} ${c([0, 0, 0.34], [0.28, 0, 0.9], 0.015)}
  ${c([0.86, -0.21, 0.98], [0.86, 0.21, 0.98], 0.016)}
  d = min(d, sdEllipsoid(p - ${P(0.27, 0, 0.93)}, vec3(${R(0.13)}, ${R(0.07)}, ${R(0.03)})));
  // rider
  ${c(hip, sh, 0.14)}
  d = min(d, sdEllipsoid(p - ${P(...head)}, vec3(${R(0.13)}, ${R(0.1)}, ${R(0.12)})));
  ${arm(1)}
  ${arm(-1)}
  ${c([hip[0], 0.1, hip[2]], knee1, 0.075)} ${c(knee1, foot1, 0.055)}
  ${c([hip[0], -0.1, hip[2]], knee2, 0.075)} ${c(knee2, foot2, 0.055)}
  return d;`,
      bbox: [[x0 - 0.4 * m, yc - 0.35 * m, -0.5], [x0 + 1.4 * m, yc + 0.35 * m, gz + 1.75 * m]],
      inflow: 'return vec3(1., 0., 0.);', bcY: 1, bcZ: 1, floor: 'road',
    };
  },
  // a tower and a low neighbour in the atmospheric boundary layer (wind grows with height, 1/7 power law)
  tower(N, {} = {}) {
    const H = 0.62 * N[2], B = 0.075 * N[0], x0 = 0.3 * N[0], yc = N[1] / 2 - 0.5;
    return {
      kind: 'tower', refArea: B * H + 1.8 * B * 0.36 * N[2], refLen: B, ground: true,
      sdf: `float d = sdRoundBox(p - vec3(${fl(x0)}, ${fl(yc)}, ${fl(H / 2 - 0.5)}), vec3(${fl(B / 2)}, ${fl(B / 2)}, ${fl(H / 2)}), 0.6);
  d = min(d, sdRoundBox(p - vec3(${fl(x0 + 2.4 * B)}, ${fl(yc - 1.3 * B)}, ${fl(0.18 * N[2] - 0.5)}), vec3(${fl(0.8 * B)}, ${fl(0.9 * B)}, ${fl(0.18 * N[2])}), 0.6));
  return d;`,
      bbox: [[x0 - B / 2 - 3, yc - 2.4 * B, -0.5], [x0 + 3.4 * B, yc + B / 2 + 3, H + 2]],
      inflow: `float z = max(float(p.z) + 0.5, 0.5) / float(N.z); return vec3(1.1 * pow(z, 0.143), 0., 0.);`,
      bcY: 1, bcZ: 1, floor: 'ground', wall: {},
    };
  },
  // artery with a smooth (cosine) stenosis; severity = fraction of the lumen AREA blocked
  artery(N, { severity = 0.75, ecc = 0.05 } = {}) {
    const R0 = 0.44 * N[1], yc = N[1] / 2 - 0.5, zc = N[2] / 2 - 0.5, xs = 0.22 * N[0], Ls = 2 * R0;
    const dlt = 1 - Math.sqrt(1 - severity);
    return {
      kind: 'artery', R0, refArea: Math.PI * R0 * R0, refLen: 2 * R0, internal: true, xs, severity,
      sdf: `float t = clamp((p.x - ${fl(xs)}) / ${fl(Ls)}, -1., 1.);
  float R = ${fl(R0)} * (1. - ${fl(dlt)} * 0.5 * (1. + cos(3.14159265 * t)));
  vec2 c = vec2(${fl(yc)}, ${fl(zc)}) + vec2(0., ${fl(ecc * R0)} * 0.5 * (1. + cos(3.14159265 * t)));
  return R - length(p.yz - c);`,
      bbox: [[-0.5, -0.5, -0.5], [N[0] - 0.5, N[1] - 0.5, N[2] - 0.5]],
      inflow: `vec2 d = vec2(float(p.y) - ${fl(yc)}, float(p.z) - ${fl(zc)}); float r2 = dot(d, d) / ${fl(R0 * R0)};
  return vec3(max(2. * (1. - r2), 0.), 0., 0.);`,
      bcY: 2, bcZ: 2,
    };
  },
};

if (typeof module !== 'undefined') module.exports = { SCENES, GLSL_SDF_LIB, nacaPoints, glslPoly };

// Powers of Ten: a person standing on Hallgrímstorg, as a signed distance function. The same geometry feeds the
// Wind Tunnel's lattice-Boltzmann solver (today's wind around the body) and the page's ray-marcher, down to the
// nail fold of the right index finger where the zoom goes under the skin.
// Person frame: x forward (the way they face), y to their left, z up, metres, origin on the ground between the feet.
// Body proportions are adult averages (stature 1.75 m); the hand follows anthropometric hand data (refs_inner.md).
// Runs in node and the browser.
(function (root) {
  const add = (a, b) => a.map((x, i) => x + b[i]), sub = (a, b) => a.map((x, i) => x - b[i]), mul = (a, s) => a.map(x => x * s);
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = v => mul(v, 1 / Math.hypot(...v));
  // rotate v about unit axis k by angle a (Rodrigues)
  const rot = (v, k, a) => { const c = Math.cos(a), s = Math.sin(a); return add(add(mul(v, c), mul(cross(k, v), s)), mul(k, dot(k, v) * (1 - c))); };

  // ---- body (metres) ----
  const B = {
    head: [0.005, 0, 1.635], headR: [0.0975, 0.078, 0.115],
    neck: [[0, 0, 1.44], [0.005, 0, 1.56], 0.056],
    chest: [[0, 0, 1.27], [0.115, 0.178, 0.172]], waist: [[0, 0, 1.08], [0.11, 0.16, 0.16]], pelvis: [[-0.005, 0, 0.93], [0.115, 0.175, 0.12]],
    shoulder: 0.195, shoulderZ: 1.435,
  };
  // arms hang with a slight forward swing; the right wrist is where the hand frame starts
  const arm = s => ({ sh: [0, s * B.shoulder, B.shoulderZ], el: [0.025, s * 0.225, 1.135], wr: [0.07, s * 0.232, 0.872] });
  const legs = s => ({ hip: [0, s * 0.092, 0.9], kn: [0.012, s * 0.1, 0.49], an: [-0.005, s * 0.105, 0.085] });

  // ---- the right hand ----
  // hand axes at the wrist: u along the hand toward the fingers, v toward the thumb (radial), w out of the back of the hand
  const AR = arm(-1);
  const u0 = norm(sub(AR.wr, AR.el));                         // continue the forearm
  const v0 = norm(sub([1, 0, 0], mul(u0, dot([1, 0, 0], u0)))); // thumb forward (neutral hanging hand)
  const w0 = cross(u0, v0);                                    // = back of the hand (points outward, -y)
  const at = (u, v, w) => add(AR.wr, add(add(mul(u0, u), mul(v0, v)), mul(w0, w)));
  // finger rays: MCP joint (u, v), segment lengths (m), radii at the joints, flexion (rad) at MCP, PIP, DIP
  const FING = {
    index: { mcp: [0.094, 0.026], len: [0.041, 0.025, 0.0195], r: [0.0098, 0.0088, 0.0080, 0.0070], flex: [0.22, 0.38, 0.16], spread: 0.06 },
    middle: { mcp: [0.098, 0.006], len: [0.045, 0.028, 0.0205], r: [0.0100, 0.0090, 0.0081, 0.0071], flex: [0.24, 0.42, 0.18], spread: 0.0 },
    ring: { mcp: [0.094, -0.0135], len: [0.042, 0.027, 0.0200], r: [0.0094, 0.0084, 0.0076, 0.0067], flex: [0.27, 0.45, 0.2], spread: -0.05 },
    little: { mcp: [0.084, -0.031], len: [0.033, 0.0205, 0.0185], r: [0.0082, 0.0072, 0.0065, 0.0058], flex: [0.32, 0.5, 0.22], spread: -0.13 },
  };
  // each finger: joints J0..J3 and the local axes of every segment (a = along, d = dorsal)
  const fingers = {};
  for (const [name, f] of Object.entries(FING)) {
    let p = at(f.mcp[0], f.mcp[1], 0.004), a = norm(add(u0, mul(v0, Math.tan(f.spread)))), d = w0;
    const side = norm(cross(d, a));                            // flexion axis (radial-ulnar)
    const J = [p], A = [], Dd = [];
    for (let k = 0; k < 3; k++) {
      a = rot(a, side, f.flex[k]); d = rot(d, side, f.flex[k]);   // curl toward the palm (-w)
      A.push(a); Dd.push(d); p = add(p, mul(a, f.len[k])); J.push(p);
    }
    fingers[name] = { J, A, D: Dd, r: f.r, side };
  }
  // thumb: from the base of the palm, pointing forward and down, alongside the index finger
  const thumb = (() => {
    const base = at(0.03, 0.03, -0.006), a1 = norm(add(add(mul(u0, 0.72), mul(v0, 0.62)), mul(w0, -0.3)));
    const j1 = add(base, mul(a1, 0.045)), a2 = norm(add(a1, mul(u0, 0.45))), j2 = add(j1, mul(a2, 0.032)), a3 = norm(add(a2, mul(u0, 0.25))), j3 = add(j2, mul(a3, 0.028));
    return { J: [base, j1, j2, j3], r: [0.0145, 0.0112, 0.0098, 0.0084] };
  })();

  // ---- the index fingernail and its nail fold ----
  // distal phalanx of the index finger: from the DIP joint J[2] to the tip J[3]; nail plate on the dorsal side,
  // 10.5 mm wide, its proximal edge (under the cuticle) 6.5 mm from the DIP crease
  const IX = fingers.index, dA = IX.A[2], dD = IX.D[2], dS = norm(cross(dA, dD));
  const NAIL = { s0: 0.0065, s1: 0.0195 + 0.0012, halfW: 0.00525, thick: 0.00052 };
  // the nail fold point: on the dorsal skin, 1.2 mm proximal of the cuticle; its frame: x toward the fingertip,
  // y across the finger (toward the thumb side), z out of the skin
  const rDip = IX.r[2], rTip = IX.r[3];
  const sF = NAIL.s0 - 0.0012, rF = rDip + (rTip - rDip) * (sF / 0.0195);
  const nailfold = { p: add(add(IX.J[2], mul(dA, sF)), mul(dD, rF * 0.86 + 0.00025)), x: dA, y: mul(dS, -1), z: dD };

  // ---- GLSL ----
  const f = x => (Math.abs(x) < 1e-12 ? '0.0' : x.toPrecision(9).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '.0'));
  const v3 = v => `vec3(${v.map(f).join(', ')})`;
  const LIB = `
  float pp_smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
  float pp_ell(vec3 p, vec3 r) { float k0 = length(p / r), k1 = length(p / (r * r)); return k0 * (k0 - 1.0) / max(k1, 1e-9); }
  float pp_cone(vec3 p, vec3 a, vec3 b, float r1, float r2) {           // round cone (tapered capsule)
    vec3 ba = b - a; float l2 = dot(ba, ba), rr = r1 - r2, a2 = l2 - rr * rr, il2 = 1.0 / l2;
    vec3 pa = p - a; float y = dot(pa, ba), z = y - l2; vec3 xv = pa * l2 - ba * y; float x2 = dot(xv, xv), y2 = y * y * l2, z2 = z * z * l2;
    float k = sign(rr) * rr * rr * x2;
    if (sign(z) * a2 * z2 > k) return sqrt(x2 + z2) * il2 - r2;
    if (sign(y) * a2 * y2 < k) return sqrt(x2 + y2) * il2 - r1;
    return (sqrt(x2 * a2 * il2) + y * rr) * il2 - r1;
  }
  float pp_rbox(vec3 p, vec3 b, float r) { vec3 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r; }`;
  function glsl() {
    const s = [];
    // body: clothes are part of the shape (an October jacket and trousers)
    s.push(`float d = pp_ell(p - ${v3(B.head)}, ${v3(B.headR)});`);
    s.push(`float neck = pp_cone(p, ${v3(B.neck[0])}, ${v3(B.neck[1])}, ${f(B.neck[2])}, ${f(B.neck[2] * 0.9)}); d = pp_smin(d, neck, 0.02);`);
    s.push(`float torso = pp_smin(pp_smin(pp_ell(p - ${v3(B.chest[0])}, ${v3(B.chest[1])}), pp_ell(p - ${v3(B.waist[0])}, ${v3(B.waist[1])}), 0.08), pp_ell(p - ${v3(B.pelvis[0])}, ${v3(B.pelvis[1])}), 0.07);`);
    for (const sd of [-1, 1]) {
      const A = arm(sd), Lg = legs(sd);
      s.push(`torso = pp_smin(torso, pp_ell(p - ${v3([0, sd * 0.155, 1.405])}, vec3(0.065, 0.075, 0.05)), 0.06);`);
      s.push(`float arm${sd > 0 ? 'L' : 'R'} = min(pp_cone(p, ${v3(A.sh)}, ${v3(A.el)}, 0.054, 0.044), pp_cone(p, ${v3(A.el)}, ${v3(A.wr)}, 0.043, 0.031));`);
      s.push(`float leg${sd > 0 ? 'L' : 'R'} = min(pp_cone(p, ${v3(Lg.hip)}, ${v3(Lg.kn)}, 0.085, 0.056), pp_cone(p, ${v3(Lg.kn)}, ${v3(Lg.an)}, 0.054, 0.04));`);
      s.push(`float foot${sd > 0 ? 'L' : 'R'} = pp_rbox(p - ${v3([0.065, sd * 0.11, 0.045])}, vec3(0.13, 0.048, 0.045), 0.035);`);
    }
    s.push(`torso = pp_smin(torso, min(armL, armR), 0.03); torso = pp_smin(torso, min(legL, legR), 0.04);`);
    s.push(`d = pp_smin(d, torso, 0.03); d = min(d, min(footL, footR));`);
    return s.join('\n  ');
  }
  // the right hand, in metres, separate so the renderer can give it skin and the nail its own material
  function glslHand(detail) {
    const s = [], pal = at(0.052, 0.0, 0.0);
    // palm: a rounded box in the hand axes, slightly cupped
    s.push(`vec3 hq = p - ${v3(pal)}; hq = vec3(dot(hq, ${v3(u0)}), dot(hq, ${v3(v0)}), dot(hq, ${v3(w0)}));`);
    s.push(`float hand = pp_rbox(hq, vec3(0.047, 0.037, 0.0115), 0.0105);`);
    s.push(`hand = pp_smin(hand, pp_cone(p, ${v3(AR.wr)}, ${v3(at(0.02, 0, 0))}, 0.031, 0.029), 0.012);`);
    for (const [name, F] of Object.entries(fingers)) {
      const J = F.J, r = F.r;
      s.push(`hand = pp_smin(hand, min(min(pp_cone(p, ${v3(J[0])}, ${v3(J[1])}, ${f(r[0])}, ${f(r[1])}), pp_cone(p, ${v3(J[1])}, ${v3(J[2])}, ${f(r[1])}, ${f(r[2])})), ${name === 'index' ? 'fingerTip' : `pp_cone(p, ${v3(J[2])}, ${v3(J[3])}, ${f(r[2])}, ${f(r[3])})`}), ${name === 'index' ? '0.004' : '0.006'});`);
    }
    const T = thumb;
    s.push(`hand = pp_smin(hand, min(min(pp_cone(p, ${v3(T.J[0])}, ${v3(T.J[1])}, ${f(T.r[0])}, ${f(T.r[1])}), pp_cone(p, ${v3(T.J[1])}, ${v3(T.J[2])}, ${f(T.r[1])}, ${f(T.r[2])})), pp_cone(p, ${v3(T.J[2])}, ${v3(T.J[3])}, ${f(T.r[2])}, ${f(T.r[3])})), 0.012);`);
    const pre = tipPre(p => p, m => m);
    return { pre, body: s.join('\n  ') };
  }
  // the index fingertip, flattened dorso-ventrally, with the nail plate and the fold of skin over its root.
  // T maps person-frame points into the frame the shader works in, Rm maps directions.
  function tipPre(T, Rm) {
    const pre = [];
    pre.push(`vec3 fq = p - ${v3(T(IX.J[2]))}; vec3 fl = vec3(dot(fq, ${v3(Rm(dA))}), dot(fq, ${v3(Rm(dS))}), dot(fq, ${v3(Rm(dD))}));`);
    pre.push(`vec3 fl2 = vec3(fl.x, fl.y, fl.z * 1.16);`);
    pre.push(`float fingerTip = pp_cone(fl2, vec3(0.0), vec3(${f(0.0195)}, 0.0, -0.0006), ${f(IX.r[2])}, ${f(IX.r[3])}) / 1.08;`);
    // nail plate: a 0.52 mm shell lying on the dorsal surface between s0 and the free edge, 10.5 mm wide
    pre.push(`float nshell = abs(fingerTip + 0.00012) - ${f(NAIL.thick / 2)};`);
    // outline: the cuticle is an arc bowed toward the knuckle, the sides tuck into the lateral folds, the free edge is rounded
    const hy = NAIL.halfW, xm = 0.0165;
    pre.push(`float ny4 = pow(abs(fl.y) / ${f(hy)}, 4.0), nx4 = pow(max(fl.x - ${f(xm)}, 0.0) / ${f(NAIL.s1 - xm)}, 4.0);`);
    pre.push(`float nprox = (${f(NAIL.s0)} - 0.0011 * (1.0 - min(ny4, 1.0))) - fl.x;`);
    pre.push(`float nbox = max(max(nprox, (pow(ny4 + nx4, 0.25) - 1.0) * ${f(hy)}), 0.002 - fl.z);`);
    pre.push(`float nail = max(nshell, nbox);`);
    pre.push(`float nailU = clamp((fl.x - ${f(NAIL.s0)}) / ${f(NAIL.s1 - NAIL.s0)}, 0.0, 0.99);`);
    // proximal nail fold: a soft ridge of skin covering the nail root, ending at the cuticle; lateral folds along the sides
    pre.push(`float fold = exp(-pow((fl.x - ${f(NAIL.s0 + 0.0004)} + 0.0011 * (1.0 - min(ny4, 1.0))) / 0.0013, 2.0)) * smoothstep(0.0, 0.004, fl.z) * smoothstep(${f(hy + 0.002)}, ${f(hy - 0.001)}, abs(fl.y));`);
    pre.push(`fold += 0.7 * exp(-pow((abs(fl.y) - ${f(hy + 0.0003)}) / 0.001, 2.0)) * smoothstep(${f(NAIL.s0 - 0.001)}, ${f(NAIL.s0 + 0.002)}, fl.x) * smoothstep(0.019, 0.016, fl.x) * smoothstep(0.0, 0.004, fl.z);`);
    pre.push(`fingerTip -= 0.00045 * fold;`);
    return pre.join('\n  ');
  }
  // the fingertip alone, in another frame (the nail fold's), for millimetre views: returns (distance, material)
  function glslFingertip(T, Rm) {
    const J = IX.J, r = IX.r;
    return `${LIB}
  vec2 pp_tip(vec3 p) {
  ${tipPre(T, Rm)}
    float skin = pp_smin(pp_cone(p, ${v3(T(J[1]))}, ${v3(T(J[2]))}, ${f(r[1])}, ${f(r[2])}), fingerTip, 0.004);
    float d = min(skin, nail);
    return vec2(d, nail <= d + 1e-9 ? 5.0 + nailU : 0.0);
  }`;
  }
  // full scene SDF in person-frame metres: returns distance; material via pp_mat
  function glslScene() {
    const H = glslHand();
    return `${LIB}
  float pp_body(vec3 p) { ${glsl()}
    return d; }
  vec2 pp_handNail(vec3 p) {
  ${H.pre}
  ${H.body}
    return vec2(hand, nail); }
  // x: distance, y: material (0 skin, 1 jacket, 2 trousers, 3 shoes, 4 hair, 5 nail)
  vec2 pp_scene(vec3 p) {
    float body = pp_body(p);
    vec2 hn = vec2(1.0);
    if (length(p - ${v3(at(0.07, 0.0, 0.0))}) < 0.16) hn = pp_handNail(p);
    float d = min(pp_smin(body, hn.x, 0.008), hn.y);
    float m = 1.0;
    if (hn.y <= d + 1e-7) m = 5.0;
    else if (hn.x < body + 0.004 || p.z > 1.5) m = 0.0;
    else if (p.z < 0.095 && length(p.xy - vec2(0.065, sign(p.y) * 0.11)) < 0.2) m = 3.0;
    else if (p.z < 0.9) m = 2.0;
    if (p.z > 1.66 && p.x < 0.07) m = 4.0;
    // the face and neck are skin; the jacket ends at the wrists
    if (p.z > 1.53 && m != 4.0) m = 0.0;
    return vec2(d, m);
  }`;
  }
  // LBM wrapper: lattice coordinates -> person metres (cells per metre cpm, person origin o in lattice units)
  function glslLBM(cpm, o) {
    return { lib: `${LIB}\n float pp_body(vec3 p) { ${glsl()}\n return d; }`,
      sdf: `vec3 q = (vec3(p) - ${v3(o)}) / ${f(cpm)}; return pp_body(q) * ${f(cpm)};` };
  }

  const api = { B, arm, legs, fingers, thumb, NAIL, nailfold, hand: { wr: AR.wr, u: u0, v: v0, w: w0, centre: at(0.075, 0.005, 0) }, glslScene, glslLBM, glslFingertip, LIB };
  root.PTEN_PERSON = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

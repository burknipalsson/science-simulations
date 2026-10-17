// Red-cell membrane mechanics (CPU reference). Units are free; the tests use µm and pN.
//  shear + local area: Skalak law per triangle, w = Gs/4 (I1² + 2 I1 − 2 I2 + C I2²), Gs the small-strain shear modulus
//     (area modulus K = Gs (1 + 2C); Krüger's ks/12 form has ks = 3 Gs)
//     with I1 = λ1² + λ2² − 2, I2 = λ1²λ2² − 1 from the triangle metric (basis-free: I1 + 2 = tr(G⁻¹g), I2 + 1 = det g / det G)
//  bending: E = kb Σ_edges (1 − cos(θ − θ0)), θ the signed dihedral angle, kb = 2κ/√3 (Gompper & Kroll)
//  global area and volume: E = kA (A − A0)² / (2 A0) and kV (V − V0)² / (2 V0)
// The reference (stress-free) state is the resting biconcave shape for shear and bending.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const len = a => Math.sqrt(dot(a, a));

// signed dihedral at edge a->b with wings w1 (left, face a,b,w1) and w2: 0 when flat, > 0 when convex (outward fold)
function dihedral(X, e) {
  const xa = X[e.a], xb = X[e.b], E = sub(xb, xa);
  const n1 = cross(sub(xb, xa), sub(X[e.w1], xa)); // normal of face (a, b, w1)
  const n2 = cross(sub(X[e.w2], xa), sub(xb, xa)); // normal of face (b, a, w2), same orientation
  const c = dot(n1, n2), s = dot(cross(n1, n2), E) / len(E);
  return Math.atan2(s, c);
}

function triArea(X, t) { return 0.5 * len(cross(sub(X[t[1]], X[t[0]]), sub(X[t[2]], X[t[0]]))); }
function totals(X, F) {
  let A = 0, V = 0;
  for (const t of F) { A += triArea(X, t); V += dot(X[t[0]], cross(X[t[1]], X[t[2]])) / 6; }
  return { A, V };
}

function makeRef(cell) {
  const { X, F, E } = cell;
  const tri = F.map(t => {
    const e1 = sub(X[t[1]], X[t[0]]), e2 = sub(X[t[2]], X[t[0]]);
    const g11 = dot(e1, e1), g12 = dot(e1, e2), g22 = dot(e2, e2), d = g11 * g22 - g12 * g12;
    return { A0: 0.5 * Math.sqrt(d), M11: g22 / d, M12: -g12 / d, M22: g11 / d, detG: d };
  });
  const th0 = E.map(e => dihedral(X, e));
  return { tri, th0, ...totals(X, F) };
}

// forces (and energy) on all vertices; P = { Gs, C, kb, kA, kV }
function forces(X, cell, ref, P, out) {
  const { F, E } = cell, n = X.length;
  const f = out || Array.from({ length: n }, () => [0, 0, 0]);
  for (const v of f) v[0] = v[1] = v[2] = 0;
  let W = 0;
  const add = (i, v, s) => { f[i][0] += s * v[0]; f[i][1] += s * v[1]; f[i][2] += s * v[2]; };
  // Skalak
  for (let k = 0; k < F.length; k++) {
    const t = F[k], r = ref.tri[k];
    const e1 = sub(X[t[1]], X[t[0]]), e2 = sub(X[t[2]], X[t[0]]);
    const g11 = dot(e1, e1), g12 = dot(e1, e2), g22 = dot(e2, e2);
    const I1 = r.M11 * g11 + 2 * r.M12 * g12 + r.M22 * g22 - 2, I2 = (g11 * g22 - g12 * g12) / r.detG - 1;
    W += r.A0 * P.Gs / 4 * (I1 * I1 + 2 * I1 - 2 * I2 + P.C * I2 * I2);
    const w1 = r.A0 * P.Gs / 2 * (I1 + 1), w2 = r.A0 * P.Gs / 2 * (P.C * I2 - 1) / r.detG;
    // dW/de1, dW/de2
    const d1 = [0, 1, 2].map(i => w1 * 2 * (r.M11 * e1[i] + r.M12 * e2[i]) + w2 * 2 * (g22 * e1[i] - g12 * e2[i]));
    const d2 = [0, 1, 2].map(i => w1 * 2 * (r.M12 * e1[i] + r.M22 * e2[i]) + w2 * 2 * (g11 * e2[i] - g12 * e1[i]));
    add(t[1], d1, -1); add(t[2], d2, -1); add(t[0], d1, 1); add(t[0], d2, 1);
  }
  // bending: gradient of the signed dihedral (Bridson et al. 2003)
  for (let k = 0; k < E.length; k++) {
    const e = E[k], th = dihedral(X, e), dth = th - ref.th0[k];
    W += P.kb * (1 - Math.cos(dth));
    const s = P.kb * Math.sin(dth); // dE/dθ
    const xa = X[e.a], xb = X[e.b], Ev = sub(xb, xa), el = len(Ev);
    const n1 = cross(sub(xb, xa), sub(X[e.w1], xa)), n2 = cross(sub(X[e.w2], xa), sub(xb, xa));
    const q1 = dot(n1, n1), q2 = dot(n2, n2);
    // dθ/dx for wings and edge ends (signs fixed by the finite-difference test)
    const gw1 = scl(n1, -el / q1), gw2 = scl(n2, -el / q2);
    const ga = [0, 1, 2].map(i => -(dot(sub(X[e.w1], xb), Ev) / el * n1[i] / q1 + dot(sub(X[e.w2], xb), Ev) / el * n2[i] / q2));
    const gb = [0, 1, 2].map(i => (dot(sub(X[e.w1], xa), Ev) / el * n1[i] / q1 + dot(sub(X[e.w2], xa), Ev) / el * n2[i] / q2));
    add(e.w1, gw1, -s); add(e.w2, gw2, -s); add(e.a, ga, -s); add(e.b, gb, -s);
  }
  // global area and volume
  const T = totals(X, F), cA = P.kA ? P.kA * (T.A - ref.A) / ref.A : 0, cV = P.kV ? P.kV * (T.V - ref.V) / ref.V : 0;
  W += (P.kA ? P.kA * (T.A - ref.A) ** 2 / (2 * ref.A) : 0) + (P.kV ? P.kV * (T.V - ref.V) ** 2 / (2 * ref.V) : 0);
  for (const t of F) {
    const [x0, x1, x2] = t.map(i => X[i]), N = cross(sub(x1, x0), sub(x2, x0)), nl = len(N);
    for (let j = 0; j < 3; j++) {
      const a = X[t[(j + 1) % 3]], b = X[t[(j + 2) % 3]];
      // dA/dx_j = ½ N̂ × (b − a); dV/dx_j = (a × b)/6
      const dA = scl(cross(N, sub(b, a)), 0.5 / nl), dV = scl(cross(a, b), 1 / 6);
      add(t[j], dA, -cA); add(t[j], dV, -cV);
    }
  }
  return { f, W, A: T.A, V: T.V };
}

if (typeof module !== 'undefined') module.exports = { forces, makeRef, totals, dihedral, sub, dot, cross, len };

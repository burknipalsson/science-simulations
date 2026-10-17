// Triangulated red-cell membrane: an icosphere mapped onto the Evans-Fung biconcave disc,
// plus the topology tables the force kernels need (triangles, edges with their two wing vertices,
// and per-vertex rings so a GPU fragment can gather everything acting on one vertex).

// Evans & Fung (1972) mean resting shape, lengths in µm: z(r) = ±½ R0 √(1−ρ²) (C0 + C2 ρ² + C4 ρ⁴), ρ = r/R0
const EF = { R0: 3.91, C0: 0.81, C2: 7.83, C4: -4.39 };

// icosphere(level).parents[i] = [a, b] for every vertex added by the last subdivision (midpoint of a and b of the level below)
function icosphere(level) {
  const t = (1 + Math.sqrt(5)) / 2;
  let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]];
  let F = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const norm = v => { const l = Math.hypot(...v); return v.map(x => x / l); };
  V = V.map(norm);
  let parents = [];
  for (let l = 0; l < level; l++) {
    const mid = new Map(), F2 = []; parents = [];
    const m = (a, b) => {
      const k = a < b ? a * 1e6 + b : b * 1e6 + a;
      if (!mid.has(k)) { mid.set(k, V.length); parents.push([a, b]); V.push(norm([0, 1, 2].map(i => (V[a][i] + V[b][i]) / 2))); }
      return mid.get(k);
    };
    for (const [a, b, c] of F) { const ab = m(a, b), bc = m(b, c), ca = m(c, a); F2.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    F = F2;
  }
  return { V, F, parents };
}

// map a unit sphere onto the biconcave disc (disc plane = xy, axis = z); optional scale for the size
function biconcave(V, s = 1) {
  const { R0, C0, C2, C4 } = EF;
  return V.map(([x, y, z]) => {
    const r2 = x * x + y * y;
    return [s * R0 * x, s * R0 * y, s * 0.5 * R0 * z * (C0 + C2 * r2 + C4 * r2 * r2) / R0];
  });
}

// topology: edges (with wings), vertex rings
function topology(F, nv) {
  const emap = new Map(), E = [];
  for (let f = 0; f < F.length; f++) for (let k = 0; k < 3; k++) {
    const a = F[f][k], b = F[f][(k + 1) % 3], c = F[f][(k + 2) % 3];
    const key = a < b ? a * 1e6 + b : b * 1e6 + a;
    if (!emap.has(key)) { emap.set(key, E.length); E.push({ a, b, w1: c, w2: -1 }); } // a->b in face orientation, w1 left wing
    else E[emap.get(key)].w2 = c;
  }
  const vf = Array.from({ length: nv }, () => []), ve = Array.from({ length: nv }, () => []);
  F.forEach((t, i) => t.forEach(v => vf[v].push(i)));
  E.forEach((e, i) => [e.a, e.b, e.w1, e.w2].forEach(v => ve[v].push(i))); // every hinge that moves this vertex
  return { E, vf, ve };
}

// other reference shapes on the same (unit-sphere) mesh, lengths in µm
const SHAPES = {
  rbc: V => biconcave(V),
  sphere: (V, r) => V.map(p => p.map(x => x * r)),
  // oblate spheroid (platelet: a disc about 2.5 µm across and 0.6 µm thick)
  spheroid: (V, a, c) => V.map(([x, y, z]) => [a * x, a * y, c * z]),
  // irreversibly sickled cell: an elongated, tapered body bent into a crescent (long axis x, bent towards +y)
  sickle(V, len = 17, w = 4.6, t = 2.0, bend = 10) { // area 132 µm² (a normal membrane), volume 72 µm³ (dehydrated), 15 µm tip to tip
    const a = len / 2;
    return V.map(([x, y, z]) => {
      const taper = Math.pow(Math.max(1 - x * x, 0), 0.25) / Math.max(Math.sqrt(1 - x * x), 1e-6) * Math.sqrt(Math.max(1 - x * x, 0)); // blunter than an ellipsoid
      const X = a * x, Y = (w / 2) * y * taper, Z = (t / 2) * z * taper;
      const th = X / bend; // bend the centre line on a circle of radius 'bend'
      return [(bend - Y) * Math.sin(th), bend - (bend - Y) * Math.cos(th), Z];
    });
  },
};

// refine a deformed mesh of level l-1 to level l (fine.parents from icosphere(l)): new vertices at edge midpoints
function refine(X, fine) { return [...X.map(p => p.slice()), ...fine.parents.map(([a, b]) => [0, 1, 2].map(i => (X[a][i] + X[b][i]) / 2))]; }

function makeCell(level = 3, s = 1) {
  const { V, F } = icosphere(level);
  const X = biconcave(V, s);
  return { X, F, ...topology(F, X.length) };
}

if (typeof module !== 'undefined') module.exports = { EF, icosphere, biconcave, topology, makeCell, SHAPES, refine };

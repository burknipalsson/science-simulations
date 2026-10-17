// Random sequential addition of full-size red cells (random orientations) into a container, with a shape overlap test:
// each cell is treated as an oblate spheroid (semi-axes a, a, c, padded by gap) and two cells overlap if a sample
// of either one's surface points falls inside the other's padded spheroid.
function packCells({ N, inside, sample, rnd, a = 3.95, c = 1.35, gap = 0.25, maxTries = 400000 }) {
  // inside(p): true if a point (µm, container frame) is allowed (e.g. at least gap from the wall)
  // sample: [[x,y,z]...] points on the cell surface in its own frame (µm, disc plane xy)
  const cells = [], A = a + gap, C = c + gap, bound = 2 * A;
  const rot = () => {
    const u1 = rnd(), u2 = rnd(), u3 = rnd(), q = [Math.sqrt(1 - u1) * Math.sin(2 * Math.PI * u2), Math.sqrt(1 - u1) * Math.cos(2 * Math.PI * u2), Math.sqrt(u1) * Math.sin(2 * Math.PI * u3), Math.sqrt(u1) * Math.cos(2 * Math.PI * u3)];
    const [x, y, z, w] = q;
    return [[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)], [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)], [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]];
  };
  const apply = (M, p, t) => [0, 1, 2].map(i => M[i][0] * p[0] + M[i][1] * p[1] + M[i][2] * p[2] + t[i]);
  const inSpheroid = (cell, p, per) => { // p in container frame; cell = { M, t }
    let d = [p[0] - cell.t[0], p[1] - cell.t[1], p[2] - cell.t[2]];
    if (per) d = per(d);
    const M = cell.M, l = [0, 1, 2].map(j => M[0][j] * d[0] + M[1][j] * d[1] + M[2][j] * d[2]); // Mᵀ d
    return (l[0] * l[0] + l[1] * l[1]) / (A * A) + l[2] * l[2] / (C * C) < 1;
  };
  return {
    cells,
    // try to add one cell at a random point from gen(); per(d) maps a separation to its periodic minimum image
    tryAdd(gen, per) {
      for (let k = 0; k < maxTries; k++) {
        const t = gen(), M = rot(), pts = sample.map(p => apply(M, p, t));
        if (!pts.every(inside)) continue;
        let ok = true;
        for (const o of cells) {
          let d = [t[0] - o.t[0], t[1] - o.t[1], t[2] - o.t[2]]; if (per) d = per(d);
          if (Math.hypot(...d) > bound) continue;
          if (pts.some(p => inSpheroid(o, p, per)) || o.pts.some(p => inSpheroid({ M, t }, p, per))) { ok = false; break; }
        }
        if (ok) { cells.push({ M, t, pts }); return true; }
      }
      return false;
    },
  };
}
if (typeof module !== 'undefined') module.exports = { packCells };

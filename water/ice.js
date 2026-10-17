// Ice Ih builder: hexagonal oxygen lattice (c axis along z) with proton-disordered hydrogens
// obeying the Bernal–Fowler ice rules (each O donates two H bonds and accepts two), net dipole ~0.
'use strict';

// returns { O: Float64Array(3n), box: [Lx,Ly,Lz], nbr: Int32Array(4n), donors: Int32Array(2n) }
// a = hexagonal lattice constant (Å); O–O distance = a·sqrt(3/8)
function iceIhLattice(nx, ny, nz, a, rng = Math.random) {
  const c = a * Math.sqrt(8 / 3);
  const Lx = nx * a, Ly = ny * a * Math.sqrt(3), Lz = nz * c;
  const basis = [[1/3, 2/3, 1/16], [2/3, 1/3, 9/16], [2/3, 1/3, 15/16], [1/3, 2/3, 7/16]];
  const pts = [];
  const key = new Set();
  // hexagonal lattice a1=(a,0,0), a2=(-a/2, a√3/2, 0); orthorhombic cell holds 2 hex cells
  for (let k = 0; k < nz; k++) for (let j = -1; j <= 2 * ny + 1; j++) for (let i = -ny - 2; i <= nx + ny + 2; i++)
    for (const b of basis) {
      const f1 = i + b[0], f2 = j + b[1];
      let x = f1 * a - f2 * a / 2, y = f2 * a * Math.sqrt(3) / 2, z = (k + b[2]) * c;
      if (x < -1e-6 || x >= Lx - 1e-6 || y < -1e-6 || y >= Ly - 1e-6) continue;
      const kk = `${Math.round(x * 1e3)},${Math.round(y * 1e3)},${Math.round(z * 1e3)}`;
      if (key.has(kk)) continue; key.add(kk);
      pts.push(x, y, z);
    }
  const n = pts.length / 3, O = Float64Array.from(pts), box = [Lx, Ly, Lz];
  if (n !== 8 * nx * ny * nz) throw new Error('ice lattice count ' + n);
  // neighbour graph (4 per O)
  const dOO = a * Math.sqrt(3 / 8), cut2 = (dOO * 1.2) ** 2;
  const nbr = new Int32Array(4 * n).fill(-1), cnt = new Int32Array(n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let r2 = 0;
    for (let d = 0; d < 3; d++) { let dd = O[3*i+d] - O[3*j+d]; dd -= box[d] * Math.round(dd / box[d]); r2 += dd * dd; }
    if (r2 < cut2) { nbr[4*i + cnt[i]++] = j; nbr[4*j + cnt[j]++] = i; }
  }
  for (let i = 0; i < n; i++) if (cnt[i] !== 4) throw new Error('coordination ' + cnt[i]);
  // orient edges: random Eulerian walks give in = out = 2 at every vertex
  const dir = new Int8Array(4 * n);           // +1: i donates along edge slot, -1: accepts, 0: unset
  const slotOf = (i, j) => { for (let s = 0; s < 4; s++) if (nbr[4*i+s] === j) return s; return -1; };
  const free = i => { const s = []; for (let k = 0; k < 4; k++) if (!dir[4*i+k]) s.push(k); return s; };
  for (let v0 = 0; v0 < n; v0++) {
    while (free(v0).length) {
      let u = v0;
      do {
        const fs = free(u), k = fs[Math.floor(rng() * fs.length)], w = nbr[4*u+k];
        dir[4*u+k] = 1; dir[4*w + slotOf(w, u)] = -1;
        u = w;
      } while (u !== v0);
    }
  }
  // reduce the net dipole by flipping random directed loops
  const bondVec = (i, k) => {
    const j = nbr[4*i+k], r = [];
    for (let d = 0; d < 3; d++) { let dd = O[3*j+d] - O[3*i+d]; dd -= box[d] * Math.round(dd / box[d]); r.push(dd); }
    return r;
  };
  const dip = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 4; k++) if (dir[4*i+k] > 0) { const r = bondVec(i, k); for (let d = 0; d < 3; d++) dip[d] += r[d]; }
  for (let it = 0; it < 200 * n && Math.hypot(...dip) > 1e-6; it++) {
    // follow donor edges from a random start until a vertex repeats; flip that cycle
    const path = [], seen = new Map();
    let u = Math.floor(rng() * n);
    while (!seen.has(u)) {
      seen.set(u, path.length);
      const outs = []; for (let k = 0; k < 4; k++) if (dir[4*u+k] > 0) outs.push(k);
      const k = outs[Math.floor(rng() * outs.length)];
      path.push([u, k]); u = nbr[4*u+k];
    }
    const cyc = path.slice(seen.get(u));
    const dd = [0, 0, 0];
    for (const [i, k] of cyc) { const r = bondVec(i, k); for (let d = 0; d < 3; d++) dd[d] += r[d]; }
    const nd = dip.map((x, d) => x - 2 * dd[d]);
    if (Math.hypot(...nd) < Math.hypot(...dip) || (Math.hypot(...nd) === Math.hypot(...dip) && rng() < 0.5)) {
      for (const [i, k] of cyc) { const j = nbr[4*i+k]; dir[4*i+k] = -1; dir[4*j + slotOf(j, i)] = 1; }
      for (let d = 0; d < 3; d++) dip[d] = nd[d];
    }
  }
  const donors = new Int32Array(2 * n);
  for (let i = 0; i < n; i++) { let m = 0; for (let k = 0; k < 4; k++) if (dir[4*i+k] > 0) donors[2*i + m++] = nbr[4*i+k]; if (m !== 2) throw new Error('ice rule'); }
  return { O, box, nbr, donors, n, dipole: Math.hypot(...dip) };
}

// lab rotation matrix (rows) placing the water body frame so its two OH bonds point along
// the unit vectors d1, d2 (body: z = bisector towards the H's, x in plane, y normal)
function waterFrame(d1, d2) {
  const nz = norm([d1[0] + d2[0], d1[1] + d2[1], d1[2] + d2[2]]);
  const nx = norm([d1[0] - d2[0], d1[1] - d2[1], d1[2] - d2[2]]);
  const ny = [nz[1]*nx[2] - nz[2]*nx[1], nz[2]*nx[0] - nz[0]*nx[2], nz[0]*nx[1] - nz[1]*nx[0]];
  // R maps body -> lab: columns are the lab images of body axes
  return [nx[0], ny[0], nz[0], nx[1], ny[1], nz[1], nx[2], ny[2], nz[2]];
}
function norm(v) { const l = Math.hypot(v[0], v[1], v[2]); return [v[0]/l, v[1]/l, v[2]/l]; }

if (typeof module !== 'undefined') module.exports = { iceIhLattice, waterFrame }; else Object.assign(self, { iceIhLattice, waterFrame });

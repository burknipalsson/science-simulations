// Pack the Cosmic Web run for the page and choose where the Local Group sits in it.
// Criteria from the real Local Group: a Virgo-like cluster (0.6-2.5e15 Msun within 2.2 Mpc) at 14.5-18.5 Mpc,
// a total of 2-12e12 Msun within 1 Mpc, and a calm neighbourhood (no >2e14 Msun group within 8 Mpc).
const fs = require('fs'), zlib = require('zlib'), S = require('../scale.js');
const [file, Np] = [process.argv[2], +process.argv[3]];
const pos = new Float32Array(fs.readFileSync(file).buffer.slice(0)), N = pos.length / 3, L = 306.6;
const RHO = 0.31 * 2.775e11 * 0.68 * 0.68, MP = RHO * L ** 3 / N;               // Msun per particle
console.log(`N=${N}, particle mass ${MP.toExponential(3)} Msun`);
// cell lists for neighbour counting (2 Mpc cells)
const NC = 153, cell = L / NC, heads = new Int32Array(NC ** 3).fill(-1), next = new Int32Array(N);
const ci = (x) => Math.min(NC - 1, Math.floor(x * NC));
for (let i = 0; i < N; i++) { const c = ci(pos[3 * i]) + NC * (ci(pos[3 * i + 1]) + NC * ci(pos[3 * i + 2])); next[i] = heads[c]; heads[c] = i; }
function within(p, rMpc, cb) {
  const r = rMpc / L, n = Math.ceil(rMpc / cell);
  const cx = ci(p[0]), cy = ci(p[1]), cz = ci(p[2]);
  for (let dz = -n; dz <= n; dz++) for (let dy = -n; dy <= n; dy++) for (let dx = -n; dx <= n; dx++) {
    const c = ((cx + dx + NC) % NC) + NC * (((cy + dy + NC) % NC) + NC * ((cz + dz + NC) % NC));
    for (let j = heads[c]; j >= 0; j = next[j]) {
      let d = [0, 1, 2].map(k => { let v = pos[3 * j + k] - p[k]; v -= Math.round(v); return v; });
      if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < r * r) cb(j, d);
    }
  }
}
const count = (p, r) => { let n = 0; within(p, r, () => n++); return n; };
// clusters: density peaks on a coarse pass (every 8th particle as probe), mass within 2.2 Mpc
const peaks = [];
for (let i = 0; i < N; i += 8) {
  const p = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  const m = count(p, 1.0) * MP; if (m < 1.5e14) continue;
  // recentre on the local centre of mass
  let c = [0, 0, 0], n = 0; within(p, 1.5, (j, d) => { c = c.map((v, k) => v + d[k]); n++; });
  const q = p.map((v, k) => ((v + c[k] / n) % 1 + 1) % 1);
  const M = count(q, 2.2) * MP;
  if (!peaks.some(o => { const d = o.p.map((v, k) => { let x = v - q[k]; return x - Math.round(x); }); return Math.hypot(...d) * L < 3; })) peaks.push({ p: q, M });
  else { const o = peaks.find(o => { const d = o.p.map((v, k) => { let x = v - q[k]; return x - Math.round(x); }); return Math.hypot(...d) * L < 3; }); if (M > o.M) { o.p = q; o.M = M; } }
}
peaks.sort((a, b) => b.M - a.M);
console.log(`groups/clusters > 1.5e14 within 1 Mpc: ${peaks.length}; top: ${peaks.slice(0, 5).map(p => p.M.toExponential(2)).join(', ')}`);
const virgos = peaks.filter(p => p.M > 6e14 && p.M < 2.5e15);
const big = peaks.filter(p => p.M > 2e14);
// candidate LG sites: particles with 2-12e12 Msun within 1 Mpc
let best = null; const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
for (let i = 0; i < N; i += 3) {
  const p = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  let near = null;
  for (const v of virgos) { const d = Math.hypot(...v.p.map((x, k) => { let y = x - p[k]; return y - Math.round(y); })) * L; if (d > 14.5 && d < 18.5) near = { v, d }; }
  if (!near) continue;
  const m1 = count(p, 1.0) * MP; if (m1 < 2e12 || m1 > 1.2e13) continue;
  if (big.some(b => Math.hypot(...b.p.map((x, k) => { let y = x - p[k]; return y - Math.round(y); })) * L < 8)) continue;
  const m3 = count(p, 4.0) * MP, dens4 = m3 / (RHO * 4 / 3 * Math.PI * 64);
  const score = Math.abs(near.d - 16.5) + Math.abs(Math.log10(m1 / 5e12)) * 3 + Math.abs(dens4 - 1.6);   // Local Sheet: mildly overdense on 4 Mpc
  if (!best || score < best.score) best = { p, m1, d: near.d, vM: near.v.M, vp: near.v.p, dens4, score };
}
console.log('chosen LG site:', JSON.stringify({ ...best, p: best.p.map(x => +x.toFixed(5)), vp: best.vp.map(x => +x.toFixed(5)) }));
// recentre on the centre of mass within 1 Mpc
let c = [0, 0, 0], n = 0; within(best.p, 1.0, (j, d) => { c = c.map((v, k) => v + d[k]); n++; });
const lg = best.p.map((v, k) => v + c[k] / n);
// local sheet: inertia tensor of particles within 6 Mpc -> the flattest axis is the sheet's normal
const I = [0, 0, 0, 0, 0, 0, 0, 0, 0]; within(lg, 6, (j, d) => { for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) I[3 * a + b] += d[a] * d[b]; });
function eig3(A) { // Jacobi
  let a = A.slice(), V = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 50; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(a[3 * p + q]) < 1e-18) continue;
    const th = 0.5 * Math.atan2(2 * a[3 * p + q], a[3 * q + q] - a[3 * p + p]), c = Math.cos(th), s = Math.sin(th);
    const J = [1, 0, 0, 0, 1, 0, 0, 0, 1]; J[3 * p + p] = c; J[3 * q + q] = c; J[3 * p + q] = s; J[3 * q + p] = -s;
    a = S.mul(S.T(J), S.mul(a, J)); V = S.mul(V, J);
  }
  return { val: [a[0], a[4], a[8]], vec: [0, 1, 2].map(k => [V[k], V[3 + k], V[6 + k]]) };
}
const E = eig3(I); const kmin = E.val.indexOf(Math.min(...E.val)), sheetN = E.vec[kmin];
console.log('sheet axis ratios', E.val.map(v => Math.sqrt(v / Math.max(...E.val)).toFixed(2)), 'normal', sheetN.map(x => x.toFixed(3)));
// orientation: Galactic axes inside the box so that (1) the cluster lies toward the real Virgo (M87: l 283.78, b 74.49)
// and (2) the sheet normal lies as close as possible to the supergalactic pole (l 47.37, b 6.32)
const dv = best.vp.map((x, k) => { let y = x - lg[k]; return y - Math.round(y); }), dvn = dv.map(x => x / Math.hypot(...dv));
const gal = (l, b) => [Math.cos(b * S.D) * Math.cos(l * S.D), Math.cos(b * S.D) * Math.sin(l * S.D), Math.sin(b * S.D)];
const virgoG = gal(283.78, 74.49), sgpG = gal(47.37, 6.32);
const ortho = (u, v) => { const d = u[0] * v[0] + u[1] * v[1] + u[2] * v[2]; const w = v.map((x, i) => x - d * u[i]); const l = Math.hypot(...w); return w.map(x => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const bw = [dvn, ortho(dvn, sheetN)]; bw.push(cross(bw[0], bw[1]));          // web basis
const bg = [virgoG, ortho(virgoG, sgpG)]; bg.push(cross(bg[0], bg[1]));      // galactic basis
// rot (galactic -> web) = sum_i bw_i bg_i^T
const rot = [0, 0, 0, 0, 0, 0, 0, 0, 0]; for (let i = 0; i < 3; i++) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) rot[3 * a + b] += bw[i][a] * bg[i][b];
// pack: a random 1/8 of the box (uint16), plus every particle within 60 Mpc of the LG (int16 relative)
const far = [], nearArr = [], R = 60 / L;
for (let i = 0; i < N; i++) {
  if (rnd() < 1 / 8) for (let k = 0; k < 3; k++) far.push(Math.min(65535, Math.round(pos[3 * i + k] * 65536)));
  const d = [0, 1, 2].map(k => { let v = pos[3 * i + k] - lg[k]; return v - Math.round(v); });
  if (Math.hypot(...d) < R) for (let k = 0; k < 3; k++) nearArr.push(Math.round(d[k] / R * 32767));
}
const gz = a => zlib.gzipSync(Buffer.from(a.buffer), { level: 9 }).toString('base64');
const centred = lg.map(x => x - 0.5);                                       // web frame is box-centred
const out = { far: gz(Uint16Array.from(far)), near: gz(Int16Array.from(nearArr)), lg: centred, nearR: R, farSize: 0.0035, nearSize: 0.0012, farGain: 0.5, nearGain: 0.5,
  rot, virgo: dv.map((x, k) => x + centred[k]), virgoM: best.vM, lgM: best.m1, mp: MP, sheet: sheetN };
fs.writeFileSync('../web_data.js', 'globalThis.PTEN_WEB = ' + JSON.stringify(out) + ';\n');
console.log(`far ${far.length / 3}, near ${nearArr.length / 3}; web_data.js ${(fs.statSync('../web_data.js').size / 1024).toFixed(0)} KB`);

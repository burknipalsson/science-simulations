const P = require('./phys.js'), A = require('./ast.js');
const s0 = P.initial(require('./data/state0.json'));
const IDX = [0, 6, 7, 8, 9]; const M = IDX.map(i => i === 0 ? P.GM[0] + P.GM[1] + P.GM[2] + P.GM[3] + P.GM[4] + P.GM[5] : P.GM[i]);
const X = new Float64Array(15), V = new Float64Array(15), Acc = new Float64Array(15);
IDX.forEach((b, j) => { for (let k = 0; k < 3; k++) { X[3 * j + k] = s0.x[3 * b + k]; V[3 * j + k] = s0.v[3 * b + k]; } });
const W = (() => { const w = [-1.17767998417887, 0.235573213359357, 0.784513610477560]; const w0 = 1 - 2 * (w[0] + w[1] + w[2]); return [w[2], w[1], w[0], w0, w[0], w[1], w[2]]; })();
function acc() { Acc.fill(0); for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) { const d = [0, 1, 2].map(k => X[3 * j + k] - X[3 * i + k]); const r2 = d[0] ** 2 + d[1] ** 2 + d[2] ** 2, ir3 = 1 / (r2 * Math.sqrt(r2)); for (let k = 0; k < 3; k++) { Acc[3 * i + k] += M[j] * ir3 * d[k]; Acc[3 * j + k] -= M[i] * ir3 * d[k]; } } }
function stepP(h) { for (const w of W) { const d = w * h; for (let i = 0; i < 15; i++) X[i] += V[i] * d / 2; acc(); for (let i = 0; i < 15; i++) V[i] += Acc[i] * d; for (let i = 0; i < 15; i++) X[i] += V[i] * d / 2; } }
let seed = 17; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const parts = []; for (let k = 0; k < 600; k++) { const a = 1.9 + 2.35 * rnd(), e = 0.12 * rnd(), inc = 6 * rnd(); parts.push({ s: A.elemToState(a, e, inc, 360 * rnd(), 360 * rnd(), 360 * rnd()), a0: a }); }
const GMs = [6, 7, 8, 9].map(i => P.GM[i] * (process.env.NOPERT ? 0 : 1)); const IND = process.env.NOIND ? 0 : 1; const DT = +(process.env.DT || 20);
const aOf = s => A.stateToElem(s).a;
const a0 = parts.map(q => aOf(q.s));
const NMAX = Math.round(701 * 365.25 / DT); for (let n = 0; n < NMAX; n++) {
  stepP(DT / 2); const hp = [1, 2, 3, 4].map(j => [X[3 * j] - X[0], X[3 * j + 1] - X[1], X[3 * j + 2] - X[2]]);
  const pl = hp.flat();
  for (const q of parts) { if (q.dead) continue; A.kepler(q.s, DT / 2); let ax = 0, ay = 0, az = 0; for (let j = 0; j < 4; j++) { const [px, py, pz] = hp[j]; const dx = px - q.s[0], dy = py - q.s[1], dz = pz - q.s[2]; const d2 = dx * dx + dy * dy + dz * dz, id3 = 1 / (d2 * Math.sqrt(d2)); const rp2 = px * px + py * py + pz * pz, ir3 = 1 / (rp2 * Math.sqrt(rp2)); ax += GMs[j] * (dx * id3 - IND * px * ir3); ay += GMs[j] * (dy * id3 - IND * py * ir3); az += GMs[j] * (dz * id3 - IND * pz * ir3); } q.s[3] += ax * DT; q.s[4] += ay * DT; q.s[5] += az * DT; if (!A.kepler(q.s, DT / 2)) q.dead = true; }
  stepP(DT / 2);
  if ((n + 1) % Math.round(175 * 365.25 / DT) === 0) { let s = 0, sa = 0, c = 0; parts.forEach((q, i) => { if (q.dead) return; const d = aOf(q.s) - a0[i]; s += d; sa += Math.abs(d); c++; }); console.log('years', ((n + 1) * DT / 365.25).toFixed(0), 'mean da', (s / c).toExponential(2), 'mean |da|', (sa / c).toExponential(2)); }
}
const bins = {}; parts.forEach((q, i) => { if (q.dead) return; const b = (Math.floor(a0[i] * 4) / 4).toFixed(2); (bins[b] = bins[b] || []).push(aOf(q.s) - a0[i]); });
for (const [b, ds] of Object.entries(bins).sort()) { ds.sort((x, y) => x - y); console.log(b, 'n', ds.length, 'median', ds[ds.length >> 1].toExponential(2), 'mean', (ds.reduce((s, v) => s + v, 0) / ds.length).toExponential(2)); }

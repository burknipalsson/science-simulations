// Least-squares fit of the Moon's initial geocentric state (Earth-Moon barycenter held fixed) to DE441.
const P = require('./phys.js');
const ep = require('./data/state0.json'), rows = require('./data/moonfit.json');
const s0 = P.initial(ep);
const mu = P.GM[4] / (P.GM[3] + P.GM[4]);
function withDelta(p) {
  const s = P.copy(P.makeSystem(), s0);
  for (let k = 0; k < 3; k++) {
    s.x[12 + k] += (1 - mu) * p[k]; s.x[9 + k] -= mu * p[k];
    s.v[12 + k] += (1 - mu) * p[3 + k]; s.v[9 + k] -= mu * p[3 + k];
  }
  return s;
}
function resid(p) {
  const out = new Float64Array(rows.length * 3);
  for (const dir of [1, -1]) {
    const s = withDelta(p);
    const idx = rows.map((r, i) => i).filter(i => (rows[i].jd - P.EPOCH) * dir >= 0).sort((a, b) => dir * (rows[a].jd - rows[b].jd));
    for (const i of idx) {
      P.advance(s, rows[i].jd - P.EPOCH);
      for (let k = 0; k < 3; k++) out[3 * i + k] = (s.x[12 + k] - s.x[9 + k]) - rows[i].s[k];
    }
  }
  return out;
}
const rms = r => Math.sqrt(r.reduce((a, b) => a + b * b, 0) / r.length) * P.AU_KM;
let p = [0, 0, 0, 0, 0, 0];
const scl = [1e-9, 1e-9, 1e-9, 1e-11, 1e-11, 1e-11];
for (let it = 0; it < 3; it++) {
  const r0 = resid(p); console.log('iter', it, 'rms km', rms(r0).toFixed(2), 'p', p.map(v => v.toExponential(3)).join(' '));
  const J = [];
  for (let k = 0; k < 6; k++) { const q = p.slice(); q[k] += scl[k]; const r = resid(q); J.push(r.map((v, i) => (v - r0[i]) / scl[k])); }
  // normal equations
  const A = Array.from({ length: 6 }, () => new Float64Array(6)), b = new Float64Array(6);
  for (let a = 0; a < 6; a++) { for (let c = 0; c < 6; c++) { let sum = 0; for (let i = 0; i < r0.length; i++) sum += J[a][i] * J[c][i]; A[a][c] = sum; } let sb = 0; for (let i = 0; i < r0.length; i++) sb -= J[a][i] * r0[i]; b[a] = sb; }
  // solve by Gaussian elimination
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 6; i++) { let piv = i; for (let j = i + 1; j < 6; j++) if (Math.abs(M[j][i]) > Math.abs(M[piv][i])) piv = j; [M[i], M[piv]] = [M[piv], M[i]]; for (let j = i + 1; j < 6; j++) { const f = M[j][i] / M[i][i]; for (let k = i; k < 7; k++) M[j][k] -= f * M[i][k]; } }
  const d = new Array(6); for (let i = 5; i >= 0; i--) { let sum = M[i][6]; for (let k = i + 1; k < 6; k++) sum -= M[i][k] * d[k]; d[i] = sum / M[i][i]; }
  p = p.map((v, k) => v + d[k]);
}
const rf = resid(p); console.log('final rms km', rms(rf).toFixed(2));
console.log(JSON.stringify(p));
require('fs').writeFileSync('data/moon_delta.json', JSON.stringify(p));

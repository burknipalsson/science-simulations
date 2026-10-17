// Resonance lab experiment: uniform belt test particles under Jupiter/Saturn/Uranus/Neptune for deep time.
const P = require('./phys.js'), A = require('./ast.js');
const s0 = P.initial(require('./data/state0.json'));
// giants heliocentric state -> simple barycentric 5-body system integrated with Y6 at dt
const IDX = [0, 6, 7, 8, 9]; const M = IDX.map(i => P.GM[i] + (i === 0 ? P.GM[1] + P.GM[2] + P.GM[3] + P.GM[4] + P.GM[5] : 0));
const X = new Float64Array(15), V = new Float64Array(15);
IDX.forEach((b, j) => { for (let k = 0; k < 3; k++) { X[3 * j + k] = s0.x[3 * b + k]; V[3 * j + k] = s0.v[3 * b + k]; } });
const W = (() => { const w = [-1.17767998417887, 0.235573213359357, 0.784513610477560]; const w0 = 1 - 2 * (w[0] + w[1] + w[2]); return [w[2], w[1], w[0], w0, w[0], w[1], w[2]]; })();
const Acc = new Float64Array(15);
function acc() { Acc.fill(0); for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) { const dx = X[3 * j] - X[3 * i], dy = X[3 * j + 1] - X[3 * i + 1], dz = X[3 * j + 2] - X[3 * i + 2], r2 = dx * dx + dy * dy + dz * dz, ir3 = 1 / (r2 * Math.sqrt(r2)); for (let k = 0; k < 3; k++) { const d = [dx, dy, dz][k]; Acc[3 * i + k] += M[j] * ir3 * d; Acc[3 * j + k] -= M[i] * ir3 * d; } } }
function stepP(h) { for (const w of W) { const d = w * h; for (let i = 0; i < 15; i++) X[i] += V[i] * d / 2; acc(); for (let i = 0; i < 15; i++) V[i] += Acc[i] * d; for (let i = 0; i < 15; i++) X[i] += V[i] * d / 2; } }
const helio = (j, t) => [X[3 * j] - X[0], X[3 * j + 1] - X[1], X[3 * j + 2] - X[2]];
// particles
const NP = +(process.env.NP || 400), parts = [];
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (let p = 0; p < NP; p++) { const a = 2.1 + 1.3 * p / NP, e = 0.02 + 0.13 * rnd(), i = 5 * rnd(); parts.push({ a0: a, s: A.elemToState(a, e, i, 360 * rnd(), 360 * rnd(), 360 * rnd()), emax: e, alive: true }); }
const DT = 20, YEARS = +(process.env.YEARS || 20000), NS = Math.round(YEARS * 365.25 / DT);
const pl = new Float64Array(21); const MU = A.MU;
const GMs = [P.GM[6], P.GM[7], P.GM[8], P.GM[9]];
const t0 = Date.now();
for (let n = 0; n < NS; n++) {
  // planets to mid-step
  stepP(DT / 2);
  const hp = [1, 2, 3, 4].map(j => helio(j));
  for (const q of parts) { if (!q.alive) continue;
    if (!A.kepler(q.s, DT / 2)) { q.alive = false; continue; }
    let ax = 0, ay = 0, az = 0;
    for (let j = 0; j < 4; j++) { const [px, py, pz] = hp[j]; const dx = px - q.s[0], dy = py - q.s[1], dz = pz - q.s[2]; const d2 = dx * dx + dy * dy + dz * dz, id3 = 1 / (d2 * Math.sqrt(d2)); const rp2 = px * px + py * py + pz * pz, ir3 = 1 / (rp2 * Math.sqrt(rp2)); ax += GMs[j] * (dx * id3 - px * ir3); ay += GMs[j] * (dy * id3 - py * ir3); az += GMs[j] * (dz * id3 - pz * ir3); }
    q.s[3] += ax * DT; q.s[4] += ay * DT; q.s[5] += az * DT;
    if (!A.kepler(q.s, DT / 2)) { q.alive = false; continue; }
    if (n % 25 === 0) { const el = A.stateToElem(q.s); if (el.e > q.emax) q.emax = el.e; if (el.a * (1 - el.e) < 1.67 || el.e > 0.9) q.alive = false; }
  }
  stepP(DT / 2);
  if (n % Math.round(NS / 5) === 0) console.error('year', (n * DT / 365.25).toFixed(0), 'alive', parts.filter(q => q.alive).length, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
// report: bins of a0 with fraction removed and mean emax
const bins = {}; for (const q of parts) { const b = (Math.floor(q.a0 * 50) / 50).toFixed(2); (bins[b] = bins[b] || []).push(q); }
for (const [b, qs] of Object.entries(bins)) { const dead = qs.filter(q => !q.alive).length, em = Math.max(...qs.map(q => q.emax)); console.log(b, '#'.repeat(Math.round(em * 40)).padEnd(40), 'emax', em.toFixed(2), dead ? `removed ${dead}/${qs.length}` : ''); }

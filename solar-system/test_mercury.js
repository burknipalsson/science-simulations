// Mercury's perihelion: longitude of perihelion vs time, with and without general relativity.
const P = require('./phys.js');
const s0 = P.initial(require('./data/state0.json'), require('./data/moon_delta.json'));
function perihelion(s) { // heliocentric osculating longitude of perihelion (ecliptic J2000), radians
  const mu = P.GM[0] + P.GM[1];
  const r = [0, 1, 2].map(k => s.x[3 + k] - s.x[k]), v = [0, 1, 2].map(k => s.v[3 + k] - s.v[k]);
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const rn = Math.hypot(...r);
  const e = [0, 1, 2].map(k => ((v[(k + 1) % 3] * h[(k + 2) % 3] - v[(k + 2) % 3] * h[(k + 1) % 3]) / mu) - r[k] / rn);
  return Math.atan2(e[1], e[0]);
}
const YEARS = +(process.argv[2] || 1000);
const res = {};
for (const gr of [1, 0]) {
  const s = P.copy(P.makeSystem(), s0); s.gr = gr;
  const ts = [], ws = []; let prev = null, off = 0;
  for (let t = 0; t <= YEARS * 365.25; t += 20) {
    P.advance(s, t); let w = perihelion(s);
    if (prev !== null) { while (w + off - prev > Math.PI) off -= 2 * Math.PI; while (w + off - prev < -Math.PI) off += 2 * Math.PI; }
    w += off; prev = w; ts.push(t / 36525); ws.push(w * 206264.806);
  }
  const n = ts.length, mt = ts.reduce((a, b) => a + b) / n, mw = ws.reduce((a, b) => a + b) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (ts[i] - mt) * (ws[i] - mw); sxx += (ts[i] - mt) ** 2; }
  res[gr] = sxy / sxx; console.log(gr ? 'with Einstein' : 'Newton only ', (sxy / sxx).toFixed(2), '"/century');
}
console.log('GR contribution', (res[1] - res[0]).toFixed(2), '"/century (theory 42.98)');

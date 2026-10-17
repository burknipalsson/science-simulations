const P = require('./phys.js');
const eph = new P.Ephemeris(P.initial(require('./data/state0.json'), require('./data/moon_delta.json')));
eph.growTo(-800, 800, 1e9);
const out = new Float64Array(3 * P.N); let worst = new Array(P.N).fill(0);
for (let t = -700; t < 700; t += 3.7) {
  eph.interp(t, out); const s = eph.at(t);
  for (let i = 0; i < P.N; i++) { const d = Math.hypot(out[3 * i] - s.x[3 * i], out[3 * i + 1] - s.x[3 * i + 1], out[3 * i + 2] - s.x[3 * i + 2]) * P.AU_KM; worst[i] = Math.max(worst[i], d); }
  // EMB
}
P.BODIES.forEach((b, i) => console.log(b[0].padEnd(8), worst[i].toFixed(3), 'km'));

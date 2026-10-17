const P = require('./phys.js');
const eph = new P.Ephemeris(P.initial(require('./data/state0.json'), require('./data/moon_delta.json')));
const nb = require('./data/notable.json');
const tr = nb.craft['Voyager 2'];
eph.growTo(-17500, 0, 1e9);
const buf = new Float64Array(3 * P.N);
const SRC = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
// barycentric test particle, adaptive leapfrog(Y6) with sources from the ephemeris (Moon/Mercury via exact .at when close is unnecessary here)
function acc(t, x, a) {
  eph.interp(t, buf); a[0] = a[1] = a[2] = 0; let dmin = 1e9;
  for (const i of SRC) { const dx = buf[3 * i] - x[0], dy = buf[3 * i + 1] - x[1], dz = buf[3 * i + 2] - x[2], r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2), f = P.GM[i] / (r2 * r); a[0] += f * dx; a[1] += f * dy; a[2] += f * dz; if (i) dmin = Math.min(dmin, r / Math.cbrt(P.GM[i] / P.GM[0])); }
  return dmin;
}
const W = (() => { const w = [-1.17767998417887, 0.235573213359357, 0.784513610477560]; const w0 = 1 - 2 * (w[0] + w[1] + w[2]); return [w[2], w[1], w[0], w0, w[0], w[1], w[2]]; })();
function propagate(t, x, v, t1) {
  const a = [0, 0, 0];
  while (t < t1) {
    const dmin = acc(t, x, a);
    const h = Math.min(t1 - t, Math.max(0.002, Math.min(2, dmin * 0.5)));
    for (const w of W) { const d = w * h; for (let k = 0; k < 3; k++) x[k] += v[k] * d / 2; t += d / 2; acc(t, x, a); for (let k = 0; k < 3; k++) v[k] += a[k] * d; for (let k = 0; k < 3; k++) x[k] += v[k] * d / 2; t += d / 2; }
  }
  return t;
}
// start: heliocentric Horizons state -> barycentric
function startAt(jd) {
  const r = tr.find(r => Math.abs(r[0] - jd) < 0.01); eph.interp(jd - P.EPOCH, buf);
  return { t: jd - P.EPOCH, x: [r[1] + buf[0], r[2] + buf[1], r[3] + buf[2]], v: [r[4] + eph.at(jd - P.EPOCH).v[0], r[5] + eph.at(jd - P.EPOCH).v[1], r[6] + eph.at(jd - P.EPOCH).v[2]] };
}
const start = startAt(+(process.env.START || P.calToJd(1979, 6, 24)));
let { t, x, v } = start;
for (const [y, m, d, what] of [[1979, 7, 9, 'Jupiter flyby'], [1980, 6, 1, ''], [1981, 8, 1, 'before Saturn'], [1981, 8, 26, 'Saturn flyby']]) {
  const jd = P.calToJd(y, m, d); const ref = tr.reduce((b, r) => Math.abs(r[0] - jd) < Math.abs(b[0] - jd) ? r : b);
  t = propagate(t, x, v, ref[0] - P.EPOCH);
  eph.interp(t, buf);
  const hx = [x[0] - buf[0], x[1] - buf[1], x[2] - buf[2]];
  const err = Math.hypot(hx[0] - ref[1], hx[1] - ref[2], hx[2] - ref[3]) * P.AU_KM;
  const sat = Math.hypot(ref[1] + buf[0] - buf[21], ref[2] + buf[1] - buf[22], ref[3] + buf[2] - buf[23]) * P.AU_KM;
  const jup = Math.hypot(ref[1] + buf[0] - buf[18], ref[2] + buf[1] - buf[19], ref[3] + buf[2] - buf[20]) * P.AU_KM;
  console.log(`${y}-${m}-${d} ${what.padEnd(14)} our Voyager is ${err.toFixed(0).padStart(8)} km from the real one (real: ${jup.toFixed(0)} km from Jupiter, ${sat.toFixed(0)} km from Saturn); helio speed ${(Math.hypot(v[0], v[1], v[2]) * P.AU_KM / 86400).toFixed(2)} km/s`);
}
